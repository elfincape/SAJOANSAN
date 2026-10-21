import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
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
    outside = useRef(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
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
      onCancel={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
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
          onClose();
        outside.current = false;
      }}
    >
      {children}
    </dialog>
  );
}
