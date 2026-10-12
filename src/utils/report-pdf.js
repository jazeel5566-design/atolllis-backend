const PDFDocument = require('pdfkit');
const { calcAge } = require('./domain');

// Draws the laboratory report as a PDF: one sheet per performing lab (see routes/reports.js), each
// starting on a new page under that lab's own header.

// Keep in step with STATUS_META in public/index.html.
const STATUS_LABELS = {
  ordered: 'Awaiting Collection',
  collected: 'Sample Collected — Awaiting Acceptance',
  rejected: 'Sample Rejected',
  awaiting_referral: 'Ready — Refer Upward',
  awaiting_receipt: 'In Transit to Higher-Level Lab',
  received: 'Received — Awaiting Processing',
  processing: 'Loaded to Analyser — Processing',
  interfaced: 'Result In — Awaiting Validation',
  completed: 'Validated & Certified — Completed',
};
const GROWTH_LABELS = { no_growth: 'No Growth', growth: 'Growth', contaminated: 'Contaminated Specimen' };

const PAGE = { width: 595.28, height: 841.89, margin: 40 };
const CONTENT_W = PAGE.width - PAGE.margin * 2;
const BOTTOM = PAGE.height - PAGE.margin - 22; // room for the footer line
const PAD = 5;
const COLS = [
  { label: 'Test', w: 150 },
  { label: 'Result', w: 165 },
  { label: 'Reference Range', w: 110 },
  { label: 'Method', w: CONTENT_W - 425 },
];
const INK = '#1a2433', MUTE = '#6b7785', RULE = '#cfd6de', CRIMSON = '#b3261e', HEAD_BG = '#eef2f6';
const REG = 'Helvetica', BOLD = 'Helvetica-Bold', ITALIC = 'Helvetica-Oblique', MONO = 'Courier';

// The built-in PDF fonts only cover Windows-1252. Characters outside it that are likely in units
// and ranges are written in an equivalent plain form; anything else becomes "?" rather than
// silently disappearing from a result.
const SUPERSCRIPTS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };
const SUBSTITUTES = { 'μ': 'µ', '≤': '<=', '≥': '>=', '≠': '!=', '−': '-', '→': '->', ' ': ' ', ' ': ' ' };
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function pdfText(value) {
  let s = String(value == null ? '' : value);
  s = s.replace(/[⁰¹²³⁴-⁹⁻⁺]+/g, run => (/[¹²³]/.test(run) && run.length === 1 ? run : '^' + [...run].map(c => SUPERSCRIPTS[c]).join('')));
  s = [...s].map(c => (SUBSTITUTES[c] !== undefined ? SUBSTITUTES[c] : c)).join('');
  return [...s].map(c => {
    const cp = c.codePointAt(0);
    if (c === '\n' || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || CP1252_EXTRA.includes(c)) return c;
    return '?';
  }).join('');
}

// The lab works on Maldives time; the server does not.
const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Maldives', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '—' : dateFmt.format(date);
}

// A table cell is a stack of text blocks: { text, font, size, color }.
const block = (text, opts = {}) => ({ text: pdfText(text), font: opts.font || REG, size: opts.size || 9.5, color: opts.color || INK });

function cellHeight(doc, blocks, width) {
  let h = 0;
  for (const b of blocks) {
    doc.font(b.font).fontSize(b.size);
    h += doc.heightOfString(b.text || ' ', { width: width - PAD * 2 }) + 2;
  }
  return h + PAD * 2 - 2;
}
function drawCell(doc, blocks, x, y, width) {
  let cy = y + PAD;
  for (const b of blocks) {
    doc.font(b.font).fontSize(b.size).fillColor(b.color);
    doc.text(b.text || ' ', x + PAD, cy, { width: width - PAD * 2 });
    cy += doc.heightOfString(b.text || ' ', { width: width - PAD * 2 }) + 2;
  }
}

const certified = l => block(`Certified by ${l.validatedBy || ''}, ${fmtDate(l.validatedAt)}`, { size: 7.5, color: MUTE });

