import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  apiRequest,
  normalizeDigitsClient,
  computeShiftDurationHoursClient,
  formatShiftDurationArabicClient,
} from '../lib/api.js';
import { playSuccessChime, speakArabicConfirmation } from '../lib/audio.js';

const ACTION_AR = {
  check_in: 'حضور',
  break_start: 'بداية استراحة',
  break_end: 'عودة من الاستراحة',
  check_out: 'انصراف',
};

/**
 * كروت الـ QR والرمز السريع + طباعة كروت جميع الموظفين (بدون إظهار الرقم السري على الكرت)
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
  const [breakMinutes, setBreakMinutes] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [scanResultBanner, setScanResultBanner] = useState(null);
  const [cardSearch, setCardSearch] = useState('');

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

  // Generate QR images locally & offline whenever modal opens or employees change
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function generateAll() {
      const nextMap = {};
      for (const emp of employees) {
        const payload = `ZMART:EMP:${emp.id}`;
        try {
          nextMap[emp.id] = await QRCode.toDataURL(payload, {
            width: 240,
            margin: 1,
            color: { dark: '#0F172A', light: '#FFFFFF' },
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
  }, [open, employees]);

  // Start / Stop QR Scanner stream ONLY when user explicitly opens the 'scan' tab
  useEffect(() => {
    if (!open || tab !== 'scan') {
      setCameraActive(false);
      return;
    }

    let stream = null;
    let rafId = null;
    let active = true;
    let lastDecodeMs = 0;

    async function startScanner() {
      setCameraError('');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('الكاميرا غير متاحة على هذا المتصفح — استخدم تصوير صورة الكرت بالأسفل أو الرمز السريع.');
        return;
      }
      const isLite =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('lite-mode');
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: isLite ? 360 : 640 },
              height: { ideal: isLite ? 240 : 480 },
            },
            audio: false,
          });
        } catch {
          // Fallback for budget/older Android cameras that reject resolution/facingMode constraints
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
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
      const nowMs = Date.now();
      const isLite =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('lite-mode');
      const minInterval = isLite ? 160 : 110;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (
        nowMs - lastDecodeMs >= minInterval &&
        video &&
        canvas &&
        video.readyState === video.HAVE_ENOUGH_DATA
      ) {
        lastDecodeMs = nowMs;
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
        allowed_break_minutes: preferredAction === 'break_start' ? breakMinutes : undefined,
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
      onToast?.(err.message || 'الكود أو الـ QR غير معروف', 'error');
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

  function handlePrintCardsWindow(listToPrint) {
    const cardsList = listToPrint && listToPrint.length > 0 ? listToPrint : employees;
    if (cardsList.length === 0) {
      onToast?.('لا يوجد موظفون لطباعة كروتهم حالياً', 'error');
      return;
    }

    const cardsHtml = cardsList
      .map((emp) => {
        const qrSrc = qrMap[emp.id] || '';
        const shiftText = `${emp.shift_start || '08:00'} -> ${emp.shift_end || '20:00'}`;
        const shiftDurLabel =
          emp.shiftDurationLabel || formatShiftDurationArabicClient(emp.shift_start, emp.shift_end);
        return `
          <div class="badge-card">
            <div class="badge-info">
              <div class="badge-header">
                <img src="${window.location.origin}/Logo.png" alt="${storeName}" class="badge-logo" onerror="this.src='${window.location.origin}/logo.jpeg'" />
                <span>${storeName} — بطاقة حضور ذكية</span>
              </div>
              <div class="badge-name">${emp.name}</div>
              <div class="badge-dept">${emp.department}${emp.role_title ? ` • ${emp.role_title}` : ''}</div>
              <div class="badge-shift">⏰ شفت (${shiftDurLabel}): <span dir="ltr">${shiftText}</span></div>
              <div class="badge-footer">🔒 بطاقة QR مشفرة (بدون رقم سري)</div>
            </div>
            <div class="badge-qr-wrap">
              ${qrSrc ? `<img src="${qrSrc}" alt="QR" class="badge-qr" />` : ''}
            </div>
          </div>
        `;
      })
      .join('');

    const printWin = window.open('', '_blank', 'width=900,height=800');
    if (!printWin) {
      // Fallback to native window.print() if popup blocked
      window.print();
      return;
    }

    printWin.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <title>طباعة كروت الـ QR للموظفين — ${storeName} (${cardsList.length} موظف)</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      font-family: 'Cairo', 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif;
      direction: rtl;
      margin: 0;
      padding: 8mm;
      background: #ffffff;
      color: #0f172a;
    }
    .sheet-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid #0b57d0;
      padding-bottom: 8px;
      margin-bottom: 14px;
    }
    .sheet-title { font-size: 16pt; font-weight: 800; color: #0b57d0; }
    .sheet-meta { font-size: 10pt; color: #475569; font-weight: 700; }
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    .badge-card {
      border: 2px solid #1e293b;
      border-radius: 14px;
      padding: 12px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: #ffffff;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .badge-info { flex: 1; min-width: 0; }
    .badge-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 9.5pt;
      font-weight: 800;
      color: #0b57d0;
      margin-bottom: 4px;
    }
    .badge-logo {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      object-fit: cover;
    }
    .badge-name {
      font-size: 13.5pt;
      font-weight: 900;
      color: #0f172a;
      margin-bottom: 2px;
    }
    .badge-dept {
      font-size: 10pt;
      font-weight: 700;
      color: #334155;
      margin-bottom: 4px;
    }
    .badge-shift {
      font-size: 9pt;
      color: #475569;
      margin-bottom: 6px;
      font-weight: 700;
    }
    .badge-footer {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      background: #e8f0fe;
      color: #0b57d0;
      font-size: 8.5pt;
      font-weight: 800;
    }
    .badge-qr-wrap {
      flex-shrink: 0;
    }
    .badge-qr {
      width: 92px;
      height: 92px;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      display: block;
    }
    @media screen {
      .no-print-bar {
        margin-bottom: 14px;
        padding: 10px 14px;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .print-btn {
        background: #0b57d0;
        color: #fff;
        border: none;
        padding: 8px 18px;
        border-radius: 8px;
        font-weight: 800;
        cursor: pointer;
      }
    }
    @media print {
      .no-print-bar { display: none !important; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="no-print-bar">
    <span><strong>جاهز للطباعة:</strong> ${cardsList.length} كرت QR لجميع الموظفين (بدون إظهار كلمات المرور)</span>
    <button class="print-btn" onclick="window.print()">🖨️ طباعة الآن (A4)</button>
  </div>
  <div class="sheet-header">
    <div class="sheet-title">${storeName} — كروت الحضور والانصراف الذكية (QR)</div>
    <div class="sheet-meta">إجمالي الكروت: ${cardsList.length} موظف</div>
  </div>
  <div class="cards-grid">
    ${cardsHtml}
  </div>
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 350);
    };
  </script>
</body>
</html>`);
    printWin.document.close();
  }

  if (!open) return null;

  const filteredCardsEmployees = employees.filter((emp) => {
    if (!cardSearch.trim()) return true;
    const q = cardSearch.trim().toLowerCase();
    return (
      emp.name?.toLowerCase().includes(q) ||
      emp.department?.toLowerCase().includes(q) ||
      emp.role_title?.toLowerCase().includes(q)
    );
  });

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
                ماسح الـ QR الذكي وطباعة البطاقات
              </h3>
              <p className="text-xs text-[var(--g-muted)] m-0">
                تسجيل حضور وانصراف واستراحات فوري بالـ QR بدون كشف الأرقام السرية
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
            { id: 'code', label: 'الرمز / الماسح', icon: 'dialpad' },
            { id: 'scan', label: 'كاميرا الـ QR', icon: 'qr_code_scanner' },
            ...(canPrintCards
              ? [{ id: 'cards', label: `طباعة الكروت (${employees.length})`, icon: 'badge' }]
              : []),
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
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              {[
                { id: '', label: 'تلقائي ذكي (حضور ⇄ انصراف)' },
                { id: 'check_in', label: 'حضور فقط 👋' },
                { id: 'break_start', label: 'بداية استراحة ☕' },
                { id: 'break_end', label: 'عودة من استراحة ▶️' },
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

            {preferredAction === 'break_start' && (
              <div className="flex items-center gap-1.5 flex-wrap bg-[var(--g-surface-variant)] px-3 py-2 rounded-2xl">
                <span className="text-xs font-bold text-[var(--g-muted)]">مدة الاستراحة المسموحة:</span>
                {[15, 30, 45, 60].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setBreakMinutes(mins)}
                    className={`px-2.5 py-1 rounded-full text-xs font-extrabold transition-all ${
                      breakMinutes === mins
                        ? 'bg-[var(--g-primary)] text-white'
                        : 'bg-[var(--g-surface)] text-[var(--g-text)] border border-[var(--g-border)]'
                    }`}
                  >
                    {mins} دقيقة
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 1: USB QR Scanner / Personal Code Keypad */}
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
                امسح كرت الـ QR بجهاز الباركود (USB) مباشرة، أو أدخل الرمز الشخصي السري الخاص بك:
              </p>
              <input
                type="password"
                value={codeInput}
                onChange={(e) => setCodeInput(normalizeDigitsClient(e.target.value))}
                placeholder="امسح الـ QR أو أدخل رمزك السري"
                autoFocus
                className="g-input w-full max-w-xs mx-auto text-center text-xl sm:text-2xl font-extrabold num-ltr tracking-widest"
              />
            </div>

            <div dir="ltr" className="grid grid-cols-3 gap-2 w-full max-w-xs mx-auto select-none">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCodeInput((v) => (v + d).slice(0, 32))}
                  className="min-h-[52px] rounded-2xl bg-[var(--g-surface-variant)] hover:bg-[var(--g-secondary-container)] active:scale-95 text-2xl font-black flex items-center justify-center transition-all border border-[var(--g-border)]"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCodeInput('')}
                className="min-h-[52px] rounded-2xl bg-[var(--g-red-bg)] text-[var(--g-red)] text-xs sm:text-sm font-black flex items-center justify-center active:scale-95 transition-all"
              >
                مسح
              </button>
              <button
                type="button"
                onClick={() => setCodeInput((v) => (v + '0').slice(0, 32))}
                className="min-h-[52px] rounded-2xl bg-[var(--g-surface-variant)] text-2xl font-black flex items-center justify-center active:scale-95 transition-all border border-[var(--g-border)]"
              >
                0
              </button>
              <button
                type="submit"
                disabled={!codeInput || submitting}
                className="min-h-[52px] rounded-2xl bg-[var(--g-primary)] text-white text-sm font-black flex items-center justify-center disabled:opacity-50 active:scale-95 transition-all shadow-xs"
              >
                تأكيد ✓
              </button>
            </div>

            {/* Quick Employee Selection WITHOUT exposing passwords */}
            {employees.length > 0 && (
              <div className="pt-2 border-t border-[var(--g-border)]">
                <div className="text-xs font-bold text-[var(--g-muted)] mb-2">
                  أو اضغط على اسم الموظف للتسجيل الفوري (محمي بدون إظهار الباسورد):
                </div>
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                  {employees.map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => processScanCode(`ZMART:EMP:${emp.id}`)}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl bg-[var(--g-surface-variant)] hover:bg-[var(--g-secondary-container)] border border-[var(--g-border)] text-xs font-extrabold flex items-center gap-1.5 truncate active:scale-95"
                    >
                      <span className="ms-icon text-sm text-[var(--g-primary)] shrink-0">qr_code_2</span>
                      <span className="truncate">{emp.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>
        )}

        {/* TAB 2: Hands-Free Camera / Photo QR Card Reader */}
        {tab === 'scan' && (
          <div className="space-y-3 text-center">
            <p className="text-xs text-[var(--g-muted)] m-0">
              ارفَع كرت الـ QR الخاص بالموظف أمام العدسة ليتم التسجيل تلقائياً في ثانية واحدة دون لمس الشاشة
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

        {/* TAB 3: Printable Employee QR Cards (NO PASSWORD SHOWN, ALL EMPLOYEES INCLUDED) */}
        {tab === 'cards' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--g-surface-variant)] p-3 rounded-2xl">
              <div className="space-y-0.5">
                <div className="text-xs font-extrabold text-[var(--g-text)]">
                  جاهز لطباعة {employees.length} كرت QR لجميع الموظفين (بدون أرقام سرية على الكرت)
                </div>
                <p className="text-[11px] text-[var(--g-muted)] m-0">
                  يحتوي الكرت على رمز الـ QR المشفر والاسم والقسم والشفت فقط للحفاظ على سرية باسورد كل موظف.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {cardSearch.trim() && (
                  <button
                    type="button"
                    onClick={() => handlePrintCardsWindow(filteredCardsEmployees)}
                    className="px-3.5 py-2 rounded-full bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] text-xs font-bold flex items-center gap-1"
                  >
                    <span className="ms-icon text-sm">filter_alt</span>
                    <span>طباعة المفلتر ({filteredCardsEmployees.length})</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handlePrintCardsWindow(employees)}
                  className="px-4 py-2 rounded-full bg-[var(--g-primary)] text-white text-xs font-bold flex items-center gap-1.5 shadow-xs"
                >
                  <span className="ms-icon text-base">print</span>
                  <span>طباعة كل الكروت ({employees.length}) A4</span>
                </button>
              </div>
            </div>

            {employees.length > 4 && (
              <div className="g-search-bar flex items-center px-3.5 py-2">
                <span className="ms-icon text-[var(--g-muted)] text-base">search</span>
                <input
                  type="text"
                  value={cardSearch}
                  onChange={(e) => setCardSearch(e.target.value)}
                  placeholder="ابحث عن موظف أو قسم لمعاينة أو طباعة كرته..."
                  className="bg-transparent border-none outline-none w-full text-xs px-2 text-[var(--g-text)]"
                />
              </div>
            )}

            {employees.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--g-muted)] bg-[var(--g-surface-variant)] rounded-2xl">
                لا يوجد موظفون مسجلون حالياً. أضف الموظفين من تبويب الحضور أو لوحة الإدارة أولاً.
              </div>
            ) : (
              <div
                id="qr-print-area"
                className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto p-1"
              >
                {filteredCardsEmployees.map((emp) => (
                  <div
                    key={emp.id}
                    className="qr-badge-card p-3.5 rounded-2xl border-2 border-[var(--g-border)] bg-white text-[#1F1F1F] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-[#0B57D0]">
                        <img
                          src="/Logo.png"
                          onError={(e) => {
                            if (e.currentTarget.src.endsWith('/Logo.png')) {
                              e.currentTarget.src = '/logo.jpeg';
                            }
                          }}
                          alt={storeName}
                          className="w-5 h-5 rounded-md object-cover border border-[#DEE3EB] bg-white shrink-0"
                        />
                        <span>{storeName} — بطاقة حضور ذكية</span>
                      </div>
                      <div className="text-base font-extrabold truncate mt-1">{emp.name}</div>
                      <div className="text-xs font-bold text-[#334155] truncate">
                        {emp.department}
                        {emp.role_title ? ` • ${emp.role_title}` : ''}
                      </div>
                      <div className="text-[11px] text-[#5F6368] mt-0.5 num-ltr">
                        ⏰ {emp.shift_start || '08:00'} → {emp.shift_end || '20:00'} ({emp.shiftDurationHours || computeShiftDurationHoursClient(emp.shift_start, emp.shift_end)}h)
                      </div>
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className="inline-block px-2.5 py-0.5 rounded-lg bg-[#E8F0FE] text-[#0B57D0] text-[11px] font-extrabold">
                          🔒 QR مشفر بدون باسورد
                        </span>
                        <button
                          type="button"
                          onClick={() => handlePrintCardsWindow([emp])}
                          className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold"
                          title="طباعة هذا الكرت فقط"
                        >
                          🖨️ طباعة منفرد
                        </button>
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}
