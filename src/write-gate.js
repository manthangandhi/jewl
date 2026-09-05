const PAID = new Set(['supplier_management', 'transaction_entry', 'metal_ledger', 'settlements']);

export function assertCanPerformPaidWrite(entitlements, tenantId, feature) {
  if (!entitlements.canUseApplication(tenantId)) throw new Error('Account is blocked');
  if (feature === 'exports') return;
  if (!entitlements.canWrite(tenantId)) throw new Error('Your workspace is read-only. Subscribe to continue writing.');
  const { features } = entitlements.getFeatureEntitlements(tenantId);
  if (PAID.has(feature) && !features.includes(feature)) throw new Error(`Plan does not include ${feature}`);
}
