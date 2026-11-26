import React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import { cn } from '../../lib/utils.js';
import Icon from './Icon.jsx';

const buttonVariants = cva(
  'inline-flex items-center justify-center font-semibold rounded-[var(--g-radius-btn)] transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-150 ease-[var(--g-ease-out)] cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-ring-focus)] disabled:opacity-45 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary:
          'g-btn-primary bg-primary-solid hover:bg-primary-solid-hover text-on-primary border border-transparent',
        secondary:
          'g-btn-secondary bg-surface-2 hover:border-[var(--g-border-strong)] text-ink border border-line',
        outline:
          'bg-background hover:bg-surface-2 text-ink border border-border',
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
      },
      size: {
        sm: 'min-h-[44px] sm:min-h-[36px] px-3 py-1.5 text-xs gap-1.5',
        md: 'min-h-[44px] px-4 py-2 text-xs sm:text-sm gap-2',
        lg: 'min-h-[48px] px-5 py-2.5 text-sm gap-2',
        icon: 'min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] p-0',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      fullWidth: false,
    },
  }
);

/**
 * Tactile operational button with >=44px mobile touch target, CVA variants,
 * Radix `Slot` (`asChild`) support, and theme-scoped Shadcn New York shadow polish.
 */
const Button = React.forwardRef(function Button(
  {
    type = 'button',
    variant = 'primary',
    size = 'md',
    icon = '',
    iconFilled = false,
    loading = false,
    disabled = false,
    fullWidth = false,
    badge = null,
    asChild = false,
    className = '',
    children,
    ...rest
  },
  ref
) {
  const arch = useThemeArchitecture();
  const isDisabled = disabled || loading;
  const resolvedVariant = variant || 'primary';
  const minimalShadow =
    arch.id === 'minimal' && resolvedVariant !== 'ghost'
      ? 'shadow-[var(--g-shadow-sm)]'
      : '';

  const classes = cn(
    buttonVariants({
      variant: resolvedVariant,
      size,
      fullWidth: Boolean(fullWidth),
    }),
    arch.motion.pressClass,
    minimalShadow,
    className
  );

  if (asChild) {
    return (
      <Slot
        ref={ref}
        aria-disabled={isDisabled || undefined}
        className={classes}
        {...rest}
      >
        {children}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      className={classes}
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
});

Button.displayName = 'Button';

export { Button, buttonVariants };
export default Button;
