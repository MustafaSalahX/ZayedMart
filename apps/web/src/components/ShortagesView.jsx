import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  apiRequest,
  formatRequestedQty,
  normalizeDigitsClient,
  postActionWithOfflineSupport,
} from '../lib/api.js';
import { playSuccessChime, speakArabicConfirmation } from '../lib/audio.js';
import {
  buildShortagesWhatsAppText,
  exportShortagesCsv,
  exportShortagesWord,
  formatTimeArabic,
} from '../lib/exportUtils.js';
import { useThemeArchitecture } from '../lib/themeContext.jsx';
import ShortageComposerForm from './shortages/ShortageComposerForm.jsx';
import {
  BottomSheet,
  Button,
  CockpitMetricStrip,
  ConfirmSheet,
  EmptyState,
  FilterChipRail,
  GroupedList,
  GroupedRow,
  Icon,
  SearchFilterBar,
  SectionHeader,
  StatusDot,
} from './ui/index.js';

export const SHORTAGE_CATEGORIES = [
  { id: 'ألبان وجبن', label: 'ألبان وجبن', icon: 'kitchen' },
  { id: 'مشروبات وعصائر', label: 'مشروبات وعصائر', icon: 'local_drink' },
  { id: 'بقالة جافة', label: 'بقالة جافة', icon: 'inventory_2' },
  { id: 'شيبسي وسناكس', label: 'شيبسي وسناكس', icon: 'cookie' },
  { id: 'منظفات وورقيات', label: 'منظفات وورقيات', icon: 'cleaning_services' },
  { id: 'مجمدات ولحوم', label: 'مجمدات ولحوم', icon: 'ac_unit' },
  { id: 'خضار وفاكهة', label: 'خضار وفاكهة', icon: 'nutrition' },
  { id: 'مخبوزات وحلويات', label: 'مخبوزات وحلويات', icon: 'bakery_dining' },
  { id: 'عطارة وتوابل', label: 'عطارة وتوابل', icon: 'spa' },
  { id: 'أصناف أخرى', label: 'أصناف أخرى', icon: 'category' },
];

const UNIT_OPTIONS = ['', 'كرتونة', 'باكت', 'علبة', 'قطعة', 'كيلو', 'شكارة'];
const QTY_PRESETS = [
  { label: 'بدون كمية', value: '' },
  { label: '0', value: '0' },
  { label: '1', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '5', value: '5' },
  { label: '10', value: '10' },
];

const CATALOG_INITIAL_LIMIT = 48;

function parseQtyInputForPayload(rawStr) {
  if (rawStr === null || rawStr === undefined) return { ok: true, value: null };
  const cleaned = normalizeDigitsClient(rawStr).trim();
  if (cleaned === '') return { ok: true, value: null };
  const num = Number(cleaned);
  if (Number.isNaN(num) || !Number.isFinite(num) || num < 0) {
    return { ok: false, error: 'أدخل رقماً صحيحاً أو اتركه فارغاً' };
  }
  return { ok: true, value: Math.round(num * 1000) / 1000 };
}

