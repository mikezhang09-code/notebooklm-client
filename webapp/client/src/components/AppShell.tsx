/**
 * NotebookHub app shell — espresso sidebar rail + sticky topbar + routed outlet.
 * Two-column grid, each column scrolls internally (no page scroll).
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { TYPES } from '../lib/registry';
import { useTheme } from '../lib/theme';
import { apiGet } from '../lib/api';
import { clearSession } from '../lib/session-store';

interface Crumb {
  label: string;
  to?: string;
}

/** Build breadcrumbs from the current path. Last crumb is bold (non-link). */
function useCrumbs(): Crumb[] {
  const { pathname } = useLocation();
  const seg = pathname.split('/').filter(Boolean);
  if (seg.length === 0) return [{ label: 'NotebookLM' }];

  const head = seg[0];
  if (head === 'notebooklm') {
    const crumbs: Crumb[] = [{ label: 'NotebookLM', to: seg[1] ? '/notebooklm' : undefined }];
    if (seg[1]) crumbs.push({ label: 'Notebook' });
    return crumbs;
  }
  if (head === 'collections') {
    const crumbs: Crumb[] = [{ label: 'Collections', to: seg[1] ? '/collections' : undefined }];
    if (seg[1]) crumbs.push({ label: 'Collection' });
    return crumbs;
  }
  if (head === 'ask') {
    return [{ label: 'Ask' }];
  }
  if (head === 'free-forms') {
    const crumbs: Crumb[] = [{ label: 'Free Forms', to: seg[1] ? '/free-forms' : undefined }];
    if (seg[1]) {
      const t = TYPES.find((x) => x.key === seg[1]);
      crumbs.push({ label: t ? t.plural : 'Type' });
    }
    return crumbs;
  }
  if (head === 'settings') {
    return [
      { label: 'Settings' },
      { label: seg[1] === 'diagnose' ? 'Diagnose' : 'Session' },
    ];
  }
  return [{ label: head }];
}

export default function AppShell() {
  const [theme, toggleTheme] = useTheme();
  const navigate = useNavigate();
  const crumbs = useCrumbs();
  const [nbCount, setNbCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ notebooks: unknown[] }>('/api/notebooks')
      .then((r) => !cancelled && setNbCount(r.notebooks?.length ?? 0))
      .catch(() => !cancelled && setNbCount(null));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">
          <span className="mark">
            <Icon id="i-book" />
          </span>
          <b>
            Notebook<span>Hub</span>
          </b>
        </div>

        <div className="side-scroll">
          {/* LIBRARY */}
          <div className="nav-sec nav-lib">
            <div className="nav-label">Library</div>
            <NavLink
              to="/notebooklm"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="col-ic">
                <Icon id="i-nlm" />
              </span>
              <span className="n-label">
                NotebookLM
                <span className="sub">Google NotebookLM</span>
              </span>
              {nbCount != null && <span className="n-count">{nbCount}</span>}
            </NavLink>
            <NavLink
              to="/collections"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="col-ic">
                <Icon id="i-folder" />
              </span>
              <span className="n-label">
                Collections
                <span className="sub">Your research</span>
              </span>
            </NavLink>
          </div>

          {/* ASK */}
          <div className="nav-sec">
            <NavLink
              to="/ask"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon id="i-chat" />
              <span className="n-label">Ask</span>
            </NavLink>
          </div>

          {/* FREE FORMS */}
          <div className="nav-sec">
            <button className="nav-label clickable" onClick={() => navigate('/free-forms')}>
              <span>Free Forms</span>
              <span className="lab-x">All ›</span>
            </button>
            {TYPES.map((t) => (
              <NavLink
                key={t.key}
                to={`/free-forms/${t.key}`}
                style={{ '--tc': t.color } as React.CSSProperties}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <Icon id={t.icon} />
                <span className="n-label">{t.label}</span>
                {t.isNew ? <span className="n-new">New</span> : null}
              </NavLink>
            ))}
          </div>

          {/* SETTINGS */}
          <div className="nav-sec">
            <div className="nav-label">Settings</div>
            <NavLink
              to="/settings/session"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon id="i-gear" />
              <span className="n-label">Session</span>
            </NavLink>
            <NavLink
              to="/settings/diagnose"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon id="i-pulse" />
              <span className="n-label">Diagnose</span>
            </NavLink>
          </div>
        </div>

        <div className="side-foot">
          <span className="avatar">MZ</span>
          <span className="who">
            <b>Mike Zhang</b>
            <small>Local workspace</small>
          </span>
          <button
            className="ghost-ic"
            title="Toggle theme"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            <Icon id={theme === 'light' ? 'i-moon' : 'i-sun'} />
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {i > 0 && <Icon id="i-chev" />}
                {c.to ? (
                  <a onClick={() => navigate(c.to as string)}>{c.label}</a>
                ) : (
                  <b>{c.label}</b>
                )}
              </span>
            ))}
          </div>
          <div className="spacer" />
          <div className="search">
            <Icon id="i-search" />
            <input placeholder="Search…" />
          </div>
          <button
            className="icon-btn"
            title="Sign out (clear session)"
            onClick={() => {
              if (confirm('Clear the saved session from this browser?')) {
                clearSession();
                location.reload();
              }
            }}
          >
            <Icon id="i-refresh" />
          </button>
        </div>

        <Outlet />
      </main>
    </div>
  );
}
