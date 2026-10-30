import { motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import { useAppearance } from './WorkspaceProvider';

export function ThemeToggle({
  floating = false,
  disabled = false,
}: {
  floating?: boolean;
  disabled?: boolean;
}) {
  const { theme, toggle } = useAppearance();
  const dark = theme === 'dark';
  const label = dark ? '라이트 모드로 전환' : '다크 모드로 전환';
  return (
    <button
      disabled={disabled}
      id="theme-toggle"
      type="button"
      className={`theme-toggle btn btn-ghost${floating ? ' theme-toggle-floating' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={dark}
      onClick={toggle}
    >
      <motion.span
        aria-hidden="true"
        style={{ display: 'inline-flex' }}
        animate={{ rotate: dark ? 180 : 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 28 }}
      >
        {dark ? (
          <Sun aria-hidden="true" size={18} strokeWidth={1.5} />
        ) : (
          <Moon aria-hidden="true" size={18} strokeWidth={1.5} />
        )}
      </motion.span>
    </button>
  );
}
