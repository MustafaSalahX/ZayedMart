import React from 'react';
import ProofUploader from '../ProofUploader.jsx';
import VoiceMicButton from '../VoiceMicButton.jsx';
import { Button, Card, FilterChipRail, SectionHeader } from '../ui/index.js';

/**
 * Reusable Note Composer used inline on desktop and inside BottomSheet on mobile.
 */
export default function NoteComposerForm({
  locationTags = [],
  categoryTags = [],
  severities = [],
  locationTag,
  setLocationTag,
  categoryTag,
  setCategoryTag,
  severity,
  setSeverity,
  dvrTimestamp,
  setDvrTimestamp,
  onResetTimestamp,
  keepOpenForHandover,
  setKeepOpenForHandover,
  content,
  setContent,
  proofDataUrl,
  setProofDataUrl,
  submitting,
  canWrite,
  onSubmit,
  onToast,
  inSheet = false,
}) {
  const locationChipItems = locationTags.map((loc) => ({
    id: loc,
    label: loc,
  }));

  const categoryChipItems = categoryTags.map((cat) => ({
    id: cat,
    label: cat,
  }));

  const isAutoHandover = severity === 'urgent';

  const formBody = (
    <form onSubmit={onSubmit} className="space-y-4">
      {!inSheet && <SectionHeader title="ملاحظة جديدة" />}

      {/* Location */}
      <div>
        <label className="block text-xs font-medium text-ink-muted mb-1.5">
          المكان
        </label>
        {inSheet ? (
          <FilterChipRail
            items={locationChipItems}
            activeId={locationTag}
            onSelect={setLocationTag}
          />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {locationTags.map((loc) => {
              const active = locationTag === loc;
              return (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setLocationTag(loc)}
                  className={`min-h-[44px] px-3 py-1.5 rounded-[var(--g-radius-md)] text-xs border transition-[background-color,border-color,color] duration-150 cursor-pointer ${
                    active
                      ? 'bg-primary-solid text-on-primary border-primary font-semibold'
                      : 'bg-surface-2 border-line text-ink font-medium hover:border-line-strong'
                  }`}
                >
                  {loc}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Category */}
      <div>
        <label className="block text-xs font-medium text-ink-muted mb-1.5">
          التصنيف
        </label>
        {inSheet ? (
          <FilterChipRail
            items={categoryChipItems}
            activeId={categoryTag}
            onSelect={setCategoryTag}
          />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {categoryTags.map((cat) => {
              const active = categoryTag === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryTag(cat)}
                  className={`min-h-[44px] px-3 py-1.5 rounded-[var(--g-radius-md)] text-xs border transition-[background-color,border-color,color] duration-150 cursor-pointer ${
                    active
                      ? 'bg-primary-solid text-on-primary border-primary font-semibold'
                      : 'bg-surface-2 border-line text-ink font-medium hover:border-line-strong'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Severity + DVR Time */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1.5">
            الأهمية
          </label>
          <div className="grid grid-cols-3 gap-2">
            {severities.map((sev) => {
              const active = severity === sev.id;
              return (
                <button
                  key={sev.id}
                  type="button"
                  onClick={() => setSeverity(sev.id)}
                  className={`min-h-[44px] py-2 px-2 rounded-[var(--g-radius-md)] border text-xs font-semibold flex items-center justify-center transition-[background-color,border-color,color] duration-150 cursor-pointer ${
                    active
                      ? sev.activeStyle
                      : 'bg-surface-2 border-line text-ink-muted hover:text-ink'
                  }`}
                >
                  <span className="truncate">{sev.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">
              وقت DVR
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={dvrTimestamp}
                onChange={(e) => setDvrTimestamp(e.target.value)}
                className="g-input w-full text-sm font-semibold num-ltr text-center"
                placeholder="HH:MM:SS"
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={onResetTimestamp}
                className="shrink-0"
              >
                الآن
              </Button>
            </div>
          </div>

          <label className="min-h-[44px] flex items-center gap-2 px-3 py-2 rounded-[var(--g-radius-md)] border border-line text-xs font-medium text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(keepOpenForHandover || isAutoHandover)}
              disabled={isAutoHandover}
              onChange={(e) => setKeepOpenForHandover(e.target.checked)}
              className="w-4 h-4 accent-[var(--g-primary-solid)]"
            />
            <span>نقل للوردية التالية</span>
          </label>
        </div>
      </div>

      {/* Textarea + Voice */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <label className="text-xs font-medium text-ink-muted">التفاصيل</label>
          <VoiceMicButton
            small
            onToast={onToast}
            onTranscript={(spoken) =>
              setContent((prev) => (prev ? `${prev} ${spoken}` : spoken))
            }
          />
        </div>
        <textarea
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="اكتب الملاحظة..."
          className="g-input w-full resize-none"
        />
      </div>

      <ProofUploader
        value={proofDataUrl}
        onChange={setProofDataUrl}
        label="صورة مرفقة"
        compact
      />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={submitting}
        disabled={!canWrite}
      >
        {submitting ? 'جاري الحفظ...' : canWrite ? 'حفظ الملاحظة' : 'للعرض فقط'}
      </Button>
    </form>
  );

  if (inSheet) return formBody;

  return <Card padding="md">{formBody}</Card>;
}
