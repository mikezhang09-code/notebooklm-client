/**
 * Voyage AI embeddings provider.
 *
 * Voyage offers a far more generous free tier than Gemini. The voyage-4 family
 * (voyage-4 / voyage-4-large / voyage-4-lite) currently carries the 200M-token
 * free quota; the older voyage-3.x models have 0 free quota. Default voyage-4
 * returns 1024-dim vectors (configurable via VOYAGE_EMBED_DIM). Endpoint:
 *   POST https://api.voyageai.com/v1/embeddings
 */

import type { CorpusConfig } from '../config.js';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
// Conservative batch size — Voyage allows up to 1000 inputs but caps tokens
// per request; 96 keeps us comfortably under the limit for chunky documents.
const BATCH_SIZE = 96;

interface VoyageResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  usage?: { total_tokens: number };
  detail?: string;
}

/**
 * Embed texts via Voyage. `inputType` maps to Voyage's `input_type`
 * ('document' for indexing, 'query' for search) which improves retrieval.
 */
export async function embedTextsVoyage(
  cfg: CorpusConfig,
  texts: string[],
  inputType: string = 'SEARCH_DOCUMENT',
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!cfg.voyageApiKey) {
    throw new Error('Voyage API key not configured — set VOYAGE_API_KEY in .env');
  }

  const input_type = inputType === 'SEARCH_QUERY' ? 'query' : 'document';
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.voyageApiKey}`,
      },
      body: JSON.stringify({
        input: batch,
        model: cfg.voyageModel,
        input_type,
        output_dimension: cfg.voyageEmbedDim,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '(no body)');
      throw new Error(`Voyage Embedding API error ${response.status}: ${errText.slice(0, 500)}`);
    }

    const json = (await response.json()) as VoyageResponse;
    const data = json.data;
    if (!data || data.length !== batch.length) {
      throw new Error(`Voyage returned ${data?.length ?? 0} vectors for ${batch.length} inputs`);
    }
    // Voyage returns items with an `index`; sort to preserve input order.
    data.sort((a, b) => a.index - b.index);
    for (const d of data) results.push(d.embedding);
  }

  return results;
}
