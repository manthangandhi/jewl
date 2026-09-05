# Karigar core supplier ledger — design

Date: 2026-09-05  
Status: approved in design conversation; awaiting spec review before implementation planning  
Source of commercial rules: `SAAS_COMMERCIALIZATION_ADDENDUM.md`

## 1. Goal

Ship a working jewellery operations slice on the existing Node + vanilla JS app:

- Shop owner signs in with Google (owner-only; no staff users).
- The jewellery ledger lives in one spreadsheet created in the owner’s Google Drive.
- The owner can run a daily supplier ledger: suppliers, money, metal by purity, simple settlements, reports, and CSV export.
- A 14-day trial grants full writes. After expiry the app is read-only; customer Drive files are never deleted.
- `/admin` can manage tenants and access. It never reads ledger rows.

This is not the completed commercial SRS. Live Razorpay checkout, multi-user, reconciliation, period close, attachments, WhatsApp, and multi-branch are out of scope.

## 2. Approach

Extend this repository. Do not rewrite on Next.js. Do not put the product inside Apps Script.

Replace `LedgerStore` file JSON as the owner-facing database with a Google Sheets adapter. Keep the current control plane, entitlement service, public pages, and admin screen. Keep local JSON only as a test/dev adapter when Google credentials are absent, never as a silent fallback for a signed-in owner session.

## 3. Architecture

Two data planes:

**SaaS control plane** (this app’s metadata store: existing file-backed `MetadataStore` in `data/` for local development):

- Tenant, owner identity, plan, trial, subscription status
- Spreadsheet ID pointer (not sheet rows)
- Encrypted OAuth refresh/access tokens
- Admin actions and processed billing webhook IDs

Forbidden in the control plane: supplier names, phones, money amounts, metal weights, settlement notes, or any other jewellery business records. Keep the existing forbidden-key check and extend it for metal/purity/weight fields.

**Customer Google account:**

- One spreadsheet in the owner’s Drive
- Tabs: `Suppliers`, `Money`, `Metal`, `Settlements`
- Owner can open the file in Google Sheets at any time

Request path for owner operations:

`Google OAuth → app session → SubscriptionEntitlementService → Sheets adapter (owner token) → customer spreadsheet`

Admin path:

`x-admin-key → tenant metadata only`

## 4. Identity and tenancy

Owner-only.

On first successful Google login:

1. Read Google subject, email, and profile name. Encrypt and store OAuth tokens server-side (`TOKEN_ENCRYPTION_KEY`). Never send refresh tokens to the browser.
2. If no user exists for that Google subject, show a one-field setup: **business name** (required). Do not create a spreadsheet until this is submitted.
3. Then create:
   - `User`: `id`, `tenantId`, `email`, `googleSubjectId`, `name`, `role=OWNER`, `status=ACTIVE`, `createdAt`, `lastLoginAt`
   - `Tenant`: existing fields from `createTenant`, plus `spreadsheetId`, `googleConnected`, `setupStatus`
4. Start a 14-day `TRIALING` tenant on plan `PRO` (price and trial days come from the plan record, not hard-coded in UI copy).
5. Create the Drive spreadsheet with the four tabs and header rows. Store `spreadsheetId`. Set `googleConnected=true`, `setupStatus=READY`.

Later logins: refresh `lastLoginAt` / `lastAccessAt`, reuse the existing spreadsheet. If the spreadsheet is missing but tokens work, recreate it and save the new ID. Do not invent a second tenant for the same Google subject.

Admin does not create Drive ledgers for other people. Self-serve Google login is how a shop gets a spreadsheet. Admin only changes access on tenants that already exist.

Sessions: HTTP-only server session after OAuth. All `/api/tenants/:id/*` routes must authenticate as that tenant’s owner. Do not accept a tenant id from `localStorage` as authority.

## 5. Spreadsheet schema

One spreadsheet named `Karigar ledger — {businessName}`.

