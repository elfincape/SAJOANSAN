import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import '../styles/dialog-frame.css';

const ActionsHost = createContext<HTMLElement | null | undefined>(undefined);
/** One scroll owner and a separate action row for both native and Radix dialogs. */
export function DialogFrame({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = frame.current?.closest('dialog');
    // PortalDialog already owns its busy-aware outside-click lifecycle.
    if (!dialog || dialog.hasAttribute('data-portal-motion')) return;
    let outside = false;
    const beyond = (event: PointerEvent | MouseEvent) => {
      const bounds = dialog.getBoundingClientRect();
      return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
    };
    const down = (event: PointerEvent) => { outside = beyond(event); };
    const click = (event: MouseEvent) => {
      if (outside && beyond(event)) dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      outside = false;
    };
    dialog.addEventListener('pointerdown', down); dialog.addEventListener('click', click);
    return () => { dialog.removeEventListener('pointerdown', down); dialog.removeEventListener('click', click); };
  }, []);
  return <ActionsHost.Provider value={host}><div className="ean-dialog-frame" ref={frame}>
    <div className="ean-dialog-body">{children}</div>
    <div className="ean-dialog-footer" ref={setHost} />
  </div></ActionsHost.Provider>;
}
export function DialogActions({ children, className = '' }: { children: ReactNode; className?: string }) {
  const host = useContext(ActionsHost);
  const actions = <div className={`ean-dialog-actions ${className}`}>{children}</div>;
  return host === undefined ? actions : host ? createPortal(actions, host) : null;
}
