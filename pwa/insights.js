/** Numbers a shop owner can act on: trends, who buys, who owes, what sells. Pure functions, no screen code. */
import { SALE, RETURN, PAYMENT, EXCHANGE, customerBalance } from './customer-math.js';

const num = (v) => Number(v || 0);
const day = (v) => String(v || '').slice(0, 10);

/** The last `count` calendar months ending with the month of `now`, oldest first. */
export function lastMonths(count = 6, now = new Date()) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: d.toLocaleDateString('en-IN', { month: 'short' }), year: d.getFullYear() });
  }
  return out;
}

/** Per month: sold, returned, collected from customers, paid to suppliers. */
export function monthlyTrend({ sales = [], money = [] }, now = new Date(), count = 6) {
  const months = lastMonths(count, now).map((m) => ({ ...m, sold: 0, returned: 0, collected: 0, paidOut: 0 }));
  const at = Object.fromEntries(months.map((m) => [m.key, m]));
  for (const row of sales) {
    const m = at[day(row.date).slice(0, 7)];
    if (!m) continue;
    if (row.kind === EXCHANGE) continue;
    if (row.kind === PAYMENT) m.collected += num(row.amountInr);
    else if (row.kind === RETURN) m.returned += num(row.amountInr);
    else { m.sold += num(row.amountInr); m.collected += num(row.paidInr); }
  }
  for (const row of money) {
    const m = at[day(row.date).slice(0, 7)];
    if (m && row.type === 'PAYMENT') m.paidOut += num(row.amountInr);
  }
  return months.map((m) => ({ ...m, net: m.sold - m.returned }));
}

/** Share of sales value by metal over the period. */
export function salesMix(sales, { from = '', to = '' } = {}) {
  const by = {};
  let total = 0;
  for (const row of sales) {
    if (row.kind === PAYMENT || row.kind === RETURN || row.kind === EXCHANGE) continue;
    const d = day(row.date);
    if ((from && d < from) || (to && d > to)) continue;
    const type = String(row.metalType || 'OTHER').toUpperCase();
    by[type] = (by[type] || 0) + num(row.amountInr);
    total += num(row.amountInr);
  }
  return Object.entries(by).map(([metalType, amountInr]) => ({ metalType, amountInr, pct: total ? Math.round((amountInr / total) * 100) : 0 }))
    .sort((a, b) => b.amountInr - a.amountInr);
}

/** Best customers by net sales (sales minus returns) since `from`. */
export function topCustomers(customers, sales, { from = '', limit = 5 } = {}) {
  const name = Object.fromEntries((customers || []).map((c) => [c.id, c.name]));
  const by = {};
  for (const row of sales) {
    if (row.kind === PAYMENT || row.kind === EXCHANGE || (from && day(row.date) < from)) continue;
    const e = (by[row.customerId] ||= { id: row.customerId, name: name[row.customerId] || 'Customer', soldInr: 0, returnedInr: 0, visits: 0 });
    if (row.kind === RETURN) e.returnedInr += num(row.amountInr);
    else { e.soldInr += num(row.amountInr); e.visits += 1; }
  }
  return Object.values(by).map((e) => ({ ...e, netInr: e.soldInr - e.returnedInr })).sort((a, b) => b.netInr - a.netInr).slice(0, limit);
}

/**
 * Money customers owe us, aged by the bill it came from. Payments and returns settle the oldest bills first,
 * so a small recent payment does not make an old debt look new.
 */
export function duesAgeing(customers, sales, now = new Date()) {
  const buckets = [
    { id: 'b30', label: 'Under 30 days', amountInr: 0, count: 0 },
    { id: 'b60', label: '30 to 60 days', amountInr: 0, count: 0 },
    { id: 'b90', label: '60 to 90 days', amountInr: 0, count: 0 },
    { id: 'b90p', label: 'Over 90 days', amountInr: 0, count: 0 }
  ];
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const c of customers || []) {
    const mine = (sales || []).filter((r) => r.customerId === c.id).sort((a, b) => day(a.date).localeCompare(day(b.date)));
    let credit = 0;
    const debts = [];
    for (const r of mine) {
      if (r.kind === PAYMENT || r.kind === EXCHANGE) credit += num(r.amountInr);
      else if (r.kind === RETURN) credit += Math.max(0, num(r.amountInr) - num(r.paidInr));
      else if (num(r.amountInr) - num(r.paidInr) > 0) debts.push({ date: day(r.date), left: num(r.amountInr) - num(r.paidInr) });
    }
    for (const d of debts) {
      const used = Math.min(d.left, credit);
      d.left -= used; credit -= used;
    }
    const seen = new Set();
    for (const d of debts) {
      if (d.left <= 0) continue;
      const age = Math.floor((t - new Date(`${d.date}T00:00:00`).getTime()) / 86400000);
      const b = age > 90 ? buckets[3] : age > 60 ? buckets[2] : age > 30 ? buckets[1] : buckets[0];
      b.amountInr += d.left;
      if (!seen.has(b.id)) { seen.add(b.id); b.count += 1; }
    }
  }
  return buckets;
}

