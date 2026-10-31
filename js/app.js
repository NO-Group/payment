/* ================================================================
   DEVPAY — GITHUB WORK PAYMENTS
   Frontend checkout powered by Paystack Inline (v2)

   No fixed prices: the payer types the amount they owe.
   Every payment is routed to a Paystack subaccount (see CONFIG).

   ⚠️ Public key only. Never put your Paystack secret key in this file.
================================================================ */

'use strict';

/* ================================================================
   1. CONFIGURATION
================================================================ */
const CONFIG = {
  /* Paystack PUBLIC key — Dashboard → Settings → API Keys & Webhooks */
  PAYSTACK_PUBLIC_KEY: 'pk_live_1d48c7981d1abf7396474499a369ab7bef17740a',

  /* ── SUBACCOUNT ROUTING ─────────────────────────────────────
     Every transaction is initialised with this code so funds land
     in the subaccount rather than the main account.              */
  SUBACCOUNT_CODE: 'ACCT_4i2l4tyiv5p48cu',

  /* Who absorbs Paystack's fee: 'account' or 'subaccount' */
  BEARER: 'account',

  /* Flat fee (in NAIRA) kept by the MAIN account per payment.
     0 = nothing retained; the subaccount's own percentage_charge
     decides the split. This is a flat amount, not a percentage.   */
  MAIN_ACCOUNT_FLAT_CHARGE_NGN: 0,

  /* ── BRANDING ─────────────────────────────────────────────── */
  BRAND_NAME: 'DevPay',
  GITHUB_HANDLE: '@yourhandle',
  SUPPORT_EMAIL: 'hello@example.com',

  /* ── CURRENCY ─────────────────────────────────────────────── */
  CHARGE_CURRENCY: 'NGN',        // Paystack always charges in NGN here
  USD_TO_NGN_RATE: 1600,         // display/conversion rate — update as FX moves

  /* Limits (Paystack charges NGN; these are NGN limits) */
  MIN_CHARGE_NGN: 100,           // Paystack's floor is ₦100
  MAX_CHARGE_NGN: 5000000,       // soft ceiling; above this, talk first
};

/* ================================================================
   2. STATE
================================================================ */
const STATE = {
  currency: 'NGN',          // what the payer types in
  amountValue: 0,           // parsed amount in STATE.currency
  amountNGN: 0,             // converted amount in Naira
  isProcessing: false,
  buyerEmail: '',
  buyerName: '',
  githubHandle: '',
  workReference: '',
  note: '',
  currentReference: '',
};

/* ================================================================
   3. HELPERS
================================================================ */
const $ = (id) => document.getElementById(id);

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatNGN(amount) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatUSD(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatMoney(amount, currency) {
  return currency === 'USD' ? formatUSD(amount) : formatNGN(amount);
}

/* Thousands separators while typing, decimals up to 2 places */
function formatAmountInput(raw, currency) {
  let value = String(raw).replace(/[^\d.]/g, '');

  const firstDot = value.indexOf('.');
  if (firstDot !== -1) {
    value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, '');
    const [whole, decimals] = value.split('.');
    value = `${whole}.${(decimals || '').slice(0, 2)}`;
  }

  const [whole, decimals] = value.split('.');
  const grouped = whole
    ? Number(whole).toLocaleString('en-US', { maximumFractionDigits: 0 })
    : '';

  if (value.includes('.')) return `${grouped || '0'}.${decimals ?? ''}`;
  return grouped;
}

