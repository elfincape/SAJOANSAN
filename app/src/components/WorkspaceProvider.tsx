import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import '../styles/common.css';
import '../styles/workspace-ui.css';
import '../styles/admin-workspace.css';
import '../styles/portal-theme.css';
import '../styles/theme.css';
import '../styles/ean.css';
import '../styles/workspace-tables.css';
import '../styles/workspace-dialogs.css';

const storageKey = 'sajo.appearance.v1';
type Theme = 'light' | 'dark';
const savedTheme = (): Theme => {
  try {
    return localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};
const Appearance = createContext<{ theme: Theme; toggle: () => void } | null>(
  null,
);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(savedTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setTheme(savedTheme());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* The current page still changes. */
    }
  }
  return (
    <Appearance.Provider value={{ theme, toggle }}>
      <MotionConfig
        reducedMotion="user"
        transition={{ type: 'spring', stiffness: 400, damping: 38 }}
      >
        {children}
      </MotionConfig>
    </Appearance.Provider>
  );
}
export function useAppearance() {
  const value = useContext(Appearance);
  if (!value) throw new Error('WorkspaceProvider가 필요합니다.');
  return value;
}
