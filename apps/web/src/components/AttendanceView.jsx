import React, { useEffect, useMemo, useRef, useState } from 'react';
import ProofUploader from './ProofUploader.jsx';
import VoiceMicButton from './VoiceMicButton.jsx';
import {
  BottomSheet,
  Button,
  CockpitMetricStrip,
  ConfirmSheet,
  EmptyState,
  FilterChipRail,
  GroupedList,
  GroupedRow,
  Icon,
  RoleAvatar,
  SearchFilterBar,
  SectionHeader,
  SkeletonKpiStrip,
  SkeletonList,
  StatusDot,
  ToggleSwitch,
} from './ui/index.js';
import {
  postActionWithOfflineSupport,
  apiRequest,
  verifyAttendanceLog,
  computeShiftDurationHoursClient,
  formatShiftDurationArabicClient,
} from '../lib/api.js';
import { playSuccessChime, speakArabicConfirmation } from '../lib/audio.js';
import {
  formatTimeArabic,
  exportDailyAttendanceExcel,
  buildAttendanceWhatsAppText,
  openWhatsAppShare,
} from '../lib/exportUtils.js';

const STATUS_META = {
  present: { label: 'حاضر', tone: 'success' },
  on_break: { label: 'بريك', tone: 'warning' },
  checked_out: { label: 'منصرف', tone: 'primary' },
  absent: { label: 'غائب', tone: 'neutral' },
};

function getLogCctvStatus(log) {
  if (!log) return 'none';
  if (
    log.cctv_status === 'confirmed' ||
    log.cctv_status === 'mismatch' ||
    log.cctv_status === 'pending'
  ) {
    return log.cctv_status;
  }
  return Number(log.verified_by_cctv) ? 'confirmed' : 'pending';
}

function getEmployeeCctvStatus(emp) {
  if (!emp || !emp.latestLogId) return 'none';
  if (
    emp.latestCctvStatus === 'confirmed' ||
    emp.latestCctvStatus === 'mismatch' ||
    emp.latestCctvStatus === 'pending'
  ) {
    return emp.latestCctvStatus;
  }
  return emp.latestVerified ? 'confirmed' : 'pending';
}

