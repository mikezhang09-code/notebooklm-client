/**
 * OCI Generative AI client — embeddings only (for now).
 *
 * Uses cohere.embed-multilingual-v3.0 → 1024-dim float vectors, cosine.
 * Handles English + Chinese + 100+ other languages, which matches the
 * mixed content this corpus will hold.
 */

import * as common from 'oci-common';
import * as genai from 'oci-generativeaiinference';
import oracledb from 'oracledb';
import type { CorpusConfig } from '../config.js';
import { withConnection } from './db.js';
import { embedTextsGemini } from './gemini.js';

/** Max inputs per embed call for cohere multilingual v3. */
const EMBED_BATCH_SIZE = 96;

let clientPromise: Promise<genai.GenerativeAiInferenceClient> | null = null;

async function buildClient(cfg: CorpusConfig): Promise<genai.GenerativeAiInferenceClient> {
  const provider = new common.ConfigFileAuthenticationDetailsProvider(
    cfg.ociConfigFile,
    cfg.ociProfile,
  );
  const client = new genai.GenerativeAiInferenceClient({
    authenticationDetailsProvider: provider,
  });
  // Use the GenAI-specific region — may differ from the home/storage/db region
  // because not every OCI region hosts Generative AI (e.g. ap-tokyo-1 doesn't;
  // Tokyo tenancies cross-region to ap-osaka-1).
  client.regionId = cfg.ociGenAiRegion;
  // Pin the inference endpoint explicitly — SDK normally derives it from
  // regionId but being explicit avoids surprises across SDK versions.
  client.endpoint = `https://inference.generativeai.${cfg.ociGenAiRegion}.oci.oraclecloud.com`;
  return client;
}

export async function getGenAiClient(cfg: CorpusConfig): Promise<genai.GenerativeAiInferenceClient> {
  if (!clientPromise) clientPromise = buildClient(cfg);
  return clientPromise;
}

export type EmbedInputType =
  | 'SEARCH_DOCUMENT' // for indexing (corpus chunks)
  | 'SEARCH_QUERY' //   for queries  (user search input)
  | 'CLASSIFICATION'
  | 'CLUSTERING';

/**
 * Embed an array of strings. Dispatches to either OCI GenAI or the
 * in-database ONNX model based on `cfg.embeddingProvider`.
 *
 * Cohere multilingual v3 quirks (OCI path):
 *  - max 512 input tokens per string (≈ 2000 English chars or 1000 CJK chars)
 *  - we set `truncate: 'END'` so the model trims rather than 400-erroring
 *  - `inputType` distinguishes index vs query passes (Cohere v3 trains different vectors)
 */
export async function embedTexts(
  cfg: CorpusConfig,
  texts: string[],
  inputType: EmbedInputType = 'SEARCH_DOCUMENT',
): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (cfg.embeddingProvider === 'database') {
    return embedTextsInDb(cfg, texts);
  }

  if (cfg.embeddingProvider === 'gemini') {
    return embedTextsGemini(cfg, texts);
  }

  return embedTextsOci(cfg, texts, inputType);
}

/**
 * OCI GenAI embedding path — calls the Cohere embed API via REST.
 * Automatically batches into ≤96-input chunks.
 */
async function embedTextsOci(
  cfg: CorpusConfig,
  texts: string[],
  inputType: EmbedInputType,
): Promise<number[][]> {
  const client = await getGenAiClient(cfg);
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const response = await client.embedText({
      embedTextDetails: {
        compartmentId: cfg.ociCompartmentId,
        inputs: batch,
        truncate: genai.models.EmbedTextDetails.Truncate.End,
        inputType: inputType as unknown as genai.models.EmbedTextDetails.InputType,
        servingMode: {
          servingType: 'ON_DEMAND',
          modelId: cfg.ociGenAiModel,
        } as genai.models.OnDemandServingMode,
      },
    });
    const embeddings = response.embedTextResult.embeddings;
    if (!embeddings || embeddings.length !== batch.length) {
      throw new Error(
        `OCI GenAI returned ${embeddings?.length ?? 0} vectors for ${batch.length} inputs`,
      );
    }
    for (const vec of embeddings) results.push(vec);
  }

  return results;
}

/**
 * In-database ONNX embedding — calls VECTOR_EMBEDDING() SQL function.
 *
 * The ONNX model must have been loaded into the database beforehand via
 * DBMS_VECTOR.LOAD_ONNX_MODEL_CLOUD (see implementation plan / README).
 *
 * Benefits:
 *   - Zero GenAI billing — runs entirely inside Oracle ADB
 *   - No network round-trip — data stays inside the DB
 *   - Works on Always Free tier ADB instances
 *
 * The inputType parameter is ignored because ONNX models don't distinguish
 * SEARCH_QUERY vs SEARCH_DOCUMENT like Cohere v3 does. For symmetric models
 * like bge-m3 this is fine; for asymmetric models the quality difference is
 * negligible in practice.
 */
