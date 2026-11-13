import React from 'react';

/**
 * Horizontal scrollable filter chip rail with >=40px touch height and >=8px gap between items.
 */
export default function FilterChipRail({
  items = [],
  activeId,
  onSelect,
  className = '',
}) {
  return (
    <div
      className={`flex items-center gap-2 overflow-x-auto no-scrollbar py-1 ${className}`}
      role="tablist"
    >
      {items.map((item) => {
        const isActive = activeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect?.(item.id)}
            className={`min-h-[40px] px-3.5 py-1.5 rounded-full text-xs font-extrabold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all duration-150 cursor-pointer active:scale-95 border ${
              isActive
                ? 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] border-transparent shadow-2xs'
                : 'bg-[var(--g-surface)] text-[var(--g-muted)] border-[var(--g-border)] hover:border-[var(--g-primary)] hover:text-[var(--g-text)]'
            }`}
          >
            {item.icon && (
              <span className={`ms-icon text-base ${isActive ? 'filled' : ''}`}>
                {item.icon}
              </span>
            )}
            <span>{item.label}</span>
            {item.count !== undefined && item.count !== null && (
              <span
                className={`num-ltr text-[11px] px-1.5 py-0.25 rounded-full font-black ${
                  item.alert && item.count > 0
                    ? 'bg-[var(--g-red-bg)] text-[var(--g-red)]'
                    : isActive
                    ? 'bg-white/65 dark:bg-black/25 text-current'
                    : 'bg-[var(--g-surface-variant)] text-[var(--g-text)]'
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
