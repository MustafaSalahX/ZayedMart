import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import Icon from './Icon.jsx';

let openSheetCounter = 0;
let savedBodyOverflow = '';

/**
 * Global Modal Layer Tracker:
 * - Coordinates stacked sheet z-indexes (`62, 64, 66...`) cleanly
 * - Toggles `html[data-modal-open="true"]` so `.g-floating-chrome` docks/FABs auto-hide
 * - Locks body scroll safely until the last overlay closes
 */
export function pushModalLayer() {
  openSheetCounter += 1;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.modalOpen = 'true';
    if (openSheetCounter === 1) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
  }
  return 60 + openSheetCounter * 2;
}

export function popModalLayer() {
  openSheetCounter = Math.max(0, openSheetCounter - 1);
  if (typeof document !== 'undefined' && openSheetCounter === 0) {
    delete document.documentElement.dataset.modalOpen;
    document.body.style.overflow = savedBodyOverflow || '';
    savedBodyOverflow = '';
  }
}

/**
 * Unified Mobile Bottom Sheet / Desktop Centered Dialog:
 * - Portals directly to `document.body` so ancestor stacking contexts NEVER trap it
 * - Zero colored header icon-box clutter; crisp title + optional factual context + 44×44 close button
 * - Pinned header + sticky footer stay visible above the Android virtual keyboard (IME)
 * - Body scroll lock with safe ref-counting + Escape key dismissal + full ARIA dialog attributes
 */
export default function BottomSheet({
  open,
  onClose,
  title = '',
  subtitle = '',
  badge = null,
  maxWidth = 'max-w-lg',
  footer = null,
  closeOnOverlay = true,
  children,
}) {
  const arch = useThemeArchitecture();
  const [layerZ, setLayerZ] = useState(62);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const z = pushModalLayer();
    setLayerZ(z);

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        onCloseRef.current?.();
      }
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      window.removeEventListener('keydown', handleKey);
      popModalLayer();
    };
  }, [open]);

  if (!open) return null;

  const sheetNode = (
    <div
      onClick={() => {
        if (closeOnOverlay) onClose?.();
      }}
      style={{ zIndex: layerZ }}
      className="g-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'نافذة إجراءات'}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`g-dialog-sheet g-dialog-sheet-sticky ${maxWidth} animate-pop gap-3`}
      >
        <div className="g-sheet-handle" aria-hidden="true" />

        {(title || onClose) && (
          <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-line shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3
                  className={`text-sm sm:text-base ${arch.surfaces.headingWeight} tracking-tight text-ink m-0 truncate`}
                >
                  {title}
                </h3>
                {badge}
              </div>
              {subtitle && (
                <p className="text-xs font-normal text-ink-muted m-0 mt-0.5 truncate">
                  {subtitle}
                </p>
              )}
            </div>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="إغلاق"
                className="w-11 h-11 rounded-full bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink flex items-center justify-center shrink-0 transition-[background-color,color,transform] duration-150 ease-[var(--g-ease-out)] active:scale-95"
              >
                <Icon name="close" size={20} />
              </button>
            )}
          </div>
        )}

        <div className="g-dialog-body pe-0.5">{children}</div>

        {footer && (
          <div className="pt-3 border-t border-line shrink-0">{footer}</div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(sheetNode, document.body)
    : sheetNode;
}
