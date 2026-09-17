import { summarizeLedger, isoDate } from './ledger-math.js';

export const SCHEMA_VERSION = '1';

export const HEADERS = {
  _Meta: ['key', 'value'],
  Suppliers: ['name', 'phone', 'city', 'notes', 'status', 'createdAt', 'updatedAt', 'id'],
  Money: ['date', 'supplierName', 'type', 'amountInr', 'note', 'createdAt', 'updatedAt', 'supplierId', 'id'],
  Metal: ['date', 'supplierName', 'direction', 'metalType', 'purity', 'weightGrams', 'note', 'createdAt', 'updatedAt', 'supplierId', 'id'],
  Settlements: ['date', 'supplierName', 'moneyAmountInr', 'metalType', 'purity', 'metalGrams', 'note', 'createdAt', 'updatedAt', 'supplierId', 'id'],
  Khata: ['supplierName', 'status', 'moneyDirection', 'moneyInr', 'gold24k', 'gold22k', 'gold18k', 'gold14k', 'silver999', 'silver925', 'weOweInr', 'theyOweInr', 'updatedAt', 'supplierId'],
  MetalMaster: ['metalType', 'purity', 'rateInrPerGram', 'status', 'createdAt', 'updatedAt', 'id']
};

export function seedMetalMaster(rows) {
  if (Array.isArray(rows) && rows.length) return rows;
  const now = new Date().toISOString();
  const defaults = [
    ['GOLD', '24K'], ['GOLD', '22K'], ['GOLD', '18K'], ['GOLD', '14K'],
    ['SILVER', '999'], ['SILVER', '925']
  ];
  return defaults.map(([metalType, purity]) => ({
    id: `mm-${metalType.toLowerCase()}-${purity.toLowerCase()}`,
    metalType,
    purity,
    rateInrPerGram: '',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now
  }));
}

export function emptyLedger() {
  return {
    meta: { shopName: '', schemaVersion: SCHEMA_VERSION },
    suppliers: [],
    money: [],
    metal: [],
    settlements: [],
    metalMaster: seedMetalMaster([])
  };
}

function demoDay(asOf, daysAgo) {
  const origin = asOf instanceof Date ? asOf : new Date(asOf);
  const d = new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() - Number(daysAgo || 0));
  const date = isoDate(d);
  const ts = `${date}T06:30:00.000Z`;
  return { date, createdAt: ts, updatedAt: ts };
}

