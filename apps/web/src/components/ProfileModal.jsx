import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  computeShiftDurationHoursClient,
  fetchMyProfile,
  fetchPersonLog,
  formatShiftDurationArabicClient,
} from '../lib/api.js';
import {
  ACTION_LABELS,
  buildPersonLogWhatsAppText,
  exportPersonLogCsv,
  exportPersonLogWord,
  formatCctvStatusArabic,
  formatTimeArabic,
  getCctvStatusType,
  openWhatsAppShare,
} from '../lib/exportUtils.js';
import {
  BottomSheet,
  Button,
  CockpitMetricStrip,
  EmptyState,
  GroupedList,
  Icon,
  RoleAvatar,
  SkeletonKpiStrip,
  SkeletonList,
  StatusDot,
} from './ui/index.js';

async function copyTextSafe(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return Boolean(ok);
  } catch {
    return false;
  }
}

export default function ProfileModal({
  open,
  onClose,
  authUser,
  onOpenSettings,
  onToast,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [personLog, setPersonLog] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setShowPassword(false);
    setError('');

    async function load() {
      setLoading(true);
      try {
        const res = await fetchMyProfile();
        if (cancelled) return;
        const prof = res?.profile || res || {};
        setProfile(prof);

        const empId =
          prof?.employee?.id ||
          prof?.employee_id ||
          prof?.id ||
          authUser?.employee_id ||
          authUser?.id;

        if (empId) {
          try {
            const qrUrl = await QRCode.toDataURL(`ZMART:EMP:${empId}`, {
              width: 240,
              margin: 1,
            });
            if (!cancelled) setQrDataUrl(qrUrl);
          } catch {
            // ignore QR generation error
          }
          try {
            const logRes = await fetchPersonLog(empId);
            if (!cancelled) setPersonLog(logRes);
          } catch {
            // optional
          }
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err.message || 'تعذر تحميل البيانات';
          setError(msg);
          onToast?.(msg, 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, authUser?.id, authUser?.employee_id, reloadTick, onToast]);

  const p = profile || authUser || {};
  const emp = p.employee || {};
  const displayName = p.display_name || emp.name || authUser?.display_name || 'المستخدم';
  const roleLabel = p.role_label || p.role || authUser?.role_label || authUser?.role || '';
  const department = emp.department || p.department || '';
  const roleTitle = emp.role_title || p.role_title || '';
  const phone = emp.phone || p.phone || '';
  const myPassword = p.my_password || emp.emp_code || p.emp_code || '—';
  const shiftStart = emp.shift_start || p.shift_start || '08:00';
  const shiftEnd = emp.shift_end || p.shift_end || '20:00';
  const shiftDurLabel = formatShiftDurationArabicClient(
    computeShiftDurationHoursClient(shiftStart, shiftEnd)
  );

  const plAtt = personLog?.attendanceLogs || [];
  const plStats = {
    totalCheckIns:
      personLog?.stats?.totalCheckIns ??
      (plAtt.length > 0
        ? plAtt.filter((a) => a.action_type === 'check_in').length
        : personLog?.summary?.daysPresent || 0),
    totalBreaks:
      personLog?.stats?.totalBreaks ??
      personLog?.summary?.totalBreakCount ??
      plAtt.filter((a) => a.action_type === 'break_start').length,
    totalBreakMinutes:
      personLog?.stats?.totalBreakMinutes ??
      personLog?.summary?.totalBreakMinutes ??
      plAtt
        .filter((a) => a.action_type === 'break_end')
        .reduce((acc, a) => acc + (Number(a.break_duration_minutes) || 0), 0),
    shortagesReported:
      personLog?.stats?.shortagesReported ??
      personLog?.summary?.shortagesCount ??
      (personLog?.shortages || []).length,
    notesRecorded:
      personLog?.stats?.notesRecorded ??
      personLog?.summary?.notesCount ??
      (personLog?.notes || []).length,
  };

  async function handleCopyPassword() {
    if (!myPassword || myPassword === '—') return;
    const ok = await copyTextSafe(String(myPassword));
    if (ok) {
      onToast?.('تم نسخ الرمز');
    } else {
      onToast?.('تعذر النسخ التلقائي', 'error');
    }
  }

  return (
    <BottomSheet
      open={Boolean(open)}
      onClose={onClose}
      title={displayName}
      subtitle={`${roleLabel}${department ? ` · ${department}` : ''}`}
      maxWidth="max-w-2xl"
      footer={
        onOpenSettings ? (
          <Button
            variant="secondary"
            fullWidth
            icon="settings"
            onClick={() => {
              onClose?.();
              onOpenSettings('profile');
            }}
          >
            الإعدادات
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        {loading ? (
          <div className="space-y-3">
            <SkeletonKpiStrip count={4} />
            <SkeletonList rows={3} />
          </div>
        ) : error && !profile ? (
          <EmptyState
            icon="cloud_off"
            title="تعذر تحميل البيانات"
            actionLabel="إعادة المحاولة"
            onAction={() => setReloadTick((t) => t + 1)}
            compact
          />
        ) : (
          <div className="space-y-5">
            {/* Compact Identity + Credentials + QR */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <RoleAvatar
                    src={p.effective_avatar_url || p.avatar_url || authUser?.avatar_url}
                    name={displayName}
                    role={p.role || authUser?.role}
                    color={p.avatar_color || authUser?.avatar_color}
                    preset={p.avatar_preset || authUser?.avatar_preset}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink truncate">
                      {emp.name || displayName}
                    </div>
                    <div className="text-xs text-ink-muted truncate">
                      {department || roleLabel}
                      {roleTitle ? ` · ${roleTitle}` : ''}
                    </div>
                  </div>
                </div>

                <GroupedList>
                  <div className="px-3 py-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-ink-muted">الرمز</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm num-ltr tracking-wider text-ink">
                        {showPassword ? myPassword : '••••••'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'إخفاء' : 'إظهار'}
                        className="w-11 h-11 sm:w-9 sm:h-9 rounded-full hover:bg-surface-2 text-ink-muted hover:text-ink flex items-center justify-center cursor-pointer"
                      >
                        <Icon
                          name={showPassword ? 'visibility_off' : 'visibility'}
                          size={16}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyPassword}
                        aria-label="نسخ"
                        className="w-11 h-11 sm:w-9 sm:h-9 rounded-full hover:bg-surface-2 text-ink-muted hover:text-ink flex items-center justify-center cursor-pointer"
                      >
                        <Icon name="content_copy" size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <span className="text-ink-muted">الشفت ({shiftDurLabel})</span>
                    <span className="font-medium num-ltr text-ink">
                      {shiftStart} – {shiftEnd}
                    </span>
                  </div>

                  {phone && (
                    <div className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                      <span className="text-ink-muted">الهاتف</span>
                      <span className="font-medium num-ltr text-ink">{phone}</span>
                    </div>
                  )}
                </GroupedList>
              </div>

              {/* QR Quiet Zone (White background strictly on QR code wrapper) */}
              <div className="flex flex-col items-center justify-center gap-2 py-2">
                {qrDataUrl ? (
                  <div className="p-2 rounded-2xl bg-white border border-line">
                    <img
                      src={qrDataUrl}
                      alt="بطاقة QR"
                      className="w-36 h-36 block rounded-lg"
                    />
                  </div>
                ) : (
                  <div className="w-36 h-36 rounded-2xl bg-surface-2 border border-line flex items-center justify-center text-xs text-ink-muted">
                    QR
                  </div>
                )}
              </div>
            </div>

            {/* Personal Activity & Metrics */}
            {personLog && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-muted">السجل الشخصي</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={exportingExcel}
                      onClick={async () => {
                        if (exportingExcel) return;
                        setExportingExcel(true);
                        try {
                          await exportPersonLogCsv(personLog);
                          onToast?.('تم التصدير إلى Excel');
                        } catch (err) {
                          onToast?.(err.message || 'تعذر التصدير', 'error');
                        } finally {
                          setExportingExcel(false);
                        }
                      }}
                    >
                      Excel
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        exportPersonLogWord(personLog);
                        onToast?.('تم التصدير إلى Word');
                      }}
                    >
                      Word
                    </Button>
                    <Button
                      variant="whatsapp"
                      size="sm"
                      onClick={() => openWhatsAppShare(buildPersonLogWhatsAppText(personLog))}
                    >
                      واتساب
                    </Button>
                  </div>
                </div>

                <CockpitMetricStrip
                  columns={4}
                  items={[
                    { id: 'ci', label: 'الحضور', value: plStats.totalCheckIns },
                    {
                      id: 'br',
                      label: 'البريك',
                      value: plStats.totalBreaks,
                      secondary: `${plStats.totalBreakMinutes} د`,
                    },
                    { id: 'sh', label: 'النواقص', value: plStats.shortagesReported },
                    { id: 'nt', label: 'الملاحظات', value: plStats.notesRecorded },
                  ]}
                />

                {plAtt.length === 0 ? (
                  <EmptyState title="لا توجد حركات مسجلة" compact />
                ) : (
                  <GroupedList>
                    {plAtt.slice(0, 10).map((a) => {
                      const cctvType = getCctvStatusType(a);
                      const cctvTone =
                        cctvType === 'confirmed'
                          ? 'success'
                          : cctvType === 'mismatch'
                          ? 'danger'
                          : 'warning';
                      return (
                        <div
                          key={a.id}
                          className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <StatusDot tone={cctvTone} />
                            <span className="font-medium text-ink truncate">
                              {ACTION_LABELS[a.action_type] || a.action_type}
                              {a.break_duration_minutes > 0
                                ? ` · ${a.break_duration_minutes} د`
                                : ''}
                            </span>
                            <span className="text-ink-muted hidden sm:inline truncate">
                              · {formatCctvStatusArabic(a, { includeMeta: false })}
                            </span>
                          </div>
                          <span className="text-ink-muted num-ltr shrink-0">
                            {a.date_key} · {formatTimeArabic(a.timestamp)}
                          </span>
                        </div>
                      );
                    })}
                  </GroupedList>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
