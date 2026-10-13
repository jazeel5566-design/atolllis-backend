#!/usr/bin/env node
// AtollLIS analyser bridge — runs on one always-on computer in the lab network and serves every
// analyser listed in its config.
//
//   analysers  <— ASTM (LIS01-A2 / LIS02-A2) or HL7 v2 (MLLP) —>  this program  <— HTTPS —>  AtollLIS
//
// Usage: node bridge.js [path/to/config.json]      (default: ./config.json — see config.example.json)
const fs = require('fs');
const path = require('path');
const { openTransport } = require('./lib/transports');
const { LisClient } = require('./lib/lis-client');
const { AstmLink } = require('./lib/astm-link');
const astm = require('./lib/astm-records');
const hl7 = require('./lib/hl7');

// One analyser: its own line, its own key, its own queue of undelivered results.
function startOne(config, options = {}) {
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
  transport.on('fatal', e => { log(`Line failure: ${e.message}`); if (options.onFatal) options.onFatal(e); else if (!options.embedded) process.exit(1); });

  let registered = false;
  const beat = async () => {
    try {
      const r = await lis.heartbeat();
      if (!r.ok) { registered = false; log(`LIS rejected this bridge: ${r.data && r.data.error ? r.data.error : `HTTP ${r.status}`}`); }
      else if (!registered) { registered = true; log(`Registered in AtollLIS as "${r.data.instrument.name}"`); }
    } catch (e) { registered = false; log(`LIS not reachable: ${e.message}`); }
    lis.flush();
  };
  beat();
  const timer = setInterval(beat, config.heartbeatMs || 30000);
  return { lis, transport, stop() { clearInterval(timer); transport.stop(); } };
}

// config.instruments lists several analysers served by this one program; lisUrl, queueDir, logRaw
// and heartbeatMs at the top level apply to all of them unless an entry sets its own. Without
// `instruments`, the config describes a single analyser.
function start(config, options = {}) {
  if (!Array.isArray(config.instruments)) return startOne(config, options);
  if (!config.instruments.length) throw new Error('config: "instruments" is empty');
  const baseLog = options.log || (msg => console.log(`${new Date().toISOString()}  ${msg}`));
  const { instruments, ...shared } = config;
  const seen = { name: new Set(), key: new Set(), line: new Set() };
  const entries = instruments.map((ins, i) => {
    if (!ins.name) throw new Error(`config: instrument #${i + 1} needs a "name"`);
    const t = ins.transport || {};
    const line = t.type === 'tcp-server' ? `port ${t.port}` : t.type === 'tcp-client' ? `${t.host}:${t.port}` : `serial ${t.path}`;
    for (const [kind, value, what] of [['name', ins.name, 'name'], ['key', ins.instrumentKey, 'instrumentKey'], ['line', line, 'connection']]) {
      if (kind === 'line' && t.type === 'tcp-server' && !t.port) continue; // port 0: the system picks a free one
      if (seen[kind].has(value)) throw new Error(`config: two instruments share the same ${what}${kind === 'key' ? '' : ` (${value})`} — each needs its own`);
      seen[kind].add(value);
    }
    const folder = String(ins.name).replace(/[^A-Za-z0-9_-]+/g, '_');
    return { ...shared, ...ins, queueDir: ins.queueDir || path.join(shared.queueDir || './queue', folder) };
  });
  // One analyser's line failing must not take the others down with it.
  const running = entries.map(entry => {
    const log = msg => baseLog(`[${entry.name}] ${msg}`);
    try { return startOne(entry, { ...options, log, onFatal: () => log('This instrument is stopped until the bridge is restarted') }); }
    catch (e) { log(`Not started: ${e.message}`); return null; }
  });
  if (!running.some(Boolean)) throw new Error('No instrument could be started — check the config');
  return { instruments: running, stop() { running.forEach(r => r && r.stop()); } };
}

if (require.main === module) {
  const file = path.resolve(process.argv[2] || 'config.json');
  let config;
  try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`Cannot read ${file}: ${e.message}`); process.exit(1); }
  try { start(config); } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { start };
