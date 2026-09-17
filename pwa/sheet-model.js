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

/** Place each field under the sheet column whose header matches the key — never by array index. */
export function recordsToAlignedRows(sheetHeaders, records, canonicalHeaders) {
  const headers = (sheetHeaders || []).map((h) => String(h || '').trim());
  const keys = canonicalHeaders || [];
  const map = {};
  headers.forEach((key, i) => {
    if (key && map[key] === undefined) map[key] = i;
  });
  const width = Math.max(headers.length, 1);
  return (records || []).map((record) => {
    const row = Array(width).fill('');
    keys.forEach((key) => {
      const i = map[key];
      if (i === undefined) return;
      const value = record[key];
      row[i] = value === undefined || value === null ? '' : String(value);
    });
    return row;
  });
}

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

export function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

export function isPhoneLike(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const d = digitsOnly(raw);
  if (d.length < 8 || d.length > 15) return false;
  const compact = raw.replace(/[\s\-+().]/g, '');
  return compact === d;
}

export function partyDisplayName(party) {
  const name = String(party?.name || '').trim();
  if (!name || isPhoneLike(name)) return '';
  return name;
}

export function assertPartyName(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Enter the party name');
  if (isPhoneLike(n)) throw new Error('Name is the party, not the mobile. Put the number in Phone.');
  return n;
}

function humanName(value) {
  const name = String(value || '').trim();
  if (!name || isPhoneLike(name)) return '';
  return name;
}

function partyPhoneKey(party) {
  const fromPhone = digitsOnly(party?.phone);
  if (fromPhone.length >= 8 && fromPhone.length <= 15) return fromPhone;
  if (isPhoneLike(party?.name)) return digitsOnly(party.name);
  return '';
}

function sameParty(a, b) {
  const ap = partyPhoneKey(a);
  const bp = partyPhoneKey(b);
  if (ap && bp && ap === bp) return true;
  const na = humanName(a.name).toLowerCase();
  const nb = humanName(b.name).toLowerCase();
  if (na && nb && na === nb) return true;
  return false;
}

function preferPhone(a, b) {
  if (digitsOnly(a)) return String(a).trim();
  if (digitsOnly(b)) return String(b).trim();
  if (isPhoneLike(a)) return String(a).trim();
  if (isPhoneLike(b)) return String(b).trim();
  return '';
}

function preferParty(a, b) {
  const out = { ...a };
  out.name = humanName(a.name) || humanName(b.name) || '';
  out.phone = preferPhone(a.phone, b.phone) || preferPhone(a.name, b.name) || out.phone || '';
  if (!out.city) out.city = b.city || '';
  if (!out.notes) out.notes = b.notes || '';
  if (!out.id) out.id = b.id;
  return out;
}

function nameFromJournals(id, ledger) {
  const sid = String(id || '');
  for (const row of [...(ledger?.money || []), ...(ledger?.metal || []), ...(ledger?.settlements || [])]) {
    if (String(row.supplierId || '') !== sid) continue;
    const n = humanName(row.supplierName);
    if (n) return n;
  }
  return '';
}

export function dedupePartyLedger(ledger) {
  const list = (ledger?.suppliers || []).filter((row) => row && (row.id || row.name || row.phone));
  const kept = [];
  const idMap = {};
  for (const row of list) {
    const idx = kept.findIndex((k) => sameParty(k, row));
    if (idx === -1) {
      kept.push({ ...row });
      if (row.id) idMap[String(row.id)] = String(row.id);
      continue;
    }
    const merged = preferParty(kept[idx], row);
    const keepId = String(merged.id || kept[idx].id || row.id || '');
    merged.id = keepId;
    if (kept[idx].id) idMap[String(kept[idx].id)] = keepId;
    if (row.id) idMap[String(row.id)] = keepId;
    kept[idx] = merged;
  }
  const remap = (rows) => (rows || []).map((row) => ({
    ...row,
    supplierId: idMap[String(row.supplierId || '')] || row.supplierId
  }));
  const money = remap(ledger?.money);
  const metal = remap(ledger?.metal);
  const settlements = remap(ledger?.settlements);
  const journals = { money, metal, settlements };
  const suppliers = kept.map((row) => {
    const out = { ...row };
    if (isPhoneLike(out.name) && !digitsOnly(out.phone)) out.phone = String(out.name).trim();
    if (!humanName(out.name)) {
      const recovered = nameFromJournals(out.id, journals);
      out.name = recovered || '';
    }
    return out;
  });
  return {
    ...ledger,
    suppliers,
    money: withSupplierNames(money, suppliers),
    metal: withSupplierNames(metal, suppliers),
    settlements: withSupplierNames(settlements, suppliers)
  };
}

export function dealIsValid({ amountInr, metals } = {}) {
  if (Number(amountInr || 0) > 0) return true;
  return (metals || []).some((m) => Number(m.weightGrams || 0) > 0 && m.metalType && m.purity);
}

export function splitDeal({ supplierId, type, amountInr, date, note, metals } = {}) {
  const money = [];
  const metal = [];
  if (Number(amountInr || 0) > 0) {
    money.push({
      supplierId,
      type: type || 'PURCHASE',
      amountInr: Number(amountInr),
      date,
      note: note || ''
    });
  }
  for (const m of metals || []) {
    if (!(Number(m.weightGrams || 0) > 0 && m.metalType && m.purity)) continue;
    metal.push({
      supplierId,
      direction: m.direction || 'ISSUE',
      metalType: String(m.metalType || '').toUpperCase(),
      purity: m.purity,
      weightGrams: Number(m.weightGrams),
      date,
      note: note || ''
    });
  }
  return { money, metal };
}


function dropDemoIdRows(list) {
  return (list || []).filter((row) => !String(row?.id || '').startsWith('demo-'));
}

export function stripDemoLedger(ledger) {
  const current = ledger || emptyLedger();
  const next = { ...current };
  for (const key of ['suppliers', 'money', 'metal', 'settlements']) {
    next[key] = dropDemoIdRows(current[key]);
  }
  next.metalMaster = current.metalMaster || [];
  next.meta = { ...(current.meta || {}) };
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
  const names = Object.fromEntries((suppliers || []).map((s) => [s.id, partyDisplayName(s)]));
  return rows.map((row) => ({
    ...row,
    supplierName: names[row.supplierId] || humanName(row.supplierName) || ''
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
