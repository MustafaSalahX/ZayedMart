import React from 'react';

const PADDING_CLASSES = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-3.5 sm:p-5',
  lg: 'p-5 sm:p-6',
};

const VARIANT_CLASSES = {
  surface: '',
  flush: 'g-card-flush',
  tinted: 'bg-surface-tint',
  variant: 'bg-surface-2',
  elevated: 'bg-surface-elevated shadow-[var(--g-shadow)]',
};

/**
 * Theme-Adaptive Surface Primitive (`Card`):
 * Automatically transforms across all 5 architectures:
 * - minimal: pure flat 6px hairline surface + automatic nested `.g-card .g-card` de-boxing
 * - liquid-glass: optical frosted glass pane (`blur(32px) saturate(210%)`) + Fresnel specular rim
 * - elegant: warm editorial 1px hairline surface
 * - modern / classic: crisp tonal studio / clean M3 surface
 */
export default function Card({
  padding = 'md',
  variant = 'surface',
  surface = undefined,
  interactive = false,
  elevated = false,
  alert = false,
  className = '',
  children,
  ...rest
}) {
  const padCls = PADDING_CLASSES[padding] ?? PADDING_CLASSES.md;
  const resolvedVariant = surface || variant;
  const varCls = VARIANT_CLASSES[resolvedVariant] || '';

  return (
    <div
      className={`g-card ${
        interactive ? 'g-card-interactive g-glass-interactive cursor-pointer' : ''
      } ${elevated ? 'shadow-[var(--g-shadow)]' : ''} ${
        alert ? 'g-smart-timer-orange' : ''
      } ${varCls} ${padCls} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
