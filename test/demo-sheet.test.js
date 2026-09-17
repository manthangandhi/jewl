import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const pwa = path.join(process.cwd(), 'pwa');
const gs = fs.readFileSync(path.join(pwa, 'google-apps-script.gs'), 'utf8');
const app = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
const model = fs.readFileSync(path.join(pwa, 'sheet-model.js'), 'utf8');

test('sample khata lives in the bound Sheet script, not in the PWA', () => {
  assert.match(gs, /function demoLedger_/);
  assert.match(gs, /Ramesh Karigar/);
  assert.match(gs, /Suresh Jewels/);
  assert.match(gs, /action === "seedDemo"/);
  assert.match(gs, /action === "clearDemo"/);
  assert.match(gs, /function clearDemoLedger_/);
  assert.match(gs, /"Opening — old jobwork", 88\)/);
  assert.match(gs, /"Part settle \+ 20g", 1\)/);
  assert.doesNotMatch(model, /function buildDemoLedger/);
  assert.doesNotMatch(model, /Ramesh Karigar/);
  assert.doesNotMatch(app, /buildDemoLedger/);
  assert.doesNotMatch(app, /replaceDemoLedger/);
  assert.doesNotMatch(app, /Ramesh Karigar/);
  assert.match(app, /action:\s*['"]seedDemo['"]/);
  assert.match(app, /action:\s*['"]clearDemo['"]/);
});

test('Sheet seed replaces demo- ids and keeps live parties and shop name', () => {
  assert.match(gs, /function dropDemoRows_/);
  assert.match(gs, /indexOf\("demo-"\) === 0/);
  assert.match(gs, /live\.concat\(demo\.suppliers\)/);
  assert.match(gs, /shopName \|\| demo\.shopName/);
  assert.doesNotMatch(gs, /function initLedger\(\)[\s\S]{0,400}seedDemoLedger_/);
});

test('demo seed writes into the named header column, even if the live Sheet has id first', async () => {
  const { HEADERS, recordsToAlignedRows } = await import('../pwa/sheet-model.js');
  const idFirst = ['id', 'name', 'phone', 'city', 'notes', 'status', 'createdAt', 'updatedAt'];
  const record = {
    id: 'demo-ramesh',
    name: 'Ramesh Karigar',
    phone: '98200 11122',
    city: 'Mumbai',
    notes: '22K jobwork',
    status: 'ACTIVE',
    createdAt: '2026-06-20 10:00:00',
    updatedAt: '2026-06-20 10:00:00'
  };
  const row = recordsToAlignedRows(idFirst, [record], HEADERS.Suppliers)[0];
  assert.equal(row[idFirst.indexOf('id')], 'demo-ramesh');
  assert.equal(row[idFirst.indexOf('name')], 'Ramesh Karigar');
  assert.equal(row[idFirst.indexOf('phone')], '98200 11122');
  assert.equal(row[idFirst.indexOf('city')], 'Mumbai');
  assert.equal(row[idFirst.indexOf('notes')], '22K jobwork');
  assert.notEqual(row[0], 'Ramesh Karigar');
});

test('Apps Script seed writes by header name and fills the Khata tab', () => {
  assert.match(gs, /function recordsToAlignedRows_/);
  assert.match(gs, /function writeObjectsAsRows_/);
  assert.match(gs, /recordsToAlignedRows_\(headerRow, records, headers\)/);
  assert.match(gs, /writeObjectsAsRows_\("Khata"/);
  assert.match(gs, /function buildKhataRows_/);
  assert.doesNotMatch(gs, /sheet\.getRange\(2, 1, rows\.length, headers\.length\)\.setValues\(rows\)/);
});

test('demo parties in the Sheet script are named people, not mobile numbers', () => {
  const expected = [
    'Ramesh Karigar',
    'Suresh Jewels',
    'Mehta Silver House',
    'Fatima Polishing Works',
    'Gupta Casting Co',
    'Kiran Chain Maker'
  ];
  for (const name of expected) assert.match(gs, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(gs, /party\("demo-ramesh", "Ramesh Karigar", "98200 11122"/);
  assert.match(gs, /supplierName: names\[supplierId\]/);
});
