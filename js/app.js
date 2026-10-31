/* ================================================================
   PAYMENT — CLIENT

   Two modes:
   A. Verifying server present (/api/initialize available)
      → server creates the transaction, popup resumes it, and only the
        server's /api/verify answer can show "Payment successful".
   B. Static host (GitHub Pages) — no /api
      → checkout is created in the browser with the Paystack public key.
        Success is shown from Paystack's response, re-checked with
        /transaction/verify using the same public key.

   No secret key, no fixed prices, no marketing copy in this file.
================================================================ */

'use strict';

const $ = (id) => document.getElementById(id);

const STATE = {
  currency: 'NGN',
  amount: 0,
  apiMode: false,
  ready: false,
  busy: false,
  reference: '',
  accessCode: '',
  attempts: 0,
  timer: null,
  snapshot: null,
  config: { usdToNgnRate: 1600, minNgn: 100, maxNgn: 5000000, verifyAttempts: 6 },
};

/* ---------------------------------------------------------------
   Formatting
---------------------------------------------------------------- */
const ngnFmt = new Intl.NumberFormat('en-NG', {
  style: 'currency', currency: 'NGN', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const formatNGN = (v) => ngnFmt.format(Number(v) || 0);
const formatUSD = (v) => usdFmt.format(Number(v) || 0);

function formatAmountInput(raw) {
  let value = String(raw).replace(/[^\d.]/g, '');

  const dot = value.indexOf('.');
  if (dot !== -1) {
    value = value.slice(0, dot + 1) + value.slice(dot + 1).replace(/\./g, '');
    const [whole, decimals] = value.split('.');
    value = `${whole}.${(decimals || '').slice(0, 2)}`;
  }

  const [whole, decimals] = value.split('.');
  const grouped = whole ? Number(whole).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';

  if (value.includes('.')) return `${grouped || '0'}.${decimals ?? ''}`;
  return grouped;
}

const parseAmount = (v) => {
  const n = Number.parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const rate = () => STATE.config.usdToNgnRate || 1600;
const toNGN = (value, currency) => (currency === 'USD' ? value * rate() : value);
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(v).trim());

/* ---------------------------------------------------------------
   Amount field
---------------------------------------------------------------- */
function render() {
  STATE.amount = parseAmount($('amountInput')?.value || '');
  const ngn = toNGN(STATE.amount, STATE.currency);

  const btn = $('payBtn');
  const label = $('payBtnText');
  if (label) {
    label.textContent = STATE.amount > 0
      ? `Pay ${STATE.currency === 'USD' ? formatUSD(STATE.amount) : formatNGN(STATE.amount)}`
      : 'Pay';
  }
  if (btn) btn.disabled = STATE.busy || !STATE.ready || STATE.amount <= 0;

  // Conversion note only when it adds information (USD entry); never over an error
  const hint = $('amountError');
  if (hint && !hint.dataset.error) {
    hint.textContent = STATE.currency === 'USD' && STATE.amount > 0 ? `= ${formatNGN(ngn)}` : '';
    hint.classList.remove('is-error');
  }
}

function setError(id, message) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || '';
  el.dataset.error = message ? '1' : '';
  el.classList.toggle('is-error', Boolean(message));
  if (id === 'amountError') $('amountWrap')?.classList.toggle('is-error', Boolean(message));
  if (id === 'emailError') $('buyerEmail')?.classList.toggle('is-error', Boolean(message));
}

function initAmount() {
  const input = $('amountInput');
  if (!input) return;

  input.addEventListener('input', () => {
    const next = formatAmountInput(input.value);
    if (next !== input.value) {
      input.value = next;
      const end = next.length;
      try { input.setSelectionRange(end, end); } catch { /* ignore */ }
    }
    setError('amountError', '');
    render();
  });

  input.addEventListener('blur', () => {
    const value = parseAmount(input.value);
    if (value > 0) {
      input.value = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    render();
  });

  document.querySelectorAll('.cur-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.currency;
      if (next === STATE.currency) return;

      const ngn = toNGN(STATE.amount, STATE.currency);
      STATE.currency = next;
      STATE.amount = Math.round((next === 'USD' ? ngn / rate() : ngn) * 100) / 100;

      document.querySelectorAll('.cur-btn').forEach((b) => {
        const active = b.dataset.currency === next;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      if ($('amountPrefix')) $('amountPrefix').textContent = next === 'USD' ? '$' : '₦';
      if (input) {
        input.value = STATE.amount > 0
          ? STATE.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : '';
      }
      setError('amountError', '');
      render();
    });
  });

  $('buyerEmail')?.addEventListener('input', () => setError('emailError', ''));
}

function validate() {
  const min = STATE.config.minNgn;
  const max = STATE.config.maxNgn;

  if (STATE.amount <= 0) {
    setError('amountError', 'Enter amount');
    $('amountInput')?.focus();
    return false;
  }
  if (toNGN(STATE.amount, STATE.currency) < min) {
    setError('amountError', `Minimum ${formatNGN(min)}`);
    $('amountInput')?.focus();
    return false;
  }
  if (toNGN(STATE.amount, STATE.currency) > max) {
    setError('amountError', `Maximum ${formatNGN(max)}`);
    $('amountInput')?.focus();
    return false;
  }
  setError('amountError', '');

  const email = $('buyerEmail')?.value.trim() || '';
  if (!email) {
    setError('emailError', 'Enter email');
    $('buyerEmail')?.focus();
    return false;
  }
  if (!isValidEmail(email)) {
    setError('emailError', 'Invalid email');
    $('buyerEmail')?.focus();
    return false;
  }
  setError('emailError', '');
  return true;
}

/* ---------------------------------------------------------------
   Panels
---------------------------------------------------------------- */
function panel(name) {
  $('paymentForm').hidden = name !== 'form';
  $('processingState').hidden = name !== 'processing';
  $('successState').hidden = name !== 'success';
  $('failedState').hidden = name !== 'failed';
}

function busy(state) {
  STATE.busy = state;
  const label = $('payBtnText');
  const load = $('payBtnLoader');
  if (label) label.style.visibility = state ? 'hidden' : 'visible';
  if (load) load.hidden = !state;
  render();
}

const formData = () => ({
  email: $('buyerEmail')?.value.trim() || '',
  amount: STATE.amount,
  currency: STATE.currency,
  name: $('buyerName')?.value.trim() || '',
  github: $('githubHandle')?.value.trim() || '',
  reference: $('workReference')?.value.trim() || '',
  note: $('paymentNote')?.value.trim() || '',
});

/* ---------------------------------------------------------------
   Start payment
---------------------------------------------------------------- */
async function start() {
  if (STATE.busy) return;
  if (!validate()) return;

  busy(true);
  const form = formData();
  STATE.snapshot = form;

  if (STATE.apiMode) {
    await startServerFlow(form);
  } else {
    startStaticFlow(form);
  }
}

/* ── A. server-verified flow ─────────────────────────────────── */
async function startServerFlow(form) {
  try {
    const response = await fetch('/api/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok || !data.accessCode) {
      busy(false);
      setError(data.field === 'email' ? 'emailError' : 'amountError', data.error || 'Could not start payment');
      if (!data.field) setError('amountError', data.error || 'Could not start payment');
      return;
    }

    STATE.reference = data.reference;
    openCheckout(() => verifyServer(data.reference), null, data.accessCode);
  } catch {
    busy(false);
    setError('amountError', 'Connection failed');
  }
}

/* ── B. static flow (GitHub Pages) ───────────────────────────── */
function startStaticFlow(form) {
  const publicKey = STATE.config.publicKey;
  if (!publicKey) {
    busy(false);
    STATE.ready = false;
    render();
    return;
  }

  const kobo = Math.round(toNGN(form.amount, form.currency) * 100);

  if (!window.PaystackPop) {
    busy(false);
    setError('amountError', 'Checkout failed');
    return;
  }

  const popup = new PaystackPop();
  try {
    popup.newTransaction({
      key: publicKey,
      email: form.email,
      amount: kobo,
      currency: 'NGN',
      label: 'Payment',
      subaccount: STATE.config.subaccount || undefined,
      bearer: STATE.config.bearer || 'account',
      transaction_charge: STATE.config.transactionChargeKobo || 0,
      channels: ['card', 'bank', 'ussd', 'bank_transfer', 'mobile_money'],
      metadata: {
        custom_fields: [
          { display_name: 'Payer', variable_name: 'buyer_name', value: form.name || '—' },
          { display_name: 'GitHub', variable_name: 'github_handle', value: form.github || '—' },
          { display_name: 'PR / Issue', variable_name: 'work_reference', value: form.reference || '—' },
          { display_name: 'Note', variable_name: 'invoice_note', value: form.note || '—' },
          { display_name: 'Amount NGN', variable_name: 'amount_ngn', value: String(toNGN(form.amount, form.currency)) },
        ],
      },
      onSuccess: (tx) => {
        STATE.reference = tx?.reference || '';
        verifyStatic(STATE.reference, 0);
      },
      onCancel: () => busy(false),
      onError: () => {
        busy(false);
        setError('amountError', 'Checkout failed');
      },
    });
  } catch {
    busy(false);
    setError('amountError', 'Checkout failed');
  }
}

function openCheckout(onSuccess, onCancel, accessCode) {
  const popup = new PaystackPop();
  try {
    popup.resumeTransaction(accessCode, {
      onSuccess,
      onCancel: onCancel || (() => busy(false)),
      onError: () => {
        busy(false);
        setError('amountError', 'Checkout failed');
      },
    });
  } catch {
    busy(false);
    setError('amountError', 'Checkout failed');
  }
}

/* ---------------------------------------------------------------
   Verification
---------------------------------------------------------------- */
function verifying() {
  panel('processing');
  const text = $('processingText');
  if (text) text.textContent = 'Confirming payment';
}

async function verifyServer(reference) {
  verifying();

  let response;
  let data;
  try {
    response = await fetch(`/api/verify/${encodeURIComponent(reference)}`, {
      headers: { Accept: 'application/json' },
    });
    data = await response.json().catch(() => ({}));
  } catch {
    // network problem — worth retrying
    return retryLater(() => verifyServer(reference));
  }

  // A real answer from Paystack, via our server
  if (data.status === 'success') {
    // Money went somewhere other than the configured subaccount: don't claim success
    if (data.routedCorrectly === false) return fail('routing');
    return succeed(data.reference || reference, data.amountNGN);
  }

  if (data.status === 'pending') return retryLater(() => verifyServer(reference));
  if (data.status === 'failed' || data.status === 'reversed') return fail('failed', data.gatewayResponse);
  if (data.status === 'abandoned') return fail('abandoned');

  // Paystack has no record of this reference — terminal, don't poll for 30s
  if (response.status === 404) return fail('unconfirmed');

  // Server or Paystack hiccup (5xx / 429) — worth retrying
  if (!response.ok) return retryLater(() => verifyServer(reference));

  return fail('unconfirmed');
}

async function verifyStatic(reference, attempt) {
  verifying();
  const key = STATE.config.publicKey;

  if (!reference || !key) return settleStatic(reference);

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    const json = await response.json().catch(() => ({}));
    const data = json?.data || {};

    if (data.status === 'success') {
      return succeed(data.reference || reference, (Number(data.amount) || 0) / 100);
    }
    if (data.status === 'failed' || data.status === 'reversed') {
      return fail('failed', data.gateway_response);
    }
    if (data.status === 'abandoned') return fail('abandoned');

    // Paystack answered but the charge isn't settled yet
    if (data.status) return retryLater(() => verifyStatic(reference, attempt + 1));

    // 401/403 — verify needs a secret key, so this host can't read the status
    return settleStatic(reference);
  } catch {
    return settleStatic(reference);
  }
}

