import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HEADERS } from '../pwa/sheet-model.js';

const pwa = path.join(process.cwd(), 'pwa');

test('PWA shell files exist for installable Sheets app', () => {
  for (const file of ['index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'service-worker.js', 'icon.svg', 'apps-script-url.txt', 'google-apps-script.gs', 'karigar-licenses.gs', 'license-url.txt', 'sheets-client.js', 'shop-auth.js', 'session-cache.js', 'tour.js', 'party-khata-print.js', 'customer-math.js', 'photo.js', 'tokens.css', 'base.css', 'about.html', 'favicon.svg', 'favicon-32.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'App.html', 'appsscript.json']) {
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
  assert.match(gs, /action === "clearDemo"/);
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
  assert.match(js, /LABEL\.weGet/);
  assert.doesNotMatch(js, /Unse lena/);
  assert.match(js, /data-view="parties"/);
  assert.match(js, /data-view="report"/);
  assert.match(js, /data-view="masters"/);
  assert.match(js, /metalMaster/);
  assert.match(js, /shop-nav/);
  assert.match(js, /LABEL\.supplier\.metalGiven/);
  assert.doesNotMatch(js, /Metal diya|Metal aaya|Gave metal|Got metal/);
  assert.match(js, /New shop/);
  assert.match(js, /copy-script|Copy script/);
  assert.match(js, /admitUnlock/);
  assert.match(js, /shopLock/);
  assert.doesNotMatch(js, /pin-pad|applyPinKey|shouldHandlePinKeyboard|lockDigits/);
  assert.match(js, /name="shopLock" class="pin-entry" type="password" inputmode="numeric"/);
  assert.doesNotMatch(js, /pinEntry\.oninput/);
  assert.match(js, /desk-col/);
  assert.match(js, /assertPartyName/);
  assert.match(js, /data-action="seed-demo"/);
  assert.match(js, /data-action="strip-demo"/);
  assert.match(js, /action:\s*['"]seedDemo['"]/);
  assert.match(js, /action:\s*['"]clearDemo['"]/);
  assert.doesNotMatch(js, /buildDemoLedger/);
  assert.doesNotMatch(js, /replaceDemoLedger/);
  assert.doesNotMatch(js, /mergeDemoLedger/);
  assert.match(js, /appbar-end[\s\S]{0,500}data-action="refresh"/);
  assert.match(js, /Refresh data/);
  assert.match(js, /toSessionUnlock/);
  assert.match(js, /dedupePartyLedger/);
  assert.match(js, /partyDisplayName/);
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
  assert.doesNotMatch(css, /pin-pad/);
  assert.match(css, /desk-col/);
  assert.match(css.split('\n').find((l) => l.trim()), /^\/\* Hallmark · shape: app screen/);
  assert.match(css, /@import url\("\.\/tokens\.css"\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /--control:\s*46px/);
  assert.match(css, /@media print/);
  assert.match(css, /\.print-head/);
  assert.doesNotMatch(css, /text-transform:\s*uppercase/);
  assert.match(css, /\.pin-entry[\s\S]{0,400}letter-spacing/);
  assert.doesNotMatch(css, /\.pin-label\s*\{[^}]*clip:\s*rect/);
});

test('customers, sales, categories and photos are wired through the app', () => {
  const js = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
  assert.match(js, /data-view="customers"/);
  assert.match(js, /data-modal="sale"/);
  assert.match(js, /data-modal="return"/);
  assert.match(js, /id="photo-camera"[^>]*capture="environment"/);
  assert.match(js, /action:\s*'uploadPhoto'/);
  assert.match(js, /action:\s*'getPhoto'/);
  assert.match(js, /compressImage/);
  assert.match(js, /data-modal="category"/);
  assert.match(js, /customers:\s*state\.customers/);
  assert.match(js, /sales:\s*state\.sales/);
  assert.match(js, /categories:\s*state\.categories/);
});

test('Apps Script stores customers, sales, categories and photos in Drive', () => {
  const gs = fs.readFileSync(path.join(pwa, 'google-apps-script.gs'), 'utf8');
  for (const tab of ['Customers', 'Sales', 'Categories', 'CustomerKhata']) assert.match(gs, new RegExp(`${tab}:`));
  for (const col of HEADERS.Sales) assert.match(gs, new RegExp(`"${col}"`));
  assert.match(gs, /action === "uploadPhoto"/);
  assert.match(gs, /action === "getPhoto"/);
  assert.match(gs, /action === "deletePhoto"/);
  assert.match(gs, /DriveApp\.createFolder/);
  assert.match(gs, /Array\.isArray\(body\.customers\)/);
  const manifest = fs.readFileSync(path.join(pwa, 'appsscript.json'), 'utf8');
  assert.match(manifest, /auth\/drive"/);
  assert.equal(fs.readFileSync(path.join(pwa, 'google-apps-script.gs'), 'utf8'), fs.readFileSync(path.join(process.cwd(), 'google-apps-script.gs'), 'utf8'));
});

test('existing shops get a guided one-time Sheet update with PIN and license filled in', () => {
  const js = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
  assert.match(js, /data-modal="updateSheet"/);
  assert.match(js, /copy-update-script/);
  assert.match(js, /copy-update-manifest/);
  assert.match(js, /fillScriptConstants\(await res\.text\(\), \{ pin: state\.pin, licenseKey: key/);
  assert.match(js, /scriptOutdated/);
});

test('security: Drive access is confined, PIN guessing is throttled, writes are serialised', () => {
  const gs = fs.readFileSync(path.join(pwa, 'google-apps-script.gs'), 'utf8');
  // only files inside Karigar's own photo folder can be read or trashed
  assert.match(gs, /function assertPhotoFile_/);
  assert.match(gs, /const file = DriveApp\.getFileById\(id\);\s*assertPhotoFile_\(file\);/);
  assert.match(gs, /file = DriveApp\.getFileById\(id\);\s*assertPhotoFile_\(file\);\s*file\.setTrashed/);
  // PIN lockout and constant-time compare
  assert.match(gs, /MAX_PIN_FAILS/);
  assert.match(gs, /Too many wrong PINs/);
  assert.match(gs, /sameText_\(/);
  // two phones saving at once must not interleave
  assert.match(gs, /LockService\.getScriptLock\(\)/);
  for (const action of ['save', 'uploadPhoto', 'deletePhoto', 'seedDemo', 'clearDemo']) assert.match(gs, new RegExp(`"${action}"`));
  const js = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
  assert.match(js, /safeSheetUrl/);
  assert.doesNotMatch(js, /href="\$\{esc\(state\.spreadsheetUrl\)\}"/);
});

test('exported CSV cannot run a customer name as a spreadsheet formula', async () => {
  const { reportCsv } = await import('../pwa/ledger-math.js');
  const out = reportCsv({ lines: [{ date: '2026-01-01', name: '=HYPERLINK("http://x")', label: '+cmd', fig: 5 }, { date: '2026-01-02', name: 'Anita', label: 'Metal aaya', fig: -60, kind: 'metal' }] });
  const rows = out.split('\n');
  assert.match(rows[1], /"'=HYPERLINK/);
  assert.match(rows[1], /"'\+cmd"/);
  assert.match(rows[2], /"Anita"/);
  assert.match(rows[2], /"-60 g"/);
});

test('customers, suppliers and metals are named the same way on every screen', () => {
  const js = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
  assert.doesNotMatch(js, /Add party|No parties yet|Search parties|Edit party|Delete party|Party name/);
  assert.match(js, /Add supplier/);
  assert.match(js, /titleCase\(t\)/);
});

test('installable icons exist as PNG, the favicon and home-screen icon are wired, and iOS gets a PNG', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pwa, 'manifest.webmanifest'), 'utf8'));
  const purposes = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`);
  assert.ok(purposes.includes('192x192:any'));
  assert.ok(purposes.includes('512x512:any'));
  assert.ok(purposes.includes('512x512:maskable'));
  for (const icon of manifest.icons) assert.equal(fs.existsSync(path.join(pwa, icon.src)), true, icon.src);
  const png = (file) => fs.readFileSync(path.join(pwa, file));
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
    const b = png(file);
    assert.equal(b.subarray(1, 4).toString(), 'PNG', file);
    assert.equal(b.readUInt32BE(16), size, `${file} width`);
    assert.equal(b.readUInt32BE(20), size, `${file} height`);
  }
  const html = fs.readFileSync(path.join(pwa, 'index.html'), 'utf8');
  assert.match(html, /rel="apple-touch-icon" href="\.\/apple-touch-icon\.png"/);
  assert.match(html, /rel="icon" type="image\/svg\+xml" href="\.\/favicon\.svg"/);
  assert.doesNotMatch(html, /apple-touch-icon" href="\.\/icon\.svg"/);
});

test('the About page carries the disclaimer, privacy and support details and is reachable from the app', () => {
  const about = fs.readFileSync(path.join(pwa, 'about.html'), 'utf8');
  for (const id of ['support', 'disclaimer', 'privacy']) assert.match(about, new RegExp(`id="${id}"`));
  assert.match(about, /mailto:manthangandhi0@gmail\.com/);
  assert.match(about, /Never send your shop PIN or your license key/);
  assert.match(about, /not your dealer’s rate/);
  assert.match(about, /id="rates"/);
  assert.match(about, /id="pin"/);
  assert.match(about, /import duty/);
  assert.match(about, /not investment advice/);
  assert.match(about, /gold-api\.com/);
  const js = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
  assert.ok((js.match(/href="\.\/about\.html"/g) || []).length >= 2); // sign-in screens and the Sheet page
  const sw = fs.readFileSync(path.join(pwa, 'service-worker.js'), 'utf8');
  assert.match(sw, /about\.html/);
});

test('the shop name in the header may wrap to two lines instead of being cut off', () => {
  const css = fs.readFileSync(path.join(pwa, 'styles.css'), 'utf8');
  assert.match(css, /\.appbar \.brand span:last-child \{[^}]*-webkit-line-clamp: 2/);
  assert.match(css, /\.appbar-end \{ flex: 0 0 auto; \}/);
});

test('the sign-in screens share one branded split layout with icons, and the PIN keeps the native keyboard', () => {
  const js = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
  assert.match(js, /class="lock-hero"/);
  assert.match(js, /class="lock-panel"/);
  assert.match(js, /id="show-pin" aria-pressed="false"/);
  assert.match(js, /ic\('lock'\)\}<span>Unlock<\/span>/);
  assert.match(js, /name="shopLock" class="pin-entry" type="password" inputmode="numeric"/);
  assert.equal((js.match(/<div class="brand"><span class="brand-mark">/g) || []).length, 2); // the sign-in hero and the app header
});

test('Today fills the page with the CRM widgets and person pages put the ledger beside the details', () => {
  const js = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
  for (const cls of ['glance', 'w-follow', 'w-dates', 'w-collect', 'w-pay', 'w-rates']) assert.match(js, new RegExp(cls));
  assert.equal((js.match(/class="detail-grid"/g) || []).length, 2);
  assert.match(js, /crm\.quick/);
  assert.match(js, /crm\.details/);
  const css = fs.readFileSync(path.join(pwa, 'styles.css'), 'utf8');
  assert.match(css, /\.detail-grid \{ grid-template-columns: minmax\(0, 1fr\) 340px/);
});

test('buttons, chips and the add button carry an icon beside the label', () => {
  const js = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
  assert.doesNotMatch(js, />Save<\/button>/);
  assert.match(js, /ic\('check'\)\}<span>Save<\/span>/);
  assert.match(js, /ic\('trash'\)\}<span>Delete/);
  assert.match(js, /ic\('plus'\)\}<span>Add customer<\/span>/);
  assert.match(js, /ic\('plus'\)\}<span>Add supplier<\/span>/);
  assert.match(js, /\[\['all', 'All', 'list'\], \['owe', LABEL\.weGet, 'rupee'\], \['vip', 'VIP', 'star'\], \['follow', 'Follow-up', 'bell'\]\]/);
});

test('saves are checked for staleness so one device cannot wipe out another, and unsaved rows survive a refresh', () => {
  const gs = fs.readFileSync(path.join(pwa, 'google-apps-script.gs'), 'utf8');
  assert.match(gs, /STALE: the Sheet changed/);
  assert.match(gs, /expected && stored && expected !== stored/);
  const js = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
  assert.match(js, /expect: state\.lastSavedAt/);
  assert.match(js, /\/STALE\/\.test/);
  assert.match(js, /function mergeRemote/);
  assert.match(js, /state\.dirty = keep\.dirty/);
  assert.match(js, /state\.lastSavedAt = now;/);
});

test('backup download, install help and PIN help are reachable', () => {
  const js = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
  assert.match(js, /data-action="backup"/);
  assert.match(js, /karigar-backup-/);
  assert.match(js, /beforeinstallprompt/);
  assert.match(js, /about\.html#pin/);
  const about = fs.readFileSync(path.join(pwa, 'about.html'), 'utf8');
  assert.match(about, /SCRIPT_PIN/);
});

test('the sign-in screen shows live rates from the public feeds before anyone unlocks', () => {
  const js = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
  assert.match(js, /function loginRatesHtml/);
  assert.match(js, /id="lock-rates"/);
  assert.match(js, /updateLoginRates/);
});
