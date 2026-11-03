'use strict';
/**
 * Shared settings for the demo environment. The demo database is ALWAYS
 * `tulsi_erp_demo` on the same server as the backend's own .env database;
 * every script refuses any other name, so the real/shared database
 * (wholeseler_erp) is never touched.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.resolve(process.env.BACKEND_DIR || path.join(ROOT, '..', 'RCRM_Backend'));
const DEMO_DB = 'tulsi_erp_demo';
const DEMO_PORT = Number(process.env.DEMO_API_PORT || 3070);
const DEMO_PASSWORD = 'Demo@Tulsi2026';

function backendEnvUrl() {
  const env = fs.readFileSync(path.join(BACKEND, '.env'), 'utf8');
  const m = /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(env);
  if (!m) throw new Error('DATABASE_URL not found in the backend .env');
  return m[1].trim();
}

/** The backend's DATABASE_URL with the database name swapped for tulsi_erp_demo. */
function demoUrl(dbName = DEMO_DB) {
  const u = new URL(backendEnvUrl());
  u.pathname = `/${dbName}`;
  return u.toString();
}

function assertDemo(url) {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (name !== DEMO_DB) throw new Error(`Refusing to use database "${name}": demo scripts only touch ${DEMO_DB}.`);
  return url;
}

const backendRequire = (m) => require(require.resolve(m, { paths: [BACKEND] }));

module.exports = { ROOT, BACKEND, DEMO_DB, DEMO_PORT, DEMO_PASSWORD, demoUrl, assertDemo, backendRequire };
