# DevPay — payments for GitHub work

A single, focused payment screen: the payer types the amount you agreed on, pays
through **Paystack**, and the success screen only appears after **Paystack's
server confirms the charge**. No fixed price, no trust in the browser.

```
server.js        Node server: static files + initialize + verify + webhook
index.html       the payment screen
css/style.css    the styles
js/app.js        the browser flow (no secret key, no prices)
.env.example     copy to .env and fill in
```

Node 18+ (uses built-in `fetch`). No dependencies, no build step.

---

## Run it

```bash
cp .env.example .env      # add your Paystack keys
node server.js            # http://localhost:3000
```

Open the site, type an amount, pay with a test card
(`4084 0840 8408 4081`, any future date, CVV `408`, PIN `0000`) once
`PAYSTACK_SECRET_KEY` is a `sk_test_…` key.

---

## How a payment actually works

```
browser                      your server                     Paystack
   │  POST /api/initialize        │                              │
   ├─────────────────────────────►│  initialize (SECRET key)     │
   │                              ├─────────────────────────────►│
   │   { reference, accessCode }  │                              │
   │◄─────────────────────────────┤                              │
   │  PaystackPop.resumeTransaction(accessCode)                  │
   ├────────────────────────────────────────────────────────────►│
   │        buyer pays in the Paystack popup                     │
   │  onSuccess ──► GET /api/verify/:reference                   │
   ├─────────────────────────────►│  verify (SECRET key)         │
   │                              ├─────────────────────────────►│
   │  { status: success|failed|…} │                              │
   │◄─────────────────────────────┤                              │
   │  ✅ success screen ONLY when the server says success        │
```

Why it's built this way:

- **The reference comes from your server**, not from the popup callback. A faked
  callback can't produce a reference Paystack knows about.
- **`/api/verify` is the only thing that can show the success screen.** The
  browser never decides that a payment succeeded.
- **`status: pending/ongoing` is polled** (every 2.5 s, `VERIFY_ATTEMPTS` times)
  because bank transfers and USSD settle after the popup closes.
- **Wrong subaccount is not success.** If Paystack reports the money went
  anywhere other than `SUBACCOUNT_CODE`, the screen says "routing needs review"
  instead of claiming success.
- **Returning from a redirect** (`?reference=…`) triggers the same verification,
  so a bank redirect lands on the correct screen.

---

## Money routing

Set in `.env`:

| Variable | Meaning |
| --- | --- |
| `SUBACCOUNT_CODE` | Every transaction is initialised with this subaccount (default `ACCT_4i2l4tyiv5p48cu`) |
| `BEARER` | `account` or `subaccount` — who absorbs Paystack's fee |
| `TRANSACTION_CHARGE_NGN` | Flat Naira amount retained by the **main** account per payment (0 = none) |
| `USD_TO_NGN_RATE` | Rate used to convert what the payer types in USD |
| `MIN_AMOUNT_NGN` / `MAX_AMOUNT_NGN` | Server-enforced limits (default ₦100 / ₦5,000,000) |

The percentage split itself lives on the subaccount in your Paystack dashboard
(`percentage_charge`). `TRANSACTION_CHARGE_NGN` overrides it with a flat amount —
it is **not** a percentage.

Amounts are validated and converted **on the server**, so the kobo value sent to
Paystack can't be tampered with by editing the page.

---

## Webhook (recommended)

Set your Paystack webhook URL to:

```
https://your-domain.com/api/paystack/webhook
```

`server.js` verifies the `x-paystack-signature` HMAC (SHA-512, your secret key)
with a timing-safe comparison, then logs the charge. **Add your fulfilment where
the `charge.success` handler logs** — mark the invoice paid, email the receipt,
update a sheet. This is what catches payments where the buyer closed the tab
before verification.

Webhooks are retried by Paystack, so make your handler idempotent by reference.

---

## What the payer sees

1. Amount (typed, ₦ or $ toggle) → email → name / GitHub handle / PR / note.
2. "Opening checkout…" → Paystack popup.
3. **"Confirming with Paystack"** while the server verifies.
4. **Payment confirmed** with amount, reference, method, date, GitHub handle and
   a "verified by Paystack server" line — plus copy reference and print.
   Or a specific failure: declined, abandoned, not found, not confirmed yet, or
   routing needs review.

---

## Security notes

- The **secret key only ever exists in `server.js`'s process memory** (from
  `.env`). It is never served, injected or exposed. `.env` is gitignored.
- `/server.js`, `/package.json`, `/.env*`, `/.git/*` and any dot-path are
  blocked by the static handler; path traversal is rejected.
- Both API routes are rate-limited per IP (`INIT_RATE_LIMIT`,
  `VERIFY_RATE_LIMIT`).
- All metadata sent to Paystack is length-clamped and control characters are
  stripped.
- Still true: this is a **payment page**, not an invoice database. There's no
  record of who owes what beyond Paystack and your webhook handler.

---

## Deploying

Any Node host: Render, Railway, Fly, a VPS, or a serverless wrapper around the
handlers. Requirements:

1. `node server.js` (or a process manager behind a reverse proxy with TLS).
2. Env vars from `.env.example` set in the host's dashboard — don't upload `.env`.
3. `SITE_URL` set to your public HTTPS URL (used for `callback_url`).
4. Paystack webhook pointed at `/api/paystack/webhook`.
5. Rotate the public key that was previously committed in this repo.

Health check: `GET /api/health` → `{ ok: true, paystackConfigured: true }`.

---

## Limits / non-goals

- No database: invoices aren't stored. Use the webhook to persist them.
- No user accounts, no subscriptions, no refunds UI — refund from the Paystack
  dashboard.
- Amount is free-form by design; there's no price list to maintain.
