/**
 * Live metal rates for an Indian jewellery shop.
 *
 * Where the numbers come from (free public feeds, no account, no key):
 *   gold-api.com  spot gold, silver and platinum in US dollars per troy ounce   (second opinion: Coinbase spot)
 *   open.er-api.com  US dollars to rupees
 * International price in rupees per gram = spot x dollar rate / 31.1035.
 * That is the world "parity" price. A shop in India pays customs duty on top, so the number a dealer
 * quotes is higher. The app therefore adds an editable adjustment per metal (starting at India's import
 * duty), and the owner can calibrate it to match what their own dealer quotes. A board rate typed on the
 * Metals page always wins over everything here.
 */

export const GRAMS_PER_TROY_OUNCE = 31.1034768;

export const RATE_FEEDS = {
  gold: 'https://api.gold-api.com/price/XAU',
  silver: 'https://api.gold-api.com/price/XAG',
  platinum: 'https://api.gold-api.com/price/XPT',
  usdInr: 'https://open.er-api.com/v6/latest/USD'
};
export const SECOND_OPINION = {
  gold: 'https://api.coinbase.com/v2/prices/XAU-USD/spot',
  silver: 'https://api.coinbase.com/v2/prices/XAG-USD/spot',
  platinum: 'https://api.coinbase.com/v2/prices/XPT-USD/spot'
};

/** India's customs duty on bullion (percent) as the starting point; the owner can change each one. */
export const DEFAULT_ADJUST = { GOLD: 6, SILVER: 6, PLATINUM: 6.4 };

/** Believable ranges, so a broken feed can never put a silly number on the screen. */
const SANE = { gold: [500, 20000], silver: [3, 600], platinum: [200, 10000], usdInr: [40, 200] };

const FIXED_PURITY = {
  GOLD: { '24K': 1, '22K': 22 / 24, '18K': 18 / 24, '14K': 14 / 24 },
  SILVER: { 999: 0.999, 925: 0.925 },
  PLATINUM: { 950: 0.95, 900: 0.9 }
};

export function purityFactor(metalType, purity) {
  const type = String(metalType || '').toUpperCase();
  const label = String(purity || '').trim().toUpperCase();
  const known = FIXED_PURITY[type]?.[label];
  if (known) return known;
  const karat = /^(\d{1,2})K$/.exec(label);
  if (karat) return Number(karat[1]) / 24;
  if (/^\d{3}$/.test(label)) return Number(label) / 1000;
  return 0;
}

export function adjustFor(adjust, metalType) {
  const type = String(metalType || '').toUpperCase();
  const own = adjust && adjust[type];
  return Number.isFinite(Number(own)) && own !== '' && own !== null && own !== undefined ? Number(own) : (DEFAULT_ADJUST[type] ?? 0);
}

/** Rupees per gram of the metal at this purity, before any adjustment: the world price. */
export function parityPerGram({ spotUsdPerOunce, usdInr, metalType, purity }) {
  const factor = purityFactor(metalType, purity);
  const spot = Number(spotUsdPerOunce);
  const fx = Number(usdInr);
  if (!(factor > 0 && spot > 0 && fx > 0)) return 0;
  return ((spot * fx) / GRAMS_PER_TROY_OUNCE) * factor;
}

export function ratePerGram({ spotUsdPerOunce, usdInr, metalType, purity, premiumPct = 0 }) {
  const parity = parityPerGram({ spotUsdPerOunce, usdInr, metalType, purity });
  return parity ? Math.round(parity * (1 + Number(premiumPct || 0) / 100)) : 0;
}

export function liveRate(snapshot, metalType, purity, premiumPct = 0) {
  if (!snapshot) return 0;
  return ratePerGram({ spotUsdPerOunce: snapshot[String(metalType || '').toLowerCase()], usdInr: snapshot.usdInr, metalType, purity, premiumPct });
}

export function parityRate(snapshot, metalType, purity) {
  if (!snapshot) return 0;
  return Math.round(parityPerGram({ spotUsdPerOunce: snapshot[String(metalType || '').toLowerCase()], usdInr: snapshot.usdInr, metalType, purity }));
}

/**
 * The rate to show and to price a sale with. Owner's board rate first, then live with the adjustment.
 * `adjust` is { GOLD: 6, SILVER: 6, PLATINUM: 6.4 } (percent over the world price).
 */
export function effectiveRate({ master = [], snapshot = null, adjust = DEFAULT_ADJUST, now = Date.now() }, metalType, purity) {
  const type = String(metalType || '').toUpperCase();
  const row = master.find((r) => String(r.metalType || '').toUpperCase() === type && String(r.purity) === String(purity)
    && String(r.status || 'ACTIVE').toUpperCase() !== 'INACTIVE');
  const manual = Number(row?.rateInrPerGram || 0);
  if (manual > 0 && boardRateIsToday(row, now)) return { perGram: manual, source: 'board' };
  const live = liveRate(snapshot, type, purity, adjustFor(adjust, type));
  return live > 0 ? { perGram: live, source: 'live' } : { perGram: 0, source: 'none' };
}

