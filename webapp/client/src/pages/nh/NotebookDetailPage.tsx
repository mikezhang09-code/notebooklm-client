/**
 * Notebook detail — Artifacts / Sources / Chat tabs for one NotebookLM notebook.
 * Wired to GET /api/notebooks/:id, the sources + chat + generate routes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Icon } from '../../components/Icon';
import GenerateDrawer, { type DrawerSource } from '../../components/GenerateDrawer';
import ItemModal from '../../components/ItemModal';
import { TYPE, TYPES, type TypeKey } from '../../lib/registry';
import { apiGet, apiJson, apiFormData, apiDelete } from '../../lib/api';
import { listItems, type Item } from '../../lib/artifacts';
import { toast } from '../../lib/toast';

interface SourceInfo {
  id: string;
  title: string;
  wordCount?: number;
  url?: string;
}
interface ArtifactInfo {
  id: string;
  title: string;
  type: number;
  typeLabel: string;
  durationSeconds?: number;
}
interface DetailResponse {
  title: string;
  sources: SourceInfo[];
  artifacts?: ArtifactInfo[];
}

const NB_BLUE = '#4a76a8';

function labelToTypeKey(label: string): TypeKey {
  const map: Record<string, TypeKey> = {
    audio: 'audio',
    report: 'report',
    video: 'video',
    quiz: 'quiz',
    flashcards: 'flash',
    'mind-map': 'mind',
    infographic: 'info',
    slides: 'slides',
    'data-table': 'table',
  };
  return map[label] ?? 'report';
}

/** NotebookLM labels flashcards as 'quiz' (shared type); disambiguate by title. */
function artifactTypeKey(a: ArtifactInfo): TypeKey {
  if (a.typeLabel === 'quiz' && /flashcard/i.test(a.title)) return 'flash';
  return labelToTypeKey(a.typeLabel);
}

type Tab = 'artifacts' | 'sources' | 'chat';

