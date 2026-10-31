import React, { useMemo, useRef, useState } from 'react';
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
  formatTimeArabic,
} from '../lib/exportUtils.js';
import VoiceMicButton from './VoiceMicButton.jsx';

export const SHORTAGE_CATEGORIES = [
  { id: 'ألبان وجبن', label: 'ألبان وجبن', emoji: '🧀' },
  { id: 'مشروبات وعصائر', label: 'مشروبات وعصائر', emoji: '🧃' },
  { id: 'بقالة جافة', label: 'بقالة جافة', emoji: '🥫' },
  { id: 'شيبسي وسناكس', label: 'شيبسي وسناكس', emoji: '🥔' },
  { id: 'منظفات وورقيات', label: 'منظفات وورقيات', emoji: '🧼' },
  { id: 'مجمدات ولحوم', label: 'مجمدات ولحوم', emoji: '❄️' },
  { id: 'خضار وفاكهة', label: 'خضار وفاكهة', emoji: '🍎' },
  { id: 'مخبوزات وحلويات', label: 'مخبوزات وحلويات', emoji: '🥖' },
  { id: 'عطارة وتوابل', label: 'عطارة وتوابل', emoji: '🌿' },
  { id: 'أصناف أخرى', label: 'أصناف أخرى', emoji: '📦' },
];

const UNIT_OPTIONS = ['', 'كرتونة', 'باكت', 'علبة', 'قطعة', 'كيلو', 'شكارة'];
const QTY_PRESETS = [
  { label: 'فاضي (بدون كمية)', value: '' },
  { label: '0', value: '0' },
  { label: '1', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '5', value: '5' },
  { label: '10', value: '10' },
];

