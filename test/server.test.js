import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { ControlPlane } from '../src/control-plane.js';
import { LedgerStore } from '../src/ledger-store.js';
import { defaultPlan, SubscriptionEntitlementService, createTenant, createUser } from '../src/domain.js';
import { SessionStore } from '../src/session.js';

function start(overrides = {}) {
  const controlPlane = overrides.controlPlane || new ControlPlane();
  if (!controlPlane.plans.get('plan_pro')) controlPlane.savePlan(defaultPlan());
  const ledger = overrides.ledger || new LedgerStore();
  const sessions = overrides.sessions || new SessionStore();
  const entitlements = overrides.entitlements || new SubscriptionEntitlementService({ tenantStore: controlPlane.tenants, planStore: controlPlane.plans });
  const app = createApp({
    controlPlane, ledger, sessions, entitlements,
    ...overrides,
    env: { ADMIN_KEY: 'local-admin', GOOGLE_CLIENT_ID: '', TOKEN_ENCRYPTION_KEY: 'a'.repeat(64), ...(overrides.env || {}) }
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        server, controlPlane, ledger, sessions, entitlements,
        url: `http://127.0.0.1:${port}`
      });
    });
  });
}

test('owner session can add a supplier and money; admin cannot see the name', async () => {
  const ctx = await start();
  try {
    const tenant = createTenant({ id: 't1', businessName: 'Mehta', ownerUserId: 'u1' });
    tenant.setupStatus = 'READY';
    ctx.controlPlane.saveTenant(tenant);
    ctx.controlPlane.saveUser(createUser({ id: 'u1', tenantId: 't1', email: 'o@x.com', googleSubjectId: 'sub', name: 'O' }));
    const { header } = ctx.sessions.create({ userId: 'u1', tenantId: 't1' });
    const cookie = header.split(';')[0];
    const created = await fetch(`${ctx.url}/api/me/suppliers`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Secret Karigar', openingMoney: 10 })
    });
    assert.equal(created.status, 201);
    const admin = await fetch(`${ctx.url}/api/admin/tenants`, { headers: { 'x-admin-key': 'local-admin' } });
    const rows = await admin.json();
    assert.equal(rows[0].businessName, 'Mehta');
    assert.equal(rows[0].ownerEmail, 'o@x.com');
    assert.equal(rows[0].setupStatus, 'READY');
    assert.ok(!JSON.stringify(rows).includes('Secret Karigar'));
  } finally { ctx.server.close(); }
});

test('read-only tenant is rejected on write and allowed on export', async () => {
  const ctx = await start();
  const tenant = createTenant({ id: 't1', businessName: 'Mehta', ownerUserId: 'u1', now: new Date('2026-01-01') });
  tenant.setupStatus = 'READY';
  ctx.controlPlane.saveTenant(tenant);
  ctx.controlPlane.saveUser(createUser({ id: 'u1', tenantId: 't1', email: 'o@x.com', googleSubjectId: 'sub', name: 'O' }));
  const entitlements = new SubscriptionEntitlementService({
    tenantStore: ctx.controlPlane.tenants, planStore: ctx.controlPlane.plans,
    clock: () => new Date('2026-02-01')
  });
  ctx.server.close();
  const ctx2 = await start({ controlPlane: ctx.controlPlane, entitlements, ledger: ctx.ledger, sessions: ctx.sessions });
  try {
    const { header } = ctx2.sessions.create({ userId: 'u1', tenantId: 't1' });
    const cookie = header.split(';')[0];
    const write = await fetch(`${ctx2.url}/api/me/suppliers`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' })
    });
    assert.equal(write.status, 400);
    const exportRes = await fetch(`${ctx2.url}/api/me/export?kind=suppliers`, { headers: { cookie } });
    assert.equal(exportRes.status, 200);
  } finally { ctx2.server.close(); }
});

test('POST /tenants without Google is local-dev only and does not require session', async () => {
  const ctx = await start();
  try {
    const res = await fetch(`${ctx.url}/api/tenants`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ businessName: 'Local Shop', ownerUserId: 'dev@local' })
    });
    assert.equal(res.status, 201);
    const tenant = await res.json();
    assert.equal(tenant.setupStatus, 'READY');
    assert.match(res.headers.get('set-cookie') || '', /karigar\.sid=/);
  } finally { ctx.server.close(); }
});

test('GET /auth/google 302s when GOOGLE_CLIENT_ID is set', async () => {
  const ctx = await start({
    env: {
      GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
      GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback'
    }
  });
  try {
    const res = await fetch(`${ctx.url}/auth/google`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location') || '', /accounts\.google\.com/);
  } finally { ctx.server.close(); }
});

test('POST /api/setup with a pending Google session creates a tenant and spreadsheet', async () => {
  const calls = [];
  const stubLedger = {
    async ensureSpreadsheet(args) { calls.push(args); return 'ss_1'; },
    list() { return []; }, add() { return {}; }, addSupplier() { return {}; },
    update() { return {}; }, summary() { return {}; }, supplierLedger() { return {}; }, exportCSV() { return ''; }
  };
  const ctx = await start({ ledger: stubLedger });
  try {
    const { header } = ctx.sessions.create({
      googleSubjectId: 'sub-setup', email: 'owner@shop.com', name: 'Owner', accessToken: 'tok'
    });
    const cookie = header.split(';')[0];
    const res = await fetch(`${ctx.url}/api/setup`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ businessName: 'Mehta Jewels' })
    });
    assert.equal(res.status, 201);
    const tenant = await res.json();
    assert.equal(tenant.setupStatus, 'READY');
    assert.equal(tenant.spreadsheetId, 'ss_1');
    assert.equal(tenant.googleConnected, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].businessName, 'Mehta Jewels');
    assert.equal(calls[0].accessToken, 'tok');
    assert.ok(ctx.controlPlane.findUserByGoogleSubject('sub-setup'));
  } finally { ctx.server.close(); }
});

test('GET /api/me without cookie is 401 with Sign in required', async () => {
  const ctx = await start();
  try {
    const res = await fetch(`${ctx.url}/api/me`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'Sign in required' });
  } finally { ctx.server.close(); }
});

test('POST /api/setup sheet failure marks SETUP_FAILED', async () => {
  const stubLedger = {
    async ensureSpreadsheet() { throw new Error('sheets down'); },
    list() { return []; }, add() { return {}; }, addSupplier() { return {}; },
    update() { return {}; }, summary() { return {}; }, supplierLedger() { return {}; }, exportCSV() { return ''; }
  };
  const ctx = await start({ ledger: stubLedger });
  try {
    const { header } = ctx.sessions.create({ googleSubjectId: 'sub-fail', email: 'a@b.com', name: 'A' });
    const cookie = header.split(';')[0];
    const res = await fetch(`${ctx.url}/api/setup`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ businessName: 'X' })
    });
    assert.equal(res.status, 400);
    const tenants = ctx.controlPlane.tenants.values();
    assert.equal(tenants[0].setupStatus, 'SETUP_FAILED');
    assert.notEqual(tenants[0].setupStatus, 'READY');
  } finally { ctx.server.close(); }
});
