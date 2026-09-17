import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HEADERS } from '../pwa/sheet-model.js';

const pwa = path.join(process.cwd(), 'pwa');

test('PWA shell files exist for installable Sheets app', () => {
  for (const file of ['index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'service-worker.js', 'icon.svg', 'apps-script-url.txt', 'google-apps-script.gs', 'karigar-licenses.gs', 'license-url.txt', 'sheets-client.js', 'shop-auth.js', 'session-cache.js', 'tour.js', 'App.html', 'appsscript.json']) {
    assert.equal(fs.existsSync(path.join(pwa, file)), true, file);
  }
  const html = fs.readFileSync(path.join(pwa, 'index.html'), 'utf8');
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /apple-mobile-web-app-capable/);
});

test('Apps Script implements load, save, init and the same tabs as the PWA model', () => {
  const gs = fs.readFileSync(path.join(pwa, 'google-apps-script.gs'), 'utf8');
  assert.match(gs, /action === "load"/);
  assert.match(gs, /action === "save"/);
  assert.match(gs, /action === "init"/);
  assert.match(gs, /action === "seedDemo"/);
  assert.match(gs, /function seedDemo/);
  assert.match(gs, /Load sample khata \(demo only\)/);
  const initFn = gs.match(/function initLedger\(\) \{[\s\S]*?\n\}/);
  assert.ok(initFn, 'initLedger');
  assert.doesNotMatch(initFn[0], /seedDemoLedger_/);
  assert.match(gs, /Ramesh Karigar/);
  assert.match(gs, /SCRIPT_PIN/);
  assert.match(gs, /SpreadsheetApp\.getActiveSpreadsheet/);
  assert.doesNotMatch(gs, /SpreadsheetApp\.openById/);
  assert.doesNotMatch(gs, /SpreadsheetApp\.openByUrl/);
  assert.match(gs, /assertPin_/);
  assert.match(gs, /action === "unlock"/);
  assert.match(gs, /unlocked:\s*true/);
  assert.match(gs, /function doGet[\s\S]*unlocked:\s*false/);
  assert.match(gs, /ok:\s*false,\s*unlocked:\s*false/);
  assert.match(gs, /LICENSE_KEY/);
  assert.match(gs, /assertLicense_/);
  const licenses = fs.readFileSync(path.join(pwa, 'karigar-licenses.gs'), 'utf8');
  assert.match(licenses, /action === "verify"/);
  assert.match(licenses, /ACTIVE/);
  assert.match(licenses, /trialEndsAt/);
  assert.match(licenses, /function issueTrial/);
  assert.match(licenses, /function markPaid/);
  assert.match(licenses, /INACTIVE/);
  for (const tab of Object.keys(HEADERS)) {
    assert.match(gs, new RegExp(`${tab}:`));
  }
  for (const col of HEADERS.Khata) {
    assert.match(gs, new RegExp(`"${col}"`));
  }
  const manifest = fs.readFileSync(path.join(pwa, 'appsscript.json'), 'utf8');
  assert.match(manifest, /spreadsheets\.currentonly/);
  assert.match(manifest, /script\.external_request/);
  assert.doesNotMatch(manifest, /auth\/spreadsheets"/);
});

test('PWA is party-first jewellery khata, not journal modules', () => {
  const js = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(pwa, 'styles.css'), 'utf8');
  assert.match(js, /Hume dena/);
  assert.match(js, /Unse lena/);
  assert.match(js, /data-view="parties"/);
  assert.match(js, /data-view="report"/);
  assert.match(js, /data-view="masters"/);
  assert.match(js, /metalMaster/);
  assert.match(js, /shop-nav/);
  assert.match(js, /Give metal|Metal diya/);
  assert.match(js, /New shop/);
  assert.match(js, /copy-script|Copy script/);
  assert.match(js, /admitUnlock/);
  assert.match(js, /pin-pad/);
  assert.match(js, /shopLock/);
  assert.match(js, /applyPinKey/);
  assert.match(js, /shouldHandlePinKeyboard/);
  assert.match(js, /desk-col/);
  assert.match(js, /buildDemoLedger/);
  assert.match(js, /data-action="seed-demo"/);
  assert.match(js, /appbar-end[\s\S]{0,500}data-action="refresh"/);
  assert.match(js, /Refresh data/);
  assert.match(js, /toSessionUnlock/);
  assert.match(js, /dedupePartyLedger/);
  assert.match(js, /splitDeal/);
  assert.match(js, /data-view="help"/);
  assert.match(js, /How this works/);
  assert.match(js, /data-metal-row/);
  assert.match(js, /resolveTourClick/);
  assert.match(js, /applyTourNav/);
  assert.doesNotMatch(js, /tour-card[^\n]*stopPropagation/);
  assert.doesNotMatch(js, /onclick="event\.stopPropagation\(\)"/);
  assert.doesNotMatch(js, /suppliers\.length && !state\.money\.length[\s\S]{0,120}seedDemoIntoSheet/);
  assert.doesNotMatch(js, /seedDemoIntoSheet\(\{\s*silent:\s*true/);
  assert.doesNotMatch(js, /rememberedPinOk/);
  assert.doesNotMatch(js, /data-view="dashboard"/);
  assert.match(css, /shop-nav/);
  assert.match(css, /min-width: 768px/);
  assert.match(css, /min-width: 1024px/);
  assert.match(css, /pin-pad/);
  assert.match(css, /desk-col/);
  assert.match(css, /--radius:\s*0/);
  assert.match(css, /desk-split\.fill[\s\S]{0,180}grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.pin-entry[\s\S]{0,400}letter-spacing/);
  assert.doesNotMatch(css, /\.pin-label\s*\{[^}]*clip:\s*rect/);
});
