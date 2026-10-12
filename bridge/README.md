# AtollLIS analyser bridge

A small program that runs on a PC in the lab, next to one analyser. It speaks the analyser's own
protocol on one side and talks to AtollLIS over HTTPS on the other:

```
analyser  <— ASTM or HL7 —>  bridge (lab PC)  <— HTTPS —>  AtollLIS
```

The analyser never needs internet access, and AtollLIS never needs to reach into the lab network.
Run one bridge per analyser.

## What it does

- **Host query.** The analyser reads a tube's barcode and asks what to run. The bridge asks
  AtollLIS and passes back the tests on that tube that are mapped to this instrument. Those tests
  move to "Loaded to Analyser — Processing".
- **Results.** Results from the analyser are sent to AtollLIS, where they wait for validation by a
  person exactly like a manually entered result. Anything that cannot be placed safely (unknown
  barcode, unmapped code, wrong unit) is held under Result Processing → Analyser Interface.
- **Outages.** Each result batch is written to the `queue/` folder first and deleted only when
  AtollLIS confirms it, so an internet outage or a restart delays results but does not lose them.
  While AtollLIS is unreachable, a query is answered "nothing to run"; the analyser can ask again.

## Standards

| Protocol | Standard | Connection |
|---|---|---|
| `astm` | CLSI LIS01-A2 (ASTM E1381) link layer + CLSI LIS02-A2 (ASTM E1394) records | Network or serial cable |
| `hl7` | HL7 v2.5.1 over MLLP, IHE LAW message set (QBP^Q11 / RSP^K11 / OML^O33 / OUL^R22, also ORU^R01) | Network |

## Setting up

1. Install Node.js 18 or newer on the lab PC.
2. Copy this `bridge` folder to the PC. For a **serial cable** connection only, run `npm install`
   in the folder (it fetches the `serialport` package). A network connection needs nothing installed.
3. In AtollLIS: **Settings → Instruments → New Instrument**. Copy the key it shows — it is shown once.
4. Still in Settings → Instruments, open **Test Codes** and enter the analyser's code for each test,
   from the analyser's host-interface manual.
5. Copy `config.example.json` to `config.json` and fill it in (below).
6. Start it: `node bridge.js`. Set it up to start with the PC (Task Scheduler / a service).
7. On the analyser, switch on its host (LIS) connection and, for bidirectional use, host query mode.

## config.json

| Setting | Meaning |
|---|---|
| `lisUrl` | The AtollLIS address, e.g. `https://…` |
| `instrumentKey` | The key from Settings → Instruments |
| `protocol` | `astm` or `hl7` — must match what the analyser is set to |
| `transport` | How the analyser is connected — one of the three forms below |
| `astm.testIdComponent` | Which part of the ASTM test ID holds the analyser's code. `4` is usual (`^^^CODE`) |
| `astm.orderActionCode` | Action code sent with orders. `N` (new) by default; some analysers expect `A` |
| `queueDir` | Where undelivered results wait. Default `./queue` |
| `logRaw` | `true` prints every raw message — useful when first connecting an analyser. It prints patient names, so switch it off afterwards |

Transport forms:

```json
{ "type": "tcp-server", "port": 5001 }                          the analyser connects to this PC
{ "type": "tcp-client", "host": "192.168.1.50", "port": 5001 }  this PC connects to the analyser
{ "type": "serial", "path": "COM3", "baudRate": 9600, "dataBits": 8, "parity": "none", "stopBits": 1 }
```

The serial settings must equal the ones set on the analyser.

## Trying it without an analyser

`simulator.js` plays the analyser's part against a bridge using a `tcp-server` transport:

```
node simulator.js --protocol astm --port 5001 --specimen <barcode>
node simulator.js --protocol astm --port 5001 --specimen <barcode> --result <code>=<value>:<unit>
```

The first form only asks what to run; the second also sends a result back. **The simulator sends
whatever is typed, as if an analyser had measured it — never point it at the live system with a
real patient's barcode.**

## Connecting a real analyser

Analysers differ in the details of both protocols. Before relying on a new instrument, connect it
with `logRaw` on, run QC material and a test specimen, and confirm in Result Processing → Analyser
Interface that queries and results appear as expected.
