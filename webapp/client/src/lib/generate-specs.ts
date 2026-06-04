/**
 * Shared artifact-generation form specs — used by both the full Generate page
 * (fresh notebook from a source) and the "generate from existing sources"
 * panel on the notebook detail page. Single source of truth for the per-kind
 * option fields so the two surfaces never drift.
 */

export type Kind =
  | 'audio'
  | 'report'
  | 'video'
  | 'quiz'
  | 'flashcards'
  | 'infographic'
  | 'slides'
  | 'data-table';

export type FieldSpec =
  | { kind: 'select'; name: string; label: string; options: { value: string; label: string }[]; defaultValue?: string }
  | { kind: 'text'; name: string; label: string; placeholder?: string; defaultValue?: string }
  | { kind: 'textarea'; name: string; label: string; placeholder?: string; defaultValue?: string };

export interface KindSpec {
  title: string;
  description: string;
  fields: FieldSpec[];
}

export const LANG_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'hi', label: 'Hindi' },
];

export const SPECS: Record<Kind, KindSpec> = {
  audio: {
    title: 'Audio podcast',
    description: 'Generate an audio overview from the source material.',
    fields: [
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      {
        kind: 'select',
        name: 'format',
        label: 'Format',
        options: [
          { value: '', label: '(default)' },
          { value: 'deep_dive', label: 'Deep dive' },
          { value: 'brief', label: 'Brief' },
          { value: 'critique', label: 'Critique' },
          { value: 'debate', label: 'Debate' },
        ],
      },
      {
        kind: 'select',
        name: 'length',
        label: 'Length',
        options: [
          { value: '', label: '(default)' },
          { value: 'short', label: 'Short' },
          { value: 'default', label: 'Default' },
          { value: 'long', label: 'Long' },
        ],
      },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  report: {
    title: 'Report',
    description: 'Generate a briefing doc, study guide, blog post, or custom report.',
    fields: [
      {
        kind: 'select',
        name: 'template',
        label: 'Template',
        options: [
          { value: 'briefing_doc', label: 'Briefing doc' },
          { value: 'study_guide', label: 'Study guide' },
          { value: 'blog_post', label: 'Blog post' },
          { value: 'custom', label: 'Custom' },
        ],
        defaultValue: 'briefing_doc',
      },
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  video: {
    title: 'Video overview',
    description: 'Generate a video overview with a chosen style.',
    fields: [
      {
        kind: 'select',
        name: 'format',
        label: 'Format',
        options: [
          { value: '', label: '(default)' },
          { value: 'explainer', label: 'Explainer' },
          { value: 'brief', label: 'Brief' },
          { value: 'cinematic', label: 'Cinematic' },
        ],
      },
      {
        kind: 'select',
        name: 'style',
        label: 'Style',
        options: [
          { value: '', label: '(auto)' },
          { value: 'auto', label: 'Auto' },
          { value: 'classic', label: 'Classic' },
          { value: 'whiteboard', label: 'Whiteboard' },
          { value: 'kawaii', label: 'Kawaii' },
          { value: 'anime', label: 'Anime' },
          { value: 'watercolor', label: 'Watercolor' },
          { value: 'retro_print', label: 'Retro print' },
        ],
      },
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  quiz: {
    title: 'Quiz',
    description: 'Generate an interactive HTML quiz.',
    fields: [
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      {
        kind: 'select',
        name: 'quantity',
        label: 'Quantity',
        options: [
          { value: '', label: '(default)' },
          { value: 'fewer', label: 'Fewer' },
          { value: 'standard', label: 'Standard' },
        ],
      },
      {
        kind: 'select',
        name: 'difficulty',
        label: 'Difficulty',
        options: [
          { value: '', label: '(default)' },
          { value: 'easy', label: 'Easy' },
          { value: 'medium', label: 'Medium' },
          { value: 'hard', label: 'Hard' },
        ],
      },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  flashcards: {
    title: 'Flashcards',
    description: 'Generate interactive flashcards.',
    fields: [
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      {
        kind: 'select',
        name: 'quantity',
        label: 'Quantity',
        options: [
          { value: '', label: '(default)' },
          { value: 'fewer', label: 'Fewer' },
          { value: 'standard', label: 'Standard' },
        ],
      },
      {
        kind: 'select',
        name: 'difficulty',
        label: 'Difficulty',
        options: [
          { value: '', label: '(default)' },
          { value: 'easy', label: 'Easy' },
          { value: 'medium', label: 'Medium' },
          { value: 'hard', label: 'Hard' },
        ],
      },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  infographic: {
    title: 'Infographic',
    description: 'Generate a single-image infographic.',
    fields: [
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      {
        kind: 'select',
        name: 'orientation',
        label: 'Orientation',
        options: [
          { value: '', label: '(default)' },
          { value: 'landscape', label: 'Landscape' },
          { value: 'portrait', label: 'Portrait' },
          { value: 'square', label: 'Square' },
        ],
      },
      {
        kind: 'select',
        name: 'detail',
        label: 'Detail',
        options: [
          { value: '', label: '(default)' },
          { value: 'concise', label: 'Concise' },
          { value: 'standard', label: 'Standard' },
          { value: 'detailed', label: 'Detailed' },
        ],
      },
      {
        kind: 'select',
        name: 'style',
        label: 'Style',
        options: [
          { value: '', label: '(default)' },
          { value: 'sketch_note', label: 'Sketch note' },
          { value: 'professional', label: 'Professional' },
          { value: 'bento_grid', label: 'Bento grid' },
        ],
      },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  slides: {
    title: 'Slide deck',
    description: 'Generate a slide deck (PPTX, with optional PDF).',
    fields: [
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      {
        kind: 'select',
        name: 'format',
        label: 'Format',
        options: [
          { value: '', label: '(default)' },
          { value: 'detailed', label: 'Detailed' },
          { value: 'presenter', label: 'Presenter' },
        ],
      },
      {
        kind: 'select',
        name: 'length',
        label: 'Length',
        options: [
          { value: '', label: '(default)' },
          { value: 'default', label: 'Default' },
          { value: 'short', label: 'Short' },
        ],
      },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  'data-table': {
    title: 'Data table',
    description: 'Extract a structured data table (CSV).',
    fields: [
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      {
        kind: 'textarea',
        name: 'instructions',
        label: 'Instructions',
        placeholder: 'Describe the table structure you want…',
      },
    ],
  },
};