function parseAmount(formatted) {
  const clean = String(formatted).replace(/,/g, '');
  const parsed = Number.parseFloat(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNGN(value, currency) {
  return currency === 'USD' ? value * CONFIG.USD_TO_NGN_RATE : value;
}

function toKobo(ngnAmount) {
  return Math.round(ngnAmount * 100);
}

function generateReference() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `DEVPAY-${stamp}-${rand}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(email).trim());
}

function scrollToEl(el, options = { behavior: 'smooth', block: 'start' }) {
  if (el && typeof el.scrollIntoView === 'function') {
    try { el.scrollIntoView(options); } catch { /* ignore */ }
  }
}

/* ================================================================
   4. TOASTS
================================================================ */
function showToast({ type = 'info', title = '', message = '', duration = 4500 }) {
  const container = $('toastContainer');
  if (!container) return;

  const icons = {
    success: 'fa-check',
    error: 'fa-xmark',
    info: 'fa-circle-info',
    warning: 'fa-triangle-exclamation',
  };

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
   5. AMOUNT INPUT
================================================================ */
function initAmountInput() {
  const input = $('amountInput');
  if (!input) return;

  input.addEventListener('input', () => {
    const formatted = formatAmountInput(input.value, STATE.currency);
    if (formatted !== input.value) {
      input.value = formatted;
      // keep the caret at the end after reformatting
      const end = formatted.length;
      try { input.setSelectionRange(end, end); } catch { /* ignore */ }
    }

    STATE.amountValue = parseAmount(input.value);
    updateAmountDisplay();
    setAmountError('');
  });

  input.addEventListener('blur', () => {
    if (STATE.amountValue > 0) {
      const decimals = STATE.currency === 'NGN' ? 2 : 2;
      input.value = STATE.amountValue.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      STATE.amountValue = parseAmount(input.value);
      updateAmountDisplay();
    }
  });
}

function updateAmountDisplay() {
  const value = STATE.amountValue;
  STATE.amountNGN = toNGN(value, STATE.currency);

  const summaryAmount = $('summaryAmount');
  const summaryTotal = $('summaryTotal');
  const conversion = $('amountConversion');
  const btnText = $('payBtnText');
  const btn = $('payBtn');

  if (summaryAmount) summaryAmount.textContent = formatMoney(value, STATE.currency);

  if (summaryTotal) {
    if (value > 0) {
      summaryTotal.textContent = STATE.currency === 'NGN'
        ? formatNGN(STATE.amountNGN)
        : `${formatUSD(value)} · ${formatNGN(STATE.amountNGN)}`;
    } else {
      summaryTotal.textContent = formatNGN(0);
    }
  }

  if (conversion) {
    conversion.textContent = STATE.currency === 'USD' && value > 0
      ? `= ${formatNGN(STATE.amountNGN)} charged by Paystack.`
      : 'Charged in Naira by Paystack.';
  }

  if (btnText) {
    btnText.textContent = value > 0
      ? `Pay ${formatMoney(value, STATE.currency)}`
      : 'Enter an amount to continue';
  }
  if (btn) btn.disabled = value <= 0;
}

function initCurrencyToggle() {
  document.querySelectorAll('.currency-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.currency;
      if (next === STATE.currency) return;

      // Convert the typed amount into the new currency
      const ngn = toNGN(STATE.amountValue, STATE.currency);
      STATE.currency = next;
      STATE.amountValue = next === 'USD' ? ngn / CONFIG.USD_TO_NGN_RATE : ngn;
      STATE.amountValue = Math.round(STATE.amountValue * 100) / 100;

      document.querySelectorAll('.currency-btn').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.currency === next);
      });
      if ($('amountPrefix')) $('amountPrefix').textContent = next === 'USD' ? '$' : '₦';
      if ($('amountInput')) {
        $('amountInput').value = STATE.amountValue > 0
          ? STATE.amountValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : '';
      }

      updateAmountDisplay();
      setAmountError('');
    });
  });
}

function setAmountError(message) {
  const input = $('amountInput');
  const errorEl = $('amountError');
  const wrap = $('amountWrap');

  if (wrap) wrap.classList.toggle('has-error', Boolean(message));
  if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.toggle('visible', Boolean(message));
  }
}

function validateAmount() {
  const value = STATE.amountValue;
  const ngn = toNGN(value, STATE.currency);

  if (!value || value <= 0) {
    setAmountError('Enter the amount we agreed on — any amount above zero.');
    return false;
  }
  if (ngn < CONFIG.MIN_CHARGE_NGN) {
    setAmountError(`Paystack's minimum is ${formatNGN(CONFIG.MIN_CHARGE_NGN)}. Enter a larger amount.`);
    return false;
  }
  if (ngn > CONFIG.MAX_CHARGE_NGN) {
    setAmountError(
      `That's above ${formatNGN(CONFIG.MAX_CHARGE_NGN)}. Email me first so the settlement and receipt are set up correctly.`
    );
    return false;
  }

  setAmountError('');
  return true;
}

/* ================================================================
   6. EMAIL VALIDATION
================================================================ */
function validateEmail() {
  const emailEl = $('buyerEmail');
  const errorEl = $('emailError');
  const email = emailEl?.value.trim() || '';

  if (!email) {
    setEmailError('Enter the email address for your receipt.');
    return false;
  }
  if (!isValidEmail(email)) {
    setEmailError('That email doesn\'t look right — check and try again.');
    return false;
  }

  setEmailError('');
  return true;
}

