import React, { useMemo, useState } from 'react';
import {
  ConfirmSheet,
  FilterChipRail,
  GroupedList,
  Icon,
  SearchFilterBar,
  SectionHeader,
  StatusDot,
} from '../ui/index.js';
import { apiRequest, formatRequestedQty } from '../../lib/api.js';

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

export function buildTimelineItems(data) {
  if (!data) return [];
  const items = [];
  const actionMap = {
    check_in: 'حضور',
    break_start: 'استراحة',
    break_end: 'عودة',
    check_out: 'انصراف',
  };

  for (const a of data.attendanceLogs || []) {
    const contextParts = [a.department];
    if (a.late_minutes > 0) contextParts.push(`تأخير ${a.late_minutes}د`);
    const detailParts = [a.recorded_by ? `بواسطة ${a.recorded_by}` : '', a.note || ''].filter(Boolean);

    items.push({
      id: `att_${a.id}`,
      category: 'attendance',
      deleteEndpoint: `/api/attendance/${a.id}`,
      time: a.timestamp,
      dotTone: a.late_minutes > 0 ? 'warning' : 'primary',
      title: `${actionMap[a.action_type] || a.action_type} · ${a.employee_name}`,
      context: contextParts.filter(Boolean).join(' · '),
      detail: detailParts.join(' · '),
      proof: a.proof_url,
    });
  }

  for (const t of data.truckLogs || []) {
    const isDamaged = t.delivery_condition === 'return_damaged';
    const isShortage = t.delivery_condition === 'shortage';
    const stateLabel = t.status === 'unloading' ? 'قيد التنزيل' : 'تم الاستلام';
    const contextParts = [
      stateLabel,
      t.duration_minutes ? `${t.duration_minutes}د` : '',
    ].filter(Boolean);
    const detailParts = [t.category, t.recorded_by, t.notes].filter(Boolean);

    items.push({
      id: `trk_${t.id}`,
      category: 'trucks',
      deleteEndpoint: `/api/trucks/${t.id}`,
      time: t.departure_time || t.arrival_time,
      dotTone: isDamaged ? 'danger' : isShortage || t.status === 'unloading' ? 'warning' : 'success',
      title: `عربية · ${t.supplier_name}`,
      context: contextParts.join(' · '),
      detail: detailParts.join(' · '),
      proof: t.completion_proof_url || t.arrival_proof_url,
    });
  }

  for (const sh of data.shortages || []) {
    const resolved = sh.status === 'resolved';
    const qtyLabel = formatRequestedQty(sh.requested_qty, sh.unit);
    const detailParts = [sh.category, sh.recorded_by, sh.notes].filter(Boolean);

    items.push({
      id: `sht_${sh.id}`,
      category: 'shortages',
      deleteEndpoint: `/api/shortages/${sh.id}`,
      time: sh.updated_at || sh.created_at,
      dotTone: resolved ? 'success' : 'danger',
      title: `نقص · ${sh.item_name}`,
      context: qtyLabel,
      detail: detailParts.join(' · '),
      proof: '',
    });
  }

  for (const n of data.notes || []) {
    const urgent = n.severity === 'urgent';
    const loc = n.location_tag || 'الماركت';
    const detailParts = [
      n.dvr_timestamp ? `DVR ${n.dvr_timestamp}` : '',
      n.category_tag,
      n.content,
      n.recorded_by,
    ].filter(Boolean);

    items.push({
      id: `not_${n.id}`,
      category: 'notes',
      deleteEndpoint: `/api/notes/${n.id}`,
      time: n.timestamp,
      dotTone: urgent ? 'danger' : 'warning',
      title: `ملاحظة · ${loc}`,
      context: n.content || n.category_tag || '',
      detail: detailParts.join(' · '),
      proof: n.proof_url,
    });
  }

  return items.sort((a, b) => new Date(b.time) - new Date(a.time));
}

/**
 * Clean Chronological Hairline Activity Feed (`سجل اليوم`).
 * Single-line rows inside one `<GroupedList>` with 8px dot, concise label, tabular HH:MM,
 * tap-to-expand details, optional proof preview, and `<ConfirmSheet />` admin delete.
 */
