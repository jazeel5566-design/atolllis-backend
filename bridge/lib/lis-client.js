const fs = require('fs');
const path = require('path');

// The bridge's link to AtollLIS. A query has to be answered while the analyser waits, so it is
// tried once. Results must never be lost: each batch is written to disk first and removed only
// when the LIS has confirmed it, so an internet outage or a restart just delays them.
class LisClient {
  constructor({ lisUrl, instrumentKey, queueDir, log }) {
    this.base = String(lisUrl).replace(/\/+$/, '') + '/api/interface';
    this.key = instrumentKey;
    this.queueDir = queueDir;
    this.rejectedDir = path.join(queueDir, 'rejected');
    this.log = log;
    fs.mkdirSync(this.rejectedDir, { recursive: true });
    this.flushing = false;
  }

  async post(route, body, timeoutMs) {
    const res = await fetch(this.base + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Instrument-Key': this.key },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs || 15000),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { status: res.status, ok: res.ok, data };
  }

  heartbeat() { return this.post('/heartbeat', {}); }

  // Never throws: with the LIS out of reach the analyser is simply told there is nothing to run.
  async query(specimenNumber, raw) {
    try {
      const r = await this.post('/query', { specimenNumber, raw }, 10000);
      if (r.ok) return r.data;
      this.log(`LIS refused the query for ${specimenNumber}: ${r.data && r.data.error ? r.data.error : `HTTP ${r.status}`}`);
    } catch (e) {
      this.log(`LIS not reachable for the query on ${specimenNumber}: ${e.message}`);
    }
    return { specimenNumber, found: false, tests: [] };
  }

  enqueueResults(batch) {
    const file = path.join(this.queueDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    fs.writeFileSync(file + '.tmp', JSON.stringify(batch));
    fs.renameSync(file + '.tmp', file); // a half-written file is never picked up
    this.flush();
  }

  pending() { return fs.readdirSync(this.queueDir).filter(f => f.endsWith('.json')).sort(); }

  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const name of this.pending()) {
        const file = path.join(this.queueDir, name);
        const batch = JSON.parse(fs.readFileSync(file, 'utf8'));
        let r;
        try { r = await this.post('/results', batch); } catch (e) { this.log(`LIS not reachable — ${this.pending().length} result batch(es) waiting: ${e.message}`); return; }
        if (r.ok) {
          fs.unlinkSync(file);
          for (const o of (r.data && r.data.results) || []) this.log(`Result ${batch.specimenNumber || '(no barcode)'} ${o.instrumentCode}: ${o.status}${o.detail ? ` — ${o.detail}` : ''}`);
        } else if (r.status === 400) {
          // The LIS could not read the batch at all; retrying will not help. Keep it for a person.
          fs.renameSync(file, path.join(this.rejectedDir, name));
          this.log(`LIS could not read a result batch (kept in ${this.rejectedDir}): ${r.data && r.data.error}`);
        } else {
          this.log(`LIS did not take the results (${r.data && r.data.error ? r.data.error : `HTTP ${r.status}`}) — will retry`);
          return;
        }
      }
    } finally { this.flushing = false; }
  }
}

module.exports = { LisClient };
