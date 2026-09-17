# Your Karigar license Sheet (operator only)

Shop books stay in the shop’s Drive. This Sheet is **yours**: who is on trial, who paid, who is inactive.

## Once

1. Google Sheets → blank → name `Karigar licenses`.
2. Extensions → Apps Script. Paste `pwa/karigar-licenses.gs`.
3. Set `LICENSES_SHEET_ID` to the id in the Sheet URL (`/d/THIS/edit`).
4. Run `initLicenses`. Allow.
5. Deploy → Web app → Execute as **Me** → **Anyone**. Copy `/exec`.
6. Put that URL in `pwa/license-url.txt` (one line, no quotes). Redeploy the PWA / GitHub Pages.

Optional: Triggers → From this project → `expireStaleLicenses` → time-driven → daily. That flips expired rows to `INACTIVE` even if they never open the app.

## How a new shop is onboarded

They cannot invent a working key. You create the row **first**, as a trial (not paid).

1. In the license Apps Script editor, run:

   `issueTrial('Mehta Jewellers', '98xxxxxxxx')`

   That appends a row: status `TRIAL`, `trialEndsAt` = now + **30 days**, and a `licenseKey` like `k-ab12cd34ef`.

2. WhatsApp them the key. They use **New shop** in the PWA and paste it.

3. For 30 days, unlock/save is allowed. Their jewellery data lives only in **their** Google Sheet.

4. Day 31 without payment: the next verify (or the daily trigger) sets status `INACTIVE`. The app refuses to open. Their Sheet is not deleted.

## When they pay (and every 30 days after)

Run:

`markPaid('k-ab12cd34ef')`

That sets status `ACTIVE` and `paidUntil` = now + 30 days.

If they do not pay again, day 31 after `paidUntil` they become `INACTIVE` again. Same as a lapsed trial.

To block immediately (refund, abuse): set `status` to `BLOCKED` in the Sheet.

## Status meaning

| status | Meaning | App works? |
|---|---|---|
| TRIAL | New shop, not paid yet | Yes, until `trialEndsAt` (30 days) |
| ACTIVE | Paid | Yes, until `paidUntil` (another 30 days) |
| INACTIVE | Trial or paid window ended | No |
| BLOCKED | You cut them off | No |

Unknown key → no.
