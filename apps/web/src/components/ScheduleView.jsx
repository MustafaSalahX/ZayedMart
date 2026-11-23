import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getCairoDateKey,
  getSaturdayWeekStart,
  getScheduleWeekdayLabel,
  getWeekDateKeys,
  SCHEDULE_TEAM_GROUPS,
  SCHEDULE_WEEKDAYS,
  shiftWeekStart,
} from '@zayed-mart/shared';
import {
  assignDayOff,
  bulkUpdateSchedule,
  cancelDayOffSwap,
  createDayOffSwap,
  decideDayOffSwap,
  fetchWeeklySchedule,
  respondDayOffSwap,
  revertDayOffSwap,
  updateScheduleSettings,
  verifyAttendanceLog,
} from '../lib/api.js';
import { playSuccessChime } from '../lib/audio.js';
import {
  exportWeeklyScheduleToCsv,
  exportWeeklyScheduleToWord,
  formatWeeklyScheduleWhatsApp,
  openWhatsAppShare,
} from '../lib/exportUtils.js';
import { useThemeArchitecture } from '../lib/themeContext.jsx';
import ScheduleShiftsTab from './ScheduleShiftsTab.jsx';
import {
  BottomSheet,
  Button,
  Card,
  CockpitMetricStrip,
  ConfirmSheet,
  EmptyState,
  FilterChipRail,
  GroupedList,
  GroupedRow,
  Icon,
  RoleAvatar,
  SegmentedControl,
  SkeletonKpiStrip,
  SkeletonList,
  StatusDot,
  ToggleSwitch,
  WeekDayStrip,
} from './ui/index.js';

const SWAP_STATUS_META = {
  pending_requester: { label: 'بانتظار المبادر', tone: 'warning' },
  pending_peer: { label: 'بانتظار الزميل', tone: 'warning' },
  pending_manager: { label: 'بانتظار الإدارة', tone: 'warning' },
  approved: { label: 'معتمد', tone: 'success' },
  rejected: { label: 'مرفوض', tone: 'danger' },
  cancelled: { label: 'ملغي', tone: 'neutral' },
  reverted: { label: 'تم التراجع', tone: 'purple' },
};

function formatShortDate(dateKey) {
  if (!dateKey || typeof dateKey !== 'string') return '';
  const parts = dateKey.split('-');
  if (parts.length !== 3) return dateKey;
  return `${parts[2]}/${parts[1]}`;
}

