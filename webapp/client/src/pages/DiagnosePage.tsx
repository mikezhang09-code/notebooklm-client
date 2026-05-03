import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';

interface DiagnoseResponse {
  server?: {
    platform?: string;
    osRelease?: string;
    node?: string;
  };
  transport?: {
    curlImpersonate?: boolean;
    tlsClient?: boolean;
    undici?: boolean;
    autoSelect?: string;
    error?: string;
  };
  api?: {
    status?: string;
    reason?: string;
    error?: string;
    notebookCount?: number;
    account?: {
      isPlus?: boolean;
      planType?: number;
      notebookLimit?: number;
      sourceLimit?: number;
      sourceWordLimit?: number;
    } | null;
  };
}

function Badge({ ok, label }: { ok: boolean | undefined; label: string }) {
  if (ok === undefined) return <span className="badge">{label}: ?</span>;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {label}: {ok ? 'available' : 'not available'}
    </span>
  );
}

export default function DiagnosePage() {
  const [data, setData] = useState<DiagnoseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setErr(null);
    try {
      const result = await apiGet<DiagnoseResponse>('/api/diagnose');
      setData(result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Diagnose</h1>
        <button type="button" className="btn-secondary" onClick={reload} disabled={loading}>
          {loading ? 'Checking…' : 'Re-run'}
        </button>
      </div>

      {err && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {err}
        </div>
      )}

      {data && (
        <>
          <div className="card">
            <h2 className="mb-2 text-lg font-semibold">Server</h2>
            <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
              <dt className="text-slate-500">Platform</dt>
              <dd className="font-mono text-xs">{data.server?.platform}</dd>
              <dt className="text-slate-500">OS release</dt>
              <dd className="font-mono text-xs">{data.server?.osRelease}</dd>
              <dt className="text-slate-500">Node</dt>
              <dd className="font-mono text-xs">{data.server?.node}</dd>
            </dl>
          </div>

          <div className="card">
            <h2 className="mb-2 text-lg font-semibold">Transport tiers</h2>
            {data.transport?.error ? (
              <div className="text-sm text-rose-700">{data.transport.error}</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge ok={data.transport?.curlImpersonate} label="curl-impersonate" />
                  <Badge ok={data.transport?.tlsClient} label="tls-client" />
                  <Badge ok={data.transport?.undici} label="undici" />
                </div>
                {data.transport?.autoSelect && (
                  <div className="mt-2 text-sm text-slate-600">
                    Auto-selected:{' '}
                    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
                      {data.transport.autoSelect}
                    </code>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="card">
            <h2 className="mb-2 text-lg font-semibold">API</h2>
            {data.api?.status === 'ok' ? (
              <dl className="grid grid-cols-[160px_1fr] gap-y-1 text-sm">
                <dt className="text-slate-500">Status</dt>
                <dd className="text-emerald-700">OK</dd>
                <dt className="text-slate-500">Notebooks</dt>
                <dd>{data.api.notebookCount}</dd>
                {data.api.account && (
                  <>
                    <dt className="text-slate-500">Plan</dt>
                    <dd>
                      {data.api.account.isPlus ? 'Plus' : 'Free'}{' '}
                      <span className="text-slate-400">(type {data.api.account.planType})</span>
                    </dd>
                    <dt className="text-slate-500">Notebook limit</dt>
                    <dd>{data.api.account.notebookLimit}</dd>
                    <dt className="text-slate-500">Source limit</dt>
                    <dd>{data.api.account.sourceLimit} / notebook</dd>
                    <dt className="text-slate-500">Word limit</dt>
                    <dd>{data.api.account.sourceWordLimit} / source</dd>
                  </>
                )}
              </dl>
            ) : data.api?.status === 'failed' ? (
              <div className="text-sm text-rose-700">{data.api.error}</div>
            ) : (
              <div className="text-sm text-slate-500">{data.api?.reason ?? 'skipped'}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
