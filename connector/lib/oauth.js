'use strict';
/**
 * OAuth 2.1 authorization server for the connector: discovery documents,
 * DCR, the Tulsi ERP sign-in page, forgot/reset password, the token endpoint
 * (authorization_code + rotating refresh_token, PKCE S256 required) and revoke.
 */
const crypto = require('crypto');
const { send, sendHtml, redirect, readBody, parseBody, clientIp, escapeHtml } = require('./http');
const { sha256, random } = require('./store');
const { sameRedirect } = require('./clients');
const pages = require('./pages');

const PENDING_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 60_000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60_000;
const LOCK_AFTER = 3;
const LOCK_MS = 15 * 60_000;
const SCOPE = 'erp';

const b64urlSha256 = (s) => crypto.createHash('sha256').update(s).digest('base64url');

class OAuth {
  constructor({ cfg, store, backend, clients, log }) {
    this.cfg = cfg;
    this.store = store;
    this.backend = backend;
    this.clients = clients;
    this.log = log;
    this.pending = new Map();
    this.codes = new Map();
    this.lockouts = new Map();
    this.resetLimits = new Map();
  }

  // ---------- discovery ----------
  protectedResource(base) {
    return {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
      scopes_supported: [SCOPE],
      resource_name: pages.PRODUCT,
    };
  }

