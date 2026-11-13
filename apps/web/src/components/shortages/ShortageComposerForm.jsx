import React from 'react';
import { formatRequestedQty, normalizeDigitsClient } from '../../lib/api.js';
import VoiceMicButton from '../VoiceMicButton.jsx';

export default function ShortageComposerForm({
  categories = [],
  unitOptions = [],
  qtyPresets = [],
  suppliers = [],
  canManageShortages = false,
  canManageRecords = false,
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
  onSubmit,
  onToast,
  inSheet = false,
}) {
  const parsedLiveQty = parseQtyInputForPayload(qtyInput);
  const liveQtyPreview = !parsedLiveQty.ok
    ? 'رقم غير صحيح'
    : formatRequestedQty(parsedLiveQty.value, unit);

  return (
    <form
      onSubmit={onSubmit}
      className={
        inSheet
          ? 'space-y-4'
          : 'g-card p-4 sm:p-5 space-y-4 border-2 border-[var(--g-primary)]/20'
      }
    >
      {/* Toggle between Shortage vs Cashier Product Suggestion */}
      <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-[var(--g-surface-variant)]">
        <button
          type="button"
          onClick={() => setIsSuggestion(false)}
          className={`min-h-[44px] py-2 px-3 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all ${
            !isSuggestion
              ? 'bg-[var(--g-surface)] text-[var(--g-primary)] shadow-xs'
              : 'text-[var(--g-muted)]'
          }`}
        >
          <span className="ms-icon text-base">production_quantity_limits</span>
          <span>صنف ناقص بالصالة</span>
        </button>
        <button
          type="button"
          onClick={() => setIsSuggestion(true)}
          className={`min-h-[44px] py-2 px-3 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all ${
            isSuggestion
              ? 'bg-[var(--g-purple-bg)] text-[var(--g-purple)] shadow-xs border border-[var(--g-purple-border)]/40'
              : 'text-[var(--g-muted)]'
          }`}
        >
          <span className="ms-icon text-base">lightbulb</span>
          <span>اقتراح صنف جديد</span>
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-[var(--g-primary)] text-white text-sm font-black flex items-center justify-center num-ltr">
            1
          </span>
          <h3 className="text-sm sm:text-base font-black text-[var(--g-text)] m-0">
            {isSuggestion ? 'القسم واسم الصنف المقترح' : 'اختر القسم واكتب اسم الصنف الناقص'}
          </h3>
        </div>
        <VoiceMicButton
          onTranscript={(txt) => setItemName((prev) => (prev ? `${prev} ${txt}` : txt))}
          onToast={onToast}
        />
      </div>

      {/* Step 1: Category Grid with Crisp Material Symbols */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {categories.map((cat) => {
          const active = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`min-h-[44px] px-3 py-2 rounded-2xl border text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${
                active
                  ? 'border-[var(--g-primary)] bg-[var(--g-primary-solid)] text-white shadow-sm'
                  : 'border-[var(--g-border)] bg-[var(--g-surface-2)] text-[var(--g-text)] hover:border-[var(--g-primary)]'
              }`}
            >
              <span className={`ms-icon text-base ${active ? 'filled' : 'text-[var(--g-primary)]'}`}>
                {cat.icon}
              </span>
              <span className="truncate">{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* Item Name Input */}
      <div>
        <label className="block text-xs sm:text-sm font-extrabold text-[var(--g-text)] mb-1.5">
          اسم الصنف المطلوب (يُحفظ تلقائياً في الكتالوج السريع)
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
            className="g-input min-h-[52px] text-base font-extrabold pl-10"
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
      <div className="p-3.5 rounded-2xl bg-[var(--g-surface-2)] border border-[var(--g-border)] space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-[var(--g-primary)] text-white text-sm font-black flex items-center justify-center num-ltr">
              2
            </span>
            <div>
              <div className="text-sm font-black text-[var(--g-text)]">
                الكمية المطلوبة (اختياري)
              </div>
              <div className="text-[11px] text-[var(--g-text-muted)]">
                اتركها فاضية أو اختر 0 أو اكتب العدد
              </div>
            </div>
          </div>

          <span className="px-3 py-1 rounded-full text-xs font-black bg-[var(--g-primary-container)] text-[var(--g-on-primary-container)] num-ltr">
            {liveQtyPreview}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {qtyPresets.map((preset) => {
            const isSelected = normalizeDigitsClient(qtyInput).trim() === preset.value;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => setQtyInput(preset.value)}
                className={`min-h-[42px] px-3 py-1.5 rounded-xl border text-xs font-black transition-all active:scale-[0.97] num-ltr ${
                  isSelected
                    ? 'border-[var(--g-primary)] bg-[var(--g-primary-solid)] text-white shadow-sm'
                    : 'border-[var(--g-border)] bg-[var(--g-surface)] text-[var(--g-text)]'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setQtyInput((prev) => adjustQty(prev, 1))}
            className="w-13 h-13 rounded-2xl bg-[#146C2E] hover:bg-[#0F5223] text-white text-2xl font-black flex items-center justify-center shrink-0 shadow-sm active:scale-95"
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
              className="g-input min-h-[52px] text-center text-lg font-black num-ltr"
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
            className="w-13 h-13 rounded-2xl bg-[var(--g-surface)] border border-[var(--g-border)] text-[var(--g-text)] text-2xl font-black flex items-center justify-center shrink-0 active:scale-95"
            aria-label="تقليل الكمية"
          >
            −
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <span className="text-xs font-bold text-[var(--g-text-muted)] ml-1">الوحدة:</span>
          {unitOptions.map((u) => (
            <button
              key={u || '__none'}
              type="button"
              onClick={() => setUnit(u)}
              className={`min-h-[38px] px-3 py-1 rounded-full text-xs font-extrabold border transition-all ${
                unit === u
                  ? 'border-[var(--g-primary)] bg-[var(--g-primary-solid)] text-white shadow-2xs'
                  : 'border-[var(--g-border)] bg-[var(--g-surface)] text-[var(--g-text)] hover:border-[var(--g-primary)]'
              }`}
            >
              {u || 'بدون وحدة'}
            </button>
          ))}
        </div>
      </div>

      {/* Step 3: Urgency 2-Big Buttons */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => setUrgency('out_of_stock')}
          className={`min-h-[50px] p-3 rounded-2xl border-2 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99] ${
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
          <span>خلص تماماً</span>
        </button>

        <button
          type="button"
          onClick={() => setUrgency('low_stock')}
          className={`min-h-[50px] p-3 rounded-2xl border-2 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99] ${
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
          <span>قرب يخلص</span>
        </button>
      </div>

      {/* Optional Extra Note / Supplier Toggle */}
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
                className="g-input min-h-[44px] text-sm"
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
                  className="g-input min-h-[44px] text-sm"
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

      {/* Primary Submit Button */}
      <button
        type="submit"
        disabled={submitting}
        className="w-full min-h-[54px] rounded-2xl bg-[#146C2E] hover:bg-[#0F5223] text-white text-sm sm:text-base font-black shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.99] disabled:opacity-60"
      >
        <span className="ms-icon filled text-2xl">add_shopping_cart</span>
        <span>{submitting ? 'جاري التسجيل...' : 'تسجيل الصنف في النواقص الآن'}</span>
      </button>
    </form>
  );
}
