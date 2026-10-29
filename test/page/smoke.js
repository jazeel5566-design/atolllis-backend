// Page smoke test (npm run test:page): with the app running on localhost:4000 against the dev
// branch, logs into the real page in headless Chrome as a temporary admin, opens every screen and
// tab, and reports script errors and screens that fail to load. Creates and removes its own
// zz_test_ account. CHROME_PATH overrides where Chrome is.
require('dotenv').config();
const { spawn } = require('child_process');
const os = require('os');
const bcrypt = require('bcryptjs');
const prisma = require('../../src/db');
const { uid } = require('../../src/utils/id');
const { assertDevBranch } = require('../../src/utils/db-guard');

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP = process.env.APP_URL || 'http://localhost:4000/';
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await assertDevBranch(prisma);
  const username = 'zz_test_smoke_' + Date.now().toString(36);
  const password = 'smoke-pass-' + Date.now().toString(36);
  const regional = await prisma.facility.findFirst({ where: { tier: 'regional' } });
  const user = await prisma.user.create({ data: { name: 'ZZ Test smoke', username, passwordHash: await bcrypt.hash(password, 10), role: 'admin', facilityId: regional.id } });
  await prisma.userFacilityAccess.create({ data: { id: uid('UFA'), userId: user.id, facilityId: regional.id } });

  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${os.tmpdir()}/atolllis-smoke-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });
  const errors = [];
  let failures = 0;
  try {
    let target;
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250);
      try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page'); } catch (e) { /* not up yet */ }
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));
    let id = 0; const pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      if (msg.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n').slice(0, 2).join(' '));
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('CONSOLE ' + msg.params.args.map(a => a.value || a.description).join(' '));
    });
    const send = (method, params = {}) => new Promise(r => { const mid = ++id; pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })); });
    const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result;

    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: APP });
    await sleep(2500);
    await evaluate(`document.getElementById('login_user').value=${JSON.stringify(username)}; document.getElementById('login_pass').value=${JSON.stringify(password)}; doLogin();`);
    await sleep(3000);
    const loggedIn = await evaluate(`!!session.token`);
    console.log('logged in:', loggedIn.result.value);

    const screens = [
      ['dashboard'], ['processflow'], ['collection'], ['acceptance'],
      ...['analyser', 'incoming', 'critical', 'interface'].map(t => ['processing', `processingTab='${t}'`]),
      ...['todo', 'done', 'lab', 'all'].map(t => ['reports', `deskTab='${t}';deskQuery=''`]),
      ['reports', `deskQuery='ZZ-NO-MATCH'`],
      ['patients', `folderPatientId=null;deskQuery=''`],
    ];
    const settingsTabs = (await evaluate(`SETTINGS_GROUPS.flatMap(g=>g.tabs.map(t=>t.id))`)).result.value;
    settingsTabs.forEach(t => screens.push(['settings', `settingsTab='${t}'`]));

    for (const [view, setup] of screens) {
      const before = errors.length;
      const r = await evaluate(`(async()=>{ ${setup || ''}; state.activeView='${view}'; await render(); const c=document.getElementById('content'); return { len: c.innerText.length, failed: /could not be loaded/.test(c.innerText) }; })()`);
      const v = r.result.value || {};
      if (v.failed) failures++;
      console.log(`${(view + (setup ? ' ' + setup.split("'")[1] : '')).padEnd(26)} ${v.failed ? 'FAILED TO LOAD' : 'ok'}  (${v.len} chars)${errors.length > before ? '  <-- errors' : ''}`);
    }
    ws.close();
  } finally {
    chrome.kill();
    await prisma.auditLog.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
  console.log(errors.length ? `\n${errors.length} error(s):\n` + [...new Set(errors)].join('\n') : '\nno script errors');
  if (errors.length || failures) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
