import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, useAnimate, useReducedMotion } from 'motion/react';

const CloseContext = createContext<(action?: () => void) => void>(() => {});

export function ModalClose({
  onAction,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  onAction?: () => void;
}) {
  const close = useContext(CloseContext);
  return (
    <button {...props} type="button" onClick={() => close(onAction)}>
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
  const [opener] = useState(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body
      ? active
      : null;
  });
  const previous = useRef(opener);
  const fallbackFocus = useRef(
    opener?.closest('#app-account-menu')
      ? document.getElementById('app-account-toggle')
      : null,
  );
  const [scope, animate] = useAnimate();
  const surface = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const mounted = useRef(true);
  const openingAnimations = useRef<{ stop: () => void }[]>([]);
  useEffect(() => {
    mounted.current = true;
    closingRef.current = false;
    return () => {
      mounted.current = false;
      closingRef.current = true;
      openingAnimations.current.forEach((animation) => animation.stop());
    };
  }, []);
  const origin = useRef({
    x: 0,
    y: 6,
    scaleX: 0.985,
    scaleY: 0.985,
    borderRadius: 20,
  });

  function enter(event: Event) {
    event.preventDefault();
    if (surface.current && content.current && !reduced) {
      const layer = surface.current;
      const opening = animate(
        layer,
        { ...origin.current, opacity: 0.7 },
        { duration: 0 },
      );
      openingAnimations.current.push(opening);
      void opening.then(() => {
        if (!closingRef.current)
          openingAnimations.current.push(
            animate(
              layer,
              {
                x: 0,
                y: 0,
                scaleX: 1,
                scaleY: 1,
                borderRadius: 20,
                opacity: 1,
              },
              { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
            ),
          );
      });
    }
    scope.current?.focus({ preventScroll: true });
  }

  async function close(action?: () => void) {
    if (!dismissable || closingRef.current) return;
    closingRef.current = true;
    openingAnimations.current.forEach((animation) => animation.stop());
    openingAnimations.current = [];
    if (action) {
      action();
      return;
    }
    setClosing(true);
    if (content.current) content.current.inert = true;
    scope.current?.focus({ preventScroll: true });
    if (!reduced && surface.current && content.current) {
      await Promise.all([
        animate(content.current, { opacity: 0 }, { duration: 0.12 }),
        animate(
          surface.current,
          { ...origin.current, opacity: 0 },
          { duration: 0.16, ease: [0.4, 0, 0.2, 1] },
        ),
      ]);
    }
    if (mounted.current) onClose();
  }

  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
    '5xl': 'max-w-5xl',
  };
  const maxWidths = {
    sm: '24rem',
    md: '28rem',
    lg: '32rem',
    xl: '42rem',
    '5xl': '64rem',
  };
  return (
    <CloseContext.Provider
      value={(action) => {
        void close(action);
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
                if (fallbackFocus.current?.isConnected)
                  fallbackFocus.current.focus({ preventScroll: true });
                else if (previous.current?.isConnected)
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
                  width: '100%',
                  maxWidth: maxWidths[width],
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
                    opacity: 1,
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
