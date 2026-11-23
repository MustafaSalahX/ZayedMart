import {
  getScheduleWeekdayLabel,
  getWeekdayCodeFromDateKey,
  SCHEDULE_WEEKDAYS,
} from '@zayed-mart/shared';
import {
  computeShiftDurationHoursClient,
  formatShiftDurationArabicClient,
} from './api.js';
import {
  ACTION_LABELS,
  formatCctvStatusArabic,
  formatQtyForExport,
  formatTimeArabic,
  formatTimeWithSeconds,
  getCctvStatusType,
  triggerBlobDownloadOrAndroidShare,
} from './exportUtils.js';

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const THIN_BORDER_COLOR = { argb: 'FFCBD5E1' };
const THIN_BORDER = {
  top: { style: 'thin', color: THIN_BORDER_COLOR },
  left: { style: 'thin', color: THIN_BORDER_COLOR },
  bottom: { style: 'thin', color: THIN_BORDER_COLOR },
  right: { style: 'thin', color: THIN_BORDER_COLOR },
};

const SUMMARY_BORDER = {
  top: { style: 'medium', color: { argb: 'FF0B57D0' } },
  left: { style: 'thin', color: THIN_BORDER_COLOR },
  bottom: { style: 'thin', color: THIN_BORDER_COLOR },
  right: { style: 'thin', color: THIN_BORDER_COLOR },
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

const EMPLOYEE_STATUS_LABELS = {
  present: 'حاضر الآن',
  on_break: 'في استراحة',
  checked_out: 'منصرف',
  absent: 'لم يحضر بعد',
};

async function loadExcelJS() {
  const ExcelJS = (await import('exceljs')).default || (await import('exceljs'));
  if (ExcelJS?.Workbook) return ExcelJS;
  if (ExcelJS?.default?.Workbook) return ExcelJS.default;
  throw new Error('تعذر تحميل مكتبة تصدير Excel');
}

export function sanitizeSheetName(rawName, usedNames = new Set()) {
  const cleaned = String(rawName || 'تقرير')
    .replace(/[:\\/?*[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const base = (cleaned || 'تقرير').slice(0, 31).trim() || 'تقرير';
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  let counter = 2;
  while (counter < 100) {
    const suffix = ` (${counter})`;
    const candidate = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    counter += 1;
  }
  return base;
}

function sanitizeCell(val) {
  if (val === undefined || val === null) return '';
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 0;
  }
  if (typeof val === 'boolean') {
    return val ? 'نعم' : 'لا';
  }
  return String(val);
}

function measureVisualWidth(val) {
  const str = sanitizeCell(val);
  if (!str) return 0;
  const lines = String(str).split(/\r?\n/);
  let maxLen = 0;
  for (const line of lines) {
    let score = 0;
    for (const ch of line) {
      const code = ch.codePointAt(0) || 0;
      if (
        (code >= 0x0600 && code <= 0x06ff) ||
        (code >= 0x0750 && code <= 0x077f) ||
        (code >= 0x08a0 && code <= 0x08ff) ||
        (code >= 0xfb50 && code <= 0xfdff) ||
        (code >= 0xfe70 && code <= 0xfeff)
      ) {
        score += 1.25;
      } else if (code > 0x2000) {
        score += 1.7;
      } else {
        score += 1.0;
      }
    }
    if (score > maxLen) maxLen = score;
  }
  return maxLen;
}

function resolveStatusStyle(rawVal) {
  const text = String(rawVal || '').trim();
  if (!text) return null;

  // Guard explicit positive phrasing before negative keyword checks
  if (text.includes('سليمة') || text.includes('لا يوجد نواقص')) {
    return { bg: 'FFE6F4EA', fg: 'FF146C2E' };
  }

  const redKeywords = [
    'تعارض',
    'لم يحضر',
    'غائب',
    'نافذ',
    'طارئ',
    'مرتجع',
    'تالف',
    'نواقص',
    'مطلوب توفيره',
    'مطلوب الآن',
  ];
  if (redKeywords.some((kw) => text.includes(kw))) {
    return { bg: 'FFFCE8E6', fg: 'FFB3261E' };
  }

  const amberKeywords = [
    'بريك',
    'استراحة',
    'تأخير',
    'بانتظار',
    'قيد التنزيل',
    'جاري التنزيل',
    'تم الطلب',
    'متابعة',
    'منخفضة',
    'مفتوحة',
  ];
  if (amberKeywords.some((kw) => text.includes(kw))) {
    return { bg: 'FFFEF7E0', fg: 'FFB06000' };
  }

  const blueKeywords = ['إجازة', 'منصرف', 'انصرف', 'معدل'];
  if (blueKeywords.some((kw) => text.includes(kw))) {
    return { bg: 'FFE8F0FE', fg: 'FF0B57D0' };
  }

  const greenKeywords = [
    'حاضر',
    'مؤكد بالكاميرا',
    'تمت المطابقة',
    'تم التوفير',
    'سليمة',
    'منتظم',
    'دوام',
    'عمل',
    'مكتمل',
    'متواجد',
    'تم الاطلاع',
    'مغلق',
  ];
  if (greenKeywords.some((kw) => text.includes(kw))) {
    return { bg: 'FFE6F4EA', fg: 'FF146C2E' };
  }

  return null;
}

export function buildStyledWorksheet(
  workbook,
  {
    name,
    title,
    subtitle,
    headers = [],
    rows = [],
    statusColIndexes,
    summaryRow,
    usedNames,
  }
) {
  const safeName = sanitizeSheetName(name, usedNames);
  const colCount = Math.max(
    headers.length,
    ...rows.map((r) => (Array.isArray(r) ? r.length : 0)),
    Array.isArray(summaryRow) ? summaryRow.length : 0,
    1
  );

  const normalizedHeaders = Array.from({ length: colCount }, (_, i) =>
    sanitizeCell(headers[i] ?? `عمود ${i + 1}`)
  );

  const ws = workbook.addWorksheet(safeName, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }],
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  // Row 1: Branded Title Banner
  const titleRow = ws.getRow(1);
  titleRow.height = 30;
  ws.getCell(1, 1).value = sanitizeCell(title || safeName);
  if (colCount > 1) {
    ws.mergeCells(1, 1, 1, colCount);
  }
  for (let c = 1; c <= colCount; c += 1) {
    const cell = ws.getCell(1, c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    cell.font = { name: 'Cairo', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  }

  // Row 2: Branded Subtitle Strip
  const subRow = ws.getRow(2);
  subRow.height = 22;
  ws.getCell(2, 1).value = sanitizeCell(
    subtitle || `تاريخ الاستخراج: ${new Date().toLocaleString('ar-EG')}`
  );
  if (colCount > 1) {
    ws.mergeCells(2, 1, 2, colCount);
  }
  for (let c = 1; c <= colCount; c += 1) {
    const cell = ws.getCell(2, c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
    cell.font = { name: 'Cairo', size: 10.5, bold: true, color: { argb: 'FF1E3A8A' } };
    cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  }

  // Row 3: Spacer
  ws.getRow(3).height = 8;

  // Row 4: Column Headers
  const headerRow = ws.getRow(4);
  headerRow.height = 26;
  for (let c = 0; c < colCount; c += 1) {
    const cell = headerRow.getCell(c + 1);
    cell.value = normalizedHeaders[c];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B57D0' } };
    cell.font = { name: 'Cairo', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  }

  const effectiveRows =
    rows.length > 0
      ? rows
      : [['لا توجد سجلات مسجلة في هذا القسم', ...Array(Math.max(0, colCount - 1)).fill('')]];

  const statusSet = Array.isArray(statusColIndexes) ? new Set(statusColIndexes) : null;

  effectiveRows.forEach((rawRow, rIdx) => {
    const rowNumber = 5 + rIdx;
    const row = ws.getRow(rowNumber);
    const baseBg = rIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    let maxLines = 1;

    for (let c = 0; c < colCount; c += 1) {
      const val = sanitizeCell(Array.isArray(rawRow) ? rawRow[c] : '');
      const cell = row.getCell(c + 1);
      cell.value = val;
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };

      const lineCount = String(val).split(/\r?\n/).length;
      if (lineCount > maxLines) maxLines = lineCount;

      const shouldCheckStatus =
        rows.length > 0 &&
        (statusSet ? statusSet.has(c) : String(val).length > 0 && String(val).length <= 48);
      const statusStyle = shouldCheckStatus ? resolveStatusStyle(val) : null;

      if (statusStyle) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: statusStyle.bg },
        };
        cell.font = {
          name: 'Cairo',
          size: 10.5,
          bold: true,
          color: { argb: statusStyle.fg },
        };
      } else {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: baseBg },
        };
        cell.font = {
          name: 'Cairo',
          size: 10.5,
          bold: false,
          color: { argb: rows.length === 0 && c === 0 ? 'FF64748B' : 'FF0F172A' },
        };
      }
    }

    row.height = Math.min(96, Math.max(22, maxLines * 17 + 6));
  });

  ws.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4 + effectiveRows.length, column: colCount },
  };

  if (Array.isArray(summaryRow) && summaryRow.length > 0) {
    const sumRowNumber = 5 + effectiveRows.length;
    const sRow = ws.getRow(sumRowNumber);
    sRow.height = 24;
    for (let c = 0; c < colCount; c += 1) {
      const cell = sRow.getCell(c + 1);
      cell.value = sanitizeCell(summaryRow[c] ?? '');
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
      cell.font = { name: 'Cairo', size: 10.5, bold: true, color: { argb: 'FF1E3A8A' } };
      cell.border = SUMMARY_BORDER;
      cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    }
  }

  // Auto-calculate column widths with 1.25x Arabic multiplier (min 12, max 46)
  for (let c = 0; c < colCount; c += 1) {
    let maxW = measureVisualWidth(normalizedHeaders[c]);
    for (const r of effectiveRows) {
      const w = measureVisualWidth(Array.isArray(r) ? r[c] : '');
      if (w > maxW) maxW = w;
    }
    if (Array.isArray(summaryRow)) {
      const sw = measureVisualWidth(summaryRow[c]);
      if (sw > maxW) maxW = sw;
    }
    const clamped = Math.max(12, Math.min(46, Math.ceil(maxW) + 4));
    ws.getColumn(c + 1).width = clamped;
  }

  return ws;
}

