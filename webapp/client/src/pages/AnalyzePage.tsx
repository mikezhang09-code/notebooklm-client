import { useRef, useState } from 'react';
import SourceInput, { buildSourcePayload, emptySource, type SourceState } from '../components/SourceInput';
import ProgressLog, { type ProgressEntry } from '../components/ProgressLog';
import { streamSse } from '../lib/api';

interface ResultData {
  meta?: {
    answer?: string;
    notebookUrl?: string;
  };
}

export default function AnalyzePage() {
  const [source, setSource] = useState<SourceState>(emptySource);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [result, setResult] = useState<ResultData | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function addEntry(k: ProgressEntry['kind'], text: string) {
    setEntries((list) => [...list, { kind: k, text, ts: Date.now() }]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setEntries([]);
    setResult(null);
    try {
      const { payload, file } = buildSourcePayload(source);
      const form = new FormData();
      form.append('payload', JSON.stringify({ source: payload, question }));
      if (file) form.append('file', file);

      const controller = new AbortController();
      abortRef.current = controller;
      addEntry('info', 'Sent; streaming progress…');
      await streamSse('/api/analyze', form, {
        onProgress: (p) => addEntry('progress', `[${p.status}] ${p.message}`),
        onResult: (data) => {
          setResult(data as ResultData);
          addEntry('result', 'Completed.');
        },
        onError: (msg) => addEntry('error', msg),
      }, controller.signal);
    } catch (err) {
      addEntry('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Analyze</h1>
        <p className="text-sm text-slate-600">
          Ask a question about a source without keeping a notebook afterward.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <SourceInput value={source} onChange={setSource} disabled={busy} />
        <div>
          <label className="label">Question</label>
          <textarea
            className="input h-24"
            placeholder="e.g. What are the key findings? Who is the audience?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        <div className="border-t border-slate-200 pt-3">
          <button type="submit" className="btn-primary" disabled={busy || !question.trim()}>
            {busy ? 'Analyzing…' : 'Ask'}
          </button>
        </div>
      </form>

      <ProgressLog entries={entries} />

      {result?.meta?.answer && (
        <div className="card space-y-3">
          <h2 className="text-lg font-semibold">Answer</h2>
          <div className="whitespace-pre-wrap text-sm text-slate-800">{result.meta.answer}</div>
          {result.meta.notebookUrl && (
            <a
              href={result.meta.notebookUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
            >
              Open notebook ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
