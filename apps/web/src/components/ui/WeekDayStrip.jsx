import React from 'react';

/**
 * Responsive 7-Day Week Selector Strip:
 * - On phones (< 640px): horizontal snap-scroll rail (`min-w-[58px] min-h-[52px]`)
 * - On tablets/desktop (>= 640px): crisp 7-column balanced grid (`sm:grid sm:grid-cols-7`)
 */
export default function WeekDayStrip({
  days = [],
  activeId,
  onSelect,
  ariaLabel = 'أيام الأسبوع',
  className = '',
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex sm:grid sm:grid-cols-7 items-stretch gap-1.5 overflow-x-auto no-scrollbar snap-x snap-mandatory py-1 ${className}`}
    >
      {days.map((day) => {
        const isActive = activeId === day.id;
        const isToday = Boolean(day.isToday);
        return (
          <button
            key={day.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={Boolean(day.disabled)}
            onClick={() => onSelect?.(day.id)}
            className={`snap-start min-w-[58px] sm:min-w-0 min-h-[52px] px-2 py-1.5 rounded-[var(--g-radius-md)] border flex flex-col items-center justify-center gap-0.5 shrink-0 transition-[transform,background-color,border-color,color] duration-150 ease-[var(--g-ease-out)] cursor-pointer active:scale-[0.97] disabled:opacity-45 ${
              isActive
                ? 'bg-primary-solid text-on-primary border-transparent'
                : isToday
                ? 'bg-primary-container text-on-primary-container border-primary'
                : 'bg-surface text-ink border-line hover:border-line-strong'
            }`}
          >
            <span className="text-[11px] font-semibold leading-tight whitespace-nowrap">
              {day.shortLabel || day.label}
            </span>
            {day.dateNum !== undefined && day.dateNum !== null && (
              <span
                className={`text-xs font-semibold num-ltr leading-none ${
                  isActive ? 'opacity-95' : 'text-ink-muted'
                }`}
              >
                {day.dateNum}
              </span>
            )}
            {day.badge !== undefined && day.badge !== null && day.badge !== 0 && (
              <span
                className={`text-[10px] font-semibold num-ltr leading-tight ${
                  isActive
                    ? 'opacity-90'
                    : day.alert
                    ? 'text-danger'
                    : 'text-ink-muted'
                }`}
              >
                {day.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
