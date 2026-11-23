import React from 'react';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import Icon from './Icon.jsx';

const TONE_DOT = {
  neutral: '',
  primary: 'bg-primary-solid',
  success: 'bg-success-solid',
  warning: 'bg-warning-solid',
  danger: 'bg-danger-solid',
  purple: 'bg-purple-solid',
};

const TONE_VALUE = {
  neutral: 'text-ink',
  primary: 'text-ink',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  purple: 'text-purple',
};

/**
 * Detoxed Compact Metric Tile (`StatCard`):
 * Strips colored icon squares, progress bars, and badge clutter so every caller inherits
 * the clean 3-datum Apple / Linear metric aesthetic across all 5 theme architectures.
 */
export default function StatCard({
  label,
  value,
  sublabel = '',
  tone = 'neutral',
  active = false,
  chevron = undefined,
  onClick,
  className = '',
  children,
}) {
  const arch = useThemeArchitecture();
  const Comp = onClick ? 'button' : 'div';
  const showChevron = chevron !== undefined ? chevron : Boolean(onClick);
  const dotCls = TONE_DOT[tone] || '';
  const valueCls = TONE_VALUE[tone] || TONE_VALUE.neutral;
  const surfaceCls = arch.id === 'liquid-glass' ? 'g-glass-pane rounded-[20px]' : 'g-card';

  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`${surfaceCls} text-start p-3.5 sm:p-4 min-h-[82px] flex flex-col justify-between gap-2 min-w-0 transition-[transform,background-color,border-color,box-shadow] duration-150 ease-[var(--g-ease-out)] ${
        onClick
          ? 'g-card-interactive g-glass-interactive cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-ring-focus)]'
          : ''
      } ${active ? 'ring-2 ring-[var(--g-primary)] bg-surface-tint' : ''} ${className}`}
    >
      <div className="flex items-center justify-between gap-2 w-full min-w-0">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted truncate">
          {dotCls && (
            <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} aria-hidden="true" />
          )}
          <span className="truncate">{label}</span>
        </span>
        {showChevron && (
          <Icon
            name="chevron_left"
            size={16}
            className="text-ink-muted opacity-65 ltr:rotate-180"
          />
        )}
      </div>

      <div className="space-y-0.5 min-w-0">
        <div
          className={`text-2xl sm:text-3xl font-semibold tracking-tight num-ltr leading-none ${valueCls}`}
        >
          {value}
        </div>
        {sublabel && (
          <div className="text-xs font-normal text-ink-muted truncate">{sublabel}</div>
        )}
      </div>

      {children}
    </Comp>
  );
}
