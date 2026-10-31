import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { apiRequest, normalizeDigitsClient } from '../lib/api.js';
import { playSuccessChime, speakArabicConfirmation } from '../lib/audio.js';

const ACTION_AR = {
  check_in: 'حضور',
  break_start: 'بداية استراحة',
  break_end: 'عودة من الاستراحة',
  check_out: 'انصراف',
};

/**
 * الميزة #4: وضع كروت الـ QR والرمز السريع (بدون لمس أو برمز 3 أرقام) + طباعة كروت الموظفين
 */
export default function QrQuickModal({
  open,
  onClose,
  employees = [],
  storeName = 'زايد مارت',
  actorName = 'كشك QR السريع',
  voiceConfirmEnabled = true,
  canPrintCards = true,
  initialTab = 'code',
  onRefresh,
  onToast,
}) {
  const [tab, setTab] = useState(initialTab);
  const [codeInput, setCodeInput] = useState('');
  const [preferredAction, setPreferredAction] = useState(''); // '' = automatic smart toggle
  const [submitting, setSubmitting] = useState(false);
  const [scanResultBanner, setScanResultBanner] = useState(null);

  // Camera QR Scanner state (optional hands-free QR reader when on 'scan' tab)
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const qrImageInputRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const lastScannedRef = useRef({ value: '', time: 0 });

  // Generated QR Data URLs for printable employee cards
  const [qrMap, setQrMap] = useState({});

  useEffect(() => {
    if (open) {
      setTab(!canPrintCards && initialTab === 'cards' ? 'code' : initialTab);
      setCodeInput('');
      setScanResultBanner(null);
    }
  }, [open, initialTab, canPrintCards]);

  // Generate QR images locally & offline whenever 'cards' tab opens
  useEffect(() => {
    if (!open || tab !== 'cards') return;
    let cancelled = false;
    async function generateAll() {
      const nextMap = {};
      for (const emp of employees) {
        const payload = `ZMART:EMP:${emp.id}`;
        try {
          nextMap[emp.id] = await QRCode.toDataURL(payload, {
            width: 220,
            margin: 1,
            color: { dark: '#1F1F1F', light: '#FFFFFF' },
          });
        } catch {
          // ignore
        }
      }
      if (!cancelled) setQrMap(nextMap);
    }
    generateAll();
    return () => {
      cancelled = true;
    };
  }, [open, tab, employees]);

  // Start / Stop QR Scanner stream ONLY when user explicitly opens the 'scan' tab
  useEffect(() => {
    if (!open || tab !== 'scan') {
      setCameraActive(false);
      return;
    }

    let stream = null;
    let rafId = null;
    let active = true;

    async function startScanner() {
      setCameraError('');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('الكاميرا غير متاحة على هذا المتصفح — استخدم تصوير صورة الكرت بالأسفل أو الرمز السريع.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraActive(true);
          tickScan();
        }
      } catch {
        setCameraError('لم يتم السماح بالكاميرا أو لا توجد كاميرا متصلة — يمكنك رفع صورة الكرت أو إدخال الرمز السريع.');
      }
    }

    function tickScan() {
      if (!active) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (code && code.data) {
          const now = Date.now();
          if (
            code.data !== lastScannedRef.current.value ||
            now - lastScannedRef.current.time > 4000
          ) {
            lastScannedRef.current = { value: code.data, time: now };
            processScanCode(code.data);
          }
        }
      }
      rafId = requestAnimationFrame(tickScan);
    }

    startScanner();

    return () => {
      active = false;
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      setCameraActive(false);
    };
  }, [open, tab]);

  async function processScanCode(rawCode) {
    if (!rawCode || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiRequest('/api/attendance/quick-scan', 'POST', {
        code_or_qr: rawCode,
        preferred_action: preferredAction,
        recorded_by: `${actorName} (QR/كود)`,
      });

      const empName = res.employee?.name || 'الموظف';
      const actionLabel = ACTION_AR[res.action_type] || 'حركة';

      if (res.duplicateGuard) {
        playSuccessChime('in');
        setScanResultBanner({
          empName,
          text: res.message,
          tone: 'bg-[#0B57D0]',
        });
      } else {
        playSuccessChime(res.action_type === 'check_out' ? 'out' : 'in');
        speakArabicConfirmation(`تم تسجيل ${actionLabel}، ${empName}`, voiceConfirmEnabled);
        setScanResultBanner({
          empName,
          text: `تم تسجيل ${actionLabel} بنجاح ✓`,
          tone: res.action_type === 'check_out' ? 'bg-[#B3261E]' : 'bg-[#146C2E]',
        });
        onToast?.(`تم تسجيل ${actionLabel} لـ "${empName}" في ثانية واحدة ✓`);
        onRefresh?.();
      }

      setCodeInput('');
      setTimeout(() => {
        setScanResultBanner((curr) => (curr?.empName === empName ? null : curr));
      }, 2800);
    } catch (err) {
      onToast?.(err.message || 'الكود غير معروف', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecodeQrFromPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(data.data, data.width, data.height);
      if (code?.data) {
        processScanCode(code.data);
      } else {
        onToast?.('لم يتم العثور على رمز QR واضح في الصورة', 'error');
      }
    };
    img.src = URL.createObjectURL(file);
  }

  if (!open) return null;

  return (
    <div onClick={onClose} className="g-modal-overlay">
      <div
        onClick={(e) => e.stopPropagation()}
        className="g-dialog-sheet max-w-2xl animate-pop space-y-4"
      >
        <div className="g-sheet-handle" />

        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-[var(--g-border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-11 h-11 rounded-2xl bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] flex items-center justify-center shrink-0">
              <span className="ms-icon filled text-2xl">qr_code_scanner</span>
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-extrabold m-0">
                كروت الـ QR والرمز السريع للموظفين
              </h3>
              <p className="text-xs text-[var(--g-muted)] m-0">
                تسجيل حضور وانصراف فوري في ثانية واحدة بدون بحث
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

        {/* Google Segmented Tabs */}
        <div
          className={`grid ${
            canPrintCards ? 'grid-cols-3' : 'grid-cols-2'
          } gap-1 bg-[var(--g-surface-variant)] p-1 sm:p-1.5 rounded-2xl sm:rounded-full`}
        >
          {[
            { id: 'code', label: 'الرمز السريع', icon: 'dialpad' },
            { id: 'scan', label: 'مسح كرت QR', icon: 'qr_code_scanner' },
            ...(canPrintCards ? [{ id: 'cards', label: 'طباعة الكروت', icon: 'badge' }] : []),
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`py-2 px-1.5 rounded-xl sm:rounded-full text-[11px] sm:text-sm font-bold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 transition-all min-w-0 ${
                tab === t.id
                  ? 'bg-[var(--g-surface)] text-[var(--g-primary)] shadow-xs'
                  : 'text-[var(--g-muted)]'
              }`}
            >
              <span className="ms-icon text-base">{t.icon}</span>
              <span className="truncate max-w-full">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Live Instant Feedback Banner */}
        {scanResultBanner && (
          <div
            className={`${scanResultBanner.tone} text-white p-4 rounded-2xl flex items-center justify-between gap-3 animate-pop`}
          >
            <div className="flex items-center gap-2.5">
              <span className="ms-icon filled text-3xl">verified</span>
              <div>
                <div className="font-extrabold text-base">{scanResultBanner.empName}</div>
                <div className="text-xs opacity-95">{scanResultBanner.text}</div>
              </div>
            </div>
          </div>
        )}

        {/* Action Override Pills (Auto vs Explicit) */}
        {tab !== 'cards' && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {[
              { id: '', label: 'تلقائي ذكي (حضور ⇄ انصراف)' },
              { id: 'check_in', label: 'حضور فقط 👋' },
              { id: 'break_start', label: 'استراحة ☕' },
              { id: 'break_end', label: 'عودة ▶️' },
              { id: 'check_out', label: 'انصراف 🏠' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPreferredAction(opt.id)}
                className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap border transition-all ${
                  preferredAction === opt.id
                    ? 'g-pill-active border-transparent'
                    : 'bg-[var(--g-surface)] border-[var(--g-border)] text-[var(--g-muted)] font-medium'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* TAB 1: Quick 3-Digit Employee Code Keypad */}
        {tab === 'code' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              processScanCode(codeInput);
            }}
            className="space-y-3"
          >
            <div className="text-center">
              <p className="text-xs text-[var(--g-muted)] m-0 mb-2">
                أدخل كود الموظف السريع (مثال: <strong className="num-ltr">101</strong> أو{' '}
                <strong className="num-ltr">102</strong>) أو امسح بجهاز الباركود USB:
              </p>
              <input
                type="text"
                inputMode="numeric"
                value={codeInput}
                onChange={(e) => setCodeInput(normalizeDigitsClient(e.target.value))}
                placeholder="101"
                className="g-input w-full max-w-xs mx-auto text-center text-2xl sm:text-3xl font-extrabold num-ltr tracking-widest"
              />
            </div>

            <div dir="ltr" className="grid grid-cols-3 gap-2 w-full max-w-xs mx-auto select-none">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCodeInput((v) => (v + d).slice(0, 6))}
                  className="min-h-[54px] rounded-2xl bg-[var(--g-surface-variant)] hover:bg-[var(--g-secondary-container)] active:scale-95 text-2xl font-black flex items-center justify-center transition-all border border-[var(--g-border)]"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCodeInput('')}
                className="min-h-[54px] rounded-2xl bg-[var(--g-red-bg)] text-[var(--g-red)] text-xs sm:text-sm font-black flex items-center justify-center active:scale-95 transition-all"
              >
                مسح
              </button>
              <button
                type="button"
                onClick={() => setCodeInput((v) => (v + '0').slice(0, 6))}
                className="min-h-[54px] rounded-2xl bg-[var(--g-surface-variant)] text-2xl font-black flex items-center justify-center active:scale-95 transition-all border border-[var(--g-border)]"
              >
                0
              </button>
              <button
                type="submit"
                disabled={!codeInput || submitting}
                className="min-h-[54px] rounded-2xl bg-[var(--g-primary)] text-white text-sm font-black flex items-center justify-center disabled:opacity-50 active:scale-95 transition-all shadow-xs"
              >
                تأكيد ✓
              </button>
            </div>

            {/* Quick Directory Reference Chips */}
            <div className="pt-2 border-t border-[var(--g-border)]">
              <div className="text-xs font-bold text-[var(--g-muted)] mb-2">
                أكواد الموظفين السريعة (اضغط على الاسم للتسجيل المباشر بلمسة واحدة):
              </div>
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                {employees.map((emp) => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => processScanCode(emp.emp_code || emp.id)}
                    className="min-h-[42px] px-3 py-1.5 rounded-xl bg-[var(--g-surface-variant)] hover:bg-[var(--g-secondary-container)] border border-[var(--g-border)] text-xs font-extrabold flex items-center gap-1.5 truncate active:scale-95"
                  >
                    <span className="num-ltr px-1.5 py-0.5 rounded bg-[var(--g-surface)] text-[var(--g-primary)] shrink-0">
                      #{emp.emp_code}
                    </span>
                    <span className="truncate">{emp.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </form>
        )}

        {/* TAB 2: Hands-Free Camera / Photo QR Card Reader */}
        {tab === 'scan' && (
          <div className="space-y-3 text-center">
            <p className="text-xs text-[var(--g-muted)] m-0">
              ارفَع كرت الـ QR الخاص بالعامل أمام العدسة ليتم التسجيل تلقائياً في ثانية واحدة دون لمس الشاشة
            </p>

            <div className="relative mx-auto w-full max-w-sm aspect-4/3 rounded-3xl overflow-hidden bg-black border-2 border-[var(--g-primary)] flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />

              {/* Scanning Target Frame */}
              {cameraActive && (
                <div className="absolute inset-8 border-2 border-dashed border-[#81C995] rounded-2xl pointer-events-none flex items-end justify-center pb-2">
                  <span className="px-3 py-0.5 rounded-full bg-black/65 text-white text-[11px] font-bold">
                    وجّه كرت الـ QR داخل الإطار
                  </span>
                </div>
              )}

              {cameraError && (
                <div className="p-4 text-white text-xs font-semibold leading-relaxed">
                  {cameraError}
                </div>
              )}
            </div>

            <input
              ref={qrImageInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleDecodeQrFromPhoto}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => qrImageInputRef.current?.click()}
              className="px-5 py-2.5 rounded-full bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] text-xs sm:text-sm font-bold inline-flex items-center gap-2"
            >
              <span className="ms-icon text-lg">photo_camera</span>
              <span>أو التقط / ارفع صورة كرت الـ QR من الفون</span>
            </button>
          </div>
        )}

        {/* TAB 3: Printable Employee QR Cards */}
        {tab === 'cards' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--g-surface-variant)] p-3 rounded-2xl">
              <p className="text-xs text-[var(--g-muted)] m-0">
                اطبع هذه الصفحة على ورق عادي أو مقوى وغلّف كل كرت بلاستيك حراري لتسليمه للعمال:
              </p>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 rounded-full bg-[var(--g-primary)] text-white text-xs font-bold flex items-center gap-1.5"
              >
                <span className="ms-icon text-base">print</span>
                <span>طباعة كل الكروت (A4)</span>
              </button>
            </div>

            <div
              id="qr-print-area"
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[52vh] overflow-y-auto p-1"
            >
              {employees.map((emp) => (
                <div
                  key={emp.id}
                  className="p-3.5 rounded-2xl border-2 border-[var(--g-border)] bg-white text-[#1F1F1F] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-[#0B57D0]">
                      <img
                        src="/logo.jpeg"
                        alt={storeName}
                        className="w-5 h-5 rounded-md object-cover border border-[#DEE3EB] bg-white shrink-0"
                      />
                      <span>{storeName} — كرت حضور ذكي</span>
                    </div>
                    <div className="text-base font-extrabold truncate mt-0.5">{emp.name}</div>
                    <div className="text-xs text-[#5F6368]">{emp.department}</div>
                    <div className="mt-2 inline-block px-2.5 py-0.5 rounded-lg bg-[#E8F0FE] text-[#0B57D0] text-xs font-extrabold num-ltr">
                      CODE: {emp.emp_code}
                    </div>
                  </div>
                  {qrMap[emp.id] ? (
                    <img
                      src={qrMap[emp.id]}
                      alt={`QR ${emp.name}`}
                      className="w-22 h-22 rounded-xl border border-[#DEE3EB] shrink-0"
                    />
                  ) : (
                    <div className="w-22 h-22 rounded-xl bg-gray-100 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
