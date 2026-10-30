import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { ChevronDown } from 'lucide-react';

export function AccountMenu({
  name,
  disabled,
  actions,
  onSignOut,
}: {
  name: string;
  disabled?: boolean;
  actions?: ReactNode;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const openRef = useRef(false);
  const restoreFocus = useRef(false);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const id = useId();
  function highlight(key: string) {
    return activeItem === key ? (
      <motion.span
        aria-hidden="true"
        className="account-item-highlight"
        layoutId="account-interaction"
        initial={false}
        style={{ borderRadius: 10 }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 540, damping: 42 }
        }
      />
    ) : null;
  }
  return (
    <LayoutGroup id={id}>
      <Menu.Root
        modal={false}
        open={open}
        onOpenChange={(value) => {
          openRef.current = value;
          if (value) restoreFocus.current = false;
          setOpen(value);
          if (!value) setActiveItem(null);
        }}
      >
        <Menu.Trigger asChild>
          <button
            ref={trigger}
            disabled={disabled}
            type="button"
            id="app-account-toggle"
            aria-controls={open ? 'app-account-menu' : undefined}
            aria-label="사용자 메뉴"
            title="사용자 메뉴"
          >
            {!open ? (
              <motion.span
                className="account-glass"
                layoutId="account-surface"
                style={{ borderRadius: 12 }}
              />
            ) : null}
            <span id="app-profile-label">{name}</span>
            <ChevronDown aria-hidden="true" size={18} strokeWidth={1.5} />
          </button>
        </Menu.Trigger>
        {open ? (
          <Menu.Portal>
            <Menu.Content
              asChild
              align="end"
              sideOffset={8}
              collisionPadding={12}
              onEscapeKeyDown={() => {
                restoreFocus.current = true;
                trigger.current?.focus({ preventScroll: true });
              }}
              onCloseAutoFocus={(event) => {
                if (
                  openRef.current ||
                  document.querySelector('[role="dialog"][aria-modal="true"]')
                ) {
                  event.preventDefault();
                } else if (restoreFocus.current) {
                  event.preventDefault();
                  trigger.current?.focus({ preventScroll: true });
                }
              }}
            >
              <motion.div
                id="app-account-menu"
                aria-labelledby="app-account-toggle"
                className="ean-account-menu account-interactive"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: reducedMotion ? 0 : 0.14 }}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    setActiveItem(null);
                }}
              >
                <motion.div
                  className="account-glass"
                  layoutId="account-surface"
                  style={{ borderRadius: 16 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                />
                {Children.map(actions, (child, index) =>
                  isValidElement<{ children?: ReactNode }>(child) ? (
                    <Menu.Item
                      asChild
                      onFocus={() => setActiveItem(`action-${index}`)}
                    >
                      {cloneElement(child, {
                        children: (
                          <>
                            {highlight(`action-${index}`)}
                            {child.props.children}
                          </>
                        ),
                      })}
                    </Menu.Item>
                  ) : (
                    child
                  ),
                )}
                <Menu.Item
                  asChild
                  onSelect={onSignOut}
                  onFocus={() => setActiveItem('sign-out')}
                >
                  <button disabled={disabled} type="button">
                    {highlight('sign-out')}
                    로그아웃
                  </button>
                </Menu.Item>
              </motion.div>
            </Menu.Content>
          </Menu.Portal>
        ) : null}
      </Menu.Root>
    </LayoutGroup>
  );
}
