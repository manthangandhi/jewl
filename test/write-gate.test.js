import test from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionEntitlementService, createTenant, defaultPlan, SubscriptionStatus } from '../src/domain.js';
import { ControlPlane } from '../src/control-plane.js';
import { assertCanPerformPaidWrite } from '../src/write-gate.js';

function make(status = SubscriptionStatus.TRIALING) {
  const cp = new ControlPlane();
  cp.savePlan(defaultPlan());
  const tenant = createTenant({ id: 't1', businessName: 'Demo', ownerUserId: 'u1' });
  tenant.subscriptionStatus = status;
  if (status === SubscriptionStatus.EXPIRED) tenant.trialEndsAt = '2000-01-01T00:00:00.000Z';
  cp.saveTenant(tenant);
  const entitlements = new SubscriptionEntitlementService({ tenantStore: cp.tenants, planStore: cp.plans });
  return { entitlements };
}

test('full access can write supplier_management', () => {
  const { entitlements } = make();
  assert.doesNotThrow(() => assertCanPerformPaidWrite(entitlements, 't1', 'supplier_management'));
});

test('expired tenant cannot write but exports are allowed', () => {
  const now = new Date('2026-02-01T00:00:00Z');
  const cp = new ControlPlane();
  cp.savePlan(defaultPlan());
  const tenant = createTenant({ id: 't1', businessName: 'Demo', ownerUserId: 'u1', now: new Date('2026-01-01T00:00:00Z') });
  cp.saveTenant(tenant);
  const entitlements = new SubscriptionEntitlementService({
    tenantStore: cp.tenants, planStore: cp.plans, clock: () => now
  });
  assert.throws(() => assertCanPerformPaidWrite(entitlements, 't1', 'transaction_entry'), /read-only/i);
  assert.doesNotThrow(() => assertCanPerformPaidWrite(entitlements, 't1', 'exports'));
});