/**
 * A board rate is today's rate. One typed on an earlier day is old news and must not hide the live price,
 * so it only counts when it was saved on the same calendar day. A row with no save date counts (older data).
 */
export function boardRateIsToday(row, now = Date.now()) {
  const raw = row?.updatedAt;
  if (!raw) return true;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return true;
  return new Date(t).toDateString() === new Date(now).toDateString();
}

/** What the adjustment must be for the world price to equal the rate the owner's dealer quoted (per gram). */
export function calibrateAdjust({ snapshot, metalType, purity, dealerPerGram }) {
  const parity = parityRate(snapshot, metalType, purity);
  const dealer = Number(dealerPerGram);
  if (!(parity > 0 && dealer > 0)) return null;
  const pct = Math.round((dealer / parity - 1) * 1000) / 10;
  return pct < -30 || pct > 40 ? null : pct;
}

export const DEALER_UNITS = { gram: 1, '10g': 10, kg: 1000 };
export function perGramFromUnit(amount, unit) {
  const per = DEALER_UNITS[unit] || 1;
  const n = Number(amount);
  return n > 0 ? n / per : 0;
}

/** The way shops quote it: gold and platinum per 10 grams, silver per kilogram. */
export function dealerQuote(metalType, perGram) {
  const type = String(metalType || '').toUpperCase();
  const n = Number(perGram || 0);
  if (!(n > 0)) return null;
  if (type === 'SILVER') return { unit: 'kg', amount: Math.round(n * 1000), label: 'per kg' };
  return { unit: '10g', amount: Math.round(n * 10), label: 'per 10 g' };
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

const sane = (key, n) => Number.isFinite(n) && n >= SANE[key][0] && n <= SANE[key][1];

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Rate feed answered ${res.status}`);
  return res.json();
}

async function spotFrom(fetchFn, key) {
  try {
    const n = Number((await getJson(fetchFn, RATE_FEEDS[key]))?.price);
    if (sane(key, n)) return { value: n, source: 'gold-api.com' };
  } catch { /* fall through to the second feed */ }
  try {
    const n = Number((await getJson(fetchFn, SECOND_OPINION[key]))?.data?.amount);
    if (sane(key, n)) return { value: n, source: 'Coinbase' };
  } catch { /* nothing left to try */ }
  return null;
}

async function crossCheck(fetchFn, key) {
  try {
    const n = Number((await getJson(fetchFn, SECOND_OPINION[key]))?.data?.amount);
    return sane(key, n) ? n : 0;
  } catch { return 0; }
}

/**
 * One snapshot of the world price. Each metal tries its main feed, then the second one. The dollar rate falls
 * back to the last one we had (up to 3 days) if its feed is down. A second opinion for gold is compared so a
 * disagreement above 3% can be shown to the owner instead of hidden.
 */
export async function fetchLiveRates(fetchFn = fetch, now = Date.now(), previous = null) {
  const [gold, silver, platinum, fx, goldCheck] = await Promise.all([
    spotFrom(fetchFn, 'gold'), spotFrom(fetchFn, 'silver'), spotFrom(fetchFn, 'platinum'),
    getJson(fetchFn, RATE_FEEDS.usdInr).then((j) => Number(j?.rates?.INR)).catch(() => 0),
    crossCheck(fetchFn, 'gold')
  ]);
  let usdInr = fx;
  let fxStale = false;
  if (!sane('usdInr', usdInr)) {
    const old = previous && sane('usdInr', Number(previous.usdInr)) && now - Number(previous.fetchedAt) < 3 * 86400000 ? Number(previous.usdInr) : 0;
    if (!old) throw new Error('Could not get the dollar-rupee rate');
    usdInr = old;
    fxStale = true;
  }
  if (!gold) throw new Error('Could not get the gold price');
  const spots = { gold, silver, platinum };
  const missing = Object.entries(spots).filter(([, v]) => !v).map(([k]) => k);
  const snapshot = {
    gold: gold.value,
    silver: silver?.value || (previous?.silver ?? 0),
    platinum: platinum?.value || (previous?.platinum ?? 0),
    usdInr,
    fetchedAt: now,
    sources: [...new Set(Object.values(spots).filter(Boolean).map((v) => v.source))],
    missing,
    fxStale,
    disagreePct: goldCheck ? Math.round(Math.abs(goldCheck / gold.value - 1) * 1000) / 10 : 0
  };
  if (!(snapshot.silver > 0) || !(snapshot.platinum > 0)) snapshot.missing = [...new Set([...missing, ...(!(snapshot.silver > 0) ? ['silver'] : []), ...(!(snapshot.platinum > 0) ? ['platinum'] : [])])];
  return snapshot;
}
