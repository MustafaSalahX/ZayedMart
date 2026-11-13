import React, { useState } from 'react';

/**
 * Context-Aware Mobile & Desktop Smart FAB (Floating Action Button + Speed-Dial).
 * Positioned on the right thumb-zone in RTL (`right-3 sm:right-6`) so it never collides
 * with `WalkieFloatingDock` on the left (`left-3 sm:left-6`).
 */
export default function SmartFab({
  activeTab,
  hasBottomNav = true,
  canWriteAttendance = false,
  canQr = false,
  canWriteShortages = false,
  canWriteTrucks = false,
  canWriteNotes = false,
  canHandover = false,
  onPrimaryAction,
  onOpenQr,
  onOpenHandover,
}) {
  const [dialOpen, setDialOpen] = useState(false);

  const primaryMeta = (() => {
    if (activeTab === 'shortages' && canWriteShortages) {
      return {
        action: 'shortage_add',
        label: 'صنف ناقص',
        icon: 'add_shopping_cart',
        tone: 'bg-[var(--g-primary-solid)] text-white shadow-[0_8px_24px_rgba(11,87,208,0.38)]',
      };
    }
    if (activeTab === 'attendance' && (canQr || canWriteAttendance)) {
      return {
        action: 'qr_scan',
        label: 'QR / كود',
        icon: 'qr_code_scanner',
        tone: 'bg-[#146C2E] text-white shadow-[0_8px_24px_rgba(20,108,46,0.38)]',
      };
    }
    if (activeTab === 'trucks' && canWriteTrucks) {
      return {
        action: 'truck_arrive',
        label: 'وصول عربية',
        icon: 'local_shipping',
        tone: 'bg-[#C25E00] text-white shadow-[0_8px_24px_rgba(194,94,0,0.38)]',
      };
    }
    if (activeTab === 'notes' && canWriteNotes) {
      return {
        action: 'note_add',
        label: 'ملاحظة',
        icon: 'add_comment',
        tone: 'bg-[var(--g-primary-solid)] text-white shadow-[0_8px_24px_rgba(11,87,208,0.38)]',
      };
    }
    if (canQr) {
      return {
        action: 'qr_scan',
        label: 'مسح سريع',
        icon: 'qr_code_scanner',
        tone: 'bg-[var(--g-primary-solid)] text-white shadow-[0_8px_24px_rgba(11,87,208,0.38)]',
      };
    }
    return null;
  })();

  const dialActions = [];
  if (canWriteShortages && primaryMeta?.action !== 'shortage_add') {
    dialActions.push({
      id: 'shortage_add',
      label: 'إضافة صنف ناقص',
      icon: 'add_shopping_cart',
      onClick: () => onPrimaryAction?.('shortage_add'),
    });
  }
  if (canQr && primaryMeta?.action !== 'qr_scan') {
    dialActions.push({
      id: 'qr_scan',
      label: 'مسح QR / كود موظف',
      icon: 'qr_code_scanner',
      onClick: () => onOpenQr?.(),
    });
  }
  if (canWriteTrucks && primaryMeta?.action !== 'truck_arrive') {
    dialActions.push({
      id: 'truck_arrive',
      label: 'تسجيل وصول عربية',
      icon: 'local_shipping',
      onClick: () => onPrimaryAction?.('truck_arrive'),
    });
  }
  if (canWriteNotes && primaryMeta?.action !== 'note_add') {
    dialActions.push({
      id: 'note_add',
      label: 'تسجيل ملاحظة',
      icon: 'add_comment',
      onClick: () => onPrimaryAction?.('note_add'),
    });
  }
  if (canHandover) {
    dialActions.push({
      id: 'handover',
      label: 'تسليم الوردية',
      icon: 'swap_horiz',
      onClick: () => onOpenHandover?.(),
    });
  }

  if (!primaryMeta && dialActions.length === 0) return null;

  return (
    <>
      {dialOpen && (
        <div
          onClick={() => setDialOpen(false)}
          className="fixed inset-0 z-30 bg-black/25 backdrop-blur-[1px]"
          aria-hidden="true"
        />
      )}

      <div
        className={`fixed right-3 sm:right-6 z-40 flex flex-col items-end gap-2 transition-all duration-200 ${
          hasBottomNav ? 'bottom-21 md:bottom-6' : 'bottom-5'
        }`}
      >
        {dialOpen && dialActions.length > 0 && (
          <div className="flex flex-col items-end gap-2 mb-1 animate-pop">
            {dialActions.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setDialOpen(false);
                  item.onClick();
                }}
                className="min-h-[44px] px-3.5 py-2 rounded-2xl bg-[var(--g-surface)] text-[var(--g-text)] border border-[var(--g-border)] shadow-lg flex items-center gap-2 text-xs font-extrabold hover:border-[var(--g-primary)] active:scale-95 cursor-pointer"
              >
                <span className="ms-icon filled text-lg text-[var(--g-primary)]">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          {dialActions.length > 0 && (
            <button
              type="button"
              onClick={() => setDialOpen((v) => !v)}
              aria-label={dialOpen ? 'إغلاق الإجراءات السريعة' : 'إجراءات سريعة إضافية'}
              aria-expanded={dialOpen}
              className="w-11 h-11 rounded-2xl bg-[var(--g-surface)] text-[var(--g-text)] border border-[var(--g-border)] shadow-md flex items-center justify-center hover:border-[var(--g-primary)] active:scale-95 transition-transform cursor-pointer"
            >
              <span
                className={`ms-icon text-xl transition-transform duration-150 ${
                  dialOpen ? 'rotate-45 text-[var(--g-red)]' : ''
                }`}
              >
                add
              </span>
            </button>
          )}

          {primaryMeta && (
            <button
              type="button"
              onClick={() => {
                setDialOpen(false);
                if (primaryMeta.action === 'qr_scan') {
                  onOpenQr?.();
                } else {
                  onPrimaryAction?.(primaryMeta.action);
                }
              }}
              className={`min-h-[52px] px-4 rounded-2xl font-black text-xs sm:text-sm flex items-center gap-2 transition-transform active:scale-95 cursor-pointer ${primaryMeta.tone}`}
            >
              <span className="ms-icon filled text-xl">{primaryMeta.icon}</span>
              <span>{primaryMeta.label}</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
