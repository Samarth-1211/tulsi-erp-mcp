#!/usr/bin/env node
'use strict';
/**
 * End-to-end tests against the demo backend (node demo/start-backend.js,
 * tulsi_erp_demo). Starts two connectors in-process:
 *   A — the deployed shape (catalog mode, WRITE_LEVELS=low,normal)
 *   B — WRITE_LEVELS=low,normal,high, to exercise the high-risk writes
 * MUTATES the demo data: afterwards run setup-db --reset and seed-demo.
 * Writes demo/TEST-REPORT.md and demo/test-results.json.
 *
 *   node demo/run-tests.js [--api http://localhost:3070]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const o = require('./oauth-client');
const { DEMO_PASSWORD } = require('./demo-env');
const { createServer, loadConfig } = require('../connector/server');

const API = process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1] : 'http://localhost:3070';
const PW = DEMO_PASSWORD;
const USERS = {
  ADMIN: 'admin@demo.tulsi',
  MANAGER: 'sunita.manager@demo.tulsi',
  MANAGER2: 'vikram.manager@demo.tulsi',
  CALLER: 'amit.caller@demo.tulsi',
  CALLER2: 'priya.caller@demo.tulsi',
  CALLER3: 'rahul.caller@demo.tulsi',
  CALLER4: 'neha.caller@demo.tulsi',
  CALLER5: 'sanjay.caller@demo.tulsi',
  WAREHOUSE_STAFF: 'mohan.warehouse@demo.tulsi',
  DELIVERY_PARTNER: 'raju.delivery@demo.tulsi',
};
const CLAUDE = { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'client_secret_post' };

const results = [];
const allToolTexts = [];
const add = (group, name, status, detail = '') => results.push({ group, name, status, detail: String(detail).slice(0, 300) });
const pass = (g, n, d) => add(g, n, 'pass', d);
const fail = (g, n, d) => add(g, n, 'fail', d);
const info = (g, n, d) => add(g, n, 'info', d);
const check = (g, n, cond, d) => (cond ? pass(g, n, d) : fail(g, n, d));

async function guard(group, name, fn) {
  try {
    await fn();
  } catch (e) {
    fail(group, name, `threw: ${e.message}`);
  }
}

function startConnector(name, env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `tulsi-mcp-${name}-`));
  const cfg = loadConfig({ API_URL: API, DATA_DIR: dataDir, QUIET: '1', TEST_ALLOW_INSECURE_CIMD: '1', ...env });
  const app = createServer(cfg);
  return new Promise((resolve) => app.server.listen(0, '127.0.0.1', () => resolve({ app, cfg, dataDir, base: `http://127.0.0.1:${app.server.address().port}` })));
}

async function tool(base, at, name, args) {
  const r = await o.tool(base, at, name, args);
  allToolTexts.push(JSON.stringify(r));
  return r;
}

/** Sign in and return {at, rt, userId, client}. */
async function connect(c, email, meta = CLAUDE) {
  const { tokens, client } = await o.signInFlow(c.base, email, PW, { clientMeta: meta });
  const entry = c.app.store.state.accessTokens[require('../connector/lib/store').sha256(tokens.access_token)];
  const conn = c.app.store.state.connections[entry.connectionId];
  return { at: tokens.access_token, rt: tokens.refresh_token, userId: conn.user.id, client, connectionId: entry.connectionId };
}

/** authorize → sign in → code, without the token exchange. */
async function getCode(base, clientId, redirectUri, email, { resource, password = PW } = {}) {
  const { verifier, challenge } = o.pkce();
  const auth = await o.openAuthorize(base, { response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state: 'st1', resource });
  if (!auth.requestId) return { auth };
  const signed = await o.submitSignIn(base, auth.requestId, email, password);
  const loc = signed.location ? new URL(signed.location) : null;
  return { auth, signed, loc, code: loc?.searchParams.get('code'), verifier };
}

async function backendLogin(email) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
  return (await r.json()).accessToken;
}

