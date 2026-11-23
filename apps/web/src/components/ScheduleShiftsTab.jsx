import React, { useEffect, useMemo, useState } from 'react';
import {
  getCairoDateKey,
  getSaturdayWeekStart,
  getScheduleWeekdayLabel,
  SCHEDULE_TEAM_GROUPS,
  SCHEDULE_WEEKDAYS,
} from '@zayed-mart/shared';
import {
  computeShiftDurationHoursClient,
  formatShiftDurationArabicClient,
} from '../lib/api.js';
import { formatTimeArabic } from '../lib/exportUtils.js';
import {
  Button,
  CockpitMetricStrip,
  EmptyState,
  FilterChipRail,
  GroupedList,
  Icon,
  RoleAvatar,
  SearchFilterBar,
  StatusDot,
  WeekDayStrip,
} from './ui/index.js';

const SHIFT_PERIOD_SECTIONS = [
  { id: 'morning', title: 'الصباحي', chipLabel: 'صباحي' },
  { id: 'evening', title: 'المسائي', chipLabel: 'مسائي' },
  { id: 'night', title: 'الليلي', chipLabel: 'ليلي' },
];

function formatShortDate(dateKey) {
  if (!dateKey || typeof dateKey !== 'string') return '';
  const parts = dateKey.split('-');
  if (parts.length !== 3) return dateKey;
  return `${parts[2]}/${parts[1]}`;
}

