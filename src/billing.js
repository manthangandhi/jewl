import { createHmac, timingSafeEqual } from 'node:crypto';

export class BillingProvider {
  createCustomer() { throw new Error('Billing provider is not configured'); }
  createSubscription() { throw new Error('Billing provider is not configured'); }
  cancelSubscription() { throw new Error('Billing provider is not configured'); }
  resumeSubscription() { throw new Error('Billing provider is not configured'); }
  getSubscription() { throw new Error('Billing provider is not configured'); }
  createCheckout() { throw new Error('Billing provider is not configured'); }
  handleWebhook() { throw new Error('Billing provider is not configured'); }
  verifyWebhook() { throw new Error('Billing provider is not configured'); }
  getInvoices() { throw new Error('Billing provider is not configured'); }
}

export class RazorpayWebhookProvider extends BillingProvider {
  constructor(secret) { super(); this.secret = secret; }
  verifyWebhook(rawBody, signature) {
    if (!this.secret) throw new Error('Razorpay webhook secret is not configured');
    if (!signature) throw new Error('Missing webhook signature');
    const expected = createHmac('sha256', this.secret).update(rawBody).digest('hex');
    const actual = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) throw new Error('Invalid webhook signature');
    const payload = JSON.parse(rawBody);
    return { id: payload.id, tenantId: payload.tenantId, status: payload.status,
      customerId: payload.customerId, subscriptionId: payload.subscriptionId,
      currentPeriodStart: payload.currentPeriodStart, currentPeriodEnd: payload.currentPeriodEnd,
      cancelAtPeriodEnd: payload.cancelAtPeriodEnd };
  }
}

export class BillingWebhookService {
  constructor({ controlPlane, provider }) { this.controlPlane = controlPlane; this.provider = provider; }

  handle(rawBody, signature) {
    const event = this.provider.verifyWebhook(rawBody, signature);
    if (!event?.id || !event.tenantId) throw new Error('Invalid billing event');
    if (this.controlPlane.events.get(event.id)) return { duplicate: true };
    const tenant = this.controlPlane.getTenant(event.tenantId);
    if (!tenant) throw new Error('Unknown tenant');
    const next = { ...tenant, updatedAt: new Date().toISOString() };
    if (event.status) next.subscriptionStatus = event.status;
    if (event.customerId) next.billingCustomerId = event.customerId;
    if (event.subscriptionId) next.billingSubscriptionId = event.subscriptionId;
    if (event.currentPeriodStart) next.currentPeriodStart = event.currentPeriodStart;
    if (event.currentPeriodEnd) next.currentPeriodEnd = event.currentPeriodEnd;
    if (event.cancelAtPeriodEnd !== undefined) next.cancelAtPeriodEnd = event.cancelAtPeriodEnd;
    this.controlPlane.events.set(event.id, { id: event.id, receivedAt: next.updatedAt });
    this.controlPlane.saveTenant(next);
    return { duplicate: false, tenant: next };
  }
}
