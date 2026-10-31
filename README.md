# Payment page

One screen: amount, email, pay. No prices, no marketing copy.

```
index.html                     the screen
css/style.css                  styles (light + dark, system fonts)
js/app.js                      amount input + checkout
config.js                      public key + subaccount (GitHub Pages mode)
server.js                      optional server-side verification
.github/workflows/pages.yml    publishes the static site to GitHub Pages
.env.example                   copy to .env for server mode
```

---

## Deploying to GitHub Pages

1. Push the repo, then **Settings → Pages → Source: GitHub Actions**.
2. Edit `config.js`:

```js
window.PAYMENT_CONFIG = {
  publicKey: 'pk_live_…',               // Paystack public key
  subaccount: 'ACCT_4i2l4tyiv5p48cu',   // where money lands
  bearer: 'account',                    // or 'subaccount'
  transactionChargeNGN: 0,              // flat Naira kept by the main account
  usdToNgnRate: 1600,
  minNgn: 100,
  maxNgn: 5000000,
  verifyAttempts: 6,
};
```

3. `.github/workflows/pages.yml` publishes **only** `index.html`, `css/`, `js/`
   and `config.js`. It fails the build if a Paystack **secret** key is ever found
   in those files, or if `config.js` has no public key. `server.js`, `.env` and
   `README.md` are never published.

### What GitHub Pages can and cannot do

Pages is static hosting — it cannot run code. So in Pages mode:

- the transaction is created **in the browser** with your public key, routed to
  the subaccount;
- success is shown from Paystack's checkout callback, and the page attempts
  `transaction/verify` once (that endpoint needs a *secret* key, so it normally
  falls back to the callback).

**Treat Pages mode as display-only.** Confirm receipts in your Paystack
dashboard. There is no way to verify a payment server-side without a server.

---

## Server mode (real verification)

If you host somewhere that runs Node 18+ (Render, Railway, Fly, a VPS):

```bash
cp .env.example .env      # SET PAYSTACK_SECRET_KEY=sk_live_…
node server.js            # http://localhost:3000
```

`js/app.js` probes `/api/config` on load and switches automatically — no code
changes. In this mode:

| Route | Purpose |
| --- | --- |
| `POST /api/initialize` | Creates the transaction with the secret key, applies subaccount routing, validates amount + email server-side |
| `GET /api/verify/:ref` | The **only** thing that can show "Payment successful" |
| `POST /api/paystack/webhook` | Verifies the `x-paystack-signature` HMAC and logs `charge.success` |
| `GET /api/config` | Public, non-secret config |
| `GET /api/health` | Uptime + whether the secret key is configured |

The secret key never reaches the browser. Add your fulfilment where the webhook
logs `charge.success` (mark the invoice paid, email a receipt, update a sheet).
Webhooks are retried, so keep that handler idempotent by reference.

Set the Paystack webhook URL to `https://your-domain.com/api/paystack/webhook`.

---

## Amounts and routing

- Free-form: the payer types it. `₦ / $` toggle; USD converts at `usdToNgnRate`
  and is charged in Naira.
- `minNgn` / `maxNgn` are enforced server-side in server mode and in the page in
  Pages mode. Paystack's floor is ₦100.
- Every transaction is initialised with `subaccount`. The percentage split lives
  on the subaccount in the Paystack dashboard (`percentage_charge`);
  `transactionChargeNGN` is a **flat Naira amount kept by the main account**, not
  a percentage.

---

## Production checklist

- [ ] Rotate the public key that was previously committed in this repo.
- [ ] `ACCT_4i2l4tyiv5p48cu` exists under the same Paystack business as the key
      you use (test keys need test subaccounts).
- [ ] One real test-card payment on the deployed URL
      (`4084 0840 8408 4081`, any future date, CVV `408`, PIN `0000`).
- [ ] Server mode only: `.env` set in the host dashboard (never committed),
      `SITE_URL` is the public HTTPS URL, webhook URL configured.
- [ ] Refund policy agreed in writing with payers — the page shows none.

---

## Notes

- No build step, no dependencies for the site; `server.js` uses only Node core.
- Third-party requests: Paystack's checkout script only. Fonts and icons are
  local/system.
- `npm run check` syntax-checks the JavaScript.
