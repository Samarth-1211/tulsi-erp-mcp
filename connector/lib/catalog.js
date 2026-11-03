'use strict';
/**
 * The private action catalog (catalog/actions.json): role filtering, input
 * schemas, validation, request building and search. The backend still
 * enforces everything; this only keeps the assistant on the right path.
 */
const fs = require('fs');
const { normalizeDateTime } = require('./format');

const stem = (w) => w.replace(/ies$/, 'y').replace(/(ss|sh|ch|x)es$/, '$1').replace(/([^s])s$/, '$1');
const words = (s) =>
  String(s || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1)
    .map(stem);

class Catalog {
  constructor(file, { writeLevels = ['low', 'normal'] } = {}) {
    this.file = file;
    this.writeLevels = writeLevels;
    this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.actions = this.data.actions.filter((a) => a.exposed);
    this.byName = new Map(this.actions.map((a) => [a.name, a]));
    this.synonyms = {};
    for (const [k, v] of Object.entries(this.data.synonyms || {})) this.synonyms[stem(k.toLowerCase())] = v.map((w) => stem(w.toLowerCase()));
    this.index = new Map(
      this.actions.map((a) => [
        a.name,
        {
          name: new Set(words(a.name.replace(/_/g, ' '))),
          text: new Set(words([a.name.replace(/_/g, ' '), a.summary, a.description, a.path, a.module, ...(a.examples || [])].join(' '))),
        },
      ]),
    );
  }

  get generatedAt() {
    return this.data.generatedAt;
  }

  roleAllowed(a, role) {
    return !Array.isArray(a.roles) || a.roles.includes(role);
  }

  levelAllowed(a) {
    return a.kind === 'read' || this.writeLevels.includes(a.risk);
  }

  forRole(role) {
    return this.actions.filter((a) => this.roleAllowed(a, role) && this.levelAllowed(a));
  }

  /** → {action} or {error}. */
  find(name, role) {
    const a = this.byName.get(String(name || ''));
    if (!a) return { error: `There is no action called "${name}". Use search_erp_actions to find the right one.` };
    if (!this.roleAllowed(a, role)) return { error: `Your role (${role}) can't use ${a.name}; it is for ${a.roles.join(', ')}.` };
    if (!this.levelAllowed(a)) return { error: `${a.name} is a ${a.risk}-risk change that is switched off for connected assistants. Do it in the Tulsi ERP app.` };
    return { action: a };
  }

  /** One flat object: path params and query params at the top level, the JSON body under "body". */
  inputSchema(a) {
    const properties = {};
    const required = [];
    for (const [k, s] of Object.entries(a.pathParams || {})) {
      properties[k] = { type: 'string', description: s.description || `the ${k}` };
      required.push(k);
    }
    for (const [k, s] of Object.entries(a.query?.properties || {})) properties[k] = plain(s);
    for (const k of a.query?.required || []) if (!required.includes(k)) required.push(k);
    if (a.body) {
      const body = plain(a.body);
      for (const g of a.generatedFields || []) {
        delete body.properties?.[g];
        if (body.required) body.required = body.required.filter((r) => r !== g);
      }
      properties.body = body;
      if (body.required?.length) required.push('body');
    }
    const schema = { type: 'object', properties, additionalProperties: false };
    if (required.length) schema.required = required;
    return schema;
  }

  validate(a, params) {
    const errors = [];
    check(this.inputSchema(a), params ?? {}, '', errors, true);
    return errors;
  }

  /** params → {method, path, query, body}. Date-times without a zone are business time (+05:30). */
  buildRequest(a, params = {}) {
    let path = a.path;
    for (const k of Object.keys(a.pathParams || {})) path = path.replace(`:${k}`, encodeURIComponent(String(params[k])));
    let query;
    for (const k of Object.keys(a.query?.properties || {})) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') (query = query || {})[k] = normalizeValue(a.query.properties[k], params[k]);
    }
    let body;
    if (a.body) {
      body = { ...(params.body || {}) };
      for (const g of a.generatedFields || []) delete body[g];
      body = normalizeObject(a.body, body);
    }
    return { method: a.method, path, query, body };
  }

  search(query, role, { kind, limit = 8 } = {}) {
    const q = words(query);
    const terms = new Set(q);
    for (const w of q) for (const s of this.synonyms[w] || []) terms.add(s);
    const scored = [];
    for (const a of this.forRole(role)) {
      if (kind && a.kind !== kind) continue;
      const idx = this.index.get(a.name);
      let score = 0;
      for (const w of terms) {
        if (idx.name.has(w)) score += 3;
        if (idx.text.has(w)) score += 1;
      }
      if (score > 0) scored.push({ a, score });
    }
    scored.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name));
    return scored.slice(0, Math.max(1, Math.min(15, limit))).map(({ a }) => this.describe(a));
  }

  describe(a) {
    const desc = [a.summary, a.description].filter(Boolean).join(' — ');
    return {
      action: a.name,
      kind: a.kind,
      ...(a.kind === 'read' ? {} : { risk: a.risk }),
      route: `${a.method} ${a.path}`,
      description: desc.length > 400 ? `${desc.slice(0, 397)}…` : desc,
      roles: Array.isArray(a.roles) ? a.roles : 'any signed-in user',
      input: this.inputSchema(a),
      ...(a.exampleBody ? { exampleBody: a.exampleBody } : {}),
    };
  }

  /** The read that shows the record a change targets: the longest GET path that prefixes the change's path. */
  recordReadFor(a, role) {
    let best = null;
    for (const r of this.forRole(role)) {
      if (r.method !== 'GET' || r.kind !== 'read' || r.query?.required?.length) continue;
      if (!(a.path === r.path || a.path.startsWith(`${r.path}/`))) continue;
      if (!Object.keys(r.pathParams || {}).length) continue;
      if (!best || r.path.length > best.path.length) best = r;
    }
    return best;
  }
}