function setEmailError(message) {
  const input = $('buyerEmail');
  const errorEl = $('emailError');

  if (input) {
    input.classList.toggle('has-error', Boolean(message));
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.toggle('visible', Boolean(message));
  }
}

function initEmailValidation() {
  const emailEl = $('buyerEmail');
  const iconEl = $('emailValidIcon');
  if (!emailEl) return;

  emailEl.addEventListener('input', () => {
    const value = emailEl.value.trim();
    if (!value) {
      setEmailError('');
      if (iconEl) iconEl.innerHTML = '';
      return;
    }
    if (isValidEmail(value)) {
      setEmailError('');
      if (iconEl) iconEl.innerHTML = '<i class="fas fa-check"></i>';
    } else {
      if (iconEl) iconEl.innerHTML = '';
    }
  });

  emailEl.addEventListener('blur', () => {
    if (emailEl.value.trim()) validateEmail();
  });
}

/* ================================================================
   7. PAYSTACK CHECKOUT — ROUTED TO SUBACCOUNT
================================================================ */
function initPaystackPayment() {
  if (STATE.isProcessing) return;

  const amountOK = validateAmount();
  const emailOK = validateEmail();

  if (!amountOK) {
    $('amountInput')?.focus();
    return;
  }
  if (!emailOK) {
    $('buyerEmail')?.focus();
    return;
  }

  if (!window.PaystackPop) {
    showToast({
      type: 'error',
      title: 'Checkout unavailable',
      message: 'The Paystack library did not load. Check your connection and refresh.',
      duration: 7000,
    });
    return;
  }

  if (CONFIG.PAYSTACK_PUBLIC_KEY.includes('xxxxxxxx')) {
    showToast({
      type: 'error',
      title: 'Setup required',
      message: 'Add your Paystack public key in js/app.js (CONFIG.PAYSTACK_PUBLIC_KEY).',
      duration: 8000,
    });
    return;
  }

  STATE.isProcessing = true;
  STATE.buyerEmail = $('buyerEmail')?.value.trim() || '';
  STATE.buyerName = $('buyerName')?.value.trim() || '';
  STATE.githubHandle = $('githubHandle')?.value.trim() || '';
  STATE.workReference = $('workReference')?.value.trim() || '';
  STATE.note = $('paymentNote')?.value.trim() || '';

  setButtonLoading(true);

  const reference = generateReference();
  STATE.currentReference = reference;

  const chargedNGN = Math.round(STATE.amountNGN * 100) / 100;
  const amountKobo = toKobo(chargedNGN);
  const typedAmount = formatMoney(STATE.amountValue, STATE.currency);

  /* ── Paystack configuration ─────────────────────────────────
     `subaccount` routes the money; `bearer` decides who pays the
     fee; `transaction_charge` is the flat slice kept centrally.  */
  const paystackConfig = {
    key: CONFIG.PAYSTACK_PUBLIC_KEY,
    email: STATE.buyerEmail,
    amount: amountKobo,
    currency: CONFIG.CHARGE_CURRENCY,
    reference,
    ref: reference,
    label: CONFIG.BRAND_NAME,

    subaccount: CONFIG.SUBACCOUNT_CODE,
    bearer: CONFIG.BEARER,
    transaction_charge: Math.round(CONFIG.MAIN_ACCOUNT_FLAT_CHARGE_NGN * 100),

    channels: ['card', 'bank', 'ussd', 'bank_transfer', 'mobile_money'],

    metadata: {
      purpose: 'GitHub development work — custom amount',
      subaccount: CONFIG.SUBACCOUNT_CODE,
      custom_fields: [
        { display_name: 'Buyer Name', variable_name: 'buyer_name', value: STATE.buyerName || 'Anonymous' },
        { display_name: 'GitHub Handle', variable_name: 'github_handle', value: STATE.githubHandle || 'Not provided' },
        { display_name: 'Amount Typed', variable_name: 'amount_typed', value: `${typedAmount} (${STATE.currency})` },
        { display_name: 'Amount NGN', variable_name: 'amount_ngn', value: String(chargedNGN) },
        { display_name: 'PR / Issue', variable_name: 'work_reference', value: STATE.workReference || 'None' },
        { display_name: 'Invoice Note', variable_name: 'invoice_note', value: STATE.note || 'None' },
      ],
    },

    onSuccess: function (response) {
      setButtonLoading(false);
      STATE.isProcessing = false;
      console.log('Paystack success:', response);
      handlePaymentSuccess(response || {});
    },

    onCancel: function () {
      setButtonLoading(false);
      STATE.isProcessing = false;
      showToast({
        type: 'info',
        title: 'Checkout closed',
        message: 'No charges were made. Try again whenever you\'re ready.',
      });
    },
  };

  try {
    const popup = new PaystackPop();
    const result = popup.newTransaction(paystackConfig);

    if (result && typeof result.then === 'function') {
      result.catch((error) => {
        console.error('Paystack error:', error);
        setButtonLoading(false);
        STATE.isProcessing = false;
        showToast({
          type: 'error',
          title: 'Checkout error',
          message: error?.message || 'Could not open the Paystack checkout. Please retry.',
        });
      });
    }
  } catch (e) {
    console.error('Paystack error:', e);
    setButtonLoading(false);
    STATE.isProcessing = false;
    showToast({
      type: 'error',
      title: 'Payment error',
      message: 'Could not open the payment window. Refresh and try again.',
    });
  }
}

