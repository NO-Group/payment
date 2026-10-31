/* ================================================================
   DEVPAY SERVER
   Zero-dependency Node server (Node 18+)

   Responsibilities
   ─────────────────
   1. Serve the static site (index.html, css/, js/).
   2. POST /api/initialize  → creates the transaction WITH the secret
      key, routes it to the subaccount, returns the access code.
   3. GET  /api/verify/:ref → asks Paystack whether it really
      succeeded. The success screen is only shown when this says so.
   4. POST /api/paystack/webhook → signed charge.success events,
      so a payment is recorded even if the buyer closes the tab.

   The secret key never leaves this process.

   Run:  node server.js      (config via environment or .env)
================================================================ */

'use strict';

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (NODE_MAJOR < 18) {
  console.error(`\n  Node 18 or newer is required (found ${process.versions.node}).\n`);
  process.exit(1);
}

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* ----------------------------------------------------------------
   1. CONFIG
---------------------------------------------------------------- */
const ROOT = __dirname;

/* Minimal .env loader — no dependency needed. Existing env wins. */
function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (err) {
    console.warn('[env] could not read .env:', err.message);
  }
}
loadEnvFile();

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

const CONFIG = {
  port: envNumber('PORT', 3000),
  siteUrl: process.env.SITE_URL || '',

  /* Paystack */
  paystackBase: (process.env.PAYSTACK_API_BASE || 'https://api.paystack.co').replace(/\/+$/, ''),
  publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
  secretKey: process.env.PAYSTACK_SECRET_KEY || '',

  /* Split / subaccount routing — every payment goes here */
  subaccount: process.env.SUBACCOUNT_CODE || 'ACCT_4i2l4tyiv5p48cu',
  bearer: (process.env.BEARER || 'account').toLowerCase() === 'subaccount' ? 'subaccount' : 'account',
  transactionChargeNGN: envNumber('TRANSACTION_CHARGE_NGN', 0),

  /* Money */
  usdToNgnRate: envNumber('USD_TO_NGN_RATE', 1600),
  minNgn: envNumber('MIN_AMOUNT_NGN', 100),
  maxNgn: envNumber('MAX_AMOUNT_NGN', 5000000),

  /* Contact (used only in server logs / error guidance, never rendered) */
  supportEmail: process.env.SUPPORT_EMAIL || '',

  /* Behaviour */
  verifyAttempts: envNumber('VERIFY_ATTEMPTS', 6),
  requestTimeoutMs: envNumber('REQUEST_TIMEOUT_MS', 15000),

  /* Rate limits (per IP) */
  initRateLimit: envNumber('INIT_RATE_LIMIT', 15),
  verifyRateLimit: envNumber('VERIFY_RATE_LIMIT', 60),
};

const CHANNELS = ['card', 'bank', 'ussd', 'bank_transfer', 'mobile_money'];

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

/* ----------------------------------------------------------------
   2. SMALL UTILITIES
---------------------------------------------------------------- */
function sendJSON(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function readBody(req, limitBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on('data', (chunk) => {
      if (tooLarge) return;            // keep draining so the response can be sent
      size += chunk.length;
      if (size > limitBytes) {
        tooLarge = true;
        chunks.length = 0;
        const err = new Error('Request body too large');
        err.code = 'TOO_LARGE';
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

async function readJSON(req, limitBytes) {
  const raw = await readBody(req, limitBytes);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.trim());
}

function reference() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `DEVPAY-${stamp}-${rand}`;
}

/* Strip control chars, trim, clamp length — everything ends up in Paystack metadata */
function cleanText(value, maxLength = 160) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength);
}

/* Very small in-memory rate limiter (per IP + route) */
const rateBuckets = new Map();

function rateLimit(ip, route, max, windowMs) {
  const key = `${ip}:${route}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

/* Drop expired buckets so the map can't grow without bound */
const rateSweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(key);
  }
}, 60_000);
rateSweeper.unref?.();

/* ----------------------------------------------------------------
   3. PAYSTACK CLIENT (secret-key calls only happen here)
---------------------------------------------------------------- */
async function paystackRequest(endpoint, { method = 'GET', body } = {}) {
  if (!CONFIG.secretKey) {
    const err = new Error('Paystack secret key is not configured on the server.');
    err.code = 'NO_SECRET_KEY';
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

  try {
    const response = await fetch(`${CONFIG.paystackBase}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${CONFIG.secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { status: false, message: 'Unexpected response from Paystack' };
    }

    return { ok: response.ok, statusCode: response.status, json };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Paystack did not respond in time. Please try again.');
      timeoutErr.code = 'TIMEOUT';
      throw timeoutErr;
    }
    const networkErr = new Error('Could not reach Paystack. Check the server connection.');
    networkErr.code = 'NETWORK';
    throw networkErr;
  } finally {
    clearTimeout(timer);
  }
}

