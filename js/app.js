/* ================================================================
   DEVPAY — CLIENT
   Flow:
     1. POST /api/initialize   → server creates the transaction with the
                                 secret key and returns an access code
     2. PaystackPop.resumeTransaction(accessCode) → buyer pays in the popup
     3. GET /api/verify/:ref   → server asks Paystack whether it really
                                 succeeded; only then is success shown
   No secret key, no price and no trust decisions live in this file.
================================================================ */

'use strict';

/* ================================================================
   1. STATE
================================================================ */
const STATE = {
  currency: 'NGN',        // what the payer types in
  amountValue: 0,
  amountNGN: 0,
  config: null,
  isProcessing: false,
  reference: '',
  accessCode: '',
  pollTimer: null,
  pollAttempts: 0,
  lastPayment: null,      // snapshot used by the receipt
};

const $ = (id) => document.getElementById(id);

/* ================================================================
   2. HELPERS
================================================================ */
const ngnFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency', currency: 'NGN', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function formatNGN(amount) { return ngnFormatter.format(Number(amount) || 0); }
function formatUSD(amount) { return usdFormatter.format(Number(amount) || 0); }
function formatMoney(amount, currency) {
  return currency === 'USD' ? formatUSD(amount) : formatNGN(amount);
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(email).trim());
}

/* Amount formatting while typing: separators, max 2 decimals */
function formatAmountInput(raw) {
  let value = String(raw).replace(/[^\d.]/g, '');

  const firstDot = value.indexOf('.');
  if (firstDot !== -1) {
    value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, '');
    const [whole, decimals] = value.split('.');
    value = `${whole}.${(decimals || '').slice(0, 2)}`;
  }

  const [whole, decimals] = value.split('.');
  const grouped = whole ? Number(whole).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';

  if (value.includes('.')) return `${grouped || '0'}.${decimals ?? ''}`;
  return grouped;
}

function parseAmount(value) {
  const parsed = Number.parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rate() {
  return STATE.config?.usdToNgnRate || 1600;
}

function toNGN(value, currency) {
  return currency === 'USD' ? value * rate() : value;
}

function scrollToEl(el, options = { behavior: 'smooth', block: 'center' }) {
  if (el && typeof el.scrollIntoView === 'function') {
    try { el.scrollIntoView(options); } catch { /* ignore */ }
  }
}

/* ================================================================
   3. TOASTS
================================================================ */
function showToast({ type = 'info', title = '', message = '', duration = 4500 }) {
  const container = $('toastContainer');
  if (!container) return;

  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fas ${icons[type] || icons.info} toast-icon"></i>
    <div class="toast-body">
      ${title ? `<div class="toast-title">${escapeHTML(title)}</div>` : ''}
      ${message ? `<div class="toast-msg">${escapeHTML(message)}</div>` : ''}
    </div>
    <button class="toast-close" aria-label="Dismiss"><i class="fas fa-xmark"></i></button>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  const remove = () => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  };
  toast.querySelector('.toast-close').addEventListener('click', remove);
  setTimeout(remove, duration);
}

/* ================================================================
   4. CONFIG FROM SERVER
================================================================ */
async function loadConfig() {
  try {
    const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('config unavailable');
    const cfg = await response.json();

    STATE.config = cfg;

    if (cfg.recipientHandle) {
      const handleEl = $('recipientHandle');
      if (handleEl) handleEl.textContent = cfg.recipientHandle;
      const avatarEl = $('recipientAvatar');
      if (avatarEl) avatarEl.textContent = cfg.recipientHandle.slice(0, 2).toLowerCase();
    }
    if (cfg.supportEmail) {
      const support = $('supportLink');
      if (support) support.href = `mailto:${cfg.supportEmail}`;
      const footer = $('footerEmail');
      if (footer) { footer.textContent = cfg.supportEmail; footer.href = `mailto:${cfg.supportEmail}`; }
    }
    if (cfg.brandName) {
      const brand = $('footerBrand');
      if (brand) brand.textContent = cfg.brandName;
      document.title = `Pay for GitHub work · ${cfg.brandName}`;
    }

    updateAmountDisplay();
  } catch {
    STATE.config = { usdToNgnRate: 1600, minNgn: 100, maxNgn: 5000000, verifyAttempts: 6 };
  }
}

