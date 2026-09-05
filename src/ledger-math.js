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
