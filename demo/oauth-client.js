'use strict';
/**
 * A scripted OAuth client for tests and headless assistants: registers (DCR),
 * fills in the Tulsi ERP sign-in page like a browser would, exchanges the
 * code with PKCE, and calls MCP. Also usable from the command line to get a
 * connector access token for a headless Claude Code / Gemini CLI run:
 *
 *   node demo/oauth-client.js http://localhost:8790 amit.caller@demo.tulsi 'Demo@Tulsi2026' [--mcp-config out.json]
 */
const crypto = require('crypto');
const fs = require('fs');

const b64url = (b) => Buffer.from(b).toString('base64url');

async function register(base, meta) {
  const r = await fetch(`${base}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
  return { status: r.status, body: await r.json() };
}

function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

/** GET /authorize → {status, html, requestId, location}. */
async function openAuthorize(base, params) {
  const u = new URL(`${base}/authorize`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  const r = await fetch(u, { redirect: 'manual' });
  const html = r.status === 302 ? '' : await r.text();
  return { status: r.status, html, location: r.headers.get('location'), requestId: /name="request_id" value="([^"]+)"/.exec(html)?.[1] };
}

/** POST the sign-in form → {status, html, location}. */
async function submitSignIn(base, requestId, email, password, action = 'signin', headers = {}) {
  const r = await fetch(`${base}/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ request_id: requestId, email, password, action, lang: 'en' }),
  });
  return { status: r.status, html: r.status === 302 ? '' : await r.text(), location: r.headers.get('location') };
}

async function token(base, form, basicAuth) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (basicAuth) headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(basicAuth[0])}:${encodeURIComponent(basicAuth[1])}`).toString('base64')}`;
  const r = await fetch(`${base}/token`, { method: 'POST', headers, body: new URLSearchParams(form) });
  return { status: r.status, body: await r.json() };
}

/** Full flow for one user. Returns {client, tokens, redirect}. */
async function signInFlow(base, email, password, { clientMeta, resource, useBasic = false } = {}) {
  const meta = clientMeta || { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'client_secret_post' };
  const reg = await register(base, meta);
  if (reg.status !== 201) throw new Error(`register ${reg.status} ${JSON.stringify(reg.body)}`);
  const client = reg.body;
  const { verifier, challenge } = pkce();
  const state = b64url(crypto.randomBytes(8));
  const auth = await openAuthorize(base, {
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: meta.redirect_uris[0],
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: 'erp',
    resource,
  });
  if (!auth.requestId) throw new Error(`authorize ${auth.status} ${auth.location || auth.html.slice(0, 200)}`);
  const signed = await submitSignIn(base, auth.requestId, email, password);
  if (signed.status !== 302) throw new Error(`sign-in ${signed.status} ${/class="msg[^"]*"[^>]*>([^<]+)/.exec(signed.html)?.[1] || ''}`);
  const loc = new URL(signed.location);
  const code = loc.searchParams.get('code');
  const form = { grant_type: 'authorization_code', code, redirect_uri: meta.redirect_uris[0], code_verifier: verifier, ...(resource ? { resource } : {}) };
  let tok;
  if (client.client_secret && useBasic) tok = await token(base, form, [client.client_id, client.client_secret]);
  else tok = await token(base, { ...form, client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}) });
  if (tok.status !== 200) throw new Error(`token ${tok.status} ${JSON.stringify(tok.body)}`);
  return { client, tokens: tok.body, redirect: loc, state, verifier };
}

let rpcId = 0;
async function mcp(base, accessToken, method, params) {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const text = await r.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* empty */
  }
  return { status: r.status, body, headers: r.headers };
}

/** tools/call → parsed JSON result (plus isError). */
async function tool(base, accessToken, name, args = {}) {
  const r = await mcp(base, accessToken, 'tools/call', { name, arguments: args });
  if (r.status !== 200) return { httpStatus: r.status, error: `HTTP ${r.status}` };
  const res = r.body.result;
  const data = JSON.parse(res.content[0].text);
  return Object.assign(data && typeof data === 'object' ? data : { value: data }, res.isError ? { _isError: true } : {});
}

module.exports = { register, pkce, openAuthorize, submitSignIn, token, signInFlow, mcp, tool };

if (require.main === module) {
  const [base, email, password] = process.argv.slice(2);
  const out = process.argv.indexOf('--mcp-config');
  signInFlow(base, email, password)
    .then(({ tokens }) => {
      if (out > -1) {
        const cfg = { mcpServers: { 'tulsi-erp': { type: 'http', url: `${base}/mcp`, headers: { Authorization: `Bearer ${tokens.access_token}` } } } };
        fs.writeFileSync(process.argv[out + 1], JSON.stringify(cfg, null, 2));
        console.log(`Wrote ${process.argv[out + 1]} (token valid for ${tokens.expires_in}s).`);
      } else console.log(tokens.access_token);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
