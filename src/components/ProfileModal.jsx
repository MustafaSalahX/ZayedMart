import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { fetchMyProfile, fetchPersonLog } from '../lib/api.js';
import {
  ACTION_LABELS,
  buildPersonLogWhatsAppText,
  exportPersonLogCsv,
  exportPersonLogWord,
  formatTimeArabic,
  openWhatsAppShare,
} from '../lib/exportUtils.js';

export default function ProfileModal({ open, onClose, authUser, onToast }) {
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [personLog, setPersonLog] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setShowPassword(false);

    async function load() {
      setLoading(true);
      try {
        const res = await fetchMyProfile();
        if (cancelled) return;
        setProfile(res.profile);

        const empId = res.profile?.employee?.id || res.profile?.id || authUser?.id;
        if (empId) {
          try {
            const qrUrl = await QRCode.toDataURL(`ZMART:EMP:${empId}`, {
              width: 240,
              margin: 1,
              color: { dark: '#0F172A', light: '#FFFFFF' },
            });
            if (!cancelled) setQrDataUrl(qrUrl);
          } catch {
            // ignore
          }
          try {
            const logRes = await fetchPersonLog(empId);
            if (!cancelled) setPersonLog(logRes);
          } catch {
            // ignore
          }
        }
      } catch (err) {
        if (!cancelled) onToast?.(err.message || 'تعذر تحميل بيانات البروفايل', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, authUser?.id]);

  if (!open) return null;

  const p = profile || authUser || {};
  const emp = p.employee || {};
  const myPassword = p.my_password || emp.emp_code || '—';
  const shiftStart = emp.shift_start || '08:00';
  const shiftEnd = emp.shift_end || '20:00';

  function handleCopyPassword() {
    if (!myPassword || myPassword === '—') return;
    navigator.clipboard?.writeText(String(myPassword));
    onToast?.('تم نسخ كلمة المرور الخاصة بك ✓');
  }

  return (
    <div onClick={onClose} className="g-modal-overlay">
      <div
        onClick={(e) => e.stopPropagation()}
        className="g-dialog-sheet max-w-2xl animate-pop space-y-4"
      >
        <div className="g-sheet-handle" />

        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-[var(--g-border)]">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-2xl text-white font-black text-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: p.avatar_color || '#0B57D0' }}
            >
              {(p.display_name || 'م').slice(0, 1)}
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-extrabold m-0">
                بروفايلي الشخصي — {p.display_name}
              </h3>
              <p className="text-xs text-[var(--g-muted)] m-0">
                {p.role_label || p.role} {emp.department ? `• قسم ${emp.department}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center"
          >
            <span className="ms-icon">close</span>
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs font-bold text-[var(--g-muted)]">
            جاري تحميل بروفايلك الشخصي...
          </div>
        ) : (
          <div className="space-y-4">
            {/* Personal Credentials & QR Card */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Left: Private Password & Info */}
              <div className="p-4 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-[var(--g-muted)]">
                    🔐 الباسورد / الكود السري الخاص بك فقط
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-[var(--g-green-bg)] text-[var(--g-green)] text-[10px] font-extrabold">
                    خاص بك وحدك
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-[var(--g-surface)] border border-[var(--g-border)] flex items-center justify-between gap-2">
                  <div className="font-black text-xl num-ltr tracking-widest text-[var(--g-primary)]">
                    {showPassword ? myPassword : '••••••'}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="px-2.5 py-1.5 rounded-lg bg-[var(--g-surface-variant)] text-xs font-bold flex items-center gap-1"
                    >
                      <span className="ms-icon text-sm">
                        {showPassword ? 'visibility_off' : 'visibility'}
                      </span>
                      <span>{showPassword ? 'إخفاء' : 'إظهار'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyPassword}
                      className="px-2.5 py-1.5 rounded-lg bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] text-xs font-bold flex items-center gap-1"
                    >
                      <span className="ms-icon text-sm">content_copy</span>
                      <span>نسخ</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--g-muted)]">الاسم الكامل:</span>
                    <span className="font-extrabold">{emp.name || p.display_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--g-muted)]">القسم / الدور:</span>
                    <span className="font-extrabold">
                      {emp.department || p.role_label} {emp.role_title ? `(${emp.role_title})` : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--g-muted)]">مواعيد الشفت (12 ساعة):</span>
                    <span className="font-extrabold num-ltr">
                      {shiftStart} → {shiftEnd}
                    </span>
                  </div>
                  {emp.phone && (
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--g-muted)]">رقم الهاتف:</span>
                      <span className="font-extrabold num-ltr">{emp.phone}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Personal QR Code for Instant Scan */}
              <div className="p-4 rounded-2xl bg-white text-[#0F172A] border-2 border-[var(--g-border)] flex flex-col items-center justify-center text-center space-y-2">
                <div className="text-xs font-extrabold text-[#0B57D0]">
                  بطاقة الـ QR الشخصية للحضور والانصراف
                </div>
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="My QR"
                    className="w-32 h-32 rounded-xl border border-slate-200"
                  />
                ) : (
                  <div className="w-32 h-32 rounded-xl bg-slate-100 flex items-center justify-center text-xs text-slate-400">
                    QR
                  </div>
                )}
                <div className="text-[11px] text-slate-600 font-bold">
                  امسح هذا الـ QR مباشرة على السيستم لتسجيل الحضور أو الاستراحة أو الانصراف بدون كتابة الباسورد
                </div>
              </div>
            </div>

            {/* Personal Activity & Attendance Summary */}
            {personLog && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs sm:text-sm font-extrabold m-0">
                    📋 سجلي الشخصي (الحضور، الاستراحات، النواقص والملاحظات)
                  </h4>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => exportPersonLogCsv(personLog)}
                      className="px-2.5 py-1 rounded-full bg-[var(--g-green-bg)] text-[var(--g-green)] text-[11px] font-extrabold"
                    >
                      تصدير Excel
                    </button>
                    <button
                      type="button"
                      onClick={() => exportPersonLogWord(personLog)}
                      className="px-2.5 py-1 rounded-full bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] text-[11px] font-extrabold"
                    >
                      تصدير Word
                    </button>
                    <button
                      type="button"
                      onClick={() => openWhatsAppShare(buildPersonLogWhatsAppText(personLog))}
                      className="px-2.5 py-1 rounded-full bg-[#25D366]/15 text-[#128C7E] dark:text-[#4ADE80] text-[11px] font-extrabold"
                    >
                      واتساب
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="p-2.5 rounded-xl bg-[var(--g-surface-variant)]">
                    <div className="text-[11px] text-[var(--g-muted)]">مرات الحضور</div>
                    <div className="text-sm font-black">{personLog.stats?.totalCheckIns || 0}</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--g-surface-variant)]">
                    <div className="text-[11px] text-[var(--g-muted)]">الاستراحات</div>
                    <div className="text-sm font-black">
                      {personLog.stats?.totalBreaks || 0} ({personLog.stats?.totalBreakMinutes || 0} د)
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--g-surface-variant)]">
                    <div className="text-[11px] text-[var(--g-muted)]">نواقص ومقترحات</div>
                    <div className="text-sm font-black">{personLog.stats?.shortagesReported || 0}</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--g-surface-variant)]">
                    <div className="text-[11px] text-[var(--g-muted)]">الملاحظات</div>
                    <div className="text-sm font-black">{personLog.stats?.notesRecorded || 0}</div>
                  </div>
                </div>

                <div className="max-h-44 overflow-y-auto space-y-1.5">
                  {(personLog.attendanceLogs || []).slice(0, 10).map((a) => (
                    <div
                      key={a.id}
                      className="px-3 py-2 rounded-xl bg-[var(--g-surface-variant)] flex items-center justify-between text-xs"
                    >
                      <div className="font-bold">
                        {ACTION_LABELS[a.action_type] || a.action_type}
                        {a.break_duration_minutes > 0 ? ` (${a.break_duration_minutes} د)` : ''}
                        {a.shift_date_key && a.shift_date_key !== a.date_key
                          ? ` [شفت ${a.shift_date_key}]`
                          : ''}
                      </div>
                      <div className="text-[var(--g-muted)] num-ltr">
                        {a.date_key} • {formatTimeArabic(a.timestamp)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