async function finalizeAndDownloadWorkbook(workbook, filename, triggerDownload) {
  const safeFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME });
  const deliver =
    typeof triggerDownload === 'function' ? triggerDownload : triggerBlobDownloadOrAndroidShare;
  deliver(blob, safeFilename, XLSX_MIME);
  return { buffer, blob, filename: safeFilename };
}

function getArabicDayTitle(dateKey) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))) return '';
  return getScheduleWeekdayLabel(getWeekdayCodeFromDateKey(dateKey));
}

function buildEmployeeStatusLabel(emp) {
  if (emp?.isScheduledOff && !emp?.workedOnDayOff && emp?.currentStatus === 'absent') {
    return 'إجازة أسبوعية';
  }
  if (emp?.workedOnDayOff) {
    return `${EMPLOYEE_STATUS_LABELS[emp.currentStatus] || 'حاضر'} (حضر يوم إجازته)`;
  }
  return EMPLOYEE_STATUS_LABELS[emp?.currentStatus] || 'لم يحضر بعد';
}

function buildEmployeeRowsForSheet(data = {}) {
  const branchName = data?.settings?.branch_name || 'الفرع الرئيسي';
  const employees = Array.isArray(data?.employees) ? data.employees : [];
  const logs = Array.isArray(data?.attendanceLogs) ? data.attendanceLogs : [];

  // Map latest log per employee as fallback if employee snapshot lacks log fields
  const latestLogByEmp = new Map();
  const firstInByEmp = new Map();
  const checkOutByEmp = new Map();
  for (const log of logs) {
    if (!log?.employee_id) continue;
    if (!latestLogByEmp.has(log.employee_id)) {
      latestLogByEmp.set(log.employee_id, log);
    }
    if (log.action_type === 'check_in') {
      firstInByEmp.set(log.employee_id, log);
    }
    if (log.action_type === 'check_out' && !checkOutByEmp.has(log.employee_id)) {
      checkOutByEmp.set(log.employee_id, log);
    }
  }

  return employees.map((emp) => {
    const latest = latestLogByEmp.get(emp.id);
    const firstIn = firstInByEmp.get(emp.id);
    const checkOut = checkOutByEmp.get(emp.id);
    const shiftStart = emp.shift_start || '08:00';
    const shiftEnd = emp.shift_end || '20:00';
    const hours =
      emp.shiftDurationHours || computeShiftDurationHoursClient(shiftStart, shiftEnd);
    const durLabel =
      emp.shiftDurationLabel || formatShiftDurationArabicClient(hours);
    const checkInTs = emp.checkInTime || firstIn?.timestamp || '';
    const checkOutTs = emp.checkOutTime || checkOut?.timestamp || '';
    const lateMins = Number(emp.lateMinutes ?? firstIn?.late_minutes ?? 0);
    const breaksCount = Number(emp.breaksCount ?? 0);
    const totalBreakMins = Number(emp.totalBreakMinutes ?? 0);
    const recordedBy = emp.latestRecordedBy || latest?.recorded_by || '—';
    const cctvTarget =
      emp.latestCctvStatus || emp.latestLogId
        ? emp
        : latest || (emp.currentStatus && emp.currentStatus !== 'absent' ? emp : null);
    const cctvStatusType = getCctvStatusType(cctvTarget);
    const cctvText =
      cctvStatusType === 'none'
        ? '—'
        : formatCctvStatusArabic(cctvTarget, { includeMeta: false });
    const verifier =
      emp.latestVerifiedBy || latest?.verified_by || (cctvStatusType === 'confirmed' ? 'تم التأكيد' : '—');
    const observedTime =
      emp.latestCctvObservedTime || latest?.cctv_observed_time || '—';

    return [
      emp.name || '—',
      emp.department || '—',
      branchName,
      `${shiftStart} ← ${shiftEnd}`,
      durLabel,
      buildEmployeeStatusLabel(emp),
      checkInTs ? formatTimeArabic(checkInTs) : '—',
      checkOutTs ? formatTimeArabic(checkOutTs) : '—',
      lateMins > 0 ? `تأخير ${lateMins} دقيقة` : checkInTs ? 'منتظم' : '—',
      breaksCount > 0 || totalBreakMins > 0
        ? `${breaksCount} (${totalBreakMins} د)`
        : '—',
      recordedBy,
      cctvText,
      verifier || '—',
      observedTime || '—',
    ];
  });
}

