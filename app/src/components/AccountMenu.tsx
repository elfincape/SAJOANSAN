import { Children, isValidElement, useId, useState } from 'react';
import type { ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
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
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <Menu.Root open={open} onOpenChange={setOpen}>
        <Menu.Trigger asChild>
          <button
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
        <AnimatePresence>
          {open ? (
            <Menu.Portal forceMount>
              <Menu.Content
                forceMount
                asChild
                align="end"
                sideOffset={8}
                collisionPadding={12}
              >
                <motion.div
                  id="app-account-menu"
                  aria-labelledby="app-account-toggle"
                  className="ean-account-menu"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                >
                  <motion.div
                    className="account-glass"
                    layoutId="account-surface"
                    style={{ borderRadius: 16 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                  />
                  {Children.map(actions, (child) =>
                    isValidElement(child) ? (
                      <Menu.Item asChild>{child}</Menu.Item>
                    ) : (
                      child
                    ),
                  )}
                  <Menu.Item asChild onSelect={onSignOut}>
                    <button disabled={disabled} type="button">
                      로그아웃
                    </button>
                  </Menu.Item>
                </motion.div>
              </Menu.Content>
            </Menu.Portal>
          ) : null}
        </AnimatePresence>
      </Menu.Root>
    </LayoutGroup>
  );
}
