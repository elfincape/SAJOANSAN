import { useEffect } from 'react';
import type Lenis from 'lenis';
const load = () =>
  Promise.all([import('lenis'), import('lenis/dist/lenis.css')]);
let library: ReturnType<typeof load> | undefined;
export function useWorkspaceScroll(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const desktop = matchMedia(
        '(min-width: 1001px) and (hover: hover) and (pointer: fine)',
      ),
      reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let instance: Lenis | undefined,
      active = true;
    function eligible() {
      return (
        active &&
        desktop.matches &&
        !reducedMotion.matches &&
        !document.hidden &&
        getComputedStyle(document.documentElement).overflowY !== 'hidden' &&
        document.documentElement.scrollHeight > innerHeight + 1
      );
    }
    function refresh() {
      if (!eligible()) {
        instance?.destroy();
        instance = undefined;
        return;
      }
      library ??= load();
      void library
        .then(([{ default: Lenis }]) => {
          if (instance || !eligible()) return;
          instance = new Lenis({
            autoRaf: true,
            lerp: 0.2,
            syncTouch: false,
            allowNestedScroll: true,
            stopInertiaOnNavigate: true,
            prevent: (node) =>
              Boolean(
                node.closest(
                  '#app-sidebar, [role="dialog"], dialog, input, textarea, select, [contenteditable="true"], iframe, .ag-root',
                ),
              ),
            virtualScroll: ({ event }) => {
              const modal = [
                ...document.querySelectorAll(
                  '[aria-modal="true"], dialog:modal',
                ),
              ].some((element) => element.checkVisibility());
              if (event.ctrlKey || event.metaKey || event.shiftKey || modal) {
                reset();
                return false;
              }
              return true;
            },
          });
        })
        .catch(() => {});
    }
    const sizes = new ResizeObserver(refresh),
      observe = () => {
        sizes.observe(document.body);
        sizes.observe(document.documentElement);
      },
      // Keep the existing reset operation of the pinned Lenis version.
      reset = () =>
        (instance as unknown as { reset(): void } | undefined)?.reset(),
      hide = () => {
        active = false;
        sizes.disconnect();
        refresh();
      },
      show = (event: PageTransitionEvent) => {
        if (event.persisted) {
          active = true;
          observe();
          refresh();
        }
      };
    observe();
    desktop.addEventListener('change', refresh);
    reducedMotion.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    document.addEventListener('pointerdown', reset, true);
    document.addEventListener('keydown', reset, true);
    addEventListener('pagehide', hide);
    addEventListener('pageshow', show);
    refresh();
    return () => {
      active = false;
      sizes.disconnect();
      instance?.destroy();
      desktop.removeEventListener('change', refresh);
      reducedMotion.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
      document.removeEventListener('pointerdown', reset, true);
      document.removeEventListener('keydown', reset, true);
      removeEventListener('pagehide', hide);
      removeEventListener('pageshow', show);
    };
  }, [enabled]);
}
