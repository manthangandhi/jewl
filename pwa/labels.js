/**
 * Every word the shop sees for money and metal, in one place, so a supplier page and a customer page
 * never describe the same thing two ways.
 *   Hume dena = we have to give (we owe)      Hume lena = we have to get (they owe us)
 */
export const LABEL = {
  weGive: 'Hume dena',
  weGet: 'Hume lena',
  square: 'Square',
  supplier: {
    purchase: 'Purchase',
    payment: 'Payment',
    metalGiven: 'Metal given',
    metalReceived: 'Metal received',
    openingMoney: 'Opening',
    openingMetal: 'Opening metal',
    settlement: 'Settlement'
  },
  customer: {
    sale: 'Sale',
    return: 'Return',
    payment: 'Payment'
  }
};

/** moneyWeGet > 0 means the other side owes us. */
export function balanceName(moneyWeGet) {
  const n = Number(moneyWeGet || 0);
  if (n > 0) return LABEL.weGet;
  if (n < 0) return LABEL.weGive;
  return LABEL.square;
}
