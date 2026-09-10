import fs from 'node:fs';
import vm from 'node:vm';

export function loadCoupangPage(overrides = {}) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        value: '', textContent: '', innerHTML: '', disabled: false,
        classList: { add() {}, remove() {}, toggle() {} },
        listeners: {}, addEventListener(event, handler) { this.listeners[event] = handler; },
        querySelectorAll() { return []; }, removeAttribute() {}
      });
      return elements.get(id);
    },
    addEventListener() {}, querySelectorAll() { return []; }
  };
  const source = fs.readFileSync(new URL('../../repo-root/admin/coupang-entry.html', import.meta.url), 'utf8');
  for (const [, id] of source.matchAll(/\bid="([^"]+)"/g)) document.getElementById(id);
  const script = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const context = vm.createContext({
    document, window: {}, console: { log() {}, warn() {}, error() {} },
    fetch: () => new Promise(() => {}), setTimeout() {}, clearTimeout() {},
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, ...overrides
  });
  vm.runInContext(script, context);
  return { context, elements, evaluate: code => vm.runInContext(code, context) };
}
