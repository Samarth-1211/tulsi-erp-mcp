#!/usr/bin/env node
'use strict';
/**
 * Runs the Tulsi ERP backend from source against tulsi_erp_demo on port 3070.
 * Mail goes to a dead port, so invites/reset codes fail with 503 instead of
 * reaching real people. The backend's .env still supplies JWT secrets etc.;
 * the overrides below win (dotenv never overrides set variables).
 *
 *   node demo/start-backend.js
 */
const { spawn } = require('child_process');
const path = require('path');
const { BACKEND, DEMO_PORT, demoUrl, assertDemo } = require('./demo-env');

const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(DEMO_PORT),
  DATABASE_URL: assertDemo(demoUrl()),
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '9',
  SMTP_USER: 'demo',
  SMTP_PASS: 'demo',
  AUTO_VERIFY_NEW_USERS: 'true',
  WHATSAPP_DEBUG_SIMULATE_ENABLED: 'false',
  SWAGGER_ENABLED: 'false',
  TRUST_PROXY: 'loopback',
  TS_NODE_TRANSPILE_ONLY: 'true',
};

const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', path.join('src', 'main.ts')], { cwd: BACKEND, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
