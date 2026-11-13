/** The people side of the shop: who to call, whose day is coming, who has dues, what was said last time. */

export const NOTE_KINDS = ['Note', 'Call', 'Visit', 'WhatsApp'];
export const CUSTOMER_TAGS = ['Regular', 'VIP', 'Wholesale'];
export const SUPPLIER_TAGS = ['Karigar', 'Wholesaler', 'Other'];

export const digits = (v) => String(v || '').replace(/\D/g, '');

/** A 10-digit Indian mobile gets the 91 country code that WhatsApp links need. */
export function whatsappNumber(phone) {
  const d = digits(phone);
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return d.length >= 11 ? d : '';
}

export const telLink = (phone) => (digits(phone).length >= 6 ? `tel:+${whatsappNumber(phone) || digits(phone)}` : '');
export const whatsappLink = (phone, text = '') => {
  const n = whatsappNumber(phone);
  if (!n) return '';
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
};
export const mailLink = (email) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim()) ? `mailto:${String(email).trim()}` : '');

export function duesReminderText({ shopName, name, amountInr }) {
  const amount = `₹${Number(amountInr || 0).toLocaleString('en-IN')}`;
  return `Namaste ${name}, a gentle reminder from ${shopName || 'our shop'}: ${amount} is pending on your account. Please let us know when it suits you. Thank you.`;
}

const ymd = (d) => {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const dayNumber = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
};

export function daysUntil(dateIso, todayIso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(dateIso || ''))) return null;
  return dayNumber(dateIso) - dayNumber(todayIso);
}

/** Follow-ups that are overdue, due today, or due within `windowDays`. Overdue first. */
export function dueFollowUps(parties, todayIso, windowDays = 3) {
  return (parties || [])
    .map((p) => ({ party: p, days: daysUntil(p.followUpDate, todayIso) }))
    .filter((x) => x.days !== null && x.days <= windowDays)
    .sort((a, b) => a.days - b.days);
}

/** Birthdays and anniversaries in the next `windowDays`, ignoring the year. */
export function upcomingDates(customers, todayIso, windowDays = 7) {
  const out = [];
  const today = new Date(`${todayIso}T00:00:00`);
  for (const c of customers || []) {
    for (const [field, label] of [['birthday', 'Birthday'], ['anniversary', 'Anniversary']]) {
      const raw = String(c[field] || '').slice(0, 10);
      const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(raw) || /^(\d{2})-(\d{2})$/.exec(raw);
      if (!m) continue;
      let next = new Date(today.getFullYear(), Number(m[1]) - 1, Number(m[2]));
      if (ymd(next) < todayIso) next = new Date(today.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]));
      const days = daysUntil(ymd(next), todayIso);
      if (days !== null && days <= windowDays) out.push({ customer: c, label, days, on: ymd(next) });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

export function notesFor(interactions, partyId) {
  return (interactions || [])
    .filter((n) => n.partyId === partyId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function removeInteractionsFor(list, partyId) {
  return (list || []).filter((n) => String(n.partyId) !== String(partyId));
}

export function whenLabel(days) {
  if (days === null || days === undefined) return '';
  if (days < -1) return `${-days} days overdue`;
  if (days === -1) return 'Yesterday';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}