function buildAttendanceLogRowsForSheet(logs = []) {
  return (logs || []).map((log) => {
    const breakInfo =
      log.action_type === 'break_start' && Number(log.allowed_break_minutes) > 0
        ? `مسموح ${log.allowed_break_minutes} د`
        : Number(log.break_duration_minutes) > 0
          ? `استغرقت ${log.break_duration_minutes} د`
          : '—';
    const extendedShift =
      log.shift_date_key && log.shift_date_key !== log.date_key
        ? `[شفت ممتد من ${log.shift_date_key}] `
        : '';
    const extraNote = [log.cctv_note, log.break_reason, log.note]
      .filter(Boolean)
      .join(' • ');

    return [
      log.date_key || '—',
      log.shift_date_key || log.date_key || '—',
      formatTimeWithSeconds(log.timestamp),
      log.employee_name || '—',
      log.department || '—',
      ACTION_LABELS[log.action_type] || log.action_type || '—',
      Number(log.late_minutes) > 0 ? `تأخير ${log.late_minutes} دقيقة` : 'منتظم',
      breakInfo,
      log.recorded_by || '—',
      formatCctvStatusArabic(log, { includeMeta: false }),
      log.verified_by || '—',
      log.cctv_observed_time || '—',
      `${extendedShift}${extraNote || '—'}`,
    ];
  });
}

function buildShortageRowsForSheet(shortages = []) {
  return (shortages || []).map((sh) => [
    sh.date_key || '—',
    formatTimeArabic(sh.updated_at || sh.created_at),
    sh.is_suggestion ? 'اقتراح صنف جديد' : 'نقص صنف بالصالة',
    sh.item_name || '—',
    sh.category || '—',
    formatQtyForExport(sh.requested_qty, sh.unit),
    SHORTAGE_URGENCY_LABELS[sh.urgency] || sh.urgency || '—',
    SHORTAGE_STATUS_LABELS[sh.status] || sh.status || '—',
    sh.supplier_name || '—',
    sh.recorded_by || '—',
    sh.resolved_by || '—',
    sh.notes || '—',
  ]);
}

function buildTruckRowsForSheet(truckLogs = []) {
  return (truckLogs || []).map((t) => [
    t.date_key || (t.arrival_time ? String(t.arrival_time).slice(0, 10) : '—'),
    formatTimeArabic(t.arrival_time),
    t.departure_time ? formatTimeArabic(t.departure_time) : '—',
    t.supplier_name || '—',
    t.category || '—',
    t.status === 'unloading' ? 'قيد التنزيل' : 'مكتمل الاستلام',
    DELIVERY_LABELS[t.delivery_condition] || t.status || '—',
    t.duration_minutes ? `${t.duration_minutes} دقيقة` : 'قيد التنزيل',
    t.plate_or_driver || t.invoice_number || '—',
    t.recorded_by || '—',
    t.notes || '—',
  ]);
}

function buildNotesRowsForSheet(notes = []) {
  return (notes || []).map((n) => [
    n.date_key || '—',
    n.dvr_timestamp || formatTimeArabic(n.timestamp),
    n.location_tag || '—',
    n.category_tag || '—',
    SEVERITY_LABELS[n.severity] || n.severity || '—',
    n.is_open_handover ? 'مفتوحة للمتابعة' : 'تم الاطلاع',
    n.recorded_by || '—',
    n.resolved_by || '—',
    n.content || '—',
  ]);
}