function setButtonLoading(loading) {
  const content = $('payBtnContent');
  const loader = $('payBtnLoader');
  const btn = $('payBtn');

  if (content) content.style.display = loading ? 'none' : 'inline-flex';
  if (loader) loader.style.display = loading ? 'inline-flex' : 'none';
  if (btn) btn.disabled = loading || STATE.amountValue <= 0;
}

/* ================================================================
   8. STATE PANELS
================================================================ */
function showState(state) {
  const panels = {
    form: $('formState'),
    success: $('successState'),
    failed: $('failedState'),
  };

  Object.entries(panels).forEach(([key, el]) => {
    if (!el) return;
    el.style.display = key === state ? 'block' : 'none';
  });

  if (state !== 'form') scrollToEl($('paymentCard'), { behavior: 'smooth', block: 'center' });
}

function handlePaymentSuccess(response) {
  const reference = response.reference || response.ref || STATE.currentReference;

  if ($('successRef')) $('successRef').textContent = reference;
  if ($('successAmount')) $('successAmount').textContent = formatMoney(STATE.amountValue, STATE.currency);
  if ($('successCharge')) $('successCharge').textContent = formatNGN(STATE.amountNGN);
  if ($('successEmail')) $('successEmail').textContent = STATE.buyerEmail;
  if ($('successEmailInline')) $('successEmailInline').textContent = STATE.buyerEmail;
  if ($('successGithub')) $('successGithub').textContent = STATE.githubHandle || 'Not provided';
  if ($('successWorkRef')) $('successWorkRef').textContent = STATE.workReference || 'None';
  if ($('successNote')) $('successNote').textContent = STATE.note || 'None';

  showState('success');

  showToast({
    type: 'success',
    title: 'Payment confirmed',
    message: `Reference ${reference}. Receipt sent to ${STATE.buyerEmail}.`,
    duration: 7000,
  });
}

function handlePaymentFailed(message) {
  if ($('failedMessage')) {
    $('failedMessage').textContent = message
      || 'No money left your account. You can retry with the same amount.';
  }
  showState('failed');
}

/* ================================================================
   9. ACTIONS
================================================================ */
function initActions() {
  $('paymentForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    initPaystackPayment();
  });

  $('retryBtn')?.addEventListener('click', () => {
    showState('form');
    initPaystackPayment();
  });

  $('changeAmountBtn')?.addEventListener('click', () => {
    showState('form');
    scrollToEl($('amountInput'), { behavior: 'smooth', block: 'center' });
    try { $('amountInput')?.focus({ preventScroll: true }); } catch { /* ignore */ }
  });

  $('buyAgainBtn')?.addEventListener('click', () => {
    showState('form');
    setButtonLoading(false);
    const amountInput = $('amountInput');
    const noteInput = $('paymentNote');
    if (amountInput) amountInput.value = '';
    if (noteInput) noteInput.value = '';
    STATE.amountValue = 0;
    STATE.amountNGN = 0;
    updateAmountDisplay();
    scrollToEl($('paymentCard'), { behavior: 'smooth', block: 'center' });
  });

  $('copyRefBtn')?.addEventListener('click', async () => {
    const ref = $('successRef')?.textContent || '';
    try {
      await navigator.clipboard.writeText(ref);
      showToast({ type: 'success', title: 'Copied', message: 'Reference copied to clipboard.' });
    } catch {
      showToast({ type: 'error', title: 'Copy failed', message: 'Select the reference and copy it manually.' });
    }
  });

  $('printReceiptBtn')?.addEventListener('click', () => window.print());
}

