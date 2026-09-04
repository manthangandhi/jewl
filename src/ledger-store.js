import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Development adapter for customer-owned Google Sheets/Drive data.
// It is intentionally separate from ControlPlane and must be replaced in production.
export class LedgerStore {
  constructor(filePath = null) { this.filePath = filePath; this.data = new Map(); if (filePath && existsSync(filePath)) this.data = new Map(Object.entries(JSON.parse(readFileSync(filePath, 'utf8')))); }
  persist() { if (this.filePath) writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.data), null, 2)); }
  bucket(tenantId) {
    if (!this.data.has(tenantId)) this.data.set(tenantId, { suppliers: [], transactions: [], settlements: [] });
    return this.data.get(tenantId);
  }
  list(tenantId, kind) { return structuredClone(this.bucket(tenantId)[kind]); }
  add(tenantId, kind, value) {
    const item = { id: randomUUID(), createdAt: new Date().toISOString(), ...value };
    this.bucket(tenantId)[kind].unshift(item);
    this.persist();
    return structuredClone(item);
  }
  update(tenantId, kind, id, value) {
    const items = this.bucket(tenantId)[kind];
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`${kind} item not found`);
    items[index] = { ...items[index], ...value, updatedAt: new Date().toISOString() };
    this.persist();
    return structuredClone(items[index]);
  }
  exportCSV(tenantId, kind) {
    const items = this.list(tenantId, kind);
    if (!items.length) return '';
    const columns = [...new Set(items.flatMap((item) => Object.keys(item)))];
    const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return [columns.join(','), ...items.map((item) => columns.map((column) => quote(item[column])).join(','))].join('\n');
  }
  deleteTenantData(tenantId) { this.data.delete(tenantId); this.persist(); }
  summary(tenantId) {
    const transactions = this.bucket(tenantId).transactions;
    const totalPurchases = transactions.filter((item) => item.type === 'PURCHASE').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalPayments = transactions.filter((item) => item.type === 'PAYMENT').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const metalTransactions = transactions.filter((item) => item.metalType).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    return { supplierCount: this.bucket(tenantId).suppliers.length, transactionCount: transactions.length, totalPurchases, totalPayments, metalTransactions, outstanding: totalPurchases - totalPayments };
  }
}
