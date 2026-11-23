import React from 'react';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';

/**
 * Detoxed Operational Section Header:
 * Zero colored icon-in-square boxes. Clean typographic title, optional subtle count/datum,
 * and end-aligned action controls adapted to the active theme architecture.
 */
export default function SectionHeader({
  title,
  subtitle = '',
  count = null,
  badge = null,
  actions = null,
  className = '',
}) {
  const arch = useThemeArchitecture();
  const isMinimalOrElegant =
    arch.id === 'minimal' || arch.id === 'elegant';

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0 ${
        isMinimalOrElegant ? 'pb-2 border-b border-line' : ''
      } ${className}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2
            className={`text-sm sm:text-base ${arch.surfaces.headingWeight} tracking-tight text-ink m-0 leading-snug`}
          >
            {title}
          </h2>
          {count !== null && count !== undefined && (
            <span className="num-ltr text-xs font-medium text-ink-muted">
              {count}
            </span>
          )}
          {badge}
        </div>
        {subtitle && (
          <p className="text-xs font-normal text-ink-muted m-0 mt-0.5 leading-snug">
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div className="w-full sm:w-auto min-w-0 flex items-center gap-1.5 flex-wrap shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
