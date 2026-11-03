#!/usr/bin/env node
/**
 * Builds catalog/actions.json and catalog/API-CATALOG.md from the Tulsi ERP
 * backend's source code: NestJS route metadata (path, method, guards, roles,
 * route arguments, param types), class-validator DTO rules and @nestjs/swagger
 * summaries/examples. catalog/overrides.json adds what code can't know:
 * friendly names, risk levels, exclusions, examples, synonyms.
 *
 *   node scripts/build-catalog.js [--backend ../RCRM_Backend]
 *
 * Needs the backend's node_modules (npm ci there). Loads controllers with
 * ts-node in transpile-only mode; nothing is started, nothing touches a DB.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argBackend = process.argv.indexOf('--backend');
const BACKEND = path.resolve(
  argBackend > -1 ? process.argv[argBackend + 1] : process.env.BACKEND_DIR || path.join(ROOT, '..', 'RCRM_Backend'),
);
const OUT_DIR = path.join(ROOT, 'catalog');

const backendRequire = (m) => require(require.resolve(m, { paths: [BACKEND] }));
backendRequire('ts-node').register({ transpileOnly: true, project: path.join(BACKEND, 'tsconfig.json') });
backendRequire('reflect-metadata');
// Controllers import services that read env at import time only through Nest DI, but be safe.
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const { getMetadataStorage } = backendRequire('class-validator');
let transformerStorage = null;
try {
  transformerStorage = backendRequire('class-transformer/cjs/storage').defaultMetadataStorage;
} catch {
  /* nested DTO types fall back to design:type */
}

const overrides = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'overrides.json'), 'utf8'));

// ---------- Nest constants (stable across Nest 8–10) ----------
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
const PARAM = { REQUEST: 0, RESPONSE: 1, NEXT: 2, BODY: 3, QUERY: 4, PARAM: 5, HEADERS: 6, FILE: 8, FILES: 9, IP: 11, RAW_BODY: 12 };

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

const joinPath = (...parts) =>
  '/' +
  parts
    .flatMap((p) => (Array.isArray(p) ? p[0] : p))
    .filter((p) => p !== undefined && p !== null && p !== '' && p !== '/')
    .map((p) => String(p).replace(/^\/+|\/+$/g, ''))
    .join('/');

const snake = (s) =>
  String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

// ---------- DTO → JSON Schema ----------
function enumValues(c) {
  if (Array.isArray(c?.[1])) return c[1];
  if (c?.[0] && typeof c[0] === 'object') return [...new Set(Object.values(c[0]).filter((v) => typeof v === 'string'))];
  return undefined;
}

function swaggerProp(dto, prop) {
  return Reflect.getMetadata('swagger/apiModelProperties', dto.prototype, prop) || {};
}

function primitiveFromCtor(t) {
  if (t === String) return { type: 'string' };
  if (t === Number) return { type: 'number' };
  if (t === Boolean) return { type: 'boolean' };
  if (t === Date) return { type: 'string', format: 'date-time' };
  if (t === Array) return { type: 'array' };
  return null;
}