/* ----------------------------------------------------------------
   4. AMOUNT HANDLING (server-side authority)
---------------------------------------------------------------- */
function resolveAmount(body) {
  const currency = body.currency === 'USD' ? 'USD' : 'NGN';
  const value = Number(body.amount);

  if (!Number.isFinite(value) || value <= 0) {
    return { error: 'Enter an amount greater than zero.' };
  }
  if (!Number.isFinite(CONFIG.usdToNgnRate) || CONFIG.usdToNgnRate <= 0) {
    return { error: 'Server exchange rate is misconfigured.' };
  }

  const ngn = currency === 'USD' ? value * CONFIG.usdToNgnRate : value;
  const ngnRounded = Math.round(ngn * 100) / 100;
  const kobo = Math.round(ngnRounded * 100);

  if (kobo < Math.round(CONFIG.minNgn * 100)) {
    return { error: `The minimum payment is ₦${CONFIG.minNgn.toLocaleString('en-NG')}.` };
  }
  if (kobo > Math.round(CONFIG.maxNgn * 100)) {
    return {
      error: `That amount is above ₦${CONFIG.maxNgn.toLocaleString('en-NG')}. Contact ${CONFIG.supportEmail} to arrange a larger payment.`,
    };
  }

  return { currency, value, ngn: ngnRounded, kobo };
}

