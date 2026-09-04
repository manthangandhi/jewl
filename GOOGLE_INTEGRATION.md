# Google Login and Sheets Setup

The current local build stores test ledger data in `data/ledger.json`. It does not authenticate the owner and does not write to Google Sheets yet.

To make this a Google-backed product, create a Google Cloud project owned by the SaaS operator and configure OAuth consent for the customer-facing application.

1. Create an OAuth 2.0 Web Application client in Google Cloud Console.
2. Add `http://localhost:3000/auth/google/callback` as an authorized redirect URI for local development.
3. Enable the Google Sheets API and Google Drive API.
4. Configure the minimum required scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/spreadsheets`, and `https://www.googleapis.com/auth/drive.file`.
5. Copy `.env.example` to `.env` and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`.
6. Add a production redirect URI only after the deployed domain is available.

The next implementation step is an OAuth session layer and a Google Sheets ledger adapter. It must create a spreadsheet inside the authenticated customer's Drive and write suppliers, transactions, and settlements there. OAuth tokens must be encrypted in a server-side secret store, never exposed to the browser or committed to this repository.