function dtoSchema(dto, depth = 0) {
  if (!dto || typeof dto !== 'function' || depth > 4) return { type: 'object' };
  const prim = primitiveFromCtor(dto);
  if (prim) return prim;
  const metas = getMetadataStorage().getTargetValidationMetadatas(dto, null, false, false);
  const swaggerNames = (Reflect.getMetadata('swagger/apiModelPropertiesArray', dto.prototype) || []).map((n) =>
    String(n).replace(/^:/, ''),
  );
  const names = [...new Set([...metas.map((m) => m.propertyName), ...swaggerNames])];
  if (!names.length) return { type: 'object' };

  const properties = {};
  const required = [];
  for (const name of names) {
    const rules = metas.filter((m) => m.propertyName === name);
    const sw = swaggerProp(dto, name);
    const s = {};
    let optional = false;
    let conditional = false;
    let each = false;
    let nested = false;
    for (const r of rules) {
      if (r.type === 'conditionalValidation') {
        // @IsOptional and @ValidateIf share this type; IsOptional's name is "isOptional" (0.14) or has no name.
        if (r.name === 'isOptional' || !r.name) optional = true;
        else conditional = true;
        continue;
      }
      if (r.type === 'nestedValidation') {
        nested = true;
        if (r.each) each = true;
        continue;
      }
      if (r.type === 'isDefined') continue;
      if (r.each) each = true;
      const c = r.constraints || [];
      switch (r.name) {
        case 'isString':
          s.type = 'string';
          break;
        case 'isInt':
          s.type = 'integer';
          break;
        case 'isNumber':
        case 'isNumberString':
          s.type = 'number';
          break;
        case 'isBoolean':
        case 'isBooleanString':
          s.type = 'boolean';
          break;
        case 'isDateString':
        case 'isISO8601':
        case 'isDate':
          s.type = 'string';
          s.format = 'date-time';
          break;
        case 'isEmail':
          s.type = 'string';
          s.format = 'email';
          break;
        case 'isUUID':
          s.type = 'string';
          s.format = 'uuid';
          break;
        case 'isUrl':
        case 'isURL':
          s.type = 'string';
          s.format = 'uri';
          break;
        case 'isEnum':
          s.enum = enumValues(c);
          break;
        case 'isIn':
          s.enum = Array.isArray(c[0]) ? c[0] : undefined;
          break;
        case 'min':
          s.minimum = c[0];
          break;
        case 'max':
          s.maximum = c[0];
          break;
        case 'minLength':
          s.minLength = c[0];
          break;
        case 'maxLength':
          s.maxLength = c[0];
          break;
        case 'length':
          s.minLength = c[0];
          if (c[1] !== undefined) s.maxLength = c[1];
          break;
        case 'isNotEmpty':
          s.minLength = Math.max(s.minLength || 0, 1);
          break;
        case 'isArray':
          s.type = 'array';
          break;
        case 'arrayMaxSize':
          s.maxItems = c[0];
          break;
        case 'arrayMinSize':
          s.minItems = c[0];
          break;
        case 'isObject':
          s.type = 'object';
          break;
        case 'matches':
          if (c[0]) s.pattern = String(c[0]).replace(/^\/|\/[gimsuy]*$/g, '');
          break;
        case 'isPhoneNumber':
        case 'isMobilePhone':
          s.type = 'string';
          s.description = 'phone number';
          break;
        default:
          if (r.name && /password/i.test(r.name)) {
            s.type = 'string';
            s.format = 'password';
          }
      }
    }
    if (s.type === 'array' || each) {
      const item = { ...s };
      delete item.type;
      delete item.maxItems;
      delete item.minItems;
      if (nested) Object.assign(item, nestedType(dto, name, depth));
      s.type = 'array';
      for (const k of Object.keys(item)) if (k !== 'maxItems' && k !== 'minItems') delete s[k];
      s.type = 'array';
      s.items = Object.keys(item).length ? item : {};
      if (!s.items.type) {
        const swType = Array.isArray(sw.type) ? sw.type[0] : sw.type;
        Object.assign(s.items, primitiveFromCtor(swType) || {});
      }
    } else if (nested) {
      Object.assign(s, nestedType(dto, name, depth));
    }
    if (!s.type) {
      const swType = typeof sw.type === 'function' ? sw.type : undefined;
      const dt = swType || Reflect.getMetadata('design:type', dto.prototype, name);
      Object.assign(s, primitiveFromCtor(dt) || (dt && dt !== Object ? dtoSchema(dt, depth + 1) : {}));
      if (!s.type && Array.isArray(sw.enum)) s.type = 'string';
    }
    if (!s.enum && sw.enum) s.enum = Array.isArray(sw.enum) ? sw.enum : enumValues([sw.enum]);
    if (sw.description) s.description = sw.description;
    if (sw.example !== undefined) s.example = sw.example;
    if (sw.default !== undefined && s.default === undefined) s.default = sw.default;
    if (conditional) s.description = [s.description, 'required only in some cases (see the action description)'].filter(Boolean).join('; ');
    properties[name] = s;
    const swaggerRequired = sw.required !== false;
    if (!optional && !conditional && (rules.length ? true : swaggerRequired)) required.push(name);
  }
  const out = { type: 'object', properties, additionalProperties: false };
  if (required.length) out.required = required;
  return out;
}

