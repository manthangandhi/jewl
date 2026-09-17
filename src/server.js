import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ControlPlane, MetadataStore } from './control-plane.js';
import { defaultPlan, createTenant, createUser, SubscriptionEntitlementService } from './domain.js';
import { BillingWebhookService, RazorpayWebhookProvider } from './billing.js';
import { LedgerStore } from './ledger-store.js';
import { SheetsLedger } from './sheets-ledger.js';
import { googleAuthUrl, exchangeCode, refreshAccessToken } from './oauth.js';
import { SessionStore } from './session.js';
import { encryptSecret, decryptSecret } from './token-crypto.js';
import { assertCanPerformPaidWrite } from './write-gate.js';

const MONEY_TYPES = new Set(['OPENING', 'PURCHASE', 'PAYMENT']);
const METAL_DIRECTIONS = new Set(['OPENING', 'ISSUE', 'RECEIPT']);
const EXPORT_KINDS = new Set(['suppliers', 'money', 'metal', 'settlements']);
const DEFAULT_REDIRECT = 'http://localhost:3000/auth/google/callback';

function json(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let value = '';
  for await (const chunk of request) value += chunk;
  return value;
}

async function jsonBody(request) {
  const raw = await readBody(request);
  return raw ? JSON.parse(raw) : {};
}

function cookieSid(request) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('karigar.sid=')) return trimmed.slice('karigar.sid='.length);
  }
  return null;
}

function publicUser(user) {
  if (!user) return null;
  const { encryptedRefreshToken, accessToken, refreshToken, ...rest } = user;
  void encryptedRefreshToken; void accessToken; void refreshToken;
  return rest;
}

function isUnauthorized(error) {
  return /401|unauthorized|invalid.?grant|invalid.?token/i.test(error?.message || '');
}

async function staticFile(pathname) {
  const pages = { '/pricing': '/pricing.html', '/data-ownership': '/data-ownership.html', '/admin': '/admin.html' };
  const safePath = pages[pathname] || (pathname === '/' ? '/index.html' : pathname);
  const file = join(fileURLToPath(new URL('../public', import.meta.url)), safePath);
  const content = await readFile(file);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  return { content, type: types[extname(file)] || 'application/octet-stream' };
}

