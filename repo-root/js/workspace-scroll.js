let library;

export function mountWorkspaceScroll(main) {
  if (main.id === 'app') return;
  const desktop = matchMedia('(min-width: 1001px) and (hover: hover) and (pointer: fine)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let instance;
  let active = true;

  function eligible() {
    return active && desktop.matches && !reducedMotion.matches && !document.hidden &&
      getComputedStyle(document.documentElement).overflowY !== 'hidden' &&
      document.documentElement.scrollHeight > innerHeight + 1;
  }

  function refresh() {
    if (!eligible()) {
      instance?.destroy();
      instance = undefined;
      return;
    }
    library ||= Promise.all([import('lenis'), import('lenis/dist/lenis.css')]);
    library.then(([{ default: Lenis }]) => {
      if (instance || !eligible()) return;
      instance = new Lenis({
        autoRaf: true,
        lerp: 0.2,
        syncTouch: false,
        allowNestedScroll: true,
        stopInertiaOnNavigate: true,
        prevent: (node) => Boolean(node.closest(
          '#app-sidebar, [role="dialog"], dialog, input, textarea, select, [contenteditable="true"], iframe, .ag-root',
        )),
        virtualScroll: ({ event }) => {
          const modal = [...document.querySelectorAll('[aria-modal="true"], dialog:modal')]
            .some((element) => element.checkVisibility());
          if (event.ctrlKey || event.metaKey || event.shiftKey || modal) {
            instance?.reset();
            return false;
          }
        },
      });
    }).catch(() => {
      // Static-file previews retain native scrolling when package imports are unavailable.
    });
  }

  const sizes = new ResizeObserver(refresh);
  const observe = () => {
    sizes.observe(main);
    sizes.observe(document.body);
  };
  observe();
  desktop.addEventListener('change', refresh);
  reducedMotion.addEventListener('change', refresh);
  document.addEventListener('visibilitychange', refresh);
  document.addEventListener('pointerdown', () => instance?.reset(), true);
  document.addEventListener('keydown', () => instance?.reset(), true);
  addEventListener('pagehide', () => {
    active = false;
    sizes.disconnect();
    refresh();
  });
  addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    active = true;
    observe();
    refresh();
  });
  refresh();
}
