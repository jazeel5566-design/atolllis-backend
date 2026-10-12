// CLSI LIS02-A2 (formerly ASTM E1394) records: the content carried by the LIS01-A2 link.
//   H header · P patient · O order · R result · Q query · C comment · L terminator
// Fields are separated by |, repeats by \, components by ^ (the header declares the actual set).

const pad = n => String(n).padStart(2, '0');
function timestamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
// Free text must not contain the delimiters themselves.
const safe = v => String(v == null ? '' : v).replace(/[|\\^&\r\n]/g, ' ').trim();

function delimitersOf(records) {
  const h = records.find(r => r[0] === 'H');
  if (h && h.length >= 5) return { field: h[1], repeat: h[2], component: h[3], escape: h[4] };
  return { field: '|', repeat: '\\', component: '^', escape: '&' };
}

// Turns one received message into what the analyser is asking or telling:
//   { queries: [specimenNumber], results: [{ specimenNumber, qc, results: [{ instrumentCode, value, unit, flags, raw }] }] }
// opts.testIdComponent — which component of the Universal Test ID holds the analyser's test code
// (1-based; 4 is the manufacturer's local code, the usual place).
function parseMessage(records, opts = {}) {
  const d = delimitersOf(records);
  const codeAt = (opts.testIdComponent || 4) - 1;
  const queries = [], groups = [];
  let group = null;
  for (const raw of records) {
    const f = raw.split(d.field);
    const type = (f[0] || '').charAt(0).toUpperCase();
    const comps = v => String(v || '').split(d.component);
    if (type === 'Q') {
      // Q.3 Starting Range ID: patient ID ^ specimen ID, possibly repeated
      for (const rep of String(f[2] || '').split(d.repeat)) {
        const c = comps(rep);
        const specimen = (c[1] || c[0] || '').trim();
        if (specimen && specimen.toUpperCase() !== 'ALL') queries.push(specimen);
      }
    } else if (type === 'O') {
      // O.3 Specimen ID (the barcode), falling back to O.4 Instrument Specimen ID. O.12 Action Code Q = QC.
      const specimenNumber = (comps(f[2])[0] || comps(f[3])[0] || '').trim();
      group = { specimenNumber, qc: /Q/i.test(f[11] || ''), results: [] };
      groups.push(group);
    } else if (type === 'R') {
      if (!group) { group = { specimenNumber: '', qc: false, results: [] }; groups.push(group); }
      const id = comps(f[2]);
      const instrumentCode = (id[codeAt] || id.find(Boolean) || '').trim();
      const value = (comps(f[3]).find(c => c.trim()) || '').trim();
      const status = (f[8] || '').trim().toUpperCase();
      if (status === 'X') continue; // the analyser could not do this test — there is no result
      group.results.push({ instrumentCode, value, unit: (f[4] || '').trim(), flags: (f[6] || '').trim(), raw });
    }
  }
  return { queries, results: groups.filter(g => g.results.length) };
}

const header = sender => `H|\\^&|||${safe(sender || 'AtollLIS')}|||||||P|LIS2-A2|${timestamp()}\r`;

// The answer to a query: for each specimen, the patient and one order record listing the tests to
// run. answers: [{ specimenNumber, patient, tests: [{ instrumentCode, isStat }] }]
function buildOrders(answers, opts = {}) {
  const withTests = answers.filter(a => a.tests && a.tests.length);
  // L|1|I — "no information available from the last query"
  if (!withTests.length) return [header(opts.sender), 'L|1|I\r'];
  const records = [header(opts.sender)];
  withTests.forEach((a, i) => {
    const p = a.patient || {};
    const dob = String(p.dob || '').replace(/\D/g, '').slice(0, 8);
    const sex = /^m/i.test(p.sex || '') ? 'M' : /^f/i.test(p.sex || '') ? 'F' : 'U';
    records.push(`P|${i + 1}||${safe(p.hospitalNumber)}||${safe(p.name)}|||${dob}|${sex}\r`);
    const tests = a.tests.map(t => `^^^${safe(t.instrumentCode)}`).join('\\');
    const priority = a.tests.some(t => t.isStat) ? 'S' : 'R';
    records.push(`O|1|${safe(a.specimenNumber)}||${tests}|${priority}||||||${opts.orderActionCode || 'N'}||||||||||||||O\r`);
  });
  records.push('L|1|N\r');
  return records;
}

module.exports = { parseMessage, buildOrders, timestamp, safe };
