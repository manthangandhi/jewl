/**
 * Bound to THIS jewellery Sheet: Extensions → Apps Script (not a standalone project).
 * 1. Set SCRIPT_PIN, LICENSE_KEY, LICENSE_URL.
 * 2. Gear → Project Settings → Show "appsscript.json". Scopes:
 *    spreadsheets.currentonly
 *    script.external_request
 * 3. Run authorizeKarigar → Allow (this spreadsheet + Connect to an external service).
 * 4. Run initLedger to create tabs.
 * 5. Deploy → Web app → Execute as Me → Anyone. Copy /exec into the PWA.
 * 6. After any Code.gs change: Deploy → Manage deployments → pencil → New version.
 * Do not open /exec in a tab. This file only uses the bound spreadsheet.
 */
const SCRIPT_PIN = "PASTE_SHOP_PIN_HERE";
const LICENSE_KEY = "PASTE_LICENSE_KEY_HERE";
const LICENSE_URL = "PASTE_LICENSE_URL_HERE";
const SCRIPT_VERSION = "2026-09-18-karigar-cols";
const LOCAL_TIMEZONE = "Asia/Kolkata";

const HEADERS = {
  _Meta: ["key", "value"],
  Suppliers: ["name", "phone", "city", "notes", "status", "createdAt", "updatedAt", "id"],
  Money: ["date", "supplierName", "type", "amountInr", "note", "createdAt", "updatedAt", "supplierId", "id"],
  Metal: ["date", "supplierName", "direction", "metalType", "purity", "weightGrams", "note", "createdAt", "updatedAt", "supplierId", "id"],
  Settlements: ["date", "supplierName", "moneyAmountInr", "metalType", "purity", "metalGrams", "note", "createdAt", "updatedAt", "supplierId", "id"],
  Khata: ["supplierName", "status", "moneyDirection", "moneyInr", "gold24k", "gold22k", "gold18k", "gold14k", "silver999", "silver925", "weOweInr", "theyOweInr", "updatedAt", "supplierId"],
  MetalMaster: ["metalType", "purity", "rateInrPerGram", "status", "createdAt", "updatedAt", "id"]
};

const TAB_ORDER = ["Khata", "Suppliers", "Money", "Metal", "Settlements", "MetalMaster", "_Meta"];

function spreadsheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("This script is not bound to the jewellery Sheet. Open that Sheet → Extensions → Apps Script and paste Code.gs there. Do not create a standalone script.");
  }
  return ss;
}

function authorizeKarigar() {
  spreadsheet_();
  const url = String(LICENSE_URL || "").trim();
  try {
    if (url && url.indexOf("PASTE_") !== 0) {
      UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "text/plain;charset=utf-8",
        payload: JSON.stringify({ action: "verify", key: "ping" }),
        muteHttpExceptions: true,
        followRedirects: true
      });
    } else {
      UrlFetchApp.fetch("https://www.google.com", { muteHttpExceptions: true });
    }
  } catch (err) {
    throw new Error("Allow “Connect to an external service”, then run authorizeKarigar again. " + String(err));
  }
  return { ok: true, boundSheet: spreadsheet_().getName() };
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Karigar")
    .addItem("Authorise this Sheet", "authorizeKarigar")
    .addItem("Create tabs", "initLedger")
    .addItem("Load sample khata (demo only)", "seedDemo")
    .addItem("Remove sample khata", "clearDemo")
    .addToUi();
}

function spreadsheetUrl_() {
  return spreadsheet_().getUrl();
}

function doGet() {
  return jsonOut_({
    ok: false,
    unlocked: false,
    version: SCRIPT_VERSION,
    error: "This web app URL does not unlock on GET. Wrong shop PIN or the request did not include the PIN.",
    hint: "This URL is an API. Use the Karigar PWA; it POSTs {action, pin}. Opening this tab does not unlock the shop."
  });
}

function assertPin_(body) {
  const need = String(SCRIPT_PIN || "").trim();
  if (!need || need.indexOf("PASTE_") === 0) {
    throw new Error("Set SCRIPT_PIN at the top of this script. The ledger will not open without it.");
  }
  if (String((body && body.pin) || "").trim() !== need) {
    throw new Error("Wrong shop PIN");
  }
}

