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
  'حضور منتظم (شفت 12 ساعة)',
  'بإذن مسبق من الإدارة',
  'تأخير مواصلات',
  'استراحة غداء / صلاة',
  'مأمورية خاصة بالماركت',
  'إضافي بعد الوردية',
];

const BREAK_PRESETS = [
  { minutes: 15, label: '15 دقيقة (صلاة / سريعة)' },
  { minutes: 30, label: '30 دقيقة (استراحة عادية)' },
  { minutes: 45, label: '45 دقيقة (غداء)' },
  { minutes: 60, label: '60 دقيقة (ساعة كاملة)' },
];

const BREAK_REASONS = ['استراحة غداء', 'صلاة', 'راحة قصيرة', 'إذن خاص', 'ظرف طارئ'];

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
    btnLabel: 'بداية استراحة محددة المدة',
    icon: 'free_breakfast',
    bg: 'bg-[#C25E00] hover:bg-[#9A4A00] text-white',
    badge: 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]',
  },
  break_end: {
    label: 'عودة للعمل',
    btnLabel: 'عودة من الاستراحة (حساب المدة)',
    icon: 'play_arrow',
    bg: 'bg-[#0B57D0] hover:bg-[#0842A0] text-white',
    badge: 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]',
  },
  check_out: {
    label: 'انصراف',
    btnLabel: 'تسجيل انصراف نهاية الشفت',
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
  onOpenPersonLog,
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
  const [allowedBreakMins, setAllowedBreakMins] = useState(maxBreakMinutes || 30);
  const [breakReason, setBreakReason] = useState('استراحة غداء');
  const [customTimeHHMM, setCustomTimeHHMM] = useState('');
  const [proofDataUrl, setProofDataUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingLog, setEditingLog] = useState(null);

  const cardsSectionRef = useRef(null);
  const canCallPhone = CALL_ALLOWED_ROLES.has(actorRole) || canReadLogs;
  const isOwner = actorRole === 'owner';

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
        const hay = `${emp.name} ${isOwner ? emp.emp_code || '' : ''} ${emp.department} ${emp.role_title || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [employees, selectedDept, statusFilter, searchQuery, isOwner]);

  function getBreakElapsedMinutes(emp) {
    if (emp.currentStatus !== 'on_break') return 0;
    const startTs = emp.activeBreakStart || emp.latestActionTime;
    if (!startTs) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(startTs).getTime()) / 60000));
  }

  function openEmployeeModal(emp, defaultBreakMins = null) {
    if (!canWrite) {
      if (onOpenPersonLog && canReadLogs) {
        onOpenPersonLog(emp.id, emp.name);
        return;
      }
      onToast?.('عرض فقط — حسابك الحالي لا يملك صلاحية تسجيل حضور', 'error');
      return;
    }
    setActiveEmployee(emp);
    setNote('');
    setAllowedBreakMins(defaultBreakMins || emp.allowedBreakMinutes || maxBreakMinutes || 30);
    setBreakReason('استراحة غداء');
    setCustomTimeHHMM('');
    setProofDataUrl('');
  }

  async function submitAttendance(actionType, customBreakOverride = null) {
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

      const finalBreakMins =
        actionType === 'break_start'
          ? Number(customBreakOverride || allowedBreakMins || maxBreakMinutes || 30)
          : 0;

      const res = await postActionWithOfflineSupport(
        '/api/attendance',
        {
          employee_id: activeEmployee.id,
          action_type: actionType,
          note: note.trim() || (actionType === 'break_start' ? breakReason : ''),
          allowed_break_minutes: finalBreakMins,
          break_reason: actionType === 'break_start' ? breakReason : '',
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

      const breakDurationMsg =
        res.log?.break_duration_minutes > 0
          ? ` (استغرقت الاستراحة ${res.log.break_duration_minutes} دقيقة)`
          : actionType === 'break_start'
            ? ` (لمدة ${finalBreakMins} دقيقة)`
            : '';

      onToast?.(
        res.queuedOffline
          ? `تم حفظ ${actionAr} (${activeEmployee.name}) محلياً وسيتم الرفع فور عودة الشبكة`
          : `تم تسجيل ${actionAr} لـ "${activeEmployee.name}"${breakDurationMsg} بنجاح ✓`
      );
      setActiveEmployee(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر تسجيل الحركة', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleQuickCardAction(emp, actionType, e, customBreakMinutes = null) {
    e?.stopPropagation();
    if (!canWrite || submitting) return;
    setSubmitting(true);
    try {
      const res = await postActionWithOfflineSupport('/api/attendance', {
        employee_id: emp.id,
        action_type: actionType,
        allowed_break_minutes:
          actionType === 'break_start' ? Number(customBreakMinutes || maxBreakMinutes || 30) : 0,
        break_reason: actionType === 'break_start' ? 'استراحة' : '',
        note: '',
        recorded_by: actorName,
      });
      playSuccessChime(actionType === 'check_out' ? 'out' : 'in');
      const actionAr = ACTION_META[actionType]?.label || 'حركة';
      speakArabicConfirmation(`تم تسجيل ${actionAr}، ${emp.name}`, voiceConfirmEnabled);
      const breakDurationMsg =
        res.log?.break_duration_minutes > 0
          ? ` (مدة الاستراحة: ${res.log.break_duration_minutes} د)`
          : actionType === 'break_start'
            ? ` (مسموح ${customBreakMinutes || maxBreakMinutes || 30} د)`
            : '';
      onToast?.(
        res.queuedOffline
          ? `تم حفظ ${actionAr} (${emp.name}) محلياً`
          : `تم تسجيل ${actionAr} لـ "${emp.name}"${breakDurationMsg} بنجاح ✓`
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
        allowed_break_minutes: Number(editingLog.allowed_break_minutes) || 0,
        break_duration_minutes: Number(editingLog.break_duration_minutes) || 0,
        break_reason: editingLog.break_reason || '',
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
            placeholder="ابحث باسم الموظف أو القسم أو الوظيفة..."
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
              <span>طباعة كروت QR ({employees.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Quick Status Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
        {[
          {
            id: 'all',
            label: 'إجمالي الموظفين (شفت 12س)',
            count: employees.length,
            icon: 'groups',
            tone: 'text-[var(--g-primary)] bg-[var(--g-primary-container)]',
          },
          {
            id: 'present',
            label: 'متواجد الآن بالشفت',
            count: employees.filter((e) => e.currentStatus === 'present').length,
            icon: 'how_to_reg',
            tone: 'text-[var(--g-green)] bg-[var(--g-green-bg)]',
          },
          {
            id: 'on_break',
            label: 'في استراحة حالياً',
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
                قاعدة البيانات نظيفة وجاهزة لإدخال موظفي زايد مارت الحقيقيين
              </h3>
              <p className="text-xs sm:text-sm text-[var(--g-muted)] m-0 mt-1 max-w-lg mx-auto">
                أضف موظفي الماركت والكاشيرية والأمن الحقيقيين (شفت 12 ساعة) ليتم تفعيل حساباتهم وكروت الـ QR لهم فوراً.
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
              const empAllowedBreak = emp.allowedBreakMinutes || maxBreakMinutes || 30;
              const breakExceeded = emp.currentStatus === 'on_break' && breakMins > empAllowedBreak;
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
                          {isOwner && emp.emp_code && (
                            <span
                              title="الرمز السري (يظهر للأدمن فقط)"
                              className="num-ltr text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--g-surface-variant)] text-[var(--g-muted)] font-bold shrink-0"
                            >
                              🔑 {emp.emp_code}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--g-muted)] truncate mt-0.5">
                          {emp.department}
                          {emp.role_title ? ` • ${emp.role_title}` : ''}
                        </div>
                        <div className="text-[11px] text-[var(--g-muted)] num-ltr mt-0.5">
                          ⏰ {emp.shift_start || '08:00'} → {emp.shift_end || '20:00'} (12h)
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span
                        className={`text-xs font-extrabold px-2.5 py-1 rounded-full ${
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
                          ? `استراحة ${breakMins}/${empAllowedBreak} د`
                          : emp.currentStatus === 'checked_out'
                          ? 'انصرف'
                          : 'لم يحضر'}
                      </span>

                      {emp.isCrossDayShift && (
                        <span className="px-2 py-0.5 rounded-full bg-[var(--g-purple-bg)] text-[var(--g-purple)] text-[10px] font-extrabold">
                          🌙 شفت ممتد ({emp.shiftDateKey})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Break summary or live break alert */}
                  {(emp.currentStatus === 'on_break' || emp.totalBreakMinutes > 0) && (
                    <div className="px-2.5 py-1.5 rounded-xl bg-[var(--g-surface-variant)] flex items-center justify-between text-[11px] font-bold">
                      {emp.currentStatus === 'on_break' ? (
                        <span className={breakExceeded ? 'text-[var(--g-orange-text)] font-extrabold' : 'text-[var(--g-yellow)]'}>
                          ☕ في استراحة منذ {breakMins} د (مسموح {empAllowedBreak} د)
                        </span>
                      ) : (
                        <span className="text-[var(--g-muted)]">
                          ☕ إجمالي الاستراحات بالشفت: {emp.totalBreakMinutes} دقيقة ({emp.breaksCount || 1} مرة)
                        </span>
                      )}
                      {breakExceeded && (
                        <span className="px-1.5 py-0.5 rounded bg-[#B3261E] text-white text-[10px] font-extrabold">
                          تجاوز +{breakMins - empAllowedBreak} د!
                        </span>
                      )}
                    </div>
                  )}

                  {/* Direct 1-Tap Phone Call Button */}
                  {canCallPhone && emp.phone && (
                    <div onClick={(e) => e.stopPropagation()} className="flex items-center">
                      <a
                        href={`tel:${emp.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full min-h-[36px] px-3 py-1 rounded-xl bg-[var(--g-primary-container)]/50 hover:bg-[var(--g-primary-container)] text-[var(--g-primary)] border border-[var(--g-primary)]/30 text-xs font-extrabold flex items-center justify-between gap-2 active:scale-95 transition-all no-underline"
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

                  {/* CCTV Verification Stamp */}
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
                      className="space-y-1.5 pt-2 border-t border-[var(--g-border)] w-full"
                    >
                      <div className="flex flex-wrap items-center gap-1.5 w-full">
                        {(emp.currentStatus === 'absent' || emp.currentStatus === 'checked_out') && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={(e) => handleQuickCardAction(emp, 'check_in', e)}
                            className="flex-1 min-h-[40px] px-3 py-1.5 rounded-xl bg-[#146C2E] hover:bg-[#0F5223] text-white text-xs sm:text-sm font-black flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-2xs"
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
                              onClick={() => openEmployeeModal(emp, 30)}
                              className="flex-1 min-h-[40px] px-2.5 py-1.5 rounded-xl bg-[var(--g-yellow-bg)] text-[var(--g-yellow)] border border-[var(--g-yellow-border)]/35 text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95"
                              title="تحديد مدة الاستراحة للموظف"
                            >
                              <span className="ms-icon text-base">coffee</span>
                              <span>إعطاء استراحة ⏱️</span>
                            </button>
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={(e) => handleQuickCardAction(emp, 'check_out', e)}
                              className="flex-1 min-h-[40px] px-2.5 py-1.5 rounded-xl bg-[var(--g-red-bg)] text-[var(--g-red)] border border-[var(--g-red-border)]/30 text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95"
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
                              className="flex-1 min-h-[40px] px-2.5 py-1.5 rounded-xl bg-[var(--g-primary)] text-white text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95"
                            >
                              <span className="ms-icon text-base">work_history</span>
                              <span>عودة ({breakMins} د) ✓</span>
                            </button>
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={(e) => handleQuickCardAction(emp, 'check_out', e)}
                              className="min-h-[40px] px-2.5 py-1.5 rounded-xl bg-[var(--g-red-bg)] text-[var(--g-red)] text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95"
                            >
                              <span className="ms-icon text-base">logout</span>
                              <span>انصراف</span>
                            </button>
                          </>
                        )}

                        {canReadLogs && onOpenPersonLog && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenPersonLog(emp.id, emp.name);
                            }}
                            title="عرض السجل الفردي الكامل للموظف"
                            className="min-h-[40px] px-2.5 py-1.5 rounded-xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-xs font-extrabold text-[var(--g-primary)] flex items-center justify-center gap-1 active:scale-95 shrink-0"
                          >
                            <span className="ms-icon text-base">assignment_ind</span>
                            <span>سجله</span>
                          </button>
                        )}
                      </div>

                      {/* Quick 1-Tap Break Duration Pills for Security & Supervisors */}
                      {emp.currentStatus === 'present' && (
                        <div className="flex items-center justify-between gap-1 pt-1">
                          <span className="text-[10px] font-bold text-[var(--g-muted)]">بريك سريع:</span>
                          {[15, 30, 45, 60].map((m) => (
                            <button
                              key={m}
                              type="button"
                              disabled={submitting}
                              onClick={(e) => handleQuickCardAction(emp, 'break_start', e, m)}
                              className="flex-1 py-1 rounded-lg bg-[var(--g-surface-variant)] hover:bg-[var(--g-yellow-bg)] text-[10px] font-extrabold text-[var(--g-text)] border border-[var(--g-border)]"
                            >
                              {m} د
                            </button>
                          ))}
                        </div>
                      )}
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
                          الشفت: <span className="num-ltr font-semibold">{emp.shift_start || '08:00'} → {emp.shift_end || '20:00'}</span>
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

      {/* Today's & Cross-Day Linked Attendance Logs */}
      {canReadLogs && (
        <section className="g-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
            <div className="flex items-center gap-2">
              <span className="ms-icon filled text-[var(--g-primary)]">history</span>
              <h2 className="text-base sm:text-lg font-extrabold m-0">
                سجل الحضور والانصراف والاستراحات التفصيلي ({attendanceLogs.length})
              </h2>
            </div>
            <span className="text-xs text-[var(--g-muted)] font-bold">
              🔄 يدعم مزامنة شفت الـ 12 ساعة الممتد لليوم التالي تلقائياً
            </span>
          </div>

          {attendanceLogs.length === 0 ? (
            <div className="text-center py-8 text-[var(--g-muted)] text-sm">
              لم يتم تسجيل أي حركة حضور أو انصراف في هذا اليوم بعد.
            </div>
          ) : (
            <div className="space-y-2.5">
              {attendanceLogs.map((log) => {
                const meta = ACTION_META[log.action_type] || ACTION_META.check_in;
                const isCrossDay = log.shift_date_key && log.shift_date_key !== log.date_key;
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
                          <button
                            type="button"
                            onClick={() => onOpenPersonLog?.(log.employee_id, log.employee_name)}
                            className="hover:underline text-right font-extrabold text-[var(--g-text)]"
                          >
                            {log.employee_name}
                          </button>
                          <span className="text-xs font-normal text-[var(--g-muted)]">
                            ({log.department})
                          </span>
                          {isCrossDay && (
                            <span className="px-2 py-0.5 rounded-full bg-[var(--g-purple-bg)] text-[var(--g-purple)] text-[10px] font-extrabold">
                              🌙 تابع لشفت {log.shift_date_key}
                            </span>
                          )}
                          {log.allowed_break_minutes > 0 && log.action_type === 'break_start' && (
                            <span className="px-2 py-0.5 rounded-full bg-[var(--g-yellow-bg)] text-[var(--g-yellow)] text-[10px] font-extrabold">
                              مسموح {log.allowed_break_minutes} د
                            </span>
                          )}
                          {log.break_duration_minutes > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-[var(--g-green-bg)] text-[var(--g-green)] text-[10px] font-extrabold">
                              استغرقت الاستراحة: {log.break_duration_minutes} د
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--g-muted)] flex flex-wrap items-center gap-1.5 mt-0.5">
                          <span className="num-ltr font-bold text-[var(--g-text)]">
                            {log.date_key} • {formatTimeWithSeconds(log.timestamp)}
                          </span>
                          <span>• {log.recorded_by}</span>
                          {log.late_minutes > 0 && (
                            <span className="text-[var(--g-yellow)] font-bold">
                              • تأخير {log.late_minutes} د
                            </span>
                          )}
                          {(log.note || log.break_reason) && (
                            <span>• "{log.note || log.break_reason}"</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
                      {onOpenPersonLog && (
                        <button
                          type="button"
                          onClick={() => onOpenPersonLog(log.employee_id, log.employee_name)}
                          className="px-2.5 py-1.5 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] text-xs font-bold flex items-center gap-1"
                          title="سجل الموظف الكامل"
                        >
                          <span className="ms-icon text-sm text-[var(--g-primary)]">assignment_ind</span>
                          <span>سجله</span>
                        </button>
                      )}

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
                          <span>تمت المطابقة ✓</span>
                        </span>
                      ) : canVerify ? (
                        <button
                          type="button"
                          onClick={(e) => handleVerifyLog(log.id, e)}
                          className="px-3.5 py-1.5 rounded-full bg-[#0B57D0] text-white text-xs font-extrabold flex items-center gap-1"
                        >
                          <span className="ms-icon filled text-base">fact_check</span>
                          <span>مطابقة الكاميرا ✓</span>
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

      {/* Material 3 Bottom Sheet / Dialog for Employee Attendance & Smart Break Control */}
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
                    {activeEmployee.department} • شفت 12 ساعة:{' '}
                    <span className="num-ltr font-bold">
                      {activeEmployee.shift_start || '08:00'} → {activeEmployee.shift_end || '20:00'}
                    </span>
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {canCallPhone && activeEmployee.phone && (
                      <a
                        href={`tel:${activeEmployee.phone}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--g-primary)] text-white text-xs font-extrabold no-underline shadow-2xs"
                      >
                        <span className="ms-icon filled text-sm">call</span>
                        <span>اتصال:</span>
                        <span className="num-ltr">{activeEmployee.phone}</span>
                      </a>
                    )}
                    {onOpenPersonLog && (
                      <button
                        type="button"
                        onClick={() => {
                          const emp = activeEmployee;
                          setActiveEmployee(null);
                          onOpenPersonLog(emp.id, emp.name);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] text-xs font-extrabold"
                      >
                        <span className="ms-icon text-sm">assignment_ind</span>
                        <span>فتح السجل الكامل للموظف</span>
                      </button>
                    )}
                  </div>
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

            {/* Smart Break Duration & Reason Selector (for Security / Supervisor / Admin) */}
            {(canManageRecords || activeEmployee.currentStatus === 'present') && (
              <div className="p-3.5 rounded-2xl bg-[var(--g-yellow-bg)]/50 border border-[var(--g-yellow-border)]/40 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-[var(--g-yellow)] flex items-center gap-1">
                    <span className="ms-icon text-base">timer</span>
                    <span>تحديد مدة وسبب الاستراحة (للأمن والمشرف):</span>
                  </span>
                  <span className="text-xs font-black num-ltr text-[var(--g-yellow)]">
                    {allowedBreakMins} دقيقة
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {BREAK_PRESETS.map((bp) => (
                    <button
                      key={bp.minutes}
                      type="button"
                      onClick={() => setAllowedBreakMins(bp.minutes)}
                      className={`py-2 px-2 rounded-xl text-xs font-extrabold transition-all border ${
                        Number(allowedBreakMins) === bp.minutes
                          ? 'bg-[#C25E00] text-white border-transparent shadow-2xs'
                          : 'bg-[var(--g-surface)] text-[var(--g-text)] border-[var(--g-border)]'
                      }`}
                    >
                      {bp.minutes} دقيقة
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[var(--g-muted)] shrink-0">مدة مخصصة (دقائق):</span>
                  <input
                    type="number"
                    min="5"
                    max="240"
                    value={allowedBreakMins}
                    onChange={(e) => setAllowedBreakMins(Number(e.target.value) || 30)}
                    className="g-input py-1.5 w-24 text-center num-ltr font-black text-sm"
                  />
                  <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                    {BREAK_REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setBreakReason(r)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap ${
                          breakReason === r
                            ? 'bg-[var(--g-primary)] text-white'
                            : 'bg-[var(--g-surface)] text-[var(--g-muted)]'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

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
                    <span>استراحة ({allowedBreakMins} د)</span>
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
                    <span>عودة للعمل (حساب البريك)</span>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <label className="block text-xs font-bold mb-1">مدة الاستراحة الفعلية (د)</label>
                <input
                  type="number"
                  min="0"
                  value={editingLog.break_duration_minutes ?? 0}
                  onChange={(e) =>
                    setEditingLog((l) => ({ ...l, break_duration_minutes: e.target.value }))
                  }
                  className="g-input num-ltr font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">ملاحظة / سبب الاستراحة</label>
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
