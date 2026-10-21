import { useEffect, useSyncExternalStore } from 'react';

export interface WorkspaceAction {
  id: string;
  title: string;
  description?: string;
  run: () => void;
  disabled?: boolean;
}
const listeners = new Set<() => void>();
const owners = new Map<symbol, WorkspaceAction[]>();
let snapshot: WorkspaceAction[] = [];
function publish() {
  snapshot = [...owners.values()].flat().filter(action => !action.disabled);
  for (const listener of listeners) listener();
}
export function useWorkspaceActions(actions: WorkspaceAction[]) {
  useEffect(() => {
    const owner = Symbol();
    owners.set(owner, actions);
    publish();
    return () => { owners.delete(owner); publish(); };
  }, [actions]);
}
export function useContextualActions() {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => snapshot,
  );
}
