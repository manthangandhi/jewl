# Karigar owner ledger — design

Date: 2026-09-08  
Status: approved (Approach 1)  
For: first shop owner, jewellery supplier/karigar khata

## Intent

The shop owner owns the books. Karigar is the counter. Google Sheets is the CA’s register and the file that survives if the app does not.

## Decisions

- Spreadsheet and Apps Script live in the **owner’s Google account** (template: File → Make a copy).
- Daily work on **phone and computer**; UI is **phone-first**, desktop is the same product wider.
- **App for daily entry**; **Sheet for the CA**. Saves must not wipe CA edits to other rows.
- **Only the owner** uses the app (one PIN). CA never logs into Karigar.

## Setup (once)

1. Owner copies the Karigar template into their Drive.
2. Menu **Karigar → Set up my books** (authorise + tabs).
3. **Karigar → Turn on phone access** (Deploy: Me / Anyone). First shop: sit with them.
4. Open the PWA, paste `/exec` **once**, set PIN. Later sessions: PIN only. Shop name comes from the Sheet.

Live books are that one Drive file. The PWA is a client. `SHEET_ID` in the copied script points at **their** spreadsheet.

## Daily product

- Home is **party khata** (search + add party). Not journal modules.
- Party screen is a **passbook** plus **Purchase · Payment · Give metal · Get metal**. Settlement is secondary.
- Timeline newest-first with running money balance. Purity never mixed.
- Phone: bottom nav Parties · Today · Books (Sheet). Laptop: same, plus obvious “Open in Google Sheets”.
- After first setup, no `/exec` field.

## Sheet (CA)

Tabs: **Khata** (report, do not type), **Parties**, **Money**, **Metal**, **Settlements**, hidden **_Meta**.  
Human columns first; `id` last. Party name on every journal row.

Save: reload from Sheet, merge by id (local dirty/deleted vs remote; keep CA-added rows), then write. Show last-saved time in the app.

## Out of scope

GST, staff logins, job cards, tola, WhatsApp, Razorpay, retail customers, Node OAuth, your Drive as the database.

## Done when

Owner copies the file into their Drive; PIN unlocks party khata on phone/laptop; CA can read Khata/Money without the app; a Money cell the CA edits is still there after the owner saves a *different* row from the phone.
