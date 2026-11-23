import React, { useMemo, useState } from 'react';
import {
  BottomSheet,
  Button,
  ConfirmSheet,
  EmptyState,
  FilterChipRail,
  GroupedList,
  Icon,
  SearchFilterBar,
  SectionHeader,
  SegmentedControl,
  ToggleSwitch,
} from '../ui/index.js';
import { apiRequest } from '../../lib/api.js';
import { ROLE_DEFAULT_COLORS } from '../../lib/navigation.js';

export const SUPPLIER_CATEGORIES = [
  'بقالة جافة',
  'ألبان وجبن',
  'مشروبات وعصائر',
  'شيبسي وسناكس',
  'مجمدات ولحوم',
  'خضار وفاكهة',
  'منظفات وورقيات',
  'مخبوزات وحلويات',
];

const SWATCH_COLORS = Object.values(ROLE_DEFAULT_COLORS);

/**
 * Detoxed Suppliers Directory & Management Tab (`الموردون`).
 * Zero outer/inner boxes, zero w-11 h-11 colored truck squares (10px color dot instead),
 * zero verbose subtitles or toggle prose.
 */
export default function DashboardSuppliersTab({
  suppliers = [],
  onRefresh,
  onToast,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [catFilter, setCatFilter] = useState('all');

  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [entryMode, setEntryMode] = useState('single');
  const [supName, setSupName] = useState('');
  const [supCategory, setSupCategory] = useState('بقالة جافة');
  const [supPhone, setSupPhone] = useState('');
  const [supColor, setSupColor] = useState(SWATCH_COLORS[5] || 'var(--g-success-solid)');
  const [supHasReturn, setSupHasReturn] = useState(false);
  const [supReturnNote, setSupReturnNote] = useState('');
  const [supBulkLines, setSupBulkLines] = useState('');
  const [submittingAdd, setSubmittingAdd] = useState(false);

  const [editingSupplier, setEditingSupplier] = useState(null);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);

  const pendingReturnsTotal = useMemo(
    () => suppliers.filter((s) => Number(s.has_pending_return) === 1).length,
    [suppliers]
  );

  const filterChips = useMemo(() => {
    const items = [{ id: 'all', label: 'الكل', count: suppliers.length }];
    if (pendingReturnsTotal > 0) {
      items.push({
        id: '__returns__',
        label: 'مرتجع معلق',
        count: pendingReturnsTotal,
        alert: true,
      });
    }
    const counts = new Map();
    for (const s of suppliers) {
      const c = s.category || 'أخرى';
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    for (const [cat, count] of counts.entries()) {
      items.push({ id: cat, label: cat, count });
    }
    return items;
  }, [suppliers, pendingReturnsTotal]);

  const filteredSuppliers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (catFilter === '__returns__' && Number(s.has_pending_return) !== 1) return false;
      if (catFilter !== 'all' && catFilter !== '__returns__' && s.category !== catFilter) {
        return false;
      }
      if (q) {
        const hay = `${s.name} ${s.category} ${s.phone || ''} ${s.pending_return_note || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [suppliers, catFilter, searchQuery]);

  async function handleAddSingle(e) {
    e?.preventDefault?.();
    if (!supName.trim() || submittingAdd) return;
    setSubmittingAdd(true);
    try {
      await apiRequest('/api/suppliers', 'POST', {
        name: supName.trim(),
        category: supCategory,
        phone: supPhone.trim(),
        color: supColor,
        has_pending_return: supHasReturn ? 1 : 0,
        pending_return_note: supHasReturn ? supReturnNote.trim() : '',
      });
      setSupName('');
      setSupPhone('');
      setSupHasReturn(false);
      setSupReturnNote('');
      setAddSheetOpen(false);
      onToast?.('تمت إضافة المورد');
      onRefresh?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر إضافة المورد', 'error');
    } finally {
      setSubmittingAdd(false);
    }
  }

  async function handleAddBulk(e) {
    e?.preventDefault?.();
    if (!supBulkLines.trim() || submittingAdd) return;
    setSubmittingAdd(true);
    try {
      const res = await apiRequest('/api/suppliers/bulk', 'POST', {
        lines: supBulkLines,
        category: supCategory,
        color: supColor,
      });
      setSupBulkLines('');
      setAddSheetOpen(false);
      onToast?.(`تمت إضافة ${res.addedCount} مورد`);
      onRefresh?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر إضافة القائمة', 'error');
    } finally {
      setSubmittingAdd(false);
    }
  }

  async function handleSaveEditSupplier(e) {
    e?.preventDefault?.();
    if (!editingSupplier?.name?.trim() || submittingEdit) return;
    setSubmittingEdit(true);
    try {
      await apiRequest(`/api/suppliers/${editingSupplier.id}`, 'PUT', {
        name: editingSupplier.name.trim(),
        category: editingSupplier.category,
        phone: editingSupplier.phone || '',
        color: editingSupplier.color || SWATCH_COLORS[5],
        has_pending_return: editingSupplier.has_pending_return ? 1 : 0,
        pending_return_note: editingSupplier.has_pending_return
          ? editingSupplier.pending_return_note || ''
          : '',
      });
      setEditingSupplier(null);
      onToast?.('تم حفظ التعديلات');
      onRefresh?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر حفظ التعديلات', 'error');
    } finally {
      setSubmittingEdit(false);
    }
  }

  async function handleConfirmDeleteSupplier() {
    if (!deleteTarget || submittingDelete) return;
    setSubmittingDelete(true);
    try {
      await apiRequest(`/api/suppliers/${deleteTarget.id}`, 'DELETE');
      setDeleteTarget(null);
      onToast?.('تم حذف المورد');
      onRefresh?.();
    } catch (err) {
      onToast?.(err?.message || 'تعذر حذف المورد', 'error');
    } finally {
      setSubmittingDelete(false);
    }
  }

  return (
    <>
      <div className="space-y-4">
        <SectionHeader
          title="الموردون"
          count={suppliers.length}
          actions={
            <Button
              variant="primary"
              size="sm"
              icon="add"
              onClick={() => {
                setEntryMode('single');
                setAddSheetOpen(true);
              }}
            >
              إضافة
            </Button>
          }
        />

        {suppliers.length > 0 && (
          <div className="space-y-2.5">
            <SearchFilterBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="بحث باسم المورد أو التصنيف..."
            />
            <FilterChipRail
              items={filterChips}
              activeId={catFilter}
              onSelect={setCatFilter}
            />
          </div>
        )}

        {filteredSuppliers.length === 0 ? (
          <EmptyState
            compact={suppliers.length > 0}
            title={suppliers.length === 0 ? 'لا يوجد موردون' : 'لا توجد نتائج مطابقة'}
            actionLabel={suppliers.length === 0 ? 'إضافة مورد' : 'إعادة ضبط'}
            actionIcon={suppliers.length === 0 ? 'add' : 'restart_alt'}
            onAction={() => {
              if (suppliers.length === 0) {
                setAddSheetOpen(true);
              } else {
                setSearchQuery('');
                setCatFilter('all');
              }
            }}
          />
        ) : (
          <GroupedList>
            {filteredSuppliers.map((sup) => {
              const hasReturn = Number(sup.has_pending_return) === 1;
              return (
                <div
                  key={sup.id}
                  className="min-h-[56px] px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      style={{ backgroundColor: sup.color || 'var(--g-primary-solid)' }}
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-sm font-semibold text-ink truncate">
                          {sup.name}
                        </span>
                        {hasReturn && (
                          <span className="text-xs font-medium text-warning shrink-0">
                            مرتجع
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-muted truncate">
                        <span>{sup.category}</span>
                        {sup.phone && (
                          <span className="num-ltr"> · {sup.phone}</span>
                        )}
                        {hasReturn && sup.pending_return_note && (
                          <span className="text-warning">
                            {' '}
                            · {sup.pending_return_note}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="w-full sm:w-auto flex items-center justify-end gap-1 flex-wrap shrink-0">
                    {sup.phone && (
                      <a
                        href={`tel:${sup.phone}`}
                        aria-label={`اتصال بـ ${sup.name}`}
                        title="اتصال"
                        className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-primary inline-flex items-center justify-center no-underline transition-[background-color,color] duration-150 shrink-0"
                      >
                        <Icon name="call" size={18} />
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setEditingSupplier({
                          ...sup,
                          has_pending_return: Boolean(Number(sup.has_pending_return)),
                        })
                      }
                      aria-label={`تعديل ${sup.name}`}
                      title="تعديل"
                      className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150 shrink-0"
                    >
                      <Icon name="edit" size={18} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeleteTarget(sup)}
                      aria-label={`حذف ${sup.name}`}
                      title="حذف"
                      className="w-11 h-11 sm:w-9 sm:h-9 rounded-[var(--g-radius-btn)] bg-transparent hover:bg-danger-bg text-ink-muted hover:text-danger inline-flex items-center justify-center cursor-pointer transition-[background-color,color] duration-150 shrink-0"
                    >
                      <Icon name="delete" size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </GroupedList>
        )}
      </div>

      {/* Add Single / Bulk Supplier BottomSheet */}
      <BottomSheet
        open={addSheetOpen}
        onClose={() => !submittingAdd && setAddSheetOpen(false)}
        title="إضافة مورد"
        maxWidth="max-w-xl"
        footer={
          <div className="flex items-center gap-2.5">
            <Button
              variant="secondary"
              fullWidth
              disabled={submittingAdd}
              onClick={() => setAddSheetOpen(false)}
            >
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              loading={submittingAdd}
              onClick={entryMode === 'single' ? handleAddSingle : handleAddBulk}
            >
              {entryMode === 'single' ? 'حفظ' : 'إضافة القائمة'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <SegmentedControl
            fullWidth
            value={entryMode}
            onChange={setEntryMode}
            options={[
              { id: 'single', label: 'مورد مفرد' },
              { id: 'bulk', label: 'قائمة جماعية' },
            ]}
          />

          {entryMode === 'single' ? (
            <form onSubmit={handleAddSingle} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    اسم المورد *
                  </label>
                  <input
                    type="text"
                    required
                    value={supName}
                    onChange={(e) => setSupName(e.target.value)}
                    placeholder="شركة جهينة"
                    className="g-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    التصنيف
                  </label>
                  <select
                    value={supCategory}
                    onChange={(e) => setSupCategory(e.target.value)}
                    className="g-input"
                  >
                    {SUPPLIER_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    رقم المندوب
                  </label>
                  <input
                    type="text"
                    value={supPhone}
                    onChange={(e) => setSupPhone(e.target.value)}
                    placeholder="010xxxxxxxx"
                    className="g-input num-ltr"
                  />
                </div>
              </div>

              <div className="border-y border-line">
                <ToggleSwitch
                  checked={supHasReturn}
                  onChange={setSupHasReturn}
                  label="مرتجع معلق"
                />
              </div>

              {supHasReturn && (
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    تفاصيل المرتجع
                  </label>
                  <input
                    type="text"
                    value={supReturnNote}
                    onChange={(e) => setSupReturnNote(e.target.value)}
                    placeholder="3 عبوات تالفة"
                    className="g-input"
                  />
                </div>
              )}

              <div>
                <span className="block text-xs font-medium text-ink-muted mb-1.5">
                  اللون
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {SWATCH_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSupColor(c)}
                      aria-label={`اللون ${c}`}
                      className="w-11 h-11 rounded-full flex items-center justify-center bg-transparent hover:bg-surface-2 cursor-pointer"
                    >
                      <span
                        style={{ backgroundColor: c }}
                        className={`w-6 h-6 rounded-full ${
                          supColor === c
                            ? 'ring-2 ring-offset-2 ring-[var(--g-primary)]'
                            : ''
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleAddBulk} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  التصنيف
                </label>
                <select
                  value={supCategory}
                  onChange={(e) => setSupCategory(e.target.value)}
                  className="g-input"
                >
                  {SUPPLIER_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الأسماء (سطر لكل مورد)
                </label>
                <textarea
                  rows={6}
                  required
                  value={supBulkLines}
                  onChange={(e) => setSupBulkLines(e.target.value)}
                  placeholder={`شركة جهينة - 01099887766\nشركة المراعي\nشركة بيبسي`}
                  className="g-input leading-relaxed"
                />
              </div>
            </form>
          )}
        </div>
      </BottomSheet>

      {/* Edit Supplier BottomSheet */}
      <BottomSheet
        open={Boolean(editingSupplier)}
        onClose={() => !submittingEdit && setEditingSupplier(null)}
        title="تعديل مورد"
        subtitle={editingSupplier?.name || ''}
        maxWidth="max-w-lg"
        footer={
          <div className="flex items-center gap-2.5">
            <Button
              variant="secondary"
              fullWidth
              disabled={submittingEdit}
              onClick={() => setEditingSupplier(null)}
            >
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              loading={submittingEdit}
              onClick={handleSaveEditSupplier}
            >
              حفظ
            </Button>
          </div>
        }
      >
        {editingSupplier && (
          <form onSubmit={handleSaveEditSupplier} className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  اسم المورد *
                </label>
                <input
                  type="text"
                  required
                  value={editingSupplier.name}
                  onChange={(e) =>
                    setEditingSupplier((p) => ({ ...p, name: e.target.value }))
                  }
                  className="g-input"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  التصنيف
                </label>
                <select
                  value={editingSupplier.category}
                  onChange={(e) =>
                    setEditingSupplier((p) => ({ ...p, category: e.target.value }))
                  }
                  className="g-input"
                >
                  {SUPPLIER_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  رقم المندوب
                </label>
                <input
                  type="text"
                  value={editingSupplier.phone || ''}
                  onChange={(e) =>
                    setEditingSupplier((p) => ({ ...p, phone: e.target.value }))
                  }
                  className="g-input num-ltr"
                />
              </div>
            </div>

            <div className="border-y border-line">
              <ToggleSwitch
                checked={Boolean(editingSupplier.has_pending_return)}
                onChange={(val) =>
                  setEditingSupplier((p) => ({ ...p, has_pending_return: val }))
                }
                label="مرتجع معلق"
              />
            </div>

            {editingSupplier.has_pending_return && (
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  تفاصيل المرتجع
                </label>
                <input
                  type="text"
                  value={editingSupplier.pending_return_note || ''}
                  onChange={(e) =>
                    setEditingSupplier((p) => ({
                      ...p,
                      pending_return_note: e.target.value,
                    }))
                  }
                  placeholder="تفاصيل المرتجع"
                  className="g-input"
                />
              </div>
            )}
          </form>
        )}
      </BottomSheet>

      <ConfirmSheet
        open={Boolean(deleteTarget)}
        onClose={() => !submittingDelete && setDeleteTarget(null)}
        onConfirm={handleConfirmDeleteSupplier}
        loading={submittingDelete}
        tone="danger"
        title="حذف المورد"
        description={deleteTarget ? `حذف "${deleteTarget.name}" من القائمة؟` : ''}
        confirmLabel="حذف"
      />
    </>
  );
}
