/**
 * YOUR license API (not the shop ledger).
 * 1. Create a Google Sheet in YOUR Drive. Name it Karigar licenses.
 * 2. Paste this file as Apps Script. Set LICENSES_SHEET_ID to that Sheet id.
 * 3. Run initLicenses; Allow Sheets.
 * 4. Deploy → Web app → Execute as: Me → Anyone. Copy /exec.
 * 5. Put that /exec in pwa/license-url.txt (the shop PWA bakes it into Copy script).
 *
 * New shop (before they pay):
 *   Run issueTrial('Mehta Jewellers', '98xxxxxxxx') in this editor.
 *   Status TRIAL, trialEndsAt = today + 30 days. WhatsApp them the licenseKey.
 *
 * They pay:
 *   Run markPaid('the-key') — status ACTIVE, paidUntil = today + 30 days.
 *
 * They stop paying / 30 days lapse:
 *   Next verify writes status INACTIVE. Their khata file is untouched.
 *
 * Optional: Triggers → From this script → expireStaleLicenses → Day timer 1.
 */
const LICENSES_SHEET_ID = "PASTE_LICENSES_SHEET_ID_HERE";
const TRIAL_DAYS = 30;
const HEADERS = ["licenseKey", "shopName", "phone", "status", "trialEndsAt", "paidUntil", "notes", "createdAt", "updatedAt"];

function licensesSpreadsheet_() {
  const raw = String(LICENSES_SHEET_ID || "").trim();
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const fromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = fromUrl ? fromUrl[1] : raw;
  return SpreadsheetApp.openById(id);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return jsonOut_({ ok: true, hint: "Karigar license API. POST {action:verify,key}." });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : "{}");
    if (body.action === "verify") return jsonOut_(verifyLicense_(body.key));
    return jsonOut_({ ok: false, error: "Invalid action" });
  } catch (err) {
    return jsonOut_({ ok: false, allowed: false, error: String(err) });
  }
}

function initLicenses() {
  const ss = licensesSpreadsheet_();
  ss.setName(ss.getName().indexOf("Karigar") === 0 ? ss.getName() : "Karigar licenses");
  let sheet = ss.getSheetByName("Licenses");
  if (!sheet) sheet = ss.insertSheet("Licenses");
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#3f1018").setFontColor("#f8e7c8");
  sheet.setFrozenRows(1);
  const def = ss.getSheetByName("Sheet1");
  if (def && def.getLastRow() <= 1) ss.deleteSheet(def);
  return { ok: true, spreadsheetUrl: ss.getUrl() };
}

function trialEndIso_(fromDate, days) {
  const d = fromDate instanceof Date ? new Date(fromDate.getTime()) : new Date(fromDate);
  d.setUTCDate(d.getUTCDate() + Number(days || TRIAL_DAYS));
  return d.toISOString();
}

function licenseCurrentlyAllowed_(status, trialEndsAt, paidUntil, createdAt, now) {
  const s = String(status || "").trim().toUpperCase();
  const t = now || Date.now();
  if (s === "TRIAL") {
    const endRaw = trialEndsAt || (createdAt ? trialEndIso_(createdAt, TRIAL_DAYS) : "");
    const end = Date.parse(endRaw);
    return isFinite(end) && t <= end;
  }
  if (s === "ACTIVE") {
    if (!paidUntil) return true;
    const end = Date.parse(paidUntil);
    return isFinite(end) ? t <= end : true;
  }
  return false;
}

function headerIndex_(headers, name) {
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || "").trim() === name) return i;
  }
  return -1;
}