/* ----------------------------------------------------------------
   5. API — INITIALIZE
---------------------------------------------------------------- */
async function handleInitialize(req, res) {
  const ip = clientIp(req);
  if (!rateLimit(ip, 'initialize', CONFIG.initRateLimit, 60_000)) {
    return sendJSON(res, 429, { ok: false, error: 'Too many attempts. Wait a minute and try again.' });
  }

  let body;
  try {
    body = await readJSON(req);
  } catch (err) {
    const tooLarge = err.code === 'TOO_LARGE';
    return sendJSON(res, tooLarge ? 413 : 400, {
      ok: false,
      error: tooLarge ? 'Request too large.' : 'Invalid request.',
    });
  }

  const email = cleanText(body.email, 120);
  if (!isValidEmail(email)) {
    return sendJSON(res, 400, { ok: false, error: 'Enter a valid email address for the receipt.', field: 'email' });
  }

  const amount = resolveAmount(body);
  if (amount.error) {
    return sendJSON(res, 400, { ok: false, error: amount.error, field: 'amount' });
  }

  const payerName = cleanText(body.name, 80);
  const github = cleanText(body.github, 60);
  const workReference = cleanText(body.reference, 120);
  const note = cleanText(body.note, 240);
  const ref = reference();

  const payload = {
    email,
    amount: amount.kobo,
    currency: 'NGN',
    reference: ref,
    channels: CHANNELS,
    metadata: {
      purpose: 'GitHub development work — custom amount',
      custom_fields: [
        { display_name: 'Payer Name', variable_name: 'buyer_name', value: payerName || 'Anonymous' },
        { display_name: 'GitHub Handle', variable_name: 'github_handle', value: github || 'Not provided' },
        { display_name: 'Amount Typed', variable_name: 'amount_typed', value: `${amount.value} ${amount.currency}` },
        { display_name: 'Amount NGN', variable_name: 'amount_ngn', value: String(amount.ngn) },
        { display_name: 'PR / Issue', variable_name: 'work_reference', value: workReference || 'None' },
        { display_name: 'Invoice Note', variable_name: 'invoice_note', value: note || 'None' },
      ],
    },
  };

  if (CONFIG.subaccount) payload.subaccount = CONFIG.subaccount;
  if (CONFIG.bearer) payload.bearer = CONFIG.bearer;
  if (CONFIG.transactionChargeNGN > 0) {
    payload.transaction_charge = Math.round(CONFIG.transactionChargeNGN * 100);
  }
  if (CONFIG.siteUrl) {
    payload.callback_url = `${CONFIG.siteUrl.replace(/\/+$/, '')}/?reference=${encodeURIComponent(ref)}`;
  }

  try {
    const { ok, json } = await paystackRequest('/transaction/initialize', { method: 'POST', body: payload });

    if (!ok || !json.status || !json.data?.access_code) {
      log('[initialize] Paystack refused:', json.message);
      return sendJSON(res, 502, { ok: false, error: 'Payment unavailable. Please try again.' });
    }

    log(`[initialize] ${ref} ₦${amount.ngn} → ${CONFIG.subaccount || 'main account'} (${email})`);

    return sendJSON(res, 200, {
      ok: true,
      reference: json.data.reference || ref,
      accessCode: json.data.access_code,
      authorizationUrl: json.data.authorization_url || null,
      amount: { ngn: amount.ngn, kobo: amount.kobo, typed: amount.value, currency: amount.currency },
    });
  } catch (err) {
    log('[initialize] error:', err.message);
    return sendJSON(res, 502, { ok: false, error: 'Payment unavailable. Please try again.' });
  }
}

/* ----------------------------------------------------------------
   6. API — VERIFY (the source of truth for the success screen)
---------------------------------------------------------------- */
async function handleVerify(req, res, rawReference) {
  const ip = clientIp(req);
  if (!rateLimit(ip, 'verify', CONFIG.verifyRateLimit, 60_000)) {
    return sendJSON(res, 429, { ok: false, error: 'Too many verification attempts. Wait a minute.' });
  }

  const ref = decodeURIComponent(String(rawReference || '')).trim();
  if (!/^[A-Za-z0-9._=-]{6,120}$/.test(ref)) {
    return sendJSON(res, 400, { ok: false, error: 'Invalid transaction reference.' });
  }

  try {
    const { ok, statusCode, json } = await paystackRequest(`/transaction/verify/${encodeURIComponent(ref)}`);

    if (!ok || !json.status || !json.data) {
      log('[verify] Paystack refused:', statusCode, json.message);
      return sendJSON(res, statusCode === 404 ? 404 : 502, {
        ok: false,
        status: 'unknown',
        reference: ref,
        error: 'Could not confirm this payment.',
      });
    }

    const data = json.data;
    const paidOK = data.status === 'success';
    const routedTo =
      (data.subaccount && (data.subaccount.subaccount_code || data.subaccount)) ||
      (data.split && data.split.subaccount_code) ||
      null;

    const routedCorrectly = CONFIG.subaccount
      ? String(routedTo || '').toUpperCase() === CONFIG.subaccount.toUpperCase()
      : true;

    /* Every failure state that Paystack can report */
    const statusMap = {
      success: 'success',
      failed: 'failed',
      reversed: 'failed',
      abandoned: 'abandoned',
      ongoing: 'pending',
      pending: 'pending',
      processing: 'pending',
      queued: 'pending',
    };

    const status = statusMap[data.status] || 'pending';

    return sendJSON(res, 200, {
      ok: true,
      status,
      reference: data.reference,
      paidAt: data.paid_at || null,
      amountKobo: data.amount,
      amountNGN: Math.round((Number(data.amount) || 0)) / 100,
      currency: data.currency,
      channel: data.channel || null,
      gatewayResponse: data.gateway_response || null,
      buyerEmail: data.customer?.email || null,
      routedTo,
      routedCorrectly,
    });
  } catch (err) {
    log('[verify] error:', err.message);
    return sendJSON(res, 502, {
      ok: false,
      status: 'unknown',
      reference: ref,
      error: 'Could not confirm this payment.',
    });
  }
}