export default function NotebookDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'artifacts';
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await apiGet<DetailResponse>(`/api/notebooks/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, [id]);

  if (!id) return null;
  const sources = detail?.sources ?? [];
  const artifacts = detail?.artifacts ?? [];

  function setTab(t: Tab) {
    setParams((p) => {
      p.set('tab', t);
      return p;
    });
  }

  return (
    <div className="content" style={{ '--tc': NB_BLUE } as React.CSSProperties}>
      <div className="view-head">
        <div className="view-eyebrow">
          <span className="pip" style={{ background: NB_BLUE }} />
          NotebookLM · #{id.slice(0, 6)}
        </div>
        <div className="view-title">
          <h1 className="ser">{detail?.title ?? (loading ? 'Loading…' : 'Notebook')}</h1>
        </div>
        <p className="view-sub">
          {sources.length} sources · {artifacts.length} artifacts. Linked to Google NotebookLM.
        </p>
      </div>

      <div className="tabbar">
        <button className={`tab${tab === 'artifacts' ? ' on' : ''}`} onClick={() => setTab('artifacts')}>
          <Icon id="i-grid" /> Artifacts <span className="tab-x">{artifacts.length}</span>
        </button>
        <button className={`tab${tab === 'sources' ? ' on' : ''}`} onClick={() => setTab('sources')}>
          <Icon id="i-doc" /> Sources <span className="tab-x">{sources.length}</span>
        </button>
        <button className={`tab${tab === 'chat' ? ' on' : ''}`} onClick={() => setTab('chat')}>
          <Icon id="i-chat" /> Chat
        </button>
      </div>

      {error && <div className="empty" style={{ color: 'var(--accent)' }}>{error}</div>}

      {tab === 'artifacts' && (
        <ArtifactsTab
          notebookId={id}
          notebookTitle={detail?.title}
          artifacts={artifacts}
          sources={sources}
          onChanged={reload}
        />
      )}
      {tab === 'sources' && (
        <SourcesTab notebookId={id} sources={sources} onChanged={reload} />
      )}
      {tab === 'chat' && <ChatTab notebookId={id} sourceCount={sources.length} />}
    </div>
  );
}

/* ───────────────────────────── Artifacts tab ───────────────────────────── */

function ArtifactsTab({
  notebookId,
  notebookTitle,
  artifacts,
  sources,
  onChanged,
}: {
  notebookId: string;
  notebookTitle?: string;
  artifacts: ArtifactInfo[];
  sources: SourceInfo[];
  onChanged: () => void;
}) {
  const [genType, setGenType] = useState<TypeKey | null>(null);
  // corpus artifacts already saved for this notebook, keyed by NotebookLM artifact id.
  const [savedMap, setSavedMap] = useState<Map<string, Item>>(new Map());
  // Artifacts saved this session whose corpus row may still be indexing (so we
  // show "Saved" instantly without waiting for the async ingest to finish).
  const [savedPending, setSavedPending] = useState<Set<string>>(new Set());
  const [corpusEnabled, setCorpusEnabled] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [open, setOpen] = useState<Item | null>(null);

  const drawerSources: DrawerSource[] = sources.map((s) => ({
    id: s.id,
    title: s.title,
    ext: s.url ? 'web' : undefined,
  }));

  async function fetchSaved(): Promise<Map<string, Item>> {
    try {
      const { items } = await listItems({ notebookId, limit: 200 });
      const m = new Map<string, Item>();
      for (const it of items) if (it.artifactId) m.set(it.artifactId, it);
      setSavedMap(m);
      setCorpusEnabled(true);
      return m;
    } catch {
      setCorpusEnabled(false); // corpus disabled — fall back to download-only
      return new Map();
    }
  }
  useEffect(() => {
    void fetchSaved();
  }, [notebookId]);

  /**
   * Save = download (which auto-ingests). The download response confirms the
   * ingest was scheduled, so we flip to "Saved" immediately, then poll in the
   * background until the corpus row appears (needed to open the item modal).
   */
  async function save(a: ArtifactInfo) {
    setSavingId(a.id);
    try {
      await apiJson(`/api/notebooks/${notebookId}/artifacts/${a.id}/download`, {
        artifactTitle: a.title,
        notebookTitle,
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
      setSavingId(null);
      return;
    }
    // Optimistic: the byte download + ingest were accepted.
    setSavedPending((p) => new Set(p).add(a.id));
    setSavingId(null);
    toast('Saved to library');
    // Resolve the real corpus row (ingest is async — can take 10-30s for slides).
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const m = await fetchSaved();
      if (m.has(a.id)) break;
    }
  }

  /** Direct download when the corpus is disabled (no library to save into). */
  async function download(a: ArtifactInfo) {
    try {
      const r = await apiJson<{ files: { name: string; url: string }[]; streamUrl?: string }>(
        `/api/notebooks/${notebookId}/artifacts/${a.id}/download`,
        {},
      );
      if (r.files[0]) {
        const link = document.createElement('a');
        link.href = r.files[0].url;
        link.download = r.files[0].name;
        link.click();
      } else if (r.streamUrl) {
        window.open(r.streamUrl, '_blank');
      }
      toast('Download ready');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      {artifacts.length > 0 && (
        <div className="item-grid" style={{ marginBottom: 24 }}>
          {artifacts.map((a) => {
            const t = TYPE[artifactTypeKey(a)];
            const isMind = a.typeLabel === 'mind-map';
            const saved = savedMap.get(a.id);
            const isSaved = !!saved || savedPending.has(a.id);
            const saving = savingId === a.id;
            return (
              <div
                key={a.id}
                className="item"
                style={{ '--tc': t.color } as React.CSSProperties}
                onClick={() => {
                  if (isMind) {
                    window.open(`https://notebooklm.google.com/notebook/${notebookId}`, '_blank');
                  } else if (saved) {
                    setOpen(saved);
                  } else if (isSaved) {
                    toast('Saved — still indexing, View available shortly');
                  } else if (corpusEnabled) {
                    if (!saving) void save(a);
                  } else {
                    void download(a);
                  }
                }}
              >
                <div className="item-top">
                  <span className="t-ic">
                    <Icon id={t.icon} />
                  </span>
                  {isMind ? (
                    <span className="prov p-notebooklm">
                      <Icon id="i-ext" /> NotebookLM
                    </span>
                  ) : isSaved ? (
                    <span className="health-pill ok" style={{ padding: '4px 9px' }}>
                      <span className="hd" /> Saved
                    </span>
                  ) : corpusEnabled ? (
                    <button
                      className="act"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!saving) void save(a);
                      }}
                    >
                      {saving ? <span className="spinner" /> : <Icon id="i-download" />}
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  ) : (
                    <button
                      className="act"
                      onClick={(e) => {
                        e.stopPropagation();
                        void download(a);
                      }}
                    >
                      <Icon id="i-download" /> Download
                    </button>
                  )}
                </div>
                <h4>{a.title}</h4>
                <div className="i-meta">
                  {t.label}
                  {a.durationSeconds ? ` · ${Math.round(a.durationSeconds / 60)}m` : ''}
                  {isSaved ? ' · in library' : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="launcher">
        <div className="launcher-head">
          <span className="l-ic">
            <Icon id="i-spark" />
          </span>
          <div>
            <b>Generate a new artifact</b>
            <br />
            <small>Choose sources &amp; options in the next step</small>
          </div>
        </div>
        <div className="gen-strip">
          {TYPES.filter((t) => t.generate).map((t) => (
            <button
              key={t.key}
              className="gen-tile"
              style={{ '--tc': t.color } as React.CSSProperties}
              onClick={() => setGenType(t.key)}
            >
              <span className="g-ic">
                <Icon id={t.icon} />
              </span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {genType && (
        <GenerateDrawer
          typeKey={genType}
          notebookId={notebookId}
          sources={drawerSources}
          onClose={() => setGenType(null)}
          onDone={() => {
            onChanged();
            void fetchSaved();
          }}
        />
      )}

      {open && (
        <ItemModal
          item={open}
          onClose={() => setOpen(null)}
          onDeleted={() => {
            void fetchSaved();
            onChanged();
          }}
        />
      )}
    </>
  );
}

/* ────────────────────────────── Sources tab ────────────────────────────── */

function SourcesTab({
  notebookId,
  sources,
  onChanged,
}: {
  notebookId: string;
  sources: SourceInfo[];
  onChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () => sources.filter((s) => s.title.toLowerCase().includes(query.toLowerCase())),
    [sources, query],
  );

  async function removeSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Remove ${selected.size} source(s)?`)) return;
    setBusy(true);
    try {
      for (const sid of selected) await apiDelete(`/api/notebooks/${notebookId}/sources/${sid}`);
      toast('Sources removed');
      setSelected(new Set());
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const allChecked = filtered.length > 0 && filtered.every((s) => selected.has(s.id));

  return (
    <>
      <div className="src-toolbar">
        <div className="search" style={{ width: 300 }}>
          <Icon id="i-search" />
          <input placeholder="Filter sources…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {selected.size > 0 && <span className="src-tool-count">{selected.size} selected</span>}
        <div style={{ flex: 1 }} />
        {selected.size > 0 && (
          <button className="btn btn-soft" disabled={busy} onClick={removeSelected}>
            <Icon id="i-trash" /> Remove selected
          </button>
        )}
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
          <Icon id="i-plus" /> Add source
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <Icon id="i-doc" />
          <p>{sources.length === 0 ? 'No sources yet.' : 'No matches.'}</p>
        </div>
      ) : (
        <div className="src-table">
          <div className="srt-head">
            <label className="cbox">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={() =>
                  setSelected(allChecked ? new Set() : new Set(filtered.map((s) => s.id)))
                }
              />
              <span>
                <Icon id="i-check" />
              </span>
            </label>
            <span>Source</span>
            <span>Type</span>
            <span>Format</span>
            <span>Words</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>
          {filtered.map((s) => {
            const kind = s.url ? 'url' : 'file';
            return (
              <div key={s.id} className="srt-row">
                <label className="cbox">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() =>
                      setSelected((p) => {
                        const n = new Set(p);
                        n.has(s.id) ? n.delete(s.id) : n.add(s.id);
                        return n;
                      })
                    }
                  />
                  <span>
                    <Icon id="i-check" />
                  </span>
                </label>
                <div className="srt-name">
                  <span className="src-ic">
                    <Icon id={s.url ? 'i-link' : 'i-doc'} />
                  </span>
                  <span className="srt-nm">{s.title}</span>
                </div>
                <span>
                  <span className={`kind-badge kind-${kind}`}>{kind}</span>
                </span>
                <span className="srt-mono">{s.url ? 'web' : 'file'}</span>
                <span className="srt-date">{s.wordCount != null ? `${s.wordCount}` : '—'}</span>
                <div className="srt-act">
                  {s.url && (
                    <a className="icon-btn" href={s.url} target="_blank" rel="noreferrer">
                      <Icon id="i-ext" />
                    </a>
                  )}
                  <button
                    className="icon-btn"
                    onClick={async () => {
                      if (!confirm('Remove this source?')) return;
                      try {
                        await apiDelete(`/api/notebooks/${notebookId}/sources/${s.id}`);
                        toast('Source removed');
                        onChanged();
                      } catch (err) {
                        toast(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    <Icon id="i-trash" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {addOpen && (
        <AddSourceDrawer
          notebookId={notebookId}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function AddSourceDrawer({
  notebookId,
  onClose,
  onAdded,
}: {
  notebookId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [mode, setMode] = useState<'file' | 'url' | 'text'>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      if (mode === 'url') form.append('url', url);
      else if (mode === 'text') {
        form.append('text', text);
        if (title) form.append('title', title);
      } else if (file) form.append('file', file);
      await apiFormData(`/api/notebooks/${notebookId}/sources`, form);
      toast('Source added');
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = mode === 'url' ? !!url.trim() : mode === 'text' ? !!text.trim() : !!file;

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <aside className="drawer open" style={{ '--tc': NB_BLUE } as React.CSSProperties}>
        <div className="drawer-head">
          <span className="d-ic">
            <Icon id="i-plus" />
          </span>
          <div className="d-tt">
            <b>Add source</b>
            <small>File, URL, or text</small>
          </div>
          <button className="icon-btn x" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>
        <div className="drawer-body">
          <div className="field">
            <label>Source type</label>
            <div className="seg">
              {(['file', 'url', 'text'] as const).map((m) => (
                <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                  {m === 'file' ? 'File' : m === 'url' ? 'URL' : 'Text'}
                </button>
              ))}
            </div>
          </div>
          {mode === 'url' && (
            <div className="field">
              <label>URL</label>
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </div>
          )}
          {mode === 'text' && (
            <>
              <div className="field">
                <label>Title (optional)</label>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="field">
                <label>Text</label>
                <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} />
              </div>
            </>
          )}
          {mode === 'file' && (
            <div className="field">
              <label>File</label>
              <button className="dropzone" style={{ width: '100%' }} onClick={() => inputRef.current?.click()}>
                <Icon id="i-upload" />
                <div style={{ marginTop: 8 }}>{file ? file.name : 'Click to choose a file'}</div>
              </button>
              <input
                ref={inputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          )}
          {error && <p className="hint" style={{ color: 'var(--accent)' }}>{error}</p>}
        </div>
        <div className="drawer-foot">
          <button className="btn btn-primary" disabled={busy || !canSubmit} onClick={submit}>
            {busy ? 'Adding…' : 'Add to notebook'}
          </button>
          <button className="btn btn-soft" onClick={onClose}>
            Cancel
          </button>
        </div>
      </aside>
    </>
  );
}

/* ─────────────────────────────── Chat tab ──────────────────────────────── */

interface ChatMsg {
  role: 'user' | 'bot';
  text: string;
  cites?: string[];
}

/**
 * Render an assistant answer as user-friendly HTML: parse the Markdown the
 * model emits (headings, bold, lists, rules) and turn inline `[1, 2]` /
 * `[13-15]` citation markers into small numbered chips, the way NotebookLM
 * displays them. Mirrors the markdown rendering already used by the note
 * editor + artifact viewer.
 */
function renderAnswer(text: string): string {
  let html: string;
  try {
    html = marked.parse(text, { async: false }) as string;
  } catch {
    return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
  }
  // Replace bracketed citation lists ([1, 2], [2, 5-7], [13-15]) with chips.
  // Restricted to digit/comma/space/hyphen/en-dash content so prose like
  // "[note]" or markdown links are left untouched.
  html = html.replace(/\[(\d[\d\s,–-]*)\]/g, (whole, grp: string) => {
    const parts = grp
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return whole;
    return parts.map((p) => `<sup class="cite-chip">${p}</sup>`).join('');
  });
  // The answer is model output that can echo source HTML or be steered by
  // prompt injection, so sanitize before injecting via dangerouslySetInnerHTML.
  return DOMPurify.sanitize(html);
}

function ChatTab({ notebookId, sourceCount }: { notebookId: string; sourceCount: number }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const threadRef = useRef<HTMLDivElement>(null);

  // Load the notebook's persisted conversation history when the chat opens.
  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    apiGet<{ turns: { role: 'user' | 'assistant'; text: string }[] }>(
      `/api/chat/history?notebookId=${encodeURIComponent(notebookId)}`,
    )
      .then((r) => {
        if (cancelled) return;
        setMsgs(r.turns.map((t) => ({ role: t.role === 'user' ? 'user' : 'bot', text: t.text })));
      })
      .catch(() => {
        /* history is best-effort; leave the empty state */
      })
      .finally(() => !cancelled && setLoadingHistory(false));
    return () => {
      cancelled = true;
    };
  }, [notebookId]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [msgs, busy, loadingHistory]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setBusy(true);
    try {
      const r = await apiJson<{ text: string; citations?: Array<Record<string, unknown>> }>(
        '/api/chat',
        { notebookId, question, withCitations: true },
      );
      const cites = (r.citations ?? [])
        .map((c) => String(c['sourceTitle'] ?? c['title'] ?? c['excerpt'] ?? '').trim())
        .filter(Boolean)
        .slice(0, 6);
      setMsgs((m) => [...m, { role: 'bot', text: r.text, cites }]);
    } catch (err) {
      setMsgs((m) => [...m, { role: 'bot', text: `⚠ ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setBusy(false);
    }
  }

  const suggestions = ['Summarize the key points', 'What are the main takeaways?', 'List open questions'];

  return (
    <div className="chat-wrap">
      <div className="chat-thread" ref={threadRef}>
        {loadingHistory && msgs.length === 0 ? (
          <div className="empty">Loading conversation history…</div>
        ) : msgs.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-orb">
              <Icon id="i-chat" />
            </div>
            <h3>Chat with this notebook</h3>
            <p>Grounded in this notebook's {sourceCount} sources, with citations.</p>
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
                  <div
                    className="md-body bubble-md"
                    dangerouslySetInnerHTML={{ __html: renderAnswer(m.text) }}
                  />
                ) : (
                  m.text
                )}
                {m.cites && m.cites.length > 0 && (
                  <div className="cites">
                    {m.cites.map((c, j) => (
                      <span key={j} className="cite">
                        <Icon id="i-doc" />
                        {c.length > 28 ? `${c.slice(0, 28)}…` : c}
                      </span>
                    ))}
                  </div>
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
          placeholder="Ask about this notebook…"
          disabled={busy}
        />
        <button className="btn btn-primary" disabled={busy || !input.trim()} onClick={() => send(input)}>
          <Icon id="i-chev" />
        </button>
      </div>
      <p className="chat-foot">Grounded in {sourceCount} sources · responses cite their origin.</p>
    </div>
  );
}