/* Static host without verification access: trust the checkout callback that
   Paystack fired for this transaction. A verifying server is always better. */
function settleStatic(reference) {
  if (!reference) return fail('failed');
  const paid = toNGN(STATE.snapshot?.amount || 0, STATE.snapshot?.currency || 'NGN');
  succeed(reference, paid);
}

function retryLater(fn) {
  STATE.attempts += 1;
  if (STATE.attempts > (STATE.config.verifyAttempts || 6)) return fail('unconfirmed');
  clearTimeout(STATE.timer);
  // 2.5s, then 3.5s, 4.5s… — give slow bank transfers a chance without hammering the API
  STATE.timer = setTimeout(fn, 2500 + STATE.attempts * 1000);
}

function succeed(reference, amountNGN) {
  clearTimeout(STATE.timer);
  STATE.busy = false;
  STATE.attempts = 0;

  const paid = amountNGN || toNGN(STATE.snapshot?.amount || 0, STATE.snapshot?.currency || 'NGN');

  if ($('successAmount')) $('successAmount').textContent = formatNGN(paid);
  if ($('successRef')) $('successRef').textContent = reference || '';

  busy(false);
  panel('success');
}

function fail(kind, reason) {
  clearTimeout(STATE.timer);
  STATE.busy = false;
  STATE.attempts = 0;
  busy(false);

  // Gateway text can be long or technical — only show short, readable messages
  const readable = typeof reason === 'string'
    && reason.trim().length > 0
    && reason.trim().length <= 60
    && !/https?:|\bcode\b|\{\}|undefined/i.test(reason);


  const titles = {
    failed: 'Payment failed',
    abandoned: 'Payment cancelled',
    unconfirmed: 'Payment pending',
    routing: 'Payment pending',
  };
  const texts = {
    failed: readable ? reason.trim() : '',
    abandoned: '',
    unconfirmed: '',
    routing: '',
  };

  if ($('failedTitle')) $('failedTitle').textContent = titles[kind] || 'Payment failed';
  if ($('failedText')) {
    $('failedText').textContent = texts[kind] || '';
    $('failedText').hidden = !texts[kind];
  }
  panel('failed');
}

