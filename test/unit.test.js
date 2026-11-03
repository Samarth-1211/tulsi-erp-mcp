'use strict';
// Offline unit tests (no backend, no database): node --test test/
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fmt = require('../connector/lib/format');
const { redirectAllowed, sameRedirect, isPrivateAddress } = require('../connector/lib/clients');
const { parseStockQuery, matchesStock } = require('../connector/lib/curated');
const { shapeList, clean } = require('../connector/lib/shape');
const { Catalog } = require('../connector/lib/catalog');
const { Store } = require('../connector/lib/store');
const os = require('os');
const fs = require('fs');

const catalog = new Catalog(path.join(__dirname, '..', 'catalog', 'actions.json'));
const ALLOW = ['claude.ai', 'chatgpt.com'];

test('business time: inputs without a zone are IST, outputs shown in IST', () => {
  assert.strictEqual(fmt.normalizeDateTime('2026-11-05T11:00'), '2026-11-05T11:00:00+05:30');
  assert.strictEqual(fmt.normalizeDateTime('2026-11-05 11:00:00'), '2026-11-05T11:00:00+05:30');
  assert.strictEqual(fmt.normalizeDateTime('2026-11-05T11:00:00Z'), '2026-11-05T11:00:00Z');
  assert.strictEqual(fmt.normalizeDateTime('2026-11-05'), '2026-11-05');
  assert.strictEqual(fmt.toBusinessTime('2026-11-05T05:30:00.000Z'), '2026-11-05T11:00+05:30');
  assert.strictEqual(fmt.toBusinessTime('2026-11-05T00:00:00.000Z'), '2026-11-05'); // @db.Date column
  assert.strictEqual(fmt.businessDate(new Date('2026-11-03T20:00:00Z')), '2026-11-04'); // 01:30 IST next day
  assert.match(fmt.describeInstant('2026-11-09T11:00:00+05:30'), /Mon, 9 Nov,? 2026,? 11:00 am IST/i);
});

test('named periods follow the IST calendar', () => {
  const now = new Date('2026-11-04T10:00:00+05:30'); // a Wednesday
  assert.deepStrictEqual(fmt.period('today', now), { from: '2026-11-04', to: '2026-11-04' });
  assert.deepStrictEqual(fmt.period('this_week', now), { from: '2026-11-02', to: '2026-11-04' });
  assert.deepStrictEqual(fmt.period('last_week', now), { from: '2026-10-26', to: '2026-11-01' });
  assert.deepStrictEqual(fmt.period('last_month', now), { from: '2026-10-01', to: '2026-10-31' });
  assert.strictEqual(fmt.period('someday', now), null);
});

test('Indian number grouping and units', () => {
  assert.strictEqual(fmt.formatNumber(1234567), '12,34,567');
  assert.strictEqual(fmt.formatQuantity(50, 'SHEET'), '50 sheets');
  assert.strictEqual(fmt.formatQuantity(1, 'BOX'), '1 box');
});

test('redirect allowlist', () => {
  assert.ok(redirectAllowed('https://claude.ai/api/mcp/auth_callback', ALLOW));
  assert.ok(redirectAllowed('http://localhost:33418/callback', ALLOW));
  assert.ok(redirectAllowed('http://127.0.0.1:5000/cb', ALLOW));
  assert.ok(!redirectAllowed('http://claude.ai/cb', ALLOW));
  assert.ok(!redirectAllowed('https://evil.example/cb', ALLOW));
  assert.ok(!redirectAllowed('https://claude.ai/cb#frag', ALLOW));
  assert.ok(!redirectAllowed('javascript:alert(1)', ALLOW));
  assert.ok(sameRedirect('http://localhost:1/cb', 'http://localhost:2/cb'));
  assert.ok(!sameRedirect('https://claude.ai/a', 'https://claude.ai/b'));
});

test('CIMD SSRF guard: private addresses', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ['8.8.8.8', '104.18.0.1', '2606:4700::1']) assert.ok(!isPrivateAddress(ip), ip);
});

