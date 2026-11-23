import React, { useEffect, useState } from 'react';
import { subscribePwaInstallState, triggerPwaInstall } from '../lib/localDb.js';
import { BottomSheet, BrandLogo, Button, Icon } from './ui/index.js';

export default function PwaInstallBanner({
  compact = false,
  dismissible = true,
  onToast,
}) {
  const [pwaState, setPwaState] = useState({
    canPromptInstall: false,
    isStandalone: false,
    isAndroid: false,
    isIOS: false,
    storagePersisted: false,
  });
  const [dismissed, setDismissed] = useState(
    () =>
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem('zayed_pwa_banner_hide') === '1'
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
        onToast?.('تم تثبيت تطبيق زايد مارت');
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

  if (compact) {
    if (!pwaState.canPromptInstall && !pwaState.isAndroid && !pwaState.isIOS) {
      return null;
    }
    return (
      <>
        <Button
          variant="primary"
          size="sm"
          icon="install_mobile"
          onClick={handleInstallClick}
        >
          تثبيت
        </Button>

        <BottomSheet
          open={showManualHint}
          onClose={() => setShowManualHint(false)}
          title="تثبيت تطبيق زايد مارت"
          maxWidth="max-w-sm"
          footer={
            <Button variant="primary" fullWidth onClick={() => setShowManualHint(false)}>
              إغلاق
            </Button>
          }
        >
          {pwaState.isIOS ? (
            <p className="text-xs sm:text-sm text-ink-muted leading-relaxed m-0">
              اضغط زر المشاركة في Safari ثم اختر إضافة إلى الشاشة الرئيسية.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs sm:text-sm text-ink-muted leading-relaxed m-0">
                اختر تثبيت التطبيق من قائمة المتصفح أو حمّل ملف APK المباشر.
              </p>
              <a
                href="/zayed-mart.apk"
                download="zayed-mart-ops.apk"
                className="min-h-[44px] w-full py-2 px-4 rounded-[var(--g-radius-btn)] bg-success-solid text-on-success text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 hover:opacity-95 no-underline"
              >
                <Icon name="android" size={16} />
                <span>تحميل APK</span>
              </a>
            </div>
          )}
        </BottomSheet>
      </>
    );
  }

  if (dismissed && dismissible !== false) return null;
  if (!pwaState.canPromptInstall && !pwaState.isAndroid && !pwaState.isIOS) return null;

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="px-3 py-2 rounded-[var(--g-radius-md)] bg-surface border border-line flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BrandLogo alt="زايد مارت" size="xs" />
          <span className="text-xs font-semibold text-ink truncate">
            تثبيت تطبيق زايد مارت
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!pwaState.isIOS && (
            <a
              href="/zayed-mart.apk"
              download="zayed-mart-ops.apk"
              className="min-h-[36px] px-2.5 rounded-[var(--g-radius-btn)] bg-surface-2 border border-line text-ink text-xs font-semibold hover:border-line-strong no-underline inline-flex items-center"
            >
              APK
            </a>
          )}
          <Button variant="primary" size="sm" onClick={handleInstallClick}>
            تثبيت
          </Button>
          {dismissible !== false && (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="إغلاق"
              className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-2 shrink-0 cursor-pointer"
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>

      {showManualHint && (
        <div className="mt-1.5 p-2.5 rounded-[var(--g-radius-md)] bg-surface border border-line text-xs text-ink-muted leading-relaxed">
          {pwaState.isIOS
            ? 'اضغط زر المشاركة في Safari ثم إضافة إلى الشاشة الرئيسية.'
            : 'اضغط قائمة المتصفح (⋮) ثم تثبيت التطبيق.'}
        </div>
      )}
    </div>
  );
}
