import { randomUUID } from 'node:crypto';
import { payableInr, metalByPurity, assertPurity } from './ledger-math.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const LEDGER_KINDS = ['suppliers', 'money', 'metal', 'settlements'];
const SUPPLIER_UPDATE_FIELDS = ['name', 'phone', 'notes', 'status'];
const TAB_BY_KIND = {
  suppliers: 'Suppliers',
  money: 'Money',
  metal: 'Metal',
  settlements: 'Settlements'
};
const HEADERS = {
  _Meta: ['schemaVersion', 'createdAt'],
  Suppliers: ['id', 'name', 'phone', 'notes', 'status', 'createdAt'],
  Money: ['id', 'date', 'supplierId', 'type', 'amountInr', 'note', 'createdAt'],
  Metal: ['id', 'date', 'supplierId', 'direction', 'metalType', 'purity', 'weightGrams', 'note', 'createdAt'],
  Settlements: ['id', 'date', 'supplierId', 'moneyAmountInr', 'metalType', 'purity', 'metalGrams', 'note', 'createdAt']
};
const REQUIRED = {
  suppliers: ['id', 'name'],
  money: ['id', 'type', 'supplierId'],
  metal: ['id', 'direction', 'metalType', 'purity'],
  settlements: ['id']
};
const NUMERIC = {
  money: ['amountInr'],
  metal: ['weightGrams'],
  settlements: ['moneyAmountInr', 'metalGrams']
};

function objectToRow(headers, item) {
  return headers.map((column) => (item[column] == null ? '' : item[column]));
}

function valuesToObjects(values, kind) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const headers = values[0].map((h) => String(h));
  const required = REQUIRED[kind] || ['id'];
  const numeric = NUMERIC[kind] || [];
  const items = [];
  for (const row of values.slice(1)) {
    if (!Array.isArray(row)) continue;
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index] ?? '';
    });
    if (required.some((field) => item[field] === undefined || item[field] === '')) continue;
    for (const field of numeric) {
      if (item[field] === '' || item[field] == null) continue;
      item[field] = Number(item[field]);
    }
    items.push(item);
  }
  items.reverse();
  return items;
}

export class SheetsLedger {
  constructor({ fetchImpl, accessToken, spreadsheetId } = {}) {
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.accessToken = accessToken;
    this.spreadsheetId = spreadsheetId;
  }

  async request(method, url, body) {
    const headers = { Authorization: `Bearer ${this.accessToken}` };
    const options = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await this.fetchImpl(url, options);
    if (!response.ok) {
      if (response.status === 404) throw new Error('missing spreadsheet');
      let message = `sheets request failed: ${response.status}`;
      try {
        const payload = await response.json();
        message = payload?.error?.message || message;
      } catch {
        // keep status message
      }
      throw new Error(message);
    }
    return response.json();
  }

  valuesUrl(tab, { append = false } = {}) {
    const encoded = encodeURIComponent(tab);
    const suffix = append ? ':append' : '';
    return `${SHEETS_API}/${this.spreadsheetId}/values/${encoded}${suffix}?valueInputOption=RAW`;
  }

  async readValues(tab) {
    const encoded = encodeURIComponent(tab);
    const data = await this.request('GET', `${SHEETS_API}/${this.spreadsheetId}/values/${encoded}`);
    return data.values || [];
  }

  async appendRow(tab, row) {
    await this.request('POST', this.valuesUrl(tab, { append: true }), { values: [row] });
  }

  async writeTab(tab, values) {
    await this.request('PUT', this.valuesUrl(tab), { values });
  }

  async ensureSpreadsheet({ accessToken, businessName, spreadsheetId } = {}) {
    if (accessToken) this.accessToken = accessToken;
    const existingId = spreadsheetId ?? this.spreadsheetId;
    if (existingId) {
      try {
        await this.request('GET', `${SHEETS_API}/${existingId}`);
        this.spreadsheetId = existingId;
        return existingId;
      } catch (error) {
        if (!/not found|missing spreadsheet/i.test(error.message)) throw error;
      }
    }

    const created = await this.request('POST', SHEETS_API, {
      properties: { title: `Karigar ledger — ${businessName}` },
      sheets: Object.keys(HEADERS).map((title) => ({ properties: { title } }))
    });
    this.spreadsheetId = created.spreadsheetId;
    const createdAt = new Date().toISOString();
    await this.writeTab('_Meta', [HEADERS._Meta, ['1', createdAt]]);
    for (const tab of ['Suppliers', 'Money', 'Metal', 'Settlements']) {
      await this.writeTab(tab, [HEADERS[tab]]);
    }
    return this.spreadsheetId;
  }

  async list(tenantId, kind) {
    void tenantId;
    if (!LEDGER_KINDS.includes(kind)) throw new Error(`unknown ledger kind: ${kind}`);
    const values = await this.readValues(TAB_BY_KIND[kind]);
    return valuesToObjects(values, kind);
  }

