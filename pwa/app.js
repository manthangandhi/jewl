import { summarizeLedger, buildPassbook, rangeForPreset, reportForRange, reportCsv, puritiesForType } from './ledger-math.js';
import {
  SALE, RETURN, PAYMENT, seedCategories, categoriesForType, summarizeCustomers, buildCustomerPassbook,
  categoryTotals, salesPeriodTotals, validateSale, validatePayment, removeCustomerData
} from './customer-math.js';
import { LABEL, balanceName } from './labels.js';
import {
  NOTE_KINDS, CUSTOMER_TAGS, SUPPLIER_TAGS, telLink, whatsappLink, mailLink, duesReminderText,
  dueFollowUps, upcomingDates, notesFor, whenLabel, daysUntil
} from './crm.js';
import { fetchLiveRates, effectiveRate, suggestedAmount, ratesAreStale, describeAge } from './rates.js';
import { compressImage, photoFileName } from './photo.js';
import {
  emptyLedger, upsertById, removeById, deleteSupplierCascade, prepareSavePayload, mergeJournals, seedMetalMaster,
  dedupePartyLedger, dealIsValid, splitDeal, partyDisplayName, assertPartyName, stripDemoLedger
} from './sheet-model.js';
import { normalizeAppsScriptUrl, googleHttpErrorMessage, verifyPin, parseSpreadsheetId, fillScriptConstants, explainLedgerError } from './sheets-client.js';
import { toLedgerSnapshot, fromLedgerSnapshot, toSessionUnlock, fromSessionUnlock } from './session-cache.js';
import { admitUnlock } from './shop-auth.js';
import { resolveTourClick, applyTourNav } from './tour.js';
import { buildPartyKhataDoc, partyKhataPrintHtml, printPartyKhataHtml, sharePartyKhataPdf } from './party-khata-print.js';

