/**
 * Light/dark theme — persisted to localStorage (`nh-theme`) and applied to
 * <body data-theme="…">, which is where the design system's tokens live.
 */
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'nh-theme';

export function getStoredTheme(): Theme {
  const t = localStorage.getItem(KEY);
  return t === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.body.dataset.theme = theme;
}

/** Apply the stored theme as early as possible (called once at boot). */
export function initTheme(): void {
  applyTheme(getStoredTheme());
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);
  const toggle = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  return [theme, toggle];
}