function parseTimeToMinutes(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function classifyShiftPeriodClient(shiftStart = '08:00') {
  const mins = parseTimeToMinutes(shiftStart);
  if (mins === null) return 'morning';
  const hour = Math.floor(mins / 60);
  if (hour >= 5 && hour < 13) return 'morning';
  if (hour >= 13 && hour < 19) return 'evening';
  return 'night';
}

function doShiftsOverlapClient(startA, endA, startB, endB) {
  const sA = parseTimeToMinutes(startA);
  let eA = parseTimeToMinutes(endA);
  const sB = parseTimeToMinutes(startB);
  let eB = parseTimeToMinutes(endB);
  if (sA === null || eA === null || sB === null || eB === null) return true;
  if (eA <= sA) eA += 1440;
  if (eB <= sB) eB += 1440;
  for (const offset of [-1440, 0, 1440]) {
    if (Math.max(sA + offset, sB) < Math.min(eA + offset, eB)) {
      return true;
    }
  }
  return false;
}

function deriveFallbackRoster(scheduleData) {
  const groups = Array.isArray(scheduleData?.groups) ? scheduleData.groups : [];
  const myEmployeeId = scheduleData?.myEmployeeId || '';
  const todayWeekday = scheduleData?.todayWeekday || '';
  const flat = groups.flatMap((g) =>
    (g.employees || []).map((emp) => ({
      ...emp,
      team_group: emp.team_group || g.id,
      team_group_label: g.label || g.shortLabel || '',
    }))
  );
  const myEmp = myEmployeeId ? flat.find((e) => e.id === myEmployeeId) || null : null;

  return flat.map((emp) => {
    const shiftStart = emp.shift_start || '08:00';
    const shiftEnd = emp.shift_end || '20:00';
    const shiftDurationHours = computeShiftDurationHoursClient(shiftStart, shiftEnd);
    const shiftDurationLabel = formatShiftDurationArabicClient(shiftDurationHours);
    const isMe = Boolean(myEmployeeId && emp.id === myEmployeeId);
    const overlapsMyShift = myEmp
      ? doShiftsOverlapClient(
          shiftStart,
          shiftEnd,
          myEmp.shift_start || '08:00',
          myEmp.shift_end || '20:00'
        )
      : false;

    return {
      id: emp.id,
      name: emp.name || '',
      department: emp.department || '',
      role_title: emp.role_title || '',
      avatar_color: emp.avatar_color || 'var(--g-primary-solid)',
      team_group: emp.team_group || 'hall',
      team_group_label:
        emp.team_group_label ||
        SCHEDULE_TEAM_GROUPS.find((tg) => tg.id === emp.team_group)?.label ||
        '',
      shift_start: shiftStart,
      shift_end: shiftEnd,
      shiftDurationHours,
      shiftDurationLabel,
      shiftPeriod: classifyShiftPeriodClient(shiftStart),
      effective_day_of_week: emp.effective_day_of_week || null,
      default_day_of_week: emp.default_day_of_week || null,
      is_override: Boolean(emp.is_override),
      currentStatus: 'absent',
      isScheduledOffToday: Boolean(todayWeekday && emp.effective_day_of_week === todayWeekday),
      workedOnDayOff: false,
      overlapsMyShift,
      isMe,
    };
  });
}

function normalizeRosterEntry(entry) {
  const shiftStart = entry.shift_start || '08:00';
  const shiftEnd = entry.shift_end || '20:00';
  const shiftDurationHours =
    Number(entry.shiftDurationHours) || computeShiftDurationHoursClient(shiftStart, shiftEnd);
  const shiftDurationLabel =
    entry.shiftDurationLabel || formatShiftDurationArabicClient(shiftDurationHours);
  const period =
    entry.shiftPeriod === 'morning' ||
    entry.shiftPeriod === 'evening' ||
    entry.shiftPeriod === 'night'
      ? entry.shiftPeriod
      : classifyShiftPeriodClient(shiftStart);

  return {
    ...entry,
    shift_start: shiftStart,
    shift_end: shiftEnd,
    shiftDurationHours,
    shiftDurationLabel,
    shiftPeriod: period,
    team_group_label:
      entry.team_group_label ||
      SCHEDULE_TEAM_GROUPS.find((tg) => tg.id === entry.team_group)?.label ||
      '',
    currentStatus: entry.currentStatus || 'absent',
  };
}

function getEmployeeDayState(emp, { isLiveToday, selectedDay }) {
  const isScheduledOffSelected = emp.effective_day_of_week
    ? emp.effective_day_of_week === selectedDay
    : Boolean(isLiveToday && emp.isScheduledOffToday);

  if (!isLiveToday) {
    return {
      isScheduledOffSelected,
      isActuallyOff: isScheduledOffSelected,
      isWorkedDayOff: false,
      statusKey: isScheduledOffSelected ? 'off' : 'scheduled',
      statusLabel: isScheduledOffSelected ? 'إجازة' : 'دوام',
      statusTone: isScheduledOffSelected ? 'neutral' : 'success',
    };
  }

  const liveStatus = emp.currentStatus || 'absent';
  const isWorkedDayOff = Boolean(
    emp.workedOnDayOff || (isScheduledOffSelected && liveStatus !== 'absent')
  );
  const isActuallyOff = isScheduledOffSelected && liveStatus === 'absent' && !isWorkedDayOff;

  if (isActuallyOff) {
    return {
      isScheduledOffSelected,
      isActuallyOff: true,
      isWorkedDayOff: false,
      statusKey: 'off',
      statusLabel: 'إجازة',
      statusTone: 'purple',
    };
  }

  if (liveStatus === 'present') {
    return {
      isScheduledOffSelected,
      isActuallyOff: false,
      isWorkedDayOff,
      statusKey: 'present',
      statusLabel: 'حاضر',
      statusTone: 'success',
    };
  }

  if (liveStatus === 'on_break') {
    return {
      isScheduledOffSelected,
      isActuallyOff: false,
      isWorkedDayOff,
      statusKey: 'on_break',
      statusLabel: 'بريك',
      statusTone: 'warning',
    };
  }

  if (liveStatus === 'checked_out') {
    return {
      isScheduledOffSelected,
      isActuallyOff: false,
      isWorkedDayOff,
      statusKey: 'checked_out',
      statusLabel: 'منصرف',
      statusTone: 'primary',
    };
  }

  return {
    isScheduledOffSelected,
    isActuallyOff: false,
    isWorkedDayOff: false,
    statusKey: 'absent',
    statusLabel: 'لم يحضر',
    statusTone: 'danger',
  };
}

function resolveCctvState(emp) {
  if (emp.latestCctvStatus && emp.latestCctvStatus !== 'none') {
    return emp.latestCctvStatus;
  }
  if (!emp.latestLogId) return 'none';
  return emp.latestVerified ? 'confirmed' : 'pending';
}

/**
 * Detoxed Team Shifts & Live Attendance Roster (`ScheduleShiftsTab.jsx`).
 * Zero emojis, zero decorative checkmarks, zero colored section banners or nested cards,
 * `<CockpitMetricStrip />` + hairline `<GroupedList>` rows preserving full privacy isolation.
 */
export default function ScheduleShiftsTab({
  scheduleData = null,
  canVerify: propCanVerify = false,
  onVerifyLog,
  onRefresh,
  onToast,
}) {
  const todayDateKey = scheduleData?.todayDateKey || getCairoDateKey();
  const currentCairoWeekStart = useMemo(() => getSaturdayWeekStart(todayDateKey), [todayDateKey]);
  const resolvedWeekStart = scheduleData?.weekStartDate || currentCairoWeekStart;
  const isCurrentWeek = resolvedWeekStart === currentCairoWeekStart;
  const todayWeekday = scheduleData?.todayWeekday || '';
  const weekDates = scheduleData?.weekDates || {};
  const isOfflineReadOnly = Boolean(scheduleData?._offlineCached);

  const [selectedDay, setSelectedDay] = useState(() =>
    isCurrentWeek && todayWeekday ? todayWeekday : 'sat'
  );
  const [shiftPeriodFilter, setShiftPeriodFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [teamGroupFilter, setTeamGroupFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [verifyingLogId, setVerifyingLogId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showAllCompanions, setShowAllCompanions] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (isCurrentWeek && todayWeekday) {
      setSelectedDay(todayWeekday);
    } else if (!isCurrentWeek) {
      setSelectedDay('sat');
    }
  }, [resolvedWeekStart, isCurrentWeek, todayWeekday]);

  const isLiveToday = Boolean(
    (weekDates[selectedDay] && weekDates[selectedDay] === todayDateKey) ||
      (isCurrentWeek && todayWeekday && selectedDay === todayWeekday)
  );

  useEffect(() => {
    setStatusFilter('all');
    if (!isLiveToday) {
      setShiftPeriodFilter((prev) => (prev === 'checked_out' ? 'all' : prev));
    }
  }, [isLiveToday]);

  const hasLiveRoster = Array.isArray(scheduleData?.shiftRoster);
  const hasFullShiftVisibility = Boolean(
    typeof scheduleData?.hasFullShiftVisibility === 'boolean'
      ? scheduleData.hasFullShiftVisibility
      : scheduleData?.canManage || (scheduleData?.groups?.length || 0) > 1
  );
  const effectiveCanVerify = Boolean(scheduleData?.canVerify ?? propCanVerify);

  const roster = useMemo(() => {
    if (hasLiveRoster) {
      return scheduleData.shiftRoster.map(normalizeRosterEntry);
    }
    return deriveFallbackRoster(scheduleData);
  }, [hasLiveRoster, scheduleData]);

  const hasActiveBreaks = useMemo(
    () => isLiveToday && roster.some((e) => e.currentStatus === 'on_break'),
    [isLiveToday, roster]
  );

  useEffect(() => {
    if (!hasActiveBreaks) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, [hasActiveBreaks]);

  const myRosterEntry = useMemo(
    () => roster.find((e) => e.isMe) || null,
    [roster]
  );

  const rosterWithDayState = useMemo(
    () =>
      roster.map((emp) => ({
        emp,
        dayState: getEmployeeDayState(emp, { isLiveToday, selectedDay }),
      })),
    [roster, isLiveToday, selectedDay]
  );

  const companionSummary = useMemo(() => {
    if (!myRosterEntry) return null;
    const myDayState = getEmployeeDayState(myRosterEntry, { isLiveToday, selectedDay });
    const overlapping = rosterWithDayState.filter(
      ({ emp }) => emp.overlapsMyShift && !emp.isMe
    );
    const overlappingWorking = overlapping.filter(({ dayState }) => !dayState.isActuallyOff);
    const overlappingOff = overlapping.filter(({ dayState }) => dayState.isActuallyOff);

    return {
      myDayState,
      overlappingWorking,
      overlappingOff,
    };
  }, [myRosterEntry, rosterWithDayState, isLiveToday, selectedDay]);

  const metrics = useMemo(() => {
    let presentCount = 0;
    let onBreakCount = 0;
    let notArrivedCount = 0;
    let checkedOutCount = 0;
    let offCount = 0;
    let workedDayOffCount = 0;
    let scheduledWorkingCount = 0;
    let withMeWorkingCount = 0;

    for (const { emp, dayState } of rosterWithDayState) {
      if (dayState.isWorkedDayOff) workedDayOffCount += 1;
      if (dayState.isActuallyOff) {
        offCount += 1;
      } else {
        scheduledWorkingCount += 1;
        if (emp.overlapsMyShift && !emp.isMe) {
          withMeWorkingCount += 1;
        }
      }

      if (isLiveToday) {
        if (dayState.statusKey === 'present') presentCount += 1;
        else if (dayState.statusKey === 'on_break') onBreakCount += 1;
        else if (dayState.statusKey === 'checked_out') checkedOutCount += 1;
        else if (dayState.statusKey === 'absent') notArrivedCount += 1;
      }
    }

    return {
      totalCount: rosterWithDayState.length,
      presentCount,
      onBreakCount,
      notArrivedCount,
      checkedOutCount,
      offCount,
      workedDayOffCount,
      scheduledWorkingCount,
      withMeWorkingCount,
    };
  }, [rosterWithDayState, isLiveToday]);

  const baseScopedList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rosterWithDayState.filter(({ emp }) => {
      if (hasFullShiftVisibility && teamGroupFilter !== 'all' && emp.team_group !== teamGroupFilter) {
        return false;
      }
      if (hasFullShiftVisibility && q) {
        const hay = `${emp.name} ${emp.department} ${emp.role_title || ''} ${emp.team_group_label || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rosterWithDayState, hasFullShiftVisibility, teamGroupFilter, searchQuery]);

  const filteredRoster = useMemo(() => {
    return baseScopedList.filter(({ emp, dayState }) => {
      if (shiftPeriodFilter === 'with_me') {
        if (!emp.overlapsMyShift && !emp.isMe) return false;
      } else if (shiftPeriodFilter === 'checked_out') {
        if (dayState.statusKey !== 'checked_out') return false;
      } else if (shiftPeriodFilter !== 'all' && emp.shiftPeriod !== shiftPeriodFilter) {
        return false;
      }

      if (statusFilter !== 'all') {
        if (isLiveToday) {
          if (dayState.statusKey !== statusFilter) return false;
        } else {
          if (statusFilter === 'scheduled' && dayState.isActuallyOff) return false;
          if (statusFilter === 'off' && !dayState.isActuallyOff) return false;
        }
      }

      return true;
    });
  }, [baseScopedList, shiftPeriodFilter, statusFilter, isLiveToday]);

  const groupedSections = useMemo(() => {
    return SHIFT_PERIOD_SECTIONS.map((sec) => {
      const items = filteredRoster.filter(({ emp }) => emp.shiftPeriod === sec.id);
      const presentInSection = items.filter(({ dayState }) => dayState.statusKey === 'present').length;
      const workingInSection = items.filter(({ dayState }) => !dayState.isActuallyOff).length;
      return {
        ...sec,
        items,
        presentInSection,
        workingInSection,
      };
    }).filter((sec) => sec.items.length > 0);
  }, [filteredRoster]);

  const hasActiveFilters = Boolean(
    shiftPeriodFilter !== 'all' ||
      statusFilter !== 'all' ||
      teamGroupFilter !== 'all' ||
      searchQuery.trim()
  );

  function resetAllFilters() {
    setShiftPeriodFilter('all');
    setStatusFilter('all');
    setTeamGroupFilter('all');
    setSearchQuery('');
  }

  async function handleQuickVerify(emp) {
    if (!emp?.latestLogId || verifyingLogId || isOfflineReadOnly) return;
    setVerifyingLogId(emp.latestLogId);
    try {
      await onVerifyLog?.(emp.latestLogId, { status: 'confirmed' });
    } catch {
      // handled by parent
    } finally {
      setVerifyingLogId('');
    }
  }

  async function handleManualRefresh() {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
      onToast?.('تم تحديث الشفتات');
    } catch (err) {
      onToast?.(err?.message || 'تعذر التحديث', 'error');
    } finally {
      setRefreshing(false);
    }
  }

  const periodFilterItems = useMemo(() => {
    const items = [{ id: 'all', label: 'الكل', count: baseScopedList.length }];
    if (myRosterEntry) {
      items.push({
        id: 'with_me',
        label: 'معاك',
        count: baseScopedList.filter(({ emp }) => emp.overlapsMyShift || emp.isMe).length,
      });
    }
    for (const sec of SHIFT_PERIOD_SECTIONS) {
      items.push({
        id: sec.id,
        label: sec.chipLabel,
        count: baseScopedList.filter(({ emp }) => emp.shiftPeriod === sec.id).length,
      });
    }
    if (isLiveToday) {
      items.push({
        id: 'checked_out',
        label: 'منصرف',
        count: baseScopedList.filter(({ dayState }) => dayState.statusKey === 'checked_out').length,
      });
    }
    return items;
  }, [baseScopedList, myRosterEntry, isLiveToday]);

  const weekDayItems = useMemo(
    () =>
      SCHEDULE_WEEKDAYS.map((day) => {
        const dKey = weekDates[day.code] || '';
        const isDayToday = Boolean(
          (dKey && dKey === todayDateKey) || (isCurrentWeek && todayWeekday === day.code)
        );
        const isMyOffDay = myRosterEntry?.effective_day_of_week === day.code;
        const workingCount = roster.filter((e) => e.effective_day_of_week !== day.code).length;

        return {
          id: day.code,
          shortLabel: day.shortLabel,
          label: day.label,
          dateNum: formatShortDate(dKey),
          badge: isDayToday ? 'مباشر' : isMyOffDay ? 'إجازتك' : String(workingCount),
          isToday: isDayToday,
        };
      }),
    [weekDates, todayDateKey, isCurrentWeek, todayWeekday, myRosterEntry, roster]
  );

  const teamGroupFilterItems = useMemo(
    () => [
      { id: 'all', label: 'الكل', count: rosterWithDayState.length },
      ...SCHEDULE_TEAM_GROUPS.map((tg) => ({
        id: tg.id,
        label: tg.shortLabel || tg.label,
        count: rosterWithDayState.filter(({ emp }) => emp.team_group === tg.id).length,
      })),
    ],
    [rosterWithDayState]
  );

  const stripMetrics = useMemo(() => {
    if (isLiveToday) {
      return [
        {
          id: 'present',
          label: 'حاضر',
          value: metrics.presentCount,
          secondary:
            metrics.workedDayOffCount > 0
              ? `من ${metrics.scheduledWorkingCount} · ${metrics.workedDayOffCount} إضافي`
              : `من ${metrics.scheduledWorkingCount}`,
          dotTone: metrics.presentCount > 0 ? 'success' : '',
          active: statusFilter === 'present',
          onClick: () => setStatusFilter((prev) => (prev === 'present' ? 'all' : 'present')),
        },
        {
          id: 'on_break',
          label: 'بريك',
          value: metrics.onBreakCount,
          dotTone: metrics.onBreakCount > 0 ? 'warning' : '',
          active: statusFilter === 'on_break',
          onClick: () => setStatusFilter((prev) => (prev === 'on_break' ? 'all' : 'on_break')),
        },
        {
          id: 'absent',
          label: 'لم يحضر',
          value: metrics.notArrivedCount,
          secondary: metrics.checkedOutCount > 0 ? `${metrics.checkedOutCount} منصرف` : '',
          tone: metrics.notArrivedCount > 0 ? 'danger' : 'neutral',
          dotTone: metrics.notArrivedCount > 0 ? 'danger' : '',
          active: statusFilter === 'absent',
          onClick: () => setStatusFilter((prev) => (prev === 'absent' ? 'all' : 'absent')),
        },
        {
          id: 'off',
          label: 'إجازة',
          value: metrics.offCount,
          secondary: getScheduleWeekdayLabel(selectedDay),
          active: statusFilter === 'off',
          onClick: () => setStatusFilter((prev) => (prev === 'off' ? 'all' : 'off')),
        },
      ];
    }

    return [
      {
        id: 'scheduled',
        label: 'دوام',
        value: metrics.scheduledWorkingCount,
        secondary: getScheduleWeekdayLabel(selectedDay),
        active: statusFilter === 'scheduled',
        onClick: () => setStatusFilter((prev) => (prev === 'scheduled' ? 'all' : 'scheduled')),
      },
      {
        id: 'with_me',
        label: 'معاك',
        value: myRosterEntry ? metrics.withMeWorkingCount : 0,
        active: shiftPeriodFilter === 'with_me',
        onClick: myRosterEntry
          ? () => setShiftPeriodFilter((prev) => (prev === 'with_me' ? 'all' : 'with_me'))
          : undefined,
      },
      {
        id: 'off',
        label: 'إجازة',
        value: metrics.offCount,
        secondary: getScheduleWeekdayLabel(selectedDay),
        active: statusFilter === 'off',
        onClick: () => setStatusFilter((prev) => (prev === 'off' ? 'all' : 'off')),
      },
      {
        id: 'total',
        label: 'الإجمالي',
        value: metrics.totalCount,
        onClick: hasActiveFilters ? resetAllFilters : undefined,
      },
    ];
  }, [
    isLiveToday,
    metrics,
    statusFilter,
    selectedDay,
    myRosterEntry,
    shiftPeriodFilter,
    hasActiveFilters,
  ]);

  if (!scheduleData) {
    return null;
  }

  if (roster.length === 0) {
    return <EmptyState compact title="لا توجد شفتات" />;
  }

  const totalOverlappingWorking = companionSummary?.overlappingWorking?.length || 0;
  const visibleOverlappingWorking = companionSummary
    ? showAllCompanions
      ? companionSummary.overlappingWorking
      : companionSummary.overlappingWorking.slice(0, 4)
    : [];

  return (
    <div className="space-y-5">
      {!hasLiveRoster && (
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-warning">
          <span>نسخة محفوظة — حدّث للحالة المباشرة</span>
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              loading={refreshing}
              onClick={handleManualRefresh}
            >
              تحديث
            </Button>
          )}
        </div>
      )}

      {/* 1. Day Header + 7-Day Selector */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
            <h3 className="text-sm sm:text-base font-semibold tracking-tight text-ink m-0">
              {getScheduleWeekdayLabel(selectedDay)}
            </h3>
            {weekDates[selectedDay] && (
              <span className="num-ltr text-xs font-medium text-ink-muted">
                {weekDates[selectedDay]}
              </span>
            )}
            {isLiveToday && <StatusDot tone="success" label="مباشر" pulse tintedText />}
          </div>

          <div className="flex items-center gap-1.5">
            {isCurrentWeek && todayWeekday && selectedDay !== todayWeekday && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedDay(todayWeekday)}
              >
                اليوم
              </Button>
            )}
            {onRefresh && (
              <Button
                variant="ghost"
                size="sm"
                icon="refresh"
                loading={refreshing}
                onClick={handleManualRefresh}
              >
                تحديث
              </Button>
            )}
          </div>
        </div>

        <WeekDayStrip
          days={weekDayItems}
          activeId={selectedDay}
          onSelect={setSelectedDay}
          ariaLabel="أيام شفتات الأسبوع"
        />
      </div>

      {/* 2. Flat Companion Hairline Group (Own shift + overlapping teammates) */}
      {myRosterEntry && companionSummary && (
        <GroupedList
          label="شفتك ومين معاك"
          count={totalOverlappingWorking}
          actions={
            totalOverlappingWorking > 4 ? (
              <button
                type="button"
                onClick={() => setShowAllCompanions((prev) => !prev)}
                className="text-xs font-medium text-primary hover:underline cursor-pointer min-h-[32px] px-1"
              >
                {showAllCompanions ? 'عرض أقل' : `الكل (${totalOverlappingWorking})`}
              </button>
            ) : null
          }
        >
          <div className="min-h-[54px] px-3.5 py-2.5 flex items-center justify-between gap-3 bg-surface-tint">
            <div className="flex items-center gap-2.5 min-w-0">
              <RoleAvatar
                src={myRosterEntry.avatar_url}
                name={myRosterEntry.name}
                color={myRosterEntry.avatar_color || 'var(--g-primary-solid)'}
                preset={myRosterEntry.avatar_preset || 'initials_gradient'}
                size="sm"
                shape="circle"
              />
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-semibold text-ink truncate">
                  {myRosterEntry.name}
                  <span className="text-xs font-medium text-primary"> · أنت</span>
                  {companionSummary.myDayState.isWorkedDayOff && (
                    <span className="text-xs font-medium text-purple"> · عمل يوم إجازة</span>
                  )}
                </div>
                <div className="text-xs text-ink-muted truncate num-ltr">
                  {myRosterEntry.department} · {myRosterEntry.shift_start}–{myRosterEntry.shift_end} ({myRosterEntry.shiftDurationLabel})
                </div>
              </div>
            </div>

            <StatusDot
              tone={companionSummary.myDayState.statusTone}
              label={companionSummary.myDayState.statusLabel}
              tintedText
            />
          </div>

          {visibleOverlappingWorking.map(({ emp, dayState }) => (
            <div
              key={emp.id}
              className="min-h-[48px] px-3.5 py-2 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <RoleAvatar
                  src={emp.avatar_url}
                  name={emp.name}
                  color={emp.avatar_color || 'var(--g-primary-solid)'}
                  preset={emp.avatar_preset || 'initials_gradient'}
                  size="xs"
                  shape="circle"
                />
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-medium text-ink truncate">
                    {emp.name}
                  </div>
                  <div className="text-xs text-ink-muted truncate num-ltr">
                    {emp.department} · {emp.shift_start}–{emp.shift_end}
                  </div>
                </div>
              </div>
              <StatusDot tone={dayState.statusTone} label={dayState.statusLabel} />
            </div>
          ))}
        </GroupedList>
      )}

      {/* 3. Adaptive 4-Metric Cockpit Strip */}
      <CockpitMetricStrip items={stripMetrics} columns={4} />

      {/* 4. Borderless Filter Controls */}
      <div className="space-y-2.5">
        {hasFullShiftVisibility && (
          <div className="flex flex-col lg:flex-row lg:items-center gap-2.5 min-w-0">
            <SearchFilterBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="بحث بالاسم أو القسم..."
              className="flex-1 lg:min-w-[240px]"
            />
            <FilterChipRail
              items={teamGroupFilterItems}
              activeId={teamGroupFilter}
              onSelect={setTeamGroupFilter}
              className="lg:shrink-0 max-w-full"
            />
          </div>
        )}

        <FilterChipRail
          items={periodFilterItems}
          activeId={shiftPeriodFilter}
          onSelect={setShiftPeriodFilter}
        />
      </div>

      {/* 5. Shift-Grouped Hairline Lists */}
      {groupedSections.length === 0 ? (
        <EmptyState
          compact
          title="لا توجد نتائج مطابقة"
          actionLabel={hasActiveFilters ? 'عرض الكل' : ''}
          onAction={hasActiveFilters ? resetAllFilters : undefined}
        />
      ) : (
        <div className="space-y-5">
          {groupedSections.map((section) => (
            <GroupedList
              key={section.id}
              label={section.title}
              count={
                isLiveToday
                  ? `${section.presentInSection}/${section.workingInSection}`
                  : section.workingInSection
              }
            >
              {section.items.map(({ emp, dayState }) => {
                const cctvState = resolveCctvState(emp);
                const canQuickVerify = Boolean(
                  isLiveToday &&
                    hasFullShiftVisibility &&
                    effectiveCanVerify &&
                    emp.latestLogId &&
                    cctvState !== 'confirmed'
                );

                const activeBreakMins =
                  isLiveToday && emp.currentStatus === 'on_break' && emp.activeBreakStart
                    ? Math.max(
                        0,
                        Math.floor((Date.now() - new Date(emp.activeBreakStart).getTime()) / 60000)
                      )
                    : null;
                const breakExceeded = Boolean(
                  activeBreakMins !== null &&
                    emp.allowedBreakMinutes &&
                    activeBreakMins > emp.allowedBreakMinutes
                );

                const metaParts = [
                  emp.department,
                  `${emp.shift_start}–${emp.shift_end}`,
                ];
                if (isLiveToday && hasFullShiftVisibility) {
                  if (emp.checkInTime) {
                    metaParts.push(`حضور ${formatTimeArabic(emp.checkInTime)}`);
                  }
                  if (emp.checkOutTime) {
                    metaParts.push(`انصراف ${formatTimeArabic(emp.checkOutTime)}`);
                  }
                  if (Number(emp.lateMinutes) > 0) {
                    metaParts.push(`تأخير ${emp.lateMinutes}د`);
                  }
                  if (emp.currentStatus === 'on_break' && activeBreakMins !== null) {
                    metaParts.push(
                      `بريك ${activeBreakMins}د${
                        breakExceeded ? ` (+${activeBreakMins - emp.allowedBreakMinutes}د)` : ''
                      }`
                    );
                  } else if (Number(emp.totalBreakMinutes) > 0) {
                    metaParts.push(`بريك ${emp.totalBreakMinutes}د`);
                  }
                }

                const singleDotTone =
                  isLiveToday && hasFullShiftVisibility && cctvState === 'mismatch'
                    ? 'danger'
                    : breakExceeded
                    ? 'danger'
                    : dayState.statusTone;

                const singleDotLabel =
                  isLiveToday && hasFullShiftVisibility && cctvState === 'mismatch'
                    ? 'تعارض'
                    : breakExceeded
                    ? `بريك ${activeBreakMins}د`
                    : dayState.statusLabel;

                return (
                  <div
                    key={emp.id}
                    className={`min-h-[56px] px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                      emp.isMe ? 'bg-surface-tint' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <RoleAvatar
                        src={emp.avatar_url}
                        name={emp.name}
                        color={emp.avatar_color || 'var(--g-primary-solid)'}
                        preset={emp.avatar_preset || 'initials_gradient'}
                        size="sm"
                        shape="circle"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                          <span className="text-sm font-semibold text-ink truncate">
                            {emp.name}
                          </span>
                          {emp.isMe && (
                            <span className="text-xs font-medium text-primary">أنت</span>
                          )}
                          {dayState.isWorkedDayOff && (
                            <span className="text-xs font-medium text-purple">
                              عمل يوم إجازة
                            </span>
                          )}
                          {isLiveToday &&
                            hasFullShiftVisibility &&
                            cctvState === 'confirmed' && (
                              <Icon
                                name="verified"
                                size={14}
                                filled
                                className="text-success align-middle"
                                ariaLabel="مؤكد بالكاميرا"
                              />
                            )}
                        </div>

                        <div className="text-xs text-ink-muted truncate num-ltr">
                          {metaParts.filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 shrink-0">
                      <StatusDot
                        tone={singleDotTone}
                        label={singleDotLabel}
                        tintedText={singleDotTone === 'danger' || singleDotTone === 'warning'}
                      />

                      {canQuickVerify && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={verifyingLogId === emp.latestLogId}
                          disabled={isOfflineReadOnly || Boolean(verifyingLogId)}
                          onClick={() => handleQuickVerify(emp)}
                        >
                          تأكيد
                        </Button>
                      )}

                      {hasFullShiftVisibility && emp.phone && (
                        <a
                          href={`tel:${emp.phone}`}
                          aria-label={`اتصال بـ ${emp.name}`}
                          title={emp.phone}
                          className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-primary inline-flex items-center justify-center no-underline transition-[background-color,color] duration-150 shrink-0"
                        >
                          <Icon name="call" size={18} />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </GroupedList>
          ))}
        </div>
      )}
    </div>
  );
}
