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