function parseQtyInputForPayload(rawStr) {
  if (rawStr === null || rawStr === undefined) return { ok: true, value: null };
  const cleaned = normalizeDigitsClient(rawStr).trim();
  if (cleaned === '') return { ok: true, value: null };
  const num = Number(cleaned);
  if (Number.isNaN(num) || !Number.isFinite(num) || num < 0) {
    return { ok: false, error: 'يرجى كتابة رقم صحيح (0 أو أكثر) أو ترك الكمية فاضية' };
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
  const [selectedCategory, setSelectedCategory] = useState('ألبان وجبن');
  const [catalogFilterCat, setCatalogFilterCat] = useState('all');
  const [catalogSearch, setCatalogSearch] = useState('');

  // Composer state
  const [itemName, setItemName] = useState('');
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [qtyInput, setQtyInput] = useState(''); // '' => null, '0' => 0, '5' => 5
  const [unit, setUnit] = useState('');
  const [urgency, setUrgency] = useState('out_of_stock');
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [showExtraFields, setShowExtraFields] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // List filter state
  const [statusFilter, setStatusFilter] = useState('open');
  const [listSearch, setListSearch] = useState('');
  const [busyId, setBusyId] = useState('');

  // Quick Edit / Full Admin Edit Modal
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

  // Map open/ordered shortages by normalized item name so quick catalog shows live status
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
    for (const s of shortages) {
      if (s.status === 'open') open += 1;
      else if (s.status === 'ordered') ordered += 1;
      else if (s.status === 'resolved') resolved += 1;
    }
    return { open, ordered, resolved, total: shortages.length };
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

  const filteredShortages = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return shortages.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
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
      onToast?.(`"${catItem.name}" مسجل بالفعل — يمكنك تعديل الكمية هنا مباشرة`);
      return;
    }
    setItemName(catItem.name);
    setSelectedCatalogId(catItem.id);
    if (catItem.category) setSelectedCategory(catItem.category);
    if (catItem.default_unit) setUnit(catItem.default_unit);
    if (catItem.supplier_id) setSupplierId(catItem.supplier_id);
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function handleSubmitShortage(e) {
    e?.preventDefault();
    if (!canWrite) return;

    const cleanName = itemName.trim();
    if (!cleanName) {
      onToast?.('اكتب اسم الصنف الناقص أو اختره من الأزرار السريعة أولاً', 'error');
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
        requested_qty: parsedQty.value, // null, 0, or positive number
        unit,
        urgency,
        supplier_id: supplierId,
        notes: notes.trim(),
        save_to_catalog: true,
      });

      playSuccessChime('in');
      speakArabicConfirmation(`تم تسجيل ${cleanName} في النواقص`, voiceEnabled);

      if (res?.queuedOffline) {
        onToast?.(`تم حفظ "${cleanName}" مؤقتاً وسيتم إرساله فور عودة الشبكة`);
      } else if (res?.merged) {
        onToast?.(`تم تحديث الصنف الموجود مسبقاً "${cleanName}" بنجاح ✓`);
      } else {
        onToast?.(`تم تسجيل "${cleanName}" في قائمة النواقص ✓`);
      }

      setItemName('');
      setSelectedCatalogId('');
      setQtyInput('');
      setNotes('');
      setStatusFilter('open');
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
      onToast?.('يرجى كتابة اسم الصنف', 'error');
      return;
    }

    setBusyId(editingItem.id);
    try {
      const payload = {
        item_name: editForm.item_name.trim(),
        category: editForm.category,
        requested_qty: parsedQty.value, // null, 0, or positive number
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
      onToast?.(`تم حفظ التعديلات على "${editForm.item_name.trim()}" ✓`);
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
          ? `تم تعليم "${item.item_name}" أنه تم طلبه من المورد 🚚`
          : nextStatus === 'resolved'
          ? `تم توفير "${item.item_name}" في الصالة ✓`
          : `تم إعادة "${item.item_name}" إلى النواقص المفتوحة`;
      onToast?.(msg);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setBusyId('');
    }
  }

  async function handleResolveAll() {
    if (!window.confirm('هل تم توفير جميع الأصناف المفتوحة في الصالة؟')) return;
    setBusyId('__ALL__');
    try {
      const res = await apiRequest('/api/shortages/resolve-all', 'POST', {});
      playSuccessChime('out');
      onToast?.(`تم إغلاق وتوفير ${res.resolvedCount || 0} صنف بنجاح ✓`);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setBusyId('');
    }
  }

  async function handleDeleteShortage(item) {
    if (!canManageRecords) return;
    if (!window.confirm(`حذف الصنف "${item.item_name}" نهائياً من السجل؟`)) return;
    setBusyId(item.id);
    try {
      await apiRequest(`/api/shortages/${item.id}`, 'DELETE');
      onToast?.(`تم حذف "${item.item_name}" نهائياً`);
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
      onToast?.('اكتب اسماً واحداً على الأقل في المربع', 'error');
      return;
    }

    setCatalogBusy(true);
    try {
      const res = await apiRequest('/api/catalog/bulk', 'POST', {
        lines,
        category: bulkCategory,
        default_unit: bulkUnit,
      });
      onToast?.(`تم إضافة ${res.addedCount || 0} صنف سريع للكتالوج ✓`);
      setBulkLines('');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setCatalogBusy(false);
    }
  }

  async function handleDeleteCatalogItem(catItem) {
    if (!window.confirm(`إزالة "${catItem.name}" من الأزرار السريعة؟`)) return;
    setCatalogBusy(true);
    try {
      await apiRequest(`/api/catalog/${catItem.id}`, 'DELETE');
      onToast?.(`تم إزالة "${catItem.name}" من الأزرار السريعة`);
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

  const parsedLiveQty = parseQtyInputForPayload(qtyInput);
  const liveQtyPreview = !parsedLiveQty.ok
    ? 'رقم غير صحيح'
    : formatRequestedQty(parsedLiveQty.value, unit);

  return (
    <div className="space-y-4">
      {/* Top Summary Banner — Large, Friendly, Mobile-First */}
      <div className="g-card p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[var(--g-green-bg)] border border-[var(--g-green-border)]/30 text-[var(--g-green)] flex items-center justify-center shrink-0">
              <span className="ms-icon filled text-2xl">shopping_basket</span>
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-[var(--g-text)]">
                نواقص الصالة والأصناف المطلوبة
              </h2>
              <p className="text-xs sm:text-sm text-[var(--g-text-muted)] font-medium">
                سجّل أي صنف خلص أو قرب يخلص من الرفوف بلمسة واحدة
              </p>
            </div>
          </div>

          {/* Handover, Export & Catalog Actions */}
          {(canHandover || canExport || canManageShortages || canManageRecords) && (
            <div className="flex flex-wrap items-center gap-2">
              {canHandover && (
                <button
                  type="button"
                  onClick={onOpenHandoverModal}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[var(--g-primary)] text-white text-xs sm:text-sm font-extrabold flex items-center gap-1.5 shadow-sm active:scale-[0.98]"
                >
                  <span className="ms-icon filled text-lg">swap_horiz</span>
                  <span>تسليم وردية الصالة</span>
                </button>
              )}
              {(canExport || canManageShortages) && (
                <>
                  <button
                    type="button"
                    onClick={handleShareWhatsApp}
                    className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#146C2E] hover:bg-[#0F5223] text-white text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-sm active:scale-[0.98]"
                  >
                    <span className="ms-icon text-lg">share</span>
                    <span>إرسال واتساب</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => exportShortagesCsv(shortages, dateKey || 'today')}
                    className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[var(--g-surface)] hover:bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-[var(--g-text)] text-xs sm:text-sm font-bold flex items-center gap-1.5 active:scale-[0.98]"
                  >
                    <span className="ms-icon text-lg text-[var(--g-primary)]">download</span>
                    <span>ملف Excel</span>
                  </button>
                </>
              )}
              {(canManageShortages || canManageRecords) && (
                <button
                  type="button"
                  onClick={() => setShowCatalogModal(true)}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[var(--g-primary-container)] text-[var(--g-on-primary-container)] border border-[var(--g-primary)]/20 text-xs sm:text-sm font-bold flex items-center gap-1.5 active:scale-[0.98]"
                >
                  <span className="ms-icon text-lg">bolt</span>
                  <span>أزرار الأصناف السريعة ({productCatalog.length})</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* 3 Big Status Counters */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-4">
          <button
            type="button"
            onClick={() => setStatusFilter('open')}
            className={`p-3 rounded-2xl border-2 text-right transition-all ${
              statusFilter === 'open'
                ? 'border-[#9E1C17] bg-[#C5221F] text-white shadow-sm'
                : 'border-[var(--g-red-border)]/35 bg-[var(--g-red-bg)] text-[var(--g-red)] hover:border-[var(--g-red-border)]'
            }`}
          >
            <div className="text-[11px] sm:text-xs font-extrabold">
              مطلوب الآن
            </div>
            <div className="text-2xl sm:text-3xl font-black num-ltr mt-0.5">
              {counts.open}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('ordered')}
            className={`p-3 rounded-2xl border-2 text-right transition-all ${
              statusFilter === 'ordered'
                ? 'border-[#9A4A00] bg-[#C25E00] text-white shadow-sm'
                : 'border-[var(--g-yellow-border)]/40 bg-[var(--g-yellow-bg)] text-[var(--g-yellow)] hover:border-[var(--g-yellow-border)]'
            }`}
          >
            <div className="text-[11px] sm:text-xs font-extrabold">
              تم طلبه
            </div>
            <div className="text-2xl sm:text-3xl font-black num-ltr mt-0.5">
              {counts.ordered}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('resolved')}
            className={`p-3 rounded-2xl border-2 text-right transition-all ${
              statusFilter === 'resolved'
                ? 'border-[#0F5223] bg-[#146C2E] text-white shadow-sm'
                : 'border-[var(--g-green-border)]/40 bg-[var(--g-green-bg)] text-[var(--g-green)] hover:border-[var(--g-green-border)]'
            }`}
          >
            <div className="text-[11px] sm:text-xs font-extrabold">
              تم توفيره ✓
            </div>
            <div className="text-2xl sm:text-3xl font-black num-ltr mt-0.5">
              {counts.resolved}
            </div>
          </button>
        </div>
      </div>

      {/* Quick 1-Tap Product Catalog (if any saved products exist) */}
      {canWrite && productCatalog.length > 0 && (
        <div className="g-card p-4 sm:p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="ms-icon filled text-xl text-[#E37400]">touch_app</span>
              <h3 className="text-sm sm:text-base font-extrabold text-[var(--g-text)]">
                اضغط على الصنف بلمسة واحدة للتسجيل السريع
              </h3>
            </div>
            <div className="relative w-full sm:w-64">
              <span className="ms-icon text-lg text-[var(--g-text-muted)] absolute right-3 top-1/2 -translate-y-1/2">
                search
              </span>
              <input
                type="search"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder="ابحث في الأصناف المحفوظة..."
                className="g-input pr-9 min-h-[44px] text-sm"
              />
            </div>
          </div>

          {/* Category filter pills for catalog */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            <button
              type="button"
              onClick={() => setCatalogFilterCat('all')}
              className={`min-h-[42px] px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold whitespace-nowrap transition-all ${
                catalogFilterCat === 'all'
                  ? 'bg-[var(--g-primary)] text-white shadow-sm'
                  : 'bg-[var(--g-surface-2)] text-[var(--g-text)] border border-[var(--g-border)]'
              }`}
            >
              كل الأقسام ({productCatalog.length})
            </button>
            {SHORTAGE_CATEGORIES.map((cat) => {
              const countInCat = productCatalog.filter((c) => c.category === cat.id).length;
              if (countInCat === 0) return null;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setCatalogFilterCat(cat.id);
                    setSelectedCategory(cat.id);
                  }}
                  className={`min-h-[42px] px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                    catalogFilterCat === cat.id
                      ? 'bg-[var(--g-primary)] text-white shadow-sm'
                      : 'bg-[var(--g-surface-2)] text-[var(--g-text)] border border-[var(--g-border)]'
                  }`}
                >
                  <span>{cat.emoji}</span>
                  <span>{cat.label}</span>
                  <span className="opacity-75">({countInCat})</span>
                </button>
              );
            })}
          </div>

          {/* Big Touch Product Buttons */}
          {filteredCatalog.length === 0 ? (
            <div className="text-center py-4 text-xs sm:text-sm text-[var(--g-text-muted)]">
              لا يوجد صنف محفوظ بهذا الاسم — اكتبه بالأسفل وسيُحفظ تلقائياً للمرات القادمة!
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-64 overflow-y-auto p-0.5">
              {filteredCatalog.slice(0, 48).map((catItem) => {
                const activeMatch = activeByNormName.get(catItem.name.trim().toLowerCase());
                const isSelected = itemName.trim().toLowerCase() === catItem.name.trim().toLowerCase();
                return (
                  <button
                    key={catItem.id}
                    type="button"
                    onClick={() => handleSelectCatalogItem(catItem)}
                    className={`min-h-[56px] p-3 rounded-2xl border text-right transition-all flex flex-col justify-between active:scale-[0.98] ${
                      activeMatch
                        ? 'border-[var(--g-green-border)] bg-[var(--g-green-bg)]'
                        : isSelected
                        ? 'border-[var(--g-primary)] ring-2 ring-[var(--g-primary)]/30 bg-[var(--g-primary-container)]'
                        : 'border-[var(--g-border)] bg-[var(--g-surface)] hover:bg-[var(--g-surface-variant)] hover:border-[var(--g-primary)]'
                    }`}
                  >
                    <div className="font-extrabold text-sm text-[var(--g-text)] leading-snug line-clamp-2">
                      {catItem.name}
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-1.5">
                      <span className="text-[11px] text-[var(--g-text-muted)] truncate">
                        {catItem.category}
                      </span>
                      {activeMatch ? (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#146C2E] text-white shrink-0">
                          مسجل ✓
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold text-[var(--g-primary)] shrink-0">
                          اختر +
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Super-Simple Add Shortage Form (Mobile-First, Giant Buttons) */}
      {canWrite && (
        <form
          ref={composerRef}
          onSubmit={handleSubmitShortage}
          className="g-card p-4 sm:p-5 space-y-4 border-2 border-[var(--g-primary)]/20"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-[var(--g-primary)] text-white text-sm font-black flex items-center justify-center">
                1
              </span>
              <h3 className="text-base sm:text-lg font-black text-[var(--g-text)]">
                اختر القسم واكتب اسم الصنف الناقص
              </h3>
            </div>
            <VoiceMicButton
              onTranscript={(txt) => setItemName((prev) => (prev ? `${prev} ${txt}` : txt))}
              onToast={onToast}
            />
          </div>

          {/* Step 1: Big Category Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {SHORTAGE_CATEGORIES.map((cat) => {
              const active = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`min-h-[48px] px-3 py-2 rounded-2xl border text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${
                    active
                      ? 'border-[var(--g-primary)] bg-[var(--g-primary)] text-white shadow-sm'
                      : 'border-[var(--g-border)] bg-[var(--g-surface-2)] text-[var(--g-text)]'
                  }`}
                >
                  <span className="text-base">{cat.emoji}</span>
                  <span className="truncate">{cat.label}</span>
                </button>
              );
            })}
          </div>

          {/* Item Name Large Input */}
          <div>
            <label className="block text-xs sm:text-sm font-extrabold text-[var(--g-text)] mb-1.5">
              اسم الصنف المطلوب (يُحفظ تلقائياً في الأزرار السريعة)
            </label>
            <div className="relative">
              <input
                ref={nameInputRef}
                type="text"
                value={itemName}
                onChange={(e) => {
                  setItemName(e.target.value);
                  setSelectedCatalogId('');
                }}
                placeholder="مثال: لبن جهينة 1 لتر / زيت كريستال ذرة / سكر..."
                className="g-input min-h-[54px] text-base sm:text-lg font-extrabold pl-10"
              />
              {itemName && (
                <button
                  type="button"
                  onClick={() => {
                    setItemName('');
                    setSelectedCatalogId('');
                  }}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[var(--g-surface-2)] text-[var(--g-text-muted)] flex items-center justify-center"
                  title="مسح الاسم"
                >
                  <span className="ms-icon text-lg">close</span>
                </button>
              )}
            </div>
          </div>

          {/* Step 2: Nullable / Zero / Positive Quantity Picker */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-[var(--g-surface-2)] border border-[var(--g-border)] space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-[var(--g-primary)] text-white text-sm font-black flex items-center justify-center">
                  2
                </span>
                <div>
                  <div className="text-sm sm:text-base font-black text-[var(--g-text)]">
                    الكمية المطلوبة (اختياري)
                  </div>
                  <div className="text-xs text-[var(--g-text-muted)]">
                    ممكن تسيبها فاضية بدون كمية، أو تختار 0، أو تكتب العدد المطلوب
                  </div>
                </div>
              </div>

              <span className="px-3 py-1 rounded-full text-xs font-black bg-[var(--g-primary-container)] text-[var(--g-on-primary-container)]">
                {liveQtyPreview}
              </span>
            </div>

            {/* 1-Tap Presets including Empty (null) and 0 */}
            <div className="flex flex-wrap gap-2">
              {QTY_PRESETS.map((preset) => {
                const isSelected = normalizeDigitsClient(qtyInput).trim() === preset.value;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setQtyInput(preset.value)}
                    className={`min-h-[46px] px-3.5 py-2 rounded-xl border text-xs sm:text-sm font-black transition-all active:scale-[0.97] ${
                      isSelected
                        ? 'border-[var(--g-primary)] bg-[var(--g-primary)] text-white shadow-sm'
                        : 'border-[var(--g-border)] bg-[var(--g-surface)] text-[var(--g-text)]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Big Plus / Minus Stepper + Direct Number Input */}
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => setQtyInput((prev) => adjustQty(prev, 1))}
                className="w-14 h-14 rounded-2xl bg-[#146C2E] hover:bg-[#0F5223] text-white text-2xl font-black flex items-center justify-center shrink-0 shadow-sm active:scale-95"
                aria-label="زيادة الكمية"
              >
                +
              </button>

              <div className="relative flex-1">
                <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={qtyInput}
                  onChange={(e) => setQtyInput(normalizeDigitsClient(e.target.value))}
                  placeholder="فاضي (بدون تحديد كمية)"
                  className="g-input min-h-[56px] text-center text-lg sm:text-xl font-black"
                />
                {qtyInput !== '' && (
                  <button
                    type="button"
                    onClick={() => setQtyInput('')}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-[var(--g-surface-2)] text-xs font-bold text-[var(--g-text-muted)]"
                  >
                    تفريغ
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setQtyInput((prev) => adjustQty(prev, -1))}
                className="w-14 h-14 rounded-2xl bg-[var(--g-surface)] border border-[var(--g-border)] text-[var(--g-text)] text-2xl font-black flex items-center justify-center shrink-0 active:scale-95"
                aria-label="تقليل الكمية"
              >
                −
              </button>
            </div>

            {/* Optional Unit Chips */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-xs font-bold text-[var(--g-text-muted)] ml-1">الوحدة:</span>
              {UNIT_OPTIONS.map((u) => (
                <button
                  key={u || '__none'}
                  type="button"
                  onClick={() => setUnit(u)}
                  className={`min-h-[38px] px-3 py-1 rounded-full text-xs font-extrabold border transition-all ${
                    unit === u
                      ? 'border-[var(--g-primary)] bg-[var(--g-primary)] text-white shadow-2xs'
                      : 'border-[var(--g-border)] bg-[var(--g-surface)] text-[var(--g-text)] hover:border-[var(--g-primary)]'
                  }`}
                >
                  {u || 'بدون وحدة'}
                </button>
              ))}
            </div>
          </div>

          {/* Step 3: Urgency 2-Big Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setUrgency('out_of_stock')}
              className={`min-h-[54px] p-3 rounded-2xl border-2 font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 transition-all active:scale-[0.99] ${
                urgency === 'out_of_stock'
                  ? 'border-[#9E1C17] bg-[#C5221F] text-white shadow-sm'
                  : 'border-[var(--g-border)] bg-[var(--g-surface)] hover:bg-[var(--g-red-bg)] hover:border-[var(--g-red-border)] text-[var(--g-text)]'
              }`}
            >
              <span
                className={`ms-icon filled text-xl ${
                  urgency === 'out_of_stock' ? 'text-white' : 'text-[#C5221F]'
                }`}
              >
                error
              </span>
              <span>خلص تماماً من الرف</span>
            </button>

            <button
              type="button"
              onClick={() => setUrgency('low_stock')}
              className={`min-h-[54px] p-3 rounded-2xl border-2 font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 transition-all active:scale-[0.99] ${
                urgency === 'low_stock'
                  ? 'border-[#9A4A00] bg-[#C25E00] text-white shadow-sm'
                  : 'border-[var(--g-border)] bg-[var(--g-surface)] hover:bg-[var(--g-yellow-bg)] hover:border-[var(--g-yellow-border)] text-[var(--g-text)]'
              }`}
            >
              <span
                className={`ms-icon filled text-xl ${
                  urgency === 'low_stock' ? 'text-white' : 'text-[#C25E00]'
                }`}
              >
                warning
              </span>
              <span>قرب يخلص (رصيد قليل)</span>
            </button>
          </div>

          {/* Optional Extra Note / Supplier Toggle (keeps form clean for workers!) */}
          <div>
            <button
              type="button"
              onClick={() => setShowExtraFields((v) => !v)}
              className="text-xs sm:text-sm font-bold text-[var(--g-primary)] flex items-center gap-1 py-1"
            >
              <span className="ms-icon text-base">
                {showExtraFields ? 'expand_less' : 'add_circle'}
              </span>
              <span>
                {showExtraFields
                  ? 'إخفاء الملاحظة الإضافية'
                  : 'إضافة ملاحظة أو تحديد مورد (اختياري)'}
              </span>
            </button>

            {showExtraFields && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 p-3 rounded-2xl bg-[var(--g-surface-2)] border border-[var(--g-border)]">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-[var(--g-text-muted)]">
                      ملاحظة قصيرة (اختياري)
                    </label>
                    <VoiceMicButton
                      small
                      onTranscript={(txt) => setNotes((p) => (p ? `${p} ${txt}` : txt))}
                      onToast={onToast}
                    />
                  </div>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="مثال: مطلوب الحجم العائلي..."
                    className="g-input min-h-[46px] text-sm"
                  />
                </div>

                {suppliers.length > 0 && (canManageShortages || canManageRecords) && (
                  <div>
                    <label className="block text-xs font-bold text-[var(--g-text-muted)] mb-1">
                      ربط بمورد (اختياري)
                    </label>
                    <select
                      value={supplierId}
                      onChange={(e) => setSupplierId(e.target.value)}
                      className="g-input min-h-[46px] text-sm"
                    >
                      <option value="">— بدون تحديد مورد —</option>
                      {suppliers.map((sup) => (
                        <option key={sup.id} value={sup.id}>
                          {sup.name} ({sup.category})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Giant Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[58px] rounded-2xl bg-[#146C2E] hover:bg-[#0F5223] text-white text-base sm:text-lg font-black shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.99] disabled:opacity-60"
          >
            <span className="ms-icon filled text-2xl">add_shopping_cart</span>
            <span>{submitting ? 'جاري التسجيل...' : 'تسجيل الصنف في النواقص الآن ✓'}</span>
          </button>
        </form>
      )}

      {/* Recorded Shortages List */}
      <div className="g-card p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {[
              { id: 'open', label: `مطلوب الآن (${counts.open})` },
              { id: 'ordered', label: `تم طلبه (${counts.ordered})` },
              { id: 'resolved', label: `تم توفيره (${counts.resolved})` },
              { id: 'all', label: `الكل (${counts.total})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`min-h-[44px] px-4 py-2 rounded-full text-xs sm:text-sm font-extrabold whitespace-nowrap transition-all ${
                  statusFilter === tab.id
                    ? 'bg-[var(--g-primary)] text-white shadow-sm'
                    : 'bg-[var(--g-surface-2)] text-[var(--g-text)] border border-[var(--g-border)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-56">
              <span className="ms-icon text-lg text-[var(--g-text-muted)] absolute right-3 top-1/2 -translate-y-1/2">
                search
              </span>
              <input
                type="search"
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder="بحث في قائمة النواقص..."
                className="g-input pr-9 min-h-[44px] text-sm"
              />
            </div>

            {canManageShortages && counts.open + counts.ordered > 0 && statusFilter !== 'resolved' && (
              <button
                type="button"
                disabled={busyId === '__ALL__'}
                onClick={handleResolveAll}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#146C2E] hover:bg-[#0F5223] text-white text-xs font-extrabold whitespace-nowrap shadow-xs active:scale-95"
              >
                توفير الكل ✓
              </button>
            )}
          </div>
        </div>

        {filteredShortages.length === 0 ? (
          <div className="text-center py-10 px-4 rounded-2xl bg-[var(--g-surface-2)] border border-dashed border-[var(--g-border)]">
            <span className="ms-icon text-4xl text-[var(--g-green)] mb-2">inventory</span>
            <p className="text-base font-extrabold text-[var(--g-text)]">
              {statusFilter === 'open'
                ? 'لا توجد نواقص مطلوبة حالياً في الصالة'
                : 'لا توجد أصناف في هذا القسم حالياً'}
            </p>
            <p className="text-xs text-[var(--g-text-muted)] mt-1">
              أي صنف يتم تسجيله يظهر هنا فوراً لكل المسؤولين
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredShortages.map((item) => {
              const isNullQty = item.requested_qty === null || item.requested_qty === undefined;
              const isZeroQty = !isNullQty && Number(item.requested_qty) === 0;
              const canWorkerEditThis = canWrite && item.status !== 'resolved';

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-2xl border transition-all ${
                    item.status === 'resolved'
                      ? 'border-[var(--g-border)] bg-[var(--g-surface-2)]/60 opacity-85'
                      : item.urgency === 'out_of_stock'
                      ? 'border-[var(--g-red-border)]/50 bg-[var(--g-surface)]'
                      : 'border-[var(--g-border)] bg-[var(--g-surface)]'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    {/* Item Main Info */}
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${
                            item.status === 'resolved'
                              ? 'bg-[var(--g-green-bg)] text-[var(--g-green)] border-[var(--g-green-border)]/35'
                              : item.status === 'ordered'
                              ? 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)] border-[var(--g-yellow-border)]/40'
                              : item.urgency === 'out_of_stock'
                              ? 'bg-[var(--g-red-bg)] text-[var(--g-red)] border-[var(--g-red-border)]/40'
                              : 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)] border-[var(--g-yellow-border)]/40'
                          }`}
                        >
                          {item.status === 'resolved'
                            ? '✓ تم التوفير بالصالة'
                            : item.status === 'ordered'
                            ? '🚚 تم الطلب من المورد'
                            : item.urgency === 'out_of_stock'
                            ? 'خلص تماماً'
                            : 'قرب يخلص'}
                        </span>

                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[var(--g-surface-2)] text-[var(--g-text-muted)] border border-[var(--g-border)]">
                          {item.category || 'بقالة جافة'}
                        </span>

                        {/* Quantity Badge — Explicitly differentiates NULL vs 0 vs Positive */}
                        <span
                          className={`px-3 py-1 rounded-xl text-xs sm:text-sm font-black ${
                            isNullQty
                              ? 'bg-[var(--g-surface-2)] text-[var(--g-text-muted)] border border-dashed border-[var(--g-border)]'
                              : isZeroQty
                              ? 'bg-[var(--g-purple-bg)] text-[var(--g-purple)] border border-[var(--g-purple-border)]/30'
                              : 'bg-[var(--g-primary-container)] text-[var(--g-on-primary-container)]'
                          }`}
                        >
                          {isNullQty
                            ? 'الكمية: بدون تحديد (فاضي)'
                            : isZeroQty
                            ? `الكمية المطلوبة: 0${item.unit ? ` ${item.unit}` : ''}`
                            : `المطلوب: ${item.requested_qty}${item.unit ? ` ${item.unit}` : ''}`}
                        </span>
                      </div>

                      <div className="text-base sm:text-lg font-black text-[var(--g-text)] break-words">
                        {item.item_name}
                      </div>

                      {item.notes && (
                        <div className="text-xs sm:text-sm font-medium text-[var(--g-text)] bg-[var(--g-surface-2)] px-3 py-1.5 rounded-xl">
                          📝 {item.notes}
                        </div>
                      )}

                      <div className="flex items-center gap-3 flex-wrap text-[11px] sm:text-xs text-[var(--g-text-muted)]">
                        <span>سجله: {item.recorded_by}</span>
                        {item.updated_by && item.updated_by !== item.recorded_by && (
                          <>
                            <span>•</span>
                            <span className="font-bold text-[var(--g-text)]">
                              آخر تحديث: {item.updated_by}
                            </span>
                          </>
                        )}
                        <span>•</span>
                        <span>{formatTimeArabic(item.updated_at || item.created_at)}</span>
                        {item.supplier_name && (
                          <>
                            <span>•</span>
                            <span className="font-bold text-[var(--g-primary)]">
                              المورد: {item.supplier_name}
                            </span>
                          </>
                        )}
                        {item.status === 'resolved' && item.resolved_by && (
                          <>
                            <span>•</span>
                            <span className="text-[var(--g-green)] font-bold">
                              وفره: {item.resolved_by}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Big Touch Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0 pt-2.5 lg:pt-0 border-t lg:border-t-0 border-[var(--g-border)] w-full lg:w-auto">
                      {(canWorkerEditThis || canManageRecords || canManageShortages) && (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => openEditModal(item, canManageRecords)}
                          className="flex-1 sm:flex-none justify-center min-h-[46px] px-3.5 py-2 rounded-xl bg-[var(--g-surface-2)] hover:bg-[var(--g-primary-container)] border border-[var(--g-border)] text-xs sm:text-sm font-extrabold text-[var(--g-text)] flex items-center gap-1.5 active:scale-95 transition-colors"
                        >
                          <span className="ms-icon text-lg text-[var(--g-primary)]">edit</span>
                          <span>{canManageRecords ? 'تعديل / كمية' : 'تعديل الكمية'}</span>
                        </button>
                      )}

                      {canManageShortages && item.status === 'open' && (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => handleStatusChange(item, 'ordered')}
                          className="flex-1 sm:flex-none justify-center min-h-[46px] px-3.5 py-2 rounded-xl bg-[#C25E00] hover:bg-[#9A4A00] text-white text-xs sm:text-sm font-extrabold flex items-center gap-1.5 shadow-xs active:scale-95"
                        >
                          <span className="ms-icon text-lg">local_shipping</span>
                          <span>تم الطلب</span>
                        </button>
                      )}

                      {canManageShortages && item.status !== 'resolved' && (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => handleStatusChange(item, 'resolved')}
                          className="flex-1 sm:flex-none justify-center min-h-[46px] px-4 py-2 rounded-xl bg-[#146C2E] hover:bg-[#0F5223] text-white text-xs sm:text-sm font-extrabold flex items-center gap-1.5 shadow-sm active:scale-95"
                        >
                          <span className="ms-icon text-lg">check_circle</span>
                          <span>تم التوفير ✓</span>
                        </button>
                      )}

                      {canManageShortages && item.status === 'resolved' && (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => handleStatusChange(item, 'open')}
                          className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[var(--g-surface-2)] border border-[var(--g-border)] text-xs font-bold text-[var(--g-text)] flex items-center gap-1 active:scale-95"
                        >
                          <span className="ms-icon text-base">replay</span>
                          <span>إعادة للنواقص</span>
                        </button>
                      )}

                      {/* Permanent Delete strictly for Admin (records:manage) */}
                      {canManageRecords && (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => handleDeleteShortage(item)}
                          className="min-h-[44px] px-3 py-2 rounded-xl bg-[var(--g-red-bg)] hover:bg-[#C5221F] border border-[var(--g-red-border)]/40 text-[var(--g-red)] hover:text-white text-xs font-extrabold flex items-center gap-1 active:scale-95 transition-colors"
                          title="حذف نهائي (للأدمن فقط)"
                        >
                          <span className="ms-icon text-lg">delete</span>
                          <span className="hidden sm:inline">حذف</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick / Admin Edit Modal */}
      {editingItem && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setEditingItem(null)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveEdit}
            className="w-full sm:max-w-lg bg-[var(--g-surface)] rounded-t-3xl sm:rounded-3xl border border-[var(--g-border)] p-5 space-y-4 max-h-[92vh] overflow-y-auto shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-[var(--g-text)]">
                تعديل الصنف والكمية المطلوبة
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="w-10 h-10 rounded-full bg-[var(--g-surface-2)] flex items-center justify-center"
              >
                <span className="ms-icon">close</span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--g-text-muted)] mb-1">
                اسم الصنف
              </label>
              <input
                type="text"
                value={editForm.item_name}
                onChange={(e) => setEditForm((f) => ({ ...f, item_name: e.target.value }))}
                className="g-input min-h-[50px] text-base font-extrabold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--g-text-muted)] mb-1">
                القسم
              </label>
              <select
                value={editForm.category}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                className="g-input min-h-[48px] text-sm font-bold"
              >
                {SHORTAGE_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Nullable / 0 / Positive Qty in Edit Modal */}
            <div className="p-3.5 rounded-2xl bg-[var(--g-surface-2)] border border-[var(--g-border)] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs sm:text-sm font-extrabold text-[var(--g-text)]">
                  الكمية المطلوبة (فاضي أو 0 أو عدد)
                </span>
                <span className="text-xs font-black text-[var(--g-primary)]">
                  {formatRequestedQty(
                    parseQtyInputForPayload(editForm.qtyInput).value,
                    editForm.unit
                  )}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {QTY_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setEditForm((f) => ({ ...f, qtyInput: p.value }))}
                    className={`min-h-[42px] px-3 py-1.5 rounded-xl border text-xs font-black ${
                      normalizeDigitsClient(editForm.qtyInput).trim() === p.value
                        ? 'border-[var(--g-primary)] bg-[var(--g-primary)] text-white'
                        : 'border-[var(--g-border)] bg-[var(--g-surface)] text-[var(--g-text)]'
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
                  className="w-12 h-12 rounded-xl bg-[#146C2E] hover:bg-[#0F5223] text-white text-xl font-black shrink-0"
                >
                  +
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
                  placeholder="فاضي (بدون كمية)"
                  className="g-input min-h-[48px] text-center text-lg font-black"
                />
                <button
                  type="button"
                  onClick={() =>
                    setEditForm((f) => ({ ...f, qtyInput: adjustQty(f.qtyInput, -1) }))
                  }
                  className="w-12 h-12 rounded-xl bg-[var(--g-surface)] border border-[var(--g-border)] text-xl font-black shrink-0"
                >
                  −
                </button>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {UNIT_OPTIONS.map((u) => (
                  <button
                    key={u || '__none'}
                    type="button"
                    onClick={() => setEditForm((f) => ({ ...f, unit: u }))}
                    className={`min-h-[36px] px-2.5 py-1 rounded-full text-xs font-extrabold border ${
                      editForm.unit === u
                        ? 'border-[var(--g-primary)] bg-[var(--g-primary)] text-white'
                        : 'border-[var(--g-border)] bg-[var(--g-surface)] text-[var(--g-text)]'
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
                className={`min-h-[48px] rounded-xl border-2 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all ${
                  editForm.urgency === 'out_of_stock'
                    ? 'border-[#9E1C17] bg-[#C5221F] text-white shadow-xs'
                    : 'border-[var(--g-border)] bg-[var(--g-surface)] text-[var(--g-text)]'
                }`}
              >
                <span
                  className={`ms-icon filled text-lg ${
                    editForm.urgency === 'out_of_stock' ? 'text-white' : 'text-[#C5221F]'
                  }`}
                >
                  error
                </span>
                <span>خلص تماماً</span>
              </button>
              <button
                type="button"
                onClick={() => setEditForm((f) => ({ ...f, urgency: 'low_stock' }))}
                className={`min-h-[48px] rounded-xl border-2 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all ${
                  editForm.urgency === 'low_stock'
                    ? 'border-[#9A4A00] bg-[#C25E00] text-white shadow-xs'
                    : 'border-[var(--g-border)] bg-[var(--g-surface)] text-[var(--g-text)]'
                }`}
              >
                <span
                  className={`ms-icon filled text-lg ${
                    editForm.urgency === 'low_stock' ? 'text-white' : 'text-[#C25E00]'
                  }`}
                >
                  warning
                </span>
                <span>قرب يخلص</span>
              </button>
            </div>

            {(canManageShortages || canManageRecords) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[var(--g-text-muted)] mb-1">
                    حالة التوفير
                  </label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                    className="g-input min-h-[46px] text-sm font-bold"
                  >
                    <option value="open">مطلوب توفيره الآن</option>
                    <option value="ordered">تم الطلب من المورد</option>
                    <option value="resolved">تم التوفير بالصالة ✓</option>
                  </select>
                </div>

                {suppliers.length > 0 && (
                  <div>
                    <label className="block text-xs font-bold text-[var(--g-text-muted)] mb-1">
                      المورد
                    </label>
                    <select
                      value={editForm.supplier_id}
                      onChange={(e) => setEditForm((f) => ({ ...f, supplier_id: e.target.value }))}
                      className="g-input min-h-[46px] text-sm font-bold"
                    >
                      <option value="">— بدون مورد —</option>
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
              <label className="block text-xs font-bold text-[var(--g-text-muted)] mb-1">
                ملاحظات
              </label>
              <input
                type="text"
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="ملاحظة إضافية..."
                className="g-input min-h-[46px] text-sm"
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                disabled={busyId === editingItem.id}
                className="flex-1 min-h-[52px] rounded-2xl bg-[var(--g-primary)] text-white font-black text-base"
              >
                حفظ التعديل ✓
              </button>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="min-h-[52px] px-5 rounded-2xl bg-[var(--g-surface-2)] text-[var(--g-text)] font-bold text-sm"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Quick Catalog Manager Modal for Admin / Supervisor */}
      {showCatalogModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setShowCatalogModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-xl bg-[var(--g-surface)] rounded-t-3xl sm:rounded-3xl border border-[var(--g-border)] p-5 space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-[var(--g-text)]">
                  إدارة أزرار الأصناف السريعة ({productCatalog.length})
                </h3>
                <p className="text-xs text-[var(--g-text-muted)]">
                  جهّز أشهر أصناف الماركت هنا ليختارها عمال الصالة بلمسة واحدة بدون كتابة
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCatalogModal(false)}
                className="w-10 h-10 rounded-full bg-[var(--g-surface-2)] flex items-center justify-center"
              >
                <span className="ms-icon">close</span>
              </button>
            </div>

            <form onSubmit={handleBulkAddCatalog} className="space-y-3 p-3.5 rounded-2xl bg-[var(--g-surface-2)] border border-[var(--g-border)]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-[var(--g-text-muted)] mb-1">
                    القسم
                  </label>
                  <select
                    value={bulkCategory}
                    onChange={(e) => setBulkCategory(e.target.value)}
                    className="g-input min-h-[44px] text-sm font-bold"
                  >
                    {SHORTAGE_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.emoji} {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--g-text-muted)] mb-1">
                    الوحدة الافتراضية (اختياري)
                  </label>
                  <select
                    value={bulkUnit}
                    onChange={(e) => setBulkUnit(e.target.value)}
                    className="g-input min-h-[44px] text-sm font-bold"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u || '__none'} value={u}>
                        {u || 'بدون وحدة افتراضية'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--g-text-muted)] mb-1">
                  اكتب كل صنف في سطر مستقل (يمكنك لصق قائمة كاملة دفعة واحدة)
                </label>
                <textarea
                  rows={4}
                  value={bulkLines}
                  onChange={(e) => setBulkLines(e.target.value)}
                  placeholder={'لبن جهينة كامل الدسم 1 لتر\nجبنة عبور لاند فيتا 500 جم\nزيت كريستال عباد 800 مل'}
                  className="g-input text-sm font-bold"
                />
              </div>

              <button
                type="submit"
                disabled={catalogBusy}
                className="w-full min-h-[48px] rounded-xl bg-[var(--g-primary)] text-white font-black text-sm"
              >
                {catalogBusy ? 'جاري الحفظ...' : 'إضافة للأزرار السريعة +'}
              </button>
            </form>

            {productCatalog.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                <div className="text-xs font-bold text-[var(--g-text-muted)]">
                  الأصناف المحفوظة حالياً:
                </div>
                {productCatalog.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--g-surface-2)] border border-[var(--g-border)]"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[var(--g-text)] truncate">
                        {c.name}
                      </div>
                      <div className="text-[11px] text-[var(--g-text-muted)]">
                        {c.category} {c.default_unit ? `• ${c.default_unit}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={catalogBusy}
                      onClick={() => handleDeleteCatalogItem(c)}
                      className="w-9 h-9 rounded-lg text-[#C5221F] hover:bg-[#FCE8E6] flex items-center justify-center shrink-0"
                      title="حذف من الكتالوج"
                    >
                      <span className="ms-icon text-lg">delete</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
