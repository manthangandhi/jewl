export function assertShopPin(provided, expected) {
  const need = String(expected || '').trim();
  if (!need || need.indexOf('PASTE_') === 0) {
    throw new Error('SCRIPT_PIN is not set on the Apps Script');
  }
  if (String(provided || '').trim() !== need) {
    throw new Error('Wrong shop PIN');
  }
}

export function applyPinKey(digits, key) {
  const cur = String(digits || '');
  if (key === 'Backspace' || key === 'Delete' || key === 'del') return cur.slice(0, -1);
  if (/^[0-9]$/.test(String(key)) && cur.length < 8) return cur + key;
  return cur;
}

export function shouldHandlePinKeyboard(event, { unlocked, gate, pinScreen, target } = {}) {
  if (unlocked) return false;
  const onPin = pinScreen === true || gate === 'login';
  if (!onPin) return false;
  const tag = String(target && target.tagName ? target.tagName : '').toUpperCase();
  const isField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  const isPinField = Boolean(target && target.classList && typeof target.classList.contains === 'function' && target.classList.contains('pin-entry'));
  if (isField && !isPinField) return false;
  const key = event && event.key;
  if (key === 'Enter' || key === 'Backspace' || key === 'Delete') return true;
  return /^[0-9]$/.test(String(key || ''));
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
