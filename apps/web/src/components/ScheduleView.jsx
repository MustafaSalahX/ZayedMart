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
} from '../lib/api.js';
import { playSuccessChime } from '../lib/audio.js';
import {
  exportWeeklyScheduleToCsv,
  exportWeeklyScheduleToWord,
  formatWeeklyScheduleWhatsApp,
  openWhatsAppShare,
} from '../lib/exportUtils.js';
import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  FilterChipRail,
  SkeletonKpiStrip,
  SkeletonList,
  StatCard,
} from './ui/index.js';

const GROUP_STYLE_BY_TONE = {
  primary: {
    borderTop: 'border-t-4 border-t-[var(--g-primary)]',
    iconBox: 'bg-[var(--g-primary-container)] text-[var(--g-primary)]',
    offPill:
      'bg-[var(--g-primary-container)] text-[var(--g-on-primary-container)] border border-[var(--g-primary)]/35',
    badgeTone: 'primary',
  },
  secondary: {
    borderTop: 'border-t-4 border-t-[#007B83]',
    iconBox: 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]',
    offPill:
      'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] border border-[#007B83]/35',
    badgeTone: 'secondary',
  },
  purple: {
    borderTop: 'border-t-4 border-t-[var(--g-purple-border)]',
    iconBox: 'bg-[var(--g-purple-bg)] text-[var(--g-purple)]',
    offPill:
      'bg-[var(--g-purple-bg)] text-[var(--g-purple)] border border-[var(--g-purple-border)]/40',
    badgeTone: 'purple',
  },
};

const SWAP_STATUS_META = {
  pending_requester: { label: 'بانتظار موافقة المبادر', tone: 'warning', icon: 'hourglass_top' },
  pending_peer: { label: 'بانتظار موافقة الزميل', tone: 'warning', icon: 'hourglass_top' },
  pending_manager: { label: 'بانتظار اعتماد الإدارة', tone: 'orange', icon: 'admin_panel_settings' },
  approved: { label: 'معتمد ومطبق', tone: 'success', icon: 'check_circle' },
  rejected: { label: 'مرفوض', tone: 'danger', icon: 'cancel' },
  cancelled: { label: 'ملغي', tone: 'neutral', icon: 'block' },
  reverted: { label: 'تم التراجع عنه', tone: 'purple', icon: 'undo' },
};

function formatShortDate(dateKey) {
  if (!dateKey || typeof dateKey !== 'string') return '';
  const parts = dateKey.split('-');
  if (parts.length !== 3) return dateKey;
  return `${parts[2]}/${parts[1]}`;
}

function getInitials(name = '') {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('');
}

