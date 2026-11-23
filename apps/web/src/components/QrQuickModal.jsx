import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  apiRequest,
  postActionWithOfflineSupport,
  normalizeDigitsClient,
  computeShiftDurationHoursClient,
  formatShiftDurationArabicClient,
} from '../lib/api.js';
import { playSuccessChime, speakArabicConfirmation } from '../lib/audio.js';
import {
  BottomSheet,
  BrandLogo,
  Button,
  EmptyState,
  FilterChipRail,
  Icon,
  SearchFilterBar,
  SegmentedControl,
} from './ui/index.js';

const ACTION_AR = {
  check_in: 'حضور',
  break_start: 'بداية استراحة',
  break_end: 'عودة من الاستراحة',
  check_out: 'انصراف',
};

const ACTION_OVERRIDE_ITEMS = [
  { id: '', label: 'تلقائي' },
  { id: 'check_in', label: 'حضور' },
  { id: 'break_start', label: 'بداية بريك' },
  { id: 'break_end', label: 'عودة' },
  { id: 'check_out', label: 'انصراف' },
];

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
  const [preferredAction, setPreferredAction] = useState('');
  const [breakMinutes, setBreakMinutes] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [decodingPhoto, setDecodingPhoto] = useState(false);
  const [scanResultBanner, setScanResultBanner] = useState(null);
  const [cardSearch, setCardSearch] = useState('');
  const [singlePrintEmployeeId, setSinglePrintEmployeeId] = useState('');

  const codeInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const qrImageInputRef = useRef(null);
  const bannerTimerRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const lastScannedRef = useRef({ value: '', time: 0 });

  // Generated QR Data URLs for printable employee cards (lazy: generated ONLY on 'cards' tab)
  const [qrMap, setQrMap] = useState({});

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (open) {
      const nextTab = !canPrintCards && initialTab === 'cards' ? 'code' : initialTab;
      setTab(nextTab);
      setCodeInput('');
      setScanResultBanner(null);
      setSinglePrintEmployeeId('');
    }
  }, [open, initialTab, canPrintCards]);

  // Desktop-only auto-focus so mobile virtual keyboard never covers the touch keypad
  useEffect(() => {
    if (!open || tab !== 'code') return;
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      const id = setTimeout(() => codeInputRef.current?.focus(), 60);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open, tab]);

  // Lazy-generate QR images ONLY when 'cards' tab is active
  useEffect(() => {
    if (!open || tab !== 'cards') return undefined;
    let cancelled = false;
    async function generateAll() {
      const nextMap = {};
      for (const emp of employees) {
        const payload = `ZMART:EMP:${emp.id}`;
        try {
          nextMap[emp.id] = await QRCode.toDataURL(payload, {
            width: 240,
            margin: 1,
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

  // Start / Stop QR Scanner stream ONLY when user opens the 'scan' tab
  useEffect(() => {
    if (!open || tab !== 'scan') {
      setCameraActive(false);
      setCameraStarting(false);
      return undefined;
    }

    let stream = null;
    let rafId = null;
    let active = true;
    let lastDecodeMs = 0;

    async function startScanner() {
      setCameraError('');
      setCameraStarting(true);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraStarting(false);
        setCameraError(
          'الكاميرا غير متاحة على هذا المتصفح — استخدم تصوير صورة الكرت بالأسفل أو الرمز السريع.'
        );
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
          setCameraStarting(false);
          setCameraActive(true);
          tickScan();
        }
      } catch {
        setCameraStarting(false);
        setCameraError(
          'لم يتم السماح بالكاميرا أو لا توجد كاميرا متصلة — يمكنك رفع صورة الكرت أو إدخال الرمز السريع.'
        );
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
      setCameraStarting(false);
    };
  }, [open, tab]);

  function resolveLocalEmployeeForOffline(rawCode) {
    const clean = String(rawCode || '').trim();
    if (!clean) return null;
    if (clean.startsWith('ZMART:EMP:')) {
      const id = clean.slice('ZMART:EMP:'.length).trim();
      return employees.find((e) => String(e.id) === id) || null;
    }
    return employees.find((e) => String(e.emp_code || '') === clean) || null;
  }

  function inferSmartAction(emp) {
    if (preferredAction) return preferredAction;
    if (!emp?.currentStatus || emp.currentStatus === 'absent' || emp.currentStatus === 'checked_out') {
      return 'check_in';
    }
    if (emp.currentStatus === 'on_break') return 'break_end';
    return 'check_out';
  }

  async function processScanCode(rawCode) {
    if (!rawCode || submitting) return;
    setSubmitting(true);
    try {
      let res = null;
      try {
        res = await apiRequest('/api/attendance/quick-scan', 'POST', {
          code_or_qr: rawCode,
          preferred_action: preferredAction,
          allowed_break_minutes: preferredAction === 'break_start' ? breakMinutes : undefined,
          recorded_by: `${actorName} (QR/كود)`,
        });
      } catch (err) {
        // Offline resilience fallback when employee is known locally
        const localEmp = resolveLocalEmployeeForOffline(rawCode);
        const isNetworkError =
          !navigator.onLine ||
          err?.code === 'OFFLINE_QUEUED' ||
          /Failed to fetch|NetworkError|تعذر الاتصال/i.test(String(err?.message || ''));
        if (localEmp && isNetworkError) {
          const action_type = inferSmartAction(localEmp);
          await postActionWithOfflineSupport('/api/attendance', {
            employee_id: localEmp.id,
            action_type,
            allowed_break_minutes: action_type === 'break_start' ? breakMinutes : undefined,
            recorded_by: `${actorName} (QR/كود)`,
          });
          res = {
            employee: localEmp,
            action_type,
          };
        } else {
          throw err;
        }
      }

      const empName = res.employee?.name || 'الموظف';
      const actionLabel = ACTION_AR[res.action_type] || 'حركة';

      if (res.duplicateGuard) {
        playSuccessChime('in');
        setScanResultBanner({
          empName,
          text: res.message,
          tone: 'bg-primary-solid text-on-primary',
        });
      } else {
        playSuccessChime(res.action_type === 'check_out' ? 'out' : 'in');
        speakArabicConfirmation(`تم تسجيل ${actionLabel}، ${empName}`, voiceConfirmEnabled);
        setScanResultBanner({
          empName,
          text: `تم تسجيل ${actionLabel}`,
          tone:
            res.action_type === 'check_out'
              ? 'bg-danger-solid text-on-danger'
              : 'bg-success-solid text-on-success',
        });
        onToast?.(`تم تسجيل ${actionLabel} — ${empName}`);
        onRefresh?.();
      }

      setCodeInput('');
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => {
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
    setDecodingPhoto(true);
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
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
      } finally {
        URL.revokeObjectURL(objectUrl);
        setDecodingPhoto(false);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setDecodingPhoto(false);
      onToast?.('تعذر قراءة ملف الصورة المختار', 'error');
    };
    img.src = objectUrl;
  }

  function handlePrintCardsWindow(listToPrint, singleEmpId = '') {
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
          emp.shiftDurationLabel ||
          formatShiftDurationArabicClient(
            emp.shiftDurationHours || computeShiftDurationHoursClient(emp.shift_start, emp.shift_end)
          );
        return `
          <div class="badge-card">
            <div class="badge-info">
              <div class="badge-header">
                <img src="${window.location.origin}/Logo.png" alt="${storeName}" class="badge-logo" onerror="this.src='${window.location.origin}/logo.jpeg'" />
                <span>${storeName} — بطاقة حضور ذكية</span>
              </div>
              <div class="badge-name">${emp.name}</div>
              <div class="badge-dept">${emp.department}${emp.role_title ? ` • ${emp.role_title}` : ''}</div>
              <div class="badge-shift">شفت (${shiftDurLabel}): <span dir="ltr">${shiftText}</span></div>
              <div class="badge-footer">بطاقة QR مشفرة (بدون رقم سري)</div>
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
      // Fallback to native window.print() if popup blocked (e.g. Android WebView)
      setSinglePrintEmployeeId(singleEmpId || '');
      setTimeout(() => {
        window.print();
        setTimeout(() => setSinglePrintEmployeeId(''), 400);
      }, 60);
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
    <button class="print-btn" onclick="window.print()">طباعة الآن (A4)</button>
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

  const filteredCardsEmployees = employees.filter((emp) => {
    if (singlePrintEmployeeId && String(emp.id) !== String(singlePrintEmployeeId)) {
      return false;
    }
    if (!cardSearch.trim()) return true;
    const q = cardSearch.trim().toLowerCase();
    return (
      emp.name?.toLowerCase().includes(q) ||
      emp.department?.toLowerCase().includes(q) ||
      emp.role_title?.toLowerCase().includes(q) ||
      String(emp.emp_code || '').toLowerCase().includes(q)
    );
  });

  const segmentedTabOptions = [
    { id: 'code', labelAr: 'الرمز' },
    { id: 'scan', labelAr: 'الكاميرا' },
    ...(canPrintCards
      ? [{ id: 'cards', labelAr: `الكروت (${employees.length})` }]
      : []),
  ];

  return (
    <BottomSheet
      open={Boolean(open)}
      onClose={onClose}
      title="QR / كود"
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        <SegmentedControl
          fullWidth
          ariaLabel="وضع QR"
          options={segmentedTabOptions}
          value={tab}
          onChange={setTab}
        />

        {/* Live Instant Feedback Banner */}
        {scanResultBanner && (
          <div
            role="status"
            aria-live="polite"
            className={`${scanResultBanner.tone} px-4 py-3 rounded-[var(--g-radius-md)] flex items-center gap-2.5 animate-pop`}
          >
            <Icon name="verified" size={24} filled className="shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{scanResultBanner.empName}</div>
              <div className="text-xs opacity-95 truncate">{scanResultBanner.text}</div>
            </div>
          </div>
        )}

        {/* Action Override Strip */}
        {tab !== 'cards' && (
          <div className="space-y-2">
            <FilterChipRail
              items={ACTION_OVERRIDE_ITEMS}
              activeId={preferredAction}
              onSelect={setPreferredAction}
            />

            {preferredAction === 'break_start' && (
              <div className="flex items-center gap-2 flex-wrap py-1">
                <span className="text-xs font-medium text-ink-muted">مدة البريك:</span>
                {[15, 30, 45, 60].map((mins) => (
                  <Button
                    key={mins}
                    variant={breakMinutes === mins ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setBreakMinutes(mins)}
                  >
                    <span className="num-ltr">{mins}</span> د
                  </Button>
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
            <div className="relative max-w-xs mx-auto">
              <input
                ref={codeInputRef}
                type="password"
                value={codeInput}
                onChange={(e) => setCodeInput(normalizeDigitsClient(e.target.value))}
                placeholder="امسح QR أو أدخل الرمز"
                aria-label="الرمز السري أو كود الموظف"
                className="g-input w-full text-center text-xl sm:text-2xl font-semibold num-ltr tracking-widest pe-11"
              />
              {codeInput && (
                <button
                  type="button"
                  onClick={() => setCodeInput((v) => v.slice(0, -1))}
                  aria-label="حذف"
                  className="absolute top-1/2 -translate-y-1/2 end-1.5 w-10 h-10 rounded-full hover:bg-surface-2 text-ink-muted hover:text-ink flex items-center justify-center cursor-pointer"
                >
                  <Icon name="backspace" size={18} />
                </button>
              )}
            </div>

            <div dir="ltr" className="grid grid-cols-3 gap-2 w-full max-w-xs mx-auto select-none">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCodeInput((v) => (v + d).slice(0, 32))}
                  className="min-h-[50px] rounded-[var(--g-radius-btn)] bg-surface-2 hover:bg-secondary-container text-ink active:scale-[0.97] text-xl font-semibold flex items-center justify-center transition-[transform,background-color] duration-150 border border-line cursor-pointer"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                dir="rtl"
                onClick={() => setCodeInput('')}
                className="min-h-[50px] rounded-[var(--g-radius-btn)] bg-danger-bg text-danger border border-[var(--g-red-border)] text-xs font-semibold flex items-center justify-center active:scale-[0.97] transition-[transform,opacity] duration-150 cursor-pointer"
              >
                مسح
              </button>
              <button
                type="button"
                onClick={() => setCodeInput((v) => (v + '0').slice(0, 32))}
                className="min-h-[50px] rounded-[var(--g-radius-btn)] bg-surface-2 hover:bg-secondary-container text-ink text-xl font-semibold flex items-center justify-center active:scale-[0.97] transition-[transform,background-color] duration-150 border border-line cursor-pointer"
              >
                0
              </button>
              <button
                type="submit"
                dir="rtl"
                disabled={!codeInput || submitting}
                className="min-h-[50px] rounded-[var(--g-radius-btn)] bg-primary-solid hover:bg-primary-solid-hover text-on-primary text-sm font-semibold flex items-center justify-center gap-1 disabled:opacity-45 active:scale-[0.97] transition-[transform,background-color] duration-150 cursor-pointer"
              >
                {submitting && (
                  <Icon name="progress_activity" size={16} spin />
                )}
                <span>تأكيد</span>
              </button>
            </div>

            {employees.length > 0 && (
              <div className="pt-2.5 border-t border-line space-y-2">
                <div className="text-xs font-medium text-ink-muted">اختيار سريع</div>
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {employees.map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      disabled={submitting}
                      onClick={() => processScanCode(`ZMART:EMP:${emp.id}`)}
                      className="min-h-[44px] px-3 py-1.5 rounded-[var(--g-radius-md)] bg-surface-2 hover:bg-secondary-container border border-line text-xs font-medium text-ink flex items-center gap-1.5 truncate active:scale-[0.97] transition-[transform,background-color] duration-150 disabled:opacity-45 cursor-pointer"
                    >
                      <span className="truncate">{emp.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>
        )}

        {/* TAB 2: Camera / Photo QR Card Reader */}
        {tab === 'scan' && (
          <div className="space-y-3 text-center">
            <div className="relative mx-auto w-full max-w-sm aspect-4/3 rounded-[var(--g-radius-card)] overflow-hidden bg-[var(--g-radio-bg)] border border-line flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />

              {cameraStarting && !cameraActive && !cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--g-radio-text)] text-xs font-medium">
                  <Icon name="progress_activity" size={24} spin />
                  <span>تشغيل الكاميرا...</span>
                </div>
              )}

              {cameraActive && (
                <div className="absolute inset-8 border-2 border-dashed border-[var(--g-radio-signal-bright)] rounded-2xl pointer-events-none flex items-end justify-center pb-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-[var(--g-radio-bg)] text-[var(--g-radio-text)] text-[11px] font-medium">
                    وجّه QR داخل الإطار
                  </span>
                </div>
              )}

              {cameraError && (
                <div className="p-4 text-[var(--g-radio-text)] text-xs font-medium leading-relaxed">
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
            <Button
              variant="secondary"
              size="md"
              icon="photo_camera"
              loading={decodingPhoto}
              onClick={() => qrImageInputRef.current?.click()}
            >
              مسح من صورة
            </Button>
          </div>
        )}

        {/* TAB 3: Printable Employee QR Cards */}
        {tab === 'cards' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-line">
              <span className="text-xs font-medium text-ink-muted num-ltr">
                {employees.length} كرت
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {cardSearch.trim() && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="print"
                    onClick={() => handlePrintCardsWindow(filteredCardsEmployees)}
                  >
                    طباعة ({filteredCardsEmployees.length})
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  icon="print"
                  onClick={() => handlePrintCardsWindow(employees)}
                >
                  طباعة الكل A4
                </Button>
              </div>
            </div>

            {employees.length > 4 && (
              <SearchFilterBar
                value={cardSearch}
                onChange={setCardSearch}
                placeholder="بحث بالاسم أو القسم..."
              />
            )}

            {employees.length === 0 ? (
              <EmptyState icon="badge" title="لا يوجد موظفون" compact />
            ) : filteredCardsEmployees.length === 0 ? (
              <EmptyState
                icon="person_search"
                title="لا توجد نتائج"
                actionLabel="مسح"
                onAction={() => setCardSearch('')}
                compact
              />
            ) : (
              <div id="qr-print-area" className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-0.5">
                {filteredCardsEmployees.map((emp) => (
                  <div
                    key={emp.id}
                    className="qr-badge-card g-card p-3.5 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
                        <BrandLogo alt={storeName} size="xs" />
                        <span className="truncate">{storeName}</span>
                      </div>
                      <div className="text-sm font-semibold text-ink truncate">{emp.name}</div>
                      <div className="text-xs text-ink-muted truncate">
                        {emp.department}
                        {emp.role_title ? ` · ${emp.role_title}` : ''}
                      </div>
                      <div className="text-[11px] text-ink-muted num-ltr">
                        {emp.shift_start || '08:00'} – {emp.shift_end || '20:00'} (
                        {emp.shiftDurationHours ||
                          computeShiftDurationHoursClient(emp.shift_start, emp.shift_end)}
                        h)
                      </div>
                      <div className="pt-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="print"
                          onClick={() => handlePrintCardsWindow([emp], emp.id)}
                        >
                          طباعة
                        </Button>
                      </div>
                    </div>

                    {qrMap[emp.id] ? (
                      <div className="p-1.5 rounded-xl bg-white border border-line shrink-0">
                        <img
                          src={qrMap[emp.id]}
                          alt={`QR ${emp.name}`}
                          className="w-20 h-20 block rounded-lg"
                        />
                      </div>
                    ) : (
                      <div className="w-22 h-22 rounded-xl bg-surface-2 border border-line shrink-0 flex items-center justify-center text-xs text-ink-muted">
                        QR
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
