import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet } from '../lib/api';

interface NotebookInfo {
  id: string;
  title: string;
  sourceCount?: number;
}

interface ListResponse {
  notebooks: NotebookInfo[];
}

export default function NotebooksPage() {
  const [notebooks, setNotebooks] = useState<NotebookInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const { notebooks } = await apiGet<ListResponse>('/api/notebooks');
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

  async function handleDelete(id: string) {
    if (!confirm(`Delete notebook ${id}? This cannot be undone.`)) return;
    setBusyId(id);
    try {
      await apiDelete(`/api/notebooks/${id}`);
      setNotebooks((list) => list.filter((n) => n.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Notebooks</h1>
        <button type="button" className="btn-secondary" onClick={reload} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {!loading && notebooks.length === 0 && !error && (
        <div className="card text-sm text-slate-600">
          No notebooks yet. Generate one from the sidebar (Audio, Report, etc.) — every generation
          creates a notebook.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {notebooks.map((nb) => (
          <div key={nb.id} className="card flex flex-col gap-3">
            <div>
              <div className="truncate text-base font-semibold text-slate-900" title={nb.title}>
                {nb.title || '(untitled)'}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {nb.sourceCount !== undefined && (
                  <span className="mr-2">
                    {nb.sourceCount} source{nb.sourceCount === 1 ? '' : 's'}
                  </span>
                )}
                <code className="font-mono text-[11px] text-slate-400">{nb.id}</code>
              </div>
            </div>
            <div className="mt-auto flex flex-wrap gap-2">
              <Link to={`/library/${nb.id}`} className="btn-secondary">
                Open
              </Link>
              <Link to={`/chat/${nb.id}`} className="btn-secondary">
                Chat
              </Link>
              <a
                href={`https://notebooklm.google.com/notebook/${nb.id}`}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost"
              >
                ↗ NotebookLM
              </a>
              <button
                type="button"
                className="btn-danger ml-auto"
                onClick={() => handleDelete(nb.id)}
                disabled={busyId === nb.id}
              >
                {busyId === nb.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
