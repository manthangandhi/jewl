import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const FORBIDDEN_KEYS = new Set([
  'supplierName', 'suppliers', 'goldBalance', 'silverBalance', 'metalBalances', 'purchaseAmount',
  'transactions', 'supplierTransactions', 'supplierPayments', 'supplierInvoices', 'documents', 'ledger',
  'amountInr', 'weightGrams', 'purity', 'metalType', 'metalGrams', 'openingBalance', 'phone', 'supplierId'
]);

function assertPlatformMetadata(value, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`Customer business data cannot be stored in control plane: ${path}${key}`);
    assertPlatformMetadata(child, `${path}${key}.`);
  }
}

export class MetadataStore {
  constructor(filePath = null) {
    this.filePath = filePath; this.records = new Map();
    if (filePath && existsSync(filePath)) for (const value of JSON.parse(readFileSync(filePath, 'utf8'))) this.records.set(value.id, value);
  }
  persist() { if (this.filePath) writeFileSync(this.filePath, JSON.stringify([...this.records.values()], null, 2)); }
  set(id, value) { assertPlatformMetadata(value); this.records.set(id, structuredClone(value)); this.persist(); return this.get(id); }
  get(id) { const value = this.records.get(id); return value ? structuredClone(value) : undefined; }
  values() { return [...this.records.values()].map((value) => structuredClone(value)); }
  delete(id) { this.records.delete(id); this.persist(); }
}

export class ControlPlane {
  constructor({ plans = new MetadataStore(), tenants = new MetadataStore(), events = new MetadataStore(), users = new MetadataStore() } = {}) {
    this.plans = plans; this.tenants = tenants; this.events = events; this.users = users;
  }
  savePlan(plan) { return this.plans.set(plan.id, plan); }
  saveTenant(tenant) { return this.tenants.set(tenant.id, tenant); }
  getTenant(id) { return this.tenants.get(id); }
  deleteTenant(id) { this.tenants.delete(id); }
  saveUser(user) { return this.users.set(user.id, user); }
  getUser(id) { return this.users.get(id); }
  findUserByGoogleSubject(googleSubjectId) {
    return this.users.values().find((user) => user.googleSubjectId === googleSubjectId);
  }
}