const URL_KEY = 'karigar.appsScriptUrl';
const CACHE_KEY = 'karigar.ledgerCache';
const PIN_FP_KEY = 'karigar.pinFp';
const SESSION_UNLOCK_KEY = 'karigar.sessionUnlock';
const TOUR_KEY = 'karigar.tourDone';
const TEXT_KEY = 'karigar.bigText';
const LICENSE_KEY_STORE = 'karigar.licenseKey';
const RATES_KEY = 'karigar.liveRates';
const PREMIUM_KEY = 'karigar.ratePremium';
const TOUR = [
  { title: 'Today', body: 'Today shows live gold and silver rates, who to follow up with, birthdays and anniversaries coming up, and the biggest dues.' },
  { title: 'One card per person', body: 'Each supplier and each customer has one card with their phone, notes and follow-up date. Cash and every metal sit on the same card.' },
  { title: 'Hume dena and Hume lena', body: 'Hume dena means we have to give. Hume lena means we have to get. It is the same on every supplier and customer.' },
  { title: 'Suppliers', body: 'Purchase is what you bought. Payment is what you paid. Metal given and Metal received move metal with no rupees. Settlement closes the account.' },
  { title: 'Customers', body: 'Sale is what they bought. Return is what they gave back. Payment is money they paid you later. You can take a photo of the item on a sale or return.' },
  { title: 'Refresh data', body: 'Tap Refresh data to reload the Google Sheet. Browser refresh will PIN-check this tab. Lock signs you out.' }
];
const root = document.querySelector('#app');
const emptyTrack = () => ({ suppliers: [], money: [], metal: [], settlements: [], metalMaster: [], customers: [], sales: [], categories: [], interactions: [] });
const state = {
  ...emptyLedger(),
  sheetsUrl: '',
  pin: '',
  spreadsheetUrl: '',
  shopName: '',
  view: 'today',
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
  metalMaster: seedMetalMaster([]),
  reportPreset: 'month',
  reportFrom: '',
  reportTo: '',
  partyFilter: 'all',
  dealMetalCount: 1,
  tourStep: null,
  customerId: null,
  customerFilter: 'all',
  rates: null,
  ratesLoading: false,
  ratesError: '',
  premiumPct: 0,
  customerSearch: '',
  custSummary: null,
  customerDetail: null,
  pendingPhoto: null,
  photoRemoved: false,
  photoCache: {},
  scriptOutdated: false,
  bigText: false,
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
// Only ever link to Google's own https pages; the URL comes from the script's reply.
const safeSheetUrl = (u) => (/^https:\/\/(docs|drive)\.google\.com\//.test(String(u || '')) ? String(u) : '');
const nid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}`);
const partyLabel = (party) => partyDisplayName(party) || 'Party';
const supplierName = (id) => partyLabel(state.suppliers.find((s) => s.id === id) || {});
const tone = (name) => (String(name || '').split('').reduce((n, ch) => n + ch.charCodeAt(0), 0) % 4) + 1;
const avatar = (name, size = '') => `<span class="avatar ${size}" data-tone="${tone(name)}">${esc(initials(name))}</span>`;
const initials = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || 'P') + (parts[1]?.[0] || '')).toUpperCase();
};
function ic(name) {
  const paths = {
    rupee: '<path d="M7 5h10M7 9h10M7 5c5 0 7 2 7 4s-2 4-7 4l7 6"/>',
    out: '<path d="M5 19L19 5M9 5h10v10"/>',
    in: '<path d="M19 5L5 19M15 19H5V9"/>',
    bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 7l9 6 9-6"/>',
    gem: '<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l-1 5 4 11M15 4l1 5-4 11"/>',
    sold: '<path d="M6 8h12l1 12H5z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
    returned: '<path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-3"/>',
    update: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    customers: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    parties: '<path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="9" cy="7" r="3"/><path d="M22 19v-1a4 4 0 0 0-3-3.87"/><path d="M16 3.13a3 3 0 0 1 0 5.74"/>',
    today: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
    sheet: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8 13h8M8 17h5"/>',
    report: '<path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.8.4-1.4 1-1.4 1.7"/><path d="M12 17h.01"/>',
    masters: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    print: '<path d="M6 9V3h12v6"/><rect x="6" y="14" width="12" height="7"/><path d="M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/>',
    share: '<path d="M4 12v7h16v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/>'
  };
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function moneyDirection(payable) {
  if (Number(payable) > 0) return { label: LABEL.weGive, amount: Number(payable), tone: 'owe' };
  if (Number(payable) < 0) return { label: LABEL.weGet, amount: -Number(payable), tone: 'collect' };
  return { label: LABEL.square, amount: 0, tone: 'square' };
}

function metalTypeOptions(selected) {
  const types = [...new Set((state.metalMaster || []).map((row) => row.metalType).filter(Boolean))];
  const list = types.length ? types : ['GOLD', 'SILVER'];
  return list.map((t) => `<option value="${esc(t)}" ${t === selected ? 'selected' : ''}>${esc(titleCase(t))}</option>`).join('');
}

function categoryOptions(metalType, selected) {
  const list = categoriesForType(state.categories, metalType || 'GOLD');
  const withCurrent = selected && !list.includes(selected) ? [selected, ...list] : list;
  return `<option value="">Choose…</option>${withCurrent.map((c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
}

const customerLabel = (c) => String(c?.name || '').trim() || 'Customer';

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

const titleCase = (v) => String(v || '').toLowerCase().replace(/(^|\s)([a-z])/g, (m, sp, ch) => sp + ch.toUpperCase());
const metalLabel = (key) => {
  const [type, purity] = String(key).split(':');
  return `${titleCase(type)} ${purity || ''}`.trim();
};

function metalPills(map) {
  const entries = Object.entries(map || {}).filter(([, v]) => Number(v) !== 0);
  if (!entries.length) return '';
  return `<div class="metal-pills">${entries.map(([key, v]) => `<span class="pill" data-metal="${esc(String(key).split(':')[0])}">${esc(metalLabel(key))}<b>${grams(v)}</b></span>`).join('')}</div>`;
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
  state.custSummary = summarizeCustomers(state.customers, state.sales);
  if (state.view === 'customer' && state.customerId) {
    const customer = state.customers.find((c) => c.id === state.customerId);
    const row = state.custSummary.byCustomer.find((r) => r.id === state.customerId);
    state.customerDetail = customer ? {
      customer,
      balance: row?.balance || 0,
      metalNet: row?.metalNet || {},
      passbook: buildCustomerPassbook(customer.id, state.sales)
    } : null;
  } else {
    state.customerDetail = null;
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
    metalMaster: seedMetalMaster(Array.isArray(data.metalMaster) ? data.metalMaster : []),
    customers: Array.isArray(data.customers) ? data.customers : [],
    sales: Array.isArray(data.sales) ? data.sales : [],
    categories: seedCategories(Array.isArray(data.categories) ? data.categories : []),
    interactions: Array.isArray(data.interactions) ? data.interactions : []
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
  state.customers = incoming.customers;
  state.sales = incoming.sales;
  state.categories = incoming.categories;
  state.interactions = incoming.interactions;
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
  try { localStorage.setItem(LICENSE_KEY_STORE, state.setupDraft.licenseKey); } catch { /* ignore */ }
  state.setupDraft.copied = true;
  state.error = null;
  landing();
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    throw new Error('Your browser did not allow copying. Allow clipboard access and try again.');
  }
}

function flashButton(btn, text) {
  if (!btn) return;
  const label = btn.querySelector('span') || btn;
  const old = label.textContent;
  label.textContent = text;
  setTimeout(() => { label.textContent = old; }, 2200);
}

async function copyUpdatedScript() {
  const btn = root.querySelector('[data-action="copy-update-script"]');
  const key = String(root.querySelector('#upd-license')?.value || '').trim();
  if (!key) throw new Error('Type your license key first (the one your Karigar provider sent).');
  try { localStorage.setItem(LICENSE_KEY_STORE, key); } catch { /* ignore */ }
  const res = await fetch('./google-apps-script.gs', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load the new script. Check your internet and try again.');
  let licenseUrl = '';
  try {
    const lic = await fetch('./license-url.txt', { cache: 'no-store' });
    if (lic.ok) licenseUrl = (await lic.text()).trim().split('\n')[0].trim();
  } catch { /* handled below */ }
  if (!licenseUrl) throw new Error('This copy of Karigar has no license server set. Ask your Karigar provider.');
  try { localStorage.setItem(LICENSE_KEY_STORE, key); } catch { /* ignore */ }
  const filled = fillScriptConstants(await res.text(), { pin: state.pin, licenseKey: key, licenseUrl });
  await writeClipboard(filled);
  flashButton(btn, 'Copied ✓ — now paste it');
}

async function copyManifest() {
  const btn = root.querySelector('[data-action="copy-update-manifest"]');
  const res = await fetch('./appsscript.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load the permissions file.');
  await writeClipboard(await res.text());
  flashButton(btn, 'Copied ✓');
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
      metalMaster: mergeJournals(remote.metalMaster || [], state.metalMaster, { deletedIds: state.deleted.metalMaster, dirtyIds: state.dirty.metalMaster }),
      customers: mergeJournals(remote.customers || [], state.customers, { deletedIds: state.deleted.customers, dirtyIds: state.dirty.customers }),
      sales: mergeJournals(remote.sales || [], state.sales, { deletedIds: state.deleted.sales, dirtyIds: state.dirty.sales }),
      categories: mergeJournals(remote.categories || [], state.categories, { deletedIds: state.deleted.categories, dirtyIds: state.dirty.categories }),
      interactions: mergeJournals(remote.interactions || [], state.interactions, { deletedIds: state.deleted.interactions, dirtyIds: state.dirty.interactions })
    };
    const outdated = !Array.isArray(remote.interactions);
    applyLoaded(merged);
    state.scriptOutdated = outdated;
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
  if (!confirm('Write a 3-month DEMO khata (suppliers and customers) into this Google Sheet? Sample rows use demo- ids. Your real entries stay. Do not use this on a live shop.')) return;
  state.syncing = true;
  render();
  try {
    const result = await sheetsRequest({ action: 'seedDemo', replace: true });
    if (result.seeded === false) {
      state.error = 'This Sheet already has suppliers. The sample khata was not written.';
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
  if (![...state.suppliers, ...state.customers].some((row) => String(row.id || '').startsWith('demo-'))) {
    state.error = 'No sample khata on this Sheet.';
    render();
    return;
  }
  if (!confirm('Remove the DEMO sample khata (suppliers and customers) from this Google Sheet? Your real suppliers and customers stay.')) return;
  state.syncing = true;
  render();
  try {
    await sheetsRequest({ action: 'clearDemo' });
    // Drop the demo rows from this screen too, so a refresh cannot merge them back.
    Object.assign(state, stripDemoLedger(state));
    state.view = 'parties';
    state.supplierId = null;
    state.customerId = null;
    refreshSummary();
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
      metalMaster: state.metalMaster,
      customers: state.customers,
      sales: state.sales,
      categories: state.categories,
      interactions: state.interactions
    });
    const data = await sheetsRequest({ action: 'save', ...payload });
    state.spreadsheetUrl = data.spreadsheetUrl || state.spreadsheetUrl;
    state.lastSavedAt = data.lastSavedAt || now;
    state.dirty = emptyTrack();
    state.deleted = emptyTrack();
    refreshSummary();
    writeCache();
    toast('Saved to your Google Sheet');
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

function currentPartyKhataDoc() {
  const detail = state.detail;
  if (!detail?.supplier) throw new Error('Open a supplier to print their khata.');
  return buildPartyKhataDoc({
    shopName: state.shopName,
    party: { ...detail.supplier, name: partyLabel(detail.supplier) },
    payable: detail.payable,
    metalByPurity: detail.metalByPurity,
    passbook: detail.passbook
  });
}

function printOpenPartyKhata() {
  printPartyKhataHtml(partyKhataPrintHtml(currentPartyKhataDoc()));
}

async function shareOpenPartyKhata() {
  try {
    await sharePartyKhataPdf(currentPartyKhataDoc());
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    state.error = error.message || 'Could not share the supplier khata.';
    render();
  }
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
    <div class="brand"><span class="brand-mark">${ic('gem')}</span> Karigar</div>
    <h1>Your Sheet.<br>This counter.</h1>
    <p>Karigar, supplier, cash and metal — one name, one khata. Books stay in the shop’s Google Sheet.</p>
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
      <h1>Shop and PIN</h1>
      <p class="count">Step 1 of 5</p>
      <p>Same PIN goes into Apps Script in a moment.</p>
      ${err}
      <form id="setup-shop">
        <label>Shop name<input name="shopName" required value="${esc(d.shopName)}" placeholder="e.g. Mehta Jewellers"></label>
        <label>Shop PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" required minlength="4" value="${esc(d.pin)}" placeholder="4 or more digits"></label>
        <label>Type PIN again<input name="pin2" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" required value="${esc(d.pin)}"></label>
        <button class="btn btn-primary">Continue</button>
      </form>`;
  } else if (state.setupStep === 2) {
    body = `
      <h1>License</h1>
      <p class="count">Step 2 of 5</p>
      <p>Key from your Karigar provider.</p>
      ${err}
      <form id="setup-license">
        <label>License key<input name="licenseKey" required value="${esc(d.licenseKey)}" placeholder="The key they WhatsApp you"></label>
        <button class="btn btn-primary">Continue</button>
      </form>`;
  } else if (state.setupStep === 3) {
    body = `
      <h1>Your Sheet</h1>
      <p class="count">Step 3 of 5</p>
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
      <p class="count">Step 4 of 5</p>
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
      <p class="count">Step 5 of 5</p>
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
    <div class="brand"><span class="brand-mark">${ic('gem')}</span> Karigar</div>
    ${setupDots()}
    ${body}
    <p class="setup-toggle"><button type="button" class="btn-plain" data-action="setup-back">Back</button></p>
  `);
}

function loginScreen() {
  const configured = Boolean(state.sheetsUrl);
  const askUrl = !configured || state.setupOpen;
  onboardShell(`
    <div class="brand"><span class="brand-mark">${ic('gem')}</span> Karigar</div>
    <h1>Unlock</h1>
    ${configured ? '<p class="pin-hint">Type your shop PIN. Your phone or computer keyboard will open.</p>' : '<p>Paste the shop /exec URL, then PIN.</p>'}
    ${state.error ? `<div class="notice">${esc(state.error)}</div>` : ''}
    <form id="login-form" autocomplete="on">
      <input class="autofill-trap" type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" value="karigar-shop">
      ${askUrl ? `<label>Web app URL (/exec)<input name="sheetsUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec" ${configured ? '' : 'required'} value="${esc(state.sheetsUrl)}" autocomplete="off"></label>` : ''}
      <label class="pin-label">Shop PIN
        <input name="shopLock" class="pin-entry" type="password" inputmode="numeric" pattern="[0-9]*" enterkeyhint="go" autocomplete="current-password" minlength="4" required ${askUrl ? '' : 'autofocus'} autocapitalize="off" spellcheck="false">
      </label>
      <label class="check-row"><input type="checkbox" id="show-pin"> <span>Show PIN</span></label>
      <button class="btn btn-primary btn-block" id="login-submit">Unlock</button>
    </form>
    <p class="setup-toggle">
      ${configured ? `<button type="button" class="btn-plain" data-action="setup">Use a different Sheet</button>` : ''}
      <button type="button" class="btn-plain" data-action="gate" data-gate="setup">New shop</button>
      <a class="btn-plain" href="./about.html" target="_blank" rel="noopener">About and support</a>
    </p>
  `);
}

function effRate(metalType, purity) {
  return effectiveRate({ master: state.metalMaster, snapshot: state.rates, premiumPct: state.premiumPct }, metalType, purity);
}

/** The rows shown for rates: every active metal and purity the shop uses, with a rate where one is known. */
function rateRows() {
  const rank = (t) => ({ GOLD: 0, SILVER: 1, PLATINUM: 2 }[String(t).toUpperCase()] ?? 3);
  return (state.metalMaster || [])
    .filter((row) => String(row.status || 'ACTIVE') !== 'INACTIVE')
    .map((row) => ({ row, ...effRate(row.metalType, row.purity) }))
    .sort((a, b) => rank(a.row.metalType) - rank(b.row.metalType) || String(b.row.purity).localeCompare(String(a.row.purity), 'en', { numeric: true }));
}

function rateBoard() {
  const rows = rateRows().filter((r) => r.perGram > 0);
  if (!rows.length) return '';
  return `<div class="rate-board" aria-label="Rates per gram">${rows.map((r) => (
    `<div class="rate-chip" data-metal="${esc(r.row.metalType)}"><em>${esc(titleCase(r.row.metalType))} ${esc(r.row.purity)}</em><strong>${money(r.perGram)}/g</strong></div>`
  )).join('')}</div>`;
}

function ratesCard() {
  const rows = rateRows();
  const age = state.rates ? describeAge(state.rates.fetchedAt) : '';
  const status = state.ratesLoading ? 'Updating…' : state.ratesError ? state.ratesError : age ? `Live, updated ${age}` : '';
  return `<section class="list-card rates-card" id="rates-card">
    <div class="list-head"><span>Today’s rates</span><button type="button" class="btn-plain" data-action="refresh-rates" ${state.ratesLoading ? 'disabled' : ''}>${ic('refresh')}<span>Refresh rates</span></button></div>
    ${status ? `<p class="rates-status ${state.ratesError ? 'bad' : ''}" role="status">${esc(status)}</p>` : ''}
    ${rows.length && rows.some((r) => r.perGram > 0) ? `<ul class="rate-list">${rows.map((r) => `<li data-metal="${esc(r.row.metalType)}">
      <span class="rate-name">${esc(titleCase(r.row.metalType))} ${esc(r.row.purity)}</span>
      <span class="rate-src">${r.source === 'board' ? 'Your board rate' : r.source === 'live' ? 'Live' : ''}</span>
      <strong>${r.perGram ? `${money(r.perGram)}<small>per gram</small>` : 'No rate yet'}</strong>
    </li>`).join('')}</ul>` : `<p class="lede">${rows.length ? (state.ratesLoading ? 'Fetching today’s rates…' : 'Rates will show here as soon as the internet is back. You can also type a board rate for each metal on the Metals page.') : 'Add a metal under Metals to see its rate here.'}</p>`}
    <form class="premium-row" id="premium-form">
      <label>Add to the international price (percent)
        <input name="premium" type="number" step="0.1" inputmode="decimal" value="${esc(state.premiumPct || '')}" placeholder="0">
      </label>
      <p class="hint">Live rates are the international price turned into rupees. Indian board rates usually run a few percent higher because of duty and tax. Add that difference here, or type your own board rate on the Metals page, which always wins.</p>
    </form>
  </section>`;
}

function refreshRateDom() {
  const board = root.querySelector('.rate-board');
  const html = rateBoard();
  if (board && html) board.outerHTML = html;
  else if (board && !html) board.remove();
  else if (!board && html) { const stage = root.querySelector('.stage'); if (stage) stage.insertAdjacentHTML('beforebegin', html); }
  const card = root.querySelector('#rates-card');
  if (card) card.outerHTML = ratesCard();
  const bar = root.querySelector('.appbar-end .btn-refresh');
  if (bar) bar.disabled = state.syncing;
  updateRateSuggest();
}

function loadSavedRates() {
  try {
    const saved = JSON.parse(localStorage.getItem(RATES_KEY) || 'null');
    if (saved && saved.usdInr > 0 && saved.gold > 0) state.rates = saved;
    state.premiumPct = Number(localStorage.getItem(PREMIUM_KEY) || 0) || 0;
  } catch { /* ignore */ }
}

async function loadRates(force = false) {
  if (state.ratesLoading) return;
  if (!force && state.rates && !ratesAreStale(state.rates.fetchedAt)) return;
  if (!force && Date.now() - (state.ratesTriedAt || 0) < 60000) return;
  state.ratesTriedAt = Date.now();
  state.ratesLoading = true;
  state.ratesError = '';
  if (state.unlocked) refreshRateDom();
  try {
    state.rates = await fetchLiveRates(fetch);
    try { localStorage.setItem(RATES_KEY, JSON.stringify(state.rates)); } catch { /* ignore */ }
  } catch {
    state.ratesError = state.rates ? 'Could not refresh. Showing the last rates.' : 'Could not load live rates. Check your internet.';
  } finally {
    state.ratesLoading = false;
    if (state.unlocked) refreshRateDom();
  }
}

/** Under the weight field of a sale: what that weight comes to at today's rate, one tap to use it. */
function updateRateSuggest() {
  const form = root.querySelector('form[data-kind="sale"]');
  const box = root.querySelector('#rate-suggest');
  if (!form || !box || !form.elements.metalType) return;
  const { perGram, source } = effRate(form.elements.metalType.value, form.elements.purity.value);
  const amount = suggestedAmount(form.elements.weightGrams.value, perGram);
  if (!perGram) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = amount
    ? `At ${source === 'board' ? 'your board rate' : 'today’s live rate'} of ${money(perGram)} a gram, this comes to <b>${money(amount)}</b>. <button type="button" class="btn-plain" data-action="use-suggest" data-amount="${amount}">Use this amount</button>`
    : `${source === 'board' ? 'Your board rate' : 'Today’s live rate'}: ${money(perGram)} a gram.`;
}

function metalMasterGroups(rows) {
  const rank = (t) => {
    const u = String(t || '').toUpperCase();
    if (u === 'GOLD') return 0;
    if (u === 'SILVER') return 1;
    return 2;
  };
  const map = new Map();
  for (const row of rows || []) {
    const key = row.metalType || 'OTHER';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.entries()].sort((a, b) => {
    const d = rank(a[0]) - rank(b[0]);
    return d !== 0 ? d : String(a[0]).localeCompare(String(b[0]));
  });
}

function recordActions() {
  if (!state.suppliers.length) return '';
  const S = LABEL.supplier;
  return `<div class="action-bar four" role="group" aria-label="Supplier entries">
    <button type="button" class="act primary" data-action="modal" data-modal="purchase">${ic('sold')}<span><strong>${S.purchase}</strong><small>We bought</small></span></button>
    <button type="button" class="act" data-action="modal" data-modal="payment">${ic('rupee')}<span><strong>${S.payment}</strong><small>We paid</small></span></button>
    <button type="button" class="act" data-action="modal" data-modal="issue">${ic('out')}<span><strong>${S.metalGiven}</strong><small>We gave metal</small></span></button>
    <button type="button" class="act" data-action="modal" data-modal="receive">${ic('in')}<span><strong>${S.metalReceived}</strong><small>We got metal</small></span></button>
  </div>`;
}

function customerRows() {
  const q = state.customerSearch.trim().toLowerCase();
  const t = today();
  let rows = state.custSummary?.byCustomer || [];
  const byId = Object.fromEntries(state.customers.map((c) => [c.id, c]));
  if (state.customerFilter === 'owe') rows = rows.filter((row) => row.balance > 0);
  if (state.customerFilter === 'vip') rows = rows.filter((row) => byId[row.id]?.tag === 'VIP');
  if (state.customerFilter === 'follow') rows = rows.filter((row) => { const d = daysUntil(byId[row.id]?.followUpDate, t); return d !== null && d <= 3; });
  if (!q) return rows;
  return rows.filter((row) => row.name.toLowerCase().includes(q) || String(row.phone || '').toLowerCase().includes(q));
}

function customerTone(balance) {
  if (balance > 0) return { label: LABEL.weGet, amount: balance, tone: 'collect' };
  if (balance < 0) return { label: LABEL.weGive, amount: -balance, tone: 'owe' };
  return { label: LABEL.square, amount: 0, tone: 'square' };
}

function saleActions() {
  if (!state.customers.length) return '';
  const C = LABEL.customer;
  return `<div class="action-bar three" role="group" aria-label="Customer entries">
    <button type="button" class="act primary" data-action="modal" data-modal="sale">${ic('sold')}<span><strong>${C.sale}</strong><small>They bought</small></span></button>
    <button type="button" class="act return" data-action="modal" data-modal="return">${ic('returned')}<span><strong>${C.return}</strong><small>They gave back</small></span></button>
    <button type="button" class="act" data-action="modal" data-modal="custpay">${ic('rupee')}<span><strong>${C.payment}</strong><small>They paid us</small></span></button>
  </div>`;
}

function customersHome() {
  const s = state.custSummary || {};
  const rows = customerRows();
  const month = salesPeriodTotals(state.sales, rangeForPreset('month'));
  const recent = state.sales
    .filter((row) => String(row.date || '').slice(0, 10) >= rangeForPreset('month').from)
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 8);
  const list = rows.length ? `<section class="list-card blotter grow">
      <div class="list-head"><span>Customers</span><span>${rows.length}</span></div>
      <div class="party-list">${rows.map((row) => {
    const t = customerTone(row.balance);
    return `<button type="button" class="cell party-row party-card ${t.tone}" data-customer="${esc(row.id)}">
        ${avatar(row.name)}
        <span class="cell-main party-body">
          <span class="party-title-row"><strong class="party-name">${esc(row.name)}</strong>${String(row.id || '').startsWith('demo-') ? '<small class="demo-tag">DEMO</small>' : ''}</span>
          ${row.phone ? `<small class="party-phone">${esc(row.phone)}</small>` : ''}
          ${metalPills(row.metalNet)}
        </span>
        <span class="cell-trail party-bal ${t.tone}">${t.amount ? `<em class="bal-label">${t.label}</em><b class="bal-fig">${money(t.amount)}</b>` : '<em class="bal-label">Square</em><b class="zero">—</b>'}</span>
        ${ic('chevron')}
      </button>`;
  }).join('')}</div>
    </section>` : `<div class="empty-khata grow">
      <span class="empty-gem">${ic('gem')}</span>
      <p class="empty-title">${state.customers.length ? 'No match' : 'No customers yet'}</p>
      <p class="lede">${state.customers.length ? 'Try another name or number.' : 'Add the people who buy from you. Then tap Sale, Return or Payment on them.'}</p>
      ${state.customers.length ? '' : '<button class="btn btn-primary" data-action="modal" data-modal="customer">Add customer</button>'}
    </div>`;
  return `
    <div class="desk-split fill">
      <div class="desk-col">
        <section class="balance-hero">
          <div class="bh collect"><span>${LABEL.weGet}</span><strong>${money(s.customersOweInr || 0)}</strong></div>
          <div class="bh owe"><span>${LABEL.weGive}</span><strong>${money(s.weOweCustomersInr || 0)}</strong></div>
        </section>
        ${saleActions()}
        <div class="filter-row">
          <div class="search-bar">${ic('search')}<input class="search" data-scope="customer" name="search" value="${esc(state.customerSearch)}" placeholder="Search customers" aria-label="Search customers"></div>
          <div class="chips">
            ${[['all', 'All'], ['owe', LABEL.weGet], ['vip', 'VIP'], ['follow', 'Follow-up']].map(([id, label]) => `<button type="button" class="chip ${state.customerFilter === id ? 'on' : ''}" data-action="customer-filter" data-filter="${id}">${label}</button>`).join('')}
          </div>
        </div>
        ${list}
      </div>
      <aside class="side-panel">
        <div class="list-head"><span>This month</span><button type="button" class="btn-plain" data-view="report">Report</button></div>
        <div class="mini-stats">
          <div><span>Sales</span><strong>${money(month.soldInr)}</strong></div>
          <div><span>Returns</span><strong>${money(month.returnedInr)}</strong></div>
          <div><span>Gold/silver sold</span><strong>${grams(month.soldGrams)}</strong></div>
          <div><span>Taken back</span><strong>${grams(month.returnedGrams)}</strong></div>
        </div>
        <ol class="passbook-list tight">${recent.map((row) => `
          <li class="cell clickable" data-edit="sale" data-id="${esc(row.id)}">
            <span class="cell-main"><strong>${row.kind === PAYMENT ? LABEL.customer.payment : (row.kind === RETURN ? LABEL.customer.return : LABEL.customer.sale)}${row.category ? `, ${esc(row.category)}` : ''}</strong><small>${esc(row.customerName || customerLabel(state.customers.find((c) => c.id === row.customerId)))}, ${fmtDate(row.date)}</small></span>
            <span class="cell-trail"><b>${money(row.amountInr)}</b></span>
          </li>`).join('') || '<li class="empty-in">No sales this month</li>'}</ol>
      </aside>
    </div>
    <button class="fab" data-action="modal" data-modal="customer" type="button" aria-label="Add customer">+</button>`;
}

function customerPassbook() {
  const detail = state.customerDetail;
  if (!detail?.customer) return '<div class="empty-khata">Customer not found.</div>';
  const t = customerTone(detail.balance);
  const lines = detail.passbook || [];
  return `
    <div class="desk-col fill">
    <header class="party-head">
      <button class="icon-btn back" data-view="customers" type="button" aria-label="Back">${ic('chevron')}</button>
      <div class="party-id">
        ${avatar(customerLabel(detail.customer), 'lg')}
        <div>
          <h1 class="party-name">${esc(customerLabel(detail.customer))}</h1>
          ${detail.customer.phone ? `<p class="party-phone">${esc(detail.customer.phone)}</p>` : ''}
        </div>
      </div>
      <div class="party-tools">
        <button class="btn-plain" data-edit="customer" data-id="${esc(detail.customer.id)}" type="button">Edit</button>
      </div>
    </header>
    <section class="balance-hero tight">
      <div class="bh ${t.tone}"><span>${t.label}</span><strong>${money(t.amount)}</strong></div>
      <div class="bh"><span>Bought (net metal)</span><div>${metalPills(detail.metalNet) || '<strong>—</strong>'}</div></div>
    </section>
    ${saleActions()}
    ${crmPanel('customer', detail.customer, detail.balance)}
    <section class="list-card blotter grow">
      <div class="list-head"><span>Sales, returns and payments</span><span>${lines.length}</span></div>
      ${lines.length ? `<ol class="passbook-list">${lines.map((line) => `
        <li class="cell clickable" data-edit="sale" data-id="${esc(line.id)}">
          <time class="pass-date">${esc(fmtDate(line.date))}</time>
          <span class="cell-main">
            <strong>${line.label}${line.hasPhoto ? ` <span class="photo-flag" title="Has photo">${ic('camera')}</span>` : ''}</strong>
            <small>${esc([line.detail, line.note].filter(Boolean).join(', '))}</small>
          </span>
          <span class="cell-trail">
            <b class="${line.kind === 'return' ? 'owe' : 'collect'}">${money(line.amountInr)}</b>
            <em class="hisab"><span>Paid ${money(line.paidInr)}</span><span>Balance ${money(line.runningInr)}</span></em>
          </span>
        </li>`).join('')}</ol>` : '<div class="empty-in">Nothing yet. Tap Sale when this customer buys.</div>'}
    </section>
    </div>`;
}

function customerSalesCard(range) {
  const totals = salesPeriodTotals(state.sales, range);
  if (!totals.count) return '';
  const cats = categoryTotals(state.sales, range);
  return `<section class="list-card">
    <div class="list-head"><span>Customer sales by item</span><span>${totals.count}</span></div>
    <div class="mini-stats cat-stats">
      <div><span>Sales</span><strong>${money(totals.soldInr)}</strong></div>
      <div><span>Returns</span><strong>${money(totals.returnedInr)}</strong></div>
      <div><span>Weight sold</span><strong>${grams(totals.soldGrams)}</strong></div>
      <div><span>Weight returned</span><strong>${grams(totals.returnedGrams)}</strong></div>
    </div>
    ${cats.length ? `<ol class="barchart" aria-label="Net weight by item, in grams">${(() => {
      const max = Math.max(...cats.map((r) => Math.abs(r.netGrams)), 1);
      return cats.filter((r) => r.netGrams > 0).slice(0, 8).map((r) => `<li title="${esc(r.category)}: ${grams(r.netGrams)} net">
        <span>${esc(r.category)} <small>${esc(titleCase(r.metalType))}</small></span>
        <span class="bar-track"><i class="bar" style="--w:${Math.max(2, Math.round((r.netGrams / max) * 100))}%"></i></span>
        <b>${grams(r.netGrams)}</b></li>`).join('');
    })()}</ol>` : ''}
    <div class="data-table cat-table">
      <div class="th"><span>Item</span><span>Sales</span><span>Returns</span><span>Net</span></div>
      ${cats.map((row) => `<div class="tr">
        <span>${esc(row.category)} <small>${esc(titleCase(row.metalType))}</small></span><span>${grams(row.soldGrams)}</span><span>${grams(row.returnedGrams)}</span><span>${grams(row.netGrams)}</span>
      </div>`).join('')}
    </div>
  </section>`;
}

const contactParty = (kind, id) => (kind === 'customer' ? state.customers : state.suppliers).find((p) => p.id === id);

function factRow(label, value) {
  return value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : '';
}

/** Contact buttons, details, follow-up and notes for one supplier or customer. */
function crmPanel(kind, party, owesUs = 0) {
  const phone = party.phone || '';
  const call = telLink(phone);
  const wa = whatsappLink(phone);
  const mail = mailLink(party.email);
  const remind = kind === 'customer' && owesUs > 0 && whatsappLink(phone, duesReminderText({ shopName: state.shopName, name: party.name, amountInr: owesUs }));
  const buttons = [
    call ? `<a class="btn btn-soft" href="${esc(call)}">${ic('phone')}<span>Call</span></a>` : '',
    wa ? `<a class="btn btn-soft" href="${esc(wa)}" target="_blank" rel="noopener">${ic('chat')}<span>WhatsApp</span></a>` : '',
    mail ? `<a class="btn btn-soft" href="${esc(mail)}">${ic('mail')}<span>Email</span></a>` : '',
    remind ? `<a class="btn btn-soft" href="${esc(remind)}" target="_blank" rel="noopener">${ic('bell')}<span>Remind about dues</span></a>` : ''
  ].filter(Boolean).join('');
  const facts = [
    factRow('Type', party.tag ? esc(party.tag) : ''),
    factRow('City', party.city ? esc(party.city) : ''),
    factRow('Address', party.address ? esc(party.address) : ''),
    factRow('Email', party.email ? esc(party.email) : ''),
    kind === 'supplier' ? factRow('GSTIN', party.gstin ? esc(party.gstin) : '') : '',
    kind === 'customer' ? factRow('Birthday', party.birthday ? esc(fmtLong(party.birthday)) : '') : '',
    kind === 'customer' ? factRow('Anniversary', party.anniversary ? esc(fmtLong(party.anniversary)) : '') : '',
    factRow('Notes', party.notes ? esc(party.notes) : '')
  ].join('');
  const days = daysUntil(party.followUpDate, today());
  const follow = party.followUpDate ? `<div class="followup ${days !== null && days < 0 ? 'late' : ''}">
      <span class="followup-icon">${ic('bell')}</span>
      <span class="followup-text"><strong>${esc(whenLabel(days))}${party.followUpNote ? `: ${esc(party.followUpNote)}` : ''}</strong><small>Follow-up on ${esc(fmtLong(party.followUpDate))}</small></span>
      <button type="button" class="btn btn-soft" data-action="followup-done" data-kind="${kind}" data-id="${esc(party.id)}">Done</button>
    </div>` : '';
  const notes = notesFor(state.interactions, party.id);
  return `<section class="crm" aria-label="Contact and notes">
    ${buttons ? `<div class="contact-row">${buttons}</div>` : ''}
    ${follow}
    ${facts ? `<dl class="facts">${facts}</dl>` : ''}
    <section class="list-card notes">
      <div class="list-head"><span>Notes and calls</span><button type="button" class="btn-plain" data-action="add-note" data-kind="${kind}" data-id="${esc(party.id)}">+ Add note</button></div>
      ${notes.length ? `<ol class="note-list">${notes.map((n) => `<li class="cell clickable" data-edit="interaction" data-id="${esc(n.id)}">
        <time class="pass-date">${esc(fmtDate(n.date))}</time>
        <span class="cell-main"><strong>${esc(n.kind || 'Note')}</strong><small>${esc(n.text || '')}</small></span>
      </li>`).join('')}</ol>` : '<div class="empty-in">No notes yet. Write down what was said, so you remember next time.</div>'}
    </section>
  </section>`;
}

function fmtLong(v) {
  const d = new Date(String(v).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const wishText = (c, label) => `${label === 'Birthday' ? `Happy birthday ${c.name}! Wishing you a wonderful year ahead.` : `Happy anniversary ${c.name}! Wishing you many more happy years together.`} From all of us at ${state.shopName || 'our shop'}.`;

function todayView() {
  const t = today();
  const everyone = [
    ...state.customers.map((c) => ({ ...c, _kind: 'customer' })),
    ...state.suppliers.map((c) => ({ ...c, _kind: 'supplier' }))
  ];
  const follow = dueFollowUps(everyone, t, 3);
  const dates = upcomingDates(state.customers, t, 7);
  const collect = (state.custSummary?.byCustomer || []).filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 5);
  const pay = (state.summary?.bySupplier || []).filter((r) => r.payable > 0).sort((a, b) => b.payable - a.payable).slice(0, 5);
  const link = (kind, id) => (kind === 'customer' ? `data-customer="${esc(id)}"` : `data-supplier="${esc(id)}"`);
  const empty = (text) => `<div class="empty-in">${text}</div>`;
  return `
    <div class="today">
      <div class="today-rates">${ratesCard()}</div>
      <section class="list-card">
        <div class="list-head"><span>Follow-ups</span><span>${follow.length}</span></div>
        ${follow.length ? `<ul class="plain-list">${follow.map(({ party, days }) => `<li><button type="button" class="cell" ${link(party._kind, party.id)}>
          ${avatar(party.name)}
          <span class="cell-main"><strong>${esc(party.name)}</strong><small>${esc(party.followUpNote || (party._kind === 'customer' ? 'Customer' : 'Supplier'))}</small></span>
          <span class="cell-trail ${days < 0 ? 'owe' : ''}"><b>${esc(whenLabel(days))}</b></span>
        </button></li>`).join('')}</ul>` : empty('Nobody to follow up with. Add a follow-up date on a customer or supplier.')}
      </section>
      <section class="list-card">
        <div class="list-head"><span>Birthdays and anniversaries</span><span>${dates.length}</span></div>
        ${dates.length ? `<ul class="plain-list">${dates.map((d) => {
    const wa = whatsappLink(d.customer.phone, wishText(d.customer, d.label));
    return `<li class="cell">
          <button type="button" class="cell-hit" data-customer="${esc(d.customer.id)}">
            ${avatar(d.customer.name)}
            <span class="cell-main"><strong>${esc(d.customer.name)}</strong><small>${d.label}, ${esc(whenLabel(d.days).toLowerCase())}</small></span>
          </button>
          ${wa ? `<a class="btn btn-soft" href="${esc(wa)}" target="_blank" rel="noopener">${ic('chat')}<span>Wish</span></a>` : ''}
        </li>`;
  }).join('')}</ul>` : empty('No birthdays or anniversaries in the next 7 days.')}
      </section>
      <section class="list-card">
        <div class="list-head"><span>${LABEL.weGet}, customers</span><span>${money((state.custSummary?.customersOweInr) || 0)}</span></div>
        ${collect.length ? `<ul class="plain-list">${collect.map((r) => `<li><button type="button" class="cell" data-customer="${esc(r.id)}">
          ${avatar(r.name)}<span class="cell-main"><strong>${esc(r.name)}</strong><small>${r.lastDate ? `Last entry ${esc(fmtDate(r.lastDate))}` : ''}</small></span>
          <span class="cell-trail collect"><b>${money(r.balance)}</b></span></button></li>`).join('')}</ul>` : empty('No customer owes you anything.')}
      </section>
      <section class="list-card">
        <div class="list-head"><span>${LABEL.weGive}, suppliers</span><span>${money((state.summary?.weOweInr) || 0)}</span></div>
        ${pay.length ? `<ul class="plain-list">${pay.map((r) => `<li><button type="button" class="cell" data-supplier="${esc(r.id)}">
          ${avatar(r.name)}<span class="cell-main"><strong>${esc(r.name)}</strong></span>
          <span class="cell-trail owe"><b>${money(r.payable)}</b></span></button></li>`).join('')}</ul>` : empty('You do not owe any supplier.')}
      </section>
    </div>`;
}

function partiesHome() {
  const s = state.summary || {};
  const rows = partyRows();
  const month = reportForRange({
    suppliers: state.suppliers, money: state.money, metal: state.metal, settlements: state.settlements,
    ...rangeForPreset('month')
  });
  const list = state.syncing && !rows.length ? `<div class="skeleton" role="status" aria-label="Loading"><i></i><i></i><i></i></div>` : rows.length ? `<section class="list-card blotter grow">
      <div class="list-head"><span>Suppliers</span><span>${rows.length}</span></div>
      <div class="party-list">${rows.map((row) => {
    const dir = moneyDirection(row.payable);
    const metal = metalPills(row.metalByPurity);
    const party = state.suppliers.find((s) => s.id === row.id) || {};
    return `<button type="button" class="cell party-row party-card ${dir.tone}" data-supplier="${esc(row.id)}">
        ${avatar(partyLabel(party) !== 'Party' ? partyLabel(party) : partyLabel(row))}
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
      <span class="empty-gem">${ic('gem')}</span>
      <p class="empty-title">No suppliers yet</p>
      <p class="lede">Add a karigar or supplier. Gold, silver, and cash all sit on that one card.</p>
      <button class="btn btn-primary" data-action="modal" data-modal="supplier">Add supplier</button>
    </div>`;
  return `
    <div class="desk-split fill">
      <div class="desk-col">
        <section class="balance-hero">
          <div class="bh owe"><span>Hume dena</span><strong>${money(s.weOweInr || 0)}</strong></div>
          <div class="bh collect"><span>${LABEL.weGet}</span><strong>${money(s.theyOweInr || 0)}</strong></div>
        </section>
        <div class="filter-row">
          <div class="search-bar">${ic('search')}<input class="search" name="search" value="${esc(state.search)}" placeholder="Search suppliers" aria-label="Search suppliers"></div>
          <div class="chips">
            <button type="button" class="chip ${state.partyFilter === 'all' ? 'on' : ''}" data-action="party-filter" data-filter="all">All</button>
            <button type="button" class="chip ${state.partyFilter === 'owe' ? 'on' : ''}" data-action="party-filter" data-filter="owe">${LABEL.weGive}</button>
            <button type="button" class="chip ${state.partyFilter === 'collect' ? 'on' : ''}" data-action="party-filter" data-filter="collect">${LABEL.weGet}</button>
          </div>
        </div>
        ${list}
      </div>
      <aside class="side-panel">
        <div class="list-head"><span>This month</span><button type="button" class="btn-plain" data-view="report">Report</button></div>
        <div class="mini-stats">
          <div><span>Purchases</span><strong>${money(month.purchases)}</strong></div>
          <div><span>Payments</span><strong>${money(month.payments)}</strong></div>
          <div><span>Metal given</span><strong>${grams(month.metalOut)}</strong></div>
          <div><span>Metal received</span><strong>${grams(month.metalIn)}</strong></div>
        </div>
        <ol class="passbook-list tight">${month.lines.slice(0, 8).map((line) => `
          <li class="cell clickable" data-edit="${esc(line.kind === 'settle' ? 'settle' : line.kind)}" data-id="${esc(line.id)}">
            <span class="cell-main"><strong>${esc(line.label)}</strong><small>${esc(line.name)}, ${fmtDate(line.date)}</small></span>
            <span class="cell-trail"><b>${line.kind === 'metal' ? grams(line.fig) : money(line.fig)}</b></span>
          </li>`).join('') || '<li class="empty-in">No entries this month</li>'}</ol>
      </aside>
    </div>
    <button class="fab" data-action="modal" data-modal="supplier" type="button" aria-label="Add supplier">+</button>`;
}

function supplierPassbook() {
  const detail = state.detail;
  if (!detail?.supplier) return '<div class="empty-khata">Supplier not found.</div>';
  const dir = moneyDirection(detail.payable);
  const lines = detail.passbook || [];
  return `
    <div class="desk-col fill">
    <header class="party-head">
      <button class="icon-btn back" data-view="parties" type="button" aria-label="Back">${ic('chevron')}</button>
      <div class="party-id">
        ${avatar(partyLabel(detail.supplier), 'lg')}
        <div>
          <h1 class="party-name">${esc(partyLabel(detail.supplier))}</h1>
          ${detail.supplier.phone ? `<p class="party-phone">${esc(detail.supplier.phone)}</p>` : ''}
        </div>
      </div>
      <div class="party-tools">
        <button class="btn-plain" data-action="print-party" type="button">${ic('print')}<span>Print</span></button>
        <button class="btn btn-primary party-share" data-action="share-party" type="button">${ic('share')}<span>Share PDF</span></button>
        <button class="btn-plain" data-edit="supplier" data-id="${esc(detail.supplier.id)}" type="button">Edit</button>
      </div>
    </header>
    <section class="balance-hero tight">
      <div class="bh ${dir.tone}"><span>${dir.label || 'Square'}</span><strong>${money(dir.amount)}</strong></div>
      <div class="bh"><span>Metal with supplier</span><div>${metalPills(detail.metalByPurity) || '<strong>—</strong>'}</div></div>
    </section>
    ${recordActions()}
    <button class="text-link" data-action="modal" data-modal="settle" type="button">Settle account</button>
    ${crmPanel('supplier', detail.supplier)}
    <section class="list-card blotter grow">
      <div class="list-head"><span>Running hisab</span></div>
      ${lines.length ? `<ol class="passbook-list">${lines.map((line) => `
        <li class="cell clickable" data-edit="${esc(line.kind === 'settle' ? 'settle' : line.kind)}" data-id="${esc(line.id)}">
          <time class="pass-date">${esc(fmtDate(line.date))}</time>
          <span class="cell-main">
            <strong>${esc(line.label)}</strong>
            <small>${line.detail ? `${esc(line.detail)}` : ''}${line.note ? `${line.detail ? ', ' : ''}${esc(line.note)}` : ''}</small>
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
  const custom = state.reportPreset === 'custom';
  const presets = [
    ['today', 'Today'],
    ['7d', '7d'],
    ['30d', '30d'],
    ['month', 'Month'],
    ['all', 'All'],
    ['custom', 'Custom']
  ];
  const activity = report.lines.length ? `<ol class="passbook-list">${report.lines.map((line) => `
          <li class="cell clickable" data-edit="${esc(line.kind === 'settle' ? 'settle' : line.kind)}" data-id="${esc(line.id)}">
            <span class="cell-main"><strong>${esc(line.label)}</strong><small>${esc(line.name)}, ${fmtDate(line.date)}</small></span>
            <span class="cell-trail"><b>${line.kind === 'metal' ? grams(line.fig) : money(line.fig)}</b></span>
          </li>`).join('')}</ol>` : '<div class="empty-in">No entries in this period</div>';
  const byParty = report.byParty.length ? `<div class="report-party-cards">${report.byParty.map((row) => `
          <button type="button" class="party-report-card" data-supplier="${esc(row.id)}">
            <strong class="party-name">${esc(row.name)}</strong>
            <div class="mini-stats">
              <div><span>Purchases</span><strong>${money(row.purchases)}</strong></div>
              <div><span>Payments</span><strong>${money(row.payments)}</strong></div>
              <div><span>Metal given</span><strong>${grams(row.metalOut)}</strong></div>
              <div><span>Metal received</span><strong>${grams(row.metalIn)}</strong></div>
            </div>
          </button>`).join('')}</div>
        <div class="data-table report-party-table">
          <div class="th"><span>Supplier</span><span>Purchases</span><span>Payments</span><span>Metal given</span><span>Metal received</span></div>
          ${report.byParty.map((row) => `<button type="button" class="tr" data-supplier="${esc(row.id)}">
            <span>${esc(row.name)}</span><span>${money(row.purchases)}</span><span>${money(row.payments)}</span><span>${grams(row.metalOut)}</span><span>${grams(row.metalIn)}</span>
          </button>`).join('')}
        </div>` : '<div class="empty-in">No supplier activity in this period</div>';
  return `
    <div class="report-page fill">
    <header class="print-head">
      <h2>${esc(state.shopName || 'Karigar')}: report</h2>
      <p>${range.from ? esc(fmtDate(range.from)) : 'From the start'} to ${range.to ? esc(fmtDate(range.to)) : 'today'}, printed ${esc(fmtDate(today()))}</p>
    </header>
    <div class="report-toolbar">
      <div class="chips report-presets">
        ${presets.map(([id, label]) => `<button type="button" class="chip ${state.reportPreset === id ? 'on' : ''}" data-action="preset" data-preset="${id}">${label}</button>`).join('')}
      </div>
      ${custom ? `<div class="range-fields">
        <label>From<input type="date" data-range="reportFrom" value="${esc(range.from)}"></label>
        <label>To<input type="date" data-range="reportTo" value="${esc(range.to)}"></label>
      </div>` : ''}
      <div class="report-tools">
        <button type="button" class="btn btn-soft" data-action="export-report">Export CSV</button>
        <button type="button" class="btn btn-primary" data-action="print-report">Print</button>
      </div>
    </div>
    <section class="metric-grid">
      <div class="metric"><span>Purchases</span><strong>${money(report.purchases)}</strong></div>
      <div class="metric"><span>Payments</span><strong>${money(report.payments)}</strong></div>
      <div class="metric"><span>Metal given</span><strong>${grams(report.metalOut)}</strong></div>
      <div class="metric"><span>Metal received</span><strong>${grams(report.metalIn)}</strong></div>
      <div class="metric"><span>Settled</span><strong>${money(report.settled)}</strong></div>
      <div class="metric"><span>Entries</span><strong>${report.count}</strong></div>
    </section>
    <div class="desk-split fill report-desk">
      <section class="list-card grow">
        <div class="list-head"><span>By supplier</span></div>
        ${byParty}
      </section>
      <section class="list-card grow report-activity">
        <div class="list-head"><span>Activity</span><span>${report.lines.length}</span></div>
        ${activity}
      </section>
    </div>
    ${customerSalesCard(range)}
    </div>`;
}

function helpView() {
  const item = (title, lead, body) => `<article class="help-item"><h2>${title}</h2><p class="help-lead">${lead}</p><p>${body}</p></article>`;
  return `<section class="help-page list-card grow">
    <div class="list-head"><span>How this works</span><button type="button" class="btn-plain" data-action="tour-start">Start tour</button></div>
    <div class="help-body">
      ${item('Today', 'Your day at a glance.', 'Live gold, silver and platinum rates, who to follow up with, birthdays and anniversaries in the next week, and the biggest amounts to get and to give.')}
      ${item('Live rates', 'International price, in rupees.', 'Rates come from the world market and are turned into rupees per gram for each purity. Indian board rates usually run a few percent higher, so add the difference on the Today page, or type your own board rate on the Metals page, which always wins. On a sale, the weight is priced at today’s rate and you can tap to use it.')}
      ${item('Hume dena and Hume lena', 'The same two words everywhere.', 'Hume dena means we have to give. Hume lena means we have to get. They mean the same on every supplier and every customer.')}
      ${item('Suppliers', 'Karigars and wholesalers. One card each.', 'Purchase is what you bought. Payment is what you paid. Metal given and Metal received move metal with no rupees. Settlement closes the account. Gold, silver and cash sit on the same card.')}
      ${item('Customers', 'People who buy from you. One card each.', 'Sale is what they bought. Return is what they gave back. Payment is money they paid you later. Pick the metal, the item (chain, ring, mangalsutra) and the weight. A sale or return can carry a photo.')}
      ${item('Contacts and follow-ups', 'Remember every person.', 'Each card has Call, WhatsApp and Email buttons, a follow-up date, notes of what was said, and for customers a birthday and anniversary. Remind about dues opens WhatsApp with the message ready to send. Nothing is sent until you press send.')}
      ${item('Photos', 'Take a photo of the item.', 'On a sale or return, tap Take photo or Choose photo. The picture is saved in your own Google Drive, in a Karigar photos folder. Tap the entry later to see it.')}
      ${item('Print and share', 'One supplier’s khata, not the whole shop.', 'Open a supplier. Print for paper or Save as PDF. Share PDF sends the same account on WhatsApp when your phone allows it.')}
      ${item('Metals and categories', 'Purities, item types and an optional board rate.', 'These appear on every purchase and sale. If you type a rate in rupees per gram it replaces the live rate for that metal.')}
      ${item('Refresh data', 'Reloads the Google Sheet.', 'You stay unlocked. The browser refresh button asks for the PIN again. Lock signs you out.')}
      ${item('Demo khata', 'Sheet screen only, not for live books.', 'Load demo writes sample suppliers, customers, sales and notes into the Google Sheet. Remove demo deletes only those.')}
    </div>
  </section>`;
}

function tourOverlay() {
  if (state.tourStep == null || state.tourStep < 0) return '';
  const step = TOUR[state.tourStep] || TOUR[0];
  const last = state.tourStep >= TOUR.length - 1;
  return `<div class="tour-backdrop">
    <section class="tour-card">
      <h2>${esc(step.title)}</h2>
      <p class="count">Tip ${state.tourStep + 1} of ${TOUR.length}</p>
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
    <div class="sheet-desk">
      <div class="sheet-main">
        <section class="list-card">
          <div class="list-head"><span>This shop</span></div>
          <button class="cell" data-view="masters" type="button">
            <span class="cell-main"><strong>Metals and categories</strong><small>Gold, silver, purity, chains, rings…</small></span>
            ${ic('chevron')}
          </button>
          <button class="cell" data-action="modal" data-modal="updateSheet" type="button">
            <span class="cell-main"><strong>Update my Google Sheet</strong><small>One-time, guided — needed for customers and photos</small></span>
            ${ic('chevron')}
          </button>
          <button class="cell" data-view="help" type="button">
            <span class="cell-main"><strong>How this works</strong><small>Short help for every screen</small></span>
            ${ic('chevron')}
          </button>
          <a class="cell" href="./about.html" target="_blank" rel="noopener">
            <span class="cell-main"><strong>About, privacy and support</strong><small>Disclaimer, where your data lives, and how to reach us</small></span>
            ${ic('chevron')}
          </a>
          <button class="cell" data-action="text-size" type="button">
            <span class="cell-main"><strong>${state.bigText ? 'Normal text size' : 'Bigger text'}</strong><small>Make everything easier to read</small></span>
          </button>
          <button class="cell danger" data-action="logout" type="button">
            <span class="cell-main"><strong>Lock</strong><small>PIN lock this device</small></span>
          </button>
        </section>
        <section class="list-card">
          <div class="list-head"><span>Google Sheet</span></div>
          <button class="cell" data-action="refresh" type="button">
            <span class="cell-main"><strong>Refresh data</strong>${savedLine() ? `<small>${esc(savedLine())}</small>` : '<small>Reload the Google Sheet. Header Refresh does the same.</small>'}</span>
            ${ic('chevron')}
          </button>
          ${safeSheetUrl(state.spreadsheetUrl) ? `<a class="cell" href="${esc(safeSheetUrl(state.spreadsheetUrl))}" target="_blank" rel="noopener">
            <span class="cell-main"><strong>Open in Google Sheets</strong><small>View the live workbook</small></span>
            ${ic('chevron')}
          </a>` : ''}
        </section>
      </div>
      <section class="list-card sheet-demo">
        <div class="list-head"><span>Demo only</span></div>
        <p class="sheet-warn">Writes into the Sheet, not the app. Do not use on live books.</p>
        <button class="cell" data-action="seed-demo" type="button">
          <span class="cell-main"><strong>Load demo khata</strong><small>Sample suppliers, customers and sales into this Google Sheet</small></span>
          ${ic('chevron')}
        </button>
        <button class="cell" data-action="strip-demo" type="button">
          <span class="cell-main"><strong>Remove demo khata</strong><small>Deletes only the demo suppliers, customers and their entries</small></span>
          ${ic('chevron')}
        </button>
      </section>
    </div>
  </section>`;
}

function viewContent() {
  if (state.view === 'supplier') return supplierPassbook();
  if (state.view === 'customer') return customerPassbook();
  if (state.view === 'customers') return customersHome();
  if (state.view === 'today') return todayView();
  if (state.view === 'report') return reportView();
  if (state.view === 'today') return reportView();
  if (state.view === 'masters') return mastersView();
  if (state.view === 'books') return booksView();
  if (state.view === 'help') return helpView();
  return partiesHome();
}

function render() {
  if (!state.unlocked) return landing();
  const on = (...views) => (views.includes(state.view) ? 'active' : '');
  const outdated = state.scriptOutdated
    ? `<div class="notice warn"><strong>One-time update needed for customers, notes and photos.</strong> Until then people and entries are not saved. <button type="button" class="btn btn-primary banner-btn" data-action="modal" data-modal="updateSheet">Show me how — step by step</button></div>`
    : '';
  // Only a change of page eases in; typing in a search box must not make the list flash.
  const enter = state.lastView !== state.view + ':' + (state.supplierId || state.customerId || '');
  state.lastView = state.view + ':' + (state.supplierId || state.customerId || '');
  root.innerHTML = `<div class="shop">
    <header class="appbar">
      <div class="brand"><span class="brand-mark">${ic('gem')}</span> <span>${esc(state.shopName || 'Karigar')}</span></div>
      <nav class="shop-nav" aria-label="Shop">
        <button class="nav-item nav-core ${on('today')}" data-view="today" type="button" ${on('today') ? 'aria-current="page"' : ''}>${ic('today')}<span>Today</span></button>
        <button class="nav-item nav-core ${on('customers', 'customer')}" data-view="customers" type="button" ${on('customers', 'customer') ? 'aria-current="page"' : ''}>${ic('customers')}<span>Customers</span></button>
        <button class="nav-item nav-core ${on('parties', 'supplier')}" data-view="parties" type="button" ${on('parties', 'supplier') ? 'aria-current="page"' : ''}>${ic('parties')}<span>Suppliers</span></button>
        <button class="nav-item nav-core ${on('report')}" data-view="report" type="button" ${on('report') ? 'aria-current="page"' : ''}>${ic('report')}<span>Report</span></button>
        <button class="nav-item ${on('masters')}" data-view="masters" type="button" ${on('masters') ? 'aria-current="page"' : ''}>${ic('masters')}<span>Metals</span></button>
        <button class="nav-item nav-core ${on('books')}" data-view="books" type="button" ${on('books') ? 'aria-current="page"' : ''}>${ic('sheet')}<span>Sheet</span></button>
        <button class="nav-item ${on('help')}" data-view="help" type="button" ${on('help') ? 'aria-current="page"' : ''}>${ic('help')}<span>How to</span></button>
      </nav>
      <div class="appbar-end">
        ${state.saving || state.syncing ? '<span class="sync-dot" role="status" aria-label="Saving"></span>' : ''}
        <button class="btn-refresh" data-action="refresh" type="button" ${state.syncing ? 'disabled' : ''} aria-label="Refresh data">
          ${ic('refresh')}<span>Refresh data</span>
        </button>
        <button class="icon-btn text-size" data-action="text-size" type="button" aria-label="${state.bigText ? 'Normal text size' : 'Bigger text'}"><span aria-hidden="true">A<sup>${state.bigText ? '−' : '+'}</sup></span></button>
        <button class="icon-btn mast-lock" data-action="logout" type="button" aria-label="Lock the app">${ic('lock')}<span class="lock-text">Lock</span></button>
      </div>
    </header>
    <div class="shop-body">
      ${rateBoard()}
      <main class="stage" ${enter ? 'data-enter' : ''}>
        ${outdated}
        ${state.error ? `<div class="notice">${esc(state.error)}</div>` : ''}
        ${viewContent()}
      </main>
    </div>
    ${state.modal ? modal() : ''}
    ${tourOverlay()}
  </div>`;
  bind();
}

function tagOptions(list, selected) {
  return `<option value="">None</option>${list.map((t) => `<option value="${esc(t)}" ${t === selected ? 'selected' : ''}>${esc(t)}</option>`).join('')}`;
}

function moreDetails(kind, e) {
  const filled = ['email', 'address', 'gstin', 'birthday', 'anniversary', 'tag', 'followUpDate', 'followUpNote'].some((k) => e[k]);
  return `<details class="more" ${filled ? 'open' : ''}>
    <summary>More details (optional)</summary>
    <label>${kind === 'customer' ? 'Customer type' : 'Supplier type'}<select name="tag">${tagOptions(kind === 'customer' ? CUSTOMER_TAGS : SUPPLIER_TAGS, e.tag || '')}</select></label>
    <label>Email<input name="email" type="email" inputmode="email" autocomplete="off" value="${esc(e.email || '')}"></label>
    <label>Address<input name="address" autocomplete="off" value="${esc(e.address || '')}"></label>
    ${kind === 'supplier' ? `<label>GSTIN<input name="gstin" autocomplete="off" value="${esc(e.gstin || '')}"></label>` : `
    <div class="field-row">
      <label>Birthday<input name="birthday" type="date" value="${esc(String(e.birthday || '').slice(0, 10))}"></label>
      <label>Anniversary<input name="anniversary" type="date" value="${esc(String(e.anniversary || '').slice(0, 10))}"></label>
    </div>`}
    <div class="field-row">
      <label>Follow up on<input name="followUpDate" type="date" value="${esc(String(e.followUpDate || '').slice(0, 10))}"></label>
      <label>Follow-up note<input name="followUpNote" autocomplete="off" value="${esc(e.followUpNote || '')}" placeholder="Why call?"></label>
    </div>
  </details>`;
}

function supplierModal() {
  const e = state.editing || {};
  return `<div class="modal-backdrop"><section class="modal">
    <div class="section-head"><h2>${e.id ? 'Edit supplier' : 'Add supplier'}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <form id="data-form" data-kind="supplier">
      <label>Supplier name<input name="name" required value="${esc(e.name || '')}" placeholder="Karigar or supplier"></label>
      <label>Phone (optional)<input name="phone" value="${esc(e.phone || '')}"></label>
      <label>Notes (optional)<input name="notes" value="${esc(e.notes || '')}"></label>
      ${moreDetails('supplier', e)}
      ${e.id ? '' : `
        <label>Opening balance, ${LABEL.weGive} (₹)<input name="openingMoney" type="number" min="0" step="0.01" value="0"></label>
        <label>Opening metal<select name="metalType"><option value="">None</option>${metalTypeOptions('')}</select></label>
        <label>Purity<select name="purity">${purityOptions('GOLD', '22K')}</select></label>
        <label>Opening metal (grams)<input name="weightGrams" type="number" min="0" step="0.001" value="0"></label>
      `}
      <div class="form-actions">
        ${e.id ? '<button type="button" class="btn btn-soft" data-delete="supplier">Delete supplier</button>' : ''}
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
          <option value="ISSUE" ${dir === 'ISSUE' ? 'selected' : ''}>Metal given</option>
          <option value="RECEIPT" ${dir === 'RECEIPT' ? 'selected' : ''}>Metal received</option>
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
    <p class="lede">${isPay ? 'Payment to the supplier. Rupees, metal, or both.' : 'Bill from the supplier. Rupees, metal, or both.'}</p>
    <form id="data-form" data-kind="deal">
      ${locked ? `<input type="hidden" name="supplierId" value="${esc(state.supplierId)}">` : `<label>Supplier<select name="supplierId" required>${state.suppliers.map((s) => `<option value="${esc(s.id)}" ${(draft.supplierId || state.supplierId) === s.id ? 'selected' : ''}>${esc(partyLabel(s))}</option>`).join('')}</select></label>`}
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
      ${locked ? `<input type="hidden" name="supplierId" value="${esc(state.supplierId)}">` : `<label>Supplier<select name="supplierId" required>${state.suppliers.map((s) => `<option value="${esc(s.id)}" ${s.id === (e.supplierId || state.supplierId) ? 'selected' : ''}>${esc(partyLabel(s))}</option>`).join('')}</select></label>`}
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
    <div class="section-head"><h2>${isEdit ? 'Edit metal entry' : (current === 'RECEIPT' ? LABEL.supplier.metalReceived : LABEL.supplier.metalGiven)}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <form id="data-form" data-kind="metal">
      ${locked ? `<input type="hidden" name="supplierId" value="${esc(state.supplierId)}">` : `<label>Supplier<select name="supplierId" required>${state.suppliers.map((s) => `<option value="${esc(s.id)}" ${s.id === (e.supplierId || state.supplierId) ? 'selected' : ''}>${esc(partyLabel(s))}</option>`).join('')}</select></label>`}
      ${isEdit ? `<label>Direction<select name="direction">
        <option value="OPENING" ${e.direction === 'OPENING' ? 'selected' : ''}>Opening</option>
        <option value="ISSUE" ${current === 'ISSUE' ? 'selected' : ''}>Metal given</option>
        <option value="RECEIPT" ${current === 'RECEIPT' ? 'selected' : ''}>Metal received</option>
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
      ${locked ? `<input type="hidden" name="supplierId" value="${esc(state.supplierId)}">` : `<label>Supplier<select name="supplierId" required>${state.suppliers.map((s) => `<option value="${esc(s.id)}" ${s.id === (e.supplierId || state.supplierId) ? 'selected' : ''}>${esc(partyLabel(s))}</option>`).join('')}</select></label>`}
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

function customerModal() {
  const e = state.editing || {};
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${e.id ? 'Edit customer' : 'Add customer'}">
    <div class="section-head"><h2>${e.id ? 'Edit customer' : 'Add customer'}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <form id="data-form" data-kind="customer">
      <label>Customer name<input name="name" required autocomplete="off" value="${esc(e.name || '')}" placeholder="Name of the customer"></label>
      <label>Phone (optional)<input name="phone" type="tel" inputmode="tel" autocomplete="off" value="${esc(e.phone || '')}"></label>
      <label>City / area (optional)<input name="city" autocomplete="off" value="${esc(e.city || '')}"></label>
      <label>Notes (optional)<input name="notes" autocomplete="off" value="${esc(e.notes || '')}"></label>
      ${moreDetails('customer', e)}
      <div class="form-actions">
        ${e.id ? '<button type="button" class="btn btn-soft" data-delete="customer">Delete customer</button>' : ''}
        <button type="button" class="btn btn-soft" data-action="close">Cancel</button>
        <button class="btn btn-primary">Save</button>
      </div>
    </form>
  </section></div>`;
}

function photoPreviewHtml() {
  const e = state.editing || {};
  if (state.pendingPhoto) return `<img src="${esc(state.pendingPhoto.dataUrl)}" alt="Photo of the item">`;
  if (e.photoId && !state.photoRemoved) {
    const cached = state.photoCache[e.photoId];
    if (cached) return `<img src="${esc(cached)}" alt="Photo of the item">`;
    return '<span class="muted">Loading photo…</span>';
  }
  return '<span class="muted">No photo yet</span>';
}

function hasPhotoNow() {
  const e = state.editing || {};
  return Boolean(state.pendingPhoto || (e.photoId && !state.photoRemoved));
}

function updatePhotoPreview() {
  const box = root.querySelector('#photo-preview');
  if (box) box.innerHTML = photoPreviewHtml();
  const clear = root.querySelector('[data-action="photo-clear"]');
  if (clear) clear.hidden = !hasPhotoNow();
}

async function loadSavedPhoto() {
  const id = state.editing?.photoId;
  if (!id || state.photoCache[id]) return;
  try {
    const res = await sheetsRequest({ action: 'getPhoto', fileId: id });
    if (res.dataUrl) state.photoCache[id] = res.dataUrl;
  } catch (error) {
    state.photoCache[id] = '';
    const box = root.querySelector('#photo-preview');
    if (box && state.editing?.photoId === id) box.innerHTML = `<span class="muted">Could not load the photo (${esc(explainLedgerError(error))})</span>`;
    return;
  }
  if (state.editing?.photoId === id) updatePhotoPreview();
}

function resetPhotoState() {
  state.pendingPhoto = null;
  state.photoRemoved = false;
}

function saleModal(modalKind) {
  const e = state.editing || {};
  const isEdit = Boolean(e.id);
  const kind = e.kind || (modalKind === 'return' ? RETURN : SALE);
  const isReturn = kind === RETURN;
  const locked = Boolean(state.customerId) && !isEdit;
  const metalType = e.metalType || 'GOLD';
  const amountDefault = e.amountInr ?? '';
  const paidDefault = isEdit ? (e.paidInr ?? '') : '';
  const customerId = e.customerId || state.customerId || '';
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${isReturn ? 'Customer return' : 'Customer sale'}">
    <div class="section-head"><h2>${isEdit ? 'Edit entry' : (isReturn ? 'Return from customer' : 'Sale to customer')}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <form id="data-form" data-kind="sale">
      ${locked ? `<input type="hidden" name="customerId" value="${esc(state.customerId)}">` : `<label>Customer<select name="customerId" required><option value="">Choose customer…</option>${state.customers.map((c) => `<option value="${esc(c.id)}" ${c.id === customerId ? 'selected' : ''}>${esc(customerLabel(c))}</option>`).join('')}</select></label>`}
      ${isEdit ? `<label>Type<select name="kind">
        <option value="SALE" ${!isReturn ? 'selected' : ''}>Sale</option>
        <option value="RETURN" ${isReturn ? 'selected' : ''}>Return</option>
      </select></label>` : `<input type="hidden" name="kind" value="${kind}">`}
      <div class="field-row">
        <label>Metal<select name="metalType">${metalTypeOptions(metalType)}</select></label>
        <label>Purity<select name="purity">${purityOptions(metalType, e.purity || (metalType === 'SILVER' ? '925' : metalType === 'PLATINUM' ? '950' : '22K'))}</select></label>
      </div>
      <label>Item<select name="category" required>${categoryOptions(metalType, e.category || '')}</select></label>
      <label>Weight (grams)<input name="weightGrams" type="number" min="0.001" step="0.001" required inputmode="decimal" placeholder="e.g. 12.5" value="${esc(e.weightGrams || '')}"></label>
      <p class="rate-suggest" id="rate-suggest" hidden></p>
      <label>${isReturn ? 'Value of returned item (₹)' : 'Bill amount (₹)'}<input name="amountInr" type="number" min="0" step="0.01" required inputmode="decimal" placeholder="e.g. 85000" value="${esc(amountDefault)}"></label>
      <label>${isReturn ? 'Refunded to customer (₹)' : 'Received from customer (₹)'}<input name="paidInr" type="number" min="0" step="0.01" inputmode="decimal" data-touched="${isEdit ? '1' : ''}" placeholder="Same as bill if paid in full" value="${esc(paidDefault)}"></label>
      <div class="photo-box">
        <div class="photo-title">Photo of the item</div>
        <div id="photo-preview" class="photo-preview">${photoPreviewHtml()}</div>
        <div class="photo-actions">
          <label class="btn btn-soft file-btn">${ic('camera')}<span>Take photo</span><input type="file" id="photo-camera" class="sr-only" accept="image/*" capture="environment"></label>
          <label class="btn btn-soft file-btn"><span>Choose photo</span><input type="file" id="photo-gallery" class="sr-only" accept="image/*"></label>
          <button type="button" class="btn-plain" data-action="photo-clear" ${hasPhotoNow() ? '' : 'hidden'}>Remove photo</button>
        </div>
      </div>
      <label>Date<input name="date" type="date" value="${esc((e.date || today()).slice(0, 10))}" required></label>
      <label>Note (optional)<input name="note" autocomplete="off" value="${esc(e.note || '')}" placeholder="Bill no. / remark"></label>
      <div class="form-actions">
        ${e.id ? '<button type="button" class="btn btn-soft" data-delete="sale">Delete</button>' : ''}
        <button type="button" class="btn btn-soft" data-action="close">Cancel</button>
        <button class="btn btn-primary">Save</button>
      </div>
    </form>
  </section></div>`;
}

function categoryModal() {
  const e = state.editing || {};
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${e.id ? 'Edit item type' : 'Add item type'}">
    <div class="section-head"><h2>${e.id ? 'Edit item type' : 'Add item type'}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <form id="data-form" data-kind="category">
      <label>Metal<select name="metalType">${metalTypeOptions(e.metalType || 'GOLD')}</select></label>
      <label>Item name<input name="category" required autocomplete="off" value="${esc(e.category || '')}" placeholder="Chain, Ring, Mangalsutra…"></label>
      <label>Status<select name="status">
        <option value="ACTIVE" ${e.status !== 'INACTIVE' ? 'selected' : ''}>Active</option>
        <option value="INACTIVE" ${e.status === 'INACTIVE' ? 'selected' : ''}>Hidden</option>
      </select></label>
      <div class="form-actions">
        ${e.id ? '<button type="button" class="btn btn-soft" data-delete="category">Delete</button>' : ''}
        <button type="button" class="btn btn-soft" data-action="close">Cancel</button>
        <button class="btn btn-primary">Save</button>
      </div>
    </form>
  </section></div>`;
}

function updateSheetModal() {
  let saved = '';
  try { saved = localStorage.getItem(LICENSE_KEY_STORE) || ''; } catch { /* ignore */ }
  const sheetLink = safeSheetUrl(state.spreadsheetUrl)
    ? `<a class="btn btn-soft btn-block" href="${esc(safeSheetUrl(state.spreadsheetUrl))}" target="_blank" rel="noopener">Open my Google Sheet</a>`
    : '';
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="Update my Google Sheet">
    <div class="section-head"><h2>Update my Google Sheet</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <p class="lede">Do this once. Your old entries stay safe. Your PIN is filled in for you.</p>
    ${state.error ? `<div class="notice">${esc(state.error)}</div>` : ''}
    <ol class="steps-big">
      <li><strong>Your license key</strong><span>The key your Karigar provider sent you.</span>
        <input id="upd-license" autocomplete="off" placeholder="License key" value="${esc(saved)}"></li>
      <li><strong>Copy the new script</strong>
        <button type="button" class="btn btn-primary btn-block" data-action="copy-update-script">${ic('update')}<span>Copy new script</span></button></li>
      <li><strong>Open your Sheet</strong><span>Extensions → Apps Script. Select everything, paste, press Save.</span>${sheetLink}</li>
      <li><strong>Allow photos</strong><span>Project Settings (gear) → tick “Show appsscript.json”. Open that file, select all, then paste the permissions file:</span>
        <button type="button" class="btn btn-soft btn-block" data-action="copy-update-manifest">Copy permissions file</button></li>
      <li><strong>Run two things</strong><span>Pick <em>authorizeKarigar</em> → Run → Allow. Then pick <em>initLedger</em> → Run.</span></li>
      <li><strong>Publish</strong><span>Deploy → Manage deployments → pencil → Version: New version → Deploy.</span></li>
      <li><strong>Come back here</strong><span>Tap Refresh data. The yellow note disappears.</span></li>
    </ol>
    <div class="form-actions"><button type="button" class="btn btn-soft" data-action="close">Close</button></div>
  </section></div>`;
}

function interactionModal() {
  const e = state.editing || {};
  const party = contactParty(e.partyType === 'SUPPLIER' ? 'supplier' : 'customer', e.partyId) || {};
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${e.id ? 'Edit note' : 'Add note'}">
    <div class="section-head"><h2>${e.id ? 'Edit note' : 'Add note'}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <p class="lede">${esc(party.name || '')}</p>
    <form id="data-form" data-kind="interaction">
      <input type="hidden" name="partyId" value="${esc(e.partyId || '')}">
      <input type="hidden" name="partyType" value="${esc(e.partyType || '')}">
      <label>What happened<select name="kind">${NOTE_KINDS.map((k) => `<option value="${k}" ${k === (e.kind || 'Note') ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label>Note<textarea name="text" rows="4" required placeholder="What was said or agreed">${esc(e.text || '')}</textarea></label>
      <label>Date<input name="date" type="date" value="${esc((e.date || today()).slice(0, 10))}" required></label>
      <div class="form-actions">
        ${e.id ? '<button type="button" class="btn btn-soft" data-delete="interaction">Delete</button>' : ''}
        <button type="button" class="btn btn-soft" data-action="close">Cancel</button>
        <button class="btn btn-primary">Save</button>
      </div>
    </form>
  </section></div>`;
}

function custPayModal() {
  const e = state.editing || {};
  const isEdit = Boolean(e.id);
  const locked = Boolean(state.customerId) && !isEdit;
  const customerId = e.customerId || state.customerId || '';
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="Payment from customer">
    <div class="section-head"><h2>${isEdit ? 'Edit payment' : 'Payment from customer'}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <p class="lede">Money the customer paid you. It lowers what they owe.</p>
    <form id="data-form" data-kind="sale">
      <input type="hidden" name="kind" value="PAYMENT">
      ${locked ? `<input type="hidden" name="customerId" value="${esc(state.customerId)}">` : `<label>Customer<select name="customerId" required><option value="">Choose customer…</option>${state.customers.map((c) => `<option value="${esc(c.id)}" ${c.id === customerId ? 'selected' : ''}>${esc(customerLabel(c))}</option>`).join('')}</select></label>`}
      <label>Amount received (₹)<input name="amountInr" type="number" min="0.01" step="0.01" required inputmode="decimal" value="${esc(e.amountInr || '')}"></label>
      <label>Date<input name="date" type="date" value="${esc((e.date || today()).slice(0, 10))}" required></label>
      <label>Note (optional)<input name="note" autocomplete="off" value="${esc(e.note || '')}" placeholder="Cash, UPI, cheque no."></label>
      <div class="form-actions">
        ${isEdit ? '<button type="button" class="btn btn-soft" data-delete="sale">Delete</button>' : ''}
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
  if (kind === 'updateSheet') return updateSheetModal();
  if (kind === 'customer') return customerModal();
  if (kind === 'sale' || kind === 'return') return state.editing?.kind === PAYMENT ? custPayModal() : saleModal(kind);
  if (kind === 'custpay') return custPayModal();
  if (kind === 'interaction') return interactionModal();
  if (kind === 'category') return categoryModal();
  return '';
}

function metalMasterModal() {
  const e = state.editing || {};
  return `<div class="modal-backdrop"><section class="modal">
    <div class="section-head"><h2>${e.id ? 'Edit metal' : 'Add metal'}</h2><button class="btn-plain" data-action="close" type="button">Close</button></div>
    <form id="data-form" data-kind="metalMaster">
      <label>Metal type<input name="metalType" required value="${esc(e.metalType || 'GOLD')}" placeholder="GOLD / SILVER"></label>
      <label>Purity<input name="purity" required value="${esc(e.purity || '')}" placeholder="22K / 999"></label>
      <label>Board rate ₹ / gram (optional)<input name="rateInrPerGram" type="number" min="0" step="0.01" value="${esc(e.rateInrPerGram || '')}" placeholder="Blank = not on the header board"></label>
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
  const groups = metalMasterGroups(rows);
  const catGroups = metalMasterGroups((state.categories || []).map((row) => ({ ...row })));
  return `
    <div class="desk-col fill masters-page">
    <div class="page-head">
      <p class="lede">Metals and purities you trade in. Board rate is optional — when you enter ₹/g it shows under the header.</p>
      <button class="btn btn-primary" data-action="modal" data-modal="metalMaster" type="button">+ Metal</button>
    </div>
    ${groups.length ? groups.map(([type, items]) => `
      <section class="list-card master-group">
        <div class="list-head"><span>${esc(titleCase(type))}</span><span>${items.length}</span></div>
        <div class="master-list">${items.map((row) => {
    const n = Number(row.rateInrPerGram || 0);
    const off = String(row.status || 'ACTIVE') === 'INACTIVE';
    return `<button type="button" class="master-row ${off ? 'dim' : ''}" data-metal="${esc(row.metalType)}" data-edit="metalMaster" data-id="${esc(row.id)}">
            <span class="master-id">
              <em class="master-kicker">${esc(titleCase(row.metalType))}</em>
              <strong class="master-purity">${esc(row.purity)}</strong>
            </span>
            <span class="master-rate ${n > 0 ? '' : 'none'}">${n > 0 ? `${money(n)}/g` : 'No board rate'}</span>
            ${off ? '<span class="master-off">Off</span>' : ''}
          </button>`;
  }).join('')}</div>
      </section>`).join('') : `<div class="empty-khata">
      <p class="empty-title">No metals</p>
      <p class="lede">Add gold, silver, platinum, or a purity you use.</p>
    </div>`}
    <div class="page-head">
      <p class="lede">Item types shown when you record a sale or return — chain, ring, mangalsutra and so on, for each metal.</p>
      <button class="btn btn-primary" data-action="modal" data-modal="category" type="button">+ Item type</button>
    </div>
    ${catGroups.map(([type, items]) => `
      <section class="list-card master-group">
        <div class="list-head"><span>${esc(titleCase(type))} items</span><span>${items.length}</span></div>
        <div class="chip-cloud">${items.map((row) => `<button type="button" class="chip ${String(row.status || 'ACTIVE') === 'INACTIVE' ? 'dim' : ''}" data-edit="category" data-id="${esc(row.id)}">${esc(row.category)}</button>`).join('')}</div>
      </section>`).join('')}
    </div>`;
}

function stamp(row, isNew) {
  const now = new Date().toISOString();
  return { ...row, createdAt: isNew ? now : (row.createdAt || now), updatedAt: now };
}

function logout() {
  state.unlocked = false;
  state.pin = '';
  forgetLocalPin();
  forgetSessionUnlock();
  state.view = 'today';
  state.error = null;
  landing();
}

let toastTimer = null;
function toast(text) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !state.modal) return;
  state.modal = null;
  state.editing = null;
  state.error = null;
  resetPhotoState();
  render();
});

async function finishFollowUp(kind, id) {
  const key = kind === 'customer' ? 'customers' : 'suppliers';
  const list = state[key];
  const row = list.find((r) => r.id === id);
  if (!row) return;
  requireNewScript(kind);
  state[key] = upsertById(list, stamp({ ...row, followUpDate: '', followUpNote: '' }, false));
  markDirty(key, id);
  await persist();
  render();
}

function applyTextSize() {
  document.documentElement.classList.toggle('big-text', Boolean(state.bigText));
}

async function trashPhotos(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  await Promise.allSettled(list.map((fileId) => sheetsRequest({ action: 'deletePhoto', fileId })));
}

function requireNewScript(kind) {
  if (state.scriptOutdated && ['customer', 'supplier', 'sale', 'category', 'interaction'].includes(kind)) {
    throw new Error('Customers, notes and photos need the newest Karigar script. Update the Apps Script (see the note at the top), then tap Refresh data.');
  }
}

function bind() {
  root.onclick = async (event) => {
    const target = event.target.closest('[data-view],[data-action],[data-supplier],[data-customer],[data-edit],[data-delete]');
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
      if (target.dataset.customer) {
        state.view = 'customer';
        state.customerId = target.dataset.customer;
        state.modal = null;
        state.editing = null;
        refreshSummary();
        render();
        return;
      }
      if (target.dataset.view) {
        state.view = target.dataset.view;
        if (target.dataset.view !== 'supplier') state.supplierId = null;
        if (target.dataset.view !== 'customer') state.customerId = null;
        resetPhotoState();
        state.modal = null;
        state.editing = null;
        refreshSummary();
        render();
        return;
      }
      if (target.dataset.edit) {
        const kind = target.dataset.edit;
        const id = target.dataset.id;
        const lists = { supplier: state.suppliers, money: state.money, metal: state.metal, metalMaster: state.metalMaster, customer: state.customers, sale: state.sales, category: state.categories, interaction: state.interactions };
        const list = lists[kind] || state.settlements;
        state.editing = list.find((r) => r.id === id) || null;
        state.modal = kind === 'settle' ? 'settle' : kind;
        resetPhotoState();
        render();
        if (kind === 'sale') loadSavedPhoto();
        return;
      }
      if (target.dataset.delete) {
        await onDelete(target.dataset.delete);
        return;
      }
      const action = target.dataset.action;
      if (action === 'close') { state.modal = null; state.editing = null; state.error = null; resetPhotoState(); render(); }
      else if (action === 'text-size') {
        state.bigText = !state.bigText;
        try { localStorage.setItem(TEXT_KEY, state.bigText ? '1' : '0'); } catch { /* ignore */ }
        applyTextSize();
        render();
      } else if (action === 'photo-clear') {
        state.pendingPhoto = null;
        state.photoRemoved = true;
        updatePhotoPreview();
        return;
      } else if (action === 'modal') {
        state.editing = null;
        resetPhotoState();
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
      } else if (action === 'add-note') {
        const isCustomer = target.dataset.kind === 'customer';
        state.editing = { partyId: target.dataset.id, partyType: isCustomer ? 'CUSTOMER' : 'SUPPLIER' };
        state.modal = 'interaction';
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
      else if (action === 'copy-update-script') await copyUpdatedScript();
      else if (action === 'copy-update-manifest') await copyManifest();
      else if (action === 'preset') {
        state.reportPreset = target.dataset.preset;
        if (state.reportPreset !== 'custom') {
          const next = rangeForPreset(state.reportPreset);
          state.reportFrom = next.from;
          state.reportTo = next.to;
        }
        render();
      } else if (action === 'customer-filter') {
        state.customerFilter = target.dataset.filter || 'all';
        render();
      } else if (action === 'refresh-rates') {
        await loadRates(true);
      } else if (action === 'use-suggest') {
        const form = root.querySelector('form[data-kind="sale"]');
        if (form) { form.elements.amountInr.value = target.dataset.amount; form.elements.amountInr.dispatchEvent(new Event('input', { bubbles: true })); }
      } else if (action === 'followup-done') {
        await finishFollowUp(target.dataset.kind, target.dataset.id);
      } else if (action === 'party-filter') {
        state.partyFilter = target.dataset.filter || 'all';
        render();
      } else if (action === 'export-report') downloadReport();
      else if (action === 'print-report') window.print();
      else if (action === 'print-party') printOpenPartyKhata();
      else if (action === 'share-party') await shareOpenPartyKhata();
    } catch (error) {
      state.error = error.message;
      render();
    }
  };
  window.onkeydown = null;
  const pinEntry = root.querySelector('input.pin-entry');
  const showPin = root.querySelector('#show-pin');
  if (pinEntry && showPin) showPin.onchange = () => { pinEntry.type = showPin.checked ? 'text' : 'password'; pinEntry.focus(); };
  if (pinEntry && !state.unlocked && !root.querySelector('input[name="sheetsUrl"]') && document.activeElement !== pinEntry) {
    pinEntry.focus({ preventScroll: true });
  }
  const dialog = root.querySelector('.modal');
  if (dialog && !dialog.contains(document.activeElement)) { dialog.setAttribute('tabindex', '-1'); dialog.focus({ preventScroll: true }); }
  for (const input of root.querySelectorAll('#photo-camera, #photo-gallery')) {
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      const box = root.querySelector('#photo-preview');
      if (box) box.innerHTML = '<span class="muted">Preparing photo…</span>';
      try {
        state.pendingPhoto = await compressImage(file);
        state.photoRemoved = false;
      } catch (error) {
        state.error = error.message;
        render();
        return;
      }
      updatePhotoPreview();
    };
  }
  for (const name of ['metalType', 'purity', 'weightGrams']) {
    const el = root.querySelector(`form[data-kind="sale"] [name="${name}"]`);
    if (el) { el.addEventListener('input', updateRateSuggest); el.addEventListener('change', updateRateSuggest); }
  }
  updateRateSuggest();
  const premium = root.querySelector('#premium-form');
  if (premium) {
    premium.onsubmit = (event) => event.preventDefault();
    premium.elements.premium.onchange = () => {
      state.premiumPct = Math.max(-20, Math.min(50, Number(premium.elements.premium.value) || 0));
      try { localStorage.setItem(PREMIUM_KEY, String(state.premiumPct)); } catch { /* ignore */ }
      refreshRateDom();
    };
  }
  if (state.view === 'today' && state.unlocked && !state.ratesLoading && (!state.rates || ratesAreStale(state.rates.fetchedAt))) loadRates();
  const amountInput = root.querySelector('form[data-kind="sale"] input[name="amountInr"]');
  const paidInput = root.querySelector('form[data-kind="sale"] input[name="paidInr"]');
  if (amountInput && paidInput) {
    paidInput.addEventListener('input', () => { paidInput.dataset.touched = '1'; });
    amountInput.addEventListener('input', () => { if (!paidInput.dataset.touched) paidInput.value = amountInput.value; });
  }
  for (const input of root.querySelectorAll('input[data-range]')) {
    input.onchange = () => {
      state.reportPreset = 'custom';
      state[input.dataset.range] = input.value;
      render();
    };
  }
  for (const search of root.querySelectorAll('input.search')) {
    search.oninput = () => {
      const key = search.dataset.scope === 'customer' ? 'customerSearch' : 'search';
      state[key] = search.value;
      const pos = search.selectionStart;
      render();
      const next = root.querySelector(`input.search[data-scope="${search.dataset.scope || ''}"]`) || root.querySelector('input.search');
      if (next) {
        next.focus();
        try { next.setSelectionRange(pos, pos); } catch { /* ignore */ }
      }
    };
  }
  const metalType = root.querySelector('select[name="metalType"]');
  const purity = root.querySelector('select[name="purity"]');
  const category = root.querySelector('select[name="category"]');
  if (metalType && purity) {
    metalType.onchange = () => {
      purity.innerHTML = purityOptions(metalType.value || 'GOLD', '');
      if (category) category.innerHTML = categoryOptions(metalType.value || 'GOLD', '');
    };
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
  const photoIds = [];
  if (kind === 'supplier') {
    if (!confirm(`Delete ${partyLabel(row)} and all of their khata? This cannot be undone.`)) return;
    markDeleted('suppliers', row.id);
    for (const item of state.money.filter((x) => x.supplierId === row.id)) markDeleted('money', item.id);
    for (const item of state.metal.filter((x) => x.supplierId === row.id)) markDeleted('metal', item.id);
    for (const item of state.settlements.filter((x) => x.supplierId === row.id)) markDeleted('settlements', item.id);
    for (const item of state.interactions.filter((x) => x.partyId === row.id)) markDeleted('interactions', item.id);
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
  } else if (kind === 'customer') {
    if (!confirm(`Delete ${customerLabel(row)} and all of their sales and returns?`)) return;
    requireNewScript('customer');
    photoIds.push(...state.sales.filter((x) => x.customerId === row.id).map((x) => x.photoId));
    markDeleted('customers', row.id);
    for (const item of state.sales.filter((x) => x.customerId === row.id)) markDeleted('sales', item.id);
    for (const item of state.interactions.filter((x) => x.partyId === row.id)) markDeleted('interactions', item.id);
    Object.assign(state, removeCustomerData(state, row.id));
    state.view = 'customers';
    state.customerId = null;
  } else if (kind === 'sale') {
    if (!confirm('Delete this entry? Its photo, if any, is removed too.')) return;
    requireNewScript('sale');
    photoIds.push(row.photoId);
    markDeleted('sales', row.id);
    state.sales = removeById(state.sales, row.id);
  } else if (kind === 'interaction') {
    if (!confirm('Delete this note?')) return;
    requireNewScript('interaction');
    markDeleted('interactions', row.id);
    state.interactions = removeById(state.interactions, row.id);
  } else if (kind === 'category') {
    if (!confirm(`Remove ${row.category} from the ${row.metalType} item list? Old sales keep their item name.`)) return;
    markDeleted('categories', row.id);
    state.categories = removeById(state.categories, row.id);
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
  resetPhotoState();
  await persist();
  if (photoIds.length) trashPhotos(photoIds);
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
      const typed = String(data.shopLock || data.pin || '').trim();
      state.pin = typed;
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
    requireNewScript(kind);
    const saveBtn = form.querySelector('.form-actions .btn-primary');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    let staleSalePhoto = '';
    if (kind === 'supplier') {
      const row = stamp({ ...(state.editing || {}), id, name: assertPartyName(data.name), phone: data.phone || '', notes: data.notes || '', status: 'ACTIVE', email: String(data.email || '').trim(), address: String(data.address || '').trim(), tag: data.tag || '', followUpDate: data.followUpDate || '', followUpNote: String(data.followUpNote || '').trim(), gstin: String(data.gstin || '').trim() }, isNew);
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
    } else if (kind === 'customer') {
      const row = stamp({ ...(state.editing || {}), id, name: assertPartyName(data.name), phone: data.phone || '', city: data.city || '', notes: data.notes || '', status: 'ACTIVE', email: String(data.email || '').trim(), address: String(data.address || '').trim(), tag: data.tag || '', followUpDate: data.followUpDate || '', followUpNote: String(data.followUpNote || '').trim(), birthday: data.birthday || '', anniversary: data.anniversary || '' }, isNew);
      state.customers = upsertById(state.customers, row);
      markDirty('customers', id);
      if (isNew) {
        state.view = 'customer';
        state.customerId = row.id;
      }
    } else if (kind === 'sale' && data.kind === PAYMENT) {
      const v = validatePayment(data);
      state.sales = upsertById(state.sales, stamp({
        ...(state.editing || {}), id, customerId: data.customerId, kind: PAYMENT, category: '', metalType: '', purity: '',
        weightGrams: 0, amountInr: v.amount, paidInr: v.amount, date: data.date, note: data.note || '', photoId: '', photoUrl: ''
      }, isNew));
      markDirty('sales', id);
    } else if (kind === 'interaction') {
      const text = String(data.text || '').trim();
      if (!text) throw new Error('Write a short note');
      const partyType = data.partyType || (state.editing?.partyType || '');
      state.interactions = upsertById(state.interactions, stamp({
        ...(state.editing || {}), id, partyId: data.partyId, partyType, kind: data.kind || 'Note', text, date: data.date
      }, isNew));
      markDirty('interactions', id);
    } else if (kind === 'sale') {
      const v = validateSale(data);
      const old = state.editing || {};
      let photoId = old.photoId || '';
      let photoUrl = old.photoUrl || '';
      if (state.pendingPhoto) {
        if (saveBtn) saveBtn.textContent = 'Saving photo…';
        const customer = state.customers.find((c) => c.id === data.customerId);
        const res = await sheetsRequest({
          action: 'uploadPhoto',
          name: photoFileName({ customerName: customer?.name, kind: data.kind, date: data.date }),
          mime: state.pendingPhoto.mime,
          data: state.pendingPhoto.base64
        });
        if (!res.fileId) throw new Error('Photo was not saved. The Karigar script in your Sheet is out of date — update it and try again.');
        state.photoCache[res.fileId] = state.pendingPhoto.dataUrl;
        staleSalePhoto = photoId;
        photoId = res.fileId;
        photoUrl = res.url || '';
      } else if (state.photoRemoved && photoId) {
        staleSalePhoto = photoId;
        photoId = '';
        photoUrl = '';
      }
      state.sales = upsertById(state.sales, stamp({
        ...old, id, customerId: data.customerId, kind: data.kind === RETURN ? RETURN : SALE,
        category: String(data.category).trim(), metalType: String(data.metalType).toUpperCase(), purity: data.purity,
        weightGrams: v.grams, amountInr: v.amount, paidInr: v.paid, date: data.date, note: data.note || '',
        photoId, photoUrl
      }, isNew));
      markDirty('sales', id);
    } else if (kind === 'category') {
      const metalType = String(data.metalType || '').trim().toUpperCase();
      const name = String(data.category || '').trim();
      if (!name) throw new Error('Enter the item name');
      const dup = state.categories.find((c) => c.id !== id && String(c.metalType).toUpperCase() === metalType && String(c.category).toLowerCase() === name.toLowerCase());
      if (dup) throw new Error(`${name} is already in the ${metalType} list`);
      state.categories = upsertById(state.categories, stamp({ ...(state.editing || {}), id, metalType, category: name, status: data.status || 'ACTIVE' }, isNew));
      markDirty('categories', id);
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
    resetPhotoState();
    await persist();
    if (staleSalePhoto) trashPhotos([staleSalePhoto]);
    render();
  } catch (error) {
    if (form.id === 'data-form' && state.modal) {
      let box = form.querySelector('.form-error');
      if (!box) {
        box = document.createElement('div');
        box.className = 'notice form-error';
        box.setAttribute('role', 'alert');
        form.prepend(box);
      }
      box.textContent = explainLedgerError(error);
      const btn = form.querySelector('.form-actions .btn-primary');
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      box.scrollIntoView({ block: 'nearest' });
      return;
    }
    state.error = explainLedgerError(error);
    if (form.id === 'login-form' || form.id === 'setup-exec' || form.id === 'setup-shop' || form.id === 'setup-sheet' || form.id === 'setup-license') {
      state.unlocked = false;
      state.pin = '';
      return landing();
    }
    render();
  }
}

async function enterUnlocked() {
  loadSavedRates();
  loadRates();
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
  try { state.bigText = localStorage.getItem(TEXT_KEY) === '1'; } catch { /* ignore */ }
  applyTextSize();
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
