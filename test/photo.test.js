import test from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, photoFileName, splitDataUrl } from '../pwa/photo.js';

test('big phone photos are shrunk, small ones are left alone', () => {
  assert.deepEqual(fitWithin(4000, 3000, 1280), { width: 1280, height: 960 });
  assert.deepEqual(fitWithin(3000, 4000, 1280), { width: 960, height: 1280 });
  assert.deepEqual(fitWithin(800, 600, 1280), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(0, 0), { width: 0, height: 0 });
});

test('photo file names are safe and readable', () => {
  const name = photoFileName({ customerName: 'Anita Shah!', kind: 'RETURN', date: '2026-11-13', stamp: 5 });
  assert.equal(name, '2026-11-13-return-anita-shah-5');
});

test('data URLs split into mime and base64', () => {
  assert.deepEqual(splitDataUrl('data:image/jpeg;base64,AAAA'), { mime: 'image/jpeg', base64: 'AAAA' });
  assert.throws(() => splitDataUrl('nope'), /photo/i);
});