function nestedType(dto, name, depth) {
  let t = null;
  if (transformerStorage) {
    const meta = transformerStorage.findTypeMetadata(dto, name);
    if (meta?.typeFunction) t = meta.typeFunction();
  }
  if (!t) t = Reflect.getMetadata('design:type', dto.prototype, name);
  if (!t || t === Array || t === Object) return { type: 'object' };
  return dtoSchema(t, depth + 1);
}

function exampleFor(schema) {
  if (!schema || schema.type !== 'object' || !schema.properties) return undefined;
  const ex = {};
  for (const [k, s] of Object.entries(schema.properties)) {
    const req = (schema.required || []).includes(k);
    if (s.example !== undefined) ex[k] = s.example;
    else if (!req) continue;
    else if (s.enum) ex[k] = s.enum[0];
    else if (s.type === 'integer' || s.type === 'number') ex[k] = s.minimum ?? 1;
    else if (s.type === 'boolean') ex[k] = true;
    else if (s.type === 'array') ex[k] = [];
    else if (s.format === 'date-time') ex[k] = '2026-11-05T11:00:00+05:30';
    else if (s.format === 'email') ex[k] = 'name@example.com';
    else if (s.type === 'object') ex[k] = exampleFor(s) || {};
    else ex[k] = '…';
  }
  return Object.keys(ex).length ? ex : undefined;
}

// ---------- Walk controllers ----------
const files = walk(path.join(BACKEND, 'src')).sort();
const actions = [];
const flags = [];
for (const file of files) {
  const mod = require(file);
  for (const Ctrl of Object.values(mod)) {
    if (typeof Ctrl !== 'function' || Reflect.getMetadata('__controller__', Ctrl) !== true) continue;
    const base = Reflect.getMetadata('path', Ctrl);
    const classGuards = (Reflect.getMetadata('__guards__', Ctrl) || []).map((g) => g.name);
    const classRoles = Reflect.getMetadata('roles', Ctrl);
    const proto = Ctrl.prototype;
    for (const methodName of Object.getOwnPropertyNames(proto)) {
      if (methodName === 'constructor') continue;
      const handler = proto[methodName];
      if (typeof handler !== 'function') continue;
      const methodIdx = Reflect.getMetadata('method', handler);
      if (methodIdx === undefined) continue;
      const method = METHODS[methodIdx];
      const routePath = joinPath(base, Reflect.getMetadata('path', handler));
      const guards = [...classGuards, ...(Reflect.getMetadata('__guards__', handler) || []).map((g) => g.name)];
      const roles = Reflect.getMetadata('roles', handler) ?? classRoles;
      const op = Reflect.getMetadata('swagger/apiOperation', handler) || {};
      const args = Reflect.getMetadata('__routeArguments__', Ctrl, methodName) || {};
      const types = Reflect.getMetadata('design:paramtypes', proto, methodName) || [];
      const headers = (Reflect.getMetadata('__headers__', handler) || []).map((h) => `${h.name}: ${h.value}`);

      const pathParams = {};
      const query = { type: 'object', properties: {}, additionalProperties: false };
      let body = null;
      let multipart = false;
      let rawResponse = false;
      for (const [key, arg] of Object.entries(args)) {
        const kind = Number(key.split(':')[0]);
        if (Number.isNaN(kind)) continue; // custom decorator (@CurrentUser)
        const t = types[arg.index];
        if (kind === PARAM.PARAM) {
          if (arg.data) pathParams[arg.data] = { type: 'string' };
        } else if (kind === PARAM.QUERY) {
          if (arg.data) query.properties[arg.data] = primitiveFromCtor(t) || { type: 'string' };
          else {
            const s = dtoSchema(t);
            Object.assign(query.properties, s.properties || {});
            if (s.required) query.required = [...(query.required || []), ...s.required];
          }
        } else if (kind === PARAM.BODY) {
          if (arg.data) {
            body = body || { type: 'object', properties: {}, required: [], additionalProperties: false };
            body.properties[arg.data] = primitiveFromCtor(t) || { type: 'string' };
            body.required.push(arg.data);
          } else body = dtoSchema(t);
        } else if (kind === PARAM.FILE || kind === PARAM.FILES) multipart = true;
        else if (kind === PARAM.RESPONSE) rawResponse = true;
      }
      for (const name of (routePath.match(/:([A-Za-z0-9_]+)/g) || []).map((p) => p.slice(1))) {
        pathParams[name] = pathParams[name] || { type: 'string' };
      }

      const source = `${path.relative(BACKEND, file).replace(/\\/g, '/')} → ${Ctrl.name}.${methodName}`;
      const isPublic = !guards.includes('JwtAuthGuard');
      const rolesArr = Array.isArray(roles) && roles.length ? roles : null;
      if (rolesArr && !guards.includes('RolesGuard')) flags.push(`${method} ${routePath}: @Roles(${rolesArr.join(', ')}) declared but RolesGuard is not applied`);

      actions.push({
        key: `${method} ${routePath}`,
        name: snake(`${Ctrl.name.replace(/Controller$/, '')}_${methodName}`),
        kind: method === 'GET' ? 'read' : method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update',
        method,
        path: routePath,
        summary: op.summary || '',
        description: op.description || '',
        module: routePath.split('/')[1] || '',
        source,
        auth: isPublic ? 'public' : 'signed-in',
        roles: rolesArr ? rolesArr.filter((r) => r !== 'SUPER_ADMIN') : 'any signed-in user (the service may narrow it)',
        rolesDeclared: rolesArr,
        pathParams,
        query: Object.keys(query.properties).length ? query : null,
        body: body && body.properties && Object.keys(body.properties).length ? body : null,
        bodyType: multipart ? 'multipart' : body ? 'json' : null,
        _rawResponse: rawResponse,
        _headers: headers,
      });
    }
  }
}

