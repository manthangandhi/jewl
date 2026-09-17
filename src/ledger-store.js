import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { payableInr, metalByPurity, assertPurity, summarizeLedger } from './ledger-math.js';

const LEDGER_KINDS = ['suppliers', 'money', 'metal', 'settlements'];
const SUPPLIER_UPDATE_FIELDS = ['name', 'phone', 'notes', 'status'];

// Development adapter for customer-owned Google Sheets/Drive data.
// It is intentionally separate from ControlPlane and must be replaced in production.
export class LedgerStore {
  constructor(filePath = null) {
    this.filePath = filePath;
    this.data = new Map();
    if (filePath && existsSync(filePath)) this.data = new Map(Object.entries(JSON.parse(readFileSync(filePath, 'utf8'))));
  }
  persist() { if (this.filePath) writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.data), null, 2)); }
  bucket(tenantId) {
    if (!this.data.has(tenantId)) this.data.set(tenantId, { suppliers: [], money: [], metal: [], settlements: [] });
    const b = this.data.get(tenantId);
    b.suppliers ||= []; b.money ||= []; b.metal ||= []; b.settlements ||= [];
    return b;
  }
  list(tenantId, kind) { return structuredClone(this.bucket(tenantId)[kind]); }
  add(tenantId, kind, value) {
    if (!LEDGER_KINDS.includes(kind)) throw new Error(`unknown ledger kind: ${kind}`);
    if (kind === 'metal') assertPurity(value.metalType, value.purity);
    if (kind === 'settlements' && Number(value.metalGrams || 0) > 0) assertPurity(value.metalType, value.purity);
    const item = { ...value, id: randomUUID(), createdAt: new Date().toISOString() };
    this.bucket(tenantId)[kind].unshift(item);
    this.persist();
    return structuredClone(item);
  }
  addSupplier(tenantId, { name, phone = '', notes = '', openingMoney = 0, openingMetal = [] } = {}) {
    const supplier = this.add(tenantId, 'suppliers', { name, phone, notes, status: 'ACTIVE' });
    if (Number(openingMoney) > 0) {
      this.add(tenantId, 'money', { supplierId: supplier.id, type: 'OPENING', amountInr: Number(openingMoney), date: new Date().toISOString().slice(0, 10) });
    }
    for (const row of openingMetal) {
      if (Number(row.weightGrams) > 0) {
        this.add(tenantId, 'metal', {
          supplierId: supplier.id, direction: 'OPENING', metalType: row.metalType, purity: row.purity,
          weightGrams: Number(row.weightGrams), date: new Date().toISOString().slice(0, 10)
        });
      }
    }
    return this.list(tenantId, 'suppliers').find((s) => s.id === supplier.id);
  }
  update(tenantId, kind, id, value) {
    if (kind !== 'suppliers') throw new Error('money, metal, and settlements are append-only');
    const items = this.bucket(tenantId)[kind];
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`${kind} item not found`);
    const patch = {};
    for (const field of SUPPLIER_UPDATE_FIELDS) {
      if (value[field] !== undefined) patch[field] = value[field];
    }
    items[index] = { ...items[index], ...patch, updatedAt: new Date().toISOString() };
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
  supplierLedger(tenantId, supplierId) {
    const money = this.list(tenantId, 'money');
    const metal = this.list(tenantId, 'metal');
    const settlements = this.list(tenantId, 'settlements');
    const supplier = this.list(tenantId, 'suppliers').find((s) => s.id === supplierId);
    return {
      supplier,
      payable: payableInr(money, settlements, supplierId),
      metalByPurity: metalByPurity(metal, settlements, supplierId),
      money: money.filter((r) => r.supplierId === supplierId),
      metal: metal.filter((r) => r.supplierId === supplierId),
      settlements: settlements.filter((r) => r.supplierId === supplierId)
    };
  }
  summary(tenantId) {
    return summarizeLedger(
      this.list(tenantId, 'suppliers'),
      this.list(tenantId, 'money'),
      this.list(tenantId, 'metal'),
      this.list(tenantId, 'settlements')
    );
  }
}