/* ================================================================
   5. AMOUNT INPUT
================================================================ */
function initAmountInput() {
  const input = $('amountInput');
  if (!input) return;

  input.addEventListener('input', () => {
    const formatted = formatAmountInput(input.value);
    if (formatted !== input.value) {
      input.value = formatted;
      const end = formatted.length;
      try { input.setSelectionRange(end, end); } catch { /* ignore */ }
    }
    STATE.amountValue = parseAmount(input.value);
    setAmountError('');
    updateAmountDisplay();
  });

  input.addEventListener('blur', () => {
    if (STATE.amountValue > 0) {
      input.value = STATE.amountValue.toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
      STATE.amountValue = parseAmount(input.value);
      updateAmountDisplay();
    }
  });
}

function initCurrencySwitch() {
  document.querySelectorAll('.currency-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.currency;
      if (next === STATE.currency) return;

      const ngn = toNGN(STATE.amountValue, STATE.currency);
      STATE.currency = next;
      STATE.amountValue = Math.round((next === 'USD' ? ngn / rate() : ngn) * 100) / 100;

      document.querySelectorAll('.currency-btn').forEach((b) => {
        const active = b.dataset.currency === next;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      if ($('amountPrefix')) $('amountPrefix').textContent = next === 'USD' ? '$' : '₦';
      if ($('amountInput')) {
        $('amountInput').value = STATE.amountValue > 0
          ? STATE.amountValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : '';
      }
      setAmountError('');
      updateAmountDisplay();
    });
  });
}

function updateAmountDisplay() {
  STATE.amountNGN = toNGN(STATE.amountValue, STATE.currency);

  const conversion = $('amountConversion');
  const btnText = $('payBtnText');
  const btn = $('payBtn');
  const min = STATE.config?.minNgn ?? 100;

  if (conversion) {
    if (STATE.amountValue > 0) {
      conversion.textContent = STATE.currency === 'USD'
        ? `Charged as ${formatNGN(STATE.amountNGN)} in Naira`
        : 'Charged in Naira by Paystack';
    } else {
      conversion.textContent = `Minimum ${formatNGN(min)} · type any amount`;
    }
  }

  if (btnText) {
    btnText.textContent = STATE.amountValue > 0
      ? `Pay ${formatMoney(STATE.amountValue, STATE.currency)}`
      : 'Enter an amount';
  }
  if (btn) btn.disabled = STATE.isProcessing || STATE.amountValue <= 0;
}

function setAmountError(message) {
  const wrap = $('amountWrap');
  const input = $('amountInput');
  const errorEl = $('amountError');

  if (wrap) wrap.classList.toggle('has-error', Boolean(message));
  if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (errorEl) {
    errorEl.textContent = message || '';
    errorEl.classList.toggle('visible', Boolean(message));
  }
}

function validateAmount() {
  const value = STATE.amountValue;
  const ngn = toNGN(value, STATE.currency);
  const min = STATE.config?.minNgn ?? 100;
  const max = STATE.config?.maxNgn ?? 5000000;

  if (!value || value <= 0) {
    setAmountError('Enter the amount you agreed on.');
    return false;
  }
  if (ngn < min) {
    setAmountError(`The minimum payment is ${formatNGN(min)}.`);
    return false;
  }
  if (ngn > max) {
    setAmountError(`That's above ${formatNGN(max)}. Email ${STATE.config?.supportEmail || 'me'} to arrange it.`);
    return false;
  }
  setAmountError('');
  return true;
}

