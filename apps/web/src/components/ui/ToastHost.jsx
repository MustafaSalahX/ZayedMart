import React from 'react';
import { createPortal } from 'react-dom';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import Icon from './Icon.jsx';

/**
 * Unified Theme-Aware Snackbar / Toast Host:
 * - Portals to `document.body` at `z-[90]` so notifications render above every modal/sheet
 * - Anchored below TopBar on mobile so it never collides with BottomNav or Walkie pill
 * - Anchored bottom-center on desktop (`md:top-auto md:bottom-6`)
 */
export default function ToastHost({ toast, onDismiss }) {
  const arch = useThemeArchitecture();

  if (!toast || !toast.message) return null;

  const isError = toast.type === 'error';
  const isWarning = toast.type === 'warning';

  const iconName = isError ? 'error' : isWarning ? 'warning' : 'check_circle';
  const iconColor = isError
    ? 'text-[var(--g-snackbar-error)]'
    : isWarning
    ? 'text-[var(--g-yellow)]'
    : 'text-[var(--g-snackbar-success)]';

  const radiusCls =
    arch.id === 'liquid-glass'
      ? 'rounded-full px-4 py-2.5'
      : 'rounded-[var(--g-radius-md)] px-4 py-2.5';

  const toastNode = (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`fixed top-[calc(var(--topbar-h)+0.75rem)] md:top-auto md:bottom-6 left-1/2 -translate-x-1/2 z-[90] w-[92vw] max-w-md shadow-[var(--g-shadow-elevated)] border border-line/35 flex items-center justify-between gap-2.5 text-xs sm:text-sm font-medium animate-pop bg-[var(--g-snackbar-bg)] text-[var(--g-snackbar-text)] ${radiusCls}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Icon name={iconName} size={18} filled className={iconColor} />
        <span className="leading-snug">{toast.message}</span>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="إغلاق"
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 opacity-75 hover:opacity-100 transition-opacity duration-150"
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(toastNode, document.body)
    : toastNode;
}
