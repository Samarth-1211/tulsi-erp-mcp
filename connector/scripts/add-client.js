#!/usr/bin/env node
'use strict';
/**
 * Pre-registered OAuth clients, for assistants whose admin types in a client
 * id and secret (Gemini Enterprise, Microsoft Copilot Studio, some ChatGPT
 * enterprise setups).
 *
 *   node connector/scripts/add-client.js --name "Gemini Enterprise" --redirect <uri> [--redirect <uri>…] [--public]
 *   node connector/scripts/add-client.js --list
 *   node connector/scripts/add-client.js --remove <client_id>
 *
 * Uses the same DATA_DIR and ALLOWED_REDIRECT_HOSTS as the server. Clients go
 * to DATA_DIR/preregistered-clients.json, which only this script writes; the
 * running connector reads it when it meets an unknown client_id, so no
 * restart is needed.
 */
const { loadConfig } = require('../server');
const { redirectAllowed, readPreregistered, writePreregistered } = require('../lib/clients');
const { sha256, random } = require('../lib/store');

const args = process.argv.slice(2);
const opt = (name) => {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) out.push(args[++i]);
  return out;
};

const cfg = loadConfig();
const clients = readPreregistered(cfg.dataDir);

if (args.includes('--list')) {
  for (const c of Object.values(clients)) console.log(`${c.client_id}\t${c.token_endpoint_auth_method}\t${c.client_name}\t${c.redirect_uris.join(' ')}`);
  if (!Object.keys(clients).length) console.log('No pre-registered clients.');
  process.exit(0);
}

const remove = opt('--remove')[0];
if (remove) {
  if (!clients[remove]) {
    console.error(`No pre-registered client ${remove}.`);
    process.exit(1);
  }
  delete clients[remove];
  writePreregistered(cfg.dataDir, clients);
  console.log(`Removed ${remove}. Its existing connections stay until they expire or the user disconnects.`);
  process.exit(0);
}

const name = opt('--name')[0];
const redirects = opt('--redirect');
if (!name || !redirects.length) {
  console.error('Usage: add-client.js --name "<assistant>" --redirect <uri> [--redirect <uri>…] [--public] | --list | --remove <client_id>');
  process.exit(1);
}
const bad = redirects.filter((r) => !redirectAllowed(r, cfg.allowedRedirectHosts));
if (bad.length) {
  console.error(`Not on ALLOWED_REDIRECT_HOSTS: ${bad.join(', ')}\nAdd the host to ALLOWED_REDIRECT_HOSTS first.`);
  process.exit(1);
}
const isPublic = args.includes('--public');
const id = `tp_${random(16)}`;
const secret = isPublic ? null : random(32);
clients[id] = {
  client_id: id,
  client_name: name.slice(0, 100),
  redirect_uris: redirects,
  token_endpoint_auth_method: isPublic ? 'none' : 'client_secret_post',
  client_secret_hash: secret ? sha256(secret) : null,
  source: 'pre-registered',
  createdAt: Date.now(),
};
writePreregistered(cfg.dataDir, clients);
const base = cfg.publicUrl || `http://localhost:${cfg.port}`;
console.log(`Client created. The secret is shown only now: copy it into the assistant's admin screen.

  client_id      ${id}
  client_secret  ${secret || '(public client: none)'}
  authorize URL  ${base}/authorize
  token URL      ${base}/token
  scope          erp
  PKCE           S256 (required)`);
