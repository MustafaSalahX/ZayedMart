import React from 'react';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import Icon from './Icon.jsx';

const SUBTLE_TONE_CLASSES = {
  neutral: 'bg-surface-2 text-ink-muted border border-line',
  primary: 'bg-primary-container text-on-primary-container',
  secondary: 'bg-secondary-container text-on-secondary-container',
  accent: 'bg-accent-bg text-accent',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  orange: 'bg-[var(--g-orange-bg)] text-[var(--g-orange-text)] border border-[var(--g-orange-border)]',
  danger: 'bg-danger-bg text-danger',
  purple: 'bg-purple-bg text-purple',
};

const SOLID_TONE_CLASSES = {
  neutral: 'bg-ink text-canvas',
  primary: 'bg-primary-solid text-on-primary',
  primarySolid: 'bg-primary-solid text-on-primary',
  secondary: 'bg-secondary-container text-on-secondary-container',
  accent: 'bg-primary-solid text-on-primary',
  success: 'bg-success-solid text-on-success',
  successSolid: 'bg-success-solid text-on-success',
  warning: 'bg-warning-solid text-on-warning',
  warningSolid: 'bg-warning-solid text-on-warning',
  orange: 'bg-warning-solid text-on-warning',
  danger: 'bg-danger-solid text-on-danger',
  dangerSolid: 'bg-danger-solid text-on-danger',
  purple: 'bg-purple-solid text-on-purple',
  purpleSolid: 'bg-purple-solid text-on-purple',
};

/**
 * Restrained semantic badge adapting radius & weight per active theme architecture.
 * Prefer `<StatusDot />` for inline row status; reserve `<Badge />` for critical counts/tags.
 */
export default function Badge({
  tone = 'neutral',
  solid = false,
  icon = '',
  iconFilled = false,
  dot = false,
  pulse = false,
  numeric = false,
  className = '',
  children,
}) {
  const arch = useThemeArchitecture();
  const isMinimal = arch.id === 'minimal';

  const toneCls = solid
    ? SOLID_TONE_CLASSES[tone] || SOLID_TONE_CLASSES.neutral
    : SOLID_TONE_CLASSES[tone] && tone.endsWith('Solid')
    ? SOLID_TONE_CLASSES[tone]
    : SUBTLE_TONE_CLASSES[tone] || SUBTLE_TONE_CLASSES.neutral;

  return (
    <span
      className={`inline-flex items-center gap-1 ${
        isMinimal ? 'px-2 py-0.5 rounded-[4px] font-medium' : 'px-2.5 py-0.5 rounded-[var(--g-radius-pill)] font-semibold'
      } text-[11px] leading-tight shrink-0 ${toneCls} ${
        numeric ? 'num-ltr' : ''
      } ${className}`}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full bg-current shrink-0 ${
            pulse ? 'animate-ping' : ''
          }`}
          aria-hidden="true"
        />
      )}
      {icon && (
        <Icon name={icon} size={14} filled={iconFilled} />
      )}
      <span>{children}</span>
    </span>
  );
}
