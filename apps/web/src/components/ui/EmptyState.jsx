import React from 'react';
import Button from './Button.jsx';

/**
 * Task-teaching empty state replacing generic blank screens.
 */
export default function EmptyState({
  icon = 'inbox',
  title = 'لا توجد بيانات بعد',
  description = '',
  actionLabel = '',
  actionIcon = 'add',
  onAction,
  className = '',
}) {
  return (
    <div
      className={`g-card p-6 sm:p-8 flex flex-col items-center justify-center text-center gap-3 ${className}`}
    >
      <div className="w-14 h-14 rounded-2xl bg-[var(--g-surface-variant)] text-[var(--g-primary)] flex items-center justify-center">
        <span className="ms-icon filled text-3xl">{icon}</span>
      </div>
      <div className="space-y-1 max-w-sm">
        <h4 className="text-sm sm:text-base font-black text-[var(--g-text)] m-0">{title}</h4>
        {description && (
          <p className="text-xs sm:text-sm font-medium text-[var(--g-muted)] m-0 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actionLabel && onAction && (
        <Button variant="tonal" size="md" icon={actionIcon} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