function assertLicense_() {
  const key = String(LICENSE_KEY || "").trim();
  const url = String(LICENSE_URL || "").trim();
  if (!key || key.indexOf("PASTE_") === 0 || !url || url.indexOf("PASTE_") === 0) {
    throw new Error("This shop is not licensed. Pay for Karigar and enter the license key from your provider.");
  }
  const cache = CacheService.getScriptCache();
  const cacheId = "lic:" + key;
  const hit = cache.get(cacheId);
  if (hit === "1") return;
  if (hit === "0") throw new Error("Karigar is paused for this shop. Contact your Karigar provider.");
  let res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "text/plain;charset=utf-8",
      payload: JSON.stringify({ action: "verify", key: key }),
      muteHttpExceptions: true,
      followRedirects: true
    });
  } catch (err) {
    throw new Error("You do not have permission to call UrlFetchApp.fetch. Required permissions: https://www.googleapis.com/auth/script.external_request");
  }
  let data = {};
  try { data = JSON.parse(res.getContentText() || "{}"); } catch (err) { data = {}; }
  const status = String((data && data.status) || "").toUpperCase();
  const allowed = data && data.allowed === true && (status === "" || status === "ACTIVE" || status === "TRIAL");
  if (!allowed) {
    cache.put(cacheId, "0", 60);
    throw new Error("Karigar is paused for this shop. Contact your Karigar provider.");
  }
  cache.put(cacheId, "1", 300);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : "{}");
    assertPin_(body);
    assertLicense_();
    if (body.action === "unlock") return jsonOut_({ ok: true, unlocked: true, version: SCRIPT_VERSION });
    if (body.action === "init") return jsonOut_(initLedger());
    if (body.action === "load") return jsonOut_(loadLedger_());
    if (body.action === "save") return jsonOut_(saveLedger_(body));
    if (body.action === "seedDemo") return jsonOut_(seedDemoLedger_({ force: Boolean(body.force), replace: body.replace !== false }));
    if (body.action === "clearDemo") return jsonOut_(clearDemoLedger_());
    return jsonOut_(loadLedger_());
  } catch (err) {
    return jsonOut_({ ok: false, unlocked: false, error: String(err) });
  }
}

function initLedger() {
  const ss = spreadsheet_();
  ss.setName(ss.getName().indexOf("Karigar") === 0 ? ss.getName() : "Karigar ledger");
  TAB_ORDER.forEach(function (name) {
    const sheet = getOrCreateSheet_(name);
    ensureHeaders_(sheet, HEADERS[name]);
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), HEADERS[name].length).setNumberFormat("@");
  });
  seedMetaIfEmpty_();
  hideUnusedDefaultSheet_();
  hideLegacyBalances_();
  return {
    ok: true,
    version: SCRIPT_VERSION,
    spreadsheetUrl: spreadsheetUrl_(),
    tabs: TAB_ORDER
  };
}

function seedDemo() {
  return seedDemoLedger_({ replace: true });
}

function seedDemoForce() {
  return seedDemoLedger_({ force: true, replace: true });
}

function clearDemo() {
  return clearDemoLedger_();
}

function isoDaysAgo_(n) {
  const d = new Date();
  d.setDate(d.getDate() - Number(n || 0));
  return Utilities.formatDate(d, LOCAL_TIMEZONE, "yyyy-MM-dd");
}

function demoStamp_(n) {
  const date = isoDaysAgo_(n);
  const ts = date + " 10:00:00";
  return { date: date, createdAt: ts, updatedAt: ts };
}

