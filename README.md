# Jewellery ERP SaaS foundation

This is a local-development MVP for the multi-tenant jewellery operations product described in the addendum. It currently uses a local ledger adapter; it does not yet offer Google login or write ledger records to Google Sheets. The complete requirement-by-requirement audit is in [SAAS_COMMERCIALIZATION_ADDENDUM.md](./SAAS_COMMERCIALIZATION_ADDENDUM.md).

## Run

```sh
npm test
npm start
```

Open `http://localhost:3000` after starting. The app includes onboarding, dashboard, suppliers, transactions, reports, and billing screens. Public pages are available at `/pricing` and `/data-ownership`; the local control-plane screen is at `/admin` using the default key `local-admin`.

If an older browser session is stuck, open `http://localhost:3000/?reset=1` once to clear the local workspace pointer and start fresh.

The API includes tenant CRUD workflows, summaries, CSV exports, settlements, account deletion choices, entitlement checks, billing webhooks, admin metrics, and admin tenant lifecycle actions.

## Storage boundary

The control plane stores tenant, plan, subscription, entitlement, and webhook metadata only. It rejects common customer-ledger fields. In this local MVP, the separate ledger adapter writes test records to `data/ledger.json`. It is not a Google Sheets integration. See [GOOGLE_INTEGRATION.md](./GOOGLE_INTEGRATION.md) for the required OAuth and API setup before using real customer data.

Local development data is persisted under `data/` so a server restart does not strand the browser on a deleted in-memory tenant. Replace these file stores with a real metadata database and Google-owned ledger adapter before production. Real webhook requests require `RAZORPAY_WEBHOOK_SECRET`; requests are HMAC-verified and event IDs are processed once. This is not yet the full production SRS: Google OAuth/Sheets/Drive, persistent hosted storage, full jewellery workflows, admin tooling, and live Razorpay billing remain required work.
