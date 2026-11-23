/**
 * تصدير التقارير والسجلات لملفات Excel حقيقية متعددة الصفحات (.xlsx عبر ExcelJS)
 * وملفات Word (.doc بتنسيق RTL وجداول احترافية متوافقة مع Microsoft Word)
 * وتجهيز الملخصات المنسقة لإرسالها على واتساب بنقرة واحدة
 */

import {
  getScheduleWeekdayLabel,
  getWeekdayCodeFromDateKey,
  SCHEDULE_WEEKDAYS,
} from '@zayed-mart/shared';
import {
  computeShiftDurationHoursClient,
  formatShiftDurationArabicClient,
} from './api.js';

export function formatTimeArabic(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString);
  const hours24 = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, '0');
  const period = hours24 >= 12 ? 'م' : 'ص';
  const hours12 = hours24 % 12 || 12;
  return `${String(hours12).padStart(2, '0')}:${mins} ${period}`;
}

export function formatTimeWithSeconds(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

function formatObservedTimeArabic(raw) {
  const str = String(raw || '').trim();
  if (!str) return '';
  const hhmm = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hhmm) {
    const h24 = Number(hhmm[1]);
    const mins = hhmm[2];
    if (!Number.isNaN(h24) && h24 >= 0 && h24 <= 23) {
      const period = h24 >= 12 ? 'م' : 'ص';
      const h12 = h24 % 12 || 12;
      return `${String(h12).padStart(2, '0')}:${mins} ${period}`;
    }
  }
  return formatTimeArabic(str);
}

export function formatQtyForExport(qty, unit = '') {
  if (qty === null || qty === undefined || qty === '') {
    return 'بدون تحديد كمية';
  }
  const num = Number(qty);
  if (Number.isNaN(num)) return 'بدون تحديد كمية';
  if (num === 0) {
    return unit ? `0 ${unit}` : '0';
  }
  return unit ? `${num} ${unit}` : String(num);
}

function escapeCsvCell(val) {
  const str = val === null || val === undefined ? '' : String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeHtml(val) {
  const str = val === null || val === undefined ? '' : String(val);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function triggerBlobDownloadOrAndroidShare(blob, filename, mimeType) {
  try {
    if (
      typeof window !== 'undefined' &&
      window.ZayedAndroidBridge?.shareOrSaveFile &&
      typeof FileReader !== 'undefined'
    ) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = String(reader.result || '').split(',')[1] || '';
        if (base64) {
          window.ZayedAndroidBridge.shareOrSaveFile(filename, mimeType, base64);
        }
      };
      reader.readAsDataURL(blob);
      return;
    }
  } catch {
    // Fallback below
  }

  try {
    const isAndroidWv =
      typeof navigator !== 'undefined' &&
      /Android/i.test(navigator.userAgent || '') &&
      (window.Capacitor?.isNativePlatform?.() || /; wv\)/i.test(navigator.userAgent || ''));
    if (isAndroidWv && typeof navigator.share === 'function' && typeof File !== 'undefined') {
      const file = new File([blob], filename, { type: mimeType });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: filename }).catch(() => {});
        return;
      }
    }
  } catch {
    // Fallback below
  }

  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadExcelCsv(filename, headers, rows) {
  const safeFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ];
  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerBlobDownloadOrAndroidShare(blob, safeFilename, 'text/csv');
}

