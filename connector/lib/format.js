'use strict';
/**
 * Dates, numbers and units the way Tulsi Plywood works: business timezone
 * Asia/Kolkata (fixed +05:30, no DST), Indian digit grouping (12,34,567).
 * Tulsi ERP sends no money at all, so there is no currency formatting here.
 */

const TZ = 'Asia/Kolkata';
const OFFSET = '+05:30';
const OFFSET_MS = 330 * 60_000;

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD of the business day `date` falls on. */
function businessDate(date = new Date()) {
  const d = new Date(date.getTime() + OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday-based weekday 0..6 of a YYYY-MM-DD. */
const weekday = (ymd) => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;

/** Named periods → {from, to} as business-day YYYY-MM-DD (inclusive). */
function period(name, now = new Date()) {
  const today = businessDate(now);
  const [y, m] = today.split('-').map(Number);
  const monthStart = (yy, mm) => `${yy}-${pad(mm)}-01`;
  const prevMonth = m === 1 ? [y - 1, 12] : [y, m - 1];
  switch (String(name || '').toLowerCase()) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'this_week':
      return { from: addDays(today, -weekday(today)), to: today };
    case 'last_week': {
      const start = addDays(today, -weekday(today) - 7);
      return { from: start, to: addDays(start, 6) };
    }
    case 'last_7_days':
      return { from: addDays(today, -6), to: today };
    case 'last_30_days':
      return { from: addDays(today, -29), to: today };
    case 'this_month':
      return { from: monthStart(y, m), to: today };
    case 'last_month':
      return { from: monthStart(...prevMonth), to: addDays(monthStart(y, m), -1) };
    case 'this_year':
      return { from: `${y}-01-01`, to: today };
    case 'all':
      return { from: undefined, to: undefined };
    default:
      return null;
  }
}

/**
 * An input date-time without a zone ("2026-11-05T11:00") means business time:
 * add +05:30 so Tulsi ERP stores the right instant. Values with Z/offset and
 * plain dates pass through.
 */
function normalizeDateTime(value) {
  if (typeof value !== 'string') return value;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v)) {
    return `${v.replace(' ', 'T')}${v.length === 16 ? ':00' : ''}${OFFSET}`;
  }
  return v;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * An ISO instant from the API shown in business time:
 * "2026-11-05T05:30:00.000Z" → "2026-11-05T11:00+05:30". Values at exactly
 * UTC midnight are @db.Date columns (attendance day, leave dates) → "2026-11-05".
 */
function toBusinessTime(value) {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return value;
  if (/T00:00:00(\.0+)?Z$/.test(value)) return value.slice(0, 10);
  const d = new Date(new Date(value).getTime() + OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${OFFSET}`;
}

const spoken = new Intl.DateTimeFormat('en-IN', {
  timeZone: TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
/** "2026-11-09T11:00:00+05:30" → "Mon, 9 Nov 2026, 11:00 am IST" — lets the user check a time in a draft. */
function describeInstant(value) {
  const d = new Date(normalizeDateTime(value));
  return Number.isNaN(d.getTime()) ? String(value) : `${spoken.format(d)} IST`;
}

const groupIN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
/** 1234567 → "12,34,567". */
const formatNumber = (n) => (typeof n === 'number' && Number.isFinite(n) ? groupIN.format(n) : String(n));

/** 50, "SHEET" → "50 sheets". */
function formatQuantity(n, unit) {
  const u = String(unit || '').toLowerCase();
  const plural = { sheet: 'sheets', piece: 'pieces', box: 'boxes', sqft: 'sq ft', kg: 'kg' }[u] || u;
  const singular = { sheet: 'sheet', piece: 'piece', box: 'box', sqft: 'sq ft', kg: 'kg' }[u] || u;
  return `${formatNumber(n)}${u ? ' ' + (Math.abs(n) === 1 ? singular : plural) : ''}`;
}

module.exports = { TZ, OFFSET, businessDate, addDays, period, normalizeDateTime, toBusinessTime, describeInstant, formatNumber, formatQuantity };