export function resolvePersonStats(personData) {
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

// 1) Daily Comprehensive Report (.xlsx - 5 sheets)
export async function exportDailyReportXlsx(data = {}, triggerDownload) {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'زايد مارت';
  workbook.created = new Date();
  const usedNames = new Set();

  const dateKey = data.dateKey || new Date().toISOString().slice(0, 10);
  const dayLabel = getArabicDayTitle(dateKey);
  const storeName = data.settings?.store_name || 'زايد مارت';
  const branchName = data.settings?.branch_name || 'الفرع الرئيسي';
  const s = data.summary || {};

  const empRows = buildEmployeeRowsForSheet(data);
  const totalLateMins = (data.employees || []).reduce(
    (acc, e) => acc + Number(e.lateMinutes || 0),
    0
  );
  const totalBreakMins = (data.employees || []).reduce(
    (acc, e) => acc + Number(e.totalBreakMinutes || 0),
    0
  );

  const kpiSubtitle = [
    `التاريخ: ${dayLabel ? `${dayLabel} ` : ''}${dateKey}`,
    `الفرع: ${branchName}`,
    `حاضر: ${s.presentCount ?? 0}`,
    `استراحة: ${s.onBreakCount ?? 0}`,
    `انصراف: ${s.checkedOutCount ?? 0}`,
    `لم يحضر: ${s.absentCount ?? 0}`,
    `إجازة: ${s.scheduledOffCount ?? 0}`,
    `تأخير: ${s.lateCount ?? 0}`,
    `نواقص مفتوحة: ${s.openShortagesCount ?? 0}`,
    `عربيات مستلمة: ${s.completedTrucksCount ?? 0}`,
    `تعارض كاميرا: ${s.mismatchAttendanceCount ?? 0}`,
  ].join(' | ');

  const sheet1 = buildStyledWorksheet(workbook, {
    name: 'ملخص اليوم وحالة الموظفين',
    title: `التقرير اليومي الشامل — ${storeName} (${branchName})`,
    subtitle: kpiSubtitle,
    headers: [
      'الموظف',
      'القسم',
      'الفرع',
      'الشفت',
      'المدة',
      'الحالة الآن',
      'وقت الحضور',
      'وقت الانصراف',
      'التأخير / الانتظام',
      'الاستراحات',
      'المسجل بواسطة',
      'حالة الكاميرا',
      'مراجع الكاميرا',
      'وقت الرصد بالكاميرا',
    ],
    rows: empRows,
    statusColIndexes: [5, 8, 11],
    summaryRow: [
      `الإجمالي (${empRows.length} موظف)`,
      '—',
      branchName,
      '—',
      '—',
      `حاضر: ${s.presentCount ?? 0} | استراحة: ${s.onBreakCount ?? 0} | منصرف: ${s.checkedOutCount ?? 0}`,
      '—',
      '—',
      `إجمالي التأخير: ${totalLateMins} د`,
      `إجمالي الاستراحات: ${totalBreakMins} د`,
      '—',
      `بانتظار: ${s.unverifiedAttendanceCount ?? 0} | تعارض: ${s.mismatchAttendanceCount ?? 0}`,
      '—',
      '—',
    ],
    usedNames,
  });

  // Append compact KPI summary block below the employee table in Sheet 1
  const kpiStartRow = sheet1.rowCount + 2;
  const kpiHeaderRow = sheet1.getRow(kpiStartRow);
  kpiHeaderRow.height = 24;
  kpiHeaderRow.getCell(1).value = 'مؤشرات الأداء اليومية (KPIs)';
  kpiHeaderRow.getCell(2).value = 'القيمة';
  for (let c = 1; c <= 2; c += 1) {
    const cell = kpiHeaderRow.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    cell.font = { name: 'Cairo', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
  }
  const kpiPairs = [
    ['الحاضرون الآن', s.presentCount ?? 0],
    ['في استراحة حالياً', s.onBreakCount ?? 0],
    ['تم الانصراف', s.checkedOutCount ?? 0],
    ['لم يحضر بعد', s.absentCount ?? 0],
    ['إجازة أسبوعية اليوم', s.scheduledOffCount ?? 0],
    ['حالات التأخير', s.lateCount ?? 0],
    ['حركات بانتظار الكاميرا', s.unverifiedAttendanceCount ?? 0],
    ['تعارضات الكاميرا', s.mismatchAttendanceCount ?? 0],
    ['نواقص الصالة المطلوبة', s.openShortagesCount ?? 0],
    ['نواقص تم طلبها', s.orderedShortagesCount ?? 0],
    ['نواقص تم توفيرها اليوم', s.resolvedShortagesTodayCount ?? s.resolvedTodayShortagesCount ?? 0],
    ['عربيات قيد التنزيل / مستلمة', `${s.unloadingTrucksCount ?? 0} قيد التنزيل / ${s.completedTrucksCount ?? 0} مستلمة`],
    ['ملاحظات طارئة / مفتوحة للمتابعة', `${s.urgentNotesCount ?? 0} طارئة / ${s.openHandoverNotesCount ?? 0} متابعة`],
  ];
  kpiPairs.forEach(([label, val], idx) => {
    const r = sheet1.getRow(kpiStartRow + 1 + idx);
    r.height = 24;
    const c1 = r.getCell(1);
    const c2 = r.getCell(2);
    c1.value = label;
    c2.value = sanitizeCell(val);
    const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    [c1, c2].forEach((cell, colI) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.font = {
        name: 'Cairo',
        size: 10,
        bold: colI === 1,
        color: { argb: 'FF0F172A' },
      };
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    });
  });
  sheet1.getColumn(1).width = Math.min(46, Math.max(sheet1.getColumn(1).width || 12, 34));
  sheet1.getColumn(2).width = Math.min(46, Math.max(sheet1.getColumn(2).width || 12, 26));

  // Sheet 2: Attendance Logs
  const attRows = buildAttendanceLogRowsForSheet(data.attendanceLogs || []);
  buildStyledWorksheet(workbook, {
    name: 'سجل الحضور والانصراف',
    title: `سجل حركات الحضور والانصراف — ${storeName} (${branchName})`,
    subtitle: `التاريخ: ${dateKey} | إجمالي الحركات: ${attRows.length}`,
    headers: [
      'التاريخ',
      'تاريخ الشفت',
      'الوقت',
      'الموظف',
      'القسم',
      'الحركة',
      'التأخير / الانتظام',
      'الاستراحة',
      'المسجل بواسطة',
      'حالة الكاميرا',
      'مراجع الكاميرا',
      'وقت الرصد',
      'ملاحظات الكاميرا / التفاصيل',
    ],
    rows: attRows,
    statusColIndexes: [5, 6, 9],
    summaryRow: [
      'الإجمالي',
      '—',
      '—',
      `${attRows.length} حركة`,
      '—',
      '—',
      `تأخير: ${(data.attendanceLogs || []).filter((l) => Number(l.late_minutes) > 0).length}`,
      '—',
      '—',
      `مؤكد: ${(data.attendanceLogs || []).filter((l) => getCctvStatusType(l) === 'confirmed').length}`,
      '—',
      '—',
      '—',
    ],
    usedNames,
  });

  // Sheet 3: Shortages & Suggestions
  const shRows = buildShortageRowsForSheet(data.shortages || []);
  buildStyledWorksheet(workbook, {
    name: 'النواقص والمقترحات',
    title: `نواقص الصالة ومقترحات الكاشيرية — ${storeName}`,
    subtitle: `التاريخ: ${dateKey} | إجمالي الأصناف: ${shRows.length}`,
    headers: [
      'التاريخ',
      'الوقت',
      'النوع',
      'اسم الصنف',
      'القسم',
      'الكمية',
      'درجة الاستعجال',
      'الحالة',
      'المورد',
      'المسجل بواسطة',
      'تم التوفير بواسطة',
      'ملاحظات',
    ],
    rows: shRows,
    statusColIndexes: [6, 7],
    summaryRow: [
      'الإجمالي',
      '—',
      '—',
      `${shRows.length} صنف`,
      '—',
      '—',
      `نافذ: ${(data.shortages || []).filter((x) => x.urgency === 'out_of_stock').length}`,
      `مطلوب: ${s.openShortagesCount ?? 0} | تم التوفير: ${s.resolvedShortagesTodayCount ?? 0}`,
      '—',
      '—',
      '—',
      '—',
    ],
    usedNames,
  });

  // Sheet 4: Truck Logs
  const trkRows = buildTruckRowsForSheet(data.truckLogs || []);
  buildStyledWorksheet(workbook, {
    name: 'عربيات الموردين',
    title: `سجل عربيات الموردين والطلبيات — ${storeName}`,
    subtitle: `التاريخ: ${dateKey} | إجمالي العربيات: ${trkRows.length}`,
    headers: [
      'التاريخ',
      'وقت الوصول',
      'وقت المغادرة',
      'المورد',
      'التصنيف',
      'حالة العربية',
      'حالة الاستلام',
      'مدة التنزيل',
      'رقم السيارة / الفاتورة',
      'المسجل بواسطة',
      'ملاحظات',
    ],
    rows: trkRows,
    statusColIndexes: [5, 6],
    summaryRow: [
      'الإجمالي',
      '—',
      '—',
      `${trkRows.length} عربية`,
      '—',
      `قيد التنزيل: ${s.unloadingTrucksCount ?? 0}`,
      `نواقص/مرتجع: ${s.issuesTrucksCount ?? 0}`,
      '—',
      '—',
      '—',
      '—',
    ],
    usedNames,
  });

  // Sheet 5: Notes & CCTV
  const noteRows = buildNotesRowsForSheet(data.notes || []);
  buildStyledWorksheet(workbook, {
    name: 'الملاحظات والكاميرات',
    title: `ملاحظات الكاشيرية والأمن والكاميرات — ${storeName}`,
    subtitle: `التاريخ: ${dateKey} | إجمالي الملاحظات: ${noteRows.length}`,
    headers: [
      'التاريخ',
      'الوقت / DVR',
      'المكان',
      'التصنيف',
      'الأهمية',
      'حالة المتابعة',
      'المسجل بواسطة',
      'تم الحل بواسطة',
      'التفاصيل',
    ],
    rows: noteRows,
    statusColIndexes: [4, 5],
    summaryRow: [
      'الإجمالي',
      '—',
      '—',
      `${noteRows.length} ملاحظة`,
      `طارئ: ${s.urgentNotesCount ?? 0}`,
      `مفتوحة: ${s.openHandoverNotesCount ?? 0}`,
      '—',
      '—',
      '—',
    ],
    usedNames,
  });

  return finalizeAndDownloadWorkbook(
    workbook,
    `تقرير_زايد_مارت_${dateKey}.xlsx`,
    triggerDownload
  );
}

// 2) Daily Attendance Export (.xlsx - 2 sheets)
export async function exportDailyAttendanceXlsx(data = {}, triggerDownload) {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'زايد مارت';
  workbook.created = new Date();
  const usedNames = new Set();

  const dateKey = data.dateKey || new Date().toISOString().slice(0, 10);
  const dayLabel = getArabicDayTitle(dateKey);
  const storeName = data.settings?.store_name || 'زايد مارت';
  const branchName = data.settings?.branch_name || 'الفرع الرئيسي';
  const employees = Array.isArray(data.employees) ? data.employees : [];
  const logs = Array.isArray(data.attendanceLogs) ? data.attendanceLogs : [];
  const s = data.summary || {};

  const presentCount =
    s.presentCount ?? employees.filter((e) => e.currentStatus === 'present').length;
  const onBreakCount =
    s.onBreakCount ?? employees.filter((e) => e.currentStatus === 'on_break').length;
  const checkedOutCount =
    s.checkedOutCount ?? employees.filter((e) => e.currentStatus === 'checked_out').length;
  const absentCount =
    s.absentCount ??
    employees.filter((e) => e.currentStatus === 'absent' && !e.isScheduledOff).length;

  const empRows = buildEmployeeRowsForSheet(data);
  buildStyledWorksheet(workbook, {
    name: 'حالة الموظفين الآن',
    title: `كشف الحضور والانصراف اليومي — ${storeName} (${branchName})`,
    subtitle: `التاريخ: ${dayLabel ? `${dayLabel} ` : ''}${dateKey} | حاضر: ${presentCount} | استراحة: ${onBreakCount} | منصرف: ${checkedOutCount} | لم يحضر: ${absentCount}`,
    headers: [
      'الموظف',
      'القسم',
      'الفرع',
      'مواعيد الشفت',
      'المدة',
      'الحالة الآن',
      'وقت الحضور',
      'وقت الانصراف',
      'التأخير / الانتظام',
      'الاستراحات',
      'المسجل بواسطة',
      'حالة الكاميرا',
      'مراجع الكاميرا',
      'وقت الرصد بالكاميرا',
    ],
    rows: empRows,
    statusColIndexes: [5, 8, 11],
    summaryRow: [
      `الإجمالي (${empRows.length} موظف)`,
      '—',
      branchName,
      '—',
      '—',
      `حاضر: ${presentCount} | استراحة: ${onBreakCount} | منصرف: ${checkedOutCount}`,
      '—',
      '—',
      '—',
      '—',
      '—',
      `مؤكد: ${employees.filter((e) => getCctvStatusType(e) === 'confirmed').length} | تعارض: ${employees.filter((e) => getCctvStatusType(e) === 'mismatch').length}`,
      '—',
      '—',
    ],
    usedNames,
  });

  const attRows = buildAttendanceLogRowsForSheet(logs);
  buildStyledWorksheet(workbook, {
    name: 'حركات الحضور والكاميرات',
    title: `حركات الحضور ومطابقة الكاميرات — ${storeName} (${branchName})`,
    subtitle: `التاريخ: ${dateKey} | إجمالي الحركات: ${attRows.length}`,
    headers: [
      'التاريخ',
      'تاريخ الشفت',
      'الوقت',
      'الموظف',
      'القسم',
      'الحركة',
      'الانتظام / التأخير',
      'الاستراحة',
      'المسجل بواسطة',
      'حالة الكاميرا',
      'مراجع الكاميرا',
      'وقت الرصد',
      'ملاحظات',
    ],
    rows: attRows,
    statusColIndexes: [5, 6, 9],
    summaryRow: [
      'الإجمالي',
      '—',
      '—',
      `${attRows.length} حركة`,
      '—',
      '—',
      '—',
      '—',
      '—',
      `مؤكد: ${logs.filter((l) => getCctvStatusType(l) === 'confirmed').length} | تعارض: ${logs.filter((l) => getCctvStatusType(l) === 'mismatch').length}`,
      '—',
      '—',
      '—',
    ],
    usedNames,
  });

  return finalizeAndDownloadWorkbook(
    workbook,
    `تقرير_الحضور_${dateKey}.xlsx`,
    triggerDownload
  );
}

// 3) Range Comprehensive Report (.xlsx - 5 sheets)
export async function exportRangeReportXlsx(
  report,
  storeName = 'زايد مارت',
  branchName = '',
  triggerDownload
) {
  if (!report) return null;
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = storeName || 'زايد مارت';
  workbook.created = new Date();
  const usedNames = new Set();

  const from = report.period?.from || '';
  const to = report.period?.to || '';
  const t = report.totals || {};
  const locationLabel = branchName ? `${storeName} (${branchName})` : storeName;

  // Sheet 1: Period Summary
  const kpiRows = [
    ['الفترة المغطاة', `${from} ← ${to}`, 'تاريخ البداية والنهاية'],
    ['اسم المنشأة والفرع', locationLabel, '—'],
    ['إجمالي الموظفين النشطين', t.totalActiveStaff ?? 0, '—'],
    ['موظفون سجلوا حضور', t.uniqueEmployeesPresent ?? 0, `إجمالي حركات الحضور: ${t.attendanceEvents ?? 0}`],
    ['حالات التأخير', t.totalLateInstances ?? 0, `إجمالي دقائق التأخير: ${t.totalLateMinutes ?? 0} دقيقة`],
    ['الاستراحات المسجلة', t.breaksCount ?? 0, `إجمالي دقائق الاستراحة: ${t.totalBreakMinutes ?? 0} دقيقة`],
    ['بانتظار مطابقة الكاميرا', t.unverifiedCount ?? 0, `تعارض كاميرا: ${t.mismatchCount ?? 0}`],
    ['عربيات الموردين', t.trucksTotal ?? 0, `مكتمل: ${t.trucksCompleted ?? 0} | متوسط التنزيل: ${t.avgUnloadMinutes ?? 0} دقيقة`],
    ['طلبيات بنواقص / مرتجع', (t.trucksWithShortage ?? 0) + (t.trucksWithReturn ?? 0), `نواقص: ${t.trucksWithShortage ?? 0} | مرتجع/تالف: ${t.trucksWithReturn ?? 0}`],
    ['إجمالي النواقص والمقترحات', t.shortagesTotal ?? 0, `مطلوب: ${t.shortagesOpen ?? 0} | تم الطلب: ${t.shortagesOrdered ?? 0} | تم التوفير: ${t.shortagesResolved ?? 0}`],
    ['ملاحظات الكاميرات والأمن', t.notesTotal ?? 0, `طارئة: ${t.urgentNotes ?? 0} | مفتوحة للمتابعة: ${t.openHandoverNotes ?? 0}`],
  ];
  buildStyledWorksheet(workbook, {
    name: 'ملخص الفترة',
    title: `التقرير الشامل عن الفترة — ${locationLabel}`,
    subtitle: `الفترة من ${from} إلى ${to}`,
    headers: ['المؤشر', 'القيمة', 'التفاصيل'],
    rows: kpiRows,
    statusColIndexes: [],
    usedNames,
  });

  // Sheet 2: Employee Compliance
  const empStats = report.employeeStats || [];
  const empRows = empStats.map((emp) => {
    const shiftStart = emp.shift_start || '08:00';
    const shiftEnd = emp.shift_end || '20:00';
    const durLabel = formatShiftDurationArabicClient(
      computeShiftDurationHoursClient(shiftStart, shiftEnd)
    );
    const checkIns = emp.checkInsCount ?? emp.checkIns ?? 0;
    const checkOuts = emp.checkOutsCount ?? emp.checkOuts ?? 0;
    const breaks = emp.breaksCount ?? emp.breaks ?? 0;
    return [
      emp.name || '—',
      emp.emp_code || '—',
      emp.department || '—',
      `${shiftStart} ← ${shiftEnd}`,
      durLabel,
      emp.daysPresent ?? 0,
      checkIns,
      checkOuts,
      emp.lateCount ?? 0,
      emp.totalLateMinutes ?? 0,
      breaks,
      emp.totalBreakMinutes ?? 0,
    ];
  });
  buildStyledWorksheet(workbook, {
    name: 'التزام الموظفين',
    title: `تقرير التزام وحضور الموظفين — ${locationLabel}`,
    subtitle: `الفترة من ${from} إلى ${to} | عدد الموظفين: ${empRows.length}`,
    headers: [
      'الموظف',
      'الكود',
      'القسم',
      'الشفت',
      'مدة الشفت',
      'أيام الحضور',
      'مرات الحضور',
      'مرات الانصراف',
      'مرات التأخير',
      'دقائق التأخير',
      'الاستراحات',
      'دقائق الاستراحة',
    ],
    rows: empRows,
    statusColIndexes: [],
    summaryRow: [
      `الإجمالي (${empRows.length})`,
      '—',
      '—',
      '—',
      '—',
      empStats.reduce((a, e) => a + Number(e.daysPresent || 0), 0),
      empStats.reduce((a, e) => a + Number(e.checkInsCount ?? e.checkIns ?? 0), 0),
      empStats.reduce((a, e) => a + Number(e.checkOutsCount ?? e.checkOuts ?? 0), 0),
      empStats.reduce((a, e) => a + Number(e.lateCount || 0), 0),
      empStats.reduce((a, e) => a + Number(e.totalLateMinutes || 0), 0),
      empStats.reduce((a, e) => a + Number(e.breaksCount ?? e.breaks ?? 0), 0),
      empStats.reduce((a, e) => a + Number(e.totalBreakMinutes || 0), 0),
    ],
    usedNames,
  });

  // Sheet 3: Detailed Attendance Logs
  const attRows = buildAttendanceLogRowsForSheet(report.attendanceLogs || []);
  buildStyledWorksheet(workbook, {
    name: 'سجل الحضور التفصيلي',
    title: `سجل الحضور التفصيلي — ${locationLabel}`,
    subtitle: `الفترة من ${from} إلى ${to} | عدد الحركات: ${attRows.length}`,
    headers: [
      'التاريخ',
      'تاريخ الشفت',
      'الوقت',
      'الموظف',
      'القسم',
      'الحركة',
      'الانتظام / التأخير',
      'الاستراحة',
      'المسجل بواسطة',
      'حالة الكاميرا',
      'مراجع الكاميرا',
      'وقت الرصد',
      'ملاحظات',
    ],
    rows: attRows,
    statusColIndexes: [5, 6, 9],
    usedNames,
  });

  // Sheet 4: Shortages & Suggestions
  const shRows = buildShortageRowsForSheet(report.shortagesList || []);
  buildStyledWorksheet(workbook, {
    name: 'النواقص والمقترحات',
    title: `سجل النواقص والمقترحات — ${locationLabel}`,
    subtitle: `الفترة من ${from} إلى ${to} | عدد الأصناف: ${shRows.length}`,
    headers: [
      'التاريخ',
      'الوقت',
      'النوع',
      'اسم الصنف',
      'القسم',
      'الكمية',
      'الاستعجال',
      'الحالة',
      'المورد',
      'المسجل بواسطة',
      'تم التوفير بواسطة',
      'ملاحظات',
    ],
    rows: shRows,
    statusColIndexes: [6, 7],
    usedNames,
  });

  // Sheet 5: Supplier Evaluation
  const supStats = report.supplierStats || [];
  const supRows = supStats.map((sup) => [
    sup.name || sup.supplier_name || '—',
    sup.category || '—',
    sup.deliveriesCount ?? 0,
    sup.completedCount ?? 0,
    sup.avgDurationMinutes ?? 0,
    sup.issuesCount ?? 0,
    sup.hasPendingReturn ? 'مرتجع معلق' : 'سليمة',
    sup.pendingReturnNote || '—',
  ]);
  buildStyledWorksheet(workbook, {
    name: 'تقييم الموردين',
    title: `تقييم الموردين والعربيات — ${locationLabel}`,
    subtitle: `الفترة من ${from} إلى ${to} | عدد الموردين: ${supRows.length}`,
    headers: [
      'المورد',
      'التصنيف',
      'عدد الطلبيات',
      'المكتمل',
      'متوسط التنزيل (د)',
      'نواقص / ملاحظات',
      'حالة المرتجعات',
      'ملاحظة المرتجع',
    ],
    rows: supRows,
    statusColIndexes: [6],
    summaryRow: [
      `الإجمالي (${supRows.length})`,
      '—',
      supStats.reduce((a, s) => a + Number(s.deliveriesCount || 0), 0),
      supStats.reduce((a, s) => a + Number(s.completedCount || 0), 0),
      '—',
      supStats.reduce((a, s) => a + Number(s.issuesCount || 0), 0),
      `معلق: ${supStats.filter((s) => s.hasPendingReturn).length}`,
      '—',
    ],
    usedNames,
  });

  return finalizeAndDownloadWorkbook(
    workbook,
    `التقرير_الشامل_زايد_مارت_${from}_الى_${to}.xlsx`,
    triggerDownload
  );
}

// 4) Weekly Schedule Export (.xlsx - Coverage overview + 1 sheet per team group)
export async function exportWeeklyScheduleXlsx(
  scheduleData,
  storeName = 'زايد مارت',
  triggerDownload
) {
  if (!scheduleData) return null;
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = storeName || 'زايد مارت';
  workbook.created = new Date();
  const usedNames = new Set();

  const weekStart = scheduleData.weekStartDate || 'week';
  const weekDates = scheduleData.weekDates || {};
  const groups = scheduleData.groups || [];
  const startStr = weekDates.sat || weekStart;
  const endStr = weekDates.fri || '';

  const dayHeaders = SCHEDULE_WEEKDAYS.map((d) => {
    const shortDate = (weekDates[d.code] || '').slice(5);
    return shortDate ? `${d.label} (${shortDate})` : d.label;
  });

  // Overview Sheet
  const overviewRows = groups.map((group) => {
    const emps = group.employees || [];
    const minReq = group.coverageByDay?.sat?.minRequired ?? '—';
    return [
      group.label || group.id || '—',
      emps.length,
      minReq,
      ...SCHEDULE_WEEKDAYS.map((d) => {
        const cov = group.coverageByDay?.[d.code];
        if (!cov) return '—';
        return `دوام ${cov.onDutyCount} / إجازة ${cov.offCount}${cov.lowCoverage ? ' (منخفضة)' : ''}`;
      }),
    ];
  });

  const totalEmpsAll = groups.reduce((acc, g) => acc + (g.employees?.length || 0), 0);
  buildStyledWorksheet(workbook, {
    name: 'ملخص التغطية الشامل',
    title: `ملخص التغطية والإجازات الأسبوعي — ${storeName}`,
    subtitle: `الأسبوع من ${startStr}${endStr ? ` إلى ${endStr}` : ''}`,
    headers: ['الفريق / المجموعة', 'عدد الموظفين', 'الحد الأدنى اليومي', ...dayHeaders],
    rows: overviewRows,
    statusColIndexes: [3, 4, 5, 6, 7, 8, 9],
    summaryRow: [
      'إجمالي الماركت',
      totalEmpsAll,
      '—',
      ...SCHEDULE_WEEKDAYS.map((d) => {
        const onDuty = groups.reduce(
          (acc, g) => acc + Number(g.coverageByDay?.[d.code]?.onDutyCount || 0),
          0
        );
        const off = groups.reduce(
          (acc, g) => acc + Number(g.coverageByDay?.[d.code]?.offCount || 0),
          0
        );
        return `دوام ${onDuty} / إجازة ${off}`;
      }),
    ],
    usedNames,
  });

  // One sheet per team group
  for (const group of groups) {
    const emps = group.employees || [];
    const empRows = emps.map((emp) => {
      const shiftStart = emp.shift_start || '08:00';
      const shiftEnd = emp.shift_end || '20:00';
      const durLabel = formatShiftDurationArabicClient(
        computeShiftDurationHoursClient(shiftStart, shiftEnd)
      );
      return [
        emp.name || '—',
        emp.emp_code || '—',
        emp.department || '—',
        `${shiftStart} ← ${shiftEnd}`,
        durLabel,
        emp.effective_day_of_week
          ? getScheduleWeekdayLabel(emp.effective_day_of_week)
          : 'غير محدد',
        emp.default_day_of_week
          ? getScheduleWeekdayLabel(emp.default_day_of_week)
          : 'غير محدد',
        emp.is_override ? 'معدل' : 'ثابت',
        ...SCHEDULE_WEEKDAYS.map((d) =>
          emp.effective_day_of_week === d.code ? 'إجازة' : 'دوام'
        ),
      ];
    });

    const minReq = group.coverageByDay?.sat?.minRequired;
    const summaryRow = [
      `ملخص التغطية (${emps.length} موظف)`,
      '—',
      '—',
      '—',
      minReq !== undefined ? `الحد الأدنى: ${minReq}` : '—',
      '—',
      '—',
      '—',
      ...SCHEDULE_WEEKDAYS.map((d) => {
        const cov = group.coverageByDay?.[d.code];
        if (!cov) return '—';
        return `دوام ${cov.onDutyCount} / إجازة ${cov.offCount}${cov.lowCoverage ? ' (منخفضة)' : ''}`;
      }),
    ];

    buildStyledWorksheet(workbook, {
      name: group.label || group.id || 'فريق',
      title: `جدول ${group.label || group.id} والشفتات — ${storeName}`,
      subtitle: `الأسبوع من ${startStr}${endStr ? ` إلى ${endStr}` : ''} | الموظفون: ${emps.length}`,
      headers: [
        'الموظف',
        'الكود',
        'القسم',
        'الشفت',
        'المدة',
        'الإجازة المعتمدة',
        'الإجازة الثابتة',
        'حالة الأسبوع',
        ...dayHeaders,
      ],
      rows: empRows,
      statusColIndexes: [7, 8, 9, 10, 11, 12, 13, 14],
      summaryRow,
      usedNames,
    });
  }

  return finalizeAndDownloadWorkbook(
    workbook,
    `جدول_الإجازات_${weekStart}.xlsx`,
    triggerDownload
  );
}

// 5) Individual Person Log Export (.xlsx - 4 sheets)
export async function exportPersonLogXlsx(personData, triggerDownload) {
  if (!personData) return null;
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'زايد مارت';
  workbook.created = new Date();
  const usedNames = new Set();

  const p = personData.person || {};
  const st = resolvePersonStats(personData);
  const shiftStart = p.shift_start || '08:00';
  const shiftEnd = p.shift_end || '20:00';
  const shiftDurLabel = formatShiftDurationArabicClient(
    computeShiftDurationHoursClient(shiftStart, shiftEnd)
  );

  // Sheet 1: Person Summary
  const summaryRows = [
    ['اسم الموظف', p.name || '—'],
    ['الكود الوظيفي', p.emp_code || '—'],
    ['القسم', p.department || '—'],
    ['المسمى / الدور', p.role_title || p.role_label || '—'],
    ['مواعيد الشفت', `${shiftStart} ← ${shiftEnd} (${shiftDurLabel})`],
    ['رقم الهاتف', p.phone || '—'],
    ['أيام / مرات الحضور', `${st.totalCheckIns} حضور (${st.daysPresent} يوم)`],
    ['مرات الانصراف', st.totalCheckOuts],
    ['الاستراحات', `${st.totalBreaks} استراحة (${st.totalBreakMinutes} دقيقة)`],
    ['إجمالي دقائق التأخير', `${st.totalLateMinutes} دقيقة`],
    ['النواقص والمقترحات المسجلة', `${st.shortagesReported} (${st.suggestionsReported} مقترح)`],
    ['الملاحظات المسجلة', st.notesRecorded],
    ['حركات النظام الرقابية', st.auditActionsCount],
  ];

  buildStyledWorksheet(workbook, {
    name: 'ملخص الموظف',
    title: `السجل الفردي الكامل — ${p.name || 'موظف'}`,
    subtitle: `${p.department || '—'} | شفت ${shiftDurLabel}: ${shiftStart} → ${shiftEnd}`,
    headers: ['البيان', 'القيمة'],
    rows: summaryRows,
    statusColIndexes: [],
    usedNames,
  });

  // Sheet 2: Attendance & Breaks
  const attLogs = personData.attendanceLogs || [];
  const attRows = attLogs.map((a) => {
    const breakTxt =
      Number(a.break_duration_minutes) > 0
        ? `استغرقت ${a.break_duration_minutes} د`
        : Number(a.allowed_break_minutes) > 0
          ? `مسموح ${a.allowed_break_minutes} د`
          : '—';
    return [
      a.date_key || '—',
      formatTimeArabic(a.timestamp),
      ACTION_LABELS[a.action_type] || a.action_type || '—',
      a.shift_date_key || a.date_key || '—',
      Number(a.late_minutes) > 0 ? `تأخير ${a.late_minutes} د` : 'منتظم',
      breakTxt,
      a.recorded_by || '—',
      formatCctvStatusArabic(a, { includeMeta: false }),
      a.verified_by || '—',
      a.cctv_observed_time || '—',
      a.note || a.break_reason || '—',
    ];
  });
  buildStyledWorksheet(workbook, {
    name: 'الحضور والاستراحات',
    title: `سجل الحضور والاستراحات — ${p.name || 'موظف'}`,
    subtitle: `إجمالي الحركات: ${attRows.length} | إجمالي الاستراحات: ${st.totalBreakMinutes} دقيقة`,
    headers: [
      'التاريخ',
      'الوقت',
      'الحركة',
      'تاريخ الشفت',
      'الانتظام / التأخير',
      'الاستراحة',
      'بواسطة',
      'حالة الكاميرا',
      'مراجع الكاميرا',
      'وقت الرصد',
      'ملاحظات',
    ],
    rows: attRows,
    statusColIndexes: [2, 4, 7],
    usedNames,
  });

  // Sheet 3: Shortages
  const shRows = buildShortageRowsForSheet(personData.shortages || []);
  buildStyledWorksheet(workbook, {
    name: 'النواقص',
    title: `النواقص والمقترحات المسجلة — ${p.name || 'موظف'}`,
    subtitle: `إجمالي الأصناف المسجلة: ${shRows.length}`,
    headers: [
      'التاريخ',
      'الوقت',
      'النوع',
      'اسم الصنف',
      'القسم',
      'الكمية',
      'درجة الاستعجال',
      'الحالة',
      'المورد',
      'المسجل بواسطة',
      'تم التوفير بواسطة',
      'ملاحظات',
    ],
    rows: shRows,
    statusColIndexes: [6, 7],
    usedNames,
  });

  // Sheet 4: Notes & Audit Logs
  const combinedRows = [
    ...(personData.notes || []).map((n) => [
      'ملاحظة / بلاغ',
      n.date_key || '—',
      n.dvr_timestamp || formatTimeArabic(n.timestamp),
      n.location_tag || '—',
      n.category_tag || '—',
      SEVERITY_LABELS[n.severity] || n.severity || '—',
      n.recorded_by || '—',
      n.content || '—',
    ]),
    ...(personData.auditLogs || []).map((al) => [
      'حركة نظام (Audit)',
      al.timestamp ? String(al.timestamp).slice(0, 10) : '—',
      formatTimeArabic(al.timestamp),
      al.action || '—',
      al.target_type || '—',
      al.target_label || '—',
      al.actor_name || al.user_name || '—',
      al.details || '—',
    ]),
  ];
  buildStyledWorksheet(workbook, {
    name: 'الملاحظات والحركات',
    title: `الملاحظات وسجل الحركات — ${p.name || 'موظف'}`,
    subtitle: `الملاحظات: ${(personData.notes || []).length} | حركات النظام: ${(personData.auditLogs || []).length}`,
    headers: [
      'نوع السجل',
      'التاريخ',
      'الوقت',
      'المكان / العملية',
      'التصنيف / الكيان',
      'الأهمية / الهدف',
      'المنفذ',
      'التفاصيل',
    ],
    rows: combinedRows,
    statusColIndexes: [5],
    usedNames,
  });

  const safeNameSlug = (p.name || 'موظف').replace(/\s+/g, '_');
  return finalizeAndDownloadWorkbook(
    workbook,
    `سجل_${safeNameSlug}.xlsx`,
    triggerDownload
  );
}

// 6) Shortages Export (.xlsx)
export async function exportShortagesXlsx(
  shortages = [],
  label = 'today',
  storeName = 'زايد مارت',
  triggerDownload
) {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = storeName || 'زايد مارت';
  workbook.created = new Date();
  const usedNames = new Set();

  const rows = buildShortageRowsForSheet(shortages);
  const openCount = shortages.filter((s) => s.status === 'open').length;
  const orderedCount = shortages.filter((s) => s.status === 'ordered').length;
  const resolvedCount = shortages.filter((s) => s.status === 'resolved').length;

  buildStyledWorksheet(workbook, {
    name: 'النواقص والمقترحات',
    title: `كشف نواقص الصالة ومقترحات الكاشيرية — ${storeName}`,
    subtitle: `الفترة: ${label} | الإجمالي: ${rows.length} | مطلوب: ${openCount} | تم الطلب: ${orderedCount} | تم التوفير: ${resolvedCount}`,
    headers: [
      'التاريخ',
      'الوقت',
      'النوع',
      'اسم الصنف',
      'القسم',
      'الكمية',
      'درجة الاستعجال',
      'الحالة',
      'المورد',
      'المسجل بواسطة',
      'تم التوفير بواسطة',
      'ملاحظات',
    ],
    rows,
    statusColIndexes: [6, 7],
    summaryRow: [
      'الإجمالي',
      '—',
      '—',
      `${rows.length} صنف`,
      '—',
      '—',
      `نافذ: ${shortages.filter((s) => s.urgency === 'out_of_stock').length}`,
      `مطلوب: ${openCount} | تم التوفير: ${resolvedCount}`,
      '—',
      '—',
      '—',
      '—',
    ],
    usedNames,
  });

  // Category Breakdown Sheet
  const catMap = new Map();
  for (const sh of shortages) {
    const cat = sh.category || 'أصناف متنوعة';
    if (!catMap.has(cat)) {
      catMap.set(cat, { category: cat, total: 0, open: 0, ordered: 0, resolved: 0 });
    }
    const entry = catMap.get(cat);
    entry.total += 1;
    if (sh.status === 'open') entry.open += 1;
    else if (sh.status === 'ordered') entry.ordered += 1;
    else entry.resolved += 1;
  }
  const catRows = Array.from(catMap.values()).map((c) => [
    c.category,
    c.total,
    c.open,
    c.ordered,
    c.resolved,
  ]);
  buildStyledWorksheet(workbook, {
    name: 'توزيع الأقسام',
    title: `توزيع النواقص حسب أقسام ${storeName}`,
    subtitle: `عدد الأقسام: ${catRows.length}`,
    headers: ['القسم', 'إجمالي الأصناف', 'مطلوب توفيره', 'تم الطلب', 'تم التوفير'],
    rows: catRows,
    statusColIndexes: [],
    summaryRow: ['الإجمالي', shortages.length, openCount, orderedCount, resolvedCount],
    usedNames,
  });

  return finalizeAndDownloadWorkbook(
    workbook,
    `كشف_نواقص_ومقترحات_الصالة_${label}.xlsx`,
    triggerDownload
  );
}

// 7) Audit Logs Export (.xlsx)
export async function exportAuditLogsXlsx(logs = [], triggerDownload) {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'زايد مارت';
  workbook.created = new Date();
  const usedNames = new Set();

  const dateSlug = new Date().toISOString().slice(0, 10);
  const rows = (logs || []).map((l) => [
    l.timestamp ? new Date(l.timestamp).toLocaleString('ar-EG') : '—',
    l.actor_name || l.user_name || '—',
    l.actor_role || l.role || '—',
    l.action || '—',
    l.target_type || '—',
    l.target_label || '—',
    l.details || '—',
    l.ip_address || l.ip || '—',
  ]);

  buildStyledWorksheet(workbook, {
    name: 'السجل الرقابي الشامل',
    title: 'السجل الرقابي والأمني الشامل — زايد مارت',
    subtitle: `تاريخ الاستخراج: ${dateSlug} | إجمالي الحركات: ${rows.length}`,
    headers: [
      'التوقيت',
      'المستخدم المنفذ',
      'الدور الوظيفي',
      'نوع العملية',
      'الكيان المستهدف',
      'الهدف',
      'التفاصيل',
      'عنوان IP',
    ],
    rows,
    statusColIndexes: [],
    summaryRow: ['الإجمالي', `${rows.length} حركة`, '—', '—', '—', '—', '—', '—'],
    usedNames,
  });

  return finalizeAndDownloadWorkbook(
    workbook,
    `السجل_الأمني_الشامل_زايد_مارت_${dateSlug}.xlsx`,
    triggerDownload
  );
}