// ---------- Exclusions, overrides, risk ----------
const rules = overrides.excludeRules || [];
const per = overrides.actions || {};
const seenNames = new Map();
for (const a of actions) {
  const o = per[a.key] || {};
  let reason = null;
  if (a.auth === 'public') reason = a.path.startsWith('/webhooks') ? 'webhook (public, called by Meta / relays)' : 'public route';
  else if (Array.isArray(a.roles) && a.roles.length === 0) reason = 'super-admin only (super admins never connect)';
  else if (a.bodyType === 'multipart') reason = 'file upload (chats cannot send files reliably yet)';
  else if (a._rawResponse || a._headers.some((h) => /content-disposition|spreadsheetml/i.test(h))) reason = 'file download';
  if (!reason) {
    for (const r of rules) {
      if (new RegExp(r.match).test(a.key)) {
        reason = r.reason;
        break;
      }
    }
  }
  if (o.exclude) reason = o.exclude;
  a.exposed = !reason;
  if (reason) a.excludedReason = reason;
  if (o.sessionOnly) a.sessionOnly = true;

  if (o.name) a.name = o.name;
  if (o.summary) a.summary = o.summary;
  if (o.description) a.description = o.description;
  if (o.examples) a.examples = o.examples;
  if (o.labelFields) a.labelFields = o.labelFields;
  if (o.idHints) for (const [p, hint] of Object.entries(o.idHints)) if (a.pathParams[p]) a.pathParams[p].description = hint;
  if (o.queryDescriptions && a.query)
    for (const [p, d] of Object.entries(o.queryDescriptions)) if (a.query.properties[p]) a.query.properties[p].description = d;
  if (o.bodyDescriptions && a.body)
    for (const [p, d] of Object.entries(o.bodyDescriptions)) if (a.body.properties[p]) a.body.properties[p].description = d;
  if (o.hideQuery && a.query) for (const p of o.hideQuery) delete a.query.properties[p];
  if (o.generatedFields) a.generatedFields = o.generatedFields;
  if (o.units) a.units = o.units;
  if (o.warning) a.warning = o.warning;
  if (o.warnings) a.warnings = o.warnings;
  if (o.note) a.note = o.note;
  if (o.list) a.list = o.list;
  if (o.labelFrom) a.labelFrom = o.labelFrom;
  if (o.kind) a.kind = o.kind;

  if (a.kind === 'read') a.risk = null;
  else a.risk = o.risk || (a.method === 'DELETE' ? 'high' : 'normal');

  if (a.exposed && a.body) a.exampleBody = o.exampleBody || exampleFor(a.body);
  if (a.exposed && !o.name && a.exposed) a.nameAutoGenerated = true;
  if (seenNames.has(a.name)) a.name = `${a.name}_${snake(a.method)}`;
  seenNames.set(a.name, a.key);
  delete a._rawResponse;
  delete a._headers;
}

