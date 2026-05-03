import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { hasSession, clearSession } from './lib/session-store';
import SessionGate from './components/SessionGate';
import SessionPage from './pages/SessionPage';
import NotebooksPage from './pages/NotebooksPage';
import NotebookDetailPage from './pages/NotebookDetailPage';
import GeneratePage from './pages/GeneratePage';
import AnalyzePage from './pages/AnalyzePage';
import ChatPage from './pages/ChatPage';
import DiagnosePage from './pages/DiagnosePage';

interface NavItem {
  to: string;
  label: string;
  group: string;
}

const NAV: NavItem[] = [
  { to: '/library', label: 'Notebooks', group: 'Library' },
  { to: '/generate/audio', label: 'Audio podcast', group: 'Generate' },
  { to: '/generate/report', label: 'Report', group: 'Generate' },
  { to: '/generate/video', label: 'Video', group: 'Generate' },
  { to: '/generate/quiz', label: 'Quiz', group: 'Generate' },
  { to: '/generate/flashcards', label: 'Flashcards', group: 'Generate' },
  { to: '/generate/infographic', label: 'Infographic', group: 'Generate' },
  { to: '/generate/slides', label: 'Slides', group: 'Generate' },
  { to: '/generate/data-table', label: 'Data table', group: 'Generate' },
  { to: '/analyze', label: 'Analyze', group: 'Ask' },
  { to: '/chat', label: 'Chat', group: 'Ask' },
  { to: '/session', label: 'Session', group: 'Settings' },
  { to: '/diagnose', label: 'Diagnose', group: 'Settings' },
];

function groupBy(items: NavItem[]): Record<string, NavItem[]> {
  const out: Record<string, NavItem[]> = {};
  for (const item of items) {
    out[item.group] ??= [];
    out[item.group].push(item);
  }
  return out;
}

export default function App() {
  const [authed, setAuthed] = useState<boolean>(hasSession());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  if (!authed) {
    return <SessionGate onSession={() => setAuthed(true)} />;
  }

  const groups = groupBy(NAV);

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 transform border-r border-slate-200 bg-white transition-transform md:static md:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center border-b border-slate-200 px-4">
          <span className="text-lg font-semibold text-brand-700">NotebookLM GUI</span>
        </div>
        <nav className="space-y-6 px-3 py-4 text-sm">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {group}
              </div>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        `block rounded-md px-2 py-1.5 ${
                          isActive
                            ? 'bg-brand-50 text-brand-700'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="pt-2">
            <button
              type="button"
              className="btn-ghost w-full justify-start text-rose-600 hover:bg-rose-50"
              onClick={() => {
                if (confirm('Clear the saved session from this browser?')) {
                  clearSession();
                  setAuthed(false);
                }
              }}
            >
              Sign out (clear session)
            </button>
          </div>
        </nav>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden">
          <span className="font-semibold text-brand-700">NotebookLM GUI</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setMobileNavOpen((v) => !v)}
          >
            Menu
          </button>
        </header>
        <main className="flex-1 p-4 md:p-8">
          <Routes>
            <Route path="/" element={<Navigate to="/library" replace />} />
            <Route path="/library" element={<NotebooksPage />} />
            <Route path="/library/:id" element={<NotebookDetailPage />} />
            <Route path="/generate/:kind" element={<GeneratePage />} />
            <Route path="/analyze" element={<AnalyzePage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:id" element={<ChatPage />} />
            <Route path="/session" element={<SessionPage />} />
            <Route path="/diagnose" element={<DiagnosePage />} />
            <Route path="*" element={<Navigate to="/library" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
