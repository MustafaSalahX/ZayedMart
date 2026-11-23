import React, { useEffect, useState } from 'react';
import { fetchPersonLog } from '../lib/api.js';
import {
  ACTION_LABELS,
  buildPersonLogWhatsAppText,
  exportPersonLogCsv,
  exportPersonLogWord,
  formatCctvStatusArabic,
  formatQtyForExport,
  formatTimeArabic,
  getCctvStatusType,
  openWhatsAppShare,
} from '../lib/exportUtils.js';
import {
  BottomSheet,
  Button,
  CockpitMetricStrip,
  EmptyState,
  FilterChipRail,
  GroupedList,
  SkeletonKpiStrip,
  SkeletonList,
  StatusDot,
} from './ui/index.js';

export default function PersonLogModal({
  open,
  personId,
  personName,
  onClose,
  onToast,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('attendance');
  const [exportingExcel, setExportingExcel] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setData(null);
    setError('');
    setTab('attendance');
  }, [personId, open]);

  useEffect(() => {
    if (!open || !personId) return undefined;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await fetchPersonLog(personId);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) {
          const msg = err.message || 'تعذر تحميل السجل';
          setError(msg);
          onToast?.(msg, 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, personId, reloadTick, onToast]);

  const p = data?.person || { name: personName || 'الموظف' };
  const attLogs = data?.attendanceLogs || [];
  const shortages = data?.shortages || [];
  const notes = data?.notes || [];
  const auditLogs = data?.auditLogs || [];
  const rawStats = data?.stats || {};
  const rawSum = data?.summary || {};

  const stats = {
    totalCheckIns:
      rawStats.totalCheckIns ??
      (attLogs.length > 0
        ? attLogs.filter((a) => a.action_type === 'check_in').length
        : rawSum.daysPresent || 0),
    totalCheckOuts:
      rawStats.totalCheckOuts ?? attLogs.filter((a) => a.action_type === 'check_out').length,
    totalBreaks:
      rawStats.totalBreaks ??
      rawSum.totalBreakCount ??
      attLogs.filter((a) => a.action_type === 'break_start').length,
    totalBreakMinutes:
      rawStats.totalBreakMinutes ??
      rawSum.totalBreakMinutes ??
      attLogs
        .filter((a) => a.action_type === 'break_end')
        .reduce((acc, a) => acc + (Number(a.break_duration_minutes) || 0), 0),
    shortagesReported: rawStats.shortagesReported ?? rawSum.shortagesCount ?? shortages.length,
    suggestionsReported:
      rawStats.suggestionsReported ?? shortages.filter((s) => Boolean(s.is_suggestion)).length,
    notesRecorded: rawStats.notesRecorded ?? rawSum.notesCount ?? notes.length,
    auditActionsCount: rawStats.auditActionsCount ?? rawSum.auditCount ?? auditLogs.length,
  };

  const shiftStart = p.shift_start || '08:00';
  const shiftEnd = p.shift_end || '20:00';

  const tabItems = [
    { id: 'attendance', label: 'الحضور', count: attLogs.length },
    { id: 'shortages', label: 'النواقص', count: shortages.length },
    { id: 'notes', label: 'الملاحظات', count: notes.length },
    { id: 'audit', label: 'الحركات', count: auditLogs.length },
  ];

  return (
    <BottomSheet
      open={Boolean(open)}
      onClose={onClose}
      title={p.name}
      subtitle={`${p.department || p.role_label || 'موظف'} · ${shiftStart}–${shiftEnd}`}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        {data && !loading && (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              loading={exportingExcel}
              onClick={async () => {
                if (exportingExcel) return;
                setExportingExcel(true);
                try {
                  await exportPersonLogCsv(data);
                  onToast?.('تم التصدير إلى Excel');
                } catch (err) {
                  onToast?.(err.message || 'تعذر التصدير', 'error');
                } finally {
                  setExportingExcel(false);
                }
              }}
            >
              Excel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                exportPersonLogWord(data);
                onToast?.('تم التصدير إلى Word');
              }}
            >
              Word
            </Button>
            <Button
              variant="whatsapp"
              size="sm"
              onClick={() => openWhatsAppShare(buildPersonLogWhatsAppText(data))}
            >
              واتساب
            </Button>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            <SkeletonKpiStrip count={4} />
            <SkeletonList rows={4} />
          </div>
        ) : error ? (
          <EmptyState
            icon="error_outline"
            title="تعذر تحميل السجل"
            actionLabel="إعادة المحاولة"
            onAction={() => setReloadTick((t) => t + 1)}
            compact
          />
        ) : (
          <>
            <CockpitMetricStrip
              columns={4}
              items={[
                {
                  id: 'ci',
                  label: 'الحضور',
                  value: stats.totalCheckIns || 0,
                  secondary: `انصراف ${stats.totalCheckOuts || 0}`,
                },
                {
                  id: 'br',
                  label: 'البريك',
                  value: stats.totalBreaks || 0,
                  secondary: `${stats.totalBreakMinutes || 0} د`,
                },
                {
                  id: 'sh',
                  label: 'النواقص',
                  value: stats.shortagesReported || 0,
                  secondary:
                    stats.suggestionsReported > 0 ? `${stats.suggestionsReported} مقترح` : '',
                },
                {
                  id: 'nt',
                  label: 'الملاحظات',
                  value: stats.notesRecorded || 0,
                  secondary: `${stats.auditActionsCount || 0} حركة`,
                },
              ]}
            />

            <FilterChipRail items={tabItems} activeId={tab} onSelect={setTab} />

            {tab === 'attendance' &&
              (attLogs.length === 0 ? (
                <EmptyState title="لا توجد حركات حضور" compact />
              ) : (
                <GroupedList>
                  {attLogs.map((l) => {
                    const cctvType = getCctvStatusType(l);
                    const cctvTone =
                      cctvType === 'confirmed'
                        ? 'success'
                        : cctvType === 'mismatch'
                        ? 'danger'
                        : 'warning';
                    const metaParts = [
                      l.late_minutes > 0 ? `تأخير ${l.late_minutes}د` : '',
                      l.break_duration_minutes > 0 ? `بريك ${l.break_duration_minutes}د` : '',
                      l.shift_date_key && l.shift_date_key !== l.date_key
                        ? `شفت ${l.shift_date_key}`
                        : '',
                      formatCctvStatusArabic(l, { includeMeta: false }),
                      l.recorded_by,
                    ].filter(Boolean);

                    return (
                      <div key={l.id} className="px-3.5 py-2.5 space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <StatusDot tone={cctvTone} />
                            <span className="font-medium text-ink truncate">
                              {ACTION_LABELS[l.action_type] || l.action_type}
                            </span>
                          </div>
                          <span className="text-ink-muted num-ltr shrink-0">
                            {l.date_key} · {formatTimeArabic(l.timestamp)}
                          </span>
                        </div>
                        <div className="text-[11px] text-ink-muted ps-4 truncate">
                          {metaParts.join(' · ')}
                        </div>
                        {(l.note || l.break_reason || l.cctv_note) && (
                          <div className="text-xs text-ink-muted ps-4">
                            {[l.break_reason, l.note, l.cctv_note].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </GroupedList>
              ))}

            {tab === 'shortages' &&
              (shortages.length === 0 ? (
                <EmptyState title="لا توجد نواقص" compact />
              ) : (
                <GroupedList>
                  {shortages.map((s) => (
                    <div
                      key={s.id}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <StatusDot tone={s.is_suggestion ? 'purple' : 'primary'} />
                          <span className="font-medium text-ink truncate">{s.item_name}</span>
                        </div>
                        <div className="text-[11px] text-ink-muted ps-4 truncate">
                          {[s.category, formatQtyForExport(s.requested_qty, s.unit), s.notes]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <span className="text-[11px] text-ink-muted num-ltr shrink-0">
                        {s.date_key}
                      </span>
                    </div>
                  ))}
                </GroupedList>
              ))}

            {tab === 'notes' &&
              (notes.length === 0 ? (
                <EmptyState title="لا توجد ملاحظات" compact />
              ) : (
                <GroupedList>
                  {notes.map((n) => (
                    <div key={n.id} className="px-3.5 py-2.5 space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-ink truncate">
                          {n.location_tag} · {n.category_tag}
                        </span>
                        <span className="text-[11px] text-ink-muted num-ltr shrink-0">
                          {n.date_key} {n.dvr_timestamp}
                        </span>
                      </div>
                      <p className="text-xs m-0 text-ink-muted leading-relaxed">{n.content}</p>
                    </div>
                  ))}
                </GroupedList>
              ))}

            {tab === 'audit' &&
              (auditLogs.length === 0 ? (
                <EmptyState title="لا توجد حركات رقابية" compact />
              ) : (
                <GroupedList>
                  {auditLogs.map((al) => (
                    <div
                      key={al.id}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-ink truncate">
                          {al.action} · {al.target_label}
                        </div>
                        {al.details && (
                          <div className="text-[11px] text-ink-muted truncate">{al.details}</div>
                        )}
                      </div>
                      <span className="text-[11px] text-ink-muted num-ltr shrink-0">
                        {al.timestamp ? new Date(al.timestamp).toLocaleString('ar-EG') : ''}
                      </span>
                    </div>
                  ))}
                </GroupedList>
              ))}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