export function downloadWordDoc(filename, title, subtitle, sections = []) {
  const safeFilename = filename.endsWith('.doc') ? filename : `${filename}.doc`;
  const sectionsHtml = sections
    .map((sec) => {
      const headersHtml = (sec.headers || [])
        .map(
          (h) =>
            `<th style="background:#1e3a8a;color:#ffffff;padding:8px 10px;border:1px solid #cbd5e1;font-size:11pt;text-align:right;">${escapeHtml(h)}</th>`
        )
        .join('');
      const rowsHtml =
        (sec.rows || []).length > 0
          ? sec.rows
              .map(
                (row, idx) =>
                  `<tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">${row
                    .map(
                      (cell) =>
                        `<td style="padding:7px 10px;border:1px solid #cbd5e1;font-size:10.5pt;text-align:right;vertical-align:top;">${escapeHtml(cell)}</td>`
                    )
                    .join('')}</tr>`
              )
              .join('')
          : `<tr><td colspan="${(sec.headers || []).length || 1}" style="padding:12px;text-align:center;color:#64748b;border:1px solid #cbd5e1;">لا توجد سجلات في هذا القسم</td></tr>`;

      return `
        <div style="margin-top:18px;margin-bottom:18px;">
          <h2 style="font-size:13.5pt;color:#0f172a;margin:0 0 8px 0;padding-bottom:4px;border-bottom:2px solid #2563eb;">${escapeHtml(sec.title || '')}</h2>
          <table dir="rtl" style="width:100%;border-collapse:collapse;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
            <thead><tr>${headersHtml}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40"
      dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 1.5cm; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; text-align: right; color: #0f172a; }
    .header-box { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 14px 18px; border-radius: 8px; margin-bottom: 16px; }
    .header-title { font-size: 18pt; font-weight: bold; color: #1e3a8a; margin: 0 0 4px 0; }
    .header-sub { font-size: 11pt; color: #475569; margin: 0; }
  </style>
</head>
<body dir="rtl">
  <div class="header-box">
    <div class="header-title">${escapeHtml(title)}</div>
    <div class="header-sub">${escapeHtml(subtitle || `تاريخ الاستخراج: ${new Date().toLocaleString('ar-EG')}`)}</div>
  </div>
  ${sectionsHtml}
</body>
</html>`;

  const blob = new Blob(['\uFEFF', html], {
    type: 'application/msword;charset=utf-8',
  });
  triggerBlobDownloadOrAndroidShare(blob, safeFilename, 'application/msword');
}

export function openWhatsAppShare(text) {
  try {
    if (typeof window !== 'undefined' && window.ZayedAndroidBridge?.shareWhatsApp) {
      window.ZayedAndroidBridge.shareWhatsApp(String(text || ''));
      return;
    }
  } catch {
    // Fallback below
  }
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export const ACTION_LABELS = {
  check_in: 'حضور',
  break_start: 'بداية استراحة',
  break_end: 'عودة من استراحة',
  check_out: 'انصراف',
};

const DELIVERY_LABELS = {
  pending: 'جاري التنزيل',
  complete: 'سليمة وكاملة',
  shortage: 'يوجد نواقص',
  return_damaged: 'مرتجع / تالف',
};

const SEVERITY_LABELS = {
  normal: 'عادي',
  warning: 'متابعة',
  urgent: 'طارئ',
};

const SHORTAGE_STATUS_LABELS = {
  open: 'مطلوب توفيره',
  ordered: 'تم الطلب من المورد',
  resolved: 'تم التوفير بالصالة',
};

const SHORTAGE_URGENCY_LABELS = {
  out_of_stock: 'نافذ تماماً من الرف',
  low_stock: 'قارب على النفاد',
};

export function getCctvStatusType(logOrEmp) {
  if (!logOrEmp) return 'none';
  const raw = logOrEmp.cctv_status ?? logOrEmp.latestCctvStatus;
  if (raw === 'none') return 'none';
  if (raw === 'mismatch') return 'mismatch';
  if (raw === 'confirmed') return 'confirmed';
  if (raw === 'pending') return 'pending';
  const verifiedFlag = logOrEmp.verified_by_cctv ?? logOrEmp.latestVerified;
  if (verifiedFlag !== undefined && verifiedFlag !== null) {
    return Number(verifiedFlag) ? 'confirmed' : 'pending';
  }
  return 'pending';
}

export function formatCctvStatusArabic(logOrEmp, { includeMeta = true } = {}) {
  const type = getCctvStatusType(logOrEmp);
  if (type === 'none') return '—';

  const base =
    type === 'confirmed'
      ? '📹 مؤكد بالكاميرا ✓'
      : type === 'mismatch'
        ? '⚠️ تعارض كاميرا'
        : '⏳ بانتظار الكاميرا';

  if (!includeMeta) return base;

  const obs = formatObservedTimeArabic(
    logOrEmp?.cctv_observed_time ?? logOrEmp?.latestCctvObservedTime
  );
  const verifier = String(
    logOrEmp?.verified_by ?? logOrEmp?.latestVerifiedBy ?? ''
  ).trim();

  const metaParts = [];
  if (obs) metaParts.push(type === 'mismatch' ? `رُصد ${obs}` : obs);
  if (verifier) metaParts.push(verifier);

  return metaParts.length > 0 ? `${base} (${metaParts.join(' — ')})` : base;
}

function getNormalizedPersonStats(personData) {
  const s = personData?.stats || {};
  const sum = personData?.summary || {};
  const att = personData?.attendanceLogs || [];
  const sh = personData?.shortages || [];
  const notes = personData?.notes || [];
  const audits = personData?.auditLogs || [];

  const totalCheckIns =
    s.totalCheckIns ??
    (att.length > 0 ? att.filter((a) => a.action_type === 'check_in').length : sum.daysPresent || 0);
  const totalCheckOuts =
    s.totalCheckOuts ?? att.filter((a) => a.action_type === 'check_out').length;
  const totalBreaks =
    s.totalBreaks ??
    sum.totalBreakCount ??
    att.filter((a) => a.action_type === 'break_start').length;
  const totalBreakMinutes =
    s.totalBreakMinutes ??
    sum.totalBreakMinutes ??
    att
      .filter((a) => a.action_type === 'break_end')
      .reduce((acc, a) => acc + (Number(a.break_duration_minutes) || 0), 0);
  const totalLateMinutes =
    s.totalLateMinutes ??
    sum.totalLateMinutes ??
    att.reduce((acc, a) => acc + (Number(a.late_minutes) || 0), 0);
  const shortagesReported = s.shortagesReported ?? sum.shortagesCount ?? sh.length;
  const suggestionsReported =
    s.suggestionsReported ?? sh.filter((item) => Boolean(item.is_suggestion)).length;
  const notesRecorded = s.notesRecorded ?? sum.notesCount ?? notes.length;
  const auditActionsCount = s.auditActionsCount ?? sum.auditCount ?? audits.length;

  return {
    daysPresent: sum.daysPresent ?? totalCheckIns,
    totalCheckIns,
    totalCheckOuts,
    totalBreaks,
    totalBreakMinutes,
    totalLateMinutes,
    shortagesReported,
    suggestionsReported,
    notesRecorded,
    auditActionsCount,
  };
}

// ─── CSV Fallback Helpers (used only if ExcelJS .xlsx export fails) ───

function exportDailyReportCsvFallback(data) {
  const dateKey = data?.dateKey || 'today';
  const rows = [];

  for (const log of data?.attendanceLogs || []) {
    const breakInfo =
      log.action_type === 'break_start' && log.allowed_break_minutes
        ? ` (مسموح ${log.allowed_break_minutes} د)`
        : log.break_duration_minutes > 0
          ? ` (استراحة ${log.break_duration_minutes} د)`
          : '';
    rows.push([
      'حضور وانصراف',
      formatTimeWithSeconds(log.timestamp),
      log.employee_name,
      log.department,
      (ACTION_LABELS[log.action_type] || log.action_type) + breakInfo,
      log.late_minutes > 0 ? `تأخير ${log.late_minutes} دقيقة` : 'منتظم',
      log.recorded_by,
      formatCctvStatusArabic(log),
      `${log.shift_date_key && log.shift_date_key !== log.date_key ? `[شفت ممتد من ${log.shift_date_key}] ` : ''}${log.note || log.break_reason || ''}`,
    ]);
  }

  for (const sh of data?.shortages || []) {
    rows.push([
      sh.is_suggestion ? 'اقتراح صنف جديد' : 'نواقص الصالة والكاشيرية',
      formatTimeWithSeconds(sh.updated_at || sh.created_at),
      sh.item_name,
      sh.category,
      SHORTAGE_STATUS_LABELS[sh.status] || sh.status,
      formatQtyForExport(sh.requested_qty, sh.unit),
      sh.recorded_by,
      `${SHORTAGE_URGENCY_LABELS[sh.urgency] || sh.urgency}${sh.supplier_name ? ` - ${sh.supplier_name}` : ''}`,
      sh.notes || '',
    ]);
  }

  for (const t of data?.truckLogs || []) {
    rows.push([
      'عربيات وطلبيات',
      formatTimeWithSeconds(t.arrival_time),
      t.supplier_name,
      t.category,
      DELIVERY_LABELS[t.delivery_condition] || t.status,
      t.duration_minutes ? `${t.duration_minutes} دقيقة` : 'قيد التنزيل',
      t.recorded_by,
      t.plate_or_driver || t.invoice_number || '',
      t.notes || '',
    ]);
  }

  for (const n of data?.notes || []) {
    rows.push([
      'ملاحظات الكاشيرية والأمن والكاميرات',
      n.dvr_timestamp || formatTimeWithSeconds(n.timestamp),
      n.location_tag,
      n.category_tag,
      SEVERITY_LABELS[n.severity] || n.severity,
      n.is_open_handover ? 'مفتوحة للمتابعة' : 'تم الاطلاع',
      n.recorded_by,
      '',
      n.content || '',
    ]);
  }

  downloadExcelCsv(
    `تقرير_زايد_مارت_${dateKey}.csv`,
    [
      'القسم الرئيسي',
      'الوقت',
      'الاسم / الصنف / المورد / المكان',
      'التصنيف / القسم',
      'الحالة',
      'الكمية / المدة / الانتظام',
      'المسجل بواسطة',
      'مطابقة / أولوية / بيانات إضافية',
      'التفاصيل والملاحظات',
    ],
    rows
  );
}

function exportDailyAttendanceCsvFallback(data) {
  const dateKey = data?.dateKey || 'today';
  const rows = (data?.employees || []).map((emp) => [
    emp.name || '',
    emp.department || '',
    `${emp.shift_start || '08:00'} -> ${emp.shift_end || '20:00'}`,
    emp.currentStatus || 'absent',
    formatTimeArabic(emp.checkInTime),
    formatTimeArabic(emp.checkOutTime),
    emp.lateMinutes > 0 ? `تأخير ${emp.lateMinutes} د` : 'منتظم',
    emp.latestRecordedBy || '',
    formatCctvStatusArabic(emp),
  ]);
  downloadExcelCsv(
    `تقرير_الحضور_${dateKey}.csv`,
    ['الموظف', 'القسم', 'الشفت', 'الحالة', 'الحضور', 'الانصراف', 'الانتظام', 'بواسطة', 'حالة الكاميرا'],
    rows
  );
}

function exportShortagesCsvFallback(shortages = [], label = 'today') {
  const rows = shortages.map((sh) => [
    sh.date_key || '',
    formatTimeArabic(sh.updated_at || sh.created_at),
    sh.is_suggestion ? 'اقتراح صنف جديد' : 'صنف ناقص',
    sh.item_name,
    sh.category || '',
    sh.requested_qty === null || sh.requested_qty === undefined || sh.requested_qty === ''
      ? 'بدون تحديد كمية'
      : String(sh.requested_qty),
    sh.unit || '',
    SHORTAGE_URGENCY_LABELS[sh.urgency] || sh.urgency,
    SHORTAGE_STATUS_LABELS[sh.status] || sh.status,
    sh.supplier_name || '',
    sh.recorded_by || '',
    sh.resolved_by || '',
    sh.notes || '',
  ]);

  downloadExcelCsv(
    `كشف_نواقص_ومقترحات_الصالة_${label}.csv`,
    [
      'التاريخ',
      'الوقت',
      'النوع',
      'اسم الصنف',
      'قسم الصالة',
      'الكمية المطلوبة',
      'الوحدة',
      'درجة الاستعجال',
      'الحالة',
      'المورد',
      'المسجل بواسطة',
      'تم التوفير بواسطة',
      'ملاحظات',
    ],
    rows
  );
}

function exportRangeReportCsvFallback(report) {
  if (!report) return;
  const from = report.period?.from || '';
  const to = report.period?.to || '';
  const rows = [];

  for (const emp of report.employeeStats || []) {
    rows.push([
      'إحصائيات حضور الموظفين',
      `${from} -> ${to}`,
      emp.name,
      emp.department,
      `أيام الحضور: ${emp.daysPresent}`,
      `مرات التأخير: ${emp.lateCount} (${emp.totalLateMinutes} دقيقة)`,
      `الاستراحات: ${emp.breaksCount ?? emp.breaks ?? 0}`,
      emp.emp_code ? `كود ${emp.emp_code}` : '',
      `انصراف مسجل: ${emp.checkOutsCount ?? emp.checkOuts ?? 0}`,
    ]);
  }

  for (const sh of report.shortagesList || []) {
    rows.push([
      sh.is_suggestion ? 'مقترحات أصناف جديدة' : 'سجل نواقص الصالة',
      `${sh.date_key} ${formatTimeWithSeconds(sh.created_at)}`,
      sh.item_name,
      sh.category,
      SHORTAGE_STATUS_LABELS[sh.status] || sh.status,
      formatQtyForExport(sh.requested_qty, sh.unit),
      sh.recorded_by,
      SHORTAGE_URGENCY_LABELS[sh.urgency] || sh.urgency,
      sh.notes || '',
    ]);
  }

  for (const sup of report.supplierStats || []) {
    rows.push([
      'تقييم الموردين والعربيات',
      `${from} -> ${to}`,
      sup.name || sup.supplier_name || '',
      sup.category,
      `الطلبيات: ${sup.deliveriesCount} (مكتمل: ${sup.completedCount})`,
      `متوسط التنزيل: ${sup.avgDurationMinutes} دقيقة`,
      `ملاحظات/نواقص: ${sup.issuesCount}`,
      sup.hasPendingReturn ? 'عليه مرتجع معلق' : 'سليم',
      sup.pendingReturnNote || '',
    ]);
  }

  for (const n of report.notes || []) {
    rows.push([
      'ملاحظات الكاشيرية والكاميرات والأمن',
      `${n.date_key} ${n.dvr_timestamp || ''}`,
      n.location_tag,
      n.category_tag,
      SEVERITY_LABELS[n.severity] || n.severity,
      n.is_open_handover ? 'مفتوحة للمتابعة' : 'مغلقة',
      n.recorded_by,
      n.resolved_by || '',
      n.content || '',
    ]);
  }

  downloadExcelCsv(
    `التقرير_الشامل_زايد_مارت_${from}_الى_${to}.csv`,
    [
      'نوع التقرير',
      'التاريخ / الفترة',
      'الاسم / الصنف / المورد / المكان',
      'القسم / التصنيف',
      'الحالة / الإجمالي',
      'الكمية / التأخير / المدة',
      'المسجل / التفاصيل الإضافية',
      'الأولوية / الكود',
      'ملاحظات',
    ],
    rows
  );
}

function exportAuditLogsCsvFallback(logs = []) {
  const rows = logs.map((l) => [
    l.timestamp ? new Date(l.timestamp).toLocaleString('ar-EG') : '',
    l.actor_name || l.user_name || '',
    l.actor_role || l.role || '',
    l.action || '',
    l.target_type || '',
    l.target_label || '',
    l.details || '',
    l.ip_address || '',
  ]);

  downloadExcelCsv(
    `السجل_الأمني_الشامل_زايد_مارت_${new Date().toISOString().slice(0, 10)}.csv`,
    ['التوقيت', 'المستخدم المنفذ', 'الدور الوظيفي', 'نوع العملية', 'الكيان المستهدف', 'الهدف', 'التفاصيل', 'عنوان IP'],
    rows
  );
}

function exportPersonLogCsvFallback(personData) {
  if (!personData) return;
  const p = personData.person || {};
  const rows = [];

  for (const a of personData.attendanceLogs || []) {
    const breakTxt =
      a.break_duration_minutes > 0
        ? `مدة الاستراحة: ${a.break_duration_minutes} د`
        : a.allowed_break_minutes > 0
          ? `مسموح: ${a.allowed_break_minutes} د`
          : '';
    rows.push([
      'حضور وانصراف',
      a.date_key || '',
      formatTimeWithSeconds(a.timestamp),
      ACTION_LABELS[a.action_type] || a.action_type,
      a.shift_date_key || a.date_key || '',
      a.late_minutes > 0 ? `تأخير ${a.late_minutes} د` : 'منتظم',
      breakTxt,
      a.recorded_by || '',
      `${formatCctvStatusArabic(a)}${a.note || a.break_reason ? ` — ${a.note || a.break_reason}` : ''}`,
    ]);
  }

  for (const s of personData.shortages || []) {
    rows.push([
      s.is_suggestion ? 'اقتراح صنف جديد' : 'تبليغ نقص صنف',
      s.date_key || '',
      formatTimeWithSeconds(s.created_at),
      s.item_name,
      s.category || '',
      formatQtyForExport(s.requested_qty, s.unit),
      SHORTAGE_STATUS_LABELS[s.status] || s.status,
      s.recorded_by || '',
      s.notes || '',
    ]);
  }

  for (const n of personData.notes || []) {
    rows.push([
      'ملاحظة مسجلة',
      n.date_key || '',
      n.dvr_timestamp || formatTimeWithSeconds(n.timestamp),
      n.location_tag || '',
      n.category_tag || '',
      SEVERITY_LABELS[n.severity] || n.severity,
      '',
      n.recorded_by || '',
      n.content || '',
    ]);
  }

  for (const al of personData.auditLogs || []) {
    rows.push([
      'حركة نظام (Audit)',
      (al.timestamp || '').slice(0, 10),
      formatTimeWithSeconds(al.timestamp),
      al.action || '',
      al.target_type || '',
      al.target_label || '',
      '',
      al.actor_name || al.user_name || '',
      al.details || '',
    ]);
  }

  downloadExcelCsv(
    `سجل_${(p.name || 'موظف').replace(/\s+/g, '_')}.csv`,
    ['نوع السجل', 'التاريخ', 'الوقت', 'الحركة / الصنف / العملية', 'القسم / تاريخ الشفت', 'التفاصيل / الكمية', 'الاستراحة / الحالة', 'بواسطة', 'ملاحظات'],
    rows
  );
}

function exportWeeklyScheduleCsvFallback(scheduleData) {
  if (!scheduleData) return;
  const weekStart = scheduleData.weekStartDate || 'week';
  const weekDates = scheduleData.weekDates || {};
  const groups = scheduleData.groups || [];

  const headers = [
    'الفريق / المجموعة',
    'الموظف',
    'الكود',
    'القسم',
    'الشفت',
    'يوم الإجازة المعتمد',
    'الإجازة الثابتة',
    'تعديل أسبوعي',
    ...SCHEDULE_WEEKDAYS.map((d) => `${d.label} (${weekDates[d.code] || d.code})`),
  ];

  const rows = [];
  for (const group of groups) {
    for (const emp of group.employees || []) {
      rows.push([
        group.label || group.id,
        emp.name || '',
        emp.emp_code || '',
        emp.department || '',
        `${emp.shift_start || '08:00'} -> ${emp.shift_end || '20:00'}`,
        emp.effective_day_of_week ? getScheduleWeekdayLabel(emp.effective_day_of_week) : 'غير محدد',
        emp.default_day_of_week ? getScheduleWeekdayLabel(emp.default_day_of_week) : 'غير محدد',
        emp.is_override ? 'نعم' : 'لا',
        ...SCHEDULE_WEEKDAYS.map((d) => (emp.effective_day_of_week === d.code ? 'إجازة' : 'عمل')),
      ]);
    }
  }

  downloadExcelCsv(`جدول_الإجازات_${weekStart}.csv`, headers, rows);
}

// ─── Upgraded .xlsx Excel Exports (lazy-loaded ExcelJS + graceful CSV fallback) ───

export async function exportDailyReportExcel(data) {
  try {
    const mod = await import('./excelExport.js');
    return await mod.exportDailyReportXlsx(data, triggerBlobDownloadOrAndroidShare);
  } catch {
    exportDailyReportCsvFallback(data);
    return null;
  }
}

export async function exportDailyReportCsv(data) {
  return exportDailyReportExcel(data);
}

export async function exportDailyAttendanceExcel(data) {
  try {
    const mod = await import('./excelExport.js');
    return await mod.exportDailyAttendanceXlsx(data, triggerBlobDownloadOrAndroidShare);
  } catch {
    exportDailyAttendanceCsvFallback(data);
    return null;
  }
}

export function exportDailyReportWord(data) {
  const dateKey = data.dateKey || 'today';
  const storeName = data.settings?.store_name || 'زايد مارت';
  const branchName = data.settings?.branch_name || '';

  const attRows = (data.attendanceLogs || []).map((log) => [
    formatTimeArabic(log.timestamp),
    log.employee_name,
    log.department,
    ACTION_LABELS[log.action_type] || log.action_type,
    log.late_minutes > 0 ? `تأخير ${log.late_minutes} د` : 'منتظم',
    log.break_duration_minutes > 0
      ? `استغرقت ${log.break_duration_minutes} د`
      : log.allowed_break_minutes > 0
        ? `مسموح ${log.allowed_break_minutes} د`
        : '—',
    formatCctvStatusArabic(log),
    log.shift_date_key || log.date_key,
    log.recorded_by,
    log.note || log.break_reason || '—',
  ]);

  const shortageRows = (data.shortages || []).map((sh) => [
    sh.is_suggestion ? '💡 اقتراح صنف' : '🛒 صنف ناقص',
    sh.item_name,
    sh.category || '—',
    formatQtyForExport(sh.requested_qty, sh.unit),
    SHORTAGE_STATUS_LABELS[sh.status] || sh.status,
    sh.recorded_by || '—',
    sh.notes || '—',
  ]);

  const notesRows = (data.notes || []).map((n) => [
    n.dvr_timestamp || formatTimeArabic(n.timestamp),
    n.location_tag,
    n.category_tag,
    SEVERITY_LABELS[n.severity] || n.severity,
    n.recorded_by,
    n.content,
  ]);

  const truckRows = (data.truckLogs || []).map((t) => [
    formatTimeArabic(t.arrival_time),
    t.supplier_name,
    t.category,
    DELIVERY_LABELS[t.delivery_condition] || t.status,
    t.duration_minutes ? `${t.duration_minutes} د` : 'قيد التنزيل',
    t.recorded_by,
    t.notes || '—',
  ]);

  downloadWordDoc(
    `تقرير_زايد_مارت_${dateKey}.doc`,
    `التقرير اليومي الشامل — ${storeName}${branchName ? ` (${branchName})` : ''}`,
    `التاريخ: ${dateKey} | حضور: ${data.summary?.presentCount || 0} | استراحة: ${data.summary?.onBreakCount || 0} | انصراف: ${data.summary?.checkedOutCount || 0}`,
    [
      {
        title: `1) سجل الحضور والانصراف والاستراحات (${attRows.length})`,
        headers: ['الوقت', 'الموظف', 'القسم', 'الحركة', 'الانتظام', 'الاستراحة', 'الكاميرا', 'تاريخ الشفت', 'بواسطة', 'ملاحظات'],
        rows: attRows,
      },
      {
        title: `2) نواقص الصالة ومقترحات الكاشيرية (${shortageRows.length})`,
        headers: ['النوع', 'الصنف', 'القسم', 'الكمية', 'الحالة', 'المسجل بواسطة', 'ملاحظات'],
        rows: shortageRows,
      },
      {
        title: `3) ملاحظات الكاشيرية والأمن والكاميرات (${notesRows.length})`,
        headers: ['الوقت', 'المكان', 'التصنيف', 'الأهمية', 'المسجل بواسطة', 'التفاصيل'],
        rows: notesRows,
      },
      {
        title: `4) عربيات الموردين والطلبيات (${truckRows.length})`,
        headers: ['الوقت', 'المورد', 'التصنيف', 'حالة الاستلام', 'المدة', 'المسجل بواسطة', 'ملاحظات'],
        rows: truckRows,
      },
    ]
  );
}

export async function exportShortagesExcel(
  shortages = [],
  label = 'today',
  storeName = 'زايد مارت'
) {
  try {
    const mod = await import('./excelExport.js');
    return await mod.exportShortagesXlsx(
      shortages,
      label,
      storeName,
      triggerBlobDownloadOrAndroidShare
    );
  } catch {
    exportShortagesCsvFallback(shortages, label);
    return null;
  }
}

export async function exportShortagesCsv(
  shortages = [],
  label = 'today',
  storeName = 'زايد مارت'
) {
  return exportShortagesExcel(shortages, label, storeName);
}

export function exportShortagesWord(shortages = [], label = 'today', storeName = 'زايد مارت') {
  const rows = shortages.map((sh) => [
    sh.date_key || '—',
    sh.is_suggestion ? '💡 اقتراح صنف جديد' : '🛒 صنف ناقص',
    sh.item_name,
    sh.category || '—',
    formatQtyForExport(sh.requested_qty, sh.unit),
    SHORTAGE_URGENCY_LABELS[sh.urgency] || sh.urgency,
    SHORTAGE_STATUS_LABELS[sh.status] || sh.status,
    sh.recorded_by || '—',
    sh.notes || '—',
  ]);

  downloadWordDoc(
    `كشف_نواقص_ومقترحات_${label}.doc`,
    `كشف نواقص الصالة ومقترحات الكاشيرية — ${storeName}`,
    `إجمالي الأصناف المسجلة: ${rows.length} صنف`,
    [
      {
        title: 'قائمة الأصناف المطلوبة والمقترحة',
        headers: ['التاريخ', 'النوع', 'اسم الصنف', 'القسم', 'الكمية', 'الأولوية', 'الحالة', 'المسجل بواسطة', 'ملاحظات'],
        rows,
      },
    ]
  );
}

export function buildShortagesWhatsAppText(shortages = [], storeName = 'زايد مارت') {
  const active = shortages.filter((s) => s.status !== 'resolved');
  const list = active.length > 0 ? active : shortages;

  const lines = [
    `🛒 *كشف نواقص ومقترحات الصالة - ${storeName}*`,
    `📅 عدد الأصناف المطلوبة: ${list.length}`,
    `━━━━━━━━━━━━━━━━━━`,
  ];

  if (list.length === 0) {
    lines.push(`✅ جميع أصناف الصالة متوفرة حالياً.`);
    return lines.join('\n');
  }

  // Group by category for clean purchasing order
  const byCat = new Map();
  for (const item of list) {
    const cat = item.category || 'أصناف متنوعة';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(item);
  }

  for (const [cat, items] of byCat.entries()) {
    lines.push(`\n📦 *${cat}:*`);
    for (const sh of items) {
      const icon = sh.is_suggestion ? '💡' : sh.urgency === 'out_of_stock' ? '🔴' : '🟡';
      const prefix = sh.is_suggestion ? '[اقتراح صنف] ' : '';
      const qtyText = formatQtyForExport(sh.requested_qty, sh.unit);
      const statusSuffix = sh.status === 'ordered' ? ' [تم الطلب]' : '';
      const noteSuffix = sh.notes ? ` (${sh.notes})` : '';
      const bySuffix = sh.recorded_by ? ` — بواسطة: ${sh.recorded_by}` : '';
      lines.push(`${icon} ${prefix}${sh.item_name} — *${qtyText}*${statusSuffix}${noteSuffix}${bySuffix}`);
    }
  }

  return lines.join('\n');
}

export async function exportRangeReportExcel(
  report,
  storeName = 'زايد مارت',
  branchName = ''
) {
  if (!report) return null;
  try {
    const mod = await import('./excelExport.js');
    return await mod.exportRangeReportXlsx(
      report,
      storeName,
      branchName,
      triggerBlobDownloadOrAndroidShare
    );
  } catch {
    exportRangeReportCsvFallback(report);
    return null;
  }
}

export async function exportRangeReportCsv(
  report,
  storeName = 'زايد مارت',
  branchName = ''
) {
  return exportRangeReportExcel(report, storeName, branchName);
}

export function exportRangeReportWord(report, storeName = 'زايد مارت', branchName = '') {
  if (!report) return;
  const from = report.period?.from || '';
  const to = report.period?.to || '';

  const empRows = (report.employeeStats || []).map((emp) => {
    const sStart = emp.shift_start || '08:00';
    const sEnd = emp.shift_end || '20:00';
    const durLabel = formatShiftDurationArabicClient(
      computeShiftDurationHoursClient(sStart, sEnd)
    );
    return [
      emp.name,
      emp.department,
      `${sStart} -> ${sEnd} (${durLabel})`,
      String(emp.daysPresent || 0),
      String(emp.checkOutsCount ?? emp.checkOuts ?? 0),
      `${emp.lateCount || 0} (${emp.totalLateMinutes || 0} د)`,
      String(emp.breaksCount ?? emp.breaks ?? 0),
    ];
  });

  const shortageRows = (report.shortagesList || []).map((sh) => [
    sh.date_key || '—',
    sh.is_suggestion ? '💡 اقتراح' : '🛒 نقص',
    sh.item_name,
    sh.category || '—',
    formatQtyForExport(sh.requested_qty, sh.unit),
    SHORTAGE_STATUS_LABELS[sh.status] || sh.status,
    sh.recorded_by || '—',
  ]);

  const supRows = (report.supplierStats || []).map((sup) => [
    sup.name || sup.supplier_name || '—',
    sup.category,
    String(sup.deliveriesCount || 0),
    `${sup.avgDurationMinutes || 0} د`,
    String(sup.issuesCount || 0),
    sup.hasPendingReturn ? 'مرتجع معلق' : 'سليم',
  ]);

  downloadWordDoc(
    `التقرير_الشامل_زايد_مارت_${from}_الى_${to}.doc`,
    `التقرير الشامل عن فترة — ${storeName}${branchName ? ` (${branchName})` : ''}`,
    `الفترة من ${from} إلى ${to}`,
    [
      {
        title: `1) إحصائيات حضور وانصراف الموظفين (${empRows.length})`,
        headers: ['الموظف', 'القسم', 'الشفت والمدة', 'أيام الحضور', 'مرات الانصراف', 'التأخير', 'الاستراحات'],
        rows: empRows,
      },
      {
        title: `2) سجل النواقص والمقترحات (${shortageRows.length})`,
        headers: ['التاريخ', 'النوع', 'الصنف', 'القسم', 'الكمية', 'الحالة', 'بواسطة'],
        rows: shortageRows,
      },
      {
        title: `3) تقييم الموردين (${supRows.length})`,
        headers: ['المورد', 'التصنيف', 'الطلبيات', 'متوسط التنزيل', 'الملاحظات', 'المرتجعات'],
        rows: supRows,
      },
    ]
  );
}

// ─── Attendance & Daily WhatsApp Builders ───

function buildNormalizedAttendanceData(data = {}) {
  const logs = Array.isArray(data?.attendanceLogs) ? data.attendanceLogs : [];
  const rawEmployees = Array.isArray(data?.employees) ? data.employees : [];

  const logsByEmp = new Map();
  for (const log of logs) {
    const key = log.employee_id || log.employee_name;
    if (!key) continue;
    if (!logsByEmp.has(key)) logsByEmp.set(key, []);
    logsByEmp.get(key).push(log);
  }

  let employees = rawEmployees;
  if (employees.length === 0 && logsByEmp.size > 0) {
    employees = Array.from(logsByEmp.entries()).map(([key, empLogs]) => {
      const sortedAsc = [...empLogs].sort((a, b) =>
        String(a.timestamp).localeCompare(String(b.timestamp))
      );
      const latest = sortedAsc[sortedAsc.length - 1];
      const firstIn = sortedAsc.find((l) => l.action_type === 'check_in');
      const lastOut = [...sortedAsc].reverse().find((l) => l.action_type === 'check_out');
      let currentStatus = 'absent';
      if (latest?.action_type === 'check_in' || latest?.action_type === 'break_end') {
        currentStatus = 'present';
      } else if (latest?.action_type === 'break_start') {
        currentStatus = 'on_break';
      } else if (latest?.action_type === 'check_out') {
        currentStatus = 'checked_out';
      }
      return {
        id: latest?.employee_id || key,
        name: latest?.employee_name || 'موظف',
        department: latest?.department || 'عام',
        shift_start: '08:00',
        shift_end: '20:00',
        currentStatus,
        checkInTime: firstIn?.timestamp || latest?.timestamp || null,
        checkOutTime: lastOut?.timestamp || null,
        lateMinutes: Number(firstIn?.late_minutes || 0),
        activeBreakStart: currentStatus === 'on_break' ? latest?.timestamp : null,
        allowedBreakMinutes: Number(latest?.allowed_break_minutes || 30),
        breakReason: latest?.break_reason || '',
        latestLogId: latest?.id || null,
        latestRecordedBy: latest?.recorded_by || '',
        latestActionTime: latest?.timestamp || null,
        latestActionType: latest?.action_type || null,
        latestCctvStatus:
          latest?.cctv_status || (Number(latest?.verified_by_cctv) ? 'confirmed' : 'pending'),
        latestVerified: Boolean(Number(latest?.verified_by_cctv)),
        latestVerifiedBy: latest?.verified_by || '',
        latestCctvObservedTime: latest?.cctv_observed_time || '',
        latestCctvNote: latest?.cctv_note || '',
      };
    });
  } else {
    employees = rawEmployees.map((emp) => {
      const empLogs = logsByEmp.get(emp.id) || [];
      const sortedAsc = [...empLogs].sort((a, b) =>
        String(a.timestamp).localeCompare(String(b.timestamp))
      );
      const latest = sortedAsc[sortedAsc.length - 1] || null;
      const firstIn = sortedAsc.find((l) => l.action_type === 'check_in') || null;
      const lastOut = [...sortedAsc].reverse().find((l) => l.action_type === 'check_out') || null;
      return {
        ...emp,
        checkInTime: emp.checkInTime || firstIn?.timestamp || null,
        checkOutTime: emp.checkOutTime || lastOut?.timestamp || null,
        lateMinutes: emp.lateMinutes ?? Number(firstIn?.late_minutes || 0),
        latestLogId: emp.latestLogId || latest?.id || null,
        latestRecordedBy: emp.latestRecordedBy || latest?.recorded_by || '',
        latestActionTime: emp.latestActionTime || latest?.timestamp || null,
        latestActionType: emp.latestActionType || latest?.action_type || null,
        latestCctvStatus:
          emp.latestCctvStatus ??
          latest?.cctv_status ??
          (emp.latestVerified !== undefined
            ? emp.latestVerified
              ? 'confirmed'
              : 'pending'
            : latest
              ? Number(latest.verified_by_cctv)
                ? 'confirmed'
                : 'pending'
              : 'none'),
        latestVerified:
          emp.latestVerified ?? (latest ? Boolean(Number(latest.verified_by_cctv)) : undefined),
        latestVerifiedBy: emp.latestVerifiedBy || latest?.verified_by || '',
        latestCctvObservedTime: emp.latestCctvObservedTime || latest?.cctv_observed_time || '',
        latestCctvNote: emp.latestCctvNote || latest?.cctv_note || '',
      };
    });
  }

  const presentEmps = employees.filter((e) => e.currentStatus === 'present');
  const onBreakEmps = employees.filter((e) => e.currentStatus === 'on_break');
  const checkedOutEmps = employees.filter((e) => e.currentStatus === 'checked_out');
  const offEmps = employees.filter(
    (e) => e.currentStatus === 'absent' && Boolean(e.isScheduledOff && !e.workedOnDayOff)
  );
  const absentEmps = employees.filter(
    (e) => (!e.currentStatus || e.currentStatus === 'absent') && !e.isScheduledOff
  );

  // Collect all CCTV mismatches (both from logs and enriched employees)
  const mismatchMap = new Map();
  for (const l of logs) {
    if (getCctvStatusType(l) === 'mismatch') {
      mismatchMap.set(l.id || `${l.employee_id}_${l.timestamp}`, {
        name: l.employee_name || 'موظف',
        department: l.department || '—',
        action: ACTION_LABELS[l.action_type] || l.action_type || 'حركة',
        time: l.timestamp,
        observed: l.cctv_observed_time || '',
        verifier: l.verified_by || '',
        note: l.cctv_note || l.note || '',
      });
    }
  }
  for (const e of employees) {
    if (getCctvStatusType(e) === 'mismatch') {
      const key = e.latestLogId || `${e.id}_${e.latestActionTime || ''}`;
      if (!mismatchMap.has(key)) {
        mismatchMap.set(key, {
          name: e.name || 'موظف',
          department: e.department || '—',
          action: ACTION_LABELS[e.latestActionType] || 'حضور',
          time: e.latestActionTime || e.checkInTime,
          observed: e.latestCctvObservedTime || '',
          verifier: e.latestVerifiedBy || '',
          note: e.latestCctvNote || '',
        });
      }
    }
  }

  return {
    employees,
    presentEmps,
    onBreakEmps,
    checkedOutEmps,
    offEmps,
    absentEmps,
    mismatches: Array.from(mismatchMap.values()),
  };
}

function buildAttendanceBodyLines(data = {}) {
  const defaultMaxBreak = Number(data?.settings?.max_break_minutes || 30);
  const {
    employees,
    presentEmps,
    onBreakEmps,
    checkedOutEmps,
    offEmps,
    absentEmps,
    mismatches,
  } = buildNormalizedAttendanceData(data);

  const lateCount = employees.filter((e) => Number(e.lateMinutes || 0) > 0).length;
  const lines = [
    `📊 *ملخص الحضور الآن:*`,
    `• حاضرون: ${presentEmps.length} | في استراحة: ${onBreakEmps.length} | انصراف: ${checkedOutEmps.length}`,
    `• إجازة اليوم: ${offEmps.length} | لم يحضر بعد: ${absentEmps.length} | حالات تأخير: ${lateCount}`,
  ];
  if (mismatches.length > 0) {
    lines.push(`• ⚠️ تنبيهات تعارض الكاميرا: ${mismatches.length}`);
  }

  // 1) Present employees grouped by department
  lines.push(``);
  lines.push(`✅ *الحاضرون الآن (${presentEmps.length}) — حسب القسم/المكان:*`);
  if (presentEmps.length === 0) {
    lines.push(`• لا يوجد موظفون حاضرون الآن.`);
  } else {
    const byDept = new Map();
    for (const emp of presentEmps) {
      const dept = emp.department || 'أقسام أخرى';
      if (!byDept.has(dept)) byDept.set(dept, []);
      byDept.get(dept).push(emp);
    }
    for (const [dept, deptEmps] of byDept.entries()) {
      lines.push(`📍 *${dept}:*`);
      for (const emp of deptEmps) {
        const shiftStr = `${emp.shift_start || '08:00'}-${emp.shift_end || '20:00'}`;
        const inStr = emp.checkInTime ? formatTimeArabic(emp.checkInTime) : '—';
        const lateStr = Number(emp.lateMinutes) > 0 ? ` • تأخير ${emp.lateMinutes} د` : '';
        const recStr = emp.latestRecordedBy ? ` • سجله: ${emp.latestRecordedBy}` : '';
        const offBonus = emp.workedOnDayOff ? ' ⭐ (حضر يوم إجازته)' : '';
        const cctvStr = formatCctvStatusArabic(emp);
        lines.push(
          `• *${emp.name}* — حضر ${inStr} (شفت ${shiftStr})${lateStr}${recStr}${offBonus} • ${cctvStr}`
        );
      }
    }
  }

  // 2) Currently on break
  if (onBreakEmps.length > 0) {
    lines.push(``);
    lines.push(`☕ *في استراحة حالياً (${onBreakEmps.length}):*`);
    for (const emp of onBreakEmps) {
      const breakStart = emp.activeBreakStart || emp.latestActionTime;
      const elapsed = breakStart
        ? Math.max(0, Math.floor((Date.now() - new Date(breakStart).getTime()) / 60000))
        : 0;
      const allowed = Number(emp.allowedBreakMinutes || defaultMaxBreak);
      const overFlag = elapsed > allowed ? ' ⚠️ متأخر' : '';
      const cctvStr = formatCctvStatusArabic(emp);
      lines.push(
        `• *${emp.name}* (${emp.department || '—'}) — بدأ ${formatTimeArabic(breakStart)} (${elapsed}/${allowed} د${overFlag})${emp.breakReason ? ` • ${emp.breakReason}` : ''} • ${cctvStr}`
      );
    }
  }

  // 3) Checked out
  if (checkedOutEmps.length > 0) {
    lines.push(``);
    lines.push(`🏠 *تم الانصراف (${checkedOutEmps.length}):*`);
    for (const emp of checkedOutEmps) {
      const inStr = emp.checkInTime ? formatTimeArabic(emp.checkInTime) : '—';
      const outStr = emp.checkOutTime
        ? formatTimeArabic(emp.checkOutTime)
        : formatTimeArabic(emp.latestActionTime);
      const lateStr = Number(emp.lateMinutes) > 0 ? ` • تأخير ${emp.lateMinutes} د` : '';
      const cctvStr = formatCctvStatusArabic(emp);
      lines.push(
        `• *${emp.name}* (${emp.department || '—'}) — ${inStr} ← ${outStr}${lateStr} • ${cctvStr}`
      );
    }
  }

  // 4) Scheduled day off today
  if (offEmps.length > 0) {
    lines.push(``);
    lines.push(`🏖️ *إجازة أسبوعية اليوم (${offEmps.length}):*`);
    for (const emp of offEmps) {
      lines.push(`• *${emp.name}* (${emp.department || '—'})`);
    }
  }

  // 5) Absent / Not arrived yet
  if (absentEmps.length > 0) {
    lines.push(``);
    lines.push(`❌ *لم يحضر بعد (${absentEmps.length}):*`);
    for (const emp of absentEmps) {
      lines.push(
        `• *${emp.name}* (${emp.department || '—'}) — بداية الشفت ${emp.shift_start || '08:00'}`
      );
    }
  }

  // 6) Prominent CCTV mismatch alerts
  if (mismatches.length > 0) {
    lines.push(``);
    lines.push(`⚠️ *تنبيهات تعارض الكاميرا (${mismatches.length}):*`);
    for (const m of mismatches) {
      const obsStr = m.observed ? ` • رُصد ${formatObservedTimeArabic(m.observed)}` : '';
      const verStr = m.verifier ? ` • مراجع: ${m.verifier}` : '';
      const noteStr = m.note ? ` — ${m.note}` : '';
      lines.push(
        `• *${m.name}* (${m.department}) — ${m.action} ${formatTimeArabic(m.time)}${obsStr}${verStr}${noteStr}`
      );
    }
  }

  return lines;
}

export function buildAttendanceWhatsAppText(data = {}) {
  const store = data?.settings?.store_name || 'زايد مارت';
  const branch = data?.settings?.branch_name || 'الفرع الرئيسي';
  const dateKey = data?.dateKey || new Date().toISOString().slice(0, 10);
  const dayName = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))
    ? getScheduleWeekdayLabel(getWeekdayCodeFromDateKey(dateKey))
    : '';
  const reportTime = formatTimeArabic(new Date().toISOString());

  const lines = [
    `📋 *تقرير الحضور والانصراف — ${store}*`,
    `📍 *فين (الفرع):* ${branch}`,
    `📅 *التاريخ:* ${dayName ? `${dayName} ` : ''}${dateKey} | 🕒 وقت التقرير: ${reportTime}`,
    `━━━━━━━━━━━━━━━━━━`,
    ...buildAttendanceBodyLines(data),
  ];

  return lines.join('\n');
}

export function buildWhatsAppSummaryText(data = {}) {
  const s = data?.summary || {};
  const store = data?.settings?.store_name || 'زايد مارت';
  const branch = data?.settings?.branch_name || 'الفرع الرئيسي';
  const dateKey = data?.dateKey || new Date().toISOString().slice(0, 10);
  const dayName = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))
    ? getScheduleWeekdayLabel(getWeekdayCodeFromDateKey(dateKey))
    : '';
  const reportTime = formatTimeArabic(new Date().toISOString());

  const lines = [
    `📊 *التقرير اليومي الشامل - ${store}${branch ? ` (${branch})` : ''}*`,
    `📍 *فين (الفرع):* ${branch}`,
    `📅 *التاريخ:* ${dayName ? `${dayName} ` : ''}${dateKey} | 🕒 وقت التقرير: ${reportTime}`,
    `━━━━━━━━━━━━━━━━━━`,
    ...buildAttendanceBodyLines(data),
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    `🛒 *نواقص الصالة ومقترحات الكاشيرية:*`,
    `• نواقص مطلوبة الآن: ${s.openShortagesCount || 0} | تم طلبها: ${s.orderedShortagesCount || 0}`,
    `• تم توفيرها اليوم: ${s.resolvedShortagesTodayCount ?? s.resolvedTodayShortagesCount ?? 0}`,
  ];

  const openShortages = (data?.shortages || []).filter((sh) => sh.status === 'open');
  if (openShortages.length > 0) {
    lines.push(`📌 *أبرز النواقص والمقترحات الحالية:*`);
    openShortages.slice(0, 6).forEach((sh) => {
      const icon = sh.is_suggestion ? '💡' : sh.urgency === 'out_of_stock' ? '🔴' : '🟡';
      lines.push(
        `  ${icon} ${sh.item_name} (${formatQtyForExport(sh.requested_qty, sh.unit)}) — ${sh.recorded_by}`
      );
    });
  }

  lines.push(
    ``,
    `🚛 *عربيات الموردين والطلبيات:*`,
    `• تم استلامها اليوم: ${s.completedTrucksCount || 0} عربية`,
    `• قيد التنزيل حالياً: ${s.unloadingTrucksCount || 0} عربية`,
    `• طلبيات بها نواقص أو مرتجع: ${s.issuesTrucksCount || 0}`
  );

  const issueTrucks = (data?.truckLogs || []).filter(
    (t) => t.delivery_condition === 'shortage' || t.delivery_condition === 'return_damaged'
  );
  if (issueTrucks.length > 0) {
    lines.push(`⚠️ *تفاصيل ملاحظات الموردين:*`);
    issueTrucks.slice(0, 5).forEach((t) => {
      lines.push(
        `  - ${t.supplier_name}: ${DELIVERY_LABELS[t.delivery_condition]}${t.notes ? ` (${t.notes})` : ''}`
      );
    });
  }

  const importantNotes = (data?.notes || []).filter(
    (n) => n.severity === 'urgent' || n.severity === 'warning' || n.is_open_handover
  );
  lines.push(``);
  lines.push(`🛡️ *ملاحظات الكاشيرية والأمن والكاميرات (${(data?.notes || []).length}):*`);
  if (importantNotes.length === 0) {
    lines.push(`• لا توجد ملاحظات طارئة مسجلة اليوم ✅`);
  } else {
    importantNotes.slice(0, 6).forEach((n) => {
      const icon = n.severity === 'urgent' ? '🔴' : '🟡';
      lines.push(`  ${icon} [${n.dvr_timestamp}] ${n.location_tag}: ${n.content} (${n.recorded_by})`);
    });
  }

  return lines.join('\n');
}

