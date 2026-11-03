'use strict';
/**
 * Who the assistant is. Three ways a client identifies itself, all behind the
 * same redirect allowlist:
 *  1. Dynamic client registration (POST /register) — Claude, ChatGPT (DCR).
 *  2. Client ID Metadata Documents — client_id is an https URL (ChatGPT).
 *  3. Pre-registered clients (scripts/add-client.js) — Gemini Enterprise, Copilot Studio.
 */
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { sha256, random } = require('./store');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const AUTH_METHODS = new Set(['none', 'client_secret_post', 'client_secret_basic']);
const CIMD_MAX_BYTES = 64 * 1024;
const CIMD_TTL_MS = 24 * 60 * 60_000;

const DEFAULT_REDIRECT_HOSTS = [
  'claude.ai',
  'claude.com',
  'chatgpt.com',
  'oauth-redirect.googleusercontent.com',
  'oauth-redirect-sandbox.googleusercontent.com',
  'oauth-redirect-test.googleusercontent.com',
  'vertexaisearch.cloud.google.com',
  'callback.mistral.ai',
  'www.perplexity.ai',
  'enterprise.perplexity.ai',
  'global.consent.azure-apim.net',
  'vscode.dev',
  'cursor.com',
];

function hostAllowed(host, allowlist) {
  const h = String(host || '').toLowerCase();
  return allowlist.includes('*') || allowlist.includes(h);
}

/** https on an allowed host, or http on loopback (Claude Code, Gemini CLI, VS Code). Never a #fragment. */
function redirectAllowed(uri, allowlist) {
  let u;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || String(uri).includes('#')) return false;
  if (u.protocol === 'https:') return hostAllowed(u.hostname, allowlist);
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname);
  return false;
}

/** Same redirect URI; on loopback the port may differ (RFC 8252 §7.3). */
function sameRedirect(registered, requested) {
  if (registered === requested) return true;
  try {
    const a = new URL(registered);
    const b = new URL(requested);
    return (
      a.protocol === 'http:' &&
      LOOPBACK.has(a.hostname) &&
      a.protocol === b.protocol &&
      a.hostname === b.hostname &&
      a.pathname === b.pathname &&
      a.search === b.search
    );
  } catch {
    return false;
  }
}

/** Pre-registered clients live in their own file, written only by scripts/add-client.js. */
const preregisteredFile = (dataDir) => path.join(dataDir, 'preregistered-clients.json');

function readPreregistered(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(preregisteredFile(dataDir), 'utf8'));
  } catch {
    return {};
  }
}