/* ----------------------------------------------------------------
   7. API — WEBHOOK (records payments even if the tab is closed)
---------------------------------------------------------------- */
async function handleWebhook(req, res) {
  const signature = req.headers['x-paystack-signature'];

  if (!CONFIG.secretKey) {
    return sendJSON(res, 500, { ok: false, error: 'Server not configured' });
  }
  if (typeof signature !== 'string' || !/^[a-f0-9]{128}$/i.test(signature)) {
    log('[webhook] rejected: missing or malformed signature');
    return sendJSON(res, 401, { ok: false, error: 'Invalid signature' });
  }
  if (!rateLimit(clientIp(req), 'webhook', 120, 60_000)) {
    return sendJSON(res, 429, { ok: false, error: 'Too many requests' });
  }

  let raw;
  try {
    raw = await readBody(req, 256 * 1024);
  } catch {
    return sendJSON(res, 413, { ok: false, error: 'Request too large' });
  }

  const expected = crypto.createHmac('sha512', CONFIG.secretKey).update(raw).digest('hex');
  const valid =
    typeof signature === 'string' &&
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!valid) {
    log('[webhook] rejected: bad signature');
    return sendJSON(res, 401, { ok: false, error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(raw || '{}');
  } catch {
    return sendJSON(res, 400, { ok: false, error: 'Invalid JSON' });
  }

  if (event.event === 'charge.success') {
    const tx = event.data || {};
    const routedTo = tx.subaccount?.subaccount_code || tx.subaccount || null;
    log(
      `[webhook] charge.success ${tx.reference} ₦${(Number(tx.amount) || 0) / 100} ` +
        `channel=${tx.channel || 'n/a'} routed=${routedTo || 'main'} email=${tx.customer?.email || 'n/a'}`
    );
    /* Hook your fulfilment here: mark the invoice paid, email a receipt, etc.
       This handler is idempotent by reference — Paystack may retry. */
  } else {
    log(`[webhook] ${event.event} received`);
  }

  return sendJSON(res, 200, { ok: true });
}

/* ----------------------------------------------------------------
   8. API — PUBLIC CONFIG (no secrets, ever)
---------------------------------------------------------------- */
function handleConfig(res) {
  return sendJSON(res, 200, {
    ok: true,
    currency: 'NGN',
    usdToNgnRate: CONFIG.usdToNgnRate,
    minNgn: CONFIG.minNgn,
    maxNgn: CONFIG.maxNgn,
    channels: CHANNELS,
    verifyAttempts: CONFIG.verifyAttempts,
    ready: Boolean(CONFIG.secretKey),
  });
}

/* ----------------------------------------------------------------
   9. STATIC FILE SERVING
---------------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/* Files that must never be served, whatever the path */
const BLOCKED = new Set([
  'server.js',
  'package.json',
  'package-lock.json',
  '.env',
  '.env.example',
  '.gitignore',
  'README.md',
]);

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  const safeRel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, safeRel);

  // Must stay inside the project root, and not be a blocked/dot file
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    return sendJSON(res, 403, { ok: false, error: 'Forbidden' });
  }
  const base = path.basename(filePath);
  if (BLOCKED.has(base) || safeRel.split(path.sep).some((part) => part.startsWith('.') && part !== '')) {
    return sendJSON(res, 404, { ok: false, error: 'Not found' });
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      return sendJSON(res, 404, { ok: false, error: 'Not found' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const etag = `W/"${stats.size}-${stats.mtimeMs.toString(36)}"`;

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      return res.end();
    }

    const revalidate = ['.html', '.js', '.css', '.json'].includes(ext);

    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': revalidate ? 'no-cache' : 'public, max-age=86400',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });

    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ----------------------------------------------------------------
   10. ROUTER
---------------------------------------------------------------- */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  // Basic security headers for every response
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  try {
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/config' && (req.method === 'GET' || req.method === 'HEAD')) {
        return handleConfig(res);
      }
      if (pathname === '/api/health' && req.method === 'GET') {
        return sendJSON(res, 200, {
          ok: true,
          uptime: Math.round(process.uptime()),
          paystackConfigured: Boolean(CONFIG.secretKey),
        });
      }
      if (pathname === '/api/initialize') {
        if (req.method !== 'POST') return sendJSON(res, 405, { ok: false, error: 'Use POST' });
        return handleInitialize(req, res);
      }
      if (pathname.startsWith('/api/verify/')) {
        if (req.method !== 'GET') return sendJSON(res, 405, { ok: false, error: 'Use GET' });
        return handleVerify(req, res, pathname.slice('/api/verify/'.length));
      }
      if (pathname === '/api/paystack/webhook') {
        if (req.method !== 'POST') return sendJSON(res, 405, { ok: false, error: 'Use POST' });
        return handleWebhook(req, res);
      }
      return sendJSON(res, 404, { ok: false, error: 'Unknown API route' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJSON(res, 405, { ok: false, error: 'Method not allowed' });
    }

    return serveStatic(req, res, pathname);
  } catch (err) {
    log('[fatal]', err.stack || err.message);
    if (!res.headersSent) sendJSON(res, 500, { ok: false, error: 'Server error' });
    else res.end();
  }
});

