import React, { useEffect, useRef, useState } from 'react';
import { fetchStorePublicInfo, loginWithPassword, normalizeDigitsClient } from '../lib/api.js';
import { playSuccessChime } from '../lib/audio.js';
import PwaInstallBanner from './PwaInstallBanner.jsx';

export default function AuthLoginScreen({
  darkMode,
  onToggleDarkMode,
  onLoginSuccess,
}) {
  const [storeInfo, setStoreInfo] = useState({
    store_name: 'زايد مارت',
    branch_name: 'الفرع الرئيسي',
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    fetchStorePublicInfo()
      .then((info) => {
        if (info?.store_name) setStoreInfo(info);
      })
      .catch(() => {});

    // Auto-focus only on desktop so mobile OS keyboard doesn't cover the touch keypad immediately
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      inputRef.current?.focus();
    }
  }, []);

  async function handleSubmit(e) {
    e?.preventDefault();
    const clean = password.trim();
    if (!clean || submitting) return;
    setSubmitting(true);
    setLoginError('');
    try {
      const session = await loginWithPassword(clean);
      playSuccessChime('in');
      onLoginSuccess?.(session);
    } catch (err) {
      playSuccessChime('alert');
      setLoginError(err.message || 'كلمة المرور غير صحيحة');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeypadDigit(digit) {
    if (submitting) return;
    setLoginError('');
    setPassword((prev) => (prev + digit).slice(0, 24));
  }

  function handleBackspace() {
    if (submitting) return;
    setPassword((prev) => prev.slice(0, -1));
  }

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-[var(--g-bg)] text-[var(--g-text)] overflow-x-hidden">
      <div className="google-brand-bar shrink-0" />

      {/* Top Minimal Google Bar */}
      <div className="max-w-4xl w-full mx-auto px-3 sm:px-6 pt-3 sm:pt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold text-[var(--g-muted)] min-w-0">
          <span className="ms-icon filled text-base text-[var(--g-primary)]">shield_lock</span>
          <span className="truncate">دخول لمرة واحدة — تحديد الدور تلقائياً</span>
        </div>

        <button
          type="button"
          onClick={onToggleDarkMode}
          title={darkMode ? 'الوضع النهاري' : 'الوضع الليلي المريح'}
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[var(--g-surface)] border border-[var(--g-border)] flex items-center justify-center shrink-0 hover:border-[var(--g-primary)]"
        >
          <span className="ms-icon filled text-lg">
            {darkMode ? 'light_mode' : 'dark_mode'}
          </span>
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-3 sm:px-6 py-3 sm:py-6">
        <PwaInstallBanner />
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-md g-card p-4 sm:p-7 shadow-sm space-y-3.5 sm:space-y-5 animate-pop"
        >
          {/* Brand Identity */}
          <div className="text-center space-y-1">
            <img
              src="/logo.jpeg"
              alt={storeInfo.store_name || 'زايد مارت'}
              className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-2xl sm:rounded-3xl object-cover border-2 border-[var(--g-border)] shadow-sm bg-white"
            />
            <h1 className="text-lg sm:text-2xl font-extrabold m-0">
              {storeInfo.store_name || 'زايد مارت'}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--g-muted)] m-0">
              أدخل كلمة المرور الخاصة بك لفتح النظام على هذا الجهاز
            </p>
          </div>

          {/* Password Input with Show/Hide Toggle */}
          <div className="relative w-full">
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setLoginError('');
                setPassword(normalizeDigitsClient(e.target.value));
              }}
              placeholder="اكتب الرقم السري هنا..."
              className="g-input w-full text-center text-2xl sm:text-3xl tracking-widest font-black num-ltr min-h-[58px] py-3.5 px-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              title={showPassword ? 'إخفاء' : 'إظهار'}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center text-[var(--g-muted)] hover:bg-[var(--g-surface-variant)]"
            >
              <span className="ms-icon text-xl">
                {showPassword ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          </div>

          {loginError && (
            <div className="p-3 rounded-2xl bg-[var(--g-red-bg)] text-[var(--g-red)] text-xs sm:text-sm font-extrabold text-center flex items-center justify-center gap-1.5">
              <span className="ms-icon filled text-lg">gpp_bad</span>
              <span>{loginError}</span>
            </div>
          )}

          {/* True 3-Column Giant Touch Keypad (Explicit dir="ltr" so grid is never broken!) */}
          <div dir="ltr" className="grid grid-cols-3 gap-2.5 sm:gap-3 w-full select-none">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                disabled={submitting}
                onClick={() => handleKeypadDigit(digit)}
                className="h-14 sm:h-15 rounded-2xl bg-[var(--g-surface-variant)] hover:bg-[var(--g-secondary-container)] active:scale-95 text-2xl font-black flex items-center justify-center transition-all"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              disabled={submitting}
              onClick={handleBackspace}
              title="مسح رقم"
              className="h-14 sm:h-15 rounded-2xl bg-[var(--g-surface-variant)] text-[var(--g-muted)] font-extrabold flex items-center justify-center active:scale-95 transition-all"
            >
              <span className="ms-icon text-2xl">backspace</span>
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleKeypadDigit('0')}
              className="h-14 sm:h-15 rounded-2xl bg-[var(--g-surface-variant)] hover:bg-[var(--g-secondary-container)] active:scale-95 text-2xl font-black flex items-center justify-center transition-all"
            >
              0
            </button>
            <button
              type="submit"
              disabled={submitting || !password.trim()}
              className="h-14 sm:h-15 rounded-2xl bg-[#1E8E3E] text-white text-base font-black flex items-center justify-center gap-1.5 disabled:opacity-45 active:scale-95 transition-all shadow-sm"
            >
              <span>{submitting ? '...' : 'دخول'}</span>
              <span className="ms-icon text-lg">login</span>
            </button>
          </div>

          <div className="pt-2 border-t border-[var(--g-border)] text-center text-[11px] text-[var(--g-muted)] flex items-center justify-center gap-1.5 leading-snug">
            <span className="ms-icon text-sm text-[var(--g-green)]">verified_user</span>
            <span>يبقى الجهاز مسجلاً تلقائياً ولا يطلب كلمة المرور مرة أخرى إلا عند تسجيل الخروج</span>
          </div>
        </form>
      </div>
    </div>
  );
}
