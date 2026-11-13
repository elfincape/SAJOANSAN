import { Fragment, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { subscribeWorkspaceStorage, workspaceStorageWarning } from '../lib/workspace-session';
import { useAdminPage } from './AdminPage';

export function WorkspaceDraftStatus({ storageKeys, dirty = false }: { storageKeys: string[]; dirty?: boolean }) {
  const warning = useSyncExternalStore(subscribeWorkspaceStorage, () => workspaceStorageWarning(storageKeys), () => '');
  if (!warning && !dirty) return null;
  return <p className="editor-status" data-workspace-draft role={warning ? 'alert' : 'status'} aria-live="polite">{warning || '이 탭에 초안 보관 · 서버 미저장'}</p>;
}
export function WorkspaceSessionScope({ children }: { children: ReactNode }) {
  const { profile, center } = useAdminPage();
  return <Fragment key={profile.id + ':' + center.code}>{children}</Fragment>;
}
