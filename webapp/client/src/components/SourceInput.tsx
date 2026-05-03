import type { Dispatch, SetStateAction } from 'react';

export type SourceKind = 'url' | 'text' | 'file' | 'research';

export interface SourceState {
  kind: SourceKind;
  url: string;
  text: string;
  topic: string;
  researchMode: 'fast' | 'deep';
  file: File | null;
}

export const emptySource: SourceState = {
  kind: 'url',
  url: '',
  text: '',
  topic: '',
  researchMode: 'fast',
  file: null,
};

interface Props {
  value: SourceState;
  onChange: Dispatch<SetStateAction<SourceState>>;
  disabled?: boolean;
}

const KIND_OPTIONS: { value: SourceKind; label: string; hint: string }[] = [
  { value: 'url', label: 'URL', hint: 'Public article, PDF, YouTube video, etc.' },
  { value: 'text', label: 'Text', hint: 'Paste raw text or markdown.' },
  { value: 'file', label: 'File', hint: 'Upload pdf, txt, md, docx, csv, pptx, epub, mp3, wav…' },
  { value: 'research', label: 'Research topic', hint: 'Let NotebookLM research a topic for you.' },
];

export default function SourceInput({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Source</label>
        <div className="flex flex-wrap gap-2">
          {KIND_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                value.kind === opt.value
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => onChange((v) => ({ ...v, kind: opt.value }))}
              disabled={disabled}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {KIND_OPTIONS.find((o) => o.value === value.kind)?.hint}
        </div>
      </div>

      {value.kind === 'url' && (
        <div>
          <label className="label">URL</label>
          <input
            type="url"
            className="input"
            placeholder="https://example.com/article"
            value={value.url}
            onChange={(e) => onChange((v) => ({ ...v, url: e.target.value }))}
            disabled={disabled}
            required
          />
        </div>
      )}

      {value.kind === 'text' && (
        <div>
          <label className="label">Text</label>
          <textarea
            className="input h-36"
            placeholder="Paste the text you want to summarise / turn into a podcast / analyse…"
            value={value.text}
            onChange={(e) => onChange((v) => ({ ...v, text: e.target.value }))}
            disabled={disabled}
            required
          />
        </div>
      )}

      {value.kind === 'file' && (
        <div>
          <label className="label">File</label>
          <input
            type="file"
            className="text-sm"
            onChange={(e) => onChange((v) => ({ ...v, file: e.target.files?.[0] ?? null }))}
            disabled={disabled}
            required={!value.file}
          />
          {value.file && (
            <div className="mt-1 text-xs text-slate-500">
              {value.file.name} — {(value.file.size / 1024).toFixed(1)} KB
            </div>
          )}
        </div>
      )}

      {value.kind === 'research' && (
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div>
            <label className="label">Research topic</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. quantum computing fundamentals"
              value={value.topic}
              onChange={(e) => onChange((v) => ({ ...v, topic: e.target.value }))}
              disabled={disabled}
              required
            />
          </div>
          <div>
            <label className="label">Mode</label>
            <select
              className="input"
              value={value.researchMode}
              onChange={(e) =>
                onChange((v) => ({ ...v, researchMode: e.target.value as 'fast' | 'deep' }))
              }
              disabled={disabled}
            >
              <option value="fast">Fast</option>
              <option value="deep">Deep</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

export function buildSourcePayload(s: SourceState): { payload: Record<string, unknown>; file: File | null } {
  const base: Record<string, unknown> = { type: s.kind };
  if (s.kind === 'url') base.url = s.url;
  else if (s.kind === 'text') base.text = s.text;
  else if (s.kind === 'research') {
    base.topic = s.topic;
    base.researchMode = s.researchMode;
  }
  return { payload: base, file: s.kind === 'file' ? s.file : null };
}