/** Strips generator-only keys so the schema stays plain JSON Schema (Gemini-safe). */
function plain(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const k of ['type', 'enum', 'format', 'description', 'minimum', 'maximum', 'minLength', 'maxLength', 'maxItems', 'minItems', 'default', 'required', 'additionalProperties']) {
    if (s[k] !== undefined) out[k] = s[k];
  }
  if (out.format === 'date-time') {
    delete out.format;
    out.description = [out.description, 'ISO date (YYYY-MM-DD) or date-time; times are Asia/Kolkata, e.g. 2026-11-05T11:00:00+05:30'].filter(Boolean).join('; ');
  }
  if (s.example !== undefined && !out.description?.includes('e.g.')) out.description = [out.description, `e.g. ${JSON.stringify(s.example)}`].filter(Boolean).join('; ');
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, plain(v)]));
  if (s.items) out.items = plain(s.items);
  if (out.type === 'object' && out.additionalProperties === undefined && s.properties) out.additionalProperties = false;
  return out;
}

const isDateTimeSchema = (s) => s?.format === 'date-time';

function normalizeValue(s, v) {
  if (isDateTimeSchema(s)) return normalizeDateTime(v);
  if ((s?.type === 'integer' || s?.type === 'number') && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (s?.type === 'boolean' && (v === 'true' || v === 'false')) return v === 'true';
  return v;
}

function normalizeObject(schema, obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const s = schema?.properties?.[k];
    if (Array.isArray(v)) out[k] = v.map((x) => (s?.items?.properties ? normalizeObject(s.items, x) : normalizeValue(s?.items, x)));
    else if (v && typeof v === 'object') out[k] = normalizeObject(s, v);
    else out[k] = normalizeValue(s, v);
  }
  return out;
}

/** Small JSON Schema check: type, enum, required, additionalProperties:false, min/max, nested objects/arrays. */
function check(s, v, at, errors, top = false) {
  const where = at || 'params';
  if (v === null) return; // null clears a field in Tulsi ERP
  if (s.enum && !s.enum.includes(v)) {
    errors.push(`${where} must be one of ${s.enum.join(', ')}`);
    return;
  }
  const t = s.type;
  if (t === 'object') {
    if (typeof v !== 'object' || Array.isArray(v)) return errors.push(`${where} must be an object`);
    for (const r of s.required || []) if (v[r] === undefined) errors.push(`${at ? at + '.' : ''}${r} is required`);
    for (const [k, val] of Object.entries(v)) {
      const ps = s.properties?.[k];
      if (!ps) {
        if (s.additionalProperties === false) errors.push(`${at ? at + '.' : ''}${k} is not an allowed field${top ? '' : ` here`}`);
        continue;
      }
      check(ps, val, `${at ? at + '.' : ''}${k}`, errors);
    }
    return;
  }
  if (t === 'array') {
    if (!Array.isArray(v)) return errors.push(`${where} must be a list`);
    if (s.maxItems !== undefined && v.length > s.maxItems) errors.push(`${where} can have at most ${s.maxItems} items`);
    if (s.minItems !== undefined && v.length < s.minItems) errors.push(`${where} needs at least ${s.minItems} items`);
    if (s.items) v.forEach((item, i) => check(s.items, item, `${where}[${i}]`, errors));
    return;
  }
  if (t === 'integer' || t === 'number') {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || Number.isNaN(n) || (t === 'integer' && !Number.isInteger(n))) return errors.push(`${where} must be ${t === 'integer' ? 'a whole number' : 'a number'}`);
    if (s.minimum !== undefined && n < s.minimum) errors.push(`${where} must be at least ${s.minimum}`);
    if (s.maximum !== undefined && n > s.maximum) errors.push(`${where} must be at most ${s.maximum}`);
    return;
  }
  if (t === 'boolean') {
    if (typeof v !== 'boolean' && v !== 'true' && v !== 'false') errors.push(`${where} must be true or false`);
    return;
  }
  if (t === 'string') {
    if (typeof v !== 'string' && typeof v !== 'number') return errors.push(`${where} must be text`);
    const len = String(v).length;
    if (s.minLength !== undefined && len < s.minLength) errors.push(`${where} must not be empty`);
    if (s.maxLength !== undefined && len > s.maxLength) errors.push(`${where} can be at most ${s.maxLength} characters`);
  }
}

module.exports = { Catalog, words };
