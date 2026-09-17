import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPassbook } from '../pwa/ledger-math.js';
import {
  buildPartyKhataDoc,
  partyKhataPrintHtml,
  partyKhataPdfBytes,
  partyKhataFilename,
  partyKhataShareText
} from '../pwa/party-khata-print.js';

const party = { id: 'p1', name: 'Ramesh Karigar', phone: '98200 11122' };
const money = [
  { id: 'm1', supplierId: 'p1', type: 'OPENING', amountInr: 100000, date: '2026-06-01', note: 'Opening' },
  { id: 'm2', supplierId: 'p1', type: 'PURCHASE', amountInr: 42000, date: '2026-09-12', note: 'Bill 184' },
  { id: 'm3', supplierId: 'p1', type: 'PAYMENT', amountInr: 20000, date: '2026-09-14', note: 'UPI' }
];
const metal = [
  { id: 't1', supplierId: 'p1', direction: 'ISSUE', metalType: 'GOLD', purity: '22K', weightGrams: 48.2, date: '2026-08-01', note: 'Jobwork' }
];
const passbook = buildPassbook({ supplierId: 'p1', money, metal, settlements: [] });

function sampleDoc() {
  return buildPartyKhataDoc({
    shopName: 'Mehta Jewellers',
    party,
    payable: 122000,
    metalByPurity: { 'GOLD:22K': 48.2 },
    passbook,
    printedAt: new Date('2026-09-18T10:00:00+05:30')
  });
}

test('party khata statement is oldest-first with closing Hume dena and metal', () => {
  const doc = sampleDoc();
  assert.equal(doc.partyName, 'Ramesh Karigar');
  assert.equal(doc.shopName, 'Mehta Jewellers');
  assert.equal(doc.phone, '98200 11122');
  assert.equal(doc.moneyLabel, 'Hume dena');
  assert.equal(doc.moneyInr, 122000);
  assert.match(doc.metalLine, /GOLD 22K/);
  assert.match(doc.metalLine, /48.2/);
  assert.equal(doc.lines[0].label, 'Opening');
  assert.equal(doc.lines.at(-1).label, 'Payment');
  assert.equal(doc.lines.at(-1).runningInr, 122000);
});

test('print HTML is a standalone khata the shop can print or Save as PDF', () => {
  const html = partyKhataPrintHtml(sampleDoc());
  assert.match(html, /Ramesh Karigar/);
  assert.match(html, /Mehta Jewellers/);
  assert.match(html, /Hume dena/);
  assert.match(html, /Bill 184/);
  assert.match(html, /@media print/);
  assert.doesNotMatch(html, /shop-nav/);
});

test('PDF bytes are a real PDF named after the party', () => {
  const doc = sampleDoc();
  const bytes = partyKhataPdfBytes(doc);
  const text = Buffer.from(bytes).toString('latin1');
  assert.equal(bytes[0], 0x25);
  assert.match(text, /^%PDF-/);
  assert.match(text, /Ramesh Karigar/);
  assert.match(text, /Hume dena/);
  assert.match(text, /%%EOF/);
  assert.equal(partyKhataFilename(doc), 'ramesh-karigar-khata.pdf');
});

test('share text is a short WhatsApp hisab if the phone cannot attach a PDF', () => {
  const text = partyKhataShareText(sampleDoc());
  assert.match(text, /Ramesh Karigar/);
  assert.match(text, /Hume dena/);
  assert.match(text, /1,22,000/);
});

test('share attaches a PDF when the browser can share files', async () => {
  const { sharePartyKhataPdf } = await import('../pwa/party-khata-print.js');
  const sent = [];
  const nav = {
    canShare: (data) => Array.isArray(data.files) && data.files[0]?.name.endsWith('.pdf'),
    share: async (data) => { sent.push(data); }
  };
  const result = await sharePartyKhataPdf(sampleDoc(), nav);
  assert.equal(result, 'shared');
  assert.equal(sent[0].files[0].name, 'ramesh-karigar-khata.pdf');
  assert.equal(sent[0].files[0].type, 'application/pdf');
});