function writePreregistered(dataDir, clients) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = preregisteredFile(dataDir);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(clients, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

class Clients {
  constructor({ store, allowlist, cimdEnabled, dataDir, log = () => {}, allowInsecureCimdForTests = false }) {
    this.store = store;
    this.dataDir = dataDir;
    this.allowlist = allowlist;
    this.cimdEnabled = cimdEnabled;
    this.log = log;
    this.cimdCache = new Map();
    this.insecureCimd = allowInsecureCimdForTests;
  }

  /** POST /register body → {status, body}. */
  register(meta) {
    const redirectUris = Array.isArray(meta?.redirect_uris) ? meta.redirect_uris.map(String) : [];
    if (!redirectUris.length) return { status: 400, body: { error: 'invalid_redirect_uri', error_description: 'redirect_uris is required' } };
    const bad = redirectUris.filter((u) => !redirectAllowed(u, this.allowlist));
    if (bad.length) {
      this.log({ event: 'register_rejected', hosts: bad.map((u) => { try { return new URL(u).host; } catch { return 'invalid'; } }) });
      return { status: 400, body: { error: 'invalid_redirect_uri', error_description: 'This redirect address is not allowed for Tulsi ERP.' } };
    }
    const method = meta.token_endpoint_auth_method || 'client_secret_basic';
    if (!AUTH_METHODS.has(method)) return { status: 400, body: { error: 'invalid_client_metadata', error_description: `token_endpoint_auth_method ${method} is not supported` } };
    const grantTypes = meta.grant_types || ['authorization_code', 'refresh_token'];
    const client = this.save({
      client_name: String(meta.client_name || 'AI assistant').slice(0, 100),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: method,
      source: 'dcr',
    });
    return {
      status: 201,
      body: {
        client_id: client.client_id,
        ...(client.secret ? { client_secret: client.secret, client_secret_expires_at: 0 } : {}),
        client_id_issued_at: Math.floor(client.createdAt / 1000),
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: method,
        grant_types: grantTypes,
        response_types: ['code'],
        scope: 'erp',
      },
    };
  }

  /** Stores a DCR or pre-registered client; returns it with the one-time plain secret. */
  save({ client_name, redirect_uris, token_endpoint_auth_method, source }) {
    const id = `tp_${random(16)}`;
    const secret = token_endpoint_auth_method === 'none' ? null : random(32);
    const client = {
      client_id: id,
      client_name,
      redirect_uris,
      token_endpoint_auth_method,
      client_secret_hash: secret ? sha256(secret) : null,
      source,
      createdAt: Date.now(),
    };
    this.store.state.clients[id] = client;
    this.store.save();
    return { ...client, secret };
  }

  /** client_id → client, or {error, description}. */
  async resolve(clientId) {
    if (!clientId) return { error: 'invalid_client', description: 'client_id is missing.' };
    if (/^https?:\/\//i.test(clientId)) {
      if (!this.cimdEnabled) return { error: 'invalid_client', description: 'This app is not registered with Tulsi ERP.' };
      return this.fetchCimd(clientId);
    }
    const c = this.store.state.clients[clientId] || (this.dataDir && readPreregistered(this.dataDir)[clientId]);
    return c ? c : { error: 'invalid_client', description: 'This app is not registered with Tulsi ERP. Remove the connector and add it again.' };
  }

  async fetchCimd(url) {
    const cached = this.cimdCache.get(url);
    if (cached && cached.expires > Date.now()) return cached.client;
    let u;
    try {
      u = new URL(url);
    } catch {
      return { error: 'invalid_client', description: 'client_id is not a valid URL.' };
    }
    const insecureOk = this.insecureCimd && u.protocol === 'http:' && LOOPBACK.has(u.hostname);
    if (u.protocol !== 'https:' && !insecureOk) return { error: 'invalid_client', description: 'client_id must be an https URL.' };
    if (!insecureOk) {
      if (!hostAllowed(u.hostname, this.allowlist)) return { error: 'invalid_client', description: `${u.hostname} is not an allowed app host.` };
      let addrs;
      try {
        addrs = await dns.lookup(u.hostname, { all: true });
      } catch {
        return { error: 'invalid_client', description: `${u.hostname} could not be resolved.` };
      }
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return { error: 'invalid_client', description: 'client_id points to a private address.' };
    }
    let doc;
    let maxAge = CIMD_TTL_MS;
    try {
      let target = u;
      let res;
      for (let hop = 0; hop < 3; hop++) {
        res = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
        if (res.status < 300 || res.status >= 400) break;
        const next = new URL(res.headers.get('location') || '', target);
        if (next.host !== u.host) return { error: 'invalid_client', description: 'client_id document redirects to another host.' };
        target = next;
      }
      if (!res.ok) return { error: 'invalid_client', description: `client_id document answered ${res.status}.` };
      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > CIMD_MAX_BYTES) {
          reader.cancel();
          return { error: 'invalid_client', description: 'client_id document is too large.' };
        }
        chunks.push(Buffer.from(value));
      }
      doc = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const cc = /max-age=(\d+)/i.exec(res.headers.get('cache-control') || '');
      if (cc) maxAge = Math.min(CIMD_TTL_MS, Number(cc[1]) * 1000);
    } catch {
      return { error: 'invalid_client', description: 'client_id document could not be read.' };
    }
    if (!doc || doc.client_id !== url) return { error: 'invalid_client', description: 'client_id document does not name itself.' };
    const redirectUris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.map(String) : [];
    if (!redirectUris.length || redirectUris.some((r) => !redirectAllowed(r, this.allowlist)))
      return { error: 'invalid_client', description: 'client_id document lists a redirect address that is not allowed.' };
    const method = doc.token_endpoint_auth_method || 'none';
    if (method !== 'none') return { error: 'invalid_client', description: `token_endpoint_auth_method ${method} is not supported for metadata-document clients; use "none".` };
    const client = {
      client_id: url,
      client_name: String(doc.client_name || u.hostname).slice(0, 100),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      source: 'cimd',
    };
    this.cimdCache.set(url, { client, expires: Date.now() + maxAge });
    return client;
  }

  /** Client authentication at /token and /revoke. */
  authenticate(client, secret) {
    if (client.token_endpoint_auth_method === 'none') return true;
    if (!secret || !client.client_secret_hash) return false;
    const a = Buffer.from(sha256(secret), 'hex');
    const b = Buffer.from(client.client_secret_hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

module.exports = { Clients, redirectAllowed, sameRedirect, isPrivateAddress, readPreregistered, writePreregistered, DEFAULT_REDIRECT_HOSTS };
