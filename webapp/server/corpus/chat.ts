/**
 * Corpus-grounded chat (RAG).
 *
 *   question → semantic search over the corpus
 *            → flatten snippets into Cohere "documents" slots
 *            → chat call with chat history + documents
 *            → model returns text + citations pointing back at document ids
 *
 * The heavy lifting (embedding + kNN SQL + grouping) already lives in
 * `searchCorpus()`; this module just wires that retrieval step into a
 * Cohere chat call and repackages the response so the UI can render
 * inline citations next to the answer and show the underlying snippets.
 */

import oracledb from 'oracledb';
import type { CorpusConfig, ChatProvider } from './config.js';
import { chatCohere, type CohereChatTurn, type CohereChatOutcome } from './oci/genai.js';
import { chatGemini, chatGeminiStream } from './oci/gemini.js';
import { chatMimo } from './oci/mimo.js';
import { withConnection } from './oci/db.js';
import { getObjectBuffer } from './oci/storage.js';
import { extract } from './extract/index.js';
import { searchCorpus, type SearchHit, type SearchSnippet } from './search.js';

/** Max characters of a whole document fed into the prompt as a fallback. */
const WHOLE_DOC_CHAR_CAP = 48000;

/** Max chunks pulled per artifact when assembling a broad scope overview. */
const OVERVIEW_SNIPPETS_PER_DOC = 3;

/** Tolerant JSON parse for tags/metadata columns (CLOB string or object). */
function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'object') return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
}

/** Map an `artifacts` row (OUT_FORMAT_OBJECT) to the SearchHit artifact shape. */
function rowToArtifact(row: Record<string, unknown>): SearchHit['artifact'] {
  const createdAt = row['CREATED_AT'];
  return {
    id: String(row['ID']),
    kind: String(row['KIND']),
    origin: String(row['ORIGIN']),
    title: String(row['TITLE']),
    notebookId: (row['NOTEBOOK_ID'] as string | null) ?? null,
    artifactId: (row['ARTIFACT_ID'] as string | null) ?? null,
    bucket: String(row['BUCKET']),
    objectName: String(row['OBJECT_NAME']),
    mimeType: (row['MIME_TYPE'] as string | null) ?? null,
    sizeBytes: Number(row['SIZE_BYTES'] ?? 0),
    tags: parseJson<string[]>(row['TAGS'], []),
    metadata: parseJson<Record<string, unknown>>(row['METADATA'], {}),
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt ?? ''),
  };
}

/**
 * Load a single artifact's full text straight from Object Storage (fetch blob
 * → extract). Used as a fallback for a single-document chat whose target has no
 * indexed chunks, so the model can still answer from the whole document.
 * Returns null if the artifact is missing or its blob can't be read.
 */