  authServer(base) {
    return {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      revocation_endpoint: `${base}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: [SCOPE],
      ...(this.cfg.cimdEnabled ? { client_id_metadata_document_supported: true } : {}),
      authorization_response_iss_parameter_supported: true,
    };
  }

  /** RFC 8707: `resource`, when sent, must name this server's MCP endpoint. */
  resourceOk(resource, base) {
    if (resource === undefined || resource === null || resource === '') return true;
    const r = String(resource).replace(/\/+$/, '');
    return r === `${base}/mcp` || r === base;
  }

  /** Routes this module answers. Returns true when handled. */
  async handle(req, res, url, base) {
    const p = url.pathname;
    if (req.method === 'GET' && (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp')) {
      send(res, 200, this.protectedResource(base));
      return true;
    }
    if (
      req.method === 'GET' &&
      (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/oauth-authorization-server/mcp' || p === '/.well-known/openid-configuration' || p === '/.well-known/openid-configuration/mcp')
    ) {
      send(res, 200, this.authServer(base));
      return true;
    }
    if (req.method === 'POST' && p === '/register') {
      const body = parseBody(req, await readBody(req));
      const r = this.clients.register(body);
      if (r.status === 201) this.log({ event: 'client_registered', client: r.body.client_name, method: r.body.token_endpoint_auth_method });
      send(res, r.status, r.body);
      return true;
    }
    if (req.method === 'GET' && p === '/authorize') return this.authorizeGet(req, res, url, base), true;
    if (req.method === 'POST' && p === '/authorize') return this.authorizePost(req, res, base), true;
    if (req.method === 'GET' && p === '/authorize/back') return this.back(req, res, url), true;
    if (req.method === 'GET' && p === '/forgot') return this.forgotGet(req, res, url), true;
    if (req.method === 'POST' && p === '/forgot') return this.forgotPost(req, res), true;
    if (req.method === 'POST' && p === '/reset') return this.resetPost(req, res), true;
    if (req.method === 'POST' && p === '/token') return this.token(req, res, base), true;
    if (req.method === 'POST' && p === '/revoke') return this.revoke(req, res), true;
    return false;
  }

  lang(req, explicit) {
    return pages.pickLang(explicit, req.headers['accept-language']);
  }

  html(res, status, html) {
    sendHtml(res, status, html);
  }

  // ---------- /authorize ----------
  async authorizeGet(req, res, url, base) {
    const q = Object.fromEntries(url.searchParams);
    const lang = this.lang(req, q.lang);
    const client = await this.clients.resolve(q.client_id);
    if (client.error) {
      this.log({ event: 'authorize_rejected', reason: client.error });
      return this.html(res, 400, pages.errorPage({ lang, message: client.description, badge: this.cfg.badge }));
    }
    const redirectUri = q.redirect_uri || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : '');
    if (!redirectUri || !client.redirect_uris.some((r) => sameRedirect(r, redirectUri))) {
      return this.html(res, 400, pages.errorPage({ lang, message: 'This redirect address is not registered for this app. Remove the connector and add it again.', badge: this.cfg.badge }));
    }
    const back = (error, description) => {
      const u = new URL(redirectUri);
      u.searchParams.set('error', error);
      if (description) u.searchParams.set('error_description', description);
      if (q.state) u.searchParams.set('state', q.state);
      u.searchParams.set('iss', base);
      return redirect(res, u.toString());
    };
    if (q.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
    if (!q.code_challenge || q.code_challenge_method !== 'S256') return back('invalid_request', 'PKCE with S256 is required.');
    if (!this.resourceOk(q.resource, base)) return back('invalid_target', 'Unknown resource.');

    const requestId = random(24);
    this.pending.set(requestId, {
      client: { client_id: client.client_id, client_name: client.client_name },
      redirectUri,
      challenge: q.code_challenge,
      state: q.state,
      resource: q.resource || null,
      created: Date.now(),
    });
    this.cleanupMaps();
    this.renderSignIn(res, requestId, lang);
  }

  getPending(requestId) {
    const p = requestId && this.pending.get(requestId);
    if (!p || Date.now() - p.created > PENDING_TTL_MS) return null;
    return p;
  }

  renderSignIn(res, requestId, lang, { email, message, status = 200 } = {}) {
    const p = this.getPending(requestId);
    const html = pages.signInPage({
      lang,
      requestId,
      clientName: p.client.client_name,
      redirectHost: new URL(p.redirectUri).host,
      email,
      message,
      badge: this.cfg.badge,
      hint: this.cfg.signinHint,
    });
    this.html(res, status, html);
  }

  expired(res, lang, clientName = 'your assistant') {
    this.html(res, 400, pages.errorPage({ lang, message: pages.t(lang, 'expired', { client: clientName }).replace(/<[^>]+>/g, ''), badge: this.cfg.badge }));
  }

  back(req, res, url) {
    const lang = this.lang(req, url.searchParams.get('lang'));
    const requestId = url.searchParams.get('request_id');
    if (!this.getPending(requestId)) return this.expired(res, lang);
    this.renderSignIn(res, requestId, lang);
  }

  async authorizePost(req, res, base) {
    const f = parseBody(req, await readBody(req));
    const lang = this.lang(req, f.lang);
    const p = this.getPending(f.request_id);
    if (!p) return this.expired(res, lang);

    const finish = (params) => {
      const u = new URL(p.redirectUri);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (p.state) u.searchParams.set('state', p.state);
      u.searchParams.set('iss', base);
      this.pending.delete(f.request_id);
      redirect(res, u.toString());
    };
    if (f.action === 'cancel') return finish({ error: 'access_denied', error_description: 'The user cancelled sign-in.' });

    const email = String(f.email || '').trim().toLowerCase();
    const password = String(f.password || '');
    if (!email || !password) return this.renderSignIn(res, f.request_id, lang, { email, message: { html: pages.t(lang, 'invalid') }, status: 400 });

    const lock = this.lockouts.get(email);
    if (lock?.until && lock.until > Date.now()) {
      const m = Math.ceil((lock.until - Date.now()) / 60_000);
      return this.renderSignIn(res, f.request_id, lang, { email, message: { html: pages.t(lang, 'locked', { m }) }, status: 429 });
    }

    const xff = clientIp(req, this.cfg.trustProxy);
    const r = await this.backend.signIn(email, password, { xff, clientName: p.client.client_name });
    if (!r.ok) {
      this.log({ event: 'signin_failed', kind: r.kind, client: p.client.client_name });
      if (r.kind === 'invalid') {
        const entry = lock && (!lock.until || lock.until > Date.now()) ? lock : { fails: 0 };
        entry.fails += 1;
        entry.until = entry.fails >= LOCK_AFTER ? Date.now() + LOCK_MS : null;
        entry.at = Date.now();
        this.lockouts.set(email, entry);
        const html = entry.until
          ? pages.t(lang, 'locked', { m: Math.ceil(LOCK_MS / 60_000) })
          : `${pages.t(lang, 'invalid')} ${pages.t(lang, 'attemptsLeft', { n: LOCK_AFTER - entry.fails })}`;
        return this.renderSignIn(res, f.request_id, lang, { email, message: { html }, status: entry.until ? 429 : 401 });
      }
      // Verify-your-account, suspended org and Tulsi ERP's own 429 pass through as they are, uncounted.
      const html = r.kind === 'unreachable' ? pages.t(lang, 'unreachable') : escapeHtml(r.message || 'Sign-in failed.');
      return this.renderSignIn(res, f.request_id, lang, { email, message: { html }, status: r.status === 429 ? 429 : 400 });
    }
    this.lockouts.delete(email);

    const connectionId = random(16);
    this.store.state.connections[connectionId] = {
      user: r.user,
      clientId: p.client.client_id,
      clientName: p.client.client_name,
      mode: r.cred.mode,
      cred: this.store.encrypt(r.cred),
      createdAt: Date.now(),
    };
    this.store.save();
    const code = random(32);
    this.codes.set(sha256(code), {
      connectionId,
      clientId: p.client.client_id,
      redirectUri: p.redirectUri,
      challenge: p.challenge,
      resource: p.resource,
      expires: Date.now() + CODE_TTL_MS,
    });
    this.log({ event: 'signin_ok', role: r.user.role, client: p.client.client_name, mode: r.cred.mode });
    finish({ code });
  }

  // ---------- forgot / reset ----------
  limited(key, max) {
    const now = Date.now();
    const e = this.resetLimits.get(key);
    if (!e || e.reset < now) {
      this.resetLimits.set(key, { n: 1, reset: now + LOCK_MS });
      return 0;
    }
    e.n += 1;
    return e.n > max ? Math.ceil((e.reset - now) / 60_000) : 0;
  }

  forgotGet(req, res, url) {
    const lang = this.lang(req, url.searchParams.get('lang'));
    const requestId = url.searchParams.get('request_id');
    if (!this.getPending(requestId)) return this.expired(res, lang);
    this.html(res, 200, pages.forgotPage({ lang, requestId, badge: this.cfg.badge }));
  }

  async forgotPost(req, res) {
    const f = parseBody(req, await readBody(req));
    const lang = this.lang(req, f.lang);
    if (!this.getPending(f.request_id)) return this.expired(res, lang);
    const email = String(f.email || '').trim().toLowerCase();
    const xff = clientIp(req, this.cfg.trustProxy);
    const wait = this.limited(`forgot:${email}`, 3) || this.limited(`forgot-ip:${xff}`, 10);
    if (wait) return this.html(res, 429, pages.forgotPage({ lang, requestId: f.request_id, email, message: { html: pages.t(lang, 'tooMany', { m: wait }) }, badge: this.cfg.badge }));
    const r = await this.backend.forgotPassword(email, xff);
    if (!r.ok) {
      const html = r.status === 0 ? pages.t(lang, 'unreachable') : escapeHtml(r.message);
      return this.html(res, r.status === 429 ? 429 : 400, pages.forgotPage({ lang, requestId: f.request_id, email, message: { html }, badge: this.cfg.badge }));
    }
    this.html(res, 200, pages.resetPage({ lang, requestId: f.request_id, email, message: { ok: true, html: pages.t(lang, 'codeSent', { email }) }, badge: this.cfg.badge }));
  }

  async resetPost(req, res) {
    const f = parseBody(req, await readBody(req));
    const lang = this.lang(req, f.lang);
    if (!this.getPending(f.request_id)) return this.expired(res, lang);
    const email = String(f.email || '').trim().toLowerCase();
    const xff = clientIp(req, this.cfg.trustProxy);
    const wait = this.limited(`reset-ip:${xff}`, 10);
    if (wait) return this.html(res, 429, pages.resetPage({ lang, requestId: f.request_id, email, message: { html: pages.t(lang, 'tooMany', { m: wait }) }, badge: this.cfg.badge }));
    const r = await this.backend.resetPassword(email, String(f.otp || '').trim(), String(f.newPassword || ''), xff);
    if (!r.ok) {
      const html = r.status === 0 ? pages.t(lang, 'unreachable') : escapeHtml(r.message);
      return this.html(res, r.status === 429 ? 429 : 400, pages.resetPage({ lang, requestId: f.request_id, email, message: { html }, badge: this.cfg.badge }));
    }
    this.lockouts.delete(email);
    this.renderSignIn(res, f.request_id, lang, { email, message: { ok: true, html: pages.t(lang, 'resetDone') } });
  }

  // ---------- /token ----------
  async clientFromRequest(req, f) {
    let clientId = f.client_id;
    let secret = f.client_secret;
    const auth = String(req.headers.authorization || '');
    if (auth.startsWith('Basic ')) {
      const [id, sec] = Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':');
      clientId = decodeURIComponent(id || '');
      secret = decodeURIComponent(sec || '');
    }
    const client = await this.clients.resolve(clientId);
    if (client.error) return { error: client };
    if (!this.clients.authenticate(client, secret)) return { error: { error: 'invalid_client', description: 'Client authentication failed.' } };
    return { client };
  }

  async token(req, res, base) {
    let f;
    try {
      f = parseBody(req, await readBody(req));
    } catch {
      return send(res, 400, { error: 'invalid_request' });
    }
    const bad = (status, error, description) => send(res, status, { error, error_description: description });
    const { client, error } = await this.clientFromRequest(req, f);
    if (error) return bad(401, 'invalid_client', error.description);

    if (f.grant_type === 'authorization_code') {
      const h = sha256(f.code || '');
      const entry = this.codes.get(h);
      this.codes.delete(h); // single use, even when a check below fails
      if (!entry || entry.expires < Date.now()) return bad(400, 'invalid_grant', 'The code is invalid or expired.');
      if (entry.clientId !== client.client_id) return bad(400, 'invalid_grant', 'The code was issued to another client.');
      if (f.redirect_uri && !sameRedirect(entry.redirectUri, f.redirect_uri)) return bad(400, 'invalid_grant', 'redirect_uri does not match.');
      if (!this.resourceOk(f.resource, base)) return bad(400, 'invalid_target', 'Unknown resource.');
      if (entry.resource && f.resource && String(f.resource).replace(/\/+$/, '') !== String(entry.resource).replace(/\/+$/, '')) return bad(400, 'invalid_target', 'resource does not match the authorization request.');
      if (!f.code_verifier || b64urlSha256(String(f.code_verifier)) !== entry.challenge) return bad(400, 'invalid_grant', 'PKCE verification failed.');
      if (!this.store.state.connections[entry.connectionId]) return bad(400, 'invalid_grant', 'The sign-in is no longer valid.');
      return send(res, 200, this.issue(entry.connectionId, client.client_id, entry.resource));
    }
    if (f.grant_type === 'refresh_token') {
      const h = sha256(f.refresh_token || '');
      const entry = this.store.state.refreshTokens[h];
      if (!entry || entry.expires < Date.now() || entry.clientId !== client.client_id) return bad(400, 'invalid_grant', 'The refresh token is invalid or expired.');
      if (!this.resourceOk(f.resource, base)) return bad(400, 'invalid_target', 'Unknown resource.');
      delete this.store.state.refreshTokens[h]; // rotating
      if (!this.store.state.connections[entry.connectionId]) {
        this.store.save();
        return bad(400, 'invalid_grant', 'The Tulsi ERP sign-in has ended. Connect again.');
      }
      return send(res, 200, this.issue(entry.connectionId, client.client_id, entry.resource));
    }
    return bad(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  }

  issue(connectionId, clientId, resource) {
    const access = `tp_at_${random(32)}`;
    const refresh = `tp_rt_${random(32)}`;
    const now = Date.now();
    this.store.state.accessTokens[sha256(access)] = { connectionId, clientId, expires: now + this.cfg.accessTtlSeconds * 1000 };
    this.store.state.refreshTokens[sha256(refresh)] = { connectionId, clientId, resource: resource || null, expires: now + REFRESH_TTL_MS };
    const dropped = this.store.prune(now);
    this.store.save();
    for (const conn of dropped) this.backend.revoke(this.store.decrypt(conn.cred)).catch(() => {});
    return { access_token: access, token_type: 'Bearer', expires_in: this.cfg.accessTtlSeconds, refresh_token: refresh, scope: SCOPE };
  }

  /** Bearer tp_at_… → connection id, or null. */
  connectionFor(bearer) {
    if (!bearer || !bearer.startsWith('tp_at_')) return null;
    const entry = this.store.state.accessTokens[sha256(bearer)];
    if (!entry || entry.expires < Date.now()) return null;
    return this.store.state.connections[entry.connectionId] ? entry.connectionId : null;
  }

  // ---------- /revoke ----------
  async revoke(req, res) {
    let f = {};
    try {
      f = parseBody(req, await readBody(req));
    } catch {
      /* always 200 */
    }
    const h = sha256(f.token || '');
    const entry = this.store.state.accessTokens[h] || this.store.state.refreshTokens[h];
    if (entry) {
      const conn = this.store.dropConnection(entry.connectionId);
      this.store.save();
      if (conn) {
        await this.backend.revoke(this.store.decrypt(conn.cred)).catch(() => {});
        this.log({ event: 'revoked', client: conn.clientName });
      }
    }
    send(res, 200, {});
  }

  cleanupMaps() {
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.created > PENDING_TTL_MS) this.pending.delete(k);
    for (const [k, v] of this.codes) if (v.expires < now) this.codes.delete(k);
    for (const [k, v] of this.lockouts) if ((v.until || v.at + LOCK_MS) < now) this.lockouts.delete(k);
    for (const [k, v] of this.resetLimits) if (v.reset < now) this.resetLimits.delete(k);
  }
}

module.exports = { OAuth, SCOPE };