export default function ShortagesView({
  shortages = [],
  productCatalog = [],
  suppliers = [],
  storeName = 'زايد مارت',
  dateKey = '',
  voiceEnabled = false,
  canWrite = false,
  canManageShortages = false,
  canManageRecords = false,
  canExport = false,
  canHandover = false,
  onOpenHandoverModal,
  onRefresh,
  onToast,
}) {
  const arch = useThemeArchitecture();
  const isMinimal = arch.id === 'minimal';

  const [selectedCategory, setSelectedCategory] = useState('ألبان وجبن');
  const [catalogFilterCat, setCatalogFilterCat] = useState('all');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [showAllCatalog, setShowAllCatalog] = useState(false);

  // Composer state
  const [itemName, setItemName] = useState('');
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [qtyInput, setQtyInput] = useState('');
  const [unit, setUnit] = useState('');
  const [urgency, setUrgency] = useState('out_of_stock');
  const [isSuggestion, setIsSuggestion] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [showExtraFields, setShowExtraFields] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [composerSheetOpen, setComposerSheetOpen] = useState(false);
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);

  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : false
  );

  // List filter state
  const [statusFilter, setStatusFilter] = useState('open');
  const [listSearch, setListSearch] = useState('');
  const [busyId, setBusyId] = useState('');

  // Confirmation Sheet state
  const [confirmState, setConfirmState] = useState(null);

  // Quick Edit / Admin Edit Modal
  const [editingItem, setEditingItem] = useState(null);
  const [editForm, setEditForm] = useState({
    item_name: '',
    category: 'بقالة جافة',
    qtyInput: '',
    unit: '',
    urgency: 'out_of_stock',
    status: 'open',
    supplier_id: '',
    notes: '',
    fullAdminMode: false,
  });

  // Catalog Manager Modal
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('ألبان وجبن');
  const [bulkUnit, setBulkUnit] = useState('');
  const [bulkLines, setBulkLines] = useState('');
  const [catalogBusy, setCatalogBusy] = useState(false);

  const composerRef = useRef(null);
  const nameInputRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(min-width: 768px)');
    const handleChange = (e) => {
      setIsDesktop(e.matches);
      if (e.matches) {
        setComposerSheetOpen(false);
      }
    };
    setIsDesktop(mq.matches);
    if (mq.addEventListener) {
      mq.addEventListener('change', handleChange);
      return () => mq.removeEventListener('change', handleChange);
    }
    mq.addListener(handleChange);
    return () => mq.removeListener(handleChange);
  }, []);

  function focusOrOpenComposer() {
    if (!canWrite) return;
    if (isDesktop) {
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => nameInputRef.current?.focus(), 100);
    } else {
      setComposerSheetOpen(true);
      setTimeout(() => nameInputRef.current?.focus(), 140);
    }
  }

  useEffect(() => {
    const handleOpenComposer = (ev) => {
      if (ev?.detail?.action === 'shortage_add' && canWrite) {
        if (isDesktop) {
          composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => nameInputRef.current?.focus(), 100);
        } else {
          setComposerSheetOpen(true);
          setTimeout(() => nameInputRef.current?.focus(), 140);
        }
      }
    };
    window.addEventListener('zayed:open-composer', handleOpenComposer);
    return () => window.removeEventListener('zayed:open-composer', handleOpenComposer);
  }, [canWrite, isDesktop]);

  const activeByNormName = useMemo(() => {
    const map = new Map();
    for (const s of shortages) {
      if (s.status !== 'resolved' && s.item_name) {
        map.set(s.item_name.trim().toLowerCase(), s);
      }
    }
    return map;
  }, [shortages]);

  const counts = useMemo(() => {
    let open = 0;
    let ordered = 0;
    let resolved = 0;
    let suggestions = 0;
    for (const s of shortages) {
      if (s.status === 'open') open += 1;
      else if (s.status === 'ordered') ordered += 1;
      else if (s.status === 'resolved') resolved += 1;
      if (Number(s.is_suggestion) === 1) suggestions += 1;
    }
    return { open, ordered, resolved, suggestions, total: shortages.length };
  }, [shortages]);

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return productCatalog.filter((c) => {
      if (catalogFilterCat !== 'all' && c.category !== catalogFilterCat) return false;
      if (q && !c.name.toLowerCase().includes(q) && !(c.category || '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [productCatalog, catalogFilterCat, catalogSearch]);

  const visibleCatalog = useMemo(() => {
    if (showAllCatalog || filteredCatalog.length <= CATALOG_INITIAL_LIMIT) {
      return filteredCatalog;
    }
    return filteredCatalog.slice(0, CATALOG_INITIAL_LIMIT);
  }, [filteredCatalog, showAllCatalog]);

  const hiddenCatalogCount = Math.max(0, filteredCatalog.length - visibleCatalog.length);

  const catalogCategoryChips = useMemo(() => {
    const items = [
      {
        id: 'all',
        label: 'الكل',
        count: productCatalog.length,
      },
    ];
    for (const cat of SHORTAGE_CATEGORIES) {
      const countInCat = productCatalog.filter((c) => c.category === cat.id).length;
      if (countInCat > 0) {
        items.push({
          id: cat.id,
          label: cat.label,
          count: countInCat,
        });
      }
    }
    return items;
  }, [productCatalog]);

  const statusFilterChips = useMemo(
    () => [
      { id: 'open', label: 'مطلوب', count: counts.open },
      { id: 'suggestions', label: 'مقترحات', count: counts.suggestions },
      { id: 'ordered', label: 'تم طلبه', count: counts.ordered },
      { id: 'resolved', label: 'توفّر', count: counts.resolved },
      { id: 'all', label: 'الكل', count: counts.total },
    ],
    [counts]
  );

  const filteredShortages = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return shortages.filter((s) => {
      if (statusFilter === 'suggestions') {
        if (Number(s.is_suggestion) !== 1) return false;
      } else if (statusFilter !== 'all' && s.status !== statusFilter) {
        return false;
      }
      if (
        q &&
        !s.item_name.toLowerCase().includes(q) &&
        !(s.category || '').toLowerCase().includes(q) &&
        !(s.recorded_by || '').toLowerCase().includes(q) &&
        !(s.notes || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [shortages, statusFilter, listSearch]);

  function adjustQty(currentStr, delta) {
    const cleaned = normalizeDigitsClient(currentStr).trim();
    const base = cleaned === '' ? 0 : Number(cleaned);
    if (Number.isNaN(base)) return String(Math.max(0, delta));
    const next = Math.max(0, Math.round((base + delta) * 100) / 100);
    return String(next);
  }

  function handleSelectCatalogItem(catItem) {
    const existingActive = activeByNormName.get(catItem.name.trim().toLowerCase());
    if (existingActive) {
      openEditModal(existingActive, false);
      onToast?.(`${catItem.name} مسجل بالفعل`);
      return;
    }
    setItemName(catItem.name);
    setSelectedCatalogId(catItem.id);
    if (catItem.category) setSelectedCategory(catItem.category);
    if (catItem.default_unit) setUnit(catItem.default_unit);
    if (catItem.supplier_id) setSupplierId(catItem.supplier_id);
    focusOrOpenComposer();
  }

  async function handleSubmitShortage(e) {
    e?.preventDefault();
    if (!canWrite) return;

    const cleanName = itemName.trim();
    if (!cleanName) {
      onToast?.('اكتب اسم الصنف أولاً', 'error');
      nameInputRef.current?.focus();
      return;
    }

    const parsedQty = parseQtyInputForPayload(qtyInput);
    if (!parsedQty.ok) {
      onToast?.(parsedQty.error, 'error');
      return;
    }

    setSubmitting(true);
    try {
      const res = await postActionWithOfflineSupport('/api/shortages', {
        catalog_item_id: selectedCatalogId || '',
        item_name: cleanName,
        category: selectedCategory,
        requested_qty: parsedQty.value,
        unit,
        urgency,
        is_suggestion: isSuggestion ? 1 : 0,
        supplier_id: supplierId,
        notes: notes.trim(),
        save_to_catalog: true,
      });

      playSuccessChime('in');
      speakArabicConfirmation(
        isSuggestion ? `تم تسجيل اقتراح إضافة ${cleanName}` : `تم تسجيل ${cleanName} في النواقص`,
        voiceEnabled
      );

      if (res?.queuedOffline) {
        onToast?.(`تم حفظ ${cleanName} محلياً`);
      } else if (res?.merged) {
        onToast?.(`تم تحديث ${cleanName}`);
      } else {
        onToast?.(`تم تسجيل ${cleanName}`);
      }

      setItemName('');
      setSelectedCatalogId('');
      setQtyInput('');
      setNotes('');
      setIsSuggestion(false);
      setStatusFilter('open');
      setComposerSheetOpen(false);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function openEditModal(item, fullAdminMode = false) {
    setEditingItem(item);
    setEditForm({
      item_name: item.item_name || '',
      category: item.category || 'بقالة جافة',
      qtyInput:
        item.requested_qty === null || item.requested_qty === undefined
          ? ''
          : String(item.requested_qty),
      unit: item.unit || '',
      urgency: item.urgency || 'out_of_stock',
      status: item.status || 'open',
      supplier_id: item.supplier_id || '',
      notes: item.notes || '',
      fullAdminMode: Boolean(fullAdminMode && (canManageRecords || canManageShortages)),
    });
  }

  async function handleSaveEdit(e) {
    e?.preventDefault();
    if (!editingItem) return;

    const parsedQty = parseQtyInputForPayload(editForm.qtyInput);
    if (!parsedQty.ok) {
      onToast?.(parsedQty.error, 'error');
      return;
    }

    if (!editForm.item_name.trim()) {
      onToast?.('اكتب اسم الصنف', 'error');
      return;
    }

    setBusyId(editingItem.id);
    try {
      const payload = {
        item_name: editForm.item_name.trim(),
        category: editForm.category,
        requested_qty: parsedQty.value,
        unit: editForm.unit,
        urgency: editForm.urgency,
        notes: editForm.notes.trim(),
      };

      if (canManageShortages || canManageRecords) {
        payload.status = editForm.status;
        payload.supplier_id = editForm.supplier_id;
      }

      await apiRequest(`/api/shortages/${editingItem.id}`, 'PUT', payload);
      playSuccessChime('in');
      onToast?.(`تم تحديث ${editForm.item_name.trim()}`);
      setEditingItem(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setBusyId('');
    }
  }

  async function handleStatusChange(item, nextStatus) {
    setBusyId(item.id);
    try {
      await apiRequest(`/api/shortages/${item.id}/status`, 'POST', { status: nextStatus });
      playSuccessChime(nextStatus === 'resolved' ? 'out' : 'in');
      const msg =
        nextStatus === 'ordered'
          ? `تم طلب ${item.item_name}`
          : nextStatus === 'resolved'
          ? `تم توفير ${item.item_name}`
          : `تمت إعادة ${item.item_name}`;
      onToast?.(msg);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setBusyId('');
    }
  }

  async function executeResolveAll() {
    setBusyId('__ALL__');
    try {
      const res = await apiRequest('/api/shortages/resolve-all', 'POST', {});
      playSuccessChime('out');
      onToast?.(`تم توفير ${res.resolvedCount || 0} صنف`);
      setConfirmState(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setBusyId('');
    }
  }

  async function executeDeleteShortage(item) {
    if (!canManageRecords || !item) return;
    setBusyId(item.id);
    try {
      await apiRequest(`/api/shortages/${item.id}`, 'DELETE');
      onToast?.(`تم حذف ${item.item_name}`);
      setConfirmState(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setBusyId('');
    }
  }

  async function handleBulkAddCatalog(e) {
    e?.preventDefault();
    const lines = bulkLines
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      onToast?.('اكتب صنفاً واحداً على الأقل', 'error');
      return;
    }

    setCatalogBusy(true);
    try {
      const res = await apiRequest('/api/catalog/bulk', 'POST', {
        lines,
        category: bulkCategory,
        default_unit: bulkUnit,
      });
      onToast?.(`تمت إضافة ${res.addedCount || 0} صنف`);
      setBulkLines('');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setCatalogBusy(false);
    }
  }

  async function executeDeleteCatalogItem(catItem) {
    if (!catItem) return;
    setCatalogBusy(true);
    try {
      await apiRequest(`/api/catalog/${catItem.id}`, 'DELETE');
      onToast?.(`تم حذف ${catItem.name}`);
      setConfirmState(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setCatalogBusy(false);
    }
  }

  function handleShareWhatsApp() {
    const text = buildShortagesWhatsAppText(shortages, storeName);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  const sharedComposerProps = {
    categories: SHORTAGE_CATEGORIES,
    unitOptions: UNIT_OPTIONS,
    qtyPresets: QTY_PRESETS,
    suppliers,
    canManageShortages,
    canManageRecords,
    selectedCategory,
    setSelectedCategory,
    itemName,
    setItemName,
    setSelectedCatalogId,
    qtyInput,
    setQtyInput,
    unit,
    setUnit,
    urgency,
    setUrgency,
    isSuggestion,
    setIsSuggestion,
    supplierId,
    setSupplierId,
    notes,
    setNotes,
    showExtraFields,
    setShowExtraFields,
    submitting,
    nameInputRef,
    parseQtyInputForPayload,
    adjustQty,
    onSubmit: handleSubmitShortage,
    onToast,
  };

  return (
    <div className={arch.surfaces.sectionGapClass}>
      {/* Borderless Canvas Header */}
      <div
        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
          isMinimal ? 'pb-2.5 border-b border-line' : ''
        }`}
      >
        <h1
          className={`text-lg sm:text-xl ${arch.surfaces.headingWeight} tracking-tight text-ink m-0`}
        >
          النواقص
        </h1>

        {/* Mobile Consolidated Actions */}
        <div className="flex md:hidden items-center gap-1.5 shrink-0">
          {canWrite && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              icon="add"
              onClick={() => setComposerSheetOpen(true)}
            >
              إضافة
            </Button>
          )}
          {((canHandover && onOpenHandoverModal) ||
            canExport ||
            canManageShortages ||
            canManageRecords) && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon="more_horiz"
              onClick={() => setActionsSheetOpen(true)}
            >
              المزيد
            </Button>
          )}
        </div>

        {/* Desktop Full Action Strip */}
        <div className="hidden md:flex flex-wrap items-center gap-1.5">
          {canHandover && onOpenHandoverModal && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon="swap_horiz"
              onClick={onOpenHandoverModal}
            >
              الوردية
            </Button>
          )}
          {(canExport || canManageShortages) && (
            <>
              <Button
                type="button"
                variant="whatsapp"
                size="sm"
                icon="share"
                onClick={handleShareWhatsApp}
              >
                واتساب
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon="download"
                onClick={() => exportShortagesCsv(shortages, dateKey || 'today')}
              >
                Excel
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon="description"
                onClick={() => exportShortagesWord(shortages, dateKey || 'today', storeName)}
              >
                Word
              </Button>
            </>
          )}
          {(canManageShortages || canManageRecords) && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowCatalogModal(true)}
            >
              الكتالوج
            </Button>
          )}
        </div>
      </div>

      {/* 3-Metric Cockpit Strip */}
      <CockpitMetricStrip
        columns={3}
        items={[
          {
            id: 'open',
            label: 'مطلوب',
            value: counts.open,
            tone: counts.open > 0 ? 'danger' : 'neutral',
            active: statusFilter === 'open',
            onClick: () => setStatusFilter('open'),
          },
          {
            id: 'ordered',
            label: 'تم طلبه',
            value: counts.ordered,
            tone: counts.ordered > 0 ? 'warning' : 'neutral',
            active: statusFilter === 'ordered',
            onClick: () => setStatusFilter('ordered'),
          },
          {
            id: 'resolved',
            label: 'توفّر',
            value: counts.resolved,
            tone: counts.resolved > 0 ? 'success' : 'neutral',
            active: statusFilter === 'resolved',
            onClick: () => setStatusFilter('resolved'),
          },
        ]}
      />

      {/* Quick 1-Tap Product Catalog */}
      {canWrite && productCatalog.length > 0 && (
        <section className="space-y-3">
          <SectionHeader
            title="الأصناف السريعة"
            count={filteredCatalog.length}
            actions={
              <div className="w-full sm:w-56">
                <SearchFilterBar
                  value={catalogSearch}
                  onChange={setCatalogSearch}
                  placeholder="بحث..."
                />
              </div>
            }
          />

          <FilterChipRail
            items={catalogCategoryChips}
            activeId={catalogFilterCat}
            onSelect={(catId) => {
              setCatalogFilterCat(catId);
              if (catId !== 'all') {
                setSelectedCategory(catId);
              }
            }}
          />

          {filteredCatalog.length === 0 ? (
            <EmptyState compact title="لا توجد أصناف مطابقة" />
          ) : (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {visibleCatalog.map((catItem) => {
                  const activeMatch = activeByNormName.get(
                    catItem.name.trim().toLowerCase()
                  );
                  const isSelected =
                    itemName.trim().toLowerCase() === catItem.name.trim().toLowerCase();
                  return (
                    <button
                      key={catItem.id}
                      type="button"
                      onClick={() => handleSelectCatalogItem(catItem)}
                      className={`min-h-[52px] px-3 py-2.5 rounded-[var(--g-radius-md)] border text-start flex items-center justify-between gap-2 transition-[border-color,background-color] duration-150 active:scale-[0.98] cursor-pointer ${
                        activeMatch
                          ? 'border-[var(--g-green-border)] bg-success-bg/40'
                          : isSelected
                          ? 'border-primary bg-surface-tint'
                          : 'border-line bg-surface hover:border-line-strong'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-xs sm:text-sm text-ink truncate">
                          {catItem.name}
                        </div>
                        <div className="text-[11px] text-ink-muted truncate">
                          {catItem.category}
                        </div>
                      </div>
                      {activeMatch ? (
                        <span
                          className="w-2 h-2 rounded-full bg-success-solid shrink-0"
                          aria-label="مسجل"
                        />
                      ) : (
                        <span
                          className="text-sm font-semibold text-ink-muted shrink-0"
                          aria-hidden="true"
                        >
                          +
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {(hiddenCatalogCount > 0 || showAllCatalog) &&
                filteredCatalog.length > CATALOG_INITIAL_LIMIT && (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      icon={showAllCatalog ? 'expand_less' : 'expand_more'}
                      onClick={() => setShowAllCatalog((prev) => !prev)}
                    >
                      {showAllCatalog ? 'إخفاء' : `عرض الكل (+${hiddenCatalogCount})`}
                    </Button>
                  </div>
                )}
            </div>
          )}
        </section>
      )}

      {/* Single Active Composer Instance */}
      {canWrite && (
        <>
          {isDesktop ? (
            <div ref={composerRef}>
              <ShortageComposerForm {...sharedComposerProps} />
            </div>
          ) : (
            <BottomSheet
              open={composerSheetOpen}
              onClose={() => setComposerSheetOpen(false)}
              title={isSuggestion ? 'اقتراح صنف' : 'تسجيل ناقص'}
              maxWidth="max-w-xl"
            >
              <ShortageComposerForm inSheet {...sharedComposerProps} />
            </BottomSheet>
          )}
        </>
      )}

      {/* Recorded Shortages List */}
      <section className="space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          <FilterChipRail
            items={statusFilterChips}
            activeId={statusFilter}
            onSelect={setStatusFilter}
            className="flex-1 min-w-0"
          />

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
            <div className="flex-1 sm:w-56">
              <SearchFilterBar
                value={listSearch}
                onChange={setListSearch}
                placeholder="بحث في النواقص"
              />
            </div>

            {canManageShortages &&
              counts.open + counts.ordered > 0 &&
              statusFilter !== 'resolved' && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon="done_all"
                  loading={busyId === '__ALL__'}
                  onClick={() => setConfirmState({ type: 'resolve_all' })}
                  className="shrink-0"
                >
                  توفير الكل
                </Button>
              )}
          </div>
        </div>

        {filteredShortages.length === 0 ? (
          <EmptyState
            compact
            title="لا توجد نواقص"
            actionLabel={canWrite ? 'إضافة صنف' : undefined}
            onAction={canWrite ? focusOrOpenComposer : undefined}
          />
        ) : (
          <GroupedList>
            {filteredShortages.map((item) => {
              const isNullQty =
                item.requested_qty === null || item.requested_qty === undefined;
              const canWorkerEditThis = canWrite && item.status !== 'resolved';
              const isSug = Number(item.is_suggestion) === 1;
              const dotTone =
                item.status === 'resolved'
                  ? 'success'
                  : item.status === 'ordered'
                  ? 'warning'
                  : isSug
                  ? 'purple'
                  : item.urgency === 'out_of_stock'
                  ? 'danger'
                  : 'warning';

              const qtyDisplay = isNullQty
                ? ''
                : `${item.requested_qty}${item.unit ? ` ${item.unit}` : ''}`;

              return (
                <div
                  key={item.id}
                  className={`px-3.5 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 ${
                    item.status === 'resolved' ? 'opacity-65' : ''
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <StatusDot tone={dotTone} />
                      <span className="text-sm sm:text-base font-semibold text-ink break-words">
                        {item.item_name}
                      </span>
                      {qtyDisplay && (
                        <span className="num-ltr text-xs font-semibold text-primary">
                          {qtyDisplay}
                        </span>
                      )}
                      {isSug && (
                        <span className="text-[11px] font-medium text-purple">
                          · مقترح
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-ink-muted flex items-center gap-1.5 flex-wrap">
                      <span>{item.category || 'بقالة جافة'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.recorded_by}</span>
                      <span aria-hidden="true">·</span>
                      <span className="num-ltr">
                        {formatTimeArabic(item.updated_at || item.created_at)}
                      </span>
                      {item.supplier_name && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{item.supplier_name}</span>
                        </>
                      )}
                      {item.status === 'resolved' && item.resolved_by && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-success">توفّر: {item.resolved_by}</span>
                        </>
                      )}
                      {item.notes && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-ink">{item.notes}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {(canWorkerEditThis || canManageRecords || canManageShortages) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon="edit"
                        disabled={busyId === item.id}
                        onClick={() => openEditModal(item, canManageRecords)}
                      >
                        تعديل
                      </Button>
                    )}

                    {canManageShortages && item.status === 'open' && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        loading={busyId === item.id}
                        onClick={() => handleStatusChange(item, 'ordered')}
                      >
                        تم الطلب
                      </Button>
                    )}

                    {canManageShortages && item.status !== 'resolved' && (
                      <Button
                        type="button"
                        variant="success"
                        size="sm"
                        loading={busyId === item.id}
                        onClick={() => handleStatusChange(item, 'resolved')}
                      >
                        توفّر
                      </Button>
                    )}

                    {canManageShortages && item.status === 'resolved' && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        loading={busyId === item.id}
                        onClick={() => handleStatusChange(item, 'open')}
                      >
                        إعادة
                      </Button>
                    )}

                    {canManageRecords && (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() =>
                          setConfirmState({ type: 'delete_shortage', item })
                        }
                        aria-label={`حذف ${item.item_name}`}
                        className="w-11 h-11 rounded-full text-danger hover:bg-danger-bg flex items-center justify-center shrink-0 cursor-pointer"
                      >
                        <Icon name="delete" size={18} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </GroupedList>
        )}
      </section>

      {/* Edit Shortage BottomSheet */}
      <BottomSheet
        open={Boolean(editingItem)}
        onClose={() => {
          if (busyId !== editingItem?.id) setEditingItem(null);
        }}
        title="تعديل الصنف"
        subtitle={editingItem?.item_name || ''}
        maxWidth="max-w-lg"
        footer={
          editingItem ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={busyId === editingItem.id}
                onClick={() => setEditingItem(null)}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                form="edit-shortage-form"
                variant="primary"
                size="md"
                loading={busyId === editingItem.id}
                className="flex-1"
              >
                حفظ
              </Button>
            </div>
          ) : null
        }
      >
        {editingItem && (
          <form id="edit-shortage-form" onSubmit={handleSaveEdit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                اسم الصنف
              </label>
              <input
                type="text"
                value={editForm.item_name}
                onChange={(e) => setEditForm((f) => ({ ...f, item_name: e.target.value }))}
                className="g-input"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                القسم
              </label>
              <select
                value={editForm.category}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                className="g-input font-medium"
              >
                {SHORTAGE_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-3 border-t border-line space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-muted">الكمية</span>
                {parseQtyInputForPayload(editForm.qtyInput).value !== null && (
                  <span className="text-xs font-semibold text-primary num-ltr">
                    {formatRequestedQty(
                      parseQtyInputForPayload(editForm.qtyInput).value,
                      editForm.unit
                    )}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto sm:flex-wrap no-scrollbar pb-0.5">
                {QTY_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setEditForm((f) => ({ ...f, qtyInput: p.value }))}
                    className={`min-h-[44px] px-3 py-1 rounded-[var(--g-radius-sm)] border text-xs font-medium shrink-0 cursor-pointer ${
                      normalizeDigitsClient(editForm.qtyInput).trim() === p.value
                        ? 'border-primary bg-primary-solid text-on-primary'
                        : 'border-line bg-surface text-ink'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setEditForm((f) => ({ ...f, qtyInput: adjustQty(f.qtyInput, 1) }))
                  }
                  className="w-12 h-12 rounded-[var(--g-radius-md)] bg-success-solid text-on-success flex items-center justify-center shrink-0 cursor-pointer"
                  aria-label="زيادة الكمية"
                >
                  <Icon name="add" size={20} weight="bold" />
                </button>
                <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={editForm.qtyInput}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      qtyInput: normalizeDigitsClient(e.target.value),
                    }))
                  }
                  placeholder="0"
                  className="g-input flex-1 min-w-0 text-center text-base font-semibold num-ltr"
                />
                <button
                  type="button"
                  onClick={() =>
                    setEditForm((f) => ({ ...f, qtyInput: adjustQty(f.qtyInput, -1) }))
                  }
                  className="w-12 h-12 rounded-[var(--g-radius-md)] bg-surface-2 border border-line text-ink flex items-center justify-center shrink-0 cursor-pointer"
                  aria-label="تقليل الكمية"
                >
                  <Icon name="remove" size={20} weight="bold" />
                </button>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {UNIT_OPTIONS.map((u) => (
                  <button
                    key={u || '__none'}
                    type="button"
                    onClick={() => setEditForm((f) => ({ ...f, unit: u }))}
                    className={`min-h-[40px] px-3 py-1 rounded-full text-xs font-medium border cursor-pointer ${
                      editForm.unit === u
                        ? 'border-primary bg-primary-solid text-on-primary'
                        : 'border-line bg-surface text-ink'
                    }`}
                  >
                    {u || 'بدون وحدة'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEditForm((f) => ({ ...f, urgency: 'out_of_stock' }))}
                className={`min-h-[44px] rounded-[var(--g-radius-md)] border font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer ${
                  editForm.urgency === 'out_of_stock'
                    ? 'border-[var(--g-danger-solid)] bg-danger-solid text-on-danger'
                    : 'border-line bg-surface text-ink'
                }`}
              >
                نفد تماماً
              </button>
              <button
                type="button"
                onClick={() => setEditForm((f) => ({ ...f, urgency: 'low_stock' }))}
                className={`min-h-[44px] rounded-[var(--g-radius-md)] border font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer ${
                  editForm.urgency === 'low_stock'
                    ? 'border-[var(--g-warning-solid)] bg-warning-solid text-on-warning'
                    : 'border-line bg-surface text-ink'
                }`}
              >
                قرب يخلص
              </button>
            </div>

            {(canManageShortages || canManageRecords) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-muted mb-1">
                    الحالة
                  </label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                    className="g-input font-medium"
                  >
                    <option value="open">مطلوب</option>
                    <option value="ordered">تم الطلب</option>
                    <option value="resolved">تم التوفير</option>
                  </select>
                </div>

                {suppliers.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-ink-muted mb-1">
                      المورد
                    </label>
                    <select
                      value={editForm.supplier_id}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, supplier_id: e.target.value }))
                      }
                      className="g-input font-medium"
                    >
                      <option value="">بدون مورد</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                ملاحظات
              </label>
              <input
                type="text"
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="ملاحظة..."
                className="g-input"
              />
            </div>
          </form>
        )}
      </BottomSheet>

      {/* Quick Catalog Manager BottomSheet */}
      <BottomSheet
        open={showCatalogModal}
        onClose={() => {
          if (!catalogBusy) setShowCatalogModal(false);
        }}
        title="كتالوج الأصناف السريعة"
        maxWidth="max-w-xl"
        footer={
          <Button
            type="button"
            variant="secondary"
            size="md"
            fullWidth
            onClick={() => setShowCatalogModal(false)}
          >
            إغلاق
          </Button>
        }
      >
        <div className="space-y-4">
          <form onSubmit={handleBulkAddCatalog} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  القسم
                </label>
                <select
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  className="g-input font-medium"
                >
                  {SHORTAGE_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الوحدة
                </label>
                <select
                  value={bulkUnit}
                  onChange={(e) => setBulkUnit(e.target.value)}
                  className="g-input font-medium"
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u || '__none'} value={u}>
                      {u || 'بدون وحدة'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                الأصناف (سطر لكل صنف)
              </label>
              <textarea
                rows={4}
                value={bulkLines}
                onChange={(e) => setBulkLines(e.target.value)}
                placeholder={'لبن جهينة 1 لتر\nجبنة عبور لاند 500 جم'}
                className="g-input"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              fullWidth
              loading={catalogBusy}
            >
              إضافة للكتالوج
            </Button>
          </form>

          {productCatalog.length > 0 && (
            <GroupedList label="المحفوظة" count={productCatalog.length}>
              {productCatalog.map((c) => (
                <div
                  key={c.id}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{c.name}</div>
                    <div className="text-xs text-ink-muted">
                      {c.category}
                      {c.default_unit ? ` · ${c.default_unit}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={catalogBusy}
                    onClick={() =>
                      setConfirmState({ type: 'delete_catalog', item: c })
                    }
                    aria-label={`حذف ${c.name}`}
                    className="w-11 h-11 rounded-full text-danger hover:bg-danger-bg flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <Icon name="delete" size={18} />
                  </button>
                </div>
              ))}
            </GroupedList>
          )}
        </div>
      </BottomSheet>

      {/* Mobile Actions BottomSheet */}
      <BottomSheet
        open={actionsSheetOpen}
        onClose={() => setActionsSheetOpen(false)}
        title="خيارات النواقص"
        maxWidth="max-w-md"
      >
        <GroupedList>
          {canHandover && onOpenHandoverModal && (
            <GroupedRow
              onClick={() => {
                setActionsSheetOpen(false);
                onOpenHandoverModal();
              }}
            >
              <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                <Icon name="swap_horiz" size={19} className="text-ink-muted" />
                <span>تسليم الوردية</span>
              </span>
              <Icon
                name="chevron_left"
                size={18}
                className="text-ink-muted ltr:rotate-180"
              />
            </GroupedRow>
          )}

          {(canExport || canManageShortages) && (
            <>
              <GroupedRow
                onClick={() => {
                  setActionsSheetOpen(false);
                  handleShareWhatsApp();
                }}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                  <Icon name="send" size={19} className="text-[var(--g-whatsapp)]" />
                  <span>واتساب</span>
                </span>
                <Icon
                  name="chevron_left"
                  size={18}
                  className="text-ink-muted ltr:rotate-180"
                />
              </GroupedRow>

              <GroupedRow
                onClick={() => {
                  setActionsSheetOpen(false);
                  exportShortagesCsv(shortages, dateKey || 'today');
                }}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                  <Icon name="table_view" size={19} className="text-success" />
                  <span>Excel (.xlsx)</span>
                </span>
                <Icon name="download" size={18} className="text-ink-muted opacity-70" />
              </GroupedRow>

              <GroupedRow
                onClick={() => {
                  setActionsSheetOpen(false);
                  exportShortagesWord(shortages, dateKey || 'today', storeName);
                }}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                  <Icon name="description" size={19} className="text-primary" />
                  <span>Word (.doc)</span>
                </span>
                <Icon name="download" size={18} className="text-ink-muted opacity-70" />
              </GroupedRow>
            </>
          )}

          {(canManageShortages || canManageRecords) && (
            <GroupedRow
              onClick={() => {
                setActionsSheetOpen(false);
                setShowCatalogModal(true);
              }}
            >
              <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                <Icon name="inventory_2" size={19} className="text-ink-muted" />
                <span>الكتالوج</span>
              </span>
              <Icon
                name="chevron_left"
                size={18}
                className="text-ink-muted ltr:rotate-180"
              />
            </GroupedRow>
          )}
        </GroupedList>
      </BottomSheet>

      {/* Non-blocking Confirmation Sheet */}
      <ConfirmSheet
        open={Boolean(confirmState)}
        onClose={() => {
          if (!busyId && !catalogBusy) setConfirmState(null);
        }}
        onConfirm={() => {
          if (confirmState?.type === 'resolve_all') {
            executeResolveAll();
          } else if (confirmState?.type === 'delete_shortage') {
            executeDeleteShortage(confirmState.item);
          } else if (confirmState?.type === 'delete_catalog') {
            executeDeleteCatalogItem(confirmState.item);
          }
        }}
        title={
          confirmState?.type === 'resolve_all'
            ? 'توفير جميع النواقص'
            : confirmState?.type === 'delete_shortage'
            ? 'حذف الصنف'
            : 'حذف من الكتالوج'
        }
        description={
          confirmState?.type === 'resolve_all'
            ? 'تعليم جميع الأصناف المفتوحة كمتوفرة؟'
            : confirmState?.type === 'delete_shortage'
            ? `حذف ${confirmState?.item?.item_name || ''}؟`
            : `إزالة ${confirmState?.item?.name || ''}؟`
        }
        confirmLabel={
          confirmState?.type === 'resolve_all' ? 'توفير الكل' : 'حذف'
        }
        tone={confirmState?.type === 'resolve_all' ? 'success' : 'danger'}
        loading={busyId === '__ALL__' || Boolean(busyId) || catalogBusy}
      />
    </div>
  );
}
