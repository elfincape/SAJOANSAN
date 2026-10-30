import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import '../styles/rail-tooltip.css';

export function RailTooltip({ sidebar, expanded }: {
  sidebar: RefObject<HTMLDialogElement | null>;
  expanded: boolean;
}) {
  const bubble = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [label, setLabel] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const rail = sidebar.current;
    if (!rail || expanded) { setLabel(null); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let target: HTMLElement | null = null;
    let dismissed = false;
    const cancel = () => clearTimeout(timer);
    const hide = () => { cancel(); clearTimeout(hideTimer.current); setLabel(null); };
    const show = (element: HTMLElement) => {
      clearTimeout(hideTimer.current);
      if (element === target) return;
      hide(); target = element; dismissed = false;
      timer = setTimeout(() => {
        if (dismissed || !element.isConnected) return;
        const rect = element.getBoundingClientRect();
        setLabel({ text: element.getAttribute('aria-label') || '', x: rect.right + 10, y: rect.top + rect.height / 2 });
      }, 250);
    };
    const find = (event: Event) => event.target instanceof Element
      ? event.target.closest<HTMLElement>('.app-rail-link, .app-rail-heading button') : null;
    const enter = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerType === 'touch') return;
      const element = find(event);
      if (element && !element.matches(':disabled')) show(element);
    };
    const leave = (event: Event) => {
      const next = (event as FocusEvent).relatedTarget;
      if (next instanceof Node && (target?.contains(next) || bubble.current?.contains(next))) return;
      if (event.type === 'pointerout' && target === document.activeElement) return;
      cancel(); target = null;
      hideTimer.current = setTimeout(hide, 100);
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !target) return;
      dismissed = true; target = null; hide();
      event.stopPropagation();
    };
    rail.addEventListener('pointerover', enter);
    rail.addEventListener('focusin', enter);
    rail.addEventListener('pointerout', leave);
    rail.addEventListener('focusout', leave);
    rail.addEventListener('click', hide);
    document.addEventListener('keydown', dismiss, true);
    window.addEventListener('resize', hide);
    return () => {
      hide();
      rail.removeEventListener('pointerover', enter);
      rail.removeEventListener('focusin', enter);
      rail.removeEventListener('pointerout', leave);
      rail.removeEventListener('focusout', leave);
      rail.removeEventListener('click', hide);
      document.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('resize', hide);
    };
  }, [expanded, sidebar]);
  return label && !expanded ? createPortal(
    <div ref={bubble} className="ean-rail-tooltip" role="tooltip"
      style={{ left: label.x, top: label.y }}
      onPointerEnter={() => clearTimeout(hideTimer.current)}
      onPointerLeave={() => setLabel(null)}>{label.text}</div>, document.body,
  ) : null;
}
