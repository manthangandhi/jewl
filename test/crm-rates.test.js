import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  whatsappNumber, whatsappLink, telLink, mailLink, duesReminderText, daysUntil, dueFollowUps, upcomingDates, notesFor, whenLabel
} from '../pwa/crm.js';
import {
  purityFactor, ratePerGram, liveRate, effectiveRate, suggestedAmount, ratesAreStale, describeAge, fetchLiveRates, GRAMS_PER_TROY_OUNCE
} from '../pwa/rates.js';
import { LABEL, balanceName } from '../pwa/labels.js';
import { customerBalance, buildCustomerPassbook, salesPeriodTotals, categoryTotals, validatePayment } from '../pwa/customer-math.js';

test('phone numbers become WhatsApp and call links', () => {
  assert.equal(whatsappNumber('98230 11001'), '919823011001');
  assert.equal(whatsappNumber('098230 11001'), '919823011001');
  assert.equal(whatsappNumber('+91 98230 11001'), '919823011001');
  assert.equal(whatsappNumber('12345'), '');
  assert.equal(whatsappLink('9823011001', 'Hi there'), 'https://wa.me/919823011001?text=Hi%20there');
  assert.equal(whatsappLink('', 'x'), '');
  assert.equal(telLink('9823011001'), 'tel:+919823011001');
  assert.equal(mailLink('a@b.co'), 'mailto:a@b.co');
  assert.equal(mailLink('not an email'), '');
  assert.match(duesReminderText({ shopName: 'Mehta Jewellers', name: 'Anita', amountInr: 18000 }), /Anita.*Mehta Jewellers.*₹18,000/);
});

test('follow-ups come overdue first, and only those within the window', () => {
  const parties = [
    { id: 'a', followUpDate: '2026-11-10' }, { id: 'b', followUpDate: '2026-11-13' },
    { id: 'c', followUpDate: '2026-11-16' }, { id: 'd', followUpDate: '2026-11-30' }, { id: 'e' }
  ];
  const due = dueFollowUps(parties, '2026-11-13', 3);
  assert.deepEqual(due.map((x) => x.party.id), ['a', 'b', 'c']);
  assert.equal(daysUntil('2026-11-10', '2026-11-13'), -3);
  assert.equal(whenLabel(-3), '3 days overdue');
  assert.equal(whenLabel(0), 'Today');
  assert.equal(whenLabel(1), 'Tomorrow');
  assert.equal(whenLabel(5), 'In 5 days');
});

test('birthdays and anniversaries ignore the year and wrap over New Year', () => {
  const customers = [
    { id: 'a', birthday: '1985-11-16' }, { id: 'b', anniversary: '2001-12-30' },
    { id: 'c', birthday: '1990-11-20' }, { id: 'd', birthday: '1990-01-02' }
  ];
  const soon = upcomingDates(customers, '2026-11-13', 7);
  assert.deepEqual(soon.map((x) => [x.customer.id, x.days]), [['a', 3], ['c', 7]]);
  const newYear = upcomingDates(customers, '2026-12-28', 7);
  assert.deepEqual(newYear.map((x) => [x.customer.id, x.days]), [['b', 2], ['d', 5]]);
});

test('notes are listed newest first for one person', () => {
  const list = notesFor([{ id: '1', partyId: 'p', date: '2026-01-01' }, { id: '2', partyId: 'p', date: '2026-02-01' }, { id: '3', partyId: 'q', date: '2026-03-01' }], 'p');
  assert.deepEqual(list.map((n) => n.id), ['2', '1']);
});

test('purity factors cover karats, fineness and known metals', () => {
  assert.equal(purityFactor('GOLD', '24K'), 1);
  assert.ok(Math.abs(purityFactor('GOLD', '22K') - 22 / 24) < 1e-9);
  assert.equal(purityFactor('SILVER', '925'), 0.925);
  assert.equal(purityFactor('PLATINUM', '950'), 0.95);
  assert.ok(Math.abs(purityFactor('GOLD', '20K') - 20 / 24) < 1e-9);
  assert.equal(purityFactor('GOLD', 'nonsense'), 0);
});

test('rupees per gram come from the ounce price, the dollar rate, purity and the shop adjustment', () => {
  const pure = Math.round((3100 * 90) / GRAMS_PER_TROY_OUNCE);
  assert.equal(ratePerGram({ spotUsdPerOunce: 3100, usdInr: 90, metalType: 'GOLD', purity: '24K' }), pure);
  assert.equal(ratePerGram({ spotUsdPerOunce: 3100, usdInr: 90, metalType: 'GOLD', purity: '24K', premiumPct: 6 }), Math.round(((3100 * 90) / GRAMS_PER_TROY_OUNCE) * 1.06));
  assert.equal(ratePerGram({ spotUsdPerOunce: 0, usdInr: 90, metalType: 'GOLD', purity: '24K' }), 0);
  const snapshot = { gold: 3100, silver: 40, platinum: 1500, usdInr: 90 };
  assert.ok(liveRate(snapshot, 'SILVER', '999') > 0);
  assert.equal(liveRate(null, 'GOLD', '22K'), 0);
});

