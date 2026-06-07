/**
 * Gemini multimodal OCR — extract text from PDFs and images that have no text
 * layer (scanned/image-only PDFs, slide exports, infographics). Used to index
 * documents the plain text extractors return empty for.
 *
 * Small files (<15 MB) are sent inline; larger files go through the Gemini
 * Files API (resumable upload → poll until ACTIVE → reference by URI), which
 * keeps the request under the ~20 MB inline limit. Audio/video are NOT handled
 * here — those need transcription.
 */
import type { CorpusConfig } from '../config.js';

const API_BASE = 'https://generativelanguage.googleapis.com';
// Keep the inline request comfortably under the ~20 MB cap after base64 (+33%).
const INLINE_MAX_BYTES = 15 * 1024 * 1024;

const OCR_PROMPT = `You are a precise document OCR and transcription engine. Extract ALL textual content from the provided document in natural reading order, as clean Markdown.
- Preserve headings, lists, and tables.
- For slides, transcribe every slide's title and bullet points in order.
- For charts, diagrams, or infographics, transcribe the title and every label, number, and data value, then add a one-line description of what the visual conveys.
- Do not summarize, skip, or add commentary. Output only the extracted content.`;

/** True for mime types Gemini OCR can read (documents + images). */
export function isOcrableMime(mime: string | undefined | null): boolean {
  const m = (mime ?? '').toLowerCase();
  return m === 'application/pdf' || m.startsWith('image/');
}

interface GenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
}

interface FilesApiResponse {
  file?: { uri?: string; name?: string; state?: string };
}

/** Upload a blob via the resumable Files API; returns the file URI once ACTIVE. */
async function uploadViaFilesApi(
  cfg: CorpusConfig,
  buffer: Buffer,
  mimeType: string,
  displayName: string,
): Promise<string> {
  const key = cfg.geminiApiKey!;

  // 1) Start a resumable upload — the response carries the upload URL.
  const start = await fetch(`${API_BASE}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buffer.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
  });
  if (!start.ok) {
    throw new Error(`Files API start ${start.status}: ${(await start.text()).slice(0, 300)}`);
  }
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Files API: no upload URL in response');

  // 2) Upload the bytes and finalize in one shot.
  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Length': String(buffer.length),
    },
    body: buffer,
  });
  if (!up.ok) {
    throw new Error(`Files API upload ${up.status}: ${(await up.text()).slice(0, 300)}`);
  }
  const file = ((await up.json()) as FilesApiResponse).file;
  if (!file?.uri || !file?.name) throw new Error('Files API: missing file uri/name');

  // 3) PDFs/large files process asynchronously — poll until ACTIVE.
  let state = file.state;
  for (let i = 0; state === 'PROCESSING' && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${API_BASE}/v1beta/${file.name}?key=${key}`);
    if (poll.ok) state = ((await poll.json()) as { state?: string }).state;
  }
  if (state && state !== 'ACTIVE') throw new Error(`Files API: file not ACTIVE (state=${state})`);
  return file.uri;
}

/**
 * OCR a document/image with Gemini and return the extracted Markdown text.
 * `mimeType` must be a real type (application/pdf or image/*), not
 * application/octet-stream — infer it from the filename before calling.
 */
export async function geminiExtractText(
  cfg: CorpusConfig,
  buffer: Buffer,
  mimeType: string,
  displayName: string,
): Promise<string> {
  if (!cfg.geminiApiKey) throw new Error('GEMINI_API_KEY not configured');
  const model = cfg.geminiModel ?? 'gemini-2.5-flash';

  const filePart =
    buffer.length <= INLINE_MAX_BYTES
      ? { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } }
      : { file_data: { mime_type: mimeType, file_uri: await uploadViaFilesApi(cfg, buffer, mimeType, displayName) } };

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: 16384,
    temperature: 0,
  };
  // Don't let 2.5 "thinking" tokens eat the output budget (see chat path).
  if (/2\.5/.test(model)) {
    generationConfig['thinkingConfig'] = { thinkingBudget: /pro/i.test(model) ? 256 : 0 };
  }

  const res = await fetch(`${API_BASE}/v1beta/models/${model}:generateContent?key=${cfg.geminiApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [filePart, { text: OCR_PROMPT }] }],
      generationConfig,
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini OCR ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const json = (await res.json()) as GenerateResponse;
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? '').join('');
}
