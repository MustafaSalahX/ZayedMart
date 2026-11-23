import React, { useEffect, useState } from 'react';
import { getScheduleWeekdayLabel } from '@zayed-mart/shared';
import { apiRequest, decideDayOffSwap, respondDayOffSwap } from '../lib/api.js';
import { playSuccessChime } from '../lib/audio.js';
import VoiceMicButton from './VoiceMicButton.jsx';
import { BottomSheet, Button, ConfirmSheet, GroupedList, Icon, StatusDot } from './ui/index.js';

const HANDOVER_ROLE_COPY = {
  security: {
    defaultReceiver: 'زميل الأمن بالوردية الجديدة',
    notePlaceholder: 'ملاحظة لزميل الأمن...',
    toastMsg: 'تم تسليم وردية الأمن',
  },
  cctv: {
    defaultReceiver: 'مراقب الكاميرات بالوردية الجديدة',
    notePlaceholder: 'ملاحظة لمراقب الكاميرات...',
    toastMsg: 'تم تسليم وردية الكاميرات',
  },
  supervisor: {
    defaultReceiver: 'مشرف الوردية الجديدة',
    notePlaceholder: 'ملاحظة للمشرف...',
    toastMsg: 'تم تسليم وردية الإشراف',
  },
  hall: {
    defaultReceiver: 'زميل الصالة بالوردية الجديدة',
    notePlaceholder: 'ملاحظة لزميل الصالة...',
    toastMsg: 'تم تسليم وردية الصالة',
  },
  manager: {
    defaultReceiver: 'مدير الوردية الجديدة',
    notePlaceholder: 'ملخص أو توصية للوردية القادمة...',
    toastMsg: 'تم تسليم الوردية',
  },
  owner: {
    defaultReceiver: 'مسؤول الوردية الجديدة',
    notePlaceholder: 'ملخص أو توصية للوردية القادمة...',
    toastMsg: 'تم تسليم الوردية',
  },
};

/**
 * Detoxed Operational Alerts Strip + Shift Handover Modal (`SmartAlertsAndHandoverBar`):
 * - `showBanners={false}` suppresses alert banners on Dashboard & Settings (zero double alerts)
 *   while still serving the Shift Handover modal from anywhere in the app.
 * - Replaces heavy border-2 boxes and icon squares with compact 1-line hairline rows + StatusDot.
 */