/* ================================================================
   6. EMAIL
================================================================ */
function setEmailError(message) {
  const input = $('buyerEmail');
  const errorEl = $('emailError');
  if (input) {
    input.classList.toggle('has-error', Boolean(message));
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  if (errorEl) {
    errorEl.textContent = message || '';
    errorEl.classList.toggle('visible', Boolean(message));
  }
}

function initEmailField() {
  const emailEl = $('buyerEmail');
  const iconEl = $('emailValidIcon');
  if (!emailEl) return;

  emailEl.addEventListener('input', () => {
    const value = emailEl.value.trim();
    if (isValidEmail(value)) {
      setEmailError('');
      if (iconEl) iconEl.innerHTML = '<i class="fas fa-check"></i>';
    } else if (iconEl) {
      iconEl.innerHTML = '';
      if (!value) setEmailError('');
    }
  });

  emailEl.addEventListener('blur', () => {
    const value = emailEl.value.trim();
    if (!value) return;
    setEmailError(isValidEmail(value) ? '' : 'Enter a valid email address.');
  });
}

function validateEmail() {
  const value = $('buyerEmail')?.value.trim() || '';
  if (!value) {
    setEmailError('We need an email to send the receipt.');
    return false;
  }
  if (!isValidEmail(value)) {
    setEmailError('Enter a valid email address.');
    return false;
  }
  setEmailError('');
  return true;
}

/* ================================================================
   7. PANELS
================================================================ */
function showPanel(name) {
  const panels = {
    form: $('formState'),
    processing: $('processingState'),
    success: $('successState'),
    failed: $('failedState'),
  };
  Object.entries(panels).forEach(([key, el]) => {
    if (el) el.style.display = key === name ? 'block' : 'none';
  });
  if (name !== 'form') scrollToEl($('paymentCard'));
}

function readForm() {
  return {
    email: $('buyerEmail')?.value.trim() || '',
    amount: STATE.amountValue,
    currency: STATE.currency,
    name: $('buyerName')?.value.trim() || '',
    github: $('githubHandle')?.value.trim() || '',
    reference: $('workReference')?.value.trim() || '',
    note: $('paymentNote')?.value.trim() || '',
  };
}

/* ================================================================
   8. PAYMENT FLOW
================================================================ */
async function startPayment() {
  if (STATE.isProcessing) return;

  const amountOK = validateAmount();
  const emailOK = validateEmail();
  if (!amountOK) { $('amountInput')?.focus(); return; }
  if (!emailOK) { $('buyerEmail')?.focus(); return; }

  if (!window.PaystackPop) {
    showToast({
      type: 'error',
      title: 'Checkout unavailable',
      message: 'The Paystack library did not load. Check your connection and refresh.',
    });
    return;
  }

  const form = readForm();
  STATE.isProcessing = true;
  setLoading(true);

  try {
    /* 1 — the server creates the transaction (secret key stays there) */
    const response = await fetch('/api/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok || !data.accessCode) {
      STATE.isProcessing = false;
      setLoading(false);
      showToast({
        type: 'error',
        title: 'Could not start payment',
        message: data.error || 'The server could not create this transaction. Please try again.',
        duration: 7000,
      });
      if (data.field === 'amount') setAmountError(data.error);
      if (data.field === 'email') setEmailError(data.error);
      return;
    }

    STATE.reference = data.reference;
    STATE.accessCode = data.accessCode;
    STATE.lastPayment = {
      amount: form.amount,
      currency: form.currency,
      amountNGN: data.amount?.ngn ?? toNGN(form.amount, form.currency),
      email: form.email,
      github: form.github,
      workReference: form.reference,
    };

    /* 2 — resume that exact transaction in the popup */
    const popup = new PaystackPop();
    popup.resumeTransaction(data.accessCode, {
      onSuccess: () => {
        /* 3 — never trust the callback; ask our server */
        verifyPayment(data.reference);
      },
      onCancel: () => {
        STATE.isProcessing = false;
        setLoading(false);
        showToast({
          type: 'info',
          title: 'Checkout closed',
          message: 'No charge was made. Try again whenever you are ready.',
        });
      },
      onError: (error) => {
        STATE.isProcessing = false;
        setLoading(false);
        showToast({
          type: 'error',
          title: 'Checkout error',
          message: error?.message || 'Paystack could not open this transaction. Please retry.',
        });
      },
    });
  } catch (err) {
    console.error('startPayment failed:', err);
    STATE.isProcessing = false;
    setLoading(false);
    showToast({
      type: 'error',
      title: 'Network error',
      message: 'Could not reach the payment server. Check your connection and try again.',
    });
  }
}

function setLoading(loading) {
  const content = $('payBtnContent');
  const loader = $('payBtnLoader');
  const btn = $('payBtn');

  if (content) content.style.display = loading ? 'none' : 'inline-flex';
  if (loader) loader.style.display = loading ? 'inline-flex' : 'none';
  if (btn) btn.disabled = loading || STATE.amountValue <= 0;
}

/* ── Server verification, with polling for async channels ───── */
function verifyPayment(reference, attempt = 0) {
  showPanel('processing');

  const maxAttempts = STATE.config?.verifyAttempts || 6;
  const processingText = $('processingText');
  if (processingText && attempt > 0) {
    processingText.textContent = 'Still waiting for Paystack to confirm the charge. This usually takes a few seconds.';
  }

  fetch(`/api/verify/${encodeURIComponent(reference)}`, { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));

      if (!response.ok && data.status === undefined) {
        throw new Error(data.error || 'Verification failed');
      }

      switch (data.status) {
        case 'unknown':
          /* Paystack has no record of this reference — fail fast, don't poll */
          return showResult('failed', {
            title: 'Transaction not found',
            text: data.error
              || 'Paystack has no record of this reference. If money left your account, contact support with the reference below.',
            reference,
          });

        case 'success':
          if (data.routedCorrectly === false) {
            /* Paid, but not to the expected subaccount — do not claim success */
            console.warn('Payment routed to unexpected account:', data.routedTo);
            return showResult('failed', {
              title: 'Payment received — routing needs review',
              text: `Paystack confirmed the charge to ${data.routedTo || 'another account'}. Please contact support with the reference below so it can be reconciled.`,
              reference,
            });
          }
          return showResult('success', data, reference);

        case 'failed':
          return showResult('failed', {
            title: 'Payment failed',
            text: data.gatewayResponse
              ? `Paystack reported: ${data.gatewayResponse}. Nothing was taken from your account.`
              : 'Paystack declined this charge. Nothing was taken from your account.',
            reference,
          });

        case 'abandoned':
          return showResult('failed', {
            title: 'Payment abandoned',
            text: 'This transaction was abandoned before it completed. Nothing was charged — you can start again.',
            reference,
          });

        case 'pending':
        default:
          if (attempt + 1 < maxAttempts) {
            STATE.pollTimer = setTimeout(() => verifyPayment(reference, attempt + 1), 2500);
            return;
          }
          return showResult('failed', {
            title: 'Payment not confirmed yet',
            text: "Paystack hasn't confirmed this charge yet. If money left your account, keep the reference and check your email — the receipt will arrive once Paystack settles it.",
            reference,
          });
      }
    })
    .catch((err) => {
      console.error('verify failed:', err);
      if (attempt + 1 < maxAttempts) {
        STATE.pollTimer = setTimeout(() => verifyPayment(reference, attempt + 1), 3000);
        return;
      }
      showResult('failed', {
        title: 'Could not verify',
        text: 'We could not reach our server to verify this payment. If you were charged, keep the reference and contact support.',
        reference,
      });
    });
}

