import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seedCategories, categoriesForType, customerBalance, customerMetalNet, summarizeCustomers,
  buildCustomerPassbook, categoryTotals, salesPeriodTotals, validateSale, removeCustomerData, buildCustomerBalanceRows
} from '../pwa/customer-math.js';
import { emptyLedger, prepareSavePayload, withCustomerNames, HEADERS, recordsToAlignedRows } from '../pwa/sheet-model.js';
import { puritiesForType } from '../pwa/ledger-math.js';

const sales = [
  { id: 's1', customerId: 'c1', kind: 'SALE', category: 'Chain', metalType: 'GOLD', purity: '22K', weightGrams: 20, amountInr: 150000, paidInr: 100000, date: '2026-11-01', createdAt: '1' },
  { id: 's2', customerId: 'c1', kind: 'SALE', category: 'Ring', metalType: 'GOLD', purity: '22K', weightGrams: 5, amountInr: 40000, paidInr: 40000, date: '2026-11-03', createdAt: '2' },
  { id: 's3', customerId: 'c1', kind: 'RETURN', category: 'Ring', metalType: 'GOLD', purity: '22K', weightGrams: 5, amountInr: 38000, paidInr: 0, date: '2026-11-05', createdAt: '3' },
  { id: 's4', customerId: 'c2', kind: 'SALE', category: 'Payal', metalType: 'SILVER', purity: '925', weightGrams: 100, amountInr: 9000, paidInr: 9000, date: '2026-11-06', createdAt: '4' }
];

test('categories are seeded per metal and can be listed, hidden and extended', () => {
  const seeded = seedCategories([]);
  const gold = categoriesForType(seeded, 'gold');
  for (const name of ['Chain', 'Mangalsutra', 'Ring', 'Earrings']) assert.ok(gold.includes(name), name);
  assert.ok(categoriesForType(seeded, 'SILVER').includes('Payal'));
  assert.ok(categoriesForType(seeded, 'PLATINUM').includes('Band'));
  const hidden = seeded.map((row) => (row.metalType === 'GOLD' && row.category === 'Chain' ? { ...row, status: 'INACTIVE' } : row));
  assert.equal(categoriesForType(hidden, 'GOLD').includes('Chain'), false);
  const kept = seedCategories([{ id: 'x', metalType: 'GOLD', category: 'Kada' }]);
  assert.equal(kept.length, 1);
});

test('platinum is a known metal with its own purities', () => {
  assert.deepEqual(puritiesForType([], 'PLATINUM'), ['950', '900']);
});

test('customer balance: unpaid sale adds, return credits back', () => {
  assert.equal(customerBalance(sales, 'c1'), 50000 + 0 - 38000);
  assert.equal(customerBalance(sales, 'c2'), 0);
});

test('customer metal net subtracts returns', () => {
  assert.deepEqual(customerMetalNet(sales, 'c1'), { 'GOLD:22K': 20 });
  assert.deepEqual(customerMetalNet(sales, 'c2'), { 'SILVER:925': 100 });
});

test('customer summary totals who owes whom', () => {
  const sum = summarizeCustomers([{ id: 'c1', name: 'Anita' }, { id: 'c2', name: 'Bharat' }], sales);
  assert.equal(sum.customersOweInr, 12000);
  assert.equal(sum.weOweCustomersInr, 0);
  assert.equal(sum.byCustomer[0].lastDate, '2026-11-05');
});

test('passbook lists newest first with a running balance', () => {
  const lines = buildCustomerPassbook('c1', sales);
  assert.deepEqual(lines.map((l) => l.label), ['Returned', 'Sold', 'Sold']);
  assert.equal(lines[0].runningInr, 12000);
  assert.equal(lines.at(-1).runningInr, 50000);
  assert.match(lines[2].detail, /Chain · GOLD 22K · 20 g/);
});

test('category totals show sold, returned and net weight by item', () => {
  const rows = categoryTotals(sales, { from: '2026-11-01', to: '2026-11-30' });
  const ring = rows.find((r) => r.category === 'Ring');
  assert.equal(ring.soldGrams, 5);
  assert.equal(ring.returnedGrams, 5);
  assert.equal(ring.netGrams, 0);
  assert.equal(categoryTotals(sales, { from: '2026-12-01' }).length, 0);
  const t = salesPeriodTotals(sales, {});
  assert.equal(t.soldInr, 199000);
  assert.equal(t.returnedInr, 38000);
});

test('validateSale speaks plainly and defaults paid to the bill', () => {
  const ok = { customerId: 'c1', metalType: 'GOLD', purity: '22K', category: 'Ring', weightGrams: '4.5', amountInr: '30000', paidInr: '' };
  assert.deepEqual(validateSale(ok), { grams: 4.5, amount: 30000, paid: 30000 });
  assert.throws(() => validateSale({ ...ok, customerId: '' }), /customer/i);
  assert.throws(() => validateSale({ ...ok, category: '' }), /item/i);
  assert.throws(() => validateSale({ ...ok, weightGrams: '0' }), /weight/i);
  assert.throws(() => validateSale({ ...ok, paidInr: '40000' }), /more than the bill/i);
});

test('deleting a customer removes their sales only', () => {
  const next = removeCustomerData({ customers: [{ id: 'c1' }, { id: 'c2' }], sales }, 'c1');
  assert.deepEqual(next.customers.map((c) => c.id), ['c2']);
  assert.deepEqual(next.sales.map((s) => s.id), ['s4']);
});

test('save payload carries customers, named sales, categories and a customer khata', () => {
  const ledger = { ...emptyLedger(), customers: [{ id: 'c1', name: 'Anita', phone: '99' }], sales: [sales[0]] };
  const payload = prepareSavePayload(ledger);
  assert.equal(payload.customers.length, 1);
  assert.equal(payload.sales[0].customerName, 'Anita');
  assert.ok(payload.categories.length > 10);
  assert.equal(payload.customerKhata[0].balanceDirection, 'Unse lena');
  assert.equal(payload.customerKhata[0].balanceInr, 50000);
  assert.match(payload.customerKhata[0].metalSummary, /GOLD 22K 20 g/);
  assert.equal(withCustomerNames([{ customerId: 'c1' }], [{ id: 'c1', name: 'Anita' }])[0].customerName, 'Anita');
});

test('sales rows are written under their header, photo link included', () => {
  const row = recordsToAlignedRows(HEADERS.Sales, [{ id: 's1', photoId: 'f1', photoUrl: 'https://drive/f1', customerId: 'c1' }], HEADERS.Sales)[0];
  assert.equal(row[HEADERS.Sales.indexOf('photoId')], 'f1');
  assert.equal(row[HEADERS.Sales.indexOf('id')], 's1');
  assert.equal(buildCustomerBalanceRows([], []).length, 0);
});
