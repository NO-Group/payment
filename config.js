/* ================================================================
   PAYMENT CONFIG — static hosts (GitHub Pages)

   Used only when there is no verification server. On GitHub Pages this
   file is the whole configuration: public key + subaccount routing.

   ⚠️ Public key ONLY. A secret key here would be visible to everyone,
      and once published it must be treated as compromised.
================================================================ */

window.PAYMENT_CONFIG = {
  /* Paystack public key — Dashboard → Settings → API Keys & Webhooks */
  publicKey: 'pk_live_1d48c7981d1abf7396474499a369ab7bef17740a',

  /* Every payment is routed to this subaccount */
  subaccount: 'ACCT_4i2l4tyiv5p48cu',

  /* Who absorbs Paystack's fee: 'account' or 'subaccount' */
  bearer: 'account',

  /* Flat Naira amount kept by the main account per payment (0 = none) */
  transactionChargeNGN: 0,

  /* Amount handling */
  usdToNgnRate: 1600,
  minNgn: 100,
  maxNgn: 5000000,

  /* How many times to re-check an unsettled transaction (2.5s apart) */
  verifyAttempts: 6,
};