function demoLedger_() {
  const t = demoStamp_;
  const names = {
    "demo-ramesh": "Ramesh Karigar",
    "demo-suresh": "Suresh Jewels",
    "demo-mehta": "Mehta Silver House",
    "demo-fatima": "Fatima Polishing Works",
    "demo-gupta": "Gupta Casting Co",
    "demo-kiran": "Kiran Chain Maker"
  };
  function party(id, name, phone, city, notes, ago) {
    const s = t(ago);
    return { id: id, name: name, phone: phone, city: city, notes: notes, status: "ACTIVE", createdAt: s.createdAt, updatedAt: s.updatedAt };
  }
  function money(id, supplierId, type, amount, note, ago) {
    const s = t(ago);
    return { id: id, supplierId: supplierId, supplierName: names[supplierId] || "", type: type, amountInr: amount, note: note, date: s.date, createdAt: s.createdAt, updatedAt: s.updatedAt };
  }
  function metal(id, supplierId, direction, metalType, purity, grams, note, ago) {
    const s = t(ago);
    return { id: id, supplierId: supplierId, supplierName: names[supplierId] || "", direction: direction, metalType: metalType, purity: purity, weightGrams: grams, note: note, date: s.date, createdAt: s.createdAt, updatedAt: s.updatedAt };
  }
  function settle(id, supplierId, cash, metalType, purity, grams, note, ago) {
    const s = t(ago);
    return { id: id, supplierId: supplierId, supplierName: names[supplierId] || "", moneyAmountInr: cash, metalType: metalType || "", purity: purity || "", metalGrams: grams || 0, note: note, date: s.date, createdAt: s.createdAt, updatedAt: s.updatedAt };
  }
  const now = t(0);
  return {
    shopName: "Mehta Jewellers",
    suppliers: [
      party("demo-ramesh", "Ramesh Karigar", "98200 11122", "Mumbai", "22K jobwork — Zaveri Bazaar", 90),
      party("demo-suresh", "Suresh Jewels", "98765 44001", "Ahmedabad", "Wholesale gold supplier", 90),
      party("demo-mehta", "Mehta Silver House", "90909 22110", "Rajkot", "Silver 999 / 925", 90),
      party("demo-fatima", "Fatima Polishing Works", "99887 66554", "Surat", "Polishing — often takes advance", 90),
      party("demo-gupta", "Gupta Casting Co", "98111 77882", "Jaipur", "18K casting", 90),
      party("demo-kiran", "Kiran Chain Maker", "97654 33009", "Kolhapur", "Machine chain", 90)
    ],
    money: [
      money("demo-m-r-op", "demo-ramesh", "OPENING", 185000, "Opening — old jobwork", 88),
      money("demo-m-s-op", "demo-suresh", "OPENING", 210000, "Opening — gold supply", 88),
      money("demo-m-f-op", "demo-fatima", "PAYMENT", 50000, "Advance for polishing", 85),
      money("demo-m-k-op", "demo-kiran", "OPENING", 40000, "Opening", 84),
      money("demo-m-s-p1", "demo-suresh", "PURCHASE", 450000, "22K kada lot", 80),
      money("demo-m-r-p1", "demo-ramesh", "PURCHASE", 95000, "Finished sets received", 64),
      money("demo-m-s-pay1", "demo-suresh", "PAYMENT", 200000, "RTGS part payment", 58),
      money("demo-m-g-op", "demo-gupta", "OPENING", 72000, "Opening casting", 50),
      money("demo-m-s-p2", "demo-suresh", "PURCHASE", 320000, "24K coin + bar", 40),
      money("demo-m-r-pay1", "demo-ramesh", "PAYMENT", 50000, "Cash on counter", 36),
      money("demo-m-m-p1", "demo-mehta", "PURCHASE", 68000, "Silver payal lot", 33),
      money("demo-m-k-p1", "demo-kiran", "PURCHASE", 60000, "Chain labour + metal", 28),
      money("demo-m-f-p1", "demo-fatima", "PURCHASE", 12000, "Polishing bill", 24),
      money("demo-m-s-pay2", "demo-suresh", "PAYMENT", 150000, "UPI", 22),
      money("demo-m-r-p2", "demo-ramesh", "PURCHASE", 120000, "Wedding set jobwork", 14),
      money("demo-m-g-p1", "demo-gupta", "PURCHASE", 85000, "18K cast rings", 9),
      money("demo-m-k-pay1", "demo-kiran", "PAYMENT", 70000, "Cleared chain bill", 8),
      money("demo-m-r-pay2", "demo-ramesh", "PAYMENT", 80000, "Part payment", 7),
      money("demo-m-m-p2", "demo-mehta", "PURCHASE", 42000, "925 jewellery", 3),
      money("demo-m-f-p2", "demo-fatima", "PURCHASE", 8000, "Rhodium polish", 2)
    ],
    metal: [
      metal("demo-t-r-op", "demo-ramesh", "OPENING", "GOLD", "22K", 120, "Metal with karigar", 88),
      metal("demo-t-m-op", "demo-mehta", "OPENING", "SILVER", "999", 2000, "Silver with party", 86),
      metal("demo-t-r-i1", "demo-ramesh", "ISSUE", "GOLD", "22K", 80, "Gave for bangles", 75),
      metal("demo-t-g-i1", "demo-gupta", "ISSUE", "GOLD", "18K", 60, "Casting issue", 48),
      metal("demo-t-m-i1", "demo-mehta", "ISSUE", "SILVER", "999", 500, "Gave for payal", 34),
      metal("demo-t-r-i2", "demo-ramesh", "ISSUE", "GOLD", "22K", 40, "Gave for set", 21),
      metal("demo-t-g-r1", "demo-gupta", "RECEIPT", "GOLD", "18K", 40, "Casting returned", 12),
      metal("demo-t-r-r1", "demo-ramesh", "RECEIPT", "GOLD", "22K", 35, "Unused metal back", 6),
      metal("demo-t-m-r1", "demo-mehta", "RECEIPT", "SILVER", "999", 200, "Scrap returned", 4)
    ],
    settlements: [
      settle("demo-x-k1", "demo-kiran", 30000, "", "", 0, "Squared chain account", 5),
      settle("demo-x-r1", "demo-ramesh", 40000, "GOLD", "22K", 20, "Part settle + 20g", 1)
    ],
    metalMaster: [
      { id: "mm-gold-24k", metalType: "GOLD", purity: "24K", rateInrPerGram: 7800, status: "ACTIVE", createdAt: now.createdAt, updatedAt: now.updatedAt },
      { id: "mm-gold-22k", metalType: "GOLD", purity: "22K", rateInrPerGram: 7200, status: "ACTIVE", createdAt: now.createdAt, updatedAt: now.updatedAt },
      { id: "mm-gold-18k", metalType: "GOLD", purity: "18K", rateInrPerGram: 5900, status: "ACTIVE", createdAt: now.createdAt, updatedAt: now.updatedAt },
      { id: "mm-gold-14k", metalType: "GOLD", purity: "14K", rateInrPerGram: 4600, status: "ACTIVE", createdAt: now.createdAt, updatedAt: now.updatedAt },
      { id: "mm-silver-999", metalType: "SILVER", purity: "999", rateInrPerGram: 118, status: "ACTIVE", createdAt: now.createdAt, updatedAt: now.updatedAt },
      { id: "mm-silver-925", metalType: "SILVER", purity: "925", rateInrPerGram: 108, status: "ACTIVE", createdAt: now.createdAt, updatedAt: now.updatedAt }
    ]
  };
}