export function buildDemoLedger(asOf = new Date()) {
  const t = (daysAgo) => demoDay(asOf, daysAgo);
  const parties = [
    { id: 'demo-ramesh', name: 'Ramesh Karigar', phone: '98200 11122', city: 'Mumbai', notes: '22K jobwork — Zaveri Bazaar' },
    { id: 'demo-suresh', name: 'Suresh Jewels', phone: '98765 44001', city: 'Ahmedabad', notes: 'Wholesale gold supplier' },
    { id: 'demo-mehta', name: 'Mehta Silver House', phone: '90909 22110', city: 'Rajkot', notes: 'Silver 999 / 925' },
    { id: 'demo-fatima', name: 'Fatima Polishing Works', phone: '99887 66554', city: 'Surat', notes: 'Polishing — often takes advance' },
    { id: 'demo-gupta', name: 'Gupta Casting Co', phone: '98111 77882', city: 'Jaipur', notes: '18K casting' },
    { id: 'demo-kiran', name: 'Kiran Chain Maker', phone: '97654 33009', city: 'Kolhapur', notes: 'Machine chain' }
  ];
  const suppliers = parties.map((p) => ({ ...p, status: 'ACTIVE', ...t(90) }));
  const money = [
    { id: 'demo-m-r-op', supplierId: 'demo-ramesh', type: 'OPENING', amountInr: 185000, note: 'Opening — old jobwork', ...t(88) },
    { id: 'demo-m-s-op', supplierId: 'demo-suresh', type: 'OPENING', amountInr: 210000, note: 'Opening — gold supply', ...t(88) },
    { id: 'demo-m-f-op', supplierId: 'demo-fatima', type: 'PAYMENT', amountInr: 50000, note: 'Advance for polishing', ...t(85) },
    { id: 'demo-m-k-op', supplierId: 'demo-kiran', type: 'OPENING', amountInr: 40000, note: 'Opening', ...t(84) },
    { id: 'demo-m-s-p1', supplierId: 'demo-suresh', type: 'PURCHASE', amountInr: 450000, note: '22K kada lot', ...t(80) },
    { id: 'demo-m-r-p1', supplierId: 'demo-ramesh', type: 'PURCHASE', amountInr: 95000, note: 'Finished sets received', ...t(64) },
    { id: 'demo-m-s-pay1', supplierId: 'demo-suresh', type: 'PAYMENT', amountInr: 200000, note: 'RTGS part payment', ...t(58) },
    { id: 'demo-m-g-op', supplierId: 'demo-gupta', type: 'OPENING', amountInr: 72000, note: 'Opening casting', ...t(50) },
    { id: 'demo-m-s-p2', supplierId: 'demo-suresh', type: 'PURCHASE', amountInr: 320000, note: '24K coin + bar', ...t(40) },
    { id: 'demo-m-r-pay1', supplierId: 'demo-ramesh', type: 'PAYMENT', amountInr: 50000, note: 'Cash on counter', ...t(36) },
    { id: 'demo-m-m-p1', supplierId: 'demo-mehta', type: 'PURCHASE', amountInr: 68000, note: 'Silver payal lot', ...t(33) },
    { id: 'demo-m-k-p1', supplierId: 'demo-kiran', type: 'PURCHASE', amountInr: 60000, note: 'Chain labour + metal', ...t(28) },
    { id: 'demo-m-f-p1', supplierId: 'demo-fatima', type: 'PURCHASE', amountInr: 12000, note: 'Polishing bill', ...t(24) },
    { id: 'demo-m-s-pay2', supplierId: 'demo-suresh', type: 'PAYMENT', amountInr: 150000, note: 'UPI', ...t(22) },
    { id: 'demo-m-r-p2', supplierId: 'demo-ramesh', type: 'PURCHASE', amountInr: 120000, note: 'Wedding set jobwork', ...t(14) },
    { id: 'demo-m-g-p1', supplierId: 'demo-gupta', type: 'PURCHASE', amountInr: 85000, note: '18K cast rings', ...t(9) },
    { id: 'demo-m-k-pay1', supplierId: 'demo-kiran', type: 'PAYMENT', amountInr: 70000, note: 'Cleared chain bill', ...t(8) },
    { id: 'demo-m-r-pay2', supplierId: 'demo-ramesh', type: 'PAYMENT', amountInr: 80000, note: 'Part payment', ...t(7) },
    { id: 'demo-m-m-p2', supplierId: 'demo-mehta', type: 'PURCHASE', amountInr: 42000, note: '925 jewellery', ...t(3) },
    { id: 'demo-m-f-p2', supplierId: 'demo-fatima', type: 'PURCHASE', amountInr: 8000, note: 'Rhodium polish', ...t(2) }
  ];
  const metal = [
    { id: 'demo-t-r-op', supplierId: 'demo-ramesh', direction: 'OPENING', metalType: 'GOLD', purity: '22K', weightGrams: 120, note: 'Metal with karigar', ...t(88) },
    { id: 'demo-t-m-op', supplierId: 'demo-mehta', direction: 'OPENING', metalType: 'SILVER', purity: '999', weightGrams: 2000, note: 'Silver with party', ...t(86) },
    { id: 'demo-t-r-i1', supplierId: 'demo-ramesh', direction: 'ISSUE', metalType: 'GOLD', purity: '22K', weightGrams: 80, note: 'Gave for bangles', ...t(75) },
    { id: 'demo-t-g-i1', supplierId: 'demo-gupta', direction: 'ISSUE', metalType: 'GOLD', purity: '18K', weightGrams: 60, note: 'Casting issue', ...t(48) },
    { id: 'demo-t-m-i1', supplierId: 'demo-mehta', direction: 'ISSUE', metalType: 'SILVER', purity: '999', weightGrams: 500, note: 'Gave for payal', ...t(34) },
    { id: 'demo-t-r-i2', supplierId: 'demo-ramesh', direction: 'ISSUE', metalType: 'GOLD', purity: '22K', weightGrams: 40, note: 'Gave for set', ...t(21) },
    { id: 'demo-t-g-r1', supplierId: 'demo-gupta', direction: 'RECEIPT', metalType: 'GOLD', purity: '18K', weightGrams: 40, note: 'Casting returned', ...t(12) },
    { id: 'demo-t-r-r1', supplierId: 'demo-ramesh', direction: 'RECEIPT', metalType: 'GOLD', purity: '22K', weightGrams: 35, note: 'Unused metal back', ...t(6) },
    { id: 'demo-t-m-r1', supplierId: 'demo-mehta', direction: 'RECEIPT', metalType: 'SILVER', purity: '999', weightGrams: 200, note: 'Scrap returned', ...t(4) }
  ];
  const settlements = [
    { id: 'demo-x-k1', supplierId: 'demo-kiran', moneyAmountInr: 30000, metalType: '', purity: '', metalGrams: 0, note: 'Squared chain account', ...t(5) },
    { id: 'demo-x-r1', supplierId: 'demo-ramesh', moneyAmountInr: 40000, metalType: 'GOLD', purity: '22K', metalGrams: 20, note: 'Part settle + 20g', ...t(1) }
  ];
  const now = t(0);
  const metalMaster = [
    ['GOLD', '24K', 7800], ['GOLD', '22K', 7200], ['GOLD', '18K', 5900], ['GOLD', '14K', 4600],
    ['SILVER', '999', 118], ['SILVER', '925', 108]
  ].map(([metalType, purity, rateInrPerGram]) => ({
    id: `mm-${metalType.toLowerCase()}-${purity.toLowerCase()}`,
    metalType,
    purity,
    rateInrPerGram,
    status: 'ACTIVE',
    createdAt: now.createdAt,
    updatedAt: now.updatedAt
  }));
  return {
    meta: { shopName: 'Mehta Jewellers', schemaVersion: SCHEMA_VERSION, createdAt: t(90).createdAt },
    suppliers,
    money,
    metal,
    settlements,
    metalMaster
  };
}

