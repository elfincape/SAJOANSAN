import { useRef, useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import './center-switcher.css';

export function CenterSwitcher({
  value,
  options,
  disabled = false,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const switching = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  async function change(next: string) {
    if (disabled || switching.current || next === value) return;
    switching.current = true;
    setOpen(false);
    // Any unsaved-work dialog should return focus to the persistent trigger.
    trigger.current?.focus({ preventScroll: true });
    setPending(true);
    try {
      await onChange(next);
    } finally {
      switching.current = false;
      setPending(false);
    }
  }
  return (
    <div id="center-switcher" data-app-center="true">
      <Menu.Root
        open={open}
        onOpenChange={(next) => {
          if (!switching.current || !next) setOpen(next);
        }}
        modal={false}
      >
        <Menu.Trigger asChild>
          <button
            ref={trigger}
            id="app-center-select"
            className="workspace-center-trigger"
            type="button"
            aria-label="작업 센터"
            disabled={disabled}
            aria-disabled={disabled || pending}
            aria-busy={pending}
          >
            <span>
              {options.find((option) => option.value === value)?.label ??
                '센터 선택'}
            </span>
            <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            id="workspace-center-menu"
            className="workspace-center-menu"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            aria-label="센터 선택"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (!document.querySelector('[role="dialog"][aria-modal="true"]'))
                trigger.current?.focus({ preventScroll: true });
            }}
          >
            <Menu.RadioGroup
              value={value}
              onValueChange={(next) => void change(next)}
            >
              {options.map((option) => (
                <Menu.RadioItem
                  key={option.value}
                  value={option.value}
                  className="workspace-center-option"
                  disabled={disabled || pending}
                >
                  <span className="workspace-center-check">
                    <Menu.ItemIndicator>
                      <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                    </Menu.ItemIndicator>
                  </span>
                  <span>{option.label}</span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
