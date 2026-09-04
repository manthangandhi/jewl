import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountMode, SubscriptionEntitlementService, SubscriptionStatus, createTenant, defaultPlan } from '../src/domain.js';
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
