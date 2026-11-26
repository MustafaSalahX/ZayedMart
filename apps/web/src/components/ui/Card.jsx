import React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const cardVariants = cva('g-card', {
  variants: {
    variant: {
      surface: '',
      flush: 'g-card-flush',
      tinted: 'bg-surface-tint',
      variant: 'bg-surface-2',
      elevated: 'bg-surface-elevated shadow-[var(--g-shadow)]',
    },
    padding: {
      none: 'p-0',
      sm: 'p-3',
      md: 'p-3.5 sm:p-5',
      lg: 'p-5 sm:p-6',
    },
    interactive: {
      true: 'g-card-interactive g-glass-interactive cursor-pointer',
      false: '',
    },
    elevated: {
      true: 'shadow-[var(--g-shadow)]',
      false: '',
    },
    alert: {
      true: 'g-smart-timer-orange',
      false: '',
    },
  },
  defaultVariants: {
    variant: 'surface',
    padding: 'md',
    interactive: false,
    elevated: false,
    alert: false,
  },
});

/**
 * Theme-Adaptive Surface Primitive (`Card`):
 * Automatically transforms across all 5 architectures:
 * - minimal: Shadcn New York bordered Zinc card + flat nested `.g-card .g-card` de-boxing
 * - liquid-glass: optical frosted glass pane (`blur(32px) saturate(210%)`) + Fresnel specular rim
 * - elegant: warm editorial 1px hairline surface
 * - modern / classic: crisp tonal studio / clean M3 surface
 */
const Card = React.forwardRef(function Card(
  {
    padding = 'md',
    variant = 'surface',
    surface = undefined,
    interactive = false,
    elevated = false,
    alert = false,
    className = '',
    children,
    ...rest
  },
  ref
) {
  const resolvedVariant = surface || variant;

  return (
    <div
      ref={ref}
      className={cn(
        cardVariants({
          variant: resolvedVariant,
          padding,
          interactive: Boolean(interactive),
          elevated: Boolean(elevated),
          alert: Boolean(alert),
        }),
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

Card.displayName = 'Card';

export { Card, cardVariants };
export default Card;
