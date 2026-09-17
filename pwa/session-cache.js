export const CACHE_VERSION = 1;

export function toLedgerSnapshot(data) {
  const meta = data?.meta || {};
  return {
    v: CACHE_VERSION,
    meta,
    shopName: data?.shopName || meta.shopName || '',
    spreadsheetUrl: data?.spreadsheetUrl || '',
    lastSavedAt: data?.lastSavedAt || meta.lastSavedAt || '',
    suppliers: Array.isArray(data?.suppliers) ? data.suppliers : [],
    money: Array.isArray(data?.money) ? data.money : [],
    metal: Array.isArray(data?.metal) ? data.metal : [],
    settlements: Array.isArray(data?.settlements) ? data.settlements : [],
    metalMaster: Array.isArray(data?.metalMaster) ? data.metalMaster : []
  };
}

export function fromLedgerSnapshot(raw) {
  if (!raw || raw.v !== CACHE_VERSION || !Array.isArray(raw.suppliers)) return null;
  return toLedgerSnapshot(raw);
}

export function pinFingerprint(execUrl, pin) {
  return `${String(execUrl || '').trim()}::${String(pin || '').trim()}`;
}

export function localPinMatches(storedFingerprint, execUrl, pin) {
  if (!storedFingerprint) return false;
  return storedFingerprint === pinFingerprint(execUrl, pin);
}

export function toSessionUnlock({ sheetsUrl, pin } = {}) {
  const url = String(sheetsUrl || '').trim();
  const p = String(pin || '').trim();
  if (!url || !p) return null;
  return { v: 1, sheetsUrl: url, pin: p };
}

export function fromSessionUnlock(raw) {
  if (!raw || raw.v !== 1) return null;
  return toSessionUnlock({ sheetsUrl: raw.sheetsUrl, pin: raw.pin });
}
