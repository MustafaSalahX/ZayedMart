import React, { useMemo } from 'react';
import { GroupedList, GroupedRow, StatusDot } from '../ui/index.js';
import DashboardKpiBentoGrid from './DashboardKpiBentoGrid.jsx';
import DashboardAttentionPanel from './DashboardAttentionPanel.jsx';
import DashboardActivityFeed from './DashboardActivityFeed.jsx';

function formatShortTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

function buildDepartmentCoverage(employees = []) {
  const map = new Map();
  for (const emp of employees) {
    const dept = emp.department || 'أخرى';
    if (!map.has(dept)) {
      map.set(dept, {
        department: dept,
        total: 0,
        active: 0,
        onBreak: 0,
      });
    }
    const row = map.get(dept);
    row.total += 1;
    if (emp.status === 'present') row.active += 1;
    else if (emp.status === 'on_break') {
      row.active += 1;
      row.onBreak += 1;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

/**
 * Pure Single-Column Operational Cockpit (`نظرة عامة`):
 * 1. Ultra-quiet 1-line inline prompt ONLY if staff or suppliers = 0 (zero giant rocket box)
 * 2. 4-Metric Cockpit Strip
 * 3. Attention Queue (completely hidden when 0 alerts)
 * 4. Compact Department Coverage + Latest Handover (ONLY when populated — zero empty filler)
 * 5. Clean chronological hairline Daily Activity Feed
 */
export default function DashboardOverviewTab({
  data,
  canManageStaff = false,
  canManageSuppliers = false,
  canManageRecords = false,
  canViewReports = false,
  isConnectedApi = true,
  onSelectSubTab,
  onSmartJumpTab,
  onSelectTab,
  onOpenHandoverModal,
  onPreviewImage,
  onRefresh,
  onToast,
}) {
  const employees = data?.employees || [];
  const suppliers = data?.suppliers || [];
  const handovers = data?.handovers || [];

  const needsStaff = canManageStaff && employees.length === 0;
  const needsSuppliers = canManageSuppliers && suppliers.length === 0;
  const showInlineSetup = needsStaff || needsSuppliers;

  const deptCoverage = useMemo(
    () => buildDepartmentCoverage(employees),
    [employees]
  );

  const latestHandover = handovers[0] || null;

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* 1. Quiet 1-line inline prompt when initial data is empty */}
      {showInlineSetup && (
        <div className="py-2 border-b border-line flex items-center flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
          {needsStaff && (
            <button
              type="button"
              onClick={() => onSelectSubTab?.('staff')}
              className="min-h-[44px] sm:min-h-[32px] inline-flex items-center gap-1 font-semibold text-primary hover:underline cursor-pointer"
            >
              <span>أضف أول موظف +</span>
            </button>
          )}
          {needsSuppliers && (
            <button
              type="button"
              onClick={() => onSelectSubTab?.('suppliers')}
              className="min-h-[44px] sm:min-h-[32px] inline-flex items-center gap-1 font-semibold text-primary hover:underline cursor-pointer"
            >
              <span>أضف مورد +</span>
            </button>
          )}
        </div>
      )}

      {/* 2. Adaptive 4-Metric Cockpit Strip */}
      <DashboardKpiBentoGrid
        summary={data?.summary}
        onSmartJumpTab={onSmartJumpTab}
        onSelectTab={onSelectTab}
      />

      {/* 3. Actionable Attention Queue (renders null when empty) */}
      <DashboardAttentionPanel
        data={data}
        onSmartJumpTab={onSmartJumpTab}
        onSelectTab={onSelectTab}
        onOpenHandoverModal={onOpenHandoverModal}
      />

      {/* 4. Conditional Context Strip: Department Coverage + Latest Handover (hidden when empty) */}
      {deptCoverage.length > 0 && (
        <GroupedList label="تغطية الأقسام" count={deptCoverage.length}>
          {deptCoverage.map((d) => {
            const pct = d.total > 0 ? Math.round((d.active / d.total) * 100) : 0;
            const tone =
              d.active === 0 ? 'danger' : pct >= 70 ? 'success' : 'warning';
            return (
              <GroupedRow
                key={d.department}
                onClick={
                  onSmartJumpTab
                    ? () => onSmartJumpTab('attendance')
                    : onSelectTab
                    ? () => onSelectTab('attendance')
                    : undefined
                }
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <StatusDot tone={tone} />
                  <span className="text-xs sm:text-sm font-medium text-ink truncate">
                    {d.department}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {d.onBreak > 0 && (
                    <span className="text-xs text-warning font-medium num-ltr">
                      استراحة {d.onBreak}
                    </span>
                  )}
                  <span className="num-ltr text-xs sm:text-sm font-semibold text-ink">
                    {d.active}/{d.total}
                  </span>
                </div>
              </GroupedRow>
            );
          })}
        </GroupedList>
      )}

      {latestHandover && (
        <GroupedList label="آخر تسليم">
          <GroupedRow onClick={onOpenHandoverModal || undefined}>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="text-xs sm:text-sm font-medium text-ink truncate">
                {latestHandover.from_actor || 'الوردية السابقة'}
                {latestHandover.to_actor ? ` ← ${latestHandover.to_actor}` : ''}
              </div>
              {latestHandover.summary_note && (
                <div className="text-xs text-ink-muted truncate">
                  {latestHandover.summary_note}
                </div>
              )}
            </div>
            {latestHandover.timestamp && (
              <span className="num-ltr text-xs font-medium text-ink-muted shrink-0">
                {formatShortTime(latestHandover.timestamp)}
              </span>
            )}
          </GroupedRow>
        </GroupedList>
      )}

      {/* 5. Clean Chronological Hairline Stream */}
      {canViewReports && (
        <DashboardActivityFeed
          data={data}
          canManageRecords={canManageRecords}
          isConnectedApi={isConnectedApi}
          onPreviewImage={onPreviewImage}
          onRefresh={onRefresh}
          onToast={onToast}
        />
      )}
    </div>
  );
}
