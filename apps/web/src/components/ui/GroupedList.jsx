import React from 'react';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';

/**
 * Apple iOS / Linear Grouped Hairline List Container (`GroupedList`):
 * Eliminates boxes-inside-boxes by placing hairline-divided rows inside a single
 * theme-native architectural surface (flush open hairline in Minimal, frosted glass pane
 * in Liquid Glass, editorial hairline in Elegant, crisp card in Modern/Classic).
 */
export default function GroupedList({
  label = '',
  count = null,
  actions = null,
  children,
  className = '',
  listClassName = '',
  ...rest
}) {
  const arch = useThemeArchitecture();

  return (
    <section className={`min-w-0 ${className}`} {...rest}>
      {(label || actions || (count !== null && count !== undefined)) && (
        <div className="flex items-center justify-between gap-2 px-1 mb-2 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {label && (
              <h3 className="text-xs font-semibold text-ink-muted m-0 truncate tracking-tight">
                {label}
              </h3>
            )}
            {count !== null && count !== undefined && (
              <span className="num-ltr text-xs font-medium text-ink-muted">
                · {count}
              </span>
            )}
          </div>
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </div>
      )}

      <div
        className={`g-grouped-list ${arch.surfaces.listDivider} ${listClassName}`}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Clean single-level hairline row helper for use inside `<GroupedList>`.
 */
export function GroupedRow({
  onClick,
  className = '',
  children,
  ...rest
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`w-full min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-3 text-start min-w-0 transition-[background-color] duration-150 ${
        onClick
          ? 'cursor-pointer hover:bg-surface-tint active:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--g-ring-focus)]'
          : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </Comp>
  );
}
