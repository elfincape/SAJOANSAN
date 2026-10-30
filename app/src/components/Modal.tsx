import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, useAnimate, useReducedMotion } from 'motion/react';

export function Modal({
  children,
  onClose,
  label = '작업 창',
  width = 'md',
  dismissable = true,
}: {
  children: ReactNode;
  onClose: () => void;
  label?: string;
  width?: 'sm' | 'md' | 'lg' | 'xl' | '5xl';
  dismissable?: boolean;
}) {
  const previous = useRef<HTMLElement | null>(null);
  const [scope, animate] = useAnimate();
  const reduced = useReducedMotion();
  const [closing, setClosing] = useState(false);
  const origin = useRef({
    x: 0,
    y: 12,
    scaleX: 0.96,
    scaleY: 0.96,
    borderRadius: 20,
  });
  function enter(event: Event) {
    event.preventDefault();
    const active = document.activeElement;
    previous.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    const target = scope.current?.getBoundingClientRect();
    const source = previous.current?.getBoundingClientRect();
    if (source?.width && source.height && target?.width && target.height)
      origin.current = {
        x: source.x + source.width / 2 - target.x - target.width / 2,
        y: source.y + source.height / 2 - target.y - target.height / 2,
        scaleX: Math.max(0.12, source.width / target.width),
        scaleY: Math.max(0.08, source.height / target.height),
        borderRadius: 28,
      };
    if (scope.current && !reduced) {
      void animate(scope.current, origin.current, { duration: 0 });
      void animate(
        scope.current,
        { x: 0, y: 0, scaleX: 1, scaleY: 1, borderRadius: 20 },
        { type: 'spring', stiffness: 400, damping: 38 },
      );
    }
    scope.current?.focus({ preventScroll: true });
  }
  async function close() {
    if (!dismissable || closing) return;
    setClosing(true);
    if (!reduced && scope.current)
      await animate(
        scope.current,
        { ...origin.current, opacity: 0 },
        { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
      );
    onClose();
  }
  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
    '5xl': 'max-w-5xl',
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ean-modal-overlay" />
        <div id="modal-root" className="ean-modal-position">
          <Dialog.Content
            asChild
            aria-modal="true"
            aria-describedby={undefined}
            onOpenAutoFocus={enter}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (previous.current?.isConnected)
                previous.current.focus({ preventScroll: true });
            }}
            onEscapeKeyDown={(event) => {
              if (!dismissable) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (!dismissable) event.preventDefault();
            }}
          >
            <motion.div
              ref={scope}
              tabIndex={-1}
              className={`ean-modal-panel w-full ${widths[width]}`}
              style={{ borderRadius: 20 }}
            >
              <Dialog.Title className="sr-only">{label}</Dialog.Title>
              {children}
            </motion.div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
