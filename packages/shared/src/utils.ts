export const ZAYED_SUPABASE_URL = 'https://efeioijgxjyyqplfusub.supabase.co';
export const ZAYED_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmZWlvaWpneGp5eXFwbGZ1c3ViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5NzAzMTEsImV4cCI6MjEwOTU0NjMxMX0.sB9irAyfdF_KzNmGujHHEgX1AAhn168eGKS0cQbsGZE';

export function normalizeDigits(str: unknown = ''): string {
  return String(str ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function normalizeRequestedQty(
  raw: unknown
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const str = normalizeDigits(String(raw)).trim().replace(/[٫,]/g, '.');
  if (str === '') return { ok: true, value: null };
  const num = Number(str);
  if (!Number.isFinite(num) || num < 0) {
    return {
      ok: false,
      error: 'الكمية المطلوبة يجب أن تكون رقماً (0 أو أكثر) أو تُترك فارغة',
    };
  }
  return { ok: true, value: num };
}

export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getPreviousDateKey(dateKeyStr?: string): string {
  if (!dateKeyStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateKeyStr)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return getLocalDateKey(d);
  }
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const prev = new Date(y, m - 1, d - 1);
  return getLocalDateKey(prev);
}

export function getNextDateKey(dateKeyStr?: string): string {
  if (!dateKeyStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateKeyStr)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return getLocalDateKey(d);
  }
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  return getLocalDateKey(next);
}

export function getLocalTimeHMS(date: Date = new Date()): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}

export function computeLateMinutes(shiftStart?: string, checkInDate: Date = new Date()): number {
  if (!shiftStart || !/^\d{2}:\d{2}$/.test(shiftStart)) return 0;
  const [sh, sm] = shiftStart.split(':').map(Number);
  const scheduled = new Date(checkInDate);
  scheduled.setHours(sh, sm, 0, 0);
  if (sh >= 18 && checkInDate.getHours() < 6) {
    scheduled.setDate(scheduled.getDate() - 1);
  }
  const diffMin = Math.floor((checkInDate.getTime() - scheduled.getTime()) / 60000);
  if (diffMin < -600) return 0;
  return diffMin > 10 ? diffMin : 0;
}

export function computeShiftDurationHours(shiftStart?: string, shiftEnd?: string): number {
  if (!shiftStart || !shiftEnd || !/^\d{2}:\d{2}$/.test(shiftStart) || !/^\d{2}:\d{2}$/.test(shiftEnd)) {
    return 12;
  }
  const [sh, sm] = shiftStart.split(':').map(Number);
  const [eh, em] = shiftEnd.split(':').map(Number);
  const startTotalMin = sh * 60 + sm;
  let endTotalMin = eh * 60 + em;
  if (endTotalMin <= startTotalMin) {
    endTotalMin += 24 * 60;
  }
  const diffHours = (endTotalMin - startTotalMin) / 60;
  if (diffHours <= 0 || diffHours >= 24) return 12;
  return Math.round(diffHours * 10) / 10;
}

export function formatShiftDurationArabic(hours: number): string {
  const h = Number.isFinite(hours) && hours > 0 ? hours : 12;
  if (h >= 3 && h <= 10 && Number.isInteger(h)) {
    return `${h} ساعات`;
  }
  return `${h} ساعة`;
}

export function formatShiftSummaryArabic(shiftStart?: string, shiftEnd?: string): string {
  const hours = computeShiftDurationHours(shiftStart, shiftEnd);
  const durationLabel = formatShiftDurationArabic(hours);
  if (shiftStart && shiftEnd) {
    return `شفت ${durationLabel} (${shiftStart} - ${shiftEnd})`;
  }
  return `شفت ${durationLabel}`;
}

export interface NextCheckInAvailability {
  canCheckIn: boolean;
  nextShiftStartStr: string;
  windowOpenTimeStr: string;
  remainingMinutes: number;
  lockReasonArabic: string;
}