// Each row is a list of cells: { blocks, span } where span is how many columns the cell covers.
function rowFor(l) {
  const testCell = [block(l.name, l.isCulture ? { font: BOLD } : {})];
  if (l.isStat) testCell.push(block('STAT', { font: BOLD, size: 7.5, color: CRIMSON }));
  const method = { blocks: [block(l.method || '', { size: 8.5 })], span: 1 };

  if (l.status) {
    return [{ blocks: testCell, span: 1 }, { blocks: [block(STATUS_LABELS[l.status] || l.status, { font: ITALIC, color: MUTE })], span: 2 }, method];
  }
  if (l.isCulture) {
    const cr = l.cultureResult;
    const blocks = [block(GROWTH_LABELS[cr && cr.growthStatus] || '—', { font: BOLD })];
    for (const o of (cr && cr.organisms) || []) {
      blocks.push(block(`${o.organism.name}${o.colonyCount ? ` — ${o.colonyCount}` : ''}`, { font: BOLD }));
      const sens = (o.sensitivities || []).map(s => `${s.antibiotic.name}: ${s.result}`).join('    ');
      blocks.push(block(sens || 'No sensitivity data recorded.', { size: 8, color: sens ? INK : MUTE }));
    }
    blocks.push(certified(l));
    return [{ blocks: testCell, span: 1 }, { blocks, span: 2 }, method];
  }
  if (l.comment) testCell.push(block(l.comment, { size: 7.5, color: MUTE }));
  const flagged = l.flag && l.flag !== 'Normal' && l.flag !== 'N/A';
  const critical = /^Critical/.test(l.flag || '');
  const resultText = `${l.value == null ? '' : l.value} ${l.unit || ''}${flagged ? ` (${l.flagLabel})` : ''}`.trim();
  return [
    { blocks: testCell, span: 1 },
    { blocks: [block(resultText, { font: flagged ? BOLD : REG, color: critical ? CRIMSON : INK }), certified(l)], span: 1 },
    { blocks: [block(l.rangeText || '', { size: 8.5, color: MUTE })], span: 1 },
    method,
  ];
}

function drawTableHeader(doc, y) {
  const h = 20;
  doc.rect(PAGE.margin, y, CONTENT_W, h).fill(HEAD_BG);
  let x = PAGE.margin;
  for (const c of COLS) {
    doc.font(BOLD).fontSize(8).fillColor(MUTE).text(c.label.toUpperCase(), x + PAD, y + 6, { width: c.w - PAD * 2, lineBreak: false });
    x += c.w;
  }
  return y + h;
}

function drawLetterhead(doc, report, sheet, continued) {
  const { order } = report;
  const top = PAGE.margin;
  doc.font(BOLD).fontSize(16).fillColor(INK).text(pdfText(sheet.facility.name), PAGE.margin, top, { width: CONTENT_W - 170 });
  const afterName = doc.y;
  doc.font(REG).fontSize(8.5).fillColor(MUTE).text(continued ? 'Standard Laboratory Report (continued)' : 'Standard Laboratory Report', PAGE.margin, afterName + 1);
  const leftBottom = doc.y;
  doc.font(MONO).fontSize(10).fillColor(INK).text(pdfText(order.memoNumber || order.id), PAGE.margin + CONTENT_W - 170, top + 2, { width: 170, align: 'right' });
  doc.font(REG).fontSize(8.5).fillColor(MUTE).text(fmtDate(order.createdAt), PAGE.margin + CONTENT_W - 170, doc.y + 1, { width: 170, align: 'right' });
  const y = Math.max(leftBottom, doc.y) + 8;
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_W, y).lineWidth(1.2).strokeColor(INK).stroke();
  return y + 10;
}

