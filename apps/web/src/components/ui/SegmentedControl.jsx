import React from 'react';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import Icon from './Icon.jsx';

/**
 * Adaptive Accessible Segmented Control (`role="radiogroup"`) with >=44px mobile touch target.
 * Morphs cleanly across all 5 architectures (flat hairline in Minimal, frosted glass capsule
 * in Liquid Glass, editorial/studio/M3 tracks in Elegant/Modern/Classic).
 */
export default function SegmentedControl({
  options = [],
  value,
  onChange,
  ariaLabel = 'اختيار وضع',
  fullWidth = false,
  fullWidthOnMobile = false,
  className = '',
}) {
  const arch = useThemeArchitecture();
  const isGlass = arch.id === 'liquid-glass';
  const isMinimal = arch.id === 'minimal';

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 p-1 border min-w-0 ${
        isGlass
          ? 'rounded-full bg-glass-control border-[var(--g-glass-border)]'
          : 'rounded-[var(--g-radius-btn)] bg-surface-2 border-line'
      } ${fullWidth ? 'w-full' : fullWidthOnMobile ? 'w-full sm:w-auto' : ''} ${className}`}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        const label = opt.labelAr || opt.label || opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={Boolean(opt.disabled)}
            onClick={() => onChange?.(opt.id)}
            className={`min-h-[42px] sm:min-h-[36px] px-2.5 sm:px-3 py-1.5 ${
              isGlass ? 'rounded-full' : 'rounded-[var(--g-radius-sm)]'
            } text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-[transform,background-color,border-color,color,box-shadow] duration-150 ease-[var(--g-ease-out)] cursor-pointer select-none active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed ${
              fullWidth ? 'flex-1 min-w-0' : fullWidthOnMobile ? 'flex-1 sm:flex-none min-w-0' : ''
            } ${
              active
                ? isGlass
                  ? 'bg-glass-pill text-ink shadow-[var(--g-glass-pill-specular)] border border-[var(--g-glass-border)]'
                  : isMinimal
                  ? 'bg-canvas text-ink border border-line'
                  : 'bg-surface text-ink shadow-[var(--g-shadow-sm)] border border-line'
                : 'bg-transparent text-ink-muted hover:text-ink border border-transparent'
            }`}
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
          </button>
        );
      })}
    </div>
  );
}