export default function SmartAlertsAndHandoverBar({
  data,
  showBanners = true,
  canAttendance = false,
  canTrucks = false,
  canHandover = false,
  canVerify = false,
  actorName,
  actorRole = '',
  showHandoverModal,
  onCloseHandoverModal,
  onJumpTab,
  onRefresh,
  onToast,
}) {
  const [, setTick] = useState(0);
  const [toOperator, setToOperator] = useState('');
  const [shiftName, setShiftName] = useState('الصباحية ← المسائية');
  const [handoverNote, setHandoverNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ackingHandover, setAckingHandover] = useState(false);
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [confirmVerifyAllOpen, setConfirmVerifyAllOpen] = useState(false);
  const [showAllAlertsMobile, setShowAllAlertsMobile] = useState(false);
  const [swapBusyId, setSwapBusyId] = useState('');
  const [rejectingSwapId, setRejectingSwapId] = useState('');
  const [rejectSwapReason, setRejectSwapReason] = useState('');

  const effectiveRole = actorRole || data?.auth?.user?.role || 'cctv';
  const roleCopy = HANDOVER_ROLE_COPY[effectiveRole] || HANDOVER_ROLE_COPY.cctv;
  const roleColleagues = data?.roleColleagues || [];

  useEffect(() => {
    if (showHandoverModal) {
      if (roleColleagues.length > 0) {
        setToOperator((prev) =>
          roleColleagues.some((c) => c.name === prev) ? prev : roleColleagues[0].name
        );
      } else {
        setToOperator(roleCopy.defaultReceiver);
      }
    }
  }, [showHandoverModal, roleColleagues, roleCopy.defaultReceiver]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  if (!data) return null;

  const maxBreak = data.settings?.max_break_minutes || 30;
  const maxUnload = data.settings?.max_unload_minutes || 60;

  const overdueBreaks = canAttendance
    ? (data.employees || []).filter((e) => {
        if (e.currentStatus !== 'on_break' || !e.latestActionTime) return false;
        const mins = Math.floor((Date.now() - new Date(e.latestActionTime).getTime()) / 60000);
        return mins > maxBreak;
      })
    : [];

  const overdueTrucks = canTrucks
    ? (data.truckLogs || []).filter((t) => {
        if (t.status !== 'unloading' || !t.arrival_time) return false;
        const mins = Math.floor((Date.now() - new Date(t.arrival_time).getTime()) / 60000);
        return mins > maxUnload;
      })
    : [];

  const pendingHandover = canHandover ? data.pendingHandover : null;
  const unverifiedCount = canVerify ? data.summary?.unverifiedAttendanceCount || 0 : 0;
  const mismatchCount = canVerify ? data.summary?.mismatchAttendanceCount || 0 : 0;
  const actionableSwaps = (data.pendingDayOffSwaps || []).filter((s) =>
    Boolean(s.awaiting_my_action)
  );

  const hasVisibleBanners =
    showBanners &&
    (Boolean(pendingHandover && canHandover) ||
      actionableSwaps.length > 0 ||
      overdueBreaks.length > 0 ||
      overdueTrucks.length > 0 ||
      Boolean(canVerify && (unverifiedCount > 0 || mismatchCount > 0)));

  if (!hasVisibleBanners && !showHandoverModal && !confirmVerifyAllOpen) {
    return null;
  }

  async function handleSwapDecision(swap, decision, reason = '') {
    if (!swap?.id || swapBusyId) return;
    setSwapBusyId(swap.id);
    try {
      const payload = { decision, ...(reason ? { reason: reason.trim() } : {}) };
      if (swap.status === 'pending_manager') {
        await decideDayOffSwap(swap.id, payload);
      } else {
        await respondDayOffSwap(swap.id, payload);
      }
      playSuccessChime(decision === 'approve' ? 'in' : 'out');
      onToast?.(decision === 'approve' ? 'تمت الموافقة على الطلب' : 'تم رفض الطلب');
      setRejectingSwapId('');
      setRejectSwapReason('');
      onRefresh?.();
      window.dispatchEvent(
        new CustomEvent('zayed:schedule-updated', { detail: { reason: 'day_off_swap' } })
      );
    } catch (err) {
      onToast?.(err.message || 'تعذر تنفيذ الإجراء', 'error');
      if (err?.status === 409) {
        setRejectingSwapId('');
        setRejectSwapReason('');
        onRefresh?.();
        window.dispatchEvent(
          new CustomEvent('zayed:schedule-updated', { detail: { reason: 'day_off_swap' } })
        );
      }
    } finally {
      setSwapBusyId('');
    }
  }

  async function handleAcknowledgeHandover(id) {
    if (ackingHandover) return;
    setAckingHandover(true);
    try {
      await apiRequest(`/api/handovers/${id}/acknowledge`, 'POST');
      playSuccessChime('in');
      onToast?.('تم استلام الوردية');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setAckingHandover(false);
    }
  }

  async function handleVerifyAllAttendance() {
    if (verifyingAll) return;
    setVerifyingAll(true);
    try {
      const res = await apiRequest('/api/attendance/verify-all', 'POST', {
        date_key: data.dateKey,
      });
      playSuccessChime('in');
      onToast?.(`تم تأكيد (${res.count}) حركة حضور`);
      setConfirmVerifyAllOpen(false);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setVerifyingAll(false);
    }
  }

  async function handleSubmitHandover(e) {
    e?.preventDefault?.();
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiRequest('/api/handovers', 'POST', {
        from_operator: actorName,
        to_operator: (toOperator || '').trim() || roleCopy.defaultReceiver,
        target_role: effectiveRole,
        shift_name: shiftName,
        summary_note: handoverNote.trim(),
      });
      playSuccessChime('in');
      onToast?.(roleCopy.toastMsg);
      setHandoverNote('');
      onCloseHandoverModal?.();
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const activeOpenTrucks = (data.truckLogs || []).filter((t) => t.status === 'unloading');
  const activeOpenNotes = (data.notes || []).filter((n) => n.is_open_handover === 1);
  const activeOpenShortages = (data.shortages || []).filter(
    (s) => s.status === 'open' || s.status === 'ordered'
  );
  const hiddenShortagesCount = Math.max(0, activeOpenShortages.length - 6);
  const hasOpenHandoverTasks =
    effectiveRole === 'hall'
      ? activeOpenShortages.length > 0
      : activeOpenTrucks.length > 0 || activeOpenNotes.length > 0;

  const bannerRows = [];

  if (showBanners) {
    if (pendingHandover && canHandover) {
      bannerRows.push({
        id: 'handover',
        node: (
          <div
            key="handover"
            className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <StatusDot tone="primary" />
                <span className="text-xs sm:text-sm font-medium text-ink truncate">
                  تسليم وردية · {pendingHandover.from_operator} → {pendingHandover.to_operator}
                </span>
              </div>
              {pendingHandover.summary_note && (
                <p className="text-xs text-ink-muted m-0 ps-4 truncate">
                  {pendingHandover.summary_note}
                </p>
              )}
              {pendingHandover.openItems?.length > 0 && (
                <div className="text-[11px] text-ink-muted ps-4 truncate">
                  {pendingHandover.openItems.map((item) => item.text).join(' · ')}
                </div>
              )}
            </div>

            <Button
              variant="primary"
              size="sm"
              loading={ackingHandover}
              onClick={() => handleAcknowledgeHandover(pendingHandover.id)}
              className="w-full sm:w-auto shrink-0"
            >
              استلام
            </Button>
          </div>
        ),
      });
    }

    if (canVerify && mismatchCount > 0) {
      bannerRows.push({
        id: 'cctv-mismatch',
        node: (
          <div
            key="cctv-mismatch"
            className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot tone="danger" />
              <span className="text-xs sm:text-sm font-medium text-ink">
                تعارض كاميرا (<span className="num-ltr font-semibold text-danger">{mismatchCount}</span>)
              </span>
            </div>
            <Button
              variant="dangerTonal"
              size="sm"
              onClick={() => onJumpTab?.('attendance', { status: 'mismatch_cctv' })}
            >
              مراجعة
            </Button>
          </div>
        ),
      });
    }

    if (overdueBreaks.length > 0) {
      bannerRows.push({
        id: 'overdue-breaks',
        node: (
          <div
            key="overdue-breaks"
            className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot tone="warning" />
              <span className="text-xs sm:text-sm font-medium text-ink truncate">
                تجاوز استراحة ({maxBreak}د) · {overdueBreaks.map((e) => e.name).join('، ')}
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onJumpTab?.('attendance', { status: 'on_break' })}
            >
              عرض
            </Button>
          </div>
        ),
      });
    }

    if (overdueTrucks.length > 0) {
      bannerRows.push({
        id: 'overdue-trucks',
        node: (
          <div
            key="overdue-trucks"
            className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot tone="warning" />
              <span className="text-xs sm:text-sm font-medium text-ink truncate">
                تأخر تفريغ ({maxUnload}د) · {overdueTrucks.map((t) => t.supplier_name).join('، ')}
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onJumpTab?.('trucks', { focusUnloading: true })}
            >
              عرض
            </Button>
          </div>
        ),
      });
    }

    actionableSwaps.forEach((swap) => {
      const isBusy = swapBusyId === swap.id;
      const isRejecting = rejectingSwapId === swap.id;
      const fromLabel = getScheduleWeekdayLabel(swap.requester_from_day);
      const toLabel = getScheduleWeekdayLabel(swap.target_from_day);

      bannerRows.push({
        id: `swap-${swap.id}`,
        node: (
          <div key={`swap-${swap.id}`} className="px-3.5 py-2.5 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusDot tone="warning" />
                  <span className="text-xs sm:text-sm font-medium text-ink truncate">
                    {swap.request_type === 'move'
                      ? `ترحيل إجازة · ${swap.requester_name || 'موظف'} (${fromLabel} ← ${toLabel})`
                      : `تبديل إجازة · ${swap.requester_name || 'موظف'} (${fromLabel}) ↔ ${swap.target_name || 'زميل'} (${toLabel})`}
                  </span>
                </div>
                {swap.reason && (
                  <div className="text-[11px] text-ink-muted ps-4 truncate">{swap.reason}</div>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="success"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => handleSwapDecision(swap, 'approve')}
                >
                  قبول
                </Button>
                <Button
                  variant="dangerTonal"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => {
                    if (isRejecting) {
                      setRejectingSwapId('');
                      setRejectSwapReason('');
                    } else {
                      setRejectingSwapId(swap.id);
                      setRejectSwapReason('');
                    }
                  }}
                >
                  رفض
                </Button>
              </div>
            </div>

            {isRejecting && (
              <div className="pt-2 border-t border-line flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="text"
                  value={rejectSwapReason}
                  onChange={(e) => setRejectSwapReason(e.target.value)}
                  placeholder="سبب الرفض (اختياري)..."
                  className="g-input flex-1"
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => handleSwapDecision(swap, 'reject', rejectSwapReason)}
                  >
                    تأكيد الرفض
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => {
                      setRejectingSwapId('');
                      setRejectSwapReason('');
                    }}
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            )}
          </div>
        ),
      });
    });

    if (canVerify && unverifiedCount > 0) {
      bannerRows.push({
        id: 'cctv-unverified',
        node: (
          <div
            key="cctv-unverified"
            className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot tone="warning" />
              <span className="text-xs sm:text-sm font-medium text-ink">
                بانتظار مراجعة الكاميرا (<span className="num-ltr font-semibold">{unverifiedCount}</span>)
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onJumpTab?.('attendance', { status: 'pending_cctv' })}
              >
                مراجعة
              </Button>
              <Button
                variant="success"
                size="sm"
                loading={verifyingAll}
                onClick={() => setConfirmVerifyAllOpen(true)}
              >
                اعتماد الكل
              </Button>
            </div>
          </div>
        ),
      });
    }
  }

  const hiddenAlertsCount = Math.max(0, bannerRows.length - 2);

  return (
    <>
      {bannerRows.length > 0 && (
        <div className="mb-4">
          <GroupedList>
            {bannerRows.map((b, idx) => (
              <div
                key={b.id}
                className={idx >= 2 && !showAllAlertsMobile ? 'hidden md:block' : ''}
              >
                {b.node}
              </div>
            ))}
          </GroupedList>

          {hiddenAlertsCount > 0 && (
            <div className="md:hidden mt-1.5">
              <button
                type="button"
                onClick={() => setShowAllAlertsMobile((v) => !v)}
                className="w-full min-h-[40px] text-xs font-medium text-ink-muted hover:text-ink flex items-center justify-center gap-1 cursor-pointer"
              >
                <Icon
                  name={showAllAlertsMobile ? 'expand_less' : 'expand_more'}
                  size={16}
                />
                <span>
                  {showAllAlertsMobile ? 'أقل' : `+${hiddenAlertsCount} تنبيهات أخرى`}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Confirm Bulk CCTV Verify-All Sheet */}
      <ConfirmSheet
        open={confirmVerifyAllOpen}
        onClose={() => setConfirmVerifyAllOpen(false)}
        onConfirm={handleVerifyAllAttendance}
        loading={verifyingAll}
        tone="success"
        title="اعتماد مطابقة الكاميرا للكل"
        description={`اعتماد جميع حركات الحضور غير المراجعة اليوم (${unverifiedCount}).`}
        confirmLabel="اعتماد الكل"
      />

      {/* Global Shift Handover BottomSheet */}
      <BottomSheet
        open={Boolean(showHandoverModal)}
        onClose={submitting ? undefined : onCloseHandoverModal}
        title="تسليم الوردية"
        maxWidth="max-w-lg"
        footer={
          <Button
            type="submit"
            form="zayed-handover-form"
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
          >
            تسليم الوردية
          </Button>
        }
      >
        <form id="zayed-handover-form" onSubmit={handleSubmitHandover} className="space-y-4">
          {hasOpenHandoverTasks && (
            <div className="p-3 rounded-[var(--g-radius-md)] bg-surface-2 border border-line space-y-1.5">
              <div className="text-xs font-semibold text-ink-muted">المهام المفتوحة</div>
              {effectiveRole === 'hall' ? (
                <div className="space-y-1">
                  <ul className="m-0 ps-4 list-disc text-xs space-y-1 text-ink max-h-28 overflow-y-auto">
                    {activeOpenShortages.slice(0, 6).map((s) => (
                      <li key={s.id}>
                        {s.item_name} ({s.category})
                      </li>
                    ))}
                  </ul>
                  {hiddenShortagesCount > 0 && (
                    <div className="text-[11px] font-medium text-ink-muted num-ltr">
                      +{hiddenShortagesCount} أصناف أخرى
                    </div>
                  )}
                </div>
              ) : (
                <ul className="m-0 ps-4 list-disc text-xs space-y-1 text-ink max-h-28 overflow-y-auto">
                  {activeOpenTrucks.map((t) => (
                    <li key={t.id}>عربية {t.supplier_name} (قيد التنزيل)</li>
                  ))}
                  {activeOpenNotes.map((n) => (
                    <li key={n.id}>
                      {n.location_tag} · {n.content}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1 text-ink-muted">الوردية</label>
            <select
              value={shiftName}
              onChange={(e) => setShiftName(e.target.value)}
              className="g-input w-full"
            >
              <option>الصباحية ← المسائية</option>
              <option>المسائية ← الليلية</option>
              <option>الليلية ← الصباحية</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-ink-muted">المسلِّم</label>
              <input
                type="text"
                readOnly
                value={actorName || ''}
                className="g-input w-full bg-surface-2 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1 text-ink-muted">المستلِم</label>
              <select
                required
                value={toOperator}
                onChange={(e) => setToOperator(e.target.value)}
                className="g-input w-full"
              >
                {roleColleagues.map((col) => (
                  <option key={col.id} value={col.name}>
                    {col.name}
                    {col.role_title ? ` (${col.role_title})` : ''}
                  </option>
                ))}
                <option value={roleCopy.defaultReceiver}>{roleCopy.defaultReceiver}</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="text-xs font-medium text-ink-muted">ملاحظة</label>
              <VoiceMicButton
                small
                onToast={onToast}
                onTranscript={(txt) =>
                  setHandoverNote((prev) => (prev ? `${prev} ${txt}` : txt))
                }
              />
            </div>
            <textarea
              rows={2}
              value={handoverNote}
              onChange={(e) => setHandoverNote(e.target.value)}
              placeholder={roleCopy.notePlaceholder}
              className="g-input w-full resize-none"
            />
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
