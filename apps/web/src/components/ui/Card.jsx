import React from 'react';

const PADDING_CLASSES = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4 sm:p-5',
  lg: 'p-5 sm:p-6',
};

const VARIANT_CLASSES = {
  surface: '',
  tinted: 'bg-[var(--g-surface-tint)]',
  variant: 'bg-[var(--g-surface-variant)]',
};

/**
 * Standardized Material 3 Card primitive supporting interactive elevation and smart-timer alerts.
 */
export default function Card({
  padding = 'md',
  variant = 'surface',
  interactive = false,
  alert = false,
  className = '',
  children,
  ...rest
}) {
  const padCls = PADDING_CLASSES[padding] ?? PADDING_CLASSES.md;
  const varCls = VARIANT_CLASSES[variant] || '';
  return (
    <div
      className={`g-card ${interactive ? 'g-card-interactive cursor-pointer' : ''} ${
        alert ? 'g-smart-timer-orange' : ''
      } ${varCls} ${padCls} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
