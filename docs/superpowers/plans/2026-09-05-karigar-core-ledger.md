# Karigar Core Supplier Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a jewellery shop owner sign in with Google, keep a supplier ledger in their Drive, and run money, metal-by-purity, and simple settlements behind the existing trial/read-only paywall.

**Architecture:** Keep the Node HTTP app and file-backed control plane. Add a pure ledger-math module, a ledger port with a JSON adapter (tests/local) and a Google Sheets adapter (owner sessions), Google OAuth + HTTP-only sessions, and `assertCanPerformPaidWrite` on every mutation. Admin continues to read tenant metadata only.

**Tech Stack:** Node.js ESM, built-in `node:test` / `node:http` / `node:crypto`, Google OAuth 2.0 + Sheets/Drive REST (via `fetch`, no new runtime framework), existing vanilla `public/app.js` UI.

**Spec:** `docs/superpowers/specs/2026-09-05-karigar-core-ledger-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `src/ledger-math.js` | Payable and per-purity metal math; purity/type validation. No I/O. |
| `src/write-gate.js` | `assertCanPerformPaidWrite(entitlements, tenantId, feature)`. |
| `src/domain.js` | Plan feature keys, `createTenant` extra fields, `createUser`. |
| `src/control-plane.js` | Users store; expanded forbidden ledger keys. |
| `src/token-crypto.js` | Encrypt/decrypt OAuth tokens with `TOKEN_ENCRYPTION_KEY`. |
| `src/ledger-store.js` | JSON ledger adapter: `suppliers`, `money`, `metal`, `settlements`. |
| `src/sheets-ledger.js` | Google Sheets adapter implementing the same methods. |
| `src/oauth.js` | Auth URL, code exchange, userinfo, token refresh. |
| `src/session.js` | HTTP-only session cookie store. |
| `src/server.js` | `createApp()` factory: OAuth, session auth, ledger routes, admin. |
| `public/app.js` | Owner UI: Google login, setup, supplier-centric ledger. |
| `public/admin.html` | Tenant metadata + lifecycle actions; no ledger rows. |
| `test/*.test.js` | One test file per unit above, plus HTTP tests. |
| `.env.example`, `README.md`, `GOOGLE_INTEGRATION.md` | Credentials and how to run. |

Do not add Next.js, a hosted database, or Razorpay checkout in this plan.

---

### Task 1: Ledger math

**Files:**
- Create: `src/ledger-math.js`
- Test: `test/ledger-math.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { payableInr, metalByPurity, assertPurity } from '../src/ledger-math.js';

const supplierId = 's1';
const money = [
  { supplierId, type: 'OPENING', amountInr: 1000 },
  { supplierId, type: 'PURCHASE', amountInr: 5000 },
  { supplierId, type: 'PAYMENT', amountInr: 2000 },
  { supplierId: 'other', type: 'PURCHASE', amountInr: 999 }
];
const metal = [
  { supplierId, direction: 'OPENING', metalType: 'GOLD', purity: '22K', weightGrams: 10 },
  { supplierId, direction: 'ISSUE', metalType: 'GOLD', purity: '22K', weightGrams: 5 },
  { supplierId, direction: 'RECEIPT', metalType: 'GOLD', purity: '22K', weightGrams: 3 },
  { supplierId, direction: 'ISSUE', metalType: 'GOLD', purity: '18K', weightGrams: 2 }
];
const settlements = [
  { supplierId, moneyAmountInr: 500, metalType: 'GOLD', purity: '22K', metalGrams: 1 }
];

test('payable is opening + purchases - payments - settlement cash', () => {
  assert.equal(payableInr(money, settlements, supplierId), 3500);
});

test('metal stays separate by type and purity', () => {
  assert.deepEqual(metalByPurity(metal, settlements, supplierId), {
    'GOLD:22K': 11,
    'GOLD:18K': 2
  });
});

test('rejects gold purity on silver and unknown purity', () => {
  assert.throws(() => assertPurity('GOLD', '925'), /purity/);
  assert.throws(() => assertPurity('SILVER', '22K'), /purity/);
  assert.doesNotThrow(() => assertPurity('GOLD', '22K'));
  assert.doesNotThrow(() => assertPurity('SILVER', '999'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ledger-math.test.js`

Expected: FAIL with `Cannot find module` for `../src/ledger-math.js`

- [ ] **Step 3: Write minimal implementation**

```js
export const GOLD_PURITIES = ['24K', '22K', '18K', '14K'];
export const SILVER_PURITIES = ['999', '925'];

export function assertPurity(metalType, purity) {
  const allowed = metalType === 'GOLD' ? GOLD_PURITIES : metalType === 'SILVER' ? SILVER_PURITIES : [];
  if (!allowed.includes(purity)) throw new Error(`Invalid purity ${purity} for ${metalType}`);
}

export function payableInr(moneyRows, settlementRows, supplierId) {
  const money = moneyRows.filter((row) => row.supplierId === supplierId)
    .reduce((sum, row) => {
      if (row.type === 'OPENING' || row.type === 'PURCHASE') return sum + Number(row.amountInr || 0);
      if (row.type === 'PAYMENT') return sum - Number(row.amountInr || 0);
      return sum;
    }, 0);
  const settled = settlementRows.filter((row) => row.supplierId === supplierId)
    .reduce((sum, row) => sum + Number(row.moneyAmountInr || 0), 0);
  return money - settled;
}

export function metalByPurity(metalRows, settlementRows, supplierId) {
  const balances = {};
  const add = (key, delta) => { balances[key] = (balances[key] || 0) + delta; };
  for (const row of metalRows.filter((item) => item.supplierId === supplierId)) {
    const key = `${row.metalType}:${row.purity}`;
    const grams = Number(row.weightGrams || 0);
    if (row.direction === 'OPENING' || row.direction === 'ISSUE') add(key, grams);
    if (row.direction === 'RECEIPT') add(key, -grams);
  }
  for (const row of settlementRows.filter((item) => item.supplierId === supplierId)) {
    if (row.metalType && row.purity && Number(row.metalGrams || 0) > 0) {
      add(`${row.metalType}:${row.purity}`, -Number(row.metalGrams));
    }
  }
  return Object.fromEntries(Object.entries(balances).filter(([, grams]) => grams !== 0));
}

export function skipInvalidMetalRow(row) {
  try {
    if (!row?.metalType || !row?.purity) return null;
    assertPurity(row.metalType, row.purity);
    return row;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ledger-math.test.js`

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ledger-math.js test/ledger-math.test.js
git commit -m "feat: add payable and metal-by-purity ledger math"
```

---

### Task 2: Plan features, user factory, tenant setup fields, write gate

**Files:**
- Modify: `src/domain.js`
- Create: `src/write-gate.js`
- Test: `test/domain.test.js` (extend), `test/write-gate.test.js`

- [ ] **Step 1: Write failing write-gate tests and extend domain tests**

Add to `test/domain.test.js`:

```js
import { createUser } from '../src/domain.js';

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
```

Create `test/write-gate.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/write-gate.test.js test/domain.test.js`

Expected: FAIL on missing `createUser` / `assertCanPerformPaidWrite` / `setupStatus` / new feature keys.

- [ ] **Step 3: Implement domain + write gate**

In `src/domain.js`, change `defaultPlan().features` to:

```js
features: ['supplier_management', 'transaction_entry', 'metal_ledger', 'settlements', 'exports'],
```

Add to `createTenant` return object:

```js
spreadsheetId: null, setupStatus: 'PENDING',
```

Add:

```js
export function createUser({ id, tenantId, email, googleSubjectId, name, now = new Date() }) {
  return {
    id, tenantId, email, googleSubjectId, name, role: 'OWNER', status: 'ACTIVE',
    createdAt: now.toISOString(), lastLoginAt: now.toISOString()
  };
}
```

Create `src/write-gate.js`:

```js
const PAID = new Set(['supplier_management', 'transaction_entry', 'metal_ledger', 'settlements']);

export function assertCanPerformPaidWrite(entitlements, tenantId, feature) {
  if (!entitlements.canUseApplication(tenantId)) throw new Error('Account is blocked');
  if (feature === 'exports') return;
  if (!entitlements.canWrite(tenantId)) throw new Error('Your workspace is read-only. Subscribe to continue writing.');
  const { features } = entitlements.getFeatureEntitlements(tenantId);
  if (PAID.has(feature) && !features.includes(feature)) throw new Error(`Plan does not include ${feature}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/domain.test.js test/write-gate.test.js`

Expected: PASS, including previous webhook tests in `test/domain.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/domain.js src/write-gate.js test/domain.test.js test/write-gate.test.js
git commit -m "feat: add owner user, setup fields, and paid write gate"
```

---

### Task 3: Control plane users store and stricter ledger-key ban

**Files:**
- Modify: `src/control-plane.js`
- Test: `test/control-plane.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlane } from '../src/control-plane.js';
import { createUser } from '../src/domain.js';

test('control plane rejects metal and money ledger fields', () => {
  const cp = new ControlPlane();
  assert.throws(() => cp.tenants.set('t1', { id: 't1', amountInr: 10 }), /cannot be stored/);
  assert.throws(() => cp.tenants.set('t1', { id: 't1', weightGrams: 1 }), /cannot be stored/);
  assert.throws(() => cp.tenants.set('t1', { id: 't1', purity: '22K' }), /cannot be stored/);
  assert.throws(() => cp.users.set('u1', { id: 'u1', supplierName: 'X' }), /cannot be stored/);
});

test('users are stored without ledger content', () => {
  const cp = new ControlPlane();
  const user = createUser({ id: 'u1', tenantId: 't1', email: 'a@b.com', googleSubjectId: 'sub', name: 'A' });
  cp.saveUser(user);
  assert.equal(cp.findUserByGoogleSubject('sub').email, 'a@b.com');
  assert.equal(cp.findUserByGoogleSubject('nope'), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/control-plane.test.js`

Expected: FAIL (`users` / `saveUser` missing, `amountInr` not forbidden)

- [ ] **Step 3: Implement**

In `src/control-plane.js`, extend `FORBIDDEN_KEYS` with:

`amountInr`, `weightGrams`, `purity`, `metalType`, `metalGrams`, `openingBalance`, `phone`, `supplierId`

Add `users` to `ControlPlane` constructor (default `new MetadataStore()`), plus:

```js
saveUser(user) { return this.users.set(user.id, user); }
getUser(id) { return this.users.get(id); }
findUserByGoogleSubject(googleSubjectId) {
  return this.users.values().find((user) => user.googleSubjectId === googleSubjectId);
}
```

`server.js` will later persist users to `data/users.json` the same way tenants are persisted.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/control-plane.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/control-plane.js test/control-plane.test.js
git commit -m "feat: persist SaaS users and ban ledger fields from control plane"
```

---

### Task 4: JSON ledger adapter for the four-tab model

**Files:**
- Modify: `src/ledger-store.js`
- Test: `test/ledger-store.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { LedgerStore } from '../src/ledger-store.js';

test('creating a supplier writes opening money and metal rows', () => {
  const ledger = new LedgerStore();
  const supplier = ledger.addSupplier('t1', {
    name: 'Mehta',
    phone: '999',
    openingMoney: 1000,
    openingMetal: [{ metalType: 'GOLD', purity: '22K', weightGrams: 4 }]
  });
  assert.equal(supplier.name, 'Mehta');
  assert.equal(ledger.list('t1', 'money')[0].type, 'OPENING');
  assert.equal(ledger.list('t1', 'metal')[0].direction, 'OPENING');
  const summary = ledger.summary('t1');
  assert.equal(summary.outstanding, 1000);
  assert.equal(summary.metalByPurity['GOLD:22K'], 4);
  const detail = ledger.supplierLedger('t1', supplier.id);
  assert.equal(detail.payable, 1000);
});

test('journals are append-only except supplier edits', () => {
  const ledger = new LedgerStore();
  const supplier = ledger.addSupplier('t1', { name: 'A' });
  ledger.add('t1', 'money', { supplierId: supplier.id, type: 'PURCHASE', amountInr: 50, date: '2026-01-02' });
  assert.throws(() => ledger.update('t1', 'money', 'x', {}), /append-only/);
  const updated = ledger.update('t1', 'suppliers', supplier.id, { phone: '1', notes: 'k' });
  assert.equal(updated.phone, '1');
});

test('settlement reduces payable and metal', () => {
  const ledger = new LedgerStore();
  const supplier = ledger.addSupplier('t1', {
    name: 'A', openingMoney: 100, openingMetal: [{ metalType: 'GOLD', purity: '22K', weightGrams: 10 }]
  });
  ledger.add('t1', 'settlements', {
    supplierId: supplier.id, moneyAmountInr: 40, metalType: 'GOLD', purity: '22K', metalGrams: 2, date: '2026-01-03'
  });
  const detail = ledger.supplierLedger('t1', supplier.id);
  assert.equal(detail.payable, 60);
  assert.equal(detail.metalByPurity['GOLD:22K'], 8);
});

test('exportCSV includes money rows', () => {
  const ledger = new LedgerStore();
  const supplier = ledger.addSupplier('t1', { name: 'A', openingMoney: 10 });
  const csv = ledger.exportCSV('t1', 'money');
  assert.match(csv, /amountInr/);
  assert.match(csv, /OPENING/);
  assert.ok(csv.includes(supplier.id));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ledger-store.test.js`

Expected: FAIL (`addSupplier` / `supplierLedger` missing; `transactions` still the bucket)

- [ ] **Step 3: Implement JSON adapter**

Replace `src/ledger-store.js` so that:

- `bucket` is `{ suppliers: [], money: [], metal: [], settlements: [] }`
- `addSupplier(tenantId, { name, phone, notes, openingMoney, openingMetal })` adds supplier `status: 'ACTIVE'`, then optional `OPENING` money and metal rows
- `update` throws `Error('money, metal, and settlements are append-only')` unless `kind === 'suppliers'`
- `summary` and `supplierLedger` use `payableInr` and `metalByPurity`
- Keep `list`, `add`, `exportCSV`, `deleteTenantData`

`add` for `metal` must call `assertPurity`. `add` for `settlements` must call `assertPurity` when `metalGrams > 0`.

`summary` shape:

```js
{
  supplierCount,
  moneyCount,
  metalCount,
  settlementCount,
  outstanding,          // sum of payable across suppliers
  totalPurchases,
  totalPayments,
  metalByPurity,        // shop-wide net grams
  recentMoney           // 5 latest money rows with supplierName joined
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/ledger-store.test.js test/ledger-math.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ledger-store.js test/ledger-store.test.js
git commit -m "feat: store money, metal, and settlements in the JSON ledger adapter"
```

---

### Task 5: Token encryption

**Files:**
- Create: `src/token-crypto.js`
- Test: `test/token-crypto.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../src/token-crypto.js';

test('round-trips a refresh token', () => {
  const key = 'a'.repeat(64);
  const packed = encryptSecret('refresh-token-value', key);
  assert.notEqual(packed, 'refresh-token-value');
  assert.equal(decryptSecret(packed, key), 'refresh-token-value');
});

test('wrong key fails closed', () => {
  const packed = encryptSecret('x', 'a'.repeat(64));
  assert.throws(() => decryptSecret(packed, 'b'.repeat(64)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/token-crypto.test.js`

Expected: FAIL module not found

- [ ] **Step 3: Implement AES-256-GCM**

`src/token-crypto.js`: derive 32-byte key with `scryptSync(key, 'karigar-tokens', 32)` if the provided key is not 64 hex chars, otherwise `Buffer.from(key, 'hex')`. Use random 12-byte IV. Return `ivB64.tagB64.cipherB64`. Never log plaintext tokens.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/token-crypto.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/token-crypto.js test/token-crypto.test.js
git commit -m "feat: encrypt OAuth tokens at rest"
```

---

### Task 6: Google Sheets ledger adapter (mocked HTTP)

**Files:**
- Create: `src/sheets-ledger.js`
- Test: `test/sheets-ledger.test.js`

The adapter must implement the same methods as `LedgerStore`: `addSupplier`, `list`, `add`, `update` (suppliers only), `summary`, `supplierLedger`, `exportCSV`, `ensureSpreadsheet({ accessToken, businessName, spreadsheetId })`.

Do not call live Google. Inject `fetchImpl`.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SheetsLedger } from '../src/sheets-ledger.js';

function memoryGoogle() {
  const sheets = new Map();
  const fetchImpl = async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};
    if (url.includes('/spreadsheets') && method === 'POST' && !url.includes('values')) {
      const id = `ss_${sheets.size + 1}`;
      const tabs = {};
      for (const sheet of body.sheets || []) tabs[sheet.properties.title] = [[]];
      sheets.set(id, { title: body.properties.title, tabs });
      return { ok: true, json: async () => ({ spreadsheetId: id }) };
    }
    const spreadsheetId = url.match(/spreadsheets\/([^/]+)/)[1];
    const book = sheets.get(spreadsheetId);
    if (url.includes(':batchGet') || url.includes('values:get') || (url.includes('/values/') && method === 'GET')) {
      const range = decodeURIComponent((url.split('/values/')[1] || '').split('?')[0]);
      const title = range.split('!')[0];
      return { ok: true, json: async () => ({ values: book.tabs[title] || [] }) };
    }
    if (method === 'PUT' || method === 'POST') {
      const title = decodeURIComponent(url.split('/values/')[1].split('?')[0].split('!')[0]);
      if (method === 'PUT') book.tabs[title] = body.values;
      else book.tabs[title] = [...(book.tabs[title] || []), ...(body.values || [])];
      return { ok: true, json: async () => ({}) };
    }
    if (method === 'GET' && url.endsWith(spreadsheetId)) {
      return { ok: true, json: async () => ({ spreadsheetId }) };
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
  };
  return { fetchImpl, sheets };
}

test('ensureSpreadsheet creates four data tabs plus _Meta', async () => {
  const { fetchImpl, sheets } = memoryGoogle();
  const ledger = new SheetsLedger({ fetchImpl, accessToken: 'tok' });
  const id = await ledger.ensureSpreadsheet({ businessName: 'Mehta Jewellers' });
  const book = [...sheets.values()][0];
  assert.equal(book.title, 'Karigar ledger — Mehta Jewellers');
  for (const tab of ['_Meta', 'Suppliers', 'Money', 'Metal', 'Settlements']) assert.ok(book.tabs[tab]);
  assert.equal(id, [...sheets.keys()][0]);
});

test('addSupplier and settlement round-trip through sheet rows', async () => {
  const { fetchImpl } = memoryGoogle();
  const ledger = new SheetsLedger({ fetchImpl, accessToken: 'tok', spreadsheetId: await new SheetsLedger({ fetchImpl, accessToken: 'tok' }).ensureSpreadsheet({ businessName: 'Shop' }) });
  const supplier = await ledger.addSupplier(null, {
    name: 'Karigar A', openingMoney: 200, openingMetal: [{ metalType: 'GOLD', purity: '22K', weightGrams: 3 }]
  });
  await ledger.add(null, 'settlements', {
    supplierId: supplier.id, moneyAmountInr: 50, metalType: 'GOLD', purity: '22K', metalGrams: 1, date: '2026-01-04'
  });
  const detail = await ledger.supplierLedger(null, supplier.id);
  assert.equal(detail.payable, 150);
  assert.equal(detail.metalByPurity['GOLD:22K'], 2);
  const csv = await ledger.exportCSV(null, 'suppliers');
  assert.match(csv, /Karigar A/);
});

test('missing spreadsheet on get is a recreate signal, not a delete', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) });
  const ledger = new SheetsLedger({ fetchImpl, accessToken: 'tok', spreadsheetId: 'gone' });
  await assert.rejects(() => ledger.list(null, 'suppliers'), /not found|missing spreadsheet/i);
});
```

If the in-test fake Google is too brittle, implement a slightly richer fake inside `test/sheets-ledger.test.js` that stores tab values as arrays of arrays and have `SheetsLedger` use REST shapes:

- Create: `POST https://sheets.googleapis.com/v4/spreadsheets`
- Read tab: `GET .../spreadsheets/{id}/values/{tab}`
- Append: `POST .../values/{tab}:append?valueInputOption=RAW`
- Overwrite suppliers tab on update: read all, rewrite with `PUT .../values/{tab}?valueInputOption=RAW`

`tenantId` is unused by Sheets (the spreadsheet is the isolation). Keep the method signatures identical to `LedgerStore` so `server.js` can call either adapter.

Header row for each tab must match the spec column names. Skip rows missing required columns instead of throwing the whole list.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sheets-ledger.test.js`

Expected: FAIL module not found

- [ ] **Step 3: Implement `SheetsLedger`**

Use `Authorization: Bearer ${accessToken}`. Map rows ↔ objects. Generate ids with `randomUUID()`. `update` for non-suppliers throws append-only. `ensureSpreadsheet` creates tabs with headers:

- `_Meta`: `schemaVersion,createdAt` then row `1,<iso>`
- `Suppliers`: `id,name,phone,notes,status,createdAt`
- `Money`: `id,date,supplierId,type,amountInr,note,createdAt`
- `Metal`: `id,date,supplierId,direction,metalType,purity,weightGrams,note,createdAt`
- `Settlements`: `id,date,supplierId,moneyAmountInr,metalType,purity,metalGrams,note,createdAt`

If `spreadsheetId` is passed to `ensureSpreadsheet` and GET succeeds, return it. If GET is 404, create a new spreadsheet and return the new id (caller saves it). Never delete a spreadsheet.

- [ ] **Step 4: Run tests**

Run: `node --test test/sheets-ledger.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sheets-ledger.js test/sheets-ledger.test.js
git commit -m "feat: add Google Sheets ledger adapter behind a fetch port"
```

---

### Task 7: OAuth helpers and session store

**Files:**
- Create: `src/oauth.js`
- Create: `src/session.js`
- Test: `test/oauth-session.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { googleAuthUrl, exchangeCode, refreshAccessToken } from '../src/oauth.js';
import { SessionStore } from '../src/session.js';

test('auth URL includes drive.file and spreadsheets scopes', () => {
  const url = googleAuthUrl({ clientId: 'cid', redirectUri: 'http://localhost:3000/auth/google/callback', state: 'abc' });
  assert.match(url, /accounts.google.com/);
  assert.match(url, /spreadsheets/);
  assert.match(url, /drive.file/);
  assert.match(url, /openid/);
});

test('exchangeCode stores tokens from mocked token endpoint', async () => {
  const fetchImpl = async (url, options) => {
    if (String(url).includes('token')) {
      return { ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: 'x' }) };
    }
    if (String(url).includes('userinfo')) {
      return { ok: true, json: async () => ({ sub: 'sub-1', email: 'owner@shop.com', name: 'Owner' }) };
    }
    throw new Error(url);
  };
  const result = await exchangeCode({ code: 'code', clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://localhost:3000/auth/google/callback', fetchImpl });
  assert.equal(result.googleSubjectId, 'sub-1');
  assert.equal(result.email, 'owner@shop.com');
  assert.equal(result.refreshToken, 'rt');
});

test('session cookie round-trips owner identity', () => {
  const sessions = new SessionStore();
  const { header } = sessions.create({ googleSubjectId: 'sub-1', email: 'a@b.com' });
  assert.match(header, /HttpOnly/i);
  const sid = header.split('karigar.sid=')[1].split(';')[0];
  assert.equal(sessions.get(sid).email, 'a@b.com');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/oauth-session.test.js`

Expected: FAIL module not found

- [ ] **Step 3: Implement**

`src/oauth.js` scopes (space-separated):

`openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file`

`googleAuthUrl` uses `access_type=offline` and `prompt=consent` so a refresh token is issued.

`exchangeCode` POSTs to `https://oauth2.googleapis.com/token` then GET `https://openidconnect.googleapis.com/v1/userinfo`.

`refreshAccessToken` POSTs `grant_type=refresh_token`.

`src/session.js`: in-memory Map plus optional `data/sessions.json` is unnecessary; in-memory is enough for this slice. Cookie: `karigar.sid=<id>; Path=/; HttpOnly; SameSite=Lax`. `create`, `get`, `destroy`. Session payload may include `userId`, `tenantId`, `googleSubjectId`, `email`, `name`, `accessToken`, `refreshToken` (refresh token should already be encrypted before insert, or encrypt inside `create` using `token-crypto` — encrypt before store).

- [ ] **Step 4: Run tests**

Run: `node --test test/oauth-session.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/oauth.js src/session.js test/oauth-session.test.js
git commit -m "feat: add Google OAuth helpers and HttpOnly sessions"
```

---

### Task 8: HTTP app factory — auth, setup, ledger API, admin

**Files:**
- Modify: `src/server.js`
- Modify: `src/control-plane.js` constructor usage in server
- Test: `test/server.test.js`

Extract `createApp(deps)` so tests can pass in-memory stores, a `LedgerStore`, and a fake `oauth`. Do not listen when `createApp` is used from tests. Keep `server.listen` only in the `import.meta.url === process.argv[1]` main block, or when `NODE_ENV !== 'test'` after `createApp()` with file stores.

- [ ] **Step 1: Write failing HTTP tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { ControlPlane } from '../src/control-plane.js';
import { LedgerStore } from '../src/ledger-store.js';
import { defaultPlan, SubscriptionEntitlementService, createTenant, createUser } from '../src/domain.js';
import { SessionStore } from '../src/session.js';

function start(overrides = {}) {
  const controlPlane = new ControlPlane();
  controlPlane.savePlan(defaultPlan());
  const ledger = new LedgerStore();
  const sessions = new SessionStore();
  const entitlements = new SubscriptionEntitlementService({ tenantStore: controlPlane.tenants, planStore: controlPlane.plans });
  const app = createApp({
    controlPlane, ledger, sessions, entitlements,
    env: { ADMIN_KEY: 'local-admin', GOOGLE_CLIENT_ID: '', TOKEN_ENCRYPTION_KEY: 'a'.repeat(64) },
    ...overrides
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        server, controlPlane, ledger, sessions, entitlements,
        url: `http://127.0.0.1:${port}`
      });
    });
  });
}

test('owner session can add a supplier and money; admin cannot see the name', async () => {
  const ctx = await start();
  const tenant = createTenant({ id: 't1', businessName: 'Mehta', ownerUserId: 'u1' });
  tenant.setupStatus = 'READY';
  ctx.controlPlane.saveTenant(tenant);
  ctx.controlPlane.saveUser(createUser({ id: 'u1', tenantId: 't1', email: 'o@x.com', googleSubjectId: 'sub', name: 'O' }));
  const { header } = ctx.sessions.create({ userId: 'u1', tenantId: 't1' });
  const cookie = header.split(';')[0];
  const created = await fetch(`${ctx.url}/api/me/suppliers`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Secret Karigar', openingMoney: 10 })
  });
  assert.equal(created.status, 201);
  const admin = await fetch(`${ctx.url}/api/admin/tenants`, { headers: { 'x-admin-key': 'local-admin' } });
  const rows = await admin.json();
  assert.equal(rows[0].businessName, 'Mehta');
  assert.ok(!JSON.stringify(rows).includes('Secret Karigar'));
  ctx.server.close();
});

test('read-only tenant is rejected on write and allowed on export', async () => {
  const ctx = await start();
  const tenant = createTenant({ id: 't1', businessName: 'Mehta', ownerUserId: 'u1', now: new Date('2026-01-01') });
  tenant.setupStatus = 'READY';
  ctx.controlPlane.saveTenant(tenant);
  ctx.controlPlane.saveUser(createUser({ id: 'u1', tenantId: 't1', email: 'o@x.com', googleSubjectId: 'sub', name: 'O' }));
  const entitlements = new SubscriptionEntitlementService({
    tenantStore: ctx.controlPlane.tenants, planStore: ctx.controlPlane.plans,
    clock: () => new Date('2026-02-01')
  });
  ctx.server.close();
  const ctx2 = await start({ controlPlane: ctx.controlPlane, entitlements, ledger: ctx.ledger, sessions: ctx.sessions });
  const { header } = ctx2.sessions.create({ userId: 'u1', tenantId: 't1' });
  const cookie = header.split(';')[0];
  const write = await fetch(`${ctx2.url}/api/me/suppliers`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Nope' })
  });
  assert.equal(write.status, 400);
  const exportRes = await fetch(`${ctx2.url}/api/me/export?kind=suppliers`, { headers: { cookie } });
  assert.equal(exportRes.status, 200);
  ctx2.server.close();
});

test('POST /tenants without Google is local-dev only and does not require session', async () => {
  const ctx = await start();
  const res = await fetch(`${ctx.url}/api/tenants`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ businessName: 'Local Shop', ownerUserId: 'dev@local' })
  });
  assert.equal(res.status, 201);
  ctx.server.close();
});
```

Also add a test that `GET /auth/google` 302s when `GOOGLE_CLIENT_ID` is set, and that `POST /api/setup` with a pending session creates a tenant + calls `ledger.ensureSpreadsheet` when a stub ledger is provided.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/server.test.js`

Expected: FAIL (`createApp` not exported)

- [ ] **Step 3: Implement `createApp`**

Routes (owner, cookie session, tenant from session not URL):

| Method | Path | Gate | Action |
|---|---|---|---|
| GET | `/auth/google` | — | Redirect to Google |
| GET | `/auth/google/callback` | — | Exchange code; if user exists, session + `/`; else session pending + `/` |
| POST | `/api/logout` | — | Destroy session |
| GET | `/api/me` | session | `{ user, tenant, entitlements, localMode }` |
| POST | `/api/setup` | pending Google session | `businessName` required; `createUser`+`createTenant`; `ensureSpreadsheet`; save `spreadsheetId`; `setupStatus=READY`. On sheet failure: `SETUP_FAILED`, do not pretend READY |
| GET/POST | `/api/me/suppliers` | session + write on POST | list / `addSupplier` |
| PATCH | `/api/me/suppliers/:id` | write `supplier_management` | name/phone/notes/status |
| GET | `/api/me/suppliers/:id` | session | `supplierLedger` |
| GET/POST | `/api/me/money` | write `transaction_entry` on POST | |
| GET/POST | `/api/me/metal` | write `metal_ledger` on POST | |
| GET/POST | `/api/me/settlements` | write `settlements` on POST | |
| GET | `/api/me/summary` | session | |
| GET | `/api/me/export?kind=` | `exports` | CSV |
| GET | `/api/admin/overview` | admin key | existing metrics |
| GET | `/api/admin/tenants` | admin key | metadata including `ownerEmail` resolved from users; never ledger fields |
| POST | `/api/admin/tenants/:id/(trial\|comp\|block\|reactivate)` | admin key | existing actions |
| POST | `/api/tenants` | only when `!GOOGLE_CLIENT_ID` | keep local-dev onboarding |
| POST | `/billing/webhook` | unchanged | |

Every paid POST/PATCH calls `assertCanPerformPaidWrite`. Owner Google sessions with `GOOGLE_CLIENT_ID` set must use `SheetsLedger` constructed with decrypted access token (refresh on 401). Local mode uses `LedgerStore`. Never copy sheet rows into `controlPlane`.

Parse `Cookie` header for `karigar.sid`. 401 JSON `{ error: 'Sign in required' }` when missing on `/api/me*`.

Keep serving `/`, `/pricing`, `/data-ownership`, `/admin`.

- [ ] **Step 4: Run tests**

Run: `node --test`

Expected: all existing and new tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server.js test/server.test.js src/control-plane.js
git commit -m "feat: session-authenticated ledger API and Google setup"
```

---

### Task 9: Owner UI

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css` only if supplier-detail layout needs it
- Modify: `public/index.html` title already Karigar

- [ ] **Step 1: No browser unit test; lock behavior with a small render-contract test if needed**

Add `test/public-contract.test.js` that reads `public/app.js` as text and asserts required view ids exist so the shell cannot regress:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('owner app includes Google login and ledger views', () => {
  const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const needle of [
    '/auth/google',
    'data-view="suppliers"',
    'data-view="money"',
    'data-view="metal"',
    'data-view="settlements"',
    'api/me/export',
    'api/setup',
    'LOCAL DEVELOPMENT MODE'
  ]) assert.match(src, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
```

This test should fail until `public/app.js` is rewritten.

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/public-contract.test.js`

Expected: FAIL missing `/auth/google` or `api/setup`

- [ ] **Step 3: Rewrite `public/app.js`**

State: `{ me, view, supplierId, summary, suppliers, money, metal, settlements, entitlements, modal, error }`

Bootstrap: `GET /api/me`. If 401 and `localMode` is not available, show landing with **Continue with Google** (`<a href="/auth/google">`) plus, only if the server still allows it, the existing local workspace form behind the “local development mode” banner.

If `me.user` exists and `me.tenant` is null or `setupStatus !== 'READY'`, show business-name form posting `POST /api/setup`.

If READY, render shell nav: Overview, Suppliers, Money, Metal, Settlements, Reports, Plan & billing.

- Overview: outstanding, purchases, payments, supplier count, trial days from `tenant.trialEndsAt`, mode pill, recent money.
- Suppliers: list with payable (from summary or per-row fetch). Click row → `view=supplier`, load `GET /api/me/suppliers/:id`.
- Supplier detail: payable, metal pills, buttons gated by `canWrite` for purchase, payment, issue, receive, settle. Opening fields only on create modal.
- Journals: tables of money/metal/settlements with supplier name.
- Reports: totals + export links `/api/me/export?kind=suppliers|money|metal|settlements`.
- Billing: plan name and `monthlyPrice` from `/api/plans` or entitlements; stub subscribe message. Remaining trial days. Read-only banner when `mode !== 'FULL_ACCESS'`.

Stop using `localStorage` tenant id as authorization. Local-dev path may still stash nothing if `/api/me` returns a local session after `POST /api/tenants` — prefer setting a session cookie from that local POST (implement in Task 8: local POST `/api/tenants` creates a session cookie too).

- [ ] **Step 4: Run tests**

Run: `node --test test/public-contract.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/styles.css test/public-contract.test.js
git commit -m "feat: supplier-centric owner UI with Google login and setup"
```

---

### Task 10: Admin lifecycle UI without ledger data

**Files:**
- Modify: `public/admin.html`
- Modify: `src/server.js` admin tenant payload if not already including `ownerEmail`, `setupStatus`
- Test: extend `test/server.test.js`

- [ ] **Step 1: Write failing assertion**

In `test/server.test.js`:

```js
test('admin can extend trial and block without ledger fields in the payload', async () => {
  const ctx = await start();
  const tenant = createTenant({ id: 't1', businessName: 'Mehta', ownerUserId: 'u1' });
  ctx.controlPlane.saveTenant(tenant);
  ctx.controlPlane.saveUser(createUser({ id: 'u1', tenantId: 't1', email: 'owner@shop.com', googleSubjectId: 'sub', name: 'O' }));
  const headers = { 'x-admin-key': 'local-admin', 'content-type': 'application/json' };
  const trial = await fetch(`${ctx.url}/api/admin/tenants/t1/trial`, { method: 'POST', headers, body: JSON.stringify({ days: 7 }) });
  assert.equal(trial.status, 200);
  const list = await (await fetch(`${ctx.url}/api/admin/tenants`, { headers })).json();
  assert.equal(list[0].ownerEmail, 'owner@shop.com');
  assert.ok(!('suppliers' in list[0]));
  assert.ok(!('amountInr' in list[0]));
  ctx.server.close();
});
```

- [ ] **Step 2: Run to fail if `ownerEmail` missing**

Run: `node --test test/server.test.js`

- [ ] **Step 3: Admin page**

Keep metrics cards. For each tenant row show business name, owner email, status, trial end. Buttons: Extend trial, Comp, Block, Reactivate posting to the existing admin routes with the admin key header. Do not render supplier names or amounts. Wrong key still shows the error only.

- [ ] **Step 4: Run `node --test`**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/admin.html src/server.js test/server.test.js
git commit -m "feat: admin tenant lifecycle without ledger access"
```

---

### Task 11: Env, docs, and README success path

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `GOOGLE_INTEGRATION.md`

- [ ] **Step 1: Update `.env.example`**

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
TOKEN_ENCRYPTION_KEY=
ADMIN_KEY=local-admin
RAZORPAY_WEBHOOK_SECRET=
PORT=3000
```

Document that `TOKEN_ENCRYPTION_KEY` should be 64 hex chars in production.

- [ ] **Step 2: Rewrite README runbook**

Include: `npm test`, `npm start`, Google vs local-dev banner, `/pricing`, `/data-ownership`, `/admin`, that jewellery rows live in the owner’s Drive, control plane in `data/`, and this slice is not live Razorpay.

- [ ] **Step 3: Update `GOOGLE_INTEGRATION.md`**

State that the Sheets adapter is implemented; list scopes; note `drive.file` only accesses files the app created; tokens encrypted; missing sheet recreates pointer, never deletes customer files.

- [ ] **Step 4: Run full test suite**

Run: `npm test`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md GOOGLE_INTEGRATION.md
git commit -m "docs: describe Google-owned ledger setup and local fallback"
```

---

## Self-review vs spec

| Spec section | Task |
|---|---|
| Owner-only Google login + business name then spreadsheet | 7, 8, 9 |
| Customer-owned four tabs + `_Meta` | 6 |
| Money payable and metal-by-purity math | 1, 4 |
| Simple settlements | 1, 4, 8, 9 |
| Append-only journals; editable suppliers | 4, 6 |
| Opening rows at supplier create | 4, 9 |
| Encrypted tokens, no refresh token in browser | 5, 7, 8 |
| Session auth, not localStorage authority | 7, 8, 9 |
| Write gate feature keys; exports in read-only | 2, 8 |
| Admin metadata only; no Drive provisioning | 3, 8, 10 |
| Local JSON only when Google unset; no silent fallback in owner Google session | 8 |
| CSV export | 4, 6, 8, 9 |
| Trial / read-only / block; never delete Drive | 2, 6, 8 |
| Razorpay stub remains | 9, 11 (non-goal) |
| Tests without live Google | 1–8, 10 |

No TBD/TODO placeholders. Method names used later (`addSupplier`, `supplierLedger`, `ensureSpreadsheet`, `assertCanPerformPaidWrite`, `createApp`, `createUser`, `findUserByGoogleSubject`) are defined in earlier tasks.