async function loadWholeDocument(
  cfg: CorpusConfig,
  artifactId: string,
): Promise<{ artifact: SearchHit['artifact']; text: string } | null> {
  const row = await withConnection(cfg, async (conn) => {
    const r = await conn.execute<Record<string, unknown>>(
      `SELECT id, kind, origin, title, notebook_id, artifact_id, bucket,
              object_name, mime_type, size_bytes, tags, metadata, created_at
         FROM artifacts WHERE id = :id`,
      { id: artifactId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return r.rows?.[0];
  });
  if (!row) return null;

  const objectName = String(row['OBJECT_NAME']);
  let text = '';
  try {
    const buffer = await getObjectBuffer(cfg, objectName);
    text = await extract(buffer, (row['MIME_TYPE'] as string | null) ?? undefined, objectName);
  } catch (err) {
    console.warn(
      `[corpus.chat] whole-document load failed for ${artifactId}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return null;
  }

  return { text, artifact: rowToArtifact(row) };
}

/**
 * Build a "broad overview" context for a question that retrieval couldn't match
 * (e.g. "what are the main ideas?"). Rather than dead-ending, pull the opening
 * chunks of the most-recent artifacts in scope so the model still has something
 * representative to summarise. Honours the same scope filters as retrieval
 * (collection / category / notebook / kind) and returns 1-based ChatSources.
 */
async function loadScopeOverview(
  cfg: CorpusConfig,
  opts: ChatOptions,
  maxSources: number,
): Promise<ChatSource[]> {
  const filters: string[] = [];
  const binds: Record<string, unknown> = {};
  if (opts.kind) {
    filters.push('a.kind = :kind');
    binds['kind'] = opts.kind;
  }
  if (opts.kinds && opts.kinds.length > 0) {
    const ph = opts.kinds.map((_, i) => `:k${i}`);
    filters.push(`a.kind IN (${ph.join(', ')})`);
    opts.kinds.forEach((k, i) => {
      binds[`k${i}`] = k;
    });
  }
  if (opts.notebookId) {
    filters.push('a.notebook_id = :nb');
    binds['nb'] = opts.notebookId;
  }
  if (opts.collectionId) {
    filters.push('a.collection_id = :coll');
    binds['coll'] = opts.collectionId;
  }
  if (opts.category) {
    filters.push('a.category = :cat');
    binds['cat'] = opts.category;
  }
  const scope = filters.length ? filters.join(' AND ') : null;

  return withConnection(cfg, async (conn) => {
    // 1) Newest artifacts in scope that actually have indexed chunks.
    const artRes = await conn.execute<Record<string, unknown>>(
      `SELECT id, kind, origin, title, notebook_id, artifact_id, bucket,
              object_name, mime_type, size_bytes, tags, metadata, created_at
         FROM artifacts a
        WHERE ${scope ? `${scope} AND ` : ''}EXISTS (
                SELECT 1 FROM artifact_chunks c WHERE c.artifact_id = a.id)
        ORDER BY a.created_at DESC
        FETCH FIRST :n ROWS ONLY`,
      { ...binds, n: maxSources },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const artRows = artRes.rows ?? [];
    if (artRows.length === 0) return [];

    // 2) First few chunks (by ordinal) of each of those artifacts.
    const ids = artRows.map((r) => String(r['ID']));
    const idBinds: Record<string, string> = {};
    const idPh = ids.map((id, i) => {
      idBinds[`a${i}`] = id;
      return `:a${i}`;
    });
    const chunkRes = await conn.execute<Record<string, unknown>>(
      `SELECT chunk_id, artifact_id, ordinal, text, char_start, char_end
         FROM (
           SELECT c.id AS chunk_id, c.artifact_id AS artifact_id, c.ordinal AS ordinal,
                  SUBSTR(c.text, 1, 1200) AS text, c.char_start AS char_start,
                  c.char_end AS char_end,
                  ROW_NUMBER() OVER (
                    PARTITION BY c.artifact_id ORDER BY c.ordinal) AS rn
             FROM artifact_chunks c
            WHERE c.artifact_id IN (${idPh.join(', ')}))
        WHERE rn <= :per`,
      { ...idBinds, per: OVERVIEW_SNIPPETS_PER_DOC },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const byArtifact = new Map<string, SearchSnippet[]>();
    for (const row of chunkRes.rows ?? []) {
      const aid = String(row['ARTIFACT_ID']);
      const list = byArtifact.get(aid) ?? [];
      list.push({
        chunkId: String(row['CHUNK_ID']),
        ordinal: Number(row['ORDINAL'] ?? 0),
        distance: 1,
        text: String(row['TEXT'] ?? ''),
        charStart: Number(row['CHAR_START'] ?? 0),
        charEnd: Number(row['CHAR_END'] ?? 0),
      });
      byArtifact.set(aid, list);
    }

    // Reindex contiguously 1..N so the doc ids line up with the source list.
    const sources: ChatSource[] = [];
    for (const row of artRows) {
      const snippets = byArtifact.get(String(row['ID']));
      if (!snippets || snippets.length === 0) continue;
      sources.push({
        index: sources.length + 1,
        artifact: rowToArtifact(row),
        snippets,
        bestDistance: 1,
      });
    }
    return sources;
  });
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  /** Current user question. */
  question: string;
  /** Prior turns in the conversation, oldest → newest. */
  history?: ChatTurn[];
  /** Optional kind filter passed through to retrieval. */
  kind?: string;
  /** Optional any-of kind filter passed through to retrieval. */
  kinds?: string[];
  /** Optional notebook filter passed through to retrieval. */
  notebookId?: string;
  /** Optional collection filter — scope chat to one collection. */
  collectionId?: string;
  /** Optional category filter: notebooklm | collection | freeform. */
  category?: string;
  /** Optional single-artifact filter — scope chat to one document. */
  artifactId?: string;
  /** How many artifacts to retrieve (default 6, max 10). */
  maxSources?: number;
  /** How many snippets per artifact to feed into the prompt (default 2, max 4). */
  snippetsPerSource?: number;
  /**
   * Cosine-distance ceiling for snippets to be considered relevant.
   * Default 0.75 — anything worse is probably off-topic.
   */
  maxDistance?: number;
  /** Optional override for chat provider */
  chatProvider?: string;
  /** Optional override for chat model */
  chatModel?: string;
}

export interface ChatCitationSpan {
  start: number;
  end: number;
  text: string;
  /** Indices into the `sources` array (1-based, matching what we tell the model). */
  sourceIndices: number[];
}

export interface ChatSource {
  index: number; // 1-based display index matching the model's citation IDs
  artifact: SearchHit['artifact'];
  snippets: SearchSnippet[];
  bestDistance: number;
}

export interface ChatResult {
  answer: string;
  citations: ChatCitationSpan[];
  sources: ChatSource[];
  /** Diagnostic timings. */
  retrievalMs: number;
  chatMs: number;
  /** True if retrieval produced no hits — the model was asked to say so. */
  noSources: boolean;
  /**
   * True if the answer was grounded in a broad scope overview (opening chunks
   * of the scope's documents) rather than a targeted semantic match — used when
   * a summary-style question finds nothing through kNN retrieval.
   */
  overview: boolean;
  /** Which provider actually produced the answer (after any failover). */
  provider?: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

const DEFAULT_PREAMBLE = `You are a careful research assistant. You answer
the user's questions based ONLY on the documents provided to you through the
retrieval step. When you use a fact from a document, cite it inline in the
form [1], [2], etc., matching the document ids. If the documents do not
contain enough information to answer, say so explicitly instead of
speculating. Prefer concise, structured answers; use short bullet points when
comparing multiple items. Preserve numbers, dates, and proper nouns exactly
as they appear in the sources.`;

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value as number)) return fallback;
  return Math.min(Math.max(Math.floor(value as number), min), max);
}

/** Build the Cohere/Gemini "documents" array from resolved chat sources. */
function buildDocuments(
  sources: ChatSource[],
): Array<{ id: string; title: string; snippet: string }> {
  const documents: Array<{ id: string; title: string; snippet: string }> = [];
  for (const src of sources) {
    for (const snip of src.snippets) {
      documents.push({
        id: `doc_${src.index}_${snip.ordinal}`,
        title: `[${src.index}] ${src.artifact.title} · chunk #${snip.ordinal}`,
        snippet: snip.text,
      });
    }
  }
  return documents;
}

