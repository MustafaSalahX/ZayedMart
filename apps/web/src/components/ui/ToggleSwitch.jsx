import React from 'react';
import Icon from './Icon.jsx';

/**
 * Detoxed Accessible RTL-Aware Toggle Switch (`role="switch"`):
 * - Apple iOS / Linear grouped hairline row by default (`grouped = true`, zero nested box or icon square)
 * - Sleek `44×24px` pill track with crisp `20px` thumb + >=48px mobile hit target
 */
export default function ToggleSwitch({
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
  const handleToggle = () => {
    if (disabled) return;
    onChange?.(!checked);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={ariaLabel || label || 'تبديل الخيار'}
      disabled={disabled}
      onClick={handleToggle}
      className={`w-full min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-3 text-start transition-[background-color] duration-150 cursor-pointer select-none disabled:opacity-45 disabled:cursor-not-allowed ${
        grouped
          ? 'bg-transparent hover:bg-surface-tint'
          : 'rounded-[var(--g-radius-md)] bg-surface border border-line hover:border-line-strong'
      } ${className}`}
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

      <span
        aria-hidden="true"
        className={`relative inline-flex items-center w-11 h-6 rounded-full p-0.5 shrink-0 transition-[background-color] duration-150 ease-[var(--g-ease-out)] ${
          checked ? 'bg-primary-solid' : 'bg-line-strong'
        }`}
      >
        <span
          className={`w-5 h-5 rounded-full bg-[var(--g-on-primary)] shadow-2xs transform transition-transform duration-150 ease-[var(--g-ease-out)] ${
            checked ? '-translate-x-5 ltr:translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}
