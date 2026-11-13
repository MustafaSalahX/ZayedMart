import React from 'react';

const TONE_CLASSES = {
  neutral: 'bg-[var(--g-surface-variant)] text-[var(--g-muted)] border border-[var(--g-border)]',
  primary: 'bg-[var(--g-primary-container)] text-[var(--g-on-primary-container)]',
  secondary: 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]',
  success: 'bg-[var(--g-green-bg)] text-[var(--g-green)]',
  warning: 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]',
  orange: 'bg-[var(--g-orange-bg)] text-[var(--g-orange-text)] border border-[var(--g-orange-border)]/40',
  danger: 'bg-[var(--g-red-bg)] text-[var(--g-red)]',
  purple: 'bg-[var(--g-purple-bg)] text-[var(--g-purple)]',
};

/**
 * Semantic status pill using CSS design tokens and Material Symbols (no emojis).
 */
export default function Badge({
  tone = 'neutral',
  icon = '',
  iconFilled = false,
  dot = false,
  pulse = false,
  numeric = false,
  className = '',
  children,
}) {
  const toneCls = TONE_CLASSES[tone] || TONE_CLASSES.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold leading-tight shrink-0 ${toneCls} ${
        numeric ? 'num-ltr' : ''
      } ${className}`}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full bg-current shrink-0 ${
            pulse ? 'animate-ping' : ''
          }`}
        />
      )}
      {icon && <span className={`ms-icon text-sm ${iconFilled ? 'filled' : ''}`}>{icon}</span>}
      <span>{children}</span>
    </span>
  );
}
