import { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SourceInput, { buildSourcePayload, emptySource, type SourceState } from '../components/SourceInput';
import ProgressLog, { type ProgressEntry } from '../components/ProgressLog';
import { streamSse } from '../lib/api';
import { saveChatToCorpus, type SaveChatResult } from '../lib/corpus';

interface ResultData {
  meta?: {
    answer?: string;
    notebookUrl?: string;
  };
}

function notebookIdFromUrl(url: string | undefined): string {
  if (!url) return '';
  const m = url.match(/\/notebook\/([^/?#]+)/);
  return m ? m[1] : '';
}

export default function AnalyzePage() {
  const [source, setSource] = useState<SourceState>(emptySource);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [result, setResult] = useState<ResultData | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Track the submitted question separately so we have it when building the save payload.
  const [submittedQuestion, setSubmittedQuestion] = useState('');

  // ── Save-to-corpus state ────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [saveTitle, setSaveTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [savingQA, setSavingQA] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<SaveChatResult | null>(null);

  // Auto-suggest title from the question when a result arrives.
  useEffect(() => {
    if (!result?.meta?.answer || titleEdited) return;
    const q = submittedQuestion.trim();
    const suggested = q.length > 80 ? q.slice(0, 77) + '…' : q;
    setSaveTitle(suggested || 'Q&A');
  }, [result, submittedQuestion, titleEdited]);

  function addEntry(k: ProgressEntry['kind'], text: string) {
    setEntries((list) => [...list, { kind: k, text, ts: Date.now() }]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setEntries([]);
    setResult(null);
    setSessionId(null);
    setSaveResult(null);
    setSaveErr(null);
    setTitleEdited(false);
    const q = question;
    setSubmittedQuestion(q);
    try {
      const { payload, file } = buildSourcePayload(source);
      const form = new FormData();
      form.append('payload', JSON.stringify({ source: payload, question: q }));
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

  async function handleSaveQA() {
    const answer = result?.meta?.answer;
    if (!answer || !submittedQuestion) return;
    const title = saveTitle.trim();
    if (!title) {
      setSaveErr('Title is required');
      return;
    }

    setSavingQA(true);
    setSaveErr(null);
    try {
      let sid = sessionId;
      if (!sid) {
        sid =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        setSessionId(sid);
      }
      const notebookId = notebookIdFromUrl(result?.meta?.notebookUrl);
      const res = await saveChatToCorpus({
        notebookId,
        notebookTitle: '',
        sessionId: sid,
        title,
        turns: [
          { role: 'user', content: submittedQuestion },
          { role: 'assistant', content: answer },
        ],
      });
      setSaveResult(res);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingQA(false);
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

          {/* ── Save to corpus ── */}
          <div className="space-y-2 border-t border-slate-200 pt-3">
            <div className="flex items-center gap-2">
              <input
                className="input flex-1 text-sm"
                placeholder="Title for saved Q&A"
                value={saveTitle}
                onChange={(e) => {
                  setSaveTitle(e.target.value);
                  setTitleEdited(true);
                }}
                disabled={savingQA}
              />
              <button
                type="button"
                className="btn-primary whitespace-nowrap"
                onClick={() => void handleSaveQA()}
                disabled={savingQA || !saveTitle.trim()}
                title={sessionId ? 'Update the saved Q&A in your corpus' : 'Save this Q&A to your corpus'}
              >
                {savingQA ? 'Saving…' : sessionId ? 'Update saved' : 'Save to corpus'}
              </button>
            </div>
            {saveErr && (
              <div className="text-xs text-rose-700">Save failed: {saveErr}</div>
            )}
            {saveResult && !saveErr && (
              <div className="text-xs text-emerald-700">
                {saveResult.created ? 'Saved' : 'Updated'} ·{' '}
                {saveResult.chunkCount} chunk{saveResult.chunkCount === 1 ? '' : 's'} ·{' '}
                <Link to="/corpus/library" className="underline hover:text-emerald-800">
                  View in Library
                </Link>
              </div>
            )}
          </div>

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