// ─── Master Audit Logs Export (Excel .xlsx / Word / WhatsApp) ───

export async function exportAuditLogsExcel(logs = []) {
  try {
    const mod = await import('./excelExport.js');
    return await mod.exportAuditLogsXlsx(logs, triggerBlobDownloadOrAndroidShare);
  } catch {
    exportAuditLogsCsvFallback(logs);
    return null;
  }
}

export async function exportAuditLogsCsv(logs = []) {
  return exportAuditLogsExcel(logs);
}

export function exportAuditLogsWord(logs = []) {
  const rows = logs.map((l) => [
    l.timestamp ? new Date(l.timestamp).toLocaleString('ar-EG') : '—',
    l.actor_name || l.user_name || '—',
    l.actor_role || l.role || '—',
    l.action || '—',
    l.target_label || l.target_type || '—',
    l.details || '—',
  ]);

  downloadWordDoc(
    `السجل_الأمني_الشامل_زايد_مارت_${new Date().toISOString().slice(0, 10)}.doc`,
    'السجل الرقابي والأمني الشامل — زايد مارت',
    `إجمالي الحركات المسجلة: ${rows.length} حركة`,
    [
      {
        title: 'سجل جميع العمليات والحركات في النظام',
        headers: ['التوقيت', 'المستخدم', 'الدور', 'العملية', 'الهدف', 'التفاصيل'],
        rows,
      },
    ]
  );
}

