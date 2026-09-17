# Create the Karigar Google Sheet (same as FluffyPens)

## Why FluffyPens worked and Karigar 401’d

FluffyPens does **not** open the Apps Script URL in a browser tab. The GitHub Pages app **POSTs** to `/exec` in the background. You already authorised that script **once in the Apps Script editor** months ago. It runs as **you** (`Execute as: Me`) with access **Anyone**, and `SHEET_ID` is hardcoded.

Karigar 401 happened because we drifted from that:

| FluffyPens | What we did wrong |
|---|---|
| `SHEET_ID = "15EY…"` hardcoded | Empty id + `getActiveSpreadsheet()` (null in a web app) |
| Authorise by **Run** in the editor | Asked you to authorise by opening `/exec` |
| Never open `/exec` as a page | Told you to paste `/exec` in a tab → Google 401 |
| Pages on **HTTPS** | Called `/exec` from **localhost** |
| Execute as **Me**, access **Anyone** | Execute as **user accessing** (forces a login 401) |

Opening `/exec` in Chrome on FluffyPens would 401 too. That is normal.

## Same setup as FluffyPens

1. Create a Google Sheet. From the URL copy the id:
   `https://docs.google.com/spreadsheets/d/`**`THIS_ID`**`/edit`
2. Spreadsheet → **Extensions → Apps Script**. Paste [`pwa/google-apps-script.gs`](./pwa/google-apps-script.gs).
3. At the top, set:
   `const SHEET_ID = "THIS_ID";`
   `const SCRIPT_PIN = "your-secret-pin";`
   Save. The PWA will not load the books without this PIN.
4. In the editor: function **`initLedger`** → **Run**. This creates empty tabs. It does **not** load demo parties. Demo khata is optional: Sheet menu **Karigar → Load sample khata (demo only)**, or PWA **Sheet → Load demo khata**.
   Allow this account. If unverified: **Advanced** → **Go to Karigar ledger (unsafe)** → **Allow**.
   This is the same Allow you already did for FluffyPens. Do it in the **editor**, not in a browser tab of `/exec`.
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   Copy the URL that ends with `/exec`. Do not open it.
6. Open Karigar PWA → Setup → paste that `/exec` URL → Save. Or put it in `apps-script-url.txt` / GitHub secret `APPS_SCRIPT_URL` like FluffyPens.

## 1. Create the spreadsheet

1. Open [Google Sheets](https://sheets.google.com) while signed in as the shop owner (or you, for the first client).
2. **Blank spreadsheet**.
3. Rename it `Karigar ledger — {shop name}`.

Do not build tabs by hand. The script adds `_Meta`, `Suppliers`, `Money`, `Metal`, `Settlements`, and `Balances`.

## 2. Paste Apps Script

1. In that sheet: **Extensions → Apps Script**.
2. Delete any stub code.
3. Paste the full contents of [`pwa/google-apps-script.gs`](./pwa/google-apps-script.gs).
4. Leave `SHEET_ID = ""` (the script is bound to this spreadsheet).
5. Save the project (name it `Karigar ledger`).

## 3. Create the tabs

Use **Karigar → Authorise and create tabs** on the Sheet (not Run in the editor if authorisation failed there).

You should now see:

| Tab | What it is |
|---|---|
| `_Meta` | Shop name and schema version |
| `Suppliers` | Name, phone, city, notes, status |
| `Money` | Opening / purchase / payment, with supplier name on every row |
| `Metal` | Opening / issue / receipt by gold 24K–14K and silver 999/925 |
| `Settlements` | Cash and metal close-outs |
| `Balances` | **Party khata report** — We owe them / They owe us / metal with party |

Header row is frozen and dark green. `Balances` and `Suppliers` get a filter. You can edit any cell in Sheets; the PWA also edits and deletes by row id.

## 4. Deploy the web app (this is the API)

1. **Deploy → New deployment → Web app**.
2. Description: `Karigar ledger`.
3. Execute as: **Me**.
4. Who has access: **Anyone with the link**.
5. Deploy. Copy the Web app URL (`https://script.google.com/macros/s/…/exec`).

If you change the script later: **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**.

Running **initLedger** only authorises and creates tabs. It does **not** update the `/exec` URL the PWA uses. If login keeps rejecting the correct PIN, the web app is still the old version.

## 5. Connect the PWA

Local:

```sh
npm run pwa
```

Open http://localhost:4173

1. Setup opens.
2. Enter shop name.
3. Paste the Web app URL.
4. **Save & load**, then **Create / repair sheet tabs** if tabs were not created in step 3.

Phone: after GitHub Pages is on, open the Pages URL → browser **Add to Home Screen**. Same Setup if the URL was not injected.

To inject the URL for every device (FluffyPens pattern):

1. Repo **Settings → Secrets → Actions**
2. Secret name `APPS_SCRIPT_URL`, value = the web app URL
3. Enable GitHub Pages (source: GitHub Actions)
4. Push; the workflow writes `apps-script-url.txt` at deploy time

## 6. Check it worked

1. Add a supplier in the PWA, save.
2. Refresh the Google Sheet — the row is on `Suppliers`.
3. Add a purchase. `Money` and `Balances` update (`We owe them`).
4. Tap that purchase in the app, change the amount, save — the same row id updates.
5. Delete the purchase — the row disappears from the sheet.
6. Install the PWA on a phone and confirm the same balances.

## Sheet columns (full)

**Suppliers:** id, name, phone, city, notes, status, createdAt, updatedAt  

**Money:** id, date, supplierId, supplierName, type, amountInr, note, createdAt, updatedAt  

**Metal:** id, date, supplierId, supplierName, direction, metalType, purity, weightGrams, note, createdAt, updatedAt  

**Settlements:** id, date, supplierId, supplierName, moneyAmountInr, metalType, purity, metalGrams, note, createdAt, updatedAt  

**Balances:** supplierId, supplierName, status, moneyDirection, moneyInr, metalWithParty, weOweInr, theyOweInr, updatedAt  

Anyone with the web app URL can read and write this ledger. Keep the URL private to the shop.

## If you see Google **401** (“malformed”)

That page is Google rejecting the request **before** Karigar’s script runs. Typical causes:

1. You opened or pasted the **Test** URL (`/dev`) instead of the **Web app** URL (`/exec`).
2. Access is not **Anyone** (or “Anyone with a Google account”). “Only myself” and “Anyone in the organisation” both 401 from the PWA.
3. Execute as is **User accessing the web app**. It must be **Me**.
4. Several Google accounts are signed in in the same browser. Use a window with only the shop account, or an incognito window.
5. You pasted the **Sheet** link (`docs.google.com/spreadsheets/...`) instead of the script URL.

Fix:

1. In the Sheet, **Extensions → Apps Script**.
2. Replace the script with the latest `google-apps-script.gs`.
3. Select `initLedger` → **Run**. Allow permissions. This remembers the spreadsheet id for the web app.
4. **Deploy → New deployment** (or Manage deployments → pencil → New version).
   - Type: Web app
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the URL. It must end with `/exec`.
6. Paste that URL into a new browser tab. You should see JSON like `{"ok":true,"hint":"Web app is live..."}`. If you still see 401, the deployment is not public — repeat step 4.
7. Hard-refresh Karigar at http://localhost:4173 and paste the same `/exec` URL in Setup.

The PWA now loads with GET `?action=load` and never sends Google cookies (`credentials: omit`), which avoids the multi-account 401.
