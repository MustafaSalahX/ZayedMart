import React, { useEffect, useState } from 'react';
import { subscribePwaInstallState, triggerPwaInstall } from '../lib/localDb.js';

export default function PwaInstallBanner({ compact = false, onToast }) {
  const [pwaState, setPwaState] = useState({
    canPromptInstall: false,
    isStandalone: false,
    isAndroid: false,
    isIOS: false,
    storagePersisted: false,
  });
  const [dismissed, setDismissed] = useState(
    () => typeof sessionStorage !== 'undefined' && sessionStorage.getItem('zayed_pwa_banner_hide') === '1'
  );
  const [showManualHint, setShowManualHint] = useState(false);

  useEffect(() => {
    return subscribePwaInstallState((next) => {
      setPwaState(next);
    });
  }, []);

  if (pwaState.isStandalone) return null;

  async function handleInstallClick() {
    if (pwaState.canPromptInstall) {
      const res = await triggerPwaInstall();
      if (res?.outcome === 'accepted') {
        onToast?.('تم تثبيت تطبيق زايد مارت وتفعيل قاعدة التخزين المحلية بنجاح ✓');
      }
      return;
    }
    setShowManualHint((s) => !s);
  }

  function handleDismiss() {
    setDismissed(true);
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('zayed_pwa_banner_hide', '1');
    }
  }

  // Compact button mode (for TopBar Row 2)
  if (compact) {
    if (!pwaState.canPromptInstall && !pwaState.isAndroid && !pwaState.isIOS) {
      return null;
    }
    return (
      <>
        <button
          type="button"
          onClick={handleInstallClick}
          title="تثبيت تطبيق زايد مارت على شاشة الهاتف مع قاعدة بيانات أوفلاين"
          className="min-h-[40px] px-3 py-1.5 rounded-full bg-[var(--g-primary)] text-white text-xs font-extrabold flex items-center justify-center gap-1 hover:opacity-95 active:scale-95 shrink-0 shadow-xs"
        >
          <span className="ms-icon filled text-base">install_mobile</span>
          <span>تثبيت التطبيق</span>
        </button>

        {showManualHint && (
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setShowManualHint(false)}
          >
            <div
              className="g-card max-w-sm w-full p-5 space-y-3 text-right animate-pop"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-extrabold text-base">
                  <span className="ms-icon filled text-xl text-[var(--g-primary)]">
                    install_mobile
                  </span>
                  <span>تثبيت تطبيق زايد مارت</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowManualHint(false)}
                  className="w-8 h-8 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center"
                >
                  <span className="ms-icon text-base">close</span>
                </button>
              </div>

              {pwaState.isIOS ? (
                <p className="text-xs sm:text-sm text-[var(--g-muted)] leading-relaxed m-0">
                  اضغط على زر المشاركة <strong>Share</strong> أسفل متصفح Safari ثم اختر{' '}
                  <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong> لتثبيت التطبيق
                  كاملاً مع التخزين المحلي.
                </p>
              ) : (
                <p className="text-xs sm:text-sm text-[var(--g-muted)] leading-relaxed m-0">
                  من أعلى متصفح <strong>Google Chrome</strong> اضغط على القائمة{' '}
                  <strong>(⋮)</strong> ثم اختر{' '}
                  <strong>تثبيت التطبيق (Install app)</strong> ليتم تنزيل تطبيق زايد مارت بقاعدة
                  بيانات محلية تعمل أونلاين وأوفلاين.
                </p>
              )}

              <button
                type="button"
                onClick={() => setShowManualHint(false)}
                className="g-btn-primary w-full py-2.5 text-sm font-extrabold"
              >
                حسناً، فهمت
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Banner mode (for AuthLoginScreen & Top of App on Mobile)
  if (dismissed && !pwaState.canPromptInstall) return null;
  if (!pwaState.canPromptInstall && !pwaState.isAndroid && !pwaState.isIOS) return null;

  return (
    <div className="w-full max-w-md mx-auto mb-2.5">
      <div className="p-3 rounded-2xl bg-[var(--g-primary-container)]/75 border border-[var(--g-primary)]/25 flex items-center justify-between gap-2.5 shadow-2xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[var(--g-primary)] text-white flex items-center justify-center shrink-0">
            <span className="ms-icon filled text-xl">install_mobile</span>
          </div>
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-extrabold text-[var(--g-text)] truncate">
              تثبيت تطبيق زايد مارت على الموبايل
            </div>
            <div className="text-[11px] text-[var(--g-muted)] leading-snug">
              يعمل أونلاين وأوفلاين بقاعدة بيانات محلية ومزامنة تلقائية
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleInstallClick}
            className="px-3 py-1.5 rounded-full bg-[var(--g-primary)] text-white text-xs font-extrabold hover:opacity-95 active:scale-95"
          >
            تثبيت الآن
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            title="إخفاء"
            className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--g-muted)] hover:bg-black/5"
          >
            <span className="ms-icon text-sm">close</span>
          </button>
        </div>
      </div>

      {showManualHint && (
        <div className="mt-2 p-3 rounded-2xl bg-[var(--g-surface)] border border-[var(--g-border)] text-xs text-[var(--g-muted)] leading-relaxed">
          {pwaState.isIOS ? (
            <span>
              اضغط على أيقونة المشاركة <strong>Share</strong> في Safari ثم اختر{' '}
              <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.
            </span>
          ) : (
            <span>
              اضغط على قائمة متصفح كروم <strong>(⋮)</strong> أعلى الشاشة ثم اختر{' '}
              <strong>تثبيت التطبيق (Install app)</strong> لتثبيته كتطبيق كامل على هاتفك.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
