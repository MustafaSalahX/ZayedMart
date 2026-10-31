import React, { useCallback, useEffect, useState } from 'react';
import { apiRequest, formatRequestedQty } from '../lib/api.js';
import {
  buildShortagesWhatsAppText,
  exportRangeReportCsv,
  exportShortagesCsv,
  formatTimeArabic,
} from '../lib/exportUtils.js';

function shiftDateKey(baseDateKey, offsetDays) {
  const base = baseDateKey ? new Date(`${baseDateKey}T12:00:00`) : new Date();
  base.setDate(base.getDate() + offsetDays);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function AdminReportsPanel({
  data,
  canExportReports = false,
  onToast,
}) {
  const todayKey = data?.dateKey || shiftDateKey(null, 0);
  const [preset, setPreset] = useState('7days');
  const [fromDate, setFromDate] = useState(() => shiftDateKey(todayKey, -6));
  const [toDate, setToDate] = useState(todayKey);
  const [activeSection, setActiveSection] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);

  const fetchReport = useCallback(
    async (fDate, tDate) => {
      if (data?.connectionMode !== 'local_server') {
        // Graceful fallback in Direct Cloud mode using loaded snapshot
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
            breaksCount: (data?.attendanceLogs || []).filter((l) => l.action_type === 'break_start')
              .length,
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
        onToast?.(err.message || 'تعذر تحميل التقرير الشامل', 'error');
      } finally {
        setLoading(false);
      }
    },
    [data, onToast]
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

  return (
    <div className="space-y-4">
      {/* Date Range Filter + 1-Tap Export Controls */}
      <div className="g-card p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base sm:text-lg font-black text-[var(--g-text)] flex items-center gap-2">
              <span className="ms-icon filled text-xl text-[var(--g-primary)]">analytics</span>
              <span>مركز التقارير الشاملة والإحصائيات</span>
            </h3>
            <p className="text-xs text-[var(--g-text-muted)] mt-0.5">
              متابعة كاملة للحضور والتأخير، نواقص الصالة، الموردين، وملاحظات الكاميرات لأي فترة
            </p>
          </div>

          {canExportReports && report && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => exportRangeReportCsv(report)}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#146C2E] hover:bg-[#0F5223] text-white text-xs sm:text-sm font-black flex items-center gap-1.5 shadow-sm active:scale-95"
              >
                <span className="ms-icon text-lg">download</span>
                <span>تصدير التقرير الكامل Excel</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const txt = buildShortagesWhatsAppText(report.shortagesList || [], storeName);
                  window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
                }}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[var(--g-surface)] hover:bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-[var(--g-text)] text-xs sm:text-sm font-extrabold flex items-center gap-1.5 active:scale-95"
              >
                <span className="ms-icon text-lg text-[#146C2E]">share</span>
                <span>كشف النواقص واتساب</span>
              </button>
            </div>
          )}
        </div>

        {/* 1-Tap Date Presets */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: 'today', label: 'اليوم' },
            { id: 'yesterday', label: 'أمس' },
            { id: '7days', label: 'آخر 7 أيام' },
            { id: '30days', label: 'آخر 30 يوم' },
            { id: 'custom', label: 'فترة مخصصة 📅' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => (p.id === 'custom' ? setPreset('custom') : applyPreset(p.id))}
              className={`min-h-[42px] px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-extrabold border transition-all ${
                preset === p.id
                  ? 'bg-[var(--g-primary)] text-white border-[var(--g-primary)]'
                  : 'bg-[var(--g-surface-2)] text-[var(--g-text)] border-[var(--g-border)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-2xl bg-[var(--g-surface-2)] border border-[var(--g-border)] items-end">
            <div>
              <label className="block text-xs font-bold text-[var(--g-text-muted)] mb-1">من تاريخ</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="g-input min-h-[46px] num-ltr font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[var(--g-text-muted)] mb-1">إلى تاريخ</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="g-input min-h-[46px] num-ltr font-bold"
              />
            </div>
            <button
              type="button"
              onClick={() => fetchReport(fromDate, toDate)}
              className="min-h-[46px] rounded-xl bg-[var(--g-primary)] text-white font-black text-sm"
            >
              تحديث التقرير
            </button>
          </div>
        )}
      </div>

      {/* Report Sub-sections Navigation — 2x2 Touch Grid on Mobile */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 pb-1">
        {[
          { id: 'overview', label: 'ملخص الأرقام', icon: 'dashboard' },
          { id: 'shortages', label: `تقارير النواقص (${t.shortagesTotal || 0})`, icon: 'shopping_basket' },
          { id: 'employees', label: `التزام الموظفين (${report?.employeeStats?.length || 0})`, icon: 'badge' },
          { id: 'suppliers', label: `الموردون والعربيات (${report?.supplierStats?.length || 0})`, icon: 'local_shipping' },
        ].map((sec) => (
          <button
            key={sec.id}
            type="button"
            onClick={() => setActiveSection(sec.id)}
            className={`min-h-[46px] px-3 py-2 rounded-2xl sm:rounded-full text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 border transition-all active:scale-95 ${
              activeSection === sec.id
                ? 'bg-[var(--g-primary)] text-white border-[var(--g-primary)] shadow-sm'
                : 'bg-[var(--g-surface)] text-[var(--g-text)] border-[var(--g-border)]'
            }`}
          >
            <span className="ms-icon text-lg shrink-0">{sec.icon}</span>
            <span className="truncate">{sec.label}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="g-card p-8 text-center text-sm font-bold text-[var(--g-text-muted)]">
          جاري تجميع التقارير والإحصائيات...
        </div>
      ) : (
        <>
          {/* 1. OVERVIEW SECTION */}
          {activeSection === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {
                    label: 'نواقص مطلوبة الآن',
                    val: t.shortagesOpen || 0,
                    sub: `تم توفير ${t.shortagesResolved || 0} خلال الفترة`,
                    tone: 'text-[var(--g-red)]',
                  },
                  {
                    label: 'موظفون سجلوا حضور',
                    val: `${t.uniqueEmployeesPresent || 0} / ${t.totalActiveStaff || 0}`,
                    sub: `إجمالي الحركات: ${t.attendanceEvents || 0}`,
                    tone: 'text-[var(--g-green)]',
                  },
                  {
                    label: 'مرات التأخير المسجلة',
                    val: t.totalLateInstances || 0,
                    sub: `إجمالي ${t.totalLateMinutes || 0} دقيقة تأخير`,
                    tone: 'text-[var(--g-yellow)]',
                  },
                  {
                    label: 'عربيات الموردين',
                    val: t.trucksTotal || 0,
                    sub: `متوسط التنزيل: ${t.avgUnloadMinutes || 0} د`,
                    tone: 'text-[var(--g-primary)]',
                  },
                ].map((card) => (
                  <div key={card.label} className="g-card p-4 space-y-1">
                    <div className="text-xs font-bold text-[var(--g-text-muted)]">{card.label}</div>
                    <div className={`text-2xl sm:text-3xl font-black num-ltr ${card.tone}`}>
                      {card.val}
                    </div>
                    <div className="text-[11px] text-[var(--g-text-muted)]">{card.sub}</div>
                  </div>
                ))}
              </div>

              {/* Shortages by Category Breakdown */}
              {(report?.shortagesByCategory || []).length > 0 && (
                <div className="g-card p-4 sm:p-5 space-y-3">
                  <h4 className="text-sm sm:text-base font-black text-[var(--g-text)]">
                    توزيع النواقص حسب أقسام السوبر ماركت
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {report.shortagesByCategory.map((cat) => (
                      <div
                        key={cat.category}
                        className="p-3 rounded-2xl bg-[var(--g-surface-2)] border border-[var(--g-border)] flex items-center justify-between"
                      >
                        <div>
                          <div className="font-extrabold text-sm text-[var(--g-text)]">
                            {cat.category}
                          </div>
                          <div className="text-xs text-[var(--g-text-muted)]">
                            إجمالي البلاغات: {cat.total} • تم توفير: {cat.resolved}
                          </div>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-black ${
                            cat.open > 0
                              ? 'bg-[var(--g-red-bg)] text-[var(--g-red)]'
                              : 'bg-[var(--g-green-bg)] text-[var(--g-green)]'
                          }`}
                        >
                          مفتوح: {cat.open}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. SHORTAGES REPORT SECTION */}
          {activeSection === 'shortages' && (
            <div className="space-y-4">
              {(report?.topShortageItems || []).length > 0 && (
                <div className="g-card p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h4 className="text-sm sm:text-base font-black text-[var(--g-text)]">
                      الأصناف الأكثر طلباً ونفاداً خلال الفترة
                    </h4>
                    {canExportReports && (
                      <button
                        type="button"
                        onClick={() =>
                          exportShortagesCsv(
                            report.shortagesList || [],
                            `${fromDate}_${toDate}`
                          )
                        }
                        className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[var(--g-surface)] hover:bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-[var(--g-text)] text-xs font-extrabold"
                      >
                        تصدير شيت النواقص Excel
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {report.topShortageItems.map((it) => (
                      <div
                        key={it.item_name}
                        className="p-3 rounded-2xl bg-[var(--g-surface-2)] border border-[var(--g-border)] flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-extrabold text-sm text-[var(--g-text)] truncate">
                            {it.item_name}
                          </div>
                          <div className="text-xs text-[var(--g-text-muted)]">
                            {it.category} • الكمية الأخيرة:{' '}
                            <strong>{formatRequestedQty(it.latestQty, it.unit)}</strong>
                          </div>
                        </div>
                        <span className="px-2.5 py-1 rounded-xl bg-[var(--g-primary-container)] text-[var(--g-on-primary-container)] text-xs font-black shrink-0">
                          تكرر {it.timesReported} مرة
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="g-card p-4 sm:p-5 space-y-3">
                <h4 className="text-sm sm:text-base font-black text-[var(--g-text)]">
                  سجل النواقص التفصيلي ({(report?.shortagesList || []).length})
                </h4>
                {(report?.shortagesList || []).length === 0 ? (
                  <p className="text-center py-6 text-xs text-[var(--g-text-muted)]">
                    لا توجد نواقص مسجلة في هذه الفترة.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {report.shortagesList.map((sh) => (
                      <div
                        key={sh.id}
                        className="p-3 rounded-2xl bg-[var(--g-surface-2)] border border-[var(--g-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-extrabold text-sm text-[var(--g-text)]">
                            {sh.item_name}{' '}
                            <span className="text-xs font-bold text-[var(--g-primary)]">
                              ({formatRequestedQty(sh.requested_qty, sh.unit)})
                            </span>
                          </div>
                          <div className="text-xs text-[var(--g-text-muted)]">
                            {sh.category} • سجله: {sh.recorded_by} • {sh.date_key}{' '}
                            {formatTimeArabic(sh.created_at)}
                          </div>
                        </div>
                        <span
                          className={`self-start sm:self-center px-2.5 py-1 rounded-full text-xs font-extrabold ${
                            sh.status === 'resolved'
                              ? 'bg-[var(--g-green-bg)] text-[var(--g-green)]'
                              : sh.status === 'ordered'
                              ? 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]'
                              : 'bg-[var(--g-red-bg)] text-[var(--g-red)]'
                          }`}
                        >
                          {sh.status === 'resolved'
                            ? 'تم التوفير ✓'
                            : sh.status === 'ordered'
                            ? 'تم الطلب 🚚'
                            : 'مطلوب الآن'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. EMPLOYEES REPORT SECTION */}
          {activeSection === 'employees' && (
            <div className="g-card p-4 sm:p-5 space-y-3">
              <h4 className="text-sm sm:text-base font-black text-[var(--g-text)]">
                تقرير حضور والتزام الموظفين ({fromDate} إلى {toDate})
              </h4>
              {(report?.employeeStats || []).length === 0 ? (
                <p className="text-center py-6 text-xs text-[var(--g-text-muted)]">
                  لا توجد بيانات موظفين في هذه الفترة.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {report.employeeStats.map((emp) => (
                    <div
                      key={emp.id}
                      className="p-3.5 rounded-2xl bg-[var(--g-surface-2)] border border-[var(--g-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="font-extrabold text-sm sm:text-base text-[var(--g-text)]">
                          {emp.name}{' '}
                          {emp.emp_code && (
                            <span className="text-xs text-[var(--g-primary)] num-ltr">
                              #{emp.emp_code}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--g-text-muted)]">
                          {emp.department} • مواعيد الشفت: {emp.shift_start}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 sm:flex items-center gap-2 text-center">
                        <div className="px-3 py-1.5 rounded-xl bg-[var(--g-surface)] border border-[var(--g-border)]">
                          <div className="text-[10px] text-[var(--g-text-muted)]">أيام الحضور</div>
                          <div className="text-sm font-black text-[var(--g-green)] num-ltr">
                            {emp.daysPresent}
                          </div>
                        </div>
                        <div className="px-3 py-1.5 rounded-xl bg-[var(--g-surface)] border border-[var(--g-border)]">
                          <div className="text-[10px] text-[var(--g-text-muted)]">تأخير</div>
                          <div className="text-sm font-black text-[var(--g-red)] num-ltr">
                            {emp.lateCount} ({emp.totalLateMinutes}د)
                          </div>
                        </div>
                        <div className="px-3 py-1.5 rounded-xl bg-[var(--g-surface)] border border-[var(--g-border)]">
                          <div className="text-[10px] text-[var(--g-text-muted)]">استراحات</div>
                          <div className="text-sm font-black text-[var(--g-text)] num-ltr">
                            {emp.breaksCount}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 4. SUPPLIERS REPORT SECTION */}
          {activeSection === 'suppliers' && (
            <div className="g-card p-4 sm:p-5 space-y-3">
              <h4 className="text-sm sm:text-base font-black text-[var(--g-text)]">
                تقرير عربيات الموردين وزمن التنزيل والمرتجعات
              </h4>
              {(report?.supplierStats || []).length === 0 ? (
                <p className="text-center py-6 text-xs text-[var(--g-text-muted)]">
                  لا توجد عربيات موردين مسجلة في هذه الفترة.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {report.supplierStats.map((sup) => (
                    <div
                      key={sup.id}
                      className="p-3.5 rounded-2xl bg-[var(--g-surface-2)] border border-[var(--g-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="font-extrabold text-sm sm:text-base text-[var(--g-text)] flex items-center gap-2 flex-wrap">
                          <span>{sup.name}</span>
                          {sup.hasPendingReturn && (
                            <span className="px-2 py-0.5 rounded-full bg-[var(--g-yellow-bg)] text-[var(--g-yellow)] text-[11px] font-black">
                              مرتجع معلق ⚠️
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--g-text-muted)]">{sup.category}</div>
                      </div>

                      <div className="grid grid-cols-3 sm:flex items-center gap-2 text-center">
                        <div className="px-3 py-1.5 rounded-xl bg-[var(--g-surface)] border border-[var(--g-border)]">
                          <div className="text-[10px] text-[var(--g-text-muted)]">الطلبيات</div>
                          <div className="text-sm font-black text-[var(--g-primary)] num-ltr">
                            {sup.deliveriesCount}
                          </div>
                        </div>
                        <div className="px-3 py-1.5 rounded-xl bg-[var(--g-surface)] border border-[var(--g-border)]">
                          <div className="text-[10px] text-[var(--g-text-muted)]">متوسط التنزيل</div>
                          <div className="text-sm font-black text-[var(--g-text)] num-ltr">
                            {sup.avgDurationMinutes} د
                          </div>
                        </div>
                        <div className="px-3 py-1.5 rounded-xl bg-[var(--g-surface)] border border-[var(--g-border)]">
                          <div className="text-[10px] text-[var(--g-text-muted)]">نواقص/مرتجع</div>
                          <div className="text-sm font-black text-[var(--g-red)] num-ltr">
                            {sup.issuesCount}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
