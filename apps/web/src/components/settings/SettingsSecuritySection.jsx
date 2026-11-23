import React, { useEffect, useMemo, useState } from 'react';
import {
  changeMyPassword,
  changeMyUsername,
  checkUsernameAvailable,
  fetchMySessions,
  hasPermission,
  isApiConnectedMode,
  normalizeDigitsClient,
  revokeMyOtherSessions,
} from '../../lib/api.js';
import {
  Button,
  ConfirmSheet,
  GroupedList,
  GroupedRow,
  Icon,
  StatusDot,
  ToggleSwitch,
} from '../ui/index.js';

function evaluatePasswordStrength(rawPass = '', currentPass = '') {
  const pass = String(rawPass || '');
  const hasMinLen = pass.length >= 4;
  const hasGoodLen = pass.length >= 6;
  const hasStrongLen = pass.length >= 8;
  const hasDigits = /\d/.test(pass);
  const hasLettersOrSymbols =
    /[A-Za-z\u0600-\u06FF!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pass);
  const differsFromCurrent = Boolean(pass && pass !== String(currentPass || ''));

  let score = 0;
  if (hasMinLen) score += 1;
  if (hasGoodLen) score += 1;
  if (hasDigits && hasLettersOrSymbols) score += 1;
  if (hasStrongLen && (hasLettersOrSymbols || new Set(pass).size >= 4)) score += 1;

  const level =
    !pass || !hasMinLen
      ? { bars: pass ? 1 : 0, label: 'قصيرة', tone: 'danger', barCls: 'bg-danger-solid' }
      : score <= 1
      ? { bars: 1, label: 'مقبولة', tone: 'warning', barCls: 'bg-warning-solid' }
      : score === 2
      ? { bars: 2, label: 'جيدة', tone: 'primary', barCls: 'bg-primary-solid' }
      : score === 3
      ? { bars: 3, label: 'قوية', tone: 'success', barCls: 'bg-success-solid' }
      : { bars: 4, label: 'ممتازة', tone: 'success', barCls: 'bg-success-solid' };

  return {
    ...level,
    hasMinLen,
    differsFromCurrent,
  };
}

function parseDeviceLabel(ua = '') {
  const s = String(ua || '').toLowerCase();
  if (!s || s === 'rehydrated') return 'جلسة نشطة';
  if (s.includes('android')) return 'أندرويد';
  if (s.includes('iphone') || s.includes('ipad')) return 'آيفون / آيباد';
  if (s.includes('windows')) return 'Windows';
  if (s.includes('macintosh') || s.includes('mac os')) return 'Mac';
  return 'متصفح ويب';
}

/**
 * Section 2: Account Security — Username, Password & Active Sessions.
 * Clean grouped forms with RTL+LTR safe password eye toggles.
 */
