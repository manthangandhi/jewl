import { summarizeLedger, buildPassbook, rangeForPreset, reportForRange, reportCsv, puritiesForType } from './ledger-math.js';
import {
  emptyLedger, upsertById, removeById, deleteSupplierCascade, prepareSavePayload, mergeJournals, seedMetalMaster,
  dedupePartyLedger, dealIsValid, splitDeal, partyDisplayName, assertPartyName
} from './sheet-model.js';
import { normalizeAppsScriptUrl, googleHttpErrorMessage, verifyPin, parseSpreadsheetId, fillScriptConstants, explainLedgerError } from './sheets-client.js';
import { toLedgerSnapshot, fromLedgerSnapshot, toSessionUnlock, fromSessionUnlock } from './session-cache.js';
import { admitUnlock, applyPinKey, shouldHandlePinKeyboard } from './shop-auth.js';
import { resolveTourClick, applyTourNav } from './tour.js';

const URL_KEY = 'karigar.appsScriptUrl';
const CACHE_KEY = 'karigar.ledgerCache';
const PIN_FP_KEY = 'karigar.pinFp';
const SESSION_UNLOCK_KEY = 'karigar.sessionUnlock';
const TOUR_KEY = 'karigar.tourDone';
const TOUR = [
  { title: 'One card per party', body: 'A party is one karigar or supplier. Do not add another card for their phone number, or a separate card for gold vs silver. Cash and every metal sit on the same khata.' },
  { title: 'Hume dena / Unse lena', body: 'Hume dena = we owe them rupees. Unse lena = they owe us. Metal with the party shows as pills such as GOLD 22K and SILVER 999.' },
  { title: 'Purchase and payment', body: 'On Purchase you can save rupees, metal, or both together. “Gave metal” is metal you issued. “Got metal” is metal that came back. Add more metal lines for gold and silver in the same bill.' },
  { title: 'Give / Get metal', body: 'Use these when you only move metal, with no rupee amount. Repeat for any metal and any party.' },
  { title: 'Refresh data', body: 'Tap Refresh data to reload the Google Sheet. Browser refresh will PIN-check this tab. Lock signs you out.' }
];
const root = document.querySelector('#app');
const emptyTrack = () => ({ suppliers: [], money: [], metal: [], settlements: [], metalMaster: [] });
const state = {
  ...emptyLedger(),
  sheetsUrl: '',
  pin: '',
  spreadsheetUrl: '',
  shopName: '',
  view: 'parties',
  supplierId: null,
  summary: null,
  modal: null,
  editing: null,
  error: null,
  unlocked: false,
  search: '',
  setupOpen: false,
  gate: 'choice',
  setupStep: 1,
  setupDraft: { shopName: '', pin: '', licenseKey: '', sheetUrl: '', sheetId: '', execUrl: '', copied: false },
  lastSavedAt: '',
  saving: false,
  syncing: false,
  lockDigits: '',
  metalMaster: seedMetalMaster([]),
  reportPreset: 'month',
  reportFrom: '',
  reportTo: '',
  partyFilter: 'all',
  dealMetalCount: 1,
  tourStep: null,
  dirty: emptyTrack(),
  deleted: emptyTrack()
};

const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const grams = (v) => `${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })} g`;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[x]));
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const nid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}`);
const partyLabel = (party) => partyDisplayName(party) || 'Party';
const supplierName = (id) => partyLabel(state.suppliers.find((s) => s.id === id) || {});
const initials = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || 'P') + (parts[1]?.[0] || '')).toUpperCase();
};
function ic(name) {
  const paths = {
    parties: '<path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="9" cy="7" r="3"/><path d="M22 19v-1a4 4 0 0 0-3-3.87"/><path d="M16 3.13a3 3 0 0 1 0 5.74"/>',
    today: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
    sheet: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8 13h8M8 17h5"/>',
    report: '<path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.8.4-1.4 1-1.4 1.7"/><path d="M12 17h.01"/>',
    masters: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'
  };
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function moneyDirection(payable) {
  if (Number(payable) > 0) return { label: 'Hume dena', hindi: 'We owe them', amount: Number(payable), tone: 'owe' };
  if (Number(payable) < 0) return { label: 'Unse lena', hindi: 'They owe us', amount: -Number(payable), tone: 'collect' };
  return { label: 'Square', hindi: 'Settled', amount: 0, tone: 'square' };
}

function metalTypeOptions(selected) {
  const types = [...new Set((state.metalMaster || []).map((row) => row.metalType).filter(Boolean))];
  const list = types.length ? types : ['GOLD', 'SILVER'];
  return list.map((t) => `<option value="${esc(t)}" ${t === selected ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

function purityOptions(metalType, selected) {
  const list = puritiesForType(state.metalMaster, metalType || 'GOLD');
  const extra = selected && !list.includes(selected) ? [selected, ...list] : list;
  return extra.map((p) => `<option value="${esc(p)}" ${p === selected ? 'selected' : ''}>${esc(p)}</option>`).join('');
}

function rateFor(metalType, purity) {
  const row = (state.metalMaster || []).find((r) => r.metalType === metalType && r.purity === purity && String(r.status || 'ACTIVE') !== 'INACTIVE');
  const n = Number(row?.rateInrPerGram || 0);
  return n > 0 ? n : 0;
}

function markDirty(kind, id) {
  const list = state.dirty[kind] || [];
  if (id && !list.includes(id)) state.dirty[kind] = list.concat(id);
}

function markDeleted(kind, id) {
  const list = state.deleted[kind] || [];
  if (id && !list.includes(id)) state.deleted[kind] = list.concat(id);
}

function metalPills(map) {
  const entries = Object.entries(map || {}).filter(([, v]) => Number(v) !== 0);
  if (!entries.length) return '';
  return `<div class="metal-pills">${entries.map(([key, v]) => `<span class="pill">${esc(String(key).replace(':', ' '))} · ${grams(v)}</span>`).join('')}</div>`;
}

function refreshSummary() {
  state.summary = summarizeLedger(state.suppliers, state.money, state.metal, state.settlements);
  if (state.view === 'supplier' && state.supplierId) {
    const supplier = state.suppliers.find((s) => s.id === state.supplierId);
    const row = state.summary.bySupplier.find((r) => r.id === state.supplierId);
    state.detail = supplier ? {
      supplier,
      payable: row?.payable || 0,
      metalByPurity: row?.metalByPurity || {},
      passbook: buildPassbook({
        supplierId: supplier.id,
        money: state.money,
        metal: state.metal,
        settlements: state.settlements
      })
    } : null;
  } else {
    state.detail = null;
  }
}

async function sheetsRequest(payload) {
  const execUrl = normalizeAppsScriptUrl(state.sheetsUrl);
  const res = await fetch(execUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, pin: state.pin })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(googleHttpErrorMessage(res.status, text));
  if (/^\s*</.test(text) || /that.?s an error/i.test(text)) throw new Error(googleHttpErrorMessage(res.status || 401, text));
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(googleHttpErrorMessage(res.status, text)); }
  if (!data.ok) throw new Error(data.error || 'Unknown error');
  return data;
}

function applyLoaded(data) {
  const incoming = {
    meta: data.meta || state.meta,
    suppliers: Array.isArray(data.suppliers) ? data.suppliers : [],
    money: Array.isArray(data.money) ? data.money : [],
    metal: Array.isArray(data.metal) ? data.metal : [],
    settlements: Array.isArray(data.settlements) ? data.settlements : [],
    metalMaster: seedMetalMaster(Array.isArray(data.metalMaster) ? data.metalMaster : [])
  };
  const cleaned = dedupePartyLedger(incoming);
  const before = (incoming.suppliers || []).map((s) => `${s.id}|${s.name}|${s.phone}`).join(';');
  const after = (cleaned.suppliers || []).map((s) => `${s.id}|${s.name}|${s.phone}`).join(';');
  state.needsDedupeSave = before !== after;
  state.meta = cleaned.meta;
  state.shopName = data.shopName || cleaned.meta?.shopName || state.shopName;
  state.suppliers = cleaned.suppliers;
  state.money = cleaned.money;
  state.metal = cleaned.metal;
  state.settlements = cleaned.settlements;
  state.metalMaster = cleaned.metalMaster;
  state.spreadsheetUrl = data.spreadsheetUrl || state.spreadsheetUrl || '';
  state.lastSavedAt = data.lastSavedAt || data.meta?.lastSavedAt || state.lastSavedAt;
  state.unlocked = true;
  state.dirty = emptyTrack();
  state.deleted = emptyTrack();
  refreshSummary();
}

function readCache() {
  try {
    return fromLedgerSnapshot(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'));
  } catch {
    return null;
  }
}

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(toLedgerSnapshot(state)));
  } catch { /* ignore quota */ }
}

