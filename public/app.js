const root = document.querySelector('#app');
const GOLD_PURITIES = ['24K', '22K', '18K', '14K'];
const SILVER_PURITIES = ['999', '925'];
const state = {
  me: null, view: 'dashboard', supplierId: null, summary: null, suppliers: [],
  money: [], metal: [], settlements: [], entitlements: null, modal: null, error: null,
  detail: null, plans: []
};

const money = (v) => `INR ${Number(v || 0).toLocaleString('en-IN')}`;
const grams = (v) => `${Number(v || 0).toLocaleString('en-IN')} g`;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[x]));
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-IN') : '';
const canWrite = () => Boolean(state.me?.canWrite);
const modeOf = () => state.entitlements?.mode || state.me?.entitlements?.mode || 'FULL_ACCESS';
const tenant = () => state.me?.tenant || null;
const supplierName = (id) => state.suppliers.find((s) => s.id === id)?.name || '';

function trialDaysLeft() {
  const ends = tenant()?.trialEndsAt;
  if (!ends) return 0;
  return Math.max(0, Math.ceil((new Date(ends) - Date.now()) / 86400000));
}

function payableFor(supplierId) {
  const cash = (state.money || []).filter((row) => row.supplierId === supplierId)
    .reduce((sum, row) => {
      if (row.type === 'OPENING' || row.type === 'PURCHASE') return sum + Number(row.amountInr || 0);
      if (row.type === 'PAYMENT') return sum - Number(row.amountInr || 0);
      return sum;
    }, 0);
  const settled = (state.settlements || []).filter((row) => row.supplierId === supplierId)
    .reduce((sum, row) => sum + Number(row.moneyAmountInr || 0), 0);
  return cash - settled;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: `Server returned HTTP ${response.status}` }; }
  if (!response.ok) {
    const error = Error(data.error || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function purityOptions(metalType, selected) {
  const list = metalType === 'SILVER' ? SILVER_PURITIES : GOLD_PURITIES;
  return list.map((p) => `<option value="${p}" ${p === selected ? 'selected' : ''}>${p}</option>`).join('');
}

function supplierSelect(selected) {
  return `<label>Supplier<select name="supplierId" required>${state.suppliers.map((s) =>
    `<option value="${esc(s.id)}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`;
}

function landing() {
  root.innerHTML = `<main class="onboard"><section class="onboard-card">
    <div class="brand"><span class="brand-mark">K</span> karigar</div>
    <h1>Bring clarity to every gram.</h1>
    <p>Track suppliers, payments and metal balances in one calm workspace. Sign in with Google to keep the ledger in your Drive.</p>
    ${state.error ? `<div class="notice">${esc(state.error)}</div>` : ''}
    <p style="margin-top:22px"><a class="btn btn-primary" href="/auth/google">Continue with Google</a></p>
    <div class="eyebrow" style="margin-top:28px">LOCAL DEVELOPMENT MODE</div>
    <div class="notice">Data is currently saved only in this app's local <code>data/</code> folder when Google is not configured. It is not being sent to Google Sheets until Google OAuth is connected.</div>
    <form id="onboard-form">
      <label>Business name<input name="businessName" placeholder="e.g. Mehta Jewellers" required></label>
      <label>Owner email (local profile)<input name="email" type="email" placeholder="owner@shop.com" required></label>
      <button class="btn btn-primary">Create local workspace</button>
    </form>
    <p><a href="/data-ownership">Read the planned Google data-ownership model</a></p>
  </section></main>`;
  bind();
}

function setup() {
  const failed = tenant()?.setupStatus === 'SETUP_FAILED';
  const name = state.me?.user?.name || state.me?.user?.email || '';
  root.innerHTML = `<main class="onboard"><section class="onboard-card">
    <div class="brand"><span class="brand-mark">K</span> karigar</div>
    <div class="eyebrow">WORKSPACE SETUP</div>
    <h1>Name your business.</h1>
    <p>${esc(name ? `Welcome, ${name}. ` : '')}We'll create your supplier ledger after you choose a business name.</p>
    ${failed ? '<div class="notice">Spreadsheet setup did not finish. Check Google access and try again.</div>' : ''}
    ${state.error ? `<div class="notice">${esc(state.error)}</div>` : ''}
    <form id="setup-form">
      <label>Business name<input name="businessName" value="${esc(tenant()?.businessName || '')}" placeholder="e.g. Mehta Jewellers" required></label>
      <button class="btn btn-primary">${failed ? 'Retry setup' : 'Create workspace'}</button>
    </form>
    <p><button class="btn-plain" data-action="logout" type="button">Sign out</button></p>
  </section></main>`;
  bind();
}

function needsSetup(me) {
  if (!me?.user) return false;
  return !me.tenant || me.tenant.setupStatus !== 'READY';
}

async function bootstrap() {
  state.error = null;
  try {
    state.me = await api('/api/me');
  } catch (error) {
    if (error.status === 401 || error.message === 'Sign in required') {
      state.me = null;
      return landing();
    }
    return showError(error);
  }
  if (needsSetup(state.me)) return setup();
  state.entitlements = state.me.entitlements;
  try { await refresh(); } catch (error) { showError(error); }
}

async function refresh() {
  const [summary, suppliers, moneyRows, metalRows, settlements, plans] = await Promise.all([
    api('/api/me/summary'),
    api('/api/me/suppliers'),
    api('/api/me/money'),
    api('/api/me/metal'),
    api('/api/me/settlements'),
    api('/api/plans')
  ]);
  state.summary = summary;
  state.suppliers = suppliers;
  state.money = moneyRows;
  state.metal = metalRows;
  state.settlements = settlements;
  state.plans = plans;
  state.entitlements = state.me?.entitlements;
  if (state.view === 'supplier' && state.supplierId) {
    state.detail = await api(`/api/me/suppliers/${state.supplierId}`);
  } else {
    state.detail = null;
  }
  render();
}

function showError(error) {
  root.innerHTML = `<main class="onboard"><section class="onboard-card">
    <div class="eyebrow">WORKSPACE ERROR</div>
    <h1>We hit a small snag.</h1>
    <p>${esc(error.message)}</p>
    <div class="form-actions">
      <button class="btn btn-primary" data-action="retry">Try again</button>
      <button class="btn btn-soft" data-action="logout">Sign out</button>
    </div>
  </section></main>`;
  bind();
}

function render() {
  if (!state.me) return landing();
  if (needsSetup(state.me)) return setup();
  const mode = modeOf();
  const t = tenant() || {};
  root.innerHTML = `<div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">K</span> karigar</div>
      <div class="tagline">JEWELLERY OPERATIONS</div>
      <nav class="nav">
        <button class="${state.view === 'dashboard' ? 'active' : ''}" data-view="dashboard">Overview</button>
        <button class="${state.view === 'suppliers' || state.view === 'supplier' ? 'active' : ''}" data-view="suppliers">Suppliers</button>
        <button class="${state.view === 'money' ? 'active' : ''}" data-view="money">Money</button>
        <button class="${state.view === 'metal' ? 'active' : ''}" data-view="metal">Metal</button>
        <button class="${state.view === 'settlements' ? 'active' : ''}" data-view="settlements">Settlements</button>
        <button class="${state.view === 'reports' ? 'active' : ''}" data-view="reports">Reports</button>
        <button class="${state.view === 'billing' ? 'active' : ''}" data-view="billing">Plan & billing</button>
      </nav>
      <div class="side-foot">Workspace<strong>${esc(t.businessName)}</strong>
        <span>${esc(state.me.user?.email || '')}</span>
        <span>${mode === 'FULL_ACCESS' ? 'Full access' : 'Read-only workspace'}</span>
        <p><button class="btn-plain" data-action="logout" type="button">Log out</button></p>
      </div>
    </aside>
    <main class="main">${viewContent(mode)}</main>
    ${state.modal ? modal() : ''}
  </div>`;
  bind();
}

function viewContent(mode) {
  const t = tenant() || {};
  const titles = {
    dashboard: [`Good morning, ${esc(t.businessName)}`, 'A clear view of what is moving in your business.'],
    suppliers: ['Suppliers', 'Relationships, payable balances and metal on account.'],
    supplier: [esc(state.detail?.supplier?.name || 'Supplier'), 'Payable, metal by purity, and daily movements.'],
    money: ['Money journal', 'Purchases and payments against suppliers.'],
    metal: ['Metal journal', 'Issues and receipts, kept separate by purity.'],
    settlements: ['Settlements', 'Simple close-outs of cash and metal.'],
    reports: ['Reports', 'A simple pulse on your supplier operations.'],
    billing: ['Plan & billing', 'Your plan stays flexible as the business grows.']
  };
  const [title, sub] = titles[state.view] || titles.dashboard;
  const addBtn = (() => {
    if (!canWrite()) return '';
    if (state.view === 'suppliers') return `<button class="btn btn-primary" data-action="modal" data-modal="supplier">+ Add supplier</button>`;
    if (state.view === 'money') return `<button class="btn btn-primary" data-action="modal" data-modal="purchase">+ Record money</button>`;
    if (state.view === 'metal') return `<button class="btn btn-primary" data-action="modal" data-modal="issue">+ Record metal</button>`;
    if (state.view === 'settlements') return `<button class="btn btn-primary" data-action="modal" data-modal="settle">+ Record settlement</button>`;
    return '';
  })();
  const banner = mode !== 'FULL_ACCESS'
    ? '<div class="notice">This workspace is read-only. Subscribe from Plan &amp; billing to continue writing. Your data stays readable.</div>'
    : '';
  return `${banner}<header class="top"><div><div class="eyebrow">${state.view === 'dashboard' ? esc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()) : 'WORKSPACE'}</div><h1>${title}</h1><p>${sub}</p></div>${addBtn}</header>${
    state.view === 'dashboard' ? dashboard()
      : state.view === 'suppliers' ? suppliers()
        : state.view === 'supplier' ? supplierDetail()
          : state.view === 'money' ? moneyJournal()
            : state.view === 'metal' ? metalJournal()
              : state.view === 'settlements' ? settlementJournal()
                : state.view === 'reports' ? reports()
                  : billing()
  }`;
}

function dashboard() {
  const s = state.summary || {};
  const days = trialDaysLeft();
  const mode = modeOf();
  const recent = s.recentMoney || [];
  return `<section class="grid stats">
    <div class="card"><span class="stat-label">Outstanding balance</span><div class="stat-value">${money(s.outstanding)}</div><span class="stat-note">Across all suppliers</span></div>
    <div class="card"><span class="stat-label">Total purchases</span><div class="stat-value">${money(s.totalPurchases)}</div><span class="stat-note">This workspace</span></div>
    <div class="card"><span class="stat-label">Payments recorded</span><div class="stat-value">${money(s.totalPayments)}</div><span class="stat-note">Keep it moving</span></div>
    <div class="card"><span class="stat-label">Active suppliers</span><div class="stat-value">${s.supplierCount || 0}</div><span class="stat-note">Relationships</span></div>
  </section><br>
  <section class="grid two">
    <div class="card">
      <div class="section-head"><h2>Recent money</h2><button class="btn-plain" data-view="money">View all</button></div>
      ${recent.length ? `<div class="list">${recent.map((x) => `<div class="row"><div><strong>${esc(x.supplierName || supplierName(x.supplierId))}</strong><small>${esc(x.type)} · ${fmtDate(x.date || x.createdAt)}</small></div><div class="money">${money(x.amountInr)}</div><span class="pill ${x.type === 'PAYMENT' ? '' : 'orange'}">${esc(x.type)}</span></div>`).join('')}</div>` : '<div class="empty">No money entries yet.</div>'}
    </div>
    <div class="card">
      <div class="section-head"><h2>Trial status</h2><span class="pill">${esc(mode)}</span></div>
      <p>${days ? `${days} day${days === 1 ? '' : 's'} remaining on your trial.` : 'Trial has ended. Subscribe to keep writing.'}</p>
      <div class="bar"><span style="width:${Math.min(100, (days / 14) * 100)}%"></span></div>
      <p><strong>${days ? 'Trial active' : 'Read-only'}</strong><br><small>Subscribe anytime from Plan &amp; billing.</small></p>
    </div>
  </section>`;
}

function suppliers() {
  return `<section class="card">
    <div class="section-head"><h2>Supplier directory</h2><span class="pill">${state.suppliers.length} total</span></div>
    ${state.suppliers.length ? `<div class="list">${state.suppliers.map((x) => `<div class="row clickable" data-supplier="${esc(x.id)}"><div><strong>${esc(x.name)}</strong><small>${esc(x.phone || 'No phone added')}</small></div><div class="money">${money(x.payable ?? payableFor(x.id))}</div><span class="pill">${esc(x.status || 'ACTIVE')}</span></div>`).join('')}</div>` : '<div class="empty">Your supplier relationships will appear here.</div>'}
  </section>`;
}

function metalPills(map) {
  const entries = Object.entries(map || {}).filter(([, v]) => Number(v) !== 0);
  if (!entries.length) return '<p>No metal on this supplier.</p>';
  return `<div class="metal-pills">${entries.map(([key, v]) => `<span class="pill">${esc(key)} · ${grams(v)}</span>`).join('')}</div>`;
}

function supplierDetail() {
  const detail = state.detail;
  if (!detail?.supplier) return '<div class="empty">Supplier not found.</div>';
  const write = canWrite();
  return `<section class="grid two">
    <div class="card">
      <div class="section-head"><h2>Payable</h2><span class="pill">${esc(detail.supplier.status || 'ACTIVE')}</span></div>
      <div class="stat-value">${money(detail.payable)}</div>
      <p>${esc(detail.supplier.phone || 'No phone')} ${detail.supplier.notes ? `· ${esc(detail.supplier.notes)}` : ''}</p>
      ${write ? `<div class="actions">
        <button class="btn btn-primary" data-action="modal" data-modal="purchase">Purchase</button>
        <button class="btn btn-soft" data-action="modal" data-modal="payment">Payment</button>
        <button class="btn btn-soft" data-action="modal" data-modal="issue">Issue metal</button>
        <button class="btn btn-soft" data-action="modal" data-modal="receive">Receive metal</button>
        <button class="btn btn-soft" data-action="modal" data-modal="settle">Settle</button>
      </div>` : ''}
    </div>
    <div class="card">
      <div class="section-head"><h2>Metal by purity</h2></div>
      ${metalPills(detail.metalByPurity)}
    </div>
  </section>
  <br>
  <section class="card">
    <div class="section-head"><h2>Recent money</h2></div>
    ${moneyRows(detail.money || [])}
  </section>`;
}

function moneyRows(items) {
  if (!items.length) return '<div class="empty">No money entries yet.</div>';
  return `<div class="list">${items.map((x) => `<div class="row"><div><strong>${esc(x.supplierName || supplierName(x.supplierId))}</strong><small>${esc(x.type)} · ${fmtDate(x.date || x.createdAt)}${x.note ? ` · ${esc(x.note)}` : ''}</small></div><div class="money">${money(x.amountInr)}</div><span class="pill ${x.type === 'PAYMENT' ? '' : 'orange'}">${esc(x.type)}</span></div>`).join('')}</div>`;
}

function moneyJournal() {
  return `<section class="card"><div class="section-head"><h2>All money</h2><span class="date">${state.money.length} entries</span></div>${moneyRows(state.money)}</section>`;
}

function metalJournal() {
  if (!state.metal.length) return '<section class="card"><div class="empty">No metal entries yet.</div></section>';
  return `<section class="card"><div class="section-head"><h2>All metal</h2><span class="date">${state.metal.length} entries</span></div>
    <div class="list">${state.metal.map((x) => `<div class="row"><div><strong>${esc(supplierName(x.supplierId))}</strong><small>${esc(x.direction)} · ${esc(x.metalType)} ${esc(x.purity)} · ${fmtDate(x.date || x.createdAt)}</small></div><div class="money">${grams(x.weightGrams)}</div><span class="pill ${x.direction === 'RECEIPT' ? '' : 'orange'}">${esc(x.direction)}</span></div>`).join('')}</div>
  </section>`;
}

function settlementJournal() {
  if (!state.settlements.length) return '<section class="card"><div class="empty">No settlements yet.</div></section>';
  return `<section class="card"><div class="section-head"><h2>All settlements</h2><span class="date">${state.settlements.length} entries</span></div>
    <div class="list">${state.settlements.map((x) => `<div class="row"><div><strong>${esc(supplierName(x.supplierId))}</strong><small>${fmtDate(x.date || x.createdAt)}${x.metalType ? ` · ${esc(x.metalType)} ${esc(x.purity || '')} ${grams(x.metalGrams)}` : ''}${x.note ? ` · ${esc(x.note)}` : ''}</small></div><div class="money">${money(x.moneyAmountInr)}</div><span class="pill">Settlement</span></div>`).join('')}</div>
  </section>`;
}

function reports() {
  const s = state.summary || {};
  const metalMap = s.metalByPurity || {};
  return `<section class="grid two">
    <div class="card">
      <div class="section-head"><h2>Cash movement</h2><span class="pill">All time</span></div>
      <p>Purchases recorded</p><div class="stat-value">${money(s.totalPurchases)}</div>
      <div class="bar"><span style="width:${s.totalPurchases ? Math.min(100, s.totalPurchases / (s.totalPurchases + s.totalPayments) * 100) : 0}%"></span></div>
      <p>Payments recorded</p><div class="stat-value">${money(s.totalPayments)}</div>
      <div class="bar"><span style="width:${s.totalPurchases ? Math.min(100, s.totalPayments / (s.totalPurchases + s.totalPayments) * 100) : 0}%;background:var(--green)"></span></div>
      <p>Outstanding</p><div class="stat-value">${money(s.outstanding)}</div>
    </div>
    <div class="card">
      <div class="section-head"><h2>Export</h2></div>
      <p>Download CSV of each journal. Exports stay available in read-only mode.</p>
      <p><a class="btn btn-soft" href="/api/me/export?kind=suppliers">Suppliers CSV</a></p>
      <p><a class="btn btn-soft" href="/api/me/export?kind=money">Money CSV</a></p>
      <p><a class="btn btn-soft" href="/api/me/export?kind=metal">Metal CSV</a></p>
      <p><a class="btn btn-soft" href="/api/me/export?kind=settlements">Settlements CSV</a></p>
      <div class="section-head" style="margin-top:22px"><h2>Shop metal</h2></div>
      ${metalPills(metalMap)}
    </div>
  </section>`;
}

function billing() {
  const e = state.entitlements || {};
  const t = tenant() || {};
  const plan = (Array.isArray(state.plans) ? state.plans : []).find((p) => p.id === t.planId) || (Array.isArray(state.plans) ? state.plans[0] : null) || {};
  const days = trialDaysLeft();
  const mode = modeOf();
  return `${mode !== 'FULL_ACCESS' ? '<div class="notice">Read-only: writing is paused until you subscribe. Ledger rows are never deleted.</div>' : ''}
  <section class="grid two">
    <div class="card">
      <div class="eyebrow">CURRENT PLAN</div>
      <h2 style="margin-top:10px">${esc(plan.name || 'Pro')} workspace</h2>
      <div class="stat-value">${money(plan.monthlyPrice ?? 1999)} <small>/ month</small></div>
      <p>${days ? `${days} trial day${days === 1 ? '' : 's'} remaining.` : 'Trial has ended.'} Up to ${e.limits?.users || plan.limits?.users || 5} team members.</p>
      <button class="btn btn-primary" data-action="modal" data-modal="subscribe">Continue with ${esc(plan.name || 'Pro')}</button>
    </div>
    <div class="card">
      <h2>Included</h2>
      <p>Supplier ledger, money, metal by purity, settlements, dashboard, reports and exports.</p>
      <div class="pill">${esc(mode)}</div>
    </div>
  </section>`;
}

function modal() {
  const kind = state.modal;
  if (kind === 'subscribe') {
    return `<div class="modal-backdrop"><section class="modal">
      <div class="section-head"><h2>Start your Pro subscription</h2><button class="btn-plain" data-action="close">Close</button></div>
      <p>Razorpay checkout will open once billing credentials are configured. Your trial remains active.</p>
      <div class="notice">Payments are not connected. Razorpay is not connected in this build.</div>
    </section></div>`;
  }
  if (kind === 'supplier') return supplierModal();
  if (kind === 'purchase' || kind === 'payment') return moneyModal(kind === 'payment' ? 'PAYMENT' : 'PURCHASE');
  if (kind === 'issue' || kind === 'receive') return metalModal(kind === 'receive' ? 'RECEIPT' : 'ISSUE');
  if (kind === 'settle') return settleModal();
  return '';
}

function supplierModal() {
  return `<div class="modal-backdrop"><section class="modal">
    <div class="section-head"><h2>Add supplier</h2><button class="btn-plain" data-action="close">Close</button></div>
    <form id="data-form" data-kind="supplier">
      <label>Supplier name<input name="name" required></label>
      <label>Phone (optional)<input name="phone"></label>
      <label>Notes (optional)<input name="notes"></label>
      <label>Opening money (INR)<input name="openingMoney" type="number" min="0" step="0.01" value="0"></label>
      <label>Opening metal type<select name="metalType"><option value="">None</option><option value="GOLD">Gold</option><option value="SILVER">Silver</option></select></label>
      <label>Opening purity<select name="purity">${purityOptions('GOLD', '22K')}</select></label>
      <label>Opening metal (grams)<input name="weightGrams" type="number" min="0" step="0.001" value="0"></label>
      <div class="form-actions"><button type="button" class="btn btn-soft" data-action="close">Cancel</button><button class="btn btn-primary">Save</button></div>
    </form>
  </section></div>`;
}

function moneyModal(type) {
  const locked = Boolean(state.supplierId);
  return `<div class="modal-backdrop"><section class="modal">
    <div class="section-head"><h2>${type === 'PAYMENT' ? 'Record payment' : 'Record purchase'}</h2><button class="btn-plain" data-action="close">Close</button></div>
    <form id="data-form" data-kind="money">
      ${locked ? `<input type="hidden" name="supplierId" value="${esc(state.supplierId)}">` : supplierSelect(state.supplierId)}
      <label>Type<select name="type"><option value="PURCHASE" ${type === 'PURCHASE' ? 'selected' : ''}>Purchase</option><option value="PAYMENT" ${type === 'PAYMENT' ? 'selected' : ''}>Payment</option></select></label>
      <label>Amount (INR)<input name="amountInr" type="number" min="0.01" step="0.01" required></label>
      <label>Date<input name="date" type="date" value="${today()}" required></label>
      <label>Note<input name="note"></label>
      <div class="form-actions"><button type="button" class="btn btn-soft" data-action="close">Cancel</button><button class="btn btn-primary">Save</button></div>
    </form>
  </section></div>`;
}

function metalModal(direction) {
  const locked = Boolean(state.supplierId);
  return `<div class="modal-backdrop"><section class="modal">
    <div class="section-head"><h2>${direction === 'RECEIPT' ? 'Receive metal' : 'Issue metal'}</h2><button class="btn-plain" data-action="close">Close</button></div>
    <form id="data-form" data-kind="metal">
      ${locked ? `<input type="hidden" name="supplierId" value="${esc(state.supplierId)}">` : supplierSelect(state.supplierId)}
      <label>Direction<select name="direction"><option value="ISSUE" ${direction === 'ISSUE' ? 'selected' : ''}>Issue</option><option value="RECEIPT" ${direction === 'RECEIPT' ? 'selected' : ''}>Receipt</option></select></label>
      <label>Metal<select name="metalType"><option value="GOLD">Gold</option><option value="SILVER">Silver</option></select></label>
      <label>Purity<select name="purity">${purityOptions('GOLD', '22K')}</select></label>
      <label>Weight (grams)<input name="weightGrams" type="number" min="0.001" step="0.001" required></label>
      <label>Date<input name="date" type="date" value="${today()}" required></label>
      <label>Note<input name="note"></label>
      <div class="form-actions"><button type="button" class="btn btn-soft" data-action="close">Cancel</button><button class="btn btn-primary">Save</button></div>
    </form>
  </section></div>`;
}

function settleModal() {
  const locked = Boolean(state.supplierId);
  return `<div class="modal-backdrop"><section class="modal">
    <div class="section-head"><h2>Record settlement</h2><button class="btn-plain" data-action="close">Close</button></div>
    <form id="data-form" data-kind="settle">
      ${locked ? `<input type="hidden" name="supplierId" value="${esc(state.supplierId)}">` : supplierSelect(state.supplierId)}
      <label>Cash closed (INR)<input name="moneyAmountInr" type="number" min="0" step="0.01" value="0"></label>
      <label>Metal type<select name="metalType"><option value="">None</option><option value="GOLD">Gold</option><option value="SILVER">Silver</option></select></label>
      <label>Purity<select name="purity">${purityOptions('GOLD', '22K')}</select></label>
      <label>Metal closed (grams)<input name="metalGrams" type="number" min="0" step="0.001" value="0"></label>
      <label>Date<input name="date" type="date" value="${today()}" required></label>
      <label>Note<input name="note"></label>
      <div class="form-actions"><button type="button" class="btn btn-soft" data-action="close">Cancel</button><button class="btn btn-primary">Save</button></div>
    </form>
  </section></div>`;
}

function bind() {
  root.onclick = async (event) => {
    const target = event.target.closest('[data-view], [data-action], [data-supplier]');
    if (!target) return;
    try {
      if (target.dataset.supplier) {
        state.view = 'supplier';
        state.supplierId = target.dataset.supplier;
        state.modal = null;
        await refresh();
        return;
      }
      if (target.dataset.view) {
        state.view = target.dataset.view;
        if (target.dataset.view !== 'supplier') state.supplierId = null;
        state.modal = null;
        await refresh();
        return;
      }
      const action = target.dataset.action;
      if (action === 'close') { state.modal = null; render(); }
      else if (action === 'modal') { state.modal = target.dataset.modal; render(); }
      else if (action === 'retry') { await bootstrap(); }
      else if (action === 'logout') {
        try { await api('/api/logout', { method: 'POST' }); } catch { /* session already gone */ }
        state.me = null;
        state.view = 'dashboard';
        location.href = '/';
      }
    } catch (error) {
      state.error = error.message;
      render();
    }
  };
  const metalType = root.querySelector('select[name="metalType"]');
  const purity = root.querySelector('select[name="purity"]');
  if (metalType && purity) {
    metalType.onchange = () => { purity.innerHTML = purityOptions(metalType.value || 'GOLD', purity.value); };
  }
  for (const form of root.querySelectorAll('form')) form.onsubmit = submitForm;
}

async function submitForm(event) {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  state.error = null;
  try {
    if (form.id === 'onboard-form') {
      await api('/api/tenants', {
        method: 'POST',
        body: JSON.stringify({ businessName: data.businessName, ownerUserId: data.email })
      });
      state.me = await api('/api/me');
      state.entitlements = state.me.entitlements;
      await refresh();
      return;
    }
    if (form.id === 'setup-form') {
      await api('/api/setup', { method: 'POST', body: JSON.stringify({ businessName: data.businessName }) });
      state.me = await api('/api/me');
      state.entitlements = state.me.entitlements;
      await refresh();
      return;
    }
    const kind = form.dataset.kind;
    if (kind === 'supplier') {
      const openingMetal = Number(data.weightGrams) > 0 && data.metalType
        ? [{ metalType: data.metalType, purity: data.purity, weightGrams: Number(data.weightGrams) }]
        : [];
      await api('/api/me/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          phone: data.phone || '',
          notes: data.notes || '',
          openingMoney: Number(data.openingMoney || 0),
          openingMetal
        })
      });
    } else if (kind === 'money') {
      await api('/api/me/money', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: data.supplierId,
          type: data.type,
          amountInr: Number(data.amountInr),
          date: data.date,
          note: data.note || ''
        })
      });
    } else if (kind === 'metal') {
      await api('/api/me/metal', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: data.supplierId,
          direction: data.direction,
          metalType: data.metalType,
          purity: data.purity,
          weightGrams: Number(data.weightGrams),
          date: data.date,
          note: data.note || ''
        })
      });
    } else if (kind === 'settle') {
      await api('/api/me/settlements', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: data.supplierId,
          moneyAmountInr: Number(data.moneyAmountInr || 0),
          metalType: data.metalType || '',
          purity: data.metalType ? data.purity : '',
          metalGrams: Number(data.metalGrams || 0),
          date: data.date,
          note: data.note || ''
        })
      });
    }
    state.modal = null;
    await refresh();
  } catch (error) {
    state.error = error.message;
    if (form.id === 'onboard-form') return landing();
    if (form.id === 'setup-form') return setup();
    render();
  }
}

bootstrap().catch(showError);
