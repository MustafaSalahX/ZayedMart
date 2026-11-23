import React, { useEffect, useState } from 'react';
import { useThemeArchitecture } from '../../lib/themeContext.jsx';
import Icon from './Icon.jsx';

/**
 * Scroll-Aware Context Mobile FAB (`md:hidden`):
 * - Stays hidden at top of page (where the inline header CTA already lives), preventing clutter
 * - Appears cleanly once the user scrolls down (> 220px) for instant one-thumb reach
 * - Tagged with `.g-floating-chrome` so it automatically hides behind open sheets/modals
 */
export default function SmartFab({
  activeTab,
  hasBottomNav = true,
  canWriteAttendance = false,
  canQr = false,
  canWriteShortages = false,
  canWriteTrucks = false,
  canWriteNotes = false,
  canSwapSchedule = false,
  onPrimaryAction,
  onOpenQr,
}) {
  const arch = useThemeArchitecture();
  const [scrolledPast, setScrolledPast] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const checkScroll = () => {
      setScrolledPast(window.scrollY > 220);
    };
    checkScroll();
    window.addEventListener('scroll', checkScroll, { passive: true });
    return () => window.removeEventListener('scroll', checkScroll);
  }, [activeTab]);

  if (
    !scrolledPast ||
    activeTab === 'settings' ||
    activeTab === 'dashboard' ||
    activeTab === 'chat'
  ) {
    return null;
  }

  const primaryMeta = (() => {
    if (activeTab === 'schedule' && canSwapSchedule) {
      return { action: 'schedule_swap', label: 'تبديل', icon: 'swap_horiz' };
    }
    if (activeTab === 'shortages' && canWriteShortages) {
      return { action: 'shortage_add', label: 'صنف', icon: 'add' };
    }
    if (activeTab === 'attendance' && (canQr || canWriteAttendance)) {
      return { action: 'qr_scan', label: 'QR', icon: 'qr_code_scanner' };
    }
    if (activeTab === 'trucks' && canWriteTrucks) {
      return { action: 'truck_arrive', label: 'عربية', icon: 'add' };
    }
    if (activeTab === 'notes' && canWriteNotes) {
      return { action: 'note_add', label: 'ملاحظة', icon: 'add' };
    }
    if (canQr) {
      return { action: 'qr_scan', label: 'QR', icon: 'qr_code_scanner' };
    }
    return null;
  })();

  if (!primaryMeta) return null;

  const bottomPositionClass = hasBottomNav
    ? 'bottom-[calc(var(--bottom-nav-h)+0.75rem)]'
    : 'bottom-[calc(1.25rem+var(--safe-bottom))]';

  const isMinimal = arch.id === 'minimal';
  const isGlass = arch.id === 'liquid-glass';

  const surfaceCls = isMinimal
    ? 'bg-primary-solid text-on-primary border border-line shadow-sm'
    : isGlass
    ? 'g-btn-primary bg-primary-solid text-on-primary shadow-[var(--g-shadow-fab)]'
    : 'bg-primary-solid hover:bg-primary-solid-hover text-on-primary shadow-[var(--g-shadow-fab)]';

  return (
    <div className={`md:hidden fixed g-floating-chrome z-40 right-3.5 ${bottomPositionClass} animate-pop`}>
      <button
        type="button"
        aria-label={primaryMeta.label}
        title={primaryMeta.label}
        onClick={() => {
          if (primaryMeta.action === 'qr_scan') {
            onOpenQr?.();
          } else {
            onPrimaryAction?.(primaryMeta.action);
          }
        }}
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-[transform,opacity] duration-150 ease-[var(--g-ease-out)] active:scale-[0.95] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-ring-focus)] ${surfaceCls}`}
      >
        <Icon name={primaryMeta.icon} size={22} />
      </button>
    </div>
  );
}
