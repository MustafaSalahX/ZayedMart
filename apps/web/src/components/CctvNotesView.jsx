import React, { useEffect, useMemo, useRef, useState } from 'react';
import NoteComposerForm from './notes/NoteComposerForm.jsx';
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
  StatusDot,
} from './ui/index.js';
import { postActionWithOfflineSupport, apiRequest } from '../lib/api.js';
import { playSuccessChime } from '../lib/audio.js';
import { formatTimeArabic } from '../lib/exportUtils.js';

const LOCATION_TAGS = [
  'منطقة الكاشير',
  'البوابة الرئيسية',
  'رصيف البضاعة',
  'الممرات والصالة',
  'الثلاجات والأجبان',
  'المخزن',
  'المحيط الخارجي',
];

const CATEGORY_TAGS = [
  'ملاحظات الكاشيرية',
  'زحام كاشير',
  'فرق درج',
  'عطل باركود',
  'موقف عميل',
  'ملاحظة عامة',
  'تأخير أو ترك عمل',
  'عجز أو تالف',
  'ثلاجة مفتوحة',
  'ملاحظة أمنية',
  'نظافة ممر',
];

const SEVERITIES = [
  {
    id: 'normal',
    label: 'عادي',
    tone: 'primary',
    activeStyle: 'bg-primary-solid text-on-primary border-[var(--g-primary-solid)]',
  },
  {
    id: 'warning',
    label: 'متابعة',
    tone: 'warning',
    activeStyle: 'bg-warning-solid text-on-warning border-[var(--g-warning-solid)]',
  },
  {
    id: 'urgent',
    label: 'طارئ',
    tone: 'danger',
    activeStyle: 'bg-danger-solid text-on-danger border-[var(--g-danger-solid)]',
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
  const [locationTag, setLocationTag] = useState(
    actorRole === 'cashier' ? 'منطقة الكاشير' : LOCATION_TAGS[0]
  );
  const [categoryTag, setCategoryTag] = useState(
    actorRole === 'cashier' ? 'ملاحظات الكاشيرية' : CATEGORY_TAGS[0]
  );
  const [notesFilter, setNotesFilter] = useState('all');
  const [noteSearch, setNoteSearch] = useState('');
  const [severity, setSeverity] = useState('normal');
  const [dvrTimestamp, setDvrTimestamp] = useState(() => nowHMS());
  const [content, setContent] = useState('');
  const [keepOpenForHandover, setKeepOpenForHandover] = useState(false);
  const [proofDataUrl, setProofDataUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resolvingId, setResolvingId] = useState('');
  const [editingNote, setEditingNote] = useState(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deletingNote, setDeletingNote] = useState(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [composerSheetOpen, setComposerSheetOpen] = useState(false);

  const composerRef = useRef(null);

  useEffect(() => {
    function handleOpenComposer(ev) {
      if (ev?.detail?.action === 'note_add' && canWrite) {
        if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
          composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          setComposerSheetOpen(true);
        }
      }
    }
    window.addEventListener('zayed:open-composer', handleOpenComposer);
    return () => window.removeEventListener('zayed:open-composer', handleOpenComposer);
  }, [canWrite]);

  async function handleSaveNote(e) {
    e?.preventDefault();
    if (submitting || !canWrite) return;
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
      onToast?.(res.queuedOffline ? 'تم الحفظ محلياً' : 'تم تسجيل الملاحظة');
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
    if (resolvingId) return;
    setResolvingId(noteId);
    try {
      await apiRequest(`/api/notes/${noteId}/resolve`, 'POST', {
        resolved_by: actorName,
      });
      playSuccessChime('in');
      onToast?.('تم إغلاق الملاحظة');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setResolvingId('');
    }
  }

  async function handleSaveEditedNote(e) {
    e?.preventDefault();
    if (!editingNote || editSubmitting) return;
    setEditSubmitting(true);
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
      onToast?.('تم حفظ التعديل');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function executeDeleteNote() {
    if (!deletingNote || deleteSubmitting) return;
    setDeleteSubmitting(true);
    try {
      await apiRequest(`/api/notes/${deletingNote.id}`, 'DELETE');
      onToast?.('تم الحذف');
      setDeletingNote(null);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setDeleteSubmitting(false);
    }
  }

  const openHandoverNotes = useMemo(
    () => notes.filter((n) => Number(n.is_open_handover) === 1),
    [notes]
  );

  const cashierNotesCount = useMemo(
    () =>
      notes.filter(
        (n) =>
          (n.location_tag || '').includes('الكاشير') ||
          (n.category_tag || '').includes('الكاشير') ||
          (n.category_tag || '').includes('درج') ||
          (n.category_tag || '').includes('باركود')
      ).length,
    [notes]
  );

  const filterChips = useMemo(
    () => [
      { id: 'all', label: 'الكل', count: notes.length },
      { id: 'cashier', label: 'الكاشيرية', count: cashierNotesCount },
      { id: 'open', label: 'للمتابعة', count: openHandoverNotes.length },
    ],
    [notes.length, cashierNotesCount, openHandoverNotes.length]
  );

  const filteredNotes = useMemo(() => {
    const q = noteSearch.trim().toLowerCase();
    return notes.filter((n) => {
      if (notesFilter === 'cashier') {
        const isCashier =
          (n.location_tag || '').includes('الكاشير') ||
          (n.category_tag || '').includes('الكاشير') ||
          (n.category_tag || '').includes('درج') ||
          (n.category_tag || '').includes('باركود');
        if (!isCashier) return false;
      } else if (notesFilter === 'open') {
        if (Number(n.is_open_handover) !== 1) return false;
      }

      if (
        q &&
        !(n.content || '').toLowerCase().includes(q) &&
        !(n.location_tag || '').toLowerCase().includes(q) &&
        !(n.category_tag || '').toLowerCase().includes(q) &&
        !(n.recorded_by || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [notes, notesFilter, noteSearch]);

  const sharedComposerProps = {
    locationTags: LOCATION_TAGS,
    categoryTags: CATEGORY_TAGS,
    severities: SEVERITIES,
    locationTag,
    setLocationTag,
    categoryTag,
    setCategoryTag,
    severity,
    setSeverity,
    dvrTimestamp,
    setDvrTimestamp,
    onResetTimestamp: () => setDvrTimestamp(nowHMS()),
    keepOpenForHandover,
    setKeepOpenForHandover,
    content,
    setContent,
    proofDataUrl,
    setProofDataUrl,
    submitting,
    canWrite,
    onSubmit: handleSaveNote,
    onToast,
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Desktop Inline Note Composer */}
      {canWrite && (
        <div ref={composerRef} className="hidden lg:block lg:col-span-5">
          <NoteComposerForm {...sharedComposerProps} />
        </div>
      )}

      {/* Mobile Composer BottomSheet */}
      {canWrite && (
        <BottomSheet
          open={composerSheetOpen}
          onClose={() => setComposerSheetOpen(false)}
          title="ملاحظة جديدة"
          maxWidth="max-w-xl"
        >
          <NoteComposerForm inSheet {...sharedComposerProps} />
        </BottomSheet>
      )}

      {/* Main Column */}
      <div className={`${canWrite ? 'lg:col-span-7' : 'lg:col-span-12'} space-y-4`}>
        {canWrite && (
          <Button
            type="button"
            variant="primary"
            size="lg"
            fullWidth
            icon="add"
            onClick={() => setComposerSheetOpen(true)}
            className="lg:hidden"
          >
            ملاحظة جديدة
          </Button>
        )}

        {/* Compact 1-Line Hairline Handover Bar */}
        <div className="py-2.5 border-y border-line flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs sm:text-sm min-w-0">
            <span className="font-semibold text-ink">تسليم الوردية</span>
            <span className="text-ink-muted num-ltr">
              {' · '}
              {openHandoverNotes.length} مفتوحة · {summary.unloadingTrucksCount || 0} عربية
            </span>
            {handovers.length > 0 && (
              <span className="text-xs text-ink-muted">
                {' · '}
                {handovers[0].from_operator} → {handovers[0].to_operator}
              </span>
            )}
          </div>

          {canHandover && onOpenHandoverModal && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onOpenHandoverModal}
            >
              تسليم
            </Button>
          )}
        </div>

        {/* Notes Stream */}
        <section className="space-y-3">
          <SectionHeader
            title="الملاحظات"
            count={filteredNotes.length}
            actions={
              <div className="w-full sm:w-56">
                <SearchFilterBar
                  value={noteSearch}
                  onChange={setNoteSearch}
                  placeholder="بحث..."
                />
              </div>
            }
          />

          <FilterChipRail
            items={filterChips}
            activeId={notesFilter}
            onSelect={setNotesFilter}
          />

          {filteredNotes.length === 0 ? (
            <EmptyState
              compact
              title="لا توجد ملاحظات"
              actionLabel={canWrite ? 'ملاحظة جديدة' : undefined}
              onAction={
                canWrite
                  ? () => {
                      if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
                        composerRef.current?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'center',
                        });
                      } else {
                        setComposerSheetOpen(true);
                      }
                    }
                  : undefined
              }
            />
          ) : (
            <GroupedList>
              {filteredNotes.map((n) => {
                const sev = SEVERITIES.find((s) => s.id === n.severity) || SEVERITIES[0];
                const isOpenHandover = Number(n.is_open_handover) === 1;
                return (
                  <div key={n.id} className="px-3.5 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <StatusDot tone={sev.tone} />
                        <span className="text-xs sm:text-sm font-semibold text-ink">
                          {n.location_tag}
                        </span>
                        <span className="text-xs text-ink-muted">· {n.category_tag}</span>
                        {n.severity === 'urgent' && (
                          <span className="text-[11px] font-semibold text-danger">
                            · طارئ
                          </span>
                        )}
                      </div>

                      <span className="num-ltr text-xs text-ink-muted shrink-0">
                        {n.dvr_timestamp || formatTimeArabic(n.timestamp)}
                      </span>
                    </div>

                    <p className="text-sm text-ink m-0 whitespace-pre-wrap leading-relaxed">
                      {n.content}
                    </p>

                    {n.proof_url && (
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewImage?.(
                            n.proof_url,
                            `${n.location_tag} - ${n.dvr_timestamp}`
                          )
                        }
                        className="inline-block rounded-xl overflow-hidden border border-line cursor-pointer"
                      >
                        <img
                          src={n.proof_url}
                          alt="مرفق"
                          className="h-24 w-auto max-w-full object-cover"
                        />
                      </button>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
                      <span>
                        {n.recorded_by} · <span className="num-ltr">{n.date_key}</span>
                        {!isOpenHandover && n.resolved_by ? ` · أغلقه ${n.resolved_by}` : ''}
                      </span>

                      <div className="flex items-center gap-1">
                        {isOpenHandover && canResolveNotes && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            loading={resolvingId === n.id}
                            onClick={() => handleResolveNote(n.id)}
                          >
                            إغلاق
                          </Button>
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
                              aria-label="تعديل الملاحظة"
                              className="w-11 h-11 rounded-full text-ink-muted hover:text-primary hover:bg-surface-2 flex items-center justify-center cursor-pointer"
                            >
                              <Icon name="edit" size={18} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingNote(n)}
                              aria-label="حذف الملاحظة"
                              className="w-11 h-11 rounded-full text-danger hover:bg-danger-bg flex items-center justify-center cursor-pointer"
                            >
                              <Icon name="delete" size={18} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </GroupedList>
          )}
        </section>
      </div>

      {/* Edit Note BottomSheet */}
      <BottomSheet
        open={Boolean(editingNote && canManageRecords)}
        onClose={() => {
          if (!editSubmitting) setEditingNote(null);
        }}
        title="تعديل الملاحظة"
        subtitle={editingNote?.location_tag || ''}
        maxWidth="max-w-md"
        footer={
          editingNote ? (
            <Button
              type="submit"
              form="edit-note-form"
              variant="primary"
              size="lg"
              fullWidth
              loading={editSubmitting}
            >
              حفظ
            </Button>
          ) : null
        }
      >
        {editingNote && (
          <form id="edit-note-form" onSubmit={handleSaveEditedNote} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  المكان
                </label>
                <select
                  value={editingNote.location_tag || LOCATION_TAGS[0]}
                  onChange={(e) =>
                    setEditingNote((x) => ({ ...x, location_tag: e.target.value }))
                  }
                  className="g-input"
                >
                  {LOCATION_TAGS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  التصنيف
                </label>
                <select
                  value={editingNote.category_tag || CATEGORY_TAGS[0]}
                  onChange={(e) =>
                    setEditingNote((x) => ({ ...x, category_tag: e.target.value }))
                  }
                  className="g-input"
                >
                  {CATEGORY_TAGS.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  الأهمية
                </label>
                <select
                  value={editingNote.severity || 'normal'}
                  onChange={(e) =>
                    setEditingNote((x) => ({ ...x, severity: e.target.value }))
                  }
                  className="g-input"
                >
                  <option value="normal">عادي</option>
                  <option value="warning">متابعة</option>
                  <option value="urgent">طارئ</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  وقت DVR
                </label>
                <input
                  type="text"
                  value={editingNote.dvr_timestamp || ''}
                  onChange={(e) =>
                    setEditingNote((x) => ({ ...x, dvr_timestamp: e.target.value }))
                  }
                  placeholder="HH:MM:SS"
                  className="g-input num-ltr text-center"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                التفاصيل
              </label>
              <textarea
                rows={3}
                value={editingNote.content || ''}
                onChange={(e) =>
                  setEditingNote((x) => ({ ...x, content: e.target.value }))
                }
                className="g-input"
              />
            </div>

            <label className="min-h-[44px] flex items-center gap-2 py-2 border-t border-line text-xs font-medium text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(editingNote.is_open_handover)}
                onChange={(e) =>
                  setEditingNote((x) => ({ ...x, is_open_handover: e.target.checked }))
                }
                className="w-4 h-4 accent-[var(--g-primary-solid)]"
              />
              <span>متابعة في الوردية</span>
            </label>
          </form>
        )}
      </BottomSheet>

      <ConfirmSheet
        open={Boolean(deletingNote)}
        onClose={() => {
          if (!deleteSubmitting) setDeletingNote(null);
        }}
        onConfirm={executeDeleteNote}
        title="حذف الملاحظة"
        description={
          deletingNote
            ? `حذف ملاحظة ${deletingNote.location_tag} — ${deletingNote.category_tag}؟`
            : ''
        }
        confirmLabel="حذف"
        tone="danger"
        loading={deleteSubmitting}
      />
    </div>
  );
}