export default function SettingsSecuritySection({
  authUser,
  myProfile,
  permissions = [],
  connectionMode = 'local_server',
  onUserUpdated,
  onRefresh,
  onToast,
}) {
  const role = authUser?.role || '';
  const canEditSelf = hasPermission(permissions, role, 'profile:edit_self');
  const isOnlineApi = isApiConnectedMode(connectionMode);
  const currentUsername = myProfile?.username || authUser?.username || '';

  // Username form
  const [newUsername, setNewUsername] = useState('');
  const [userCurrentPass, setUserCurrentPass] = useState('');
  const [showUserPass, setShowUserPass] = useState(false);
  const [availState, setAvailState] = useState({ status: 'idle', reason: '', normalized: '' });
  const [savingUsername, setSavingUsername] = useState(false);

  // Password form
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPass, setShowOldPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [revokeOtherDevices, setRevokeOtherDevices] = useState(true);
  const [savingPassword, setSavingPassword] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);

  useEffect(() => {
    const clean = newUsername.trim().toLowerCase();
    if (!clean) {
      setAvailState({ status: 'idle', reason: '', normalized: '' });
      return undefined;
    }
    if (clean === String(currentUsername).toLowerCase()) {
      setAvailState({
        status: 'same',
        reason: 'اسم المستخدم الحالي',
        normalized: clean,
      });
      return undefined;
    }
    if (!/^[a-z0-9._-]+$/.test(clean) || clean.length < 3 || clean.length > 32) {
      setAvailState({
        status: 'invalid',
        reason: 'يُسمح بـ 3–32 حرفاً إنجليزياً صغيراً أو أرقاماً أو (. _ -)',
        normalized: clean,
      });
      return undefined;
    }
    if (!isOnlineApi) {
      setAvailState({
        status: 'offline',
        reason: 'يتطلب الاتصال بالسيرفر',
        normalized: clean,
      });
      return undefined;
    }

    setAvailState({ status: 'checking', reason: 'جاري التحقق...', normalized: clean });
    const timer = setTimeout(async () => {
      try {
        const res = await checkUsernameAvailable(clean);
        if (res?.available) {
          setAvailState({
            status: 'available',
            reason: 'متاح',
            normalized: res.normalized || clean,
          });
        } else {
          setAvailState({
            status: 'taken',
            reason: res?.reason || 'محجوز لحساب آخر',
            normalized: res?.normalized || clean,
          });
        }
      } catch {
        setAvailState({ status: 'idle', reason: '', normalized: clean });
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [newUsername, currentUsername, isOnlineApi]);

  async function loadSessions() {
    if (!isOnlineApi) return;
    setLoadingSessions(true);
    try {
      const res = await fetchMySessions();
      if (Array.isArray(res?.sessions)) {
        setSessions(res.sessions);
      }
    } catch {
      // ignore
    } finally {
      setLoadingSessions(false);
    }
  }

  useEffect(() => {
    loadSessions();
  }, [isOnlineApi]);

  async function handleCopyUsername() {
    if (!currentUsername) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(currentUsername);
      } else {
        const ta = document.createElement('textarea');
        ta.value = currentUsername;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      onToast?.(`تم نسخ @${currentUsername}`);
    } catch {
      onToast?.('تعذر النسخ', 'error');
    }
  }

  async function handleSubmitUsername(e) {
    e.preventDefault();
    if (!canEditSelf || !isOnlineApi || savingUsername) return;
    const cleanNew = newUsername.trim().toLowerCase();
    if (!cleanNew || availState.status === 'invalid' || availState.status === 'taken') {
      onToast?.(availState.reason || 'اسم مستخدم غير صالح', 'error');
      return;
    }
    if (!userCurrentPass.trim()) {
      onToast?.('أدخل كلمة المرور الحالية', 'error');
      return;
    }

    setSavingUsername(true);
    try {
      const res = await changeMyUsername({
        new_username: cleanNew,
        current_password: userCurrentPass,
      });
      setNewUsername('');
      setUserCurrentPass('');
      setAvailState({ status: 'idle', reason: '', normalized: '' });
      if (res?.user) {
        onUserUpdated?.(res.user);
      }
      onToast?.(`تم تغيير اسم المستخدم إلى @${res?.user?.username || cleanNew}`);
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر تغيير اسم المستخدم', 'error');
    } finally {
      setSavingUsername(false);
    }
  }

  const strength = useMemo(
    () => evaluatePasswordStrength(newPassword, oldPassword),
    [newPassword, oldPassword]
  );

  const passwordsMatch = Boolean(
    newPassword && confirmPassword && newPassword === confirmPassword
  );
  const passwordsMismatch = Boolean(confirmPassword && newPassword !== confirmPassword);

  async function handleSubmitPassword(e) {
    e.preventDefault();
    if (!canEditSelf || !isOnlineApi || savingPassword) return;
    if (!oldPassword.trim()) {
      onToast?.('أدخل كلمة المرور الحالية', 'error');
      return;
    }
    if (!strength.hasMinLen) {
      onToast?.('كلمة المرور 4 أحرف أو أرقام على الأقل', 'error');
      return;
    }
    if (!strength.differsFromCurrent) {
      onToast?.('كلمة المرور الجديدة مطابقة للحالية', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      onToast?.('تأكيد كلمة المرور غير متطابق', 'error');
      return;
    }

    setSavingPassword(true);
    try {
      const res = await changeMyPassword({
        current_password: oldPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
        revoke_other_sessions: revokeOtherDevices,
      });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      if (res?.user) {
        onUserUpdated?.(res.user, res.token);
      }
      onToast?.('تم تغيير كلمة المرور');
      loadSessions();
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || 'تعذر تغيير كلمة المرور', 'error');
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleConfirmRevokeOthers() {
    setRevokingSessions(true);
    try {
      const res = await revokeMyOtherSessions();
      setConfirmRevokeOpen(false);
      onToast?.(`تم إنهاء ${res?.revokedCount || 0} جلسة`);
      loadSessions();
    } catch (err) {
      onToast?.(err.message || 'تعذر إنهاء الجلسات', 'error');
    } finally {
      setRevokingSessions(false);
    }
  }

  const otherSessionsCount = Math.max(
    0,
    sessions.filter((s) => !s.is_current).length
  );

  return (
    <div className="space-y-6">
      {!isOnlineApi && (
        <div className="px-1">
          <StatusDot tone="warning" tintedText label="يتطلب الاتصال بالسيرفر" />
        </div>
      )}

      {!canEditSelf && (
        <div className="px-1">
          <StatusDot tone="neutral" label="التعديل مقيد لهذا الحساب" />
        </div>
      )}

      {/* 1. Username Form */}
      <form onSubmit={handleSubmitUsername} className="space-y-3">
        <GroupedList
          label="اسم المستخدم"
          actions={
            currentUsername ? (
              <button
                type="button"
                onClick={handleCopyUsername}
                className="text-xs font-medium text-primary hover:underline num-ltr inline-flex items-center gap-1 min-h-[32px] cursor-pointer"
              >
                <span>@{currentUsername}</span>
                <Icon name="content_copy" size={14} />
              </button>
            ) : null
          }
        >
          <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
            <label
              htmlFor="sec-new-username"
              className="text-xs sm:text-sm font-medium text-ink-muted sm:w-32 sm:pt-2.5 shrink-0"
            >
              المعرف الجديد
            </label>
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="relative">
                <input
                  id="sec-new-username"
                  type="text"
                  dir="ltr"
                  autoComplete="username"
                  disabled={!canEditSelf || !isOnlineApi}
                  value={newUsername}
                  onChange={(e) =>
                    setNewUsername(e.target.value.replace(/\s+/g, '_').toLowerCase())
                  }
                  placeholder="ahmed.cashier"
                  className="g-input num-ltr pl-9 pr-3.5 placeholder:text-right"
                />
                <span
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted font-semibold num-ltr pointer-events-none"
                >
                  @
                </span>
              </div>

              {availState.status !== 'idle' && (
                <StatusDot
                  tone={
                    availState.status === 'available'
                      ? 'success'
                      : availState.status === 'checking'
                      ? 'neutral'
                      : 'danger'
                  }
                  tintedText={availState.status !== 'checking'}
                  label={availState.reason}
                />
              )}
            </div>
          </div>

          <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label
              htmlFor="sec-username-pass"
              className="text-xs sm:text-sm font-medium text-ink-muted sm:w-32 shrink-0"
            >
              كلمة المرور
            </label>
            <div className="relative flex-1 min-w-0">
              <input
                id="sec-username-pass"
                type={showUserPass ? 'text' : 'password'}
                dir="ltr"
                autoComplete="current-password"
                disabled={!canEditSelf || !isOnlineApi}
                value={userCurrentPass}
                onChange={(e) => setUserCurrentPass(normalizeDigitsClient(e.target.value))}
                placeholder="كلمة المرور الحالية"
                className="g-input num-ltr pl-12 pr-3.5 placeholder:text-right"
              />
              <button
                type="button"
                aria-label={showUserPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                onClick={() => setShowUserPass((v) => !v)}
                className="absolute left-1.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full text-ink-muted hover:bg-surface flex items-center justify-center"
              >
                <Icon
                  name={showUserPass ? 'visibility_off' : 'visibility'}
                  size={18}
                />
              </button>
            </div>
          </div>
        </GroupedList>

        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="w-full sm:w-auto"
            loading={savingUsername}
            disabled={
              !canEditSelf ||
              !isOnlineApi ||
              availState.status !== 'available' ||
              !userCurrentPass.trim()
            }
          >
            تحديث اسم المستخدم
          </Button>
        </div>
      </form>

      {/* 2. Password Form */}
      <form onSubmit={handleSubmitPassword} className="space-y-3">
        <GroupedList label="كلمة المرور">
          <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label
              htmlFor="sec-old-pass"
              className="text-xs sm:text-sm font-medium text-ink-muted sm:w-32 shrink-0"
            >
              الحالية
            </label>
            <div className="relative flex-1 min-w-0">
              <input
                id="sec-old-pass"
                type={showOldPass ? 'text' : 'password'}
                dir="ltr"
                autoComplete="current-password"
                disabled={!canEditSelf || !isOnlineApi}
                value={oldPassword}
                onChange={(e) => setOldPassword(normalizeDigitsClient(e.target.value))}
                placeholder="كلمة المرور الحالية"
                className="g-input num-ltr pl-12 pr-3.5 placeholder:text-right"
              />
              <button
                type="button"
                aria-label={showOldPass ? 'إخفاء' : 'إظهار'}
                onClick={() => setShowOldPass((v) => !v)}
                className="absolute left-1.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full text-ink-muted hover:bg-surface flex items-center justify-center"
              >
                <Icon
                  name={showOldPass ? 'visibility_off' : 'visibility'}
                  size={18}
                />
              </button>
            </div>
          </div>

          <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
            <label
              htmlFor="sec-new-pass"
              className="text-xs sm:text-sm font-medium text-ink-muted sm:w-32 sm:pt-2.5 shrink-0"
            >
              الجديدة
            </label>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="relative">
                <input
                  id="sec-new-pass"
                  type={showNewPass ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="new-password"
                  disabled={!canEditSelf || !isOnlineApi}
                  value={newPassword}
                  onChange={(e) => setNewPassword(normalizeDigitsClient(e.target.value))}
                  placeholder="4 أحرف أو أرقام فأكثر"
                  className="g-input num-ltr pl-12 pr-3.5 placeholder:text-right"
                />
                <button
                  type="button"
                  aria-label={showNewPass ? 'إخفاء' : 'إظهار'}
                  onClick={() => setShowNewPass((v) => !v)}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full text-ink-muted hover:bg-surface flex items-center justify-center"
                >
                  <Icon
                    name={showNewPass ? 'visibility_off' : 'visibility'}
                    size={18}
                  />
                </button>
              </div>

              {/* 4-Bar Strength Meter */}
              {newPassword && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-4 gap-1.5">
                    {[1, 2, 3, 4].map((idx) => (
                      <div
                        key={idx}
                        className={`h-1.5 rounded-full transition-colors ${
                          idx <= strength.bars ? strength.barCls : 'bg-line'
                        }`}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <StatusDot tone={strength.tone} tintedText label={strength.label} />
                    {!strength.differsFromCurrent && oldPassword && (
                      <span className="text-danger font-medium">مطابقة للحالية</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
            <label
              htmlFor="sec-confirm-pass"
              className="text-xs sm:text-sm font-medium text-ink-muted sm:w-32 sm:pt-2.5 shrink-0"
            >
              التأكيد
            </label>
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="relative">
                <input
                  id="sec-confirm-pass"
                  type={showConfirmPass ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="new-password"
                  disabled={!canEditSelf || !isOnlineApi}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(normalizeDigitsClient(e.target.value))}
                  placeholder="أعد كتابة كلمة المرور"
                  className="g-input num-ltr pl-12 pr-3.5 placeholder:text-right"
                />
                <button
                  type="button"
                  aria-label={showConfirmPass ? 'إخفاء' : 'إظهار'}
                  onClick={() => setShowConfirmPass((v) => !v)}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full text-ink-muted hover:bg-surface flex items-center justify-center"
                >
                  <Icon
                    name={showConfirmPass ? 'visibility_off' : 'visibility'}
                    size={18}
                  />
                </button>
              </div>

              {confirmPassword && (
                <StatusDot
                  tone={passwordsMatch ? 'success' : 'danger'}
                  tintedText
                  label={passwordsMatch ? 'متطابق' : 'غير متطابق'}
                />
              )}
            </div>
          </div>

          <ToggleSwitch
            grouped
            checked={revokeOtherDevices}
            onChange={setRevokeOtherDevices}
            disabled={!canEditSelf || !isOnlineApi}
            label="إنهاء الجلسات الأخرى"
          />
        </GroupedList>

        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="w-full sm:w-auto"
            loading={savingPassword}
            disabled={
              !canEditSelf ||
              !isOnlineApi ||
              !oldPassword.trim() ||
              !strength.hasMinLen ||
              !strength.differsFromCurrent ||
              passwordsMismatch ||
              !confirmPassword
            }
          >
            حفظ كلمة المرور
          </Button>
        </div>
      </form>

      {/* 3. Active Sessions */}
      <GroupedList
        label="الجلسات"
        count={sessions.length || 1}
        actions={
          otherSessionsCount > 0 ? (
            <Button
              variant="dangerTonal"
              size="sm"
              onClick={() => setConfirmRevokeOpen(true)}
            >
              إنهاء الأخرى ({otherSessionsCount})
            </Button>
          ) : null
        }
      >
        {loadingSessions && sessions.length === 0 ? (
          <div className="px-3.5 py-3 text-xs text-ink-muted">جاري التحميل...</div>
        ) : (
          (sessions.length > 0
            ? sessions
            : [
                {
                  id: 'current',
                  is_current: true,
                  user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
                  created_at: new Date().toISOString(),
                },
              ]
          ).map((s) => {
            const ua = String(s.user_agent || '').toLowerCase();
            const isMobile = ua.includes('android') || ua.includes('iphone');
            const createdLabel = s.created_at
              ? String(s.created_at).slice(0, 16).replace('T', ' ')
              : '';
            return (
              <GroupedRow key={s.id}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    name={isMobile ? 'smartphone' : 'computer'}
                    size={18}
                    className="text-ink-muted shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-medium text-ink truncate">
                      {parseDeviceLabel(s.user_agent)}
                    </div>
                    <div className="text-[11px] text-ink-muted num-ltr truncate">
                      {s.ip_address ? `${s.ip_address} · ` : ''}
                      {createdLabel}
                    </div>
                  </div>
                </div>

                {s.is_current && <StatusDot tone="success" label="الحالي" />}
              </GroupedRow>
            );
          })
        )}
      </GroupedList>

      <ConfirmSheet
        open={confirmRevokeOpen}
        onClose={() => setConfirmRevokeOpen(false)}
        onConfirm={handleConfirmRevokeOthers}
        loading={revokingSessions}
        tone="danger"
        title="إنهاء الجلسات الأخرى"
        description={`تسجيل خروج ${otherSessionsCount} جهاز آخر مع بقاء هذا الجهاز متصلاً؟`}
        confirmLabel="إنهاء الجلسات"
      />
    </div>
  );
}
