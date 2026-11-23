/**
 * ضغط الصور المرفوعة أو السكرين شوت على المتصفح قبل الحفظ
 * بدون استخدام أي بث كاميرا ويب حي (getUserMedia غير مستخدم إطلاقاً)
 */

export function compressImageFile(file, maxDimension, quality) {
  const isLite =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('lite-mode');
  const resolvedMaxDim = maxDimension || (isLite ? 900 : 1280);
  const resolvedQuality = quality || (isLite ? 0.68 : 0.8);

  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('الملف المختار ليس صورة صالحة'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error('تعذر معالجة الصورة'));
      img.onload = () => {
        let { width, height } = img;
        if (width > resolvedMaxDim || height > resolvedMaxDim) {
          if (width >= height) {
            height = Math.round((height * resolvedMaxDim) / width);
            width = resolvedMaxDim;
          } else {
            width = Math.round((width * resolvedMaxDim) / height);
            height = resolvedMaxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', resolvedQuality);
        resolve(dataUrl);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function extractImageFromClipboardEvent(event) {
  const items = event?.clipboardData?.items;
  if (!items) return null;
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        return await compressImageFile(file);
      }
    }
  }
  return null;
}

export async function readImageFromClipboardButton() {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    throw new Error('استخدم اختصار لوحة المفاتيح Ctrl + V للصق السكرين شوت مباشرة');
  }
  const clipboardItems = await navigator.clipboard.read();
  for (const item of clipboardItems) {
    const imageType = item.types.find((t) => t.startsWith('image/'));
    if (imageType) {
      const blob = await item.getType(imageType);
      const file = new File([blob], 'screenshot.png', { type: imageType });
      return await compressImageFile(file);
    }
  }
  throw new Error('لا توجد صورة أو سكرين شوت منسوخة في الحافظة حالياً');
}

export function estimateBase64Bytes(dataUrl = '') {
  if (!dataUrl || typeof dataUrl !== 'string') return 0;
  const idx = dataUrl.indexOf(',');
  if (idx === -1) return 0;
  const b64 = dataUrl.slice(idx + 1).replace(/\s+/g, '');
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

function encodeCanvasBestFormat(canvas, quality) {
  try {
    const webp = canvas.toDataURL('image/webp', quality);
    if (webp && webp.startsWith('data:image/webp')) {
      return { dataUrl: webp, mimeType: 'image/webp' };
    }
  } catch {
    // Fallback to JPEG on WebViews without WebP canvas encoder
  }
  return {
    dataUrl: canvas.toDataURL('image/jpeg', quality),
    mimeType: 'image/jpeg',
  };
}

/**
 * Square 1:1 avatar crop & compression utility for profile & role photos.
 * Supports optional interactive pan/zoom/rotation from AvatarCropModal,
 * outputs WebP (or JPEG fallback) sized 320x320 (240x240 in lite-mode) <= 45KB typical.
 */
export function cropAndCompressAvatar(fileOrSrc, options = {}) {
  const isLite =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('lite-mode');
  const outputSize = Number(options.outputSize) || (isLite ? 240 : 320);
  const quality = Number(options.quality) || (isLite ? 0.74 : 0.82);
  const rotationDeg = ((Number(options.rotationDeg) || 0) % 360 + 360) % 360;
  const crop = options.crop || null; // { offsetX (px in viewport), offsetY (px in viewport), zoom (>=1), viewportSize }

  return new Promise((resolve, reject) => {
    const loadImageFromSrc = (src) => {
      const img = new Image();
      img.onerror = () => reject(new Error('تعذر معالجة ملف الصورة — جرب صورة أخرى بصيغة JPG أو PNG'));
      img.onload = () => {
        try {
          const renderToSize = (dim, q) => {
            const canvas = document.createElement('canvas');
            canvas.width = dim;
            canvas.height = dim;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, dim, dim);

            const natW = img.naturalWidth || img.width || 1;
            const natH = img.naturalHeight || img.height || 1;
            const rad = (rotationDeg * Math.PI) / 180;
            const isQuarterTurn = rotationDeg === 90 || rotationDeg === 270;
            const effW = isQuarterTurn ? natH : natW;
            const effH = isQuarterTurn ? natW : natH;

            // Base scale covers the square canvas cleanly
            const coverScale = Math.max(dim / effW, dim / effH);
            const zoom = Math.max(1, Math.min(4, Number(crop?.zoom) || 1));
            const finalScale = coverScale * zoom;

            const viewportSize = Number(crop?.viewportSize) || dim;
            const offsetScale = dim / viewportSize;
            const rawOffX = (Number(crop?.offsetX) || 0) * offsetScale;
            const rawOffY = (Number(crop?.offsetY) || 0) * offsetScale;

            // Clamp offsets so the image always covers the full 1:1 square
            const maxOffX = Math.max(0, (effW * finalScale - dim) / 2);
            const maxOffY = Math.max(0, (effH * finalScale - dim) / 2);
            const clampedX = Math.max(-maxOffX, Math.min(maxOffX, rawOffX));
            const clampedY = Math.max(-maxOffY, Math.min(maxOffY, rawOffY));

            ctx.save();
            ctx.translate(dim / 2 + clampedX, dim / 2 + clampedY);
            ctx.rotate(rad);
            ctx.scale(finalScale, finalScale);
            ctx.drawImage(img, -natW / 2, -natH / 2, natW, natH);
            ctx.restore();

            return encodeCanvasBestFormat(canvas, q);
          };

          let encoded = renderToSize(outputSize, quality);
          let byteSize = estimateBase64Bytes(encoded.dataUrl);

          // Safeguard: keep payload compact (<= 350KB) for fast 3G/4G & serverless fallback
          if (byteSize > 350 * 1024) {
            encoded = renderToSize(Math.min(outputSize, 240), 0.68);
            byteSize = estimateBase64Bytes(encoded.dataUrl);
          }

          resolve({
            dataUrl: encoded.dataUrl,
            mimeType: encoded.mimeType,
            byteSize,
            width: outputSize,
            height: outputSize,
          });
        } catch {
          reject(new Error('تعذر قص وضغط الصورة الشخصية'));
        }
      };
      img.src = src;
    };

    if (typeof fileOrSrc === 'string') {
      loadImageFromSrc(fileOrSrc);
      return;
    }

    const file = fileOrSrc;
    if (!file || !file.type || !file.type.startsWith('image/')) {
      reject(new Error('الملف المختار ليس صورة صالحة (يرجى اختيار JPG أو PNG أو WebP)'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error('حجم الصورة الأصلي كبير جداً (الحد الأقصى 10 ميجابايت)'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    reader.onload = (ev) => loadImageFromSrc(ev.target.result);
    reader.readAsDataURL(file);
  });
}
