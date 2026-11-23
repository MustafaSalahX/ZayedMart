import React, { useMemo, useState } from 'react';
import { GroupedList, GroupedRow, Icon, StatusDot } from '../ui/index.js';

function getElapsedMinutes(isoTimestamp) {
  if (!isoTimestamp) return 0;
  const ts = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

/**
 * Builds the prioritized actionable queue from already-loaded bootstrap `data`.
 * Concise 1-line operational titles only — zero verbose subtitles.
 */
export function buildAttentionItems(data) {
  if (!data) return [];
  const s = data.summary || {};
  const maxBreak = Number(data.settings?.max_break_minutes || 30);
  const maxUnload = Number(data.settings?.max_unload_minutes || 60);
  const items = [];

  if (Number(s.mismatchAttendanceCount || 0) > 0) {
    items.push({
      id: 'att_mismatch',
      severity: 'critical',
      tone: 'danger',
      title: `تعارض كاميرا (${s.mismatchAttendanceCount})`,
      targetTab: 'attendance',
      filterOpts: { status: 'mismatch' },
    });
  }

  const outOfStockItems = (data.shortages || []).filter(
    (sh) => sh.status !== 'resolved' && sh.urgency === 'out_of_stock'
  );
  if (outOfStockItems.length > 0) {
    const sampleNames = outOfStockItems
      .slice(0, 2)
      .map((x) => x.item_name)
      .join('، ');
    items.push({
      id: 'shortages_urgent',
      severity: 'critical',
      tone: 'danger',
      title: `نفد تماماً (${outOfStockItems.length}) · ${sampleNames}`,
      targetTab: 'shortages',
    });
  }

  const urgentNotesList = (data.notes || []).filter((n) => n.severity === 'urgent');
  if (urgentNotesList.length > 0) {
    const latestNote = urgentNotesList[0];
    const loc = latestNote?.location_tag ? ` · ${latestNote.location_tag}` : '';
    items.push({
      id: 'notes_urgent',
      severity: 'critical',
      tone: 'danger',
      title: `ملاحظة طارئة (${urgentNotesList.length})${loc}`,
      targetTab: 'notes',
    });
  }

  const overdueBreaks = (data.employees || [])
    .filter((emp) => emp.status === 'on_break' && emp.break_started_at)
    .map((emp) => ({
      ...emp,
      elapsed: getElapsedMinutes(emp.break_started_at),
    }))
    .filter((emp) => emp.elapsed > maxBreak);

  if (overdueBreaks.length > 0) {
    const names = overdueBreaks
      .slice(0, 2)
      .map((e) => `${e.name} (${e.elapsed}د)`)
      .join('، ');
    items.push({
      id: 'overdue_breaks',
      severity: 'warning',
      tone: 'warning',
      title: `تجاوز استراحة · ${names}`,
      targetTab: 'attendance',
      filterOpts: { status: 'on_break' },
    });
  }

  const overdueTrucks = (data.truckLogs || [])
    .filter((t) => t.status === 'unloading' && t.arrival_time)
    .map((t) => ({
      ...t,
      elapsed: getElapsedMinutes(t.arrival_time),
    }))
    .filter((t) => t.elapsed > maxUnload);

  if (overdueTrucks.length > 0) {
    const names = overdueTrucks
      .slice(0, 2)
      .map((t) => `${t.supplier_name} (${t.elapsed}د)`)
      .join('، ');
    items.push({
      id: 'overdue_trucks',
      severity: 'warning',
      tone: 'warning',
      title: `تأخر تفريغ · ${names}`,
      targetTab: 'trucks',
    });
  }

  if (data.pendingHandover) {
    items.push({
      id: 'pending_handover',
      severity: 'warning',
      tone: 'warning',
      title: `تسليم وردية معلق · ${data.pendingHandover.from_actor || 'الوردية السابقة'}`,
      isHandoverModal: true,
    });
  }

  const swapsCount = Number(
    s.pendingDayOffSwapsCount || (data.pendingDayOffSwaps || []).length || 0
  );
  if (swapsCount > 0) {
    items.push({
      id: 'pending_swaps',
      severity: 'warning',
      tone: 'purple',
      title: `طلبات إجازة معلقة (${swapsCount})`,
      targetTab: 'schedule',
    });
  }

  const pendingReturnsCount = Number(s.pendingSupplierReturnsCount || 0);
  if (pendingReturnsCount > 0) {
    items.push({
      id: 'supplier_returns',
      severity: 'info',
      tone: 'warning',
      title: `مرتجعات موردين (${pendingReturnsCount})`,
      targetTab: 'trucks',
    });
  }

  if (
    Number(s.unverifiedAttendanceCount || 0) > 0 &&
    Number(s.mismatchAttendanceCount || 0) === 0
  ) {
    items.push({
      id: 'att_unverified',
      severity: 'info',
      tone: 'primary',
      title: `بانتظار مراجعة الكاميرا (${s.unverifiedAttendanceCount})`,
      targetTab: 'attendance',
    });
  }

  return items;
}

/**
 * Quiet Operational Attention Queue (`للمتابعة`).
 * CRITICAL ANTI-AI RULE: Returns `null` when 0 items exist — zero green "stable" filler boxes!
 */
export default function DashboardAttentionPanel({
  data,
  onSmartJumpTab,
  onSelectTab,
  onOpenHandoverModal,
}) {
  const [expanded, setExpanded] = useState(false);
  const items = useMemo(() => buildAttentionItems(data), [data]);

  if (items.length === 0) return null;

  const visibleItems = expanded ? items : items.slice(0, 4);

  function handleAction(item) {
    if (item.isHandoverModal && onOpenHandoverModal) {
      onOpenHandoverModal();
      return;
    }
    if (onSmartJumpTab && item.targetTab) {
      onSmartJumpTab(item.targetTab, item.filterOpts || null);
    } else if (onSelectTab && item.targetTab) {
      onSelectTab(item.targetTab);
    }
  }

  return (
    <GroupedList
      label="للمتابعة"
      count={items.length}
      actions={
        items.length > 4 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-primary hover:underline cursor-pointer min-h-[32px] px-1"
          >
            {expanded ? 'عرض أقل' : `الكل (${items.length})`}
          </button>
        ) : null
      }
    >
      {visibleItems.map((item) => (
        <GroupedRow key={item.id} onClick={() => handleAction(item)}>
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <StatusDot
              tone={item.tone || 'warning'}
              pulse={item.severity === 'critical'}
            />
            <span className="text-xs sm:text-sm font-medium text-ink truncate">
              {item.title}
            </span>
          </div>
          <Icon
            name="chevron_left"
            size={18}
            className="text-ink-muted opacity-65 ltr:rotate-180 shrink-0"
          />
        </GroupedRow>
      ))}
    </GroupedList>
  );
}
