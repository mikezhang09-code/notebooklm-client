/**
 * Reusable retrieval-augmented chat over the research corpus.
 *
 * Mirrors the NotebookLM chat UX (thread + composer + inline [n] citations)
 * but is powered by the corpus index and scoped by props: a collection, a
 * free-form type/category, a single document, or — with no scope — the whole
 * corpus. Answers stream in token-by-token; the thread is persisted per scope
 * so it survives reloads. Clicking a citation chip or a source opens that
 * artifact in the inline Viewer.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import Viewer from './Viewer';
import { renderAnswer } from '../lib/answer';
import {
  corpusChatStream,
  getChatPersist,
  setChatPersist,
  getChatThread,
  saveChatThread,
  deleteChatThread,
  type CorpusChatScope,
  type CorpusChatSource,
  type CorpusChatStoredMsg,
} from '../lib/artifacts';
import { ApiError } from '../lib/api';
import { toast } from '../lib/toast';

interface Msg {
  role: 'user' | 'bot';
  text: string;
  sources?: CorpusChatSource[];
  /** Answer came from a broad scope overview rather than a targeted match. */
  overview?: boolean;
  /** The turn failed — show a retry affordance instead of actions. */
  error?: boolean;
}

/** Stable, bounded key identifying this chat's scope (for storage + DB). */
function scopeKeyOf(scope: CorpusChatScope): string {
  if (scope.artifactId) return `doc:${scope.artifactId}`;
  if (scope.collectionId) return `col:${scope.collectionId}`;
  if (scope.category) return `cat:${scope.category}`;
  if (scope.kind) return `kind:${scope.kind}`;
  return 'corpus';
}

/** Drop transient (error/stopped) bubbles + fields we don't persist. */
function persistable(msgs: Msg[]): CorpusChatStoredMsg[] {
  return msgs
    .filter((m) => !m.error)
    .map((m) => ({ role: m.role, text: m.text, sources: m.sources, overview: m.overview }));
}

const DEFAULT_SUGGESTIONS = [
  'Summarize the key themes',
  'What are the main takeaways?',
  'List open questions',
];

/** localStorage namespace; one thread per distinct scope. */
const STORE_PREFIX = 'nblm-chat:';
/** Cap persisted history so localStorage doesn't grow without bound. */
const MAX_PERSISTED = 50;