export function buildAuditLogsWhatsAppText(logs = []) {
  const top = logs.slice(0, 25);
  const lines = [
    `🔐 *السجل الرقابي الشامل — زايد مارت*`,
    `📅 عدد الحركات: ${logs.length} (أحدث ${top.length} حركة)`,
    `━━━━━━━━━━━━━━━━━━`,
  ];
  for (const l of top) {
    const t = formatTimeArabic(l.timestamp);
    lines.push(
      `• [${t}] *${l.actor_name || l.user_name || '—'}* (${l.action}): ${l.target_label || ''} ${l.details ? `— ${l.details}` : ''}`
    );
  }
  return lines.join('\n');
}

// ─── Individual Person Log Export (Excel .xlsx / Word / WhatsApp) ───

export async function exportPersonLogExcel(personData) {
  if (!personData) return null;
  try {
    const mod = await import('./excelExport.js');
    return await mod.exportPersonLogXlsx(personData, triggerBlobDownloadOrAndroidShare);
  } catch {
    exportPersonLogCsvFallback(personData);
    return null;
  }
}

export async function exportPersonLogCsv(personData) {
  return exportPersonLogExcel(personData);
}

export function exportPersonLogWord(personData) {
  if (!personData) return;
  const p = personData.person || {};
  const st = getNormalizedPersonStats(personData);
  const shiftStart = p.shift_start || '08:00';
  const shiftEnd = p.shift_end || '20:00';
  const shiftDurLabel = formatShiftDurationArabicClient(
    computeShiftDurationHoursClient(shiftStart, shiftEnd)
  );

  const attRows = (personData.attendanceLogs || []).map((a) => [
    a.date_key || '—',
    formatTimeArabic(a.timestamp),
    ACTION_LABELS[a.action_type] || a.action_type,
    a.shift_date_key || a.date_key || '—',
    a.late_minutes > 0 ? `تأخير ${a.late_minutes} د` : 'منتظم',
    a.break_duration_minutes > 0
      ? `استغرقت ${a.break_duration_minutes} د`
      : a.allowed_break_minutes > 0
        ? `مسموح ${a.allowed_break_minutes} د`
        : '—',
    formatCctvStatusArabic(a),
    a.recorded_by || '—',
    a.note || a.break_reason || '—',
  ]);

  const shRows = (personData.shortages || []).map((s) => [
    s.date_key || '—',
    s.is_suggestion ? '💡 اقتراح صنف' : '🛒 صنف ناقص',
    s.item_name,
    s.category || '—',
    formatQtyForExport(s.requested_qty, s.unit),
    SHORTAGE_STATUS_LABELS[s.status] || s.status,
    s.notes || '—',
  ]);

  const noteRows = (personData.notes || []).map((n) => [
    n.date_key || '—',
    n.dvr_timestamp || formatTimeArabic(n.timestamp),
    n.location_tag || '—',
    n.category_tag || '—',
    n.content || '—',
  ]);

  const auditRows = (personData.auditLogs || []).map((al) => [
    al.timestamp ? new Date(al.timestamp).toLocaleString('ar-EG') : '—',
    al.action || '—',
    al.target_label || al.target_type || '—',
    al.details || '—',
  ]);

  downloadWordDoc(
    `سجل_${(p.name || 'موظف').replace(/\s+/g, '_')}.doc`,
    `السجل الفردي الكامل — ${p.name || ''}`,
    `القسم: ${p.department || '—'} | الشفت (${shiftDurLabel}): ${shiftStart} -> ${shiftEnd} | حضور: ${st.totalCheckIns} | انصراف: ${st.totalCheckOuts} | إجمالي الاستراحات: ${st.totalBreakMinutes} دقيقة`,
    [
      {
        title: `1) سجل الحضور والانصراف والاستراحات (${attRows.length})`,
        headers: ['التاريخ', 'الوقت', 'الحركة', 'تاريخ الشفت', 'الانتظام', 'الاستراحة', 'الكاميرا', 'بواسطة', 'ملاحظات'],
        rows: attRows,
      },
      {
        title: `2) النواقص والمقترحات المسجلة (${shRows.length})`,
        headers: ['التاريخ', 'النوع', 'الصنف', 'القسم', 'الكمية', 'الحالة', 'ملاحظات'],
        rows: shRows,
      },
      {
        title: `3) الملاحظات والبلاغات (${noteRows.length})`,
        headers: ['التاريخ', 'الوقت', 'المكان', 'التصنيف', 'التفاصيل'],
        rows: noteRows,
      },
      {
        title: `4) سجل حركات النظام الرقابي (${auditRows.length})`,
        headers: ['التوقيت', 'العملية', 'الهدف', 'التفاصيل'],
        rows: auditRows,
      },
    ]
  );
}

