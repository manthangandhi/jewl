# Google Login and Sheets Setup

The Sheets ledger adapter is implemented (`src/sheets-ledger.js`). When `GOOGLE_CLIENT_ID` is set, owner sign-in uses Google OAuth and jewellery rows are written to a spreadsheet created in that owner’s Drive. When `GOOGLE_CLIENT_ID` is unset, the app uses the local JSON adapter for tests and development only.

## Scopes

The OAuth consent request uses:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/drive.file`

`drive.file` only lets the app access files **it created**. It cannot list or read the rest of the customer’s Drive.

## Operator setup

1. Create an OAuth 2.0 Web Application client in Google Cloud Console.
2. Add `http://localhost:3000/auth/google/callback` as an authorized redirect URI for local development.
3. Enable the Google Sheets API and Google Drive API.
4. Copy `.env.example` to `.env` and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `TOKEN_ENCRYPTION_KEY`.
5. In production, `TOKEN_ENCRYPTION_KEY` must be 64 hex characters. Add a production redirect URI only after the deployed domain is available.

## Tokens and files

Refresh tokens are encrypted with `TOKEN_ENCRYPTION_KEY` and stored server-side on the user record. They are never sent to the browser.

On setup the adapter creates a spreadsheet titled `Karigar ledger — {businessName}` with tabs `_Meta`, `Suppliers`, `Money`, `Metal`, and `Settlements`. The spreadsheet id is stored as a pointer on the tenant.

If that spreadsheet is later missing (GET 404), `ensureSpreadsheet` creates a **new** spreadsheet and returns the new id so the caller can update the pointer. It never deletes customer files.

A blocked or unpaid workspace can become read-only in the app; Drive files are left in place.
