import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  CockpitMetricStrip,
  EmptyState,
  FilterChipRail,
  GroupedList,
  SearchFilterBar,
  SectionHeader,
  SkeletonKpiStrip,
  SkeletonList,
  StatusDot,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/index.js';
import {
  apiRequest,
  formatRequestedQty,
} from '../lib/api.js';
import {
  buildShortagesWhatsAppText,
  exportRangeReportCsv,
  exportRangeReportWord,
  exportShortagesCsv,
  exportShortagesWord,
  formatTimeArabic,
  openWhatsAppShare,
} from '../lib/exportUtils.js';

function shiftDateKey(baseDateKey, offsetDays) {
  const base = baseDateKey ? new Date(`${baseDateKey}T12:00:00`) : new Date();
  base.setDate(base.getDate() + offsetDays);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Detoxed Multi-Day Reports & Analytics Panel (`التقارير`).
 * Pure date range header, `<CockpitMetricStrip />`, and hairline-divided tabular `<GroupedList>` rows
 * with zero nested mini stat boxes and zero progress-bar clutter.
 */
export default function AdminReportsPanel({
  data,
  canExportReports = false,
  isOwner = false,
  onOpenPersonLog,
  onToast,
}) {
  const todayKey = data?.dateKey || shiftDateKey(null, 0);
  const [preset, setPreset] = useState('7days');
  const [fromDate, setFromDate] = useState(() => shiftDateKey(todayKey, -6));
  const [toDate, setToDate] = useState(todayKey);
  const [activeSection, setActiveSection] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);

  const [exportingRangeExcel, setExportingRangeExcel] = useState(false);
  const [exportingShortagesExcel, setExportingShortagesExcel] = useState(false);

  const [shortageSearch, setShortageSearch] = useState('');
  const [showAllShortages, setShowAllShortages] = useState(false);
  const [empSearch, setEmpSearch] = useState('');
  const [empSort, setEmpSort] = useState('present');
  const [supSearch, setSupSearch] = useState('');
  const [supSort, setSupSort] = useState('deliveries');

  const isFallbackMode =
    data?.connectionMode === 'direct_cloud' || data?.connectionMode === 'offline_cached';

  const fetchReport = useCallback(
    async (fDate, tDate) => {
      if (isFallbackMode) {
        const shList = data?.shortages || [];
        setReport({
          period: { from: fDate, to: tDate },
          totals: {
            totalActiveStaff: (data?.employees || []).length,
            attendanceEvents: (data?.attendanceLogs || []).length,
            uniqueEmployeesPresent: data?.summary?.presentCount || 0,
            totalLateInstances: data?.summary?.lateCount || 0,
            totalLateMinutes: (data?.attendanceLogs || []).reduce(
              (acc, l) => acc + (l.late_minutes || 0),
              0
            ),
            breaksCount: (data?.attendanceLogs || []).filter(
              (l) => l.action_type === 'break_start'
            ).length,
            trucksTotal: (data?.truckLogs || []).length,
            trucksCompleted: data?.summary?.completedTrucksCount || 0,
            avgUnloadMinutes: 0,
            trucksWithShortage: data?.summary?.issuesTrucksCount || 0,
            trucksWithReturn: 0,
            shortagesTotal: shList.length,
            shortagesOpen: shList.filter((s) => s.status === 'open').length,
            shortagesOrdered: shList.filter((s) => s.status === 'ordered').length,
            shortagesResolved: shList.filter((s) => s.status === 'resolved').length,
            shortagesOutOfStock: shList.filter(
              (s) => s.status !== 'resolved' && s.urgency === 'out_of_stock'
            ).length,
            notesTotal: (data?.notes || []).length,
            urgentNotes: data?.summary?.urgentNotesCount || 0,
            openHandoverNotes: data?.summary?.openHandoverNotesCount || 0,
          },
          employeeStats: [],
          supplierStats: [],
          shortagesByCategory: [],
          topShortageItems: [],
          shortagesList: shList,
          notes: data?.notes || [],
        });
        return;
      }

      setLoading(true);
      try {
        const res = await apiRequest(
          `/api/reports/range?from=${encodeURIComponent(fDate)}&to=${encodeURIComponent(tDate)}`
        );
        setReport(res);
      } catch (err) {
        onToast?.(err?.message || 'تعذر تحميل التقرير', 'error');
      } finally {
        setLoading(false);
      }
    },
    [data, isFallbackMode, onToast]
  );

  useEffect(() => {
    fetchReport(fromDate, toDate);
  }, [fetchReport, fromDate, toDate]);

  function applyPreset(id) {
    setPreset(id);
    if (id === 'today') {
      setFromDate(todayKey);
      setToDate(todayKey);
    } else if (id === 'yesterday') {
      const y = shiftDateKey(todayKey, -1);
      setFromDate(y);
      setToDate(y);
    } else if (id === '7days') {
      setFromDate(shiftDateKey(todayKey, -6));
      setToDate(todayKey);
    } else if (id === '30days') {
      setFromDate(shiftDateKey(todayKey, -29));
      setToDate(todayKey);
    }
  }

  const t = report?.totals || {};
  const storeName = data?.settings?.store_name || 'زايد مارت';
  const branchName = data?.settings?.branch_name || '';

  const overviewMetrics = useMemo(
    () => [
      {
        id: 'shortages',
        label: 'النواقص',
        value: t.shortagesOpen || 0,
        secondary:
          (t.shortagesOutOfStock || 0) > 0
            ? `${t.shortagesOutOfStock} نفد · توفّر ${t.shortagesResolved || 0}`
            : `توفّر ${t.shortagesResolved || 0}`,
        tone: (t.shortagesOpen || 0) > 0 ? 'danger' : 'neutral',
        dotTone: (t.shortagesOpen || 0) > 0 ? 'danger' : '',
        onClick: () => setActiveSection('shortages'),
      },
      {
        id: 'attendance',
        label: 'الحضور',
        value: t.uniqueEmployeesPresent || 0,
        secondary: `من ${t.totalActiveStaff || 0} · ${t.attendanceEvents || 0} حركة`,
        tone: 'neutral',
        onClick: () => setActiveSection('employees'),
      },
      {
        id: 'late',
        label: 'التأخير',
        value: t.totalLateInstances || 0,
        secondary:
          (t.totalLateMinutes || 0) > 0
            ? `${t.totalLateMinutes}د · ${t.breaksCount || 0} بريك`
            : `${t.breaksCount || 0} بريك`,
        tone: (t.totalLateInstances || 0) > 0 ? 'warning' : 'neutral',
        dotTone: (t.totalLateInstances || 0) > 0 ? 'warning' : '',
        onClick: () => setActiveSection('employees'),
      },
      {
        id: 'trucks',
        label: 'العربيات',
        value: t.trucksTotal || 0,
        secondary:
          (t.trucksWithShortage || 0) > 0
            ? `متوسط ${t.avgUnloadMinutes || 0}د · ${t.trucksWithShortage} ملاحظات`
            : `متوسط ${t.avgUnloadMinutes || 0}د`,
        tone: (t.trucksWithShortage || 0) > 0 ? 'danger' : 'neutral',
        dotTone: (t.trucksWithShortage || 0) > 0 ? 'danger' : '',
        onClick: () => setActiveSection('suppliers'),
      },
    ],
    [t]
  );

  const filteredShortages = useMemo(() => {
    const list = report?.shortagesList || [];
    const q = shortageSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((sh) =>
      `${sh.item_name} ${sh.category} ${sh.recorded_by || ''}`.toLowerCase().includes(q)
    );
  }, [report?.shortagesList, shortageSearch]);

  const filteredEmployees = useMemo(() => {
    const list = [...(report?.employeeStats || [])];
    const q = empSearch.trim().toLowerCase();
    const matched = q
      ? list.filter((e) =>
          `${e.name} ${e.emp_code || ''} ${e.department}`.toLowerCase().includes(q)
        )
      : list;

    return matched.sort((a, b) => {
      if (empSort === 'late') {
        return (
          (b.lateCount || 0) - (a.lateCount || 0) ||
          (b.totalLateMinutes || 0) - (a.totalLateMinutes || 0)
        );
      }
      if (empSort === 'breaks') {
        return (b.breaksCount ?? b.breaks ?? 0) - (a.breaksCount ?? a.breaks ?? 0);
      }
      return (b.daysPresent || 0) - (a.daysPresent || 0);
    });
  }, [report?.employeeStats, empSearch, empSort]);

  const filteredSuppliers = useMemo(() => {
    const list = [...(report?.supplierStats || [])];
    const q = supSearch.trim().toLowerCase();
    const matched = q
      ? list.filter((s) =>
          `${s.name || s.supplier_name} ${s.category}`.toLowerCase().includes(q)
        )
      : list;

    return matched.sort((a, b) => {
      if (supSort === 'duration') {
        return (b.avgDurationMinutes || 0) - (a.avgDurationMinutes || 0);
      }
      if (supSort === 'issues') {
        return (
          (b.issuesCount || 0) +
          (b.hasPendingReturn ? 1 : 0) -
          ((a.issuesCount || 0) + (a.hasPendingReturn ? 1 : 0))
        );
      }
      return (b.deliveriesCount || 0) - (a.deliveriesCount || 0);
    });
  }, [report?.supplierStats, supSearch, supSort]);

  async function handleExportRangeExcel() {
    if (!report || exportingRangeExcel) return;
    setExportingRangeExcel(true);
    try {
      await exportRangeReportCsv(report, storeName, branchName);
      onToast?.('تم تصدير Excel');
    } catch (err) {
      onToast?.(err?.message || 'تعذر تصدير Excel', 'error');
    } finally {
      setExportingRangeExcel(false);
    }
  }

  async function handleExportShortagesExcel() {
    if (!report || exportingShortagesExcel) return;
    setExportingShortagesExcel(true);
    try {
      await exportShortagesCsv(
        report.shortagesList || [],
        `${fromDate}_${toDate}`,
        storeName
      );
      onToast?.('تم تصدير كشف النواقص');
    } catch (err) {
      onToast?.(err?.message || 'تعذر تصدير كشف النواقص', 'error');
    } finally {
      setExportingShortagesExcel(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <SectionHeader
          title="التقارير"
          subtitle={`${fromDate} — ${toDate}`}
          actions={
            canExportReports &&
            report && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="table_view"
                  loading={exportingRangeExcel}
                  onClick={handleExportRangeExcel}
                >
                  Excel
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="description"
                  onClick={() => {
                    exportRangeReportWord(report, storeName, branchName);
                    onToast?.('تم تصدير Word');
                  }}
                >
                  Word
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="share"
                  onClick={() => {
                    const txt = buildShortagesWhatsAppText(
                      report.shortagesList || [],
                      storeName
                    );
                    openWhatsAppShare(txt);
                    onToast?.('تم تجهيز التقرير لواتساب');
                  }}
                >
                  واتساب
                </Button>
              </div>
            )
          }
        />

        <FilterChipRail
          activeId={preset}
          onSelect={(id) => (id === 'custom' ? setPreset('custom') : applyPreset(id))}
          items={[
            { id: 'today', label: 'اليوم' },
            { id: 'yesterday', label: 'أمس' },
            { id: '7days', label: '7 أيام' },
            { id: '30days', label: '30 يوم' },
            { id: 'custom', label: 'مخصص' },
          ]}
        />

        {preset === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 py-2 border-y border-line items-end">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                من
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="g-input num-ltr"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                إلى
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="g-input num-ltr"
              />
            </div>
            <Button
              variant="primary"
              size="md"
              fullWidth
              onClick={() => fetchReport(fromDate, toDate)}
            >
              تحديث
            </Button>
          </div>
        )}

        {isFallbackMode && (
          <div className="text-xs font-medium text-warning">
            وضع أوفلاين — عرض بيانات اليوم فقط
          </div>
        )}
      </div>

      <FilterChipRail
        activeId={activeSection}
        onSelect={setActiveSection}
        items={[
          { id: 'overview', label: 'الملخص' },
          {
            id: 'shortages',
            label: 'النواقص',
            count: t.shortagesTotal || 0,
            alert: (t.shortagesOpen || 0) > 0,
          },
          {
            id: 'employees',
            label: 'الموظفون',
            count: report?.employeeStats?.length || 0,
          },
          {
            id: 'suppliers',
            label: 'الموردون',
            count: report?.supplierStats?.length || 0,
          },
        ]}
      />

      {loading ? (
        <div className="space-y-4">
          <SkeletonKpiStrip count={4} />
          <SkeletonList rows={4} />
        </div>
      ) : (
        <>
          {/* 1. OVERVIEW */}
          {activeSection === 'overview' && (
            <div className="space-y-6">
              <CockpitMetricStrip items={overviewMetrics} columns={4} />

              {(report?.shortagesByCategory || []).length > 0 && (
                <GroupedList
                  label="النواقص حسب القسم"
                  count={report.shortagesByCategory.length}
                >
                  {report.shortagesByCategory.map((cat) => (
                    <div
                      key={cat.category}
                      className="min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <StatusDot tone={cat.open > 0 ? 'danger' : 'success'} />
                        <span className="text-xs sm:text-sm font-medium text-ink truncate">
                          {cat.category}
                        </span>
                      </div>
                      <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-3 flex-wrap text-xs num-ltr shrink-0">
                        <span className={cat.open > 0 ? 'text-danger font-semibold' : 'text-ink-muted'}>
                          مفتوح {cat.open}
                        </span>
                        <span className="text-ink-muted">توفّر {cat.resolved}</span>
                        <span className="font-semibold text-ink">{cat.total}</span>
                      </div>
                    </div>
                  ))}
                </GroupedList>
              )}
            </div>
          )}

          {/* 2. SHORTAGES */}
          {activeSection === 'shortages' && (
            <div className="space-y-6">
              {(report?.topShortageItems || []).length > 0 && (
                <GroupedList
                  label="الأكثر تكراراً"
                  count={report.topShortageItems.length}
                  actions={
                    canExportReports ? (
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={exportingShortagesExcel}
                          onClick={handleExportShortagesExcel}
                        >
                          Excel
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            exportShortagesWord(
                              report.shortagesList || [],
                              `${fromDate}_${toDate}`,
                              storeName
                            );
                            onToast?.('تم تصدير كشف النواقص');
                          }}
                        >
                          Word
                        </Button>
                      </div>
                    ) : null
                  }
                >
                  {report.topShortageItems.map((it) => (
                    <div
                      key={it.item_name}
                      className="min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-medium text-ink truncate">
                          {it.item_name}
                        </div>
                        <div className="text-xs text-ink-muted truncate">
                          {it.category} · {formatRequestedQty(it.latestQty, it.unit)}
                        </div>
                      </div>
                      <span className="num-ltr text-xs font-semibold text-ink shrink-0">
                        ×{it.timesReported}
                      </span>
                    </div>
                  ))}
                </GroupedList>
              )}

              <div className="space-y-3">
                <SectionHeader title="سجل النواقص" count={filteredShortages.length} />

                {(report?.shortagesList || []).length > 4 && (
                  <SearchFilterBar
                    value={shortageSearch}
                    onChange={setShortageSearch}
                    placeholder="بحث باسم الصنف أو القسم..."
                  />
                )}

                {filteredShortages.length === 0 ? (
                  <EmptyState compact title="لا توجد نواقص في هذه الفترة" />
                ) : (
                  <>
                    <GroupedList>
                      {(showAllShortages
                        ? filteredShortages
                        : filteredShortages.slice(0, 15)
                      ).map((sh) => {
                        const tone =
                          sh.status === 'resolved'
                            ? 'success'
                            : sh.status === 'ordered'
                            ? 'warning'
                            : 'danger';
                        const statusLabel =
                          sh.status === 'resolved'
                            ? 'توفّر'
                            : sh.status === 'ordered'
                            ? 'تم الطلب'
                            : 'مطلوب';

                        return (
                          <div
                            key={sh.id}
                            className="min-h-[52px] px-3.5 py-2.5 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-xs sm:text-sm font-medium text-ink truncate">
                                {sh.item_name}{' '}
                                <span className="text-ink-muted font-normal">
                                  · {formatRequestedQty(sh.requested_qty, sh.unit)}
                                </span>
                              </div>
                              <div className="text-xs text-ink-muted truncate">
                                {sh.category} · {sh.recorded_by} ·{' '}
                                <span className="num-ltr">
                                  {sh.date_key} {formatTimeArabic(sh.created_at)}
                                </span>
                              </div>
                            </div>
                            <StatusDot tone={tone} label={statusLabel} tintedText />
                          </div>
                        );
                      })}
                    </GroupedList>

                    {filteredShortages.length > 15 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        fullWidth
                        onClick={() => setShowAllShortages((v) => !v)}
                      >
                        {showAllShortages
                          ? 'عرض أقل'
                          : `عرض الكل (${filteredShortages.length})`}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* 3. EMPLOYEES */}
          {activeSection === 'employees' && (
            <div className="space-y-3">
              <SectionHeader title="التزام الموظفين" count={filteredEmployees.length} />

              {(report?.employeeStats || []).length > 0 && (
                <div className="space-y-2.5">
                  <SearchFilterBar
                    value={empSearch}
                    onChange={setEmpSearch}
                    placeholder="بحث باسم الموظف أو القسم..."
                  />
                  <FilterChipRail
                    activeId={empSort}
                    onSelect={setEmpSort}
                    items={[
                      { id: 'present', label: 'الأكثر حضوراً' },
                      { id: 'late', label: 'الأكثر تأخيراً' },
                      { id: 'breaks', label: 'الاستراحات' },
                    ]}
                  />
                </div>
              )}

              {filteredEmployees.length === 0 ? (
                <EmptyState compact title="لا توجد بيانات موظفين" />
              ) : (
                <>
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="min-w-[180px]">الموظف</TableHead>
                          <TableHead>القسم والشفت</TableHead>
                          <TableHead>الحضور</TableHead>
                          <TableHead>التأخير</TableHead>
                          <TableHead>الاستراحات</TableHead>
                          {onOpenPersonLog && (
                            <TableHead className="text-end">إجراءات</TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredEmployees.map((emp) => {
                          const breaksVal = emp.breaksCount ?? emp.breaks ?? 0;
                          return (
                            <TableRow key={emp.id}>
                              <TableCell>
                                <div className="text-sm font-semibold text-ink">
                                  {emp.name}
                                  {isOwner && emp.emp_code && (
                                    <span className="num-ltr text-xs font-normal text-ink-muted">
                                      {' '}
                                      · #{emp.emp_code}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className="text-xs text-ink-muted num-ltr">
                                  {emp.department} · {emp.shift_start || '08:00'}–
                                  {emp.shift_end || '20:00'}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span className="num-ltr text-xs font-semibold text-ink">
                                  {emp.daysPresent} يوم
                                </span>
                              </TableCell>
                              <TableCell>
                                <StatusDot
                                  tone={emp.lateCount > 0 ? 'warning' : 'success'}
                                  tintedText={emp.lateCount > 0}
                                  label={
                                    <span className="num-ltr">
                                      {emp.lateCount > 0
                                        ? `${emp.lateCount} تأخير${
                                            emp.totalLateMinutes > 0
                                              ? ` (${emp.totalLateMinutes}د)`
                                              : ''
                                          }`
                                        : 'منتظم'}
                                    </span>
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <span className="num-ltr text-xs text-ink-muted">
                                  {breaksVal} بريك
                                </span>
                              </TableCell>
                              {onOpenPersonLog && (
                                <TableCell className="text-end">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onOpenPersonLog(emp.id, emp.name)}
                                  >
                                    سجل
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="md:hidden">
                    <GroupedList>
                      {filteredEmployees.map((emp) => {
                        const breaksVal = emp.breaksCount ?? emp.breaks ?? 0;
                        return (
                          <div
                            key={emp.id}
                            className="min-h-[56px] px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-ink truncate">
                                {emp.name}
                                {isOwner && emp.emp_code && (
                                  <span className="num-ltr text-xs font-normal text-ink-muted">
                                    {' '}
                                    · #{emp.emp_code}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-ink-muted truncate num-ltr">
                                {emp.department} · {emp.shift_start || '08:00'}–{emp.shift_end || '20:00'}
                              </div>
                            </div>

                            <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-3 flex-wrap text-xs num-ltr shrink-0">
                              <span className="font-semibold text-ink">
                                {emp.daysPresent} يوم
                              </span>
                              <span
                                className={
                                  emp.lateCount > 0
                                    ? 'text-danger font-semibold'
                                    : 'text-ink-muted'
                                }
                              >
                                {emp.lateCount} تأخير
                                {emp.totalLateMinutes > 0 ? ` (${emp.totalLateMinutes}د)` : ''}
                              </span>
                              <span className="text-ink-muted">{breaksVal} بريك</span>
                              {onOpenPersonLog && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onOpenPersonLog(emp.id, emp.name)}
                                >
                                  سجل
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </GroupedList>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 4. SUPPLIERS */}
          {activeSection === 'suppliers' && (
            <div className="space-y-3">
              <SectionHeader title="الموردون" count={filteredSuppliers.length} />

              {(report?.supplierStats || []).length > 0 && (
                <div className="space-y-2.5">
                  <SearchFilterBar
                    value={supSearch}
                    onChange={setSupSearch}
                    placeholder="بحث باسم المورد..."
                  />
                  <FilterChipRail
                    activeId={supSort}
                    onSelect={setSupSort}
                    items={[
                      { id: 'deliveries', label: 'الأكثر توريداً' },
                      { id: 'duration', label: 'مدة التنزيل' },
                      { id: 'issues', label: 'الملاحظات' },
                    ]}
                  />
                </div>
              )}

              {filteredSuppliers.length === 0 ? (
                <EmptyState compact title="لا توجد عربيات في هذه الفترة" />
              ) : (
                <>
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="min-w-[180px]">المورد</TableHead>
                          <TableHead>القسم</TableHead>
                          <TableHead>الطلبيات</TableHead>
                          <TableHead>متوسط التنزيل</TableHead>
                          <TableHead>الملاحظات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSuppliers.map((sup) => (
                          <TableRow key={sup.id || sup.supplier_name || sup.name}>
                            <TableCell>
                              <span className="text-sm font-semibold text-ink">
                                {sup.name || sup.supplier_name}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-ink-muted">
                                {sup.category || '—'}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="num-ltr text-xs font-semibold text-ink">
                                {sup.deliveriesCount} طلبية
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="num-ltr text-xs text-ink-muted">
                                {sup.avgDurationMinutes}د
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2 flex-wrap">
                                <StatusDot
                                  tone={
                                    sup.issuesCount > 0
                                      ? 'danger'
                                      : sup.hasPendingReturn
                                      ? 'warning'
                                      : 'success'
                                  }
                                  tintedText={
                                    sup.issuesCount > 0 || sup.hasPendingReturn
                                  }
                                  label={
                                    <span className="num-ltr">
                                      {sup.issuesCount} ملاحظات
                                    </span>
                                  }
                                />
                                {sup.hasPendingReturn && (
                                  <span className="text-xs font-medium text-warning">
                                    · مرتجع
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="md:hidden">
                    <GroupedList>
                      {filteredSuppliers.map((sup) => (
                        <div
                          key={sup.id || sup.supplier_name || sup.name}
                          className="min-h-[54px] px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2 min-w-0">
                              <span className="text-sm font-semibold text-ink truncate">
                                {sup.name || sup.supplier_name}
                              </span>
                              {sup.hasPendingReturn && (
                                <span className="text-xs font-medium text-warning shrink-0">
                                  مرتجع
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-ink-muted truncate">
                              {sup.category}
                            </div>
                          </div>

                          <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-3 flex-wrap text-xs num-ltr shrink-0">
                            <span className="font-semibold text-ink">
                              {sup.deliveriesCount} طلبية
                            </span>
                            <span className="text-ink-muted">{sup.avgDurationMinutes}د</span>
                            <span
                              className={
                                sup.issuesCount > 0
                                  ? 'text-danger font-semibold'
                                  : 'text-ink-muted'
                              }
                            >
                              {sup.issuesCount} ملاحظات
                            </span>
                          </div>
                        </div>
                      ))}
                    </GroupedList>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
