import React from 'react';
import BottomSheet from './BottomSheet.jsx';
import Button from './Button.jsx';

const TONE_META = {
  danger: { icon: 'warning', btnVariant: 'danger', box: 'bg-danger-bg text-danger' },
  warning: { icon: 'help', btnVariant: 'warning', box: 'bg-warning-bg text-warning' },
  primary: { icon: 'task_alt', btnVariant: 'primary', box: 'bg-primary-container text-primary' },
  success: { icon: 'verified', btnVariant: 'success', box: 'bg-success-bg text-success' },
};

/**
 * Native-feeling confirmation sheet replacing blocking `window.confirm()` dialogs
 * across operational actions (check-out, delete, urgent broadcast, bulk verify, kiosk logout).
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
  const meta = TONE_META[tone] || TONE_META.danger;
  const resolvedIcon = icon || meta.icon;

  return (
    <BottomSheet
      open={open}
      onClose={loading ? undefined : onClose}
      title={title}
      icon={resolvedIcon}
      maxWidth="max-w-md"
      closeOnOverlay={!loading}
      footer={
        <div className="flex items-center gap-2.5">
          <Button
            variant="secondary"
            fullWidth
            disabled={loading}
            onClick={onClose}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={meta.btnVariant}
            fullWidth
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 py-1">
        {description && (
          <p className="text-xs sm:text-sm font-semibold text-ink-muted leading-relaxed m-0">
            {description}
          </p>
        )}
        {children}
      </div>
    </BottomSheet>
  );
}