function isoCell_(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function verifyLicense_(key) {
  const want = String(key || "").trim();
  if (!want) return { ok: true, allowed: false, error: "Missing license key" };
  const sheet = licensesSpreadsheet_().getSheetByName("Licenses");
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, allowed: false, error: "Unknown license" };
  const width = Math.max(sheet.getLastColumn(), HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  const iKey = headerIndex_(headers, "licenseKey");
  const iStatus = headerIndex_(headers, "status");
  const iTrial = headerIndex_(headers, "trialEndsAt");
  const iPaid = headerIndex_(headers, "paidUntil");
  const iCreated = headerIndex_(headers, "createdAt");
  const iUpdated = headerIndex_(headers, "updatedAt");
  const iName = headerIndex_(headers, "shopName");
  if (iKey < 0 || iStatus < 0) return { ok: true, allowed: false, error: "Licenses headers missing. Run initLicenses." };
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  for (let i = 0; i < values.length; i++) {
    const rowKey = String(values[i][iKey] || "").trim();
    if (rowKey !== want) continue;
    let status = String(values[i][iStatus] || "").trim().toUpperCase();
    const trialEndsAt = iTrial >= 0 ? isoCell_(values[i][iTrial]) : "";
    const paidUntil = iPaid >= 0 ? isoCell_(values[i][iPaid]) : "";
    const createdAt = iCreated >= 0 ? isoCell_(values[i][iCreated]) : "";
    const allowed = licenseCurrentlyAllowed_(status, trialEndsAt, paidUntil, createdAt, Date.now());
    if (!allowed && (status === "TRIAL" || status === "ACTIVE")) {
      status = "INACTIVE";
      sheet.getRange(i + 2, iStatus + 1).setValue("INACTIVE");
      if (iUpdated >= 0) sheet.getRange(i + 2, iUpdated + 1).setValue(new Date().toISOString());
    }
    return {
      ok: true,
      allowed: allowed,
      status: status,
      shopName: iName >= 0 ? String(values[i][iName] || "") : "",
      trialEndsAt: trialEndsAt,
      paidUntil: paidUntil
    };
  }
  return { ok: true, allowed: false, error: "Unknown license" };
}

function issueTrial(shopName, phone) {
  const name = String(shopName || "").trim();
  if (!name) throw new Error("Pass the shop name: issueTrial('Mehta Jewellers', '98xxxxxxxx')");
  initLicenses();
  const sheet = licensesSpreadsheet_().getSheetByName("Licenses");
  const now = new Date();
  const key = "k-" + Utilities.getUuid().replace(/-/g, "").slice(0, 10);
  const trialEndsAt = trialEndIso_(now, TRIAL_DAYS);
  sheet.appendRow([key, name, String(phone || "").trim(), "TRIAL", trialEndsAt, "", "30-day trial", now.toISOString(), now.toISOString()]);
  return { ok: true, licenseKey: key, status: "TRIAL", trialEndsAt: trialEndsAt, shopName: name };
}

function markPaid(licenseKey, days) {
  const want = String(licenseKey || "").trim();
  if (!want) throw new Error("Pass the license key: markPaid('k-…')");
  const sheet = licensesSpreadsheet_().getSheetByName("Licenses");
  if (!sheet || sheet.getLastRow() < 2) throw new Error("No licenses yet");
  const width = Math.max(sheet.getLastColumn(), HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  const iKey = headerIndex_(headers, "licenseKey");
  const iStatus = headerIndex_(headers, "status");
  const iPaid = headerIndex_(headers, "paidUntil");
  const iUpdated = headerIndex_(headers, "updatedAt");
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  const now = new Date();
  const paidUntil = trialEndIso_(now, days || TRIAL_DAYS);
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][iKey] || "").trim() !== want) continue;
    sheet.getRange(i + 2, iStatus + 1).setValue("ACTIVE");
    if (iPaid >= 0) sheet.getRange(i + 2, iPaid + 1).setValue(paidUntil);
    if (iUpdated >= 0) sheet.getRange(i + 2, iUpdated + 1).setValue(now.toISOString());
    return { ok: true, licenseKey: want, status: "ACTIVE", paidUntil: paidUntil };
  }
  throw new Error("Unknown license key");
}

function expireStaleLicenses() {
  const sheet = licensesSpreadsheet_().getSheetByName("Licenses");
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, expired: 0 };
  const width = Math.max(sheet.getLastColumn(), HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  const iStatus = headerIndex_(headers, "status");
  const iTrial = headerIndex_(headers, "trialEndsAt");
  const iPaid = headerIndex_(headers, "paidUntil");
  const iCreated = headerIndex_(headers, "createdAt");
  const iUpdated = headerIndex_(headers, "updatedAt");
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  const now = Date.now();
  let expired = 0;
  for (let i = 0; i < values.length; i++) {
    const status = String(values[i][iStatus] || "").trim().toUpperCase();
    const trialEndsAt = iTrial >= 0 ? isoCell_(values[i][iTrial]) : "";
    const paidUntil = iPaid >= 0 ? isoCell_(values[i][iPaid]) : "";
    const createdAt = iCreated >= 0 ? isoCell_(values[i][iCreated]) : "";
    if (licenseCurrentlyAllowed_(status, trialEndsAt, paidUntil, createdAt, now)) continue;
    if (status !== "TRIAL" && status !== "ACTIVE") continue;
    sheet.getRange(i + 2, iStatus + 1).setValue("INACTIVE");
    if (iUpdated >= 0) sheet.getRange(i + 2, iUpdated + 1).setValue(new Date().toISOString());
    expired++;
  }
  return { ok: true, expired: expired };
}
