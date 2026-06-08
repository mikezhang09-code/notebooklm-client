/**
 * Google Gemini chat provider for corpus RAG.
 *
 * Replaces the OCI GenAI / Cohere chat path with Google's Gemini API.
 * Uses the free tier (15 RPM for gemini-2.0-flash) — zero cost.
 *
 * Unlike Cohere, Gemini doesn't have a native `documents[]` → `citations[]`
 * pipeline. Instead we:
 *   1. Inject retrieved snippets into the system prompt as numbered documents
 *   2. Instruct Gemini to cite inline using [1], [2], etc.
 *   3. Parse the response text to extract citation spans
 *
 * This is the standard RAG citation pattern used across the industry.
 */

import type { CorpusConfig } from '../config.js';
import type { CohereChatCitation, CohereChatOutcome } from './genai.js';

interface GeminiContent {
  role: string;
  parts: Array<{ text: string }>;
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

/**
 * Build the prompt that includes retrieved documents, so Gemini can cite them.
 */
function buildDocumentContext(
  documents: Array<{ id: string; title: string; snippet: string }>,
): string {
  if (documents.length === 0) return '';
  const parts = documents.map(
    (d) => `[Document ${d.id}] ${d.title}\n${d.snippet}`,
  );
  return (
    '\n\n--- Retrieved Documents ---\n' +
    parts.join('\n\n') +
    '\n--- End of Documents ---'
  );
}

/**
 * Parse inline citations like [1], [2][3], [1, 3] from the model's response text.
 * Returns CohereChatCitation-compatible spans so the existing UI rendering works
 * without modification.
 */
function parseCitationsFromText(text: string): CohereChatCitation[] {
  const citations: CohereChatCitation[] = [];
  // Match patterns like [1], [2, 3], [1][3]
  const re = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const ids = match[1]!
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => `doc_${s}_0`); // Remap to doc_N_0 format for compatibility
    if (ids.length === 0) continue;
    citations.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      documentIds: ids,
    });
  }
  return citations;
}

export interface GeminiChatOpts {
  question: string;
  preamble?: string;
  history?: Array<{ role: 'USER' | 'CHATBOT' | 'SYSTEM'; message: string }>;
  documents?: Array<{ id: string; title: string; snippet: string }>;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Assemble the model id + request body shared by the buffered and streaming
 * Gemini calls. Keeping this in one place means both code paths build an
 * identical prompt (system preamble + documents + history + question).
 */
function buildGeminiRequest(
  cfg: CorpusConfig,
  opts: GeminiChatOpts,
): { model: string; body: Record<string, unknown> } {
  const model = cfg.geminiModel ?? 'gemini-2.0-flash';

  // Build system instruction with preamble + document context
  const docContext = buildDocumentContext(opts.documents ?? []);
  const systemText =
    (opts.preamble ?? '') +
    docContext +
    '\n\nWhen citing information from the documents above, use inline references like [1], [2], etc., matching the document numbers.';

  // Convert history to Gemini format
  const contents: GeminiContent[] = [];
  for (const h of opts.history ?? []) {
    contents.push({
      role: h.role === 'CHATBOT' ? 'model' : 'user',
      parts: [{ text: h.message }],
    });
  }
  // Add the current question
  contents.push({ role: 'user', parts: [{ text: opts.question }] });

  const generationConfig: Record<string, unknown> = {
    // Generous headroom so any "thinking" the model does before answering
    // doesn't crowd out a complete response. OCR overrides this with a higher
    // cap; RAG answers comfortably fit in 4096.
    maxOutputTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.2,
  };
  // Gemini 2.5 specifically draws "thinking" tokens from maxOutputTokens, which
  // can exhaust the budget and truncate the answer mid-sentence. `thinkingBudget`
  // is a 2.5-era control, so apply it only to 2.5 models (flash/flash-lite accept
  // 0 = disabled; pro needs a small positive minimum). Other families (1.5, 3.x)
  // manage thinking differently and rely on the maxOutputTokens headroom above.
  if (/2\.5/.test(model)) {
    generationConfig['thinkingConfig'] = {
      thinkingBudget: /pro/i.test(model) ? 256 : 0,
    };
  }

  return {
    model,
    body: {
      system_instruction: { parts: [{ text: systemText }] },
      contents,
      generationConfig,
    },
  };
}

/**
 * Chat with Gemini for RAG. Drop-in replacement for `chatCohere()`.
 *
 * Accepts the same options shape and returns a CohereChatOutcome so the
 * calling code in `chat.ts` doesn't need to change its response handling.
 */
export async function chatGemini(
  cfg: CorpusConfig,
  opts: GeminiChatOpts,
): Promise<CohereChatOutcome> {
  if (!cfg.geminiApiKey) {
    throw new Error('Gemini API key not configured — set GEMINI_API_KEY in .env');
  }

  const { model, body } = buildGeminiRequest(cfg, opts);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.geminiApiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '(no body)');
    throw new Error(
      `Gemini API error ${response.status}: ${errText.slice(0, 500)}`,
    );
  }

  const json = (await response.json()) as GeminiResponse;
  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text ?? '';

  // Parse inline citations from the response text
  const citations = parseCitationsFromText(text);

  return {
    text,
    citations,
    finishReason: candidate?.finishReason,
    inputTokens: json.usageMetadata?.promptTokenCount,
    outputTokens: json.usageMetadata?.candidatesTokenCount,
  };
}

