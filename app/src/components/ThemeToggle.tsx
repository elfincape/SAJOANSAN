import { useEffect, useState } from 'react';

const storageKey = 'sajo.appearance.v1';
const savedTheme = () => {
  try { return localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
};

export function ThemeToggle({ floating = false, disabled = false }: { floating?: boolean; disabled?: boolean }) {
  const [theme, setTheme] = useState(savedTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setTheme(savedTheme());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const dark = theme === 'dark';
  const label = dark ? '라이트 모드로 전환' : '다크 모드로 전환';
  return <button disabled={disabled} id="theme-toggle" type="button" className={`theme-toggle btn btn-ghost${floating ? ' theme-toggle-floating' : ''}`} title={label} aria-label={label} aria-pressed={dark} onClick={() => {
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem(storageKey, next); } catch { /* Current page still changes. */ }
  }}>{dark ? '☀' : '☾'}</button>;
}
