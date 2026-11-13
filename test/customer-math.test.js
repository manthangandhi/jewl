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
  assert.deepEqual(lines.map((l) => l.label), ['Return', 'Sale', 'Sale']);
  assert.equal(lines[0].runningInr, 12000);
  assert.equal(lines.at(-1).runningInr, 50000);
  assert.match(lines[2].detail, /Chain, Gold 22K, 20 g/);
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
  assert.equal(payload.customerKhata[0].balanceDirection, 'Hume lena');
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

test('demo customers can be loaded and removed by id, without touching real customers', async () => {
  const fs = await import('node:fs');
  const gs = fs.readFileSync(new URL('../pwa/google-apps-script.gs', import.meta.url), 'utf8');
  assert.match(gs, /customers: \[\s*customer\("demo-c-anita"/);
  assert.match(gs, /sale\("demo-s-01", "demo-c-anita"/);
  assert.match(gs, /writeObjectsAsRows_\("Customers", customerRows\)/);
  assert.match(gs, /isDemoId_\(customerId\)/);
  assert.match(gs, /function buildCustomerKhataRows_/);
  const clearFn = gs.match(/function clearDemoLedger_\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(clearFn, /dropDemoRows_\(readRowsAsObjects_\("Customers"\)\)/);
  assert.match(clearFn, /dropDemoRows_\(readRowsAsObjects_\("Sales"\)\)/);

  const { stripDemoLedger, isDemoLedgerRow } = await import('../pwa/sheet-model.js');
  const ledger = {
    suppliers: [], money: [], metal: [], settlements: [], metalMaster: [],
    customers: [{ id: 'demo-c-anita', name: 'Anita Deshmukh' }, { id: 'c-real', name: 'Anita Shah' }],
    sales: [{ id: 'demo-s-01', customerId: 'demo-c-anita' }, { id: 's-real', customerId: 'c-real' }]
  };
  const clean = stripDemoLedger(ledger);
  assert.deepEqual(clean.customers.map((c) => c.id), ['c-real']);
  assert.deepEqual(clean.sales.map((s) => s.id), ['s-real']);
  assert.equal(isDemoLedgerRow({ customerId: 'demo-c-sunil' }), true);
});

import { EXCHANGE as EX, computeBill, billBreakupText, buildCustomerPassbook as pb, customerBalance as cb, customerMetalNet as cmn, validateSale as vs } from '../pwa/customer-math.js';

test('bill breakup adds up: metal + making + stone - discount, then GST', () => {
  const b = computeBill({ weightGrams: 10, ratePerGram: 7000, makingInr: 5000, stoneInr: 1000, discountInr: 1000, gstPct: 3 });
  assert.equal(b.metal, 70000);
  assert.equal(b.taxable, 75000);
  assert.equal(b.gst, 2250);
  assert.equal(b.total, 77250);
  assert.equal(computeBill({}).total, 0);
  assert.match(billBreakupText({ ratePerGram: 7000, makingInr: 5000, gstInr: 2250 }), /rate ₹7,000\/g, making ₹5,000, GST ₹2,250/);
  assert.equal(billBreakupText({}), '');
});

test('old gold handed in is credit in rupees and metal, and is not a sale', () => {
  const rows = [
    { id: 's1', customerId: 'c1', kind: 'SALE', metalType: 'GOLD', purity: '22K', weightGrams: 20, amountInr: 140000, paidInr: 40000, date: '2026-11-01' },
    { id: 'e1', customerId: 'c1', kind: EX, metalType: 'GOLD', purity: '22K', weightGrams: 8, amountInr: 50000, paidInr: 0, date: '2026-11-01', huid: 'AB12CD' }
  ];
  assert.equal(cb(rows, 'c1'), 50000);
  assert.deepEqual(cmn(rows, 'c1'), { 'GOLD:22K': 12 });
  const line = pb('c1', rows).find((l) => l.id === 'e1');
  assert.equal(line.kind, 'exchange');
  assert.equal(line.label, 'Old gold');
  assert.deepEqual(vs({ customerId: 'c1', kind: EX, metalType: 'GOLD', purity: '22K', category: 'Other', weightGrams: 8, amountInr: 50000 }), { grams: 8, amount: 50000, paid: 0 });
});
