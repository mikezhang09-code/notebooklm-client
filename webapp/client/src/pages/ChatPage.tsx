import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet, apiJson } from '../lib/api';
import { saveChatToCorpus, type SaveChatResult } from '../lib/corpus';

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

  // ── Save-to-corpus state ────────────────────────────────────────────
  // sessionId is minted lazily on first save and reused for subsequent
  // saves of the same thread, so re-saves UPDATE the existing artifact
  // instead of creating duplicates. It is reset whenever the notebook
  // changes (i.e. the user starts a fresh conversation).
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [saveTitle, setSaveTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [savingChat, setSavingChat] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<SaveChatResult | null>(null);

  // Suggest a default title from notebook title + first user question.
  // Recomputes as the conversation grows, but only "wins" while the user
  // hasn't manually edited the title input — preserves user intent across
  // turn additions.
  const suggestedTitle = useMemo(() => {
    const nbTitle = detail?.title?.trim() || 'Chat';
    const firstQ = history.find((h) => h.role === 'user')?.text?.trim() ?? '';
    if (!firstQ) return nbTitle;
    const trimmed = firstQ.length > 80 ? firstQ.slice(0, 77) + '…' : firstQ;
    return `${nbTitle} — ${trimmed}`;
  }, [detail?.title, history]);

  useEffect(() => {
    if (!titleEdited) setSaveTitle(suggestedTitle);
  }, [suggestedTitle, titleEdited]);

  // Once the conversation grows past a previous save, the "Saved · N
  // chunks" banner refers to a stale snapshot. Clear it so the user
  // isn't misled — the sessionId is preserved so the next click still
  // does an UPDATE.
  useEffect(() => {
    setSaveResult(null);
  }, [history.length]);

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

  /**
   * Persist the current conversation as a `kind='qa'` corpus artifact.
   * On first call we mint a sessionId; subsequent calls reuse it so the
   * server can update-in-place rather than create duplicates.
   */
  async function handleSaveChat() {
    if (!selectedId || history.length === 0) return;
    const title = saveTitle.trim();
    if (!title) {
      setSaveErr('Title is required');
      return;
    }
    // Need at least one assistant turn — otherwise we'd be saving a
    // question with no answer, which isn't useful for retrieval.
    if (!history.some((h) => h.role === 'assistant')) {
      setSaveErr('Send at least one question and wait for the answer first');
      return;
    }

    setSavingChat(true);
    setSaveErr(null);
    try {
      // Lazy mint — keeps state clean until the user actually saves.
      let sid = sessionId;
      if (!sid) {
        sid =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        setSessionId(sid);
      }
      const result = await saveChatToCorpus({
        notebookId: selectedId,
        notebookTitle: detail?.title ?? '',
        sessionId: sid,
        title,
        turns: history.map((h) => ({
          role: h.role,
          content: h.text,
          citations: h.citations,
        })),
      });
      setSaveResult(result);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingChat(false);
    }
  }

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
              // New notebook → new conversation. Drop the prior session
              // identity so the next save creates a fresh artifact rather
              // than overwriting the previous one.
              setSessionId(null);
              setSaveResult(null);
              setSaveErr(null);
              setTitleEdited(false);
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
          {/*
            Save-conversation toolbar. Idempotent on sessionId — clicking
            Save a second time updates the existing artifact instead of
            creating a duplicate, so the user can save mid-conversation
            and again at the end without ending up with two rows.
          */}
          <div className="space-y-2 border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <input
                className="input flex-1 text-sm"
                placeholder="Title for saved conversation"
                value={saveTitle}
                onChange={(e) => {
                  setSaveTitle(e.target.value);
                  setTitleEdited(true);
                }}
                disabled={savingChat}
              />
              <button
                type="button"
                className="btn-primary whitespace-nowrap"
                onClick={() => void handleSaveChat()}
                disabled={
                  savingChat ||
                  !saveTitle.trim() ||
                  !history.some((h) => h.role === 'assistant')
                }
                title={
                  sessionId
                    ? 'Update the saved conversation in your corpus'
                    : 'Save this conversation to your corpus'
                }
              >
                {savingChat
                  ? 'Saving…'
                  : sessionId
                  ? 'Update saved'
                  : 'Save to corpus'}
              </button>
            </div>
            {saveErr && (
              <div className="text-xs text-rose-700">Save failed: {saveErr}</div>
            )}
            {saveResult && !saveErr && (
              <div className="text-xs text-emerald-700">
                {saveResult.created ? 'Saved' : 'Updated'} ·{' '}
                {saveResult.chunkCount} chunk
                {saveResult.chunkCount === 1 ? '' : 's'} ·{' '}
                <Link
                  to="/corpus/library"
                  className="underline hover:text-emerald-800"
                >
                  View in Library
                </Link>
              </div>
            )}
          </div>
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
