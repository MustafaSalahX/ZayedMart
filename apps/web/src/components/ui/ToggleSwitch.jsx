import React, { useId } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { cn } from '../../lib/utils.js';
import Icon from './Icon.jsx';

/**
 * Accessible RTL-Aware Toggle Switch backed by `@radix-ui/react-switch`:
 * - Apple iOS / Linear grouped hairline row by default (`grouped = true`, >=48px clickable hit target)
 * - Sleek `44×24px` pill track with crisp `20px` thumb and RTL logical translation across all 5 themes
 */
export default function ToggleSwitch({
  id,
  checked = false,
  onChange,
  label = '',
  description = '',
  icon = '',
  grouped = true,
  disabled = false,
  className = '',
  ariaLabel = '',
}) {
  const autoId = useId();
  const switchId = id || autoId;

  return (
    <label
      htmlFor={switchId}
      aria-disabled={disabled || undefined}
      className={cn(
        'w-full min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-3 text-start transition-[background-color] duration-150 select-none',
        disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer',
        grouped
          ? 'bg-transparent hover:bg-surface-tint'
          : 'rounded-[var(--g-radius-md)] bg-surface border border-line hover:border-line-strong',
        className
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {icon && <Icon name={icon} size={18} className="text-ink-muted" />}
        <div className="min-w-0">
          {label && (
            <div className="text-xs sm:text-sm font-medium text-ink truncate">
              {label}
            </div>
          )}
          {description && (
            <div className="text-[11px] font-normal text-ink-muted leading-snug mt-0.5">
              {description}
            </div>
          )}
        </div>
      </div>

      <Switch.Root
        id={switchId}
        checked={Boolean(checked)}
        onCheckedChange={(next) => {
          if (!disabled) {
            onChange?.(next);
          }
        }}
        disabled={disabled}
        aria-label={ariaLabel || label || 'تبديل الخيار'}
        className={cn(
          'relative inline-flex items-center w-11 h-6 rounded-full p-0.5 shrink-0 transition-[background-color] duration-150 ease-[var(--g-ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-ring-focus)]',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          checked ? 'bg-primary-solid' : 'bg-line-strong'
        )}
      >
        <Switch.Thumb
          className={cn(
            'pointer-events-none block w-5 h-5 rounded-full bg-[var(--g-on-primary)] shadow-2xs transition-transform duration-150 ease-[var(--g-ease-out)]',
            'data-[state=checked]:-translate-x-5 ltr:data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0'
          )}
        />
      </Switch.Root>
    </label>
  );
}
