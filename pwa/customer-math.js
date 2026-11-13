/** Customer side of the shop: what we sold to a customer and what they returned. */

export const SALE = 'SALE';
export const RETURN = 'RETURN';

const DEFAULT_CATEGORIES = {
  GOLD: ['Chain', 'Mangalsutra', 'Ring', 'Earrings', 'Bangles', 'Bracelet', 'Necklace', 'Pendant', 'Nose pin', 'Coin', 'Bar', 'Other'],
  SILVER: ['Chain', 'Ring', 'Earrings', 'Payal', 'Bangles', 'Bracelet', 'Pooja items', 'Utensils', 'Idol', 'Coin', 'Bar', 'Other'],
  PLATINUM: ['Chain', 'Ring', 'Band', 'Bracelet', 'Earrings', 'Other']
};

const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function seedCategories(rows, now = new Date()) {
  if (Array.isArray(rows) && rows.length) return rows;
  const stamp = now instanceof Date ? now.toISOString() : String(now);
  const out = [];
  for (const [metalType, names] of Object.entries(DEFAULT_CATEGORIES)) {
    for (const category of names) {
      out.push({
        id: `cat-${slug(metalType)}-${slug(category)}`,
        metalType,
        category,
        status: 'ACTIVE',
        createdAt: stamp,
        updatedAt: stamp
      });
    }
  }
  return out;
}

export function categoriesForType(categories, metalType) {
  const type = String(metalType || '').toUpperCase();
  const names = (Array.isArray(categories) ? categories : [])
    .filter((row) => String(row.metalType || '').toUpperCase() === type && String(row.status || 'ACTIVE').toUpperCase() !== 'INACTIVE')
    .map((row) => String(row.category || '').trim())
    .filter(Boolean);
  return [...new Set(names)];
}

const num = (v) => Number(v || 0);
const sign = (row) => (row.kind === RETURN ? -1 : 1);

/** Positive = the customer owes the shop. Negative = the shop owes the customer. */
export function customerBalance(sales, customerId) {
  return (sales || [])
    .filter((row) => row.customerId === customerId)
    .reduce((sum, row) => sum + sign(row) * (num(row.amountInr) - num(row.paidInr)), 0);
}

/** Net grams the customer is holding from us, e.g. { 'GOLD:22K': 12.5 }. */
export function customerMetalNet(sales, customerId) {
  const out = {};
  for (const row of sales || []) {
    if (row.customerId !== customerId || !row.metalType || !row.purity) continue;
    const key = `${String(row.metalType).toUpperCase()}:${row.purity}`;
    out[key] = (out[key] || 0) + sign(row) * num(row.weightGrams);
  }
  return Object.fromEntries(Object.entries(out).filter(([, g]) => Math.abs(g) > 1e-9));
}

function nameOf(customer) {
  const name = String(customer?.name || '').trim();
  return name || 'Customer';
}

export function summarizeCustomers(customers, sales) {
  const rows = (customers || []).map((customer) => {
    const balance = customerBalance(sales, customer.id);
    const mine = (sales || []).filter((row) => row.customerId === customer.id);
    const lastDate = mine.map((row) => String(row.date || '').slice(0, 10)).sort().pop() || '';
    return {
      id: customer.id,
      name: nameOf(customer),
      phone: customer.phone || '',
      balance,
      owesUs: Math.max(0, balance),
      weOwe: Math.max(0, -balance),
      metalNet: customerMetalNet(sales, customer.id),
      lastDate,
      count: mine.length
    };
  });
  return {
    customerCount: rows.length,
    customersOweInr: rows.reduce((n, row) => n + row.owesUs, 0),
    weOweCustomersInr: rows.reduce((n, row) => n + row.weOwe, 0),
    byCustomer: rows
  };
}

export function buildCustomerPassbook(customerId, sales) {
  const mine = (sales || []).filter((row) => row.customerId === customerId);
  const sorted = mine
    .map((row) => ({ row, sort: `${String(row.date || '').slice(0, 10)}T${row.createdAt || ''}` }))
    .sort((a, b) => a.sort.localeCompare(b.sort) || String(a.row.id).localeCompare(String(b.row.id)));
  let running = 0;
  const lines = sorted.map(({ row }) => {
    const delta = sign(row) * (num(row.amountInr) - num(row.paidInr));
    running += delta;
    const grams = num(row.weightGrams);
    return {
      id: row.id,
      kind: row.kind === RETURN ? 'return' : 'sale',
      label: row.kind === RETURN ? 'Returned' : 'Sold',
      date: row.date,
      category: row.category || '',
      detail: [row.category, `${String(row.metalType || '').toUpperCase()} ${row.purity || ''}`.trim(), grams ? `${grams} g` : '']
        .filter(Boolean).join(' · '),
      note: row.note || '',
      amountInr: num(row.amountInr),
      paidInr: num(row.paidInr),
      grams,
      hasPhoto: Boolean(row.photoId),
      runningInr: running,
      raw: row
    };
  });
  return lines.reverse();
}

