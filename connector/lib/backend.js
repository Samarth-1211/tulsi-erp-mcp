'use strict';
/**
 * Calls to the Tulsi ERP API, always as the signed-in user.
 *
 * Two credential modes, picked at sign-in:
 *  - "pat": the backend has POST /auth/personal-access-tokens → one tp_pat_
 *    token named after the assistant; the login session is logged out at once.
 *  - "session": older backend (that route answers 404) → keep the session's
 *    access + refresh token, refresh before expiry / on 401. Refreshes are
 *    deduplicated per connection: Tulsi ERP revokes every session when a
 *    rotated refresh token is reused, so two parallel refreshes must never happen.
 */

class SessionEnded extends Error {
  constructor() {
    super(
      'The Tulsi ERP session has ended (signed out, password changed or account deactivated). ' +
        'Ask the user to reconnect the Tulsi ERP connector and sign in again.',
    );
    this.name = 'SessionEnded';
  }
}

function messageOf(data, fallback) {
  const m = data && typeof data === 'object' ? data.message : null;
  if (Array.isArray(m)) return m.join('; ');
  if (typeof m === 'string' && m) return m;
  if (typeof data === 'string' && data && data.length < 300) return data;
  return fallback;
}

function jwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1] || '', 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function queryString(query) {
  if (!query) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) for (const item of v) qs.append(k, String(item));
    else if (typeof v === 'object') qs.append(k, JSON.stringify(v));
    else qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

