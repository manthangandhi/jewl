import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('owner app includes Google login and ledger views', () => {
  const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const needle of [
    '/auth/google',
    'data-view="suppliers"',
    'data-view="money"',
    'data-view="metal"',
    'data-view="settlements"',
    'api/me/export',
    'api/setup',
    'LOCAL DEVELOPMENT MODE',
    'docs.google.com/spreadsheets',
    'We owe them',
    'Metal with party'
  ]) assert.match(src, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
