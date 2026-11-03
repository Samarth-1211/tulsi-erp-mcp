'use strict';
/**
 * Persistent connector state in one JSON file (DATA_DIR/state.json):
 * clients, connections, accessTokens, refreshTokens, drafts. Tokens are stored
 * only as SHA-256; Tulsi ERP credentials are AES-256-GCM encrypted with a key
 * derived from CONNECTOR_SECRET. One container only: several containers need a
 * real database instead.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY = () => ({ clients: {}, connections: {}, accessTokens: {}, refreshTokens: {}, drafts: {} });

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const random = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

class Store {
  constructor(dataDir, secret) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'state.json');
    this.key = crypto.createHash('sha256').update(String(secret)).digest();
    this.state = EMPTY();
    try {
      this.state = { ...EMPTY(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw new Error(`Cannot read ${this.file}: ${err.message}`);
    }
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
  }

  /** Returns null when the blob can't be decrypted (e.g. CONNECTOR_SECRET changed). */
  decrypt(blob) {
    try {
      const [iv, tag, data] = String(blob).split('.').map((p) => Buffer.from(p, 'base64url'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
    } catch {
      return null;
    }
  }

  /** Drops a connection with every token and draft that belongs to it. Returns the connection. */
  dropConnection(connectionId) {
    const conn = this.state.connections[connectionId];
    delete this.state.connections[connectionId];
    for (const table of ['accessTokens', 'refreshTokens', 'drafts']) {
      for (const [k, v] of Object.entries(this.state[table])) if (v.connectionId === connectionId) delete this.state[table][k];
    }
    return conn;
  }

  /**
   * Removes expired tokens and drafts, and connections that no longer have a
   * refresh token (older than the grace period, so a fresh sign-in waiting for
   * its code exchange survives). Returns the dropped connections so the caller
   * can revoke their Tulsi ERP credentials.
   */
  prune(now = Date.now(), graceMs = 15 * 60_000) {
    for (const table of ['accessTokens', 'refreshTokens', 'drafts']) {
      for (const [k, v] of Object.entries(this.state[table])) if (v.expires <= now) delete this.state[table][k];
    }
    const alive = new Set(Object.values(this.state.refreshTokens).map((t) => t.connectionId));
    const dropped = [];
    for (const [id, conn] of Object.entries(this.state.connections)) {
      if (!alive.has(id) && now - conn.createdAt > graceMs) dropped.push(this.dropConnection(id));
    }
    return dropped;
  }
}

module.exports = { Store, sha256, random };
