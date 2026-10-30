import { motion } from 'motion/react';
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
      <motion.svg
        aria-hidden="true"
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        animate={{ rotate: dark ? 180 : 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 28 }}
      >
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
          </>
        ) : (
          <path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" />
        )}
      </motion.svg>
    </button>
  );
}