test('a board rate typed by the owner beats the live rate', () => {
  const snapshot = { gold: 3100, silver: 40, platinum: 1500, usdInr: 90 };
  const master = [{ metalType: 'GOLD', purity: '22K', rateInrPerGram: 7000, status: 'ACTIVE' }, { metalType: 'GOLD', purity: '18K', rateInrPerGram: '', status: 'ACTIVE' }];
  assert.deepEqual(effectiveRate({ master, snapshot }, 'GOLD', '22K'), { perGram: 7000, source: 'board' });
  const live = effectiveRate({ master, snapshot }, 'GOLD', '18K');
  assert.equal(live.source, 'live');
  assert.ok(live.perGram > 0);
  assert.deepEqual(effectiveRate({ master, snapshot: null }, 'GOLD', '18K'), { perGram: 0, source: 'none' });
  assert.equal(suggestedAmount(10, 7000), 70000);
  assert.equal(suggestedAmount('', 7000), 0);
});

test('rates go stale after ten minutes and say how old they are', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');
  assert.equal(ratesAreStale(now - 5 * 60000, now), false);
  assert.equal(ratesAreStale(now - 11 * 60000, now), true);
  assert.equal(ratesAreStale(undefined, now), true);
  assert.equal(describeAge(now - 30 * 1000, now), 'just now');
  assert.equal(describeAge(now - 12 * 60000, now), '12 min ago');
  assert.equal(describeAge(now - 3 * 3600000, now), '3 h ago');
});

test('fetchLiveRates reads the four feeds and refuses nonsense', async () => {
  const feeds = {
    'https://api.gold-api.com/price/XAU': { price: 3900, updatedAt: 't' },
    'https://api.gold-api.com/price/XAG': { price: 50 },
    'https://api.gold-api.com/price/XPT': { price: 1500 },
    'https://open.er-api.com/v6/latest/USD': { rates: { INR: 90 } }
  };
  const ok = async (url) => ({ ok: true, json: async () => feeds[url] });
  const snap = await fetchLiveRates(ok, 123);
  assert.deepEqual([snap.gold, snap.silver, snap.platinum, snap.usdInr, snap.fetchedAt], [3900, 50, 1500, 90, 123]);
  const bad = async (url) => ({ ok: true, json: async () => (url.includes('er-api') ? { rates: {} } : feeds[url]) });
  await assert.rejects(() => fetchLiveRates(bad), /makes no sense/);
  const down = async () => ({ ok: false, status: 503 });
  await assert.rejects(() => fetchLiveRates(down), /503/);
});

test('one vocabulary: the same words for money owed and for each kind of entry', () => {
  assert.equal(LABEL.weGive, 'Hume dena');
  assert.equal(LABEL.weGet, 'Hume lena');
  assert.equal(balanceName(5), 'Hume lena');
  assert.equal(balanceName(-5), 'Hume dena');
  assert.equal(balanceName(0), 'Square');
  for (const file of fs.readdirSync(new URL('../pwa/', import.meta.url))) {
    if (!/\.(js|gs)$/.test(file) || file === 'karigar-licenses.gs') continue;
    const text = fs.readFileSync(new URL(`../pwa/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /Unse lena/, file);
    assert.doesNotMatch(text, /Metal diya|Metal aaya/, file);
  }
});

test('a customer payment lowers the balance and is not counted as a sale', () => {
  const rows = [
    { id: '1', customerId: 'c', kind: 'SALE', amountInr: 1000, paidInr: 200, weightGrams: 2, metalType: 'GOLD', purity: '22K', category: 'Ring', date: '2026-01-01', createdAt: '1' },
    { id: '2', customerId: 'c', kind: 'PAYMENT', amountInr: 300, date: '2026-01-02', createdAt: '2' }
  ];
  assert.equal(customerBalance(rows, 'c'), 500);
  const lines = buildCustomerPassbook('c', rows);
  assert.deepEqual(lines.map((l) => [l.label, l.runningInr]), [['Payment', 500], ['Sale', 800]]);
  const totals = salesPeriodTotals(rows, {});
  assert.deepEqual([totals.soldInr, totals.returnedInr, totals.receivedInr], [1000, 0, 300]);
  assert.equal(categoryTotals(rows, {}).length, 1);
  assert.deepEqual(validatePayment({ customerId: 'c', amountInr: '250' }), { amount: 250 });
  assert.throws(() => validatePayment({ customerId: 'c', amountInr: '0' }), /amount/i);
});

test('the Sheet script stores interactions and the new contact columns', () => {
  const gs = fs.readFileSync(new URL('../pwa/google-apps-script.gs', import.meta.url), 'utf8');
  assert.match(gs, /Interactions: \["date", "partyType"/);
  assert.match(gs, /interactions: readRowsAsObjects_\("Interactions"\)/);
  assert.match(gs, /Array\.isArray\(body\.interactions\)/);
  for (const col of ['"email"', '"gstin"', '"birthday"', '"anniversary"', '"followUpDate"', '"followUpNote"']) assert.ok(gs.includes(col), col);
  assert.match(gs, /demo-i-1/);
  assert.match(gs, /row\.kind === "PAYMENT"/);
});
