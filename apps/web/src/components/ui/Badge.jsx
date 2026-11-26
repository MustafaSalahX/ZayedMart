import React from 'react';
import { cva } from 'class-variance-authority';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import { cn } from '../../lib/utils.js';
import Icon from './Icon.jsx';

const badgeVariants = cva(
  'inline-flex items-center gap-1 text-[11px] leading-tight shrink-0',
  {
    variants: {
      shape: {
        minimal: 'px-2 py-0.5 rounded-[4px] font-medium',
        pill: 'px-2.5 py-0.5 rounded-[var(--g-radius-pill)] font-semibold',
      },
      tone: {
        neutral: '',
        primary: '',
        secondary: '',
        accent: '',
        success: '',
        warning: '',
        orange: '',
        danger: '',
        purple: '',
      },
      solid: {
        true: '',
        false: '',
      },
      numeric: {
        true: 'num-ltr',
        false: '',
      },
    },
    compoundVariants: [
      { solid: false, tone: 'neutral', className: 'bg-surface-2 text-ink-muted border border-line' },
      { solid: false, tone: 'primary', className: 'bg-primary-container text-on-primary-container' },
      { solid: false, tone: 'secondary', className: 'bg-secondary-container text-on-secondary-container' },
      { solid: false, tone: 'accent', className: 'bg-accent-bg text-accent' },
      { solid: false, tone: 'success', className: 'bg-success-bg text-success' },
      { solid: false, tone: 'warning', className: 'bg-warning-bg text-warning' },
      {
        solid: false,
        tone: 'orange',
        className: 'bg-[var(--g-orange-bg)] text-[var(--g-orange-text)] border border-[var(--g-orange-border)]',
      },
      { solid: false, tone: 'danger', className: 'bg-danger-bg text-danger' },
      { solid: false, tone: 'purple', className: 'bg-purple-bg text-purple' },
      { solid: true, tone: 'neutral', className: 'bg-ink text-canvas' },
      { solid: true, tone: 'primary', className: 'bg-primary-solid text-on-primary' },
      { solid: true, tone: 'secondary', className: 'bg-secondary-container text-on-secondary-container' },
      { solid: true, tone: 'accent', className: 'bg-primary-solid text-on-primary' },
      { solid: true, tone: 'success', className: 'bg-success-solid text-on-success' },
      { solid: true, tone: 'warning', className: 'bg-warning-solid text-on-warning' },
      { solid: true, tone: 'orange', className: 'bg-warning-solid text-on-warning' },
      { solid: true, tone: 'danger', className: 'bg-danger-solid text-on-danger' },
      { solid: true, tone: 'purple', className: 'bg-purple-solid text-on-purple' },
    ],
    defaultVariants: {
      shape: 'pill',
      tone: 'neutral',
      solid: false,
      numeric: false,
    },
  }
);

const VALID_TONES = new Set([
  'neutral',
  'primary',
  'secondary',
  'accent',
  'success',
  'warning',
  'orange',
  'danger',
  'purple',
]);

/**
 * Restrained semantic badge adapting radius & weight per active theme architecture.
 * Prefer `<StatusDot />` for inline row status; reserve `<Badge />` for critical counts/tags.
 */
const Badge = React.forwardRef(function Badge(
  {
    tone = 'neutral',
    solid = false,
    icon = '',
    iconFilled = false,
    dot = false,
    pulse = false,
    numeric = false,
    className = '',
    children,
    ...rest
  },
  ref
) {
  const arch = useThemeArchitecture();
  const isSolidAlias = typeof tone === 'string' && tone.endsWith('Solid');
  const baseTone = isSolidAlias ? tone.slice(0, -5) : tone;
  const resolvedTone = VALID_TONES.has(baseTone) ? baseTone : 'neutral';
  const resolvedSolid = Boolean(solid || isSolidAlias);

  return (
    <span
      ref={ref}
      className={cn(
        badgeVariants({
          shape: arch.id === 'minimal' ? 'minimal' : 'pill',
          tone: resolvedTone,
          solid: resolvedSolid,
          numeric: Boolean(numeric),
        }),
        className
      )}
      {...rest}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full bg-current shrink-0 ${
            pulse ? 'animate-ping' : ''
          }`}
          aria-hidden="true"
        />
      )}
      {icon && <Icon name={icon} size={14} filled={iconFilled} />}
      <span>{children}</span>
    </span>
  );
});

Badge.displayName = 'Badge';

export { Badge, badgeVariants };
export default Badge;
