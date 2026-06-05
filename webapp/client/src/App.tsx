import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { hasSession } from './lib/session-store';
import { IconSprite } from './components/Icon';
import { ToastHost } from './lib/toast';
import SessionGate from './components/SessionGate';
import AppShell from './components/AppShell';
import NotebookLMPage from './pages/nh/NotebookLMPage';
import NotebookDetailPage from './pages/nh/NotebookDetailPage';
import CollectionsPage from './pages/nh/CollectionsPage';
import CollectionDetailPage from './pages/nh/CollectionDetailPage';
import FreeFormsOverviewPage from './pages/nh/FreeFormsOverviewPage';
import FreeFormTypePage from './pages/nh/FreeFormTypePage';
import SettingsPage from './pages/nh/SettingsPage';

export default function App() {
  const [authed, setAuthed] = useState<boolean>(hasSession());

  return (
    <>
      <IconSprite />
      <ToastHost />
      {!authed ? (
        <SessionGate onSession={() => setAuthed(true)} />
      ) : (
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/notebooklm" replace />} />
            <Route path="/notebooklm" element={<NotebookLMPage />} />
            <Route path="/notebooklm/:id" element={<NotebookDetailPage />} />
            <Route path="/collections" element={<CollectionsPage />} />
            <Route path="/collections/:id" element={<CollectionDetailPage />} />
            <Route path="/free-forms" element={<FreeFormsOverviewPage />} />
            <Route path="/free-forms/:type" element={<FreeFormTypePage />} />
            <Route path="/settings/session" element={<SettingsPage tab="session" />} />
            <Route path="/settings/diagnose" element={<SettingsPage tab="diagnose" />} />
            <Route path="*" element={<Navigate to="/notebooklm" replace />} />
          </Route>
        </Routes>
      )}
    </>
  );
}
