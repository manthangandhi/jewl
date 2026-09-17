import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAppsScriptUrl, googleHttpErrorMessage } from '../pwa/sheets-client.js';

test('rejects a Google Sheet link instead of the web app /exec URL', () => {
  assert.throws(
    () => normalizeAppsScriptUrl('https://docs.google.com/spreadsheets/d/abc/edit'),
    /Sheet link/
  );
});

test('rejects the Test deployment /dev URL', () => {
  assert.throws(
    () => normalizeAppsScriptUrl('https://script.google.com/macros/s/AKfycbXXX/dev'),
    /\/exec/
  );
});

test('accepts a trimmed web app URL ending in /exec', () => {
  const url = normalizeAppsScriptUrl('  https://script.google.com/macros/s/AKfycbXXX/exec  ');
  assert.equal(url, 'https://script.google.com/macros/s/AKfycbXXX/exec');
});

test('parseSpreadsheetId accepts a full Sheet URL or a bare id', async () => {
  const { parseSpreadsheetId } = await import('../pwa/sheets-client.js');
  assert.equal(
    parseSpreadsheetId('https://docs.google.com/spreadsheets/d/1QmCFgqQzKql5Vjzv9XgazmP1K9yY1_kr7ekY-uWp4S4/edit'),
    '1QmCFgqQzKql5Vjzv9XgazmP1K9yY1_kr7ekY-uWp4S4'
  );
  assert.equal(parseSpreadsheetId('1QmCFgqQzKql5Vjzv9XgazmP1K9yY1_kr7ekY-uWp4S4'), '1QmCFgqQzKql5Vjzv9XgazmP1K9yY1_kr7ekY-uWp4S4');
});

test('fillScriptConstants writes the owner sheet id, PIN and license into Code.gs', async () => {
  const { fillScriptConstants } = await import('../pwa/sheets-client.js');
  const src = [
    'const SHEET_ID = "PASTE_SPREADSHEET_ID_HERE";',
    'const SCRIPT_PIN = "PASTE_SHOP_PIN_HERE";',
    'const LICENSE_KEY = "PASTE_LICENSE_KEY_HERE";',
    'const LICENSE_URL = "PASTE_LICENSE_URL_HERE";'
  ].join('\n');
  const out = fillScriptConstants(src, {
    sheetId: 'abc123',
    pin: 'shop-9',
    licenseKey: 'k-mehta-1',
    licenseUrl: 'https://script.google.com/macros/s/LIC/exec'
  });
  assert.match(out, /const SHEET_ID = "abc123"/);
  assert.match(out, /const SCRIPT_PIN = "shop-9"/);
  assert.match(out, /const LICENSE_KEY = "k-mehta-1"/);
  assert.match(out, /const LICENSE_URL = "https:\/\/script.google.com\/macros\/s\/LIC\/exec"/);
});

test('only ACTIVE and TRIAL licenses may use Karigar', async () => {
  const { isLicenseAllowed } = await import('../pwa/sheets-client.js');
  assert.equal(isLicenseAllowed('ACTIVE'), true);
  assert.equal(isLicenseAllowed('TRIAL'), true);
  assert.equal(isLicenseAllowed('BLOCKED'), false);
  assert.equal(isLicenseAllowed(''), false);
});

test('explains Google 401 malformed as a deployment/URL problem', () => {
  const msg = googleHttpErrorMessage(401, '401. That’s an error. The server cannot process the request because it is malformed.');
  assert.match(msg, /Anyone/);
  assert.match(msg, /\/exec/);
});

test('Sheets permission errors tell you to bind the script, not grant all spreadsheets', async () => {
  const { explainLedgerError } = await import('../pwa/sheets-client.js');
  const msg = explainLedgerError(
    'Exception: Specified permissions are not sufficient to call SpreadsheetApp.openById. Required permissions: https://www.googleapis.com/auth/spreadsheets'
  );
  assert.match(msg, /bound|this spreadsheet|Extensions/i);
  assert.doesNotMatch(msg, /all your Google Sheets/i);
});

test('UrlFetch permission errors ask to run authorizeKarigar', async () => {
  const { explainLedgerError } = await import('../pwa/sheets-client.js');
  const msg = explainLedgerError(
    'Exception: You do not have permission to call UrlFetchApp.fetch. Required permissions: https://www.googleapis.com/auth/script.external_request'
  );
  assert.match(msg, /authorizeKarigar/);
  assert.match(msg, /external_request|internet|license/i);
});

test('explains Invalid action as the license URL or an undeployed shop script', async () => {
  const { explainLedgerError } = await import('../pwa/sheets-client.js');
  const msg = explainLedgerError('Invalid action');
  assert.match(msg, /license/i);
  assert.match(msg, /shop/i);
  assert.match(msg, /New version/i);
});

