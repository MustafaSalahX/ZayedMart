import React, { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api.js';
import { playSuccessChime } from '../lib/audio.js';
import VoiceMicButton from './VoiceMicButton.jsx';

const HANDOVER_ROLE_COPY = {
  security: {
    modalTitle: 'تسليم وردية الأمن لفرد الأمن التالي',
    modalSubtitle: 'تنتقل العربيات المفتوحة وملاحظات البوابة تلقائياً لزميل الأمن في الوردية الجديدة',
    receiverLabel: 'اسم المستلِم (فرد الأمن بالوردية الجديدة) *',
    defaultReceiver: 'زميل الأمن بالوردية الجديدة',
    noteLabel: 'ملاحظة وتوصية لزميل الأمن الجديد (اختياري)',
    notePlaceholder: 'مثال: راجع عربية الألبان على الرصيف وبوابة المخزن الخلفية...',
    toastMsg: 'تم تسليم وردية الأمن ونقل المهام المفتوحة لزميل الأمن الجديد ✓',
  },
  cctv: {
    modalTitle: 'تسليم وردية الكاميرات لمراقب الكاميرات التالي',
    modalSubtitle: 'تنتقل المهام والعربيات المفتوحة تلقائياً لشاشة مراقب الكاميرات الجديد',
    receiverLabel: 'اسم المستلِم (مراقب الكاميرات بالوردية الجديدة) *',
    defaultReceiver: 'مراقب الكاميرات بالوردية الجديدة',
    noteLabel: 'ملاحظة وتوصية لمراقب الكاميرات الجديد (اختياري)',
    notePlaceholder: 'مثال: راجع كاميرا الكاشير رقم 2 وعربية المجمدات...',
    toastMsg: 'تم تسليم وردية الكاميرات ونقل المهام المفتوحة للمراقب الجديد ✓',
  },
  supervisor: {
    modalTitle: 'تسليم وردية الإشراف للمشرف التالي',
    modalSubtitle: 'تنتقل المهام المفتوحة والنواقص والعربيات تلقائياً للمشرف الجديد',
    receiverLabel: 'اسم المستلِم (المشرف بالوردية الجديدة) *',
    defaultReceiver: 'مشرف الوردية الجديدة',
    noteLabel: 'ملاحظة وتوصية للمشرف الجديد (اختياري)',
    notePlaceholder: 'مثال: تابع نواقص قسم الألبان واستلام طلبية البقالة...',
    toastMsg: 'تم تسليم وردية الإشراف للمشرف الجديد بنجاح ✓',
  },
  hall: {
    modalTitle: 'تسليم وردية الصالة لزميل الصالة التالي',
    modalSubtitle: 'تنتقل قائمة النواقص المفتوحة والأصناف المطلوبة تلقائياً لزميل الصالة الجديد',
    receiverLabel: 'اسم المستلِم (زميل الصالة بالوردية الجديدة) *',
    defaultReceiver: 'زميل الصالة بالوردية الجديدة',
    noteLabel: 'ملاحظة وتوصية لزميل الصالة الجديد (اختياري)',
    notePlaceholder: 'مثال: تم رص ممر الزيوت وباقي نواقص الجبن والثلاجة...',
    toastMsg: 'تم تسليم وردية الصالة لزميل الوردية الجديدة بنجاح ✓',
  },
  manager: {
    modalTitle: 'تسليم الوردية للمدير / المسؤول التالي',
    modalSubtitle: 'تنتقل جميع المهام التشغيلية المفتوحة تلقائياً للوردية الإدارية القادمة',
    receiverLabel: 'اسم المستلِم (المدير / المشرف بالوردية الجديدة) *',
    defaultReceiver: 'مدير الوردية الجديدة',
    noteLabel: 'ملاحظة وتوصية للوردية القادمة (اختياري)',
    notePlaceholder: 'مثال: ملخص تشغيل الوردية وأهم الملاحظات العاجلة...',
    toastMsg: 'تم تسليم الوردية الإدارية بنجاح ✓',
  },
  owner: {
    modalTitle: 'تسليم الوردية للمدير / المسؤول التالي',
    modalSubtitle: 'تنتقل جميع المهام التشغيلية المفتوحة تلقائياً للوردية الإدارية القادمة',
    receiverLabel: 'اسم المستلِم (المدير / المشرف بالوردية الجديدة) *',
    defaultReceiver: 'مسؤول الوردية الجديدة',
    noteLabel: 'ملاحظة وتوصية للوردية القادمة (اختياري)',
    notePlaceholder: 'مثال: ملخص تشغيل الوردية وأهم الملاحظات العاجلة...',
    toastMsg: 'تم تسليم الوردية بنجاح ✓',
  },
};

/**
 * شريط التنبيهات الذكية التلقائية وتسليم الوردية ومطابقة الكاميرا (المميزات #1 و #3 و #6)
 */
export default function SmartAlertsAndHandoverBar({
  data,
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
  const [shiftName, setShiftName] = useState('الوردية الصباحية ← المسائية');
  const [handoverNote, setHandoverNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const effectiveRole = actorRole || data?.auth?.user?.role || 'cctv';
  const roleCopy = HANDOVER_ROLE_COPY[effectiveRole] || HANDOVER_ROLE_COPY.cctv;
  const roleColleagues = data?.roleColleagues || [];

  // Default receiver dropdown to first colleague of the same role when modal opens
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

  // Live tick every 15s for Smart Timers
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

  const hasVisibleBanners =
    Boolean(pendingHandover && canHandover) ||
    overdueBreaks.length > 0 ||
    overdueTrucks.length > 0 ||
    Boolean(canVerify && unverifiedCount > 0);

  if (!hasVisibleBanners && !showHandoverModal) {
    return null;
  }

  async function handleAcknowledgeHandover(id) {
    try {
      await apiRequest(`/api/handovers/${id}/acknowledge`, 'POST');
      playSuccessChime('in');
      onToast?.('تم تأكيد استلام الوردية والاطلاع على كافة المهام المفتوحة ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleVerifyAllAttendance() {
    try {
      const res = await apiRequest('/api/attendance/verify-all', 'POST', {
        date_key: data.dateKey,
      });
      playSuccessChime('in');
      onToast?.(`تم ختم مطابقة الكاميرا لـ (${res.count}) حركة حضور بنجاح ✓`);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleSubmitHandover(e) {
    e.preventDefault();
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

  return (
    <>
      <div className="space-y-2.5 mb-4">
        {/* 1. Incoming Shift Handover Banner (Feature #1) */}
        {pendingHandover && canHandover && (
          <div className="g-card p-4 border-2 border-[var(--g-primary)] bg-[var(--g-primary-container)]/35 animate-pop">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-extrabold text-sm sm:text-base text-[var(--g-primary)]">
                  <span className="ms-icon filled">swap_horiz</span>
                  <span>
                    تسليم وردية جديد من ({pendingHandover.from_operator}) إلى (
                    {pendingHandover.to_operator}) — {pendingHandover.shift_name}
                  </span>
                </div>
                {pendingHandover.summary_note && (
                  <p className="text-xs sm:text-sm font-semibold m-0">
                    💬 ملاحظة التسليم: "{pendingHandover.summary_note}"
                  </p>
                )}
                {pendingHandover.openItems?.length > 0 ? (
                  <ul className="m-0 pt-1 pr-4 text-xs space-y-0.5 font-medium">
                    {pendingHandover.openItems.map((item, idx) => (
                      <li key={idx}>{item.text}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--g-muted)] m-0">
                    لا توجد مهام معلقة وقت تسليم الوردية.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleAcknowledgeHandover(pendingHandover.id)}
                className="px-4 py-2.5 rounded-full bg-[var(--g-primary)] text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 shrink-0 shadow-xs"
              >
                <span className="ms-icon filled text-lg">task_alt</span>
                <span>استلام الوردية وتأكيد الاطلاع ✓</span>
              </button>
            </div>
          </div>
        )}

        {/* 2. Smart Timers Automatic Orange Alert (Feature #6) */}
        {(overdueBreaks.length > 0 || overdueTrucks.length > 0) && (
          <div className="p-3.5 rounded-2xl g-smart-timer-orange flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 animate-pop">
            <div className="flex items-start gap-2.5">
              <span className="ms-icon filled text-2xl text-[var(--g-orange-text)] shrink-0 mt-0.5">
                alarm
              </span>
              <div className="text-xs sm:text-sm font-bold text-[var(--g-orange-text)] space-y-0.5">
                {overdueBreaks.length > 0 && (
                  <div>
                    ⏰ تنبيه وقت الاستراحة: تجاوز ({overdueBreaks.map((e) => e.name).join('، ')})
                    الحد المسموح ({maxBreak} دقيقة)!
                  </div>
                )}
                {overdueTrucks.length > 0 && (
                  <div>
                    🚛 تنبيه تأخر تنزيل بضاعة: تجاوزت عربية (
                    {overdueTrucks.map((t) => t.supplier_name).join('، ')}) أكثر من {maxUnload}{' '}
                    دقيقة!
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {overdueBreaks.length > 0 && (
                <button
                  type="button"
                  onClick={() => onJumpTab?.('attendance', { status: 'on_break' })}
                  className="px-3.5 py-2 rounded-full bg-[var(--g-surface)] text-xs font-extrabold border-2 border-[var(--g-orange-border)] active:scale-95 transition-transform cursor-pointer"
                >
                  عرض الاستراحات ({overdueBreaks.length})
                </button>
              )}
              {overdueTrucks.length > 0 && (
                <button
                  type="button"
                  onClick={() => onJumpTab?.('trucks', { focusUnloading: true })}
                  className="px-3.5 py-2 rounded-full bg-[var(--g-surface)] text-xs font-extrabold border-2 border-[var(--g-orange-border)] active:scale-95 transition-transform cursor-pointer"
                >
                  عرض العربيات ({overdueTrucks.length})
                </button>
              )}
            </div>
          </div>
        )}

        {/* 3. CCTV Buddy-Punching Guard Quick Strip (Feature #3) */}
        {canVerify && unverifiedCount > 0 && (
          <div className="g-card px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-[var(--g-yellow-bg)]/45 border-[var(--g-orange-border)]/50">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-[var(--g-yellow)]">
              <span className="ms-icon filled text-xl">policy</span>
              <span>
                يوجد <strong>{unverifiedCount}</strong> حركة حضور مسجلة بدون كاميرا بانتظار مطابقة
                مراقب الكاميرات
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onJumpTab?.('attendance', { status: 'all' })}
                className="px-3 py-1.5 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] text-xs font-bold"
              >
                مراجعة فردية
              </button>
              <button
                type="button"
                onClick={handleVerifyAllAttendance}
                className="px-3.5 py-1.5 rounded-full bg-[#146C2E] text-white text-xs font-extrabold flex items-center gap-1"
              >
                <span className="ms-icon filled text-sm">verified</span>
                <span>تمت المطابقة بالكاميرا للكل ✓</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Global Shift Handover Modal (Role-Aware: Security -> Security, CCTV -> CCTV, Supervisor -> Supervisor, Hall -> Hall) */}
      {showHandoverModal && (
        <div onClick={onCloseHandoverModal} className="g-modal-overlay">
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmitHandover}
            className="g-dialog-sheet max-w-lg animate-pop space-y-4"
          >
            <div className="g-sheet-handle" />
            <div className="flex items-center justify-between border-b border-[var(--g-border)] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] flex items-center justify-center shrink-0">
                  <span className="ms-icon filled">swap_horiz</span>
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-extrabold m-0">
                    {roleCopy.modalTitle}
                  </h3>
                  <p className="text-xs text-[var(--g-muted)] m-0">
                    {roleCopy.modalSubtitle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCloseHandoverModal}
                className="w-9 h-9 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center shrink-0"
              >
                <span className="ms-icon">close</span>
              </button>
            </div>

            {/* Live Open Tasks Preview */}
            <div className="p-3.5 rounded-2xl bg-[var(--g-surface-variant)] space-y-2">
              <div className="text-xs font-extrabold text-[var(--g-primary)]">
                المهام المفتوحة التي ستنتقل تلقائياً للوردية القادمة:
              </div>
              {effectiveRole === 'hall' ? (
                activeOpenShortages.length === 0 ? (
                  <div className="text-xs text-[var(--g-green)] font-bold">
                    ✓ لا توجد نواقص مفتوحة حالياً في الصالة.
                  </div>
                ) : (
                  <ul className="m-0 pr-4 text-xs space-y-1 font-semibold max-h-28 overflow-y-auto">
                    {activeOpenShortages.slice(0, 6).map((s) => (
                      <li key={s.id}>
                        🛒 صنف ناقص: "{s.item_name}" ({s.category})
                      </li>
                    ))}
                  </ul>
                )
              ) : activeOpenTrucks.length === 0 && activeOpenNotes.length === 0 ? (
                <div className="text-xs text-[var(--g-green)] font-bold">
                  ✓ لا توجد عربيات قيد التنزيل أو ملاحظات معلقة حالياً.
                </div>
              ) : (
                <ul className="m-0 pr-4 text-xs space-y-1 font-semibold max-h-28 overflow-y-auto">
                  {activeOpenTrucks.map((t) => (
                    <li key={t.id}>🚛 عربية "{t.supplier_name}" ما زالت تفرغ البضاعة</li>
                  ))}
                  {activeOpenNotes.map((n) => (
                    <li key={n.id}>
                      📌 [{n.location_tag}] {n.content}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">انتقال الوردية</label>
              <select
                value={shiftName}
                onChange={(e) => setShiftName(e.target.value)}
                className="g-input w-full text-sm font-bold"
              >
                <option>الوردية الصباحية ← المسائية</option>
                <option>الوردية المسائية ← الليلية</option>
                <option>الوردية الليلية ← الصباحية</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold">
                    اسم المسلِّم (المنتهية ورديته) *
                  </label>
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[var(--g-green-bg)] text-[var(--g-green)]">
                    تلقائي ✓
                  </span>
                </div>
                <input
                  type="text"
                  readOnly
                  value={actorName || ''}
                  className="g-input w-full text-sm font-extrabold bg-[var(--g-surface-variant)] cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">
                  {roleCopy.receiverLabel}
                </label>
                <select
                  required
                  value={toOperator}
                  onChange={(e) => setToOperator(e.target.value)}
                  className="g-input w-full text-sm font-extrabold"
                >
                  {roleColleagues.map((col) => (
                    <option key={col.id} value={col.name}>
                      {col.name}
                      {col.role_title ? ` (${col.role_title})` : ''}
                    </option>
                  ))}
                  <option value={roleCopy.defaultReceiver}>
                    {roleCopy.defaultReceiver} (عام)
                  </option>
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold">{roleCopy.noteLabel}</label>
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
                className="g-input w-full text-sm resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 rounded-full bg-[var(--g-primary)] text-white font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 shadow-sm"
            >
              <span className="ms-icon filled">send_and_archive</span>
              <span>تسليم الوردية الآن ✓</span>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
