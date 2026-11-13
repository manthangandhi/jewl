/** Numbers a shop owner can act on: trends, who buys, who owes, what sells. Pure functions, no screen code. */
import { SALE, RETURN, PAYMENT, customerBalance } from './customer-math.js';

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
    if (row.kind === PAYMENT || row.kind === RETURN) continue;
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
    if (row.kind === PAYMENT || (from && day(row.date) < from)) continue;
    const e = (by[row.customerId] ||= { id: row.customerId, name: name[row.customerId] || 'Customer', soldInr: 0, returnedInr: 0, visits: 0 });
    if (row.kind === RETURN) e.returnedInr += num(row.amountInr);
    else { e.soldInr += num(row.amountInr); e.visits += 1; }
  }
  return Object.values(by).map((e) => ({ ...e, netInr: e.soldInr - e.returnedInr })).sort((a, b) => b.netInr - a.netInr).slice(0, limit);
}

/** Money customers owe us, split by how long since the customer last had any entry. */
export function duesAgeing(customers, sales, now = new Date()) {
  const buckets = [
    { id: 'new', label: 'Under 30 days', amountInr: 0, count: 0 },
    { id: 'mid', label: '30 to 60 days', amountInr: 0, count: 0 },
    { id: 'old', label: 'Over 60 days', amountInr: 0, count: 0 }
  ];
  const t = now.getTime();
  for (const c of customers || []) {
    const bal = customerBalance(sales, c.id);
    if (bal <= 0) continue;
    const last = (sales || []).filter((r) => r.customerId === c.id).map((r) => day(r.date)).sort().pop();
    const age = last ? Math.floor((t - Date.parse(last)) / 86400000) : 0;
    const b = age > 60 ? buckets[2] : age > 30 ? buckets[1] : buckets[0];
    b.amountInr += bal;
    b.count += 1;
  }
  return buckets;
}

/** Customers who bought before but have been quiet for `days`, most valuable first. */
export function quietCustomers(customers, sales, { days = 90, now = new Date(), limit = 5 } = {}) {
  const t = now.getTime();
  const out = [];
  for (const c of customers || []) {
    const mine = (sales || []).filter((r) => r.customerId === c.id && r.kind === SALE);
    if (!mine.length) continue;
    const last = mine.map((r) => day(r.date)).sort().pop();
    const quiet = Math.floor((t - Date.parse(last)) / 86400000);
    if (quiet >= days) out.push({ id: c.id, name: c.name, phone: c.phone || '', quietDays: quiet, lifetimeInr: mine.reduce((n, r) => n + num(r.amountInr), 0) });
  }
  return out.sort((a, b) => b.lifetimeInr - a.lifetimeInr).slice(0, limit);
}

/** Percent change from `before` to `now`, or null when there is nothing to compare against. */
export function changePct(now, before) {
  return before > 0 ? Math.round(((now - before) / before) * 100) : null;
}