function inRange(row, from, to) {
  const d = String(row?.date || '').slice(0, 10);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/** Sold / returned per metal + category — how much of each kind of jewellery moved. */
export function categoryTotals(sales, { from = '', to = '' } = {}) {
  const map = {};
  for (const row of sales || []) {
    if (!inRange(row, from, to)) continue;
    const metalType = String(row.metalType || '').toUpperCase() || 'OTHER';
    const category = String(row.category || '').trim() || 'Uncategorised';
    const key = `${metalType}|${category}`;
    if (!map[key]) {
      map[key] = { metalType, category, soldGrams: 0, returnedGrams: 0, soldInr: 0, returnedInr: 0, soldCount: 0, returnedCount: 0 };
    }
    const bucket = map[key];
    if (row.kind === RETURN) {
      bucket.returnedGrams += num(row.weightGrams);
      bucket.returnedInr += num(row.amountInr);
      bucket.returnedCount += 1;
    } else {
      bucket.soldGrams += num(row.weightGrams);
      bucket.soldInr += num(row.amountInr);
      bucket.soldCount += 1;
    }
  }
  return Object.values(map)
    .map((row) => ({ ...row, netGrams: row.soldGrams - row.returnedGrams, netInr: row.soldInr - row.returnedInr }))
    .sort((a, b) => b.netGrams - a.netGrams || a.category.localeCompare(b.category));
}

export function salesPeriodTotals(sales, range = {}) {
  const rows = (sales || []).filter((row) => inRange(row, range.from, range.to));
  const sum = (kind, field) => rows.filter((row) => (kind === RETURN ? row.kind === RETURN : row.kind !== RETURN))
    .reduce((n, row) => n + num(row[field]), 0);
  return {
    soldInr: sum(SALE, 'amountInr'),
    returnedInr: sum(RETURN, 'amountInr'),
    soldGrams: sum(SALE, 'weightGrams'),
    returnedGrams: sum(RETURN, 'weightGrams'),
    count: rows.length
  };
}

/** Throws a plain-language Error when the entry cannot be saved. */
export function validateSale(data = {}) {
  if (!data.customerId) throw new Error('Choose the customer');
  if (!String(data.metalType || '').trim() || !String(data.purity || '').trim()) throw new Error('Choose the metal and purity');
  if (!String(data.category || '').trim()) throw new Error('Choose what the item is (chain, ring, …)');
  const grams = num(data.weightGrams);
  if (!(grams > 0)) throw new Error('Enter the weight in grams');
  const amount = num(data.amountInr);
  if (!(amount >= 0)) throw new Error('Enter the amount in rupees');
  const paid = data.paidInr === '' || data.paidInr == null ? amount : num(data.paidInr);
  if (paid < 0) throw new Error('Paid amount cannot be below zero');
  if (paid > amount) throw new Error('Paid amount is more than the bill amount');
  return { grams, amount, paid };
}

export function removeCustomerData(ledger, customerId) {
  const id = String(customerId || '');
  return {
    ...ledger,
    customers: (ledger.customers || []).filter((row) => String(row.id) !== id),
    sales: (ledger.sales || []).filter((row) => String(row.customerId) !== id)
  };
}

export function buildCustomerBalanceRows(customers, sales, now = new Date()) {
  const updatedAt = now instanceof Date ? now.toISOString() : String(now);
  return summarizeCustomers(customers, sales).byCustomer.map((row) => ({
    customerName: row.name,
    phone: row.phone,
    balanceDirection: row.balance > 0 ? 'Unse lena' : row.balance < 0 ? 'Hume dena' : 'Square',
    balanceInr: Math.abs(row.balance),
    metalSummary: Object.entries(row.metalNet).map(([key, g]) => `${key.replace(':', ' ')} ${Number(g.toFixed(3))} g`).join('; '),
    lastActivity: row.lastDate,
    updatedAt,
    customerId: row.id
  }));
}
