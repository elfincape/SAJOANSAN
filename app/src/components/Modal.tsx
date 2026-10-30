import { createContext, useContext, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, useAnimate, useReducedMotion } from 'motion/react';

const CloseContext = createContext<(afterClose?: () => void) => void>(() => {});

export function ModalClose({
  afterClose,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  afterClose?: () => void;
}) {
  const close = useContext(CloseContext);
  return (
    <button {...props} type="button" onClick={() => close(afterClose)}>
      {children}
    </button>
  );
}

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
  const surface = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
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
    if (source?.width && source.height && target?.width && target.height) {
      origin.current = {
        x: source.x + source.width / 2 - target.x - target.width / 2,
        y: source.y + source.height / 2 - target.y - target.height / 2,
        scaleX: source.width / target.width,
        scaleY: source.height / target.height,
        borderRadius: 20,
      };
    }
    if (surface.current && content.current && !reduced) {
      const layer = surface.current;
      void animate(
        layer,
        { ...origin.current, opacity: 0.7 },
        { duration: 0 },
      ).then(() => {
        if (!closingRef.current)
          void animate(
            layer,
            { x: 0, y: 0, scaleX: 1, scaleY: 1, borderRadius: 20, opacity: 1 },
            { type: 'spring', stiffness: 400, damping: 38 },
          );
      });
      void animate(
        content.current,
        { opacity: 1, filter: 'blur(0px)' },
        { duration: 0.2, delay: 0.08, ease: [0.2, 0.8, 0.2, 1] },
      );
    }
    scope.current?.focus({ preventScroll: true });
  }

  async function close(afterClose?: () => void) {
    if (!dismissable || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    if (!reduced && surface.current && content.current) {
      await Promise.all([
        animate(
          content.current,
          { opacity: 0, filter: 'blur(3px)' },
          { duration: 0.12 },
        ),
        animate(
          surface.current,
          { ...origin.current, opacity: 0 },
          { duration: 0.24, ease: [0.4, 0, 0.2, 1] },
        ),
      ]);
    }
    (afterClose ?? onClose)();
  }

  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
    '5xl': 'max-w-5xl',
  };
  return (
    <CloseContext.Provider
      value={(afterClose) => {
        void close(afterClose);
      }}
    >
      <Dialog.Root
        open
        onOpenChange={(open) => {
          if (!open) void close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay asChild>
            <motion.div
              className="ean-modal-overlay"
              initial={{ opacity: reduced ? 1 : 0 }}
              animate={{ opacity: closing ? 0 : 1 }}
              transition={{ duration: reduced ? 0 : 0.2 }}
            />
          </Dialog.Overlay>
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
              <div
                ref={scope}
                tabIndex={-1}
                className={`ean-modal-panel w-full ${widths[width]}`}
                style={{
                  position: 'relative',
                  borderRadius: 20,
                  background: 'transparent',
                  border: 0,
                  boxShadow: 'none',
                  overflow: 'visible',
                  maxHeight: 'none',
                }}
              >
                <motion.div
                  ref={surface}
                  aria-hidden="true"
                  className="ean-modal-surface"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 20,
                    background: 'var(--theme-panel)',
                    border: '1px solid var(--ean-rim)',
                    boxShadow: 'var(--ean-shadow)',
                    pointerEvents: 'none',
                  }}
                  initial={{ opacity: reduced ? 1 : 0 }}
                />
                <motion.div
                  ref={content}
                  style={{
                    position: 'relative',
                    borderRadius: 20,
                    maxHeight: 'calc(100dvh - 40px)',
                    overflow: 'auto',
                    overscrollBehavior: 'contain',
                    pointerEvents: closing ? 'none' : 'auto',
                  }}
                  initial={{
                    opacity: reduced ? 1 : 0,
                    filter: reduced ? 'none' : 'blur(3px)',
                  }}
                >
                  <Dialog.Title className="sr-only">{label}</Dialog.Title>
                  {children}
                </motion.div>
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    </CloseContext.Provider>
  );
}
