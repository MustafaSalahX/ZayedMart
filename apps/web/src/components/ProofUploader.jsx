import React, { useEffect, useRef, useState } from 'react';
import {
  compressImageFile,
  extractImageFromClipboardEvent,
  readImageFromClipboardButton,
} from '../lib/imageUtils.js';

/**
 * مكون إرفاق الصور الاختياري لـ "زايد مارت"
 * يدعم فقط:
 * 1) تصوير مع الرفع من الفون (تطبيق كاميرا الهاتف الأصلي عند الرفع)
 * 2) اختيار صورة جاهزة من الفون أو الكمبيوتر
 * 3) لصق سكرين شوت فوري (Ctrl + V أو زر اللصق من الحافظة)
 * بدون أي كاميرات مراقبة حية وبدون فتح ويب كام داخل المتصفح.
 */
export default function ProofUploader({
  value,
  onChange,
  label = 'إثبات بالصورة أو السكرين شوت (اختياري)',
  compact = false,
}) {
  const phoneCameraInputRef = useRef(null);
  const galleryFileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    async function handleGlobalPaste(e) {
      try {
        const imgData = await extractImageFromClipboardEvent(e);
        if (imgData) {
          e.preventDefault();
          onChange(imgData);
          setMsg('تم لصق السكرين شوت بنجاح!');
          setTimeout(() => setMsg(''), 2500);
        }
      } catch (err) {
        setMsg(err.message || 'تعذر لصق الصورة');
      }
    }

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [onChange]);

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setMsg('');
    try {
      const compressed = await compressImageFile(file);
      onChange(compressed);
    } catch (err) {
      setMsg(err.message || 'تعذر رفع الصورة');
    } finally {
      setBusy(false);
    }
  }

  async function handlePasteButton() {
    setBusy(true);
    setMsg('');
    try {
      const compressed = await readImageFromClipboardButton();
      onChange(compressed);
      setMsg('تم لصق السكرين شوت من الحافظة!');
      setTimeout(() => setMsg(''), 2500);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg('');
    try {
      const compressed = await compressImageFile(file);
      onChange(compressed);
    } catch (err) {
      setMsg(err.message || 'الملف غير صالح');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      className={`rounded-2xl border-2 border-dashed p-3.5 transition-colors ${
        dragActive
          ? 'border-[#1A73E8] bg-[#E8F0FE]/50'
          : 'border-[var(--g-border)] bg-[var(--g-surface-variant)]/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <span className="ms-icon text-[var(--g-primary)]">add_photo_alternate</span>
          <span>{label}</span>
        </div>
        <span className="text-xs px-2.5 py-0.5 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] text-[var(--g-muted)]">
          اختياري
        </span>
      </div>

      {/* Hidden native inputs: Phone capture-upload & standard file/gallery picker */}
      <input
        ref={phoneCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={galleryFileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {value ? (
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 bg-[var(--g-surface)] p-2.5 rounded-xl border border-[var(--g-border)]">
          <img
            src={value}
            alt="مرفق الإثبات"
            className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-lg border border-[var(--g-border)] shrink-0"
          />
          <div className="flex-1 min-w-[140px]">
            <div className="text-xs sm:text-sm font-semibold text-[var(--g-green)] flex items-center gap-1">
              <span className="ms-icon filled text-base">check_circle</span>
              <span>تم إرفاق الصورة وجاهزة للحفظ</span>
            </div>
            <p className="text-[11px] sm:text-xs text-[var(--g-muted)] mt-0.5">
              يمكنك استبدالها أو الضغط على حذف لإلغائها
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange('')}
            className="w-full sm:w-auto justify-center px-3 py-2 rounded-xl bg-[var(--g-red-bg)] text-[var(--g-red)] text-xs font-bold flex items-center gap-1 hover:opacity-90"
          >
            <span className="ms-icon text-base">delete</span>
            <span>حذف</span>
          </button>
        </div>
      ) : (
        <div className={`grid ${compact ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'} gap-2`}>
          <button
            type="button"
            disabled={busy}
            onClick={() => phoneCameraInputRef.current?.click()}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[var(--g-surface)] border border-[var(--g-border)] hover:border-[var(--g-primary)] text-sm font-semibold transition-all"
          >
            <span className="ms-icon text-[var(--g-primary)]">photo_camera</span>
            <span>تصوير ورفع من الفون</span>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => galleryFileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[var(--g-surface)] border border-[var(--g-border)] hover:border-[var(--g-primary)] text-sm font-semibold transition-all"
          >
            <span className="ms-icon text-[#188038]">image</span>
            <span>صورة من الفون / الجهاز</span>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={handlePasteButton}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[var(--g-surface)] border border-[var(--g-border)] hover:border-[var(--g-primary)] text-sm font-semibold transition-all"
          >
            <span className="ms-icon text-[#E37400]">content_paste</span>
            <span>لصق سكرين (Ctrl+V)</span>
          </button>
        </div>
      )}

      {busy && (
        <p className="text-xs text-[var(--g-primary)] mt-2 font-medium">
          جاري تجهيز وضغط الصورة...
        </p>
      )}
      {msg && (
        <p className="text-xs text-[var(--g-primary)] mt-2 font-medium">{msg}</p>
      )}
    </div>
  );
}
