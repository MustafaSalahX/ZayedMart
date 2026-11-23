import React from 'react';
import Button from './Button.jsx';
import Icon from './Icon.jsx';

/**
 * Detoxed Quiet Empty State:
 * Transparent directly on canvas — ZERO outer card box, ZERO giant colored icon square,
 * ZERO multi-sentence marketing prose.
 */
export default function EmptyState({
  icon = '',
  title = 'لا توجد بيانات',
  description = '',
  actionLabel = '',
  actionIcon = 'add',
  onAction,
  secondaryActionLabel = '',
  onSecondaryAction,
  compact = false,
  className = '',
}) {
  if (compact) {
    return (
      <div
        className={`py-3.5 px-1 border-y border-line flex items-center justify-between gap-3 ${className}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon && <Icon name={icon} size={18} className="text-ink-muted" />}
          <span className="text-xs sm:text-sm font-medium text-ink-muted truncate">
            {title}
          </span>
        </div>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="text-xs font-semibold text-primary hover:underline shrink-0 min-h-[44px] sm:min-h-[32px] px-1 inline-flex items-center gap-1 cursor-pointer"
          >
            <span>{actionLabel}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`py-10 px-4 flex flex-col items-center justify-center text-center gap-2.5 ${className}`}
    >
      {icon && (
        <Icon name={icon} size={24} className="text-ink-muted opacity-70" />
      )}
      <div className="space-y-1 max-w-xs">
        <p className="text-sm font-medium text-ink-muted m-0">{title}</p>
        {description && (
          <p className="text-xs font-normal text-ink-muted opacity-85 m-0 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {(actionLabel || secondaryActionLabel) && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {actionLabel && onAction && (
            <Button variant="secondary" size="sm" icon={actionIcon} onClick={onAction}>
              {actionLabel}
            </Button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <Button variant="ghost" size="sm" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
