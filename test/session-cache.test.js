import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toLedgerSnapshot,
  fromLedgerSnapshot,
  pinFingerprint,
  localPinMatches
} from '../pwa/session-cache.js';
import { verifyPin } from '../pwa/sheets-client.js';

test('ledger snapshot round-trips parties and journals', () => {
  const snap = toLedgerSnapshot({
    shopName: 'Mehta',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/x',
    suppliers: [{ id: 's1', name: 'Ramesh' }],
    money: [{ id: 'm1', amountInr: 10 }],
    metal: [],
    settlements: [],
    meta: { lastSavedAt: '2026-09-08' }
  });
  const back = fromLedgerSnapshot(JSON.parse(JSON.stringify(snap)));
  assert.equal(back.shopName, 'Mehta');
  assert.equal(back.suppliers[0].name, 'Ramesh');
  assert.equal(back.money[0].amountInr, 10);
});

test('fromLedgerSnapshot rejects junk', () => {
  assert.equal(fromLedgerSnapshot(null), null);
  assert.equal(fromLedgerSnapshot({ suppliers: [] }), null);
});

test('tab session unlock stores PIN with the web app URL and drops empties', async () => {
  const { toSessionUnlock, fromSessionUnlock } = await import('../pwa/session-cache.js');
  assert.equal(toSessionUnlock({ sheetsUrl: '', pin: '1234' }), null);
  assert.equal(toSessionUnlock({ sheetsUrl: 'https://script.google.com/macros/s/x/exec', pin: '' }), null);
  const rec = toSessionUnlock({ sheetsUrl: 'https://script.google.com/macros/s/x/exec', pin: ' 4455 ' });
  assert.equal(rec.pin, '4455');
  assert.equal(fromSessionUnlock(rec).sheetsUrl, 'https://script.google.com/macros/s/x/exec');
  assert.equal(fromSessionUnlock({ v: 1, sheetsUrl: 'https://x', pin: '' }), null);
});

test('local PIN match is per web app URL', () => {
  const fp = pinFingerprint('https://script.google.com/macros/s/abc/exec', '1234');
  assert.equal(localPinMatches(fp, 'https://script.google.com/macros/s/abc/exec', '1234'), true);
  assert.equal(localPinMatches(fp, 'https://script.google.com/macros/s/abc/exec', '0000'), false);
  assert.equal(localPinMatches(fp, 'https://script.google.com/macros/s/other/exec', '1234'), false);
});

test('verifyPin stops after unlock and does not load the whole sheet', async () => {
  const calls = [];
  const result = await verifyPin(async (payload) => {
    calls.push(payload.action);
    if (payload.action === 'unlock') return { ok: true, unlocked: true, version: 'test' };
    throw new Error(`unexpected ${payload.action}`);
  });
  assert.deepEqual(calls, ['unlock']);
  assert.equal(result.mode, 'unlock');
});
