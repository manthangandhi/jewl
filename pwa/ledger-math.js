export const GOLD_PURITIES = ['24K', '22K', '18K', '14K'];
export const SILVER_PURITIES = ['999', '925'];

export function puritiesForType(master, metalType) {
  const type = String(metalType || '').toUpperCase();
  const rows = Array.isArray(master) ? master : [];
  const fromMaster = rows
    .filter((row) => String(row.metalType || '').toUpperCase() === type && String(row.status || 'ACTIVE').toUpperCase() !== 'INACTIVE')
    .map((row) => String(row.purity || '').trim())
    .filter(Boolean);
  if (fromMaster.length) return [...new Set(fromMaster)];
  return type === 'SILVER' ? SILVER_PURITIES.slice() : GOLD_PURITIES.slice();
}

export function assertPurity(metalType, purity, master) {
  const allowed = puritiesForType(master, metalType);
  if (!allowed.includes(purity)) throw new Error(`Invalid purity ${purity} for ${metalType}`);
}

export function payableInr(moneyRows, settlementRows, supplierId) {
  const money = moneyRows.filter((row) => row.supplierId === supplierId)
    .reduce((sum, row) => {
      if (row.type === 'OPENING' || row.type === 'PURCHASE') return sum + Number(row.amountInr || 0);
      if (row.type === 'PAYMENT') return sum - Number(row.amountInr || 0);
      return sum;
    }, 0);
  const settled = settlementRows.filter((row) => row.supplierId === supplierId)
    .reduce((sum, row) => sum + Number(row.moneyAmountInr || 0), 0);
  return money - settled;
}

export function metalByPurity(metalRows, settlementRows, supplierId) {
  const balances = {};
  const add = (key, delta) => { balances[key] = (balances[key] || 0) + delta; };
  for (const row of metalRows.filter((item) => item.supplierId === supplierId)) {
    const key = `${row.metalType}:${row.purity}`;
    const grams = Number(row.weightGrams || 0);
    if (row.direction === 'OPENING' || row.direction === 'ISSUE') add(key, grams);
    if (row.direction === 'RECEIPT') add(key, -grams);
  }
  for (const row of settlementRows.filter((item) => item.supplierId === supplierId)) {
    if (row.metalType && row.purity && Number(row.metalGrams || 0) > 0) {
      add(`${row.metalType}:${row.purity}`, -Number(row.metalGrams));
    }
  }
  return Object.fromEntries(Object.entries(balances).filter(([, grams]) => grams !== 0));
}

export function skipInvalidMetalRow(row) {
  try {
    if (!row?.metalType || !row?.purity) return null;
    assertPurity(row.metalType, row.purity);
    return row;
  } catch {
    return null;
  }
}

export function summarizeLedger(suppliers, money, metal, settlements) {
  const bySupplier = suppliers.map((supplier) => {
    const payable = payableInr(money, settlements, supplier.id);
    return {
      id: supplier.id,
      name: supplier.name,
      status: supplier.status || 'ACTIVE',
      payable,
      weOweInr: Math.max(0, payable),
      theyOweInr: Math.max(0, -payable),
      metalByPurity: metalByPurity(metal, settlements, supplier.id)
    };
  });
  const outstanding = bySupplier.reduce((sum, row) => sum + row.payable, 0);
  const weOweInr = bySupplier.reduce((sum, row) => sum + row.weOweInr, 0);
  const theyOweInr = bySupplier.reduce((sum, row) => sum + row.theyOweInr, 0);
  const totalPurchases = money.filter((row) => row.type === 'PURCHASE').reduce((sum, row) => sum + Number(row.amountInr || 0), 0);
  const totalPayments = money.filter((row) => row.type === 'PAYMENT').reduce((sum, row) => sum + Number(row.amountInr || 0), 0);
  const metalByPurityShop = {};
  for (const row of bySupplier) {
    for (const [key, grams] of Object.entries(row.metalByPurity)) {
      metalByPurityShop[key] = (metalByPurityShop[key] || 0) + grams;
    }
  }
  const nameById = Object.fromEntries(suppliers.map((supplier) => [supplier.id, supplier.name]));
  const recentMoney = money.slice(0, 5).map((row) => ({ ...row, supplierName: nameById[row.supplierId] || '' }));
  return {
    supplierCount: suppliers.length,
    moneyCount: money.length,
    metalCount: metal.length,
    settlementCount: settlements.length,
    outstanding,
    weOweInr,
    theyOweInr,
    totalPurchases,
    totalPayments,
    metalByPurity: metalByPurityShop,
    recentMoney,
    bySupplier
  };
}

function eventTime(row) {
  const date = String(row.date || '').slice(0, 10);
  const created = String(row.createdAt || '');
  return `${date}T${created || '00:00:00'}`;
}

