import React, { useEffect, useRef, useState } from 'react';
import {
  fetchLoginProfiles,
  fetchStorePublicInfo,
  getCachedLoginProfiles,
  getConfiguredApiBaseUrl,
  loginWithPassword,
  normalizeDigitsClient,
  setConfiguredApiBaseUrl,
} from '../lib/api.js';
import { playSuccessChime } from '../lib/audio.js';
import { useTheme } from '../lib/themeContext.jsx';
import PwaInstallBanner from './PwaInstallBanner.jsx';
import {
  BottomSheet,
  BrandLogo,
  Button,
  Icon,
  RoleAvatar,
  SegmentedControl,
} from './ui/index.js';

const LOGIN_MODES = [
  { id: 'pin', labelAr: 'الرمز السري' },
  { id: 'credentials', labelAr: 'اسم المستخدم' },
];

export default function AuthLoginScreen({
  darkMode: propDarkMode,
  onToggleDarkMode,
  onLoginSuccess,
  onToast,
}) {
  const themeCtx = useTheme();
  const arch = themeCtx.architecture;
  const darkMode = propDarkMode !== undefined ? propDarkMode : themeCtx.darkMode;

  const isMinimal = arch.id === 'minimal';
  const isGlass = arch.id === 'liquid-glass';
  const hasBackdrop = arch.backdrop.variant !== 'none' && !themeCtx.liteMode && themeCtx.glassMode !== 'off';

  const [storeInfo, setStoreInfo] = useState(() => {
    const cached = getCachedLoginProfiles();
    return {
      store_name: cached?.store_name || 'زايد مارت',
      branch_name: cached?.branch_name || 'الفرع الرئيسي',
      login_show_role_cards: cached ? cached.login_show_role_cards !== false : true,
    };
  });
  const [profiles, setProfiles] = useState(() => getCachedLoginProfiles()?.profiles || []);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [loginMode, setLoginMode] = useState('pin');
  const [useMobileKeyboard, setUseMobileKeyboard] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [showServerConfig, setShowServerConfig] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(() => getConfiguredApiBaseUrl());
  const [serverSavedMsg, setServerSavedMsg] = useState('');

  const passwordInputRef = useRef(null);
  const usernameInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    fetchLoginProfiles()
      .then((res) => {
        if (cancelled || !res) return;
        setStoreInfo({
          store_name: res.store_name || 'زايد مارت',
          branch_name: res.branch_name || 'الفرع الرئيسي',
          login_show_role_cards: res.login_show_role_cards !== false,
        });
        if (Array.isArray(res.profiles)) {
          setProfiles(res.profiles);
        }
      })
      .catch(() => {
        fetchStorePublicInfo()
          .then((info) => {
            if (!cancelled && info?.store_name) {
              setStoreInfo((prev) => ({
                ...prev,
                store_name: info.store_name,
                branch_name: info.branch_name || prev.branch_name,
              }));
            }
          })
          .catch(() => {});
      });

    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      passwordInputRef.current?.focus();
    }

    return () => {
      cancelled = true;
    };
  }, []);

  function handleToggleDark() {
    if (onToggleDarkMode) {
      onToggleDarkMode();
    } else {
      themeCtx.toggleDarkMode();
    }
  }

  function handleSelectProfileCard(prof) {
    setLoginError('');
    if (selectedProfile?.id === prof.id) {
      setSelectedProfile(null);
      return;
    }
    setSelectedProfile(prof);
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      passwordInputRef.current?.focus();
    }
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    const cleanPass = password.trim();
    const cleanUser = username.trim().toLowerCase();
    if (!cleanPass || submitting) return;
    if (loginMode === 'credentials' && !cleanUser && !selectedProfile) {
      setLoginError('أدخل اسم المستخدم أو اختر حساباً');
      return;
    }

    setSubmitting(true);
    setLoginError('');
    try {
      const payload = { password: cleanPass };
      if (loginMode === 'credentials' && cleanUser) {
        payload.username = cleanUser;
      } else if (selectedProfile?.id) {
        payload.user_id = selectedProfile.id;
      }
      const session = await loginWithPassword(payload);
      playSuccessChime('in');
      onLoginSuccess?.(session);
    } catch (err) {
      playSuccessChime('alert');
      setLoginError(err.message || 'بيانات الدخول غير صحيحة');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeypadDigit(digit) {
    if (submitting) return;
    setLoginError('');
    setPassword((prev) => (prev + digit).slice(0, 32));
  }

  function handleBackspace() {
    if (submitting) return;
    setPassword((prev) => prev.slice(0, -1));
  }

  const showRoleCards =
    storeInfo.login_show_role_cards !== false && Array.isArray(profiles) && profiles.length > 0;

  const formSurfaceCls = isMinimal
    ? 'w-full py-2 space-y-5'
    : isGlass
    ? 'w-full g-glass-pane rounded-[26px] p-5 sm:p-6 space-y-4 animate-pop'
    : 'w-full g-card p-5 sm:p-6 space-y-4 animate-pop';

  const keyBtnCls = isMinimal
    ? 'h-13 rounded-[var(--g-radius-btn)] bg-canvas hover:bg-surface-2 border border-line text-ink active:scale-[0.97] text-xl font-semibold flex items-center justify-center transition-[transform,background-color] duration-150 cursor-pointer'
    : isGlass
    ? 'h-13 rounded-2xl bg-glass-control hover:bg-glass-pill border border-[var(--g-glass-border)] text-ink active:scale-[0.96] text-xl font-semibold flex items-center justify-center transition-[transform,background-color] duration-150 cursor-pointer'
    : 'h-13 rounded-[var(--g-radius-md)] bg-surface-2 hover:bg-secondary-container text-ink active:scale-[0.97] text-xl font-semibold flex items-center justify-center transition-[transform,background-color] duration-150 cursor-pointer';

  return (
    <div
      className={`relative z-[1] min-h-[100dvh] w-full flex flex-col text-ink overflow-x-hidden pt-[var(--safe-top)] pb-[var(--safe-bottom)] ${
        hasBackdrop ? 'bg-transparent' : 'bg-canvas'
      }`}
    >
      {arch.shell.showBrandBar && <div className="google-brand-bar shrink-0" />}

      {/* Minimal Top Bar — Single Dark/Light Toggle */}
      <div className="max-w-4xl w-full mx-auto px-4 pt-3 sm:pt-4 flex items-center justify-end">
        <button
          type="button"
          onClick={handleToggleDark}
          aria-label={darkMode ? 'الوضع النهاري' : 'الوضع الليلي'}
          className={`w-11 h-11 rounded-full flex items-center justify-center transition-[transform,background-color,border-color] duration-150 active:scale-95 cursor-pointer ${
            isGlass
              ? 'bg-glass-control border border-[var(--g-glass-border)] text-ink'
              : 'bg-surface border border-line hover:border-line-strong text-ink'
          }`}
        >
          <Icon name={darkMode ? 'light_mode' : 'dark_mode'} size={18} />
        </button>
      </div>

      {/* Centered Calm Login Surface */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-4 sm:py-6">
        <div className="w-full max-w-sm space-y-3">
          <PwaInstallBanner onToast={onToast} />

          <form onSubmit={handleSubmit} className={formSurfaceCls}>
            {/* Identity */}
            <div className="text-center space-y-1.5">
              <div className="flex justify-center">
                <BrandLogo alt={storeInfo.store_name || 'زايد مارت'} size="lg" />
              </div>
              <h1
                className={`text-lg sm:text-xl ${arch.surfaces.headingWeight} tracking-tight text-ink m-0`}
              >
                {storeInfo.store_name || 'زايد مارت'}
              </h1>
              {storeInfo.branch_name && (
                <p className="text-xs font-normal text-ink-muted m-0">
                  {storeInfo.branch_name}
                </p>
              )}
            </div>

            {/* Compact Horizontal Role Avatar Strip */}
            {showRoleCards && (
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 snap-x">
                {profiles.map((prof) => {
                  const isSelected = selectedProfile?.id === prof.id;
                  return (
                    <button
                      key={prof.id}
                      type="button"
                      onClick={() => handleSelectProfileCard(prof)}
                      aria-pressed={isSelected}
                      className={`snap-start min-w-[74px] max-w-[84px] p-2 rounded-[var(--g-radius-md)] flex flex-col items-center text-center gap-1 shrink-0 transition-[transform,background-color,border-color] duration-150 active:scale-[0.96] cursor-pointer border ${
                        isSelected
                          ? 'border-primary bg-primary-container/40'
                          : isMinimal
                          ? 'border-transparent hover:border-line bg-transparent'
                          : isGlass
                          ? 'border-[var(--g-glass-border)] bg-glass-control hover:bg-glass-pill'
                          : 'border-line bg-surface-2/60 hover:border-line-strong'
                      }`}
                    >
                      <RoleAvatar
                        src={prof.avatar_url}
                        name={prof.display_name}
                        role={prof.role}
                        color={prof.avatar_color}
                        preset={prof.avatar_preset || 'role_default'}
                        size="sm"
                      />
                      <span
                        className={`text-[11px] truncate w-full ${
                          isSelected ? 'font-semibold text-ink' : 'font-medium text-ink-muted'
                        }`}
                      >
                        {prof.display_name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Mode Switcher */}
            <SegmentedControl
              options={LOGIN_MODES}
              value={loginMode}
              onChange={(mode) => {
                setLoginMode(mode);
                setLoginError('');
                if (mode === 'credentials') {
                  setTimeout(() => usernameInputRef.current?.focus(), 50);
                }
              }}
              ariaLabel="طريقة الدخول"
              fullWidth
            />

            {/* Username Input (Credentials Mode — physical left @ alignment for RTL+LTR) */}
            {loginMode === 'credentials' && (
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">
                  اسم المستخدم
                </label>
                <div className="relative">
                  <input
                    ref={usernameInputRef}
                    type="text"
                    dir="ltr"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => {
                      setLoginError('');
                      setUsername(e.target.value.replace(/\s+/g, '_').toLowerCase());
                    }}
                    placeholder="اسم المستخدم"
                    className="g-input num-ltr pl-9 pr-3.5 placeholder:text-right"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted font-semibold num-ltr pointer-events-none"
                  >
                    @
                  </span>
                </div>
              </div>
            )}

            {/* Password Input (physical left eye toggle for RTL+LTR safety) */}
            <div className="space-y-1.5">
              <div className="relative w-full">
                <input
                  ref={passwordInputRef}
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="current-password"
                  inputMode={
                    loginMode === 'pin' && !useMobileKeyboard ? 'none' : 'text'
                  }
                  value={password}
                  onChange={(e) => {
                    setLoginError('');
                    setPassword(normalizeDigitsClient(e.target.value));
                  }}
                  placeholder={
                    loginMode === 'credentials' ? 'كلمة المرور' : 'الرمز السري'
                  }
                  className={`g-input w-full num-ltr min-h-[52px] py-2.5 pl-12 pr-3.5 placeholder:text-right ${
                    loginMode === 'pin'
                      ? 'text-center text-2xl font-semibold tracking-widest'
                      : 'text-base font-medium'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'إخفاء' : 'إظهار'}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-2 cursor-pointer"
                >
                  <Icon
                    name={showPassword ? 'visibility_off' : 'visibility'}
                    size={18}
                  />
                </button>
              </div>

              {loginMode === 'pin' && (
                <div className="flex items-center justify-end md:hidden">
                  <button
                    type="button"
                    onClick={() => {
                      setUseMobileKeyboard((v) => {
                        const next = !v;
                        if (next) {
                          setTimeout(() => passwordInputRef.current?.focus(), 40);
                        }
                        return next;
                      });
                    }}
                    className="min-h-[36px] px-2 text-xs font-medium text-ink-muted hover:text-ink inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Icon name="keyboard" size={14} />
                    <span>{useMobileKeyboard ? 'الأرقام' : 'كيبورد'}</span>
                  </button>
                </div>
              )}
            </div>

            {loginError && (
              <div
                role="alert"
                className="p-2.5 rounded-[var(--g-radius-md)] bg-danger-bg text-danger text-xs font-medium text-center"
              >
                {loginError}
              </div>
            )}

            {/* Tactile PIN Keypad or Credentials Submit */}
            {loginMode === 'pin' ? (
              <div dir="ltr" className="grid grid-cols-3 gap-2 w-full select-none">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    disabled={submitting}
                    onClick={() => handleKeypadDigit(digit)}
                    className={keyBtnCls}
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleBackspace}
                  aria-label="مسح"
                  className={keyBtnCls}
                >
                  <Icon name="backspace" size={20} className="text-ink-muted" />
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleKeypadDigit('0')}
                  className={keyBtnCls}
                >
                  0
                </button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={submitting}
                  disabled={submitting || !password.trim()}
                  className="h-13 text-sm"
                >
                  دخول
                </Button>
              </div>
            ) : (
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={submitting}
                disabled={submitting || !password.trim()}
              >
                دخول
              </Button>
            )}
          </form>

          {/* Quiet Server Config Link */}
          <div className="flex items-center justify-center pt-1">
            <button
              type="button"
              onClick={() => {
                setShowServerConfig(true);
                setServerSavedMsg('');
              }}
              className="min-h-[40px] px-3 text-xs font-medium text-ink-muted hover:text-ink inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Icon name="dns" size={16} />
              <span className="truncate max-w-[240px]">
                {serverUrlInput ? serverUrlInput : 'السيرفر'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Server Config BottomSheet */}
      <BottomSheet
        open={showServerConfig}
        onClose={() => setShowServerConfig(false)}
        title="السيرفر"
        maxWidth="max-w-md"
        footer={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                const saved = setConfiguredApiBaseUrl(serverUrlInput);
                setServerUrlInput(saved);
                setServerSavedMsg(saved ? 'تم حفظ العنوان' : 'تم الضبط على التلقائي');
              }}
            >
              حفظ
            </Button>
            {serverUrlInput && (
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  setConfiguredApiBaseUrl('');
                  setServerUrlInput('');
                  setServerSavedMsg('تم الضبط على التلقائي');
                }}
              >
                تلقائي
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-3 py-1">
          <label className="block text-xs font-medium text-ink-muted">
            عنوان السيرفر
          </label>
          <input
            type="url"
            dir="ltr"
            value={serverUrlInput}
            onChange={(e) => setServerUrlInput(e.target.value)}
            placeholder="https://zayedmart.vercel.app"
            className="g-input text-xs sm:text-sm num-ltr"
          />
          {serverSavedMsg && (
            <div className="p-2.5 rounded-[var(--g-radius-md)] bg-success-bg text-success text-xs font-medium text-center">
              {serverSavedMsg}
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
