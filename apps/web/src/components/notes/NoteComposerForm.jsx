import React from 'react';
import ProofUploader from '../ProofUploader.jsx';
import VoiceMicButton from '../VoiceMicButton.jsx';

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
  return (
    <form
      onSubmit={onSubmit}
      className={inSheet ? 'space-y-4' : 'g-card p-4 sm:p-5 space-y-4'}
    >
      {!inSheet && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--g-border)] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] flex items-center justify-center shrink-0">
              <span className="ms-icon filled text-xl">edit_note</span>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-extrabold m-0">
                تسجيل ملاحظة (لمس أو صوتي)
              </h2>
              <p className="text-xs text-[var(--g-muted)] m-0">
                بدون كيبورد: اختر الوسم أو اضغط الإملاء الصوتي
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 1. Location Quick Chips */}
      <div>
        <label className="block text-xs font-bold text-[var(--g-muted)] mb-1.5">
          1. المكان داخل الماركت:
        </label>
        <div className="flex flex-wrap gap-1.5">
          {locationTags.map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => setLocationTag(loc)}
              className={`min-h-[44px] px-3.5 py-1.5 rounded-xl text-xs border transition-all active:scale-95 ${
                locationTag === loc
                  ? 'bg-[var(--g-primary)] text-white border-[var(--g-primary)] font-extrabold shadow-2xs'
                  : 'bg-[var(--g-surface-variant)] border-[var(--g-border)] font-semibold'
              }`}
            >
              {loc}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Category Quick Chips */}
      <div>
        <label className="block text-xs font-bold text-[var(--g-muted)] mb-1.5">
          2. نوع الملاحظة:
        </label>
        <div className="flex flex-wrap gap-1.5">
          {categoryTags.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryTag(cat)}
              className={`min-h-[44px] px-3.5 py-1.5 rounded-xl text-xs border transition-all active:scale-95 ${
                categoryTag === cat
                  ? 'g-pill-active border-transparent shadow-2xs'
                  : 'bg-[var(--g-surface-variant)] border-[var(--g-border)] font-semibold'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Severity + Reference Timestamp */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-bold text-[var(--g-muted)] mb-1.5">
            3. درجة الأهمية:
          </label>
          <div className="grid grid-cols-3 gap-2">
            {severities.map((sev) => (
              <button
                key={sev.id}
                type="button"
                onClick={() => setSeverity(sev.id)}
                className={`min-h-[50px] py-2 px-1.5 rounded-2xl border text-xs font-extrabold flex flex-col sm:flex-row items-center justify-center gap-1 text-center leading-tight transition-all min-w-0 active:scale-95 ${
                  severity === sev.id
                    ? sev.activeStyle
                    : 'bg-[var(--g-surface-variant)] border-[var(--g-border)] text-[var(--g-muted)]'
                }`}
              >
                <span className="ms-icon text-base">{sev.icon}</span>
                <span className="truncate max-w-full">{sev.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-center">
          <div>
            <label className="block text-xs font-bold text-[var(--g-muted)] mb-1">
              وقت الواقعة بالثانية (مرجع التسجيل):
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={dvrTimestamp}
                onChange={(e) => setDvrTimestamp(e.target.value)}
                className="g-input w-full text-sm font-extrabold num-ltr text-center"
                placeholder="HH:MM:SS"
              />
              <button
                type="button"
                onClick={onResetTimestamp}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-xs font-extrabold shrink-0"
              >
                الآن
              </button>
            </div>
          </div>

          <label className="min-h-[44px] flex items-center gap-2 p-3 rounded-2xl bg-[var(--g-surface-variant)] text-xs font-bold cursor-pointer sm:mt-5">
            <input
              type="checkbox"
              checked={keepOpenForHandover}
              onChange={(e) => setKeepOpenForHandover(e.target.checked)}
              className="w-4 h-4 accent-[#0B57D0]"
            />
            <span>نقل للوردية التالية للمتابعة</span>
          </label>
        </div>
      </div>

      {/* 4. Arabic Voice-to-Text + Textarea */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
          <label className="text-xs font-bold text-[var(--g-muted)]">
            تفاصيل الملاحظة:
          </label>
          <VoiceMicButton
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
          placeholder="اضغط زر الإملاء الصوتي وتحدث بالعامية ليكتب النظام تلقائياً، أو اتركها فارغة لحفظ الوسوم المختارة..."
          className="g-input w-full resize-none"
        />
      </div>

      {/* 5. Optional Screenshot / Phone Photo */}
      <ProofUploader
        value={proofDataUrl}
        onChange={setProofDataUrl}
        label="سكرين شوت (Ctrl+V) أو صورة من الفون"
        compact
      />

      <button
        type="submit"
        disabled={submitting || !canWrite}
        className="w-full min-h-[50px] py-3 rounded-full bg-[var(--g-primary)] text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
      >
        <span className="ms-icon filled">add_task</span>
        <span>
          {submitting
            ? 'جاري الحفظ...'
            : canWrite
            ? 'حفظ الملاحظة الآن'
            : 'عرض فقط (بدون صلاحية إضافة)'}
        </span>
      </button>
    </form>
  );
}
