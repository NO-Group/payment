# DevPay — GitHub work payments

A GitHub-styled, single-page invoice site for contract development work. There is
**no fixed price**: whoever is paying types the amount you agreed on and pays it
through **Paystack**, with every charge routed to your **subaccount**.

```
index.html      page structure (GitHub repo/issue chrome, table, FAQ)
css/style.css   Primer-ish design system, light + dark
js/app.js       all logic — config, amount parsing, Paystack checkout
```

No build step. Host it on GitHub Pages, Netlify, Vercel, or any static host.

---

## 1. Money routing (important)

Everything lives at the top of `js/app.js`:

```js
const CONFIG = {
  PAYSTACK_PUBLIC_KEY: 'pk_live_…',
  SUBACCOUNT_CODE: 'ACCT_4i2l4tyiv5p48cu',   // ← funds land here
  BEARER: 'account',                          // who absorbs Paystack's fee
  MAIN_ACCOUNT_FLAT_CHARGE_NGN: 0,            // flat ₦ kept by the main account
  CHARGE_CURRENCY: 'NGN',
  USD_TO_NGN_RATE: 1600,
  MIN_CHARGE_NGN: 100,                        // Paystack's floor
  MAX_CHARGE_NGN: 5000000,                    // soft ceiling
};
```

The real split is decided by the subaccount's own `percentage_charge` (set in the
Paystack dashboard when the subaccount was created), not by this page.

| Intent | Setting |
| --- | --- |
| Everything to the subaccount | Subaccount `percentage_charge = 100`, `MAIN_ACCOUNT_FLAT_CHARGE_NGN: 0` |
| Keep a flat fee per payment | `MAIN_ACCOUNT_FLAT_CHARGE_NGN: 500` (₦500 per payment) |
| Keep a percentage | Set the subaccount `percentage_charge` in the dashboard |
| Subaccount pays the fee | `BEARER: 'subaccount'` |

> ⚠️ `MAIN_ACCOUNT_FLAT_CHARGE_NGN` is a **flat Naira amount retained by the main
> account**, sent as `transaction_charge` (converted to kobo). It is not a
> percentage. Leave it at `0` unless you deliberately want to keep a slice.

### Before you go live

1. Replace `PAYSTACK_PUBLIC_KEY` with your own public key (`pk_live_…`). The key
   in the file was already committed to this repo — rotate it if it's yours.
2. Confirm `ACCT_4i2l4tyiv5p48cu` exists under the **same business** as that key
   (test subaccounts don't work with live keys, and vice-versa).
3. Adjust `BEARER` / `MAIN_ACCOUNT_FLAT_CHARGE_NGN` to match your split.
4. Set the rate, brand name, GitHub handle and support email in `CONFIG`.

---

## 2. How the amount works

- The payer types **any** amount. No tiers, no rate card, no preset buttons.
- They can type in **₦ NGN** or **$ USD**; the summary shows the exact Naira
  amount that Paystack will charge (converted at `USD_TO_NGN_RATE`).
- Input is sanitised while typing: thousands separators, max 2 decimals,
  letters/punctuation stripped.
- Guards:
  - `MIN_CHARGE_NGN` (default ₦100) — Paystack's minimum.
  - `MAX_CHARGE_NGN` (default ₦5,000,000) — a soft ceiling that asks for an email
    instead of a payment, so large transfers don't break reconciliation.
- The amount Paystack receives is `kobo = NGN × 100`, as an integer.
- Paystack's own fee is deducted from settlement; the site never adds anything on
  top, and the FAQ says so explicitly.

---

## 3. Receipts

On success the page shows: reference, amount typed, Naira charged, email, GitHub
handle, PR/issue reference, the note, and the subaccount. There's a **Copy
reference** button and a **Print receipt** action (print stylesheet outputs only
the receipt).

---

## 4. Verifying payments (recommended)

The success screen is driven by Paystack's browser callback — good for a receipt
UI, **not proof of payment**. For real fulfilment:

1. Point your Paystack **webhook URL** at a serverless function.
2. Verify the `x-paystack-signature` HMAC with your **secret** key.
3. Check the transaction's `subaccount` matches `ACCT_4i2l4tyiv5p48cu`.
4. Only then mark the invoice paid.

Never put the secret key in `js/app.js` or anywhere in this repo.

---

## 5. Customising

- **Copy** — all text is in `index.html`, in commented sections.
- **Recent invoices table** — the rows at `id="work"` are samples; replace them
  with your real invoices (status, reference/PR, payer initials + name, amount,
  date).
- **Colours / theme** — tokens at the top of `css/style.css`; the page follows
  `prefers-color-scheme` automatically.
- **Keyboard** — pressing `/` jumps to the amount field, like GitHub's search.

---

## 6. Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Serve over HTTP rather than opening the file directly so the Paystack script
behaves consistently.

---

## Status / caveats

- Static frontend only — no backend, no database, no invoice records stored.
- ✅ Subaccount routing wired through `subaccount`, `bearer`, `transaction_charge`.
- ✅ Custom amounts, NGN/USD entry, validation, receipts, print.
- ⚠️ No server-side verification or webhook yet (see §4).
- ⚠️ The "Recent invoices" rows are sample data, not real transactions.
