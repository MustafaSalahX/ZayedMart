import React, { useMemo } from 'react';
import { CockpitMetricStrip } from '../ui/index.js';

/**
 * Pure Operational 4-Metric Cockpit Strip (`الحضور`, `النواقص`, `العربيات`, `المتابعة`).
 * Renders big crisp tabular numerals, 1 short label, 1 real non-zero secondary datum,
 * an 8px dot ONLY on actionable states, and 1-tap drilldown across all 5 theme architectures.
 */
export default function DashboardKpiBentoGrid({
  summary = {},
  onSmartJumpTab,
  onSelectTab,
}) {
  const s = summary || {};

  function jumpTo(tabId, filterOpts = null) {
    if (onSmartJumpTab) {
      onSmartJumpTab(tabId, filterOpts);
    } else if (onSelectTab) {
      onSelectTab(tabId);
    }
  }

  const metrics = useMemo(() => {
    const totalEmp = Number(s.totalEmployees || 0);
    const scheduledOff = Number(s.scheduledOffCount || 0);
    const present = Number(s.presentCount || 0);
    const onBreak = Number(s.onBreakCount || 0);
    const late = Number(s.lateCount || 0);
    const mismatch = Number(s.mismatchAttendanceCount || 0);

    const activeOnFloor = present + onBreak;
    const workingTarget = Math.max(0, totalEmp - scheduledOff);

    const attendanceParts = [];
    if (totalEmp > 0) attendanceParts.push(`من ${workingTarget}`);
    if (mismatch > 0) attendanceParts.push(`${mismatch} تعارض`);
    else if (late > 0) attendanceParts.push(`${late} تأخير`);
    else if (onBreak > 0) attendanceParts.push(`${onBreak} استراحة`);

    const openShortages = Number(s.openShortagesCount || 0);
    const urgentShortages = Number(s.urgentShortagesCount || 0);
    const orderedShortages = Number(s.orderedShortagesCount || 0);
    const resolvedToday = Number(s.resolvedShortagesTodayCount || 0);

    let shortageSecondary = '—';
    if (urgentShortages > 0) {
      shortageSecondary = `${urgentShortages} نفد`;
    } else if (resolvedToday > 0) {
      shortageSecondary = `توفّر ${resolvedToday}`;
    } else if (orderedShortages > 0) {
      shortageSecondary = `تم الطلب ${orderedShortages}`;
    }

    const unloadingTrucks = Number(s.unloadingTrucksCount || 0);
    const completedTrucks = Number(s.completedTrucksCount || 0);
    const issuesTrucks = Number(s.issuesTrucksCount || 0);
    const totalTrucksToday = unloadingTrucks + completedTrucks;

    let trucksSecondary = '—';
    if (unloadingTrucks > 0) {
      trucksSecondary = `${unloadingTrucks} قيد التنزيل`;
    } else if (issuesTrucks > 0) {
      trucksSecondary = `${issuesTrucks} ملاحظات`;
    } else if (completedTrucks > 0) {
      trucksSecondary = `${completedTrucks} مستلمة`;
    }

    const urgentNotes = Number(s.urgentNotesCount || 0);
    const openHandovers = Number(s.openHandoverNotesCount || 0);
    const pendingSwaps = Number(
      s.pendingDayOffSwapsCount || s.totalPendingSwapsCount || 0
    );
    const totalOpsFollowUps = urgentNotes + openHandovers + pendingSwaps;

    const followUpParts = [];
    if (urgentNotes > 0) followUpParts.push(`${urgentNotes} كاميرا`);
    if (openHandovers > 0) followUpParts.push(`${openHandovers} وردية`);
    if (pendingSwaps > 0) followUpParts.push(`${pendingSwaps} إجازة`);

    return [
      {
        id: 'attendance',
        label: 'الحضور',
        value: activeOnFloor,
        secondary: attendanceParts.length > 0 ? attendanceParts.join(' · ') : '—',
        tone: mismatch > 0 ? 'danger' : 'neutral',
        dotTone: mismatch > 0 ? 'danger' : late > 0 ? 'warning' : '',
        onClick: () => jumpTo('attendance'),
      },
      {
        id: 'shortages',
        label: 'النواقص',
        value: openShortages,
        secondary: shortageSecondary,
        tone: urgentShortages > 0 ? 'danger' : 'neutral',
        dotTone: urgentShortages > 0 ? 'danger' : '',
        onClick: () => jumpTo('shortages'),
      },
      {
        id: 'trucks',
        label: 'العربيات',
        value: totalTrucksToday,
        secondary: trucksSecondary,
        tone: issuesTrucks > 0 ? 'danger' : unloadingTrucks > 0 ? 'warning' : 'neutral',
        dotTone: issuesTrucks > 0 ? 'danger' : unloadingTrucks > 0 ? 'warning' : '',
        onClick: () => jumpTo('trucks'),
      },
      {
        id: 'followups',
        label: 'المتابعة',
        value: totalOpsFollowUps,
        secondary: followUpParts.length > 0 ? followUpParts.join(' · ') : '—',
        tone: urgentNotes > 0 ? 'danger' : 'neutral',
        dotTone: urgentNotes > 0 ? 'danger' : totalOpsFollowUps > 0 ? 'warning' : '',
        onClick: () =>
          jumpTo(
            pendingSwaps > 0 && urgentNotes === 0 && openHandovers === 0
              ? 'schedule'
              : 'notes'
          ),
      },
    ];
  }, [s, onSmartJumpTab, onSelectTab]);

  return <CockpitMetricStrip items={metrics} columns={4} />;
}
