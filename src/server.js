import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ControlPlane, MetadataStore } from './control-plane.js';
import { defaultPlan, createTenant, SubscriptionEntitlementService } from './domain.js';
import { BillingWebhookService, RazorpayWebhookProvider } from './billing.js';
import { LedgerStore } from './ledger-store.js';

const dataDirectory = join(fileURLToPath(new URL('../data', import.meta.url)));
mkdirSync(dataDirectory, { recursive: true });
const controlPlane = new ControlPlane({ plans: new MetadataStore(join(dataDirectory, 'plans.json')), tenants: new MetadataStore(join(dataDirectory, 'tenants.json')), events: new MetadataStore(join(dataDirectory, 'billing-events.json')) });
const ledger = new LedgerStore(join(dataDirectory, 'ledger.json'));
const plan = defaultPlan();
controlPlane.savePlan(plan);

const billing = new BillingWebhookService({ controlPlane, provider: new RazorpayWebhookProvider(process.env.RAZORPAY_WEBHOOK_SECRET) });
const entitlements = new SubscriptionEntitlementService({ tenantStore: controlPlane.tenants, planStore: controlPlane.plans });

function json(response, status, body) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); }
async function body(request) { let value = ''; for await (const chunk of request) value += chunk; return value; }
function tenantIdFrom(url) { const match = url.pathname.match(/^\/api\/tenants\/([^/]+)(?:\/|$)/); return match?.[1]; }
function requireTenant(tenantId) { if (!tenantId || !controlPlane.getTenant(tenantId)) throw new Error('Tenant not found'); return tenantId; }
function requireWrite(tenantId) { requireTenant(tenantId); if (!entitlements.canWrite(tenantId)) throw new Error('Your workspace is read-only. Subscribe to continue writing.'); }
function requireAdmin(request) { const expected = process.env.ADMIN_KEY || 'local-admin'; if (request.headers['x-admin-key'] !== expected) throw new Error('Admin authentication required'); }
async function staticFile(pathname) {
  const pages = { '/pricing': '/pricing.html', '/data-ownership': '/data-ownership.html', '/admin': '/admin.html' };
  const safePath = pages[pathname] || (pathname === '/' ? '/index.html' : pathname);
  const file = join(fileURLToPath(new URL('../public', import.meta.url)), safePath);
  const content = await readFile(file);
  const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
  return { content, type: types[extname(file)] || 'application/octet-stream' };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true });
    if (request.method === 'GET' && (url.pathname === '/plans' || url.pathname === '/api/plans')) return json(response, 200, controlPlane.plans.values().filter((item) => item.active));
    if (request.method === 'POST' && (url.pathname === '/tenants' || url.pathname === '/api/tenants')) {
      const input = JSON.parse(await body(request));
      if (!input.businessName || !input.ownerUserId) return json(response, 400, { error: 'businessName and ownerUserId are required' });
      const selectedPlan = controlPlane.plans.get(input.planId || plan.id) || plan;
      const tenant = createTenant({ id: randomUUID(), businessName: input.businessName, ownerUserId: input.ownerUserId, plan: selectedPlan });
      controlPlane.saveTenant(tenant); return json(response, 201, tenant);
    }
    const tenantId = tenantIdFrom(url);
    if (tenantId && request.method === 'GET' && url.pathname.endsWith('/entitlements')) {
      requireTenant(tenantId);
      return json(response, 200, { tenantId, ...entitlements.getFeatureEntitlements(tenantId), canWrite: entitlements.canWrite(tenantId) });
    }
    if (tenantId && request.method === 'GET' && url.pathname.endsWith('/summary')) return json(response, 200, ledger.summary(requireTenant(tenantId)));
    if (tenantId && request.method === 'GET' && url.pathname.endsWith('/suppliers')) return json(response, 200, ledger.list(requireTenant(tenantId), 'suppliers'));
    if (tenantId && request.method === 'GET' && url.pathname.endsWith('/transactions')) return json(response, 200, ledger.list(requireTenant(tenantId), 'transactions'));
    if (tenantId && request.method === 'GET' && url.pathname.endsWith('/export')) {
      const kind = url.searchParams.get('kind') === 'suppliers' ? 'suppliers' : 'transactions';
      requireTenant(tenantId); response.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': `attachment; filename=${kind}.csv` }); return response.end(ledger.exportCSV(tenantId, kind));
    }
    if (tenantId && request.method === 'POST' && url.pathname.endsWith('/suppliers')) {
      requireWrite(tenantId); const input = JSON.parse(await body(request));
      if (!input.name) return json(response, 400, { error: 'Supplier name is required' });
      return json(response, 201, ledger.add(tenantId, 'suppliers', { name: input.name, phone: input.phone || '', openingBalance: Number(input.openingBalance || 0) }));
    }
    const supplierMatch = tenantId && url.pathname.match(/^\/api\/tenants\/[^/]+\/suppliers\/([^/]+)$/);
    if (supplierMatch && request.method === 'PATCH') { requireWrite(tenantId); return json(response, 200, ledger.update(tenantId, 'suppliers', supplierMatch[1], JSON.parse(await body(request)))); }
    if (tenantId && request.method === 'POST' && url.pathname.endsWith('/transactions')) {
      requireWrite(tenantId); const input = JSON.parse(await body(request));
      if (!input.supplierName || !input.amount || !['PURCHASE','PAYMENT'].includes(input.type)) return json(response, 400, { error: 'supplierName, amount and a valid type are required' });
      return json(response, 201, ledger.add(tenantId, 'transactions', { supplierName: input.supplierName, type: input.type, amount: Number(input.amount), metalType: input.metalType || '', quantity: Number(input.quantity || 0), date: input.date || new Date().toISOString().slice(0,10) }));
    }
    if (tenantId && request.method === 'GET' && url.pathname.endsWith('/settlements')) return json(response, 200, ledger.list(requireTenant(tenantId), 'settlements'));
    if (tenantId && request.method === 'POST' && url.pathname.endsWith('/settlements')) { requireWrite(tenantId); const input = JSON.parse(await body(request)); if (!input.supplierName || !input.amount) return json(response, 400, { error: 'supplierName and amount are required' }); return json(response, 201, ledger.add(tenantId, 'settlements', { supplierName: input.supplierName, amount: Number(input.amount), note: input.note || '' })); }
    if (tenantId && request.method === 'DELETE' && url.pathname.endsWith('/account')) {
      requireTenant(tenantId); const input = JSON.parse(await body(request) || '{}'); controlPlane.deleteTenant(tenantId); if (input.deleteDriveData === true) ledger.deleteTenantData(tenantId); return json(response, 200, { deleted: true, driveDataDeleted: input.deleteDriveData === true });
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/overview') {
      requireAdmin(request); const tenants = controlPlane.tenants.values(); const paid = tenants.filter((item) => ['ACTIVE','CANCEL_AT_PERIOD_END'].includes(item.subscriptionStatus)); return json(response, 200, { totalTenants: tenants.length, activeSubscriptions: paid.length, trials: tenants.filter((item) => item.subscriptionStatus === 'TRIALING').length, pastDue: tenants.filter((item) => ['PAST_DUE','PAYMENT_FAILED'].includes(item.subscriptionStatus)).length, mrr: paid.length * (plan.monthlyPrice || 0), arr: paid.length * (plan.monthlyPrice || 0) * 12 });
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/tenants') { requireAdmin(request); return json(response, 200, controlPlane.tenants.values().map(({ id, businessName, ownerUserId, subscriptionStatus, planId, trialEndsAt, currentPeriodEnd, createdAt }) => ({ id, businessName, ownerUserId, subscriptionStatus, planId, trialEndsAt, currentPeriodEnd, createdAt }))); }
    const adminTenant = url.pathname.match(/^\/api\/admin\/tenants\/([^/]+)\/(trial|comp|block|reactivate)$/);
    if (adminTenant && request.method === 'POST') { requireAdmin(request); const tenant = controlPlane.getTenant(adminTenant[1]); if (!tenant) return json(response, 404, { error: 'Tenant not found' }); const action = adminTenant[2]; const input = JSON.parse(await body(request) || '{}'); const next = { ...tenant, updatedAt: new Date().toISOString() }; if (action === 'trial') next.trialEndsAt = new Date(Date.now() + Number(input.days || 14) * 86400000).toISOString(); if (action === 'comp') { next.subscriptionStatus = 'ADMIN_COMP'; next.compReason = input.reason || 'Complimentary access'; } if (action === 'block') { next.subscriptionStatus = 'ADMIN_BLOCKED'; next.status = 'BLOCKED'; } if (action === 'reactivate') { next.subscriptionStatus = 'TRIALING'; next.status = 'ACTIVE'; } controlPlane.saveTenant(next); return json(response, 200, next); }
    if (request.method === 'POST' && url.pathname === '/billing/webhook') {
      const result = billing.handle(await body(request), request.headers['x-webhook-signature']);
      return json(response, 200, result);
    }
    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const file = await staticFile(url.pathname); response.writeHead(200, { 'content-type': file.type }); return response.end(file.content);
    }
    return json(response, 404, { error: 'Not found' });
  } catch (error) { return json(response, 400, { error: error.message }); }
});

const port = Number(process.env.PORT || 3000);
if (process.env.NODE_ENV !== 'test') server.listen(port, () => console.log(`Jewellery ERP SaaS API listening on port ${port}`));
export { server, controlPlane, entitlements };
