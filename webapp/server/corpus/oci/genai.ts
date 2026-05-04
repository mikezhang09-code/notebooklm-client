/**
 * OCI Generative AI client — embeddings only (for now).
 *
 * Uses cohere.embed-multilingual-v3.0 → 1024-dim float vectors, cosine.
 * Handles English + Chinese + 100+ other languages, which matches the
 * mixed content this corpus will hold.
 */

import * as common from 'oci-common';
import * as genai from 'oci-generativeaiinference';
import type { CorpusConfig } from '../config.js';

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
 * Embed an array of strings. Automatically batches into ≤96-input chunks
 * and concatenates results in input order. Returns a flat `number[][]`.
 *
 * Cohere multilingual v3 quirks:
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
    return {
      ok: dim > 0,
      model: cfg.ociGenAiModel,
      dimensions: dim,
      ...(dim === 0 ? { error: 'empty embedding returned' } : {}),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
