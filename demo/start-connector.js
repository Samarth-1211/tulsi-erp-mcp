#!/usr/bin/env node
'use strict';
/**
 * Runs the connector against the demo backend (http://localhost:3070) on
 * http://localhost:8790, with a DEMO badge and its state in demo/.data.
 * For Claude/ChatGPT/Gemini on the web you need a public https URL: put a
 * tunnel in front (see README) and set PUBLIC_URL to it.
 *
 *   node demo/start-connector.js            # catalog mode (what users get)
 *   TOOL_MODE=direct node demo/start-connector.js
 */
const path = require('path');
const { DEMO_PORT } = require('./demo-env');

process.env.API_URL = process.env.API_URL || `http://localhost:${DEMO_PORT}`;
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '.data');
process.env.PORT = process.env.PORT || '8790';
process.env.BADGE = process.env.BADGE ?? 'DEMO';
process.env.SIGNIN_HINT = process.env.SIGNIN_HINT ?? 'Demo: sign in with a login from demo/DEMO-ACCOUNTS.md.';

const { createServer, loadConfig } = require('../connector/server');
const cfg = loadConfig();
const app = createServer(cfg);
app.server.listen(cfg.port, cfg.host, () => {
  console.log(`Tulsi ERP connector (demo) on http://localhost:${cfg.port}/mcp → ${cfg.apiUrl}${cfg.publicUrl ? ` · public ${cfg.publicUrl}/mcp` : ''}`);
});
