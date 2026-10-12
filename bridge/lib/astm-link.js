const { EventEmitter } = require('events');

// CLSI LIS01-A2 (formerly ASTM E1381) low-level protocol: how two devices take turns on one line
// and move a message across it in checksummed frames.
//
//   sender:   ENQ ............ <frame> ...... <frame> ...... EOT
//   receiver:      ACK ............... ACK ........... ACK
//
// A frame is  STX  FN  text  ETX|ETB  C1 C2  CR LF  — FN counts 1..7,0,1.., ETB marks a frame whose
// text continues in the next one, and C1C2 is the sum (mod 256, two hex digits) of everything from
// FN through ETX/ETB.

const C = { STX: 0x02, ETX: 0x03, EOT: 0x04, ENQ: 0x05, ACK: 0x06, LF: 0x0a, CR: 0x0d, NAK: 0x15, ETB: 0x17 };
const MAX_TEXT = 240;
const TIMEOUT = { reply: 15000, receive: 30000, nakWait: 10000, contentionWait: 1000, hostYield: 20000 };
const MAX_RETRIES = 6;

function checksum(bytes) {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return sum.toString(16).toUpperCase().padStart(2, '0');
}

function buildFrame(frameNumber, text, last) {
  const body = Buffer.concat([Buffer.from(String(frameNumber % 8), 'latin1'), Buffer.from(text, 'latin1'), Buffer.from([last ? C.ETX : C.ETB])]);
  return Buffer.concat([Buffer.from([C.STX]), body, Buffer.from(checksum(body), 'latin1'), Buffer.from([C.CR, C.LF])]);
}

// Splits records (each already ending in CR) into frames: one record per frame, continued with ETB
// frames when a record is longer than a frame may be.
function framesFor(records) {
  const frames = [];
  let n = 1;
  for (const record of records) {
    for (let i = 0; i < record.length; i += MAX_TEXT) {
      frames.push(buildFrame(n++, record.slice(i, i + MAX_TEXT), i + MAX_TEXT >= record.length));
    }
  }
  return frames;
}

// write(buffer) sends bytes to the instrument; feed(buffer) is given whatever arrives from it.
// Emits 'message' with an array of record strings once the instrument has sent one and released
// the line. send(records) resolves when the instrument has acknowledged the whole message.
//
// opts.role settles what happens when both ends ask for the line at the same moment: the
// 'instrument' asks again after a second, while the 'host' (the LIS side — the default) stands back
// for up to 20 seconds to let it.
class AstmLink extends EventEmitter {
  constructor(write, opts = {}) {
    super();
    this.write = write;
    this.role = opts.role || 'host';
    this.t = { ...TIMEOUT, ...opts.timeouts };
    this.state = 'idle'; // 'idle' | 'receiving' | 'sending'
    this.inbox = Buffer.alloc(0);
    this.outbox = [];
    this.reset();
  }

  reset() {
    clearTimeout(this.receiveTimer);
    this.expected = 1;
    this.text = '';
    this.pending = '';
  }

  feed(chunk) {
    this.inbox = Buffer.concat([this.inbox, chunk]);
    while (this.inbox.length && this.consume()) { /* keep going while whole units are available */ }
  }

  // Takes one unit (a control byte or a whole frame) off the front of the inbox. Returns false
  // when the rest is an incomplete frame.
  consume() {
    const b = this.inbox[0];
    if (b === C.STX) {
      const end = this.inbox.indexOf(C.LF);
      if (end === -1) return this.inbox.length <= MAX_TEXT + 64 ? false : this.drop(1);
      const frame = this.inbox.subarray(0, end + 1);
      this.inbox = this.inbox.subarray(end + 1);
      this.onFrame(frame);
      return true;
    }
    this.inbox = this.inbox.subarray(1);
    if (this.waiter && (b === C.ACK || b === C.NAK || b === C.EOT || b === C.ENQ)) {
      const w = this.waiter; this.waiter = null; clearTimeout(w.timer); w.resolve(b);
    } else if (b === C.ENQ) this.onEnq();
    else if (b === C.EOT) this.onEot();
    return true;
  }
  drop(n) { this.inbox = this.inbox.subarray(n); return true; }

