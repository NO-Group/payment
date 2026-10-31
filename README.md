# Payment page

One screen. Amount, email, pay. No prices, no copy, no brand name.

```
index.html      the screen
css/style.css   styles (light + dark)
js/app.js       amount input + checkout
config.js       public key + subaccount (static hosts)
server.js       optional: server-side verification
.env.example    copy to .env for server mode
```

---

## GitHub Pages (what you're using)

GitHub Pages only serves static files — it can't run code — so nothing can
verify a payment from the server there. The page works in this mode:

1. Upload the repo and enable Pages.
2. Edit `config.js`:

```js
window.PAYMENT_CONFIG = {
  publicKey: 'pk_live_…',                  // Paystack public key
  subaccount: 'ACCT_4i2l4tyiv5p48cu',      // where money lands
  bearer: 'account',                       // or 'subaccount'
  transactionChargeNGN: 0,                 // flat Naira kept by main account
  usdToNgnRate: 1600,
  minNgn: 100,
  maxNgn: 5000000,
  verifyAttempts: 6,
};
```

3. Paystack dashboard → Settings → API Keys & Webhooks: no webhook needed for
   static mode (Pages can't receive one).

In this mode the transaction is created in the browser with the public key
(routed to the subaccount), and success comes from Paystack's checkout callback.
The page also tries `GET /transaction/verify` first — that endpoint wants a
secret key, so on Pages it will normally fall back to the callback. Treat this
mode as **display-only**: check your Paystack dashboard for the real charge.

---

## Server mode (verification)

If you ever host somewhere that runs Node:

```bash
cp .env.example .env    # PAYSTACK_SECRET_KEY=sk_live_…
node server.js          # http://localhost:3000
```

`js/app.js` probes `/api/config` on load and switches automatically — nothing
else to change. In this mode:

- the server creates the transaction with the secret key (`/api/initialize`),
- the popup resumes it (`resumeTransaction`),
- `/api/verify/:reference` decides the screen,
- `/api/paystack/webhook` checks the HMAC signature for charges where the buyer
  closed the tab.

The secret key never reaches the browser.

---

## Amounts

- Free-form: the payer types it. No list, no tiers.
- `₦ / $` toggle; USD is converted at `usdToNgnRate` and charged in Naira.
- Server mode enforces `minNgn` / `maxNgn` server-side; static mode enforces them
  in the page.
- Paystack's floor is ₦100.

---

## Routing

Every transaction is initialised with `subaccount`. The percentage split itself
lives on the subaccount in your Paystack dashboard (`percentage_charge`).
`transactionChargeNGN` is a **flat Naira amount kept by the main account** — not
a percentage.

---

## Before going live

- Rotate the public key that was previously committed in this repo.
- Confirm `ACCT_4i2l4tyiv5p48cu` exists under the same Paystack business as the
  key you're using (test keys need test subaccounts).
- Static mode gives no server-side proof of payment — for real fulfilment use
  server mode, or reconcile in the Paystack dashboard.
