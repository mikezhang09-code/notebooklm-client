import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ARTIFACT_KINDS,
  chatWithCorpus,
  getCorpusHealth,
  type ArtifactKind,
  type ChatCitationSpan,
  type ChatResult,
  type ChatSource,
  type ChatTurn,
  type CorpusHealth,
} from '../lib/corpus';

/**
 * /corpus/chat — retrieval-augmented chat over the personal research corpus.
 *
 * Each user turn fires `POST /api/corpus/chat`. The server runs semantic
 * search to gather snippets, calls Cohere through OCI Generative AI with
 * those snippets as `documents`, and returns the grounded answer plus
 * inline citation spans pointing at the source artifacts.
 *
 * The UI:
 *  - Conversation transcript (user + assistant bubbles)
 *  - Inline `[1]` `[2]` citation badges spliced into the answer text
 *  - Per-turn sources panel with title / kind / distance / snippets
 *  - Filters: artifact kind, max sources, max cosine distance
 *  - Clear conversation button
 *
 * Streaming is not yet plumbed — the server uses non-streaming Cohere
 * responses and returns one JSON blob per turn.
 */

const KIND_LABELS: Record<string, string> = {
  audio: 'Audio',
  report: 'Report',
  video: 'Video',
  quiz: 'Quiz',
  flashcards: 'Flashcards',
  infographic: 'Infographic',
  slides: 'Slides',
  data_table: 'Data table',
  upload: 'Upload',
  qa: 'Q&A',
};

interface AssistantTurn {
  role: 'assistant';
  content: string;
  result: ChatResult;
}

interface UserTurn {
  role: 'user';
  content: string;
}

type Turn = UserTurn | AssistantTurn;

function distancePill(d: number): { text: string; cls: string } {
  if (d <= 0.45)
    return { text: 'Strong', cls: 'bg-emerald-100 text-emerald-800' };
  if (d <= 0.6) return { text: 'Good', cls: 'bg-blue-100 text-blue-800' };
  if (d <= 0.7) return { text: 'Weak', cls: 'bg-amber-100 text-amber-800' };
  return { text: 'Marginal', cls: 'bg-slate-100 text-slate-700' };
}

/**
 * Render the answer text with inline `[n]` citation badges spliced in at
 * each citation span's `end` index. Returns React children that the bubble
 * component can render directly.
 *
 * Cohere's citation `start`/`end` are character offsets into the answer
 * string, so we split the string into [text, badge, text, badge, ...]
 * pieces. Adjacent citations are merged so we never emit "[1][2]" twice.
 */
function renderAnswerWithCitations(
  answer: string,
  citations: ChatCitationSpan[],
  onClickSource: (sourceIndex: number) => void,
): JSX.Element[] {
  if (citations.length === 0) {
    return [<span key="t0">{answer}</span>];
  }
  // Sort by end position so we can splice left-to-right.
  const sorted = [...citations].sort((a, b) => a.end - b.end);
  const out: JSX.Element[] = [];
  let cursor = 0;
  sorted.forEach((c, i) => {
    const safeEnd = Math.max(cursor, Math.min(c.end, answer.length));
    if (safeEnd > cursor) {
      out.push(
        <span key={`t${i}`}>{answer.slice(cursor, safeEnd)}</span>,
      );
    }
    if (c.sourceIndices.length > 0) {
      out.push(
        <span key={`c${i}`} className="ml-0.5 inline-flex flex-wrap gap-0.5 align-baseline">
          {c.sourceIndices.map((idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onClickSource(idx)}
              className="rounded-md bg-brand-100 px-1 py-0 text-[11px] font-medium text-brand-700 hover:bg-brand-200"
              title={`Jump to source [${idx}]`}
            >
              [{idx}]
            </button>
          ))}
        </span>,
      );
    }
    cursor = safeEnd;
  });
  if (cursor < answer.length) {
    out.push(<span key="tail">{answer.slice(cursor)}</span>);
  }
  return out;
}

