import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPassbook, rangeForPreset, reportForRange } from '../pwa/ledger-math.js';

test('passbook is newest-first with running money after each line', () => {
  const lines = buildPassbook({
    supplierId: 's1',
    money: [
      { id: 'm1', supplierId: 's1', type: 'PURCHASE', amountInr: 10000, date: '2026-01-01', createdAt: '2026-01-01T10:00:00Z' },
      { id: 'm2', supplierId: 's1', type: 'PAYMENT', amountInr: 4000, date: '2026-01-03', createdAt: '2026-01-03T10:00:00Z' }
    ],
    metal: [
      { id: 't1', supplierId: 's1', direction: 'ISSUE', metalType: 'GOLD', purity: '22K', weightGrams: 8, date: '2026-01-02', createdAt: '2026-01-02T10:00:00Z' }
    ],
    settlements: []
  });
  assert.equal(lines[0].id, 'm2');
  assert.equal(lines[0].kind, 'money');
  assert.equal(lines[0].runningInr, 6000);
  assert.equal(lines[1].kind, 'metal');
  assert.equal(lines[1].label, 'Metal diya');
  assert.equal(lines[2].runningInr, 10000);
});

test('rangeForPreset today, 7d, month and all', () => {
  const now = new Date(2026, 8, 15, 12, 0, 0);
  assert.deepEqual(rangeForPreset('today', now), { from: '2026-09-15', to: '2026-09-15' });
  assert.deepEqual(rangeForPreset('7d', now), { from: '2026-09-09', to: '2026-09-15' });
  assert.deepEqual(rangeForPreset('month', now), { from: '2026-09-01', to: '2026-09-15' });
  assert.deepEqual(rangeForPreset('all', now), { from: '', to: '' });
});

test('reportForRange sums purchases, payments and metal only inside the dates', () => {
  const report = reportForRange({
    suppliers: [{ id: 's1', name: 'Ramesh' }, { id: 's2', name: 'Imran' }],
    money: [
      { id: 'm1', supplierId: 's1', type: 'PURCHASE', amountInr: 10000, date: '2026-09-10' },
      { id: 'm2', supplierId: 's1', type: 'PAYMENT', amountInr: 3000, date: '2026-09-12' },
      { id: 'm3', supplierId: 's2', type: 'PURCHASE', amountInr: 8000, date: '2026-08-01' }
    ],
    metal: [
      { id: 't1', supplierId: 's1', direction: 'ISSUE', weightGrams: 5, date: '2026-09-11' },
      { id: 't2', supplierId: 's1', direction: 'RECEIPT', weightGrams: 2, date: '2026-09-14' }
    ],
    settlements: [
      { id: 'c1', supplierId: 's1', moneyAmountInr: 1000, date: '2026-09-13' }
    ],
    from: '2026-09-01',
    to: '2026-09-30'
  });
  assert.equal(report.purchases, 10000);
  assert.equal(report.payments, 3000);
  assert.equal(report.metalOut, 5);
  assert.equal(report.metalIn, 2);
  assert.equal(report.settled, 1000);
  assert.equal(report.byParty.length, 1);
  assert.equal(report.byParty[0].name, 'Ramesh');
  assert.equal(report.lines.length, 5);
});

test('puritiesForType reads from the metal master', async () => {
  const { puritiesForType } = await import('../pwa/ledger-math.js');
  const master = [
    { metalType: 'GOLD', purity: '22K', status: 'ACTIVE' },
    { metalType: 'GOLD', purity: '20K', status: 'ACTIVE' },
    { metalType: 'GOLD', purity: '18K', status: 'INACTIVE' },
    { metalType: 'SILVER', purity: '999', status: 'ACTIVE' }
  ];
  assert.deepEqual(puritiesForType(master, 'GOLD'), ['22K', '20K']);
  assert.deepEqual(puritiesForType(master, 'SILVER'), ['999']);
});