/* ================================================================
   10. HEADER / NAV
================================================================ */
function initNavigation() {
  const header = $('navbar');
  const hamburger = $('hamburger');
  const drawer = $('mobileDrawer');

  const onScroll = () => header?.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Keep the repo tab bar pinned directly under the app header
  const syncHeaderHeight = () => {
    if (!header) return;
    document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  };
  syncHeaderHeight();
  window.addEventListener('resize', syncHeaderHeight);

  hamburger?.addEventListener('click', () => {
    const open = drawer?.classList.toggle('open');
    hamburger.classList.toggle('active', Boolean(open));
    hamburger.setAttribute('aria-expanded', String(Boolean(open)));
    hamburger.innerHTML = open ? '<i class="fas fa-xmark"></i>' : '<i class="fas fa-bars"></i>';
  });

  drawer?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      drawer.classList.remove('open');
      hamburger?.classList.remove('active');
      hamburger?.setAttribute('aria-expanded', 'false');
      if (hamburger) hamburger.innerHTML = '<i class="fas fa-bars"></i>';
    });
  });

  // Smooth anchor scrolling with sticky-header offset
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const offset = (header?.offsetHeight || 0) + 56;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  // GitHub-style "/" shortcut → jump to the amount field
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    const target = $('amountInput');
    scrollToEl(target, { behavior: 'smooth', block: 'center' });
    try { target?.focus({ preventScroll: true }); } catch { /* ignore */ }
  });

  // Active repo tab follows the section in view
  const tabs = Array.from(document.querySelectorAll('.repo-tab'));
  const sections = tabs
    .map((tab) => document.querySelector(tab.getAttribute('href')))
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        tabs.forEach((tab) => {
          tab.classList.toggle('is-active', tab.getAttribute('href') === `#${entry.target.id}`);
        });
      });
    }, { rootMargin: '-30% 0px -60% 0px' });

    sections.forEach((section) => observer.observe(section));
  }
}

/* ================================================================
   11. FAQ
================================================================ */
function initFAQ() {
  document.querySelectorAll('.faq-item').forEach((item) => {
    const button = item.querySelector('.faq-q');
    const answer = item.querySelector('.faq-a');
    if (!button || !answer) return;

    button.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');

      document.querySelectorAll('.faq-item.open').forEach((other) => {
        other.classList.remove('open');
        other.querySelector('.faq-q')?.setAttribute('aria-expanded', 'false');
        const otherAnswer = other.querySelector('.faq-a');
        if (otherAnswer) otherAnswer.style.maxHeight = null;
      });

      if (!isOpen) {
        item.classList.add('open');
        button.setAttribute('aria-expanded', 'true');
        answer.style.maxHeight = `${answer.scrollHeight}px`;
      }
    });
  });
}

/* ================================================================
   12. INIT
================================================================ */
function init() {
  console.log(`⚡ ${CONFIG.BRAND_NAME} — initializing`);

  initNavigation();
  initAmountInput();
  initCurrencyToggle();
  initEmailValidation();
  initActions();
  initFAQ();

  const yearEl = $('footerYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const rateEl = $('summaryRate');
  if (rateEl) rateEl.textContent = `$1 = ₦${CONFIG.USD_TO_NGN_RATE.toLocaleString('en-US')}`;

  updateAmountDisplay();
  showState('form');

  console.log(`🔑 Paystack: ${CONFIG.PAYSTACK_PUBLIC_KEY.startsWith('pk_live') ? 'LIVE' : 'TEST'}`);
  console.log(`🏦 Subaccount: ${CONFIG.SUBACCOUNT_CODE}`);
  console.log(`💱 Rate: $1 = ₦${CONFIG.USD_TO_NGN_RATE}`);
  console.log(`✅ ${CONFIG.BRAND_NAME} ready`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* ================================================================
   END OF app.js
================================================================ */