export function mergeDemoLedger(ledger, demo) {
  const next = { ...(ledger || emptyLedger()) };
  for (const key of ['suppliers', 'money', 'metal', 'settlements']) {
    let list = (next[key] || []).slice();
    for (const row of demo[key] || []) list = upsertById(list, row);
    next[key] = list;
  }
  let master = next.metalMaster || [];
  for (const row of demo.metalMaster || []) master = upsertById(master, row);
  next.metalMaster = master;
  next.meta = { ...(next.meta || {}), shopName: next.meta?.shopName || demo.meta?.shopName || '' };
  return next;
}

export function upsertById(list, record) {
  const id = String(record?.id || '');
  if (!id) return list.slice();
  const next = list.slice();
  const index = next.findIndex((row) => String(row.id) === id);
  if (index === -1) next.push({ ...record, id });
  else next[index] = { ...next[index], ...record, id };
  return next;
}

export function removeById(list, id) {
  const target = String(id || '');
  return list.filter((row) => String(row.id) !== target);
}

export function withSupplierNames(rows, suppliers) {
  const names = Object.fromEntries((suppliers || []).map((s) => [s.id, s.name]));
  return rows.map((row) => ({
    ...row,
    supplierName: names[row.supplierId] || row.supplierName || ''
  }));
}

export function deleteSupplierCascade(ledger, supplierId) {
  const id = String(supplierId || '');
  return {
    ...ledger,
    suppliers: removeById(ledger.suppliers || [], id),
    money: (ledger.money || []).filter((row) => String(row.supplierId) !== id),
    metal: (ledger.metal || []).filter((row) => String(row.supplierId) !== id),
    settlements: (ledger.settlements || []).filter((row) => String(row.supplierId) !== id)
  };
}

export function moneyDirectionLabel(payable) {
  if (Number(payable) > 0) return 'Hume dena';
  if (Number(payable) < 0) return 'Unse lena';
  return 'Square';
}

export function mergeJournals(remote, local, { deletedIds = [], dirtyIds = [] } = {}) {
  const deleted = new Set((deletedIds || []).map(String));
  const dirty = new Set((dirtyIds || []).map(String));
  const localById = Object.fromEntries((local || []).filter((row) => row?.id).map((row) => [String(row.id), row]));
  const used = new Set();
  const out = [];
  for (const row of remote || []) {
    const id = String(row?.id || '');
    if (!id || deleted.has(id)) continue;
    out.push(dirty.has(id) && localById[id] ? localById[id] : row);
    used.add(id);
  }
  for (const row of local || []) {
    const id = String(row?.id || '');
    if (!id || used.has(id) || deleted.has(id)) continue;
    out.push(row);
  }
  return out;
}

export function formatMetalWithParty(map) {
  const entries = Object.entries(map || {}).filter(([, grams]) => Number(grams) !== 0);
  if (!entries.length) return '';
  return entries.map(([key, grams]) => `${key} ${Number(grams)} g`).join('; ');
}

export function buildBalancesRows(ledger, now = new Date()) {
  const summary = summarizeLedger(
    ledger.suppliers || [],
    ledger.money || [],
    ledger.metal || [],
    ledger.settlements || []
  );
  const updatedAt = now instanceof Date ? now.toISOString() : String(now);
  const grams = (map, key) => Number((map || {})[key] || 0);
  return summary.bySupplier.map((row) => ({
    supplierName: row.name,
    status: row.status || 'ACTIVE',
    moneyDirection: moneyDirectionLabel(row.payable),
    moneyInr: Math.abs(Number(row.payable) || 0),
    gold24k: grams(row.metalByPurity, 'GOLD:24K'),
    gold22k: grams(row.metalByPurity, 'GOLD:22K'),
    gold18k: grams(row.metalByPurity, 'GOLD:18K'),
    gold14k: grams(row.metalByPurity, 'GOLD:14K'),
    silver999: grams(row.metalByPurity, 'SILVER:999'),
    silver925: grams(row.metalByPurity, 'SILVER:925'),
    weOweInr: row.weOweInr,
    theyOweInr: row.theyOweInr,
    updatedAt,
    supplierId: row.id
  }));
}

export function prepareSavePayload(ledger, now = new Date()) {
  const suppliers = ledger.suppliers || [];
  return {
    meta: {
      shopName: ledger.meta?.shopName || '',
      schemaVersion: SCHEMA_VERSION,
      createdAt: ledger.meta?.createdAt || (now instanceof Date ? now.toISOString() : String(now)),
      lastSavedAt: ledger.meta?.lastSavedAt || (now instanceof Date ? now.toISOString() : String(now))
    },
    suppliers,
    money: withSupplierNames(ledger.money || [], suppliers),
    metal: withSupplierNames(ledger.metal || [], suppliers),
    settlements: withSupplierNames(ledger.settlements || [], suppliers),
    khata: buildBalancesRows(ledger, now),
    metalMaster: seedMetalMaster(ledger.metalMaster || [])
  };
}