test('stock queries the way staff say them', () => {
  assert.deepStrictEqual(parseStockQuery('Century 18mm BWP 8x4'), { words: ['century'], thickness: '18', size: ['8', '4'], grade: 'bwp' });
  const q = parseStockQuery('18 mm bwr 8 by 4 kitna hai');
  assert.strictEqual(q.thickness, '18');
  assert.deepStrictEqual(q.size, ['8', '4']);
  assert.strictEqual(q.grade, 'bwr');
  assert.deepStrictEqual(q.words, []);
  assert.strictEqual(parseStockQuery('greenply laminate').category, 'LAMINATE');
  const p = { name: 'Century BWP 18mm Plywood', brand: 'Century', grade: 'BWP', thickness: '18mm', size: '8x4 ft' };
  assert.ok(matchesStock(p, parseStockQuery('18mm bwp 4x8'))); // either order
  assert.ok(!matchesStock(p, parseStockQuery('12mm bwp')));
});

test('list shaping: totals from the server, counts over every filtered row, secrets dropped', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: `id${i}`, name: `Lead ${i}`, status: i % 3 ? 'NEW' : 'LOST', assignedTo: { name: i % 2 ? 'Amit' : 'Priya' }, passwordHash: 'x', price: 10 }));
  const out = shapeList(rows, { limit: 5, serverTotal: 30 });
  assert.strictEqual(out.total, 30);
  assert.strictEqual(out.shown, 5);
  assert.deepStrictEqual(out.summary.status, { NEW: 20, LOST: 10 });
  assert.deepStrictEqual(out.summary.assignedTo, { Priya: 15, Amit: 15 });
  assert.ok(!JSON.stringify(out.rows).includes('passwordHash'));
  assert.ok(!JSON.stringify(out.rows).includes('price'));
  const filtered = shapeList(rows, { where: { assignedTo: 'ami' }, serverTotal: 30 });
  assert.strictEqual(filtered.total, 15);
  assert.strictEqual(filtered.totalBeforeFilter, 30);
  const partial = shapeList(rows, { serverTotal: 500 });
  assert.match(partial.note, /Only the first 30 of 500/);
  assert.deepStrictEqual(clean({ a: null, webhookUrl: 'x', b: { verifyToken: 'y', c: 1 } }), { b: { c: 1 } });
});

test('catalog: names, roles, write levels, search and validation', () => {
  assert.ok(catalog.actions.length > 80);
  assert.ok(catalog.find('approve_leave', 'MANAGER').error.includes('switched off'));
  assert.ok(catalog.find('team_performance', 'CALLER').error.includes("can't use"));
  assert.ok(catalog.find('list_leads', 'CALLER').action);
  assert.ok(catalog.find('nope', 'ADMIN').error.includes('search_erp_actions'));
  for (const a of catalog.actions) assert.match(a.name, /^[a-z][a-z0-9_]{0,63}$/);
  assert.strictEqual(new Set(catalog.actions.map((a) => a.name)).size, catalog.actions.length);
  assert.ok(!catalog.actions.some((a) => a.path.startsWith('/auth') || a.path.startsWith('/webhooks') || /reveal|debug|password/.test(a.path)));
  const s = catalog.search('aaj ke follow-up', 'CALLER').map((m) => m.action);
  assert.ok(s.includes('followups_due_today'), s.join());
  const a = catalog.byName.get('change_lead_status');
  assert.deepStrictEqual(catalog.validate(a, { id: 'x', body: { status: 'LOST', lostReason: 'Price' } }), []);
  assert.ok(catalog.validate(a, { id: 'x', body: { status: 'WON' } }).some((e) => /one of/.test(e)));
  assert.ok(catalog.validate(a, { body: { status: 'LOST' } }).some((e) => /id is required/.test(e)));
  const req = catalog.buildRequest(catalog.byName.get('log_follow_up'), { id: 'a/b', body: { note: 'n', nextFollowUpAt: '2026-11-05T11:00' } });
  assert.strictEqual(req.path, '/leads/a%2Fb/follow-ups');
  assert.strictEqual(req.body.nextFollowUpAt, '2026-11-05T11:00:00+05:30');
  const schema = JSON.stringify(catalog.inputSchema(catalog.byName.get('create_lead')));
  assert.ok(!/"\$ref"|"oneOf"|"anyOf"|"pattern"/.test(schema));
});

test('store: AES-256-GCM round trip, wrong key fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-store-'));
  const s = new Store(dir, 'k'.repeat(40));
  const blob = s.encrypt({ refreshToken: 'secret' });
  assert.ok(!blob.includes('secret'));
  assert.deepStrictEqual(s.decrypt(blob), { refreshToken: 'secret' });
  assert.strictEqual(new Store(dir, 'other-key-other-key-other-key-123').decrypt(blob), null);
});