async function copyOwnerScript() {
  const res = await fetch('./google-apps-script.gs', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load the Karigar script. Check you are on http://localhost:3000');
  let licenseUrl = '';
  try {
    const lic = await fetch('./license-url.txt', { cache: 'no-store' });
    if (lic.ok) licenseUrl = (await lic.text()).trim().split('\n')[0].trim();
  } catch { /* optional until you deploy your license API */ }
  if (!licenseUrl) throw new Error('This Karigar copy has no license server yet. The operator must put their license /exec URL in pwa/license-url.txt');
  const filled = fillScriptConstants(await res.text(), {
    sheetId: state.setupDraft.sheetId,
    pin: state.setupDraft.pin,
    licenseKey: state.setupDraft.licenseKey,
    licenseUrl
  });
  try {
    await navigator.clipboard.writeText(filled);
  } catch {
    throw new Error('Allow clipboard, or copy from the Apps Script file in the project.');
  }
  state.setupDraft.copied = true;
  state.error = null;
  landing();
}

function forgetLocalPin() {
  try { localStorage.removeItem(PIN_FP_KEY); } catch { /* ignore */ }
}

function writeSessionUnlock() {
  const rec = toSessionUnlock({ sheetsUrl: state.sheetsUrl, pin: state.pin });
  try {
    if (rec) sessionStorage.setItem(SESSION_UNLOCK_KEY, JSON.stringify(rec));
    else sessionStorage.removeItem(SESSION_UNLOCK_KEY);
  } catch { /* ignore */ }
}

function readSessionUnlock() {
  try {
    return fromSessionUnlock(JSON.parse(sessionStorage.getItem(SESSION_UNLOCK_KEY) || 'null'));
  } catch {
    return null;
  }
}

function forgetSessionUnlock() {
  try { sessionStorage.removeItem(SESSION_UNLOCK_KEY); } catch { /* ignore */ }
}

async function refreshFromSheet() {
  state.syncing = true;
  render();
  try {
    const remote = await sheetsRequest({ action: 'load' });
    const merged = {
      meta: remote.meta,
      shopName: remote.meta?.shopName || state.shopName,
      spreadsheetUrl: remote.spreadsheetUrl,
      lastSavedAt: remote.meta?.lastSavedAt || remote.lastSavedAt,
      suppliers: mergeJournals(remote.suppliers || [], state.suppliers, { deletedIds: state.deleted.suppliers, dirtyIds: state.dirty.suppliers }),
      money: mergeJournals(remote.money || [], state.money, { deletedIds: state.deleted.money, dirtyIds: state.dirty.money }),
      metal: mergeJournals(remote.metal || [], state.metal, { deletedIds: state.deleted.metal, dirtyIds: state.dirty.metal }),
      settlements: mergeJournals(remote.settlements || [], state.settlements, { deletedIds: state.deleted.settlements, dirtyIds: state.dirty.settlements }),
      metalMaster: mergeJournals(remote.metalMaster || [], state.metalMaster, { deletedIds: state.deleted.metalMaster, dirtyIds: state.dirty.metalMaster })
    };
    applyLoaded(merged);
    writeCache();
    state.error = null;
    if (state.needsDedupeSave) {
      state.needsDedupeSave = false;
      await persist();
    }
  } catch (error) {
    const msg = String(error.message || '');
    if (/wrong shop pin|does not unlock/i.test(msg)) {
      forgetLocalPin();
      state.unlocked = false;
      state.pin = '';
      state.error = explainLedgerError(error);
      return landing();
    }
    state.error = error.message;
  } finally {
    state.syncing = false;
    if (state.unlocked) render();
  }
}

async function seedDemoIntoSheet() {
  if (!confirm('Write a 3-month DEMO khata into this Google Sheet? Sample rows use demo- ids. Real parties stay. Do not use this on a live shop.')) return;
  state.syncing = true;
  render();
  try {
    const result = await sheetsRequest({ action: 'seedDemo', replace: true });
    if (result.seeded === false) {
      state.error = 'Sheet already has parties. Sample khata was not written.';
      return;
    }
    await refreshFromSheet();
  } catch (error) {
    state.error = explainLedgerError(error);
  } finally {
    state.syncing = false;
    if (state.unlocked) render();
  }
}

async function stripDemoFromSheet() {
  if (!state.suppliers.some((row) => String(row.id || '').startsWith('demo-'))) {
    state.error = 'No sample khata on this Sheet.';
    render();
    return;
  }
  if (!confirm('Remove the DEMO sample khata from this Google Sheet? Real parties stay.')) return;
  state.syncing = true;
  render();
  try {
    await sheetsRequest({ action: 'clearDemo' });
    await refreshFromSheet();
  } catch (error) {
    state.error = explainLedgerError(error);
  } finally {
    state.syncing = false;
    if (state.unlocked) render();
  }
}

async function persist() {
  state.saving = true;
  render();
  try {
    const now = new Date().toISOString();
    const payload = prepareSavePayload({
      meta: { ...state.meta, shopName: state.shopName, lastSavedAt: now },
      suppliers: state.suppliers,
      money: state.money,
      metal: state.metal,
      settlements: state.settlements,
      metalMaster: state.metalMaster
    });
    const data = await sheetsRequest({ action: 'save', ...payload });
    state.spreadsheetUrl = data.spreadsheetUrl || state.spreadsheetUrl;
    state.lastSavedAt = data.lastSavedAt || now;
    state.dirty = emptyTrack();
    state.deleted = emptyTrack();
    refreshSummary();
    writeCache();
  } finally {
    state.saving = false;
  }
}

function partyRows() {
  const q = state.search.trim().toLowerCase();
  let rows = state.summary?.bySupplier || [];
  if (state.partyFilter === 'owe') rows = rows.filter((row) => Number(row.payable) > 0);
  if (state.partyFilter === 'collect') rows = rows.filter((row) => Number(row.payable) < 0);
  if (!q) return rows;
  return rows.filter((row) => {
    const party = state.suppliers.find((s) => s.id === row.id) || {};
    return String(row.name || '').toLowerCase().includes(q) || String(party.phone || '').toLowerCase().includes(q);
  });
}

function currentReportRange() {
  if (state.reportPreset === 'custom') return { from: state.reportFrom || '', to: state.reportTo || '' };
  return rangeForPreset(state.reportPreset);
}

function currentReport() {
  const { from, to } = currentReportRange();
  return reportForRange({
    suppliers: state.suppliers,
    money: state.money,
    metal: state.metal,
    settlements: state.settlements,
    from,
    to
  });
}

function downloadReport() {
  const report = currentReport();
  const blob = new Blob([reportCsv(report)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `karigar-report-${report.from || 'all'}-${report.to || isoStamp()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function isoStamp() {
  return today();
}

function savedLine() {
  if (state.saving) return 'Saving…';
  if (state.syncing) return 'Refreshing from Google Sheets…';
  if (!state.lastSavedAt) return '';
  const d = new Date(state.lastSavedAt);
  if (Number.isNaN(d.getTime())) return `Saved ${esc(state.lastSavedAt)}`;
  return `Saved ${d.toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}`;
}

function landing() {
  if (!state.sheetsUrl && state.gate === 'choice') return gateChoice();
  if (state.gate === 'setup') return setupWizard();
  return loginScreen();
}

function onboardShell(inner) {
  root.innerHTML = `<main class="lock-app" tabindex="-1"><section class="onboard-card">${inner}</section></main>`;
  bind();
}

function gateChoice() {
  onboardShell(`
    <div class="brand"><span class="brand-mark">K</span> Karigar</div>
    <h1>Party khata</h1>
    ${state.error ? `<div class="notice">${esc(state.error)}</div>` : ''}
    <div class="choice-stack">
      <button type="button" class="choice-card" data-action="gate" data-gate="setup">
        <strong>New shop</strong>
        <span>One-time setup on your Google Sheet</span>
      </button>
      <button type="button" class="choice-card" data-action="gate" data-gate="login">
        <strong>Open shop</strong>
        <span>Unlock with PIN</span>
      </button>
    </div>
  `);
}

function setupDots() {
  return `<div class="steps">${[1, 2, 3, 4, 5].map((n) => `<span class="${n === state.setupStep ? 'on' : n < state.setupStep ? 'done' : ''}">${n}</span>`).join('')}</div>`;
}

function setupWizard() {
  const d = state.setupDraft;
  const err = state.error ? `<div class="notice">${esc(state.error)}</div>` : '';
  let body = '';
  if (state.setupStep === 1) {
    body = `
      <h1>Shop & PIN</h1>
      <p>Same PIN goes into Apps Script in a moment.</p>
      ${err}
      <form id="setup-shop">
        <label>Shop name<input name="shopName" required value="${esc(d.shopName)}" placeholder="e.g. Mehta Jewellers"></label>
        <label>Shop PIN<input name="pin" type="text" inputmode="numeric" autocomplete="new-password" required minlength="4" value="${esc(d.pin)}" placeholder="4 or more digits"></label>
        <label>Type PIN again<input name="pin2" type="text" inputmode="numeric" autocomplete="new-password" required value="${esc(d.pin)}"></label>
        <button class="btn btn-primary">Continue</button>
      </form>`;
  } else if (state.setupStep === 2) {
    body = `
      <h1>License</h1>
      <p>Key from your Karigar provider.</p>
      ${err}
      <form id="setup-license">
        <label>License key<input name="licenseKey" required value="${esc(d.licenseKey)}" placeholder="The key they WhatsApp you"></label>
        <button class="btn btn-primary">Continue</button>
      </form>`;
  } else if (state.setupStep === 3) {
    body = `
      <h1>Your Sheet</h1>
      <p>Blank spreadsheet in the shop Google account.</p>
      ${err}
      <ol class="howto">
        <li>Open <a href="https://sheets.google.com" target="_blank" rel="noopener">Google Sheets</a> signed in as the shop owner.</li>
        <li>Start a <strong>Blank spreadsheet</strong>. Rename it <em>Karigar — ${esc(d.shopName || 'your shop')}</em>.</li>
        <li>Copy the address bar link and paste it below.</li>
      </ol>
      <form id="setup-sheet">
        <label>Sheet link<input name="sheetUrl" required value="${esc(d.sheetUrl)}" placeholder="https://docs.google.com/spreadsheets/d/…"></label>
        <button class="btn btn-primary">Continue</button>
      </form>`;
  } else if (state.setupStep === 4) {
    body = `
      <h1>Apps Script</h1>
      <p>Paste into this Sheet only — Extensions → Apps Script.</p>
      ${err}
      <ol class="howto">
        <li>In the jewellery Sheet: <strong>Extensions → Apps Script</strong>. Delete any starter code.</li>
        <li>Tap <strong>Copy script</strong>, paste into Code.gs, Save.</li>
        <li>Gear → Project Settings → tick <strong>Show "appsscript.json"</strong>. Scopes: <code>spreadsheets.currentonly</code> and <code>script.external_request</code>.</li>
        <li>Function dropdown: <strong>authorizeKarigar</strong> → Run → Allow (this spreadsheet + Connect to an external service). Then run <strong>initLedger</strong>.</li>
      </ol>
      <p><button type="button" class="btn btn-gold" data-action="copy-script">Copy script</button>
      ${d.copied ? '<span class="ok-pill">Copied</span>' : ''}</p>
      <p><button type="button" class="btn btn-primary" data-action="setup-next">I ran authorizeKarigar</button></p>`;
  } else {
    body = `
      <h1>Web app URL</h1>
      <p>Deploy → Web app → Me / Anyone. Paste the /exec URL. Do not open it in a tab.</p>
      ${err}
      <ol class="howto">
        <li>In Apps Script: <strong>Deploy → New deployment → Web app</strong>.</li>
        <li>Execute as: <strong>Me</strong>. Who has access: <strong>Anyone</strong>.</li>
        <li>Deploy. Copy the URL that ends with <code>/exec</code>.</li>
      </ol>
      <form id="setup-exec">
        <label>Web app URL (/exec)<input name="sheetsUrl" required value="${esc(d.execUrl || state.sheetsUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
        <button class="btn btn-primary" id="login-submit">Open my khata</button>
      </form>`;
  }
  onboardShell(`
    <div class="brand"><span class="brand-mark">K</span> Karigar</div>
    ${setupDots()}
    <p class="eyebrow">Step ${state.setupStep} of 5</p>
    ${body}
    <p class="setup-toggle"><button type="button" class="btn-plain" data-action="setup-back">Back</button></p>
  `);
}

function loginScreen() {
  const configured = Boolean(state.sheetsUrl);
  const digits = String(state.lockDigits || '');
  const dots = [0, 1, 2, 3].map((i) => `<span class="${digits[i] ? 'on' : ''}"></span>`).join('');
  onboardShell(`
    <div class="brand"><span class="brand-mark">K</span> Karigar</div>
    <h1>Unlock</h1>
    ${configured ? '<p class="pin-hint">Type the shop PIN on the keyboard, or tap the pad.</p>' : '<p>Paste the shop /exec URL, then PIN.</p>'}
    ${state.error ? `<div class="notice">${esc(state.error)}</div>` : ''}
    <form id="login-form" autocomplete="off">
      <input class="autofill-trap" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" value="karigar-shop">
      ${configured && !state.setupOpen ? '' : `<label>Web app URL (/exec)<input name="sheetsUrl" placeholder="https://script.google.com/macros/s/…/exec" ${configured ? '' : 'required'} value="${esc(state.sheetsUrl)}" autocomplete="off"></label>`}
      <div class="pin-dots" aria-hidden="true">${dots}${digits.length > 4 ? `<em>+${digits.length - 4}</em>` : ''}</div>
      <label class="pin-label">Shop PIN
        <input name="shopLock" class="pin-entry" inputmode="numeric" autocomplete="one-time-code" maxlength="8" minlength="4" required value="${esc(digits)}" autocapitalize="off" spellcheck="false" ${configured && !state.setupOpen ? 'autofocus' : ''}>
      </label>
      <div class="pin-pad" aria-label="PIN pad">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'go'].map((key) => (
          key === 'go'
            ? `<button class="btn btn-primary pin-go" id="login-submit">Unlock</button>`
            : `<button type="button" class="pin-key" data-action="pin-key" data-key="${key}">${key === 'del' ? '←' : key}</button>`
        )).join('')}
      </div>
    </form>
    <p class="setup-toggle">
      ${configured ? `<button type="button" class="btn-plain" data-action="setup">Use a different Sheet</button>` : ''}
      <button type="button" class="btn-plain" data-action="gate" data-gate="setup">New shop</button>
    </p>
  `);
}

function recordActions() {
  if (!state.suppliers.length) return '';
  return `<div class="action-grid pass-actions" role="group" aria-label="Khata actions">
    <button type="button" data-action="modal" data-modal="purchase"><span class="ag-ico">₹</span><span>Purchase</span></button>
    <button type="button" data-action="modal" data-modal="payment"><span class="ag-ico">↓</span><span>Payment</span></button>
    <button type="button" data-action="modal" data-modal="issue"><span class="ag-ico">→</span><span>Give metal</span></button>
    <button type="button" data-action="modal" data-modal="receive"><span class="ag-ico">←</span><span>Get metal</span></button>
  </div>`;
}

function partiesHome() {
  const s = state.summary || {};
  const rows = partyRows();
  const month = reportForRange({
    suppliers: state.suppliers, money: state.money, metal: state.metal, settlements: state.settlements,
    ...rangeForPreset('month')
  });
  const list = state.syncing && !rows.length ? `<div class="empty-khata grow"><p>Loading…</p></div>` : rows.length ? `<section class="list-card blotter grow">
      <div class="list-head"><span>Khata</span><span>${rows.length}</span></div>
      <div class="party-list">${rows.map((row) => {
    const dir = moneyDirection(row.payable);
    const metal = metalPills(row.metalByPurity);
    const party = state.suppliers.find((s) => s.id === row.id) || {};
    return `<button type="button" class="cell party-row party-card ${dir.tone}" data-supplier="${esc(row.id)}">
        <span class="avatar">${esc(initials(partyLabel(party) !== 'Party' ? partyLabel(party) : partyLabel(row)))}</span>
        <span class="cell-main party-body">
          <span class="party-title-row"><strong class="party-name">${esc(partyLabel({ ...row, ...party }))}</strong>${String(row.id || party.id || '').startsWith('demo-') ? '<small class="demo-tag">DEMO</small>' : ''}</span>
          ${party.phone ? `<small class="party-phone">${esc(party.phone)}</small>` : ''}
          ${metal || ''}
        </span>
        <span class="cell-trail party-bal ${dir.tone}">${dir.amount ? `<em class="bal-label">${dir.label}</em><b class="bal-fig">${money(dir.amount)}</b>` : '<em class="bal-label">Square</em><b class="zero">—</b>'}</span>
        ${ic('chevron')}
      </button>`;
  }).join('')}</div>
    </section>` : `<div class="empty-khata grow">
      <p class="empty-title">No parties yet</p>
      <p class="lede">Add a karigar or supplier. Gold, silver, and cash all sit on that one card.</p>
      <button class="btn btn-primary" data-action="modal" data-modal="supplier">Add party</button>
    </div>`;
  return `
    <div class="desk-split fill">
      <div class="desk-col">
        <section class="balance-hero">
          <div class="bh owe"><span>Hume dena</span><strong>${money(s.weOweInr || 0)}</strong></div>
          <div class="bh collect"><span>Unse lena</span><strong>${money(s.theyOweInr || 0)}</strong></div>
        </section>
        <div class="filter-row">
          <div class="search-bar">${ic('search')}<input class="search" name="search" value="${esc(state.search)}" placeholder="Search parties" aria-label="Search parties"></div>
          <div class="chips">
            <button type="button" class="chip ${state.partyFilter === 'all' ? 'on' : ''}" data-action="party-filter" data-filter="all">All</button>
            <button type="button" class="chip ${state.partyFilter === 'owe' ? 'on' : ''}" data-action="party-filter" data-filter="owe">Hume dena</button>
            <button type="button" class="chip ${state.partyFilter === 'collect' ? 'on' : ''}" data-action="party-filter" data-filter="collect">Unse lena</button>
          </div>
        </div>
        ${list}
      </div>
      <aside class="side-panel">
        <div class="list-head"><span>This month</span><button type="button" class="btn-plain" data-view="report">Report</button></div>
        <div class="mini-stats">
          <div><span>Purchases</span><strong>${money(month.purchases)}</strong></div>
          <div><span>Payments</span><strong>${money(month.payments)}</strong></div>
          <div><span>Metal out</span><strong>${grams(month.metalOut)}</strong></div>
          <div><span>Metal in</span><strong>${grams(month.metalIn)}</strong></div>
        </div>
        <ol class="passbook-list tight">${month.lines.slice(0, 8).map((line) => `
          <li class="cell clickable" data-edit="${esc(line.kind === 'settle' ? 'settle' : line.kind)}" data-id="${esc(line.id)}">
            <span class="cell-main"><strong>${esc(line.label)}</strong><small>${esc(line.name)} · ${fmtDate(line.date)}</small></span>
            <span class="cell-trail"><b>${line.kind === 'metal' ? grams(line.fig) : money(line.fig)}</b></span>
          </li>`).join('') || '<li class="empty-in">No entries this month</li>'}</ol>
      </aside>
    </div>
    <button class="fab" data-action="modal" data-modal="supplier" type="button" aria-label="Add party">+</button>`;
}

function supplierPassbook() {
  const detail = state.detail;
  if (!detail?.supplier) return '<div class="empty-khata">Party not found.</div>';
  const dir = moneyDirection(detail.payable);
  const lines = detail.passbook || [];
  return `
    <div class="desk-col fill">
    <header class="party-head">
      <button class="icon-btn back" data-view="parties" type="button" aria-label="Back">${ic('chevron')}</button>
      <div class="party-id">
        <span class="avatar lg">${esc(initials(partyLabel(detail.supplier)))}</span>
        <div>
          <h1 class="party-name">${esc(partyLabel(detail.supplier))}</h1>
          ${detail.supplier.phone ? `<p class="party-phone">${esc(detail.supplier.phone)}</p>` : ''}
        </div>
      </div>
      <button class="btn-plain" data-edit="supplier" data-id="${esc(detail.supplier.id)}" type="button">Edit</button>
    </header>
    <section class="balance-hero tight">
      <div class="bh ${dir.tone}"><span>${dir.label || 'Square'}</span><strong>${money(dir.amount)}</strong></div>
      <div class="bh"><span>Metal with party</span><div>${metalPills(detail.metalByPurity) || '<strong>—</strong>'}</div></div>
    </section>
    ${recordActions()}
    <button class="text-link" data-action="modal" data-modal="settle" type="button">Settle account</button>
    <section class="list-card blotter grow">
      <div class="list-head"><span>Running hisab</span></div>
      ${lines.length ? `<ol class="passbook-list">${lines.map((line) => `
        <li class="cell clickable" data-edit="${esc(line.kind === 'settle' ? 'settle' : line.kind)}" data-id="${esc(line.id)}">
          <span class="cell-main">
            <strong>${esc(line.label)}</strong>
            <small>${fmtDate(line.date)}${line.detail ? ` · ${esc(line.detail)}` : ''}${line.note ? ` · ${esc(line.note)}` : ''}</small>
          </span>
          <span class="cell-trail">
            <b class="${line.amountInr < 0 ? 'collect' : line.amountInr > 0 ? 'owe' : ''}">${line.kind === 'metal' ? grams(line.grams) : money(Math.abs(line.amountInr))}${line.kind === 'settle' && line.grams ? ` · ${grams(line.grams)}` : ''}</b>
            <em class="hisab">Hisab ${money(line.runningInr)}</em>
          </span>
        </li>`).join('')}</ol>` : '<div class="empty-in">No entries</div>'}
    </section>
    </div>`;
}

function reportView() {
  const range = currentReportRange();
  const report = currentReport();
  const presets = [
    ['today', 'Today'],
    ['7d', '7 days'],
    ['30d', '30 days'],
    ['month', 'Month'],
    ['all', 'All'],
    ['custom', 'Custom']
  ];
  return `
    <div class="report-toolbar">
      <div class="chips wrap">
        ${presets.map(([id, label]) => `<button type="button" class="chip ${state.reportPreset === id ? 'on' : ''}" data-action="preset" data-preset="${id}">${label}</button>`).join('')}
      </div>
      <div class="range-fields">
        <label>From<input type="date" data-range="reportFrom" value="${esc(range.from)}"></label>
        <label>To<input type="date" data-range="reportTo" value="${esc(range.to)}"></label>
      </div>
      <div class="report-tools">
        <button type="button" class="btn btn-soft" data-action="export-report">Export CSV</button>
        <button type="button" class="btn btn-primary" data-action="print-report">Print</button>
      </div>
    </div>
    <section class="metric-grid">
      <div class="metric"><span>Purchases</span><strong>${money(report.purchases)}</strong></div>
      <div class="metric"><span>Payments</span><strong>${money(report.payments)}</strong></div>
      <div class="metric"><span>Settled</span><strong>${money(report.settled)}</strong></div>
      <div class="metric"><span>Metal out</span><strong>${grams(report.metalOut)}</strong></div>
      <div class="metric"><span>Metal in</span><strong>${grams(report.metalIn)}</strong></div>
      <div class="metric"><span>Entries</span><strong>${report.count}</strong></div>
    </section>
    <div class="desk-split fill">
      <section class="list-card grow">
        <div class="list-head"><span>By party</span></div>
        ${report.byParty.length ? `<div class="data-table">
          <div class="th"><span>Party</span><span>Purchases</span><span>Payments</span><span>Metal out</span><span>Metal in</span></div>
          ${report.byParty.map((row) => `<button type="button" class="tr" data-supplier="${esc(row.id)}">
            <span>${esc(row.name)}</span><span>${money(row.purchases)}</span><span>${money(row.payments)}</span><span>${grams(row.metalOut)}</span><span>${grams(row.metalIn)}</span>
          </button>`).join('')}
        </div>` : '<div class="empty-in">No party activity in this period</div>'}
      </section>
      <section class="list-card grow">
        <div class="list-head"><span>Activity</span><span>${report.lines.length}</span></div>
        ${report.lines.length ? `<ol class="passbook-list">${report.lines.map((line) => `
          <li class="cell clickable" data-edit="${esc(line.kind === 'settle' ? 'settle' : line.kind)}" data-id="${esc(line.id)}">
            <span class="cell-main"><strong>${esc(line.label)}</strong><small>${esc(line.name)} · ${fmtDate(line.date)}</small></span>
            <span class="cell-trail"><b>${line.kind === 'metal' ? grams(line.fig) : money(line.fig)}</b></span>
          </li>`).join('')}</ol>` : '<div class="empty-in">No entries in this period</div>'}
      </section>
    </div>`;
}

function helpView() {
  return `<section class="help-page list-card grow">
    <div class="list-head"><span>How this works</span><button type="button" class="btn-plain" data-action="tour-start">Start tour</button></div>
    <div class="help-body">
      <article class="help-item">
        <h2>Parties</h2>
        <p class="help-lead">One name, one khata.</p>
        <p>Phone is optional and quiet. Gold, silver, and cash sit on the same card — never a second party for a metal or a mobile number.</p>
      </article>
      <article class="help-item">
        <h2>Hume dena / Unse lena</h2>
        <p class="help-lead">Hume dena = we owe them. Unse lena = they owe us.</p>
        <p>Rupees only. Metal with the party is separate, stamped GOLD 22K / SILVER 999.</p>
      </article>
      <article class="help-item">
        <h2>Purchase</h2>
        <p class="help-lead">Bill from party — rupees, metal, or both.</p>
        <p>Leave rupees blank for metal-only. Add extra metal lines for gold and silver on the same bill. Gave metal = you issued. Got metal = it came back.</p>
      </article>
      <article class="help-item">
        <h2>Payment</h2>
        <p class="help-lead">You paid them.</p>
        <p>Rupees, and optional metal that moved with that payment.</p>
      </article>
      <article class="help-item">
        <h2>Give metal / Get metal</h2>
        <p class="help-lead">Metal only — no rupee amount.</p>
        <p>Issue for jobwork, or receive it back. Same party, any metal, as many times as needed.</p>
      </article>
      <article class="help-item">
        <h2>Settle</h2>
        <p class="help-lead">Square the running hisab.</p>
        <p>Close cash and/or metal against the khata.</p>
      </article>
      <article class="help-item">
        <h2>Refresh data</h2>
        <p class="help-lead">Header Refresh pulls the Sheet. You stay unlocked.</p>
        <p>The browser refresh button will ask for PIN again on this tab.</p>
      </article>
      <article class="help-item">
        <h2>Masters</h2>
        <p class="help-lead">Metals and purities you actually use.</p>
        <p>Purchase and Give / Get metal then offer those in the dropdowns.</p>
      </article>
      <article class="help-item">
        <h2>Demo khata</h2>
        <p class="help-lead">Sheet screen only — not for live books.</p>
        <p>Load demo writes sample parties into the Google Sheet, not into the app. A live shop stays empty until you add real parties.</p>
      </article>
    </div>
  </section>`;
}

function tourOverlay() {
  if (state.tourStep == null || state.tourStep < 0) return '';
  const step = TOUR[state.tourStep] || TOUR[0];
  const last = state.tourStep >= TOUR.length - 1;
  return `<div class="tour-backdrop">
    <section class="tour-card">
      <p class="eyebrow">How this works · ${state.tourStep + 1} / ${TOUR.length}</p>
      <h2>${esc(step.title)}</h2>
      <p>${esc(step.body)}</p>
      <div class="form-actions tour-actions">
        <button type="button" class="btn btn-soft" data-action="tour-skip">Skip</button>
        <button type="button" class="btn btn-primary" data-action="tour-next">${last ? 'Done' : 'Next'}</button>
      </div>
    </section>
  </div>`;
}

function booksView() {
  return `<section class="sheet-page">
    <section class="settings-list">
      <button class="cell" data-view="masters" type="button">
        <span class="cell-main"><strong>Metal master</strong><small>Purity and optional rate</small></span>
        ${ic('chevron')}
      </button>
    </section>
    <p class="sheet-kicker">Sheet</p>
    <section class="settings-list sheet-secondary">
      <button class="cell" data-action="refresh" type="button">
        <span class="cell-main"><strong>Refresh data</strong>${savedLine() ? `<small>${esc(savedLine())}</small>` : '<small>Reload the Google Sheet. Header Refresh does the same.</small>'}</span>
        ${ic('chevron')}
      </button>
      ${state.spreadsheetUrl ? `<a class="cell" href="${esc(state.spreadsheetUrl)}" target="_blank" rel="noopener">
        <span class="cell-main"><strong>Open in Google Sheets</strong><small>View the live workbook</small></span>
        ${ic('chevron')}
      </a>` : ''}
    </section>
    <p class="sheet-kicker demo">Demo only — not live books</p>
    <section class="settings-list sheet-demo">
      <button class="cell" data-action="seed-demo" type="button">
        <span class="cell-main"><strong>Load demo khata</strong><small>Writes sample parties into this Google Sheet — not stored in the app</small></span>
        ${ic('chevron')}
      </button>
      <button class="cell" data-action="strip-demo" type="button">
        <span class="cell-main"><strong>Remove demo khata</strong><small>Deletes demo- parties and their sample journals</small></span>
        ${ic('chevron')}
      </button>
    </section>
    <section class="settings-list">
      <button class="cell danger" data-action="logout" type="button">
        <span class="cell-main"><strong>Lock</strong></span>
      </button>
    </section>
  </section>`;
}

function viewContent() {
  if (state.view === 'supplier') return supplierPassbook();
  if (state.view === 'report') return reportView();
  if (state.view === 'today') return reportView();
  if (state.view === 'masters') return mastersView();
  if (state.view === 'books') return booksView();
  if (state.view === 'help') return helpView();
  return partiesHome();
}

function viewTitle() {
  if (state.view === 'report' || state.view === 'today') return 'Report';
  if (state.view === 'masters') return 'Masters';
  if (state.view === 'books') return 'Sheet';
  if (state.view === 'help') return 'How this works';
  if (state.view === 'supplier') return '';
  return 'Parties';
}

function render() {
  if (!state.unlocked) return landing();
  const title = viewTitle();
  const navParties = state.view === 'parties' || state.view === 'supplier' ? 'active' : '';
  const navToday = state.view === 'report' || state.view === 'today' ? 'active' : '';
  const navMasters = state.view === 'masters' ? 'active' : '';
  const navBooks = state.view === 'books' ? 'active' : '';
  const navHelp = state.view === 'help' ? 'active' : '';
  root.innerHTML = `<div class="shop">
    <aside class="shop-nav" aria-label="Shop">
      <div class="nav-brand"><span class="brand-mark">K</span> <span>Karigar</span></div>
      <button class="nav-item ${navParties}" data-view="parties" type="button">${ic('parties')}<span>Parties</span></button>
      <button class="nav-item ${navToday}" data-view="report" type="button">${ic('report')}<span>Report</span></button>
      <button class="nav-item ${navMasters}" data-view="masters" type="button">${ic('masters')}<span>Masters</span></button>
      <button class="nav-item ${navBooks}" data-view="books" type="button">${ic('sheet')}<span>Sheet</span></button>
      <button class="nav-item ${navHelp}" data-view="help" type="button">${ic('help')}<span>How to</span></button>
      <button class="nav-item nav-lock" data-action="logout" type="button">${ic('lock')}<span>Lock</span></button>
    </aside>
    <div class="shop-body">
      <header class="appbar">
        <div class="brand"><span class="brand-mark">K</span> <span>${esc(state.shopName || 'Karigar')}</span></div>
        ${title ? `<h1 class="appbar-title">${esc(title)}</h1>` : ''}
        <div class="appbar-end">
          ${state.saving || state.syncing ? '<span class="sync-dot"></span>' : ''}
          <button class="btn-refresh" data-action="refresh" type="button" ${state.syncing ? 'disabled' : ''} aria-label="Refresh data">
            ${ic('refresh')}<span>Refresh data</span>
          </button>
          <button class="icon-btn" data-view="help" type="button" aria-label="How this works">${ic('help')}</button>
          <button class="icon-btn mast-lock" data-action="logout" type="button" aria-label="Lock">${ic('lock')}</button>
        </div>
      </header>
      <main class="stage">
        ${state.error ? `<div class="notice">${esc(state.error)}</div>` : ''}
        ${viewContent()}
      </main>
    </div>
    ${state.modal ? modal() : ''}
    ${tourOverlay()}
  </div>`;
  bind();
}

function supplierModal() {
  const e = state.editing || {};
  return `<div class="modal-backdrop"><section class="modal">
    <div class="section-head"><h2>${e.id ? 'Edit party' : 'Add party'}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <form id="data-form" data-kind="supplier">
      <label>Party name<input name="name" required value="${esc(e.name || '')}" placeholder="Karigar / supplier"></label>
      <label>Phone (optional)<input name="phone" value="${esc(e.phone || '')}"></label>
      <label>Notes (optional)<input name="notes" value="${esc(e.notes || '')}"></label>
      ${e.id ? '' : `
        <label>Opening — hume dena (₹)<input name="openingMoney" type="number" min="0" step="0.01" value="0"></label>
        <label>Opening metal<select name="metalType"><option value="">None</option>${metalTypeOptions('')}</select></label>
        <label>Purity<select name="purity">${purityOptions('GOLD', '22K')}</select></label>
        <label>Opening metal (grams)<input name="weightGrams" type="number" min="0" step="0.001" value="0"></label>
      `}
      <div class="form-actions">
        ${e.id ? '<button type="button" class="btn btn-soft" data-delete="supplier">Delete party</button>' : ''}
        <button type="button" class="btn btn-soft" data-action="close">Cancel</button>
        <button class="btn btn-primary">Save</button>
      </div>
    </form>
  </section></div>`;
}

function metalLineHtml(i, draft = {}) {
  const type = draft[`metalType_${i}`] || 'GOLD';
  const dir = draft[`metalDir_${i}`] || 'ISSUE';
  const pur = draft[`purity_${i}`] || '22K';
  return `<div class="metal-line" data-metal-row="${i}">
      <label>Gave / got
        <select name="metalDir_${i}">
          <option value="ISSUE" ${dir === 'ISSUE' ? 'selected' : ''}>Gave metal</option>
          <option value="RECEIPT" ${dir === 'RECEIPT' ? 'selected' : ''}>Got metal</option>
        </select>
      </label>
      <label>Metal<select name="metalType_${i}">${metalTypeOptions(type)}</select></label>
      <label>Purity<select name="purity_${i}">${purityOptions(type, pur)}</select></label>
      <label>Grams<input name="metalGrams_${i}" type="number" min="0" step="0.001" inputmode="decimal" placeholder="0" value="${esc(draft[`metalGrams_${i}`] || '')}"></label>
    </div>`;
}

function dealModal(type) {
  const locked = Boolean(state.supplierId);
  const count = Math.max(1, Number(state.dealMetalCount || 1));
  const isPay = type === 'PAYMENT';
  const draft = state.dealDraft || {};
  return `<div class="modal-backdrop"><section class="modal">
    <div class="section-head"><h2>${isPay ? 'Payment' : 'Purchase'}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <p class="lede">${isPay ? 'Payment to party. Rupees, metal, or both.' : 'Bill from party. Rupees, metal, or both.'}</p>
    <form id="data-form" data-kind="deal">
      ${locked ? `<input type="hidden" name="supplierId" value="${esc(state.supplierId)}">` : `<label>Party<select name="supplierId" required>${state.suppliers.map((s) => `<option value="${esc(s.id)}" ${(draft.supplierId || state.supplierId) === s.id ? 'selected' : ''}>${esc(partyLabel(s))}</option>`).join('')}</select></label>`}
      <input type="hidden" name="type" value="${esc(isPay ? 'PAYMENT' : 'PURCHASE')}">
      <label>Rupees (optional)<input name="amountInr" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Blank if metal only" value="${esc(draft.amountInr || '')}"></label>
      <div class="metal-block">
        <div class="list-head"><span>Metal (optional)</span><button type="button" class="btn-plain" data-action="add-metal-row">+ Metal</button></div>
        ${Array.from({ length: count }, (_, i) => metalLineHtml(i, draft)).join('')}
      </div>
      <label>Date<input name="date" type="date" value="${esc(draft.date || today())}" required></label>
      <label>Note<input name="note" placeholder="Bill no. / optional" value="${esc(draft.note || '')}"></label>
      <div class="form-actions">
        <button type="button" class="btn btn-soft" data-action="close">Cancel</button>
        <button class="btn btn-primary">Save</button>
      </div>
    </form>
  </section></div>`;
}

function moneyModal(type) {
  const e = state.editing || {};
  const locked = Boolean(state.supplierId) && !e.id;
  const isEdit = Boolean(e.id);
  const current = e.type || type;
  return `<div class="modal-backdrop"><section class="modal">
    <div class="section-head"><h2>${isEdit ? 'Edit entry' : (current === 'PAYMENT' ? 'Payment' : 'Purchase')}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <form id="data-form" data-kind="money">
      ${locked ? `<input type="hidden" name="supplierId" value="${esc(state.supplierId)}">` : `<label>Party<select name="supplierId" required>${state.suppliers.map((s) => `<option value="${esc(s.id)}" ${s.id === (e.supplierId || state.supplierId) ? 'selected' : ''}>${esc(partyLabel(s))}</option>`).join('')}</select></label>`}
      ${isEdit ? `<label>Type<select name="type">
        <option value="OPENING" ${e.type === 'OPENING' ? 'selected' : ''}>Opening</option>
        <option value="PURCHASE" ${current === 'PURCHASE' ? 'selected' : ''}>Purchase</option>
        <option value="PAYMENT" ${current === 'PAYMENT' ? 'selected' : ''}>Payment</option>
      </select></label>` : `<input type="hidden" name="type" value="${esc(current)}">`}
      <label>Amount (₹)<input name="amountInr" type="number" min="0.01" step="0.01" required inputmode="decimal" value="${esc(e.amountInr || '')}"></label>
      <label>Date<input name="date" type="date" value="${esc((e.date || today()).slice(0, 10))}" required></label>
      <label>Note<input name="note" value="${esc(e.note || '')}" placeholder="Bill no. / optional"></label>
      <div class="form-actions">
        ${e.id ? '<button type="button" class="btn btn-soft" data-delete="money">Delete</button>' : ''}
        <button type="button" class="btn btn-soft" data-action="close">Cancel</button>
        <button class="btn btn-primary">Save</button>
      </div>
    </form>
  </section></div>`;
}

function metalModal(direction) {
  const e = state.editing || {};
  const locked = Boolean(state.supplierId) && !e.id;
  const isEdit = Boolean(e.id);
  const current = e.direction || direction;
  return `<div class="modal-backdrop"><section class="modal">
    <div class="section-head"><h2>${isEdit ? 'Edit metal' : (current === 'RECEIPT' ? 'Get metal' : 'Give metal')}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <form id="data-form" data-kind="metal">
      ${locked ? `<input type="hidden" name="supplierId" value="${esc(state.supplierId)}">` : `<label>Party<select name="supplierId" required>${state.suppliers.map((s) => `<option value="${esc(s.id)}" ${s.id === (e.supplierId || state.supplierId) ? 'selected' : ''}>${esc(partyLabel(s))}</option>`).join('')}</select></label>`}
      ${isEdit ? `<label>Direction<select name="direction">
        <option value="OPENING" ${e.direction === 'OPENING' ? 'selected' : ''}>Opening</option>
        <option value="ISSUE" ${current === 'ISSUE' ? 'selected' : ''}>Give metal</option>
        <option value="RECEIPT" ${current === 'RECEIPT' ? 'selected' : ''}>Get metal</option>
      </select></label>` : `<input type="hidden" name="direction" value="${esc(current)}">`}
      <label>Metal<select name="metalType">${metalTypeOptions(e.metalType || 'GOLD')}</select></label>
      <label>Purity<select name="purity">${purityOptions(e.metalType || 'GOLD', e.purity || '22K')}</select></label>
      ${rateFor(e.metalType || 'GOLD', e.purity || '22K') ? `<p class="rate-hint">Master ${money(rateFor(e.metalType || 'GOLD', e.purity || '22K'))}/g</p>` : ''}
      <label>Weight (grams)<input name="weightGrams" type="number" min="0.001" step="0.001" required inputmode="decimal" value="${esc(e.weightGrams || '')}"></label>
      <label>Date<input name="date" type="date" value="${esc((e.date || today()).slice(0, 10))}" required></label>
      <label>Note<input name="note" value="${esc(e.note || '')}"></label>
      <div class="form-actions">
        ${e.id ? '<button type="button" class="btn btn-soft" data-delete="metal">Delete</button>' : ''}
        <button type="button" class="btn btn-soft" data-action="close">Cancel</button>
        <button class="btn btn-primary">Save</button>
      </div>
    </form>
  </section></div>`;
}

function settleModal() {
  const e = state.editing || {};
  const locked = Boolean(state.supplierId) && !e.id;
  return `<div class="modal-backdrop"><section class="modal">
    <div class="section-head"><h2>${e.id ? 'Edit settlement' : 'Close account'}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <form id="data-form" data-kind="settle">
      ${locked ? `<input type="hidden" name="supplierId" value="${esc(state.supplierId)}">` : `<label>Party<select name="supplierId" required>${state.suppliers.map((s) => `<option value="${esc(s.id)}" ${s.id === (e.supplierId || state.supplierId) ? 'selected' : ''}>${esc(partyLabel(s))}</option>`).join('')}</select></label>`}
      <label>Cash closed (₹)<input name="moneyAmountInr" type="number" min="0" step="0.01" value="${esc(e.moneyAmountInr || 0)}"></label>
      <label>Metal type<select name="metalType"><option value="">None</option>${metalTypeOptions(e.metalType || '')}</select></label>
      <label>Purity<select name="purity">${purityOptions(e.metalType || 'GOLD', e.purity || '22K')}</select></label>
      <label>Metal closed (grams)<input name="metalGrams" type="number" min="0" step="0.001" value="${esc(e.metalGrams || 0)}"></label>
      <label>Date<input name="date" type="date" value="${esc((e.date || today()).slice(0, 10))}" required></label>
      <label>Note<input name="note" value="${esc(e.note || '')}"></label>
      <div class="form-actions">
        ${e.id ? '<button type="button" class="btn btn-soft" data-delete="settle">Delete</button>' : ''}
        <button type="button" class="btn btn-soft" data-action="close">Cancel</button>
        <button class="btn btn-primary">Save</button>
      </div>
    </form>
  </section></div>`;
}

function modal() {
  const kind = state.modal;
  if (kind === 'supplier') return supplierModal();
  if (kind === 'purchase' || kind === 'payment') return dealModal(kind === 'payment' ? 'PAYMENT' : 'PURCHASE');
  if (kind === 'money') return moneyModal('PURCHASE');
  if (kind === 'issue' || kind === 'receive' || kind === 'metal') return metalModal(kind === 'receive' ? 'RECEIPT' : 'ISSUE');
  if (kind === 'settle') return settleModal();
  if (kind === 'metalMaster') return metalMasterModal();
  return '';
}

function metalMasterModal() {
  const e = state.editing || {};
  return `<div class="modal-backdrop"><section class="modal">
    <div class="section-head"><h2>${e.id ? 'Edit metal' : 'Add metal'}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <form id="data-form" data-kind="metalMaster">
      <label>Metal type<input name="metalType" required value="${esc(e.metalType || 'GOLD')}" placeholder="GOLD / SILVER"></label>
      <label>Purity<input name="purity" required value="${esc(e.purity || '')}" placeholder="22K / 999"></label>
      <label>Rate ₹ / gram<input name="rateInrPerGram" type="number" min="0" step="0.01" value="${esc(e.rateInrPerGram || '')}" placeholder="Optional"></label>
      <label>Status<select name="status">
        <option value="ACTIVE" ${e.status !== 'INACTIVE' ? 'selected' : ''}>Active</option>
        <option value="INACTIVE" ${e.status === 'INACTIVE' ? 'selected' : ''}>Inactive</option>
      </select></label>
      <div class="form-actions">
        ${e.id ? '<button type="button" class="btn btn-soft" data-delete="metalMaster">Delete</button>' : ''}
        <button type="button" class="btn btn-soft" data-action="close">Cancel</button>
        <button class="btn btn-primary">Save</button>
      </div>
    </form>
  </section></div>`;
}

function mastersView() {
  const rows = state.metalMaster || [];
  return `
    <div class="filter-row">
      <p class="lede">Metal used when you give / get / settle. Rate is optional (₹ per gram).</p>
      <button class="btn btn-primary" data-action="modal" data-modal="metalMaster" type="button">+ Metal</button>
    </div>
    <section class="list-card grow">
      <div class="data-table master-table">
        <div class="th"><span>Metal</span><span>Purity</span><span>₹ / g</span><span></span></div>
        ${rows.map((row) => `
          <button type="button" class="tr ${row.status === 'INACTIVE' ? 'dim' : ''}" data-edit="metalMaster" data-id="${esc(row.id)}">
            <span>${esc(row.metalType)}</span>
            <span>${esc(row.purity)}</span>
            <span>${row.rateInrPerGram ? money(row.rateInrPerGram) : '—'}</span>
            <span>${row.status === 'INACTIVE' ? 'Off' : ''}</span>
          </button>`).join('')}
      </div>
    </section>`;
}

function stamp(row, isNew) {
  const now = new Date().toISOString();
  return { ...row, createdAt: isNew ? now : (row.createdAt || now), updatedAt: now };
}

function logout() {
  state.unlocked = false;
  state.pin = '';
  state.lockDigits = '';
  forgetLocalPin();
  forgetSessionUnlock();
  state.view = 'parties';
  state.error = null;
  landing();
}

function bind() {
  root.onclick = async (event) => {
    const target = event.target.closest('[data-view],[data-action],[data-supplier],[data-edit],[data-delete]');
    const tourNav = resolveTourClick({
      action: target && target.dataset.action,
      clickedBackdrop: Boolean(event.target.classList && event.target.classList.contains('tour-backdrop'))
    });
    if (tourNav) {
      const next = applyTourNav(state.tourStep, TOUR.length, tourNav);
      state.tourStep = next.step;
      if (next.finished) {
        try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* ignore */ }
      }
      render();
      return;
    }
    if (!target) return;
    try {
      if (target.dataset.supplier) {
        state.view = 'supplier';
        state.supplierId = target.dataset.supplier;
        state.modal = null;
        state.editing = null;
        refreshSummary();
        render();
        return;
      }
      if (target.dataset.view) {
        state.view = target.dataset.view;
        if (target.dataset.view !== 'supplier') state.supplierId = null;
        state.modal = null;
        state.editing = null;
        refreshSummary();
        render();
        return;
      }
      if (target.dataset.edit) {
        const kind = target.dataset.edit;
        const id = target.dataset.id;
        const list = kind === 'supplier' ? state.suppliers : kind === 'money' ? state.money : kind === 'metal' ? state.metal : kind === 'metalMaster' ? state.metalMaster : state.settlements;
        state.editing = list.find((r) => r.id === id) || null;
        state.modal = kind === 'settle' ? 'settle' : kind;
        render();
        return;
      }
      if (target.dataset.delete) {
        await onDelete(target.dataset.delete);
        return;
      }
      const action = target.dataset.action;
      if (action === 'pin-key') {
        state.lockDigits = applyPinKey(state.lockDigits, target.dataset.key);
        landing();
        return;
      }
      if (action === 'close') { state.modal = null; state.editing = null; render(); }
      else if (action === 'modal') {
        state.editing = null;
        state.modal = target.dataset.modal;
        if (state.modal === 'purchase' || state.modal === 'payment') {
          state.dealMetalCount = 1;
          state.dealDraft = {};
        }
        render();
      } else if (action === 'add-metal-row') {
        const form = root.querySelector('#data-form');
        if (form) state.dealDraft = Object.fromEntries(new FormData(form));
        state.dealMetalCount = Math.min(6, Number(state.dealMetalCount || 1) + 1);
        render();
        return;
      } else if (action === 'tour-start') {
        state.tourStep = applyTourNav(state.tourStep, TOUR.length, 'start').step;
        render();
        return;
      }
      else if (action === 'logout') logout();
      else if (action === 'setup') { state.setupOpen = !state.setupOpen; state.gate = 'login'; landing(); }
      else if (action === 'refresh') await refreshFromSheet();
      else if (action === 'seed-demo') await seedDemoIntoSheet();
      else if (action === 'strip-demo') await stripDemoFromSheet();
      else if (action === 'gate') {
        state.gate = target.dataset.gate;
        state.error = null;
        if (state.gate === 'setup') state.setupStep = 1;
        landing();
      } else if (action === 'setup-back') {
        state.error = null;
        if (state.setupStep <= 1) state.gate = 'choice';
        else state.setupStep -= 1;
        landing();
      } else if (action === 'setup-next') {
        state.setupStep = Math.min(5, state.setupStep + 1);
        landing();
      } else if (action === 'copy-script') await copyOwnerScript();
      else if (action === 'preset') {
        state.reportPreset = target.dataset.preset;
        if (state.reportPreset !== 'custom') {
          const next = rangeForPreset(state.reportPreset);
          state.reportFrom = next.from;
          state.reportTo = next.to;
        }
        render();
      } else if (action === 'party-filter') {
        state.partyFilter = target.dataset.filter || 'all';
        render();
      } else if (action === 'export-report') downloadReport();
      else if (action === 'print-report') window.print();
    } catch (error) {
      state.error = error.message;
      render();
    }
  };
  const pinEntry = root.querySelector('input.pin-entry');
  if (pinEntry) {
    pinEntry.oninput = () => {
      state.lockDigits = String(pinEntry.value || '').replace(/\D/g, '').slice(0, 8);
      landing();
    };
  }
  window.onkeydown = (event) => {
    const pinScreen = Boolean(root.querySelector('#login-form'));
    if (!shouldHandlePinKeyboard(event, { unlocked: state.unlocked, gate: state.gate, pinScreen, target: event.target })) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      const form = root.querySelector('#login-form');
      if (form && String(state.lockDigits || '').length >= 4) form.requestSubmit();
      return;
    }
    event.preventDefault();
    state.lockDigits = applyPinKey(state.lockDigits, event.key);
    landing();
  };
  if (!state.unlocked && root.querySelector('#login-form')) {
    const active = document.activeElement;
    const typingUrl = active && (active.name === 'sheetsUrl' || (active.tagName === 'INPUT' && !active.classList.contains('pin-entry') && active.name !== 'shopLock'));
    if (!typingUrl) {
      const pin = root.querySelector('input.pin-entry');
      if (pin) pin.focus({ preventScroll: true });
    }
  }
  for (const input of root.querySelectorAll('input[data-range]')) {
    input.onchange = () => {
      state.reportPreset = 'custom';
      state[input.dataset.range] = input.value;
      render();
    };
  }
  const search = root.querySelector('input.search');
  if (search) {
    search.oninput = () => {
      state.search = search.value;
      const pos = search.selectionStart;
      render();
      const next = root.querySelector('input.search');
      if (next) {
        next.focus();
        try { next.setSelectionRange(pos, pos); } catch { /* ignore */ }
      }
    };
  }
  const metalType = root.querySelector('select[name="metalType"]');
  const purity = root.querySelector('select[name="purity"]');
  if (metalType && purity) {
    metalType.onchange = () => { purity.innerHTML = purityOptions(metalType.value || 'GOLD', purity.value); };
  }
  for (const typeSel of root.querySelectorAll('select[name^="metalType_"]')) {
    const i = String(typeSel.name).slice('metalType_'.length);
    const pur = root.querySelector(`select[name="purity_${i}"]`);
    if (pur) typeSel.onchange = () => { pur.innerHTML = purityOptions(typeSel.value || 'GOLD', pur.value); };
  }
  for (const form of root.querySelectorAll('form')) form.onsubmit = submitForm;
}

async function onDelete(kind) {
  const row = state.editing;
  if (!row) return;
  if (kind === 'supplier') {
    if (!confirm(`Delete ${partyLabel(row)} and all of their khata?`)) return;
    markDeleted('suppliers', row.id);
    for (const item of state.money.filter((x) => x.supplierId === row.id)) markDeleted('money', item.id);
    for (const item of state.metal.filter((x) => x.supplierId === row.id)) markDeleted('metal', item.id);
    for (const item of state.settlements.filter((x) => x.supplierId === row.id)) markDeleted('settlements', item.id);
    const next = deleteSupplierCascade(state, row.id);
    Object.assign(state, next);
    state.view = 'parties';
    state.supplierId = null;
  } else if (kind === 'money') {
    if (!confirm('Delete this money entry?')) return;
    markDeleted('money', row.id);
    state.money = removeById(state.money, row.id);
  } else if (kind === 'metal') {
    if (!confirm('Delete this metal entry?')) return;
    markDeleted('metal', row.id);
    state.metal = removeById(state.metal, row.id);
  } else if (kind === 'metalMaster') {
    if (!confirm(`Delete ${row.metalType} ${row.purity} from master?`)) return;
    markDeleted('metalMaster', row.id);
    state.metalMaster = removeById(state.metalMaster, row.id);
  } else {
    if (!confirm('Delete this settlement?')) return;
    markDeleted('settlements', row.id);
    state.settlements = removeById(state.settlements, row.id);
  }
  state.modal = null;
  state.editing = null;
  await persist();
  render();
}

async function submitForm(event) {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  state.error = null;
  try {
    if (form.id === 'setup-shop') {
      if (String(data.pin) !== String(data.pin2)) throw new Error('PINs do not match');
      state.setupDraft.shopName = String(data.shopName || '').trim();
      state.setupDraft.pin = String(data.pin || '');
      state.shopName = state.setupDraft.shopName;
      state.setupStep = 2;
      landing();
      return;
    }
    if (form.id === 'setup-license') {
      state.setupDraft.licenseKey = String(data.licenseKey || '').trim();
      if (!state.setupDraft.licenseKey) throw new Error('Enter the license key from your Karigar provider');
      state.setupStep = 3;
      landing();
      return;
    }
    if (form.id === 'setup-sheet') {
      state.setupDraft.sheetUrl = data.sheetUrl;
      state.setupDraft.sheetId = parseSpreadsheetId(data.sheetUrl);
      state.setupDraft.copied = false;
      state.setupStep = 4;
      landing();
      return;
    }
    if (form.id === 'setup-exec' || form.id === 'login-form') {
      if (form.id === 'setup-exec') data.shopLock = state.setupDraft.pin;
      const submit = form.querySelector('#login-submit');
      if (submit) { submit.disabled = true; submit.textContent = 'Checking…'; }
      if (data.sheetsUrl) {
        state.sheetsUrl = normalizeAppsScriptUrl(data.sheetsUrl);
        try { localStorage.setItem(URL_KEY, state.sheetsUrl); } catch { /* ignore */ }
      }
      const typed = String(state.lockDigits || data.shopLock || data.pin || '').trim();
      state.pin = typed;
      state.lockDigits = '';
      forgetLocalPin();
      if (!typed) throw new Error('Enter the shop PIN');
      const verified = await verifyPin((payload) => sheetsRequest(payload));
      if (!admitUnlock({ typedPin: typed, remote: verified }).enter) {
        state.pin = '';
        forgetSessionUnlock();
        throw new Error('Wrong shop PIN');
      }
      writeSessionUnlock();
      await enterUnlocked();
      return;
    }
    const kind = form.dataset.kind;
    const isNew = !state.editing;
    const id = state.editing?.id || nid();
    if (kind === 'supplier') {
      const row = stamp({ ...(state.editing || {}), id, name: assertPartyName(data.name), phone: data.phone || '', notes: data.notes || '', status: 'ACTIVE' }, isNew);
      state.suppliers = upsertById(state.suppliers, row);
      markDirty('suppliers', id);
      if (isNew && Number(data.openingMoney) > 0) {
        const mid = nid();
        state.money = upsertById(state.money, stamp({ id: mid, supplierId: row.id, type: 'OPENING', amountInr: Number(data.openingMoney), date: today(), note: 'Opening' }, true));
        markDirty('money', mid);
      }
      if (isNew && Number(data.weightGrams) > 0 && data.metalType) {
        const tid = nid();
        state.metal = upsertById(state.metal, stamp({
          id: tid, supplierId: row.id, direction: 'OPENING', metalType: data.metalType,
          purity: data.purity, weightGrams: Number(data.weightGrams), date: today(), note: 'Opening'
        }, true));
        markDirty('metal', tid);
      }
      if (isNew) {
        state.view = 'supplier';
        state.supplierId = row.id;
      }
    } else if (kind === 'deal') {
      const metals = [];
      for (let i = 0; i < 8; i++) {
        if (data[`metalType_${i}`] == null && data[`metalGrams_${i}`] == null) continue;
        metals.push({
          metalType: data[`metalType_${i}`],
          purity: data[`purity_${i}`],
          direction: data[`metalDir_${i}`] || 'ISSUE',
          weightGrams: data[`metalGrams_${i}`]
        });
      }
      if (!dealIsValid({ amountInr: data.amountInr, metals })) {
        throw new Error('Enter rupees, or metal grams, or both');
      }
      const parts = splitDeal({
        supplierId: data.supplierId || state.supplierId,
        type: data.type,
        amountInr: data.amountInr,
        date: data.date,
        note: data.note,
        metals
      });
      for (const row of parts.money) {
        const mid = nid();
        state.money = upsertById(state.money, stamp({ ...row, id: mid }, true));
        markDirty('money', mid);
      }
      for (const row of parts.metal) {
        const tid = nid();
        state.metal = upsertById(state.metal, stamp({ ...row, id: tid }, true));
        markDirty('metal', tid);
      }
    } else if (kind === 'money') {
      state.money = upsertById(state.money, stamp({
        ...(state.editing || {}), id, supplierId: data.supplierId || state.supplierId, type: data.type,
        amountInr: Number(data.amountInr), date: data.date, note: data.note || ''
      }, isNew));
      markDirty('money', id);
    } else if (kind === 'metal') {
      state.metal = upsertById(state.metal, stamp({
        ...(state.editing || {}), id, supplierId: data.supplierId || state.supplierId, direction: data.direction,
        metalType: data.metalType, purity: data.purity, weightGrams: Number(data.weightGrams),
        date: data.date, note: data.note || ''
      }, isNew));
      markDirty('metal', id);
    } else if (kind === 'settle') {
      state.settlements = upsertById(state.settlements, stamp({
        ...(state.editing || {}), id, supplierId: data.supplierId || state.supplierId,
        moneyAmountInr: Number(data.moneyAmountInr || 0),
        metalType: data.metalType || '', purity: data.metalType ? data.purity : '',
        metalGrams: Number(data.metalGrams || 0), date: data.date, note: data.note || ''
      }, isNew));
      markDirty('settlements', id);
    } else if (kind === 'metalMaster') {
      const metalType = String(data.metalType || '').trim().toUpperCase();
      const purity = String(data.purity || '').trim();
      const row = stamp({
        ...(state.editing || {}), id, metalType, purity,
        rateInrPerGram: data.rateInrPerGram === '' ? '' : Number(data.rateInrPerGram),
        status: data.status || 'ACTIVE'
      }, isNew);
      state.metalMaster = upsertById(state.metalMaster, row);
      markDirty('metalMaster', id);
    }
    state.modal = null;
    state.editing = null;
    await persist();
    render();
  } catch (error) {
    state.error = error.message;
    if (form.id === 'login-form' || form.id === 'setup-exec' || form.id === 'setup-shop' || form.id === 'setup-sheet' || form.id === 'setup-license') {
      state.unlocked = false;
      state.pin = '';
      state.lockDigits = '';
      return landing();
    }
    render();
  }
}

async function enterUnlocked() {
  const cache = readCache();
  if (cache) applyLoaded(cache);
  else {
    state.unlocked = true;
    refreshSummary();
  }
  try {
    if (!localStorage.getItem(TOUR_KEY) && state.tourStep == null) {
      state.tourStep = applyTourNav(null, TOUR.length, 'start').step;
    }
  } catch { /* ignore */ }
  render();
  await refreshFromSheet();
}

async function bootstrap() {
  try {
    const stored = localStorage.getItem(URL_KEY);
    if (stored) {
      state.sheetsUrl = stored;
      state.gate = 'login';
    }
  } catch { /* ignore */ }
  state.unlocked = false;
  state.pin = '';
  state.lockDigits = '';
  const session = readSessionUnlock();
  if (session && (!state.sheetsUrl || session.sheetsUrl === state.sheetsUrl)) {
    state.sheetsUrl = session.sheetsUrl;
    state.pin = session.pin;
    state.gate = 'login';
    landing();
    try {
      const verified = await verifyPin((payload) => sheetsRequest(payload));
      if (admitUnlock({ typedPin: session.pin, remote: verified }).enter) {
        writeSessionUnlock();
        await enterUnlocked();
        return;
      }
    } catch { /* fall through to PIN */ }
    forgetSessionUnlock();
    state.pin = '';
  }
  landing();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
    .then(() => caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))))
    .then(() => navigator.serviceWorker.register('./service-worker.js?v=18'))
    .catch(() => {});
}

bootstrap();
