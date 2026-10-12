// HL7 v2.5.1 over MLLP, as analysers use it (IHE Laboratory Analytical Workflow, LAW):
//   QBP^Q11  analyser asks what to run on a specimen   -> RSP^K11, then OML^O33 with the orders
//   OUL^R22 / ORU^R01  analyser sends results          -> ACK
// MLLP wraps each message as  VT  message  FS CR.
const { timestamp, safe } = require('./astm-records');

const VT = 0x0b, FS = 0x1c, CR = 0x0d;
const wrap = text => Buffer.concat([Buffer.from([VT]), Buffer.from(text, 'utf8'), Buffer.from([FS, CR])]);

// Splits a byte stream into whole messages; keeps what is left over for the next chunk.
class MllpReader {
  constructor(onMessage) { this.buf = Buffer.alloc(0); this.onMessage = onMessage; }
  feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const start = this.buf.indexOf(VT);
      if (start === -1) { this.buf = Buffer.alloc(0); return; }
      const end = this.buf.indexOf(FS, start);
      if (end === -1) { this.buf = this.buf.subarray(start); return; }
      const text = this.buf.subarray(start + 1, end).toString('utf8');
      this.buf = this.buf.subarray(end + 1);
      this.onMessage(text);
    }
  }
}

function parse(text) {
  const segments = text.split(/\r\n|\r|\n/).filter(Boolean).map(line => {
    const fieldSep = line.startsWith('MSH') ? line[3] : '|';
    const f = line.split(fieldSep);
    if (line.startsWith('MSH')) f.splice(1, 0, fieldSep); // so MSH-n is f[n], as for every other segment
    return f;
  });
  const msh = segments.find(s => s[0] === 'MSH') || [];
  const comp = (msh[2] || '^~\\&')[0];
  const sub = (msh[2] || '^~\\&')[3] || '&';
  const first = v => String(v || '').split(comp)[0].split(sub)[0].trim();
  const type = String(msh[9] || '').split(comp);
  return { segments, msh, comp, first, type: type[0] || '', event: type[1] || '', controlId: msh[10] || '', version: msh[12] || '2.5.1' };
}

// { queries: [specimenNumber], results: [{ specimenNumber, qc, results: [...] }], kind }
function read(text) {
  const m = parse(text);
  const out = { message: m, queries: [], results: [], kind: 'other' };
  if (m.type === 'QBP') {
    out.kind = 'query';
    const qpd = m.segments.find(s => s[0] === 'QPD');
    const specimen = qpd && m.first(qpd[3]);
    if (specimen) out.queries.push(specimen);
    return out;
  }
  if (m.type === 'OUL' || m.type === 'ORU') {
    out.kind = 'results';
    // A specimen (SPM) may come before its results (OUL^R22) or after them (ORU^R01), so results
    // are grouped per order and the specimen is settled once the group is complete.
    let group = null, spmBefore = null;
    const close = () => {
      if (group && group.results.length) {
        out.results.push({ specimenNumber: group.spm || group.obr || '', qc: group.qc, results: group.results });
      }
      group = null;
    };
    for (const s of m.segments) {
      if (s[0] === 'SPM') {
        const id = m.first(s[2]), qc = /^Q$/i.test(m.first(s[11]));
        if (group && group.results.length && !group.spm) { group.spm = id; group.qc = group.qc || qc; } else { close(); spmBefore = { id, qc }; }
      } else if (s[0] === 'OBR') {
        close();
        group = { spm: spmBefore ? spmBefore.id : '', qc: spmBefore ? spmBefore.qc : false, obr: m.first(s[3]) || m.first(s[2]), results: [] };
      } else if (s[0] === 'OBX') {
        if (!group) group = { spm: spmBefore ? spmBefore.id : '', qc: spmBefore ? spmBefore.qc : false, obr: '', results: [] };
        const status = String(s[11] || '').trim().toUpperCase();
        if (status === 'X') continue; // result cannot be obtained
        group.results.push({ instrumentCode: m.first(s[3]), value: String(s[5] || '').split(m.comp).find(c => c.trim()) || '', unit: m.first(s[6]), flags: m.first(s[8]), raw: s.join('|') });
      }
    }
    close();
    return out;
  }
  if (m.type === 'ACK' || m.type === 'ORL') out.kind = 'ack';
  return out;
}

let counter = 0;
const controlId = () => `ALIS${Date.now().toString(36).toUpperCase()}${(counter++ % 1000)}`;
function msh(m, type, name) {
  // sender and receiver swap places in a reply
  return `MSH|^~\\&|${safe(name || 'AtollLIS')}|${m ? safe(m.msh[6]) : ''}|${m ? safe(m.msh[3]) : ''}|${m ? safe(m.msh[4]) : ''}|${timestamp()}||${type}|${controlId()}|P|${m ? m.version : '2.5.1'}`;
}

// code: AA accepted, AE error, AR rejected
function buildAck(m, code, text, name) {
  const type = m.event ? `ACK^${m.event}^ACK` : 'ACK';
  return [msh(m, type, name), `MSA|${code}|${m.controlId}${text ? `|${safe(text)}` : ''}`].join('\r') + '\r';
}

function buildQueryResponse(m, name) {
  const qpd = m.segments.find(s => s[0] === 'QPD') || ['QPD'];
  const tag = qpd[2] || '';
  return [msh(m, 'RSP^K11^RSP_K11', name), `MSA|AA|${m.controlId}`, `QAK|${tag}|OK|${qpd[1] || 'LAB-27^IHE'}`, qpd.join('|')].join('\r') + '\r';
}

// The orders for one queried specimen. With nothing to run, LAW's negative answer: order control DC.
function buildOrders(m, answer, name) {
  const lines = [msh(m, 'OML^O33^OML_O33', name)];
  const p = answer.patient || {};
  const tests = answer.tests || [];
  if (tests.length) {
    const dob = String(p.dob || '').replace(/\D/g, '').slice(0, 8);
    const sex = /^m/i.test(p.sex || '') ? 'M' : /^f/i.test(p.sex || '') ? 'F' : 'U';
    lines.push(`PID|1||${safe(p.hospitalNumber)}||${safe(p.name)}||${dob}|${sex}`);
  }
  lines.push(`SPM|1|${safe(answer.specimenNumber)}|||||||||P`); // SPM-11 specimen role: P = patient
  if (!tests.length) {
    lines.push('ORC|DC', 'OBR|1');
  } else {
    tests.forEach((t, i) => {
      const order = `${safe(answer.specimenNumber)}-${i + 1}`;
      lines.push(`ORC|NW|${order}`, `TQ1|1||||||||${t.isStat ? 'S' : 'R'}`, `OBR|${i + 1}|${order}||${safe(t.instrumentCode)}^${safe(t.name)}`);
    });
  }
  return lines.join('\r') + '\r';
}

module.exports = { MllpReader, wrap, parse, read, buildAck, buildQueryResponse, buildOrders };