export default function CorpusChatPage(): JSX.Element {
  const [health, setHealth] = useState<CorpusHealth | null>(null);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters — apply to *future* turns; do not retro-mutate prior context.
  const [kind, setKind] = useState<ArtifactKind | ''>('');
  const [maxSources, setMaxSources] = useState<number>(6);
  const [maxDistance, setMaxDistance] = useState<number>(0.75);

  // For citation-click → scroll source into view.
  // Keyed by `${turnIndex}:${sourceIndex}` so each turn keeps its own panel.
  const sourceRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const registerSourceRef = (key: string, el: HTMLDivElement | null) => {
    if (el) sourceRefs.current[key] = el;
    else delete sourceRefs.current[key];
  };

  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCorpusHealth()
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch(() => {
        /* ignored — UI will surface a generic error */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll transcript on new turn.
  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [turns]);

  const chatEnabled = health?.chat?.enabled ?? false;
  const corpusEnabled = health?.enabled ?? false;

  const history = useMemo<ChatTurn[]>(
    () =>
      turns.map((t) => ({
        role: t.role,
        content: t.content,
      })),
    [turns],
  );

  async function send() {
    const q = draft.trim();
    if (q.length === 0 || busy) return;
    setError(null);
    const userTurn: UserTurn = { role: 'user', content: q };
    setTurns((prev) => [...prev, userTurn]);
    setDraft('');
    setBusy(true);

    try {
      const result = await chatWithCorpus({
        question: q,
        history,
        kind: kind || undefined,
        maxSources,
        maxDistance,
      });
      const aTurn: AssistantTurn = {
        role: 'assistant',
        content: result.answer,
        result,
      };
      setTurns((prev) => [...prev, aTurn]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Roll back the user turn so they can retry without a duplicate.
      setTurns((prev) => prev.slice(0, -1));
      setDraft(q);
    } finally {
      setBusy(false);
    }
  }

  function clearConversation() {
    if (turns.length === 0) return;
    if (!window.confirm('Clear the entire conversation?')) return;
    setTurns([]);
    setError(null);
  }

  function jumpToSource(turnIndex: number, sourceIndex: number) {
    const key = `${turnIndex}:${sourceIndex}`;
    const el = sourceRefs.current[key];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-brand-400');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-brand-400');
      }, 1500);
    }
  }

  // ── Disabled states ─────────────────────────────────────────────────
  if (health && !corpusEnabled) {
    return (
      <div className="card max-w-2xl text-sm text-slate-600">
        Corpus subsystem is disabled. Set the OCI / Oracle env vars in
        <code className="mx-1 rounded bg-slate-100 px-1">.env</code> to
        enable.
      </div>
    );
  }
  if (health && corpusEnabled && !chatEnabled) {
    return (
      <div className="card max-w-2xl space-y-2 text-sm text-slate-600">
        <h1 className="text-lg font-bold text-slate-900">
          Chat over corpus (disabled)
        </h1>
        <p>
          The semantic search and library are working, but the chat model is
          not configured. Set
          {' '}
          <code className="rounded bg-slate-100 px-1">OCI_GENAI_CHAT_MODEL</code>
          {' '}
          in your <code className="rounded bg-slate-100 px-1">.env</code> to
          enable retrieval-augmented chat. Recommended:
        </p>
        <ul className="list-disc pl-6">
          <li>
            <code>cohere.command-r-plus-08-2024</code> — best quality, slower
          </li>
          <li>
            <code>cohere.command-r-08-2024</code> — faster, still very capable
          </li>
        </ul>
        <p>
          You can verify availability for your tenancy in the OCI console
          under <em>Generative AI &rarr; Playground</em>.
        </p>
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100vh-7rem)] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      {/* Conversation column */}
      <div className="flex min-h-0 flex-col">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Chat over corpus
            </h1>
            <p className="text-sm text-slate-600">
              Ask questions across every ingested artifact. Answers cite the
              source snippets the model relied on.
              {health?.chat?.model ? (
                <span className="ml-1 text-slate-400">
                  · model {health.chat.model}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/corpus" className="btn-secondary text-sm">
              Search
            </Link>
            <Link to="/corpus/library" className="btn-secondary text-sm">
              Library
            </Link>
            {turns.length > 0 && (
              <button
                type="button"
                className="btn-ghost text-sm text-rose-600 hover:bg-rose-50"
                onClick={clearConversation}
                disabled={busy}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Transcript */}
        <div
          ref={transcriptRef}
          className="card flex-1 space-y-4 overflow-y-auto"
        >
          {turns.length === 0 && (
            <div className="text-sm text-slate-500">
              <p className="mb-2">Try one of:</p>
              <ul className="space-y-1">
                {[
                  'Summarise the main themes across my latest reports.',
                  'What conclusions appeared in more than one notebook?',
                  'Compare how the audio podcasts differ from the slide decks on the same topic.',
                ].map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => setDraft(s)}
                      className="text-left text-brand-700 hover:underline"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {turns.map((t, i) => (
            <Bubble
              key={i}
              turn={t}
              turnIndex={i}
              onJump={jumpToSource}
              registerSourceRef={registerSourceRef}
            />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" />
              Searching corpus and generating answer…
            </div>
          )}
        </div>

        {error && (
          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Composer */}
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            className="input min-h-[60px] flex-1 resize-y"
            placeholder="Ask a question grounded in your corpus…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            maxLength={4000}
            disabled={busy}
          />
          <button
            type="submit"
            className="btn-primary self-end"
            disabled={busy || draft.trim().length === 0}
          >
            {busy ? 'Asking…' : 'Send'}
          </button>
        </form>
        <p className="mt-1 text-[11px] text-slate-400">
          Press Enter to send · Shift+Enter for newline · Filters apply to
          future turns only.
        </p>
      </div>

      {/* Right rail: filters */}
      <aside className="space-y-3">
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">
            Retrieval filters
          </h2>

          <div>
            <label className="label" htmlFor="chat-kind">
              Kind
            </label>
            <select
              id="chat-kind"
              className="input"
              value={kind}
              onChange={(e) => setKind((e.target.value || '') as ArtifactKind | '')}
              disabled={busy}
            >
              <option value="">All kinds</option>
              {ARTIFACT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k] ?? k}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="chat-max-sources">
              Max sources: {maxSources}
            </label>
            <input
              id="chat-max-sources"
              type="range"
              min={1}
              max={10}
              step={1}
              value={maxSources}
              onChange={(e) => setMaxSources(parseInt(e.target.value, 10))}
              disabled={busy}
              className="w-full"
            />
            <p className="text-[11px] text-slate-500">
              How many artifacts to feed into the prompt.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="chat-max-distance">
              Max distance: {maxDistance.toFixed(2)}
            </label>
            <input
              id="chat-max-distance"
              type="range"
              min={0.4}
              max={1}
              step={0.05}
              value={maxDistance}
              onChange={(e) => setMaxDistance(parseFloat(e.target.value))}
              disabled={busy}
              className="w-full"
            />
            <p className="text-[11px] text-slate-500">
              Lower = stricter relevance threshold.
            </p>
          </div>
        </div>

        <div className="card text-xs text-slate-600">
          <p className="font-semibold text-slate-700">How this works</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            <li>Your question is embedded with the same multilingual model as the corpus.</li>
            <li>
              The top-{maxSources} artifacts (by best-chunk cosine distance) become
              the retrieval context.
            </li>
            <li>
              Cohere generates an answer constrained to those snippets and emits
              citation spans linking the answer back to source ids.
            </li>
          </ol>
        </div>
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────── sub-components ──

function Bubble({
  turn,
  turnIndex,
  onJump,
  registerSourceRef,
}: {
  turn: Turn;
  turnIndex: number;
  onJump: (turnIndex: number, sourceIndex: number) => void;
  registerSourceRef: (key: string, el: HTMLDivElement | null) => void;
}): JSX.Element {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-brand-600 px-3 py-2 text-sm text-white">
          {turn.content}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex justify-start">
        <div className="max-w-[90%] whitespace-pre-wrap rounded-lg bg-slate-100 px-3 py-2 text-sm leading-relaxed text-slate-800">
          {renderAnswerWithCitations(
            turn.result.answer,
            turn.result.citations,
            (idx) => onJump(turnIndex, idx),
          )}
        </div>
      </div>
      <SourcesPanel
        sources={turn.result.sources}
        turnIndex={turnIndex}
        noSources={turn.result.noSources}
        retrievalMs={turn.result.retrievalMs}
        chatMs={turn.result.chatMs}
        inputTokens={turn.result.inputTokens}
        outputTokens={turn.result.outputTokens}
        registerSourceRef={registerSourceRef}
      />
    </div>
  );
}

function SourcesPanel({
  sources,
  turnIndex,
  noSources,
  retrievalMs,
  chatMs,
  inputTokens,
  outputTokens,
  registerSourceRef,
}: {
  sources: ChatSource[];
  turnIndex: number;
  noSources: boolean;
  retrievalMs: number;
  chatMs: number;
  inputTokens?: number;
  outputTokens?: number;
  registerSourceRef: (key: string, el: HTMLDivElement | null) => void;
}): JSX.Element | null {
  if (noSources && sources.length === 0) {
    return (
      <div className="ml-2 text-[11px] text-slate-500">
        No matching sources retrieved · {retrievalMs} ms
      </div>
    );
  }
  if (sources.length === 0) return null;
  return (
    <details className="ml-2 text-xs" open>
      <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700">
        {sources.length} source{sources.length === 1 ? '' : 's'} · retrieval{' '}
        {retrievalMs} ms · chat {chatMs} ms
        {inputTokens != null && outputTokens != null
          ? ` · ${inputTokens} in / ${outputTokens} out tokens`
          : ''}
      </summary>
      <div className="mt-1.5 grid grid-cols-1 gap-1.5">
        {sources.map((s) => (
          <SourceCard
            key={`${turnIndex}-${s.index}`}
            turnIndex={turnIndex}
            source={s}
            registerSourceRef={registerSourceRef}
          />
        ))}
      </div>
    </details>
  );
}

function SourceCard({
  source,
  turnIndex,
  registerSourceRef,
}: {
  source: ChatSource;
  turnIndex: number;
  registerSourceRef: (key: string, el: HTMLDivElement | null) => void;
}): JSX.Element {
  const a = source.artifact;
  const pill = distancePill(source.bestDistance);
  const refKey = `${turnIndex}:${source.index}`;
  return (
    <div
      ref={(el) => registerSourceRef(refKey, el)}
      data-source-key={refKey}
      className="rounded-md border border-slate-200 bg-white p-2 transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">
              [{source.index}]
            </span>
            <span className="badge-brand text-[10px]">
              {KIND_LABELS[a.kind] ?? a.kind}
            </span>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${pill.cls}`}
            >
              {pill.text} {source.bestDistance.toFixed(3)}
            </span>
          </div>
          <div className="mt-0.5 truncate text-sm font-medium text-slate-900">
            {a.title}
          </div>
          {a.notebookId && (
            <Link
              to={`/library/${a.notebookId}`}
              className="text-[11px] text-brand-700 hover:underline"
              title="Open the originating notebook"
            >
              📒 notebook
            </Link>
          )}
        </div>
        <Link
          to={`/corpus/library`}
          className="text-[11px] text-slate-500 hover:text-brand-700"
          title="Open in library"
        >
          library ↗
        </Link>
      </div>

      <ul className="mt-1.5 space-y-1">
        {source.snippets.map((sn) => (
          <li
            key={sn.chunkId}
            className="rounded bg-slate-50 px-2 py-1 text-[12px] leading-snug text-slate-700"
          >
            {sn.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