function SwapApprovalStepper({ swap, swapRequiresManagerApproval }) {
  const isSwap = swap.request_type === 'swap';
  const reqDone = Number(swap.requester_approved) === 1;
  const peerDone = Number(swap.target_approved) === 1;
  const mgrDone = Number(swap.manager_approved) === 1;
  const isFinalApproved = swap.status === 'approved';

  const needsManagerStep =
    !isSwap ||
    Boolean(swapRequiresManagerApproval) ||
    swap.status === 'pending_manager' ||
    mgrDone;

  const steps = [
    { key: 'requester', label: isSwap ? 'المبادر' : 'المتقدم', done: reqDone },
  ];
  if (isSwap) {
    steps.push({ key: 'peer', label: 'الزميل', done: peerDone });
  }
  steps.push({
    key: 'final',
    label: needsManagerStep ? 'الإدارة' : 'تطبيق تلقائي',
    done: isFinalApproved || mgrDone,
  });

  return (
    <div className="flex items-center flex-wrap gap-1.5 text-[11px] font-medium text-ink-muted">
      {steps.map((step, idx) => (
        <React.Fragment key={step.key}>
          <span className={step.done ? 'text-success font-semibold' : ''}>
            {step.label}
          </span>
          {idx < steps.length - 1 && <span aria-hidden="true">←</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * Detoxed Weekly Day-Off Schedule & Live Team Shifts View (`الإجازات`).
 * Borderless header, `<CockpitMetricStrip />`, hidden Swap Inbox when empty,
 * flat hairline `<GroupedList>` mobile groups, and clean desktop matrix.
 */
export default function ScheduleView({
  bootstrapData = null,
  storeName = 'زايد مارت',
  canManage: propCanManage = false,
  canSwap: propCanSwap = false,
  canExport = false,
  canVerify: propCanVerify = false,
  canWriteAttendance: propCanWriteAttendance = false,
  onRefreshBootstrap,
  onToast,
}) {
  const arch = useThemeArchitecture();
  const currentCairoWeekStart = useMemo(
    () => getSaturdayWeekStart(getCairoDateKey()),
    []
  );

  const [scheduleTab, setScheduleTab] = useState('dayoffs');
  const [weekStart, setWeekStart] = useState(
    () => bootstrapData?.dayOffSchedule?.weekStartDate || currentCairoWeekStart
  );
  const [scheduleData, setScheduleData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyAction, setBusyAction] = useState(false);
  const [busySwapId, setBusySwapId] = useState('');

  const [editScope, setEditScope] = useState('week');

  const [mobileMode, setMobileMode] = useState('day');
  const [selectedDay, setSelectedDay] = useState(
    () => bootstrapData?.dayOffSchedule?.todayWeekday || 'sat'
  );
  const [mobileGroupFilter, setMobileGroupFilter] = useState('all');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    swapRequiresManagerApproval: false,
    minOnDuty: { cashiers: 2, hall: 2, security_cctv: 1 },
  });
  const [confirmBulkAction, setConfirmBulkAction] = useState(null);
  const [confirmSwapAction, setConfirmSwapAction] = useState(null);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [swapComposer, setSwapComposer] = useState(null);
  const [rejectingSwapId, setRejectingSwapId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showPastSwaps, setShowPastSwaps] = useState(false);
  const [pendingOpenComposer, setPendingOpenComposer] = useState(false);
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);

  const inboxRef = useRef(null);
  const lastBootstrapServerTimeRef = useRef(bootstrapData?.serverTime || '');

  const loadSchedule = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      setLoadError('');
      try {
        const res = await fetchWeeklySchedule(weekStart);
        setScheduleData(res);
        if (res?.settings) {
          setSettingsForm({
            swapRequiresManagerApproval: Boolean(res.settings.swapRequiresManagerApproval),
            minOnDuty: {
              cashiers: Number(res.settings.minOnDuty?.cashiers ?? 2),
              hall: Number(res.settings.minOnDuty?.hall ?? 2),
              security_cctv: Number(res.settings.minOnDuty?.security_cctv ?? 1),
            },
          });
        }
      } catch (err) {
        setLoadError(err.message || 'تعذر تحميل الجدول');
        setPendingOpenComposer(false);
      } finally {
        setLoading(false);
      }
    },
    [weekStart]
  );

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    if (scheduleData?.todayWeekday && weekStart === currentCairoWeekStart) {
      setSelectedDay(scheduleData.todayWeekday);
    }
  }, [scheduleData?.todayWeekday, weekStart, currentCairoWeekStart]);

  useEffect(() => {
    const handleScheduleUpdated = () => {
      loadSchedule({ silent: true });
    };
    window.addEventListener('zayed:schedule-updated', handleScheduleUpdated);
    return () => window.removeEventListener('zayed:schedule-updated', handleScheduleUpdated);
  }, [loadSchedule]);

  useEffect(() => {
    const nextTime = bootstrapData?.serverTime || '';
    if (nextTime && nextTime !== lastBootstrapServerTimeRef.current) {
      lastBootstrapServerTimeRef.current = nextTime;
      if (scheduleTab === 'shifts') {
        loadSchedule({ silent: true });
      }
    }
  }, [bootstrapData?.serverTime, scheduleTab, loadSchedule]);

  const effectiveCanManage = Boolean(scheduleData?.canManage ?? propCanManage);
  const effectiveCanSwap = Boolean(scheduleData?.canSwap ?? propCanSwap);
  const effectiveCanVerify = Boolean(scheduleData?.canVerify ?? propCanVerify);
  const isOfflineReadOnly = Boolean(scheduleData?._offlineCached);

  const presentCount = useMemo(() => {
    if (Array.isArray(scheduleData?.shiftRoster)) {
      return scheduleData.shiftRoster.filter((e) => e.currentStatus === 'present').length;
    }
    return Number(bootstrapData?.summary?.presentCount || 0);
  }, [scheduleData?.shiftRoster, bootstrapData?.summary?.presentCount]);

  const handleVerifyShiftLog = useCallback(
    async (logId, payload = { status: 'confirmed' }) => {
      if (!logId || isOfflineReadOnly) {
        if (isOfflineReadOnly) {
          onToast?.('وضع أوفلاين — تعذر تأكيد الحضور', 'error');
        }
        return;
      }
      try {
        await verifyAttendanceLog(logId, payload);
        playSuccessChime('in');
        onToast?.(
          payload?.status === 'mismatch'
            ? 'تم تسجيل تعارض الكاميرا'
            : 'تم تأكيد الحضور بالكاميرا'
        );
        await Promise.all([loadSchedule({ silent: true }), onRefreshBootstrap?.()]);
      } catch (err) {
        onToast?.(err?.message || 'تعذر تأكيد الحضور', 'error');
        throw err;
      }
    },
    [isOfflineReadOnly, loadSchedule, onRefreshBootstrap, onToast]
  );

  const groups = scheduleData?.groups || [];
  const swaps = scheduleData?.swaps || [];
  const todayDateKey = scheduleData?.todayDateKey || getCairoDateKey();
  const todayWeekday = scheduleData?.todayWeekday || '';
  const resolvedWeekStart = scheduleData?.weekStartDate || weekStart;
  const weekDates = useMemo(
    () => scheduleData?.weekDates || getWeekDateKeys(resolvedWeekStart),
    [scheduleData?.weekDates, resolvedWeekStart]
  );
  const myEmployeeId =
    scheduleData?.myEmployeeId || bootstrapData?.dayOffSchedule?.myEmployeeId || '';

  const allVisibleEmployees = useMemo(
    () => groups.flatMap((g) => (g.employees || []).map((emp) => ({ ...emp, groupMeta: g }))),
    [groups]
  );

  const myEmployee = useMemo(
    () => allVisibleEmployees.find((e) => e.id === myEmployeeId) || null,
    [allVisibleEmployees, myEmployeeId]
  );

  const actionableSwaps = useMemo(
    () => swaps.filter((s) => Boolean(s.awaiting_my_action)),
    [swaps]
  );

  const otherSwaps = useMemo(
    () => swaps.filter((s) => !s.awaiting_my_action),
    [swaps]
  );

  const otherWeekActionableSwaps = useMemo(
    () =>
      (bootstrapData?.pendingDayOffSwaps || []).filter(
        (s) => Boolean(s.awaiting_my_action) && s.week_start_date !== resolvedWeekStart
      ),
    [bootstrapData?.pendingDayOffSwaps, resolvedWeekStart]
  );

  const kpiMetrics = useMemo(() => {
    const totalEmployees = allVisibleEmployees.length;
    const assignedOffCount = allVisibleEmployees.filter((e) => Boolean(e.effective_day_of_week)).length;
    const offTodayCount =
      resolvedWeekStart === currentCairoWeekStart && todayWeekday
        ? allVisibleEmployees.filter((e) => e.effective_day_of_week === todayWeekday).length
        : allVisibleEmployees.filter((e) => e.effective_day_of_week === selectedDay).length;

    let lowCoverageSlots = 0;
    for (const g of groups) {
      for (const day of SCHEDULE_WEEKDAYS) {
        if (g.coverageByDay?.[day.code]?.lowCoverage) {
          lowCoverageSlots += 1;
        }
      }
    }

    return {
      totalEmployees,
      assignedOffCount,
      offTodayCount,
      pendingForMe: actionableSwaps.length + otherWeekActionableSwaps.length,
      lowCoverageSlots,
    };
  }, [
    allVisibleEmployees,
    resolvedWeekStart,
    currentCairoWeekStart,
    todayWeekday,
    selectedDay,
    groups,
    actionableSwaps.length,
    otherWeekActionableSwaps.length,
  ]);

  const scheduleMetricItems = useMemo(
    () => [
      {
        id: 'assigned',
        label: 'الإجازات',
        value: kpiMetrics.assignedOffCount,
        secondary: kpiMetrics.totalEmployees > 0 ? `من ${kpiMetrics.totalEmployees}` : '',
      },
      {
        id: 'off_today',
        label:
          resolvedWeekStart === currentCairoWeekStart
            ? 'إجازة اليوم'
            : `إجازة ${getScheduleWeekdayLabel(selectedDay)}`,
        value: kpiMetrics.offTodayCount,
        secondary:
          resolvedWeekStart === currentCairoWeekStart && todayWeekday
            ? getScheduleWeekdayLabel(todayWeekday)
            : formatShortDate(weekDates[selectedDay]),
      },
      {
        id: 'pending',
        label: 'طلبات معلقة',
        value: kpiMetrics.pendingForMe,
        tone: kpiMetrics.pendingForMe > 0 ? 'danger' : 'neutral',
        dotTone: kpiMetrics.pendingForMe > 0 ? 'danger' : '',
        onClick:
          kpiMetrics.pendingForMe > 0
            ? () => inboxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            : undefined,
      },
      {
        id: 'coverage',
        label: 'نقص تغطية',
        value: kpiMetrics.lowCoverageSlots,
        tone: kpiMetrics.lowCoverageSlots > 0 ? 'warning' : 'neutral',
        dotTone: kpiMetrics.lowCoverageSlots > 0 ? 'warning' : '',
      },
    ],
    [kpiMetrics, resolvedWeekStart, currentCairoWeekStart, selectedDay, todayWeekday, weekDates]
  );

  const openSwapComposer = useCallback(
    ({ preselectedTargetId = '', preferredType = 'swap', requesterIdOverride = '' } = {}) => {
      if (isOfflineReadOnly) {
        onToast?.('وضع أوفلاين — يتطلب اتصالاً لتقديم الطلب', 'error');
        return;
      }
      const reqEmp =
        (requesterIdOverride && allVisibleEmployees.find((e) => e.id === requesterIdOverride)) ||
        myEmployee ||
        (effectiveCanManage
          ? allVisibleEmployees.find((e) => Boolean(e.effective_day_of_week)) || null
          : null);

      if (!reqEmp) {
        onToast?.('الحساب غير مرتبط بسجل موظف نشط', 'error');
        return;
      }

      const reqGroup = reqEmp.team_group || 'cashiers';
      const colleagues = allVisibleEmployees.filter(
        (e) =>
          e.team_group === reqGroup &&
          e.id !== reqEmp.id &&
          Boolean(e.effective_day_of_week) &&
          e.effective_day_of_week !== reqEmp.effective_day_of_week
      );

      let initialTargetId = preselectedTargetId;
      if (initialTargetId && !colleagues.some((c) => c.id === initialTargetId)) {
        initialTargetId = '';
      }
      if (!initialTargetId) {
        const nonPastColleague = colleagues.find(
          (c) =>
            effectiveCanManage || (weekDates[c.effective_day_of_week] || '') >= todayDateKey
        );
        initialTargetId = nonPastColleague?.id || colleagues[0]?.id || '';
      }

      const validTargetDays = SCHEDULE_WEEKDAYS.filter(
        (d) =>
          d.code !== reqEmp.effective_day_of_week &&
          (effectiveCanManage || (weekDates[d.code] || '') >= todayDateKey)
      );

      setSwapComposer({
        requesterId: reqEmp.id,
        requestType: preferredType,
        scope: 'week',
        targetEmployeeId: initialTargetId,
        targetDay: validTargetDays[0]?.code || '',
        reason: '',
      });
    },
    [
      isOfflineReadOnly,
      allVisibleEmployees,
      myEmployee,
      effectiveCanManage,
      weekDates,
      todayDateKey,
      onToast,
    ]
  );

  useEffect(() => {
    const handleOpenComposer = (ev) => {
      const detail = ev?.detail || {};
      if (
        (detail.type === 'schedule_swap' || detail.action === 'schedule_swap') &&
        effectiveCanSwap
      ) {
        if (!scheduleData) {
          setPendingOpenComposer(true);
        } else {
          openSwapComposer({ preferredType: 'swap' });
        }
      }
    };
    window.addEventListener('zayed:open-composer', handleOpenComposer);
    return () => window.removeEventListener('zayed:open-composer', handleOpenComposer);
  }, [effectiveCanSwap, scheduleData, openSwapComposer]);

  useEffect(() => {
    if (pendingOpenComposer && scheduleData) {
      setPendingOpenComposer(false);
      openSwapComposer({ preferredType: 'swap' });
    }
  }, [pendingOpenComposer, scheduleData, openSwapComposer]);

  async function refreshAll() {
    await Promise.all([loadSchedule({ silent: true }), onRefreshBootstrap?.()]);
  }

  async function handleAssignDayOff(emp, dayOfWeek, teamGroupOverride = null, scopeOverride = null) {
    if (!effectiveCanManage || busyAction || isOfflineReadOnly) return;
    const activeScope = scopeOverride || editScope;
    setBusyAction(true);
    try {
      await assignDayOff({
        employeeId: emp.id,
        dayOfWeek: dayOfWeek || null,
        teamGroup: teamGroupOverride || emp.team_group,
        scope: activeScope,
        weekStartDate: resolvedWeekStart,
      });
      playSuccessChime('in');
      const dayLabel = dayOfWeek ? getScheduleWeekdayLabel(dayOfWeek) : 'بدون يوم';
      onToast?.(`تم تحديث إجازة ${emp.name} (${dayLabel})`);
      setEditingEmployee(null);
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر الحفظ', 'error');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleTeamGroupQuickChange(emp, nextTeamGroup) {
    if (!effectiveCanManage || busyAction || isOfflineReadOnly || nextTeamGroup === emp.team_group) {
      return;
    }
    const currentDay =
      editScope === 'default'
        ? emp.default_day_of_week || emp.effective_day_of_week
        : emp.effective_day_of_week;
    if (!currentDay) {
      setEditingEmployee({
        emp,
        dayOfWeek: '',
        teamGroup: nextTeamGroup,
        scope: editScope,
      });
      return;
    }
    setBusyAction(true);
    try {
      await assignDayOff({
        employeeId: emp.id,
        dayOfWeek: currentDay,
        teamGroup: nextTeamGroup,
        scope: editScope,
        weekStartDate: resolvedWeekStart,
      });
      playSuccessChime('in');
      onToast?.(`تم نقل ${emp.name}`);
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر النقل', 'error');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleBulkActionConfirm() {
    if (!confirmBulkAction || !effectiveCanManage || busyAction || isOfflineReadOnly) return;
    setBusyAction(true);
    try {
      await bulkUpdateSchedule({
        action: confirmBulkAction,
        weekStartDate: resolvedWeekStart,
      });
      playSuccessChime('in');
      onToast?.(
        confirmBulkAction === 'copy_previous_week'
          ? 'تم نسخ الأسبوع السابق'
          : 'تمت الإعادة للجدول الثابت'
      );
      setConfirmBulkAction(null);
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر التنفيذ', 'error');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    if (!effectiveCanManage || busyAction || isOfflineReadOnly) return;
    setBusyAction(true);
    try {
      await updateScheduleSettings({
        swapRequiresManagerApproval: Boolean(settingsForm.swapRequiresManagerApproval),
        minOnDuty: {
          cashiers: Math.max(0, Number(settingsForm.minOnDuty.cashiers) || 0),
          hall: Math.max(0, Number(settingsForm.minOnDuty.hall) || 0),
          security_cctv: Math.max(0, Number(settingsForm.minOnDuty.security_cctv) || 0),
        },
      });
      playSuccessChime('in');
      onToast?.('تم حفظ الإعدادات');
      setSettingsOpen(false);
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر الحفظ', 'error');
    } finally {
      setBusyAction(false);
    }
  }

  async function handleSwapRespondOrDecide(swap, decision, reason = '') {
    if (!swap?.id || busySwapId || isOfflineReadOnly) return;
    setBusySwapId(swap.id);
    try {
      const payload = { decision, ...(reason ? { reason: reason.trim() } : {}) };
      if (swap.status === 'pending_manager') {
        await decideDayOffSwap(swap.id, payload);
      } else {
        await respondDayOffSwap(swap.id, payload);
      }
      playSuccessChime(decision === 'approve' ? 'in' : 'out');
      onToast?.(decision === 'approve' ? 'تمت الموافقة' : 'تم الرفض');
      setRejectingSwapId('');
      setRejectReason('');
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر المعالجة', 'error');
      if (err?.status === 409) {
        setRejectingSwapId('');
        setRejectReason('');
        await refreshAll();
      }
    } finally {
      setBusySwapId('');
    }
  }

  async function handleCancelSwap(swap) {
    if (!swap?.id || busySwapId || isOfflineReadOnly) return;
    setBusySwapId(swap.id);
    try {
      await cancelDayOffSwap(swap.id);
      playSuccessChime('out');
      onToast?.('تم إلغاء الطلب');
      setConfirmSwapAction(null);
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر الإلغاء', 'error');
    } finally {
      setBusySwapId('');
    }
  }

  async function handleRevertSwap(swap) {
    if (!swap?.id || busySwapId || isOfflineReadOnly) return;
    setBusySwapId(swap.id);
    try {
      await revertDayOffSwap(swap.id, { reason: 'تراجع إداري' });
      playSuccessChime('out');
      onToast?.('تم التراجع عن التبديل');
      setConfirmSwapAction(null);
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر التراجع', 'error');
    } finally {
      setBusySwapId('');
    }
  }

  async function handleSubmitSwapComposer(e) {
    if (e?.preventDefault) e.preventDefault();
    if (!swapComposer || busyAction || isOfflineReadOnly) return;
    setBusyAction(true);
    try {
      const payload = {
        requestType: swapComposer.requestType,
        scope: swapComposer.scope,
        weekStartDate: resolvedWeekStart,
        requesterEmployeeId: swapComposer.requesterId,
        reason: (swapComposer.reason || '').trim(),
      };
      if (swapComposer.requestType === 'swap') {
        payload.targetEmployeeId = swapComposer.targetEmployeeId;
      } else {
        payload.targetDay = swapComposer.targetDay;
      }
      await createDayOffSwap(payload);
      playSuccessChime('in');
      onToast?.('تم إرسال الطلب');
      setSwapComposer(null);
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر إرسال الطلب', 'error');
    } finally {
      setBusyAction(false);
    }
  }

  const composerContext = useMemo(() => {
    if (!swapComposer) return null;
    const reqEmp = allVisibleEmployees.find((e) => e.id === swapComposer.requesterId) || null;
    const reqGroup = groups.find((g) => g.id === reqEmp?.team_group) || null;
    const reqDay = reqEmp?.effective_day_of_week || null;
    const isReqPast = Boolean(reqDay && !effectiveCanManage && (weekDates[reqDay] || '') < todayDateKey);

    const sameGroupColleagues = reqEmp
      ? allVisibleEmployees.filter(
          (e) => e.team_group === reqEmp.team_group && e.id !== reqEmp.id
        )
      : [];

    const selectedTarget =
      swapComposer.requestType === 'swap'
        ? sameGroupColleagues.find((c) => c.id === swapComposer.targetEmployeeId) || null
        : null;

    const targetDayCode =
      swapComposer.requestType === 'swap'
        ? selectedTarget?.effective_day_of_week || ''
        : swapComposer.targetDay || '';

    const covFrom = reqDay && reqGroup?.coverageByDay ? reqGroup.coverageByDay[reqDay] : null;
    const covTo =
      targetDayCode && reqGroup?.coverageByDay ? reqGroup.coverageByDay[targetDayCode] : null;

    let preview = null;
    if (reqEmp && reqDay && targetDayCode && targetDayCode !== reqDay && covFrom && covTo) {
      if (swapComposer.requestType === 'swap') {
        preview = {
          mode: 'swap',
          fromLabel: getScheduleWeekdayLabel(reqDay),
          toLabel: getScheduleWeekdayLabel(targetDayCode),
          fromOnDutyBefore: covFrom.onDutyCount,
          fromOnDutyAfter: covFrom.onDutyCount,
          toOnDutyBefore: covTo.onDutyCount,
          toOnDutyAfter: covTo.onDutyCount,
          toLowAfter: covTo.lowCoverage,
          minRequired: covTo.minRequired,
        };
      } else {
        const fromAfter = covFrom.onDutyCount + 1;
        const toAfter = Math.max(0, covTo.onDutyCount - 1);
        const toLowAfter =
          covTo.totalCount > 0 &&
          (toAfter === 0 || toAfter < Math.min(covTo.minRequired, covTo.totalCount));
        preview = {
          mode: 'move',
          fromLabel: getScheduleWeekdayLabel(reqDay),
          toLabel: getScheduleWeekdayLabel(targetDayCode),
          fromOnDutyBefore: covFrom.onDutyCount,
          fromOnDutyAfter: fromAfter,
          toOnDutyBefore: covTo.onDutyCount,
          toOnDutyAfter: toAfter,
          toLowAfter,
          minRequired: covTo.minRequired,
        };
      }
    }

    const canSubmit = Boolean(
      reqEmp &&
        reqDay &&
        !isReqPast &&
        targetDayCode &&
        targetDayCode !== reqDay &&
        (effectiveCanManage || (weekDates[targetDayCode] || '') >= todayDateKey) &&
        (swapComposer.requestType === 'move' || selectedTarget)
    );

    return {
      reqEmp,
      reqGroup,
      reqDay,
      isReqPast,
      sameGroupColleagues,
      selectedTarget,
      targetDayCode,
      preview,
      canSubmit,
    };
  }, [swapComposer, allVisibleEmployees, groups, effectiveCanManage, weekDates, todayDateKey]);

  const filteredMobileGroups = useMemo(() => {
    if (mobileGroupFilter === 'all' || groups.length <= 1) return groups;
    return groups.filter((g) => g.id === mobileGroupFilter);
  }, [groups, mobileGroupFilter]);

  if (loading && !scheduleData) {
    return (
      <div className="space-y-4">
        <SkeletonKpiStrip count={4} />
        <SkeletonList rows={4} />
      </div>
    );
  }

  if (loadError && !scheduleData) {
    return (
      <EmptyState
        title="تعذر تحميل الجدول"
        actionLabel="إعادة المحاولة"
        actionIcon="refresh"
        onAction={() => loadSchedule()}
      />
    );
  }

  const hasSwapsToShow = swaps.length > 0 || otherWeekActionableSwaps.length > 0;
  const dateRangeLabel = `${formatShortDate(weekDates.sat || resolvedWeekStart)} — ${formatShortDate(
    weekDates.fri || ''
  )}`;

  return (
    <div className={arch.surfaces.sectionGapClass}>
      {isOfflineReadOnly && (
        <div className="text-xs font-medium text-warning">
          وضع أوفلاين — للعرض فقط
        </div>
      )}

      {/* 1. Borderless Typographic Header */}
      <header className="space-y-2 py-1">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-baseline gap-2.5 flex-wrap min-w-0">
            <h1
              className={`text-lg sm:text-xl ${arch.surfaces.headingWeight} tracking-tight text-ink m-0`}
            >
              الإجازات
            </h1>
            <span className="num-ltr text-xs font-medium text-ink-muted">
              {dateRangeLabel}
            </span>
            {loading && Boolean(scheduleData) && (
              <Icon
                name="progress_activity"
                size={14}
                spin
                className="text-ink-muted"
                ariaLabel="جاري التحديث"
              />
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <div className="hidden md:inline-flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setWeekStart(shiftWeekStart(resolvedWeekStart, -1))}
                aria-label="الأسبوع السابق"
                className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150"
              >
                <Icon name="chevron_right" size={20} />
              </button>
              <Button
                variant={resolvedWeekStart === currentCairoWeekStart ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setWeekStart(currentCairoWeekStart)}
              >
                اليوم
              </Button>
              <button
                type="button"
                onClick={() => setWeekStart(shiftWeekStart(resolvedWeekStart, 1))}
                aria-label="الأسبوع القادم"
                className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150"
              >
                <Icon name="chevron_left" size={20} />
              </button>
            </div>

            {scheduleTab === 'dayoffs' && effectiveCanSwap && (
              <Button
                variant="primary"
                size="sm"
                icon="add"
                disabled={isOfflineReadOnly}
                onClick={() => openSwapComposer({ preferredType: 'swap' })}
              >
                تبديل
              </Button>
            )}

            {scheduleTab === 'dayoffs' && (effectiveCanManage || canExport) && (
              <Button
                variant="secondary"
                size="sm"
                icon="tune"
                onClick={() => setActionsSheetOpen(true)}
                className="md:hidden"
              >
                خيارات
              </Button>
            )}
          </div>
        </div>

        <div className="flex md:hidden items-center justify-between gap-2 border-y border-line py-1">
          <button
            type="button"
            onClick={() => setWeekStart(shiftWeekStart(resolvedWeekStart, -1))}
            aria-label="الأسبوع السابق"
            className="w-11 h-11 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150"
          >
            <Icon name="chevron_right" size={20} />
          </button>
          <Button
            variant={resolvedWeekStart === currentCairoWeekStart ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setWeekStart(currentCairoWeekStart)}
          >
            اليوم
          </Button>
          <button
            type="button"
            onClick={() => setWeekStart(shiftWeekStart(resolvedWeekStart, 1))}
            aria-label="الأسبوع القادم"
            className="w-11 h-11 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150"
          >
            <Icon name="chevron_left" size={20} />
          </button>
        </div>
      </header>

      {/* 2. Primary Mode Switcher */}
      <SegmentedControl
        fullWidth
        ariaLabel="أقسام الجدول"
        value={scheduleTab}
        onChange={setScheduleTab}
        options={[
          { id: 'dayoffs', label: 'الإجازات' },
          {
            id: 'shifts',
            label: presentCount > 0 ? `الشفتات (${presentCount})` : 'الشفتات',
          },
        ]}
      />

      {/* 3. Borderless Admin & Export Toolbar (Desktop, Day-offs only) */}
      {scheduleTab === 'dayoffs' && (effectiveCanManage || canExport) && (
        <div className="hidden md:flex flex-wrap items-center justify-between gap-2.5">
          {effectiveCanManage && (
            <SegmentedControl
              ariaLabel="نطاق التعديل"
              value={editScope}
              onChange={setEditScope}
              options={[
                { id: 'week', label: 'هذا الأسبوع' },
                { id: 'default', label: 'الثابت' },
              ]}
            />
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {effectiveCanManage && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyAction || isOfflineReadOnly}
                  onClick={() => setConfirmBulkAction('copy_previous_week')}
                >
                  نسخ السابق
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyAction || isOfflineReadOnly}
                  onClick={() => setConfirmBulkAction('reset_to_defaults')}
                >
                  إعادة للثابت
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="tune"
                  onClick={() => setSettingsOpen(true)}
                >
                  إعدادات
                </Button>
              </>
            )}

            {(canExport || effectiveCanManage) && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const text = formatWeeklyScheduleWhatsApp(scheduleData, storeName);
                    if (text) openWhatsAppShare(text);
                  }}
                >
                  واتساب
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    exportWeeklyScheduleToWord(scheduleData, storeName);
                    onToast?.('تم تصدير Word');
                  }}
                >
                  Word
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await exportWeeklyScheduleToCsv(scheduleData, storeName);
                      onToast?.('تم تصدير Excel');
                    } catch (err) {
                      onToast?.(err?.message || 'تعذر تصدير Excel', 'error');
                    }
                  }}
                >
                  Excel
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {scheduleTab === 'shifts' ? (
        <ScheduleShiftsTab
          scheduleData={scheduleData}
          canVerify={effectiveCanVerify}
          canWriteAttendance={Boolean(propCanWriteAttendance)}
          onVerifyLog={handleVerifyShiftLog}
          onRefresh={() => loadSchedule({ silent: true })}
          onToast={onToast}
        />
      ) : (
        <>
          {/* 4. Adaptive 4-Metric Cockpit Strip */}
          <CockpitMetricStrip items={scheduleMetricItems} columns={4} />

          {/* 5. Swap Inbox — COMPLETELY HIDDEN when swaps.length === 0 && otherWeekActionableSwaps.length === 0 */}
          {hasSwapsToShow && (
            <div ref={inboxRef} className="scroll-mt-20 space-y-3">
              {otherWeekActionableSwaps.length > 0 && (
                <div className="py-2 border-y border-line flex flex-wrap items-center justify-between gap-2 text-xs">
                  <StatusDot
                    tone="warning"
                    label={`${otherWeekActionableSwaps.length} طلب في أسبوع آخر`}
                    tintedText
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(
                      new Set(otherWeekActionableSwaps.map((s) => s.week_start_date))
                    ).map((wk) => (
                      <Button
                        key={wk}
                        variant="ghost"
                        size="sm"
                        onClick={() => setWeekStart(wk)}
                      >
                        <span className="num-ltr">{wk}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {swaps.length > 0 && (
                <GroupedList
                  label="طلبات التبديل"
                  count={swaps.length}
                  actions={
                    otherSwaps.length > 0 && actionableSwaps.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowPastSwaps((v) => !v)}
                        className="text-xs font-medium text-primary hover:underline cursor-pointer min-h-[32px] px-1"
                      >
                        {showPastSwaps ? 'إخفاء السابقة' : `الكل (${otherSwaps.length})`}
                      </button>
                    ) : null
                  }
                >
                  {actionableSwaps.map((swap) => {
                    const isBusy = busySwapId === swap.id;
                    const isRejecting = rejectingSwapId === swap.id;
                    const isSwap = swap.request_type === 'swap';
                    const fromLabel = getScheduleWeekdayLabel(swap.requester_from_day);
                    const toLabel = getScheduleWeekdayLabel(swap.target_from_day);

                    return (
                      <div key={swap.id} className="px-3.5 py-3 space-y-2.5 bg-surface-tint">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <StatusDot tone="danger" label="بانتظار قرارك" pulse tintedText />
                              {swap.scope === 'permanent' && (
                                <span className="text-xs font-medium text-purple">دائم</span>
                              )}
                            </div>
                            <div className="text-sm font-semibold text-ink">
                              {isSwap
                                ? `${swap.requester_name || 'موظف'} (${fromLabel}) مع ${swap.target_name || 'زميل'} (${toLabel})`
                                : `${swap.requester_name || 'موظف'}: ${fromLabel} ← ${toLabel}`}
                            </div>
                            {swap.reason && (
                              <div className="text-xs text-ink-muted">{swap.reason}</div>
                            )}
                            <SwapApprovalStepper
                              swap={swap}
                              swapRequiresManagerApproval={
                                scheduleData?.settings?.swapRequiresManagerApproval
                              }
                            />
                          </div>

                          <div className="grid grid-cols-2 sm:flex w-full sm:w-auto items-center gap-2 shrink-0">
                            <Button
                              variant="success"
                              size="sm"
                              loading={isBusy}
                              disabled={isOfflineReadOnly}
                              onClick={() => handleSwapRespondOrDecide(swap, 'approve')}
                            >
                              قبول
                            </Button>
                            <Button
                              variant="dangerTonal"
                              size="sm"
                              disabled={isBusy || isOfflineReadOnly}
                              onClick={() => {
                                if (isRejecting) {
                                  setRejectingSwapId('');
                                  setRejectReason('');
                                } else {
                                  setRejectingSwapId(swap.id);
                                  setRejectReason('');
                                }
                              }}
                            >
                              رفض
                            </Button>
                          </div>
                        </div>

                        {isRejecting && (
                          <div className="pt-2 border-t border-line flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              placeholder="سبب الرفض (اختياري)..."
                              className="g-input flex-1"
                            />
                            <div className="grid grid-cols-2 sm:flex w-full sm:w-auto items-center gap-2 shrink-0">
                              <Button
                                variant="danger"
                                size="sm"
                                loading={isBusy}
                                onClick={() =>
                                  handleSwapRespondOrDecide(swap, 'reject', rejectReason)
                                }
                              >
                                تأكيد الرفض
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setRejectingSwapId('');
                                  setRejectReason('');
                                }}
                              >
                                إلغاء
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {(showPastSwaps || actionableSwaps.length === 0) &&
                    otherSwaps.map((swap) => {
                      const statusMeta =
                        SWAP_STATUS_META[swap.status] || SWAP_STATUS_META.pending_peer;
                      const isBusy = busySwapId === swap.id;
                      const isSwap = swap.request_type === 'swap';
                      const fromLabel = getScheduleWeekdayLabel(swap.requester_from_day);
                      const toLabel = getScheduleWeekdayLabel(swap.target_from_day);

                      return (
                        <div
                          key={swap.id}
                          className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <StatusDot tone={statusMeta.tone} label={statusMeta.label} />
                              {swap.scope === 'permanent' && (
                                <span className="text-xs font-medium text-purple">دائم</span>
                              )}
                            </div>
                            <div className="text-xs sm:text-sm font-medium text-ink">
                              {isSwap
                                ? `${swap.requester_name || 'موظف'} (${fromLabel}) مع ${swap.target_name || 'زميل'} (${toLabel})`
                                : `${swap.requester_name || 'موظف'}: ${fromLabel} ← ${toLabel}`}
                            </div>
                            {swap.reason && (
                              <div className="text-xs text-ink-muted">{swap.reason}</div>
                            )}
                            {swap.rejection_reason && (
                              <div className="text-xs text-danger">{swap.rejection_reason}</div>
                            )}
                            <SwapApprovalStepper
                              swap={swap}
                              swapRequiresManagerApproval={
                                scheduleData?.settings?.swapRequiresManagerApproval
                              }
                            />
                          </div>

                          <div className="grid grid-cols-2 sm:flex w-full sm:w-auto items-center gap-2 shrink-0">
                            {swap.can_cancel && (
                              <Button
                                variant="dangerTonal"
                                size="sm"
                                loading={isBusy}
                                disabled={isOfflineReadOnly}
                                onClick={() => setConfirmSwapAction({ mode: 'cancel', swap })}
                              >
                                إلغاء
                              </Button>
                            )}
                            {swap.can_revert && effectiveCanManage && (
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={isBusy}
                                disabled={isOfflineReadOnly}
                                onClick={() => setConfirmSwapAction({ mode: 'revert', swap })}
                              >
                                تراجع
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </GroupedList>
              )}
            </div>
          )}

          {/* 6. Mobile View (< md) */}
          <div className="md:hidden space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <SegmentedControl
                ariaLabel="طريقة العرض"
                value={mobileMode}
                onChange={setMobileMode}
                options={[
                  { id: 'day', label: 'باليوم' },
                  { id: 'employees', label: 'بالموظف' },
                ]}
              />

              {myEmployee?.effective_day_of_week && (
                <span className="text-xs font-medium text-primary">
                  إجازتك: {getScheduleWeekdayLabel(myEmployee.effective_day_of_week)}
                </span>
              )}
            </div>

            {mobileMode === 'day' ? (
              <div className="space-y-4">
                <WeekDayStrip
                  activeId={selectedDay}
                  onSelect={setSelectedDay}
                  ariaLabel="أيام إجازات الأسبوع"
                  days={SCHEDULE_WEEKDAYS.map((day) => {
                    const dayDateKey = weekDates[day.code] || '';
                    const isToday = dayDateKey === todayDateKey;
                    const offTotal = groups.reduce(
                      (sum, g) => sum + (g.coverageByDay?.[day.code]?.offCount || 0),
                      0
                    );
                    const anyLowCov = groups.some((g) => g.coverageByDay?.[day.code]?.lowCoverage);
                    return {
                      id: day.code,
                      shortLabel: day.shortLabel,
                      label: day.label,
                      dateNum: dayDateKey ? dayDateKey.slice(8) : '',
                      badge: String(offTotal),
                      alert: anyLowCov,
                      isToday,
                    };
                  })}
                />

                {groups.length === 0 ? (
                  <EmptyState compact title="لا توجد مجموعات" />
                ) : (
                  <div className="space-y-4">
                    {groups.map((group) => {
                      const cov = group.coverageByDay?.[selectedDay] || {
                        offCount: 0,
                        onDutyCount: 0,
                        totalCount: 0,
                        minRequired: 0,
                        lowCoverage: false,
                      };
                      const offEmps = (group.employees || []).filter(
                        (e) => e.effective_day_of_week === selectedDay
                      );
                      const unassignedEmps = (group.employees || []).filter(
                        (e) => !e.effective_day_of_week
                      );

                      return (
                        <GroupedList
                          key={group.id}
                          label={group.label}
                          count={`${cov.onDutyCount}/${cov.totalCount}`}
                          actions={
                            cov.lowCoverage ? (
                              <StatusDot
                                tone="warning"
                                label={`أقل من ${cov.minRequired}`}
                                tintedText
                              />
                            ) : null
                          }
                        >
                          {offEmps.length === 0 ? (
                            <div className="px-3.5 py-3 text-xs text-ink-muted">
                              لا إجازات
                            </div>
                          ) : (
                            offEmps.map((emp) => {
                              const isMe = emp.id === myEmployeeId;
                              const canSwapThis =
                                effectiveCanSwap &&
                                !isMe &&
                                myEmployee &&
                                myEmployee.team_group === emp.team_group &&
                                myEmployee.effective_day_of_week &&
                                emp.effective_day_of_week !== myEmployee.effective_day_of_week;

                              return (
                                <div
                                  key={emp.id}
                                  className={`min-h-[52px] px-3.5 py-2 flex items-center justify-between gap-2 ${
                                    isMe ? 'bg-surface-tint' : ''
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <RoleAvatar
                                      src={emp.avatar_url || ''}
                                      name={emp.name}
                                      color={emp.avatar_color || 'var(--g-primary-solid)'}
                                      preset="initials_gradient"
                                      size="xs"
                                      shape="circle"
                                    />
                                    <div className="min-w-0">
                                      <div className="text-xs sm:text-sm font-medium text-ink truncate">
                                        {emp.name}
                                        {isMe && (
                                          <span className="text-primary"> · أنت</span>
                                        )}
                                        {emp.is_override && (
                                          <span className="text-warning"> · معدل</span>
                                        )}
                                      </div>
                                      <div className="text-xs text-ink-muted truncate">
                                        {emp.department}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0">
                                    {canSwapThis && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={isOfflineReadOnly}
                                        onClick={() =>
                                          openSwapComposer({
                                            preselectedTargetId: emp.id,
                                            preferredType: 'swap',
                                          })
                                        }
                                      >
                                        تبديل
                                      </Button>
                                    )}
                                    {effectiveCanManage && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={isOfflineReadOnly}
                                        onClick={() =>
                                          setEditingEmployee({
                                            emp,
                                            dayOfWeek: emp.effective_day_of_week || '',
                                            teamGroup: emp.team_group,
                                            scope: editScope,
                                          })
                                        }
                                      >
                                        تعديل
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}

                          {effectiveCanManage && unassignedEmps.length > 0 && (
                            <div className="px-3.5 py-2.5 flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] font-medium text-ink-muted">
                                بدون يوم:
                              </span>
                              {unassignedEmps.map((emp) => (
                                <button
                                  key={emp.id}
                                  type="button"
                                  disabled={isOfflineReadOnly}
                                  onClick={() =>
                                    setEditingEmployee({
                                      emp,
                                      dayOfWeek: selectedDay,
                                      teamGroup: emp.team_group,
                                      scope: editScope,
                                    })
                                  }
                                  className="min-h-[36px] px-2.5 py-1 rounded-[var(--g-radius-btn)] border border-dashed border-line-strong text-xs font-medium text-primary cursor-pointer"
                                >
                                  + {emp.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </GroupedList>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {groups.length > 1 && (
                  <FilterChipRail
                    activeId={mobileGroupFilter}
                    onSelect={setMobileGroupFilter}
                    items={[
                      { id: 'all', label: 'الكل', count: allVisibleEmployees.length },
                      ...groups.map((g) => ({
                        id: g.id,
                        label: g.shortLabel || g.label,
                        count: (g.employees || []).length,
                      })),
                    ]}
                  />
                )}

                {filteredMobileGroups.map((group) => (
                  <GroupedList
                    key={group.id}
                    label={group.label}
                    count={(group.employees || []).length}
                  >
                    {(group.employees || []).length === 0 ? (
                      <div className="px-3.5 py-3 text-xs text-ink-muted">
                        لا يوجد موظفون
                      </div>
                    ) : (
                      (group.employees || []).map((emp) => {
                        const isMe = emp.id === myEmployeeId;
                        const offLabel = emp.effective_day_of_week
                          ? getScheduleWeekdayLabel(emp.effective_day_of_week)
                          : 'غير محدد';
                        const offDateShort = emp.effective_day_of_week
                          ? formatShortDate(weekDates[emp.effective_day_of_week])
                          : '';
                        const canSwapThis =
                          effectiveCanSwap &&
                          !isMe &&
                          myEmployee &&
                          myEmployee.team_group === emp.team_group &&
                          emp.effective_day_of_week &&
                          myEmployee.effective_day_of_week &&
                          emp.effective_day_of_week !== myEmployee.effective_day_of_week;

                        return (
                          <div
                            key={emp.id}
                            className={`min-h-[54px] px-3.5 py-2.5 flex items-center justify-between gap-2 ${
                              isMe ? 'bg-surface-tint' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <RoleAvatar
                                src={emp.avatar_url || ''}
                                name={emp.name}
                                color={emp.avatar_color || 'var(--g-primary-solid)'}
                                preset="initials_gradient"
                                size="sm"
                                shape="circle"
                              />
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-ink truncate">
                                  {emp.name}
                                  {isMe && <span className="text-primary"> · أنت</span>}
                                </div>
                                <div className="text-xs text-ink-muted truncate">
                                  {offLabel}
                                  {offDateShort ? ` (${offDateShort})` : ''}
                                  {emp.is_override ? ' · معدل' : ''}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              {canSwapThis && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={isOfflineReadOnly}
                                  onClick={() =>
                                    openSwapComposer({
                                      preselectedTargetId: emp.id,
                                      preferredType: 'swap',
                                    })
                                  }
                                >
                                  تبديل
                                </Button>
                              )}
                              {effectiveCanManage && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={isOfflineReadOnly}
                                  onClick={() =>
                                    setEditingEmployee({
                                      emp,
                                      dayOfWeek: emp.effective_day_of_week || '',
                                      teamGroup: emp.team_group,
                                      scope: editScope,
                                    })
                                  }
                                >
                                  تعديل
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </GroupedList>
                ))}
              </div>
            )}
          </div>

          {/* 7. Desktop Matrix Tables (md+) */}
          <div className="hidden md:block space-y-6">
            {groups.length === 0 ? (
              <EmptyState compact title="لا توجد فرق مسجلة" />
            ) : (
              groups.map((group) => {
                const emps = group.employees || [];
                const minRequired =
                  group.coverageByDay?.sat?.minRequired ??
                  scheduleData?.settings?.minOnDuty?.[group.id] ??
                  0;

                return (
                  <Card key={group.id} padding="none" className="overflow-hidden">
                    <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-line">
                      <div className="flex items-baseline gap-2.5">
                        <h3 className="text-sm font-semibold text-ink m-0">{group.label}</h3>
                        <span className="text-xs text-ink-muted num-ltr">
                          {emps.length} موظف · حد أدنى {minRequired}
                        </span>
                      </div>

                      {effectiveCanSwap && myEmployee?.team_group === group.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isOfflineReadOnly}
                          onClick={() => openSwapComposer({ preferredType: 'swap' })}
                        >
                          + تبديل
                        </Button>
                      )}
                    </div>

                    {emps.length === 0 ? (
                      <div className="p-6 text-center text-xs text-ink-muted">
                        لا يوجد موظفون
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-start">
                          <thead>
                            <tr className="border-b border-line">
                              <th className="sticky start-0 z-10 bg-surface p-3 text-xs font-semibold text-ink-muted min-w-[210px]">
                                الموظف
                              </th>
                              {SCHEDULE_WEEKDAYS.map((day) => {
                                const dKey = weekDates[day.code] || '';
                                const isToday = dKey === todayDateKey;
                                return (
                                  <th
                                    key={day.code}
                                    className={`p-2.5 text-center min-w-[88px] border-s border-line ${
                                      isToday ? 'bg-surface-tint' : ''
                                    }`}
                                  >
                                    <div
                                      className={`text-xs font-semibold ${
                                        isToday ? 'text-primary' : 'text-ink'
                                      }`}
                                    >
                                      {day.label}
                                    </div>
                                    <div className="num-ltr text-[11px] font-normal text-ink-muted mt-0.5">
                                      {formatShortDate(dKey)}
                                    </div>
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {emps.map((emp) => {
                              const isMe = emp.id === myEmployeeId;
                              const canSwapRow =
                                effectiveCanSwap &&
                                !isMe &&
                                myEmployee &&
                                myEmployee.team_group === emp.team_group &&
                                myEmployee.effective_day_of_week &&
                                emp.effective_day_of_week &&
                                emp.effective_day_of_week !== myEmployee.effective_day_of_week;

                              return (
                                <tr
                                  key={emp.id}
                                  className={`border-b border-line transition-[background-color] duration-150 ${
                                    isMe ? 'bg-surface-tint' : 'hover:bg-surface-tint'
                                  }`}
                                >
                                  <td className="sticky start-0 z-10 bg-surface p-3 align-middle">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        <RoleAvatar
                                          src={emp.avatar_url || ''}
                                          name={emp.name}
                                          color={emp.avatar_color || 'var(--g-primary-solid)'}
                                          preset="initials_gradient"
                                          size="xs"
                                          shape="circle"
                                        />
                                        <div className="min-w-0">
                                          <div className="text-xs sm:text-sm font-medium text-ink truncate">
                                            {emp.name}
                                            {isMe && (
                                              <span className="text-primary"> · أنت</span>
                                            )}
                                            {emp.is_override && (
                                              <span className="text-warning"> · معدل</span>
                                            )}
                                          </div>
                                          <div className="text-[11px] text-ink-muted truncate">
                                            {emp.department}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-1 shrink-0">
                                        {canSwapRow && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isOfflineReadOnly}
                                            onClick={() =>
                                              openSwapComposer({
                                                preselectedTargetId: emp.id,
                                                preferredType: 'swap',
                                              })
                                            }
                                          >
                                            تبديل
                                          </Button>
                                        )}
                                        {effectiveCanManage && (
                                          <select
                                            aria-label={`فريق ${emp.name}`}
                                            value={emp.team_group}
                                            disabled={busyAction || isOfflineReadOnly}
                                            onChange={(e) =>
                                              handleTeamGroupQuickChange(emp, e.target.value)
                                            }
                                            className="min-h-[36px] bg-transparent border border-line rounded-[var(--g-radius-btn)] px-2 py-1 text-[11px] font-medium text-ink outline-none focus:border-[var(--g-primary)]"
                                          >
                                            {SCHEDULE_TEAM_GROUPS.map((tg) => (
                                              <option key={tg.id} value={tg.id}>
                                                {tg.shortLabel || tg.label}
                                              </option>
                                            ))}
                                          </select>
                                        )}
                                      </div>
                                    </div>
                                  </td>

                                  {SCHEDULE_WEEKDAYS.map((day) => {
                                    const isOff = emp.effective_day_of_week === day.code;
                                    const isToday = weekDates[day.code] === todayDateKey;

                                    return (
                                      <td
                                        key={day.code}
                                        className={`p-1.5 text-center align-middle border-s border-line ${
                                          isToday ? 'bg-surface-tint' : ''
                                        }`}
                                      >
                                        {effectiveCanManage ? (
                                          <button
                                            type="button"
                                            disabled={busyAction || isOfflineReadOnly}
                                            onClick={() => {
                                              if (isOff) {
                                                setEditingEmployee({
                                                  emp,
                                                  dayOfWeek: emp.effective_day_of_week || '',
                                                  teamGroup: emp.team_group,
                                                  scope: editScope,
                                                });
                                              } else {
                                                handleAssignDayOff(emp, day.code);
                                              }
                                            }}
                                            className={`w-full min-h-[40px] px-2 py-1 rounded-[var(--g-radius-btn)] text-xs font-medium inline-flex items-center justify-center transition-[background-color,color] duration-150 cursor-pointer disabled:opacity-50 ${
                                              isOff
                                                ? 'bg-secondary-container text-on-secondary-container font-semibold'
                                                : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                                            }`}
                                          >
                                            {isOff ? 'إجازة' : '—'}
                                          </button>
                                        ) : isOff ? (
                                          <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-[var(--g-radius-btn)] bg-secondary-container text-on-secondary-container text-xs font-semibold">
                                            إجازة
                                          </span>
                                        ) : (
                                          <span className="text-xs text-ink-muted">—</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td className="sticky start-0 z-10 bg-surface p-3 text-xs font-semibold text-ink-muted">
                                التغطية
                              </td>
                              {SCHEDULE_WEEKDAYS.map((day) => {
                                const cov = group.coverageByDay?.[day.code] || {
                                  offCount: 0,
                                  onDutyCount: 0,
                                  lowCoverage: false,
                                };
                                return (
                                  <td
                                    key={day.code}
                                    className={`p-2 text-center border-s border-line num-ltr text-xs ${
                                      cov.lowCoverage
                                        ? 'text-warning font-semibold'
                                        : 'text-ink-muted'
                                    }`}
                                  >
                                    {cov.onDutyCount}/{cov.onDutyCount + cov.offCount}
                                  </td>
                                );
                              })}
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        </>
      )}

      {/* 7b. Mobile Schedule Actions BottomSheet */}
      <BottomSheet
        open={actionsSheetOpen}
        onClose={() => setActionsSheetOpen(false)}
        title="خيارات الجدول"
        subtitle={dateRangeLabel}
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          {effectiveCanManage && (
            <>
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-ink-muted">
                  نطاق التعديل
                </span>
                <SegmentedControl
                  fullWidth
                  ariaLabel="نطاق التعديل"
                  value={editScope}
                  onChange={setEditScope}
                  options={[
                    { id: 'week', label: 'هذا الأسبوع' },
                    { id: 'default', label: 'الثابت' },
                  ]}
                />
              </div>

              <GroupedList label="إدارة الجدول">
                <GroupedRow
                  onClick={() => {
                    setActionsSheetOpen(false);
                    setSettingsOpen(true);
                  }}
                >
                  <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                    <Icon name="tune" size={19} className="text-ink-muted" />
                    <span>إعدادات الجدول</span>
                  </span>
                  <Icon
                    name="chevron_left"
                    size={18}
                    className="text-ink-muted ltr:rotate-180"
                  />
                </GroupedRow>

                <GroupedRow
                  onClick={() => {
                    if (busyAction || isOfflineReadOnly) return;
                    setActionsSheetOpen(false);
                    setConfirmBulkAction('copy_previous_week');
                  }}
                >
                  <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                    <Icon name="content_copy" size={19} className="text-ink-muted" />
                    <span>نسخ الأسبوع السابق</span>
                  </span>
                  <Icon
                    name="chevron_left"
                    size={18}
                    className="text-ink-muted ltr:rotate-180"
                  />
                </GroupedRow>

                <GroupedRow
                  onClick={() => {
                    if (busyAction || isOfflineReadOnly) return;
                    setActionsSheetOpen(false);
                    setConfirmBulkAction('reset_to_defaults');
                  }}
                >
                  <span className="flex items-center gap-2.5 text-sm font-medium text-danger">
                    <Icon name="restart_alt" size={19} className="text-danger" />
                    <span>إعادة للجدول الثابت</span>
                  </span>
                  <Icon
                    name="chevron_left"
                    size={18}
                    className="text-ink-muted ltr:rotate-180"
                  />
                </GroupedRow>
              </GroupedList>
            </>
          )}

          {(canExport || effectiveCanManage) && (
            <GroupedList label="تصدير ومشاركة">
              <GroupedRow
                onClick={() => {
                  setActionsSheetOpen(false);
                  const text = formatWeeklyScheduleWhatsApp(scheduleData, storeName);
                  if (text) openWhatsAppShare(text);
                }}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                  <Icon name="send" size={19} className="text-[var(--g-whatsapp)]" />
                  <span>واتساب</span>
                </span>
                <Icon
                  name="chevron_left"
                  size={18}
                  className="text-ink-muted ltr:rotate-180"
                />
              </GroupedRow>

              <GroupedRow
                onClick={() => {
                  setActionsSheetOpen(false);
                  exportWeeklyScheduleToWord(scheduleData, storeName);
                  onToast?.('تم تصدير Word');
                }}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                  <Icon name="description" size={19} className="text-primary" />
                  <span>Word (.doc)</span>
                </span>
                <Icon
                  name="download"
                  size={18}
                  className="text-ink-muted opacity-70"
                />
              </GroupedRow>

              <GroupedRow
                onClick={async () => {
                  setActionsSheetOpen(false);
                  try {
                    await exportWeeklyScheduleToCsv(scheduleData, storeName);
                    onToast?.('تم تصدير Excel');
                  } catch (err) {
                    onToast?.(err?.message || 'تعذر تصدير Excel', 'error');
                  }
                }}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                  <Icon name="table_view" size={19} className="text-success" />
                  <span>Excel (.xlsx)</span>
                </span>
                <Icon
                  name="download"
                  size={18}
                  className="text-ink-muted opacity-70"
                />
              </GroupedRow>
            </GroupedList>
          )}
        </div>
      </BottomSheet>

      {/* 8. Settings BottomSheet */}
      <BottomSheet
        open={settingsOpen}
        onClose={() => !busyAction && setSettingsOpen(false)}
        title="إعدادات الجدول"
        maxWidth="max-w-md"
        footer={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busyAction}
              onClick={() => setSettingsOpen(false)}
            >
              إلغاء
            </Button>
            <Button
              type="submit"
              form="schedule-settings-form"
              variant="primary"
              fullWidth
              loading={busyAction}
              disabled={isOfflineReadOnly}
            >
              حفظ
            </Button>
          </div>
        }
      >
        <form id="schedule-settings-form" onSubmit={handleSaveSettings} className="space-y-4">
          <div className="border-y border-line">
            <ToggleSwitch
              checked={Boolean(settingsForm.swapRequiresManagerApproval)}
              onChange={(val) =>
                setSettingsForm((prev) => ({
                  ...prev,
                  swapRequiresManagerApproval: val,
                }))
              }
              label="اعتماد المدير للتبديل"
            />
          </div>

          <GroupedList label="الحد الأدنى اليومي">
            {SCHEDULE_TEAM_GROUPS.map((grp) => {
              const count = Number(settingsForm.minOnDuty[grp.id] ?? 0);
              return (
                <div
                  key={grp.id}
                  className="min-h-[54px] px-3.5 py-2 flex items-center justify-between gap-3"
                >
                  <span className="text-sm font-medium text-ink min-w-0 truncate">
                    {grp.label}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={busyAction || isOfflineReadOnly || count <= 0}
                      aria-label={`تقليل ${grp.label}`}
                      onClick={() =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          minOnDuty: {
                            ...prev.minOnDuty,
                            [grp.id]: Math.max(0, Number(prev.minOnDuty[grp.id] ?? 0) - 1),
                          },
                        }))
                      }
                      className="w-11 h-11 rounded-[var(--g-radius-btn)] bg-surface-2 border border-line text-ink hover:border-line-strong disabled:opacity-40 inline-flex items-center justify-center cursor-pointer transition-colors duration-150"
                    >
                      <Icon name="remove" size={18} />
                    </button>
                    <span
                      className="min-w-[2.25rem] text-center num-ltr text-base font-semibold text-ink"
                      aria-live="polite"
                    >
                      {count}
                    </span>
                    <button
                      type="button"
                      disabled={busyAction || isOfflineReadOnly || count >= 99}
                      aria-label={`زيادة ${grp.label}`}
                      onClick={() =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          minOnDuty: {
                            ...prev.minOnDuty,
                            [grp.id]: Math.min(99, Number(prev.minOnDuty[grp.id] ?? 0) + 1),
                          },
                        }))
                      }
                      className="w-11 h-11 rounded-[var(--g-radius-btn)] bg-surface-2 border border-line text-ink hover:border-line-strong disabled:opacity-40 inline-flex items-center justify-center cursor-pointer transition-colors duration-150"
                    >
                      <Icon name="add" size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </GroupedList>
        </form>
      </BottomSheet>

      {/* 9. Bulk Action ConfirmSheet */}
      <ConfirmSheet
        open={Boolean(confirmBulkAction)}
        onClose={() => !busyAction && setConfirmBulkAction(null)}
        onConfirm={handleBulkActionConfirm}
        loading={busyAction}
        tone={confirmBulkAction === 'reset_to_defaults' ? 'danger' : 'warning'}
        title={
          confirmBulkAction === 'copy_previous_week'
            ? 'نسخ الأسبوع السابق'
            : 'إعادة للجدول الثابت'
        }
        description={
          confirmBulkAction === 'copy_previous_week'
            ? `نسخ إجازات الأسبوع السابق إلى أسبوع ${resolvedWeekStart}؟`
            : `إعادة أسبوع ${resolvedWeekStart} للجدول الثابت وإلغاء الطلبات المعلقة؟`
        }
        confirmLabel="تأكيد"
      />

      {/* 10. Quick-Edit Employee Day & Group BottomSheet */}
      <BottomSheet
        open={Boolean(editingEmployee)}
        onClose={() => !busyAction && setEditingEmployee(null)}
        title={editingEmployee?.emp?.name || ''}
        subtitle={editingEmployee?.emp?.department || ''}
        maxWidth="max-w-md"
        footer={
          editingEmployee && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={busyAction}
                onClick={() => setEditingEmployee(null)}
              >
                إلغاء
              </Button>
              <Button
                variant="primary"
                fullWidth
                loading={busyAction}
                onClick={() =>
                  handleAssignDayOff(
                    editingEmployee.emp,
                    editingEmployee.dayOfWeek || null,
                    editingEmployee.teamGroup,
                    editingEmployee.scope
                  )
                }
              >
                حفظ
              </Button>
            </div>
          )
        }
      >
        {editingEmployee && (
          <div className="space-y-4">
            <SegmentedControl
              fullWidth
              ariaLabel="نطاق التعديل"
              value={editingEmployee.scope}
              onChange={(val) => setEditingEmployee((s) => ({ ...s, scope: val }))}
              options={[
                { id: 'week', label: 'هذا الأسبوع' },
                { id: 'default', label: 'الثابت' },
              ]}
            />

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-ink-muted">الفريق</span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                {SCHEDULE_TEAM_GROUPS.map((tg) => (
                  <button
                    key={tg.id}
                    type="button"
                    onClick={() => setEditingEmployee((s) => ({ ...s, teamGroup: tg.id }))}
                    className={`min-h-[42px] px-2 py-1.5 rounded-[var(--g-radius-btn)] text-xs font-medium border transition-[background-color,border-color,color] duration-150 cursor-pointer ${
                      editingEmployee.teamGroup === tg.id
                        ? 'bg-secondary-container text-on-secondary-container border-transparent font-semibold'
                        : 'bg-transparent text-ink border-line hover:border-line-strong'
                    }`}
                  >
                    {tg.shortLabel || tg.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-ink-muted">يوم الإجازة</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {SCHEDULE_WEEKDAYS.map((day) => {
                  const active = editingEmployee.dayOfWeek === day.code;
                  return (
                    <button
                      key={day.code}
                      type="button"
                      onClick={() => setEditingEmployee((s) => ({ ...s, dayOfWeek: day.code }))}
                      className={`min-h-[44px] px-2.5 py-1.5 rounded-[var(--g-radius-btn)] text-xs font-medium border transition-[background-color,border-color,color] duration-150 cursor-pointer ${
                        active
                          ? 'bg-primary-solid text-on-primary border-transparent font-semibold'
                          : 'bg-transparent text-ink border-line hover:border-line-strong'
                      }`}
                    >
                      <div>{day.label}</div>
                      <div className="num-ltr text-[11px] opacity-80">
                        {formatShortDate(weekDates[day.code])}
                      </div>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setEditingEmployee((s) => ({ ...s, dayOfWeek: '' }))}
                  className={`min-h-[44px] px-2.5 py-1.5 rounded-[var(--g-radius-btn)] text-xs font-medium border transition-[background-color,border-color,color] duration-150 cursor-pointer ${
                    editingEmployee.dayOfWeek === ''
                      ? 'bg-danger-bg text-danger border-[var(--g-red-border)] font-semibold'
                      : 'bg-transparent text-ink-muted border-line'
                  }`}
                >
                  بدون يوم
                </button>
              </div>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* 11. Swap / Move Composer BottomSheet */}
      <BottomSheet
        open={Boolean(swapComposer)}
        onClose={() => !busyAction && setSwapComposer(null)}
        title="تبديل إجازة"
        subtitle={
          composerContext?.reqEmp
            ? `${composerContext.reqEmp.name}${
                composerContext.reqDay
                  ? ` · ${getScheduleWeekdayLabel(composerContext.reqDay)}`
                  : ''
              }`
            : ''
        }
        maxWidth="max-w-lg"
        footer={
          swapComposer && composerContext?.reqDay ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busyAction}
                onClick={() => setSwapComposer(null)}
              >
                إلغاء
              </Button>
              <Button
                type="button"
                variant="primary"
                fullWidth
                loading={busyAction}
                disabled={!composerContext.canSubmit || isOfflineReadOnly}
                onClick={handleSubmitSwapComposer}
              >
                إرسال الطلب
              </Button>
            </div>
          ) : null
        }
      >
        {swapComposer && composerContext && (
          <form onSubmit={handleSubmitSwapComposer} className="space-y-4">
            {effectiveCanManage && allVisibleEmployees.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الموظف
                </label>
                <select
                  value={swapComposer.requesterId}
                  onChange={(e) =>
                    openSwapComposer({
                      requesterIdOverride: e.target.value,
                      preferredType: swapComposer.requestType,
                    })
                  }
                  className="g-input"
                >
                  {allVisibleEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} —{' '}
                      {emp.effective_day_of_week
                        ? getScheduleWeekdayLabel(emp.effective_day_of_week)
                        : 'بدون يوم'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!composerContext.reqDay ? (
              <div className="text-xs font-medium text-warning">
                لم يتم تحديد يوم إجازة لهذا الموظف بعد.
              </div>
            ) : (
              <>
                {composerContext.isReqPast && (
                  <div className="text-xs font-medium text-danger">
                    يوم الإجازة الحالي قد مضى.
                  </div>
                )}

                <SegmentedControl
                  fullWidth
                  ariaLabel="نوع الطلب"
                  value={swapComposer.requestType}
                  onChange={(val) =>
                    setSwapComposer((prev) => ({ ...prev, requestType: val }))
                  }
                  options={[
                    { id: 'swap', label: 'تبديل مع زميل' },
                    { id: 'move', label: 'ترحيل ليوم آخر' },
                  ]}
                />

                <SegmentedControl
                  fullWidth
                  ariaLabel="نطاق التغيير"
                  value={swapComposer.scope}
                  onChange={(val) => setSwapComposer((prev) => ({ ...prev, scope: val }))}
                  options={[
                    { id: 'week', label: 'هذا الأسبوع' },
                    { id: 'permanent', label: 'دائم' },
                  ]}
                />

                {swapComposer.requestType === 'swap' ? (
                  <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-ink-muted">الزميل</span>
                    {composerContext.sameGroupColleagues.length === 0 ? (
                      <div className="text-xs text-ink-muted">لا يوجد زملاء متاحون</div>
                    ) : (
                      <GroupedList>
                        {composerContext.sameGroupColleagues.map((col) => {
                          const colDay = col.effective_day_of_week;
                          const sameDay = colDay === composerContext.reqDay;
                          const isPast =
                            Boolean(colDay) &&
                            !effectiveCanManage &&
                            (weekDates[colDay] || '') < todayDateKey;
                          const disabled = !colDay || sameDay || isPast;
                          const isPicked = swapComposer.targetEmployeeId === col.id;

                          return (
                            <button
                              key={col.id}
                              type="button"
                              disabled={disabled}
                              onClick={() =>
                                setSwapComposer((prev) => ({
                                  ...prev,
                                  targetEmployeeId: col.id,
                                }))
                              }
                              className={`w-full min-h-[48px] px-3.5 py-2 text-start flex items-center justify-between gap-2 transition-[background-color] duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                isPicked ? 'bg-surface-tint' : 'hover:bg-surface-tint'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="text-xs sm:text-sm font-medium text-ink truncate">
                                  {col.name}
                                </div>
                                <div className="text-[11px] text-ink-muted">
                                  {col.department}
                                </div>
                              </div>
                              <span
                                className={`text-xs num-ltr shrink-0 ${
                                  isPicked
                                    ? 'text-primary font-semibold'
                                    : 'text-ink-muted'
                                }`}
                              >
                                {colDay
                                  ? `${getScheduleWeekdayLabel(colDay)} (${formatShortDate(
                                      weekDates[colDay]
                                    )})`
                                  : 'غير محدد'}
                              </span>
                            </button>
                          );
                        })}
                      </GroupedList>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-ink-muted">
                      اليوم المطلوب
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {SCHEDULE_WEEKDAYS.filter((d) => d.code !== composerContext.reqDay).map(
                        (day) => {
                          const isPast =
                            !effectiveCanManage && (weekDates[day.code] || '') < todayDateKey;
                          const isPicked = swapComposer.targetDay === day.code;

                          return (
                            <button
                              key={day.code}
                              type="button"
                              disabled={isPast}
                              onClick={() =>
                                setSwapComposer((prev) => ({ ...prev, targetDay: day.code }))
                              }
                              className={`min-h-[44px] px-3 py-1.5 rounded-[var(--g-radius-btn)] text-xs font-medium border transition-[background-color,border-color,color] duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                isPicked
                                  ? 'bg-primary-solid text-on-primary border-transparent font-semibold'
                                  : 'bg-transparent text-ink border-line hover:border-line-strong'
                              }`}
                            >
                              <div>{day.label}</div>
                              <div className="num-ltr text-[11px] opacity-80">
                                {formatShortDate(weekDates[day.code])}
                              </div>
                            </button>
                          );
                        }
                      )}
                    </div>
                  </div>
                )}

                {composerContext.preview && (
                  <div className="py-2 border-y border-line flex items-center justify-between gap-2 text-xs text-ink-muted flex-wrap">
                    <span className="num-ltr">
                      {composerContext.preview.fromLabel}: {composerContext.preview.fromOnDutyBefore}→
                      {composerContext.preview.fromOnDutyAfter}
                    </span>
                    <span
                      className={`num-ltr ${
                        composerContext.preview.toLowAfter
                          ? 'text-warning font-semibold'
                          : ''
                      }`}
                    >
                      {composerContext.preview.toLabel}: {composerContext.preview.toOnDutyBefore}→
                      {composerContext.preview.toOnDutyAfter}
                    </span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    السبب
                  </label>
                  <input
                    type="text"
                    maxLength={220}
                    value={swapComposer.reason}
                    onChange={(e) =>
                      setSwapComposer((prev) => ({ ...prev, reason: e.target.value }))
                    }
                    placeholder="اختياري..."
                    className="g-input"
                  />
                </div>
              </>
            )}
          </form>
        )}
      </BottomSheet>

      <ConfirmSheet
        open={Boolean(confirmSwapAction)}
        onClose={() => !busySwapId && setConfirmSwapAction(null)}
        onConfirm={() => {
          if (!confirmSwapAction?.swap) return;
          if (confirmSwapAction.mode === 'revert') {
            handleRevertSwap(confirmSwapAction.swap);
          } else {
            handleCancelSwap(confirmSwapAction.swap);
          }
        }}
        title={confirmSwapAction?.mode === 'revert' ? 'التراجع عن التبديل' : 'إلغاء الطلب'}
        description={
          confirmSwapAction?.mode === 'revert'
            ? 'استعادة أيام الإجازة الأصلية للطرفين في هذا الأسبوع؟'
            : 'إلغاء طلب التبديل الحالي؟'
        }
        confirmLabel={confirmSwapAction?.mode === 'revert' ? 'تراجع' : 'إلغاء الطلب'}
        tone={confirmSwapAction?.mode === 'revert' ? 'warning' : 'danger'}
        loading={Boolean(confirmSwapAction?.swap && busySwapId === confirmSwapAction.swap.id)}
      />
    </div>
  );
}
