import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../src/token-crypto.js';

test('round-trips a refresh token', () => {
  const key = 'a'.repeat(64);
  const packed = encryptSecret('refresh-token-value', key);
  assert.notEqual(packed, 'refresh-token-value');
  assert.equal(decryptSecret(packed, key), 'refresh-token-value');
});

test('wrong key fails closed', () => {
  const packed = encryptSecret('x', 'a'.repeat(64));
  assert.throws(() => decryptSecret(packed, 'b'.repeat(64)));
});
