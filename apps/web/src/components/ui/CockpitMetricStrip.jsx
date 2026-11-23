import React from 'react';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import Icon from './Icon.jsx';

const DOT_TONES = {
  neutral: '',
  primary: 'bg-primary-solid',
  success: 'bg-success-solid',
  warning: 'bg-warning-solid',
  danger: 'bg-danger-solid',
  purple: 'bg-purple-solid',
};

const VALUE_TONES = {
  neutral: 'text-ink',
  primary: 'text-ink',
  success: 'text-ink',
  warning: 'text-warning',
  danger: 'text-danger',
  purple: 'text-purple',
};

const COL_CLASSES = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
};

/**
 * Adaptive 4-Metric Operational Cockpit Strip (`CockpitMetricStrip` / `MetricStrip`):
 * Renders 3 pure data elements per cell (1–2 word label + optional 8px status dot,
 * big tabular numeral, 1 subtle secondary datum) with theme-native architecture:
 * - minimal: open hairline-divided strip directly on canvas (ZERO card boxes!)
 * - liquid-glass: detached frosted refractive glass tiles with Fresnel specular rim
 * - elegant: warm editorial hairline bordered strip
 * - modern / classic: crisp tonal studio / M3 metric tiles
 */
export default function CockpitMetricStrip({
  items = [],
  columns = 4,
  className = '',
}) {
  const arch = useThemeArchitecture();
  const kpiLayout = arch.surfaces.kpiLayout;
  const colCls = COL_CLASSES[columns] || COL_CLASSES[4];

  if (!items || items.length === 0) return null;

  const isMinimalStrip = kpiLayout === 'hairline-strip';
  const isEditorialStrip = kpiLayout === 'editorial-strip';
  const isGlassTiles = kpiLayout === 'glass-tiles';

  if (isMinimalStrip || isEditorialStrip) {
    return (
      <div
        className={`grid ${colCls} gap-px bg-line ${
          isMinimalStrip
            ? 'border-y border-line'
            : 'border border-line rounded-[var(--g-radius-card)] overflow-hidden'
        } ${className}`}
      >
        {items.map((item) => {
          const Comp = item.onClick ? 'button' : 'div';
          const dotCls = DOT_TONES[item.dotTone || (item.tone && item.tone !== 'neutral' ? item.tone : '')] || '';
          const valCls = VALUE_TONES[item.tone] || VALUE_TONES.neutral;

          return (
            <Comp
              key={item.id || item.label}
              type={item.onClick ? 'button' : undefined}
              onClick={item.onClick}
              aria-label={item.ariaLabel}
              className={`${
                isMinimalStrip ? 'bg-canvas' : 'bg-surface'
              } text-start ${
                columns === 3 ? 'px-2.5 py-3 sm:px-5 sm:py-4' : 'px-3.5 py-3.5 sm:px-5 sm:py-4'
              } min-h-[84px] sm:min-h-[88px] flex flex-col justify-between gap-1.5 sm:gap-2 min-w-0 transition-[background-color,transform] duration-150 ease-[var(--g-ease-out)] ${
                item.onClick
                  ? 'cursor-pointer hover:bg-surface-tint active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--g-ring-focus)]'
                  : ''
              } ${item.active ? 'bg-surface-tint' : ''}`}
            >
              <div className="flex items-center justify-between gap-1.5 min-w-0">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted truncate">
                  {dotCls && (
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`}
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{item.label}</span>
                </span>
                {item.onClick && (
                  <Icon
                    name="chevron_left"
                    size={15}
                    className="text-ink-muted opacity-60 ltr:rotate-180"
                  />
                )}
              </div>

              <div className="space-y-1 min-w-0">
                <div
                  className={`num-ltr ${
                    columns === 3 ? 'text-xl sm:text-3xl' : 'text-2xl sm:text-3xl'
                  } font-semibold tracking-tight leading-none ${valCls}`}
                >
                  {item.value}
                </div>
                {item.secondary !== undefined && item.secondary !== null && item.secondary !== '' && (
                  <div className="text-xs text-ink-muted truncate leading-snug">
                    {item.secondary}
                  </div>
                )}
              </div>
            </Comp>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`grid ${colCls} gap-2 sm:gap-3 ${className}`}>
      {items.map((item) => {
        const Comp = item.onClick ? 'button' : 'div';
        const dotCls = DOT_TONES[item.dotTone || (item.tone && item.tone !== 'neutral' ? item.tone : '')] || '';
        const valCls = VALUE_TONES[item.tone] || VALUE_TONES.neutral;

        return (
          <Comp
            key={item.id || item.label}
            type={item.onClick ? 'button' : undefined}
            onClick={item.onClick}
            aria-label={item.ariaLabel}
            className={`${
              isGlassTiles ? 'g-glass-pane rounded-[20px]' : 'g-card'
            } text-start ${
              columns === 3 ? 'p-2.5 sm:p-4' : 'p-3.5 sm:p-4'
            } min-h-[84px] sm:min-h-[92px] flex flex-col justify-between gap-1.5 sm:gap-2 min-w-0 transition-[transform,background-color,border-color,box-shadow] duration-150 ease-[var(--g-ease-out)] ${
              item.onClick
                ? 'g-card-interactive g-glass-interactive cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-ring-focus)]'
                : ''
            } ${item.active ? 'ring-2 ring-[var(--g-primary)]' : ''}`}
          >
            <div className="flex items-center justify-between gap-1.5 min-w-0">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted truncate">
                {dotCls && (
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`}
                    aria-hidden="true"
                  />
                )}
                <span className="truncate">{item.label}</span>
              </span>
              {item.onClick && (
                <Icon
                  name="chevron_left"
                  size={15}
                  className="text-ink-muted opacity-65 ltr:rotate-180"
                />
              )}
            </div>

            <div className="space-y-1 min-w-0">
              <div
                className={`num-ltr ${
                  columns === 3 ? 'text-xl sm:text-3xl' : 'text-2xl sm:text-3xl'
                } font-semibold tracking-tight leading-none ${valCls}`}
              >
                {item.value}
              </div>
              {item.secondary !== undefined && item.secondary !== null && item.secondary !== '' && (
                <div className="text-xs text-ink-muted truncate leading-snug">
                  {item.secondary}
                </div>
              )}
            </div>
          </Comp>
        );
      })}
    </div>
  );
}
