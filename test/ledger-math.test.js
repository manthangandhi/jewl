import test from 'node:test';
import assert from 'node:assert/strict';
import { payableInr, metalByPurity, assertPurity } from '../src/ledger-math.js';

const supplierId = 's1';
const money = [
  { supplierId, type: 'OPENING', amountInr: 1000 },
  { supplierId, type: 'PURCHASE', amountInr: 5000 },
  { supplierId, type: 'PAYMENT', amountInr: 2000 },
  { supplierId: 'other', type: 'PURCHASE', amountInr: 999 }
];
const metal = [
  { supplierId, direction: 'OPENING', metalType: 'GOLD', purity: '22K', weightGrams: 10 },
  { supplierId, direction: 'ISSUE', metalType: 'GOLD', purity: '22K', weightGrams: 5 },
  { supplierId, direction: 'RECEIPT', metalType: 'GOLD', purity: '22K', weightGrams: 3 },
  { supplierId, direction: 'ISSUE', metalType: 'GOLD', purity: '18K', weightGrams: 2 }
];
const settlements = [
  { supplierId, moneyAmountInr: 500, metalType: 'GOLD', purity: '22K', metalGrams: 1 }
];

test('payable is opening + purchases - payments - settlement cash', () => {
  assert.equal(payableInr(money, settlements, supplierId), 3500);
});

test('metal stays separate by type and purity', () => {
  assert.deepEqual(metalByPurity(metal, settlements, supplierId), {
    'GOLD:22K': 11,
    'GOLD:18K': 2
  });
});

test('rejects gold purity on silver and unknown purity', () => {
  assert.throws(() => assertPurity('GOLD', '925'), /purity/);
  assert.throws(() => assertPurity('SILVER', '22K'), /purity/);
  assert.doesNotThrow(() => assertPurity('GOLD', '22K'));
  assert.doesNotThrow(() => assertPurity('SILVER', '999'));
});
