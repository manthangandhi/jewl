import test from 'node:test';
import assert from 'node:assert/strict';
import { assertShopPin } from '../pwa/shop-auth.js';

test('rejects an unset script pin', () => {
  assert.throws(() => assertShopPin('1234', ''), /SCRIPT_PIN/);
  assert.throws(() => assertShopPin('1234', 'PASTE_SHOP_PIN_HERE'), /SCRIPT_PIN/);
});

test('rejects the wrong pin', () => {
  assert.throws(() => assertShopPin('0000', 'shop-secret'), /Wrong shop PIN/);
});

test('accepts the matching pin', () => {
  assert.doesNotThrow(() => assertShopPin('shop-secret', 'shop-secret'));
});

test('accepts a PIN with accidental surrounding spaces', () => {
  assert.doesNotThrow(() => assertShopPin('  shop-secret  ', 'shop-secret'));
});

test('a later wrong PIN never opens even if the last good login left a cache', async () => {
  const { admitUnlock } = await import('../pwa/shop-auth.js');
  const { pinFingerprint } = await import('../pwa/session-cache.js');
  const url = 'https://script.google.com/macros/s/abc/exec';
  const decision = admitUnlock({
    typedPin: '9999',
    execUrl: url,
    storedFingerprint: pinFingerprint(url, '1234'),
    cache: { suppliers: [{ id: 's1', name: 'Ramesh' }] },
    remote: null
  });
  assert.equal(decision.enter, false);
});

test('matching remembered PIN is not enough without Google confirming this attempt', async () => {
  const { admitUnlock } = await import('../pwa/shop-auth.js');
  const { pinFingerprint } = await import('../pwa/session-cache.js');
  const url = 'https://script.google.com/macros/s/abc/exec';
  const decision = admitUnlock({
    typedPin: '1234',
    execUrl: url,
    storedFingerprint: pinFingerprint(url, '1234'),
    cache: { suppliers: [{ id: 's1' }] },
    remote: null
  });
  assert.equal(decision.enter, false);
});

test('Google ok:true without unlocked does not admit a wrong PIN via cache', async () => {
  const { admitUnlock } = await import('../pwa/shop-auth.js');
  const decision = admitUnlock({
    typedPin: '9999',
    cache: { suppliers: [{ id: 's1' }] },
    remote: { mode: 'unlock', data: { ok: true, version: 'old' } }
  });
  assert.equal(decision.enter, false);
});

test('only a confirmed Google unlock admits; a PIN-checked load does not', async () => {
  const { admitUnlock } = await import('../pwa/shop-auth.js');
  assert.equal(admitUnlock({
    typedPin: '1234',
    remote: { mode: 'unlock', data: { ok: true, unlocked: true } }
  }).enter, true);
  assert.equal(admitUnlock({
    typedPin: '1234',
    remote: { mode: 'load', data: { ok: true, suppliers: [] } }
  }).enter, false);
});

test('a later session with a load payload still stays locked', async () => {
  const { admitUnlock } = await import('../pwa/shop-auth.js');
  assert.equal(admitUnlock({
    typedPin: '9999',
    remote: { mode: 'load', data: { ok: true, suppliers: [{ id: 's1' }] } }
  }).enter, false);
});

test('hardware keyboard digits and Backspace edit the PIN', async () => {
  const { applyPinKey } = await import('../pwa/shop-auth.js');
  assert.equal(applyPinKey('', '1'), '1');
  assert.equal(applyPinKey('12', '3'), '123');
  assert.equal(applyPinKey('1234', 'Backspace'), '123');
  assert.equal(applyPinKey('12345678', '9'), '12345678');
  assert.equal(applyPinKey('12', 'a'), '12');
});

test('PIN keyboard is live on the lock screen even when focus is not in an input', async () => {
  const { shouldHandlePinKeyboard } = await import('../pwa/shop-auth.js');
  assert.equal(shouldHandlePinKeyboard({ key: '4' }, { unlocked: false, gate: 'login', target: { tagName: 'BODY' } }), true);
  assert.equal(shouldHandlePinKeyboard({ key: 'Enter' }, { unlocked: false, gate: 'login', target: { tagName: 'BODY' } }), true);
  assert.equal(shouldHandlePinKeyboard({ key: '4' }, { unlocked: true, gate: 'login', target: { tagName: 'BODY' } }), false);
  assert.equal(shouldHandlePinKeyboard({ key: '4' }, { unlocked: false, gate: 'login', target: { tagName: 'INPUT' } }), false);
  assert.equal(shouldHandlePinKeyboard({ key: '4' }, { unlocked: false, gate: 'login', target: { tagName: 'INPUT', classList: { contains: (c) => c === 'pin-entry' } } }), true);
});

test('PIN keyboard works on the unlock form even if gate is still choice', async () => {
  const { shouldHandlePinKeyboard } = await import('../pwa/shop-auth.js');
  assert.equal(shouldHandlePinKeyboard({ key: '7' }, {
    unlocked: false,
    gate: 'choice',
    pinScreen: true,
    target: { tagName: 'MAIN' }
  }), true);
  assert.equal(shouldHandlePinKeyboard({ key: '7' }, {
    unlocked: false,
    gate: 'choice',
    pinScreen: false,
    target: { tagName: 'MAIN' }
  }), false);
});
