import { useContext, useEffect, useRef, useState } from 'react';
import { PortalStore } from './PortalStore';
import type { ReactNode } from 'react';
import '../../styles/portal-dialog-motion.css';

export function closePortalDialog(event: React.MouseEvent<HTMLButtonElement>) {
  event.currentTarget.closest('dialog')?.dispatchEvent(
    new Event('cancel', { cancelable: true }),
  );
}
export function PortalDialog({
  id,
  label,
  children,
  onClose,
  className = 'parent-task-dialog',
}: {
  id: string;
  label: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    outside = useRef(false),
    opener = useRef<HTMLElement | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    closingRef = useRef(false),
    [closing, setClosing] = useState(false),
    portal = useContext(PortalStore);
  const busy = portal?.state.busy ?? false;
  const latest = useRef({ busy, onClose });
  latest.current = { busy, onClose };
  function requestClose() {
    if (latest.current.busy || closingRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      latest.current.onClose();
      return;
    }
    closingRef.current = true;
    setClosing(true);
    timer.current = setTimeout(() => {
      if (latest.current.busy) {
        closingRef.current = false;
        setClosing(false);
      } else latest.current.onClose();
    }, 220);
  }
  useEffect(() => {
    const element = dialog.current;
    if (!opener.current && document.activeElement instanceof HTMLElement)
      opener.current = document.activeElement;
    element?.showModal();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      element?.close();
      if (opener.current?.isConnected)
        queueMicrotask(() => {
          const target = opener.current;
          const openDialog = document.querySelector('dialog:modal');
          if (
            target?.isConnected &&
            (!openDialog || openDialog.contains(target))
          )
            target.focus({ preventScroll: true });
        });
    };
  }, []);
  function beyond(event: React.MouseEvent | React.PointerEvent) {
    const bounds = dialog.current!.getBoundingClientRect();
    return (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    );
  }
  return (
    <dialog
      ref={dialog}
      id={id}
      className={className}
      aria-label={label}
      data-portal-motion
      data-closing={closing || undefined}
      onCancel={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (event.target === event.currentTarget) requestClose();
      }}
      onPointerDown={(event) => {
        outside.current = event.target === event.currentTarget && beyond(event);
      }}
      onClick={(event) => {
        if (
          outside.current &&
          event.target === event.currentTarget &&
          beyond(event)
        )
          requestClose();
        outside.current = false;
      }}
    >
      {children}
      {portal?.state.messageError && portal.state.message ? (
        <div className="portal-dialog-error" role="alert">
          <span>{portal.state.message}</span>
          <button
            type="button"
            aria-label="오류 메시지 닫기"
            onClick={() => portal.message('')}
          >
            닫기
          </button>
        </div>
      ) : null}
    </dialog>
  );
}
