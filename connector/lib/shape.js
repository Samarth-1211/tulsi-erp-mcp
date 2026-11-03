'use strict';
/**
 * Answer shaping: keeps tool results small (Free-plan friendly) and keeps
 * counts right. Lists become {total, summary, totals, shown, rows, note}
 * where total comes from Tulsi ERP and summary counts cover every filtered
 * row, never only the rows shown.
 */
const { toBusinessTime, formatQuantity } = require('./format');

/** Never sent to an assistant: secrets, and money (Tulsi ERP shows no money). */
const SECRET_KEY =
  /^(password\w*|tempPassword|accessToken|refreshToken|apiKey|apiSecret|appSecret|\w*Encrypted|encryptedSecrets|webhookSecret|webhookToken|webhookUrl|verifyToken|otp|tokenHash|sheetUrl|spreadsheetId|mediaStorageKey|rawPayload|searchKey|price|costPrice|estimatedValue|autoAllotMinValue|vapid\w*)$/i;
const NOISY_KEY = /^(orgId|deletedAt|updatedAt)$/;
const SUMMARY_SKIP =
  /(^id$|Id$|Ids$|At$|^date$|Date$|phone|Phone|email|Email|^name$|Name$|note|Note|description|Description|message|Message|summary|Summary|address|feedback|requirement|pincode|title|Title|reason|Reason|url|Url|photo|customFields|meta|^lat$|^lng$|_count|code|Code|^text$|body|Minutes$)/;
const LIST_KEYS = ['items', 'data', 'results', 'rows', 'leads', 'users', 'tasks', 'members', 'trips', 'products'];
const MAX_STRING = 1500;
const MAX_DEPTH = 6;
const MAX_JSON = 40_000;

function clean(value, depth = 0) {
  if (depth > MAX_DEPTH) return '…';
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) || NOISY_KEY.test(k) || v === null || v === undefined) continue;
      out[k] = clean(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') {
    const v = toBusinessTime(value);
    return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v;
  }
  return value;
}

/** A response → {rows, meta} when it is a list, else null. */
function listOf(data) {
  if (Array.isArray(data)) return { rows: data, meta: {} };
  if (data && typeof data === 'object') {
    for (const k of LIST_KEYS) {
      if (Array.isArray(data[k])) {
        const meta = {};
        for (const [mk, mv] of Object.entries(data)) if (mk !== k && (mv === null || typeof mv !== 'object')) meta[mk] = mv;
        return { rows: data[k], meta, key: k };
      }
    }
  }
  return null;
}

/** Display value of a field for counting: nested objects by their name. */
function categoryOf(v) {
  if (v === null || v === undefined || v === '') return '(none)';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v.length <= 60 ? v : null;
  if (typeof v === 'number') return null;
  if (typeof v === 'object' && !Array.isArray(v)) return v.name || v.title || v.fullName || v.email || null;
  return null;
}

function summarize(rows) {
  if (!rows.length) return {};
  const keys = new Set();
  for (const r of rows.slice(0, 200)) if (r && typeof r === 'object') for (const k of Object.keys(r)) keys.add(k);
  const summary = {};
  for (const k of keys) {
    if (SUMMARY_SKIP.test(k) || SECRET_KEY.test(k) || NOISY_KEY.test(k)) continue;
    const counts = new Map();
    let present = 0;
    let usable = true;
    for (const r of rows) {
      if (!r || !(k in r)) continue;
      present += 1;
      const c = categoryOf(r[k]);
      if (c === null) {
        usable = false;
        break;
      }
      counts.set(c, (counts.get(c) || 0) + 1);
      if (counts.size > 15) {
        usable = false;
        break;
      }
    }
    if (!usable || present < rows.length / 2 || counts.size < 1) continue;
    if (counts.size === rows.length && rows.length > 3) continue; // every row different: not a category
    summary[k] = Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]));
  }
  return summary;
}