function SwapApprovalStepper({ swap, swapRequiresManagerApproval }) {
  const isSwap = swap.request_type === 'swap';
  const reqDone = Number(swap.requester_approved) === 1;
  const peerDone = Number(swap.target_approved) === 1;
  const mgrDone = Number(swap.manager_approved) === 1;
  const isFinalApproved = swap.status === 'approved';
  const isStopped =
    swap.status === 'rejected' || swap.status === 'cancelled' || swap.status === 'reverted';

  const needsManagerStep =
    !isSwap ||
    Boolean(swapRequiresManagerApproval) ||
    swap.status === 'pending_manager' ||
    mgrDone;

  const steps = [
    {
      key: 'requester',
      label: isSwap ? 'الكاشير الأول' : 'مقدم الطلب',
      done: reqDone,
      active: swap.status === 'pending_requester',
    },
  ];

  if (isSwap) {
    steps.push({
      key: 'peer',
      label: 'الكاشير الثاني',
      done: peerDone,
      active: swap.status === 'pending_peer',
    });
  }

  steps.push({
    key: 'final',
    label: needsManagerStep ? 'اعتماد الإدارة' : 'التطبيق التلقائي',
    done: isFinalApproved || mgrDone,
    active: swap.status === 'pending_manager',
  });

  return (
    <div className="flex items-center flex-wrap gap-1.5 text-[11px] font-extrabold">
      {steps.map((step, idx) => {
        const toneCls = step.done
          ? 'bg-[var(--g-green-bg)] text-[var(--g-green)] border border-[var(--g-green-border)]/35'
          : step.active
          ? 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)] border border-[var(--g-yellow-border)]/45'
          : isStopped
          ? 'bg-[var(--g-surface-variant)] text-[var(--g-muted)] border border-[var(--g-border)] opacity-70'
          : 'bg-[var(--g-surface-variant)] text-[var(--g-muted)] border border-[var(--g-border)]';

        const icon = step.done
          ? 'check_circle'
          : step.active
          ? 'hourglass_top'
          : 'radio_button_unchecked';

        return (
          <React.Fragment key={step.key}>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${toneCls}`}>
              <span className={`ms-icon text-xs ${step.done ? 'filled' : ''}`}>{icon}</span>
              <span>{step.label}</span>
            </span>
            {idx < steps.length - 1 && (
              <span className="ms-icon text-xs text-[var(--g-muted)]">arrow_back</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function ScheduleView({
  bootstrapData = null,
  storeName = 'زايد مارت',
  canManage: propCanManage = false,
  canSwap: propCanSwap = false,
  canExport = false,
  onRefreshBootstrap,
  onToast,
}) {
  const currentCairoWeekStart = useMemo(
    () => getSaturdayWeekStart(getCairoDateKey()),
    []
  );

  const [weekStart, setWeekStart] = useState(
    () => bootstrapData?.dayOffSchedule?.weekStartDate || currentCairoWeekStart
  );
  const [scheduleData, setScheduleData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyAction, setBusyAction] = useState(false);
  const [busySwapId, setBusySwapId] = useState('');

  // Admin scope: 'week' vs 'default'
  const [editScope, setEditScope] = useState('week');

  // Mobile layout mode: 'day' (default) vs 'employees'
  const [mobileMode, setMobileMode] = useState('day');
  const [selectedDay, setSelectedDay] = useState(
    () => bootstrapData?.dayOffSchedule?.todayWeekday || 'sat'
  );
  const [mobileGroupFilter, setMobileGroupFilter] = useState('all');

  // BottomSheets & Inline Reject State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    swapRequiresManagerApproval: false,
    minOnDuty: { cashiers: 2, hall: 2, security_cctv: 1 },
  });
  const [confirmBulkAction, setConfirmBulkAction] = useState(null);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [swapComposer, setSwapComposer] = useState(null);
  const [rejectingSwapId, setRejectingSwapId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showPastSwaps, setShowPastSwaps] = useState(false);
  const [pendingOpenComposer, setPendingOpenComposer] = useState(false);

  const inboxRef = useRef(null);

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
        setLoadError(err.message || 'تعذر تحميل جدول الإجازات الأسبوعي');
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

  // Keep selectedDay synced to todayWeekday when jumping to current week
  useEffect(() => {
    if (scheduleData?.todayWeekday && weekStart === currentCairoWeekStart) {
      setSelectedDay(scheduleData.todayWeekday);
    }
  }, [scheduleData?.todayWeekday, weekStart, currentCairoWeekStart]);

  // Listen to realtime schedule update signals dispatched by App.jsx
  useEffect(() => {
    const handleScheduleUpdated = () => {
      loadSchedule({ silent: true });
    };
    window.addEventListener('zayed:schedule-updated', handleScheduleUpdated);
    return () => window.removeEventListener('zayed:schedule-updated', handleScheduleUpdated);
  }, [loadSchedule]);

  const effectiveCanManage = Boolean(scheduleData?.canManage ?? propCanManage);
  const effectiveCanSwap = Boolean(scheduleData?.canSwap ?? propCanSwap);
  const isOfflineReadOnly = Boolean(scheduleData?._offlineCached);

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

  // KPI metrics
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

  const openSwapComposer = useCallback(
    ({ preselectedTargetId = '', preferredType = 'swap', requesterIdOverride = '' } = {}) => {
      if (isOfflineReadOnly) {
        onToast?.('أنت في وضع عدم الاتصال — يرجى الاتصال بالشبكة لتقديم طلب تبديل', 'error');
        return;
      }
      const reqEmp =
        (requesterIdOverride && allVisibleEmployees.find((e) => e.id === requesterIdOverride)) ||
        myEmployee ||
        (effectiveCanManage
          ? allVisibleEmployees.find((e) => Boolean(e.effective_day_of_week)) || null
          : null);

      if (!reqEmp) {
        onToast?.(
          'حسابك غير مرتبط بسجل موظف نشط — تواصل مع الإدارة لربط حسابك أولاً',
          'error'
        );
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

  // Listen for SmartFab zayed:open-composer event (queue if scheduleData is still loading)
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
      const dayLabel = dayOfWeek ? getScheduleWeekdayLabel(dayOfWeek) : 'بدون يوم محدد';
      onToast?.(
        activeScope === 'default'
          ? `تم تحديث الإجازة الثابتة لـ "${emp.name}" إلى (${dayLabel})`
          : `تم تحديث إجازة "${emp.name}" لهذا الأسبوع إلى (${dayLabel})`
      );
      setEditingEmployee(null);
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر حفظ تعيين الإجازة', 'error');
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
      onToast?.('اختر يوم الإجازة للموظف لحفظ تغيير الفريق');
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
      const grpLabel =
        SCHEDULE_TEAM_GROUPS.find((g) => g.id === nextTeamGroup)?.label || nextTeamGroup;
      onToast?.(`تم نقل "${emp.name}" إلى فريق (${grpLabel})`);
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر تغيير فريق الموظف', 'error');
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
          ? 'تم نسخ جدول الأسبوع السابق إلى هذا الأسبوع بنجاح'
          : 'تمت إعادة تعيين جدول هذا الأسبوع إلى الجدول الثابت'
      );
      setConfirmBulkAction(null);
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر تنفيذ العملية الجماعية', 'error');
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
      onToast?.('تم حفظ إعدادات جدول الإجازات بنجاح');
      setSettingsOpen(false);
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر حفظ الإعدادات', 'error');
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
      onToast?.(
        decision === 'approve'
          ? 'تم تسجيل الموافقة بنجاح'
          : 'تم رفض الطلب'
      );
      setRejectingSwapId('');
      setRejectReason('');
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر معالجة الطلب', 'error');
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
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر إلغاء الطلب', 'error');
    } finally {
      setBusySwapId('');
    }
  }

  async function handleRevertSwap(swap) {
    if (!swap?.id || busySwapId || isOfflineReadOnly) return;
    setBusySwapId(swap.id);
    try {
      await revertDayOffSwap(swap.id, { reason: 'تراجع إداري من جدول الإجازات' });
      playSuccessChime('out');
      onToast?.('تم التراجع عن التبديل واستعادة الأيام الأصلية بنجاح');
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر التراجع عن التبديل', 'error');
    } finally {
      setBusySwapId('');
    }
  }

  async function handleSubmitSwapComposer(e) {
    e.preventDefault();
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
      const res = await createDayOffSwap(payload);
      playSuccessChime('in');
      const nextStatus = res?.swap?.status;
      onToast?.(
        nextStatus === 'pending_requester'
          ? 'تم تسجيل طلب التبديل وإرساله للموظفين للموافقة'
          : swapComposer.requestType === 'swap'
          ? 'تم إرسال طلب تبديل الإجازة للزميل للموافقة'
          : 'تم إرسال طلب ترحيل الإجازة للإدارة للموافقة'
      );
      setSwapComposer(null);
      await refreshAll();
    } catch (err) {
      onToast?.(err.message || 'تعذر إرسال طلب الإجازة', 'error');
    } finally {
      setBusyAction(false);
    }
  }

  // Composer derived state & live coverage preview
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
          fromLowAfter: covFrom.lowCoverage,
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
          fromLowAfter: false,
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
        <SkeletonList count={4} />
      </div>
    );
  }

  if (loadError && !scheduleData) {
    return (
      <EmptyState
        icon="calendar_month"
        title="تعذر تحميل جدول الإجازات"
        description={loadError}
        actionLabel="إعادة المحاولة"
        actionIcon="refresh"
        onAction={() => loadSchedule()}
      />
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Offline Read-Only Banner */}
      {isOfflineReadOnly && (
        <div className="g-card p-3 border-[var(--g-yellow-border)] bg-[var(--g-yellow-bg)]/50 flex items-center gap-2.5 text-xs sm:text-sm font-extrabold text-[var(--g-yellow)]">
          <span className="ms-icon filled text-xl shrink-0">cloud_off</span>
          <span>
            وضع عدم الاتصال: يتم عرض آخر نسخة محفوظة من جدول الإجازات (للقراءة فقط حتى عودة الإنترنت).
          </span>
        </div>
      )}

      {/* 1. Week Header & Admin Toolbar */}
      <Card padding="md" className="space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Title & Date Range */}
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-11 h-11 rounded-2xl bg-[var(--g-primary-container)] text-[var(--g-primary)] flex items-center justify-center shrink-0">
              <span className="ms-icon filled text-2xl">calendar_month</span>
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-xl font-black text-[var(--g-text)] m-0">
                  جدول الإجازات الأسبوعي
                </h2>
                {resolvedWeekStart === currentCairoWeekStart && (
                  <Badge tone="primary" icon="today">
                    الأسبوع الحالي
                  </Badge>
                )}
              </div>
              <div className="text-xs sm:text-sm font-bold text-[var(--g-muted)] flex items-center gap-1.5 flex-wrap mt-0.5">
                <span>من السبت</span>
                <span className="num-ltr font-black text-[var(--g-text)]">
                  {weekDates.sat || resolvedWeekStart}
                </span>
                <span>إلى الجمعة</span>
                <span className="num-ltr font-black text-[var(--g-text)]">
                  {weekDates.fri || ''}
                </span>
              </div>
            </div>
          </div>

          {/* Week Switcher Controls */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon="chevron_right"
              onClick={() => setWeekStart(shiftWeekStart(resolvedWeekStart, -1))}
            >
              الأسبوع السابق
            </Button>
            <Button
              variant={resolvedWeekStart === currentCairoWeekStart ? 'tonal' : 'secondary'}
              size="sm"
              icon="today"
              onClick={() => setWeekStart(currentCairoWeekStart)}
            >
              الأسبوع الحالي
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="chevron_left"
              onClick={() => setWeekStart(shiftWeekStart(resolvedWeekStart, 1))}
            >
              الأسبوع القادم
            </Button>

            {effectiveCanSwap && (
              <Button
                variant="primary"
                size="sm"
                icon="swap_horiz"
                disabled={isOfflineReadOnly}
                onClick={() => openSwapComposer({ preferredType: 'swap' })}
              >
                طلب تبديل / ترحيل إجازتي
              </Button>
            )}
          </div>
        </div>

        {/* Admin Toolbar: Scope Switcher + Quick Actions + Exports */}
        {(effectiveCanManage || canExport) && (
          <div className="pt-3 border-t border-[var(--g-border)] flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
            {effectiveCanManage && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex p-1 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] gap-1">
                  <button
                    type="button"
                    onClick={() => setEditScope('week')}
                    className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-extrabold transition-all ${
                      editScope === 'week'
                        ? 'bg-[var(--g-primary-solid)] text-white shadow-2xs'
                        : 'text-[var(--g-muted)] hover:text-[var(--g-text)]'
                    }`}
                  >
                    تعديل لهذا الأسبوع
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditScope('default')}
                    className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-extrabold transition-all ${
                      editScope === 'default'
                        ? 'bg-[var(--g-purple)] text-white shadow-2xs'
                        : 'text-[var(--g-muted)] hover:text-[var(--g-text)]'
                    }`}
                  >
                    الجدول الثابت المتكرر
                  </button>
                </div>
                <span className="text-[11px] font-bold text-[var(--g-muted)]">
                  {editScope === 'default'
                    ? 'أي تعديل الآن يحفظ كجدول ثابت متكرر لكل الأسابيع'
                    : 'التعديل يطبق على هذا الأسبوع فقط دون تغيير الثابت'}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              {effectiveCanManage && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="content_copy"
                    disabled={busyAction || isOfflineReadOnly}
                    onClick={() => setConfirmBulkAction('copy_previous_week')}
                  >
                    نسخ الأسبوع السابق
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="restart_alt"
                    disabled={busyAction || isOfflineReadOnly}
                    onClick={() => setConfirmBulkAction('reset_to_defaults')}
                  >
                    إعادة للجدول الثابت
                  </Button>
                  <Button
                    variant="tonal"
                    size="sm"
                    icon="tune"
                    onClick={() => setSettingsOpen(true)}
                  >
                    إعدادات الجدول
                  </Button>
                </>
              )}

              {(canExport || effectiveCanManage) && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="share"
                    onClick={() => {
                      const text = formatWeeklyScheduleWhatsApp(scheduleData, storeName);
                      if (text) openWhatsAppShare(text);
                    }}
                  >
                    واتساب
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="description"
                    onClick={() => {
                      exportWeeklyScheduleToWord(scheduleData, storeName);
                      onToast?.('تم تجهيز ملف Word لجدول الإجازات');
                    }}
                  >
                    Word
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="table_view"
                    onClick={() => {
                      exportWeeklyScheduleToCsv(scheduleData);
                      onToast?.('تم تجهيز ملف Excel لجدول الإجازات');
                    }}
                  >
                    Excel
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* 2. KPI StatCard Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <StatCard
          label="إجازات هذا الأسبوع"
          value={kpiMetrics.assignedOffCount}
          sublabel={`من أصل ${kpiMetrics.totalEmployees} موظف`}
          icon="date_range"
          tone="primary"
        />
        <StatCard
          label={resolvedWeekStart === currentCairoWeekStart ? 'إجازة اليوم' : `إجازة ${getScheduleWeekdayLabel(selectedDay)}`}
          value={kpiMetrics.offTodayCount}
          sublabel={
            resolvedWeekStart === currentCairoWeekStart && todayWeekday
              ? getScheduleWeekdayLabel(todayWeekday)
              : formatShortDate(weekDates[selectedDay])
          }
          icon="event_available"
          tone="neutral"
        />
        <StatCard
          label="طلبات بانتظارك"
          value={kpiMetrics.pendingForMe}
          sublabel={kpiMetrics.pendingForMe > 0 ? 'اضغط للمراجعة السريعة' : 'لا توجد طلبات معلقة لك'}
          icon="pending_actions"
          tone={kpiMetrics.pendingForMe > 0 ? 'danger' : 'success'}
          onClick={() => inboxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
        <StatCard
          label="تنبيهات التغطية"
          value={kpiMetrics.lowCoverageSlots}
          sublabel={kpiMetrics.lowCoverageSlots > 0 ? 'أيام أقل من الحد الأدنى' : 'التغطية متوازنة'}
          icon={kpiMetrics.lowCoverageSlots > 0 ? 'warning' : 'verified'}
          tone={kpiMetrics.lowCoverageSlots > 0 ? 'warning' : 'success'}
        />
      </div>

      {/* 3. Swap / Move Requests Inbox Card */}
      {(swaps.length > 0 || otherWeekActionableSwaps.length > 0 || effectiveCanSwap) && (
        <div ref={inboxRef} className="scroll-mt-20">
          <Card padding="md" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-xl bg-[var(--g-primary-container)] text-[var(--g-primary)] flex items-center justify-center shrink-0">
                  <span className="ms-icon filled text-xl">swap_horiz</span>
                </span>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-[var(--g-text)] m-0">
                    طلبات تبديل وترحيل الإجازات
                  </h3>
                  <p className="text-[11px] font-semibold text-[var(--g-muted)] m-0">
                    {scheduleData?.settings?.swapRequiresManagerApproval
                      ? 'التبديل يتطلب موافقة الكاشيرين ثم اعتماد الإدارة النهائي'
                      : 'التبديل يتطلب موافقة الكاشيرين معاً ويُطبق تلقائياً فور موافقتهما'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {actionableSwaps.length > 0 && (
                  <Badge tone="danger" dot pulse numeric>
                    {actionableSwaps.length} بانتظار قرارك
                  </Badge>
                )}
                {otherSwaps.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={showPastSwaps ? 'expand_less' : 'expand_more'}
                    onClick={() => setShowPastSwaps((v) => !v)}
                  >
                    {showPastSwaps
                      ? `إخفاء باقي الطلبات (${otherSwaps.length})`
                      : `باقي طلبات الأسبوع (${otherSwaps.length})`}
                  </Button>
                )}
              </div>
            </div>

            {/* Alert if user has pending swap actions in another week */}
            {otherWeekActionableSwaps.length > 0 && (
              <div className="p-3 rounded-2xl bg-[var(--g-yellow-bg)]/60 border border-[var(--g-yellow-border)]/45 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-extrabold text-[var(--g-yellow)]">
                  <span className="ms-icon filled text-lg">notifications_active</span>
                  <span>
                    لديك ({otherWeekActionableSwaps.length}) طلب بانتظار موافقتك في أسبوع آخر
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(new Set(otherWeekActionableSwaps.map((s) => s.week_start_date))).map(
                    (wk) => (
                      <Button
                        key={wk}
                        variant="tonal"
                        size="sm"
                        icon="calendar_month"
                        onClick={() => setWeekStart(wk)}
                      >
                        الانتقال لأسبوع <span className="num-ltr">{wk}</span>
                      </Button>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Actionable Swaps (Awaiting My Action) */}
            {actionableSwaps.length > 0 && (
              <div className="space-y-2.5">
                {actionableSwaps.map((swap) => {
                  const isBusy = busySwapId === swap.id;
                  const isRejecting = rejectingSwapId === swap.id;
                  const isSwap = swap.request_type === 'swap';
                  const fromLabel = getScheduleWeekdayLabel(swap.requester_from_day);
                  const toLabel = getScheduleWeekdayLabel(swap.target_from_day);

                  return (
                    <div
                      key={swap.id}
                      className="p-3.5 sm:p-4 rounded-2xl border-2 border-[var(--g-primary)] bg-[var(--g-primary-container)]/20 space-y-2.5"
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge tone="primary" icon={isSwap ? 'swap_horiz' : 'event_repeat'}>
                              {isSwap ? 'تبديل مع زميل' : 'ترحيل ليوم آخر'}
                            </Badge>
                            {swap.scope === 'permanent' && (
                              <Badge tone="purple" icon="repeat">
                                تغيير دائم
                              </Badge>
                            )}
                            <Badge tone="danger" icon="priority_high">
                              بانتظار إجراء منك
                            </Badge>
                          </div>

                          <div className="text-sm font-black text-[var(--g-text)]">
                            {isSwap
                              ? `${swap.requester_name || 'الكاشير الأول'} (${fromLabel}) ↔ ${swap.target_name || 'الكاشير الثاني'} (${toLabel})`
                              : `${swap.requester_name || 'الموظف'}: ترحيل الإجازة من ${fromLabel} إلى ${toLabel}`}
                          </div>

                          {swap.reason && (
                            <div className="text-xs font-semibold text-[var(--g-muted)]">
                              السبب: {swap.reason}
                            </div>
                          )}

                          <SwapApprovalStepper
                            swap={swap}
                            swapRequiresManagerApproval={
                              scheduleData?.settings?.swapRequiresManagerApproval
                            }
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <Button
                            variant="success"
                            size="md"
                            icon="check_circle"
                            iconFilled
                            loading={isBusy}
                            disabled={isOfflineReadOnly}
                            onClick={() => handleSwapRespondOrDecide(swap, 'approve')}
                          >
                            قبول
                          </Button>
                          <Button
                            variant="dangerTonal"
                            size="md"
                            icon="cancel"
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
                        <div className="pt-2.5 border-t border-[var(--g-border)] flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="اكتب سبب الرفض (اختياري)..."
                            className="g-input flex-1 py-2 text-xs"
                          />
                          <div className="flex items-center gap-2 shrink-0">
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
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setRejectingSwapId('');
                                setRejectReason('');
                              }}
                            >
                              تراجع
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Empty Inbox Message when no swaps exist */}
            {swaps.length === 0 && otherWeekActionableSwaps.length === 0 && (
              <div className="p-3 rounded-2xl bg-[var(--g-surface-variant)]/60 text-xs font-bold text-[var(--g-muted)] flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="ms-icon text-base text-[var(--g-primary)]">inbox</span>
                  <span>لا توجد طلبات تبديل أو ترحيل مسجلة في هذا الأسبوع.</span>
                </span>
                {effectiveCanSwap && myEmployee?.effective_day_of_week && (
                  <Button
                    variant="tonal"
                    size="sm"
                    icon="add"
                    disabled={isOfflineReadOnly}
                    onClick={() => openSwapComposer({ preferredType: 'swap' })}
                  >
                    إنشاء طلب
                  </Button>
                )}
              </div>
            )}

            {/* Other / Historical Swaps in This Week */}
            {otherSwaps.length > 0 && (showPastSwaps || actionableSwaps.length === 0) && (
              <div className="space-y-2 pt-1">
                {otherSwaps.map((swap) => {
                  const statusMeta = SWAP_STATUS_META[swap.status] || SWAP_STATUS_META.pending_peer;
                  const isBusy = busySwapId === swap.id;
                  const isSwap = swap.request_type === 'swap';
                  const fromLabel = getScheduleWeekdayLabel(swap.requester_from_day);
                  const toLabel = getScheduleWeekdayLabel(swap.target_from_day);

                  return (
                    <div
                      key={swap.id}
                      className="p-3 rounded-2xl bg-[var(--g-surface-variant)]/55 border border-[var(--g-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge tone={statusMeta.tone} icon={statusMeta.icon}>
                            {statusMeta.label}
                          </Badge>
                          <Badge tone="neutral">
                            {isSwap ? 'تبديل' : 'ترحيل'}
                          </Badge>
                          {swap.scope === 'permanent' && <Badge tone="purple">دائم</Badge>}
                        </div>

                        <div className="text-xs sm:text-sm font-black text-[var(--g-text)]">
                          {isSwap
                            ? `${swap.requester_name || 'موظف'} (${fromLabel}) ↔ ${swap.target_name || 'زميل'} (${toLabel})`
                            : `${swap.requester_name || 'موظف'}: ${fromLabel} ← ${toLabel}`}
                        </div>

                        {swap.reason && (
                          <div className="text-[11px] font-semibold text-[var(--g-muted)]">
                            السبب: {swap.reason}
                          </div>
                        )}

                        {swap.rejection_reason && (
                          <div className="text-[11px] font-bold text-[var(--g-red)]">
                            ملاحظة: {swap.rejection_reason}
                          </div>
                        )}

                        <SwapApprovalStepper
                          swap={swap}
                          swapRequiresManagerApproval={
                            scheduleData?.settings?.swapRequiresManagerApproval
                          }
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {swap.can_cancel && (
                          <Button
                            variant="dangerTonal"
                            size="sm"
                            icon="close"
                            loading={isBusy}
                            disabled={isOfflineReadOnly}
                            onClick={() => handleCancelSwap(swap)}
                          >
                            إلغاء الطلب
                          </Button>
                        )}
                        {swap.can_revert && effectiveCanManage && (
                          <Button
                            variant="secondary"
                            size="sm"
                            icon="undo"
                            loading={isBusy}
                            disabled={isOfflineReadOnly}
                            onClick={() => handleRevertSwap(swap)}
                          >
                            تراجع عن التبديل
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* 4. Mobile Schedule View (< md): Adaptive Day-First Default + Employee Cards Toggle */}
      <div className="md:hidden space-y-3">
        {/* View Mode Switcher */}
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex p-1 rounded-2xl bg-[var(--g-surface)] border border-[var(--g-border)] gap-1">
            <button
              type="button"
              onClick={() => setMobileMode('day')}
              className={`min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all ${
                mobileMode === 'day'
                  ? 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]'
                  : 'text-[var(--g-muted)]'
              }`}
            >
              <span className="ms-icon text-base">view_day</span>
              <span>عرض باليوم</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileMode('employees')}
              className={`min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all ${
                mobileMode === 'employees'
                  ? 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]'
                  : 'text-[var(--g-muted)]'
              }`}
            >
              <span className="ms-icon text-base">badge</span>
              <span>بطاقات الموظفين</span>
            </button>
          </div>

          {myEmployee?.effective_day_of_week && (
            <Badge tone="primary" icon="event_available">
              إجازتك: {getScheduleWeekdayLabel(myEmployee.effective_day_of_week)}
            </Badge>
          )}
        </div>

        {mobileMode === 'day' ? (
          <div className="space-y-3">
            {/* Compact 7-day selector bar (Sat..Fri, >=44px touch targets) */}
            <div className="grid grid-cols-7 gap-1 bg-[var(--g-surface)] p-1.5 rounded-2xl border border-[var(--g-border)]">
              {SCHEDULE_WEEKDAYS.map((day) => {
                const isSelected = selectedDay === day.code;
                const dayDateKey = weekDates[day.code] || '';
                const isToday = dayDateKey === todayDateKey;
                const isMyOff = myEmployee?.effective_day_of_week === day.code;
                const offTotal = groups.reduce(
                  (sum, g) => sum + (g.coverageByDay?.[day.code]?.offCount || 0),
                  0
                );
                const anyLowCov = groups.some((g) => g.coverageByDay?.[day.code]?.lowCoverage);

                return (
                  <button
                    key={day.code}
                    type="button"
                    onClick={() => setSelectedDay(day.code)}
                    className={`min-h-[64px] px-1 py-1.5 rounded-xl flex flex-col items-center justify-between gap-0.5 text-center transition-all active:scale-95 relative ${
                      isSelected
                        ? 'bg-[var(--g-primary-solid)] text-white shadow-xs'
                        : isMyOff
                        ? 'bg-[var(--g-primary-container)]/60 text-[var(--g-on-primary-container)] border border-[var(--g-primary)]/40'
                        : isToday
                        ? 'bg-[var(--g-secondary-container)]/65 text-[var(--g-on-secondary-container)]'
                        : 'bg-[var(--g-surface-variant)]/60 text-[var(--g-text)]'
                    }`}
                  >
                    <span className="text-[10px] font-black leading-tight truncate max-w-full">
                      {day.shortLabel}
                    </span>
                    <span className="num-ltr text-[10px] font-bold opacity-85">
                      {dayDateKey ? dayDateKey.slice(8) : ''}
                    </span>
                    <span
                      className={`num-ltr text-[10px] min-w-[20px] h-[18px] px-1 rounded-full font-black flex items-center justify-center ${
                        isSelected
                          ? 'bg-white/25 text-white'
                          : anyLowCov
                          ? 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]'
                          : 'bg-[var(--g-surface)] text-[var(--g-text)]'
                      }`}
                    >
                      {offTotal}
                    </span>
                    {(isToday || isMyOff) && (
                      <span
                        className={`text-[8px] font-black leading-none ${
                          isSelected ? 'text-white/95' : 'text-[var(--g-primary)]'
                        }`}
                      >
                        {isMyOff ? 'إجازتك' : 'اليوم'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected Day Header */}
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-black text-[var(--g-text)]">
                  يوم {getScheduleWeekdayLabel(selectedDay)}
                </span>
                <span className="num-ltr text-xs font-bold text-[var(--g-muted)]">
                  ({weekDates[selectedDay] || ''})
                </span>
                {weekDates[selectedDay] === todayDateKey && (
                  <Badge tone="success">اليوم</Badge>
                )}
              </div>

              {effectiveCanSwap && myEmployee && (
                <Button
                  variant="tonal"
                  size="sm"
                  icon="swap_horiz"
                  disabled={isOfflineReadOnly}
                  onClick={() => openSwapComposer({ preferredType: 'swap' })}
                >
                  تبديل / ترحيل
                </Button>
              )}
            </div>

            {/* Group Cards for Selected Day */}
            {groups.length === 0 ? (
              <EmptyState
                icon="groups"
                title="لا توجد مجموعات موظفين ظاهرة"
                description="أضف الموظفين أو تأكد من صلاحيات العرض الخاصة بك."
              />
            ) : (
              groups.map((group) => {
                const style = GROUP_STYLE_BY_TONE[group.tone] || GROUP_STYLE_BY_TONE.primary;
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
                  <Card key={group.id} padding="sm" className={`space-y-2.5 ${style.borderTop}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${style.iconBox}`}
                        >
                          <span className="ms-icon filled text-lg">{group.icon || 'groups'}</span>
                        </span>
                        <div className="min-w-0">
                          <h4 className="text-sm font-black text-[var(--g-text)] m-0 truncate">
                            {group.label}
                          </h4>
                          <div className="text-[11px] font-bold text-[var(--g-muted)]">
                            <span className="num-ltr">{cov.offCount}</span> إجازة •{' '}
                            <span className="num-ltr">{cov.onDutyCount}</span> متواجد
                          </div>
                        </div>
                      </div>

                      {cov.lowCoverage ? (
                        <Badge tone="warning" icon="warning">
                          تغطية منخفضة (أدنى <span className="num-ltr">{cov.minRequired}</span>)
                        </Badge>
                      ) : (
                        <Badge tone={style.badgeTone} numeric>
                          {cov.onDutyCount}/{cov.totalCount} دوام
                        </Badge>
                      )}
                    </div>

                    {offEmps.length === 0 ? (
                      <div className="p-2.5 rounded-xl bg-[var(--g-surface-variant)]/55 text-xs font-bold text-[var(--g-muted)] text-center">
                        الجميع متواجد في العمل هذا اليوم
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {offEmps.map((emp) => {
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
                              className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${
                                isMe
                                  ? 'bg-[var(--g-primary-container)]/30 border-[var(--g-primary)]/45'
                                  : 'bg-[var(--g-surface-variant)]/50 border-[var(--g-border)]'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  style={{ backgroundColor: emp.avatar_color || '#0B57D0' }}
                                  className="w-8 h-8 rounded-xl text-white text-xs font-black flex items-center justify-center shrink-0"
                                >
                                  {getInitials(emp.name)}
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-black text-[var(--g-text)] truncate">
                                      {emp.name}
                                    </span>
                                    {isMe && <Badge tone="primary">أنت</Badge>}
                                    {emp.is_override && <Badge tone="orange">تعديل أسبوعي</Badge>}
                                  </div>
                                  <div className="text-[10px] font-semibold text-[var(--g-muted)] truncate">
                                    {emp.department}
                                    {emp.role_title ? ` • ${emp.role_title}` : ''}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {canSwapThis && (
                                  <Button
                                    variant="tonal"
                                    size="sm"
                                    icon="swap_horiz"
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
                                    variant="secondary"
                                    size="sm"
                                    icon="edit"
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
                        })}
                      </div>
                    )}

                    {/* Unassigned Employees quick-assign strip for Admin */}
                    {effectiveCanManage && unassignedEmps.length > 0 && (
                      <div className="pt-2 border-t border-[var(--g-border)] space-y-1.5">
                        <div className="text-[11px] font-extrabold text-[var(--g-muted)]">
                          موظفون بدون يوم إجازة محدد ({unassignedEmps.length}):
                        </div>
                        <div className="flex flex-wrap gap-1.5">
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
                              className="min-h-[34px] px-2.5 py-1 rounded-xl bg-[var(--g-surface)] border border-dashed border-[var(--g-primary)]/50 text-[11px] font-extrabold text-[var(--g-primary)] flex items-center gap-1"
                            >
                              <span className="ms-icon text-sm">add</span>
                              <span>{emp.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        ) : (
          /* Mobile Employee Cards View */
          <div className="space-y-3">
            {groups.length > 1 && (
              <FilterChipRail
                activeId={mobileGroupFilter}
                onSelect={setMobileGroupFilter}
                items={[
                  {
                    id: 'all',
                    label: 'كل الفرق',
                    icon: 'groups',
                    count: allVisibleEmployees.length,
                  },
                  ...groups.map((g) => ({
                    id: g.id,
                    label: g.shortLabel || g.label,
                    icon: g.icon,
                    count: (g.employees || []).length,
                  })),
                ]}
              />
            )}

            {filteredMobileGroups.map((group) => {
              const style = GROUP_STYLE_BY_TONE[group.tone] || GROUP_STYLE_BY_TONE.primary;
              return (
                <div key={group.id} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-black text-[var(--g-muted)] flex items-center gap-1.5">
                      <span className="ms-icon text-base">{group.icon}</span>
                      <span>{group.label}</span>
                    </span>
                    <span className="num-ltr text-[11px] font-bold text-[var(--g-muted)]">
                      {(group.employees || []).length} موظف
                    </span>
                  </div>

                  {(group.employees || []).length === 0 ? (
                    <Card padding="sm" className="text-center text-xs font-bold text-[var(--g-muted)]">
                      لا يوجد موظفون في هذا الفريق حالياً
                    </Card>
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
                        <Card
                          key={emp.id}
                          padding="sm"
                          className={`flex items-center justify-between gap-2.5 ${
                            isMe ? 'ring-2 ring-[var(--g-primary)]/45' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              style={{ backgroundColor: emp.avatar_color || '#0B57D0' }}
                              className="w-10 h-10 rounded-xl text-white text-xs font-black flex items-center justify-center shrink-0"
                            >
                              {getInitials(emp.name)}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm font-black text-[var(--g-text)] truncate">
                                  {emp.name}
                                </span>
                                {isMe && <Badge tone="primary">أنت</Badge>}
                                {emp.is_override && <Badge tone="orange">تعديل</Badge>}
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold inline-flex items-center gap-1 ${
                                    emp.effective_day_of_week
                                      ? style.offPill
                                      : 'bg-[var(--g-surface-variant)] text-[var(--g-muted)]'
                                  }`}
                                >
                                  <span className="ms-icon text-xs">event_available</span>
                                  <span>{offLabel}</span>
                                  {offDateShort && (
                                    <span className="num-ltr opacity-80">({offDateShort})</span>
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {canSwapThis && (
                              <Button
                                variant="tonal"
                                size="sm"
                                icon="swap_horiz"
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
                                variant="secondary"
                                size="sm"
                                icon="edit"
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
                        </Card>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Desktop Schedule Tables (md+): 3 Separate Color-Coded Team Group Sections */}
      <div className="hidden md:block space-y-5">
        {groups.length === 0 ? (
          <EmptyState
            icon="calendar_month"
            title="لا توجد فرق مسجلة في جدول الإجازات"
            description="أضف الموظفين أولاً أو تحقق من الصلاحيات."
          />
        ) : (
          groups.map((group) => {
            const style = GROUP_STYLE_BY_TONE[group.tone] || GROUP_STYLE_BY_TONE.primary;
            const emps = group.employees || [];
            const minRequired =
              group.coverageByDay?.sat?.minRequired ??
              scheduleData?.settings?.minOnDuty?.[group.id] ??
              0;

            return (
              <Card key={group.id} padding="none" className={`overflow-hidden ${style.borderTop}`}>
                {/* Group Header */}
                <div className="p-4 flex items-center justify-between gap-3 border-b border-[var(--g-border)] bg-[var(--g-surface-tint)]">
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${style.iconBox}`}
                    >
                      <span className="ms-icon filled text-xl">{group.icon || 'groups'}</span>
                    </span>
                    <div>
                      <h3 className="text-base font-black text-[var(--g-text)] m-0">
                        {group.label}
                      </h3>
                      <div className="text-xs font-bold text-[var(--g-muted)]">
                        إجمالي الفريق: <span className="num-ltr">{emps.length}</span> موظف • الحد
                        الأدنى للمتواجدين يومياً: <span className="num-ltr">{minRequired}</span>
                      </div>
                    </div>
                  </div>

                  {effectiveCanSwap && myEmployee?.team_group === group.id && (
                    <Button
                      variant="tonal"
                      size="sm"
                      icon="swap_horiz"
                      disabled={isOfflineReadOnly}
                      onClick={() => openSwapComposer({ preferredType: 'swap' })}
                    >
                      طلب تبديل / ترحيل إجازتي
                    </Button>
                  )}
                </div>

                {emps.length === 0 ? (
                  <div className="p-6 text-center text-sm font-bold text-[var(--g-muted)]">
                    لا يوجد موظفون في فريق ({group.label}) حالياً.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-right">
                      <thead>
                        <tr className="bg-[var(--g-surface-variant)]/65 border-b border-[var(--g-border)]">
                          <th className="p-3 text-xs font-black text-[var(--g-text)] min-w-[210px]">
                            الموظف
                          </th>
                          {SCHEDULE_WEEKDAYS.map((day) => {
                            const dKey = weekDates[day.code] || '';
                            const isToday = dKey === todayDateKey;
                            return (
                              <th
                                key={day.code}
                                className={`p-2.5 text-center min-w-[96px] border-r border-[var(--g-border)]/70 ${
                                  isToday ? 'bg-[var(--g-primary-container)]/40' : ''
                                }`}
                              >
                                <div className="text-xs font-black text-[var(--g-text)] flex items-center justify-center gap-1">
                                  <span>{day.label}</span>
                                  {isToday && (
                                    <span className="text-[10px] px-1.5 py-0.25 rounded-full bg-[var(--g-primary-solid)] text-white">
                                      اليوم
                                    </span>
                                  )}
                                </div>
                                <div className="num-ltr text-[11px] font-bold text-[var(--g-muted)] mt-0.5">
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
                              className={`border-b border-[var(--g-border)]/70 transition-colors ${
                                isMe
                                  ? 'bg-[var(--g-primary-container)]/18'
                                  : 'hover:bg-[var(--g-surface-variant)]/35'
                              }`}
                            >
                              {/* Employee Info + Admin Group Selector / Cashier Swap Trigger */}
                              <td className="p-3 align-middle">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <span
                                      style={{ backgroundColor: emp.avatar_color || '#0B57D0' }}
                                      className="w-9 h-9 rounded-xl text-white text-xs font-black flex items-center justify-center shrink-0"
                                    >
                                      {getInitials(emp.name)}
                                    </span>
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-sm font-black text-[var(--g-text)] truncate">
                                          {emp.name}
                                        </span>
                                        {isMe && <Badge tone="primary">أنت</Badge>}
                                        {emp.is_override && (
                                          <Badge tone="orange">تعديل أسبوعي</Badge>
                                        )}
                                      </div>
                                      <div className="text-[11px] font-semibold text-[var(--g-muted)] truncate">
                                        {emp.department}
                                        {emp.role_title ? ` • ${emp.role_title}` : ''}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {canSwapRow && (
                                      <Button
                                        variant="tonal"
                                        size="sm"
                                        icon="swap_horiz"
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
                                        className="bg-[var(--g-surface-variant)] border border-[var(--g-border)] rounded-xl px-2 py-1 text-[11px] font-extrabold text-[var(--g-text)] outline-none focus:border-[var(--g-primary)]"
                                      >
                                        {SCHEDULE_TEAM_GROUPS.map((tg) => (
                                          <option key={tg.id} value={tg.id}>
                                            {tg.label}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {/* 7 Day Cells (Sat..Fri) */}
                              {SCHEDULE_WEEKDAYS.map((day) => {
                                const isOff = emp.effective_day_of_week === day.code;
                                const isToday = weekDates[day.code] === todayDateKey;

                                return (
                                  <td
                                    key={day.code}
                                    className={`p-2 text-center align-middle border-r border-[var(--g-border)]/70 ${
                                      isToday ? 'bg-[var(--g-primary-container)]/18' : ''
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
                                        title={
                                          isOff
                                            ? `تعديل إجازة ${emp.name}`
                                            : `تعيين ${day.label} إجازة لـ ${emp.name}`
                                        }
                                        className={`w-full min-h-[40px] px-2 py-1.5 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 disabled:opacity-50 ${
                                          isOff
                                            ? `${style.offPill} shadow-2xs`
                                            : 'text-[var(--g-muted)] hover:bg-[var(--g-surface-variant)] hover:text-[var(--g-text)] border border-transparent hover:border-[var(--g-border)]'
                                        }`}
                                      >
                                        {isOff ? (
                                          <>
                                            <span className="ms-icon filled text-sm">
                                              event_available
                                            </span>
                                            <span>إجازة</span>
                                          </>
                                        ) : (
                                          <span>—</span>
                                        )}
                                      </button>
                                    ) : isOff ? (
                                      <span
                                        className={`w-full min-h-[38px] px-2 py-1.5 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-1 ${style.offPill}`}
                                      >
                                        <span className="ms-icon filled text-sm">
                                          event_available
                                        </span>
                                        <span>إجازة</span>
                                      </span>
                                    ) : (
                                      <span className="text-xs font-semibold text-[var(--g-muted)]">
                                        دوام
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                      {/* Coverage Summary Footer Row */}
                      <tfoot>
                        <tr className="bg-[var(--g-surface-variant)]/55">
                          <td className="p-3 text-xs font-black text-[var(--g-text)]">
                            ملخص التغطية اليومية
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
                                className={`p-2 text-center border-r border-[var(--g-border)]/70 ${
                                  cov.lowCoverage ? 'bg-[var(--g-yellow-bg)]/55' : ''
                                }`}
                              >
                                <div className="text-[11px] font-black text-[var(--g-text)] num-ltr">
                                  {cov.offCount} إجازة • {cov.onDutyCount} دوام
                                </div>
                                {cov.lowCoverage && (
                                  <div className="mt-1">
                                    <Badge tone="warning" icon="warning">
                                      تغطية منخفضة
                                    </Badge>
                                  </div>
                                )}
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

      {/* 6. Admin Settings BottomSheet (NO peak-day locking UI) */}
      <BottomSheet
        open={settingsOpen}
        onClose={() => !busyAction && setSettingsOpen(false)}
        title="إعدادات جدول الإجازات"
        subtitle="التحكم في قواعد اعتماد التبديلات والحد الأدنى للتغطية اليومية"
        icon="tune"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleSaveSettings} className="space-y-4">
          <label className="p-3.5 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(settingsForm.swapRequiresManagerApproval)}
              onChange={(e) =>
                setSettingsForm((prev) => ({
                  ...prev,
                  swapRequiresManagerApproval: e.target.checked,
                }))
              }
              className="w-5 h-5 mt-0.5 accent-[var(--g-primary-solid)] shrink-0"
            />
            <div className="space-y-0.5">
              <div className="text-sm font-black text-[var(--g-text)]">
                تفعيل اعتماد المدير النهائي بعد موافقة الكاشيرين
              </div>
              <p className="text-xs font-medium text-[var(--g-muted)] m-0 leading-relaxed">
                عند التفعيل، تمر طلبات التبديل بين الزملاء بموافقة الإدارة بعد موافقة الكاشيرين. عند
                الإيقاف، يتم تطبيق التبديل تلقائياً بمجرد موافقة الكاشيرين (الترحيل ليوم آخر يتطلب
                موافقة الإدارة دائماً).
              </p>
            </div>
          </label>

          <div className="space-y-2.5">
            <div className="text-xs font-black text-[var(--g-muted)]">
              الحد الأدنى للموظفين المتواجدين يومياً (لتنبيهات التغطية المنخفضة):
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {SCHEDULE_TEAM_GROUPS.map((grp) => (
                <div
                  key={grp.id}
                  className="p-3 rounded-2xl bg-[var(--g-surface-variant)]/70 border border-[var(--g-border)] space-y-1.5"
                >
                  <label
                    htmlFor={`min-onduty-${grp.id}`}
                    className="block text-xs font-black text-[var(--g-text)]"
                  >
                    {grp.label}
                  </label>
                  <input
                    id={`min-onduty-${grp.id}`}
                    type="number"
                    min="0"
                    max="99"
                    value={settingsForm.minOnDuty[grp.id] ?? 0}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        minOnDuty: {
                          ...prev.minOnDuty,
                          [grp.id]: Math.max(0, Number(e.target.value) || 0),
                        },
                      }))
                    }
                    className="g-input num-ltr text-center font-black py-2"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={busyAction}
              disabled={isOfflineReadOnly}
              icon="save"
            >
              حفظ الإعدادات
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busyAction}
              onClick={() => setSettingsOpen(false)}
            >
              إلغاء
            </Button>
          </div>
        </form>
      </BottomSheet>

      {/* 7. Admin Bulk Action Confirmation BottomSheet */}
      <BottomSheet
        open={Boolean(confirmBulkAction)}
        onClose={() => !busyAction && setConfirmBulkAction(null)}
        title={
          confirmBulkAction === 'copy_previous_week'
            ? 'نسخ جدول الأسبوع السابق'
            : 'إعادة تعيين للجدول الثابت'
        }
        subtitle={`الأسبوع المستهدف: ${resolvedWeekStart}`}
        icon={confirmBulkAction === 'copy_previous_week' ? 'content_copy' : 'restart_alt'}
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-xs sm:text-sm font-semibold text-[var(--g-muted)] m-0 leading-relaxed">
            {confirmBulkAction === 'copy_previous_week'
              ? 'سيتم نسخ أيام الإجازة المعتمدة في الأسبوع السابق وتطبيقها على هذا الأسبوع كإجازات أسبوعية.'
              : 'سيتم حذف جميع التعديلات الاستثنائية لهذا الأسبوع والعودة للجدول الثابت المتكرر لكل موظف، وإلغاء الطلبات المعلقة في هذا الأسبوع.'}
          </p>

          <div className="flex items-center gap-2">
            <Button
              variant={confirmBulkAction === 'reset_to_defaults' ? 'danger' : 'primary'}
              fullWidth
              loading={busyAction}
              icon="check_circle"
              onClick={handleBulkActionConfirm}
            >
              تأكيد التنفيذ
            </Button>
            <Button
              variant="secondary"
              disabled={busyAction}
              onClick={() => setConfirmBulkAction(null)}
            >
              إلغاء
            </Button>
          </div>
        </div>
      </BottomSheet>

      {/* 8. Admin Quick-Edit Employee Day & Group BottomSheet */}
      <BottomSheet
        open={Boolean(editingEmployee)}
        onClose={() => !busyAction && setEditingEmployee(null)}
        title={editingEmployee ? `تعديل إجازة: ${editingEmployee.emp.name}` : ''}
        subtitle={editingEmployee?.emp?.department || ''}
        icon="edit_calendar"
        maxWidth="max-w-md"
      >
        {editingEmployee && (
          <div className="space-y-4">
            {/* Scope Toggle */}
            <div className="space-y-1.5">
              <div className="text-xs font-black text-[var(--g-muted)]">نطاق التعديل:</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditingEmployee((s) => ({ ...s, scope: 'week' }))}
                  className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-extrabold border transition-all ${
                    editingEmployee.scope === 'week'
                      ? 'bg-[var(--g-primary-solid)] text-white border-transparent'
                      : 'bg-[var(--g-surface-variant)] text-[var(--g-text)] border-[var(--g-border)]'
                  }`}
                >
                  لهذا الأسبوع فقط
                </button>
                <button
                  type="button"
                  onClick={() => setEditingEmployee((s) => ({ ...s, scope: 'default' }))}
                  className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-extrabold border transition-all ${
                    editingEmployee.scope === 'default'
                      ? 'bg-[var(--g-purple)] text-white border-transparent'
                      : 'bg-[var(--g-surface-variant)] text-[var(--g-text)] border-[var(--g-border)]'
                  }`}
                >
                  الجدول الثابت المتكرر
                </button>
              </div>
            </div>

            {/* Team Group Picker */}
            <div className="space-y-1.5">
              <div className="text-xs font-black text-[var(--g-muted)]">الفريق / المجموعة:</div>
              <div className="grid grid-cols-3 gap-1.5">
                {SCHEDULE_TEAM_GROUPS.map((tg) => (
                  <button
                    key={tg.id}
                    type="button"
                    onClick={() => setEditingEmployee((s) => ({ ...s, teamGroup: tg.id }))}
                    className={`min-h-[44px] px-2 py-2 rounded-xl text-[11px] font-extrabold border flex flex-col items-center justify-center gap-1 transition-all ${
                      editingEmployee.teamGroup === tg.id
                        ? 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] border-[var(--g-primary)]'
                        : 'bg-[var(--g-surface-variant)] text-[var(--g-text)] border-[var(--g-border)]'
                    }`}
                  >
                    <span className="ms-icon text-base">{tg.icon}</span>
                    <span>{tg.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Day-of-Week Picker */}
            <div className="space-y-1.5">
              <div className="text-xs font-black text-[var(--g-muted)]">يوم الإجازة:</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {SCHEDULE_WEEKDAYS.map((day) => {
                  const active = editingEmployee.dayOfWeek === day.code;
                  return (
                    <button
                      key={day.code}
                      type="button"
                      onClick={() => setEditingEmployee((s) => ({ ...s, dayOfWeek: day.code }))}
                      className={`min-h-[44px] px-2.5 py-2 rounded-xl text-xs font-extrabold border transition-all ${
                        active
                          ? 'bg-[var(--g-primary-solid)] text-white border-transparent'
                          : 'bg-[var(--g-surface-variant)] text-[var(--g-text)] border-[var(--g-border)]'
                      }`}
                    >
                      <div>{day.label}</div>
                      <div className="num-ltr text-[10px] opacity-80">
                        {formatShortDate(weekDates[day.code])}
                      </div>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setEditingEmployee((s) => ({ ...s, dayOfWeek: '' }))}
                  className={`min-h-[44px] px-2.5 py-2 rounded-xl text-xs font-extrabold border transition-all ${
                    editingEmployee.dayOfWeek === ''
                      ? 'bg-[var(--g-red-bg)] text-[var(--g-red)] border-[var(--g-red-border)]'
                      : 'bg-[var(--g-surface-variant)] text-[var(--g-muted)] border-[var(--g-border)]'
                  }`}
                >
                  {editingEmployee.scope === 'week'
                    ? 'إلغاء تعديل الأسبوع'
                    : 'إزالة الإجازة الثابتة'}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="primary"
                fullWidth
                loading={busyAction}
                icon="save"
                onClick={() =>
                  handleAssignDayOff(
                    editingEmployee.emp,
                    editingEmployee.dayOfWeek || null,
                    editingEmployee.teamGroup,
                    editingEmployee.scope
                  )
                }
              >
                حفظ التعديل
              </Button>
              <Button
                variant="secondary"
                disabled={busyAction}
                onClick={() => setEditingEmployee(null)}
              >
                إلغاء
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* 9. Swap / Move Composer BottomSheet */}
      <BottomSheet
        open={Boolean(swapComposer)}
        onClose={() => !busyAction && setSwapComposer(null)}
        title="طلب تبديل أو ترحيل إجازة"
        subtitle={
          composerContext?.reqEmp
            ? `${composerContext.reqEmp.name} • إجازتك الحالية: ${
                composerContext.reqDay
                  ? `${getScheduleWeekdayLabel(composerContext.reqDay)} (${formatShortDate(
                      weekDates[composerContext.reqDay]
                    )})`
                  : 'غير محددة'
              }`
            : ''
        }
        icon="swap_horiz"
        maxWidth="max-w-lg"
      >
        {swapComposer && composerContext && (
          <form onSubmit={handleSubmitSwapComposer} className="space-y-4">
            {/* Manager optional requester switcher */}
            {effectiveCanManage && allVisibleEmployees.length > 1 && (
              <div className="space-y-1">
                <label className="block text-xs font-black text-[var(--g-muted)]">
                  الموظف مقدم الطلب:
                </label>
                <select
                  value={swapComposer.requesterId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    openSwapComposer({
                      requesterIdOverride: nextId,
                      preferredType: swapComposer.requestType,
                    });
                  }}
                  className="g-input text-xs font-extrabold py-2"
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
              <div className="p-3.5 rounded-2xl bg-[var(--g-yellow-bg)] text-[var(--g-yellow)] text-xs font-extrabold flex items-center gap-2">
                <span className="ms-icon filled text-lg">info</span>
                <span>
                  لم يتم تحديد يوم إجازة حالي في هذا الأسبوع — تواصل مع الإدارة لتحديد يوم الإجازة
                  أولاً.
                </span>
              </div>
            ) : (
              <>
                {composerContext.isReqPast && (
                  <div className="p-3 rounded-2xl bg-[var(--g-red-bg)] text-[var(--g-red)] text-xs font-extrabold flex items-center gap-2">
                    <span className="ms-icon filled text-lg">event_busy</span>
                    <span>يوم إجازتك الحالي في هذا الأسبوع قد مضى — لا يمكن تبديله.</span>
                  </div>
                )}

                {/* Request Type Segmented Selector */}
                <div className="space-y-1.5">
                  <div className="text-xs font-black text-[var(--g-muted)]">نوع الطلب:</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSwapComposer((prev) => ({ ...prev, requestType: 'swap' }))
                      }
                      className={`min-h-[46px] px-3 py-2 rounded-2xl text-xs font-extrabold border flex items-center justify-center gap-1.5 transition-all ${
                        swapComposer.requestType === 'swap'
                          ? 'bg-[var(--g-primary-solid)] text-white border-transparent shadow-2xs'
                          : 'bg-[var(--g-surface-variant)] text-[var(--g-text)] border-[var(--g-border)]'
                      }`}
                    >
                      <span className="ms-icon text-base">swap_horiz</span>
                      <span>تبديل مع زميل</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSwapComposer((prev) => ({ ...prev, requestType: 'move' }))
                      }
                      className={`min-h-[46px] px-3 py-2 rounded-2xl text-xs font-extrabold border flex items-center justify-center gap-1.5 transition-all ${
                        swapComposer.requestType === 'move'
                          ? 'bg-[var(--g-primary-solid)] text-white border-transparent shadow-2xs'
                          : 'bg-[var(--g-surface-variant)] text-[var(--g-text)] border-[var(--g-border)]'
                      }`}
                    >
                      <span className="ms-icon text-base">event_repeat</span>
                      <span>ترحيل ليوم آخر (بموافقة المدير)</span>
                    </button>
                  </div>
                </div>

                {/* Scope Selector */}
                <div className="space-y-1.5">
                  <div className="text-xs font-black text-[var(--g-muted)]">نطاق التغيير:</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSwapComposer((prev) => ({ ...prev, scope: 'week' }))}
                      className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-extrabold border transition-all ${
                        swapComposer.scope === 'week'
                          ? 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] border-[var(--g-primary)]'
                          : 'bg-[var(--g-surface-variant)] text-[var(--g-text)] border-[var(--g-border)]'
                      }`}
                    >
                      لهذا الأسبوع فقط
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSwapComposer((prev) => ({ ...prev, scope: 'permanent' }))
                      }
                      className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-extrabold border transition-all ${
                        swapComposer.scope === 'permanent'
                          ? 'bg-[var(--g-purple-bg)] text-[var(--g-purple)] border-[var(--g-purple-border)]'
                          : 'bg-[var(--g-surface-variant)] text-[var(--g-text)] border-[var(--g-border)]'
                      }`}
                    >
                      تغيير دائم في الجدول الثابت
                    </button>
                  </div>
                </div>

                {/* Colleague Picker OR Target Day Picker */}
                {swapComposer.requestType === 'swap' ? (
                  <div className="space-y-1.5">
                    <div className="text-xs font-black text-[var(--g-muted)]">
                      اختر الزميل للتبديل معه (من نفس الفريق):
                    </div>
                    {composerContext.sameGroupColleagues.length === 0 ? (
                      <div className="p-3 rounded-xl bg-[var(--g-surface-variant)] text-xs font-bold text-[var(--g-muted)]">
                        لا يوجد زملاء متاحون في نفس الفريق للتبديل معهم.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
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
                                setSwapComposer((prev) => ({ ...prev, targetEmployeeId: col.id }))
                              }
                              className={`w-full min-h-[48px] p-2.5 rounded-2xl border text-right flex items-center justify-between gap-2 transition-all disabled:opacity-45 disabled:cursor-not-allowed ${
                                isPicked
                                  ? 'bg-[var(--g-primary-container)]/50 border-[var(--g-primary)] ring-1 ring-[var(--g-primary)]'
                                  : 'bg-[var(--g-surface-variant)]/65 border-[var(--g-border)] hover:border-[var(--g-primary)]'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  style={{ backgroundColor: col.avatar_color || '#0B57D0' }}
                                  className="w-8 h-8 rounded-xl text-white text-xs font-black flex items-center justify-center shrink-0"
                                >
                                  {getInitials(col.name)}
                                </span>
                                <div className="min-w-0">
                                  <div className="text-xs font-black text-[var(--g-text)] truncate">
                                    {col.name}
                                  </div>
                                  <div className="text-[10px] font-semibold text-[var(--g-muted)]">
                                    {col.department}
                                  </div>
                                </div>
                              </div>

                              <div className="shrink-0 text-left">
                                {colDay ? (
                                  <Badge
                                    tone={sameDay || isPast ? 'neutral' : 'primary'}
                                    numeric
                                  >
                                    {getScheduleWeekdayLabel(colDay)} (
                                    {formatShortDate(weekDates[colDay])})
                                    {isPast ? ' • ماضي' : sameDay ? ' • نفس اليوم' : ''}
                                  </Badge>
                                ) : (
                                  <Badge tone="neutral">غير محدد</Badge>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="text-xs font-black text-[var(--g-muted)]">
                      اختر يوم الإجازة المطلوب الترحيل إليه:
                    </div>
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
                              className={`min-h-[46px] px-3 py-2 rounded-xl text-xs font-extrabold border transition-all disabled:opacity-45 disabled:cursor-not-allowed ${
                                isPicked
                                  ? 'bg-[var(--g-primary-solid)] text-white border-transparent'
                                  : 'bg-[var(--g-surface-variant)] text-[var(--g-text)] border-[var(--g-border)]'
                              }`}
                            >
                              <div>{day.label}</div>
                              <div className="num-ltr text-[10px] opacity-85">
                                {formatShortDate(weekDates[day.code])}
                                {isPast ? ' (ماضي)' : ''}
                              </div>
                            </button>
                          );
                        }
                      )}
                    </div>
                  </div>
                )}

                {/* Live Coverage Preview */}
                {composerContext.preview && (
                  <div
                    className={`p-3 rounded-2xl border space-y-1.5 ${
                      composerContext.preview.toLowAfter
                        ? 'bg-[var(--g-yellow-bg)]/55 border-[var(--g-yellow-border)]/50'
                        : 'bg-[var(--g-surface-variant)]/70 border-[var(--g-border)]'
                    }`}
                  >
                    <div className="text-xs font-black text-[var(--g-text)] flex items-center gap-1.5">
                      <span className="ms-icon text-base text-[var(--g-primary)]">analytics</span>
                      <span>معاينة التغطية بعد التنفيذ:</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
                      <div className="p-2 rounded-xl bg-[var(--g-surface)] border border-[var(--g-border)]">
                        <div className="text-[var(--g-muted)]">
                          يوم {composerContext.preview.fromLabel}:
                        </div>
                        <div className="num-ltr font-black text-[var(--g-text)] mt-0.5">
                          متواجد: {composerContext.preview.fromOnDutyBefore} ←{' '}
                          {composerContext.preview.fromOnDutyAfter}
                        </div>
                      </div>
                      <div className="p-2 rounded-xl bg-[var(--g-surface)] border border-[var(--g-border)]">
                        <div className="text-[var(--g-muted)]">
                          يوم {composerContext.preview.toLabel}:
                        </div>
                        <div className="num-ltr font-black text-[var(--g-text)] mt-0.5">
                          متواجد: {composerContext.preview.toOnDutyBefore} ←{' '}
                          {composerContext.preview.toOnDutyAfter}
                        </div>
                      </div>
                    </div>
                    {composerContext.preview.mode === 'swap' ? (
                      <div className="text-[11px] font-bold text-[var(--g-green)]">
                        التبديل مع زميل يحافظ على توازن عدد المتواجدين في كلا اليومين.
                      </div>
                    ) : composerContext.preview.toLowAfter ? (
                      <div className="text-[11px] font-extrabold text-[var(--g-yellow)] flex items-center gap-1">
                        <span className="ms-icon text-sm">warning</span>
                        <span>
                          تنبيه: سيصبح عدد المتواجدين يوم {composerContext.preview.toLabel} أقل من
                          الحد الأدنى (
                          <span className="num-ltr">{composerContext.preview.minRequired}</span>)
                          وسيظهر التنبيه للإدارة عند المراجعة.
                        </span>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Reason Input */}
                <div className="space-y-1">
                  <label className="block text-xs font-black text-[var(--g-muted)]">
                    سبب الطلب (اختياري):
                  </label>
                  <input
                    type="text"
                    maxLength={220}
                    value={swapComposer.reason}
                    onChange={(e) =>
                      setSwapComposer((prev) => ({ ...prev, reason: e.target.value }))
                    }
                    placeholder="مثال: ظرف عائلي أو تبديل وردية..."
                    className="g-input text-xs sm:text-sm"
                  />
                </div>

                {/* Clear Explanation */}
                <div className="p-3 rounded-2xl bg-[var(--g-primary-container)]/30 text-[11px] font-bold text-[var(--g-on-primary-container)] flex items-start gap-2 leading-relaxed">
                  <span className="ms-icon filled text-base shrink-0 mt-0.5">info</span>
                  <span>
                    {swapComposer.requestType === 'swap'
                      ? scheduleData?.settings?.swapRequiresManagerApproval
                        ? 'يتطلب هذا التبديل موافقة الزميل المختار معك أولاً، ثم اعتماد الإدارة النهائي قبل تطبيقه في الجدول.'
                        : 'يتطلب هذا التبديل موافقتك وموافقة الزميل المختار معاً، وسيُطبق في الجدول فور موافقة الطرفين.'
                      : 'ترحيل الإجازة ليوم آخر بدون تبديل مع زميل يتطلب مراجعة واعتماد الإدارة.'}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="submit"
                    variant="primary"
                    fullWidth
                    loading={busyAction}
                    disabled={!composerContext.canSubmit || isOfflineReadOnly}
                    icon="send"
                  >
                    إرسال الطلب الآن
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busyAction}
                    onClick={() => setSwapComposer(null)}
                  >
                    إلغاء
                  </Button>
                </div>
              </>
            )}
          </form>
        )}
      </BottomSheet>
    </div>
  );
}