/* ---------------------------------------------------------------
   Actions
---------------------------------------------------------------- */
function reset() {
  clearTimeout(STATE.timer);
  STATE.busy = false;
  STATE.attempts = 0;
  STATE.reference = '';
  STATE.accessCode = '';
  STATE.snapshot = null;
  STATE.amount = 0;

  if ($('amountInput')) $('amountInput').value = '';
  ['buyerName', 'githubHandle', 'workReference', 'paymentNote'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  if ($('moreDetails')) $('moreDetails').open = false;
  setError('amountError', '');
  setError('emailError', '');
  busy(false);
  panel('form');
  render();
  $('amountInput')?.focus();
}

function initActions() {
  $('paymentForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    start();
  });

  $('retryBtn')?.addEventListener('click', () => {
    STATE.attempts = 0;
    panel('form');
    start();
  });

  $('doneBtn')?.addEventListener('click', reset);

  $('copyRefBtn')?.addEventListener('click', async () => {
    const ref = $('successRef')?.textContent || '';
    try { await navigator.clipboard.writeText(ref); } catch { /* ignore */ }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    e.preventDefault();
    $('amountInput')?.focus();
  });
}

/* ---------------------------------------------------------------
   Boot
---------------------------------------------------------------- */
function applyConfig(cfg) {
  if (!cfg) return;
  STATE.config = { ...STATE.config, ...cfg };
  if (cfg.subaccount) STATE.config.subaccount = cfg.subaccount;
  if (typeof cfg.transactionChargeNGN === 'number') {
    STATE.config.transactionChargeKobo = Math.round(cfg.transactionChargeNGN * 100);
  }
}

