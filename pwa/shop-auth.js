export function assertShopPin(provided, expected) {
  const need = String(expected || '').trim();
  if (!need || need.indexOf('PASTE_') === 0) {
    throw new Error('SCRIPT_PIN is not set on the Apps Script');
  }
  if (String(provided || '').trim() !== need) {
    throw new Error('Wrong shop PIN');
  }
}

export function admitUnlock({ typedPin, remote } = {}) {
  const pin = String(typedPin || '').trim();
  if (!pin) return { enter: false, reason: 'no-pin' };
  if (!remote) return { enter: false, reason: 'need-google' };
  const data = remote.data || {};
  if (remote.mode === 'unlock' && data.ok === true && data.unlocked === true) {
    return { enter: true, reason: 'unlock' };
  }
  return { enter: false, reason: 'rejected' };
}
