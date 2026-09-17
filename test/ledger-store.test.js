import test from 'node:test';
import assert from 'node:assert/strict';
import { LedgerStore } from '../src/ledger-store.js';

test('creating a supplier writes opening money and metal rows', () => {
  const ledger = new LedgerStore();
  const supplier = ledger.addSupplier('t1', {
    name: 'Mehta',
    phone: '999',
    openingMoney: 1000,
    openingMetal: [{ metalType: 'GOLD', purity: '22K', weightGrams: 4 }]
  });
  assert.equal(supplier.name, 'Mehta');
  assert.equal(ledger.list('t1', 'money')[0].type, 'OPENING');
  assert.equal(ledger.list('t1', 'metal')[0].direction, 'OPENING');
  const summary = ledger.summary('t1');
  assert.equal(summary.outstanding, 1000);
  assert.equal(summary.metalByPurity['GOLD:22K'], 4);
  const detail = ledger.supplierLedger('t1', supplier.id);
  assert.equal(detail.payable, 1000);
});

test('journals are append-only except supplier edits', () => {
  const ledger = new LedgerStore();
  const supplier = ledger.addSupplier('t1', { name: 'A' });
  ledger.add('t1', 'money', { supplierId: supplier.id, type: 'PURCHASE', amountInr: 50, date: '2026-01-02' });
  assert.throws(() => ledger.update('t1', 'money', 'x', {}), /append-only/);
  const updated = ledger.update('t1', 'suppliers', supplier.id, { phone: '1', notes: 'k' });
  assert.equal(updated.phone, '1');
});

test('settlement reduces payable and metal', () => {
  const ledger = new LedgerStore();
  const supplier = ledger.addSupplier('t1', {
    name: 'A', openingMoney: 100, openingMetal: [{ metalType: 'GOLD', purity: '22K', weightGrams: 10 }]
  });
  ledger.add('t1', 'settlements', {
    supplierId: supplier.id, moneyAmountInr: 40, metalType: 'GOLD', purity: '22K', metalGrams: 2, date: '2026-01-03'
  });
  const detail = ledger.supplierLedger('t1', supplier.id);
  assert.equal(detail.payable, 60);
  assert.equal(detail.metalByPurity['GOLD:22K'], 8);
});

test('exportCSV includes money rows', () => {
  const ledger = new LedgerStore();
  const supplier = ledger.addSupplier('t1', { name: 'A', openingMoney: 10 });
  const csv = ledger.exportCSV('t1', 'money');
  assert.match(csv, /amountInr/);
  assert.match(csv, /OPENING/);
  assert.ok(csv.includes(supplier.id));
});

test('add ignores caller-provided ids and update cannot change supplier id', () => {
  const ledger = new LedgerStore();
  const money = ledger.add('t1', 'money', { id: 'forged', type: 'PURCHASE', amountInr: 1, date: '2026-01-02' });
  assert.notEqual(money.id, 'forged');
  assert.ok(money.id);
  const supplier = ledger.addSupplier('t1', { name: 'A' });
  const updated = ledger.update('t1', 'suppliers', supplier.id, { id: 'hijacked', name: 'B', extra: 'drop' });
  assert.equal(updated.id, supplier.id);
  assert.equal(updated.name, 'B');
  assert.equal(updated.extra, undefined);
  assert.equal(ledger.list('t1', 'suppliers')[0].id, supplier.id);
});

test('invalid metal and settlement purity throws', () => {
  const ledger = new LedgerStore();
  const supplier = ledger.addSupplier('t1', { name: 'A' });
  assert.throws(
    () => ledger.add('t1', 'metal', { supplierId: supplier.id, direction: 'ISSUE', metalType: 'GOLD', purity: '925', weightGrams: 1 }),
    /purity/
  );
  assert.throws(
    () => ledger.add('t1', 'settlements', { supplierId: supplier.id, moneyAmountInr: 1, metalType: 'GOLD', metalGrams: 1 }),
    /purity/
  );
});

test('update on metal and settlements is append-only', () => {
  const ledger = new LedgerStore();
  assert.throws(() => ledger.update('t1', 'metal', 'x', {}), /append-only/);
  assert.throws(() => ledger.update('t1', 'settlements', 'x', {}), /append-only/);
});

test('add rejects unknown journal kinds', () => {
  const ledger = new LedgerStore();
  assert.throws(() => ledger.add('t1', 'transactions', { amount: 1 }), /kind/);
});

test('summary lists party-wise payable and metal with the party', () => {
  const ledger = new LedgerStore();
  const a = ledger.addSupplier('t1', {
    name: 'Karigar A',
    openingMoney: 100,
    openingMetal: [{ metalType: 'GOLD', purity: '22K', weightGrams: 10 }]
  });
  const b = ledger.addSupplier('t1', { name: 'Mehta', openingMoney: 50 });
  ledger.add('t1', 'money', { supplierId: b.id, type: 'PAYMENT', amountInr: 80, date: '2026-01-04' });
  const summary = ledger.summary('t1');
  const rowA = summary.bySupplier.find((row) => row.id === a.id);
  const rowB = summary.bySupplier.find((row) => row.id === b.id);
  assert.equal(rowA.payable, 100);
  assert.equal(rowA.metalByPurity['GOLD:22K'], 10);
  assert.equal(rowB.payable, -30);
  assert.equal(summary.weOweInr, 100);
  assert.equal(summary.theyOweInr, 30);
});

