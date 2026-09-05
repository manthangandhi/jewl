import test from 'node:test';
import assert from 'node:assert/strict';
import { SheetsLedger } from '../src/sheets-ledger.js';

function memoryGoogle() {
  const sheets = new Map();
  const calls = [];
  let seq = 0;
  const fetchImpl = async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url: String(url), method, headers: options.headers || {}, body });
    if (method === 'DELETE') {
      return { ok: false, status: 403, json: async () => ({ error: { message: 'delete not allowed' } }) };
    }
    const parsed = new URL(url, 'https://sheets.googleapis.com');
    const path = parsed.pathname;

    if (method === 'POST' && path === '/v4/spreadsheets') {
      const id = `ss_${++seq}`;
      const tabs = {};
      for (const sheet of body.sheets || []) tabs[sheet.properties.title] = [];
      sheets.set(id, { title: body.properties?.title, tabs });
      return { ok: true, status: 200, json: async () => ({ spreadsheetId: id }) };
    }

    const match = path.match(/^\/v4\/spreadsheets\/([^/]+)(?:\/values\/(.+))?$/);
    if (!match) {
      return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
    }
    const spreadsheetId = decodeURIComponent(match[1]);
    const book = sheets.get(spreadsheetId);
    if (!book) {
      return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
    }
    if (!match[2]) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          spreadsheetId,
          properties: { title: book.title },
          sheets: Object.keys(book.tabs).map((title) => ({ properties: { title } }))
        })
      };
    }

    let range = decodeURIComponent(match[2]);
    const isAppend = range.endsWith(':append');
    if (isAppend) range = range.slice(0, -':append'.length);
    const title = range.split('!')[0];

    if (method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ values: book.tabs[title] || [] }) };
    }
    if (method === 'PUT') {
      book.tabs[title] = body.values || [];
      return { ok: true, status: 200, json: async () => ({ updatedRange: title }) };
    }
    if (method === 'POST' && isAppend) {
      book.tabs[title] = [...(book.tabs[title] || []), ...(body.values || [])];
      return { ok: true, status: 200, json: async () => ({ updates: {} }) };
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
  };
  return { fetchImpl, sheets, calls };
}

test('ensureSpreadsheet creates four data tabs plus _Meta', async () => {
  const { fetchImpl, sheets } = memoryGoogle();
  const ledger = new SheetsLedger({ fetchImpl, accessToken: 'tok' });
  const id = await ledger.ensureSpreadsheet({ businessName: 'Mehta Jewellers' });
  const book = [...sheets.values()][0];
  assert.equal(book.title, 'Karigar ledger — Mehta Jewellers');
  for (const tab of ['_Meta', 'Suppliers', 'Money', 'Metal', 'Settlements']) assert.ok(book.tabs[tab]);
  assert.equal(id, [...sheets.keys()][0]);
});

test('addSupplier and settlement round-trip through sheet rows', async () => {
  const { fetchImpl } = memoryGoogle();
  const ledger = new SheetsLedger({
    fetchImpl,
    accessToken: 'tok',
    spreadsheetId: await new SheetsLedger({ fetchImpl, accessToken: 'tok' }).ensureSpreadsheet({ businessName: 'Shop' })
  });
  const supplier = await ledger.addSupplier(null, {
    name: 'Karigar A', openingMoney: 200, openingMetal: [{ metalType: 'GOLD', purity: '22K', weightGrams: 3 }]
  });
  await ledger.add(null, 'settlements', {
    supplierId: supplier.id, moneyAmountInr: 50, metalType: 'GOLD', purity: '22K', metalGrams: 1, date: '2026-01-04'
  });
  const detail = await ledger.supplierLedger(null, supplier.id);
  assert.equal(detail.payable, 150);
  assert.equal(detail.metalByPurity['GOLD:22K'], 2);
  const csv = await ledger.exportCSV(null, 'suppliers');
  assert.match(csv, /Karigar A/);
});

test('missing spreadsheet on get is a recreate signal, not a delete', async () => {
  const { fetchImpl, sheets, calls } = memoryGoogle();
  const ledger = new SheetsLedger({ fetchImpl, accessToken: 'tok', spreadsheetId: 'gone' });
  await assert.rejects(() => ledger.list(null, 'suppliers'), /not found|missing spreadsheet/i);
  const id = await ledger.ensureSpreadsheet({ accessToken: 'tok', businessName: 'Shop', spreadsheetId: 'gone' });
  assert.ok(id);
  assert.notEqual(id, 'gone');
  assert.ok(sheets.has(id));
  assert.equal(calls.some((c) => c.method === 'DELETE'), false);
});
