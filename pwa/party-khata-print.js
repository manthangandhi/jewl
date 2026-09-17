const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const g = (v) => `${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })} g`;

function moneyLabel(payable) {
  const n = Number(payable || 0);
  if (n > 0) return { label: 'Hume dena', amount: n };
  if (n < 0) return { label: 'Unse lena', amount: -n };
  return { label: 'Square', amount: 0 };
}

function metalLine(map) {
  const parts = Object.entries(map || {})
    .filter(([, v]) => Number(v) !== 0)
    .map(([key, v]) => `${String(key).replace(':', ' ')} ${g(v)}`);
  return parts.length ? parts.join(' · ') : '—';
}

function fmtDay(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function lineFig(line) {
  if (line.kind === 'metal') return g(line.grams);
  const amt = Math.abs(Number(line.amountInr || 0));
  const extra = line.kind === 'settle' && Number(line.grams) ? ` · ${g(line.grams)}` : '';
  return `${inr(amt)}${extra}`;
}

function lineNote(line) {
  return [line.detail, line.note].filter(Boolean).join(' · ');
}

export function buildPartyKhataDoc({
  shopName,
  party,
  payable,
  metalByPurity,
  passbook,
  printedAt = new Date()
} = {}) {
  const dir = moneyLabel(payable);
  const chronological = [...(passbook || [])].slice().reverse();
  return {
    shopName: String(shopName || 'Karigar').trim() || 'Karigar',
    partyName: String(party?.name || 'Party').trim() || 'Party',
    phone: String(party?.phone || '').trim(),
    printedAt,
    printedLabel: fmtDay(printedAt),
    moneyLabel: dir.label,
    moneyInr: dir.amount,
    metalLine: metalLine(metalByPurity),
    lines: chronological.map((line) => ({
      date: fmtDay(line.date),
      label: line.label || '',
      note: lineNote(line),
      fig: lineFig(line),
      runningInr: Number(line.runningInr || 0)
    }))
  };
}

export function partyKhataFilename(doc) {
  const slug = String(doc?.partyName || 'party')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'party';
  return `${slug}-khata.pdf`;
}

export function partyKhataShareText(doc) {
  const metal = doc.metalLine && doc.metalLine !== '—' ? `\nMetal with party: ${doc.metalLine}` : '';
  return `${doc.shopName} — party khata\n${doc.partyName}\n${doc.moneyLabel}: ${inr(doc.moneyInr)}${metal}`;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (x) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[x]));
}

