import React, { useEffect, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import { cn } from '../../lib/utils.js';
import { popModalLayer, pushModalLayer } from './BottomSheet.jsx';
import Button from './Button.jsx';
import Icon from './Icon.jsx';

const TONE_META = {
  danger: { icon: 'warning', btnVariant: 'danger', box: 'bg-danger-bg text-danger' },
  warning: { icon: 'help', btnVariant: 'warning', box: 'bg-warning-bg text-warning' },
  primary: { icon: 'task_alt', btnVariant: 'primary', box: 'bg-primary-container text-primary' },
  success: { icon: 'verified', btnVariant: 'success', box: 'bg-success-bg text-success' },
};

/**
 * Native-feeling accessible confirmation sheet backed by `@radix-ui/react-alert-dialog`
 * replacing blocking browser confirm dialogs across operational actions.
 */
export default function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title = 'تأكيد الإجراء',
  description = '',
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  tone = 'danger',
  icon = '',
  loading = false,
  children = null,
}) {
  const arch = useThemeArchitecture();
  const [layerZ, setLayerZ] = useState(62);
  const meta = TONE_META[tone] || TONE_META.danger;
  const resolvedIcon = icon || meta.icon;

  useEffect(() => {
    if (!open) return undefined;
    const z = pushModalLayer();
    setLayerZ(z);
    return () => {
      popModalLayer();
    };
  }, [open]);

  return (
    <AlertDialog.Root
      open={Boolean(open)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) {
          onClose?.();
        }
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          style={{ zIndex: layerZ }}
          className="g-modal-overlay g-radix-overlay"
        >
          <AlertDialog.Content
            onEscapeKeyDown={(e) => {
              if (loading) {
                e.preventDefault();
              }
            }}
            data-confirm-icon={resolvedIcon}
            className="g-dialog-sheet g-dialog-sheet-sticky max-w-md g-radix-dialog gap-3 focus:outline-none"
          >
            <div className="g-sheet-handle" aria-hidden="true" />

            <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-line shrink-0">
              <AlertDialog.Title
                className={cn(
                  'text-sm sm:text-base tracking-tight text-ink m-0 truncate',
                  arch.surfaces.headingWeight
                )}
              >
                {title || 'تأكيد الإجراء'}
              </AlertDialog.Title>

              {onClose && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    if (!loading) onClose?.();
                  }}
                  aria-label="إغلاق"
                  className="w-11 h-11 rounded-full bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink flex items-center justify-center shrink-0 transition-[background-color,color,transform] duration-150 ease-[var(--g-ease-out)] active:scale-95 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Icon name="close" size={20} />
                </button>
              )}
            </div>

            <div className="g-dialog-body pe-0.5">
              <div className="space-y-3 py-1">
                {description && (
                  <AlertDialog.Description className="text-xs sm:text-sm font-semibold text-ink-muted leading-relaxed m-0">
                    {description}
                  </AlertDialog.Description>
                )}
                {children}
              </div>
            </div>

            <div className="pt-3 border-t border-line shrink-0">
              <div className="flex items-center gap-2.5">
                <AlertDialog.Cancel asChild>
                  <Button
                    variant="secondary"
                    fullWidth
                    disabled={loading}
                  >
                    {cancelLabel}
                  </Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <Button
                    variant={meta.btnVariant}
                    fullWidth
                    loading={loading}
                    onClick={(e) => {
                      e.preventDefault();
                      onConfirm?.();
                    }}
                  >
                    {confirmLabel}
                  </Button>
                </AlertDialog.Action>
              </div>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