/* ----------------------------------------------------------------
   11. STARTUP / SHUTDOWN
---------------------------------------------------------------- */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${CONFIG.port} is already in use.\n  Set PORT in .env to a free port.\n`);
  } else if (err.code === 'EACCES') {
    console.error(`\n  Not allowed to bind port ${CONFIG.port}.\n  Use a port above 1024.\n`);
  } else {
    console.error('\n  Server error:', err.message, '\n');
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log('[unhandledRejection]', reason instanceof Error ? reason.message : String(reason));
});

process.on('uncaughtException', (err) => {
  log('[uncaughtException]', err.stack || err.message);
});

function shutdown(signal) {
  log(`${signal} received — closing server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  server.listen(CONFIG.port, '0.0.0.0', () => {
    const mode = CONFIG.secretKey.startsWith('sk_live')
      ? 'LIVE'
      : CONFIG.secretKey.startsWith('sk_test')
        ? 'TEST'
        : 'NOT CONFIGURED';

    console.log('');
    console.log('  Payment page');
    console.log(`  ▸ http://localhost:${CONFIG.port}`);
    console.log(`  ▸ Paystack key: ${mode}`);
    console.log(`  ▸ Subaccount:   ${CONFIG.subaccount || '(main account)'}`);
    console.log(`  ▸ Bearer:       ${CONFIG.bearer}`);
    console.log(`  ▸ Limits:       ₦${CONFIG.minNgn.toLocaleString('en-NG')} – ₦${CONFIG.maxNgn.toLocaleString('en-NG')}`);
    console.log('');
    if (!CONFIG.secretKey) {
      console.warn('  ⚠  PAYSTACK_SECRET_KEY is missing — checkout will fail.');
      console.warn('     Copy .env.example to .env and add your keys.\n');
    }
    if (CONFIG.secretKey && CONFIG.publicKey && CONFIG.secretKey.slice(-12) === CONFIG.publicKey.slice(-12)) {
      console.warn('  ⚠  Public and secret keys look like the same key — check your .env.\n');
    }
  });
}

module.exports = { server, CONFIG, resolveAmount };
