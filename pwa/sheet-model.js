import { summarizeLedger } from './ledger-math.js';

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
