import React, { useEffect, useMemo, useRef, useState } from 'react';
import ProofUploader from './ProofUploader.jsx';
import VoiceMicButton from './VoiceMicButton.jsx';
import { postActionWithOfflineSupport, apiRequest } from '../lib/api.js';
import { playSuccessChime, speakArabicConfirmation } from '../lib/audio.js';
import { formatTimeArabic, formatTimeWithSeconds } from '../lib/exportUtils.js';

const DEPT_ICONS = {
  الكل: 'groups',
  المدير: 'workspace_premium',
  مشرفين: 'supervisor_account',
  'مراقب كاميرات': 'videocam',
  أمن: 'shield_person',
  نظافة: 'cleaning_services',
  كاشير: 'point_of_sale',
  'منسقي ممرات': 'shelves',
  'ثلاجات وأجبان': 'kitchen',
  مخزن: 'warehouse',
  دليفري: 'two_wheeler',
  'أمن ونظافة': 'shield_person',
  'إدارة ومشرفين': 'supervisor_account',
};

const CALL_ALLOWED_ROLES = new Set(['owner', 'manager', 'supervisor', 'cctv', 'security']);

const QUICK_ATTENDANCE_NOTES = [
  'حضور منتظم',
  'بإذن مسبق من الإدارة',
  'تأخير مواصلات',
  'استراحة غداء / صلاة',
  'مأمورية خاصة بالماركت',
  'إضافي بعد الوردية',
];

const ACTION_META = {
  check_in: {
    label: 'حضور',
    btnLabel: 'تسجيل حضور الآن',
    icon: 'login',
    bg: 'bg-[#146C2E] hover:bg-[#0F5223] text-white',
    badge: 'bg-[var(--g-green-bg)] text-[var(--g-green)]',
  },
  break_start: {
    label: 'استراحة / إذن',
    btnLabel: 'بداية استراحة / إذن',
    icon: 'free_breakfast',
    bg: 'bg-[#C25E00] hover:bg-[#9A4A00] text-white',
    badge: 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]',
  },
  break_end: {
    label: 'عودة للعمل',
    btnLabel: 'عودة من الاستراحة',
    icon: 'play_arrow',
    bg: 'bg-[#0B57D0] hover:bg-[#0842A0] text-white',
    badge: 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]',
  },
  check_out: {
    label: 'انصراف',
    btnLabel: 'تسجيل انصراف',
    icon: 'logout',
    bg: 'bg-[#B3261E] hover:bg-[#8C1D18] text-white',
    badge: 'bg-[var(--g-red-bg)] text-[var(--g-red)]',
  },
};