function isDemoId_(id) {
  return String(id || "").indexOf("demo-") === 0;
}

function dropDemoRows_(rows) {
  return (rows || []).filter(function (row) { return !isDemoId_(row.id); });
}

function seedDemoLedger_(opt) {
  const force = opt && opt.force;
  const replace = opt && opt.replace;
  const existing = readRowsAsObjects_("Suppliers");
  const live = dropDemoRows_(existing);
  if (live.length && !replace && !force) {
    return { ok: true, seeded: false, reason: "already-has-parties", spreadsheetUrl: spreadsheetUrl_() };
  }
  const demo = demoLedger_();
  const existingMeta = metaObject_(readRowsAsObjects_("_Meta"));
  const shopName = String((existingMeta && existingMeta.shopName) || "").trim();
  writeMeta_({ shopName: shopName || demo.shopName || "", schemaVersion: "1" });
  const suppliers = live.concat(demo.suppliers);
  const moneyRows = dropDemoRows_(readRowsAsObjects_("Money")).concat(demo.money);
  const metalRows = dropDemoRows_(readRowsAsObjects_("Metal")).concat(demo.metal);
  const settleRows = dropDemoRows_(readRowsAsObjects_("Settlements")).concat(demo.settlements);
  writeObjectsAsRows_("Suppliers", suppliers);
  writeObjectsAsRows_("Money", moneyRows);
  writeObjectsAsRows_("Metal", metalRows);
  writeObjectsAsRows_("Settlements", settleRows);
  const master = readRowsAsObjects_("MetalMaster");
  const byId = {};
  master.concat(demo.metalMaster).forEach(function (row) { if (row.id) byId[row.id] = row; });
  writeObjectsAsRows_("MetalMaster", Object.keys(byId).map(function (id) { return byId[id]; }));
  writeObjectsAsRows_("Khata", buildKhataRows_(suppliers, moneyRows, metalRows, settleRows));
  return { ok: true, seeded: true, spreadsheetUrl: spreadsheetUrl_(), version: SCRIPT_VERSION };
}