export function buildPersonLogWhatsAppText(personData) {
  if (!personData) return '';
  const p = personData.person || {};
  const st = getNormalizedPersonStats(personData);
  const shiftStart = p.shift_start || '08:00';
  const shiftEnd = p.shift_end || '20:00';
  const shiftDurLabel = formatShiftDurationArabicClient(
    computeShiftDurationHoursClient(shiftStart, shiftEnd)
  );

  const lines = [
    `👤 *السجل الفردي الكامل — ${p.name || ''}*`,
    `🏷️ القسم: ${p.department || '—'} | الوظيفة: ${p.role_title || p.role_label || '—'}`,
    `⏰ الشفت (${shiftDurLabel}): ${shiftStart} -> ${shiftEnd}`,
    `━━━━━━━━━━━━━━━━━━`,
    `📊 *ملخص الأداء والحضور:*`,
    `• مرات الحضور: ${st.totalCheckIns} | مرات الانصراف: ${st.totalCheckOuts}`,
    `• الاستراحات: ${st.totalBreaks} (${st.totalBreakMinutes} دقيقة)`,
    `• إجمالي دقائق التأخير: ${st.totalLateMinutes} دقيقة`,
    `• النواقص والمقترحات المسجلة: ${st.shortagesReported} (${st.suggestionsReported} مقترح)`,
    `• الملاحظات المسجلة: ${st.notesRecorded}`,
  ];

  const recentAtt = (personData.attendanceLogs || []).slice(0, 8);
  if (recentAtt.length > 0) {
    lines.push(`\n🕒 *آخر حركات الحضور والانصراف:*`);
    for (const a of recentAtt) {
      const breakSuffix =
        a.break_duration_minutes > 0 ? ` (${a.break_duration_minutes} د)` : '';
      const lateSuffix = a.late_minutes > 0 ? ` • تأخير ${a.late_minutes} د` : '';
      const cctvSuffix = ` • ${formatCctvStatusArabic(a)}`;
      lines.push(
        `• [${a.date_key} ${formatTimeArabic(a.timestamp)}] ${ACTION_LABELS[a.action_type] || a.action_type}${breakSuffix}${lateSuffix}${cctvSuffix}`
      );
    }
  }

  return lines.join('\n');
}

