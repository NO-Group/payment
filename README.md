# DevPay — GitHub work payments

A single-page payment site for freelance/contract development work shipped on
GitHub. Buyers pick a scope (quick fix → retainer), enter an email, and pay
through **Paystack**. Every payment is routed to your Paystack **subaccount**.

```
index.html      page structure
css/style.css   design system (slate + emerald, console aesthetic)
js/app.js       all logic — config, pricing, Paystack checkout
```

No build step. Open `index.html`, or host it on GitHub Pages / Netlify / Vercel.

---

## 1. Money routing (important)

All routing settings live at the top of `js/app.js`:

```js
const CONFIG = {
  PAYSTACK_PUBLIC_KEY: 'pk_live_…',
  SUBACCOUNT_CODE: 'ACCT_4i2l4tyiv5p48cu',   // ← your subaccount
  BEARER: 'account',                          // who absorbs Paystack fees
  MAIN_ACCOUNT_FLAT_CHARGE_NGN: 0,            // flat ₦ kept by main account
  CURRENCY: 'NGN',
  USD_TO_NGN_RATE: 1600,                      // display/conversion rate
  …
};
```

How a payment is split is decided by two things: the subaccount's own
`percentage_charge` (set in the Paystack dashboard when the subaccount was
created) and these parameters.

| Intent | Setting |
| --- | --- |
| Everything to the subaccount | Subaccount `percentage_charge = 100`, `MAIN_ACCOUNT_FLAT_CHARGE_NGN: 0` |
| Keep a flat fee, rest to subaccount | `MAIN_ACCOUNT_FLAT_CHARGE_NGN: 500` (₦500 per payment) |
| Subaccount pays the Paystack fee | `BEARER: 'subaccount'` |
| Keep a % instead | Set the subaccount `percentage_charge` in the dashboard (e.g. `10` = 10% to the subaccount) |

> ⚠️ The value in `MAIN_ACCOUNT_FLAT_CHARGE_NGN` is a **flat amount kept by the
> main account**, in Naira — not a percentage. It is sent as
> `transaction_charge` (converted to kobo). Leave it at `0` unless you
> deliberately want to retain a flat slice of each payment.

### Before you go live

1. Replace `PAYSTACK_PUBLIC_KEY` with your own public key (`pk_live_…`).
   The key currently in the file was already in the repo — rotate it if it is
   yours and has been public.
2. Confirm `ACCT_4i2l4tyiv5p48cu` exists in the **same Paystack business** as
   that key (test-mode subaccounts don't work with live keys, and vice-versa).
3. Update `BEARER` / `MAIN_ACCOUNT_FLAT_CHARGE_NGN` to match your split.
4. Update rate, brand name, email and GitHub handle in `CONFIG`.

---

## 2. Scopes and prices

Scopes are defined once in `js/app.js` (`TIERS`) and mirrored in the rate cards
in `index.html`. To change a price, update **both**:

- `TIERS[n].priceUSD` in `js/app.js`
- the matching `data-price` on the rate-card button and tier option, plus the
  visible `$` text, in `index.html`

Prices are *quoted* in USD and *charged* in NGN at `USD_TO_NGN_RATE`. Adjust the
rate as FX moves; the buyer sees the exact NGN amount before paying.

---

## 3. Promo codes

```js
const PROMOS = {
  MERGE10:   { type: 'percent', value: 10, label: '10% off' },
  FIRSTPR:   { type: 'flat',    value: 5,  label: '$5 off' },
  RETAINER15:{ type: 'percent', value: 15, label: '15% off' },
};
```

These live in the frontend, so they are **not a security control** — they only
change the price shown in checkout. Delete the block if you don't want them.

---

## 4. Verifying payments (recommended)

The success screen is driven by Paystack's client callback, which is fine for a
receipt UI but is **not proof of payment**. For real fulfilment:

1. In the Paystack dashboard, set your **webhook URL** to a serverless function
   (Cloudflare Worker, Vercel, Netlify, Supabase Edge Function…).
2. Receive the `charge.success` event, verify the `x-paystack-signature` HMAC
   with your **secret** key, then check the `subaccount` field of the
   transaction matches `ACCT_4i2l4tyiv5p48cu`.
3. Only then mark the invoice paid.

Never put the secret key in `js/app.js` or anywhere in this repo.

---

## 5. Customising

- **Copy** — all text is in `index.html`, grouped under commented sections.
- **"Shipped work" cards** — replace the six sample cards with your real merged
  PRs (repo, PR number, one-line summary, amount).
- **Colours** — tokens at the top of `css/style.css`.
- **Print receipt** — the success screen has a `Print receipt` button; the print
  stylesheet outputs just the receipt.

---

## 6. Local preview

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Serve over HTTP rather than opening the file directly so the Paystack script
behaves consistently.

---

## Status / caveats

- Static frontend only — no backend, no database.
- ✅ Subaccount routing is wired through the `subaccount`, `bearer` and
  `transaction_charge` parameters.
- ✅ Receipt screen, reference, copy + print.
- ⚠️ No server-side verification or webhook yet (see §4).
- ⚠️ Promo codes and prices are client-side.