interface PreparedChat {
  sources: ChatSource[];
  documents: Array<{ id: string; title: string; snippet: string }>;
  history: CohereChatTurn[];
  retrievalMs: number;
  /** True when sources came from the broad scope-overview fallback. */
  overview: boolean;
  /** Non-null when there is nothing to answer from (short-circuit reply). */
  emptyAnswer: string | null;
}

/**
 * Shared retrieval + context assembly for both the buffered and streaming chat
 * paths: run kNN retrieval, fall back to whole-document (single-doc scope) or a
 * broad scope overview (collection/corpus scope) when retrieval is empty, and
 * map the conversation history. Leaves the actual model call to the caller.
 */
async function prepareChat(cfg: CorpusConfig, opts: ChatOptions): Promise<PreparedChat> {
  const maxSources = clampInt(opts.maxSources, 1, 10, 6);
  // A single-document chat (artifactId) explicitly targets one doc, so feed the
  // model more of its chunks and don't filter them out by distance — the user
  // already chose the source. Broader chats keep the tighter relevance gate.
  const singleDoc = Boolean(opts.artifactId);
  const snippetsPerSource = clampInt(opts.snippetsPerSource, 1, 8, singleDoc ? 6 : 2);
  const maxDistance = opts.maxDistance ?? (singleDoc ? 2 : 0.75);

  // ── 1. Retrieve ─────────────────────────────────────────────────────
  const t0 = Date.now();
  const search = await searchCorpus(cfg, {
    query: opts.question.trim(),
    kind: opts.kind,
    kinds: opts.kinds,
    notebookId: opts.notebookId,
    collectionId: opts.collectionId,
    category: opts.category,
    artifactId: opts.artifactId,
    artifactLimit: maxSources,
    snippetsPerArtifact: snippetsPerSource,
    // Scan a bit wider than what we keep to give the grouper some headroom.
    candidateLimit: Math.max(40, maxSources * snippetsPerSource * 4),
    maxDistance,
  });

  let sources: ChatSource[] = search.hits.map((hit, idx) => ({
    index: idx + 1,
    artifact: hit.artifact,
    snippets: hit.snippets,
    bestDistance: hit.bestDistance,
  }));
  let documents = buildDocuments(sources);
  let overview = false;

  // Whole-document fallback: a single-document chat whose target has no indexed
  // chunks (un-embedded upload, or one that fell outside retrieval) is still
  // answered by loading the full document text directly into the prompt.
  if (documents.length === 0 && singleDoc && opts.artifactId) {
    const whole = await loadWholeDocument(cfg, opts.artifactId);
    if (whole && whole.text.trim().length > 0) {
      const capped = whole.text.slice(0, WHOLE_DOC_CHAR_CAP);
      // The source keeps a short preview (network payload), but the model is fed
      // the full capped text directly as its single document.
      sources = [
        {
          index: 1,
          artifact: whole.artifact,
          snippets: [
            {
              chunkId: 'whole-document',
              ordinal: 0,
              distance: 0,
              text: capped.slice(0, 1200),
              charStart: 0,
              charEnd: capped.length,
            },
          ],
          bestDistance: 0,
        },
      ];
      documents = [
        {
          id: 'doc_1_0',
          title: `[1] ${whole.artifact.title} · full document`,
          snippet: capped,
        },
      ];
    }
  }

  // Broad scope overview fallback: a collection-/corpus-scoped summary question
  // (e.g. "what are the main ideas?") rarely matches any single chunk closely,
  // so retrieval comes back empty. Rather than dead-ending, ground the answer in
  // the opening chunks of the scope's documents.
  if (documents.length === 0 && !singleDoc) {
    const ov = await loadScopeOverview(cfg, opts, maxSources);
    if (ov.length > 0) {
      sources = ov;
      documents = buildDocuments(sources);
      overview = true;
    }
  }

  const retrievalMs = Date.now() - t0;

  // Map history roles to Cohere's uppercase convention.
  const history: CohereChatTurn[] = (opts.history ?? [])
    .filter((t) => typeof t.content === 'string' && t.content.trim().length > 0)
    .map((t) => ({
      role: t.role === 'assistant' ? 'CHATBOT' : 'USER',
      message: t.content,
    }));

  // If everything came back empty, hand the caller a candid reply to surface
  // instead of asking the model to hallucinate against an empty context.
  let emptyAnswer: string | null = null;
  if (documents.length === 0) {
    emptyAnswer = singleDoc
      ? "I couldn't find any indexed text for this document, so I can't answer " +
        'questions about it yet. This usually means it has no extractable text ' +
        '(e.g. a scanned or image-only PDF), media that is still being ' +
        'transcribed, or that ingestion has not finished. Try re-uploading it ' +
        'or check its status.'
      : 'I could not find anything in your research corpus that matches ' +
        'this question. Try rephrasing, relaxing the kind filter, or ' +
        'ingesting more source material.';
  }

  return { sources, documents, history, retrievalMs, overview, emptyAnswer };
}

