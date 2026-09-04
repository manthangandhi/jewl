export const SubscriptionStatus = Object.freeze({
  TRIALING: 'TRIALING', ACTIVE: 'ACTIVE', PAST_DUE: 'PAST_DUE',
  PAYMENT_FAILED: 'PAYMENT_FAILED', CANCEL_AT_PERIOD_END: 'CANCEL_AT_PERIOD_END',
  CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED', SUSPENDED: 'SUSPENDED',
  ADMIN_COMP: 'ADMIN_COMP', ADMIN_BLOCKED: 'ADMIN_BLOCKED'
});

export const AccountMode = Object.freeze({ FULL_ACCESS: 'FULL_ACCESS', READ_ONLY: 'READ_ONLY', BLOCKED: 'BLOCKED' });

export const defaultPlan = () => ({
  id: 'plan_pro', code: 'PRO', name: 'Pro', description: 'Full jewellery business operations',
  monthlyPrice: 1999, annualPrice: 19999, currency: 'INR', trialDays: 14, active: true,
  features: ['SUPPLIERS', 'TRANSACTIONS', 'DASHBOARD', 'REPORTS', 'SETTLEMENTS', 'RECONCILIATION', 'AUDIT_LOG', 'EXPORTS'],
  limits: { users: 5, branches: 1 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
});

export function createTenant({ id, businessName, ownerUserId, plan = defaultPlan(), now = new Date() }) {
  const createdAt = now.toISOString();
  const trialEndsAt = new Date(now.getTime() + plan.trialDays * 86400000).toISOString();
  return { id, businessName, ownerUserId, status: 'ACTIVE', planId: plan.id,
    trialStartedAt: createdAt, trialEndsAt, subscriptionStatus: SubscriptionStatus.TRIALING,
    billingCustomerId: null, billingSubscriptionId: null, currentPeriodStart: null, currentPeriodEnd: null,
    cancelAtPeriodEnd: false, gracePeriodEndsAt: null, googleConnected: false, createdAt, updatedAt: createdAt, lastAccessAt: null };
}

export class SubscriptionEntitlementService {
  constructor({ tenantStore, planStore, clock = () => new Date() }) {
    this.tenantStore = tenantStore; this.planStore = planStore; this.clock = clock;
  }

  getTenantSubscription(tenantId) { return this.tenantStore.get(tenantId); }
  isTrialActive(tenant) { return tenant?.subscriptionStatus === SubscriptionStatus.TRIALING && new Date(tenant.trialEndsAt) > this.clock(); }
  isSubscriptionActive(tenant) {
    if ([SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCEL_AT_PERIOD_END, SubscriptionStatus.ADMIN_COMP].includes(tenant?.subscriptionStatus)) return true;
    return [SubscriptionStatus.PAST_DUE, SubscriptionStatus.PAYMENT_FAILED].includes(tenant?.subscriptionStatus) && tenant.gracePeriodEndsAt && new Date(tenant.gracePeriodEndsAt) > this.clock();
  }

  getAccountMode(tenantId) {
    const tenant = this.getTenantSubscription(tenantId);
    if (!tenant || tenant.status === 'BLOCKED' || tenant.subscriptionStatus === SubscriptionStatus.ADMIN_BLOCKED) return AccountMode.BLOCKED;
    if (this.isTrialActive(tenant) || this.isSubscriptionActive(tenant)) return AccountMode.FULL_ACCESS;
    return AccountMode.READ_ONLY;
  }

  canUseApplication(tenantId) { return this.getAccountMode(tenantId) !== AccountMode.BLOCKED; }
  canWrite(tenantId) { return this.getAccountMode(tenantId) === AccountMode.FULL_ACCESS; }

  getFeatureEntitlements(tenantId) {
    const tenant = this.getTenantSubscription(tenantId);
    const plan = tenant && this.planStore.get(tenant.planId);
    return { features: plan?.features ?? [], limits: plan?.limits ?? {}, mode: this.getAccountMode(tenantId) };
  }

  getPlanLimits(tenantId) { return this.getFeatureEntitlements(tenantId).limits; }
}