function clearDemoLedger_() {
  const suppliers = dropDemoRows_(readRowsAsObjects_("Suppliers"));
  const moneyRows = dropDemoRows_(readRowsAsObjects_("Money"));
  const metalRows = dropDemoRows_(readRowsAsObjects_("Metal"));
  const settleRows = dropDemoRows_(readRowsAsObjects_("Settlements"));
  writeObjectsAsRows_("Suppliers", suppliers);
  writeObjectsAsRows_("Money", moneyRows);
  writeObjectsAsRows_("Metal", metalRows);
  writeObjectsAsRows_("Settlements", settleRows);
  writeObjectsAsRows_("Khata", buildKhataRows_(suppliers, moneyRows, metalRows, settleRows));
  return { ok: true, cleared: true, spreadsheetUrl: spreadsheetUrl_(), version: SCRIPT_VERSION };
}

function loadLedger_() {
  return {
    ok: true,
    version: SCRIPT_VERSION,
    spreadsheetUrl: spreadsheetUrl_(),
    meta: metaObject_(readRowsAsObjects_("_Meta")),
    suppliers: readRowsAsObjects_("Suppliers"),
    money: readRowsAsObjects_("Money"),
    metal: readRowsAsObjects_("Metal"),
    settlements: readRowsAsObjects_("Settlements"),
    metalMaster: readRowsAsObjects_("MetalMaster")
  };
}

function saveLedger_(body) {
  writeMeta_(body.meta || {});
  writeObjectsAsRows_("Suppliers", Array.isArray(body.suppliers) ? body.suppliers : []);
  writeObjectsAsRows_("Money", Array.isArray(body.money) ? body.money : []);
  writeObjectsAsRows_("Metal", Array.isArray(body.metal) ? body.metal : []);
  writeObjectsAsRows_("Settlements", Array.isArray(body.settlements) ? body.settlements : []);
  writeObjectsAsRows_("MetalMaster", Array.isArray(body.metalMaster) ? body.metalMaster : []);
  writeObjectsAsRows_("Khata", Array.isArray(body.khata) ? body.khata : (Array.isArray(body.balances) ? body.balances : []));
  hideLegacyBalances_();
  return { ok: true, version: SCRIPT_VERSION, spreadsheetUrl: spreadsheetUrl_(), lastSavedAt: formatDateTime_(new Date()) };
}

function seedMetaIfEmpty_() {
  const rows = readRowsAsObjects_("_Meta");
  if (rows.length) return;
  writeMeta_({ shopName: "", schemaVersion: "1", createdAt: formatDateTime_(new Date()) });
}

function writeMeta_(meta) {
  const createdAt = meta.createdAt || formatDateTime_(new Date());
  const records = [
    { key: "shopName", value: String(meta.shopName || "") },
    { key: "schemaVersion", value: String(meta.schemaVersion || "1") },
    { key: "createdAt", value: String(createdAt) },
    { key: "updatedAt", value: formatDateTime_(new Date()) },
    { key: "lastSavedAt", value: String(meta.lastSavedAt || formatDateTime_(new Date())) }
  ];
  writeObjectsAsRows_("_Meta", records);
}

function metaObject_(rows) {
  const out = {};
  (rows || []).forEach(function (row) {
    if (row.key) out[row.key] = row.value || "";
  });
  return out;
}