// ─── Weekly Day-Off & Shift Schedule Exports (WhatsApp / Word / Excel .xlsx) ───

export function formatWeeklyScheduleWhatsApp(scheduleData, storeName = 'زايد مارت') {
  if (!scheduleData) return '';
  const weekStart = scheduleData.weekStartDate || '';
  const weekDates = scheduleData.weekDates || {};
  const groups = scheduleData.groups || [];
  const startStr = weekDates.sat || weekStart;
  const endStr = weekDates.fri || '';

  const lines = [
    `📅 *جدول الإجازات والشفتات الأسبوعي — ${storeName}*`,
    `🗓️ الأسبوع: ${startStr}${endStr ? ` ← ${endStr}` : ''}`,
    `━━━━━━━━━━━━━━━━━━`,
  ];

  for (const group of groups) {
    const emps = group.employees || [];
    lines.push(`\n👥 *${group.label}* (${emps.length} موظف):`);

    // Group shift slots overview
    const shiftBuckets = new Map();
    for (const emp of emps) {
      const slot = `${emp.shift_start || '08:00'}-${emp.shift_end || '20:00'}`;
      shiftBuckets.set(slot, (shiftBuckets.get(slot) || 0) + 1);
    }
    if (shiftBuckets.size > 0) {
      const slotsText = Array.from(shiftBuckets.entries())
        .map(([slot, count]) => `${slot} (${count})`)
        .join(' | ');
      lines.push(`⏰ *مواعيد الشفتات:* ${slotsText}`);
    }

    for (const day of SCHEDULE_WEEKDAYS) {
      const offEmps = emps.filter((e) => e.effective_day_of_week === day.code);
      const cov = group.coverageByDay?.[day.code];
      const shortDate = (weekDates[day.code] || '').slice(5);
      const names =
        offEmps.length > 0
          ? offEmps
              .map(
                (e) =>
                  `${e.name} (${e.shift_start || '08:00'}-${e.shift_end || '20:00'})${
                    e.is_override ? ' [معدل]' : ''
                  }`
              )
              .join('، ')
          : 'الجميع دوام';
      const covSuffix = cov ? ` — متواجد: ${cov.onDutyCount}${cov.lowCoverage ? ' ⚠️' : ''}` : '';
      lines.push(`• *${day.label}*${shortDate ? ` (${shortDate})` : ''}: ${names}${covSuffix}`);
    }
    const unassigned = emps.filter((e) => !e.effective_day_of_week);
    if (unassigned.length > 0) {
      lines.push(
        `⚠️ بدون يوم محدد: ${unassigned
          .map((e) => `${e.name} (${e.shift_start || '08:00'}-${e.shift_end || '20:00'})`)
          .join('، ')}`
      );
    }
  }

  return lines.join('\n');
}