class Backend {
  constructor({ apiUrl, store, version, log = () => {}, timeoutMs = 30_000 }) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.store = store;
    this.version = version;
    this.log = log;
    this.timeoutMs = timeoutMs;
    this.refreshing = new Map();
  }

  async request(method, path, { query, body, token, xff, idempotencyKey, timeoutMs } = {}) {
    const headers = { Accept: 'application/json', 'X-Client': `tulsi-erp-mcp/${this.version}` };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (xff) headers['X-Forwarded-For'] = xff;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(this.apiUrl + path + queryString(query), {
        method,
        headers,
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs || this.timeoutMs),
        redirect: 'manual',
      });
    } catch {
      return { ok: false, status: 0, data: null, message: "Tulsi ERP can't be reached right now" };
    }
    const text = await res.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return { ok: res.ok, status: res.status, data, message: res.ok ? null : messageOf(data, `Tulsi ERP answered ${res.status}`) };
  }

  /**
   * Email + password → a per-user credential. Never stores the password.
   * Returns {ok, user, cred} or {ok:false, status, message, kind}.
   */
  async signIn(email, password, { xff, clientName }) {
    const login = await this.request('POST', '/auth/login', { body: { email, password }, xff });
    if (!login.ok) {
      const kind =
        login.status === 0
          ? 'unreachable'
          : login.status === 429
            ? 'rate_limited'
            : /verify/i.test(login.message || '')
              ? 'verify'
              : /organi[sz]ation/i.test(login.message || '')
                ? 'org_inactive'
                : login.status === 401
                  ? 'invalid'
                  : 'error';
      return { ok: false, status: login.status, message: login.message, kind };
    }
    const { accessToken, refreshToken, user } = login.data || {};
    if (!accessToken || !user) return { ok: false, status: 502, kind: 'error', message: 'Tulsi ERP sent an unexpected sign-in answer.' };

    // Platform super admins never connect: same message as a wrong password.
    if (user.role === 'SUPER_ADMIN' || !user.orgId) {
      await this.request('POST', '/auth/logout', { body: { refreshToken } });
      return { ok: false, status: 401, kind: 'invalid', message: 'Invalid email or password' };
    }

    const pat = await this.request('POST', '/auth/personal-access-tokens', {
      token: accessToken,
      body: { name: String(clientName || 'AI assistant').slice(0, 100), expiresInDays: 90 },
    });
    let cred;
    if (pat.ok && pat.data?.token) {
      cred = { mode: 'pat', pat: pat.data.token, patId: pat.data.id };
      await this.request('POST', '/auth/logout', { body: { refreshToken } });
    } else if (pat.status === 404) {
      cred = { mode: 'session', accessToken, refreshToken };
    } else {
      await this.request('POST', '/auth/logout', { body: { refreshToken } });
      return { ok: false, status: pat.status, kind: 'error', message: pat.message || 'Could not finish connecting to Tulsi ERP.' };
    }
    return {
      ok: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId },
      cred,
    };
  }

  credential(connectionId) {
    const conn = this.store.state.connections[connectionId];
    if (!conn) return null;
    return this.store.decrypt(conn.cred);
  }

  /** The user's current role: from the session JWT (fresh after each refresh) or the sign-in answer. */
  role(connectionId) {
    const conn = this.store.state.connections[connectionId];
    if (!conn) return null;
    const cred = this.store.decrypt(conn.cred);
    if (cred?.mode === 'session') return jwtPayload(cred.accessToken)?.role || conn.user.role;
    return conn.user.role;
  }

  endConnection(connectionId, reason) {
    if (this.store.state.connections[connectionId]) {
      this.store.dropConnection(connectionId);
      this.store.save();
      this.log({ event: 'connection_ended', reason });
    }
  }

  /** Refresh a session credential once; parallel callers share one refresh. */
  refreshSession(connectionId, failedAccessToken) {
    if (this.refreshing.has(connectionId)) return this.refreshing.get(connectionId);
    const job = (async () => {
      const current = this.credential(connectionId);
      if (!current || current.mode !== 'session') return null;
      // Someone else already refreshed after our token failed: use theirs.
      if (failedAccessToken && current.accessToken !== failedAccessToken) return current;
      const r = await this.request('POST', '/auth/refresh', { body: { refreshToken: current.refreshToken } });
      if (!r.ok || !r.data?.accessToken) return r.status === 0 ? current : null;
      const next = { mode: 'session', accessToken: r.data.accessToken, refreshToken: r.data.refreshToken };
      const conn = this.store.state.connections[connectionId];
      if (!conn) return null;
      conn.cred = this.store.encrypt(next);
      const role = jwtPayload(next.accessToken)?.role;
      if (role) conn.user.role = role;
      this.store.save();
      return next;
    })().finally(() => this.refreshing.delete(connectionId));
    this.refreshing.set(connectionId, job);
    return job;
  }

  /** A Tulsi ERP call as the connection's user. Throws SessionEnded when the credential is gone. */
  async call(connectionId, method, path, opts = {}) {
    let cred = this.credential(connectionId);
    if (!cred) {
      this.endConnection(connectionId, 'credential_unreadable');
      throw new SessionEnded();
    }
    if (cred.mode === 'session') {
      const exp = jwtPayload(cred.accessToken)?.exp;
      if (exp && exp * 1000 < Date.now() + 10_000) {
        cred = await this.refreshSession(connectionId, cred.accessToken);
        if (!cred) {
          this.endConnection(connectionId, 'refresh_failed');
          throw new SessionEnded();
        }
      }
    }
    const token = cred.mode === 'pat' ? cred.pat : cred.accessToken;
    let r = await this.request(method, path, { ...opts, token });
    if (r.status !== 401) return r;
    if (cred.mode === 'pat') {
      this.endConnection(connectionId, 'pat_rejected');
      throw new SessionEnded();
    }
    const next = await this.refreshSession(connectionId, cred.accessToken);
    if (!next) {
      this.endConnection(connectionId, 'refresh_failed');
      throw new SessionEnded();
    }
    // The refresh itself couldn't reach Tulsi ERP: report that, keep the connection.
    if (next.accessToken === cred.accessToken) return { ok: false, status: 0, data: null, message: "Tulsi ERP can't be reached right now" };
    r = await this.request(method, path, { ...opts, token: next.accessToken });
    if (r.status === 401) {
      this.endConnection(connectionId, 'session_rejected');
      throw new SessionEnded();
    }
    return r;
  }

  /** Disconnect at Tulsi ERP: revoke the PAT, or log the session out. Best effort. */
  async revoke(cred) {
    if (!cred) return;
    if (cred.mode === 'pat') await this.request('DELETE', '/auth/personal-access-tokens/current', { token: cred.pat });
    else if (cred.refreshToken) await this.request('POST', '/auth/logout', { body: { refreshToken: cred.refreshToken } });
  }

  forgotPassword(email, xff) {
    return this.request('POST', '/auth/forgot-password', { body: { email }, xff });
  }

  resetPassword(email, otp, newPassword, xff) {
    return this.request('POST', '/auth/reset-password', { body: { email, otp, newPassword }, xff });
  }

  async health() {
    const r = await this.request('GET', '/health', { timeoutMs: 5000 });
    return r.status !== 0 && r.status < 500;
  }
}

module.exports = { Backend, SessionEnded, jwtPayload, queryString };
