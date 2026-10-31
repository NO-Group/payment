/* ================================================================
   DEVPAY — GITHUB WORK PAYMENTS
   Frontend checkout powered by Paystack Inline (v2)

   Payments are routed to a Paystack SUBACCOUNT via the
   `subaccount` parameter. Everything you normally need to edit
   lives in the CONFIG block below.
================================================================ */

'use strict';

/* ================================================================
   1. CONFIGURATION
================================================================ */
const CONFIG = {
  /* Paystack PUBLIC key.
     Dashboard → Settings → API Keys & Webhooks
     Test: pk_test_xxx · Live: pk_live_xxx */
  PAYSTACK_PUBLIC_KEY: 'pk_live_1d48c7981d1abf7396474499a369ab7bef17740a',

  /* ── SUBACCOUNT ROUTING ──────────────────────────────────────
     Every payment is initialised with this subaccount code, so
     funds land there and not in the main account.                */
  SUBACCOUNT_CODE: 'ACCT_4i2l4tyiv5p48cu',

  /* Who absorbs Paystack's transaction fee.
     'account'    → main account pays the fee (default)
     'subaccount' → subaccount pays the fee                          */
  BEARER: 'account',

  /* Optional flat fee (in NAIRA) retained by the MAIN account on
     every split. 0 = no retention, the subaccount keeps the full
     split percentage configured on the subaccount itself.
     Example: 500 → ₦500 stays with the main account per payment.   */
  MAIN_ACCOUNT_FLAT_CHARGE_NGN: 0,

  /* ── BRANDING / CONTACT ─────────────────────────────────────── */
  BRAND_NAME: 'DevPay',
  GITHUB_HANDLE: '@yourhandle',
  SUPPORT_EMAIL: 'hello@example.com',
  SITE_URL: 'https://YOUR_USERNAME.github.io/devpay/',

  /* ── CURRENCY ───────────────────────────────────────────────── */
  CURRENCY: 'NGN',
  USD_TO_NGN_RATE: 1600,          // shown to the buyer; update as FX moves
  MIN_CHARGE_USD: 1,
};

/* ================================================================
   2. SCOPES / TIERS
   Prices are quoted in USD, charged in NGN via Paystack.
================================================================ */
const TIERS = [
  {
    id: 1,
    name: 'Quick Fix',
    priceUSD: 10,
    icon: 'fa-bug',
    tagline: 'One small, well-defined bug',
    turnaround: '48 hours',
    features: [
      'One PR, under 50 lines',
      'Repro steps documented',
      'Regression test added',
      '48h turnaround',
    ],
  },
  {
    id: 2,
    name: 'Bug Fix',
    priceUSD: 25,
    icon: 'fa-wrench',
    tagline: 'Standard issue + tests',
    turnaround: '24 hours',
    features: [
      'Up to 3 files / 150 lines',
      'Tests + CI green',
      'PR description & changelog',
      '7 days post-merge support',
    ],
  },
  {
    id: 3,
    name: 'Feature PR',
    priceUSD: 60,
    icon: 'fa-rocket',
    tagline: 'Scoped feature, reviewed & merged',
    turnaround: '5 working days',
    features: [
      'Up to 5 working days of build',
      'Tests, docs & migration notes',
      'One review round included',
      '14 days post-merge support',
    ],
  },
  {
    id: 4,
    name: 'Retainer',
    priceUSD: 200,
    icon: 'fa-infinity',
    tagline: 'Monthly, priority queue',
    turnaround: 'Priority queue',
    features: [
      '20 hours / month on your repo',
      'Priority review & async standups',
      'Weekly merged-PR summary',
      'Cancel or pause anytime',
    ],
  },
];

/* Promo codes — percentage or flat USD discount */
const PROMOS = {
  MERGE10: { type: 'percent', value: 10, label: '10% off' },
  FIRSTPR: { type: 'flat', value: 5, label: '$5 off' },
  RETAINER15: { type: 'percent', value: 15, label: '15% off' },
};

