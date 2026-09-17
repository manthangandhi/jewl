export function parseSpreadsheetId(raw) {
  const s = String(raw || '').trim().replace(/^["']|["']$/g, '');
  const fromUrl = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl) return fromUrl[1];
  const fromOpen = s.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  if (fromOpen) return fromOpen[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s) && !/^https?:/i.test(s)) return s;
  throw new Error('Paste the Google Sheet link (docs.google.com/spreadsheets/d/…)');
}

export function isLicenseAllowed(status) {
  const s = String(status || '').trim().toUpperCase();
  return s === 'ACTIVE' || s === 'TRIAL';
}

export const TRIAL_DAYS = 30;

export function trialEndIso(fromDate, days = TRIAL_DAYS) {
  const d = new Date(fromDate);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid trial start date');
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString();
}

export function isLicenseCurrentlyAllowed({ status, trialEndsAt, paidUntil, createdAt, now = Date.now() } = {}) {
  const s = String(status || '').trim().toUpperCase();
  const t = typeof now === 'number' ? now : Date.parse(now);
  if (s === 'TRIAL') {
    const endRaw = trialEndsAt || (createdAt ? trialEndIso(createdAt, TRIAL_DAYS) : '');
    const end = Date.parse(endRaw);
    return Number.isFinite(end) && t <= end;
  }
  if (s === 'ACTIVE') {
    if (!paidUntil) return true;
    const end = Date.parse(paidUntil);
    return Number.isFinite(end) ? t <= end : true;
  }
  return false;
}

export function isUnlockOk(data) {
  return Boolean(data && data.ok === true && data.unlocked === true);
}

export function fillScriptConstants(source, { sheetId, pin, licenseKey, licenseUrl } = {}) {
  const id = String(sheetId || '').replace(/"/g, '');
  const pinLit = JSON.stringify(String(pin || ''));
  const keyLit = JSON.stringify(String(licenseKey || ''));
  const urlLit = JSON.stringify(String(licenseUrl || ''));
  return String(source)
    .replace(/const SHEET_ID = "[^"]*"/, `const SHEET_ID = "${id}"`)
    .replace(/const SCRIPT_PIN = "[^"]*"/, `const SCRIPT_PIN = ${pinLit}`)
    .replace(/const LICENSE_KEY = "[^"]*"/, `const LICENSE_KEY = ${keyLit}`)
    .replace(/const LICENSE_URL = "[^"]*"/, `const LICENSE_URL = ${urlLit}`);
}

export function normalizeAppsScriptUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) throw new Error('Paste the Apps Script web app URL');
  if (/docs\.google\.com\/spreadsheets/i.test(url)) {
    throw new Error('That is the Sheet link. You need the Web app URL that ends with /exec');
  }
  if (/\/dev\/?(\?|$)/i.test(url) || url.endsWith('/dev')) {
    throw new Error('That is the Test deployment (/dev) URL. Deploy → Manage deployments → copy the URL that ends with /exec');
  }
  if (!/script\.google\.com/i.test(url) || !/\/exec\/?(\?|$)/i.test(url)) {
    throw new Error('URL must be the Web app URL ending in /exec');
  }
  return url.replace(/\/+$/, '').replace(/\?.*$/, '');
}

export function explainLedgerError(raw) {
  const msg = String(raw && raw.message ? raw.message : raw || '');
  const sheetIdFromUrl = msg.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const idHint = sheetIdFromUrl ? sheetIdFromUrl[1] : 'the id between /d/ and /edit';
  if (/invalid action/i.test(msg)) {
    return 'That /exec does not understand unlock. Do not paste the LICENSE_URL here — that is only inside Code.gs. In the PWA, paste the shop ledger /exec: open the jewellery Sheet → Extensions → Apps Script → Deploy → Manage deployments → copy the Web app URL. If that is already the shop script, pencil → Version: New version → Deploy. initLedger does not change the login URL.';
  }
  if (/illegal spreadsheet id/i.test(msg) || /spreadsheet id or key/i.test(msg)) {
    return `SHEET_ID in the deployed script is still the full Sheet URL. In Code.gs set const SHEET_ID = "${idHint}"; Save, then Deploy → Manage deployments → New version. Running initLedger is not enough — the PWA talks to the last deployed version.`;
  }
  if (/UrlFetchApp|script\.external_request|permission to call UrlFetch/i.test(msg)) {
    return 'Run authorizeKarigar in the shop Apps Script editor, click Allow (Connect to an external service), then Deploy → New version. The license check needs internet permission, not access to all your Sheets.';
  }
  if (/openById|specified permissions are not sufficient|not sufficient for this operation/i.test(msg)) {
    return 'Paste Code.gs from the jewellery Sheet: Extensions → Apps Script (bound to this spreadsheet). Do not use a standalone script or SpreadsheetApp.openById. Gear → Project Settings → Show appsscript.json → scopes must be spreadsheets.currentonly and script.external_request. Run authorizeKarigar → Allow → Deploy New version.';
  }
  if (/wrong shop pin/i.test(msg)) {
    return 'Wrong shop PIN. It must match SCRIPT_PIN in the deployed Code.gs. After you change the PIN, Deploy → Manage deployments → New version.';
  }
  if (/not licensed|license key|paused for this shop|not active/i.test(msg)) {
    return 'This shop is not licensed to use Karigar. Pay your Karigar provider; they will send a license key and set you Active. Your Google Sheet is still yours.';
  }
  return msg.replace(/^Error:\s*/i, '').replace(/^Exception:\s*/i, '');
}

export async function verifyPin(requestFn) {
  let data;
  try {
    data = await requestFn({ action: 'unlock' });
  } catch (err) {
    const raw = String(err && err.message ? err.message : err || '');
    if (/invalid action/i.test(raw)) throw new Error(explainLedgerError('Invalid action'));
    throw new Error(explainLedgerError(err));
  }
  if (isUnlockOk(data)) return { mode: 'unlock', data };
  throw new Error('Wrong shop PIN');
}

export async function unlockAndLoad(requestFn) {
  const verified = await verifyPin(requestFn);
  if (verified.mode === 'load') return verified.data;
  try {
    return await requestFn({ action: 'load' });
  } catch (err) {
    throw new Error(explainLedgerError(err));
  }
}

export function googleHttpErrorMessage(status, bodyText) {
  const text = String(bodyText || '');
  if (
    Number(status) === 401
    || /malformed/i.test(text)
    || /that.?s an error/i.test(text)
    || /cannot process the request/i.test(text)
  ) {
    return 'Google 401: the web app URL is wrong or the deployment is not public. Deploy as Execute: Me, Who has access: Anyone, then copy the URL that ends with /exec. Do not use /dev. Run initLedger in the editor once before deploying.';
  }
  if (Number(status) === 404) return 'Google 404: that deployment was deleted. Deploy → New deployment and paste the new /exec URL.';
  const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  return snippet ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`;
}

export function loadUrl(execUrl) {
  return `${normalizeAppsScriptUrl(execUrl)}?action=load`;
}

export function initUrl(execUrl) {
  return `${normalizeAppsScriptUrl(execUrl)}?action=init`;
}