function drawMeta(doc, report, sheet, y) {
  const { order, facility, patient, patientType, wardName } = report;
  const typeText = patientType === 'inpatient' ? `In-Patient${wardName ? ' — ' + wardName : ''}` : patientType === 'outpatient' ? 'Out-Patient' : '—';
  const pairs = [
    ['Patient', patient.name],
    ['Hospital No. / ID No.', `${patient.hospitalNumber || '—'} / ${patient.idNumber || '—'}`],
    ['DOB / Age / Sex', `${patient.dob} / ${calcAge(patient.dob)}y / ${patient.sex}`],
    ['Address', patient.address || '—'],
    ['Ordering Clinician', order.orderedBy || '—'],
    ['Patient Type', typeText],
    ['Memo', order.memoNumber || '—'],
  ];
  if (!sheet.isOrderingFacility) pairs.push(['Referred from', facility.name]);
  const colW = CONTENT_W / 2;
  const drawPair = ([label, value], x, py, width) => {
    doc.font(REG).fontSize(9).fillColor(MUTE).text(`${label}: `, x, py, { width, continued: true });
    doc.font(label === 'Patient' ? BOLD : REG).fillColor(INK).text(pdfText(value));
    return doc.y;
  };
  for (let i = 0; i < pairs.length; i += 2) {
    const a = drawPair(pairs[i], PAGE.margin, y, colW - 10);
    const b = pairs[i + 1] ? drawPair(pairs[i + 1], PAGE.margin + colW, y, colW) : y;
    y = Math.max(a, b) + 4;
  }
  const specimens = (sheet.specimens || []).map(s => `${s.specimenNumber} (${s.bottleType})`).join(', ') || '—';
  y = drawPair(['Specimens', specimens], PAGE.margin, y, CONTENT_W) + 10;
  return y;
}

function drawSheet(doc, report, sheet, pageInfo) {
  let pageInSheet = 0;
  const newPage = continued => {
    doc.addPage();
    pageInSheet += 1;
    pageInfo.push({ sheet, pageInSheet });
    return drawLetterhead(doc, report, sheet, continued);
  };
  // A continuation page can get separated from the first, so it names the patient again.
  const continuedPage = () => {
    const y = newPage(true);
    const { patient } = report;
    doc.font(REG).fontSize(9).fillColor(MUTE).text('Patient: ', PAGE.margin, y, { width: CONTENT_W, continued: true });
    doc.font(BOLD).fillColor(INK).text(pdfText(patient.name), { continued: true });
    doc.font(REG).text(pdfText(`   Hospital No. / ID No.: ${patient.hospitalNumber || '—'} / ${patient.idNumber || '—'}`));
    return drawTableHeader(doc, doc.y + 8);
  };
  let y = drawTableHeader(doc, drawMeta(doc, report, sheet, newPage(false)));

  for (const line of sheet.lines) {
    const cells = rowFor(line);
    let col = 0;
    for (const c of cells) {
      c.width = COLS.slice(col, col + c.span).reduce((sum, k) => sum + k.w, 0);
      col += c.span;
    }
    const h = Math.max(...cells.map(c => cellHeight(doc, c.blocks, c.width)));
    if (y + h > BOTTOM) y = continuedPage();
    let x = PAGE.margin;
    for (const c of cells) { drawCell(doc, c.blocks, x, y, c.width); x += c.width; }
    y += h;
    doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_W, y).lineWidth(0.5).strokeColor(RULE).stroke();
  }
  return pageInSheet;
}

// Resolves with the finished PDF as a Buffer.
function renderReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, autoFirstPage: false, bufferPages: true, info: { Title: `Laboratory Report ${pdfText(report.order.memoNumber || report.order.id)}` } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageInfo = [];
    for (const sheet of report.sheets) sheet.pageCount = drawSheet(doc, report, sheet, pageInfo);

    const generated = fmtDate(new Date());
    pageInfo.forEach((p, i) => {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // otherwise writing in the footer area starts a new page
      const fy = PAGE.height - PAGE.margin - 8;
      doc.moveTo(PAGE.margin, fy - 5).lineTo(PAGE.margin + CONTENT_W, fy - 5).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.font(REG).fontSize(7.5).fillColor(MUTE);
      doc.text(pdfText(`${p.sheet.facility.name} · Memo ${report.order.memoNumber || report.order.id} · Generated ${generated}`), PAGE.margin, fy, { width: CONTENT_W - 80, lineBreak: false });
      doc.text(`Page ${p.pageInSheet} of ${p.sheet.pageCount}`, PAGE.margin + CONTENT_W - 80, fy, { width: 80, align: 'right', lineBreak: false });
    });
    doc.end();
  });
}

module.exports = { renderReportPdf, pdfText };