/* ================================================================
   3. STATE
================================================================ */
const STATE = {
  selectedTier: TIERS[2],
  appliedPromo: null,
  discountUSD: 0,
  finalPriceUSD: 60,
  isProcessing: false,
  buyerEmail: '',
  buyerName: '',
  githubHandle: '',
  workReference: '',
  currentReference: '',
};

/* ================================================================
   4. HELPERS
================================================================ */
const $ = (id) => document.getElementById(id);

function usdToKobo(usd) {
  return Math.round(usd * CONFIG.USD_TO_NGN_RATE * 100);
}

function formatUSD(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatNGNFromKobo(kobo) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
  }).format(kobo / 100);
}

function formatNGNFromUSD(usd) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(usd * CONFIG.USD_TO_NGN_RATE);
}

function generateReference() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `DEVPAY-${stamp}-${rand}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(email).trim());
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* Scroll helper — guarded so it no-ops in environments without layout */
function scrollToEl(el, options = { behavior: 'smooth', block: 'start' }) {
  if (el && typeof el.scrollIntoView === 'function') {
    try { el.scrollIntoView(options); } catch { /* ignore */ }
  }
}

/* ================================================================
   5. TOASTS
================================================================ */
function showToast({ type = 'info', title = '', message = '', duration = 4500 }) {
  const container = $('toastContainer');
  if (!container) return;

  const icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-exclamation',
    info: 'fa-circle-info',
    warning: 'fa-triangle-exclamation',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon"><i class="fas ${icons[type] || icons.info}"></i></div>
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
    setTimeout(() => toast.remove(), 250);
  };

  toast.querySelector('.toast-close').addEventListener('click', remove);
  setTimeout(remove, duration);
}

/* ================================================================
   6. PRICING
================================================================ */
function calculateFinalPrice(baseUSD) {
  if (!STATE.appliedPromo) return baseUSD;

  const promo = STATE.appliedPromo;
  let discount = promo.type === 'percent'
    ? (baseUSD * promo.value) / 100
    : promo.value;

  discount = Math.min(discount, Math.max(0, baseUSD - CONFIG.MIN_CHARGE_USD));
  return Math.round((baseUSD - discount) * 100) / 100;
}

function updatePricing() {
  const tier = STATE.selectedTier;
  STATE.finalPriceUSD = calculateFinalPrice(tier.priceUSD);
  STATE.discountUSD = Math.round((tier.priceUSD - STATE.finalPriceUSD) * 100) / 100;

  const kobo = usdToKobo(STATE.finalPriceUSD);

  // Form summary
  if ($('summaryTierName')) $('summaryTierName').textContent = tier.name;
  if ($('summaryPrice')) $('summaryPrice').textContent = formatUSD(tier.priceUSD);
  if ($('summaryRate')) $('summaryRate').textContent = `$1 = ₦${CONFIG.USD_TO_NGN_RATE.toLocaleString('en-US')}`;
  if ($('summaryTotal')) $('summaryTotal').textContent = formatUSD(STATE.finalPriceUSD);
  if ($('summaryCharge')) $('summaryCharge').textContent = formatNGNFromKobo(kobo);

  // Discount row
  const discountRow = $('discountRow');
  if (discountRow) {
    if (STATE.discountUSD > 0 && STATE.appliedPromo) {
      discountRow.style.display = 'flex';
      if ($('discountAmount')) $('discountAmount').textContent = `-${formatUSD(STATE.discountUSD)}`;
      if ($('summaryPromoLabel')) $('summaryPromoLabel').textContent = `(${STATE.appliedPromo.code})`;
    } else {
      discountRow.style.display = 'none';
    }
  }

  // Pay button
  if ($('payBtnText')) {
    $('payBtnText').textContent = `Pay ${formatUSD(STATE.finalPriceUSD)} — Secure checkout`;
  }

  // Side preview
  if ($('previewName')) $('previewName').textContent = tier.name;
  if ($('previewPrice')) $('previewPrice').textContent = formatUSD(STATE.finalPriceUSD);
  if ($('previewNgn')) $('previewNgn').textContent = `≈ ${formatNGNFromUSD(STATE.finalPriceUSD)}`;
  if ($('previewTurnaround')) $('previewTurnaround').textContent = tier.turnaround;

  const featureList = $('previewFeatures');
  if (featureList) {
    featureList.innerHTML = tier.features
      .map((f) => `<li><i class="fas fa-check"></i> ${escapeHTML(f)}</li>`)
      .join('');
  }

  // Tier option buttons
  document.querySelectorAll('.tier-option').forEach((btn) => {
    btn.classList.toggle('is-active', Number(btn.dataset.tier) === tier.id);
  });

  // Rate cards highlighting
  document.querySelectorAll('[data-tier-card]').forEach((card) => {
    card.classList.toggle('is-selected', Number(card.dataset.tierCard) === tier.id);
  });
}

function selectTier(id) {
  const tier = TIERS.find((t) => t.id === Number(id));
  if (!tier) return;

  STATE.selectedTier = tier;
  STATE.appliedPromo = null;
  STATE.discountUSD = 0;

  const promoInput = $('promoCode');
  if (promoInput) promoInput.value = '';
  const promoResult = $('promoResult');
  if (promoResult) {
    promoResult.textContent = '';
    promoResult.className = 'promo-result';
  }

  updatePricing();
}

/* ================================================================
   7. TIER SELECTION / RATE CARDS
================================================================ */
function initTierSelection() {
  // Buttons inside the checkout
  document.querySelectorAll('.tier-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTier(btn.dataset.tier);
      scrollToCheckoutSummary();
    });
  });

  // Rate card buttons
  document.querySelectorAll('[data-tier][data-price]').forEach((btn) => {
    if (btn.classList.contains('tier-option')) return;
    btn.addEventListener('click', () => {
      selectTier(btn.dataset.tier);
      showState('form');
      scrollToEl(document.getElementById('pay'), { behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        try { $('buyerEmail')?.focus({ preventScroll: true }); } catch { /* ignore */ }
      }, 650);
    });
  });
}

function scrollToCheckoutSummary() {
  scrollToEl($('orderSummary'), { behavior: 'smooth', block: 'center' });
}

/* ================================================================
   8. FORM VALIDATION
================================================================ */
function validateForm() {
  const emailEl = $('buyerEmail');
  const errorEl = $('emailError');
  const email = emailEl?.value.trim() || '';

  if (!email) {
    setFieldError(emailEl, errorEl, 'Enter the email address for your receipt.');
    return false;
  }
  if (!isValidEmail(email)) {
    setFieldError(emailEl, errorEl, 'That email doesn\'t look right — check and try again.');
    return false;
  }

  setFieldError(emailEl, errorEl, '');
  return true;
}

function setFieldError(input, errorEl, message) {
  if (input) {
    input.classList.toggle('has-error', Boolean(message));
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.toggle('visible', Boolean(message));
  }
}

function initRealTimeValidation() {
  const emailEl = $('buyerEmail');
  const errorEl = $('emailError');
  const iconEl = $('emailValidIcon');
  if (!emailEl) return;

  emailEl.addEventListener('input', () => {
    const value = emailEl.value.trim();
    if (!value) {
      setFieldError(emailEl, errorEl, '');
      if (iconEl) iconEl.innerHTML = '';
      return;
    }

    if (isValidEmail(value)) {
      setFieldError(emailEl, errorEl, '');
      if (iconEl) iconEl.innerHTML = '<i class="fas fa-circle-check"></i>';
    } else {
      if (iconEl) iconEl.innerHTML = '';
    }
  });

  emailEl.addEventListener('blur', () => {
    if (emailEl.value.trim()) validateForm();
  });
}

/* ================================================================
   9. PROMO CODES
================================================================ */
function initPromoCode() {
  const toggle = $('promoToggle');
  const wrap = $('promoInputWrap');
  const applyBtn = $('applyPromo');
  const input = $('promoCode');
  const result = $('promoResult');

  toggle?.addEventListener('click', () => {
    const isOpen = wrap.style.display !== 'none';
    wrap.style.display = isOpen ? 'none' : 'block';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    toggle.classList.toggle('open', !isOpen);
    if (!isOpen) input?.focus();
  });

  const apply = () => {
    const code = (input?.value || '').trim().toUpperCase();
    if (!code) return;

    const promo = PROMOS[code];
    if (!promo) {
      STATE.appliedPromo = null;
      if (result) {
        result.textContent = 'That code isn\'t valid.';
        result.className = 'promo-result error';
      }
      updatePricing();
      return;
    }

    STATE.appliedPromo = { ...promo, code };
    updatePricing();

    if (result) {
      result.textContent = `Applied — ${promo.label}`;
      result.className = 'promo-result success';
    }
  };

  applyBtn?.addEventListener('click', apply);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    }
  });
}

/* ================================================================
   10. BUTTON LOADING
================================================================ */
function setButtonLoading(loading) {
  const content = $('payBtnContent');
  const loader = $('payBtnLoader');
  const btn = $('payBtn');

  if (content) content.style.display = loading ? 'none' : 'flex';
  if (loader) loader.style.display = loading ? 'flex' : 'none';
  if (btn) btn.disabled = loading;
}

/* ================================================================
   11. PAYSTACK CHECKOUT — ROUTED TO SUBACCOUNT
================================================================ */
function initPaystackPayment() {
  if (STATE.isProcessing) return;
  if (!validateForm()) {
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

  setButtonLoading(true);

  const reference = generateReference();
  STATE.currentReference = reference;

  const tier = STATE.selectedTier;
  const amountKobo = usdToKobo(STATE.finalPriceUSD);

  /* ── Paystack configuration ──────────────────────────────────
     `subaccount` is what makes the money land in the subaccount.
     `bearer` + `transaction_charge` fine-tune the split.        */
  const paystackConfig = {
    key: CONFIG.PAYSTACK_PUBLIC_KEY,
    email: STATE.buyerEmail,
    amount: amountKobo,
    currency: CONFIG.CURRENCY,
    reference,
    ref: reference,
    label: CONFIG.BRAND_NAME,

    subaccount: CONFIG.SUBACCOUNT_CODE,
    bearer: CONFIG.BEARER,
    transaction_charge: Math.round(CONFIG.MAIN_ACCOUNT_FLAT_CHARGE_NGN * 100),

    channels: ['card', 'bank', 'ussd', 'bank_transfer', 'mobile_money'],

    metadata: {
      purpose: 'GitHub development work',
      subaccount: CONFIG.SUBACCOUNT_CODE,
      custom_fields: [
        { display_name: 'Buyer Name', variable_name: 'buyer_name', value: STATE.buyerName || 'Anonymous' },
        { display_name: 'GitHub Handle', variable_name: 'github_handle', value: STATE.githubHandle || 'Not provided' },
        { display_name: 'Scope', variable_name: 'scope', value: `${tier.name} ($${tier.priceUSD})` },
        { display_name: 'Scope ID', variable_name: 'scope_id', value: String(tier.id) },
        { display_name: 'Price USD', variable_name: 'price_usd', value: String(STATE.finalPriceUSD) },
        { display_name: 'Work Reference', variable_name: 'work_reference', value: STATE.workReference || 'None' },
        { display_name: 'Promo Code', variable_name: 'promo_code', value: STATE.appliedPromo?.code || 'None' },
        {
          display_name: 'Discount',
          variable_name: 'discount',
          value: STATE.discountUSD > 0 ? `$${STATE.discountUSD}` : 'None',
        },
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

    onLoad: function () {
      /* Checkout iframe is up */
    },
  };

  try {
    const popup = new PaystackPop();
    const result = popup.newTransaction(paystackConfig);

    // v2 returns a promise — surface hard failures instead of hanging
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
      message: 'Could not open the payment window. Please refresh and try again.',
    });
  }
}

/* ================================================================
   12. STATE PANELS
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

  if (state !== 'form') {
    scrollToEl($('paymentCard'), { behavior: 'smooth', block: 'center' });
  }
}

function handlePaymentSuccess(response) {
  const reference = response.reference || response.ref || STATE.currentReference;
  const amountUSD = STATE.finalPriceUSD;
  const kobo = usdToKobo(amountUSD);

  if ($('successRef')) $('successRef').textContent = reference;
  if ($('successTier')) $('successTier').textContent = STATE.selectedTier.name;
  if ($('successAmount')) $('successAmount').textContent = formatUSD(amountUSD);
  if ($('successCharge')) $('successCharge').textContent = formatNGNFromKobo(kobo);
  if ($('successEmail')) $('successEmail').textContent = STATE.buyerEmail;
  if ($('successGithub')) $('successGithub').textContent = STATE.githubHandle || 'Not provided';

  const check = document.querySelector('.success-check');
  if (check) {
    check.classList.remove('animate');
    void check.offsetWidth;          // restart the draw animation
    check.classList.add('animate');
  }

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
      || 'Something interrupted the charge. No money left your account — you can retry.';
  }
  showState('failed');
}

/* ================================================================
   13. ACTION BUTTONS
================================================================ */
function initActionButtons() {
  $('paymentForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    initPaystackPayment();
  });

  $('retryBtn')?.addEventListener('click', () => {
    showState('form');
    initPaystackPayment();
  });

  $('changeTierBtn')?.addEventListener('click', () => {
    showState('form');
    scrollToEl($('tierOptions'), { behavior: 'smooth', block: 'center' });
  });

  $('buyAgainBtn')?.addEventListener('click', () => {
    showState('form');
    setButtonLoading(false);
    const promoInput = $('promoCode');
    if (promoInput) promoInput.value = '';
    const promoResult = $('promoResult');
    if (promoResult) {
      promoResult.textContent = '';
      promoResult.className = 'promo-result';
    }
    STATE.appliedPromo = null;
    updatePricing();
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
   14. NAVIGATION
================================================================ */
function initNavigation() {
  const nav = $('navbar');
  const hamburger = $('hamburger');
  const drawer = $('mobileDrawer');

  const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 20);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  hamburger?.addEventListener('click', () => {
    const open = drawer?.classList.toggle('open');
    hamburger.classList.toggle('active', Boolean(open));
    hamburger.setAttribute('aria-expanded', String(Boolean(open)));
    document.body.classList.toggle('nav-open', Boolean(open));
  });

  drawer?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      drawer.classList.remove('open');
      hamburger?.classList.remove('active');
      hamburger?.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('nav-open');
    });
  });

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const offset = (nav?.offsetHeight || 0) + 12;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });
}

/* ================================================================
   15. FAQ
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
   16. SCROLL REVEAL + COUNTERS
================================================================ */
function initScrollReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  items.forEach((el) => observer.observe(el));
}

function initCounters() {
  const counters = document.querySelectorAll('.stat-value[data-target]');
  if (!counters.length) return;

  const animate = (el) => {
    const target = Number(el.dataset.target) || 0;
    const suffix = el.dataset.suffix || '';
    const duration = 1400;
    const start = performance.now();

    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(target * eased).toLocaleString('en-US') + suffix;
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  if (!('IntersectionObserver' in window)) {
    counters.forEach((el) => {
      el.textContent = Number(el.dataset.target).toLocaleString('en-US') + (el.dataset.suffix || '');
    });
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      animate(entry.target);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.5 });

  counters.forEach((el) => observer.observe(el));
}

/* ================================================================
   17. CONSOLE CARD — live charge preview in hero
================================================================ */
function initConsolePreview() {
  const chargeEl = document.querySelector('.console-amount');
  if (!chargeEl) return;
  chargeEl.textContent = formatUSD(TIERS[2].priceUSD);
  const ngnEl = document.querySelectorAll('.console-row .mono')[2];
  if (ngnEl) ngnEl.textContent = formatNGNFromKobo(usdToKobo(TIERS[2].priceUSD));
}

/* ================================================================
   18. INIT
================================================================ */
function init() {
  console.log(`⚡ ${CONFIG.BRAND_NAME} — initializing`);

  initNavigation();
  initTierSelection();
  initRealTimeValidation();
  initPromoCode();
  initActionButtons();
  initFAQ();
  initScrollReveal();
  initCounters();
  initConsolePreview();

  const yearEl = $('footerYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  selectTier(TIERS[2].id);
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
