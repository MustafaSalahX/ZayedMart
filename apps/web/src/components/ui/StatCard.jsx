import React from 'react';

const TONE_MAP = {
  neutral: {
    wrap: 'bg-[var(--g-surface)] border-[var(--g-border)]',
    iconBox: 'bg-[var(--g-surface-variant)] text-[var(--g-text)]',
    value: 'text-[var(--g-text)]',
  },
  primary: {
    wrap: 'bg-[var(--g-surface)] border-[var(--g-primary)]/30',
    iconBox: 'bg-[var(--g-primary-container)] text-[var(--g-primary)]',
    value: 'text-[var(--g-primary)]',
  },
  success: {
    wrap: 'bg-[var(--g-surface)] border-[var(--g-green-border)]/40',
    iconBox: 'bg-[var(--g-green-bg)] text-[var(--g-green)]',
    value: 'text-[var(--g-green)]',
  },
  warning: {
    wrap: 'bg-[var(--g-surface)] border-[var(--g-yellow-border)]/40',
    iconBox: 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]',
    value: 'text-[var(--g-yellow)]',
  },
  danger: {
    wrap: 'bg-[var(--g-surface)] border-[var(--g-red-border)]/40',
    iconBox: 'bg-[var(--g-red-bg)] text-[var(--g-red)]',
    value: 'text-[var(--g-red)]',
  },
  purple: {
    wrap: 'bg-[var(--g-surface)] border-[var(--g-purple-border)]/40',
    iconBox: 'bg-[var(--g-purple-bg)] text-[var(--g-purple)]',
    value: 'text-[var(--g-purple)]',
  },
};

/**
 * Compact KPI metric card with tabular numerals and optional interactive filter toggle.
 */
export default function StatCard({
  label,
  value,
  sublabel = '',
  icon = '',
  tone = 'neutral',
  active = false,
  onClick,
  className = '',
}) {
  const t = TONE_MAP[tone] || TONE_MAP.neutral;
  const Comp = onClick ? 'button' : 'div';

  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`text-right rounded-2xl border p-3 sm:p-3.5 min-h-[76px] flex items-center justify-between gap-2.5 transition-all duration-150 ${
        t.wrap
      } ${
        onClick
          ? 'cursor-pointer hover:border-[var(--g-primary)] active:scale-[0.98]'
          : ''
      } ${
        active
          ? 'ring-2 ring-[var(--g-primary)] bg-[var(--g-surface-tint)] shadow-xs'
          : ''
      } ${className}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[11px] sm:text-xs font-bold text-[var(--g-muted)] truncate">
          {label}
        </div>
        <div className={`text-xl sm:text-2xl font-black num-ltr leading-tight mt-0.5 ${t.value}`}>
          {value}
        </div>
        {sublabel && (
          <div className="text-[10px] font-semibold text-[var(--g-muted)] truncate mt-0.5">
            {sublabel}
          </div>
        )}
      </div>
      {icon && (
        <span
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${t.iconBox}`}
        >
          <span className="ms-icon filled text-xl">{icon}</span>
        </span>
      )}
    </Comp>
  );
}
