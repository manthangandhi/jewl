import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isConfiguredUrl, normalizeVerdict, daysLeft, planNotice, whyBlocked, verifyDirect, decide, GRACE_HOURS
} from '../pwa/license.js';

const NOW = Date.parse('2026-11-13T10:00:00Z');
const iso = (days) => new Date(NOW + days * 86400000).toISOString();

test('only a real Apps Script web app address counts as a license server', () => {
  assert.equal(isConfiguredUrl('https://script.google.com/macros/s/AKfy123/exec'), true);
  assert.equal(isConfiguredUrl('PASTE_YOUR_LICENSE_URL_HERE'), false);
  assert.equal(isConfiguredUrl(''), false);
  assert.equal(isConfiguredUrl('https://evil.example/exec'), false);
});

test('a verdict is allowed only for an active or trial plan that the server approved', () => {
  assert.equal(normalizeVerdict({ ok: true, allowed: true, status: 'TRIAL' }).allowed, true);
  assert.equal(normalizeVerdict({ allowed: true, status: 'ACTIVE' }).allowed, true);
  assert.equal(normalizeVerdict({ allowed: true, status: 'INACTIVE' }).allowed, false);
  assert.equal(normalizeVerdict({ allowed: false, status: 'ACTIVE' }).allowed, false);
  assert.equal(normalizeVerdict({ allowed: 'yes', status: 'ACTIVE' }).allowed, false);
  assert.equal(normalizeVerdict(null).allowed, false);
});

test('the owner is warned in the last week, and told plainly why when it has ended', () => {
  const trial = (d) => normalizeVerdict({ allowed: true, status: 'TRIAL', trialEndsAt: iso(d) });
  assert.equal(daysLeft(trial(5), NOW), 5);
  assert.equal(planNotice(trial(5), NOW), 'Your trial ends in 5 days.');
  assert.equal(planNotice(trial(1), NOW), 'Your trial ends in 1 day.');
  assert.equal(planNotice(trial(0.2), NOW), 'Your trial ends in 1 day.');
  assert.equal(planNotice(trial(20), NOW), '');
  const paid = normalizeVerdict({ allowed: true, status: 'ACTIVE', paidUntil: iso(3) });
  assert.equal(planNotice(paid, NOW), 'Your plan ends in 3 days.');
  assert.equal(planNotice(normalizeVerdict({ allowed: false, status: 'INACTIVE' }), NOW), '');
  assert.match(whyBlocked(normalizeVerdict({ allowed: false, status: 'TRIAL', trialEndsAt: '2026-10-01T00:00:00Z' })), /free trial ended on 1 Oct 2026/);
  assert.match(whyBlocked(normalizeVerdict({ allowed: false, status: 'INACTIVE', paidUntil: '2026-10-05T00:00:00Z' })), /plan ended on 5 Oct 2026/);
  assert.match(whyBlocked({ allowed: false, status: 'INACTIVE', error: 'Unknown license' }), /not recognised/);
});

const serve = (impl) => async (url, opts) => impl(url, opts);
const reply = (obj, status = 200) => ({ ok: status === 200, status, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) });

test('asking the license server separates a real "no" from a server that cannot be reached', async () => {
  const url = 'https://script.google.com/macros/s/x/exec';
  const yes = await verifyDirect(serve(() => reply({ ok: true, allowed: true, status: 'ACTIVE', paidUntil: iso(30) })), url, 'k-1');
  assert.equal(yes.kind, 'allowed');
  const no = await verifyDirect(serve(() => reply({ ok: true, allowed: false, status: 'INACTIVE' })), url, 'k-1');
  assert.equal(no.kind, 'denied');
  const unknown = await verifyDirect(serve(() => reply({ ok: true, allowed: false, error: 'Unknown license' })), url, 'k-x');
  assert.equal(unknown.kind, 'denied');
  assert.equal((await verifyDirect(serve(() => { throw new TypeError('Failed to fetch'); }), url, 'k')).kind, 'unreachable');
  assert.equal((await verifyDirect(serve(() => reply('<html>error</html>')), url, 'k')).kind, 'unreachable');
  assert.equal((await verifyDirect(serve(() => reply({}, 500)), url, 'k')).kind, 'unreachable');
  assert.equal((await verifyDirect(serve(() => reply({ ok: false, error: 'boom' })), url, 'k')).kind, 'unreachable');
  const sent = [];
  await verifyDirect(serve((u, o) => { sent.push(JSON.parse(o.body)); return reply({ ok: true, allowed: true, status: 'ACTIVE' }); }), url, 'k-abc');
  assert.deepEqual(sent[0], { action: 'verify', key: 'k-abc' });
});

test('a "no" locks at once, an offline server gets a short grace, and a stranger gets none', () => {
  const t = NOW;
  assert.equal(decide({ result: { kind: 'allowed' }, now: t }), 'allowed');
  assert.equal(decide({ result: { kind: 'denied' }, lastOkAt: t - 1000, now: t }), 'denied');
  assert.equal(decide({ result: { kind: 'unreachable' }, lastOkAt: t - 3600000, now: t }), 'grace');
  assert.equal(decide({ result: { kind: 'unreachable' }, lastOkAt: t - (GRACE_HOURS + 1) * 3600000, now: t }), 'offline');
  assert.equal(decide({ result: { kind: 'unreachable' }, lastOkAt: 0, now: t }), 'offline');
});

test('the app checks the license itself, on opening and while open, and locks the books when it fails', () => {
  const js = fs.readFileSync(new URL('../pwa/app.js', import.meta.url), 'utf8');
  assert.match(js, /async function checkLicense/);
  assert.match(js, /if \(!\(await checkLicense\(\)\)\) return;/);
  assert.match(js, /setInterval\(\(\) => \{ if \(state\.unlocked\) checkLicense\(\); \}, RECHECK_MINUTES \* 60000\)/);
  assert.match(js, /visibilitychange/);
  assert.match(js, /function lockForLicense/);
  assert.match(js, /localStorage\.removeItem\(CACHE_KEY\)/);
  assert.match(js, /if \(state\.licenseBlock\) return licenseScreen\(\);/);
  assert.match(js, /LICENSE_\(PAUSED\|MISSING\)/);
  assert.match(js, /Your Karigar plan has ended/);
  assert.match(js, /Your books are safe/);
});

test('the shop script refuses at once, remembers a yes briefly, and tolerates a short license-server outage', () => {
  const gs = fs.readFileSync(new URL('../pwa/google-apps-script.gs', import.meta.url), 'utf8');
  assert.match(gs, /LICENSE_PAUSED:/);
  assert.match(gs, /LICENSE_UNREACHABLE:/);
  assert.match(gs, /cache\.put\(cacheId, JSON\.stringify\(verdict\), 120\)/);
  assert.match(gs, /cache\.put\(cacheId, JSON\.stringify\(verdict\), 60\)/);
  assert.match(gs, /LICENSE_GRACE_MS = 72 \* 3600 \* 1000/);
  assert.match(gs, /license: lic, licenseKey:/);
  assert.match(gs, /const lic = assertLicense_\(\);/);
});