export function createApp(deps = {}) {
  const env = { ADMIN_KEY: 'local-admin', ...process.env, ...(deps.env || {}) };
  const controlPlane = deps.controlPlane || new ControlPlane();
  if (!controlPlane.plans.get('plan_pro')) controlPlane.savePlan(defaultPlan());
  const injectedLedger = deps.ledger || new LedgerStore();
  const sessions = deps.sessions || new SessionStore();
  const entitlements = deps.entitlements || new SubscriptionEntitlementService({
    tenantStore: controlPlane.tenants, planStore: controlPlane.plans
  });
  const billing = deps.billing || new BillingWebhookService({
    controlPlane, provider: new RazorpayWebhookProvider(env.RAZORPAY_WEBHOOK_SECRET)
  });
  const oauth = {
    googleAuthUrl, exchangeCode, refreshAccessToken,
    ...(deps.oauth || {})
  };
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID);
  const plan = controlPlane.plans.get('plan_pro') || defaultPlan();

  function signInError() {
    const error = new Error('Sign in required');
    error.status = 401;
    return error;
  }

  function loadSession(request) {
    const sid = cookieSid(request);
    const session = sid ? sessions.get(sid) : undefined;
    return { sid, session };
  }

  function requireSession(request) {
    const { sid, session } = loadSession(request);
    if (!session) throw signInError();
    return { sid, session };
  }

  function requireOwner(request) {
    const { sid, session } = requireSession(request);
    if (!session.tenantId) {
      const error = new Error('Complete setup first');
      error.status = 400;
      throw error;
    }
    return { sid, session };
  }

  function requireAdmin(request) {
    const expected = env.ADMIN_KEY || 'local-admin';
    if (request.headers['x-admin-key'] !== expected) {
      const error = new Error('Admin authentication required');
      error.status = 401;
      throw error;
    }
  }

  function requireEncryptionKey() {
    if (googleEnabled && !env.TOKEN_ENCRYPTION_KEY) {
      throw new Error('TOKEN_ENCRYPTION_KEY is required');
    }
  }

  function packRefresh(token) {
    if (!token) return token;
    requireEncryptionKey();
    if (!env.TOKEN_ENCRYPTION_KEY) return token;
    return encryptSecret(token, env.TOKEN_ENCRYPTION_KEY);
  }

  async function refreshSessionToken(session, sheets) {
    if (!session.refreshToken || !env.TOKEN_ENCRYPTION_KEY) throw new Error('Google sign-in required');
    const refreshToken = decryptSecret(session.refreshToken, env.TOKEN_ENCRYPTION_KEY);
    const next = await oauth.refreshAccessToken({
      refreshToken,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET
    });
    session.accessToken = next.accessToken;
    if (sheets) sheets.accessToken = next.accessToken;
    if (next.refreshToken) session.refreshToken = packRefresh(next.refreshToken);
    if (session.userId) {
      const user = controlPlane.getUser(session.userId);
      if (user) {
        user.encryptedRefreshToken = session.refreshToken;
        controlPlane.saveUser(user);
      }
    }
  }

  function isMissingSpreadsheet(error) {
    return /missing spreadsheet/i.test(error?.message || '');
  }

  function wrapLedgerMethods(adapter, wrap) {
    return {
      ensureSpreadsheet: typeof adapter.ensureSpreadsheet === 'function' ? wrap('ensureSpreadsheet') : undefined,
      list: wrap('list'),
      add: wrap('add'),
      addSupplier: wrap('addSupplier'),
      update: wrap('update'),
      summary: wrap('summary'),
      supplierLedger: wrap('supplierLedger'),
      exportCSV: wrap('exportCSV')
    };
  }

  function withTokenRefresh(sheets, session) {
    return wrapLedgerMethods(sheets, (method) => async (...args) => {
      try {
        return await sheets[method](...args);
      } catch (error) {
        if (!isUnauthorized(error)) throw error;
        await refreshSessionToken(session, sheets);
        return await sheets[method](...args);
      }
    });
  }

  function withSpreadsheetRecreate(adapter, session, tenant) {
    const retry = (method) => async (...args) => {
      try {
        return await adapter[method](...args);
      } catch (error) {
        if (method === 'ensureSpreadsheet' || !isMissingSpreadsheet(error)) throw error;
        if (tenant?.setupStatus !== 'READY') throw error;
        if (typeof adapter.ensureSpreadsheet !== 'function') throw error;
        const spreadsheetId = await adapter.ensureSpreadsheet({
          accessToken: session.accessToken,
          businessName: tenant.businessName,
          spreadsheetId: tenant.spreadsheetId
        });
        tenant.spreadsheetId = spreadsheetId;
        tenant.updatedAt = new Date().toISOString();
        controlPlane.saveTenant(tenant);
        return await adapter[method](...args);
      }
    };
    return wrapLedgerMethods(adapter, retry);
  }

  function resolveLedger(session, tenant) {
    let adapter;
    if (!googleEnabled) {
      adapter = injectedLedger;
    } else {
      if (!session?.accessToken) throw new Error('Google sign-in required');
      const sheets = new SheetsLedger({
        accessToken: session.accessToken,
        spreadsheetId: tenant?.spreadsheetId
      });
      adapter = withTokenRefresh(sheets, session);
    }
    return withSpreadsheetRecreate(adapter, session, tenant);
  }

  function assertCanUseApplication(tenantId) {
    if (tenantId && !entitlements.canUseApplication(tenantId)) {
      throw new Error('Account is blocked');
    }
  }

  function ownerEmailFor(tenant) {
    const byId = controlPlane.getUser(tenant.ownerUserId);
    if (byId?.email) return byId.email;
    const match = controlPlane.users.values().find((user) => user.tenantId === tenant.id);
    return match?.email || null;
  }

  function mePayload(session) {
    const stored = session.userId ? controlPlane.getUser(session.userId) : null;
    const user = publicUser(stored) || {
      email: session.email, name: session.name, googleSubjectId: session.googleSubjectId
    };
    const tenant = session.tenantId ? controlPlane.getTenant(session.tenantId) : null;
    const featureEntitlements = tenant
      ? entitlements.getFeatureEntitlements(tenant.id)
      : { features: [], limits: {}, mode: null };
    return {
      user,
      tenant,
      entitlements: featureEntitlements,
      localMode: !googleEnabled,
      canWrite: tenant ? entitlements.canWrite(tenant.id) : false,
      spreadsheetUrl: tenant?.spreadsheetId
        ? `https://docs.google.com/spreadsheets/d/${tenant.spreadsheetId}`
        : null
    };
  }

  async function runSetup(session, businessName) {
    if (session.tenantId) {
      const existingTenant = controlPlane.getTenant(session.tenantId);
      if (existingTenant?.setupStatus === 'READY') throw new Error('Already set up');
    } else if (session.googleSubjectId) {
      const existingUser = controlPlane.findUserByGoogleSubject(session.googleSubjectId);
      if (existingUser) {
        session.userId = existingUser.id;
        session.tenantId = existingUser.tenantId;
        const existingTenant = controlPlane.getTenant(existingUser.tenantId);
        if (existingTenant?.setupStatus === 'READY') throw new Error('Already set up');
      }
    }

    if (!session.googleSubjectId) throw new Error('Google sign-in required');
    if (!session.tenantId && !businessName) throw new Error('businessName is required');

    let tenant = session.tenantId ? controlPlane.getTenant(session.tenantId) : null;
    if (!tenant) {
      const userId = randomUUID();
      const tenantId = randomUUID();
      const selectedPlan = controlPlane.plans.get('plan_pro') || defaultPlan();
      tenant = createTenant({ id: tenantId, businessName, ownerUserId: userId, plan: selectedPlan });
      const user = createUser({
        id: userId, tenantId, email: session.email, googleSubjectId: session.googleSubjectId, name: session.name
      });
      if (session.refreshToken) user.encryptedRefreshToken = session.refreshToken;
      controlPlane.saveUser(user);
      controlPlane.saveTenant(tenant);
      session.userId = userId;
      session.tenantId = tenantId;
    } else if (businessName) {
      tenant.businessName = businessName;
    }

    try {
      const adapter = resolveLedger(session, tenant);
      let spreadsheetId = tenant.spreadsheetId;
      if (typeof adapter.ensureSpreadsheet === 'function') {
        spreadsheetId = await adapter.ensureSpreadsheet({
          accessToken: session.accessToken,
          businessName: tenant.businessName,
          spreadsheetId: tenant.spreadsheetId
        });
      }
      tenant.spreadsheetId = spreadsheetId || tenant.spreadsheetId;
      tenant.setupStatus = 'READY';
      tenant.googleConnected = true;
      tenant.updatedAt = new Date().toISOString();
      controlPlane.saveTenant(tenant);
      return tenant;
    } catch (error) {
      tenant.setupStatus = 'SETUP_FAILED';
      tenant.googleConnected = false;
      tenant.updatedAt = new Date().toISOString();
      controlPlane.saveTenant(tenant);
      throw error;
    }
  }

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const { pathname } = url;
      const method = request.method;

      if (method === 'GET' && pathname === '/health') return json(response, 200, { ok: true });
      if (method === 'GET' && (pathname === '/plans' || pathname === '/api/plans')) {
        return json(response, 200, controlPlane.plans.values().filter((item) => item.active));
      }

      if (method === 'GET' && pathname === '/auth/google') {
        if (!googleEnabled) {
          return json(response, 400, { error: 'Google sign-in is not configured. Use local development mode (POST /api/tenants).' });
        }
        const location = oauth.googleAuthUrl({
          clientId: env.GOOGLE_CLIENT_ID,
          redirectUri: env.GOOGLE_REDIRECT_URI || DEFAULT_REDIRECT
        });
        response.writeHead(302, { Location: location });
        return response.end();
      }

      if (method === 'GET' && pathname === '/auth/google/callback') {
        requireEncryptionKey();
        const code = url.searchParams.get('code');
        if (!code) return json(response, 400, { error: 'Missing authorization code' });
        const tokens = await oauth.exchangeCode({
          code,
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: env.GOOGLE_REDIRECT_URI || DEFAULT_REDIRECT
        });
        const packedRefresh = packRefresh(tokens.refreshToken);
        const existing = controlPlane.findUserByGoogleSubject(tokens.googleSubjectId);
        const payload = {
          googleSubjectId: tokens.googleSubjectId,
          email: tokens.email,
          name: tokens.name,
          accessToken: tokens.accessToken,
          refreshToken: packedRefresh
        };
        if (existing) {
          existing.lastLoginAt = new Date().toISOString();
          if (packedRefresh) existing.encryptedRefreshToken = packedRefresh;
          controlPlane.saveUser(existing);
          const tenant = controlPlane.getTenant(existing.tenantId);
          if (tenant) {
            tenant.lastAccessAt = existing.lastLoginAt;
            controlPlane.saveTenant(tenant);
          }
          payload.userId = existing.id;
          payload.tenantId = existing.tenantId;
        }
        const { header } = sessions.create(payload);
        response.writeHead(302, { Location: '/', 'Set-Cookie': header });
        return response.end();
      }

      if (method === 'POST' && pathname === '/api/logout') {
        const { sid } = loadSession(request);
        if (sid) sessions.destroy(sid);
        return json(response, 200, { ok: true }, {
          'set-cookie': 'karigar.sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
        });
      }

      if (method === 'GET' && pathname === '/api/me') {
        const { session } = requireSession(request);
        assertCanUseApplication(session.tenantId);
        return json(response, 200, mePayload(session));
      }

      if (method === 'POST' && pathname === '/api/setup') {
        const { session } = requireSession(request);
        const input = await jsonBody(request);
        const tenant = await runSetup(session, input.businessName);
        return json(response, 201, tenant);
      }

      if (pathname.startsWith('/api/me/')) {
        const { session } = requireOwner(request);
        const tenantId = session.tenantId;
        const tenant = controlPlane.getTenant(tenantId);
        if (!tenant) throw new Error('Tenant not found');
        assertCanUseApplication(tenantId);
        const ledger = resolveLedger(session, tenant);
        tenant.lastAccessAt = new Date().toISOString();
        controlPlane.saveTenant(tenant);

        if (method === 'GET' && pathname === '/api/me/suppliers') {
          return json(response, 200, await ledger.list(tenantId, 'suppliers'));
        }
        if (method === 'POST' && pathname === '/api/me/suppliers') {
          assertCanPerformPaidWrite(entitlements, tenantId, 'supplier_management');
          const input = await jsonBody(request);
          if (!input.name) return json(response, 400, { error: 'Supplier name is required' });
          return json(response, 201, await ledger.addSupplier(tenantId, {
            name: input.name,
            phone: input.phone || '',
            notes: input.notes || '',
            openingMoney: input.openingMoney || 0,
            openingMetal: input.openingMetal || []
          }));
        }

        const supplierMatch = pathname.match(/^\/api\/me\/suppliers\/([^/]+)$/);
        if (supplierMatch && method === 'GET') {
          return json(response, 200, await ledger.supplierLedger(tenantId, supplierMatch[1]));
        }
        if (supplierMatch && method === 'PATCH') {
          assertCanPerformPaidWrite(entitlements, tenantId, 'supplier_management');
          const input = await jsonBody(request);
          return json(response, 200, await ledger.update(tenantId, 'suppliers', supplierMatch[1], input));
        }

        if (method === 'GET' && pathname === '/api/me/money') {
          return json(response, 200, await ledger.list(tenantId, 'money'));
        }
        if (method === 'POST' && pathname === '/api/me/money') {
          assertCanPerformPaidWrite(entitlements, tenantId, 'transaction_entry');
          const input = await jsonBody(request);
          if (!input.supplierId || input.amountInr == null || !MONEY_TYPES.has(input.type)) {
            return json(response, 400, { error: 'supplierId, amountInr and a valid type are required' });
          }
          return json(response, 201, await ledger.add(tenantId, 'money', {
            supplierId: input.supplierId,
            type: input.type,
            amountInr: Number(input.amountInr),
            date: input.date || new Date().toISOString().slice(0, 10),
            note: input.note || ''
          }));
        }

        if (method === 'GET' && pathname === '/api/me/metal') {
          return json(response, 200, await ledger.list(tenantId, 'metal'));
        }
        if (method === 'POST' && pathname === '/api/me/metal') {
          assertCanPerformPaidWrite(entitlements, tenantId, 'metal_ledger');
          const input = await jsonBody(request);
          if (!input.supplierId || !METAL_DIRECTIONS.has(input.direction) || !input.metalType || input.weightGrams == null) {
            return json(response, 400, { error: 'supplierId, direction, metalType, purity and weightGrams are required' });
          }
          return json(response, 201, await ledger.add(tenantId, 'metal', {
            supplierId: input.supplierId,
            direction: input.direction,
            metalType: input.metalType,
            purity: input.purity,
            weightGrams: Number(input.weightGrams),
            date: input.date || new Date().toISOString().slice(0, 10),
            note: input.note || ''
          }));
        }

        if (method === 'GET' && pathname === '/api/me/settlements') {
          return json(response, 200, await ledger.list(tenantId, 'settlements'));
        }
        if (method === 'POST' && pathname === '/api/me/settlements') {
          assertCanPerformPaidWrite(entitlements, tenantId, 'settlements');
          const input = await jsonBody(request);
          if (!input.supplierId) return json(response, 400, { error: 'supplierId is required' });
          return json(response, 201, await ledger.add(tenantId, 'settlements', {
            supplierId: input.supplierId,
            moneyAmountInr: Number(input.moneyAmountInr || 0),
            metalType: input.metalType || '',
            purity: input.purity,
            metalGrams: Number(input.metalGrams || 0),
            date: input.date || new Date().toISOString().slice(0, 10),
            note: input.note || ''
          }));
        }

        if (method === 'GET' && pathname === '/api/me/summary') {
          return json(response, 200, await ledger.summary(tenantId));
        }

        if (method === 'GET' && pathname === '/api/me/export') {
          assertCanPerformPaidWrite(entitlements, tenantId, 'exports');
          const kind = url.searchParams.get('kind');
          if (!EXPORT_KINDS.has(kind)) return json(response, 400, { error: 'kind must be suppliers, money, metal, or settlements' });
          const csv = await ledger.exportCSV(tenantId, kind);
          response.writeHead(200, {
            'content-type': 'text/csv',
            'content-disposition': `attachment; filename=${kind}.csv`
          });
          return response.end(csv);
        }
      }

      if (method === 'POST' && pathname === '/api/tenants') {
        if (googleEnabled) return json(response, 400, { error: 'Google sign-in is required' });
        const input = await jsonBody(request);
        if (!input.businessName || !input.ownerUserId) {
          return json(response, 400, { error: 'businessName and ownerUserId are required' });
        }
        const selectedPlan = controlPlane.plans.get(input.planId || plan.id) || plan;
        const userId = randomUUID();
        const tenantId = randomUUID();
        const tenant = createTenant({
          id: tenantId, businessName: input.businessName, ownerUserId: userId, plan: selectedPlan
        });
        tenant.setupStatus = 'READY';
        const user = createUser({
          id: userId,
          tenantId,
          email: input.ownerUserId,
          googleSubjectId: `local:${input.ownerUserId}`,
          name: input.businessName
        });
        controlPlane.saveUser(user);
        controlPlane.saveTenant(tenant);
        const { header } = sessions.create({ userId, tenantId });
        return json(response, 201, tenant, { 'set-cookie': header });
      }

      if (method === 'GET' && pathname === '/api/admin/overview') {
        requireAdmin(request);
        const tenants = controlPlane.tenants.values();
        const paid = tenants.filter((item) => ['ACTIVE', 'CANCEL_AT_PERIOD_END'].includes(item.subscriptionStatus));
        return json(response, 200, {
          totalTenants: tenants.length,
          activeSubscriptions: paid.length,
          trials: tenants.filter((item) => item.subscriptionStatus === 'TRIALING').length,
          pastDue: tenants.filter((item) => ['PAST_DUE', 'PAYMENT_FAILED'].includes(item.subscriptionStatus)).length,
          mrr: paid.length * (plan.monthlyPrice || 0),
          arr: paid.length * (plan.monthlyPrice || 0) * 12
        });
      }

      if (method === 'GET' && pathname === '/api/admin/tenants') {
        requireAdmin(request);
        return json(response, 200, controlPlane.tenants.values().map((tenant) => ({
          id: tenant.id,
          businessName: tenant.businessName,
          ownerUserId: tenant.ownerUserId,
          subscriptionStatus: tenant.subscriptionStatus,
          planId: tenant.planId,
          trialEndsAt: tenant.trialEndsAt,
          currentPeriodEnd: tenant.currentPeriodEnd,
          createdAt: tenant.createdAt,
          ownerEmail: ownerEmailFor(tenant),
          setupStatus: tenant.setupStatus
        })));
      }

      const adminTenant = pathname.match(/^\/api\/admin\/tenants\/([^/]+)\/(trial|comp|block|reactivate)$/);
      if (adminTenant && method === 'POST') {
        requireAdmin(request);
        const tenant = controlPlane.getTenant(adminTenant[1]);
        if (!tenant) return json(response, 404, { error: 'Tenant not found' });
        const action = adminTenant[2];
        const input = await jsonBody(request);
        const next = { ...tenant, updatedAt: new Date().toISOString() };
        if (action === 'trial') next.trialEndsAt = new Date(Date.now() + Number(input.days || 14) * 86400000).toISOString();
        if (action === 'comp') {
          next.subscriptionStatus = 'ADMIN_COMP';
          next.compReason = input.reason || 'Complimentary access';
        }
        if (action === 'block') {
          next.subscriptionStatus = 'ADMIN_BLOCKED';
          next.status = 'BLOCKED';
        }
        if (action === 'reactivate') {
          next.subscriptionStatus = 'TRIALING';
          next.status = 'ACTIVE';
        }
        controlPlane.saveTenant(next);
        return json(response, 200, next);
      }

      if (method === 'POST' && pathname === '/billing/webhook') {
        const result = billing.handle(await readBody(request), request.headers['x-webhook-signature']);
        return json(response, 200, result);
      }

      if (method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/auth/') && pathname !== '/billing/webhook') {
        const file = await staticFile(pathname);
        response.writeHead(200, { 'content-type': file.type });
        return response.end(file.content);
      }

      return json(response, 404, { error: 'Not found' });
    } catch (error) {
      const status = error.status
        || (error.message === 'Sign in required' || error.message === 'Admin authentication required' ? 401 : null)
        || (/not found/i.test(error.message || '') ? 404 : 400);
      const body = { error: error.message };
      if (status === 401 && error.message === 'Sign in required') body.localMode = !googleEnabled;
      return json(response, status, body);
    }
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dataDirectory = join(fileURLToPath(new URL('../data', import.meta.url)));
  mkdirSync(dataDirectory, { recursive: true });
  const controlPlane = new ControlPlane({
    plans: new MetadataStore(join(dataDirectory, 'plans.json')),
    tenants: new MetadataStore(join(dataDirectory, 'tenants.json')),
    events: new MetadataStore(join(dataDirectory, 'billing-events.json')),
    users: new MetadataStore(join(dataDirectory, 'users.json'))
  });
  const ledger = new LedgerStore(join(dataDirectory, 'ledger.json'));
  const sessions = new SessionStore();
  const entitlements = new SubscriptionEntitlementService({
    tenantStore: controlPlane.tenants, planStore: controlPlane.plans
  });
  const billing = new BillingWebhookService({
    controlPlane, provider: new RazorpayWebhookProvider(process.env.RAZORPAY_WEBHOOK_SECRET)
  });
  const port = Number(process.env.PORT || 3000);
  const app = createApp({ controlPlane, ledger, sessions, entitlements, billing, env: process.env });
  app.listen(port, () => console.log(`Karigar listening on port ${port}`));
}
