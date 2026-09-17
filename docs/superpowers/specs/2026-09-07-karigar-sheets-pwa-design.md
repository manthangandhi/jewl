# Karigar Sheets PWA — design

Date: 2026-09-07  
Status: approved (approach 1 — FluffyPens clone for jewellery)  
Reference: https://github.com/manthangandhi/fluffy-content-vault

## 1. Goal

Ship a first-client jewellery ledger that works like FluffyPens:

- Static PWA (GitHub Pages + install on phone)
- Google Apps Script is the only API
- Google Sheets is the only database
- Shop owner can create, edit, and delete every artefact they add (suppliers, money, metal, settlements)

No Node OAuth, no local `data/ledger.json` as live books.

## 2. Architecture

```
PWA (pwa/)  --POST JSON text/plain-->  Apps Script web app  -->  one Google spreadsheet
GitHub Pages injects pwa/apps-script-url.txt from secret APPS_SCRIPT_URL
Owner may also paste the web-app URL in Setup (session/local config only — not ledger rows)
```

API (same shape as FluffyPens):

- `{ action: "load" }` → `{ ok, meta, suppliers, money, metal, settlements, spreadsheetUrl }`
- `{ action: "save", meta, suppliers, money, metal, settlements, balances }` → `{ ok, spreadsheetUrl }`
- `{ action: "init" }` → creates/repairs tabs and header rows, returns `{ ok, spreadsheetUrl }`

## 3. Sheet (created by Apps Script)

Bound script uses `SpreadsheetApp.getActiveSpreadsheet()`. Optional `SHEET_ID` override.

| Tab | Purpose |
|---|---|
| `_Meta` | shopName, schemaVersion, createdAt |
| `Suppliers` | directory |
| `Money` | opening / purchase / payment |
| `Metal` | opening / issue / receipt |
| `Settlements` | cash and metal close-outs |
| `Balances` | computed party khata (we owe / they owe / metal with party) |

Supplier names are denormalised onto journal rows so the Sheet is readable without VLOOKUP.

Journals are **not** append-only in the UI: the PWA loads the full ledger, upserts or removes by `id`, then saves the tab. Apps Script replaces data rows (row 2+) for that tab, never the header row.

## 4. Edit and delete

Every created row is editable. Opening a row prefills the drawer. Save upserts by `id`. Delete removes that `id` after confirm.

Deleting a supplier also deletes that party’s money, metal, and settlement rows (one confirm that shows counts).

## 5. PWA

- Manifest, service worker, Apple meta, install prompt
- Home: party balances
- Views: parties, money, metal, settlements, party detail
- Mobile: bottom nav, drawers, 44px targets, safe-area
- Open in Google Sheets when `spreadsheetUrl` is known

## 6. Out of scope

Node OAuth SaaS, Razorpay, multi-tenant admin, GST, job cards, staff users.
