import React, { useEffect, useState } from 'react';
import { fetchPersonLog } from '../lib/api.js';
import {
  ACTION_LABELS,
  buildPersonLogWhatsAppText,
  exportPersonLogCsv,
  exportPersonLogWord,
  formatQtyForExport,
  formatTimeArabic,
  openWhatsAppShare,
} from '../lib/exportUtils.js';

export default function PersonLogModal({ open, personId, personName, onClose, onToast }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('attendance');

  useEffect(() => {
    if (!open || !personId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetchPersonLog(personId);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) onToast?.(err.message || 'تعذر تحميل سجل الموظف', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open, personId]);

  if (!open) return null;

  const p = data?.person || { name: personName || 'الموظف' };
  const stats = data?.stats || {};
  const attLogs = data?.attendanceLogs || [];
  const shortages = data?.shortages || [];
  const notes = data?.notes || [];
  const auditLogs = data?.auditLogs || [];

  return (
    <div onClick={onClose} className="g-modal-overlay">
      <div
        onClick={(e) => e.stopPropagation()}
        className="g-dialog-sheet max-w-3xl animate-pop space-y-4"
      >
        <div className="g-sheet-handle" />

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--g-border)]">
          <div className="flex items-center gap-2.5">
            <div
              className="w-11 h-11 rounded-2xl text-white font-extrabold flex items-center justify-center shrink-0"
              style={{ backgroundColor: p.avatar_color || '#0B57D0' }}
            >
              {(p.name || 'م').slice(0, 1)}
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-extrabold m-0">
                السجل الفردي الكامل — {p.name}
              </h3>
              <p className="text-xs text-[var(--g-muted)] m-0">
                {p.department || p.role_label || 'موظف'} • شفت 12 ساعة:{' '}
                <span className="num-ltr font-bold">
                  {p.shift_start || '08:00'} → {p.shift_end || '20:00'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {data && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    exportPersonLogCsv(data);
                    onToast?.('تم تصدير سجل الموظف لملف Excel ✓');
                  }}
                  className="px-3 py-1.5 rounded-full bg-[var(--g-green-bg)] text-[var(--g-green)] text-xs font-extrabold flex items-center gap-1"
                >
                  <span className="ms-icon text-sm">table_view</span>
                  <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    exportPersonLogWord(data);
                    onToast?.('تم تصدير سجل الموظف لملف Word ✓');
                  }}
                  className="px-3 py-1.5 rounded-full bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] text-xs font-extrabold flex items-center gap-1"
                >
                  <span className="ms-icon text-sm">description</span>
                  <span>Word</span>
                </button>
                <button
                  type="button"
                  onClick={() => openWhatsAppShare(buildPersonLogWhatsAppText(data))}
                  className="px-3 py-1.5 rounded-full bg-[#25D366]/15 text-[#128C7E] dark:text-[#4ADE80] text-xs font-extrabold flex items-center gap-1"
                >
                  <span className="ms-icon text-sm">share</span>
                  <span>واتساب</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center"
            >
              <span className="ms-icon">close</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs font-bold text-[var(--g-muted)]">
            جاري تحميل السجل الكامل لـ {p.name}...
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="p-3 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)]">
                <div className="text-[11px] text-[var(--g-muted)] font-bold">مرات الحضور / الانصراف</div>
                <div className="text-base font-black mt-0.5 num-ltr">
                  {stats.totalCheckIns || 0} حضور / {stats.totalCheckOuts || 0} انصراف
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)]">
                <div className="text-[11px] text-[var(--g-muted)] font-bold">الاستراحات والوقت المستغرق</div>
                <div className="text-base font-black mt-0.5 text-[var(--g-yellow)]">
                  {stats.totalBreaks || 0} ({stats.totalBreakMinutes || 0} دقيقة)
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)]">
                <div className="text-[11px] text-[var(--g-muted)] font-bold">النواقص والمقترحات</div>
                <div className="text-base font-black mt-0.5 text-[var(--g-primary)]">
                  {stats.shortagesReported || 0} ({stats.suggestionsReported || 0} مقترح)
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)]">
                <div className="text-[11px] text-[var(--g-muted)] font-bold">الملاحظات والحركات</div>
                <div className="text-base font-black mt-0.5">
                  {stats.notesRecorded || 0} ملاحظة • {stats.auditActionsCount || 0} حركة
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
              {[
                { id: 'attendance', label: `الحضور والاستراحات (${attLogs.length})`, icon: 'schedule' },
                { id: 'shortages', label: `النواقص والمقترحات (${shortages.length})`, icon: 'inventory_2' },
                { id: 'notes', label: `الملاحظات (${notes.length})`, icon: 'sticky_note_2' },
                { id: 'audit', label: `سجل الحركات (${auditLogs.length})`, icon: 'history' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`px-3.5 py-2 rounded-full text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap transition-all ${
                    tab === t.id
                      ? 'bg-[var(--g-primary)] text-white shadow-xs'
                      : 'bg-[var(--g-surface-variant)] text-[var(--g-muted)]'
                  }`}
                >
                  <span className="ms-icon text-sm">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="max-h-[48vh] overflow-y-auto space-y-2 pr-0.5">
              {tab === 'attendance' &&
                (attLogs.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--g-muted)] bg-[var(--g-surface-variant)] rounded-2xl">
                    لا توجد حركات حضور أو انصراف مسجلة لهذا الموظف بعد.
                  </div>
                ) : (
                  attLogs.map((l) => (
                    <div
                      key={l.id}
                      className="p-3 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-extrabold text-[var(--g-text)]">
                            {ACTION_LABELS[l.action_type] || l.action_type}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-[var(--g-surface)] text-[11px] font-bold num-ltr">
                            {l.date_key} • {formatTimeArabic(l.timestamp)}
                          </span>
                          {l.shift_date_key && l.shift_date_key !== l.date_key && (
                            <span className="px-2 py-0.5 rounded-full bg-[var(--g-purple-bg)] text-[var(--g-purple)] text-[10px] font-extrabold">
                              🌙 تابع لشفت {l.shift_date_key}
                            </span>
                          )}
                          {l.late_minutes > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-[var(--g-red-bg)] text-[var(--g-red)] text-[10px] font-extrabold">
                              تأخير {l.late_minutes} د
                            </span>
                          )}
                          {l.allowed_break_minutes > 0 && l.action_type === 'break_start' && (
                            <span className="px-2 py-0.5 rounded-full bg-[var(--g-yellow-bg)] text-[var(--g-yellow)] text-[10px] font-extrabold">
                              مسموح {l.allowed_break_minutes} د
                            </span>
                          )}
                          {l.break_duration_minutes > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-[var(--g-green-bg)] text-[var(--g-green)] text-[10px] font-extrabold">
                              مدة الاستراحة: {l.break_duration_minutes} د
                            </span>
                          )}
                        </div>
                        {(l.note || l.break_reason) && (
                          <div className="text-xs text-[var(--g-muted)]">
                            📝 {l.break_reason ? `السبب: ${l.break_reason} ` : ''}
                            {l.note}
                          </div>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--g-muted)]">بواسطة: {l.recorded_by}</div>
                    </div>
                  ))
                ))}

              {tab === 'shortages' &&
                (shortages.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--g-muted)] bg-[var(--g-surface-variant)] rounded-2xl">
                    لم يسجل هذا الموظف أي نواقص أو مقترحات أصناف بعد.
                  </div>
                ) : (
                  shortages.map((s) => (
                    <div
                      key={s.id}
                      className="p-3 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] flex flex-wrap items-center justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]">
                            {s.is_suggestion ? '💡 اقتراح صنف جديد' : '🛒 صنف ناقص'}
                          </span>
                          <span className="text-xs font-extrabold">{s.item_name}</span>
                          <span className="text-[11px] text-[var(--g-muted)]">({s.category})</span>
                        </div>
                        <div className="text-xs text-[var(--g-muted)] mt-0.5">
                          الكمية: {formatQtyForExport(s.requested_qty, s.unit)}
                          {s.notes ? ` • ${s.notes}` : ''}
                        </div>
                      </div>
                      <div className="text-[11px] text-[var(--g-muted)] num-ltr">{s.date_key}</div>
                    </div>
                  ))
                ))}

              {tab === 'notes' &&
                (notes.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--g-muted)] bg-[var(--g-surface-variant)] rounded-2xl">
                    لا توجد ملاحظات مسجلة بواسطة هذا الموظف.
                  </div>
                ) : (
                  notes.map((n) => (
                    <div
                      key={n.id}
                      className="p-3 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] space-y-1"
                    >
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span>
                          {n.location_tag} • {n.category_tag}
                        </span>
                        <span className="text-[11px] text-[var(--g-muted)] num-ltr">
                          {n.date_key} {n.dvr_timestamp}
                        </span>
                      </div>
                      <p className="text-xs m-0 text-[var(--g-text)]">{n.content}</p>
                    </div>
                  ))
                ))}

              {tab === 'audit' &&
                (auditLogs.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--g-muted)] bg-[var(--g-surface-variant)] rounded-2xl">
                    لا توجد حركات رقابية مسجلة.
                  </div>
                ) : (
                  auditLogs.map((al) => (
                    <div
                      key={al.id}
                      className="p-3 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] flex flex-wrap items-center justify-between gap-2"
                    >
                      <div>
                        <div className="text-xs font-extrabold">
                          {al.action} — <span className="text-[var(--g-primary)]">{al.target_label}</span>
                        </div>
                        {al.details && <div className="text-[11px] text-[var(--g-muted)]">{al.details}</div>}
                      </div>
                      <div className="text-[11px] text-[var(--g-muted)] num-ltr">
                        {al.timestamp ? new Date(al.timestamp).toLocaleString('ar-EG') : ''}
                      </div>
                    </div>
                  ))
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