A `_Meta` tab is allowed for `schemaVersion` and `createdAt` only. It must not contain supplier or transaction rows.

### 5.1 Suppliers

| Column | Meaning |
|---|---|
| id | UUID |
| name | Required |
| phone | Optional |
| notes | Optional |
| status | `ACTIVE` or `ARCHIVED` |
| createdAt | ISO timestamp |

### 5.2 Money

| Column | Meaning |
|---|---|
| id | UUID |
| date | `YYYY-MM-DD` |
| supplierId | Supplier id |
| type | `OPENING` \| `PURCHASE` \| `PAYMENT` |
| amountInr | Positive number |
| note | Optional |
| createdAt | ISO timestamp |

`PURCHASE` includes goods billed and making charges billed. There is no separate making-charge type in this slice.

**Payable to supplier** = opening + purchases − payments − settlement cash.

### 5.3 Metal

| Column | Meaning |
|---|---|
| id | UUID |
| date | `YYYY-MM-DD` |
| supplierId | Supplier id |
| direction | `OPENING` \| `ISSUE` \| `RECEIPT` |
| metalType | `GOLD` \| `SILVER` |
| purity | Closed set below |
| weightGrams | Positive number, grams |
| note | Optional |
| createdAt | ISO timestamp |

`ISSUE` = metal given to the party. `RECEIPT` = metal received from the party.

**Metal with supplier** for each `(metalType, purity)` = opening + issues − receipts − settlement metal of that pair.

Purity values are not converted into each other.

Allowed purity values:

- Gold: `24K`, `22K`, `18K`, `14K`
- Silver: `999`, `925`

### 5.4 Settlements

| Column | Meaning |
|---|---|
| id | UUID |
| date | `YYYY-MM-DD` |
| supplierId | Supplier id |
| moneyAmountInr | Zero or positive; cash closed |
| metalType | Empty, `GOLD`, or `SILVER` |
| purity | Empty or a allowed purity |
| metalGrams | Zero or positive |
| note | Optional |
| createdAt | ISO timestamp |

A settlement row may close cash, one metal purity, or both. Metal on a settlement must include both `metalType` and `purity` when `metalGrams` > 0.

This is a simple close-out, not a reconciliation wizard and not a period close.

Money, metal, and settlement journals are **append-only** in this slice. Suppliers may be edited (name, phone, notes) or archived. Opening money/metal is written once at supplier creation as `OPENING` rows; it is not a later editable running balance.

### 5.5 Balance source of truth

Balances are always computed from rows. Do not persist running totals as authority. Header rows are created by the adapter; the app must tolerate an owner adding columns to the right, but required columns are named and must remain present.

## 6. Application screens

Keep the current Karigar visual language (Manrope, existing CSS).

**Owner app**

- Continue with Google (replace email-only local onboarding as the primary path). New owners enter a business name, then the spreadsheet is created.
- Overview: payables, metal with parties, recent activity, remaining trial days, account mode.
- Suppliers list: name, phone, payable, metal summaries.
- Supplier detail: the daily workspace. Show payable and per-purity metal. Actions: add purchase, record payment, issue metal, receive metal, settle. Opening balances are set when creating the supplier (money opening + optional metal openings).
- Money, Metal, Settlements journals: shop-wide, each line tied to a supplier.
- Reports: same totals, plus CSV export of suppliers, money, metal, settlements.
- Plan & billing: current trial/paywall card. Razorpay checkout remains a stub message.

**Public:** `/pricing`, `/data-ownership` (keep accurate “your ledger stays in your Drive” language).

**Admin:** `/admin` with admin key. Metrics: total tenants, trials, active subscriptions, past due, MRR from plan price × paid tenant count. Actions: extend trial, comp, block, reactivate. Tenant table fields: id, business name, owner email, status, plan, trial/period dates — never supplier or transaction data. Admin does not provision Google spreadsheets.

If Google credentials are missing, local development may still create a workspace against the JSON adapter, with a visible “local development mode” banner. That path is for developers, not the owner product path.