/** Sum of quantity fields per unit: {stock: {SHEET: 1200}, stockText: "1,200 sheets"}. */
function quantityTotals(rows, fields = [], unitField) {
  if (!fields.length) return undefined;
  const out = {};
  for (const f of fields) {
    const byUnit = {};
    for (const r of rows) {
      const n = Number(r?.[f]);
      if (!Number.isFinite(n)) continue;
      const u = (unitField && r[unitField]) || 'units';
      byUnit[u] = (byUnit[u] || 0) + n;
    }
    if (Object.keys(byUnit).length) {
      out[f] = byUnit;
      out[`${f}Text`] = Object.entries(byUnit)
        .map(([u, n]) => formatQuantity(n, u === 'units' ? '' : u))
        .join(' · ');
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function fieldValue(row, key) {
  if (!row || typeof row !== 'object') return undefined;
  if (key.includes('.')) return key.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), row);
  if (key in row) return row[key];
  const lower = key.toLowerCase();
  const k = Object.keys(row).find((x) => x.toLowerCase() === lower);
  return k ? row[k] : undefined;
}

function valueMatches(v, cond) {
  if (Array.isArray(cond)) return cond.some((c) => valueMatches(v, c));
  if (cond === null) return v === null || v === undefined;
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.some((x) => valueMatches(x, cond));
  if (typeof v === 'object') return ['name', 'title', 'fullName', 'email', 'id', 'status'].some((k) => v[k] !== undefined && valueMatches(v[k], cond));
  if (typeof cond === 'string' && typeof v === 'string') return v.toLowerCase().includes(cond.trim().toLowerCase());
  return String(v).toLowerCase() === String(cond).toLowerCase();
}

const rowMatches = (row, where) => Object.entries(where).every(([k, c]) => valueMatches(fieldValue(row, k), c));

/**
 * rows → the list answer. serverTotal: Tulsi ERP's own total; scanned: how
 * many rows we actually fetched (less than serverTotal when the scan cap hit).
 */
function shapeList(rows, { limit = 20, where, serverTotal, meta, quantityFields, unitField } = {}) {
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));
  const hasWhere = where && typeof where === 'object' && Object.keys(where).length > 0;
  const filtered = hasWhere ? rows.filter((r) => rowMatches(r, where)) : rows;
  const knownTotal = typeof serverTotal === 'number' ? serverTotal : rows.length;
  const partial = rows.length < knownTotal;
  const out = {};
  out.total = hasWhere ? filtered.length : knownTotal;
  if (hasWhere) out.totalBeforeFilter = knownTotal;
  const m = { ...(meta || {}) };
  delete m.total;
  delete m.page;
  delete m.pageSize;
  if (Object.keys(m).length) out.meta = clean(m);
  out.summary = summarize(filtered);
  const totals = quantityTotals(filtered, quantityFields, unitField);
  if (totals) out.totals = totals;
  let shown = filtered.slice(0, lim).map((r) => clean(r));
  while (shown.length > 1 && JSON.stringify(shown).length > MAX_JSON) shown = shown.slice(0, Math.ceil(shown.length / 2));
  out.shown = shown.length;
  out.rows = shown;
  const notes = [];
  if (partial) notes.push(`Only the first ${rows.length} of ${knownTotal} records were scanned, so "summary"${hasWhere ? ', "total"' : ''}${totals ? ' and "totals"' : ''} cover those ${rows.length} only. Use the action's own filters (status, from/to, search…) to narrow it.`);
  if (shown.length < out.total) notes.push(`Showing ${shown.length} of ${out.total}. Narrow with "where" or raise "limit" (max 100).`);
  if (notes.length) out.note = notes.join(' ');
  return out;
}

/** Any response → a shaped answer: lists via shapeList, everything else cleaned. */
function shape(data, opts = {}) {
  const list = listOf(data);
  if (list) {
    const serverTotal = typeof list.meta.total === 'number' ? list.meta.total : opts.serverTotal;
    return shapeList(list.rows, { ...opts, serverTotal, meta: list.meta });
  }
  return clean(data);
}

const STATUS_MEANING = {
  0: "Tulsi ERP can't be reached right now.",
  400: 'Tulsi ERP rejected the input.',
  401: 'The sign-in is no longer valid.',
  403: "The user's role isn't allowed to do this.",
  404: 'Not found, or not visible to this user.',
  409: 'This conflicts with the current state (for example it was already done).',
  413: 'The request is too large.',
  422: 'A business rule failed.',
  429: 'Too many attempts. Wait a minute and try again.',
  503: "Tulsi ERP can't do this right now.",
};

function errorResult(r) {
  return {
    error: STATUS_MEANING[r.status] || (r.status >= 500 ? 'Tulsi ERP had a problem. Try again later.' : `Tulsi ERP answered ${r.status}.`),
    status: r.status,
    ...(r.message ? { details: r.message } : {}),
  };
}

module.exports = { clean, listOf, summarize, shapeList, shape, errorResult, rowMatches, quantityTotals };
