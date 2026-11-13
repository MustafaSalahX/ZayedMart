import React from 'react';

const VARIANT_CLASSES = {
  primary:
    'bg-[var(--g-primary-solid)] hover:bg-[var(--g-primary-hover)] text-white border border-transparent shadow-xs',
  secondary:
    'bg-[var(--g-surface-variant)] hover:border-[var(--g-primary)] text-[var(--g-text)] border border-[var(--g-border)]',
  tonal:
    'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] border border-transparent hover:opacity-95',
  success:
    'bg-[#146C2E] hover:bg-[#0F5223] text-white border border-transparent shadow-xs',
  warning:
    'bg-[#C25E00] hover:bg-[#9A4A00] text-white border border-transparent shadow-xs',
  danger:
    'bg-[#B3261E] hover:bg-[#8C1D18] text-white border border-transparent shadow-xs',
  dangerTonal:
    'bg-[var(--g-red-bg)] text-[var(--g-red)] border border-[var(--g-red-border)]/30 hover:border-[var(--g-red-border)]',
  ghost:
    'bg-transparent hover:bg-[var(--g-surface-variant)] text-[var(--g-text)] border border-transparent',
  dark: 'bg-[#0D1117] text-white border border-[#00E676]/50 hover:border-[#00E676]',
};

const SIZE_CLASSES = {
  sm: 'min-h-[38px] px-3 py-1.5 text-xs rounded-xl gap-1.5',
  md: 'min-h-[44px] px-4 py-2 text-xs sm:text-sm rounded-2xl gap-2',
  lg: 'min-h-[50px] px-5 py-2.5 text-sm sm:text-base rounded-2xl gap-2',
};

/**
 * Tactile operational button with >=44px mobile touch target, loading state, and Material icon support.
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
  const isDisabled = disabled || loading;
  const variantCls = VARIANT_CLASSES[variant] || VARIANT_CLASSES.primary;
  const sizeCls = SIZE_CLASSES[size] || SIZE_CLASSES.md;

  return (
    <button
      type={type}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center font-extrabold transition-all duration-150 cursor-pointer select-none active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-primary)] disabled:opacity-50 disabled:cursor-not-allowed ${variantCls} ${sizeCls} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      {...rest}
    >
      {loading ? (
        <span className="ms-icon text-base animate-spin">progress_activity</span>
      ) : icon ? (
        <span className={`ms-icon text-lg ${iconFilled ? 'filled' : ''}`}>{icon}</span>
      ) : null}
      {children}
      {badge !== null && badge !== undefined && badge !== 0 && (
        <span className="num-ltr text-[10px] px-1.5 py-0.5 rounded-full bg-black/15 dark:bg-white/15 font-black">
          {badge}
        </span>
      )}
    </button>
  );
}