## 7. Entitlements and write gate

Reuse `SubscriptionEntitlementService`. Account modes: `FULL_ACCESS`, `READ_ONLY`, `BLOCKED`.

Central write gate: `assertCanPerformPaidWrite(tenantId, feature)` before any sheet mutation.

Feature keys used in this slice:

- `supplier_management`
- `transaction_entry` (money)
- `metal_ledger`
- `settlements`
- `exports` (allowed in read-only)
- `audit_log` (not implemented as a product screen; do not claim it in the UI)

PRO trial and active/comp/grace tenants get full writes. Expired, cancelled after period end, and suspended tenants are `READ_ONLY` except `ADMIN_BLOCKED` / tenant `status=BLOCKED`, which cannot use the app.

Read-only still allows: sign in, overview, suppliers, journals, reports, CSV export, opening the customer’s Google file. It blocks creating/editing suppliers and recording money, metal, or settlements.

Never delete Drive data on non-payment or block.

## 8. Components

| Unit | Responsibility | Depends on |
|---|---|---|
| OAuth session layer | Google login, session cookie, token encrypt/decrypt | Google OAuth client, control plane user/tenant |
| Sheets ledger adapter | Create spreadsheet, CRUD tabs, compute balances, CSV | Owner tokens, Sheets + Drive APIs |
| Ledger port | Interface used by HTTP handlers (`list`, `add`, `summary`, `exportCSV`) | Sheets adapter in owner sessions; JSON adapter in tests |
| Entitlement service | Account mode, write permission, plan limits | Tenant + plan stores |
| HTTP API | Authn, write gate, JSON responses, static pages | All of the above |
| Owner UI (`public/app.js`) | Screens above; uses session, not raw tenant localStorage as auth |
| Admin UI | Metrics and lifecycle; admin key header |

## 9. Error handling

- Login cancel/failure: no tenant created; message on landing.
- Spreadsheet create failure on first login: do not leave a usable tenant without a ledger pointer. Mark `setupStatus=SETUP_FAILED` or roll back; owner retries login.
- Later Sheets read/write failure: surface the error; keep the tenant; do not write jewellery rows to local JSON in that session.
- Token expired or Drive access revoked: re-auth with Google; never delete the spreadsheet.
- Read-only write: single server entitlement error; UI disables forms from entitlements payload.
- Bad admin key: 401, empty body beyond error.
- Malformed sheet rows: skip/surface as invalid; do not crash the workspace.

## 10. Testing

`npm test` (Node test runner). No live Google in CI.

- Trial, expiry → read-only, `ADMIN_COMP`, `ADMIN_BLOCKED`.
- Payable and per-purity metal math, including settlements.
- Control plane rejects ledger field names; admin list contains no ledger fields.
- Write gate blocks mutations when not `FULL_ACCESS`.
- Mocked Sheets adapter: four tabs created; append/list; CSV.
- Mocked OAuth: first login creates tenant + spreadsheet pointer; revoke does not delete sheet.
- Existing Razorpay HMAC + idempotency tests remain.

## 11. Explicit non-goals

- Razorpay hosted checkout and recurring subscription API
- Staff users, PINs, sheet sharing
- Fine-gold conversion
- Reconciliation, period close, audit UI
- Attachments, WhatsApp, multi-branch, automatic backups
- Hosted production database (file-backed control plane remains for this slice)
- Account deletion / disconnect-Google product flows beyond not deleting Drive data by default

## 12. Success criteria

A jewellery shop owner can:

1. Sign in with Google without contacting the founder.
2. Get a private spreadsheet in their Drive.
3. Add a supplier with opening money and metal.
4. Record purchase, payment, metal issue, metal receipt, and a simple settlement.
5. See payable and per-purity metal on overview, supplier detail, and reports.
6. Export CSV.
7. Keep reading and exporting after trial expiry, without losing Drive files.
8. An admin can extend/comp/block that tenant without seeing ledger rows.
