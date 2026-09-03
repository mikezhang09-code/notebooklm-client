/**
 * NotebookHub app shell — espresso sidebar rail + sticky topbar + routed outlet.
 * Two-column grid, each column scrolls internally (no page scroll).
 *
 * The rail collapses to an icon-only strip (toggle in its header, preference
 * persisted); collapsed nav items fall back to native tooltips for their names.
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

const RAIL_KEY = 'nh-rail-collapsed';

/** Collapsed/expanded rail state, persisted the same way as the theme. */
function useRailCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(RAIL_KEY) === '1');
  useEffect(() => {
    localStorage.setItem(RAIL_KEY, collapsed ? '1' : '0');
  }, [collapsed]);
  return [collapsed, () => setCollapsed((c) => !c)];
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
  const [collapsed, toggleRail] = useRailCollapsed();
  /** Nav labels only survive as tooltips once the rail is icon-only. */
  const tip = (label: string) => (collapsed ? label : undefined);

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
    <div className={`shell${collapsed ? ' rail-collapsed' : ''}`}>
      <aside className="side" id="app-sidebar">
        <div className="side-brand">
          <span className="mark">
            <Icon id="i-book" />
          </span>
          <b>
            Notebook<span>Hub</span>
          </b>
          <button
            className="rail-toggle"
            onClick={toggleRail}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
          >
            <Icon id={collapsed ? 'i-chev' : 'i-back'} />
          </button>
        </div>

        <div className="side-scroll">
          {/* LIBRARY */}
          <div className="nav-sec nav-lib">
            <div className="nav-label">Library</div>
            <NavLink
              to="/notebooklm"
              title={tip('NotebookLM')}
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
              title={tip('Collections')}
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
              title={tip('Ask')}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon id="i-chat" />
              <span className="n-label">Ask</span>
            </NavLink>
          </div>

          {/* FREE FORMS */}
          <div className="nav-sec">
            {collapsed ? (
              // The section label carries the link to the overview; with labels
              // hidden it becomes an icon item, or the page is unreachable.
              <NavLink
                to="/free-forms"
                end
                title="Free Forms"
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <Icon id="i-spark" />
                <span className="n-label">Free Forms</span>
              </NavLink>
            ) : (
              <button className="nav-label clickable" onClick={() => navigate('/free-forms')}>
                <span>Free Forms</span>
                <span className="lab-x">All ›</span>
              </button>
            )}
            {TYPES.map((t) => (
              <NavLink
                key={t.key}
                to={`/free-forms/${t.key}`}
                title={tip(t.label)}
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
              title={tip('Session')}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon id="i-gear" />
              <span className="n-label">Session</span>
            </NavLink>
            <NavLink
              to="/settings/diagnose"
              title={tip('Diagnose')}
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