function showResult(type, payload, reference) {
  STATE.isProcessing = false;
  setLoading(false);

  if (type === 'success') {
    const snapshot = STATE.lastPayment || {};
    const paidNGN = payload.amountNGN || snapshot.amountNGN;
    const amountText = snapshot.currency === 'USD' && paidNGN
      ? `${formatUSD(paidNGN / rate())} · ${formatNGN(paidNGN)}`
      : formatNGN(paidNGN);

    if ($('successAmount')) $('successAmount').textContent = amountText;
    if ($('successRef')) $('successRef').textContent = payload.reference || reference;
    if ($('successChannel')) $('successChannel').textContent = humanChannel(payload.channel);
    if ($('successDate')) $('successDate').textContent = formatDate(payload.paidAt);
    if ($('successEmail')) $('successEmail').textContent = payload.buyerEmail || snapshot.email || 'your email';

    const githubRow = $('successGithubRow');
    if (snapshot.github && githubRow) $('successGithub').textContent = snapshot.github;
    else if (githubRow) githubRow.style.display = 'none';

    const refRow = $('successRefRow');
    if (snapshot.workReference && refRow) $('successWorkRef').textContent = snapshot.workReference;
    else if (refRow) refRow.style.display = 'none';

    showPanel('success');
    showToast({ type: 'success', title: 'Payment confirmed', message: 'Verified with Paystack.' });
    return;
  }

  if ($('failedTitle')) $('failedTitle').textContent = payload.title || 'Payment not completed';
  if ($('failedText')) $('failedText').textContent = payload.text || '';
  if ($('failedRefHint')) {
    $('failedRefHint').textContent = reference ? `Reference: ${reference}` : '';
  }
  showPanel('failed');
}