export function evaluateNextCheckInAvailability(params: {
  shiftStart?: string;
  shiftEnd?: string;
  lastCheckInAt?: string | null;
  lastCheckOutAt?: string | null;
  now?: Date;
}): NextCheckInAvailability {
  const { shiftStart = '08:00', shiftEnd = '20:00', lastCheckInAt, lastCheckOutAt, now = new Date() } = params;
  if (!lastCheckOutAt) {
    return {
      canCheckIn: true,
      nextShiftStartStr: shiftStart,
      windowOpenTimeStr: shiftStart,
      remainingMinutes: 0,
      lockReasonArabic: '',
    };
  }

  const checkOutDate = new Date(lastCheckOutAt);
  if (Number.isNaN(checkOutDate.getTime())) {
    return {
      canCheckIn: true,
      nextShiftStartStr: shiftStart,
      windowOpenTimeStr: shiftStart,
      remainingMinutes: 0,
      lockReasonArabic: '',
    };
  }

  const validStart = /^\d{2}:\d{2}$/.test(shiftStart) ? shiftStart : '08:00';
  const [sh, sm] = validStart.split(':').map(Number);
  const shiftHours = computeShiftDurationHours(validStart, shiftEnd);

  // Reference start of the completed shift
  const refDate = lastCheckInAt && !Number.isNaN(new Date(lastCheckInAt).getTime())
    ? new Date(lastCheckInAt)
    : checkOutDate;

  // Build candidate next shift start: start from the day of refDate at sh:sm
  const candidate = new Date(refDate);
  candidate.setHours(sh, sm, 0, 0);
  if (sh >= 18 && refDate.getHours() < 6) {
    candidate.setDate(candidate.getDate() - 1);
  }

  // Advance by 24h so it represents the NEXT shift after the one that started around refDate
  const nextShiftStart = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);

  // Allow check-in up to 2 hours before the next shift start,
  // but never earlier than 2 hours after check-out (or end of current shift window)
  const twoHoursBeforeNextShift = new Date(nextShiftStart.getTime() - 2 * 60 * 60 * 1000);
  const minCooldownMinutes = Math.max(120, Math.round((24 - shiftHours - 4) * 60));
  const minCooldownTime = new Date(checkOutDate.getTime() + Math.min(minCooldownMinutes, 360) * 60 * 1000);

  const unlockTime = twoHoursBeforeNextShift.getTime() > checkOutDate.getTime() + 60 * 60 * 1000
    ? twoHoursBeforeNextShift
    : minCooldownTime;

  const diffMs = unlockTime.getTime() - now.getTime();
  const windowOpenTimeStr = [unlockTime.getHours(), unlockTime.getMinutes()]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');

  if (diffMs <= 0) {
    return {
      canCheckIn: true,
      nextShiftStartStr: validStart,
      windowOpenTimeStr,
      remainingMinutes: 0,
      lockReasonArabic: '',
    };
  }

  const remainingMinutes = Math.ceil(diffMs / 60000);
  const remHours = Math.floor(remainingMinutes / 60);
  const remMins = remainingMinutes % 60;
  const remText =
    remHours > 0
      ? remMins > 0
        ? `${remHours} س و ${remMins} د`
        : `${remHours} ساعة`
      : `${remMins} دقيقة`;

  return {
    canCheckIn: false,
    nextShiftStartStr: validStart,
    windowOpenTimeStr,
    remainingMinutes,
    lockReasonArabic: `تم تسجيل الانصراف لهذا الشفت — يفتح تسجيل الحضور للشفت القادم (${validStart}) بداية من الساعة ${windowOpenTimeStr} (بعد ${remText})`,
  };
}

export type ScheduleWeekday = 'sat' | 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri';

export interface ScheduleWeekdayMeta {
  code: ScheduleWeekday;
  label: string;
  shortLabel: string;
  index: number;
}

export const SCHEDULE_WEEKDAYS: ReadonlyArray<ScheduleWeekdayMeta> = [
  { code: 'sat', label: 'السبت', shortLabel: 'سبت', index: 0 },
  { code: 'sun', label: 'الأحد', shortLabel: 'أحد', index: 1 },
  { code: 'mon', label: 'الاثنين', shortLabel: 'اثنين', index: 2 },
  { code: 'tue', label: 'الثلاثاء', shortLabel: 'ثلاثاء', index: 3 },
  { code: 'wed', label: 'الأربعاء', shortLabel: 'أربعاء', index: 4 },
  { code: 'thu', label: 'الخميس', shortLabel: 'خميس', index: 5 },
  { code: 'fri', label: 'الجمعة', shortLabel: 'جمعة', index: 6 },
];

const UTC_DAY_TO_SCHEDULE_WEEKDAY: Record<number, ScheduleWeekday> = {
  6: 'sat',
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
};

export function isScheduleWeekday(val: unknown): val is ScheduleWeekday {
  return typeof val === 'string' && SCHEDULE_WEEKDAYS.some((d) => d.code === val);
}

export function getScheduleWeekdayLabel(code: string): string {
  return SCHEDULE_WEEKDAYS.find((d) => d.code === code)?.label || String(code || '');
}

/**
 * Returns the YYYY-MM-DD calendar date in Africa/Cairo timezone so server (UTC)
 * and Egyptian branch clients agree on the active day.
 */
export function getCairoDateKey(date: Date = new Date()): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
      return formatted;
    }
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fallback below
  }
  return getLocalDateKey(date);
}

function resolveDateKeyOrCairoToday(dateKey?: string): string {
  const clean = typeof dateKey === 'string' ? dateKey.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : getCairoDateKey();
}

export function getWeekdayCodeFromDateKey(dateKey: string): ScheduleWeekday {
  const clean = resolveDateKeyOrCairoToday(dateKey);
  const [y, m, d] = clean.split('-').map(Number);
  const utcDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return UTC_DAY_TO_SCHEDULE_WEEKDAY[utcDay] || 'sat';
}

export function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const clean = resolveDateKeyOrCairoToday(dateKey);
  const [y, m, d] = clean.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Math.trunc(deltaDays || 0)));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function getSaturdayWeekStart(dateKey?: string): string {
  const clean = resolveDateKeyOrCairoToday(dateKey);
  const [y, m, d] = clean.split('-').map(Number);
  const utcDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const daysSinceSaturday = (utcDay + 1) % 7;
  return addDaysToDateKey(clean, -daysSinceSaturday);
}

export function shiftWeekStart(weekStartSaturday: string, deltaWeeks: number): string {
  const canonicalSat = getSaturdayWeekStart(weekStartSaturday);
  return addDaysToDateKey(canonicalSat, Math.trunc(deltaWeeks || 0) * 7);
}

export function getWeekDateKeys(weekStartSaturday: string): Record<ScheduleWeekday, string> {
  const sat = getSaturdayWeekStart(weekStartSaturday);
  return {
    sat,
    sun: addDaysToDateKey(sat, 1),
    mon: addDaysToDateKey(sat, 2),
    tue: addDaysToDateKey(sat, 3),
    wed: addDaysToDateKey(sat, 4),
    thu: addDaysToDateKey(sat, 5),
    fri: addDaysToDateKey(sat, 6),
  };
}

