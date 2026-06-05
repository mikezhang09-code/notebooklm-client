/**
 * Library · NotebookLM — browse notebooks linked to Google NotebookLM.
 * Wired to the real GET /api/notebooks. Cards take an editorial accent color
 * derived from the notebook id (the live API doesn't categorize notebooks).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiDelete, apiGet } from '../../lib/api';
import { Icon } from '../../components/Icon';
import { TYPES } from '../../lib/registry';
import { toast } from '../../lib/toast';

interface NotebookInfo {
  id: string;
  title: string;
  sourceCount?: number;
}

/** Deterministic accent color per notebook so the grid stays colorful + stable. */
function colorFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TYPES[h % TYPES.length].color;
}

export default function NotebookLMPage() {
  const navigate = useNavigate();
  const [notebooks, setNotebooks] = useState<NotebookInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const { notebooks } = await apiGet<{ notebooks: NotebookInfo[] }>('/api/notebooks');
      setNotebooks(notebooks);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete notebook ${id}? This cannot be undone.`)) return;
    setBusyId(id);
    try {
      await apiDelete(`/api/notebooks/${id}`);
      toast('Notebook deleted');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="content">
      <div className="view-head">
        <div className="head-row">
          <div>
            <div className="view-eyebrow">
              <span className="pip" style={{ background: 'var(--accent)' }} />
              Library · NotebookLM
            </div>
            <div className="view-title">
              <h1>NotebookLM</h1>
            </div>
            <p className="view-sub">
              Notebooks linked to Google NotebookLM. Open one to manage sources, chat with
              citations, and generate artifacts from its material.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => toast('Create a notebook by generating an artifact from a source')}>
            <Icon id="i-plus" />
            New notebook
          </button>
        </div>
      </div>

      <div className="sec-bar">
        <h2 className="sec-h">
          Your notebooks{notebooks.length ? ` · ${notebooks.length}` : ''}
        </h2>
      </div>

      {error && (
        <div className="empty" style={{ color: 'var(--accent)' }}>
          {error}
        </div>
      )}

      <div className="grid">
        {notebooks.map((nb) => {
          const tc = colorFor(nb.id);
          return (
            <div
              key={nb.id}
              className="nb"
              style={{ '--tc': tc } as React.CSSProperties}
              onClick={() => navigate(`/notebooklm/${nb.id}`)}
            >
              <div className="nb-body">
                <div className="nb-top">
                  <span className="nb-id">#{nb.id.slice(0, 6)}</span>
                </div>
                <h3>{nb.title || '(untitled notebook)'}</h3>
                <div className="nb-meta">
                  <span>{nb.sourceCount ?? 0} sources</span>
                </div>
                <div className="nb-foot">
                  <button
                    className="act open"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/notebooklm/${nb.id}`);
                    }}
                  >
                    <Icon id="i-nlm" /> Open
                  </button>
                  <button
                    className="act"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/notebooklm/${nb.id}?tab=chat`);
                    }}
                  >
                    <Icon id="i-chat" /> Chat
                  </button>
                  <a
                    className="act"
                    href={`https://notebooklm.google.com/notebook/${nb.id}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Icon id="i-ext" />
                  </a>
                  <button
                    className="act del"
                    disabled={busyId === nb.id}
                    onClick={(e) => handleDelete(nb.id, e)}
                  >
                    <Icon id="i-trash" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {!loading && (
          <button
            className="new-tile"
            onClick={() => toast('Create a notebook by generating an artifact from a source')}
          >
            <span className="plus">
              <Icon id="i-plus" />
            </span>
            <b>New notebook</b>
            <small>Start from a source</small>
          </button>
        )}
      </div>

      {loading && <div className="empty">Loading notebooks…</div>}
    </div>
  );
}
