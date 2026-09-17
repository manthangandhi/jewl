import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEADERS,
  emptyLedger,
  upsertById,
  removeById,
  withSupplierNames,
  deleteSupplierCascade,
  buildBalancesRows,
  prepareSavePayload
} from '../pwa/sheet-model.js';

test('sheet tabs include a CA-readable Khata report with ids last', () => {
  assert.deepEqual(Object.keys(HEADERS), ['_Meta', 'Suppliers', 'Money', 'Metal', 'Settlements', 'Khata', 'MetalMaster']);
  assert.ok(HEADERS.Money.includes('supplierName'));
  assert.equal(HEADERS.Money[0], 'date');
  assert.equal(HEADERS.Money.at(-1), 'id');
  assert.equal(HEADERS.Khata[0], 'supplierName');
  assert.equal(HEADERS.Khata.at(-1), 'supplierId');
  assert.ok(HEADERS.Khata.includes('gold22k'));
  assert.ok(HEADERS.Khata.includes('moneyDirection'));
  assert.ok(HEADERS.MetalMaster.includes('rateInrPerGram'));
  assert.ok(HEADERS.MetalMaster.includes('purity'));
});

test('empty ledger seeds a metal master with gold and silver purities', async () => {
  const { seedMetalMaster, emptyLedger } = await import('../pwa/sheet-model.js');
  const seeded = seedMetalMaster([]);
  assert.ok(seeded.some((row) => row.metalType === 'GOLD' && row.purity === '22K'));
  assert.ok(seeded.some((row) => row.metalType === 'SILVER' && row.purity === '999'));
  assert.equal(emptyLedger().metalMaster.length, seeded.length);
  const kept = seedMetalMaster([{ id: 'x', metalType: 'GOLD', purity: '20K' }]);
  assert.equal(kept[0].purity, '20K');
});

test('upsertById inserts then overwrites the same id (edit)', () => {
  const first = upsertById([], { id: 's1', name: 'Mehta' });
  const edited = upsertById(first, { id: 's1', name: 'Mehta Jewellers', phone: '999' });
  assert.equal(edited.length, 1);
  assert.equal(edited[0].name, 'Mehta Jewellers');
  assert.equal(edited[0].phone, '999');
});

test('removeById deletes only that artefact', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(removeById(rows, 'b').map((r) => r.id), ['a', 'c']);
});

test('deleting a supplier also deletes that party journals', () => {
  const ledger = emptyLedger();
  ledger.suppliers = [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }];
  ledger.money = [{ id: 'm1', supplierId: 's1' }, { id: 'm2', supplierId: 's2' }];
  ledger.metal = [{ id: 't1', supplierId: 's1' }];
  ledger.settlements = [{ id: 'x1', supplierId: 's2' }];
  const next = deleteSupplierCascade(ledger, 's1');
  assert.deepEqual(next.suppliers.map((r) => r.id), ['s2']);
  assert.deepEqual(next.money.map((r) => r.id), ['m2']);
  assert.equal(next.metal.length, 0);
  assert.equal(next.settlements.length, 1);
});

test('prepareSavePayload writes supplier names and party balances for the sheet', () => {
  const ledger = emptyLedger();
  ledger.suppliers = [{ id: 's1', name: 'Kiran', status: 'ACTIVE' }];
  ledger.money = [
    { id: 'm1', supplierId: 's1', type: 'PURCHASE', amountInr: 10000 }
  ];
  ledger.metal = [
    { id: 't1', supplierId: 's1', direction: 'ISSUE', metalType: 'GOLD', purity: '22K', weightGrams: 8 }
  ];
  ledger.settlements = [];
  const payload = prepareSavePayload(ledger);
  assert.equal(payload.money[0].supplierName, 'Kiran');
  assert.equal(payload.metal[0].supplierName, 'Kiran');
  const row = payload.khata.find((r) => r.supplierId === 's1');
  assert.equal(row.moneyDirection, 'Hume dena');
  assert.equal(row.weOweInr, 10000);
  assert.equal(row.gold22k, 8);
  assert.equal(payload.meta.schemaVersion, '1');
});

test('mergeJournals keeps CA-added rows and local edits, drops local deletes', async () => {
  const { mergeJournals } = await import('../pwa/sheet-model.js');
  const remote = [
    { id: 'a', amountInr: 10 },
    { id: 'ca-new', amountInr: 3 },
    { id: 'b', amountInr: 99 }
  ];
  const local = [
    { id: 'a', amountInr: 12 },
    { id: 'mine', amountInr: 5 }
  ];
  const merged = mergeJournals(remote, local, { deletedIds: ['b'], dirtyIds: ['a'] });
  assert.deepEqual(merged.map((r) => r.id), ['a', 'ca-new', 'mine']);
  assert.equal(merged[0].amountInr, 12);
  assert.equal(merged.find((r) => r.id === 'ca-new').amountInr, 3);
});

test('withSupplierNames fills names without dropping the id', () => {
  const named = withSupplierNames(
    [{ id: 'm1', supplierId: 's1', amountInr: 1 }],
    [{ id: 's1', name: 'Ravi' }]
  );
  assert.equal(named[0].supplierId, 's1');
  assert.equal(named[0].supplierName, 'Ravi');
});
