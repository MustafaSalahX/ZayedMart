import React, { useEffect, useMemo, useRef, useState } from 'react';
import { postActionWithOfflineSupport } from '../lib/api.js';
import { playSuccessChime, speakArabicConfirmation } from '../lib/audio.js';
import {
  BottomSheet,
  BrandLogo,
  Button,
  ConfirmSheet,
  EmptyState,
  FilterChipRail,
  Icon,
  RoleAvatar,
  SearchFilterBar,
  StatusDot,
} from './ui/index.js';

/**
 * Bright-Daylight Worker Kiosk Attendance Terminal (`KioskLockView`):
 * Locked to `data-theme="classic" data-mode="light" data-kiosk="true"` for wall-tablet glare resistance.
 */
export default function KioskLockView({
  storeName = 'زايد مارت',
  employees = [],
  onOpenQrModal,
  onRefresh,
  onExitKiosk,
}) {
  const [selectedDept, setSelectedDept] = useState('الكل');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [successBanner, setSuccessBanner] = useState(null);
  const [errorBanner, setErrorBanner] = useState('');
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const successTimerRef = useRef(null);
  const errorTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const deptChipItems = useMemo(() => {
    const counts = new Map();
    employees.forEach((e) => {
      const d = e.department || 'عام';
      counts.set(d, (counts.get(d) || 0) + 1);
    });
    return [
      { id: 'الكل', label: 'الكل', count: employees.length },
      ...Array.from(counts.entries()).map(([dept, count]) => ({
        id: dept,
        label: dept,
        count,
      })),
    ];
  }, [employees]);

  const list = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((e) => {
      if (selectedDept !== 'الكل' && e.department !== selectedDept) return false;
      if (q && !`${e.name} ${e.emp_code || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [employees, selectedDept, searchQuery]);

  function showKioskError(msg) {
    setErrorBanner(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorBanner(''), 3800);
  }

  async function recordKioskAction(emp, actionType) {
    if (submitting) return;
    setSubmitting(true);
    try {
      await postActionWithOfflineSupport('/api/attendance', {
        employee_id: emp.id,
        action_type: actionType,
        recorded_by: 'كشك العمال',
      });

      const label =
        actionType === 'check_in'
          ? 'حضور'
          : actionType === 'break_start'
          ? 'بداية بريك'
          : actionType === 'break_end'
          ? 'عودة من البريك'
          : 'انصراف';

      playSuccessChime(actionType === 'check_out' ? 'out' : 'in');
      speakArabicConfirmation(`شكراً يا ${emp.name}، تم تسجيل ${label}`, true);

      setSelectedEmp(null);
      setSuccessBanner({
        name: emp.name,
        label,
        tone:
          actionType === 'check_out'
            ? 'bg-danger-solid text-on-danger'
            : 'bg-success-solid text-on-success',
      });
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccessBanner(null), 2600);
      onRefresh?.();
    } catch (err) {
      const msg = err?.message || 'تعذر تنفيذ الحركة حالياً';
      speakArabicConfirmation(msg, true);
      showKioskError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-theme="classic"
      data-mode="light"
      data-kiosk="true"
      className="min-h-[100dvh] bg-canvas text-ink flex flex-col pt-[var(--safe-top)] pb-[var(--safe-bottom)]"
    >
      <div className="google-brand-bar" />

      <div className="p-3 sm:p-6 flex flex-col gap-4 max-w-7xl w-full mx-auto">
        {/* Top Kiosk Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-line">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo alt={storeName || 'زايد مارت'} size="md" />
            <h1 className="text-lg sm:text-xl font-bold text-ink m-0 truncate">
              حضور {storeName}
            </h1>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              variant="primary"
              size="lg"
              icon="qr_code_scanner"
              iconFilled
              onClick={() => onOpenQrModal?.('scan')}
              className="flex-1 sm:flex-none"
            >
              QR / رمز سريع
            </Button>

            <Button
              variant="secondary"
              size="lg"
              icon="lock_open"
              onClick={() => setConfirmExitOpen(true)}
            >
              خروج
            </Button>
          </div>
        </div>

        {/* Non-blocking Kiosk Error Banner */}
        {errorBanner && (
          <div
            role="alert"
            onClick={() => setErrorBanner('')}
            className="p-3 rounded-[var(--g-radius-md)] bg-danger-bg border border-[var(--g-red-border)] text-danger flex items-center justify-between gap-2.5 animate-pop cursor-pointer"
          >
            <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold">
              <StatusDot tone="danger" />
              <span>{errorBanner}</span>
            </div>
            <Icon name="close" size={16} className="shrink-0" />
          </div>
        )}

        {employees.length > 6 && (
          <SearchFilterBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="بحث بالاسم أو الكود..."
          />
        )}

        {deptChipItems.length > 2 && (
          <FilterChipRail
            items={deptChipItems}
            activeId={selectedDept}
            onSelect={setSelectedDept}
          />
        )}

        {/* Employee Touch Grid */}
        {employees.length === 0 ? (
          <EmptyState icon="group_add" title="لا يوجد موظفون بعد" />
        ) : list.length === 0 ? (
          <EmptyState
            icon="person_search"
            title="لا توجد نتائج مطابقة"
            actionLabel="عرض الكل"
            actionIcon="refresh"
            onAction={() => {
              setSelectedDept('الكل');
              setSearchQuery('');
            }}
          />
        ) : (
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {list.map((emp) => {
              const statusTone =
                emp.currentStatus === 'present'
                  ? 'success'
                  : emp.currentStatus === 'on_break'
                  ? 'warning'
                  : emp.currentStatus === 'checked_out'
                  ? 'danger'
                  : 'neutral';

              const statusText =
                emp.currentStatus === 'present'
                  ? 'حاضر'
                  : emp.currentStatus === 'on_break'
                  ? 'في بريك'
                  : emp.currentStatus === 'checked_out'
                  ? emp.nextCheckInAvailability?.canCheckIn
                    ? 'شفت جديد'
                    : `منصرف · يفتح ${emp.nextCheckInAvailability?.windowOpenTimeStr || emp.shift_start || '08:00'}`
                  : 'تسجيل حضور';

              return (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => setSelectedEmp(emp)}
                  className="g-card g-card-interactive p-4 sm:p-5 flex flex-col items-center text-center gap-2.5"
                >
                  <RoleAvatar
                    src={emp.avatar_url}
                    name={emp.name}
                    role={emp.system_role}
                    color={emp.avatar_color}
                    preset={emp.avatar_preset || 'initials_gradient'}
                    size="lg"
                    shape="squircle"
                    online={emp.currentStatus === 'present'}
                  />
                  <div className="min-w-0 w-full">
                    <div className="font-semibold text-sm sm:text-base text-ink leading-snug truncate">
                      {emp.name}
                    </div>
                    <div className="text-xs text-ink-muted mt-0.5 truncate">
                      {emp.department} · <span className="num-ltr">#{emp.emp_code}</span>
                    </div>
                  </div>
                  <StatusDot tone={statusTone} label={statusText} tintedText />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Employee Kiosk Action Sheet */}
      <BottomSheet
        open={Boolean(selectedEmp)}
        onClose={submitting ? undefined : () => setSelectedEmp(null)}
        title={selectedEmp?.name || ''}
        subtitle={
          selectedEmp ? `${selectedEmp.department} · #${selectedEmp.emp_code}` : ''
        }
        maxWidth="max-w-md"
        footer={
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            disabled={submitting}
            onClick={() => setSelectedEmp(null)}
          >
            رجوع
          </Button>
        }
      >
        {selectedEmp && (
          <div className="space-y-4 py-1 text-center">
            <div className="flex justify-center">
              <RoleAvatar
                src={selectedEmp.avatar_url}
                name={selectedEmp.name}
                role={selectedEmp.system_role}
                color={selectedEmp.avatar_color}
                preset={selectedEmp.avatar_preset || 'initials_gradient'}
                size="xl"
                shape="squircle"
                online={selectedEmp.currentStatus === 'present'}
              />
            </div>

            <div className="grid grid-cols-1 gap-3">
              {(!selectedEmp.currentStatus || selectedEmp.currentStatus === 'absent') && (
                <Button
                  variant="success"
                  size="lg"
                  fullWidth
                  icon="how_to_reg"
                  iconFilled
                  loading={submitting}
                  onClick={() => recordKioskAction(selectedEmp, 'check_in')}
                  className="min-h-[60px] text-lg"
                >
                  تسجيل حضور
                </Button>
              )}

              {selectedEmp.currentStatus === 'present' && (
                <>
                  <div className="py-2 flex items-center justify-center">
                    <StatusDot tone="success" label="حاضر الآن" tintedText />
                  </div>
                  <Button
                    variant="warning"
                    size="lg"
                    fullWidth
                    icon="free_breakfast"
                    iconFilled
                    loading={submitting}
                    onClick={() => recordKioskAction(selectedEmp, 'break_start')}
                    className="min-h-[56px] text-base"
                  >
                    بداية بريك
                  </Button>
                  <Button
                    variant="danger"
                    size="lg"
                    fullWidth
                    icon="logout"
                    iconFilled
                    loading={submitting}
                    onClick={() => recordKioskAction(selectedEmp, 'check_out')}
                    className="min-h-[60px] text-lg"
                  >
                    تسجيل انصراف
                  </Button>
                </>
              )}

              {selectedEmp.currentStatus === 'on_break' && (
                <>
                  <div className="py-2 flex items-center justify-center">
                    <StatusDot tone="warning" label="في بريك" tintedText />
                  </div>
                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    icon="play_arrow"
                    iconFilled
                    loading={submitting}
                    onClick={() => recordKioskAction(selectedEmp, 'break_end')}
                    className="min-h-[60px] text-lg"
                  >
                    عودة من البريك
                  </Button>
                  <Button
                    variant="danger"
                    size="lg"
                    fullWidth
                    icon="logout"
                    iconFilled
                    loading={submitting}
                    onClick={() => recordKioskAction(selectedEmp, 'check_out')}
                    className="min-h-[56px] text-base"
                  >
                    تسجيل انصراف
                  </Button>
                </>
              )}

              {selectedEmp.currentStatus === 'checked_out' && (
                <>
                  {selectedEmp.nextCheckInAvailability?.canCheckIn ? (
                    <Button
                      variant="success"
                      size="lg"
                      fullWidth
                      icon="how_to_reg"
                      iconFilled
                      loading={submitting}
                      onClick={() => recordKioskAction(selectedEmp, 'check_in')}
                      className="min-h-[60px] text-lg"
                    >
                      حضور الشفت الجديد
                    </Button>
                  ) : (
                    <div className="p-4 rounded-[var(--g-radius-md)] bg-danger-bg text-danger border border-[var(--g-red-border)] space-y-1">
                      <div className="font-semibold text-sm">تم الانصراف من هذا الشفت</div>
                      <p className="text-xs m-0">
                        {selectedEmp.nextCheckInAvailability?.lockReasonArabic ||
                          `يفتح الشفت القادم الساعة ${
                            selectedEmp.nextCheckInAvailability?.windowOpenTimeStr ||
                            selectedEmp.shift_start ||
                            '08:00'
                          }`}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Confirm Exit Kiosk Mode Sheet */}
      <ConfirmSheet
        open={confirmExitOpen}
        onClose={() => setConfirmExitOpen(false)}
        onConfirm={() => {
          setConfirmExitOpen(false);
          onExitKiosk?.();
        }}
        tone="warning"
        title="الخروج من وضع الكشك"
        description="العودة إلى شاشة تسجيل الدخول؟"
        confirmLabel="خروج"
      />

      {/* Full-Screen Confirmation Overlay */}
      {successBanner && (
        <div
          role="status"
          aria-live="polite"
          onClick={() => setSuccessBanner(null)}
          className={`fixed inset-0 z-[60] ${successBanner.tone} flex flex-col items-center justify-center p-6 text-center animate-pop cursor-pointer`}
        >
          <Icon name="check_circle" size={80} filled />
          <h2 className="text-3xl sm:text-4xl font-bold mt-4 mb-2">
            تم تسجيل {successBanner.label}
          </h2>
          <p className="text-xl sm:text-2xl opacity-95 font-medium">{successBanner.name}</p>
        </div>
      )}
    </div>
  );
}
