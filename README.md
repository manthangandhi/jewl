# Karigar

Karigar is a jewellery supplier ledger for shop owners. The client app is a **PWA** (phone home screen) with the same architecture as [FluffyPens](https://github.com/manthangandhi/fluffy-content-vault): a static frontend, Google Apps Script as the API, and **Google Sheets as the only database**.

Every supplier, money, metal, and settlement row can be created, edited, and deleted. Party balances (we owe them / they owe us / metal with party) live on the home screen and on a `Balances` tab in the Sheet.

## First client (Sheets PWA)

```sh
npm test
npm run pwa
```

Open `http://localhost:3000`. Then create the spreadsheet and connect it using [SHEETS_SETUP.md](./SHEETS_SETUP.md).

- **Live app (phone / laptop / tablet):** https://manthangandhi.github.io/jewl/
- PWA files: `pwa/`
- Apps Script: `pwa/google-apps-script.gs`
- GitHub Pages deploys `pwa/` on push. Shop PIN and Sheet stay in the owner’s Google account; this URL is only the counter.

On a phone: open the HTTPS link → browser menu → **Add to Home Screen**.

## Node SaaS prototype (optional)

The older Node workspace still runs for local JSON experiments. It is **not** the Sheets-backed client product.

```sh
cp .env.example .env
npm start
```

Open `http://localhost:3000` after starting.

- **Google mode** — set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and a production-grade `TOKEN_ENCRYPTION_KEY` (64 hex characters). The landing page’s **Continue with Google** link starts OAuth. After sign-in the owner names the shop; Karigar creates the ledger spreadsheet in their Drive.
- **Local-dev mode** — leave `GOOGLE_CLIENT_ID` empty. The landing page shows a **LOCAL DEVELOPMENT MODE** banner and a **Create local workspace** form. Ledger rows stay in `data/ledger.json`. This JSON adapter is for tests and local development only; it is not used for an owner Google session.

Public pages:

| Path | What it is |
|---|---|
| `/pricing` | PRO ₹1,999/month, 14-day trial, no card required |
| `/data-ownership` | Ledger stays in the owner’s Google Drive |
| `/admin` | SaaS control plane. Prompt for `ADMIN_KEY` (default `local-admin`) |

`/admin` can extend trial, comp, block, or reactivate a tenant. It never reads jewellery ledger rows.

## Storage boundary

- **Owner ledger** — suppliers, money, metal, and settlements live in the owner’s Google Sheets (or `data/ledger.json` in local-dev). The operator does not copy those rows into the control plane.
- **Control plane** — tenant, user, plan, subscription, entitlement, and webhook metadata only, persisted under `data/` (`tenants.json`, `users.json`, `plans.json`, `billing-events.json`). Restarting the server does not drop this metadata.

After trial expiry the workspace becomes read-only: existing rows stay readable and CSV export still works; writes are blocked. Admin block is separate and does not delete Drive files.

## Billing

This slice is **not live Razorpay**. There is no checkout. Plan metadata is PRO at ₹1,999/month with a 14-day trial. `RAZORPAY_WEBHOOK_SECRET` is only for HMAC-verified webhook experiments; do not treat that as production billing.

See [GOOGLE_INTEGRATION.md](./GOOGLE_INTEGRATION.md) for OAuth, scopes, and the Sheets adapter. The original commercialization audit is in [SAAS_COMMERCIALIZATION_ADDENDUM.md](./SAAS_COMMERCIALIZATION_ADDENDUM.md).
