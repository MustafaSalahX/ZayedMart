import React from 'react';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import Icon from './Icon.jsx';

/**
 * Adaptive Horizontal Filter Rail (`FilterChipRail`):
 * - `minimal` / `elegant`: Clean underline typographic tab strip (ZERO pill borders or icon bloat)
 * - `liquid-glass`: Translucent frosted glass pills with luminous liquid active bubble
 * - `modern`: Crisp studio tonal tabs
 * - `classic`: Clean detoxed M3 pills
 * Counts render as subtle inline tabular numerals instead of nested pills-inside-pills.
 */
export default function FilterChipRail({
  items = [],
  activeId,
  onSelect,
  variant = 'auto',
  showIcons = false,
  className = '',
}) {
  const arch = useThemeArchitecture();
  const resolvedVariant =
    variant === 'auto' ? arch.surfaces.filterRailStyle || 'pill' : variant;

  if (resolvedVariant === 'underline') {
    const isElegant = arch.id === 'elegant';
    return (
      <div
        className={`flex items-center gap-4 sm:gap-5 overflow-x-auto no-scrollbar border-b border-line ${className}`}
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
              className={`relative min-h-[44px] sm:min-h-[40px] py-2 text-xs sm:text-sm inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-[color] duration-150 cursor-pointer ${
                isActive
                  ? 'text-ink font-semibold'
                  : 'text-ink-muted hover:text-ink font-medium'
              }`}
            >
              <span>{item.label}</span>
              {item.count !== undefined && item.count !== null && (
                <span
                  className={`num-ltr text-[11px] font-medium ${
                    item.alert && item.count > 0 ? 'text-danger font-semibold' : 'text-ink-muted'
                  }`}
                >
                  {item.count}
                </span>
              )}
              {isActive && (
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-0 bottom-0 h-[2px] ${
                    isElegant ? 'bg-accent' : 'bg-ink'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  const isGlass = resolvedVariant === 'glass';
  const isStudio = resolvedVariant === 'studio';

  return (
    <div
      className={`flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 ${className}`}
      role="tablist"
    >
      {items.map((item) => {
        const isActive = activeId === item.id;
        const activeCls = isGlass
          ? 'bg-glass-pill text-ink border-[var(--g-glass-border)] shadow-[var(--g-glass-pill-specular)] font-semibold'
          : isStudio
          ? 'bg-surface text-ink border-line-strong shadow-2xs font-semibold'
          : 'bg-secondary-container text-on-secondary-container border-transparent font-semibold';

        const idleCls = isGlass
          ? 'bg-glass-control text-ink-muted border-[var(--g-glass-border)] hover:text-ink font-medium'
          : 'bg-transparent text-ink-muted border-line hover:border-line-strong hover:text-ink font-medium';

        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect?.(item.id)}
            className={`min-h-[44px] sm:min-h-[36px] px-3 py-1.5 ${
              isStudio ? 'rounded-[var(--g-radius-md)]' : 'rounded-[var(--g-radius-pill)]'
            } text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-[transform,background-color,border-color,color,box-shadow] duration-150 ease-[var(--g-ease-out)] cursor-pointer active:scale-[0.97] border ${
              isActive ? activeCls : idleCls
            }`}
          >
            {showIcons && item.icon && (
              <Icon name={item.icon} size={16} filled={isActive} />
            )}
            <span>{item.label}</span>
            {item.count !== undefined && item.count !== null && (
              <span
                className={`num-ltr text-[11px] font-semibold leading-none ${
                  item.alert && item.count > 0
                    ? 'text-danger'
                    : isActive
                    ? 'opacity-85'
                    : 'text-ink-muted'
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