  // ---------- receiving ----------
  onEnq() {
    if (this.state === 'sending') return; // handled by the sender as line contention
    clearTimeout(this.yieldTimer); this.yielding = false;
    this.state = 'receiving';
    this.reset();
    this.armReceiveTimer();
    this.write(Buffer.from([C.ACK]));
  }

  armReceiveTimer() {
    clearTimeout(this.receiveTimer);
    this.receiveTimer = setTimeout(() => {
      this.emit('log', 'Instrument stopped mid-message; the incomplete message was discarded');
      this.state = 'idle'; this.reset(); this.pump();
    }, this.t.receive);
  }

  onFrame(frame) {
    if (this.state !== 'receiving') return;
    this.armReceiveTimer();
    // STX FN text ETX|ETB C1 C2 CR LF
    const endIdx = frame.length - 5;
    const ok = frame.length >= 7 && (frame[endIdx] === C.ETX || frame[endIdx] === C.ETB)
      && checksum(frame.subarray(1, endIdx + 1)) === frame.subarray(endIdx + 1, endIdx + 3).toString('latin1').toUpperCase()
      && Number(String.fromCharCode(frame[1])) === this.expected % 8;
    if (!ok) { this.write(Buffer.from([C.NAK])); return; }
    this.expected += 1;
    this.text += frame.subarray(2, endIdx).toString('latin1');
    this.write(Buffer.from([C.ACK]));
  }

  onEot() {
    if (this.state !== 'receiving') return;
    const records = this.text.split('\r').map(r => r.replace(/\n/g, '')).filter(Boolean);
    this.state = 'idle'; this.reset();
    if (records.length) this.emit('message', records);
    this.pump();
  }

  // ---------- sending ----------
  send(records) {
    return new Promise((resolve, reject) => { this.outbox.push({ records, resolve, reject }); this.pump(); });
  }

  waitByte(ms) {
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.waiter = null; resolve(null); }, ms);
      this.waiter = { resolve, timer };
    });
  }
  pause(ms) { return new Promise(r => setTimeout(r, ms)); }

  async pump() {
    if (this.state !== 'idle' || this.yielding || !this.outbox.length) return;
    this.state = 'sending';
    const job = this.outbox[0];
    try {
      const sent = await this.transmit(job.records);
      if (sent === 'yield') {
        // Stand back: the instrument will ask again, and this message goes once it has finished
        // (or once the wait runs out because it never did).
        this.state = 'idle'; this.yielding = true;
        this.yieldTimer = setTimeout(() => { this.yielding = false; this.pump(); }, this.t.hostYield);
        return;
      }
      this.outbox.shift(); job.resolve();
    } catch (e) {
      this.outbox.shift(); job.reject(e);
    }
    this.state = 'idle';
    setImmediate(() => this.pump());
  }

  async transmit(records) {
    // Establishment: the instrument has priority when both sides ask for the line at once.
    for (let attempt = 0; ; attempt++) {
      if (attempt >= MAX_RETRIES) throw new Error('Instrument did not accept the line (no ACK to ENQ)');
      this.write(Buffer.from([C.ENQ]));
      const reply = await this.waitByte(this.t.reply);
      if (reply === C.ACK) break;
      if (reply === C.ENQ) {
        if (this.role === 'host') return 'yield';
        await this.pause(this.t.contentionWait); continue;
      }
      if (reply === C.NAK) await this.pause(this.t.nakWait);
      else if (reply === null) { this.write(Buffer.from([C.EOT])); throw new Error('Instrument did not answer ENQ'); }
    }
    for (const frame of framesFor(records)) {
      for (let attempt = 0; ; attempt++) {
        if (attempt >= MAX_RETRIES) { this.write(Buffer.from([C.EOT])); throw new Error('Instrument kept rejecting a frame'); }
        this.write(frame);
        const reply = await this.waitByte(this.t.reply);
        if (reply === C.ACK || reply === C.EOT) break; // EOT here is the receiver asking to interrupt; the frame was taken
        if (reply === null) { this.write(Buffer.from([C.EOT])); throw new Error('Instrument stopped acknowledging frames'); }
      }
    }
    this.write(Buffer.from([C.EOT]));
    return 'sent';
  }
}

module.exports = { AstmLink, buildFrame, framesFor, checksum, C };
