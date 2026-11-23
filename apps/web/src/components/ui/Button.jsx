import React from 'react';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import Icon from './Icon.jsx';

const VARIANT_CLASSES = {
  primary:
    'g-btn-primary bg-primary-solid hover:bg-primary-solid-hover text-on-primary border border-transparent',
  secondary:
    'g-btn-secondary bg-surface-2 hover:border-[var(--g-border-strong)] text-ink border border-line',
  tonal:
    'bg-secondary-container text-on-secondary-container border border-transparent hover:opacity-92',
  success:
    'bg-success-solid hover:bg-[var(--g-success-solid-hover)] text-on-success border border-transparent',
  warning:
    'bg-warning-solid hover:bg-[var(--g-warning-solid-hover)] text-on-warning border border-transparent',
  danger:
    'bg-danger-solid hover:bg-[var(--g-danger-solid-hover)] text-on-danger border border-transparent',
  dangerTonal:
    'bg-danger-bg text-danger border border-[var(--g-red-border)] hover:opacity-92',
  ghost:
    'bg-transparent hover:bg-surface-2 text-ink border border-transparent',
  dark:
    'bg-[var(--g-radio-bg)] text-[var(--g-radio-text)] border border-[var(--g-radio-signal-border)] hover:border-[var(--g-radio-signal-bright)]',
  whatsapp:
    'bg-[var(--g-whatsapp-solid)] text-[var(--g-on-whatsapp)] border border-transparent hover:opacity-95',
};

const SIZE_CLASSES = {
  sm: 'min-h-[44px] sm:min-h-[36px] px-3 py-1.5 text-xs gap-1.5',
  md: 'min-h-[44px] px-4 py-2 text-xs sm:text-sm gap-2',
  lg: 'min-h-[48px] px-5 py-2.5 text-sm gap-2',
};

/**
 * Tactile operational button with >=44px mobile touch target, explicit GPU-safe property transitions,
 * optical Liquid Glass highlights, and restrained typography.
 */
export default function Button({
  type = 'button',
  variant = 'primary',
  size = 'md',
  icon = '',
  iconFilled = false,
  loading = false,
  disabled = false,
  fullWidth = false,
  badge = null,
  className = '',
  children,
  ...rest
}) {
  const arch = useThemeArchitecture();
  const isDisabled = disabled || loading;
  const variantCls = VARIANT_CLASSES[variant] || VARIANT_CLASSES.primary;
  const sizeCls = SIZE_CLASSES[size] || SIZE_CLASSES.md;

  return (
    <button
      type={type}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center font-semibold rounded-[var(--g-radius-btn)] transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-150 ease-[var(--g-ease-out)] cursor-pointer select-none ${arch.motion.pressClass} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-ring-focus)] disabled:opacity-45 disabled:cursor-not-allowed ${variantCls} ${sizeCls} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      {...rest}
    >
      {loading ? (
        <Icon name="progress_activity" size={16} spin />
      ) : icon ? (
        <Icon name={icon} size={17} filled={iconFilled} />
      ) : null}
      {children}
      {badge !== null && badge !== undefined && badge !== 0 && (
        <span className="num-ltr text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--g-chip-count-bg)] text-current font-semibold">
          {badge}
        </span>
      )}
    </button>
  );
}
