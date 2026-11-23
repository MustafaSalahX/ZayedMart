import React, { useEffect, useRef, useState } from 'react';
import {
  compressImageFile,
  extractImageFromClipboardEvent,
  readImageFromClipboardButton,
} from '../lib/imageUtils.js';
import { Button, Icon } from './ui/index.js';

/**
 * Compact 1-Row Inline Proof Uploader (`ProofUploader`):
 * Supports phone camera capture, gallery picker, clipboard paste, and drag-and-drop.
 */
export default function ProofUploader({
  value,
  onChange,
  label = 'إرفاق صورة',
  compact = false,
  globalPaste = false,
}) {
  const phoneCameraInputRef = useRef(null);
  const galleryFileInputRef = useRef(null);
  const statusTimerRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  function showStatus(text, tone = 'success') {
    setStatus({ text, tone });
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setStatus(null), 2400);
  }

  async function processClipboardEvent(e) {
    try {
      const imgData = await extractImageFromClipboardEvent(e);
      if (imgData) {
        e.preventDefault();
        onChange?.(imgData);
        showStatus('تم لصق الصورة', 'success');
      }
    } catch (err) {
      showStatus(err.message || 'تعذر لصق الصورة', 'error');
    }
  }

  useEffect(() => {
    if (!globalPaste) return undefined;
    window.addEventListener('paste', processClipboardEvent);
    return () => window.removeEventListener('paste', processClipboardEvent);
  });

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const compressed = await compressImageFile(file);
      onChange?.(compressed);
    } catch (err) {
      showStatus(err.message || 'تعذر رفع الصورة', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handlePasteButton() {
    setBusy(true);
    setStatus(null);
    try {
      const compressed = await readImageFromClipboardButton();
      onChange?.(compressed);
    } catch (err) {
      showStatus(err.message || 'لا توجد صورة في الحافظة', 'error');
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
    setStatus(null);
    try {
      const compressed = await compressImageFile(file);
      onChange?.(compressed);
    } catch (err) {
      showStatus(err.message || 'ملف غير صالح', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      tabIndex={0}
      onPaste={globalPaste ? undefined : processClipboardEvent}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      className={`space-y-1.5 outline-none rounded-[var(--g-radius-md)] transition-colors duration-150 ${
        dragActive ? 'bg-primary-container/25 ring-1 ring-[var(--g-primary)] p-2' : ''
      }`}
    >
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
        <div className="flex items-center justify-between gap-2.5 p-2 rounded-[var(--g-radius-md)] bg-surface-2 border border-line">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={value}
              alt="مرفق"
              className="w-12 h-12 object-cover rounded-[var(--g-radius-sm)] border border-line shrink-0"
            />
            <span className="text-xs font-medium text-ink truncate">{label}</span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => galleryFileInputRef.current?.click()}
            >
              تغيير
            </Button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onChange?.('')}
              aria-label="حذف الصورة"
              className="w-10 h-10 rounded-full hover:bg-danger-bg text-ink-muted hover:text-danger flex items-center justify-center transition-colors duration-150 cursor-pointer"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            icon="photo_camera"
            loading={busy}
            disabled={busy}
            onClick={() => phoneCameraInputRef.current?.click()}
          >
            كاميرا
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon="image"
            disabled={busy}
            onClick={() => galleryFileInputRef.current?.click()}
          >
            صورة
          </Button>
          {!compact && (
            <Button
              variant="secondary"
              size="sm"
              icon="content_paste"
              disabled={busy}
              onClick={handlePasteButton}
            >
              لصق
            </Button>
          )}
        </div>
      )}

      {status && (
        <p
          role={status.tone === 'error' ? 'alert' : 'status'}
          className={`text-xs m-0 font-medium ${
            status.tone === 'error' ? 'text-danger' : 'text-success'
          }`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
