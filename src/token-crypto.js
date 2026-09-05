import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SALT = 'karigar-tokens';
const HEX_KEY = /^[0-9a-fA-F]{64}$/;

function keyMaterial(key) {
  if (typeof key === 'string' && HEX_KEY.test(key)) return Buffer.from(key, 'hex');
  return scryptSync(key, SALT, KEY_BYTES);
}

export function encryptSecret(plaintext, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, keyMaterial(key), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptSecret(packed, key) {
  const parts = String(packed ?? '').split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new Error('Invalid packed secret');
  }
  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');
  const decipher = createDecipheriv(ALGO, keyMaterial(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
