#!/usr/bin/env node
'use strict';
/**
 * Tulsi ERP MCP connector: one remote MCP server (Streamable HTTP, plain JSON
 * responses) with its own OAuth sign-in, for Claude, ChatGPT, Gemini and any
 * other assistant that speaks remote MCP. No npm dependencies.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { send, sendHtml, readBody, CORS } = require('./lib/http');
const { Store } = require('./lib/store');
const { Backend } = require('./lib/backend');
const { Clients, DEFAULT_REDIRECT_HOSTS } = require('./lib/clients');
const { OAuth } = require('./lib/oauth');
const { Catalog } = require('./lib/catalog');
const { Tools, INSTRUCTIONS } = require('./lib/tools');
const pages = require('./lib/pages');

const VERSION = '1.0.0';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const ROOT = path.resolve(__dirname, '..');

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const dataDir = path.resolve(env.DATA_DIR || path.join(__dirname, 'data'));
  let secret = env.CONNECTOR_SECRET || '';
  if (!secret && !production) {
    // Development only: a generated key kept next to the state file.
    fs.mkdirSync(dataDir, { recursive: true });
    const keyFile = path.join(dataDir, '.connector-secret');
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    secret = fs.readFileSync(keyFile, 'utf8').trim();
  }
  const list = (v, d) => (v ? v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : d);
  const cfg = {
    production,
    port: Number(env.PORT || 8790),
    host: env.HOST || '0.0.0.0',
    publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
    apiUrl: env.API_URL || 'http://localhost:3000',
    toolMode: env.TOOL_MODE === 'direct' ? 'direct' : 'catalog',
    accessTtlSeconds: Number(env.ACCESS_TTL_SECONDS || 3600),
    allowedRedirectHosts: list(env.ALLOWED_REDIRECT_HOSTS, DEFAULT_REDIRECT_HOSTS),
    cimdEnabled: env.CIMD_ENABLED !== 'false',
    dataDir,
    secret,
    catalogFile: path.resolve(env.CATALOG_FILE || path.join(ROOT, 'catalog', 'actions.json')),
    writeLevels: list(env.WRITE_LEVELS, ['low', 'normal']).filter((l) => ['low', 'normal', 'high'].includes(l)),
    badge: env.BADGE || '',
    signinHint: env.SIGNIN_HINT || '',
    quiet: env.QUIET === 'true' || env.QUIET === '1',
    trustProxy: Number(env.TRUST_PROXY ?? (production ? 1 : 0)) || 0,
    listScanCap: Number(env.LIST_SCAN_CAP || 1000),
    statsScanCap: Number(env.STATS_SCAN_CAP || 5000),
    testCimdInsecure: !production && env.TEST_ALLOW_INSECURE_CIMD === '1',
  };
  if (production) {
    const problems = [];
    if (cfg.secret.length < 32) problems.push('CONNECTOR_SECRET must be 32+ characters (openssl rand -hex 32)');
    if (!cfg.publicUrl.startsWith('https://')) problems.push('PUBLIC_URL must start with https://');
    if (!env.API_URL) problems.push('API_URL must be set (e.g. http://backend:3000)');
    if (problems.length) throw new Error(`Refusing to start in production:\n - ${problems.join('\n - ')}`);
  }
  return cfg;
}

function createServer(cfg) {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const logFile = path.join(cfg.dataDir, 'connector.log');
  const log = (event) => {
    const line = JSON.stringify({ t: new Date().toISOString(), ...event });
    if (!cfg.quiet) console.log(line);
    fs.appendFile(logFile, line + '\n', () => {});
  };
  const store = new Store(cfg.dataDir, cfg.secret);
  const catalog = new Catalog(cfg.catalogFile, { writeLevels: cfg.writeLevels });
  const backend = new Backend({ apiUrl: cfg.apiUrl, store, version: VERSION, log });
  const clients = new Clients({ store, allowlist: cfg.allowedRedirectHosts, cimdEnabled: cfg.cimdEnabled, dataDir: cfg.dataDir, log, allowInsecureCimdForTests: cfg.testCimdInsecure });
  const oauth = new OAuth({ cfg, store, backend, clients, log });
  const tools = new Tools({ cfg, store, backend, catalog, log });

  const baseUrl = (req) => {
    if (cfg.publicUrl) return cfg.publicUrl;
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host || `localhost:${cfg.port}`}`;
  };

  const unauthorized = (res, base, invalid) =>
    send(res, 401, { error: invalid ? 'invalid_token' : 'unauthorized', error_description: invalid ? 'The access token is invalid or expired' : 'Sign in to Tulsi ERP to use this connector' }, {
      'WWW-Authenticate':
        `Bearer realm="tulsi-erp", resource_metadata="${base}/.well-known/oauth-protected-resource"` +
        (invalid ? ', error="invalid_token", error_description="The access token is invalid or expired"' : ''),
    });

  async function rpc(msg, connectionId) {
    const isRequest = msg && msg.id !== undefined && msg.id !== null;
    const reply = (result) => (isRequest ? { jsonrpc: '2.0', id: msg.id, result } : null);
    const fail = (code, message) => (isRequest ? { jsonrpc: '2.0', id: msg.id, error: { code, message } } : null);
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isRequest ? fail(-32600, 'Invalid request') : null;
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion;
        log({ event: 'initialize', client: msg.params?.clientInfo?.name, protocol: asked });
        return reply({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'tulsi-erp', title: `Tulsi ERP${cfg.badge ? ` (${cfg.badge})` : ''}`, version: VERSION },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: tools.list(connectionId) });
      case 'tools/call':
        if (!msg.params?.name) return fail(-32602, 'params.name is required');
        return reply(await tools.call(connectionId, msg.params.name, msg.params.arguments || {}));
      case 'resources/list':
        return reply({ resources: [] });
      case 'resources/templates/list':
        return reply({ resourceTemplates: [] });
      case 'prompts/list':
        return reply({ prompts: [] });
      default:
        if (msg.method.startsWith('notifications/')) return null;
        return fail(-32601, `Method not found: ${msg.method}`);
    }
  }

  async function mcp(req, res, base) {
    const auth = String(req.headers.authorization || '');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!bearer) return unauthorized(res, base, false);
    const connectionId = oauth.connectionFor(bearer);
    if (!connectionId) return unauthorized(res, base, true);
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      if (err.status === 413) return send(res, 413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } });
      return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => rpc(m, connectionId)))).filter(Boolean);
      return out.length ? send(res, 200, out) : send(res, 202);
    }
    const out = await rpc(body, connectionId);
    // A tool may have ended the session (SessionEnded): the next call gets 401 → Reconnect.
    return out ? send(res, 200, out) : send(res, 202);
  }

  const server = http.createServer(async (req, res) => {
    const base = baseUrl(req);
    let url;
    try {
      url = new URL(req.url, base);
    } catch {
      return send(res, 400, { error: 'bad_request' });
    }
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '86400' });
        return res.end();
      }
      if (url.pathname === '/mcp') {
        if (req.method === 'POST') return await mcp(req, res, base);
        return send(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        const up = await backend.health();
        return send(res, up ? 200 : 503, { ok: up, app: up ? 'up' : 'down', version: VERSION, mode: cfg.toolMode, actions: catalog.actions.length, catalogGeneratedAt: catalog.generatedAt });
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return sendHtml(res, 200, pages.homePage({ base, badge: cfg.badge, actions: catalog.actions.length, mode: cfg.toolMode }));
      }
      if (await oauth.handle(req, res, url, base)) return;
      return send(res, 404, { error: 'not_found' });
    } catch (err) {
      log({ event: 'http_error', path: url.pathname, message: String(err && err.message).slice(0, 200) });
      if (!res.headersSent) send(res, err.status || 500, { error: err.status === 413 ? 'request_too_large' : err.status === 400 ? 'invalid_request' : 'server_error' });
    }
  });
  server.requestTimeout = 120_000;
  return { server, store, catalog, backend, oauth, tools, clients, log };
}

if (require.main === module) {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const app = createServer(cfg);
  app.server.listen(cfg.port, cfg.host, () => {
    app.log({ event: 'started', port: cfg.port, mode: cfg.toolMode, api: cfg.apiUrl, actions: app.catalog.actions.length, writeLevels: cfg.writeLevels.join(',') });
  });
  const stop = () => app.server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { createServer, loadConfig, VERSION };
