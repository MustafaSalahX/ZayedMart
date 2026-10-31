/**
 * تصدير التقارير لملفات Excel (CSV بترميز عربي سليم UTF-8 BOM)
 * وتجهيز ملخص اليوم وقوائم النواقص المنسقة لإرسالها على واتساب بنقرة واحدة
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

const ACTION_LABELS = {
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
    rows.push([
      'حضور وانصراف',
      formatTimeWithSeconds(log.timestamp),
      log.employee_name,
      log.department,
      ACTION_LABELS[log.action_type] || log.action_type,
      log.late_minutes > 0 ? `تأخير ${log.late_minutes} دقيقة` : 'منتظم',
      log.recorded_by,
      log.verified_by_cctv ? 'تمت المطابقة' : 'بانتظار المطابقة',
      log.note || '',
    ]);
  }

  for (const sh of data.shortages || []) {
    rows.push([
      'نواقص الصالة',
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
      'ملاحظات ومراقبة',
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

export function exportShortagesCsv(shortages = [], label = 'today') {
  const rows = shortages.map((sh) => [
    sh.date_key || '',
    formatTimeArabic(sh.updated_at || sh.created_at),
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
    `كشف_نواقص_الصالة_${label}.csv`,
    [
      'التاريخ',
      'الوقت',
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

export function buildShortagesWhatsAppText(shortages = [], storeName = 'زايد مارت') {
  const active = shortages.filter((s) => s.status !== 'resolved');
  const list = active.length > 0 ? active : shortages;

  const lines = [
    `🛒 *كشف نواقص الصالة - ${storeName}*`,
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
      const icon = sh.urgency === 'out_of_stock' ? '🔴' : '🟡';
      const qtyText = formatQtyForExport(sh.requested_qty, sh.unit);
      const statusSuffix = sh.status === 'ordered' ? ' [تم الطلب]' : '';
      const noteSuffix = sh.notes ? ` (${sh.notes})` : '';
      lines.push(`${icon} ${sh.item_name} — *${qtyText}*${statusSuffix}${noteSuffix}`);
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
      'سجل نواقص الصالة',
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
      'ملاحظات الكاميرات والأمن',
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

export function buildWhatsAppSummaryText(data) {
  const s = data.summary || {};
  const store = data.settings?.store_name || 'زايد مارت';
  const branch = data.settings?.branch_name || '';

  const lines = [
    `📊 *التقرير اليومي - ${store}${branch ? ` (${branch})` : ''}*`,
    `📅 التاريخ: ${data.dateKey}`,
    `━━━━━━━━━━━━━━━━━━`,
    `👥 *الموظفون والحضور:*`,
    `• متواجد الآن: ${s.presentCount || 0} | في استراحة: ${s.onBreakCount || 0}`,
    `• انصرف: ${s.checkedOutCount || 0} | لم يحضر بعد: ${s.absentCount || 0}`,
    `• حالات تأخير اليوم: ${s.lateCount || 0}`,
    ``,
    `🛒 *نواقص الصالة والأصناف المطلوبة:*`,
    `• نواقص مطلوبة الآن: ${s.openShortagesCount || 0} | تم طلبها: ${s.orderedShortagesCount || 0}`,
    `• تم توفيرها اليوم: ${s.resolvedTodayShortagesCount || 0}`,
  ];

  const openShortages = (data.shortages || []).filter((sh) => sh.status === 'open');
  if (openShortages.length > 0) {
    lines.push(`📌 *أبرز النواقص الحالية:*`);
    openShortages.slice(0, 6).forEach((sh) => {
      const icon = sh.urgency === 'out_of_stock' ? '🔴' : '🟡';
      lines.push(`  ${icon} ${sh.item_name} (${formatQtyForExport(sh.requested_qty, sh.unit)})`);
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
  lines.push(`🛡️ *ملاحظات مراقب الكاميرات والأمن (${(data.notes || []).length}):*`);
  if (importantNotes.length === 0) {
    lines.push(`• لا توجد ملاحظات طارئة مسجلة اليوم ✅`);
  } else {
    importantNotes.slice(0, 6).forEach((n) => {
      const icon = n.severity === 'urgent' ? '🔴' : '🟡';
      lines.push(`  ${icon} [${n.dvr_timestamp}] ${n.location_tag}: ${n.content}`);
    });
  }

  return lines.join('\n');
}
