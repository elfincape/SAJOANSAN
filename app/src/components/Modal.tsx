import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function Modal({ children, onClose, label = '작업 창', width = 'md', dismissable = true }: {
  children: ReactNode; onClose: () => void; label?: string; width?: 'sm' | 'md' | 'lg' | 'xl' | '5xl'; dismissable?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const backdropPointer = useRef(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    const frame = requestAnimationFrame(() => { setVisible(true); panel.current?.focus(); });
    return () => {
      cancelAnimationFrame(frame);
      element?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl', '5xl': 'max-w-5xl' };
  return <div id="modal-root"><dialog ref={dialog} role="dialog" aria-modal="true" aria-label={label}
    className={`workspace-modal fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-150${visible ? '' : ' opacity-0'}`}
    onPointerDown={event => { backdropPointer.current = event.target === event.currentTarget; }}
    onClick={event => { if (backdropPointer.current && event.target === event.currentTarget && dismissable) onClose(); backdropPointer.current = false; }}
    onCancel={event => { event.preventDefault(); if (dismissable) onClose(); }}>
    <div ref={panel} tabIndex={-1} className={`w-full ${widths[width]} mx-4 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl transition-transform duration-150${visible ? '' : ' scale-95'}`}>
      {children}
    </div>
  </dialog></div>;
}
