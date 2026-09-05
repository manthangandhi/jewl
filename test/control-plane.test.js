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
