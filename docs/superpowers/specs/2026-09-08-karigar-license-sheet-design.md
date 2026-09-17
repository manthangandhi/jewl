# Karigar license Sheet — design

Date: 2026-09-08  
Status: approved (Approach 1 — operator license spreadsheet)

## Intent

Shop jewellery data stays in the **shop owner’s** Google Sheet.  
**You** decide who may use Karigar. They pay you (UPI/cash/invoice). You set their row to Active or Blocked. No Razorpay in this slice.

## Your control (operator)

One spreadsheet in **your** Drive: tab `Licenses`.

| licenseKey | shopName | phone | status | trialEndsAt | paidUntil | notes | createdAt | updatedAt |
|---|---|---|---|---|---|---|---|---|
| `issueTrial` invents this | Mehta | 98… | TRIAL then ACTIVE / INACTIVE / BLOCKED | now+30d | set by `markPaid` | | | |

You deploy `pwa/karigar-licenses.gs` as a web app (Execute: Me, Anyone). That `/exec` is `LICENSE_URL`. Put it in `pwa/license-url.txt`.

- New shop → run `issueTrial`, status `TRIAL` for 30 days, WhatsApp the key  
- They pay → `markPaid(key)` → `ACTIVE` + `paidUntil` +30 days  
- Window ends unpaid → verify writes `INACTIVE`  
- You never open their khata

## Shop copy

Shop Code.gs includes `LICENSE_URL` and `LICENSE_KEY`. Every unlock/load/save asks your license `/exec`. Denied → Karigar will not open or write. Their Sheet file remains.

A determined person can delete the check from a copied script. Shop 1–5 will not. Do not publish a “no license” fork.

## New shop wizard

Name + PIN → **license key you gave them** → their Sheet link → copy script (id, PIN, key, your license URL filled) → deploy shop `/exec`.

## Out of scope

Razorpay, Node `/admin` as the source of truth, GST, job cards, visual redesign.
