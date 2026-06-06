/**
 * Artifact-type registry + generate-option spec — the TS source of truth for
 * the redesigned UI. Ported from the design handoff's `data.js` (TYPES / SOURCES
 * / LANGS / OPTS / GEN_SPEC), with an added mapping from each UI type key to the
 * backend's generate `kind` (used by POST /api/generate/:kind).
 */

export type TypeKey =
  | 'audio'
  | 'report'
  | 'video'
  | 'quiz'
  | 'flash'
  | 'info'
  | 'slides'
  | 'table'
  | 'mind'
  | 'note';

export interface ArtifactType {
  key: TypeKey;
  label: string;
  plural: string;
  icon: string;
  color: string;
  /** Whether the type can be AI-generated (all currently can). */
  generate: boolean;
  /** The `kind` segment the backend's generate route expects. null = not wired. */
  backendKind: string | null;
  /** The `kind` value used when uploading a file of this type to the corpus. */
  ingestKind: string;
  isNew?: boolean;
}

export const TYPES: ArtifactType[] = [
  { key: 'audio', label: 'Audio', plural: 'Audio', icon: 'i-audio', color: '#c15a37', generate: true, backendKind: 'audio', ingestKind: 'audio' },
  { key: 'report', label: 'Report', plural: 'Reports', icon: 'i-report', color: '#4a76a8', generate: true, backendKind: 'report', ingestKind: 'report' },
  { key: 'video', label: 'Video', plural: 'Videos', icon: 'i-video', color: '#8a6aa8', generate: true, backendKind: 'video', ingestKind: 'video' },
  { key: 'quiz', label: 'Quiz', plural: 'Quizzes', icon: 'i-quiz', color: '#b9892a', generate: true, backendKind: 'quiz', ingestKind: 'quiz' },
  { key: 'flash', label: 'Flashcards', plural: 'Flashcards', icon: 'i-flash', color: '#5f8a5a', generate: true, backendKind: 'flashcards', ingestKind: 'flashcards' },
  { key: 'info', label: 'Infographic', plural: 'Infographics', icon: 'i-info', color: '#c1503f', generate: true, backendKind: 'infographic', ingestKind: 'infographic' },
  { key: 'slides', label: 'Slides', plural: 'Slides', icon: 'i-slides', color: '#467b86', generate: true, backendKind: 'slides', ingestKind: 'slides' },
  { key: 'table', label: 'Data table', plural: 'Data tables', icon: 'i-table', color: '#8a7c4a', generate: true, backendKind: 'data-table', ingestKind: 'data_table' },
  // Mindmap can't be generated headlessly (needs a real browser); no backend kind.
  { key: 'mind', label: 'Mindmap', plural: 'Mindmaps', icon: 'i-mind', color: '#5b6bbf', generate: false, backendKind: null, ingestKind: 'upload', isNew: true },
  // Note: hand-written markdown — created via the editor, not generated/uploaded.
  { key: 'note', label: 'Note', plural: 'Notes', icon: 'i-doc', color: '#6d8a96', generate: false, backendKind: null, ingestKind: 'note' },
];

export const TYPE: Record<TypeKey, ArtifactType> = Object.fromEntries(
  TYPES.map((t) => [t.key, t]),
) as Record<TypeKey, ArtifactType>;

/** Provenance / source-of-origin metadata. */
export type SourceKey = 'notebooklm' | 'personal' | 'standalone';
export const SOURCES: Record<SourceKey, { label: string; icon: string; color: string }> = {
  notebooklm: { label: 'NotebookLM', icon: 'i-nlm', color: '#4a76a8' },
  personal: { label: 'Collections', icon: 'i-folder', color: '#c15a37' },
  standalone: { label: 'Free form', icon: 'i-spark', color: '#8a7c4a' },
};

export const LANGS = [
  'English',
  'Chinese',
  'Japanese',
  'Korean',
  'Spanish',
  'French',
  'German',
  'Portuguese',
];

