/**
 * تصدير التقارير والسجلات لملفات Excel (CSV بترميز عربي سليم UTF-8 BOM)
 * وملفات Word (.doc بتنسيق RTL وجداول احترافية متوافقة مع Microsoft Word)
 * وتجهيز الملخصات المنسقة لإرسالها على واتساب بنقرة واحدة
 */

export function formatTimeArabic(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  const hours24 = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, '0');
  const period = hours24 >= 12 ? 'م' : 'ص';
  const hours12 = hours24 % 12 || 12;
  return `${String(hours12).padStart(2, '0')}:${mins} ${period}`;
}

export function formatTimeWithSeconds(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
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

export function downloadExcelCsv(filename, headers, rows) {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ];
  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function openWhatsAppShare(text) {
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

export function exportDailyReportCsv(data) {
  const dateKey = data.dateKey || 'today';
  const rows = [];

  for (const log of data.attendanceLogs || []) {
    const breakInfo =
      log.action_type === 'break_start' && log.allowed_break_minutes
        ? ` (مسموح ${log.allowed_break_minutes} د)`
        : log.break_duration_minutes > 0
          ? ` (استراحة ${log.break_duration_minutes} د)`
          : '';
    rows.push([
      'حضور وانصراف (شفت 12 ساعة)',
      formatTimeWithSeconds(log.timestamp),
      log.employee_name,
      log.department,
      (ACTION_LABELS[log.action_type] || log.action_type) + breakInfo,
      log.late_minutes > 0 ? `تأخير ${log.late_minutes} دقيقة` : 'منتظم',
      log.recorded_by,
      log.verified_by_cctv ? 'تمت المطابقة' : 'بانتظار المطابقة',
      `${log.shift_date_key && log.shift_date_key !== log.date_key ? `[شفت ممتد من ${log.shift_date_key}] ` : ''}${log.note || log.break_reason || ''}`,
    ]);
  }

  for (const sh of data.shortages || []) {
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

  for (const t of data.truckLogs || []) {
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

  for (const n of data.notes || []) {
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

export function exportDailyReportWord(data) {
  const dateKey = data.dateKey || 'today';
  const storeName = data.settings?.store_name || 'زايد مارت';

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
    `التقرير اليومي الشامل — ${storeName}`,
    `التاريخ: ${dateKey} | حضور: ${data.summary?.presentCount || 0} | استراحة: ${data.summary?.onBreakCount || 0} | انصراف: ${data.summary?.checkedOutCount || 0}`,
    [
      {
        title: `1) سجل الحضور والانصراف والاستراحات (${attRows.length})`,
        headers: ['الوقت', 'الموظف', 'القسم', 'الحركة', 'الانتظام', 'الاستراحة', 'تاريخ الشفت', 'بواسطة', 'ملاحظات'],
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

export function exportShortagesCsv(shortages = [], label = 'today') {
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

export function exportRangeReportCsv(report) {
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
      `الاستراحات: ${emp.breaksCount}`,
      emp.emp_code ? `كود ${emp.emp_code}` : '',
      `انصراف مسجل: ${emp.checkOutsCount}`,
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
      sup.name,
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

export function exportRangeReportWord(report) {
  if (!report) return;
  const from = report.period?.from || '';
  const to = report.period?.to || '';

  const empRows = (report.employeeStats || []).map((emp) => [
    emp.name,
    emp.department,
    `${emp.shift_start || '08:00'} -> ${emp.shift_end || '20:00'}`,
    String(emp.daysPresent || 0),
    String(emp.checkOutsCount || 0),
    `${emp.lateCount || 0} (${emp.totalLateMinutes || 0} د)`,
    String(emp.breaksCount || 0),
  ]);

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
    sup.name,
    sup.category,
    String(sup.deliveriesCount || 0),
    `${sup.avgDurationMinutes || 0} د`,
    String(sup.issuesCount || 0),
    sup.hasPendingReturn ? 'مرتجع معلق' : 'سليم',
  ]);

  downloadWordDoc(
    `التقرير_الشامل_زايد_مارت_${from}_الى_${to}.doc`,
    `التقرير الشامل عن فترة — زايد مارت`,
    `الفترة من ${from} إلى ${to}`,
    [
      {
        title: `1) إحصائيات حضور وانصراف الموظفين (${empRows.length})`,
        headers: ['الموظف', 'القسم', 'الشفت (12 ساعة)', 'أيام الحضور', 'مرات الانصراف', 'التأخير', 'الاستراحات'],
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

export function buildWhatsAppSummaryText(data) {
  const s = data.summary || {};
  const store = data.settings?.store_name || 'زايد مارت';
  const branch = data.settings?.branch_name || '';

  const lines = [
    `📊 *التقرير اليومي - ${store}${branch ? ` (${branch})` : ''}*`,
    `📅 التاريخ: ${data.dateKey}`,
    `━━━━━━━━━━━━━━━━━━`,
    `👥 *الموظفون والحضور (شفت 12 ساعة):*`,
    `• متواجد الآن: ${s.presentCount || 0} | في استراحة: ${s.onBreakCount || 0}`,
    `• انصرف: ${s.checkedOutCount || 0} | لم يحضر بعد: ${s.absentCount || 0}`,
    `• حالات تأخير اليوم: ${s.lateCount || 0}`,
    ``,
    `🛒 *نواقص الصالة ومقترحات الكاشيرية:*`,
    `• نواقص مطلوبة الآن: ${s.openShortagesCount || 0} | تم طلبها: ${s.orderedShortagesCount || 0}`,
    `• تم توفيرها اليوم: ${s.resolvedTodayShortagesCount || 0}`,
  ];

  const openShortages = (data.shortages || []).filter((sh) => sh.status === 'open');
  if (openShortages.length > 0) {
    lines.push(`📌 *أبرز النواقص والمقترحات الحالية:*`);
    openShortages.slice(0, 6).forEach((sh) => {
      const icon = sh.is_suggestion ? '💡' : sh.urgency === 'out_of_stock' ? '🔴' : '🟡';
      lines.push(`  ${icon} ${sh.item_name} (${formatQtyForExport(sh.requested_qty, sh.unit)}) — ${sh.recorded_by}`);
    });
  }

  lines.push(
    ``,
    `🚛 *عربيات الموردين والطلبيات:*`,
    `• تم استلامها اليوم: ${s.completedTrucksCount || 0} عربية`,
    `• قيد التنزيل حالياً: ${s.unloadingTrucksCount || 0} عربية`,
    `• طلبيات بها نواقص أو مرتجع: ${s.issuesTrucksCount || 0}`
  );

  const issueTrucks = (data.truckLogs || []).filter(
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

  const importantNotes = (data.notes || []).filter(
    (n) => n.severity === 'urgent' || n.severity === 'warning' || n.is_open_handover
  );
  lines.push(``);
  lines.push(`🛡️ *ملاحظات الكاشيرية والأمن والكاميرات (${(data.notes || []).length}):*`);
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

// ─── Master Audit Logs Export (Excel / Word / WhatsApp) ───
export function exportAuditLogsCsv(logs = []) {
  const rows = logs.map((l) => [
    l.timestamp ? new Date(l.timestamp).toLocaleString('ar-EG') : '',
    l.actor_name || '',
    l.actor_role || '',
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

export function exportAuditLogsWord(logs = []) {
  const rows = logs.map((l) => [
    l.timestamp ? new Date(l.timestamp).toLocaleString('ar-EG') : '—',
    l.actor_name || '—',
    l.actor_role || '—',
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
    lines.push(`• [${t}] *${l.actor_name}* (${l.action}): ${l.target_label || ''} ${l.details ? `— ${l.details}` : ''}`);
  }
  return lines.join('\n');
}

// ─── Individual Person Log Export (Excel / Word / WhatsApp) ───
export function exportPersonLogCsv(personData) {
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
      a.note || a.break_reason || '',
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
      al.actor_name || '',
      al.details || '',
    ]);
  }

  downloadExcelCsv(
    `سجل_${(p.name || 'موظف').replace(/\s+/g, '_')}.csv`,
    ['نوع السجل', 'التاريخ', 'الوقت', 'الحركة / الصنف / العملية', 'القسم / تاريخ الشفت', 'التفاصيل / الكمية', 'الاستراحة / الحالة', 'بواسطة', 'ملاحظات'],
    rows
  );
}

export function exportPersonLogWord(personData) {
  if (!personData) return;
  const p = personData.person || {};
  const st = personData.stats || {};

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
    `القسم: ${p.department || '—'} | الشفت: ${p.shift_start || '08:00'} -> ${p.shift_end || '20:00'} | حضور: ${st.totalCheckIns || 0} | انصراف: ${st.totalCheckOuts || 0} | إجمالي الاستراحات: ${st.totalBreakMinutes || 0} دقيقة`,
    [
      {
        title: `1) سجل الحضور والانصراف والاستراحات (${attRows.length})`,
        headers: ['التاريخ', 'الوقت', 'الحركة', 'تاريخ الشفت', 'الانتظام', 'الاستراحة', 'بواسطة', 'ملاحظات'],
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
  const st = personData.stats || {};
  const lines = [
    `👤 *السجل الفردي الكامل — ${p.name || ''}*`,
    `🏷️ القسم: ${p.department || '—'} | الوظيفة: ${p.role_title || p.role_label || '—'}`,
    `⏰ الشفت (12 ساعة): ${p.shift_start || '08:00'} -> ${p.shift_end || '20:00'}`,
    `━━━━━━━━━━━━━━━━━━`,
    `📊 *ملخص الأداء والحضور:*`,
    `• مرات الحضور: ${st.totalCheckIns || 0} | مرات الانصراف: ${st.totalCheckOuts || 0}`,
    `• الاستراحات: ${st.totalBreaks || 0} (${st.totalBreakMinutes || 0} دقيقة)`,
    `• إجمالي دقائق التأخير: ${st.totalLateMinutes || 0} دقيقة`,
    `• النواقص والمقترحات المسجلة: ${st.shortagesReported || 0} (${st.suggestionsReported || 0} مقترح)`,
    `• الملاحظات المسجلة: ${st.notesRecorded || 0}`,
  ];

  const recentAtt = (personData.attendanceLogs || []).slice(0, 8);
  if (recentAtt.length > 0) {
    lines.push(`\n🕒 *آخر حركات الحضور والانصراف:*`);
    for (const a of recentAtt) {
      lines.push(
        `• [${a.date_key} ${formatTimeArabic(a.timestamp)}] ${ACTION_LABELS[a.action_type] || a.action_type}${
          a.break_duration_minutes > 0 ? ` (${a.break_duration_minutes} د)` : ''
        }`
      );
    }
  }

  return lines.join('\n');
}
