const net = require('net');
const { EventEmitter } = require('events');

// The physical line to the analyser. Every transport emits 'open', 'data' (Buffer) and 'close',
// and has write(buffer). Only one analyser is served per bridge process.
//   { type: 'tcp-server', port, host? }   the analyser connects to this PC
//   { type: 'tcp-client', host, port }    this PC connects to the analyser
//   { type: 'serial', path, baudRate?, dataBits?, parity?, stopBits? }   RS-232 cable

class TcpServer extends EventEmitter {
  constructor(cfg) {
    super();
    this.socket = null;
    this.server = net.createServer(socket => {
      if (this.socket) this.socket.destroy(); // a reconnecting analyser replaces its old connection
      this.socket = socket;
      this.emit('open', `${socket.remoteAddress}:${socket.remotePort}`);
      socket.on('data', d => this.emit('data', d));
      socket.on('error', e => this.emit('log', `Connection error: ${e.message}`));
      socket.on('close', () => { if (this.socket === socket) { this.socket = null; this.emit('close'); } });
    });
    this.server.on('error', e => this.emit('fatal', e));
    this.server.listen(cfg.port, cfg.host || '0.0.0.0', () => this.emit('log', `Waiting for the analyser on port ${this.server.address().port}`));
  }
  write(buf) { if (this.socket) this.socket.write(buf); }
  stop() { if (this.socket) this.socket.destroy(); this.server.close(); }
}

class TcpClient extends EventEmitter {
  constructor(cfg) { super(); this.cfg = cfg; this.stopped = false; setImmediate(() => this.connect()); }
  connect() {
    if (this.stopped) return;
    const socket = net.connect(this.cfg.port, this.cfg.host);
    socket.on('connect', () => { this.socket = socket; this.emit('open', `${this.cfg.host}:${this.cfg.port}`); });
    socket.on('data', d => this.emit('data', d));
    socket.on('error', e => this.emit('log', `Cannot reach the analyser at ${this.cfg.host}:${this.cfg.port}: ${e.message}`));
    socket.on('close', () => {
      if (this.socket === socket) { this.socket = null; this.emit('close'); }
      setTimeout(() => this.connect(), this.cfg.reconnectMs || 5000);
    });
  }
  write(buf) { if (this.socket) this.socket.write(buf); }
  stop() { this.stopped = true; if (this.socket) this.socket.destroy(); }
}

class Serial extends EventEmitter {
  constructor(cfg) {
    super();
    let SerialPort;
    try { ({ SerialPort } = require('serialport')); } catch (e) {
      throw new Error('A serial connection needs the "serialport" package — run "npm install" in the bridge folder first.');
    }
    this.port = new SerialPort({
      path: cfg.path, baudRate: cfg.baudRate || 9600, dataBits: cfg.dataBits || 8, parity: cfg.parity || 'none', stopBits: cfg.stopBits || 1,
    });
    this.port.on('open', () => this.emit('open', cfg.path));
    this.port.on('data', d => this.emit('data', d));
    this.port.on('error', e => this.emit('fatal', e));
    this.port.on('close', () => this.emit('close'));
  }
  write(buf) { this.port.write(buf); }
  stop() { this.port.close(); }
}

function openTransport(cfg) {
  if (cfg.type === 'tcp-server') return new TcpServer(cfg);
  if (cfg.type === 'tcp-client') return new TcpClient(cfg);
  if (cfg.type === 'serial') return new Serial(cfg);
  throw new Error(`Unknown transport type "${cfg.type}" — use tcp-server, tcp-client or serial`);
}

module.exports = { openTransport };