async function embedTextsInDb(
  cfg: CorpusConfig,
  texts: string[],
): Promise<number[][]> {
  const modelName = cfg.dbEmbedModel ?? 'BGE_M3_MODEL';

  return withConnection(cfg, async (conn) => {
    const results: number[][] = [];
    // Process one at a time — VECTOR_EMBEDDING is a single-row SQL function.
    // For bulk ingests this is slower than the OCI batch API but eliminates
    // all billing; a future optimisation can use PL/SQL BULK COLLECT.
    for (const text of texts) {
      // Truncate to ~8000 chars — Oracle's ONNX runtime has a token limit
      // and will error on overly long inputs. 8000 chars covers ~2000 CJK
      // or ~4000 English tokens, well within bge-m3's 8192-token capacity.
      const truncated = text.slice(0, 8000);
      const result = await conn.execute(
        // Model name is a SQL identifier, not a bind variable — this is safe
        // because it comes from a config constant, not user input.
        `SELECT VECTOR_EMBEDDING(${modelName} USING :txt AS DATA) AS emb FROM DUAL`,
        { txt: truncated },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = result.rows?.[0] as { EMB?: unknown } | undefined;
      if (!row?.EMB) {
        throw new Error(
          `VECTOR_EMBEDDING(${modelName}) returned null — is the model loaded?`,
        );
      }
      // oracledb returns VECTOR columns as Float64Array or number[];
      // normalise to number[] for consistency with the OCI path.
      const vec = row.EMB;
      if (vec instanceof Float64Array || vec instanceof Float32Array) {
        results.push(Array.from(vec));
      } else if (Array.isArray(vec)) {
        results.push(vec as number[]);
      } else {
        throw new Error(
          `VECTOR_EMBEDDING returned unexpected type: ${typeof vec}`,
        );
      }
    }
    return results;
  });
}

// ─────────────────────────────────────────────────────────── chat (RAG) ──

export interface CohereChatTurn {
  role: 'USER' | 'CHATBOT' | 'SYSTEM';
  message: string;
}

export interface CohereChatDocument {
  id: string;
  title?: string;
  snippet: string;
}

export interface CohereChatCitation {
  start: number;
  end: number;
  text: string;
  documentIds: string[];
}

export interface CohereChatOutcome {
  text: string;
  citations: CohereChatCitation[];
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Run a single Cohere-style chat turn through OCI Generative AI.
 *
 * We use the Cohere chat API because it accepts a first-class `documents`
 * array — when supplied, the model emits citations pointing back at the
 * documents it relied on, which is exactly what we need for RAG answers.
 *
 * Non-streaming for v1; streaming can be layered on later behind SSE.
 */
export async function chatCohere(
  cfg: CorpusConfig,
  opts: {
    question: string;
    preamble?: string;
    history?: CohereChatTurn[];
    documents?: CohereChatDocument[];
    maxTokens?: number;
    temperature?: number;
  },
): Promise<CohereChatOutcome> {
  if (!cfg.ociGenAiChatModel) {
    throw new Error(
      'chat model not configured — set OCI_GENAI_CHAT_MODEL in .env',
    );
  }
  const client = await getGenAiClient(cfg);

  // OCI SDK expects loose shapes for chatRequest; cast through unknown to
  // bypass the strict overly-specific type on ChatDetails.chatRequest.
  const chatRequest = {
    apiFormat: 'COHERE',
    message: opts.question,
    preambleOverride: opts.preamble,
    chatHistory: opts.history?.map((h) => ({
      role: h.role,
      message: h.message,
    })),
    documents: opts.documents,
    maxTokens: opts.maxTokens ?? 900,
    temperature: opts.temperature ?? 0.3,
    isStream: false,
    citationQuality: 'ACCURATE',
  } as unknown as genai.models.CohereChatRequest;

  // `client.chat` returns `ChatResponse | ReadableStream` because the SDK
  // uses streaming when `isStream: true`. We force non-streaming above, so
  // narrow to the non-stream branch here.
  const response = (await client.chat({
    chatDetails: {
      compartmentId: cfg.ociCompartmentId,
      servingMode: {
        servingType: 'ON_DEMAND',
        modelId: cfg.ociGenAiChatModel,
      } as genai.models.OnDemandServingMode,
      chatRequest,
    },
  })) as unknown as { chatResult?: { chatResponse?: genai.models.CohereChatResponse } };

  const result = (response?.chatResult?.chatResponse ??
    {}) as genai.models.CohereChatResponse;
  return {
    text: result.text ?? '',
    citations: (result.citations ?? []).map((c) => ({
      start: c.start,
      end: c.end,
      text: c.text,
      documentIds: c.documentIds ?? [],
    })),
    finishReason: result.finishReason,
    inputTokens: result.usage?.promptTokens,
    outputTokens: result.usage?.completionTokens,
  };
}

// ────────────────────────────────────────────────────────────── health ──

/**
 * Health check — embeds a single short test string and verifies dimensions.
 */
export async function genaiHealthCheck(cfg: CorpusConfig): Promise<{
  ok: boolean;
  model?: string;
  dimensions?: number;
  error?: string;
}> {
  try {
    const vectors = await embedTexts(cfg, ['hello world'], 'SEARCH_QUERY');
    const dim = vectors[0]?.length ?? 0;
    const actualModel =
      cfg.embeddingProvider === 'database'
        ? cfg.dbEmbedModel
        : cfg.embeddingProvider === 'gemini'
          ? cfg.geminiEmbedModel
          : cfg.ociGenAiModel;

    return {
      ok: dim > 0,
      model: actualModel,
      dimensions: dim,
      ...(dim === 0 ? { error: 'empty embedding returned' } : {}),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