/**
 * Streaming variant of {@link chatGemini}. Uses Gemini's `streamGenerateContent`
 * SSE endpoint, invoking `onDelta` with each incremental text fragment as it
 * arrives, then returns the same buffered `CohereChatOutcome` (full text +
 * citations parsed from the assembled answer) once the stream completes.
 */
export async function chatGeminiStream(
  cfg: CorpusConfig,
  opts: GeminiChatOpts,
  onDelta: (textFragment: string) => void,
): Promise<CohereChatOutcome> {
  if (!cfg.geminiApiKey) {
    throw new Error('Gemini API key not configured — set GEMINI_API_KEY in .env');
  }

  const { model, body } = buildGeminiRequest(cfg, opts);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${cfg.geminiApiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => '(no body)');
    throw new Error(
      `Gemini API error ${response.status}: ${errText.slice(0, 500)}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let fullText = '';
  let finishReason: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  const handleChunk = (json: GeminiResponse): void => {
    const candidate = json.candidates?.[0];
    const piece = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (piece) {
      fullText += piece;
      onDelta(piece);
    }
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    // usageMetadata is cumulative; the last chunk carries the final totals.
    if (json.usageMetadata?.promptTokenCount != null)
      inputTokens = json.usageMetadata.promptTokenCount;
    if (json.usageMetadata?.candidatesTokenCount != null)
      outputTokens = json.usageMetadata.candidatesTokenCount;
  };

  // Parse SSE framing: blank-line-terminated blocks of `data:` lines.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split(/\r?\n\r?\n/);
    buf = blocks.pop() ?? '';
    for (const block of blocks) {
      const dataLines = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      const data = dataLines.join('');
      if (!data || data === '[DONE]') continue;
      try {
        handleChunk(JSON.parse(data) as GeminiResponse);
      } catch {
        /* ignore malformed keep-alive / partial frames */
      }
    }
  }

  return {
    text: fullText,
    citations: parseCitationsFromText(fullText),
    finishReason,
    inputTokens,
    outputTokens,
  };
}

/**
 * Generate embeddings using Gemini's gemini-embedding-2.
 * Returns 3072-dimensional vectors. Batch size is limited to 100 per request.
 */
export async function embedTextsGemini(
  cfg: CorpusConfig,
  texts: string[],
): Promise<number[][]> {
  if (!cfg.geminiApiKey) {
    throw new Error(
      'Gemini API key not configured — set GEMINI_API_KEY in .env',
    );
  }

  const model = cfg.geminiEmbedModel || 'gemini-embedding-2';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${cfg.geminiApiKey}`;

  const results: number[][] = [];
  const BATCH_SIZE = 100; // Gemini max is usually 100 for batchEmbedContents

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    
    // Gemini embedding requires a specific structure
    const requests = batch.map(text => ({
      model: `models/${model}`,
      content: {
        parts: [{ text }]
      }
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '(no body)');
      throw new Error(
        `Gemini Embedding API error ${response.status}: ${errText.slice(0, 500)}`,
      );
    }

    const json = await response.json() as { embeddings?: Array<{ values: number[] }> };
    if (!json.embeddings || json.embeddings.length !== batch.length) {
      throw new Error(`Gemini returned ${json.embeddings?.length ?? 0} vectors for ${batch.length} inputs`);
    }

    for (const emb of json.embeddings) {
      results.push(emb.values);
    }
  }

  return results;
}
