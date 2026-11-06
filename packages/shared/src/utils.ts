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