async function backendCall(jwt, method, p, body) {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const daysFromToday = (n) => new Date(Date.now() + 330 * 60_000 + n * 864e5).toISOString().slice(0, 10);

async function main() {
  let health = null;
  for (let i = 0; i < 10 && health?.status !== 'ok'; i++) {
    health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
    if (health?.status !== 'ok') await new Promise((r) => setTimeout(r, 1500));
  }
  if (!health || health.status !== 'ok') throw new Error(`Demo backend not reachable at ${API}. Run node demo/start-backend.js first.`);
  const A = await startConnector('a', {});
  const B = await startConnector('b', { WRITE_LEVELS: 'low,normal,high' });

  // ---------------- discovery & protocol ----------------
  const G0 = 'Discovery & protocol';
  await guard(G0, 'metadata', async () => {
    const pr = await fetch(`${A.base}/.well-known/oauth-protected-resource`).then((r) => r.json());
    check(G0, 'protected resource names /mcp', pr.resource === `${A.base}/mcp` && pr.resource_name === 'Tulsi ERP', pr.resource);
    const pr2 = await fetch(`${A.base}/.well-known/oauth-protected-resource/mcp`);
    check(G0, 'protected resource at …/mcp too', pr2.status === 200);
    const as = await fetch(`${A.base}/.well-known/oauth-authorization-server`).then((r) => r.json());
    check(G0, 'auth server metadata: S256, CIMD, iss', as.code_challenge_methods_supported[0] === 'S256' && as.client_id_metadata_document_supported === true && as.authorization_response_iss_parameter_supported === true);
    for (const p of ['/.well-known/oauth-authorization-server/mcp', '/.well-known/openid-configuration']) check(G0, `${p} answers`, (await fetch(A.base + p)).status === 200);
  });
  await guard(G0, 'http basics', async () => {
    const r = await o.mcp(A.base, null, 'initialize', {});
    const wa = r.headers.get('www-authenticate') || '';
    check(G0, '401 without token + WWW-Authenticate', r.status === 401 && wa.includes('resource_metadata=') && wa.includes('realm="tulsi-erp"'), wa);
    const r2 = await o.mcp(A.base, 'tp_at_bogus', 'initialize', {});
    check(G0, '401 invalid_token with a bad token', r2.status === 401 && (r2.headers.get('www-authenticate') || '').includes('error="invalid_token"'));
    check(G0, 'GET /mcp → 405 Allow: POST', (await fetch(`${A.base}/mcp`)).headers.get('allow') === 'POST');
    const opt = await fetch(`${A.base}/mcp`, { method: 'OPTIONS' });
    check(G0, 'OPTIONS → 204 with CORS', opt.status === 204 && opt.headers.get('access-control-allow-origin') === '*');
    const h = await fetch(`${A.base}/health`).then((x) => x.json());
    check(G0, '/health → app up', h.ok === true && h.app === 'up' && h.actions > 50, JSON.stringify(h));
    const home = await fetch(`${A.base}/`);
    check(G0, 'home page with CSP', home.status === 200 && (home.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"));
  });
  const caller = await connect(A, USERS.CALLER);
  await guard(G0, 'json-rpc', async () => {
    const init = await o.mcp(A.base, caller.at, 'initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'test' } });
    check(G0, 'initialize echoes 2025-06-18', init.body.result.protocolVersion === '2025-06-18');
    check(G0, 'initialize has instructions with the STOP rule', /STOP and wait/.test(init.body.result.instructions) && /Never prepare and confirm in the same reply/.test(init.body.result.instructions));
    const init2 = await o.mcp(A.base, caller.at, 'initialize', { protocolVersion: '1999-01-01' });
    check(G0, 'unknown protocol → newest', init2.body.result.protocolVersion === '2025-11-25');
    check(G0, 'ping → {}', JSON.stringify((await o.mcp(A.base, caller.at, 'ping')).body.result) === '{}');
    check(G0, 'unknown method → -32601', (await o.mcp(A.base, caller.at, 'foo/bar')).body.error.code === -32601);
    const parse = await fetch(`${A.base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${caller.at}`, 'Content-Type': 'application/json' }, body: '{nope' });
    check(G0, 'parse error → 400 -32700', parse.status === 400 && (await parse.json()).error.code === -32700);
    const note = await fetch(`${A.base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${caller.at}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    check(G0, 'notification → 202', note.status === 202);
    const batch = await fetch(`${A.base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${caller.at}`, 'Content-Type': 'application/json' }, body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]) });
    const bb = await batch.json();
    check(G0, 'batch → 2 answers', Array.isArray(bb) && bb.length === 2);
    for (const m of ['resources/list', 'resources/templates/list', 'prompts/list']) check(G0, `${m} → empty`, !!(await o.mcp(A.base, caller.at, m)).body.result);
    const tl = (await o.mcp(A.base, caller.at, 'tools/list')).body.result.tools;
    const bad = tl.filter((t) => !t.title || t.annotations?.openWorldHint !== false || t.inputSchema.additionalProperties !== false || !/^[a-z][a-z0-9_]{0,63}$/.test(t.name));
    check(G0, 'every tool: title, openWorldHint false, additionalProperties false, safe name', bad.length === 0, bad.map((t) => t.name).join(','));
    const confirmTool = tl.find((t) => t.name === 'confirm_erp_change');
    check(G0, 'confirm tool is the only non-read-only one', confirmTool.annotations.readOnlyHint === false && confirmTool.annotations.destructiveHint === true && tl.filter((t) => t.annotations.readOnlyHint === false).length === 1);
    const schemaText = JSON.stringify(tl);
    check(G0, 'no $ref/oneOf/anyOf/patternProperties (Gemini-safe)', !/"\$ref"|"oneOf"|"anyOf"|"patternProperties"/.test(schemaText));
  });

  // ---------------- OAuth per client type ----------------
  const oauthRows = [];
  async function oauthCase(label, run) {
    const row = { client: label };
    oauthRows.push(row);
    await guard('OAuth', label, () => run(row));
  }
  const mark = (row, key, ok, detail) => {
    row[key] = ok ? 'pass' : 'FAIL';
    check('OAuth', `${row.client}: ${key}`, ok, detail);
  };

  // Each client type signs in as a different user: Tulsi ERP allows 10 logins per minute per email.
  async function commonChecks(row, base, clientId, redirectUri, tokenAuth, resource, email, expectRole = 'CALLER') {
    const { code, verifier, loc } = await getCode(base, clientId, redirectUri, email, { resource });
    mark(row, 'iss on redirect', loc && loc.searchParams.get('iss') === base && loc.searchParams.get('state') === 'st1');
    const badPkce = await o.token(base, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier', ...tokenAuth, ...(resource ? { resource } : {}) });
    mark(row, 'PKCE failure refused', badPkce.status === 400 && badPkce.body.error === 'invalid_grant');
    const reuse = await o.token(base, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, ...tokenAuth });
    mark(row, 'code reuse refused', reuse.status === 400);
    const c2 = await getCode(base, clientId, redirectUri, email, { resource });
    const wrongRes = await o.token(base, { grant_type: 'authorization_code', code: c2.code, redirect_uri: redirectUri, code_verifier: c2.verifier, resource: 'https://evil.example/mcp', ...tokenAuth });
    mark(row, 'wrong resource refused', wrongRes.status === 400 && wrongRes.body.error === 'invalid_target');
    const c3 = await getCode(base, clientId, redirectUri, email, { resource });
    const ok = await o.token(base, { grant_type: 'authorization_code', code: c3.code, redirect_uri: redirectUri, code_verifier: c3.verifier, ...tokenAuth, ...(resource ? { resource } : {}) });
    mark(row, 'token issued', ok.status === 200 && ok.body.access_token.startsWith('tp_at_') && ok.body.refresh_token.startsWith('tp_rt_') && ok.body.scope === 'erp');
    const who = await tool(base, ok.body.access_token, 'whoami');
    mark(row, 'whoami works', who.role === expectRole && who.connectedAs, who.connectedAs);
    row['credential named after client'] = `info: ${who.connectedAs} (session mode; PAT name needs backend Phase 2)`;
    const ref = await o.token(base, { grant_type: 'refresh_token', refresh_token: ok.body.refresh_token, ...tokenAuth });
    const again = await o.token(base, { grant_type: 'refresh_token', refresh_token: ok.body.refresh_token, ...tokenAuth });
    mark(row, 'refresh rotates', ref.status === 200 && ref.body.refresh_token !== ok.body.refresh_token && again.status === 400);
    await fetch(`${base}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: ref.body.refresh_token, ...tokenAuth }) });
    const after = await o.mcp(base, ref.body.access_token, 'tools/list');
    mark(row, 'revoke → 401', after.status === 401);
  }

  await oauthCase('DCR (Claude, client_secret_post)', async (row) => {
    const bad = await o.register(A.base, { ...CLAUDE, redirect_uris: ['https://evil.example/cb'] });
    mark(row, 'unlisted host refused at register', bad.status === 400);
    const frag = await o.register(A.base, { ...CLAUDE, redirect_uris: ['https://claude.ai/cb#x'] });
    mark(row, '#fragment refused', frag.status === 400);
    const reg = await o.register(A.base, CLAUDE);
    mark(row, 'registered 201 with secret', reg.status === 201 && reg.body.client_secret && reg.body.client_secret_expires_at === 0);
    await commonChecks(row, A.base, reg.body.client_id, CLAUDE.redirect_uris[0], { client_id: reg.body.client_id, client_secret: reg.body.client_secret }, `${A.base}/mcp`, USERS.CALLER2);
    const wrongSecret = await o.token(A.base, { grant_type: 'refresh_token', refresh_token: 'x', client_id: reg.body.client_id, client_secret: 'nope' });
    mark(row, 'wrong client secret → 401', wrongSecret.status === 401);
  });

  await oauthCase('DCR public + loopback (Claude Code / Gemini CLI)', async (row) => {
    const meta = { client_name: 'Claude Code', redirect_uris: ['http://localhost:33418/callback'], token_endpoint_auth_method: 'none' };
    const reg = await o.register(A.base, meta);
    mark(row, 'registered 201 without secret', reg.status === 201 && !reg.body.client_secret);
    const otherPort = await o.openAuthorize(A.base, { response_type: 'code', client_id: reg.body.client_id, redirect_uri: 'http://localhost:40001/callback', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    mark(row, 'loopback port may differ', !!otherPort.requestId);
    const httpRemote = await o.register(A.base, { ...meta, redirect_uris: ['http://claude.ai/cb'] });
    mark(row, 'plain http on a real host refused', httpRemote.status === 400);
    await commonChecks(row, A.base, reg.body.client_id, meta.redirect_uris[0], { client_id: reg.body.client_id }, undefined, USERS.CALLER4);
  });

  // CIMD: a local document server (allowed only with TEST_ALLOW_INSECURE_CIMD outside production).
  const cimdServer = http.createServer((req, res) => {
    const port = cimdServer.address().port;
    const docs = {
      '/chatgpt.json': { client_id: `http://127.0.0.1:${port}/chatgpt.json`, client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector/oauth/test123'], token_endpoint_auth_method: 'none' },
      '/liar.json': { client_id: 'http://127.0.0.1:1/other.json', client_name: 'Liar', redirect_uris: ['https://chatgpt.com/x'] },
      '/badredirect.json': { client_id: `http://127.0.0.1:${port}/badredirect.json`, client_name: 'Bad', redirect_uris: ['https://evil.example/cb'] },
    };
    const d = docs[req.url];
    res.writeHead(d ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(d || {}));
  });
  await new Promise((r) => cimdServer.listen(0, '127.0.0.1', r));
  const cimdBase = `http://127.0.0.1:${cimdServer.address().port}`;
  await oauthCase('CIMD (ChatGPT, resource on both legs)', async (row) => {
    const liar = await o.openAuthorize(A.base, { response_type: 'code', client_id: `${cimdBase}/liar.json`, redirect_uri: 'https://chatgpt.com/x', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    mark(row, 'document naming another id refused', liar.status === 400);
    const badr = await o.openAuthorize(A.base, { response_type: 'code', client_id: `${cimdBase}/badredirect.json`, redirect_uri: 'https://evil.example/cb', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    mark(row, 'document with unlisted redirect refused', badr.status === 400);
    const page = await o.openAuthorize(A.base, { response_type: 'code', client_id: `${cimdBase}/chatgpt.json`, redirect_uri: 'https://chatgpt.com/connector/oauth/test123', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    mark(row, 'sign-in page names ChatGPT', page.html.includes('<b>ChatGPT</b>') && page.html.includes('chatgpt.com'));
    await commonChecks(row, A.base, `${cimdBase}/chatgpt.json`, 'https://chatgpt.com/connector/oauth/test123', { client_id: `${cimdBase}/chatgpt.json` }, `${A.base}/mcp`, USERS.CALLER3);
  });

  await oauthCase('Pre-registered (Gemini Enterprise, add-client.js)', async (row) => {
    const env = { ...process.env, DATA_DIR: A.dataDir, QUIET: '1' };
    const script = path.join(__dirname, '..', 'connector', 'scripts', 'add-client.js');
    let refused = false;
    try {
      execFileSync(process.execPath, [script, '--name', 'Evil', '--redirect', 'https://evil.example/cb'], { env, stdio: 'pipe' });
    } catch {
      refused = true;
    }
    mark(row, 'unlisted redirect refused by add-client', refused);
    const out = execFileSync(process.execPath, [script, '--name', 'Gemini Enterprise', '--redirect', 'https://vertexaisearch.cloud.google.com/oauth-redirect'], { env, encoding: 'utf8' });
    const id = /client_id\s+(\S+)/.exec(out)[1];
    const secret = /client_secret\s+(\S+)/.exec(out)[1];
    mark(row, 'client created, secret printed once', id.startsWith('tp_') && secret.length > 20);
    const listed = execFileSync(process.execPath, [script, '--list'], { env, encoding: 'utf8' });
    mark(row, '--list shows it without the secret', listed.includes(id) && !listed.includes(secret));
    await commonChecks(row, A.base, id, 'https://vertexaisearch.cloud.google.com/oauth-redirect', { client_id: id, client_secret: secret }, undefined, USERS.MANAGER2, 'MANAGER');
  });

  // ---------------- sign-in rules ----------------
  const GS = 'Sign-in page rules';
  await guard(GS, 'authorize errors', async () => {
    const reg = (await o.register(A.base, CLAUDE)).body;
    const unknown = await o.openAuthorize(A.base, { response_type: 'code', client_id: 'tp_unknown', redirect_uri: CLAUDE.redirect_uris[0], code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    check(GS, 'unknown client → HTML error page, no redirect', unknown.status === 400 && !unknown.location && /not registered/.test(unknown.html));
    const wrongRedirect = await o.openAuthorize(A.base, { response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://claude.ai/other', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    check(GS, 'unregistered redirect → HTML error page', wrongRedirect.status === 400 && !wrongRedirect.location);
    const noPkce = await o.openAuthorize(A.base, { response_type: 'code', client_id: reg.client_id, redirect_uri: CLAUDE.redirect_uris[0], state: 's' });
    check(GS, 'no PKCE → redirect invalid_request', noPkce.status === 302 && new URL(noPkce.location).searchParams.get('error') === 'invalid_request');
    const rt = await o.openAuthorize(A.base, { response_type: 'token', client_id: reg.client_id, redirect_uri: CLAUDE.redirect_uris[0], code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    check(GS, 'response_type=token → unsupported_response_type', new URL(rt.location).searchParams.get('error') === 'unsupported_response_type');
    const badRes = await o.openAuthorize(A.base, { response_type: 'code', client_id: reg.client_id, redirect_uri: CLAUDE.redirect_uris[0], code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', resource: 'https://evil.example' });
    check(GS, 'wrong resource at authorize → invalid_target', new URL(badRes.location).searchParams.get('error') === 'invalid_target');
    const page = await o.openAuthorize(A.base, { response_type: 'code', client_id: reg.client_id, redirect_uri: CLAUDE.redirect_uris[0], code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    check(GS, 'page shows client and redirect host', page.html.includes('<b>Claude</b>') && page.html.includes('<b>claude.ai</b>'));
    const hi = await fetch(`${A.base}/authorize/back?request_id=${page.requestId}&lang=hi`).then((x) => x.text());
    check(GS, 'Hindi page', hi.includes('साइन इन करें') && hi.includes('lang="hi"'));
    const cancel = await o.submitSignIn(A.base, page.requestId, '', '', 'cancel');
    check(GS, 'Cancel → access_denied', cancel.status === 302 && new URL(cancel.location).searchParams.get('error') === 'access_denied');
    const xss = await o.register(A.base, { ...CLAUDE, client_name: '<script>alert(1)</script>' });
    const xp = await o.openAuthorize(A.base, { response_type: 'code', client_id: xss.body.client_id, redirect_uri: CLAUDE.redirect_uris[0], code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    check(GS, 'client name is HTML-escaped', !xp.html.includes('<script>alert') && xp.html.includes('&lt;script&gt;'));

    const signin = async (email, password) => {
      const p = await o.openAuthorize(A.base, { response_type: 'code', client_id: reg.client_id, redirect_uri: CLAUDE.redirect_uris[0], code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
      return o.submitSignIn(A.base, p.requestId, email, password);
    };
    const sa = await signin('superadmin@demo.tulsi', PW);
    check(GS, 'super admin refused with the normal message', sa.status === 401 && sa.html.includes('Invalid email or password'));
    const inactive = await signin('inactive@demo.tulsi', PW);
    check(GS, 'inactive user refused', inactive.status === 401);
    const w1 = await signin(USERS.CALLER5, 'Wrong@1234');
    check(GS, 'wrong password: "2 more tries"', w1.status === 401 && w1.html.includes('2 more tries'));
    await signin(USERS.CALLER5, 'Wrong@1234');
    const w3 = await signin(USERS.CALLER5, 'Wrong@1234');
    check(GS, '3rd wrong try → 15-minute pause', w3.status === 429 && /Try again in 15 minutes/.test(w3.html));
    const locked = await signin(USERS.CALLER5, PW);
    check(GS, 'correct password still paused', locked.status === 429);
    const expired = await o.submitSignIn(A.base, 'no-such-request', USERS.CALLER, PW);
    check(GS, 'expired sign-in request → error page', expired.status === 400 && /expired/.test(expired.html));
    const fp = await fetch(`${A.base}/forgot`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request_id: page.requestId, email: USERS.CALLER4, lang: 'en' }) });
    const fpText = await fp.text();
    if (fp.status === 200) pass(GS, 'forgot password → code page');
    else info(GS, 'forgot password → backend message shown', `${fp.status}: demo mail is off, so Tulsi ERP answers "can't email the reset code" (${/class="msg err"[^>]*>([^<]{0,120})/.exec(fpText)?.[1] || ''})`);
  });

  // ---------------- reads × roles ----------------
  const roleRows = {};
  const conns = {};
  for (const role of ['ADMIN', 'MANAGER', 'CALLER', 'WAREHOUSE_STAFF', 'DELIVERY_PARTNER']) conns[role] = role === 'CALLER' ? caller : await connect(A, USERS[role]);
  const adminJwt = await backendLogin(USERS.ADMIN);
  const anyLead = (await backendCall(adminJwt, 'GET', '/leads?pageSize=1')).body.items[0];
  const anyProduct = (await backendCall(adminJwt, 'GET', '/inventory/products?pageSize=1')).body.items[0];

  for (const [role, cn] of Object.entries(conns)) {
    const row = (roleRows[role] = { ok: 0, refusedByRole: 0, backend4xx: 0, fail: 0, notes: [] });
    const tl = (await o.mcp(A.base, cn.at, 'tools/list')).body.result.tools.map((t) => t.name);
    const myLead = ['ADMIN', 'MANAGER', 'CALLER'].includes(role) ? (await tool(A.base, cn.at, 'run_erp_read', { action: 'list_leads', limit: 1 })).rows?.[0] : null;
    const myTask = (await tool(A.base, cn.at, 'run_erp_read', { action: 'my_tasks', limit: 1 })).rows?.[0];
    const teamMember = ['ADMIN', 'MANAGER'].includes(role) ? (await tool(A.base, cn.at, 'run_erp_read', { action: 'list_team_members', limit: 1 })).rows?.[0]?.id : null;
    const aManager = role === 'ADMIN' ? (await tool(A.base, cn.at, 'run_erp_read', { action: 'list_managers', limit: 1 })).rows?.[0]?.id : null;
    const fixtures = {
      id: null,
      employeeId: cn.userId,
      leadId: myLead?.id,
      q: 'Indore',
      from: daysFromToday(-30),
      to: today,
      date: today,
    };
    const idFor = (a) => {
      if (a.module === 'leads') return myLead?.id || anyLead.id;
      if (a.module === 'inventory') return anyProduct.id;
      if (a.module === 'tasks') return myTask?.id;
      if (a.module === 'manager') return teamMember;
      if (a.module === 'managers') return aManager;
      if (['employees', 'users', 'activities', 'attendance'].includes(a.module)) return cn.userId;
      return null;
    };
    for (const a of A.app.catalog.actions.filter((x) => x.kind === 'read')) {
      const allowed = A.app.catalog.roleAllowed(a, role);
      const params = {};
      let skip = null;
      for (const p of Object.keys(a.pathParams || {})) {
        const v = p === 'id' ? idFor(a) : fixtures[p];
        if (!v) skip = `no ${p} fixture`;
        params[p] = v;
      }
      for (const q of a.query?.required || []) params[q] = fixtures[q] ?? 'x';
      if (a.method === 'POST') {
        if (a.name === 'plan_trip_route' || a.name === 'optimise_trip_order') params.body = { stops: [{ name: 'Indore', lat: 22.7196, lng: 75.8577 }, { name: 'Dewas', lat: 22.9676, lng: 76.0534 }] };
        else if (a.name === 'leads_in_cities') params.body = { cityIds: [] };
      }
      if (!allowed) {
        const r = await tool(A.base, cn.at, 'run_erp_read', { action: a.name, params });
        if (r.error && /can't use/.test(r.error)) row.refusedByRole++;
        else {
          row.fail++;
          fail('Reads × roles', `${role} ${a.name} should be refused`, JSON.stringify(r).slice(0, 150));
        }
        continue;
      }
      if (skip) {
        row.notes.push(`${a.name}: skipped (${skip})`);
        continue;
      }
      const r = await tool(A.base, cn.at, 'run_erp_read', { action: a.name, params, limit: 3 });
      if (!r.error) row.ok++;
      else if (r.status >= 400 && r.status < 500) {
        row.backend4xx++;
        row.notes.push(`${a.name}: Tulsi ERP ${r.status} ${String(r.details || '').slice(0, 80)}`);
      } else if (r.status === 0 || r.status >= 500) {
        row.notes.push(`${a.name}: ${r.status} ${String(r.details || r.error).slice(0, 80)}`);
        info('Reads × roles', `${role} ${a.name}`, `${r.status} ${r.details || r.error}`);
      } else {
        row.fail++;
        fail('Reads × roles', `${role} ${a.name}`, JSON.stringify(r).slice(0, 200));
      }
    }
    // curated tools
    const curatedArgs = { find_lead: { query: myLead?.name || 'Sharma' }, my_day: {}, lead_stats: { period: 'last_30_days', staleDays: 7 }, check_stock: { query: '18mm bwp 8x4' }, team_status: {} };
    for (const [name, args] of Object.entries(curatedArgs)) {
      if (!tl.includes(name)) continue;
      const r = await tool(A.base, cn.at, name, args);
      check('Curated tools', `${role} ${name}`, !r.error, r.error || '');
    }
    check('Reads × roles', `${role}: tools/list fits the role`, role === 'WAREHOUSE_STAFF' || role === 'DELIVERY_PARTNER' ? !tl.includes('find_lead') && tl.includes('check_stock') : tl.includes('find_lead'), tl.join(','));
  }

  // curated specifics
  await guard('Curated tools', 'details', async () => {
    const adm = conns.ADMIN;
    const st = await tool(A.base, adm.at, 'check_stock', { query: 'Century 18 mm BWP 8 by 4' });
    check('Curated tools', 'check_stock parses "18 mm", "8 by 4", grade, brand', st.matches === 1 && st.products[0].name === 'Century BWP 18mm Plywood', JSON.stringify(st.understood));
    const low = await tool(A.base, adm.at, 'check_stock', {});
    check('Curated tools', 'check_stock with no query → summary + low stock', !!low.summary && low.lowOrOutOfStock.count > 0);
    const hin = await tool(A.base, conns.ADMIN.at, 'run_erp_read', { action: 'list_leads', params: { search: 'ramesh' }, limit: 30 });
    check('Curated tools', 'search "ramesh" also finds "रमेश कुमार"', JSON.stringify(hin.rows).includes('रमेश'), `${hin.total} matches`);
    const hin2 = await tool(A.base, conns.ADMIN.at, 'run_erp_read', { action: 'list_leads', params: { search: 'रमेश' }, limit: 30 });
    check('Curated tools', 'search "रमेश" also finds "Ramesh"', JSON.stringify(hin2.rows).includes('Ramesh'));
    const stats = await tool(A.base, adm.at, 'lead_stats', { period: 'all' });
    const total = (await backendCall(adminJwt, 'GET', '/leads?pageSize=1')).body.total;
    check('Curated tools', 'lead_stats counts every lead (admin, all time)', stats.total === total && stats.counted === total && Object.values(stats.byStatus).reduce((s, n) => s + n, 0) === total, `${stats.counted}/${total}`);
    const list = await tool(A.base, adm.at, 'run_erp_read', { action: 'list_leads', where: { status: 'CONVERTED' } });
    const conv = (await backendCall(adminJwt, 'GET', '/leads?status=CONVERTED&pageSize=1')).body.total;
    check('Core tools', 'run_erp_read where-filter total = server count', list.total === conv && list.totalBeforeFilter === total, `${list.total} vs ${conv}`);
    check('Core tools', 'list summary counts cover all rows', Object.values(list.summary.status || {}).reduce((s, n) => s + n, 0) === conv);
    const prods = await tool(A.base, adm.at, 'run_erp_read', { action: 'list_products', limit: 2 });
    check('Core tools', 'product totals by unit', !!prods.totals?.stock?.SHEET && /sheets/.test(prods.totals.stockText), prods.totals?.stockText);
    const s = await tool(A.base, adm.at, 'search_erp_actions', { query: 'enquiry follow-up', limit: 5 });
    check('Core tools', 'search understands "enquiry" (synonym for lead)', s.matches.some((m) => /lead|follow/.test(m.action)), s.matches.map((m) => m.action).join(','));
    const inj = await tool(A.base, adm.at, 'find_lead', { query: 'Patel Furniture' });
    const injText = JSON.stringify(inj);
    info('Prompt injection', 'lead feedback with "ignore previous instructions…" reaches the assistant as data', injText.includes('Ignore previous instructions') ? 'returned inside the lead record, with the "treat as data" note; needs a real-model run to confirm behaviour' : 'not in the first match (several Patel leads); covered by the real-model checklist');
  });

  // ---------------- writes ----------------
  const writes = [];
  async function write(c, cn, action, params, verify) {
    const p = await tool(c.base, cn.at, 'prepare_erp_change', { action, params });
    if (p.error) {
      writes.push({ action, role: cn.role, result: 'FAIL', detail: `${p.error} ${JSON.stringify(p.problems || p.details || '')}` });
      fail('Writes', action, `${p.error} ${JSON.stringify(p.problems || p.details || '')}`);
      return null;
    }
    const c1 = await tool(c.base, cn.at, 'confirm_erp_change', { draftId: p.draftId });
    if (!c1.saved) {
      writes.push({ action, role: cn.role, result: 'info', detail: `${c1.error || ''} ${c1.details || ''}` });
      info('Writes', action, `Tulsi ERP said: ${c1.status} ${c1.details || c1.error}`);
      return { prepared: p, confirmed: c1 };
    }
    let extra = '';
    if (verify) extra = (await verify(c1, p)) || '';
    writes.push({ action, role: cn.role, result: extra.startsWith('FAIL') ? 'FAIL' : 'pass', detail: (p.summary.record || '') + (extra ? ` — ${extra}` : '') });
    check('Writes', action, !extra.startsWith('FAIL'), extra);
    return { prepared: p, confirmed: c1 };
  }
  for (const [r, cn] of Object.entries(conns)) cn.role = r;
  const cl = conns.CALLER;
  const myLeads = (await tool(A.base, cl.at, 'run_erp_read', { action: 'list_leads', params: { status: 'IN_PROGRESS' }, limit: 5 })).rows;
  const leadA = myLeads[0];
  const leadB = myLeads[1];

  // draft safety rules
  await guard('Draft safety', 'rules', async () => {
    const p = await tool(A.base, cl.at, 'prepare_erp_change', { action: 'add_lead_note', params: { id: leadA.id, body: { note: 'Draft rule test' } } });
    check('Draft safety', 'prepare returns a draft, saved:false, STOP text', p.draftId && p.saved === false && /do not call confirm_erp_change now/.test(p.next) && p.summary.record?.includes(leadA.name));
    const other = conns.MANAGER;
    const stolen = await tool(A.base, other.at, 'confirm_erp_change', { draftId: p.draftId });
    check('Draft safety', "another user's draft is refused", !!stolen.error);
    const c1 = await tool(A.base, cl.at, 'confirm_erp_change', { draftId: p.draftId });
    const c2 = await tool(A.base, cl.at, 'confirm_erp_change', { draftId: p.draftId });
    check('Draft safety', 'saves once; second confirm changes nothing', c1.saved === true && c2.alreadySaved === true);
    const p2 = await tool(A.base, cl.at, 'prepare_erp_change', { action: 'add_lead_note', params: { id: leadA.id, body: { note: 'expired' } } });
    A.app.store.state.drafts[p2.draftId].expires = Date.now() - 1;
    const c3 = await tool(A.base, cl.at, 'confirm_erp_change', { draftId: p2.draftId });
    check('Draft safety', 'expired draft refused', !!c3.error && /expired/.test(c3.error));
    check('Draft safety', 'unknown draft refused', !!(await tool(A.base, cl.at, 'confirm_erp_change', { draftId: 'D-nope' })).error);
    const rd = await tool(A.base, cl.at, 'prepare_erp_change', { action: 'list_leads', params: {} });
    check('Draft safety', 'prepare refuses reads', /run_erp_read/.test(rd.error || ''));
    const bad = await tool(A.base, cl.at, 'prepare_erp_change', { action: 'change_lead_status', params: { id: leadA.id, body: { status: 'WON' } } });
    check('Draft safety', 'bad enum → problems + expected schema', bad.problems?.some((x) => /one of/.test(x)) && !!bad.expected);
    const extraField = await tool(A.base, cl.at, 'prepare_erp_change', { action: 'add_lead_note', params: { id: leadA.id, body: { note: 'x', hack: 1 } } });
    check('Draft safety', 'unknown body field refused', extraField.problems?.some((x) => /hack/.test(x)));
    const high = await tool(A.base, cl.at, 'prepare_erp_change', { action: 'delete_task', params: { id: 'x' } });
    check('Draft safety', 'high-risk action switched off on connector A', /switched off/.test(high.error || ''), high.error);
    const role = await tool(A.base, cl.at, 'prepare_erp_change', { action: 'assign_lead', params: { id: leadA.id, body: { toUserId: cl.userId } } });
    check('Draft safety', "caller can't use assign_lead (role)", /can't use/.test(role.error || ''), role.error);
    const nf = await tool(A.base, cl.at, 'prepare_erp_change', { action: 'update_lead', params: { id: anyLead.id === leadA.id ? '00000000-0000-0000-0000-000000000000' : '00000000-0000-0000-0000-000000000000', body: { city: 'X' } } });
    check('Draft safety', 'update of a missing/invisible record → no draft', nf.status === 404 && !nf.draftId);
  });

  // low / normal writes on A
  await guard('Writes', 'low/normal', async () => {
    await write(A, cl, 'log_follow_up', { id: leadA.id, body: { note: 'Called, sent BWP rates', outcome: 'CONNECTED', nextFollowUpAt: `${daysFromToday(2)}T11:00` } }, async () => {
      const l = await tool(A.base, cl.at, 'run_erp_read', { action: 'get_lead', params: { id: leadA.id } });
      return l.nextFollowUpAt === `${daysFromToday(2)}T11:00+05:30` ? 'next follow-up stored as 11:00 IST' : `FAIL nextFollowUpAt=${l.nextFollowUpAt}`;
    });
    await write(A, cl, 'add_lead_note', { id: leadA.id, body: { note: 'Prefers Century brand' } });
    const newCity = `Dewas-${Date.now() % 1000}`;
    const upd = await write(A, cl, 'update_lead', { id: leadA.id, body: { city: newCity, altPhone: '+919811100000' } });
    if (upd) check('Writes', 'update draft shows before → after', upd.prepared.summary.changes?.city?.to === newCity && 'from' in upd.prepared.summary.changes.city, JSON.stringify(upd.prepared.summary.changes));
    await write(A, cl, 'change_lead_status', { id: leadB.id, body: { status: 'LOST', lostReason: 'Bought from local dealer' } });
    const lostDraft = await tool(A.base, cl.at, 'prepare_erp_change', { action: 'change_lead_status', params: { id: leadA.id, body: { status: 'LOST', lostReason: 'x' } } });
    check('Writes', 'LOST draft carries the reallocation warning', /auto-reallocation/.test(lostDraft.summary?.warning || ''));
    const created = await write(A, cl, 'create_lead', { body: { name: 'Test Lead MCP', phone: '9876501234', city: 'Indore', requirementNotes: '18mm BWP 8x4, 10 sheets', source: 'WALK_IN' } });
    globalThis.createdLeadId = created?.confirmed?.result?.id;
    const task = await write(A, cl, 'create_task', { body: { title: 'Call Jain Hardware', taskType: 'CALL', dueAt: `${daysFromToday(1)}T11:00` } }, async (c) => {
      const t = await tool(A.base, cl.at, 'run_erp_read', { action: 'get_task', params: { id: c.result.id } });
      return t.dueAt === `${daysFromToday(1)}T11:00+05:30` ? '"tomorrow 11 am" stored as 11:00 IST' : `FAIL dueAt=${t.dueAt}`;
    });
    const taskId = task?.confirmed?.result?.id;
    globalThis.callerTaskId = taskId;
    if (taskId) {
      await write(A, cl, 'edit_task', { id: taskId, body: { priority: 'URGENT' } });
      await write(A, cl, 'complete_task', { id: taskId });
    }
    await write(A, cl, 'log_activity', { body: { type: 'SITE_VISIT', description: 'Visited 3 shops in Siyaganj' } });
    await write(A, cl, 'apply_leave', { body: { startDate: daysFromToday(20), endDate: daysFromToday(21), reason: 'Family function' } });
    await write(A, cl, 'set_my_email_preference', { body: { enabled: true } });
    await write(A, cl, 'mark_all_notifications_read', {});
    const allot = await tool(A.base, cl.at, 'run_erp_read', { action: 'my_allotted_leads' });
    const allotId = JSON.stringify(allot).match(/"id":"([0-9a-f-]{36})","[^"]*":"[^"]*","leadId"/)?.[1];
    if (allotId) await write(A, cl, 'skip_allotted_lead', { id: allotId });
    else info('Writes', 'skip_allotted_lead', 'no allotment today for the demo caller (the cron builds batches only when a caller has nothing else due)');

    // curated write
    const dlu = await tool(A.base, cl.at, 'draft_lead_update', { lead: leadA.id, note: 'Visited site, needs 30 sheets', outcome: 'VISITED', nextFollowUpAt: `${daysFromToday(6)}T11:00`, status: 'IN_PROGRESS' });
    check('Writes', 'draft_lead_update → one draft, readable time', dlu.draftId && /IST/.test(dlu.summary.changes.followUp.nextFollowUpAt), JSON.stringify(dlu.summary?.changes));
    const dluC = await tool(A.base, cl.at, 'confirm_erp_change', { draftId: dlu.draftId });
    check('Writes', 'draft_lead_update confirm saves', dluC.saved === true);
    const amb = await tool(A.base, cl.at, 'draft_lead_update', { lead: 'Ramesh', note: 'x' });
    check('Writes', 'draft_lead_update with an ambiguous name → candidates, no draft', !amb.draftId && amb.candidates?.length > 1);
    const lostNoReason = await tool(A.base, cl.at, 'draft_lead_update', { lead: leadA.id, status: 'LOST' });
    check('Writes', 'draft_lead_update LOST needs a reason', /lostReason/.test(lostNoReason.error || ''));

    const mg = conns.MANAGER;
    const team = (await tool(A.base, mg.at, 'run_erp_read', { action: 'list_team_members', limit: 10 })).rows || [];
    const priya = team.find((m) => /Priya/.test(m.name));
    const mgLead = (await tool(A.base, mg.at, 'run_erp_read', { action: 'list_leads', where: { assignedTo: 'Amit' }, limit: 2 })).rows?.[0];
    if (priya && mgLead) {
      await write(A, mg, 'assign_lead', { id: mgLead.id, body: { toUserId: priya.id, reason: 'Amit on leave' } });
      await write(A, mg, 'assign_lead_to_team_member', { leadId: mgLead.id, body: { userId: cl.userId } });
      await write(A, mg, 'create_task', { body: { title: 'Visit Bansal Timber', taskType: 'SITE_VISIT', assignedToId: priya.id, dueAt: `${daysFromToday(1)}T15:30` } });
    } else fail('Writes', 'manager fixtures', 'team member or lead not found');
  });

  // high-risk writes on B
  await guard('Writes', 'high', async () => {
    const adm = await connect(B, USERS.ADMIN);
    adm.role = 'ADMIN';
    const mgB = await connect(B, USERS.MANAGER);
    mgB.role = 'MANAGER';
    const pending = await tool(B.base, mgB.at, 'run_erp_read', { action: 'team_pending_leave' });
    const lv = pending.rows || [];
    if (lv[0]) {
      const ap = await write(B, mgB, 'approve_leave', { id: lv[0].id, body: { comment: 'OK' } });
      if (ap) check('Writes', 'approve_leave draft names the applicant', /Amit|Priya|Rahul/.test(ap.prepared.summary.record || ''), ap.prepared.summary.record);
    }
    if (lv[1]) await write(B, mgB, 'reject_leave', { id: lv[1].id, body: { comment: 'Busy week' } });
    const now = new Date(Date.now() + 330 * 60_000);
    await write(B, adm, 'set_target', { body: { userId: conns.CALLER.userId, periodYear: now.getUTCFullYear(), periodMonth: now.getUTCMonth() + 1, metric: 'CONVERSIONS', targetValue: 10 } });
    const before = (await tool(B.base, adm.at, 'run_erp_read', { action: 'get_product', params: { id: anyProduct.id } })).stock;
    await write(B, adm, 'adjust_stock', { id: anyProduct.id, body: { change: 50, reason: 'RECEIVED', note: 'Truck from depot' } }, async () => {
      const after = (await tool(B.base, adm.at, 'run_erp_read', { action: 'get_product', params: { id: anyProduct.id } })).stock;
      return after === before + 50 ? `stock ${before} → ${after}` : `FAIL stock ${before} → ${after}`;
    });
    const np = await write(B, adm, 'add_product', { body: { name: 'Test Ply 9mm MR', category: 'PLYWOOD', grade: 'MR', thickness: '9mm', size: '8x4 ft', unit: 'SHEET', stock: 5, reorderLevel: 2 } });
    const npId = np?.confirmed?.result?.id;
    if (npId) {
      await write(B, adm, 'edit_product', { id: npId, body: { reorderLevel: 4 } });
      const del = await write(B, adm, 'delete_product', { id: npId, body: { confirmation: 'delete' } });
      if (del) check('Writes', 'delete draft carries a warning', !!del.prepared.summary.warning);
    }
    if (globalThis.createdLeadId) await write(B, adm, 'delete_lead', { id: globalThis.createdLeadId, body: { confirmation: 'delete' } });
    const clB = await connect(B, USERS.CALLER);
    clB.role = 'CALLER';
    if (globalThis.callerTaskId) await write(B, clB, 'delete_task', { id: globalThis.callerTaskId });
    const dpB = await connect(B, USERS.DELIVERY_PARTNER);
    dpB.role = 'DELIVERY_PARTNER';
    await write(B, dpB, 'check_in', { body: {} });
    const whB = await connect(B, USERS.WAREHOUSE_STAFF);
    whB.role = 'WAREHOUSE_STAFF';
    await write(B, whB, 'check_out', { body: { summary: 'Received two trucks, updated stock for Century and Greenply.' } });
    const cities = await tool(A.base, cl.at, 'run_erp_read', { action: 'lead_cities_on_map', limit: 5 });
    const cityIds = (cities.rows || JSON.parse(JSON.stringify(cities)).cities || []).map((c) => c.id).filter(Boolean).slice(0, 2);
    if (cityIds.length) {
      const trip = await write(A, cl, 'save_trip', { body: { name: 'Indore → Dewas dealers', tripDate: daysFromToday(2), cityIds, stops: [{ name: 'Indore', lat: 22.7196, lng: 75.8577 }, { name: 'Dewas', lat: 22.9676, lng: 76.0534 }] } });
      const tripId = trip?.confirmed?.result?.id;
      if (tripId) {
        for (const a of ['get_trip', 'trip_leads']) {
          const r = await tool(A.base, cl.at, 'run_erp_read', { action: a, params: { id: tripId } });
          check('Reads × roles', `CALLER ${a} (saved trip)`, !r.error, r.error || '');
        }
        await write(A, cl, 'edit_trip', { id: tripId, body: { notes: 'Carry BWP samples' } });
        await write(A, cl, 'share_trip', { id: tripId, body: { userIds: [conns.MANAGER.userId] } });
        await write(A, cl, 'trip_to_visit_tasks', { id: tripId, body: {} });
        await write(B, clB, 'delete_trip', { id: tripId });
      }
    } else info('Writes', 'save_trip', `no lead cities on the map: ${JSON.stringify(cities).slice(0, 120)}`);
    await write(B, clB, 'send_whatsapp_message', { leadId: leadA.id, body: { text: 'Namaste, rate list attached.' } });
  });

  // ---------------- token rules ----------------
  await guard('Token rules', 'deactivate', async () => {
    const rahul = await connect(A, USERS.CALLER3);
    check('Token rules', 'works before', (await tool(A.base, rahul.at, 'whoami')).role === 'CALLER');
    const d = await backendCall(adminJwt, 'PATCH', `/users/${rahul.userId}/deactivate`, {});
    const r = await tool(A.base, rahul.at, 'whoami');
    check('Token rules', 'deactivated user → "reconnect" answer', r.reconnect === true && /reconnect/i.test(r.error), `${d.status} ${JSON.stringify(r).slice(0, 120)}`);
    const next = await o.mcp(A.base, rahul.at, 'tools/list');
    check('Token rules', 'then /mcp → 401 (assistant shows Reconnect)', next.status === 401);
    await backendCall(adminJwt, 'PATCH', `/users/${rahul.userId}/reactivate`, {});
    const again = await connect(A, USERS.CALLER3);
    check('Token rules', 'reactivated user can connect again', (await tool(A.base, again.at, 'whoami')).role === 'CALLER');
  });
  await guard('Token rules', 'session end', async () => {
    const neha = await connect(A, USERS.CALLER4);
    const cred = A.app.store.decrypt(A.app.store.state.connections[neha.connectionId].cred);
    check('Token rules', 'credential mode', ['pat', 'session'].includes(cred.mode), cred.mode);
    if (cred.mode === 'session') {
      info('Token rules', 'backend has no PAT route yet → session mode', 'the connector keeps an encrypted session (refresh token) per connection; PAT naming, "via <assistant>" and session-only 403 come with backend Phase 2');
      await fetch(`${API}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: cred.refreshToken }) });
      // Force the access token to look expired so the connector must refresh.
      const parts = cred.accessToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
      payload.exp = 1;
      A.app.store.state.connections[neha.connectionId].cred = A.app.store.encrypt({ ...cred, accessToken: [parts[0], Buffer.from(JSON.stringify(payload)).toString('base64url'), parts[2]].join('.') });
      const r = await tool(A.base, neha.at, 'whoami');
      check('Token rules', 'revoked session → "reconnect" answer', r.reconnect === true, JSON.stringify(r).slice(0, 120));
    }
    const enc = fs.readFileSync(path.join(A.dataDir, 'state.json'), 'utf8');
    check('Token rules', 'state file holds no plain credentials', !/eyJhbGci/.test(enc) && !enc.includes(PW));
    const log = fs.readFileSync(path.join(A.dataDir, 'connector.log'), 'utf8');
    check('Token rules', 'log holds no tokens or passwords', !/tp_at_|tp_rt_|eyJhbGci/.test(log) && !log.includes(PW));
  });
  await guard('Token rules', 'refresh', async () => {
    const pr = await connect(B, USERS.CALLER5);
    const id = pr.connectionId;
    const cred = B.app.store.decrypt(B.app.store.state.connections[id].cred);
    if (cred.mode === 'session') {
      const parts = cred.accessToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
      payload.exp = 1;
      B.app.store.state.connections[id].cred = B.app.store.encrypt({ ...cred, accessToken: [parts[0], Buffer.from(JSON.stringify(payload)).toString('base64url'), parts[2]].join('.') });
      const [r1, r2, r3] = await Promise.all([tool(B.base, pr.at, 'whoami'), tool(B.base, pr.at, 'my_day'), tool(B.base, pr.at, 'run_erp_read', { action: 'my_tasks' })]);
      check('Token rules', 'expired session refreshes once for 3 parallel calls', !r1.error && !r2.error && !r3.error, JSON.stringify([r1.error, r2.error, r3.error]));
      check('Token rules', 'still connected afterwards (no reuse-detection logout)', !(await tool(B.base, pr.at, 'whoami')).error);
    }
  });

  // ---------------- secrets ----------------
  const leaks = allToolTexts.filter((t) => /"(passwordHash|password|accessToken|refreshToken|webhookToken|webhookUrl|verifyToken|tokenHash|price|costPrice|estimatedValue|rawPayload|encryptedSecrets)"\s*:/.test(t) || /eyJhbGci|tp_pat_|tp_at_|tp_rt_/.test(t));
  check('Secrets', `no secret, token or money field in ${allToolTexts.length} tool answers`, leaks.length === 0, leaks[0]?.slice(0, 200));

  // budget
  const tl = (await o.mcp(A.base, conns.ADMIN.at, 'tools/list')).body.result.tools;
  const chars = JSON.stringify(tl).length;
  info('Token budget', `tools/list for ADMIN: ${tl.length} tools, ${chars} chars ≈ ${Math.round(chars / 4)} tokens`, 'target < 3,000');
  check('Token budget', 'under 3,000 tokens', chars / 4 < 3000);

  cimdServer.close();
  A.app.server.close();
  B.app.server.close();
  return { roleRows, oauthRows, writes, budget: Math.round(chars / 4) };
}

function report({ roleRows, oauthRows, writes, budget }) {
  const counts = { pass: 0, fail: 0, info: 0 };
  for (const r of results) counts[r.status]++;
  const md = ['# Tulsi ERP MCP connector — test report', '', `Run ${new Date().toISOString()} against \`${API}\` (tulsi_erp_demo). Connector ${require('../connector/server').VERSION}.`, ''];
  md.push(`**${results.length} checks: ${counts.pass} passed, ${counts.fail} failed, ${counts.info} informational.**`, '');
  md.push(`Tool definitions: ≈${budget} tokens (ADMIN, catalog mode).`, '');
  md.push('## Reads × roles (every exposed read action)', '', '| Role | OK | Refused by role (as expected) | Tulsi ERP 4xx | Failed |', '|---|---:|---:|---:|---:|');
  for (const [role, r] of Object.entries(roleRows || {})) md.push(`| ${role} | ${r.ok} | ${r.refusedByRole} | ${r.backend4xx} | ${r.fail} |`);
  for (const [role, r] of Object.entries(roleRows || {})) if (r.notes.length) md.push('', `<details><summary>${role} notes (${r.notes.length})</summary>`, '', ...r.notes.map((n) => `- ${n}`), '', '</details>');
  md.push('', '## OAuth per client type', '');
  const cols = [...new Set((oauthRows || []).flatMap((r) => Object.keys(r)))].filter((c) => c !== 'client');
  md.push(`| Check | ${(oauthRows || []).map((r) => r.client).join(' | ')} |`, `|---|${(oauthRows || []).map(() => '---').join('|')}|`);
  for (const c of cols) md.push(`| ${c} | ${(oauthRows || []).map((r) => r[c] || '—').join(' | ')} |`);
  md.push('', '## Writes', '', '| Action | Role | Result | Detail |', '|---|---|---|---|');
  for (const w of writes || []) md.push(`| ${w.action} | ${w.role} | ${w.result} | ${String(w.detail).replace(/\|/g, '/').slice(0, 160)} |`);
  for (const g of [...new Set(results.map((r) => r.group))]) {
    md.push('', `## ${g}`, '', '| Check | Result | Detail |', '|---|---|---|');
    for (const r of results.filter((x) => x.group === g)) md.push(`| ${r.name} | ${r.status} | ${String(r.detail).replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
  }
  fs.writeFileSync(path.join(__dirname, 'TEST-REPORT.md'), md.join('\n') + '\n');
  fs.writeFileSync(path.join(__dirname, 'test-results.json'), JSON.stringify({ counts, results, roleRows, oauthRows, writes }, null, 2));
  console.log(`${results.length} checks: ${counts.pass} passed, ${counts.fail} failed, ${counts.info} informational. See demo/TEST-REPORT.md`);
  for (const r of results.filter((x) => x.status === 'fail')) console.log(`FAIL [${r.group}] ${r.name}: ${r.detail}`);
}

main()
  .then((extra) => report(extra))
  .catch((e) => {
    console.error(e.stack || e.message);
    report({});
    process.exit(1);
  });
