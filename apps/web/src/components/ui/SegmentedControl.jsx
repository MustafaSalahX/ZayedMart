import React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import { cn } from '../../lib/utils.js';
import Icon from './Icon.jsx';

/**
 * Adaptive Accessible Segmented Control backed by `@radix-ui/react-tabs`
 * with RTL arrow-key navigation and >=44px mobile touch targets.
 * Morphs cleanly across all 5 architectures (Shadcn elevated Zinc tab in Minimal,
 * frosted glass capsule in Liquid Glass, editorial/studio/M3 tracks in Elegant/Modern/Classic).
 */
export default function SegmentedControl({
  options = [],
  value,
  onChange,
  ariaLabel = 'اختيار وضع',
  fullWidth = false,
  fullWidthOnMobile = false,
  className = '',
  dir,
}) {
  const arch = useThemeArchitecture();
  const isGlass = arch.id === 'liquid-glass';
  const isMinimal = arch.id === 'minimal';

  return (
    <Tabs.Root
      value={value}
      onValueChange={(nextValue) => onChange?.(nextValue)}
      dir={dir}
      className={cn(
        'inline-flex min-w-0',
        fullWidth ? 'w-full' : fullWidthOnMobile ? 'w-full sm:w-auto' : '',
        className
      )}
    >
      <Tabs.List
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center gap-1 p-1 border min-w-0',
          isGlass
            ? 'rounded-full bg-glass-control border-[var(--g-glass-border)]'
            : 'rounded-[var(--g-radius-btn)] bg-surface-2 border-line',
          (fullWidth || fullWidthOnMobile) && 'w-full'
        )}
      >
        {options.map((opt) => {
          const active = opt.id === value;
          const label = opt.labelAr || opt.label || opt.id;
          return (
            <Tabs.Trigger
              key={opt.id}
              value={opt.id}
              disabled={Boolean(opt.disabled)}
              className={cn(
                'min-h-[42px] sm:min-h-[36px] px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 border border-transparent text-ink-muted hover:text-ink transition-[transform,background-color,border-color,color,box-shadow] duration-150 ease-[var(--g-ease-out)] cursor-pointer select-none active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-ring-focus)]',
                isGlass ? 'rounded-full' : 'rounded-[var(--g-radius-sm)]',
                fullWidth
                  ? 'flex-1 min-w-0'
                  : fullWidthOnMobile
                  ? 'flex-1 sm:flex-none min-w-0'
                  : '',
                isGlass
                  ? 'data-[state=active]:bg-glass-pill data-[state=active]:text-ink data-[state=active]:shadow-[var(--g-glass-pill-specular)] data-[state=active]:border-[var(--g-glass-border)]'
                  : isMinimal
                  ? 'data-[state=active]:bg-canvas data-[state=active]:text-ink data-[state=active]:shadow-[var(--g-shadow-sm)] data-[state=active]:border-line'
                  : 'data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-[var(--g-shadow-sm)] data-[state=active]:border-line'
              )}
            >
              {opt.icon && (
                <Icon
                  name={opt.icon}
                  size={16}
                  filled={active}
                  className={active ? 'text-primary' : ''}
                />
              )}
              <span className="truncate">{label}</span>
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>
    </Tabs.Root>
  );
}