function humanChannel(channel) {
  const map = {
    card: 'Card',
    bank: 'Bank',
    bank_transfer: 'Bank transfer',
    ussd: 'USSD',
    mobile_money: 'Mobile money',
    qr: 'QR code',
    eft: 'EFT',
  };
  return map[channel] || channel || 'Paystack';
}

function formatDate(value) {
  if (!value) return new Date().toLocaleString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* ================================================================
   9. ACTIONS
================================================================ */
function initActions() {
  $('paymentForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    startPayment();
  });

  $('retryBtn')?.addEventListener('click', () => {
    showPanel('form');
    startPayment();
  });

  $('editAmountBtn')?.addEventListener('click', () => {
    showPanel('form');
    $('amountInput')?.focus();
    scrollToEl($('amountInput'));
  });

  $('newPaymentBtn')?.addEventListener('click', resetToForm);

  $('copyRefBtn')?.addEventListener('click', async () => {
    const ref = $('successRef')?.textContent || '';
    try {
      await navigator.clipboard.writeText(ref);
      showToast({ type: 'success', title: 'Copied', message: 'Reference copied to clipboard.' });
    } catch {
      showToast({ type: 'error', title: 'Copy failed', message: 'Select the reference and copy it manually.' });
    }
  });

  $('printBtn')?.addEventListener('click', () => window.print());

  /* Keyboard: "/" jumps to the amount field */
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    const input = $('amountInput');
    scrollToEl(input);
    try { input?.focus({ preventScroll: true }); } catch { /* ignore */ }
  });
}

function resetToForm() {
  if (STATE.pollTimer) clearTimeout(STATE.pollTimer);

  STATE.isProcessing = false;
  STATE.reference = '';
  STATE.accessCode = '';
  STATE.lastPayment = null;
  STATE.amountValue = 0;
  STATE.amountNGN = 0;

  if ($('amountInput')) $('amountInput').value = '';
  ['buyerName', 'githubHandle', 'workReference', 'paymentNote'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });

  setAmountError('');
  setEmailError('');
  setLoading(false);
  updateAmountDisplay();
  showPanel('form');
  $('amountInput')?.focus();
}

/* ================================================================
   10. RETURN FROM REDIRECT (e.g. ?reference=… after a bank redirect)
================================================================ */
function handleReturningReference() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('reference') || params.get('trxref');
  if (!ref) return false;

  STATE.reference = ref;
  STATE.lastPayment = { amountNGN: 0, currency: 'NGN', email: '' };
  verifyPayment(ref);
  window.history.replaceState({}, '', window.location.pathname);
  return true;
}

/* ================================================================
   11. INIT
================================================================ */
async function init() {
  const yearEl = $('footerYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  initAmountInput();
  initCurrencySwitch();
  initEmailField();
  initActions();

  updateAmountDisplay();
  showPanel('form');

  await loadConfig();
  updateAmountDisplay();

  const returning = handleReturningReference();
  if (!returning) $('amountInput')?.focus();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* ================================================================
   END
================================================================ */
