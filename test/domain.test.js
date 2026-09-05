import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountMode, SubscriptionEntitlementService, SubscriptionStatus, createTenant, createUser, defaultPlan } from '../src/domain.js';
import { ControlPlane } from '../src/control-plane.js';
import { BillingWebhookService } from '../src/billing.js';
import { RazorpayWebhookProvider } from '../src/billing.js';
import { createHmac } from 'node:crypto';

function fixture(now = new Date('2026-01-01T00:00:00Z')) {
  const cp = new ControlPlane(); cp.savePlan(defaultPlan());
  const tenant = createTenant({ id: 't1', businessName: 'Demo Jewellers', ownerUserId: 'u1', now }); cp.saveTenant(tenant);
  return { cp, tenant, service: new SubscriptionEntitlementService({ tenantStore: cp.tenants, planStore: cp.plans, clock: () => now }) };
}

test('new tenants receive a configurable trial and full access', () => {
  const { tenant, service } = fixture();
  assert.equal(tenant.trialEndsAt, '2026-01-15T00:00:00.000Z');
  assert.equal(service.getAccountMode('t1'), AccountMode.FULL_ACCESS);
  assert.equal(service.canWrite('t1'), true);
});

test('expired accounts remain readable but cannot write', () => {
  const now = new Date('2026-02-01T00:00:00Z');
  const { cp, service } = fixture(new Date('2026-01-01T00:00:00Z'));
  cp.saveTenant({ ...cp.getTenant('t1'), trialEndsAt: '2026-01-15T00:00:00.000Z' });
  const expired = new SubscriptionEntitlementService({ tenantStore: cp.tenants, planStore: cp.plans, clock: () => now });
  assert.equal(expired.getAccountMode('t1'), AccountMode.READ_ONLY);
  assert.equal(expired.canWrite('t1'), false);
  assert.equal(service.getPlanLimits('t1').users, 5);
});

test('control plane rejects customer ledger data', () => {
  const cp = new ControlPlane();
  assert.throws(() => cp.tenants.set('t1', { id: 't1', suppliers: [] }), /cannot be stored/);
});

test('billing webhooks are idempotent', () => {
  const { cp } = fixture();
  const service = new BillingWebhookService({ controlPlane: cp, provider: { verifyWebhook: (body) => JSON.parse(body) } });
  const event = JSON.stringify({ id: 'evt1', tenantId: 't1', status: SubscriptionStatus.ACTIVE, subscriptionId: 'sub1' });
  assert.equal(service.handle(event, 'signature').duplicate, false);
  assert.equal(service.handle(event, 'signature').duplicate, true);
  assert.equal(cp.getTenant('t1').subscriptionStatus, SubscriptionStatus.ACTIVE);
});

test('Razorpay webhook signatures are verified', () => {
  const provider = new RazorpayWebhookProvider('secret');
  const body = JSON.stringify({ id: 'evt1', tenantId: 't1', status: SubscriptionStatus.ACTIVE });
  const signature = createHmac('sha256', 'secret').update(body).digest('hex');
  assert.equal(provider.verifyWebhook(body, signature).id, 'evt1');
  assert.throws(() => provider.verifyWebhook(body, 'bad'), /Invalid webhook signature/);
});

test('createUser is an owner bound to a tenant', () => {
  const user = createUser({
    id: 'u1', tenantId: 't1', email: 'a@b.com', googleSubjectId: 'sub1', name: 'A', now: new Date('2026-01-01')
  });
  assert.equal(user.role, 'OWNER');
  assert.equal(user.googleSubjectId, 'sub1');
  assert.equal(user.status, 'ACTIVE');
});

test('new tenants start pending Google ledger setup', () => {
  const { tenant } = fixture();
  assert.equal(tenant.setupStatus, 'PENDING');
  assert.equal(tenant.spreadsheetId, null);
});

test('default plan uses feature keys not display names', () => {
  const features = defaultPlan().features;
  assert.ok(features.includes('supplier_management'));
  assert.ok(features.includes('transaction_entry'));
  assert.ok(features.includes('metal_ledger'));
  assert.ok(features.includes('settlements'));
  assert.ok(features.includes('exports'));
  assert.ok(!features.includes('SUPPLIERS'));
});

test('ADMIN_COMP has full write access', () => {
  const { cp, service } = fixture();
  cp.saveTenant({ ...cp.getTenant('t1'), subscriptionStatus: SubscriptionStatus.ADMIN_COMP });
  assert.equal(service.getAccountMode('t1'), AccountMode.FULL_ACCESS);
});

test('ADMIN_BLOCKED cannot use the app', () => {
  const { cp, service } = fixture();
  cp.saveTenant({ ...cp.getTenant('t1'), subscriptionStatus: SubscriptionStatus.ADMIN_BLOCKED, status: 'BLOCKED' });
  assert.equal(service.getAccountMode('t1'), AccountMode.BLOCKED);
  assert.equal(service.canUseApplication('t1'), false);
});
