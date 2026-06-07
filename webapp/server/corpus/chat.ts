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

import type { CorpusConfig } from './config.js';
import { chatCohere, type CohereChatTurn } from './oci/genai.js';
import { chatGemini } from './oci/gemini.js';
import { chatMimo } from './oci/mimo.js';
import { searchCorpus, type SearchHit, type SearchSnippet } from './search.js';

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

/**
 * Run one RAG turn. Retrieves, calls the model, and reshapes Cohere's
 * `documentIds` citations ("doc_0", "doc_2", ...) into 1-based source
 * indices that match the `sources` array in the response.
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
  const question = opts.question.trim();
  if (question.length === 0) throw new Error('question is required');

  const maxSources = clampInt(opts.maxSources, 1, 10, 6);
  const snippetsPerSource = clampInt(opts.snippetsPerSource, 1, 4, 2);
  const maxDistance = opts.maxDistance ?? 0.75;

  // ── 1. Retrieve ─────────────────────────────────────────────────────
  const t0 = Date.now();
  const search = await searchCorpus(cfg, {
    query: question,
    kind: opts.kind,
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
  const retrievalMs = Date.now() - t0;

  const sources: ChatSource[] = search.hits.map((hit, idx) => ({
    index: idx + 1,
    artifact: hit.artifact,
    snippets: hit.snippets,
    bestDistance: hit.bestDistance,
  }));

  // ── 2. Build the Cohere "documents" array ────────────────────────────
  // Cohere expects an id + snippet + optional title per document. We use
  // "doc_<index>" as the id so citations come back in a stable order, and
  // include the chunk's ordinal in the title so the UI can disambiguate
  // multi-chunk hits when it renders them.
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

  // Map history roles to Cohere's uppercase convention.
  const history: CohereChatTurn[] = (opts.history ?? [])
    .filter((t) => typeof t.content === 'string' && t.content.trim().length > 0)
    .map((t) => ({
      role: t.role === 'assistant' ? 'CHATBOT' : 'USER',
      message: t.content,
    }));

  // If retrieval found nothing, shortcut with a candid "I don't know" reply
  // instead of asking the model to hallucinate against an empty context.
  if (documents.length === 0) {
    return {
      answer:
        'I could not find anything in your research corpus that matches ' +
        'this question. Try rephrasing, relaxing the kind filter, or ' +
        'ingesting more source material.',
      citations: [],
      sources,
      retrievalMs,
      chatMs: 0,
      noSources: true,
    };
  }

  // ── 3. Chat ─────────────────────────────────────────────────────────
  const chatStart = performance.now();
  let outcome;
  const provider = opts.chatProvider || cfg.chatProvider;
  
  if (provider === 'gemini') {
    // If chatModel is provided, create a copy of cfg with the override
    const runCfg = opts.chatModel ? { ...cfg, geminiModel: opts.chatModel } : cfg;
    outcome = await chatGemini(runCfg, {
      question: opts.question,
      preamble: DEFAULT_PREAMBLE,
      history,
      documents,
    });
  } else if (provider === 'mimo') {
    const runCfg = opts.chatModel ? { ...cfg, mimoModel: opts.chatModel } : cfg;
    outcome = await chatMimo(runCfg, {
      question: opts.question,
      preamble: DEFAULT_PREAMBLE,
      history,
      documents,
    });
  } else {
    // Fall back to oci
    const runCfg = opts.chatModel ? { ...cfg, ociGenAiChatModel: opts.chatModel } : cfg;
    outcome = await chatCohere(runCfg, {
      question: opts.question,
      preamble: DEFAULT_PREAMBLE,
      history,
      documents,
      maxTokens: 900,
      temperature: 0.2,
    });
  }
  const chatMs = performance.now() - chatStart;

  // ── 4. Re-key citations to 1-based source indices ────────────────────
  // Cohere returns documentIds like ["doc_2_0", "doc_2_1"]. We turn those
  // back into [2] source indices, dedup, and sort ascending so the UI can
  // render "[1][3]" badges directly.
  const citations: ChatCitationSpan[] = outcome.citations.map((c) => {
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

  return {
    answer: outcome.text,
    citations,
    sources,
    retrievalMs,
    chatMs,
    noSources: false,
    finishReason: outcome.finishReason,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
  };
}
