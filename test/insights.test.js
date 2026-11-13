import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyTrend, salesMix, topCustomers, duesAgeing, quietCustomers, changePct } from '../pwa/insights.js';
import { effectiveRate, boardRateIsToday } from '../pwa/rates.js';
import { normalizeVerdict, datesExpired, daysLeft } from '../pwa/license.js';

const now = new Date(2026, 10, 13);
const sales = [
  { customerId: 'a', kind: 'SALE', date: '2026-11-02', amountInr: 100000, paidInr: 60000, metalType: 'GOLD' },
  { customerId: 'a', kind: 'RETURN', date: '2026-11-05', amountInr: 10000, paidInr: 0, metalType: 'GOLD' },
  { customerId: 'b', kind: 'SALE', date: '2026-10-10', amountInr: 50000, paidInr: 50000, metalType: 'SILVER' },
  { customerId: 'b', kind: 'PAYMENT', date: '2026-11-08', amountInr: 5000 }
];
const customers = [{ id: 'a', name: 'Anita' }, { id: 'b', name: 'Bhavin' }];

test('monthly trend splits sales, returns and collections', () => {
  const m = monthlyTrend({ sales, money: [{ type: 'PAYMENT', date: '2026-11-09', amountInr: 7000 }] }, now, 3);
  assert.deepEqual(m.map((x) => x.key), ['2026-09', '2026-10', '2026-11']);
  const nov = m[2];
  assert.equal(nov.sold, 100000); assert.equal(nov.returned, 10000);
  assert.equal(nov.collected, 65000); assert.equal(nov.paidOut, 7000);
  assert.equal(m[1].sold, 50000);
});

test('mix, best customers, ageing, quiet customers', () => {
  assert.deepEqual(salesMix(sales).map((x) => [x.metalType, x.pct]), [['GOLD', 67], ['SILVER', 33]]);
  assert.equal(topCustomers(customers, sales)[0].name, 'Anita');
  assert.equal(topCustomers(customers, sales)[0].netInr, 90000);
  const age = duesAgeing(customers, sales, now);
  assert.equal(age[0].count, 1);
  assert.equal(age[0].amountInr, 30000);
  assert.equal(age[3].amountInr, 0);
  assert.equal(quietCustomers(customers, sales, { days: 20, now })[0].name, 'Bhavin');
  assert.equal(changePct(150, 100), 50);
  assert.equal(changePct(1, 0), null);
});

test('a board rate typed on an earlier day does not hide the live price', () => {
  const snapshot = { gold: 4000, silver: 30, platinum: 1000, usdInr: 90, fetchedAt: Date.now() };
  const today = new Date().toISOString();
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  const row = (updatedAt) => [{ metalType: 'GOLD', purity: '24K', rateInrPerGram: 7800, status: 'ACTIVE', updatedAt }];
  assert.equal(effectiveRate({ master: row(today), snapshot }, 'GOLD', '24K').source, 'board');
  assert.equal(effectiveRate({ master: row(old), snapshot }, 'GOLD', '24K').source, 'live');
  assert.equal(boardRateIsToday({}), false);
  assert.equal(boardRateIsToday({ updatedAt: 'garbage' }), false);
  assert.equal(boardRateIsToday({ updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) }), true);
});

test('license: the trial end date counts even when the status says ACTIVE', () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  const future = new Date(Date.now() + 5 * 86400000).toISOString();
  assert.equal(normalizeVerdict({ ok: true, allowed: true, status: 'ACTIVE', trialEndsAt: past, paidUntil: '' }).allowed, false);
  assert.equal(normalizeVerdict({ ok: true, allowed: true, status: 'ACTIVE', trialEndsAt: past, paidUntil: future }).allowed, true);
  assert.equal(normalizeVerdict({ ok: true, allowed: true, status: 'TRIAL', trialEndsAt: past }).allowed, false);
  assert.equal(normalizeVerdict({ ok: true, allowed: true, status: 'TRIAL', trialEndsAt: future }).allowed, true);
  assert.equal(normalizeVerdict({ ok: true, allowed: true, status: 'ACTIVE' }).allowed, true);
  assert.equal(datesExpired({ status: 'TRIAL', trialEndsAt: '01/01/2020' }), true);
  assert.equal(datesExpired({ status: 'ACTIVE', paidUntil: 'garbage' }), true);
  assert.ok(daysLeft({ status: 'ACTIVE', paidUntil: '', trialEndsAt: future }) >= 4);
});
