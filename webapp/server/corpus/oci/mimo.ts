/**
 * Xiaomi Mimo / OpenAI compatible chat provider for corpus RAG.
 */

import type { CorpusConfig } from '../config.js';
import type { CohereChatCitation, CohereChatOutcome } from './genai.js';

/**
 * Build the prompt that includes retrieved documents, so the model can cite them.
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
 */
function parseCitationsFromText(text: string): CohereChatCitation[] {
  const citations: CohereChatCitation[] = [];
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

/**
 * Chat with Mimo (or any OpenAI-compatible API) for RAG.
 */
export async function chatMimo(
  cfg: CorpusConfig,
  opts: {
    question: string;
    preamble?: string;
    history?: Array<{ role: 'USER' | 'CHATBOT' | 'SYSTEM'; message: string }>;
    documents?: Array<{ id: string; title: string; snippet: string }>;
    maxTokens?: number;
    temperature?: number;
  },
): Promise<CohereChatOutcome> {
  if (!cfg.mimoApiKey) {
    throw new Error(
      'Mimo API key not configured — set MIMO_API_KEY in .env',
    );
  }

  const model = cfg.mimoModel ?? 'gpt-4o';
  // Strip trailing slash if present, then append /chat/completions
  const baseUrl = cfg.mimoBaseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;

  // Build system instruction with preamble + document context
  const docContext = buildDocumentContext(opts.documents ?? []);
  const systemText =
    (opts.preamble ?? '') +
    docContext +
    '\n\nWhen citing information from the documents above, use inline references like [1], [2], etc., matching the document numbers. Always cite your sources when applicable.';

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemText },
  ];

  // Convert history to OpenAI format
  for (const h of opts.history ?? []) {
    messages.push({
      role: h.role === 'CHATBOT' ? 'assistant' : h.role === 'SYSTEM' ? 'system' : 'user',
      content: h.message,
    });
  }
  // Add the current question
  messages.push({
    role: 'user',
    content: opts.question,
  });

  const body = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.2,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': cfg.mimoApiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '(no body)');
    throw new Error(
      `Mimo API error ${response.status}: ${errText.slice(0, 500)}`,
    );
  }

  const json = (await response.json()) as any;
  const text = json.choices?.[0]?.message?.content ?? '';

  // Parse inline citations from the response text
  const citations = parseCitationsFromText(text);

  return {
    text,
    citations,
    finishReason: json.choices?.[0]?.finish_reason,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
  };
}
