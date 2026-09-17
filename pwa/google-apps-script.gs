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
const SCRIPT_VERSION = "2026-09-09-karigar-bound";
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

function ensureHeaders_(sheet, headers) {
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeader_(sheet, headers.length);
    return;
  }
  const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || "").trim();
  });
  const missing = headers.filter(function (h) {
    return existing.indexOf(h) === -1;
  });
  if (existing[0] === "" && existing.filter(Boolean).length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeader_(sheet, headers.length);
    return;
  }
  if (missing.length) {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  styleHeader_(sheet, Math.max(headers.length, sheet.getLastColumn()));
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
  const width = Math.max(sheet.getLastColumn(), headers.length);
  const maxRows = sheet.getMaxRows();
  if (maxRows > 1) sheet.getRange(2, 1, maxRows - 1, width).clearContent();
  if (!records.length) return;
  const rows = records.map(function (record) {
    return headers.map(function (key) {
      const value = record[key];
      if (value === undefined || value === null) return "";
      return String(value);
    });
  });
  sheet.getRange(2, 1, rows.length, headers.length).setNumberFormat("@");
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
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
