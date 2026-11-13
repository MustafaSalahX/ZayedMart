import React, { useEffect, useState } from 'react';
import NoteComposerForm from './notes/NoteComposerForm.jsx';
import { BottomSheet } from './ui/index.js';
import { postActionWithOfflineSupport, apiRequest } from '../lib/api.js';
import { playSuccessChime } from '../lib/audio.js';
import { formatTimeArabic, formatTimeWithSeconds } from '../lib/exportUtils.js';

const LOCATION_TAGS = [
  'منطقة الكاشير',
  'البوابة الرئيسية',
  'رصيف استلام البضاعة',
  'الممرات والصالة',
  'الثلاجات والأجبان',
  'المخزن',
  'محيط الماركت الخارجي',
];

const CATEGORY_TAGS = [
  'ملاحظات ومشاكل الكاشيرية',
  'زحام على الكاشير',
  'فرق حساب أو عهدة درج',
  'عطل باركود أو سيستم كاشير',
  'مرتجع أو موقف مع عميل',
  'ملاحظة عامة',
  'تأخير أو ترك مكان العمل',
  'عجز أو تالف بضاعة',
  'ثلاجة مفتوحة أو عطل',
  'اشتباه أو ملاحظة أمنية',
  'نظافة وترتيب ممر',
];

const SEVERITIES = [
  {
    id: 'normal',
    label: 'عادي',
    icon: 'info',
    activeStyle: 'g-pill-active border-transparent',
    badge: 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]',
  },
  {
    id: 'warning',
    label: 'يحتاج متابعة',
    icon: 'warning',
    activeStyle: 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)] border-[#E37400]',
    badge: 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]',
  },
  {
    id: 'urgent',
    label: 'طارئ للإدارة',
    icon: 'emergency_home',
    activeStyle: 'bg-[var(--g-red-bg)] text-[var(--g-red)] border-[#B3261E]',
    badge: 'bg-[var(--g-red-bg)] text-[var(--g-red)]',
  },
];

function nowHMS() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