export default function CorpusChat({
  scope,
  title = 'Chat with your sources',
  subtitle = 'Answers are grounded in your corpus, with citations.',
  placeholder = 'Ask a question…',
  suggestions = DEFAULT_SUGGESTIONS,
  accent = 'var(--accent)',
  storageKey,
}: {
  scope: CorpusChatScope;
  title?: string;
  subtitle?: string;
  placeholder?: string;
  suggestions?: string[];
  accent?: string;
  /** Override the per-scope persistence key (defaults to the serialised scope). */
  storageKey?: string;
}) {
  const scopeKey = storageKey ?? scopeKeyOf(scope);
  const key = STORE_PREFIX + scopeKey;
  const [msgs, setMsgs] = useState<Msg[]>(() => loadThread(key));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [persist, setPersist] = useState(false);
  const [viewing, setViewing] = useState<{ id: string; title: string } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Mirror `persist` in a ref so async turn handlers read the live value.
  const persistRef = useRef(false);

  function applyPersist(on: boolean) {
    persistRef.current = on;
    setPersist(on);
  }

  // On mount / scope change: paint the local copy instantly, then reconcile with
  // the server — if the global "save to library" switch is ON, the DB copy wins
  // so the thread is consistent across devices.
  useEffect(() => {
    let cancelled = false;
    setMsgs(loadThread(key));
    (async () => {
      try {
        const on = await getChatPersist();
        if (cancelled) return;
        applyPersist(on);
        if (on) {
          const dbMsgs = await getChatThread(scopeKey);
          if (!cancelled && dbMsgs.length > 0) setMsgs(dbMsgs as Msg[]);
        }
      } catch {
        // Corpus disabled / offline — stay in local-only mode silently.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scopeKey]);

  // Keep a local cache in every mode (instant paint next load); the DB copy is
  // written explicitly at the end of a turn when persistence is ON.
  useEffect(() => {
    if (busy) return;
    saveThread(key, msgs);
  }, [key, msgs, busy]);

  function scrollToEnd() {
    requestAnimationFrame(() =>
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' }),
    );
  }

  function autoGrow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }

  // Core turn runner: appends a streaming bot bubble, fills it from deltas, then
  // finalises it with sources/citations. `history` is the prior thread.
  async function runTurn(question: string, history: Msg[]) {
    const turns = history.map((m) => ({
      role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.text,
    }));
    const botIndex = history.length + 1; // user msg + this bot msg appended below
    setMsgs([...history, { role: 'user', text: question }, { role: 'bot', text: '' }]);
    setBusy(true);
    scrollToEnd();

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const result = await corpusChatStream(
        { question, history: turns, ...scope },
        (delta) => {
          setMsgs((m) => {
            const next = [...m];
            const cur = next[botIndex];
            if (cur && cur.role === 'bot') next[botIndex] = { ...cur, text: cur.text + delta };
            return next;
          });
          scrollToEnd();
        },
        ctrl.signal,
      );
      const finalThread: Msg[] = [
        ...history,
        { role: 'user', text: question },
        { role: 'bot', text: result.answer, sources: result.sources, overview: result.overview },
      ];
      setMsgs(finalThread);
      // Save the settled thread to the library when the global switch is ON, so
      // it appears on other devices. Fire-and-forget; failures stay local-only.
      if (persistRef.current) {
        void saveChatThread(scopeKey, persistable(finalThread)).catch(() => {});
      }
    } catch (err) {
      if (ctrl.signal.aborted) {
        // Keep whatever streamed so far; just drop the cursor.
        setMsgs((m) => {
          const next = [...m];
          const cur = next[botIndex];
          if (cur && cur.role === 'bot' && !cur.text)
            next[botIndex] = { role: 'bot', text: '⏹ Stopped.', error: true };
          return next;
        });
      } else {
        const msg =
          err instanceof ApiError && err.status === 503
            ? 'Corpus chat is not configured on the server (set CHAT_PROVIDER or GEMINI_API_KEY in .env).'
            : err instanceof Error
              ? err.message
              : String(err);
        setMsgs((m) => {
          const next = [...m];
          next[botIndex] = { role: 'bot', text: `⚠ ${msg}`, error: true };
          return next;
        });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      scrollToEnd();
    }
  }

  function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setInput('');
    requestAnimationFrame(autoGrow);
    void runTurn(question, msgs);
  }

  // Re-run the most recent user question, discarding the assistant reply below
  // it. Used by both the "regenerate" action and the error "retry" affordance.
  function regenerate() {
    if (busy) return;
    let lastUser = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]?.role === 'user') {
        lastUser = i;
        break;
      }
    }
    if (lastUser < 0) return;
    const question = msgs[lastUser]!.text;
    void runTurn(question, msgs.slice(0, lastUser));
  }

  function stop() {
    abortRef.current?.abort();
  }

  function clearThread() {
    if (busy) return;
    setMsgs([]);
    if (persistRef.current) void deleteChatThread(scopeKey).catch(() => {});
  }

  // Flip the global "save chats to the library" switch. Optimistic — revert on
  // failure. Turning it ON migrates the current thread so it's available on
  // other devices immediately.
  async function togglePersist() {
    const next = !persist;
    applyPersist(next);
    try {
      await setChatPersist(next);
      if (next && msgs.length > 0) {
        await saveChatThread(scopeKey, persistable(msgs));
      }
      toast(
        next
          ? 'Chats now save to the library (visible on all devices)'
          : 'Chats are now kept on this device only',
      );
    } catch (err) {
      applyPersist(!next); // revert
      toast(
        err instanceof ApiError && err.status === 503
          ? 'Saving to the library needs the corpus database configured'
          : 'Could not change the setting',
      );
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch {
      toast('Copy failed');
    }
  }

  // Citation-chip clicks bubble up here; open the matching source's artifact.
  function onThreadClick(e: React.MouseEvent, sources?: CorpusChatSource[]) {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.cite-chip');
    if (!chip || !sources) return;
    const idx = Number(chip.dataset['src']);
    const src = sources.find((s) => s.index === idx);
    if (src) setViewing({ id: src.artifact.id, title: src.artifact.title });
  }

  const lastBotIdx = (() => {
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i]?.role === 'bot') return i;
    return -1;
  })();

  return (
    <div className="chat-wrap" style={{ '--tc': accent } as React.CSSProperties}>
      <div className="chat-bar">
        <span className="chat-bar-t">{msgs.length > 0 ? title : ''}</span>
        <div className="chat-bar-actions">
          <button
            className={`chat-toggle${persist ? ' on' : ''}`}
            onClick={() => void togglePersist()}
            role="switch"
            aria-checked={persist}
            title={
              persist
                ? 'Saving chats to the library — they appear on every device. Applies to all chats. Click to keep chats on this device only.'
                : 'Chats are kept on this device only. Click to save all chats to the library so they appear on every device.'
            }
          >
            <span className="chat-toggle-track">
              <span className="chat-toggle-knob" />
            </span>
            <span className="chat-toggle-lbl">{persist ? 'Saved to library' : 'This device only'}</span>
          </button>
          {msgs.length > 0 && (
            <button
              className="chat-bar-btn"
              onClick={clearThread}
              disabled={busy}
              title="Clear conversation"
            >
              <Icon id="i-trash" /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="chat-thread" ref={threadRef}>
        {msgs.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-orb">
              <Icon id="i-chat" />
            </div>
            <h3>{title}</h3>
            <p>{subtitle}</p>
            <div className="chat-sugs">
              {suggestions.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m, i) => {
            const streaming = busy && i === lastBotIdx && m.role === 'bot';
            return (
              <div key={i} className={`msg ${m.role}`}>
                <div className="bubble">
                  {m.role === 'bot' ? (
                    <>
                      {m.overview && (
                        <div className="chat-note">
                          <Icon id="i-info" /> Broad overview — no exact match, summarised from
                          the collection.
                        </div>
                      )}
                      {m.text ? (
                        <div
                          className="md-body bubble-md"
                          onClick={(e) => onThreadClick(e, m.sources)}
                          dangerouslySetInnerHTML={{ __html: renderAnswer(m.text) }}
                        />
                      ) : (
                        <span className="typing">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                      {streaming && m.text && <span className="stream-caret" />}
                      {m.sources && m.sources.length > 0 && (
                        <div className="chat-sources">
                          {m.sources.map((s) => (
                            <button
                              key={s.index}
                              className="chat-source"
                              title={`Open “${s.artifact.title}”`}
                              onClick={() =>
                                setViewing({ id: s.artifact.id, title: s.artifact.title })
                              }
                            >
                              <span className="chat-source-n">{s.index}</span>
                              <Icon id="i-doc" />
                              <span className="chat-source-t">{s.artifact.title}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {!streaming && m.text && (
                        <div className="msg-actions">
                          {m.error ? (
                            <button className="msg-act" onClick={regenerate} disabled={busy}>
                              <Icon id="i-refresh" /> Retry
                            </button>
                          ) : (
                            <>
                              <button className="msg-act" onClick={() => void copy(m.text)}>
                                <Icon id="i-copy" /> Copy
                              </button>
                              {i === lastBotIdx && (
                                <button className="msg-act" onClick={regenerate} disabled={busy}>
                                  <Icon id="i-refresh" /> Regenerate
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    m.text
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="chat-input">
        <textarea
          ref={taRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={placeholder}
        />
        {busy ? (
          <button className="btn btn-soft chat-send" onClick={stop} title="Stop">
            <Icon id="i-stop" />
          </button>
        ) : (
          <button
            className="btn btn-primary chat-send"
            disabled={!input.trim()}
            onClick={() => send(input)}
            title="Send"
          >
            <Icon id="i-chev" />
          </button>
        )}
      </div>

      {viewing && (
        <Viewer id={viewing.id} title={viewing.title} tc={accent} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

/** Load a persisted thread, tolerating absent/corrupt storage. */
function loadThread(key: string): Msg[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Msg[]) : [];
  } catch {
    return [];
  }
}

/** Persist a thread (trimmed to the most recent turns), ignoring quota errors. */
function saveThread(key: string, msgs: Msg[]): void {
  try {
    if (msgs.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    // Drop transient error/stopped bubbles so they don't resurrect on reload.
    const clean = msgs.filter((m) => !m.error).slice(-MAX_PERSISTED);
    localStorage.setItem(key, JSON.stringify(clean));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}
