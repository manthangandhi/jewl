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

