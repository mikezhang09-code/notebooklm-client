import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiGet, apiJson } from '../lib/api';

interface NotebookInfo {
  id: string;
  title: string;
  sourceCount?: number;
}
interface SourceInfo {
  id: string;
  title: string;
}
interface DetailResponse {
  title: string;
  sources: SourceInfo[];
}
interface ChatResponse {
  text: string;
  threadId?: string;
}
interface ChatWithCitationsResponse extends ChatResponse {
  citations: { index: number; excerpt: string; sourceId: string | null }[];
}

export default function ChatPage() {
  const params = useParams<{ id?: string }>();
  const [notebooks, setNotebooks] = useState<NotebookInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>(params.id ?? '');
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [question, setQuestion] = useState('');
  const [withCitations, setWithCitations] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<
    { role: 'user' | 'assistant'; text: string; citations?: ChatWithCitationsResponse['citations'] }[]
  >([]);

  useEffect(() => {
    void (async () => {
      try {
        const { notebooks } = await apiGet<{ notebooks: NotebookInfo[] }>('/api/notebooks');
        setNotebooks(notebooks);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setSourceIds([]);
      return;
    }
    void (async () => {
      try {
        const data = await apiGet<DetailResponse>(`/api/notebooks/${selectedId}`);
        setDetail(data);
        setSourceIds(data.sources.map((s) => s.id));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [selectedId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !question.trim()) return;
    setBusy(true);
    setErr(null);
    const userMsg = question;
    setHistory((h) => [...h, { role: 'user', text: userMsg }]);
    setQuestion('');
    try {
      const result = await apiJson<ChatResponse | ChatWithCitationsResponse>('/api/chat', {
        notebookId: selectedId,
        question: userMsg,
        sourceIds,
        withCitations,
      });
      const citations = 'citations' in result ? result.citations : undefined;
      setHistory((h) => [...h, { role: 'assistant', text: result.text, citations }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleSource(id: string) {
    setSourceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Chat</h1>
        <p className="text-sm text-slate-600">Ask questions of an existing notebook.</p>
      </div>

      {err && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {err}
        </div>
      )}

      <div className="card space-y-3">
        <div>
          <label className="label">Notebook</label>
          <select
            className="input"
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setHistory([]);
            }}
          >
            <option value="">— select —</option>
            {notebooks.map((nb) => (
              <option key={nb.id} value={nb.id}>
                {nb.title || '(untitled)'} {nb.sourceCount !== undefined ? `(${nb.sourceCount})` : ''}
              </option>
            ))}
          </select>
        </div>

        {detail && (
          <div>
            <label className="label">Sources ({sourceIds.length}/{detail.sources.length})</label>
            <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {detail.sources.map((s) => (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                    sourceIds.includes(s.id)
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-slate-300 bg-white text-slate-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-3 w-3"
                    checked={sourceIds.includes(s.id)}
                    onChange={() => toggleSource(s.id)}
                  />
                  <span className="max-w-[200px] truncate">{s.title}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={withCitations}
            onChange={(e) => setWithCitations(e.target.checked)}
          />
          Include per-citation metadata
        </label>
      </div>

      {history.length > 0 && (
        <div className="card space-y-3">
          {history.map((msg, i) => (
            <div key={i}>
              <div className="text-xs font-semibold uppercase text-slate-400">
                {msg.role === 'user' ? 'You' : 'NotebookLM'}
              </div>
              <div className="whitespace-pre-wrap text-sm text-slate-800">{msg.text}</div>
              {msg.citations && msg.citations.length > 0 && (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-slate-500">
                    {msg.citations.length} citation{msg.citations.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-1 space-y-1 pl-3">
                    {msg.citations.map((c) => (
                      <li key={c.index}>
                        <span className="text-slate-400">[{c.index}]</span> {c.excerpt}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSend} className="card flex items-end gap-2">
        <textarea
          className="input h-20 flex-1"
          placeholder="Type a question…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy || !selectedId}
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={busy || !selectedId || !question.trim()}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