/** Map a UI language label to the backend's 2-letter code. */
export const LANG_CODE: Record<string, string> = {
  English: 'en',
  Chinese: 'zh',
  Japanese: 'ja',
  Korean: 'ko',
  Spanish: 'es',
  French: 'fr',
  German: 'de',
  Portuguese: 'pt',
};

/** Per-type option value sets, in display order. */
export const OPTS = {
  audioFormat: ['Deep dive', 'Brief', 'Critique', 'Debate'],
  videoFormat: ['Explainer', 'Brief', 'Cinematic'],
  slidesFormat: ['Detailed', 'Presenter'],
  length: ['Short', 'Default', 'Long'],
  template: ['Briefing doc', 'Study guide', 'Blog post', 'Custom'],
  videoStyle: ['Auto', 'Classic', 'Whiteboard', 'Anime', 'Watercolor'],
  infoStyle: ['Sketch note', 'Professional', 'Bento grid'],
  orientation: ['Landscape', 'Portrait', 'Square'],
  detail: ['Concise', 'Standard', 'Detailed'],
  quantity: ['Fewer', 'Standard'],
  difficulty: ['Easy', 'Medium', 'Hard'],
  mindDepth: ['Overview', 'Standard', 'Exhaustive'],
  mindLayout: ['Radial', 'Tree', 'Org'],
} as const;

export interface GenField {
  key: string;
  label: string;
  opts: readonly string[];
}
export interface GenSpec {
  fields: GenField[];
  instructions: boolean;
  language: boolean;
}

export const GEN_SPEC: Record<TypeKey, GenSpec> = {
  audio: {
    fields: [
      { key: 'format', label: 'Format', opts: OPTS.audioFormat },
      { key: 'length', label: 'Length', opts: OPTS.length },
    ],
    instructions: true,
    language: true,
  },
  report: {
    fields: [{ key: 'template', label: 'Template', opts: OPTS.template }],
    instructions: true,
    language: true,
  },
  video: {
    fields: [
      { key: 'format', label: 'Format', opts: OPTS.videoFormat },
      { key: 'style', label: 'Style', opts: OPTS.videoStyle },
    ],
    instructions: true,
    language: true,
  },
  quiz: {
    fields: [
      { key: 'quantity', label: 'Quantity', opts: OPTS.quantity },
      { key: 'difficulty', label: 'Difficulty', opts: OPTS.difficulty },
    ],
    instructions: true,
    language: false,
  },
  flash: {
    fields: [
      { key: 'quantity', label: 'Quantity', opts: OPTS.quantity },
      { key: 'difficulty', label: 'Difficulty', opts: OPTS.difficulty },
    ],
    instructions: true,
    language: false,
  },
  info: {
    fields: [
      { key: 'orientation', label: 'Orientation', opts: OPTS.orientation },
      { key: 'detail', label: 'Detail', opts: OPTS.detail },
      { key: 'style', label: 'Style', opts: OPTS.infoStyle },
    ],
    instructions: true,
    language: true,
  },
  slides: {
    fields: [
      { key: 'format', label: 'Format', opts: OPTS.slidesFormat },
      { key: 'length', label: 'Length', opts: OPTS.length },
    ],
    instructions: true,
    language: true,
  },
  table: { fields: [], instructions: true, language: true },
  mind: {
    fields: [
      { key: 'depth', label: 'Depth', opts: OPTS.mindDepth },
      { key: 'layout', label: 'Layout', opts: OPTS.mindLayout },
    ],
    instructions: true,
    language: true,
  },
  // Notes are hand-written, not generated — no generate spec.
  note: { fields: [], instructions: false, language: false },
};

/** Lower-case option value → backend enum (e.g. "Deep dive" → "deep_dive"). */
export function toBackendValue(v: string): string {
  return v.toLowerCase().replace(/\s+/g, '_');
}

// ── File-type classification (for uploads, which all share kind='upload') ──

export interface Face {
  label: string;
  icon: string;
  color: string;
}

