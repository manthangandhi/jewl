/**
 * License checks done by the app itself, not only by the shop's Apps Script.
 * The app asks the license server about this shop's key when it opens and every few minutes while it is
 * open. If the plan has ended the books are hidden at once, not on the next save.
 * A short offline grace stops a bad connection from locking a paying shop out.
 */

export const GRACE_HOURS = 72;
export const RECHECK_MINUTES = 5;

const DAY = 86400000;

export function isConfiguredUrl(url) {
  const u = String(url || '').trim();
  return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(u);
}

export function normalizeVerdict(json) {
  const j = json && typeof json === 'object' ? json : {};
  const status = String(j.status || '').trim().toUpperCase();
  const allowed = j.allowed === true && (status === '' || status === 'ACTIVE' || status === 'TRIAL');
  return {
    allowed,
    status: status || (allowed ? 'ACTIVE' : 'INACTIVE'),
    shopName: String(j.shopName || ''),
    trialEndsAt: String(j.trialEndsAt || ''),
    paidUntil: String(j.paidUntil || ''),
    error: String(j.error || '')
  };
}

/** Whole days until the plan ends, or null when there is no end date. */
export function daysLeft(verdict, now = Date.now()) {
  if (!verdict) return null;
  const raw = verdict.status === 'TRIAL' ? verdict.trialEndsAt : verdict.paidUntil;
  const end = Date.parse(raw);
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - now) / DAY);
}

export function endDateLabel(verdict) {
  const raw = verdict?.status === 'TRIAL' ? verdict.trialEndsAt : verdict?.paidUntil;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A short line for the owner, or '' when there is nothing worth saying. */
export function planNotice(verdict, now = Date.now()) {
  if (!verdict || !verdict.allowed) return '';
  const left = daysLeft(verdict, now);
  if (left === null || left > 7) return '';
  const what = verdict.status === 'TRIAL' ? 'Your trial' : 'Your plan';
  if (left <= 0) return `${what} ends today.`;
  return `${what} ends in ${left} ${left === 1 ? 'day' : 'days'}.`;
}

export function whyBlocked(verdict) {
  if (!verdict) return 'We could not check your plan.';
  const when = endDateLabel(verdict);
  if (verdict.error && /unknown|missing/i.test(verdict.error)) return 'This license key was not recognised.';
  if (verdict.status === 'TRIAL') return when ? `Your free trial ended on ${when}.` : 'Your free trial has ended.';
  if (verdict.status === 'ACTIVE' || verdict.status === 'INACTIVE') return when ? `Your plan ended on ${when}.` : 'The plan for this shop is not active right now.';
  return 'The plan for this shop is not active right now.';
}

/**
 * Ask the license server. Returns { kind: 'allowed' | 'denied' | 'unreachable', verdict }.
 * "Denied" is a real answer from the server. "Unreachable" is a network or server failure.
 */
export async function verifyDirect(fetchFn, url, key) {
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'verify', key })
    });
    const text = await res.text();
    if (!res.ok || /^\s*</.test(text)) return { kind: 'unreachable', verdict: null };
    let json;
    try { json = JSON.parse(text); } catch { return { kind: 'unreachable', verdict: null }; }
    if (!json || json.ok !== true) return { kind: 'unreachable', verdict: null };
    const verdict = normalizeVerdict(json);
    return { kind: verdict.allowed ? 'allowed' : 'denied', verdict };
  } catch {
    return { kind: 'unreachable', verdict: null };
  }
}

/**
 * What to do with the answer.
 *   allowed      the plan is active
 *   grace        the server cannot be reached but it said yes recently, so keep going
 *   offline      the server cannot be reached and has not said yes lately: ask for a connection
 *   denied       the server said no: lock now, no grace
 */
export function decide({ result, lastOkAt = 0, now = Date.now() }) {
  if (result.kind === 'allowed') return 'allowed';
  if (result.kind === 'denied') return 'denied';
  return lastOkAt && now - lastOkAt < GRACE_HOURS * 3600000 ? 'grace' : 'offline';
}