function getOrCreateSheet_(name) {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function headerIndexMap_(headerRow) {
  const map = {};
  (headerRow || []).forEach(function (h, i) {
    const key = String(h || "").trim();
    if (key && map[key] === undefined) map[key] = i;
  });
  return map;
}

function recordsToAlignedRows_(sheetHeaders, records, canonicalHeaders) {
  const headers = (sheetHeaders || []).map(function (h) { return String(h || "").trim(); });
  const map = headerIndexMap_(headers);
  const width = Math.max(headers.length, 1);
  return (records || []).map(function (record) {
    const row = [];
    let i;
    for (i = 0; i < width; i++) row.push("");
    (canonicalHeaders || []).forEach(function (key) {
      const col = map[key];
      if (col === undefined) return;
      const value = record[key];
      row[col] = value === undefined || value === null ? "" : String(value);
    });
    return row;
  });
}

function metalKeyToKhata_(type, purity) {
  const t = String(type || "").toUpperCase();
  const p = String(purity || "");
  if (t === "GOLD" && p === "24K") return "gold24k";
  if (t === "GOLD" && p === "22K") return "gold22k";
  if (t === "GOLD" && p === "18K") return "gold18k";
  if (t === "GOLD" && p === "14K") return "gold14k";
  if (t === "SILVER" && p === "999") return "silver999";
  if (t === "SILVER" && p === "925") return "silver925";
  return "";
}

function buildKhataRows_(suppliers, money, metal, settlements) {
  const now = formatDateTime_(new Date());
  return (suppliers || []).map(function (supplier) {
    let payable = 0;
    (money || []).forEach(function (row) {
      if (row.supplierId !== supplier.id) return;
      if (row.type === "OPENING" || row.type === "PURCHASE") payable += Number(row.amountInr || 0);
      if (row.type === "PAYMENT") payable -= Number(row.amountInr || 0);
    });
    (settlements || []).forEach(function (row) {
      if (row.supplierId !== supplier.id) return;
      payable -= Number(row.moneyAmountInr || 0);
    });
    const grams = { gold24k: 0, gold22k: 0, gold18k: 0, gold14k: 0, silver999: 0, silver925: 0 };
    (metal || []).forEach(function (row) {
      if (row.supplierId !== supplier.id) return;
      const field = metalKeyToKhata_(row.metalType, row.purity);
      if (!field) return;
      const w = Number(row.weightGrams || 0);
      if (row.direction === "OPENING" || row.direction === "ISSUE") grams[field] += w;
      if (row.direction === "RECEIPT") grams[field] -= w;
    });
    (settlements || []).forEach(function (row) {
      if (row.supplierId !== supplier.id) return;
      const field = metalKeyToKhata_(row.metalType, row.purity);
      if (!field) return;
      grams[field] -= Number(row.metalGrams || 0);
    });
    const dir = payable > 0 ? "Hume dena" : payable < 0 ? "Unse lena" : "Square";
    return {
      supplierName: supplier.name || "",
      status: supplier.status || "ACTIVE",
      moneyDirection: dir,
      moneyInr: Math.abs(payable),
      gold24k: grams.gold24k,
      gold22k: grams.gold22k,
      gold18k: grams.gold18k,
      gold14k: grams.gold14k,
      silver999: grams.silver999,
      silver925: grams.silver925,
      weOweInr: Math.max(0, payable),
      theyOweInr: Math.max(0, -payable),
      updatedAt: now,
      supplierId: supplier.id
    };
  });
}

function ensureHeaders_(sheet, headers) {
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (lastCol > headers.length) {
    sheet.getRange(1, headers.length + 1, 1, lastCol - headers.length).clearContent();
  }
  styleHeader_(sheet, headers.length);
}

function styleHeader_(sheet, width) {
  const range = sheet.getRange(1, 1, 1, width);
  range.setFontWeight("bold");
  range.setBackground("#173b33");
  range.setFontColor("#edf5ef");
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 28);
}

function hideLegacyBalances_() {
  const ss = spreadsheet_();
  const legacy = ss.getSheetByName("Balances");
  if (legacy && ss.getSheetByName("Khata")) legacy.hideSheet();
}

function hideUnusedDefaultSheet_() {
  const ss = spreadsheet_();
  const def = ss.getSheetByName("Sheet1");
  if (!def) return;
  if (def.getLastRow() <= 1 && TAB_ORDER.every(function (name) { return ss.getSheetByName(name); })) {
    ss.deleteSheet(def);
  }
}

function readRowsAsObjects_(name) {
  const headers = HEADERS[name];
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headerRow.forEach(function (h, i) {
    const key = String(h || "").trim();
    if (key && map[key] === undefined) map[key] = i;
  });
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values
    .filter(function (row) {
      return row.some(function (v) { return String(v).trim() !== ""; });
    })
    .map(function (row) {
      const obj = {};
      headers.forEach(function (key) {
        const i = map[key];
        obj[key] = i === undefined ? "" : stringify_(row[i]);
      });
      return obj;
    });
}

function writeObjectsAsRows_(name, records) {
  const headers = HEADERS[name];
  const sheet = getOrCreateSheet_(name);
  ensureHeaders_(sheet, headers);
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const width = Math.max(headerRow.length, headers.length);
  const maxRows = sheet.getMaxRows();
  if (maxRows > 1) sheet.getRange(2, 1, maxRows - 1, width).clearContent();
  if (!records.length) return;
  const rows = recordsToAlignedRows_(headerRow, records, headers);
  sheet.getRange(2, 1, rows.length, width).setNumberFormat("@");
  sheet.getRange(2, 1, rows.length, width).setValues(rows);
}

function stringify_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return formatDateTime_(value);
  if (value === null || value === undefined) return "";
  return String(value);
}

function formatDateTime_(date) {
  return Utilities.formatDate(date, LOCAL_TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
