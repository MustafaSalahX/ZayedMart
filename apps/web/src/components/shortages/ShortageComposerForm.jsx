import React from 'react';
import { formatRequestedQty, normalizeDigitsClient } from '../../lib/api.js';
import VoiceMicButton from '../VoiceMicButton.jsx';
import { Button, Card, FilterChipRail, Icon, SegmentedControl } from '../ui/index.js';

const COMPOSER_MODE_OPTIONS = [
  { id: 'shortage', labelAr: 'صنف ناقص' },
  { id: 'suggestion', labelAr: 'اقتراح صنف' },
];

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
    : parsedLiveQty.value !== null
    ? formatRequestedQty(parsedLiveQty.value, unit)
    : '';

  const categoryChipItems = categories.map((cat) => ({
    id: cat.id,
    label: cat.label,
  }));

  const formBody = (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Mode Switcher */}
      <SegmentedControl
        options={COMPOSER_MODE_OPTIONS}
        value={isSuggestion ? 'suggestion' : 'shortage'}
        onChange={(v) => setIsSuggestion(v === 'suggestion')}
        ariaLabel="نوع التسجيل"
        fullWidth
      />

      {/* Category Selector */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-muted">القسم</span>
          <VoiceMicButton
            small
            onTranscript={(txt) => setItemName((prev) => (prev ? `${prev} ${txt}` : txt))}
            onToast={onToast}
          />
        </div>

        {inSheet ? (
          <FilterChipRail
            items={categoryChipItems}
            activeId={selectedCategory}
            onSelect={setSelectedCategory}
          />
        ) : (
          <>
            <div className="sm:hidden">
              <FilterChipRail
                items={categoryChipItems}
                activeId={selectedCategory}
                onSelect={setSelectedCategory}
              />
            </div>
            <div className="hidden sm:grid sm:grid-cols-5 gap-1.5">
              {categories.map((cat) => {
                const active = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`min-h-[44px] px-2.5 py-1.5 rounded-[var(--g-radius-md)] border text-xs font-medium flex items-center justify-center text-center transition-[background-color,border-color,color] duration-150 cursor-pointer ${
                      active
                        ? 'border-primary bg-primary-solid text-on-primary font-semibold'
                        : 'border-line bg-surface-2 text-ink hover:border-line-strong'
                    }`}
                  >
                    <span className="truncate">{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Item Name */}
      <div>
        <label
          htmlFor="shortage-item-name"
          className="block text-xs font-medium text-ink-muted mb-1.5"
        >
          اسم الصنف
        </label>
        <div className="relative">
          <input
            id="shortage-item-name"
            ref={nameInputRef}
            type="text"
            value={itemName}
            onChange={(e) => {
              setItemName(e.target.value);
              setSelectedCatalogId('');
            }}
            placeholder="اسم الصنف..."
            className="g-input pe-12"
          />
          {itemName && (
            <button
              type="button"
              onClick={() => {
                setItemName('');
                setSelectedCatalogId('');
                nameInputRef?.current?.focus();
              }}
              aria-label="مسح"
              className="absolute end-1.5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full text-ink-muted hover:text-ink flex items-center justify-center cursor-pointer"
            >
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Quantity Picker */}
      <div className="pt-2 border-t border-line space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-muted">الكمية</span>
          {liveQtyPreview && (
            <span className="text-xs font-semibold text-primary num-ltr">
              {liveQtyPreview}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto sm:flex-wrap no-scrollbar pb-0.5">
          {qtyPresets.map((preset) => {
            const isSelected = normalizeDigitsClient(qtyInput).trim() === preset.value;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => setQtyInput(preset.value)}
                className={`min-h-[44px] px-3 py-1 rounded-[var(--g-radius-sm)] border text-xs font-medium num-ltr shrink-0 cursor-pointer ${
                  isSelected
                    ? 'border-primary bg-primary-solid text-on-primary font-semibold'
                    : 'border-line bg-surface text-ink hover:border-line-strong'
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
            className="w-12 h-12 rounded-[var(--g-radius-md)] bg-success-solid text-on-success flex items-center justify-center shrink-0 cursor-pointer"
            aria-label="زيادة الكمية"
          >
            <Icon name="add" size={20} weight="bold" />
          </button>

          <input
            type="text"
            inputMode="decimal"
            dir="ltr"
            value={qtyInput}
            onChange={(e) => setQtyInput(normalizeDigitsClient(e.target.value))}
            placeholder="0"
            className="g-input flex-1 min-w-0 text-center text-base font-semibold num-ltr"
          />

          {qtyInput !== '' && (
            <button
              type="button"
              onClick={() => setQtyInput('')}
              aria-label="تفريغ"
              className="w-11 h-12 rounded-[var(--g-radius-md)] bg-surface-2 border border-line text-ink-muted hover:text-danger flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Icon name="backspace" size={18} />
            </button>
          )}

          <button
            type="button"
            onClick={() => setQtyInput((prev) => adjustQty(prev, -1))}
            className="w-12 h-12 rounded-[var(--g-radius-md)] bg-surface-2 border border-line text-ink flex items-center justify-center shrink-0 cursor-pointer"
            aria-label="تقليل الكمية"
          >
            <Icon name="remove" size={20} weight="bold" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {unitOptions.map((u) => (
            <button
              key={u || '__none'}
              type="button"
              onClick={() => setUnit(u)}
              className={`min-h-[40px] px-3 py-1 rounded-full text-xs font-medium border cursor-pointer ${
                unit === u
                  ? 'border-primary bg-primary-solid text-on-primary font-semibold'
                  : 'border-line bg-surface text-ink hover:border-line-strong'
              }`}
            >
              {u || 'بدون وحدة'}
            </button>
          ))}
        </div>
      </div>

      {/* Urgency */}
      {!isSuggestion && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setUrgency('out_of_stock')}
            className={`min-h-[44px] px-3 rounded-[var(--g-radius-md)] border font-semibold text-xs sm:text-sm flex items-center justify-center cursor-pointer ${
              urgency === 'out_of_stock'
                ? 'border-[var(--g-danger-solid)] bg-danger-solid text-on-danger'
                : 'border-line bg-surface text-ink hover:border-line-strong'
            }`}
          >
            نفد تماماً
          </button>

          <button
            type="button"
            onClick={() => setUrgency('low_stock')}
            className={`min-h-[44px] px-3 rounded-[var(--g-radius-md)] border font-semibold text-xs sm:text-sm flex items-center justify-center cursor-pointer ${
              urgency === 'low_stock'
                ? 'border-[var(--g-warning-solid)] bg-warning-solid text-on-warning'
                : 'border-line bg-surface text-ink hover:border-line-strong'
            }`}
          >
            قرب يخلص
          </button>
        </div>
      )}

      {/* Optional Extra Note / Supplier */}
      <div>
        <button
          type="button"
          onClick={() => setShowExtraFields((v) => !v)}
          className="min-h-[44px] text-xs font-medium text-primary flex items-center gap-1 py-1 cursor-pointer"
        >
          <Icon name={showExtraFields ? 'expand_less' : 'add'} size={16} />
          <span>ملاحظة أو مورد</span>
        </button>

        {showExtraFields && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-line">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-ink-muted">ملاحظة</label>
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
                placeholder="ملاحظة..."
                className="g-input"
              />
            </div>

            {suppliers.length > 0 && (canManageShortages || canManageRecords) && (
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  المورد
                </label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="g-input"
                >
                  <option value="">بدون مورد</option>
                  {suppliers.map((sup) => (
                    <option key={sup.id} value={sup.id}>
                      {sup.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      <Button
        type="submit"
        variant={isSuggestion ? 'primary' : 'success'}
        size="lg"
        fullWidth
        loading={submitting}
      >
        {submitting
          ? 'جاري التسجيل...'
          : isSuggestion
          ? 'تسجيل المقترح'
          : 'تسجيل الناقص'}
      </Button>
    </form>
  );

  if (inSheet) return formBody;

  return <Card padding="md">{formBody}</Card>;
}
