import React, { useEffect } from 'react';

/**
 * Unified Mobile Bottom Sheet / Desktop Centered Dialog with Escape handling and keyboard-safe scroll.
 */
export default function BottomSheet({
  open,
  onClose,
  title = '',
  subtitle = '',
  icon = '',
  badge = null,
  maxWidth = 'max-w-lg',
  footer = null,
  children,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={() => onClose?.()}
      className="g-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'نافذة إجراءات'}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`g-dialog-sheet ${maxWidth} animate-pop flex flex-col gap-3`}
      >
        <div className="g-sheet-handle shrink-0" />

        {(title || onClose) && (
          <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-[var(--g-border)] shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              {icon && (
                <span className="w-10 h-10 rounded-2xl bg-[var(--g-primary-container)] text-[var(--g-primary)] flex items-center justify-center shrink-0">
                  <span className="ms-icon filled text-xl">{icon}</span>
                </span>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base sm:text-lg font-black text-[var(--g-text)] m-0 truncate">
                    {title}
                  </h3>
                  {badge}
                </div>
                {subtitle && (
                  <p className="text-xs font-semibold text-[var(--g-muted)] m-0 mt-0.5 truncate">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="إغلاق"
                className="w-10 h-10 rounded-full bg-[var(--g-surface-variant)] hover:bg-[var(--g-border)]/50 text-[var(--g-text)] flex items-center justify-center shrink-0 transition-colors active:scale-95"
              >
                <span className="ms-icon text-xl">close</span>
              </button>
            )}
          </div>
        )}

        <div className="min-w-0 space-y-3">{children}</div>

        {footer && (
          <div className="pt-2.5 border-t border-[var(--g-border)] shrink-0">{footer}</div>
        )}
      </div>
    </div>
  );
}