export default function DashboardActivityFeed({
  data,
  canManageRecords = false,
  isConnectedApi = true,
  defaultExpanded = false,
  onPreviewImage,
  onRefresh,
  onToast,
}) {
  const [filterCat, setFilterCat] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [openRowId, setOpenRowId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const allItems = useMemo(() => buildTimelineItems(data), [data]);

  const counts = useMemo(() => {
    const c = { all: allItems.length, attendance: 0, shortages: 0, trucks: 0, notes: 0 };
    for (const it of allItems) {
      if (c[it.category] !== undefined) c[it.category] += 1;
    }
    return c;
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allItems.filter((it) => {
      if (filterCat !== 'all' && it.category !== filterCat) return false;
      if (q) {
        const hay = `${it.title} ${it.context} ${it.detail}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allItems, filterCat, searchQuery]);

  const visibleItems = expanded ? filteredItems : filteredItems.slice(0, 8);

  async function handleConfirmDelete() {
    if (!deleteTarget?.deleteEndpoint || deleting) return;
    setDeleting(true);
    try {
      await apiRequest(deleteTarget.deleteEndpoint, 'DELETE');
      setDeleteTarget(null);
      onToast?.('تم حذف السجل بنجاح');
      onRefresh?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر حذف السجل', 'error');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <section className="space-y-3 min-w-0">
        <SectionHeader
          title="سجل اليوم"
          count={filteredItems.length}
          actions={
            <div className="flex items-center gap-1.5">
              {allItems.length > 6 && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen((v) => {
                      if (v) setSearchQuery('');
                      return !v;
                    });
                  }}
                  aria-label="بحث في سجل اليوم"
                  className={`w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] inline-flex items-center justify-center transition-[background-color,color] duration-150 cursor-pointer ${
                    searchOpen || searchQuery
                      ? 'bg-secondary-container text-on-secondary-container'
                      : 'bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink'
                  }`}
                >
                  <Icon name="search" size={18} />
                </button>
              )}

              {filteredItems.length > 8 && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="min-h-[44px] sm:min-h-[36px] px-2 text-xs font-medium text-primary hover:underline cursor-pointer"
                >
                  {expanded ? 'عرض أقل' : `عرض الكل (${filteredItems.length})`}
                </button>
              )}
            </div>
          }
        />

        {allItems.length > 0 && (
          <FilterChipRail
            activeId={filterCat}
            onSelect={setFilterCat}
            items={[
              { id: 'all', label: 'الكل', count: counts.all },
              { id: 'attendance', label: 'الحضور', count: counts.attendance },
              { id: 'shortages', label: 'النواقص', count: counts.shortages },
              { id: 'trucks', label: 'العربيات', count: counts.trucks },
              { id: 'notes', label: 'الكاميرات', count: counts.notes },
            ]}
          />
        )}

        {(searchOpen || searchQuery) && (
          <SearchFilterBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="بحث في سجل اليوم..."
          />
        )}

        {filteredItems.length === 0 ? (
          <div className="py-6 text-center text-xs text-ink-muted flex items-center justify-center gap-3">
            <span>
              {allItems.length === 0 ? 'لا توجد حركات اليوم' : 'لا توجد نتائج مطابقة'}
            </span>
            {(filterCat !== 'all' || searchQuery) && (
              <button
                type="button"
                onClick={() => {
                  setFilterCat('all');
                  setSearchQuery('');
                }}
                className="text-primary font-semibold hover:underline cursor-pointer"
              >
                إعادة ضبط
              </button>
            )}
          </div>
        ) : (
          <GroupedList>
            {visibleItems.map((it) => {
              const isOpen = openRowId === it.id;
              return (
                <div key={it.id} className="min-w-0">
                  <div className="min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setOpenRowId((cur) => (cur === it.id ? null : it.id))}
                      aria-expanded={isOpen}
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-start cursor-pointer bg-transparent border-0 p-0"
                    >
                      <StatusDot tone={it.dotTone} />
                      <div className="min-w-0 flex-1 flex items-baseline gap-2 flex-wrap">
                        <span className="text-xs sm:text-sm font-medium text-ink truncate">
                          {it.title}
                        </span>
                        {it.context && (
                          <span className="text-xs text-ink-muted truncate">
                            {it.context}
                          </span>
                        )}
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {it.proof && (
                        <button
                          type="button"
                          onClick={() => onPreviewImage?.(it.proof, it.title)}
                          aria-label={`عرض صورة ${it.title}`}
                          className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-primary inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150"
                        >
                          <Icon name="image" size={18} />
                        </button>
                      )}

                      <span className="num-ltr text-xs font-medium text-ink-muted px-1">
                        {formatShortTime(it.time)}
                      </span>

                      {canManageRecords && it.deleteEndpoint && isConnectedApi && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(it)}
                          aria-label={`حذف ${it.title}`}
                          className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-danger-bg text-ink-muted hover:text-danger inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150 shrink-0"
                        >
                          <Icon name="delete" size={18} />
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && it.detail && (
                    <div className="px-3.5 pb-3 ps-8 text-xs text-ink-muted leading-relaxed">
                      {it.detail}
                    </div>
                  )}
                </div>
              );
            })}
          </GroupedList>
        )}
      </section>

      <ConfirmSheet
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        loading={deleting}
        tone="danger"
        title="حذف السجل"
        description={deleteTarget ? `حذف "${deleteTarget.title}" نهائياً؟` : ''}
        confirmLabel="حذف"
      />
    </>
  );
}