export default function CctvNotesView({
  notes = [],
  handovers = [],
  summary = {},
  actorName = 'مراقب الكاميرات',
  actorRole = '',
  canWrite = true,
  canResolveNotes = false,
  canHandover = true,
  canManageRecords = false,
  onOpenHandoverModal,
  onRefresh,
  onToast,
  onPreviewImage,
}) {
  const handoverCardTitle =
    actorRole === 'cashier'
      ? 'تسليم واستلام وردية الكاشيرية'
      : actorRole === 'security'
      ? 'تسليم واستلام وردية الأمن'
      : actorRole === 'supervisor'
      ? 'تسليم واستلام وردية مشرف الصالة'
      : actorRole === 'manager' || actorRole === 'owner'
      ? 'تسليم واستلام الوردية الإدارية'
      : 'تسليم واستلام وردية مراقب الكاميرات';

  const handoverButtonLabel =
    actorRole === 'cashier'
      ? 'تسليم وردية الكاشير للكاشير التالي'
      : actorRole === 'security'
      ? 'تسليم الوردية لفرد الأمن التالي'
      : actorRole === 'supervisor'
      ? 'تسليم الوردية للمشرف التالي'
      : actorRole === 'manager' || actorRole === 'owner'
      ? 'تسليم الوردية للمسؤول التالي'
      : 'تسليم الوردية لمراقب الكاميرات التالي';
  const [locationTag, setLocationTag] = useState(
    actorRole === 'cashier' ? 'منطقة الكاشير' : LOCATION_TAGS[0]
  );
  const [categoryTag, setCategoryTag] = useState(
    actorRole === 'cashier' ? 'ملاحظات ومشاكل الكاشيرية' : CATEGORY_TAGS[0]
  );
  const [notesFilter, setNotesFilter] = useState('all');
  const [severity, setSeverity] = useState('normal');
  const [dvrTimestamp, setDvrTimestamp] = useState(() => nowHMS());
  const [content, setContent] = useState('');
  const [keepOpenForHandover, setKeepOpenForHandover] = useState(false);
  const [proofDataUrl, setProofDataUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [composerSheetOpen, setComposerSheetOpen] = useState(false);

  // SmartFab hook: open mobile composer BottomSheet when 'note_add' action fires
  useEffect(() => {
    function handleOpenComposer(ev) {
      if (ev?.detail?.action === 'note_add' && canWrite) {
        setComposerSheetOpen(true);
      }
    }
    window.addEventListener('zayed:open-composer', handleOpenComposer);
    return () => window.removeEventListener('zayed:open-composer', handleOpenComposer);
  }, [canWrite]);

  async function handleSaveNote(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await postActionWithOfflineSupport(
        '/api/notes',
        {
          location_tag: locationTag,
          category_tag: categoryTag,
          severity,
          dvr_timestamp: dvrTimestamp || nowHMS(),
          content: content.trim() || `${categoryTag} - ${locationTag}`,
          recorded_by: actorName,
          is_open_handover: keepOpenForHandover || severity === 'urgent',
        },
        {
          rawDataUrl: proofDataUrl,
          proofField: 'proof_url',
        }
      );

      playSuccessChime(severity === 'urgent' ? 'alert' : 'in');
      onToast?.(
        res.queuedOffline
          ? 'تم حفظ الملاحظة محلياً وسيتم رفعها تلقائياً'
          : 'تم تسجيل الملاحظة في سجل زايد مارت بنجاح ✓'
      );
      setContent('');
      setProofDataUrl('');
      setDvrTimestamp(nowHMS());
      setKeepOpenForHandover(false);
      setSeverity('normal');
      setComposerSheetOpen(false);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر حفظ الملاحظة', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolveNote(noteId) {
    try {
      await apiRequest(`/api/notes/${noteId}/resolve`, 'POST', {
        resolved_by: actorName,
      });
      playSuccessChime('in');
      onToast?.('تم إغلاق المتابعة على الملاحظة ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleSaveEditedNote(e) {
    e.preventDefault();
    if (!editingNote) return;
    try {
      await apiRequest(`/api/notes/${editingNote.id}`, 'PUT', {
        location_tag: editingNote.location_tag,
        category_tag: editingNote.category_tag,
        severity: editingNote.severity,
        dvr_timestamp: editingNote.dvr_timestamp,
        content: editingNote.content,
        is_open_handover: Boolean(editingNote.is_open_handover),
      });
      setEditingNote(null);
      onToast?.('تم تعديل الملاحظة بنجاح ✓');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleDeleteNote(note) {
    if (!window.confirm('حذف هذه الملاحظة نهائياً من السجل؟')) return;
    try {
      await apiRequest(`/api/notes/${note.id}`, 'DELETE');
      onToast?.('تم حذف الملاحظة');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  const openHandoverNotes = notes.filter((n) => n.is_open_handover === 1);

  const filteredNotes = notes.filter((n) => {
    if (notesFilter === 'cashier') {
      return (
        (n.location_tag || '').includes('الكاشير') ||
        (n.category_tag || '').includes('الكاشير') ||
        (n.category_tag || '').includes('درج') ||
        (n.category_tag || '').includes('باركود')
      );
    }
    if (notesFilter === 'open') {
      return Number(n.is_open_handover) === 1;
    }
    return true;
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Right Column: Inline Note Composer on Desktop */}
      <div className="hidden lg:block lg:col-span-5 space-y-4">
        <NoteComposerForm
          locationTags={LOCATION_TAGS}
          categoryTags={CATEGORY_TAGS}
          severities={SEVERITIES}
          locationTag={locationTag}
          setLocationTag={setLocationTag}
          categoryTag={categoryTag}
          setCategoryTag={setCategoryTag}
          severity={severity}
          setSeverity={setSeverity}
          dvrTimestamp={dvrTimestamp}
          setDvrTimestamp={setDvrTimestamp}
          onResetTimestamp={() => setDvrTimestamp(nowHMS())}
          keepOpenForHandover={keepOpenForHandover}
          setKeepOpenForHandover={setKeepOpenForHandover}
          content={content}
          setContent={setContent}
          proofDataUrl={proofDataUrl}
          setProofDataUrl={setProofDataUrl}
          submitting={submitting}
          canWrite={canWrite}
          onSubmit={handleSaveNote}
          onToast={onToast}
        />
      </div>

      {/* Mobile Composer Snap BottomSheet */}
      <BottomSheet
        open={composerSheetOpen}
        onClose={() => setComposerSheetOpen(false)}
        title="تسجيل ملاحظة جديدة"
        subtitle="اختر المكان ونوع الملاحظة أو استخدم الإملاء الصوتي"
        icon="edit_note"
        maxWidth="max-w-xl"
      >
        <NoteComposerForm
          inSheet
          locationTags={LOCATION_TAGS}
          categoryTags={CATEGORY_TAGS}
          severities={SEVERITIES}
          locationTag={locationTag}
          setLocationTag={setLocationTag}
          categoryTag={categoryTag}
          setCategoryTag={setCategoryTag}
          severity={severity}
          setSeverity={setSeverity}
          dvrTimestamp={dvrTimestamp}
          setDvrTimestamp={setDvrTimestamp}
          onResetTimestamp={() => setDvrTimestamp(nowHMS())}
          keepOpenForHandover={keepOpenForHandover}
          setKeepOpenForHandover={setKeepOpenForHandover}
          content={content}
          setContent={setContent}
          proofDataUrl={proofDataUrl}
          setProofDataUrl={setProofDataUrl}
          submitting={submitting}
          canWrite={canWrite}
          onSubmit={handleSaveNote}
          onToast={onToast}
        />
      </BottomSheet>

      {/* Left Column: Mobile Quick Action Bar + Shift Handover Card + Notes Stream */}
      <div className="lg:col-span-7 space-y-5">
        {canWrite && (
          <div className="lg:hidden g-card p-3.5 flex items-center justify-between gap-2.5 bg-[var(--g-surface)]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-[var(--g-primary-container)] text-[var(--g-primary)] flex items-center justify-center shrink-0">
                <span className="ms-icon filled text-xl">edit_note</span>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-black text-[var(--g-text)] truncate">
                  تسجيل ملاحظة سريعة
                </div>
                <div className="text-[11px] text-[var(--g-muted)] truncate">
                  لمس سريع أو إملاء صوتي بالعامية
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setComposerSheetOpen(true)}
              className="min-h-[44px] px-4 py-2 rounded-full bg-[var(--g-primary)] text-white text-xs sm:text-sm font-extrabold flex items-center gap-1.5 shadow-sm shrink-0 active:scale-[0.98]"
            >
              <span className="ms-icon text-lg">add</span>
              <span>إضافة ملاحظة</span>
            </button>
          </div>
        )}
        {/* Feature #1: Shift Handover Control Card */}
        <section className="g-card p-4 sm:p-5 bg-[var(--g-surface-tint)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-[var(--g-primary)] text-white flex items-center justify-center shrink-0">
                <span className="ms-icon filled text-2xl">swap_horiz</span>
              </div>
              <div>
                <h3 className="text-base font-extrabold m-0">
                  {handoverCardTitle}
                </h3>
                <p className="text-xs text-[var(--g-muted)] m-0 mt-0.5">
                  مهام مفتوحة الآن: <strong>{openHandoverNotes.length}</strong> ملاحظة •{' '}
                  <strong>{summary.unloadingTrucksCount || 0}</strong> عربية قيد التنزيل
                </p>
              </div>
            </div>

            {canHandover && (
              <button
                type="button"
                onClick={onOpenHandoverModal}
                className="w-full sm:w-auto px-5 py-2.5 rounded-full bg-[var(--g-primary)] text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 shadow-xs shrink-0"
              >
                <span className="ms-icon filled text-lg">send_and_archive</span>
                <span>{handoverButtonLabel}</span>
              </button>
            )}
          </div>

          {handovers.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--g-border)] text-xs text-[var(--g-muted)] flex flex-wrap items-center justify-between gap-2">
              <span>
                آخر تسليم: من <strong>{handovers[0].from_operator}</strong> إلى{' '}
                <strong>{handovers[0].to_operator}</strong> (
                {handovers[0].acknowledged ? 'تم الاستلام ✓' : 'بانتظار استلام الوردية'})
              </span>
              <span className="num-ltr font-bold">
                {formatTimeArabic(handovers[0].timestamp)}
              </span>
            </div>
          )}
        </section>

        {/* Notes Feed */}
        <section className="g-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <span className="ms-icon filled text-[var(--g-primary)]">feed</span>
              <h3 className="text-base sm:text-lg font-extrabold m-0">
                سجل ملاحظات الكاشيرية والأمن والكاميرات ({filteredNotes.length})
              </h3>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {[
                { id: 'all', label: `الكل (${notes.length})` },
                { id: 'cashier', icon: 'point_of_sale', label: 'ملاحظات الكاشيرية' },
                { id: 'open', icon: 'pending_actions', label: `للمتابعة (${openHandoverNotes.length})` },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setNotesFilter(f.id)}
                  className={`min-h-[36px] px-3 py-1 rounded-full text-xs font-extrabold whitespace-nowrap transition-all inline-flex items-center gap-1 ${
                    notesFilter === f.id
                      ? 'bg-[var(--g-primary)] text-white'
                      : 'bg-[var(--g-surface-variant)] text-[var(--g-muted)]'
                  }`}
                >
                  {f.icon && <span className="ms-icon text-sm">{f.icon}</span>}
                  <span>{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          {filteredNotes.length === 0 ? (
            <div className="text-center py-10 text-[var(--g-muted)] text-sm">
              لا توجد ملاحظات مسجلة في هذا التصنيف حتى الآن.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredNotes.map((n) => {
                const sev = SEVERITIES.find((s) => s.id === n.severity) || SEVERITIES[0];
                return (
                  <div
                    key={n.id}
                    className={`p-4 rounded-2xl border transition-all ${
                      n.severity === 'urgent'
                        ? 'border-[#B3261E]/60 bg-[var(--g-red-bg)]/30'
                        : n.is_open_handover
                        ? 'g-smart-timer-orange'
                        : 'border-[var(--g-border)] bg-[var(--g-surface-variant)]/50'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold ${sev.badge}`}>
                          {sev.label}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[var(--g-surface)] border border-[var(--g-border)]">
                          <span className="ms-icon text-sm text-[var(--g-primary)]">location_on</span>
                          <span>{n.location_tag}</span>
                        </span>
                        <span className="text-xs text-[var(--g-muted)] font-semibold">
                          • {n.category_tag}
                        </span>
                      </div>

                      <span className="inline-flex items-center gap-1 num-ltr text-xs font-extrabold px-2.5 py-1 rounded-lg bg-[var(--g-surface)] border border-[var(--g-border)]">
                        <span className="ms-icon text-sm text-[var(--g-muted)]">schedule</span>
                        <span>{n.dvr_timestamp || formatTimeWithSeconds(n.timestamp)}</span>
                      </span>
                    </div>

                    <p className="text-sm sm:text-base font-medium my-2.5 whitespace-pre-wrap">
                      {n.content}
                    </p>

                    {n.proof_url && (
                      <div className="mb-3">
                        <button
                          type="button"
                          onClick={() =>
                            onPreviewImage?.(n.proof_url, `${n.location_tag} - ${n.dvr_timestamp}`)
                          }
                          className="group relative inline-block rounded-2xl overflow-hidden border border-[var(--g-border)]"
                        >
                          <img
                            src={n.proof_url}
                            alt="مرفق الملاحظة"
                            className="h-28 w-auto max-w-full object-cover"
                          />
                          <span className="absolute bottom-1.5 right-1.5 px-2.5 py-0.5 rounded-full bg-black/75 text-white text-[11px] font-bold flex items-center gap-1">
                            <span className="ms-icon text-sm">zoom_in</span>
                            تكبير
                          </span>
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--g-border)]/70 text-xs text-[var(--g-muted)]">
                      <span>
                        بواسطة: <strong>{n.recorded_by}</strong> • {n.date_key}
                      </span>

                      <div className="flex items-center gap-2 flex-wrap">
                        {n.is_open_handover === 1 ? (
                          canResolveNotes ? (
                            <button
                              type="button"
                              onClick={() => handleResolveNote(n.id)}
                              className="px-3.5 py-1.5 rounded-full bg-[#146C2E] text-white font-extrabold flex items-center gap-1"
                            >
                              <span className="ms-icon text-sm">check</span>
                              <span>تمت المتابعة والإغلاق ✓</span>
                            </button>
                          ) : (
                            <span className="text-[var(--g-yellow)] font-extrabold">
                              مفتوحة للمتابعة
                            </span>
                          )
                        ) : (
                          n.resolved_by && (
                            <span className="text-[var(--g-green)] font-bold">
                              تمت المتابعة ({n.resolved_by})
                            </span>
                          )
                        )}

                        {canManageRecords && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingNote({
                                  ...n,
                                  is_open_handover: Boolean(n.is_open_handover),
                                })
                              }
                              className="w-8 h-8 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] flex items-center justify-center text-[var(--g-primary)]"
                              title="تعديل الملاحظة"
                            >
                              <span className="ms-icon text-base">edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteNote(n)}
                              className="w-8 h-8 rounded-full bg-[var(--g-red-bg)] text-[var(--g-red)] flex items-center justify-center"
                              title="حذف الملاحظة"
                            >
                              <span className="ms-icon text-base">delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Admin Edit Note Modal */}
      {editingNote && canManageRecords && (
        <div onClick={() => setEditingNote(null)} className="g-modal-overlay">
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveEditedNote}
            className="g-dialog-sheet max-w-md space-y-4 animate-pop"
          >
            <div className="g-sheet-handle" />
            <div className="flex items-center justify-between border-b border-[var(--g-border)] pb-3">
              <h3 className="text-base font-extrabold m-0">تعديل الملاحظة</h3>
              <button
                type="button"
                onClick={() => setEditingNote(null)}
                className="w-9 h-9 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center"
              >
                <span className="ms-icon">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">المكان</label>
                <select
                  value={editingNote.location_tag}
                  onChange={(e) =>
                    setEditingNote((x) => ({ ...x, location_tag: e.target.value }))
                  }
                  className="g-input font-bold"
                >
                  {LOCATION_TAGS.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">الأهمية</label>
                <select
                  value={editingNote.severity}
                  onChange={(e) =>
                    setEditingNote((x) => ({ ...x, severity: e.target.value }))
                  }
                  className="g-input font-bold"
                >
                  <option value="normal">عادي</option>
                  <option value="warning">يحتاج متابعة</option>
                  <option value="urgent">طارئ للإدارة</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1">نص الملاحظة</label>
              <textarea
                rows={3}
                value={editingNote.content || ''}
                onChange={(e) =>
                  setEditingNote((x) => ({ ...x, content: e.target.value }))
                }
                className="g-input"
              />
            </div>

            <label className="flex items-center gap-2 p-3 rounded-2xl bg-[var(--g-surface-variant)] text-xs font-extrabold cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(editingNote.is_open_handover)}
                onChange={(e) =>
                  setEditingNote((x) => ({ ...x, is_open_handover: e.target.checked }))
                }
                className="w-4 h-4 accent-[#0B57D0]"
              />
              <span>مفتوحة للمتابعة في الوردية</span>
            </label>

            <button
              type="submit"
              className="w-full py-3.5 rounded-full bg-[var(--g-primary)] text-white font-extrabold text-sm"
            >
              حفظ التعديل ✓
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