  async add(tenantId, kind, value) {
    void tenantId;
    if (!LEDGER_KINDS.includes(kind)) throw new Error(`unknown ledger kind: ${kind}`);
    if (kind === 'metal') assertPurity(value.metalType, value.purity);
    if (kind === 'settlements' && Number(value.metalGrams || 0) > 0) assertPurity(value.metalType, value.purity);
    const item = { ...value, id: randomUUID(), createdAt: new Date().toISOString() };
    const tab = TAB_BY_KIND[kind];
    await this.appendRow(tab, objectToRow(HEADERS[tab], item));
    return structuredClone(item);
  }

  async addSupplier(tenantId, { name, phone = '', notes = '', openingMoney = 0, openingMetal = [] } = {}) {
    const supplier = await this.add(tenantId, 'suppliers', { name, phone, notes, status: 'ACTIVE' });
    if (Number(openingMoney) > 0) {
      await this.add(tenantId, 'money', {
        supplierId: supplier.id, type: 'OPENING', amountInr: Number(openingMoney), date: new Date().toISOString().slice(0, 10)
      });
    }
    for (const row of openingMetal) {
      if (Number(row.weightGrams) > 0) {
        await this.add(tenantId, 'metal', {
          supplierId: supplier.id, direction: 'OPENING', metalType: row.metalType, purity: row.purity,
          weightGrams: Number(row.weightGrams), date: new Date().toISOString().slice(0, 10)
        });
      }
    }
    const suppliers = await this.list(tenantId, 'suppliers');
    return suppliers.find((s) => s.id === supplier.id);
  }

  async update(tenantId, kind, id, value) {
    void tenantId;
    if (kind !== 'suppliers') throw new Error('money, metal, and settlements are append-only');
    const tab = TAB_BY_KIND[kind];
    const values = await this.readValues(tab);
    const headers = values[0] || HEADERS[tab];
    const rows = values.slice(1);
    const index = rows.findIndex((row) => String(row[headers.indexOf('id')] ?? '') === id);
    if (index < 0) throw new Error(`${kind} item not found`);
    const current = {};
    headers.forEach((header, i) => { current[header] = rows[index][i] ?? ''; });
    const patch = {};
    for (const field of SUPPLIER_UPDATE_FIELDS) {
      if (value[field] !== undefined) patch[field] = value[field];
    }
    const updated = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
    rows[index] = objectToRow(headers, updated);
    await this.writeTab(tab, [headers, ...rows]);
    return updated;
  }

  async exportCSV(tenantId, kind) {
    const items = await this.list(tenantId, kind);
    if (!items.length) return '';
    const columns = [...new Set(items.flatMap((item) => Object.keys(item)))];
    const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return [columns.join(','), ...items.map((item) => columns.map((column) => quote(item[column])).join(','))].join('\n');
  }

  async supplierLedger(tenantId, supplierId) {
    const money = await this.list(tenantId, 'money');
    const metal = await this.list(tenantId, 'metal');
    const settlements = await this.list(tenantId, 'settlements');
    const supplier = (await this.list(tenantId, 'suppliers')).find((s) => s.id === supplierId);
    return {
      supplier,
      payable: payableInr(money, settlements, supplierId),
      metalByPurity: metalByPurity(metal, settlements, supplierId),
      money: money.filter((r) => r.supplierId === supplierId),
      metal: metal.filter((r) => r.supplierId === supplierId),
      settlements: settlements.filter((r) => r.supplierId === supplierId)
    };
  }

  async summary(tenantId) {
    const suppliers = await this.list(tenantId, 'suppliers');
    const money = await this.list(tenantId, 'money');
    const metal = await this.list(tenantId, 'metal');
    const settlements = await this.list(tenantId, 'settlements');
    const outstanding = suppliers.reduce((sum, s) => sum + payableInr(money, settlements, s.id), 0);
    const totalPurchases = money.filter((r) => r.type === 'PURCHASE').reduce((sum, r) => sum + Number(r.amountInr || 0), 0);
    const totalPayments = money.filter((r) => r.type === 'PAYMENT').reduce((sum, r) => sum + Number(r.amountInr || 0), 0);
    const metalByPurityShop = {};
    for (const s of suppliers) {
      for (const [k, v] of Object.entries(metalByPurity(metal, settlements, s.id))) {
        metalByPurityShop[k] = (metalByPurityShop[k] || 0) + v;
      }
    }
    const nameById = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));
    const recentMoney = money.slice(0, 5).map((row) => ({ ...row, supplierName: nameById[row.supplierId] || '' }));
    return {
      supplierCount: suppliers.length,
      moneyCount: money.length,
      metalCount: metal.length,
      settlementCount: settlements.length,
      outstanding,
      totalPurchases,
      totalPayments,
      metalByPurity: metalByPurityShop,
      recentMoney
    };
  }
}
