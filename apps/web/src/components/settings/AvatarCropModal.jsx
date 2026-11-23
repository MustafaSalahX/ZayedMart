import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cropAndCompressAvatar } from '../../lib/imageUtils.js';
import {
  BottomSheet,
  Button,
  Icon,
  SegmentedControl,
  ToggleSwitch,
} from '../ui/index.js';

const PREVIEW_SHAPES = [
  { id: 'circle', labelAr: 'دائري' },
  { id: 'squircle', labelAr: 'مربع ناعم' },
];

/**
 * Interactive 1:1 square avatar cropper inside BottomSheet.
 * Supports touch/mouse pan, zoom (1.0x–3.0x), 90° rotation,
 * and optional Admin toggle to set as the Role's Default Photo.
 */
export default function AvatarCropModal({
  open,
  onClose,
  imageFileOrSrc,
  targetLabel = '',
  roleLabel = '',
  canSetRoleDefault = false,
  saving = false,
  onConfirmCrop,
}) {
  const canvasRef = useRef(null);
  const imgObjRef = useRef(null);
  const dragStateRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    origOffsetX: 0,
    origOffsetY: 0,
  });

  const [imgLoaded, setImgLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [previewShape, setPreviewShape] = useState('circle');
  const [applyToRoleDefault, setApplyToRoleDefault] = useState(false);
  const [processing, setProcessing] = useState(false);

  const viewportSize = 260;

  useEffect(() => {
    if (!open || !imageFileOrSrc) {
      setImgLoaded(false);
      setLoadError('');
      imgObjRef.current = null;
      return undefined;
    }

    let cancelled = false;
    setImgLoaded(false);
    setLoadError('');
    setZoom(1);
    setRotationDeg(0);
    setOffset({ x: 0, y: 0 });
    setApplyToRoleDefault(false);

    const loadFromUrl = (url) => {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        imgObjRef.current = img;
        setImgLoaded(true);
      };
      img.onerror = () => {
        if (cancelled) return;
        setLoadError('تعذر قراءة الصورة');
      };
      img.src = url;
    };

    if (typeof imageFileOrSrc === 'string') {
      loadFromUrl(imageFileOrSrc);
    } else if (imageFileOrSrc instanceof Blob) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (!cancelled) loadFromUrl(ev.target.result);
      };
      reader.onerror = () => {
        if (!cancelled) setLoadError('تعذر قراءة ملف الصورة');
      };
      reader.readAsDataURL(imageFileOrSrc);
    }

    return () => {
      cancelled = true;
    };
  }, [open, imageFileOrSrc]);

  const drawPreviewCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgObjRef.current;
    if (!canvas || !img || !imgLoaded) return;

    const ctx = canvas.getContext('2d');
    const dim = viewportSize;
    ctx.clearRect(0, 0, dim, dim);

    const natW = img.naturalWidth || img.width || 1;
    const natH = img.naturalHeight || img.height || 1;
    const rad = (rotationDeg * Math.PI) / 180;
    const isQuarter = rotationDeg === 90 || rotationDeg === 270;
    const effW = isQuarter ? natH : natW;
    const effH = isQuarter ? natW : natH;

    const coverScale = Math.max(dim / effW, dim / effH);
    const finalScale = coverScale * zoom;

    const maxOffX = Math.max(0, (effW * finalScale - dim) / 2);
    const maxOffY = Math.max(0, (effH * finalScale - dim) / 2);
    const clampedX = Math.max(-maxOffX, Math.min(maxOffX, offset.x));
    const clampedY = Math.max(-maxOffY, Math.min(maxOffY, offset.y));

    ctx.save();
    ctx.translate(dim / 2 + clampedX, dim / 2 + clampedY);
    ctx.rotate(rad);
    ctx.scale(finalScale, finalScale);
    ctx.drawImage(img, -natW / 2, -natH / 2, natW, natH);
    ctx.restore();
  }, [imgLoaded, zoom, rotationDeg, offset]);

  useEffect(() => {
    drawPreviewCanvas();
  }, [drawPreviewCanvas]);

  function handlePointerDown(e) {
    if (!imgLoaded) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragStateRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origOffsetX: offset.x,
      origOffsetY: offset.y,
    };
  }

  function handlePointerMove(e) {
    if (!dragStateRef.current.active || !imgObjRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleRatio = rect.width > 0 ? viewportSize / rect.width : 1;
    const dx = (e.clientX - dragStateRef.current.startX) * scaleRatio;
    const dy = (e.clientY - dragStateRef.current.startY) * scaleRatio;
    const img = imgObjRef.current;
    const natW = img.naturalWidth || img.width || 1;
    const natH = img.naturalHeight || img.height || 1;
    const isQuarter = rotationDeg === 90 || rotationDeg === 270;
    const effW = isQuarter ? natH : natW;
    const effH = isQuarter ? natW : natH;
    const coverScale = Math.max(viewportSize / effW, viewportSize / effH);
    const finalScale = coverScale * zoom;
    const maxOffX = Math.max(0, (effW * finalScale - viewportSize) / 2);
    const maxOffY = Math.max(0, (effH * finalScale - viewportSize) / 2);

    setOffset({
      x: Math.max(-maxOffX, Math.min(maxOffX, dragStateRef.current.origOffsetX + dx)),
      y: Math.max(-maxOffY, Math.min(maxOffY, dragStateRef.current.origOffsetY + dy)),
    });
  }

  function handlePointerUp() {
    dragStateRef.current.active = false;
  }

  function handleRotate90() {
    setRotationDeg((prev) => (prev + 90) % 360);
    setOffset({ x: 0, y: 0 });
  }

  function handleResetFrame() {
    setZoom(1);
    setRotationDeg(0);
    setOffset({ x: 0, y: 0 });
  }

  async function handleConfirm() {
    if (!imageFileOrSrc || processing || saving) return;
    setProcessing(true);
    try {
      const result = await cropAndCompressAvatar(imageFileOrSrc, {
        rotationDeg,
        crop: {
          offsetX: offset.x,
          offsetY: offset.y,
          zoom,
          viewportSize,
        },
      });
      await onConfirmCrop?.({
        dataUrl: result.dataUrl,
        byteSize: result.byteSize,
        mimeType: result.mimeType,
        applyToRoleDefault: Boolean(canSetRoleDefault && applyToRoleDefault),
      });
    } catch (err) {
      setLoadError(err.message || 'تعذر حفظ الصورة');
    } finally {
      setProcessing(false);
    }
  }

  const isBusy = processing || saving;

  return (
    <BottomSheet
      open={open}
      onClose={isBusy ? undefined : onClose}
      title="قص الصورة"
      subtitle={targetLabel || ''}
      maxWidth="max-w-md"
      closeOnOverlay={!isBusy}
      footer={
        <div className="flex items-center gap-2.5">
          <Button
            variant="secondary"
            fullWidth
            disabled={isBusy}
            onClick={onClose}
          >
            إلغاء
          </Button>
          <Button
            variant="primary"
            fullWidth
            loading={isBusy}
            disabled={!imgLoaded || Boolean(loadError)}
            onClick={handleConfirm}
          >
            حفظ
          </Button>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        {loadError ? (
          <div className="py-6 text-center text-xs sm:text-sm font-medium text-danger space-y-2">
            <Icon name="broken_image" size={24} className="mx-auto" />
            <div>{loadError}</div>
          </div>
        ) : (
          <>
            <div className="flex justify-center">
              <SegmentedControl
                options={PREVIEW_SHAPES}
                value={previewShape}
                onChange={setPreviewShape}
                ariaLabel="شكل الإطار"
              />
            </div>

            <div className="flex justify-center">
              <div
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className={`relative w-[min(260px,calc(100vw-4rem))] aspect-square overflow-hidden bg-surface-2 border-2 border-primary select-none touch-none cursor-grab active:cursor-grabbing ${
                  previewShape === 'circle' ? 'rounded-full' : 'rounded-3xl'
                }`}
              >
                <canvas
                  ref={canvasRef}
                  width={viewportSize}
                  height={viewportSize}
                  className="w-full h-full block"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-25"
                >
                  <div className="border-b border-e border-line" />
                  <div className="border-b border-e border-line" />
                  <div className="border-b border-line" />
                  <div className="border-b border-e border-line" />
                  <div className="border-b border-e border-line" />
                  <div className="border-b border-line" />
                  <div className="border-e border-line" />
                  <div className="border-e border-line" />
                  <div />
                </div>
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <div className="flex items-center justify-between gap-2 text-xs font-medium text-ink-muted">
                <span>التكبير</span>
                <span className="num-ltr text-ink font-semibold">
                  {Math.round(zoom * 100)}%
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  aria-label="تصغير"
                  onClick={() => setZoom((z) => Math.max(1, Number((z - 0.15).toFixed(2))))}
                  className="w-11 h-11 rounded-full bg-surface-2 border border-line text-ink flex items-center justify-center shrink-0 active:scale-95 cursor-pointer"
                >
                  <Icon name="remove" size={18} />
                </button>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  dir="ltr"
                  aria-label="التكبير"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value) || 1)}
                  className="flex-1 accent-[var(--g-primary-solid)] cursor-pointer h-2"
                />
                <button
                  type="button"
                  aria-label="تكبير"
                  onClick={() => setZoom((z) => Math.min(3, Number((z + 0.15).toFixed(2))))}
                  className="w-11 h-11 rounded-full bg-surface-2 border border-line text-ink flex items-center justify-center shrink-0 active:scale-95 cursor-pointer"
                >
                  <Icon name="add" size={18} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="rotate_90_degrees_ccw"
                  onClick={handleRotate90}
                >
                  تدوير 90°
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="restart_alt"
                  onClick={handleResetFrame}
                >
                  إعادة ضبط
                </Button>
              </div>
            </div>

            {canSetRoleDefault && roleLabel && (
              <ToggleSwitch
                grouped={false}
                checked={applyToRoleDefault}
                onChange={setApplyToRoleDefault}
                label={`تعيين كافتراضي لدور ${roleLabel}`}
              />
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
