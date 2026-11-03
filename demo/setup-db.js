#!/usr/bin/env node
'use strict';
/**
 * Creates the demo database tulsi_erp_demo (or recreates it with --reset)
 * and applies the backend's Prisma migrations to it. Never any other database.
 *
 *   node demo/setup-db.js [--reset]
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { BACKEND, DEMO_DB, demoUrl, assertDemo } = require('./demo-env');

const url = assertDemo(demoUrl());
const admin = new URL(url);
admin.pathname = '/postgres';
const prisma = path.join(BACKEND, 'node_modules', 'prisma', 'build', 'index.js');

function sql(statement) {
  const r = spawnSync(process.execPath, [prisma, 'db', 'execute', '--url', admin.toString(), '--stdin'], { input: statement, encoding: 'utf8', cwd: BACKEND });
  return r;
}

if (process.argv.includes('--reset')) {
  const r = sql(`DROP DATABASE IF EXISTS "${DEMO_DB}" WITH (FORCE);`);
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
  console.log(`Dropped ${DEMO_DB}.`);
}
const created = sql(`CREATE DATABASE "${DEMO_DB}";`);
if (created.status === 0) console.log(`Created ${DEMO_DB}.`);
else if (!/already exists/i.test(created.stderr + created.stdout)) {
  console.error(created.stderr || created.stdout);
  process.exit(1);
}

const m = spawnSync(process.execPath, [prisma, 'migrate', 'deploy'], { cwd: BACKEND, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
process.stdout.write((m.stdout || '').split('\n').slice(-6).join('\n'));
if (m.status !== 0) {
  console.error(m.stderr);
  process.exit(1);
}
console.log(`\nMigrations applied to ${DEMO_DB}.`);
