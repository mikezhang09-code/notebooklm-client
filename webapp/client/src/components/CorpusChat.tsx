/**
 * Reusable retrieval-augmented chat over the research corpus.
 *
 * Mirrors the NotebookLM chat UX (thread + composer + inline [n] citations)
 * but is powered by the corpus index and scoped by props: a collection, a
 * free-form type/category, a single document, or — with no scope — the whole
 * corpus. Clicking a citation chip or a source opens that artifact in the
 * inline Viewer.
 */
import { useRef, useState } from 'react';
import { Icon } from './Icon';
import Viewer from './Viewer';
import { renderAnswer } from '../lib/answer';
import { corpusChat, type CorpusChatScope, type CorpusChatSource } from '../lib/artifacts';
import { ApiError } from '../lib/api';

interface Msg {
  role: 'user' | 'bot';
  text: string;
  sources?: CorpusChatSource[];
}

const DEFAULT_SUGGESTIONS = [
  'Summarize the key themes',
  'What are the main takeaways?',
  'List open questions',
];

export default function CorpusChat({
  scope,
  title = 'Chat with your sources',
  subtitle = 'Answers are grounded in your corpus, with citations.',
  placeholder = 'Ask a question…',
  suggestions = DEFAULT_SUGGESTIONS,
  accent = 'var(--accent)',
}: {
  scope: CorpusChatScope;
  title?: string;
  subtitle?: string;
  placeholder?: string;
  suggestions?: string[];
  accent?: string;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{ id: string; title: string } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  function scrollToEnd() {
    requestAnimationFrame(() =>
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' }),
    );
  }

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setInput('');
    const history = msgs.map((m) => ({
      role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.text,
    }));
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setBusy(true);
    scrollToEnd();
    try {
      const r = await corpusChat({ question, history, ...scope });
      setMsgs((m) => [...m, { role: 'bot', text: r.answer, sources: r.sources }]);
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 503
          ? 'Corpus chat is not configured on the server (set CHAT_PROVIDER or GEMINI_API_KEY in .env).'
          : err instanceof Error
            ? err.message
            : String(err);
      setMsgs((m) => [...m, { role: 'bot', text: `⚠ ${msg}` }]);
    } finally {
      setBusy(false);
      scrollToEnd();
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

  return (
    <div className="chat-wrap" style={{ '--tc': accent } as React.CSSProperties}>
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
                <button key={s} className="chip" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="bubble">
                {m.role === 'bot' ? (
                  <>
                    <div
                      className="md-body bubble-md"
                      onClick={(e) => onThreadClick(e, m.sources)}
                      dangerouslySetInnerHTML={{ __html: renderAnswer(m.text) }}
                    />
                    {m.sources && m.sources.length > 0 && (
                      <div className="chat-sources">
                        {m.sources.map((s) => (
                          <button
                            key={s.index}
                            className="chat-source"
                            title={`Open “${s.artifact.title}”`}
                            onClick={() => setViewing({ id: s.artifact.id, title: s.artifact.title })}
                          >
                            <span className="chat-source-n">{s.index}</span>
                            <Icon id="i-doc" />
                            <span className="chat-source-t">{s.artifact.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  m.text
                )}
              </div>
            </div>
          ))
        )}
        {busy && (
          <div className="msg bot">
            <div className="bubble">
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send(input)}
          placeholder={placeholder}
          disabled={busy}
        />
        <button className="btn btn-primary" disabled={busy || !input.trim()} onClick={() => send(input)}>
          <Icon id="i-chev" />
        </button>
      </div>

      {viewing && (
        <Viewer
          id={viewing.id}
          title={viewing.title}
          tc={accent}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