test('explains illegal spreadsheet id as a full URL still deployed', async () => {
  const { explainLedgerError } = await import('../pwa/sheets-client.js');
  const msg = explainLedgerError(
    'Exception: Illegal spreadsheet id or key: https://docs.google.com/spreadsheets/d/1QmCFgqQzKql5Vjzv9XgazmP1K9yY1_kr7ekY-uWp4S4/edit'
  );
  assert.match(msg, /1QmCFgqQzKql5Vjzv9XgazmP1K9yY1_kr7ekY-uWp4S4/);
  assert.match(msg, /New version/i);
  assert.match(msg, /SHEET_ID/i);
});

test('unlockAndLoad does not fall back to load when the deployed script has no unlock action', async () => {
  const { unlockAndLoad } = await import('../pwa/sheets-client.js');
  const calls = [];
  await assert.rejects(
    () => unlockAndLoad(async (payload) => {
      calls.push(payload.action);
      if (payload.action === 'unlock') throw new Error('Invalid action');
      if (payload.action === 'load') return { ok: true, suppliers: [] };
      throw new Error(`unexpected ${payload.action}`);
    }),
    /New version|Invalid action/i
  );
  assert.deepEqual(calls, ['unlock']);
});

test('unlockAndLoad does not enter when PIN is wrong', async () => {
  const { unlockAndLoad } = await import('../pwa/sheets-client.js');
  await assert.rejects(
    () => unlockAndLoad(async () => {
      throw new Error('Wrong shop PIN');
    }),
    /Wrong shop PIN/
  );
});

test('a GET-style {ok:true} without unlocked is not a PIN unlock', async () => {
  const { isUnlockOk } = await import('../pwa/sheets-client.js');
  assert.equal(isUnlockOk({ ok: true, version: 'x', hint: 'API' }), false);
  assert.equal(isUnlockOk({ ok: true }), false);
  assert.equal(isUnlockOk({ ok: true, unlocked: true }), true);
});

test('verifyPin does not treat a doGet probe as a successful PIN', async () => {
  const { verifyPin } = await import('../pwa/sheets-client.js');
  await assert.rejects(
    () => verifyPin(async () => ({ ok: true, version: '2026-09-08', hint: 'This URL is an API' })),
    /Wrong shop PIN/
  );
});

test('verifyPin never falls back to load after a leftover {ok:true} unlock', async () => {
  const { verifyPin } = await import('../pwa/sheets-client.js');
  const calls = [];
  await assert.rejects(
    () => verifyPin(async (payload) => {
      calls.push(payload.action);
      if (payload.action === 'unlock') return { ok: true, version: 'old-deploy' };
      if (payload.action === 'load') return { ok: true, suppliers: [{ id: 's1', name: 'Ramesh' }] };
      throw new Error(`unexpected ${payload.action}`);
    }),
    /Wrong shop PIN/
  );
  assert.deepEqual(calls, ['unlock']);
});

test('verifyPin does not open the books when unlock is missing even if load would succeed', async () => {
  const { verifyPin } = await import('../pwa/sheets-client.js');
  await assert.rejects(
    () => verifyPin(async (payload) => {
      if (payload.action === 'unlock') throw new Error('Invalid action');
      if (payload.action === 'load') return { ok: true, suppliers: [{ id: 's1' }] };
      throw new Error(`unexpected ${payload.action}`);
    }),
    /New version|Invalid action/i
  );
});

test('trial is allowed for 30 days then inactive; unpaid ACTIVE also expires', async () => {
  const { isLicenseCurrentlyAllowed, trialEndIso } = await import('../pwa/sheets-client.js');
  const start = new Date('2026-09-08T00:00:00.000Z');
  const ends = trialEndIso(start, 30);
  assert.equal(ends, '2026-10-08T00:00:00.000Z');
  assert.equal(isLicenseCurrentlyAllowed({
    status: 'TRIAL', trialEndsAt: ends, now: Date.parse('2026-10-07T12:00:00.000Z')
  }), true);
  assert.equal(isLicenseCurrentlyAllowed({
    status: 'TRIAL', trialEndsAt: ends, now: Date.parse('2026-10-09T00:00:00.000Z')
  }), false);
  assert.equal(isLicenseCurrentlyAllowed({ status: 'INACTIVE' }), false);
  assert.equal(isLicenseCurrentlyAllowed({
    status: 'ACTIVE', paidUntil: '2026-10-08T00:00:00.000Z', now: Date.parse('2026-10-09T00:00:00.000Z')
  }), false);
  assert.equal(isLicenseCurrentlyAllowed({
    status: 'ACTIVE', paidUntil: '2026-10-08T00:00:00.000Z', now: Date.parse('2026-10-01T00:00:00.000Z')
  }), true);
});
