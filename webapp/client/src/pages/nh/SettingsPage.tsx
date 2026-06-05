/**
 * Settings — Session + Diagnose. Wired to real session state, the theme store,
 * and GET /api/corpus/health for subsystem status pills.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useTheme } from '../../lib/theme';
import { apiGet } from '../../lib/api';
import { hasSession, clearSession } from '../../lib/session-store';

function HealthPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`health-pill ${ok ? 'ok' : 'bad'}`}>
      <span className="hd" />
      {label}
    </span>
  );
}

interface CorpusHealth {
  enabled?: boolean;
  db?: { ok?: boolean };
  storage?: { ok?: boolean };
  genai?: { ok?: boolean; model?: string };
  chat?: { enabled?: boolean; provider?: string };
}

export default function SettingsPage({ tab }: { tab: 'session' | 'diagnose' }) {
  const [theme, toggleTheme] = useTheme();

  if (tab === 'diagnose') return <Diagnose />;

  return (
    <div className="content">
      <div className="view-head">
        <div className="view-eyebrow">
          <span className="pip" style={{ background: 'var(--accent)' }} />
          Settings · Session
        </div>
        <div className="view-title">
          <h1>Session</h1>
        </div>
      </div>

      <div className="set-card">
        <h3>Account</h3>
        <p className="s-d">Your NotebookLM session is stored only in this browser.</p>
        <div className="set-row">
          <span className="s-ic">
            <Icon id="i-nlm" />
          </span>
          <span className="s-main">
            <b>Google NotebookLM</b>
            <small>Bring-your-own-session</small>
          </span>
          <HealthPill ok={hasSession()} label={hasSession() ? 'Linked' : 'Not linked'} />
        </div>
        <div className="set-row">
          <span className="s-ic">
            <Icon id={theme === 'light' ? 'i-sun' : 'i-moon'} />
          </span>
          <span className="s-main">
            <b>Appearance</b>
            <small>Theme · {theme}</small>
          </span>
          <button className="btn btn-soft" onClick={toggleTheme}>
            Switch to {theme === 'light' ? 'dark' : 'light'}
          </button>
        </div>
      </div>

      <div className="set-card">
        <h3>Danger zone</h3>
        <p className="s-d">Removes the saved session from this browser. You'll need to paste it again.</p>
        <button
          className="btn btn-soft"
          style={{ color: 'var(--accent)' }}
          onClick={() => {
            if (confirm('Clear the saved session from this browser?')) {
              clearSession();
              location.reload();
            }
          }}
        >
          <Icon id="i-trash" /> Sign out (clear session)
        </button>
      </div>
    </div>
  );
}

function Diagnose() {
  const [health, setHealth] = useState<CorpusHealth | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);

  useEffect(() => {
    apiGet<{ ok: boolean }>('/api/health')
      .then((r) => setServerOk(!!r.ok))
      .catch(() => setServerOk(false));
    apiGet<CorpusHealth>('/api/corpus/health')
      .then(setHealth)
      .catch(() => setHealth({ enabled: false }));
  }, []);

  return (
    <div className="content">
      <div className="view-head">
        <div className="view-eyebrow">
          <span className="pip" style={{ background: 'var(--accent)' }} />
          Settings · Diagnose
        </div>
        <div className="view-title">
          <h1>Diagnose</h1>
        </div>
        <p className="view-sub">Health of each subsystem this app depends on.</p>
      </div>

      <div className="set-card">
        <h3>System status</h3>
        <div className="set-row">
          <span className="s-ic">
            <Icon id="i-pulse" />
          </span>
          <span className="s-main">
            <b>Web server</b>
            <small>Express API</small>
          </span>
          <HealthPill ok={!!serverOk} label={serverOk == null ? '…' : serverOk ? 'OK' : 'Down'} />
        </div>
        <div className="set-row">
          <span className="s-ic">
            <Icon id="i-nlm" />
          </span>
          <span className="s-main">
            <b>NotebookLM session</b>
            <small>Local credentials</small>
          </span>
          <HealthPill ok={hasSession()} label={hasSession() ? 'OK' : 'Missing'} />
        </div>
        <div className="set-row">
          <span className="s-ic">
            <Icon id="i-layers" />
          </span>
          <span className="s-main">
            <b>Embeddings</b>
            <small>{health?.genai?.model ?? 'Vector model'}</small>
          </span>
          <HealthPill ok={!!health?.genai?.ok} label={health?.genai?.ok ? 'OK' : 'Off'} />
        </div>
        <div className="set-row">
          <span className="s-ic">
            <Icon id="i-grid" />
          </span>
          <span className="s-main">
            <b>Vector database</b>
            <small>Oracle ADB</small>
          </span>
          <HealthPill ok={!!health?.db?.ok} label={health?.db?.ok ? 'OK' : 'Off'} />
        </div>
      </div>
    </div>
  );
}