const KIND_TO_KEY: Record<string, TypeKey> = {
  audio: 'audio',
  report: 'report',
  video: 'video',
  quiz: 'quiz',
  flashcards: 'flash',
  infographic: 'info',
  slides: 'slides',
  data_table: 'table',
  mind: 'mind',
  note: 'note',
};

/**
 * Classify an uploaded file into a display face (label/icon/color) from its
 * MIME type, falling back to the filename extension. Uploads otherwise all
 * carry kind='upload' and would be indistinguishable.
 */
export function fileFace(mimeType?: string | null, title?: string): Face {
  const m = (mimeType ?? '').split(';')[0]!.trim().toLowerCase();
  const ext = (title?.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  const has = (...e: string[]) => e.includes(ext);

  if (m === 'text/html' || has('html', 'htm')) return { label: 'Web page', icon: 'i-link', color: '#4a76a8' };
  if (m === 'text/markdown' || m === 'text/x-markdown' || has('md', 'markdown'))
    return { label: 'Markdown', icon: 'i-doc', color: '#8a7c4a' };
  if (m === 'application/pdf' || has('pdf')) return { label: 'PDF', icon: 'i-report', color: '#c1503f' };
  if (m.includes('wordprocessingml') || m === 'application/msword' || has('doc', 'docx'))
    return { label: 'Document', icon: 'i-doc', color: '#4a76a8' };
  if (m.includes('presentationml') || m === 'application/vnd.ms-powerpoint' || has('ppt', 'pptx'))
    return { label: 'Slides', icon: 'i-slides', color: '#467b86' };
  if (m.includes('spreadsheetml') || m === 'application/vnd.ms-excel' || m === 'text/csv' || has('csv', 'xls', 'xlsx'))
    return { label: 'Spreadsheet', icon: 'i-table', color: '#8a7c4a' };
  if (m === 'application/json' || has('json')) return { label: 'JSON', icon: 'i-table', color: '#8a7c4a' };
  if (m.startsWith('image/') || has('png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'))
    return { label: 'Image', icon: 'i-info', color: '#8a6aa8' };
  if (m.startsWith('audio/') || has('mp3', 'wav', 'm4a')) return { label: 'Audio', icon: 'i-audio', color: '#c15a37' };
  if (m.startsWith('video/') || has('mp4', 'mov', 'webm')) return { label: 'Video', icon: 'i-video', color: '#8a6aa8' };
  if (m === 'text/plain' || has('txt')) return { label: 'Text', icon: 'i-doc', color: '#8a7c4a' };
  return { label: 'File', icon: 'i-doc', color: '#8c8173' };
}

/**
 * Resolve the display face for any artifact: real artifact kinds use the type
 * registry; uploads are classified by file type (so HTML ≠ Markdown ≠ PDF …).
 */
export function describe(kind: string, mimeType?: string | null, title?: string): Face {
  if (kind === 'upload') return fileFace(mimeType, title);
  const t = TYPE[KIND_TO_KEY[kind] ?? 'report'];
  return { label: t.label, icon: t.icon, color: t.color };
}

/**
 * Bucket any artifact into one of the 9 output-type keys for Free Forms
 * grouping. Real kinds map directly; uploads map to the nearest output type by
 * file type (e.g. a CSV upload → data table, an mp3 upload → audio, documents
 * → report). Keeps uploaded + generated artifacts in the same type sections.
 */
export function typeKeyFor(kind: string, mimeType?: string | null, title?: string): TypeKey {
  if (kind !== 'upload') return KIND_TO_KEY[kind] ?? 'report';
  switch (fileFace(mimeType, title).label) {
    case 'Spreadsheet':
      return 'table';
    case 'Slides':
      return 'slides';
    case 'Audio':
      return 'audio';
    case 'Video':
      return 'video';
    case 'Image':
      return 'info';
    default:
      return 'report'; // Web page, Markdown, PDF, Document, Text, JSON, File
  }
}