function extractLocalHHMM(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const CCTV_NOTE_PRESETS = [
  'حضر في الموعد وظاهر على DVR',
  'لم يظهر بالكاميرا في الموعد',
  'وقت الكاميرا مختلف عن المسجل',
  'انصرف قبل الموعد المسجل',
];

const CALL_ALLOWED_ROLES = new Set(['owner', 'manager', 'supervisor', 'cctv', 'security']);

const QUICK_ATTENDANCE_NOTES = [
  'حضور منتظم',
  'بإذن مسبق',
  'تأخير مواصلات',
  'غداء / صلاة',
  'مأمورية خاصة',
  'إضافي',
];

const BREAK_PRESETS = [15, 30, 45, 60];
const BREAK_REASONS = ['غداء', 'صلاة', 'راحة قصيرة', 'إذن خاص', 'طارئ'];

const ACTION_META = {
  check_in: { label: 'حضور', dotTone: 'success' },
  break_start: { label: 'بريك', dotTone: 'warning' },
  break_end: { label: 'عودة', dotTone: 'primary' },
  check_out: { label: 'انصراف', dotTone: 'danger' },
};

/**
 * Detoxed Attendance & Shift Control View (`الحضور`).
 * Zero read-only promo box, `<CockpitMetricStrip />`, hairline `<GroupedList>` employee rows
 * (max 1 StatusDot + 1 quiet meta line + primary action + tap for Details Sheet),
 * and clean chronological `<GroupedList>` logs.
 */
export default function AttendanceView({
  employees = [],
  attendanceLogs = [],
  storeName = 'زايد مارت',
  branchName = '',
  dateKey = '',
  maxBreakMinutes = 30,
  actorName = 'الأمن',
  actorRole = '',
  myProfile = null,
  filterRequest = null,
  loading = false,
  canWrite = true,
  canSelfAttendance = false,
  canVerify = false,
  canReadLogs = true,
  canPrintCards = true,
  canExport = false,
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
  const [breakReason, setBreakReason] = useState('غداء');
  const [customTimeHHMM, setCustomTimeHHMM] = useState('');
  const [proofDataUrl, setProofDataUrl] = useState('');
  const [confirmByCctv, setConfirmByCctv] = useState(true);
  const [cctvNote, setCctvNote] = useState('');
  const [cctvObservedTime, setCctvObservedTime] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [busyEmployeeId, setBusyEmployeeId] = useState('');
  const [verifyBusyLogId, setVerifyBusyLogId] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);

  const [editingLog, setEditingLog] = useState(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const [exportSheetOpen, setExportSheetOpen] = useState(false);

  const [confirmCheckoutEmp, setConfirmCheckoutEmp] = useState(null);
  const [confirmReopenEmp, setConfirmReopenEmp] = useState(null);
  const [deleteLogTarget, setDeleteLogTarget] = useState(null);
  const [deletingLogId, setDeletingLogId] = useState('');

  const cardsSectionRef = useRef(null);
  const canCallPhone = CALL_ALLOWED_ROLES.has(actorRole) || canReadLogs;
  const isOwner = actorRole === 'owner';
  void canSelfAttendance;

  const resolvedActiveEmployee = useMemo(() => {
    if (!activeEmployee) return null;
    return employees.find((e) => e.id === activeEmployee.id) || activeEmployee;
  }, [activeEmployee, employees]);

  function isOwnEmployeeRecord(emp) {
    if (!emp) return false;
    if (myProfile?.employee_id && myProfile.employee_id === emp.id) return true;
    return String(emp.name || '').trim() === String(actorName || '').trim();
  }

  function canActOnEmployee() {
    return Boolean(canWrite);
  }

  useEffect(() => {
    if (filterRequest?.status) {
      const incoming =
        filterRequest.status === 'mismatch'
          ? 'mismatch_cctv'
          : filterRequest.status === 'unverified'
          ? 'pending_cctv'
          : filterRequest.status;
      setStatusFilter(incoming);
      setSelectedDept('الكل');
      setSearchQuery('');
      setTimeout(() => {
        cardsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    }
  }, [filterRequest]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const departmentChipItems = useMemo(() => {
    const counts = new Map();
    for (const e of employees) {
      const d = e.department || 'أخرى';
      counts.set(d, (counts.get(d) || 0) + 1);
    }
    const items = [{ id: 'الكل', label: 'الكل', count: employees.length }];
    for (const [dept, count] of counts.entries()) {
      items.push({ id: dept, label: dept, count });
    }
    return items;
  }, [employees]);

  const scheduledOffCount = useMemo(
    () => employees.filter((e) => e.isScheduledOff && !e.workedOnDayOff).length,
    [employees]
  );

  const empCctvLogFlags = useMemo(() => {
    const map = new Map();
    for (const log of attendanceLogs) {
      if (!log?.employee_id) continue;
      const entry = map.get(log.employee_id) || { hasPending: false, hasMismatch: false };
      const st = getLogCctvStatus(log);
      if (st === 'pending') entry.hasPending = true;
      if (st === 'mismatch') entry.hasMismatch = true;
      map.set(log.employee_id, entry);
    }
    return map;
  }, [attendanceLogs]);

  const pendingCctvCount = useMemo(
    () =>
      employees.filter((emp) => {
        const st = getEmployeeCctvStatus(emp);
        return st === 'pending' || Boolean(empCctvLogFlags.get(emp.id)?.hasPending);
      }).length,
    [employees, empCctvLogFlags]
  );

  const mismatchCctvCount = useMemo(
    () =>
      employees.filter((emp) => {
        const st = getEmployeeCctvStatus(emp);
        return st === 'mismatch' || Boolean(empCctvLogFlags.get(emp.id)?.hasMismatch);
      }).length,
    [employees, empCctvLogFlags]
  );

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((emp) => {
      if (selectedDept !== 'الكل' && emp.department !== selectedDept) return false;
      if (statusFilter === 'present' && emp.currentStatus !== 'present') return false;
      if (statusFilter === 'on_break' && emp.currentStatus !== 'on_break') return false;
      if (statusFilter === 'absent' && emp.currentStatus !== 'absent') return false;
      if (statusFilter === 'checked_out' && emp.currentStatus !== 'checked_out') return false;
      if (statusFilter === 'scheduled_off' && !(emp.isScheduledOff && !emp.workedOnDayOff))
        return false;
      if (statusFilter === 'pending_cctv') {
        const st = getEmployeeCctvStatus(emp);
        if (st !== 'pending' && !empCctvLogFlags.get(emp.id)?.hasPending) return false;
      }
      if (statusFilter === 'mismatch_cctv') {
        const st = getEmployeeCctvStatus(emp);
        if (st !== 'mismatch' && !empCctvLogFlags.get(emp.id)?.hasMismatch) return false;
      }
      if (q) {
        const hay = `${emp.name || ''} ${isOwner ? emp.emp_code || '' : ''} ${emp.department || ''} ${emp.role_title || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [employees, selectedDept, statusFilter, searchQuery, isOwner, empCctvLogFlags]);

  const displayedLogs = useMemo(() => {
    if (statusFilter === 'pending_cctv') {
      return attendanceLogs.filter((l) => getLogCctvStatus(l) === 'pending');
    }
    if (statusFilter === 'mismatch_cctv') {
      return attendanceLogs.filter((l) => getLogCctvStatus(l) === 'mismatch');
    }
    return attendanceLogs;
  }, [attendanceLogs, statusFilter]);

  const presentCount = useMemo(
    () => employees.filter((e) => e.currentStatus === 'present').length,
    [employees]
  );
  const onBreakCount = useMemo(
    () => employees.filter((e) => e.currentStatus === 'on_break').length,
    [employees]
  );
  const checkedOutCount = useMemo(
    () => employees.filter((e) => e.currentStatus === 'checked_out').length,
    [employees]
  );

  const attendanceExportData = useMemo(() => {
    const absentCount = Math.max(
      0,
      employees.length - presentCount - onBreakCount - checkedOutCount
    );
    const lateCount = employees.filter((e) => (e.lateMinutes || 0) > 0).length;
    const unverifiedAttendanceCount = attendanceLogs.filter(
      (l) => getLogCctvStatus(l) === 'pending'
    ).length;
    const mismatchAttendanceCount = attendanceLogs.filter(
      (l) => getLogCctvStatus(l) === 'mismatch'
    ).length;

    return {
      dateKey: dateKey || new Date().toISOString().slice(0, 10),
      settings: {
        store_name: storeName || 'زايد مارت',
        branch_name: branchName || '',
        max_break_minutes: maxBreakMinutes || 30,
      },
      employees,
      attendanceLogs,
      summary: {
        totalEmployees: employees.length,
        presentCount,
        onBreakCount,
        checkedOutCount,
        absentCount,
        lateCount,
        unverifiedAttendanceCount,
        mismatchAttendanceCount,
      },
    };
  }, [
    employees,
    attendanceLogs,
    dateKey,
    storeName,
    branchName,
    maxBreakMinutes,
    presentCount,
    onBreakCount,
    checkedOutCount,
  ]);

  const metricItems = useMemo(
    () => [
      {
        id: 'all',
        label: 'الكل',
        value: employees.length,
        active: statusFilter === 'all',
        onClick: () => setStatusFilter('all'),
      },
      {
        id: 'present',
        label: 'حاضر',
        value: presentCount,
        dotTone: presentCount > 0 ? 'success' : '',
        active: statusFilter === 'present',
        onClick: () => setStatusFilter((p) => (p === 'present' ? 'all' : 'present')),
      },
      {
        id: 'on_break',
        label: 'بريك',
        value: onBreakCount,
        secondary: onBreakCount > 0 ? `حد ${maxBreakMinutes}د` : '',
        dotTone: onBreakCount > 0 ? 'warning' : '',
        active: statusFilter === 'on_break',
        onClick: () => setStatusFilter((p) => (p === 'on_break' ? 'all' : 'on_break')),
      },
      {
        id: 'checked_out',
        label: 'منصرف',
        value: checkedOutCount,
        active: statusFilter === 'checked_out',
        onClick: () => setStatusFilter((p) => (p === 'checked_out' ? 'all' : 'checked_out')),
      },
    ],
    [employees.length, presentCount, onBreakCount, checkedOutCount, maxBreakMinutes, statusFilter]
  );

  function getBreakElapsedMinutes(emp) {
    if (emp.currentStatus !== 'on_break') return 0;
    const startTs = emp.activeBreakStart || emp.latestActionTime;
    if (!startTs) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(startTs).getTime()) / 60000));
  }

  function openEmployeeModal(emp, defaultBreakMins = null) {
    if (!emp) return;
    setActiveEmployee(emp);
    setNote('');
    setAllowedBreakMins(defaultBreakMins || emp.allowedBreakMinutes || maxBreakMinutes || 30);
    setBreakReason('غداء');
    setCustomTimeHHMM('');
    setProofDataUrl('');
    setConfirmByCctv(true);
    setCctvNote('');
    setCctvObservedTime('');
  }

  async function submitAttendance(
    actionType,
    customBreakOverride = null,
    allowReopenShift = false
  ) {
    const targetEmp = resolvedActiveEmployee;
    if (!targetEmp || submitting || !canWrite) return;
    setSubmitting(true);
    setBusyEmployeeId(targetEmp.id);
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
          employee_id: targetEmp.id,
          action_type: actionType,
          note: note.trim() || (actionType === 'break_start' ? breakReason : ''),
          allowed_break_minutes: finalBreakMins,
          break_reason: actionType === 'break_start' ? breakReason : '',
          allow_reopen_shift: Boolean(allowReopenShift),
          recorded_by: actorName,
          ...(manualIso ? { timestamp: manualIso } : {}),
          ...(canVerify
            ? {
                confirm_by_cctv: Boolean(confirmByCctv),
                ...(confirmByCctv && (cctvObservedTime || customTimeHHMM)
                  ? { cctv_observed_time: cctvObservedTime || customTimeHHMM }
                  : {}),
                ...(confirmByCctv && cctvNote.trim() ? { cctv_note: cctvNote.trim() } : {}),
              }
            : {}),
        },
        {
          rawDataUrl: proofDataUrl,
          proofField: 'proof_url',
        }
      );

      playSuccessChime(actionType === 'check_out' ? 'out' : 'in');
      const actionAr = ACTION_META[actionType]?.label || 'حركة';
      speakArabicConfirmation(
        `تم تسجيل ${actionAr}، ${targetEmp.name}`,
        voiceConfirmEnabled
      );

      onToast?.(
        res.queuedOffline
          ? `تم حفظ ${actionAr} (${targetEmp.name}) محلياً`
          : `تم تسجيل ${actionAr} — ${targetEmp.name}`
      );
      setActiveEmployee(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر تسجيل الحركة', 'error');
    } finally {
      setSubmitting(false);
      setBusyEmployeeId('');
    }
  }

  async function handleQuickCardAction(
    emp,
    actionType,
    e,
    customBreakMinutes = null,
    allowReopenShift = false
  ) {
    e?.stopPropagation?.();
    if (!canActOnEmployee(emp) || submitting || busyEmployeeId) return;
    setSubmitting(true);
    setBusyEmployeeId(emp.id);
    try {
      const res = await postActionWithOfflineSupport('/api/attendance', {
        employee_id: emp.id,
        action_type: actionType,
        allowed_break_minutes:
          actionType === 'break_start' ? Number(customBreakMinutes || maxBreakMinutes || 30) : 0,
        break_reason: actionType === 'break_start' ? 'استراحة' : '',
        allow_reopen_shift: Boolean(allowReopenShift),
        note: allowReopenShift ? 'إعادة فتح الشفت استثنائياً' : '',
        recorded_by: actorName,
      });
      playSuccessChime(actionType === 'check_out' ? 'out' : 'in');
      const actionAr = ACTION_META[actionType]?.label || 'حركة';
      speakArabicConfirmation(`تم تسجيل ${actionAr}، ${emp.name}`, voiceConfirmEnabled);
      onToast?.(
        res.queuedOffline
          ? `تم حفظ ${actionAr} (${emp.name}) محلياً`
          : `تم تسجيل ${actionAr} — ${emp.name}`
      );
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر تسجيل الحركة', 'error');
    } finally {
      setSubmitting(false);
      setBusyEmployeeId('');
    }
  }

  async function handleVerifyLog(logId, e) {
    e?.stopPropagation?.();
    if (!logId || verifyBusyLogId) return;
    setVerifyBusyLogId(logId);
    try {
      await verifyAttendanceLog(logId, { status: 'confirmed' });
      playSuccessChime('in');
      onToast?.('تم تأكيد الحضور بالكاميرا');
      onRefresh?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر تأكيد الحركة', 'error');
    } finally {
      setVerifyBusyLogId('');
    }
  }

  function openCctvReviewForLog(log, e) {
    e?.stopPropagation?.();
    if (!log?.id) return;
    setActiveEmployee(null);
    const currentStatus = getLogCctvStatus(log);
    const meta = ACTION_META[log.action_type] || ACTION_META.check_in;
    setReviewTarget({
      logId: log.id,
      employeeName: log.employee_name || 'موظف',
      department: log.department || '',
      actionLabel: meta.label,
      recordedTimeIso: log.timestamp || '',
      recordedBy: log.recorded_by || '',
      currentStatus,
      status: currentStatus === 'mismatch' ? 'mismatch' : 'confirmed',
      observedTime: log.cctv_observed_time || extractLocalHHMM(log.timestamp),
      note: log.cctv_note || '',
    });
  }

  function openCctvReviewForEmployee(emp, e) {
    e?.stopPropagation?.();
    if (!emp?.latestLogId) return;
    setActiveEmployee(null);
    const matchedLog = attendanceLogs.find((l) => l.id === emp.latestLogId);
    if (matchedLog) {
      openCctvReviewForLog(matchedLog, e);
      return;
    }
    const currentStatus = getEmployeeCctvStatus(emp);
    const actionLabel = ACTION_META[emp.latestActionType]?.label || 'حضور';
    setReviewTarget({
      logId: emp.latestLogId,
      employeeName: emp.name || 'موظف',
      department: emp.department || '',
      actionLabel,
      recordedTimeIso: emp.latestActionTime || emp.checkInTime || '',
      recordedBy: emp.latestRecordedBy || '',
      currentStatus,
      status: currentStatus === 'mismatch' ? 'mismatch' : 'confirmed',
      observedTime:
        emp.latestCctvObservedTime ||
        extractLocalHHMM(emp.latestActionTime || emp.checkInTime),
      note: emp.latestCctvNote || '',
    });
  }

  async function handleSubmitCctvReview(e) {
    e?.preventDefault?.();
    if (!reviewTarget?.logId || reviewSubmitting) return;
    setReviewSubmitting(true);
    try {
      await verifyAttendanceLog(reviewTarget.logId, {
        status: reviewTarget.status,
        observed_time: (reviewTarget.observedTime || '').trim(),
        note: (reviewTarget.note || '').trim(),
      });
      playSuccessChime(reviewTarget.status === 'mismatch' ? 'alert' : 'in');
      onToast?.(
        reviewTarget.status === 'mismatch'
          ? `تم تسجيل تعارض كاميرا — ${reviewTarget.employeeName}`
          : `تم تأكيد الحضور — ${reviewTarget.employeeName}`
      );
      setReviewTarget(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر حفظ المراجعة', 'error');
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function handleExportAttendanceExcel() {
    if (exportingExcel) return;
    setExportingExcel(true);
    try {
      await exportDailyAttendanceExcel(attendanceExportData);
      onToast?.('تم تحميل ملف Excel');
    } catch (err) {
      onToast?.(err?.message || 'تعذر تصدير Excel', 'error');
    } finally {
      setExportingExcel(false);
    }
  }

  async function handleCopyAttendanceText() {
    try {
      const text = buildAttendanceWhatsAppText(attendanceExportData);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      onToast?.('تم نسخ التقرير');
    } catch {
      onToast?.('تعذر النسخ التلقائي', 'error');
    }
  }

  function handleShareAttendanceWhatsApp() {
    const text = buildAttendanceWhatsAppText(attendanceExportData);
    openWhatsAppShare(text);
  }

  function openEditAttendanceLog(log) {
    const hhmm = extractLocalHHMM(log.timestamp) || '08:00';
    setEditingLog({
      ...log,
      hhmm,
    });
  }

  async function handleSaveEditedLog(e) {
    e?.preventDefault?.();
    if (!editingLog || editSubmitting) return;
    setEditSubmitting(true);
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
        cctv_status: editingLog.verified_by_cctv
          ? 'confirmed'
          : editingLog.cctv_status === 'mismatch'
          ? 'mismatch'
          : 'pending',
      });
      setEditingLog(null);
      onToast?.('تم حفظ التعديل');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر حفظ التعديل', 'error');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleConfirmDeleteLog() {
    if (!deleteLogTarget || deletingLogId) return;
    setDeletingLogId(deleteLogTarget.id);
    try {
      await apiRequest(`/api/attendance/${deleteLogTarget.id}`, 'DELETE');
      setDeleteLogTarget(null);
      onToast?.('تم حذف الحركة');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر حذف الحركة', 'error');
    } finally {
      setDeletingLogId('');
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonKpiStrip count={4} />
        <SkeletonList rows={5} />
      </div>
    );
  }

  const hasAnyActiveFilter =
    statusFilter !== 'all' || selectedDept !== 'الكل' || searchQuery.trim() !== '';

  const secondaryFilterChips = [];
  if (canVerify) {
    secondaryFilterChips.push(
      { id: 'pending_cctv', label: 'بانتظار الكاميرا', count: pendingCctvCount },
      {
        id: 'mismatch_cctv',
        label: 'تعارض كاميرا',
        count: mismatchCctvCount,
        alert: mismatchCctvCount > 0,
      }
    );
  }
  if (scheduledOffCount > 0) {
    secondaryFilterChips.push({
      id: 'scheduled_off',
      label: 'إجازة اليوم',
      count: scheduledOffCount,
    });
  }

  return (
    <div className="space-y-5">
      {/* 1. Borderless Header & Toolbar */}
      <div className="space-y-3">
        <SectionHeader
          title="الحضور"
          subtitle={!canWrite ? 'للعرض فقط' : dateKey}
          actions={
            <div className="flex items-center gap-1.5 flex-wrap">
              {canWrite && (
                <Button
                  variant="primary"
                  size="sm"
                  icon="qr_code_scanner"
                  onClick={() => onOpenQrModal?.('scan')}
                >
                  QR
                </Button>
              )}

              {(canPrintCards || canExport || canWrite || canVerify) && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="ios_share"
                  onClick={() => setExportSheetOpen(true)}
                  className="md:hidden"
                >
                  تصدير
                </Button>
              )}

              <div className="hidden md:flex items-center gap-1.5 flex-wrap">
                {canPrintCards && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="print"
                    onClick={() => onOpenQrModal?.('cards')}
                  >
                    كروت QR
                  </Button>
                )}
                {(canExport || canWrite || canVerify) && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="table_view"
                      loading={exportingExcel}
                      onClick={handleExportAttendanceExcel}
                    >
                      Excel
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="content_copy"
                      onClick={handleCopyAttendanceText}
                    >
                      نسخ
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="share"
                      onClick={handleShareAttendanceWhatsApp}
                    >
                      واتساب
                    </Button>
                  </>
                )}
              </div>
            </div>
          }
        />

        <SearchFilterBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="بحث بالاسم أو القسم..."
        />
      </div>

      {/* 2. Adaptive 4-Metric Cockpit Strip */}
      <CockpitMetricStrip items={metricItems} columns={4} />

      {/* 3. Filters */}
      <div className="space-y-2">
        {secondaryFilterChips.length > 0 && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <FilterChipRail
              items={secondaryFilterChips}
              activeId={statusFilter}
              onSelect={(id) => setStatusFilter((prev) => (prev === id ? 'all' : id))}
            />
            {hasAnyActiveFilter && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setSelectedDept('الكل');
                  setSearchQuery('');
                }}
                className="text-xs font-medium text-primary hover:underline cursor-pointer min-h-[36px] px-1"
              >
                إعادة ضبط
              </button>
            )}
          </div>
        )}

        <FilterChipRail
          items={departmentChipItems}
          activeId={selectedDept}
          onSelect={setSelectedDept}
        />
      </div>

      {/* 4. Detoxed Hairline Employee List */}
      <div ref={cardsSectionRef} className="scroll-mt-24">
        {employees.length === 0 ? (
          <EmptyState
            title="لا يوجد موظفون"
            actionLabel={canManageStaff ? 'إضافة موظف' : ''}
            actionIcon="add"
            onAction={canManageStaff ? () => onJumpToRealData?.('staff') : undefined}
          />
        ) : filteredEmployees.length === 0 ? (
          <EmptyState
            compact
            title="لا توجد نتائج مطابقة"
            actionLabel={hasAnyActiveFilter ? 'عرض الكل' : ''}
            onAction={
              hasAnyActiveFilter
                ? () => {
                    setStatusFilter('all');
                    setSelectedDept('الكل');
                    setSearchQuery('');
                  }
                : undefined
            }
          />
        ) : (
          <GroupedList>
            {filteredEmployees.map((emp) => {
              const breakMins = getBreakElapsedMinutes(emp);
              const empAllowedBreak = emp.allowedBreakMinutes || maxBreakMinutes || 30;
              const breakExceeded =
                emp.currentStatus === 'on_break' && breakMins > empAllowedBreak;
              const cctvStatus = getEmployeeCctvStatus(emp);
              const canEmpWrite = canActOnEmployee();
              const isSelfCard = isOwnEmployeeRecord(emp);
              const isCardBusy = busyEmployeeId === emp.id;
              const canCheckInAfterCheckout = Boolean(
                emp.nextCheckInAvailability?.canCheckIn
              );
              const nextWindowTimeStr =
                emp.nextCheckInAvailability?.windowOpenTimeStr ||
                emp.shift_start ||
                '08:00';

              const isOffToday =
                emp.currentStatus === 'absent' &&
                emp.isScheduledOff &&
                !emp.workedOnDayOff;

              const dotTone = isOffToday
                ? 'purple'
                : emp.currentStatus === 'present'
                ? 'success'
                : emp.currentStatus === 'on_break'
                ? breakExceeded
                  ? 'danger'
                  : 'warning'
                : emp.currentStatus === 'checked_out'
                ? 'primary'
                : 'neutral';

              const dotLabel = isOffToday
                ? 'إجازة'
                : emp.currentStatus === 'present'
                ? 'حاضر'
                : emp.currentStatus === 'on_break'
                ? `بريك ${breakMins}د`
                : emp.currentStatus === 'checked_out'
                ? 'منصرف'
                : 'غائب';

              const metaParts = [
                emp.department,
                `${emp.shift_start || '08:00'}–${emp.shift_end || '20:00'}`,
                emp.checkInTime ? extractLocalHHMM(emp.checkInTime) : '',
                isOwner && emp.emp_code ? `#${emp.emp_code}` : '',
              ].filter(Boolean);

              return (
                <div
                  key={emp.id}
                  className={`min-h-[60px] px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                    isSelfCard ? 'bg-surface-tint' : ''
                  }`}
                >
                  {/* Tappable Employee Info -> Details Sheet */}
                  <button
                    type="button"
                    onClick={() => openEmployeeModal(emp)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-start bg-transparent border-0 p-0 cursor-pointer"
                  >
                    <RoleAvatar
                      src={emp.avatar_url || ''}
                      name={emp.name}
                      role={emp.system_role || ''}
                      color={emp.avatar_color || ''}
                      preset="initials_gradient"
                      size="sm"
                      shape="circle"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="text-sm font-semibold text-ink truncate">
                          {emp.name}
                        </span>
                        <StatusDot
                          tone={dotTone}
                          label={dotLabel}
                          tintedText={dotTone === 'danger' || dotTone === 'warning'}
                        />
                        {cctvStatus === 'confirmed' && (
                          <Icon
                            name="verified"
                            size={14}
                            filled
                            className="text-success shrink-0"
                            ariaLabel="مؤكد بالكاميرا"
                          />
                        )}
                      </div>

                      <div className="text-xs text-ink-muted truncate num-ltr mt-0.5">
                        {metaParts.join(' · ')}
                        {emp.lateMinutes > 0 && (
                          <span className="text-warning font-medium">
                            {' '}
                            · تأخير {emp.lateMinutes}د
                          </span>
                        )}
                        {cctvStatus === 'mismatch' && (
                          <span className="text-danger font-medium"> · تعارض كاميرا</span>
                        )}
                        {breakExceeded && (
                          <span className="text-danger font-medium">
                            {' '}
                            · تجاوز +{breakMins - empAllowedBreak}د
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* End Action Strip */}
                  <div className="flex items-center justify-end gap-1.5 flex-wrap shrink-0">
                    {canVerify &&
                      emp.latestLogId &&
                      (cctvStatus === 'pending' || cctvStatus === 'mismatch') && (
                        <Button
                          variant={cctvStatus === 'mismatch' ? 'dangerTonal' : 'secondary'}
                          size="sm"
                          loading={verifyBusyLogId === emp.latestLogId}
                          onClick={(e) => handleVerifyLog(emp.latestLogId, e)}
                        >
                          تأكيد
                        </Button>
                      )}

                    {canEmpWrite && emp.currentStatus === 'absent' && (
                      <Button
                        variant="success"
                        size="sm"
                        loading={isCardBusy}
                        disabled={submitting && !isCardBusy}
                        onClick={(e) => handleQuickCardAction(emp, 'check_in', e)}
                      >
                        حضور
                      </Button>
                    )}

                    {canEmpWrite && emp.currentStatus === 'present' && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={submitting}
                          onClick={() => openEmployeeModal(emp, 30)}
                        >
                          بريك
                        </Button>
                        <Button
                          variant="dangerTonal"
                          size="sm"
                          disabled={submitting}
                          onClick={() => setConfirmCheckoutEmp(emp)}
                        >
                          انصراف
                        </Button>
                      </>
                    )}

                    {canEmpWrite && emp.currentStatus === 'on_break' && (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          loading={isCardBusy}
                          disabled={submitting && !isCardBusy}
                          onClick={(e) => handleQuickCardAction(emp, 'break_end', e)}
                        >
                          عودة
                        </Button>
                        <Button
                          variant="dangerTonal"
                          size="sm"
                          disabled={submitting}
                          onClick={() => setConfirmCheckoutEmp(emp)}
                        >
                          انصراف
                        </Button>
                      </>
                    )}

                    {canEmpWrite && emp.currentStatus === 'checked_out' && (
                      <>
                        {canCheckInAfterCheckout ? (
                          <Button
                            variant="success"
                            size="sm"
                            loading={isCardBusy}
                            disabled={submitting && !isCardBusy}
                            onClick={(e) => handleQuickCardAction(emp, 'check_in', e)}
                          >
                            حضور
                          </Button>
                        ) : (
                          <>
                            <span className="num-ltr text-xs text-ink-muted px-1">
                              يفتح {nextWindowTimeStr}
                            </span>
                            {canManageRecords && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={submitting}
                                onClick={() => setConfirmReopenEmp(emp)}
                              >
                                إعادة فتح
                              </Button>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </GroupedList>
        )}
      </div>

      {/* 5. Chronological Hairline Attendance Logs */}
      {canReadLogs && (
        <section className="space-y-3">
          <SectionHeader
            title="سجل الحضور"
            count={displayedLogs.length}
            actions={
              (statusFilter === 'pending_cctv' || statusFilter === 'mismatch_cctv') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStatusFilter('all')}
                >
                  عرض الكل
                </Button>
              )
            }
          />

          {displayedLogs.length === 0 ? (
            <EmptyState
              compact
              title={
                attendanceLogs.length === 0
                  ? 'لا توجد حركات اليوم'
                  : 'لا توجد حركات مطابقة'
              }
            />
          ) : (
            <GroupedList>
              {displayedLogs.map((log) => {
                const meta = ACTION_META[log.action_type] || ACTION_META.check_in;
                const logCctvStatus = getLogCctvStatus(log);
                const subParts = [
                  log.department,
                  log.recorded_by,
                  log.late_minutes > 0 ? `تأخير ${log.late_minutes}د` : '',
                  log.break_duration_minutes > 0 ? `بريك ${log.break_duration_minutes}د` : '',
                  log.cctv_observed_time ? `DVR ${log.cctv_observed_time}` : '',
                  log.note || log.break_reason || '',
                ].filter(Boolean);

                return (
                  <div
                    key={log.id}
                    className="min-h-[54px] px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <StatusDot
                        tone={logCctvStatus === 'mismatch' ? 'danger' : meta.dotTone}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <span className="text-xs sm:text-sm font-medium text-ink truncate">
                            {meta.label} ·{' '}
                            <button
                              type="button"
                              onClick={() =>
                                onOpenPersonLog?.(log.employee_id, log.employee_name)
                              }
                              className="font-semibold hover:underline text-ink bg-transparent border-0 p-0 cursor-pointer"
                            >
                              {log.employee_name}
                            </button>
                          </span>
                          {logCctvStatus === 'confirmed' && (
                            <Icon
                              name="verified"
                              size={14}
                              filled
                              className="text-success shrink-0"
                              ariaLabel="مؤكد بالكاميرا"
                            />
                          )}
                          {logCctvStatus === 'mismatch' && (
                            <span className="text-xs font-medium text-danger shrink-0">
                              تعارض
                            </span>
                          )}
                        </div>
                        {subParts.length > 0 && (
                          <div className="text-xs text-ink-muted truncate">
                            {subParts.join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-1.5 flex-wrap pt-1 sm:pt-0 shrink-0">
                      <span className="num-ltr text-xs font-medium text-ink-muted px-1">
                        {extractLocalHHMM(log.timestamp)}
                      </span>

                      {log.proof_url && (
                        <button
                          type="button"
                          onClick={() =>
                            onPreviewImage?.(
                              log.proof_url,
                              `${log.employee_name} - ${meta.label}`
                            )
                          }
                          aria-label="عرض الإثبات"
                          className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-primary inline-flex items-center justify-center cursor-pointer"
                        >
                          <Icon name="image" size={18} />
                        </button>
                      )}

                      {canVerify && logCctvStatus !== 'confirmed' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={verifyBusyLogId === log.id}
                          onClick={(e) => handleVerifyLog(log.id, e)}
                        >
                          تأكيد
                        </Button>
                      )}

                      {canVerify && (
                        <button
                          type="button"
                          onClick={(e) => openCctvReviewForLog(log, e)}
                          aria-label="مراجعة بالكاميرا"
                          className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink inline-flex items-center justify-center cursor-pointer"
                        >
                          <Icon name="videocam" size={18} />
                        </button>
                      )}

                      {canManageRecords && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditAttendanceLog(log)}
                            aria-label={`تعديل حركة ${log.employee_name}`}
                            className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink inline-flex items-center justify-center cursor-pointer"
                          >
                            <Icon name="edit" size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteLogTarget(log)}
                            aria-label={`حذف حركة ${log.employee_name}`}
                            className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-danger-bg text-ink-muted hover:text-danger inline-flex items-center justify-center cursor-pointer"
                          >
                            <Icon name="delete" size={18} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </GroupedList>
          )}
        </section>
      )}

      {/* MODAL 1: Employee Details & Control Sheet */}
      {resolvedActiveEmployee &&
        (() => {
          const activeCctvStatus = getEmployeeCctvStatus(resolvedActiveEmployee);
          const activeStatusMeta =
            STATUS_META[resolvedActiveEmployee.currentStatus || 'absent'] ||
            STATUS_META.absent;
          const activeShiftHours =
            resolvedActiveEmployee.shiftDurationHours ||
            computeShiftDurationHoursClient(
              resolvedActiveEmployee.shift_start,
              resolvedActiveEmployee.shift_end
            );
          const activeShiftLabel =
            resolvedActiveEmployee.shiftDurationLabel ||
            formatShiftDurationArabicClient(activeShiftHours);

          const stickyFooter = canWrite ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(!resolvedActiveEmployee.currentStatus ||
                resolvedActiveEmployee.currentStatus === 'absent') && (
                <Button
                  variant="success"
                  size="lg"
                  fullWidth
                  loading={submitting}
                  onClick={() => submitAttendance('check_in')}
                  className="sm:col-span-2"
                >
                  تسجيل حضور
                </Button>
              )}

              {resolvedActiveEmployee.currentStatus === 'present' && (
                <>
                  <Button
                    variant="warning"
                    size="lg"
                    fullWidth
                    loading={submitting}
                    onClick={() => submitAttendance('break_start')}
                  >
                    بريك ({allowedBreakMins}د)
                  </Button>
                  <Button
                    variant="danger"
                    size="lg"
                    fullWidth
                    loading={submitting}
                    onClick={() => submitAttendance('check_out')}
                  >
                    انصراف
                  </Button>
                </>
              )}

              {resolvedActiveEmployee.currentStatus === 'on_break' && (
                <>
                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    loading={submitting}
                    onClick={() => submitAttendance('break_end')}
                  >
                    عودة من البريك
                  </Button>
                  <Button
                    variant="danger"
                    size="lg"
                    fullWidth
                    loading={submitting}
                    onClick={() => submitAttendance('check_out')}
                  >
                    انصراف
                  </Button>
                </>
              )}

              {resolvedActiveEmployee.currentStatus === 'checked_out' && (
                <>
                  {resolvedActiveEmployee.nextCheckInAvailability?.canCheckIn ? (
                    <Button
                      variant="success"
                      size="lg"
                      fullWidth
                      loading={submitting}
                      onClick={() => submitAttendance('check_in')}
                      className="sm:col-span-2"
                    >
                      تسجيل حضور
                    </Button>
                  ) : (
                    canManageRecords && (
                      <Button
                        variant="secondary"
                        size="md"
                        fullWidth
                        loading={submitting}
                        onClick={() => submitAttendance('check_in', null, true)}
                        className="sm:col-span-2"
                      >
                        إعادة فتح الشفت
                      </Button>
                    )
                  )}
                </>
              )}
            </div>
          ) : null;

          return (
            <BottomSheet
              open={Boolean(resolvedActiveEmployee)}
              onClose={() => !submitting && setActiveEmployee(null)}
              title={resolvedActiveEmployee.name || 'موظف'}
              subtitle={`${resolvedActiveEmployee.department || '—'} · ${resolvedActiveEmployee.shift_start || '08:00'}–${resolvedActiveEmployee.shift_end || '20:00'} (${activeShiftLabel})`}
              badge={
                <StatusDot
                  tone={activeStatusMeta.tone}
                  label={activeStatusMeta.label}
                  tintedText
                />
              }
              maxWidth="max-w-lg"
              footer={stickyFooter}
            >
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  {canCallPhone && resolvedActiveEmployee.phone && (
                    <a
                      href={`tel:${resolvedActiveEmployee.phone}`}
                      className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-[var(--g-radius-btn)] bg-surface-2 border border-line text-xs font-semibold text-ink inline-flex items-center gap-1.5 no-underline"
                    >
                      <Icon name="call" size={16} className="text-primary" />
                      <span className="num-ltr">{resolvedActiveEmployee.phone}</span>
                    </a>
                  )}
                  {canReadLogs && onOpenPersonLog && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const emp = resolvedActiveEmployee;
                        setActiveEmployee(null);
                        onOpenPersonLog(emp.id, emp.name);
                      }}
                    >
                      السجل الكامل
                    </Button>
                  )}
                </div>

                {/* Flat 3-cell Summary */}
                <CockpitMetricStrip
                  columns={3}
                  items={[
                    {
                      id: 'in',
                      label: 'الحضور',
                      value: resolvedActiveEmployee.checkInTime
                        ? extractLocalHHMM(resolvedActiveEmployee.checkInTime)
                        : '—',
                    },
                    {
                      id: 'out',
                      label: 'الانصراف',
                      value: resolvedActiveEmployee.checkOutTime
                        ? extractLocalHHMM(resolvedActiveEmployee.checkOutTime)
                        : '—',
                    },
                    {
                      id: 'late',
                      label: 'التأخير',
                      value:
                        resolvedActiveEmployee.lateMinutes > 0
                          ? `${resolvedActiveEmployee.lateMinutes}د`
                          : '0',
                      secondary:
                        resolvedActiveEmployee.totalBreakMinutes > 0
                          ? `بريك ${resolvedActiveEmployee.totalBreakMinutes}د`
                          : '',
                    },
                  ]}
                />

                {/* CCTV Status & Review */}
                {resolvedActiveEmployee.latestLogId && activeCctvStatus !== 'none' && (
                  <div className="py-2.5 border-y border-line space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <StatusDot
                        tone={
                          activeCctvStatus === 'confirmed'
                            ? 'success'
                            : activeCctvStatus === 'mismatch'
                            ? 'danger'
                            : 'warning'
                        }
                        label={
                          activeCctvStatus === 'confirmed'
                            ? 'مؤكد بالكاميرا'
                            : activeCctvStatus === 'mismatch'
                            ? 'تعارض كاميرا'
                            : 'بانتظار الكاميرا'
                        }
                        tintedText
                      />
                      {resolvedActiveEmployee.latestCctvObservedTime && (
                        <span className="num-ltr text-xs text-ink-muted">
                          DVR {resolvedActiveEmployee.latestCctvObservedTime}
                        </span>
                      )}
                    </div>

                    {(resolvedActiveEmployee.latestVerifiedBy ||
                      resolvedActiveEmployee.latestCctvNote) && (
                      <div className="text-xs text-ink-muted">
                        {[
                          resolvedActiveEmployee.latestVerifiedBy,
                          resolvedActiveEmployee.latestCctvNote,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}

                    {canVerify && (
                      <div className="flex items-center gap-2">
                        {activeCctvStatus !== 'confirmed' && (
                          <Button
                            variant="success"
                            size="sm"
                            loading={verifyBusyLogId === resolvedActiveEmployee.latestLogId}
                            onClick={(e) =>
                              handleVerifyLog(resolvedActiveEmployee.latestLogId, e)
                            }
                          >
                            تأكيد
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) =>
                            openCctvReviewForEmployee(resolvedActiveEmployee, e)
                          }
                        >
                          مراجعة
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {canWrite && (
                  <>
                    {resolvedActiveEmployee.currentStatus === 'present' && (
                      <div className="space-y-2.5 pt-1">
                        <div className="flex items-center justify-between text-xs text-ink-muted">
                          <span className="font-medium">مدة البريك</span>
                          <span className="num-ltr font-semibold text-ink">
                            {allowedBreakMins}د
                          </span>
                        </div>

                        <div className="grid grid-cols-4 gap-1.5">
                          {BREAK_PRESETS.map((mins) => (
                            <button
                              key={mins}
                              type="button"
                              onClick={() => setAllowedBreakMins(mins)}
                              className={`min-h-[42px] rounded-[var(--g-radius-btn)] text-xs font-medium border num-ltr transition-[background-color,color,border-color] duration-150 cursor-pointer ${
                                Number(allowedBreakMins) === mins
                                  ? 'bg-primary-solid text-on-primary border-transparent'
                                  : 'bg-transparent text-ink border-line hover:border-line-strong'
                              }`}
                            >
                              {mins}د
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-ink-muted">
                            مدة مخصصة
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={(Number(allowedBreakMins) || 30) <= 5}
                              aria-label="تقليل 5 دقائق"
                              onClick={() =>
                                setAllowedBreakMins((prev) =>
                                  Math.max(5, (Number(prev) || 30) - 5)
                                )
                              }
                              className="w-11 h-11 rounded-[var(--g-radius-btn)] bg-surface-2 border border-line text-ink hover:border-line-strong disabled:opacity-40 inline-flex items-center justify-center cursor-pointer transition-colors duration-150"
                            >
                              <Icon name="remove" size={18} />
                            </button>
                            <span
                              className="min-w-[3.25rem] text-center text-sm font-semibold text-ink num-ltr"
                              aria-live="polite"
                            >
                              {allowedBreakMins}د
                            </span>
                            <button
                              type="button"
                              disabled={(Number(allowedBreakMins) || 30) >= 240}
                              aria-label="زيادة 5 دقائق"
                              onClick={() =>
                                setAllowedBreakMins((prev) =>
                                  Math.min(240, (Number(prev) || 30) + 5)
                                )
                              }
                              className="w-11 h-11 rounded-[var(--g-radius-btn)] bg-surface-2 border border-line text-ink hover:border-line-strong disabled:opacity-40 inline-flex items-center justify-center cursor-pointer transition-colors duration-150"
                            >
                              <Icon name="add" size={18} />
                            </button>
                          </div>
                        </div>

                        <FilterChipRail
                          activeId={breakReason}
                          onSelect={setBreakReason}
                          items={BREAK_REASONS.map((r) => ({ id: r, label: r }))}
                        />
                      </div>
                    )}

                    {resolvedActiveEmployee.currentStatus === 'checked_out' &&
                      !resolvedActiveEmployee.nextCheckInAvailability?.canCheckIn && (
                        <div className="text-xs text-ink-muted">
                          {resolvedActiveEmployee.nextCheckInAvailability?.lockReasonArabic ||
                            `يفتح الشفت القادم الساعة ${resolvedActiveEmployee.nextCheckInAvailability?.windowOpenTimeStr || resolvedActiveEmployee.shift_start || '08:00'}`}
                        </div>
                      )}

                    <ProofUploader
                      value={proofDataUrl}
                      onChange={setProofDataUrl}
                      label="صورة إثبات"
                      compact
                    />

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-ink-muted">ملاحظة</span>
                        <VoiceMicButton
                          small
                          onToast={onToast}
                          onTranscript={(txt) =>
                            setNote((prev) => (prev ? `${prev} ${txt}` : txt))
                          }
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {QUICK_ATTENDANCE_NOTES.map((chip) => (
                          <button
                            key={chip}
                            type="button"
                            onClick={() => setNote(note === chip ? '' : chip)}
                            className={`min-h-[36px] text-xs px-2.5 py-1 rounded-[var(--g-radius-btn)] border transition-[background-color,color,border-color] duration-150 cursor-pointer ${
                              note === chip
                                ? 'bg-secondary-container text-on-secondary-container border-transparent font-semibold'
                                : 'bg-transparent border-line text-ink-muted hover:text-ink'
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
                        placeholder="ملاحظة..."
                        className="g-input w-full"
                      />
                    </div>

                    {canVerify && (
                      <div className="space-y-2.5 pt-2 border-t border-line">
                        <ToggleSwitch
                          checked={confirmByCctv}
                          onChange={setConfirmByCctv}
                          label="تأكيد بالكاميرا"
                        />

                        {confirmByCctv && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            <div>
                              <label className="block text-xs font-medium text-ink-muted mb-1">
                                وقت DVR
                              </label>
                              <input
                                type="time"
                                value={cctvObservedTime}
                                onChange={(e) => setCctvObservedTime(e.target.value)}
                                className="g-input num-ltr"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-xs font-medium text-ink-muted mb-1">
                                ملاحظة الكاميرا
                              </label>
                              <input
                                type="text"
                                value={cctvNote}
                                onChange={(e) => setCctvNote(e.target.value)}
                                placeholder="ملاحظة..."
                                className="g-input"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {canManageRecords && (
                      <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-line">
                        <label className="text-xs font-medium text-ink-muted">
                          وقت مخصص
                        </label>
                        <input
                          type="time"
                          value={customTimeHHMM}
                          onChange={(e) => setCustomTimeHHMM(e.target.value)}
                          className="g-input w-36 num-ltr"
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </BottomSheet>
          );
        })()}

      {/* MODAL 2: CCTV Review BottomSheet */}
      <BottomSheet
        open={Boolean(reviewTarget && canVerify)}
        onClose={() => !reviewSubmitting && setReviewTarget(null)}
        title="مراجعة الكاميرا"
        subtitle={
          reviewTarget
            ? `${reviewTarget.employeeName} · ${reviewTarget.actionLabel}${
                reviewTarget.recordedTimeIso
                  ? ` · ${formatTimeArabic(reviewTarget.recordedTimeIso)}`
                  : ''
              }`
            : ''
        }
        maxWidth="max-w-md"
        footer={
          reviewTarget && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                fullWidth
                disabled={reviewSubmitting}
                onClick={() => setReviewTarget(null)}
              >
                إلغاء
              </Button>
              <Button
                variant={reviewTarget.status === 'mismatch' ? 'danger' : 'success'}
                fullWidth
                loading={reviewSubmitting}
                onClick={handleSubmitCctvReview}
              >
                {reviewTarget.status === 'mismatch' ? 'تسجيل تعارض' : 'تأكيد'}
              </Button>
            </div>
          )
        }
      >
        {reviewTarget && (
          <form onSubmit={handleSubmitCctvReview} className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setReviewTarget((r) => ({ ...r, status: 'confirmed' }))}
                className={`min-h-[48px] px-3 py-2.5 rounded-[var(--g-radius-md)] border text-xs sm:text-sm font-semibold transition-[background-color,border-color,color] duration-150 cursor-pointer ${
                  reviewTarget.status === 'confirmed'
                    ? 'bg-success-bg border-[var(--g-green-border)] text-success'
                    : 'bg-transparent border-line text-ink'
                }`}
              >
                مطابق
              </button>

              <button
                type="button"
                onClick={() => setReviewTarget((r) => ({ ...r, status: 'mismatch' }))}
                className={`min-h-[48px] px-3 py-2.5 rounded-[var(--g-radius-md)] border text-xs sm:text-sm font-semibold transition-[background-color,border-color,color] duration-150 cursor-pointer ${
                  reviewTarget.status === 'mismatch'
                    ? 'bg-danger-bg border-[var(--g-red-border)] text-danger'
                    : 'bg-transparent border-line text-ink'
                }`}
              >
                تعارض
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                وقت DVR
              </label>
              <input
                type="time"
                value={reviewTarget.observedTime || ''}
                onChange={(e) =>
                  setReviewTarget((r) => ({ ...r, observedTime: e.target.value }))
                }
                className="g-input num-ltr"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-ink-muted">ملاحظة</label>
              <div className="flex flex-wrap gap-1.5">
                {CCTV_NOTE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() =>
                      setReviewTarget((r) => ({
                        ...r,
                        note: r.note === preset ? '' : preset,
                      }))
                    }
                    className={`min-h-[36px] text-xs px-2.5 py-1 rounded-[var(--g-radius-btn)] border transition-[background-color,border-color,color] duration-150 cursor-pointer ${
                      reviewTarget.note === preset
                        ? 'bg-secondary-container text-on-secondary-container border-transparent font-semibold'
                        : 'bg-transparent border-line text-ink-muted hover:text-ink'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <textarea
                rows={2}
                value={reviewTarget.note || ''}
                onChange={(e) =>
                  setReviewTarget((r) => ({ ...r, note: e.target.value }))
                }
                placeholder="ملاحظة الكاميرا..."
                className="g-input w-full resize-none"
              />
            </div>
          </form>
        )}
      </BottomSheet>

      {/* MODAL 3: Admin Edit Attendance Log BottomSheet */}
      <BottomSheet
        open={Boolean(editingLog && canManageRecords)}
        onClose={() => !editSubmitting && setEditingLog(null)}
        title="تعديل الحركة"
        subtitle={editingLog?.employee_name || ''}
        maxWidth="max-w-md"
        footer={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              fullWidth
              disabled={editSubmitting}
              onClick={() => setEditingLog(null)}
            >
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              loading={editSubmitting}
              onClick={handleSaveEditedLog}
            >
              حفظ
            </Button>
          </div>
        }
      >
        {editingLog && (
          <form onSubmit={handleSaveEditedLog} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الحركة
                </label>
                <select
                  value={editingLog.action_type}
                  onChange={(e) =>
                    setEditingLog((l) => ({ ...l, action_type: e.target.value }))
                  }
                  className="g-input"
                >
                  <option value="check_in">حضور</option>
                  <option value="break_start">بريك</option>
                  <option value="break_end">عودة</option>
                  <option value="check_out">انصراف</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الوقت
                </label>
                <input
                  type="time"
                  value={editingLog.hhmm}
                  onChange={(e) =>
                    setEditingLog((l) => ({ ...l, hhmm: e.target.value }))
                  }
                  className="g-input num-ltr"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  التأخير (د)
                </label>
                <input
                  type="number"
                  min="0"
                  value={editingLog.late_minutes ?? 0}
                  onChange={(e) =>
                    setEditingLog((l) => ({ ...l, late_minutes: e.target.value }))
                  }
                  className="g-input num-ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  البريك (د)
                </label>
                <input
                  type="number"
                  min="0"
                  value={editingLog.break_duration_minutes ?? 0}
                  onChange={(e) =>
                    setEditingLog((l) => ({
                      ...l,
                      break_duration_minutes: e.target.value,
                    }))
                  }
                  className="g-input num-ltr"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                ملاحظة
              </label>
              <input
                type="text"
                value={editingLog.note || ''}
                onChange={(e) =>
                  setEditingLog((l) => ({ ...l, note: e.target.value }))
                }
                className="g-input"
              />
            </div>

            <div className="border-y border-line">
              <ToggleSwitch
                checked={Boolean(editingLog.verified_by_cctv)}
                onChange={(val) =>
                  setEditingLog((l) => ({ ...l, verified_by_cctv: val }))
                }
                label="مؤكد بالكاميرا"
              />
            </div>
          </form>
        )}
      </BottomSheet>

      {/* MODAL 4: Mobile Export & Print QR BottomSheet */}
      <BottomSheet
        open={exportSheetOpen}
        onClose={() => setExportSheetOpen(false)}
        title="تصدير الحضور"
        subtitle={dateKey || ''}
        maxWidth="max-w-md"
      >
        <GroupedList>
          {canPrintCards && (
            <GroupedRow
              onClick={() => {
                setExportSheetOpen(false);
                onOpenQrModal?.('cards');
              }}
            >
              <span className="text-sm font-medium text-ink">
                كروت QR ({employees.length})
              </span>
              <Icon name="print" size={18} className="text-ink-muted" />
            </GroupedRow>
          )}
          {(canExport || canWrite || canVerify) && (
            <>
              <GroupedRow
                onClick={async () => {
                  await handleExportAttendanceExcel();
                  setExportSheetOpen(false);
                }}
              >
                <span className="text-sm font-medium text-ink">Excel (.xlsx)</span>
                <Icon name="table_view" size={18} className="text-success" />
              </GroupedRow>
              <GroupedRow
                onClick={async () => {
                  await handleCopyAttendanceText();
                  setExportSheetOpen(false);
                }}
              >
                <span className="text-sm font-medium text-ink">نسخ النص</span>
                <Icon name="content_copy" size={18} className="text-ink-muted" />
              </GroupedRow>
              <GroupedRow
                onClick={() => {
                  handleShareAttendanceWhatsApp();
                  setExportSheetOpen(false);
                }}
              >
                <span className="text-sm font-medium text-ink">واتساب</span>
                <Icon name="send" size={18} className="text-[var(--g-whatsapp)]" />
              </GroupedRow>
            </>
          )}
        </GroupedList>
      </BottomSheet>

      <ConfirmSheet
        open={Boolean(confirmCheckoutEmp)}
        onClose={() => !submitting && setConfirmCheckoutEmp(null)}
        onConfirm={async () => {
          const emp = confirmCheckoutEmp;
          if (!emp) return;
          await handleQuickCardAction(emp, 'check_out');
          setConfirmCheckoutEmp(null);
        }}
        loading={submitting}
        tone="danger"
        title="تأكيد الانصراف"
        description={confirmCheckoutEmp ? `تسجيل انصراف "${confirmCheckoutEmp.name}"؟` : ''}
        confirmLabel="انصراف"
      />

      <ConfirmSheet
        open={Boolean(confirmReopenEmp)}
        onClose={() => !submitting && setConfirmReopenEmp(null)}
        onConfirm={async () => {
          const emp = confirmReopenEmp;
          if (!emp) return;
          await handleQuickCardAction(emp, 'check_in', null, null, true);
          setConfirmReopenEmp(null);
        }}
        loading={submitting}
        tone="warning"
        title="إعادة فتح الشفت"
        description={confirmReopenEmp ? `إعادة فتح الشفت لـ "${confirmReopenEmp.name}"؟` : ''}
        confirmLabel="إعادة فتح"
      />

      <ConfirmSheet
        open={Boolean(deleteLogTarget)}
        onClose={() => !deletingLogId && setDeleteLogTarget(null)}
        onConfirm={handleConfirmDeleteLog}
        loading={Boolean(deletingLogId)}
        tone="danger"
        title="حذف الحركة"
        description={
          deleteLogTarget
            ? `حذف "${ACTION_META[deleteLogTarget.action_type]?.label || deleteLogTarget.action_type} · ${deleteLogTarget.employee_name}"؟`
            : ''
        }
        confirmLabel="حذف"
      />
    </div>
  );
}