/** Repeat buyers: how many customers bought at least twice, and the average bill. */
export function repeatStats(sales) {
  const per = {};
  for (const r of sales || []) {
    if (r.kind !== SALE) continue;
    const e = (per[r.customerId] ||= { n: 0, total: 0 });
    e.n += 1; e.total += num(r.amountInr);
  }
  const ids = Object.keys(per);
  const bills = ids.reduce((n, id) => n + per[id].n, 0);
  const total = ids.reduce((n, id) => n + per[id].total, 0);
  return { customers: ids.length, repeat: ids.filter((id) => per[id].n >= 2).length, avgBillInr: bills ? Math.round(total / bills) : 0 };
}

/** Share of sold value that came back as returns, per item. Highest first. */
export function returnRates(sales, limit = 5) {
  const by = {};
  for (const r of sales || []) {
    if (r.kind === PAYMENT || r.kind === EXCHANGE) continue;
    const key = String(r.category || 'Uncategorised');
    const e = (by[key] ||= { category: key, sold: 0, returned: 0 });
    if (r.kind === RETURN) e.returned += num(r.amountInr); else e.sold += num(r.amountInr);
  }
  return Object.values(by).filter((e) => e.returned > 0 && e.sold > 0)
    .map((e) => ({ ...e, pct: Math.round((e.returned / e.sold) * 100) })).sort((a, b) => b.pct - a.pct).slice(0, limit);
}

/** Customers who bought before but have been quiet for `days`, most valuable first. */
export function quietCustomers(customers, sales, { days = 90, now = new Date(), limit = 5 } = {}) {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const out = [];
  for (const c of customers || []) {
    const mine = (sales || []).filter((r) => r.customerId === c.id && r.kind === SALE);
    if (!mine.length) continue;
    const last = mine.map((r) => day(r.date)).sort().pop();
    const quiet = Math.floor((t - new Date(`${last}T00:00:00`).getTime()) / 86400000);
    if (quiet >= days) out.push({ id: c.id, name: c.name, phone: c.phone || '', quietDays: quiet, lifetimeInr: mine.reduce((n, r) => n + num(r.amountInr), 0) });
  }
  return out.sort((a, b) => b.lifetimeInr - a.lifetimeInr).slice(0, limit);
}

/** Percent change from `before` to `now`, or null when there is nothing to compare against. */
export function changePct(now, before) {
  return before > 0 ? Math.round(((now - before) / before) * 100) : null;
}

/** Indian financial year starts on 1 April. */
export function financialYearStart(now = new Date()) {
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(y, 3, 1);
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const PERIODS = [
  ['30d', '30 days'], ['90d', '3 months'], ['6m', '6 months'], ['fy', 'This year'], ['12m', '12 months'], ['all', 'All time']
];

/** { from, to } as yyyy-mm-dd ('' = open end) for a period chip. "This year" is the 1 April financial year. */
export function periodRange(id, now = new Date(), earliest = '') {
  const to = iso(now);
  const back = (days) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  if (id === '30d') return { from: back(29), to };
  if (id === '90d') return { from: back(89), to };
  if (id === '6m') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 5, 1)), to };
  if (id === '12m') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 11, 1)), to };
  if (id === 'fy') return { from: iso(financialYearStart(now)), to };
  return { from: earliest || '', to };
}

/** The months a chart should show for a range: at least 3 and at most 12, ending this month. */
export function monthsForRange(range, now = new Date()) {
  const from = range.from ? new Date(`${range.from}T00:00:00`) : null;
  let count = from ? (now.getFullYear() - from.getFullYear()) * 12 + now.getMonth() - from.getMonth() + 1 : 12;
  count = Math.max(3, Math.min(12, count));
  return count;
}

/** Apply the owner's filters. Payments carry no metal or item, so they only pass when no metal/item filter is set. */
export function filterSales(sales, { from = '', to = '', metal = '', category = '', customerId = '' } = {}) {
  return (sales || []).filter((row) => {
    const d = day(row.date);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (customerId && row.customerId !== customerId) return false;
    if (row.kind === PAYMENT) return !metal && !category;
    if (metal && String(row.metalType || '').toUpperCase() !== metal) return false;
    if (category && String(row.category || '') !== category) return false;
    return true;
  });
}