async function boot() {
  // Try the verification server first; fall back to static checkout.
  try {
    const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (response.ok) {
      const cfg = await response.json();
      if (cfg?.ok && cfg.ready) {
        STATE.apiMode = true;
        applyConfig({
          usdToNgnRate: cfg.usdToNgnRate,
          minNgn: cfg.minNgn,
          maxNgn: cfg.maxNgn,
          verifyAttempts: cfg.verifyAttempts,
        });
        STATE.ready = true;
      }
    }
  } catch { /* static host */ }

  if (!STATE.apiMode) {
    applyConfig(window.PAYMENT_CONFIG || {});
    STATE.ready = Boolean(STATE.config.publicKey);
    if (!STATE.ready) console.warn('config.js is missing or has no publicKey — checkout disabled.');
  }

  initAmount();
  initActions();
  panel('form');
  render();

  // Returning from a redirect (?reference= / ?trxref=)
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('reference') || params.get('trxref');
  if (ref) {
    window.history.replaceState({}, '', window.location.pathname);
    STATE.snapshot = { amount: 0, currency: 'NGN', email: '' };
    if (STATE.apiMode) verifyServer(ref);
    else verifyStatic(ref, 0);
    return;
  }

  $('amountInput')?.focus();
}

function safeBoot() {
  try {
    const result = boot();
    if (result && typeof result.catch === 'function') {
      result.catch((err) => console.error('boot failed:', err));
    }
  } catch (err) {
    console.error('boot failed:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeBoot);
} else {
  safeBoot();
}
