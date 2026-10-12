#!/usr/bin/env node
// Stands in for an analyser so the bridge and the LIS can be tried end to end without one.
// It connects to a bridge that is configured with  "transport": { "type": "tcp-server", ... }.
//
//   node simulator.js --protocol astm --port 5001 --specimen <barcode> --result <code>=<value>:<unit>
//
//   --protocol astm|hl7     (default astm)
//   --host / --port         where the bridge is listening (default 127.0.0.1:5001)
//   --specimen <barcode>    the tube being run
//   --result c=v:u          a result to send back; repeat for several. Without any, it only queries.
//   --no-query              send results without asking for orders first
//   --qc                    mark the results as QC material
//
// Only ever point this at a test setup: the results it sends are whatever you type.
const net = require('net');
const { AstmLink } = require('./lib/astm-link');
const { timestamp } = require('./lib/astm-records');
const hl7 = require('./lib/hl7');

function run(opts) {
  const o = { protocol: 'astm', host: '127.0.0.1', port: 5001, results: [], query: true, qc: false, waitMs: 4000, ...opts };
  return new Promise((resolve, reject) => {
    const socket = net.connect(o.port, o.host);
    const out = { orders: [], noOrders: false, acks: [], received: [] };
    const finish = () => { socket.end(); resolve(out); };
    socket.on('error', reject);

    if (o.protocol === 'astm') {
      const link = new AstmLink(buf => socket.write(buf), { role: 'instrument' });
      socket.on('data', d => link.feed(d));
      const sendResults = async () => {
        if (!o.results.length) return finish();
        const records = [`H|\\^&|||Simulator|||||||P|LIS2-A2|${timestamp()}\r`, 'P|1\r', `O|1|${o.specimen}||${o.results.map(r => `^^^${r.code}`).join('\\')}|R||||||${o.qc ? 'Q' : ''}\r`];
        o.results.forEach((r, i) => records.push(`R|${i + 1}|^^^${r.code}|${r.value}|${r.unit || ''}||${r.flags || ''}||F||||${timestamp()}\r`));
        records.push('L|1|N\r');
        await link.send(records);
        setTimeout(finish, 300);
      };
      link.on('message', records => {
        out.received.push(records);
        for (const rec of records) {
          const f = rec.split('|');
          if (f[0][0] === 'O') out.orders.push(...String(f[4] || '').split('\\').map(t => t.split('^')[3]).filter(Boolean));
          if (f[0][0] === 'L' && f[2] === 'I') out.noOrders = true;
        }
        sendResults().catch(reject);
      });
      socket.on('connect', async () => {
        try {
          if (!o.query) return await sendResults();
          await link.send([`H|\\^&|||Simulator|||||||P|LIS2-A2|${timestamp()}\r`, `Q|1|^${o.specimen}||ALL||||||||O\r`, 'L|1|N\r']);
          setTimeout(() => { if (!out.received.length) reject(new Error('No answer to the query')); }, o.waitMs);
        } catch (e) { reject(e); }
      });
    } else {
      const head = (type, id) => `MSH|^~\\&|Simulator|Lab|AtollLIS||${timestamp()}||${type}|${id}|P|2.5.1`;
      const send = text => socket.write(hl7.wrap(text));
      const sendResults = () => {
        if (!o.results.length) return finish();
        const lines = [head('OUL^R22^OUL_R22', 'SIMR1'), `SPM|1|${o.specimen}|||||||||${o.qc ? 'Q' : 'P'}`, 'OBR|1'];
        o.results.forEach((r, i) => lines.push(`OBX|${i + 1}|NM|${r.code}^^L||${r.value}|${r.unit || ''}||${r.flags || ''}|||F`));
        send(lines.join('\r') + '\r');
      };
      const reader = new hl7.MllpReader(text => {
        const m = hl7.parse(text);
        out.received.push(text);
        if (m.type === 'OML') {
          const orc = m.segments.find(s => s[0] === 'ORC');
          if (orc && orc[1] === 'DC') out.noOrders = true;
          out.orders.push(...m.segments.filter(s => s[0] === 'OBR').map(s => m.first(s[4])).filter(Boolean));
          sendResults();
        } else if (m.type === 'ACK') {
          const msa = m.segments.find(s => s[0] === 'MSA');
          out.acks.push(msa ? msa[1] : '');
          setTimeout(finish, 300);
        }
      });
      socket.on('data', d => reader.feed(d));
      socket.on('connect', () => {
        if (!o.query) return sendResults();
        send([head('QBP^Q11^QBP_Q11', 'SIMQ1'), `QPD|LAB-27^IHE|Q1|${o.specimen}`, 'RCP|I||R'].join('\r') + '\r');
        setTimeout(() => { if (!out.received.length) reject(new Error('No answer to the query')); }, o.waitMs);
      });
    }
  });
}

if (require.main === module) {
  const args = process.argv.slice(2), opts = { results: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--no-query') opts.query = false;
    else if (a === '--qc') opts.qc = true;
    else if (a === '--result') { const [code, rest = ''] = args[++i].split('='); const [value, unit = ''] = rest.split(':'); opts.results.push({ code, value, unit }); }
    else if (a.startsWith('--')) opts[a.slice(2)] = a === '--port' ? Number(args[++i]) : args[++i];
  }
  if (!opts.specimen) { console.error('Usage: node simulator.js --specimen <barcode> [--protocol astm|hl7] [--port 5001] [--result code=value:unit]'); process.exit(1); }
  run(opts).then(out => {
    console.log(out.noOrders ? 'LIS answered: nothing to run on this specimen' : `Tests ordered by the LIS: ${out.orders.join(', ') || '(none received)'}`);
    if (opts.results.length) console.log('Results sent.');
    process.exit(0);
  }).catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { run };
