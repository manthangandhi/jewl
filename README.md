# Karigar

Karigar is a jewellery shop workspace. The owner signs in with Google so supplier, money, metal, and settlement rows live in a spreadsheet the app creates in that owner’s Drive. When `GOOGLE_CLIENT_ID` is unset, the same UI falls back to a local workspace (JSON ledger) for development.

## Run

```sh
cp .env.example .env
npm test
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
