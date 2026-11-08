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
