'use strict';
/** Small HTTP helpers: JSON/HTML responses with CORS and security headers, body reading and parsing. */

const MAX_BODY_BYTES = 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
};

const HTML_SECURITY = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'",
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function sendHtml(res, status, html, headers = {}) {
  res.writeHead(status, { ...CORS, ...HTML_SECURITY, 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(302, { ...CORS, Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end();
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** JSON or application/x-www-form-urlencoded → plain object. Throws {status:400} on bad JSON. */
function parseBody(req, raw) {
  if (!raw) return {};
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try {
    return JSON.parse(raw);
  } catch {
    if (type.includes('json')) throw Object.assign(new Error('Invalid JSON'), { status: 400 });
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

/**
 * The client IP as the edge proxy (Caddy/Nginx) saw it. With trustProxy hops,
 * take that entry from the right of X-Forwarded-For; otherwise the socket address.
 */
function clientIp(req, trustProxy) {
  const socketIp = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (!trustProxy) return socketIp;
  const chain = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!chain.length) return socketIp;
  return chain[Math.max(0, chain.length - trustProxy)] || socketIp;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { CORS, send, sendHtml, redirect, readBody, parseBody, clientIp, escapeHtml, MAX_BODY_BYTES };
