import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function Modal({ children, onClose, label = '작업 창', width = 'md', dismissable = true }: {
  children: ReactNode; onClose: () => void; label?: string; width?: 'sm' | 'md' | 'lg' | 'xl' | '5xl'; dismissable?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => { setVisible(true); panel.current?.focus(); });
    return () => { cancelAnimationFrame(frame); if (previous?.isConnected) previous.focus(); };
  }, []);
  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl', '5xl': 'max-w-5xl' };
  return <div id="modal-root"><div role="dialog" aria-modal="true" aria-label={label} className={`fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-150${visible ? '' : ' opacity-0'}`} onClick={() => { if (dismissable) onClose(); }} onKeyDown={event => {
    if (event.key === 'Escape' && dismissable) { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>('a[href],button,input:not([type="hidden"]),select,textarea,[tabindex="0"]')].filter(item => !('disabled' in item && item.disabled) && item.getClientRects().length);
    if (!items.length) { event.preventDefault(); panel.current.focus(); return; }
    if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === panel.current)) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && (document.activeElement === items.at(-1) || document.activeElement === panel.current)) { event.preventDefault(); items[0].focus(); }
  }}><div ref={panel} tabIndex={-1} className={`w-full ${widths[width]} mx-4 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl transition-transform duration-150${visible ? '' : ' scale-95'}`} onClick={event => event.stopPropagation()}>{children}</div></div></div>;
}