actions.sort((x, y) => x.module.localeCompare(y.module) || x.path.localeCompare(y.path) || x.method.localeCompare(y.method));

const exposed = actions.filter((a) => a.exposed);
const byReason = {};
for (const a of actions.filter((x) => !x.exposed)) byReason[a.excludedReason] = (byReason[a.excludedReason] || 0) + 1;
const byRisk = {};
for (const a of exposed) {
  const k = a.kind === 'read' ? 'read' : a.risk;
  byRisk[k] = (byRisk[k] || 0) + 1;
}

const catalog = {
  generatedAt: new Date().toISOString(),
  generator: 'scripts/build-catalog.js',
  backend: path.basename(BACKEND),
  totals: { routes: actions.length, exposed: exposed.length, excluded: actions.length - exposed.length, byRisk, excludedByReason: byReason },
  synonyms: overrides.synonyms || {},
  backendFlags: flags,
  actions,
};
fs.writeFileSync(path.join(OUT_DIR, 'actions.json'), JSON.stringify(catalog, null, 2) + '\n');

// ---------- Markdown ----------
const md = [];
md.push('# Tulsi ERP API catalog', '', "> Generated, don't edit by hand. Run `node scripts/build-catalog.js`; human parts live in `catalog/overrides.json`.", '');
md.push(`Generated ${catalog.generatedAt} from \`${catalog.backend}\`.`, '');
md.push(`**${actions.length} routes**: ${exposed.length} exposed, ${actions.length - exposed.length} excluded.`, '');
md.push('| Exposed by kind/risk | Count |', '|---|---:|');
for (const [k, v] of Object.entries(byRisk)) md.push(`| ${k} | ${v} |`);
md.push('', '| Excluded because | Count |', '|---|---:|');
for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |`);
if (flags.length) md.push('', '## Backend flags', '', ...flags.map((f) => `- ${f}`));
const modules = [...new Set(actions.map((a) => a.module))];
for (const m of modules) {
  md.push('', `## ${m}`, '', '| Action | Route | Kind | Risk | Roles | Summary |', '|---|---|---|---|---|---|');
  for (const a of actions.filter((x) => x.module === m)) {
    const roles = Array.isArray(a.roles) ? a.roles.join(', ') : 'any';
    const name = a.exposed ? `\`${a.name}\`` : `~~${a.name}~~ — ${a.excludedReason}`;
    md.push(`| ${name} | \`${a.method} ${a.path}\` | ${a.kind} | ${a.risk || ''} | ${roles} | ${(a.summary || '').replace(/\|/g, '\\|')} |`);
  }
}
fs.writeFileSync(path.join(OUT_DIR, 'API-CATALOG.md'), md.join('\n') + '\n');

console.log(`routes ${actions.length}, exposed ${exposed.length}, excluded ${actions.length - exposed.length}`);
console.log('exposed by kind/risk', byRisk);
console.log('excluded by reason', byReason);
const auto = exposed.filter((a) => a.nameAutoGenerated).map((a) => `${a.key} → ${a.name}`);
if (auto.length) console.log(`\n${auto.length} exposed actions still have generated names:\n  ` + auto.join('\n  '));
if (flags.length) console.log('\nbackend flags:\n  ' + flags.join('\n  '));
process.exit(0);