export function partyKhataPrintHtml(doc) {
  const rows = (doc.lines || []).map((line) => `
    <tr>
      <td>${esc(line.date)}</td>
      <td><strong>${esc(line.label)}</strong>${line.note ? `<small>${esc(line.note)}</small>` : ''}</td>
      <td class="num">${esc(line.fig)}</td>
      <td class="num">${inr(line.runningInr)}</td>
    </tr>`).join('') || '<tr><td colspan="4">No entries</td></tr>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${esc(doc.partyName)} — khata</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 24px;
      font-family: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
      color: #16130f; background: #fff;
    }
    h1 { font-family: Georgia, serif; font-size: 28px; margin: 0 0 4px; }
    .shop { letter-spacing: .14em; text-transform: uppercase; font-size: 11px; color: #6e6658; font-weight: 700; }
    .meta { color: #6e6658; font-size: 13px; margin: 0 0 16px; }
    .totals { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #d9ceb6; margin-bottom: 16px; }
    .totals div { padding: 12px 14px; }
    .totals div + div { border-left: 1px solid #d9ceb6; }
    .totals span { display: block; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #6e6658; font-weight: 700; }
    .totals strong { font-size: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #6e6658; border-bottom: 1px solid #d9ceb6; padding: 8px 6px; }
    td { border-bottom: 1px solid #ece6d8; padding: 8px 6px; vertical-align: top; }
    td small { display: block; color: #6e6658; margin-top: 2px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    footer { margin-top: 24px; font-size: 11px; color: #6e6658; }
    @media print {
      body { padding: 12mm; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <p class="shop">${esc(doc.shopName)}</p>
  <h1>${esc(doc.partyName)}</h1>
  <p class="meta">${doc.phone ? esc(doc.phone) + ' · ' : ''}Party khata · ${esc(doc.printedLabel)}</p>
  <section class="totals">
    <div><span>${esc(doc.moneyLabel)}</span><strong>${inr(doc.moneyInr)}</strong></div>
    <div><span>Metal with party</span><strong>${esc(doc.metalLine)}</strong></div>
  </section>
  <table>
    <thead><tr><th>Date</th><th>Particulars</th><th class="num">Amount</th><th class="num">Hisab</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <footer>Karigar party khata. Books stay in the shop Google Sheet.</footer>
</body>
</html>`;
}

function pdfSafe(value) {
  return String(value ?? '')
    .replace(/₹/g, 'Rs ')
    .replace(/[^\x20-\x7E]/g, (ch) => (ch === '·' ? '-' : ''))
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function pdfPageContent(doc, pageLines, page, pageCount) {
  const ops = [];
  const text = (size, x, y, str) => {
    ops.push(`BT /F1 ${size} Tf ${x} ${y} Td (${pdfSafe(str)}) Tj ET`);
  };
  text(11, 48, 800, doc.shopName);
  text(18, 48, 776, doc.partyName);
  text(10, 48, 760, [doc.phone, 'Party khata', doc.printedLabel].filter(Boolean).join('  |  '));
  text(10, 48, 736, `${doc.moneyLabel}: Rs ${Number(doc.moneyInr || 0).toLocaleString('en-IN')}`);
  text(10, 48, 722, `Metal with party: ${doc.metalLine}`);
  text(9, 48, 698, 'Date');
  text(9, 110, 698, 'Particulars');
  text(9, 360, 698, 'Amount');
  text(9, 470, 698, 'Hisab');
  ops.push('0.7 0.65 0.5 RG 48 692 m 547 692 l S');
  let y = 676;
  for (const line of pageLines) {
    text(9, 48, y, line.date);
    text(9, 110, y, line.label + (line.note ? ' - ' + line.note : ''));
    text(9, 360, y, String(line.fig).replace(/₹/g, 'Rs '));
    text(9, 470, y, `Rs ${Number(line.runningInr || 0).toLocaleString('en-IN')}`);
    y -= 16;
  }
  text(8, 48, 36, `Page ${page} of ${pageCount}  |  Karigar party khata`);
  return ops.join('\n');
}

export function partyKhataPdfBytes(doc) {
  const perPage = 38;
  const all = doc.lines && doc.lines.length ? doc.lines : [{ date: '', label: 'No entries', note: '', fig: '', runningInr: doc.moneyInr }];
  const chunks = [];
  for (let i = 0; i < all.length; i += perPage) chunks.push(all.slice(i, i + perPage));
  if (!chunks.length) chunks.push([]);
  const streams = chunks.map((lines, i) => pdfPageContent(doc, lines, i + 1, chunks.length));
  const nPages = streams.length;
  const fontId = 3;
  const firstContent = 4;
  const firstPage = 4 + nPages;
  const pageRefs = streams.map((_, i) => `${firstPage + i} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageRefs}] /Count ${nPages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams.map((stream) => `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
    ...streams.map((_, i) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${firstContent + i} 0 R >>`)
  ];

  let out = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n`;
  out += '0000000000 65535 f \n';
  offsets.slice(1).forEach((off) => {
    out += `${String(off).padStart(10, '0')} 00000 n \n`;
  });
  out += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Array.from(out, (ch) => ch.charCodeAt(0) & 0xff));
}

export function printPartyKhataHtml(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.className = 'print-frame';
  frame.srcdoc = html;
  const cleanup = () => { try { frame.remove(); } catch { /* ignore */ } };
  frame.onload = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } finally {
      setTimeout(cleanup, 1000);
    }
  };
  document.body.appendChild(frame);
}

export async function sharePartyKhataPdf(doc, share = globalThis.navigator) {
  const bytes = partyKhataPdfBytes(doc);
  const file = new File([bytes], partyKhataFilename(doc), { type: 'application/pdf' });
  if (share && typeof share.canShare === 'function' && share.canShare({ files: [file] }) && typeof share.share === 'function') {
    await share.share({ files: [file], title: `${doc.partyName} khata`, text: partyKhataShareText(doc) });
    return 'shared';
  }
  if (share && typeof share.share === 'function') {
    await share.share({ title: `${doc.partyName} khata`, text: partyKhataShareText(doc) });
    return 'shared-text';
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