export default function AttendanceView({
  employees = [],
  attendanceLogs = [],
  maxBreakMinutes = 30,
  actorName = 'الأمن',
  actorRole = '',
  filterRequest = null,
  canWrite = true,
  canVerify = false,
  canReadLogs = true,
  canPrintCards = true,
  canManageStaff = false,
  canManageRecords = false,
  onJumpToRealData,
  voiceConfirmEnabled = true,
  onOpenQrModal,
  onRefresh,
  onToast,
  onPreviewImage,
}) {
  const [, setTick] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('الكل');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeEmployee, setActiveEmployee] = useState(null);
  const [note, setNote] = useState('');
  const [customTimeHHMM, setCustomTimeHHMM] = useState('');
  const [proofDataUrl, setProofDataUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingLog, setEditingLog] = useState(null);

  const cardsSectionRef = useRef(null);
  const canCallPhone = CALL_ALLOWED_ROLES.has(actorRole) || canReadLogs;

  // Respond to Smart Alert [عرض الاستراحات] button immediately!
  useEffect(() => {
    if (filterRequest?.status) {
      setStatusFilter(filterRequest.status);
      setSelectedDept('الكل');
      setSearchQuery('');
      setTimeout(() => {
        cardsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    }
  }, [filterRequest]);

  // Live tick every 15s so Smart Break Timers auto-color orange immediately
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const departments = useMemo(() => {
    const set = new Set(['الكل']);
    employees.forEach((e) => set.add(e.department));
    return Array.from(set);
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((emp) => {
      if (selectedDept !== 'الكل' && emp.department !== selectedDept) return false;
      if (statusFilter === 'present' && emp.currentStatus !== 'present') return false;
      if (statusFilter === 'on_break' && emp.currentStatus !== 'on_break') return false;
      if (statusFilter === 'absent' && emp.currentStatus !== 'absent') return false;
      if (statusFilter === 'checked_out' && emp.currentStatus !== 'checked_out') return false;
      if (q) {
        const hay = `${emp.name} ${emp.emp_code || ''} ${emp.department} ${emp.role_title || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [employees, selectedDept, statusFilter, searchQuery]);

  function getBreakElapsedMinutes(emp) {
    if (emp.currentStatus !== 'on_break' || !emp.latestActionTime) return 0;
    return Math.max(
      0,
      Math.floor((Date.now() - new Date(emp.latestActionTime).getTime()) / 60000)
    );
  }

  function openEmployeeModal(emp) {
    if (!canWrite) {
      onToast?.('عرض فقط — حسابك الحالي لا يملك صلاحية تسجيل حضور', 'error');
      return;
    }
    setActiveEmployee(emp);
    setNote('');
    setCustomTimeHHMM('');
    setProofDataUrl('');
  }

  async function submitAttendance(actionType) {
    if (!activeEmployee || submitting) return;
    setSubmitting(true);
    try {
      let manualIso = undefined;
      if (canManageRecords && customTimeHHMM) {
        const now = new Date();
        const [hh, mm] = customTimeHHMM.split(':').map(Number);
        if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
          now.setHours(hh, mm, 0, 0);
          manualIso = now.toISOString();
        }
      }

      const res = await postActionWithOfflineSupport(
        '/api/attendance',
        {
          employee_id: activeEmployee.id,
          action_type: actionType,
          note: note.trim(),
          recorded_by: actorName,
          ...(manualIso ? { timestamp: manualIso } : {}),
        },
        {
          rawDataUrl: proofDataUrl,
          proofField: 'proof_url',
        }
      );

      playSuccessChime(actionType === 'check_out' ? 'out' : 'in');
      const actionAr = ACTION_META[actionType]?.label || 'حركة';
      speakArabicConfirmation(
        `تم تسجيل ${actionAr}، ${activeEmployee.name}`,
        voiceConfirmEnabled
      );

      onToast?.(
        res.queuedOffline
          ? `تم حفظ ${actionAr} (${activeEmployee.name}) محلياً وسيتم الرفع فور عودة الشبكة`
          : `تم تسجيل ${actionAr} لـ "${activeEmployee.name}" بنجاح`
      );
      setActiveEmployee(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر تسجيل الحركة', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleQuickCardAction(emp, actionType, e) {
    e?.stopPropagation();
    if (!canWrite || submitting) return;
    setSubmitting(true);
    try {
      const res = await postActionWithOfflineSupport('/api/attendance', {
        employee_id: emp.id,
        action_type: actionType,
        note: '',
        recorded_by: actorName,
      });
      playSuccessChime(actionType === 'check_out' ? 'out' : 'in');
      const actionAr = ACTION_META[actionType]?.label || 'حركة';
      speakArabicConfirmation(`تم تسجيل ${actionAr}، ${emp.name}`, voiceConfirmEnabled);
      onToast?.(
        res.queuedOffline
          ? `تم حفظ ${actionAr} (${emp.name}) محلياً`
          : `تم تسجيل ${actionAr} لـ "${emp.name}" بنجاح ✓`
      );
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر تسجيل الحركة', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyLog(logId, e) {
    e?.stopPropagation();
    try {
      await apiRequest(`/api/attendance/${logId}/verify`, 'POST');
      playSuccessChime('in');
      onToast?.('تمت المطابقة بالكاميرا ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  function openEditAttendanceLog(log) {
    const dt = new Date(log.timestamp);
    const hhmm = !Number.isNaN(dt.getTime())
      ? `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
      : '08:00';
    setEditingLog({
      ...log,
      hhmm,
    });
  }

  async function handleSaveEditedLog(e) {
    e.preventDefault();
    if (!editingLog) return;
    try {
      const baseDt = new Date(editingLog.timestamp);
      const [hh, mm] = (editingLog.hhmm || '08:00').split(':').map(Number);
      if (!Number.isNaN(baseDt.getTime()) && !Number.isNaN(hh) && !Number.isNaN(mm)) {
        baseDt.setHours(hh, mm);
      }
      await apiRequest(`/api/attendance/${editingLog.id}`, 'PUT', {
        action_type: editingLog.action_type,
        timestamp: !Number.isNaN(baseDt.getTime()) ? baseDt.toISOString() : editingLog.timestamp,
        late_minutes: Number(editingLog.late_minutes) || 0,
        note: editingLog.note || '',
        verified_by_cctv: Boolean(editingLog.verified_by_cctv),
      });
      setEditingLog(null);
      onToast?.('تم تعديل سجل الحضور بنجاح ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleDeleteAttendanceLog(log) {
    if (!window.confirm(`حذف حركة "${ACTION_META[log.action_type]?.label || log.action_type}" للموظف "${log.employee_name}"؟`)) {
      return;
    }
    try {
      await apiRequest(`/api/attendance/${log.id}`, 'DELETE');
      onToast?.('تم حذف حركة الحضور');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  return (
    <div className="space-y-5">
      {/* Google Search Bar + Quick QR / Print Badges Actions */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <div className="g-search-bar flex-1 flex items-center gap-2.5 px-4 py-2.5">
          <span className="ms-icon text-[var(--g-muted)]">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث بالاسم أو الكود السريع (مثل 101) أو القسم..."
            className="bg-transparent border-none outline-none w-full text-sm sm:text-base text-[var(--g-text)]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-[var(--g-muted)] flex items-center"
            >
              <span className="ms-icon text-lg">close</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canWrite && (
            <button
              type="button"
              onClick={() => onOpenQrModal?.('scan')}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-full bg-[var(--g-primary)] text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 shadow-xs"
            >
              <span className="ms-icon filled text-lg">qr_code_scanner</span>
              <span>مسح كرت QR</span>
            </button>
          )}
          {canPrintCards && (
            <button
              type="button"
              onClick={() => onOpenQrModal?.('cards')}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 hover:border-[var(--g-primary)]"
            >
              <span className="ms-icon text-lg text-[var(--g-primary)]">print</span>
              <span>كروت QR</span>
            </button>
          )}
        </div>
      </div>

      {/* Quick Status Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
        {[
          {
            id: 'all',
            label: 'إجمالي الموظفين',
            count: employees.length,
            icon: 'groups',
            tone: 'text-[var(--g-primary)] bg-[var(--g-primary-container)]',
          },
          {
            id: 'present',
            label: 'متواجد الآن',
            count: employees.filter((e) => e.currentStatus === 'present').length,
            icon: 'how_to_reg',
            tone: 'text-[var(--g-green)] bg-[var(--g-green-bg)]',
          },
          {
            id: 'on_break',
            label: 'في استراحة',
            count: employees.filter((e) => e.currentStatus === 'on_break').length,
            icon: 'free_breakfast',
            tone: 'text-[var(--g-yellow)] bg-[var(--g-yellow-bg)]',
          },
          {
            id: 'absent',
            label: 'لم يحضر بعد',
            count: employees.filter((e) => e.currentStatus === 'absent').length,
            icon: 'person_off',
            tone: 'text-[var(--g-muted)] bg-[var(--g-surface-variant)]',
          },
        ].map((card) => {
          const selected = statusFilter === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => setStatusFilter(selected ? 'all' : card.id)}
              className={`g-card p-3 sm:p-4 text-right flex items-center justify-between transition-all ${
                selected ? 'ring-2 ring-[var(--g-primary)]' : ''
              }`}
            >
              <div>
                <div className="text-[11px] sm:text-xs text-[var(--g-muted)] font-semibold">
                  {card.label}
                </div>
                <div className="text-xl sm:text-2xl font-extrabold num-ltr mt-0.5">
                  {card.count}
                </div>
              </div>
              <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center ${card.tone}`}>
                <span className="ms-icon filled text-xl sm:text-2xl">{card.icon}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Department Filter Chips */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
        {departments.map((dept) => {
          const active = selectedDept === dept;
          return (
            <button
              key={dept}
              type="button"
              onClick={() => setSelectedDept(dept)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs sm:text-sm whitespace-nowrap border transition-all ${
                active
                  ? 'g-pill-active border-transparent shadow-2xs'
                  : 'bg-[var(--g-surface)] border-[var(--g-border)] text-[var(--g-text)] font-semibold'
              }`}
            >
              <span className="ms-icon text-base sm:text-lg">
                {DEPT_ICONS[dept] || 'badge'}
              </span>
              <span>{dept}</span>
            </button>
          );
        })}
      </div>

      {/* Employee Touch Cards Grid */}
      <div ref={cardsSectionRef} className="scroll-mt-24">
      {employees.length === 0 ? (
        <div className="g-card p-6 sm:p-8 text-center space-y-3 border-2 border-dashed border-[var(--g-border)]">
          <div className="w-14 h-14 mx-auto rounded-3xl bg-[var(--g-primary-container)] text-[var(--g-primary)] flex items-center justify-center">
            <span className="ms-icon filled text-3xl">group_add</span>
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-extrabold m-0">
              قائمة الموظفين جاهزة لإدخال بيانات زايد مارت الحقيقية
            </h3>
            <p className="text-xs sm:text-sm text-[var(--g-muted)] m-0 mt-1 max-w-lg mx-auto">
              أضف موظفي الماركت الحقيقيين (فردياً أو بلصق قائمة أسماء دفعة واحدة) ليتم توليد الأكواد السريعة وكروت الـ QR لهم فوراً.
            </p>
          </div>
          {canManageStaff && (
            <button
              type="button"
              onClick={() => onJumpToRealData?.('staff')}
              className="px-6 py-3 rounded-full bg-[var(--g-primary)] text-white text-xs sm:text-sm font-extrabold inline-flex items-center gap-2 shadow-xs"
            >
              <span className="ms-icon filled text-lg">person_add</span>
              <span>+ إضافة موظفي الماركت الحقيقيين الآن</span>
            </button>
          )}
        </div>
      ) : filteredEmployees.length === 0 ? (
        <div className="g-card p-6 text-center space-y-2.5">
          <div className="text-sm font-extrabold text-[var(--g-muted)]">
            لا يوجد موظفون مطابقون للفلتر المختار حالياً.
          </div>
          {statusFilter !== 'all' && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all');
                setSelectedDept('الكل');
              }}
              className="px-4 py-2 rounded-full bg-[var(--g-primary)] text-white text-xs font-extrabold"
            >
              عرض كل الموظفين ({employees.length})
            </button>
          )}
        </div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filteredEmployees.map((emp) => {
          const breakMins = getBreakElapsedMinutes(emp);
          // Feature #6: Smart Timer colors card warm Orange if break > maxBreakMinutes
          const breakExceeded = emp.currentStatus === 'on_break' && breakMins > maxBreakMinutes;
          const needsCctvVerify = emp.latestLogId && !emp.latestVerified && canVerify;
          const initials = emp.name
            .split(' ')
            .slice(0, 2)
            .map((w) => w[0])
            .join(' ');

          return (
            <div
              key={emp.id}
              onClick={() => openEmployeeModal(emp)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && openEmployeeModal(emp)}
              className={`g-card g-card-interactive p-4 text-right flex flex-col justify-between gap-3 cursor-pointer ${
                breakExceeded ? 'g-smart-timer-orange' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2 w-full">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    style={{ backgroundColor: emp.avatar_color || '#0B57D0' }}
                    className="w-12 h-12 rounded-2xl text-white font-extrabold text-sm flex items-center justify-center shrink-0 shadow-2xs"
                  >
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-extrabold text-base truncate">{emp.name}</span>
                      {emp.emp_code && (
                        <span className="num-ltr text-[11px] px-1.5 py-0.5 rounded-md bg-[var(--g-surface-variant)] text-[var(--g-muted)] font-bold shrink-0">
                          #{emp.emp_code}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--g-muted)] truncate mt-0.5">
                      {emp.department}
                      {emp.role_title ? ` • ${emp.role_title}` : ''}
                    </div>
                  </div>
                </div>

                <span
                  className={`text-xs font-extrabold px-2.5 py-1 rounded-full shrink-0 ${
                    emp.currentStatus === 'present'
                      ? 'bg-[var(--g-green-bg)] text-[var(--g-green)]'
                      : emp.currentStatus === 'on_break'
                      ? breakExceeded
                        ? 'bg-[#C25E00] text-white'
                        : 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]'
                      : emp.currentStatus === 'checked_out'
                      ? 'bg-[var(--g-red-bg)] text-[var(--g-red)]'
                      : 'bg-[var(--g-surface-variant)] text-[var(--g-muted)]'
                  }`}
                >
                  {emp.currentStatus === 'present'
                    ? 'متواجد ✓'
                    : emp.currentStatus === 'on_break'
                    ? `استراحة ${breakMins} د`
                    : emp.currentStatus === 'checked_out'
                    ? 'انصرف'
                    : 'لم يحضر'}
                </span>
              </div>

              {/* Direct 1-Tap Phone Call Button for Security, Supervisor, CCTV, Manager & Admin */}
              {canCallPhone && emp.phone && (
                <div onClick={(e) => e.stopPropagation()} className="flex items-center">
                  <a
                    href={`tel:${emp.phone}`}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full min-h-[38px] px-3 py-1.5 rounded-xl bg-[var(--g-primary-container)]/50 hover:bg-[var(--g-primary-container)] text-[var(--g-primary)] border border-[var(--g-primary)]/30 text-xs font-extrabold flex items-center justify-between gap-2 active:scale-95 transition-all no-underline"
                    title={`اتصال مباشر بـ ${emp.name}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="ms-icon filled text-base">call</span>
                      <span>اتصال مباشر</span>
                    </span>
                    <span className="num-ltr font-black">{emp.phone}</span>
                  </a>
                </div>
              )}

              {breakExceeded && (
                <div className="text-xs font-extrabold text-[var(--g-orange-text)] flex items-center gap-1">
                  <span className="ms-icon filled text-base">alarm</span>
                  <span>تجاوز وقت الاستراحة المسموح ({maxBreakMinutes} د)!</span>
                </div>
              )}

              {/* Feature #3: Direct Buddy-Punching CCTV Stamp right on Employee Card! */}
              {needsCctvVerify && (
                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--g-yellow-bg)]/70">
                  <span className="text-[11px] font-bold text-[var(--g-yellow)]">
                    سُجل عبر ({emp.latestRecordedBy}) بدون صورة
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleVerifyLog(emp.latestLogId, e)}
                    className="w-full sm:w-auto px-2.5 py-1.5 rounded-lg bg-[#146C2E] text-white text-[11px] font-extrabold flex items-center justify-center gap-1 shrink-0"
                  >
                    <span className="ms-icon filled text-sm">verified</span>
                    <span>تمت المطابقة بالكاميرا ✓</span>
                  </button>
                </div>
              )}

              {canWrite && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[var(--g-border)] w-full"
                >
                  {(emp.currentStatus === 'absent' || emp.currentStatus === 'checked_out') && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={(e) => handleQuickCardAction(emp, 'check_in', e)}
                      className="flex-1 min-h-[42px] px-3 py-1.5 rounded-xl bg-[#146C2E] hover:bg-[#0F5223] text-white text-xs sm:text-sm font-black flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-2xs"
                    >
                      <span className="ms-icon filled text-base">login</span>
                      <span>تسجيل حضور ✓</span>
                    </button>
                  )}

                  {emp.currentStatus === 'present' && (
                    <>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={(e) => handleQuickCardAction(emp, 'break_start', e)}
                        className="flex-1 min-h-[42px] px-2.5 py-1.5 rounded-xl bg-[var(--g-yellow-bg)] text-[var(--g-yellow)] border border-[var(--g-yellow-border)]/35 text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95"
                      >
                        <span className="ms-icon text-base">coffee</span>
                        <span>استراحة</span>
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={(e) => handleQuickCardAction(emp, 'check_out', e)}
                        className="flex-1 min-h-[42px] px-2.5 py-1.5 rounded-xl bg-[var(--g-red-bg)] text-[var(--g-red)] border border-[var(--g-red-border)]/30 text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95"
                      >
                        <span className="ms-icon text-base">logout</span>
                        <span>انصراف</span>
                      </button>
                    </>
                  )}

                  {emp.currentStatus === 'on_break' && (
                    <>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={(e) => handleQuickCardAction(emp, 'break_end', e)}
                        className="flex-1 min-h-[42px] px-2.5 py-1.5 rounded-xl bg-[var(--g-primary)] text-white text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95"
                      >
                        <span className="ms-icon text-base">work_history</span>
                        <span>عودة للعمل ✓</span>
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={(e) => handleQuickCardAction(emp, 'check_out', e)}
                        className="min-h-[42px] px-2.5 py-1.5 rounded-xl bg-[var(--g-red-bg)] text-[var(--g-red)] text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95"
                      >
                        <span className="ms-icon text-base">logout</span>
                        <span>انصراف</span>
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => openEmployeeModal(emp)}
                    title="إضافة ملاحظة أو صورة إثبات"
                    className="min-h-[42px] px-2.5 py-1.5 rounded-xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-xs font-bold text-[var(--g-text)] flex items-center justify-center gap-1 active:scale-95 shrink-0"
                  >
                    <span className="ms-icon text-base text-[var(--g-primary)]">add_a_photo</span>
                    <span className="hidden xs:inline">ملاحظة/صورة</span>
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-[var(--g-border)] text-xs w-full gap-2">
                <div className="text-[var(--g-muted)] truncate">
                  {emp.checkInTime ? (
                    <span>
                      حضر:{' '}
                      <strong className="num-ltr text-[var(--g-text)]">
                        {formatTimeArabic(emp.checkInTime)}
                      </strong>
                      {emp.latestRecordedBy ? ` • سجله: ${emp.latestRecordedBy}` : ''}
                    </span>
                  ) : (
                    <span>
                      الوردية: <span className="num-ltr font-semibold">{emp.shift_start}</span>
                    </span>
                  )}
                </div>

                {emp.lateMinutes > 0 ? (
                  <span className="text-[var(--g-yellow)] font-extrabold shrink-0">
                    تأخير {emp.lateMinutes} د
                  </span>
                ) : (
                  <span className="text-[var(--g-primary)] font-bold flex items-center gap-0.5 shrink-0">
                    <span>التفاصيل</span>
                    <span className="ms-icon text-sm">chevron_left</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}
      </div>

      {/* Today's Attendance Logs */}
      {canReadLogs && (
      <section className="g-card p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3.5">
          <span className="ms-icon filled text-[var(--g-primary)]">history</span>
          <h2 className="text-base sm:text-lg font-extrabold m-0">
            سجل الحضور والانصراف التفصيلي ({attendanceLogs.length})
          </h2>
        </div>

        {attendanceLogs.length === 0 ? (
          <div className="text-center py-8 text-[var(--g-muted)] text-sm">
            لم يتم تسجيل أي حركة حضور أو انصراف في هذا اليوم بعد.
          </div>
        ) : (
          <div className="space-y-2.5">
            {attendanceLogs.map((log) => {
              const meta = ACTION_META[log.action_type] || ACTION_META.check_in;
              return (
                <div
                  key={log.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3.5 rounded-2xl bg-[var(--g-surface-variant)]/55 border border-[var(--g-border)]"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    <span className={`px-3 py-1 rounded-full text-xs font-extrabold shrink-0 ${meta.badge}`}>
                      {meta.label}
                    </span>
                    <div className="min-w-0">
                      <div className="font-extrabold text-sm sm:text-base flex flex-wrap items-center gap-1.5">
                        <span>{log.employee_name}</span>
                        <span className="text-xs font-normal text-[var(--g-muted)]">
                          ({log.department})
                        </span>
                      </div>
                      <div className="text-xs text-[var(--g-muted)] flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className="num-ltr font-bold text-[var(--g-text)]">
                          {formatTimeWithSeconds(log.timestamp)}
                        </span>
                        <span>• {log.recorded_by}</span>
                        {log.late_minutes > 0 && (
                          <span className="text-[var(--g-yellow)] font-bold">
                            • تأخير {log.late_minutes} د
                          </span>
                        )}
                        {log.note && <span>• "{log.note}"</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    {log.proof_url && (
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewImage?.(log.proof_url, `${log.employee_name} - ${meta.label}`)
                        }
                        className="px-3 py-1.5 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] text-xs font-bold flex items-center gap-1"
                      >
                        <span className="ms-icon text-base text-[var(--g-primary)]">image</span>
                        <span>الإثبات</span>
                      </button>
                    )}

                    {log.verified_by_cctv ? (
                      <span className="px-3 py-1.5 rounded-full bg-[var(--g-green-bg)] text-[var(--g-green)] text-xs font-extrabold flex items-center gap-1">
                        <span className="ms-icon filled text-base">verified</span>
                        <span>تمت المطابقة بالكاميرا ✓</span>
                      </span>
                    ) : canVerify ? (
                      <button
                        type="button"
                        onClick={(e) => handleVerifyLog(log.id, e)}
                        className="px-3.5 py-1.5 rounded-full bg-[#0B57D0] text-white text-xs font-extrabold flex items-center gap-1"
                      >
                        <span className="ms-icon filled text-base">fact_check</span>
                        <span>تمت المطابقة بالكاميرا ✓</span>
                      </button>
                    ) : (
                      <span className="text-xs text-[var(--g-muted)] px-2">بانتظار المطابقة</span>
                    )}

                    {canManageRecords && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditAttendanceLog(log)}
                          className="w-9 h-9 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] flex items-center justify-center text-[var(--g-primary)]"
                          title="تعديل الحركة (أدمن)"
                        >
                          <span className="ms-icon text-base">edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAttendanceLog(log)}
                          className="w-9 h-9 rounded-full bg-[var(--g-red-bg)] text-[var(--g-red)] flex items-center justify-center"
                          title="حذف الحركة (أدمن)"
                        >
                          <span className="ms-icon text-base">delete</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* Material 3 Bottom Sheet / Dialog for Employee Attendance */}
      {activeEmployee && (
        <div
          onClick={() => !submitting && setActiveEmployee(null)}
          className="g-modal-overlay"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="g-dialog-sheet max-w-lg animate-pop space-y-4"
          >
            <div className="g-sheet-handle" />

            <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--g-border)]">
              <div className="flex items-center gap-3">
                <div
                  style={{ backgroundColor: activeEmployee.avatar_color || '#0B57D0' }}
                  className="w-12 h-12 rounded-2xl text-white font-extrabold flex items-center justify-center text-lg"
                >
                  {activeEmployee.name[0]}
                </div>
                <div>
                  <h3 className="text-lg font-extrabold m-0">{activeEmployee.name}</h3>
                  <p className="text-xs text-[var(--g-muted)] m-0">
                    {activeEmployee.department} • كود <span className="num-ltr">#{activeEmployee.emp_code}</span> • شفت{' '}
                    <span className="num-ltr">{activeEmployee.shift_start}</span>
                  </p>
                  {canCallPhone && activeEmployee.phone && (
                    <a
                      href={`tel:${activeEmployee.phone}`}
                      className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--g-primary)] text-white text-xs font-extrabold no-underline shadow-2xs"
                    >
                      <span className="ms-icon filled text-sm">call</span>
                      <span>اتصال مباشر:</span>
                      <span className="num-ltr">{activeEmployee.phone}</span>
                    </a>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveEmployee(null)}
                className="w-9 h-9 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center"
              >
                <span className="ms-icon">close</span>
              </button>
            </div>

            <ProofUploader
              value={proofDataUrl}
              onChange={setProofDataUrl}
              label="إرفاق صورة من الفون أو سكرين شوت (اختياري)"
              compact
            />

            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-bold text-[var(--g-muted)]">
                  ملاحظة سريعة أو إملاء صوتي (اختياري):
                </span>
                <VoiceMicButton
                  small
                  onToast={onToast}
                  onTranscript={(txt) => setNote((prev) => (prev ? `${prev} ${txt}` : txt))}
                />
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK_ATTENDANCE_NOTES.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setNote(note === chip ? '' : chip)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                      note === chip
                        ? 'g-pill-active border-transparent'
                        : 'bg-[var(--g-surface-variant)] border-[var(--g-border)] font-medium'
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="أو اكتب ملاحظة قصيرة هنا..."
                className="g-input w-full"
              />
            </div>

            {canManageRecords && (
              <div className="p-3 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] flex items-center justify-between gap-3">
                <label className="text-xs font-extrabold text-[var(--g-text)]">
                  وقت مخصص للأدمن (اتركه فارغاً للوقت الحالي):
                </label>
                <input
                  type="time"
                  value={customTimeHHMM}
                  onChange={(e) => setCustomTimeHHMM(e.target.value)}
                  className="g-input w-36 num-ltr text-sm font-black py-1.5"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              {(canManageRecords ||
                activeEmployee.currentStatus === 'absent' ||
                activeEmployee.currentStatus === 'checked_out') && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => submitAttendance('check_in')}
                  className={`${
                    canManageRecords ? '' : 'sm:col-span-2'
                  } py-4 px-5 rounded-full font-extrabold text-base flex items-center justify-center gap-2 shadow-sm ${ACTION_META.check_in.bg}`}
                >
                  <span className="ms-icon filled text-2xl">waving_hand</span>
                  <span>{ACTION_META.check_in.btnLabel}</span>
                </button>
              )}

              {(canManageRecords || activeEmployee.currentStatus === 'present') && (
                <>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => submitAttendance('break_start')}
                    className={`py-4 px-4 rounded-full font-extrabold text-base flex items-center justify-center gap-2 shadow-sm ${ACTION_META.break_start.bg}`}
                  >
                    <span className="ms-icon filled text-2xl">free_breakfast</span>
                    <span>استراحة / إذن</span>
                  </button>

                  {!canManageRecords && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => submitAttendance('check_out')}
                      className={`py-4 px-4 rounded-full font-extrabold text-base flex items-center justify-center gap-2 shadow-sm ${ACTION_META.check_out.bg}`}
                    >
                      <span className="ms-icon filled text-2xl">logout</span>
                      <span>تسجيل انصراف</span>
                    </button>
                  )}
                </>
              )}

              {(canManageRecords || activeEmployee.currentStatus === 'on_break') && (
                <>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => submitAttendance('break_end')}
                    className={`py-4 px-4 rounded-full font-extrabold text-base flex items-center justify-center gap-2 shadow-sm ${ACTION_META.break_end.bg}`}
                  >
                    <span className="ms-icon filled text-2xl">play_arrow</span>
                    <span>عودة للعمل</span>
                  </button>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => submitAttendance('check_out')}
                    className={`py-4 px-4 rounded-full font-extrabold text-base flex items-center justify-center gap-2 shadow-sm ${ACTION_META.check_out.bg}`}
                  >
                    <span className="ms-icon filled text-2xl">logout</span>
                    <span>تسجيل انصراف</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin Edit Attendance Log Modal */}
      {editingLog && canManageRecords && (
        <div onClick={() => setEditingLog(null)} className="g-modal-overlay">
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveEditedLog}
            className="g-dialog-sheet max-w-md space-y-4 animate-pop"
          >
            <div className="g-sheet-handle" />
            <div className="flex items-center justify-between border-b border-[var(--g-border)] pb-3">
              <h3 className="text-base font-extrabold m-0">
                تعديل سجل حضور: {editingLog.employee_name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingLog(null)}
                className="w-9 h-9 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center"
              >
                <span className="ms-icon">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">نوع الحركة</label>
                <select
                  value={editingLog.action_type}
                  onChange={(e) =>
                    setEditingLog((l) => ({ ...l, action_type: e.target.value }))
                  }
                  className="g-input font-bold"
                >
                  <option value="check_in">حضور</option>
                  <option value="break_start">بداية استراحة</option>
                  <option value="break_end">عودة من استراحة</option>
                  <option value="check_out">انصراف</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">الوقت</label>
                <input
                  type="time"
                  value={editingLog.hhmm}
                  onChange={(e) => setEditingLog((l) => ({ ...l, hhmm: e.target.value }))}
                  className="g-input num-ltr font-black"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">دقائق التأخير</label>
              <input
                type="number"
                min="0"
                value={editingLog.late_minutes ?? 0}
                onChange={(e) =>
                  setEditingLog((l) => ({ ...l, late_minutes: e.target.value }))
                }
                className="g-input num-ltr font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">ملاحظة</label>
              <input
                type="text"
                value={editingLog.note || ''}
                onChange={(e) => setEditingLog((l) => ({ ...l, note: e.target.value }))}
                className="g-input"
              />
            </div>

            <label className="flex items-center gap-2 p-3 rounded-2xl bg-[var(--g-surface-variant)] text-xs font-extrabold cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(editingLog.verified_by_cctv)}
                onChange={(e) =>
                  setEditingLog((l) => ({ ...l, verified_by_cctv: e.target.checked }))
                }
                className="w-4 h-4 accent-[#146C2E]"
              />
              <span>معتمد ومطابق بالكاميرا ✓</span>
            </label>

            <button
              type="submit"
              className="w-full py-3.5 rounded-full bg-[var(--g-primary)] text-white font-extrabold text-sm"
            >
              حفظ تعديل الحركة ✓
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