export function exportWeeklyScheduleToWord(scheduleData, storeName = 'زايد مارت') {
  if (!scheduleData) return;
  const weekStart = scheduleData.weekStartDate || 'week';
  const weekDates = scheduleData.weekDates || {};
  const groups = scheduleData.groups || [];
  const startStr = weekDates.sat || weekStart;
  const endStr = weekDates.fri || '';

  const dayHeaders = SCHEDULE_WEEKDAYS.map((d) => {
    const shortDate = (weekDates[d.code] || '').slice(5);
    return shortDate ? `${d.label} (${shortDate})` : d.label;
  });

  const sections = groups.map((group) => {
    const emps = group.employees || [];
    const rows = emps.map((emp) => [
      emp.name || '—',
      `${emp.shift_start || '08:00'} -> ${emp.shift_end || '20:00'}`,
      emp.effective_day_of_week
        ? `${getScheduleWeekdayLabel(emp.effective_day_of_week)}${emp.is_override ? ' (معدل)' : ''}`
        : 'غير محدد',
      ...SCHEDULE_WEEKDAYS.map((d) => (emp.effective_day_of_week === d.code ? 'إجازة' : 'دوام')),
    ]);

    const minReq = group.coverageByDay?.sat?.minRequired;
    rows.push([
      'ملخص التغطية اليومية',
      '—',
      minReq !== undefined ? `الحد الأدنى: ${minReq}` : '—',
      ...SCHEDULE_WEEKDAYS.map((d) => {
        const cov = group.coverageByDay?.[d.code];
        if (!cov) return '—';
        return `إجازة ${cov.offCount} / دوام ${cov.onDutyCount}${cov.lowCoverage ? ' (منخفضة)' : ''}`;
      }),
    ]);

    return {
      title: `${group.label} (${emps.length} موظف)`,
      headers: ['الموظف', 'الشفت', 'يوم الإجازة', ...dayHeaders],
      rows,
    };
  });

  downloadWordDoc(
    `جدول_الإجازات_${weekStart}.doc`,
    `جدول الإجازات الأسبوعي — ${storeName}`,
    `الأسبوع من ${startStr}${endStr ? ` إلى ${endStr}` : ''}`,
    sections
  );
}

export async function exportWeeklyScheduleToExcel(scheduleData, storeName = 'زايد مارت') {
  if (!scheduleData) return null;
  try {
    const mod = await import('./excelExport.js');
    return await mod.exportWeeklyScheduleXlsx(
      scheduleData,
      storeName,
      triggerBlobDownloadOrAndroidShare
    );
  } catch {
    exportWeeklyScheduleCsvFallback(scheduleData);
    return null;
  }
}

export async function exportWeeklyScheduleToCsv(scheduleData, storeName = 'زايد مارت') {
  return exportWeeklyScheduleToExcel(scheduleData, storeName);
}
