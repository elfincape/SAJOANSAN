// Same-tab drafts only. Database saves still use the original revision and permissions.
const prefix = 'ean.workspace.v1:';
const readFailures = new Set<string>();
const warnings = new Map<string, string>();
const listeners = new Set<() => void>();
function warn(key: string, message: string) {
  if (!message && readFailures.has(key)) return;
  if ((warnings.get(key) ?? '') === message) return;
  if (message) warnings.set(key, message); else warnings.delete(key);
  queueMicrotask(() => listeners.forEach(listener => listener()));
}
export const subscribeWorkspaceStorage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const workspaceStorageWarning = (keys: string[]) => [...new Set(keys.map(key => warnings.get(key)).filter(Boolean))].join(' ');
export function createWorkspaceStore<T>(name: string, valid: (value: T) => boolean) {
  const memory = new Map<string, T | undefined>();
  const encoded = new Map<string, string>();
  const storageKey = (key: string) => prefix + name + ':' + key;
  return {
    storageKey,
    get(key: string): T | undefined {
      if (memory.has(key)) return memory.get(key);
      try {
        const raw = sessionStorage.getItem(storageKey(key));
        if (!raw) { memory.set(key, undefined); return; }
        const parsed = JSON.parse(raw);
        if (parsed?.version !== 1 || !parsed.value || !valid(parsed.value)) throw Error('Invalid workspace draft');
        memory.set(key, parsed.value); encoded.set(key, raw); return parsed.value;
      } catch {
        memory.set(key, undefined); readFailures.add(storageKey(key));
        warn(storageKey(key), '이 탭의 이전 작업을 복원하지 못했습니다. 저장된 서버 자료를 다시 확인하세요.');
      }
    },
    set(key: string, value: T) {
      memory.set(key, value);
      try {
        const raw = JSON.stringify({ version: 1, value });
        if (encoded.get(key) !== raw || warnings.has(storageKey(key))) sessionStorage.setItem(storageKey(key), raw);
        encoded.set(key, raw); warn(storageKey(key), '');
      } catch {
        encoded.delete(key);
        // Do not leave an older draft looking like the latest input after a quota failure.
        try { sessionStorage.removeItem(storageKey(key)); } catch { /* The warning remains. */ }
        warn(storageKey(key), '브라우저 초안 보관 실패 · 현재 화면의 입력만 유지됩니다. 새로고침 전에 서버에 저장하세요.');
      }
    },
    delete(key: string) {
      memory.set(key, undefined); encoded.delete(key);
      try { sessionStorage.removeItem(storageKey(key)); warn(storageKey(key), ''); }
      catch { warn(storageKey(key), '이전 초안을 지우지 못했습니다. 다시 열 때 서버 저장값과 비교하세요.'); }
    },
  };
}
