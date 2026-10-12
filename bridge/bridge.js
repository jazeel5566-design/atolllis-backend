#!/usr/bin/env node
// AtollLIS analyser bridge — runs on a PC in the lab, next to one analyser.
//
//   analyser  <— ASTM (LIS01-A2 / LIS02-A2) or HL7 v2 (MLLP) —>  this program  <— HTTPS —>  AtollLIS
//
// Usage: node bridge.js [path/to/config.json]      (default: ./config.json — see config.example.json)
const fs = require('fs');
const path = require('path');
const { openTransport } = require('./lib/transports');
const { LisClient } = require('./lib/lis-client');
const { AstmLink } = require('./lib/astm-link');
const astm = require('./lib/astm-records');
const hl7 = require('./lib/hl7');

function start(config, options = {}) {
  const log = options.log || (msg => console.log(`${new Date().toISOString()}  ${msg}`));
  for (const k of ['lisUrl', 'instrumentKey', 'protocol', 'transport']) {
    if (!config[k]) throw new Error(`config: "${k}" is required`);
  }
  if (!['astm', 'hl7'].includes(config.protocol)) throw new Error('config: protocol must be "astm" or "hl7"');
  if (config.protocol === 'hl7' && config.transport.type === 'serial') throw new Error('config: HL7 runs over the network, not a serial cable');

  const lis = new LisClient({ lisUrl: config.lisUrl, instrumentKey: config.instrumentKey, queueDir: path.resolve(config.queueDir || './queue'), log });
  const transport = openTransport(config.transport);
  const rawLog = (dir, text) => { if (config.logRaw) log(`${dir} ${JSON.stringify(text)}`); };

  const forward = groups => {
    for (const g of groups) lis.enqueueResults({ specimenNumber: g.specimenNumber, qc: g.qc, results: g.results });
  };

  let onData;
  if (config.protocol === 'astm') {
    const link = new AstmLink(buf => transport.write(buf), { timeouts: config.astm && config.astm.timeouts });
    link.on('log', log);
    link.on('message', async records => {
      rawLog('<-', records.join('\r'));
      const msg = astm.parseMessage(records, config.astm);
      forward(msg.results);
      if (msg.queries.length) {
        const answers = [];
        for (const specimen of msg.queries) answers.push(await lis.query(specimen, records.join('\r')));
        const reply = astm.buildOrders(answers, config.astm);
        rawLog('->', reply.join(''));
        log(`Query ${msg.queries.join(', ')}: ${answers.map(a => `${a.tests.length} test(s)`).join(', ')}`);
        link.send(reply).catch(e => log(`Could not send orders to the analyser: ${e.message}`));
      }
    });
    onData = d => link.feed(d);
  } else {
    const send = text => { rawLog('->', text); transport.write(hl7.wrap(text)); };
    const reader = new hl7.MllpReader(async text => {
      rawLog('<-', text);
      let msg;
      try { msg = hl7.read(text); } catch (e) { log(`Unreadable HL7 message: ${e.message}`); return; }
      const m = msg.message;
      if (msg.kind === 'results') {
        forward(msg.results); // safely on disk before the analyser is told it was accepted
        send(hl7.buildAck(m, 'AA', null, config.hl7 && config.hl7.sender));
      } else if (msg.kind === 'query') {
        send(hl7.buildQueryResponse(m, config.hl7 && config.hl7.sender));
        for (const specimen of msg.queries) {
          const answer = await lis.query(specimen, text);
          log(`Query ${specimen}: ${answer.tests.length} test(s)`);
          send(hl7.buildOrders(m, answer, config.hl7 && config.hl7.sender));
        }
      } else if (msg.kind !== 'ack') {
        log(`HL7 message type ${m.type}^${m.event} is not handled`);
        send(hl7.buildAck(m, 'AR', 'Unsupported message type', config.hl7 && config.hl7.sender));
      }
    });
    onData = d => reader.feed(d);
  }

  transport.on('data', onData);
  transport.on('open', who => log(`Analyser connected (${who})`));
  transport.on('close', () => log('Analyser disconnected'));
  transport.on('log', log);
  transport.on('fatal', e => { log(`Line failure: ${e.message}`); if (!options.embedded) process.exit(1); });

  const beat = async () => {
    try {
      const r = await lis.heartbeat();
      if (!r.ok) log(`LIS rejected this bridge: ${r.data && r.data.error ? r.data.error : `HTTP ${r.status}`}`);
    } catch (e) { log(`LIS not reachable: ${e.message}`); }
    lis.flush();
  };
  beat();
  const timer = setInterval(beat, config.heartbeatMs || 30000);
  return { lis, transport, stop() { clearInterval(timer); transport.stop(); } };
}

if (require.main === module) {
  const file = path.resolve(process.argv[2] || 'config.json');
  let config;
  try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`Cannot read ${file}: ${e.message}`); process.exit(1); }
  try { start(config); } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { start };