export function buildPassbook({ supplierId, money = [], metal = [], settlements = [] }) {
  const events = [];
  for (const row of money.filter((item) => item.supplierId === supplierId)) {
    const signed = row.type === 'PAYMENT' ? -Number(row.amountInr || 0) : Number(row.amountInr || 0);
    events.push({
      id: row.id,
      kind: 'money',
      type: row.type,
      date: row.date,
      createdAt: row.createdAt,
      sort: eventTime(row),
      amountInr: signed,
      grams: 0,
      label: row.type === 'PAYMENT' ? 'Payment' : row.type === 'OPENING' ? 'Opening' : 'Purchase',
      detail: '',
      note: row.note || '',
      raw: row
    });
  }
  for (const row of metal.filter((item) => item.supplierId === supplierId)) {
    const label = row.direction === 'RECEIPT' ? 'Metal aaya' : row.direction === 'OPENING' ? 'Opening metal' : 'Metal diya';
    events.push({
      id: row.id,
      kind: 'metal',
      type: row.direction,
      date: row.date,
      createdAt: row.createdAt,
      sort: eventTime(row),
      amountInr: 0,
      grams: Number(row.weightGrams || 0),
      label,
      detail: `${row.metalType || ''} ${row.purity || ''}`.trim(),
      note: row.note || '',
      raw: row
    });
  }
  for (const row of settlements.filter((item) => item.supplierId === supplierId)) {
    events.push({
      id: row.id,
      kind: 'settle',
      type: 'SETTLEMENT',
      date: row.date,
      createdAt: row.createdAt,
      sort: eventTime(row),
      amountInr: -Number(row.moneyAmountInr || 0),
      grams: Number(row.metalGrams || 0),
      label: 'Settlement',
      detail: row.metalType ? `${row.metalType} ${row.purity || ''}` : '',
      note: row.note || '',
      raw: row
    });
  }
  events.sort((a, b) => String(a.sort).localeCompare(String(b.sort)) || String(a.id).localeCompare(String(b.id)));
  let running = 0;
  const withRunning = events.map((item) => {
    running += Number(item.amountInr || 0);
    return { ...item, runningInr: running };
  });
  return withRunning.reverse();
}

export function isoDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function rangeForPreset(preset, now = new Date()) {
  const to = isoDate(now);
  if (preset === 'today') return { from: to, to };
  if (preset === '7d') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    return { from: isoDate(d), to };
  }
  if (preset === '30d') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    return { from: isoDate(d), to };
  }
  if (preset === 'month') {
    return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to };
  }
  return { from: '', to: '' };
}

export function inDateRange(row, from, to) {
  const d = String(row?.date || '').slice(0, 10);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function reportForRange({
  suppliers = [], money = [], metal = [], settlements = [], from = '', to = ''
} = {}) {
  const moneyRows = money.filter((row) => inDateRange(row, from, to));
  const metalRows = metal.filter((row) => inDateRange(row, from, to));
  const settleRows = settlements.filter((row) => inDateRange(row, from, to));
  const purchases = moneyRows.filter((row) => row.type === 'PURCHASE').reduce((n, row) => n + Number(row.amountInr || 0), 0);
  const payments = moneyRows.filter((row) => row.type === 'PAYMENT').reduce((n, row) => n + Number(row.amountInr || 0), 0);
  const metalOut = metalRows.filter((row) => row.direction === 'ISSUE').reduce((n, row) => n + Number(row.weightGrams || 0), 0);
  const metalIn = metalRows.filter((row) => row.direction === 'RECEIPT').reduce((n, row) => n + Number(row.weightGrams || 0), 0);
  const settled = settleRows.reduce((n, row) => n + Number(row.moneyAmountInr || 0), 0);
  const names = Object.fromEntries(suppliers.map((row) => [row.id, row.name]));
  const byPartyMap = {};
  const bump = (id, patch) => {
    if (!id) return;
    if (!byPartyMap[id]) {
      byPartyMap[id] = { id, name: names[id] || '', purchases: 0, payments: 0, metalOut: 0, metalIn: 0, settled: 0 };
    }
    const row = byPartyMap[id];
    for (const [key, value] of Object.entries(patch)) row[key] += value;
  };
  for (const row of moneyRows) {
    if (row.type === 'PURCHASE') bump(row.supplierId, { purchases: Number(row.amountInr || 0) });
    if (row.type === 'PAYMENT') bump(row.supplierId, { payments: Number(row.amountInr || 0) });
  }
  for (const row of metalRows) {
    if (row.direction === 'ISSUE') bump(row.supplierId, { metalOut: Number(row.weightGrams || 0) });
    if (row.direction === 'RECEIPT') bump(row.supplierId, { metalIn: Number(row.weightGrams || 0) });
  }
  for (const row of settleRows) bump(row.supplierId, { settled: Number(row.moneyAmountInr || 0) });
  const line = (kind, row, label, fig) => ({
    id: row.id,
    kind,
    date: row.date,
    supplierId: row.supplierId,
    name: names[row.supplierId] || '',
    label,
    fig
  });
  const lines = [
    ...moneyRows.map((row) => line('money', row, row.type === 'PAYMENT' ? 'Payment' : row.type === 'OPENING' ? 'Opening' : 'Purchase', Number(row.amountInr || 0))),
    ...metalRows.map((row) => line('metal', row, row.direction === 'RECEIPT' ? 'Metal aaya' : row.direction === 'ISSUE' ? 'Metal diya' : 'Opening metal', Number(row.weightGrams || 0))),
    ...settleRows.map((row) => line('settle', row, 'Settlement', Number(row.moneyAmountInr || 0)))
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return {
    from,
    to,
    purchases,
    payments,
    metalOut,
    metalIn,
    settled,
    count: lines.length,
    byParty: Object.values(byPartyMap).sort((a, b) => b.purchases - a.purchases),
    lines
  };
}

export function reportCsv(report) {
  const header = ['Date', 'Party', 'Type', 'Amount'];
  const rows = (report.lines || []).map((line) => [
    String(line.date || '').slice(0, 10),
    line.name,
    line.label,
    line.kind === 'metal' ? `${line.fig} g` : line.fig
  ]);
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\n');
}
