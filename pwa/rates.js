/**
 * Live metal rates. Prices come from two free public feeds (no account, no key):
 *   gold-api.com   spot gold, silver and platinum in US dollars per troy ounce
 *   open.er-api.com   dollars to rupees
 * Rupees per gram = spot x dollar rate / 31.1035, then times the purity, then the shop's own adjustment.
 * It is the international price, not a local board rate: Indian rates add import duty and GST, so the
 * owner can add a percentage, or type a board rate on the Metals page, which always wins.
 */

export const GRAMS_PER_TROY_OUNCE = 31.1034768;
export const RATE_FEEDS = {
  gold: 'https://api.gold-api.com/price/XAU',
  silver: 'https://api.gold-api.com/price/XAG',
  platinum: 'https://api.gold-api.com/price/XPT',
  usdInr: 'https://open.er-api.com/v6/latest/USD'
};

const FIXED_PURITY = {
  GOLD: { '24K': 1, '22K': 22 / 24, '18K': 18 / 24, '14K': 14 / 24 },
  SILVER: { 999: 0.999, 925: 0.925 },
  PLATINUM: { 950: 0.95, 900: 0.9 }
};

/** The share of pure metal in a purity label such as 22K, 925 or 950. */
export function purityFactor(metalType, purity) {
  const type = String(metalType || '').toUpperCase();
  const label = String(purity || '').trim().toUpperCase();
  const known = FIXED_PURITY[type]?.[label];
  if (known) return known;
  const karat = /^(\d{1,2})K$/.exec(label);
  if (karat) return Number(karat[1]) / 24;
  const fineness = /^\d{3}$/.exec(label);
  if (fineness) return Number(label) / 1000;
  return 0;
}

export function ratePerGram({ spotUsdPerOunce, usdInr, metalType, purity, premiumPct = 0 }) {
  const factor = purityFactor(metalType, purity);
  const spot = Number(spotUsdPerOunce);
  const fx = Number(usdInr);
  if (!(factor > 0 && spot > 0 && fx > 0)) return 0;
  const pure = (spot * fx) / GRAMS_PER_TROY_OUNCE;
  return Math.round(pure * factor * (1 + Number(premiumPct || 0) / 100));
}

/** Rate for one metal and purity from a fetched snapshot, or 0 when it is not known. */
export function liveRate(snapshot, metalType, purity, premiumPct = 0) {
  if (!snapshot) return 0;
  const key = String(metalType || '').toLowerCase();
  return ratePerGram({ spotUsdPerOunce: snapshot[key], usdInr: snapshot.usdInr, metalType, purity, premiumPct });
}

/** The board rate the owner typed wins; otherwise the live rate; otherwise nothing. */
export function effectiveRate({ master = [], snapshot = null, premiumPct = 0 }, metalType, purity) {
  const type = String(metalType || '').toUpperCase();
  const row = master.find((r) => String(r.metalType || '').toUpperCase() === type && String(r.purity) === String(purity)
    && String(r.status || 'ACTIVE').toUpperCase() !== 'INACTIVE');
  const manual = Number(row?.rateInrPerGram || 0);
  if (manual > 0) return { perGram: manual, source: 'board' };
  const live = liveRate(snapshot, type, purity, premiumPct);
  return live > 0 ? { perGram: live, source: 'live' } : { perGram: 0, source: 'none' };
}

export function suggestedAmount(weightGrams, perGram) {
  const w = Number(weightGrams);
  const r = Number(perGram);
  if (!(w > 0 && r > 0)) return 0;
  return Math.round(w * r);
}

export function ratesAreStale(fetchedAt, now = Date.now(), maxMinutes = 10) {
  const t = typeof fetchedAt === 'number' ? fetchedAt : Date.parse(fetchedAt);
  return !Number.isFinite(t) || now - t > maxMinutes * 60000;
}

export function describeAge(fetchedAt, now = Date.now()) {
  const t = typeof fetchedAt === 'number' ? fetchedAt : Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return '';
  if (now - t < 60000) return 'just now';
  const minutes = Math.round((now - t) / 60000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Rate feed answered ${res.status}`);
  return res.json();
}

/** One snapshot: dollars per ounce for each metal plus the dollar-rupee rate. Throws if any piece is missing. */
export async function fetchLiveRates(fetchFn = fetch, now = Date.now()) {
  const [gold, silver, platinum, fx] = await Promise.all([
    getJson(fetchFn, RATE_FEEDS.gold),
    getJson(fetchFn, RATE_FEEDS.silver),
    getJson(fetchFn, RATE_FEEDS.platinum),
    getJson(fetchFn, RATE_FEEDS.usdInr)
  ]);
  const snapshot = {
    gold: Number(gold?.price),
    silver: Number(silver?.price),
    platinum: Number(platinum?.price),
    usdInr: Number(fx?.rates?.INR),
    fetchedAt: now,
    feedTime: gold?.updatedAt || ''
  };
  for (const key of ['gold', 'silver', 'platinum', 'usdInr']) {
    if (!(snapshot[key] > 0)) throw new Error('The rate feed sent a price that makes no sense');
  }
  return snapshot;
}