/** Resolve the provider chain: an explicit override pins one, else cfg's chain. */
function resolveChain(cfg: CorpusConfig, opts: ChatOptions): ChatProvider[] {
  return opts.chatProvider
    ? [opts.chatProvider as ChatProvider]
    : cfg.chatProviderChain.length > 0
      ? cfg.chatProviderChain
      : [cfg.chatProvider];
}

/**
 * Re-key Cohere/Gemini documentIds ("doc_2_0", "doc_2_1", …) back into 1-based
 * source indices, deduped + sorted, so the UI can render "[1][3]" badges.
 */
function rekeyCitations(outcome: CohereChatOutcome): ChatCitationSpan[] {
  return outcome.citations.map((c) => {
    const set = new Set<number>();
    for (const id of c.documentIds) {
      const m = /^doc_(\d+)/.exec(id);
      if (m?.[1]) set.add(parseInt(m[1], 10));
    }
    return {
      start: c.start,
      end: c.end,
      text: c.text,
      sourceIndices: Array.from(set).sort((a, b) => a - b),
    };
  });
}

/**
 * Run one RAG turn. Retrieves, calls the model, and reshapes the model's
 * `documentIds` citations into 1-based source indices that match `sources`.
 */
export async function chatCorpus(
  cfg: CorpusConfig,
  opts: ChatOptions,
): Promise<ChatResult> {
  if (cfg.chatProvider === 'disabled') {
    throw new Error(
      'corpus chat disabled — set CHAT_PROVIDER or GEMINI_API_KEY in .env to enable',
    );
  }
  if (opts.question.trim().length === 0) throw new Error('question is required');

  const prep = await prepareChat(cfg, opts);
  if (prep.emptyAnswer != null) {
    return {
      answer: prep.emptyAnswer,
      citations: [],
      sources: prep.sources,
      retrievalMs: prep.retrievalMs,
      chatMs: 0,
      noSources: true,
      overview: false,
    };
  }

  // ── Chat (with provider failover) ────────────────────────────────────
  const runProvider = (provider: ChatProvider) => {
    if (provider === 'gemini') {
      const runCfg = opts.chatModel ? { ...cfg, geminiModel: opts.chatModel } : cfg;
      return chatGemini(runCfg, {
        question: opts.question,
        preamble: DEFAULT_PREAMBLE,
        history: prep.history,
        documents: prep.documents,
      });
    }
    if (provider === 'mimo') {
      const runCfg = opts.chatModel ? { ...cfg, mimoModel: opts.chatModel } : cfg;
      return chatMimo(runCfg, {
        question: opts.question,
        preamble: DEFAULT_PREAMBLE,
        history: prep.history,
        documents: prep.documents,
      });
    }
    // oci (cohere)
    const runCfg = opts.chatModel ? { ...cfg, ociGenAiChatModel: opts.chatModel } : cfg;
    return chatCohere(runCfg, {
      question: opts.question,
      preamble: DEFAULT_PREAMBLE,
      history: prep.history,
      documents: prep.documents,
      maxTokens: 900,
      temperature: 0.2,
    });
  };

  const chain = resolveChain(cfg, opts);
  const chatStart = performance.now();
  let outcome: CohereChatOutcome | undefined;
  let usedProvider: ChatProvider | undefined;
  let lastErr: unknown;
  for (const provider of chain) {
    try {
      outcome = await runProvider(provider);
      usedProvider = provider;
      break;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[corpus.chat] provider "${provider}" failed: ` +
          `${err instanceof Error ? err.message : String(err)}` +
          (provider === chain[chain.length - 1] ? '' : ' — trying next'),
      );
    }
  }
  if (!outcome) {
    throw lastErr instanceof Error ? lastErr : new Error('all chat providers failed');
  }
  const chatMs = performance.now() - chatStart;

  return {
    answer: outcome.text,
    citations: rekeyCitations(outcome),
    sources: prep.sources,
    retrievalMs: prep.retrievalMs,
    chatMs,
    noSources: false,
    overview: prep.overview,
    provider: usedProvider,
    finishReason: outcome.finishReason,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
  };
}

/**
 * Streaming variant of {@link chatCorpus}. Identical retrieval + fallback +
 * citation handling, but emits the answer incrementally through `onDelta` as it
 * is generated (token streaming for Gemini; a single chunk for other providers)
 * and resolves with the same final {@link ChatResult}.
 *
 * Provider failover only applies before the first delta is emitted — once
 * partial text has reached the client we can't cleanly switch providers, so a
 * mid-stream failure surfaces as an error.
 */
export async function chatCorpusStream(
  cfg: CorpusConfig,
  opts: ChatOptions,
  onDelta: (textFragment: string) => void,
): Promise<ChatResult> {
  if (cfg.chatProvider === 'disabled') {
    throw new Error(
      'corpus chat disabled — set CHAT_PROVIDER or GEMINI_API_KEY in .env to enable',
    );
  }
  if (opts.question.trim().length === 0) throw new Error('question is required');

  const prep = await prepareChat(cfg, opts);
  if (prep.emptyAnswer != null) {
    onDelta(prep.emptyAnswer);
    return {
      answer: prep.emptyAnswer,
      citations: [],
      sources: prep.sources,
      retrievalMs: prep.retrievalMs,
      chatMs: 0,
      noSources: true,
      overview: false,
    };
  }

  const chain = resolveChain(cfg, opts);
  const chatStart = performance.now();
  let outcome: CohereChatOutcome | undefined;
  let usedProvider: ChatProvider | undefined;
  let emitted = false;
  let lastErr: unknown;

  for (const provider of chain) {
    try {
      const onceDelta = (t: string) => {
        emitted = true;
        onDelta(t);
      };
      if (provider === 'gemini') {
        const runCfg = opts.chatModel ? { ...cfg, geminiModel: opts.chatModel } : cfg;
        outcome = await chatGeminiStream(
          runCfg,
          {
            question: opts.question,
            preamble: DEFAULT_PREAMBLE,
            history: prep.history,
            documents: prep.documents,
          },
          onceDelta,
        );
      } else if (provider === 'mimo') {
        const runCfg = opts.chatModel ? { ...cfg, mimoModel: opts.chatModel } : cfg;
        outcome = await chatMimo(runCfg, {
          question: opts.question,
          preamble: DEFAULT_PREAMBLE,
          history: prep.history,
          documents: prep.documents,
        });
        onceDelta(outcome.text);
      } else {
        const runCfg = opts.chatModel ? { ...cfg, ociGenAiChatModel: opts.chatModel } : cfg;
        outcome = await chatCohere(runCfg, {
          question: opts.question,
          preamble: DEFAULT_PREAMBLE,
          history: prep.history,
          documents: prep.documents,
          maxTokens: 900,
          temperature: 0.2,
        });
        onceDelta(outcome.text);
      }
      usedProvider = provider;
      break;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[corpus.chat] provider "${provider}" failed: ` +
          `${err instanceof Error ? err.message : String(err)}` +
          (emitted || provider === chain[chain.length - 1] ? '' : ' — trying next'),
      );
      // Can't fail over once partial output has reached the client.
      if (emitted) throw err;
    }
  }
  if (!outcome) {
    throw lastErr instanceof Error ? lastErr : new Error('all chat providers failed');
  }
  const chatMs = performance.now() - chatStart;

  return {
    answer: outcome.text,
    citations: rekeyCitations(outcome),
    sources: prep.sources,
    retrievalMs: prep.retrievalMs,
    chatMs,
    noSources: false,
    overview: prep.overview,
    provider: usedProvider,
    finishReason: outcome.finishReason,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
  };
}
