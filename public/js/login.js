/* ============================= LOGIN / LOGOUT ============================= */
async function renderApp(){
  const app = document.getElementById('app');
  const login = document.getElementById('loginScreen');
  if(!session.token){
    app.classList.remove('show');
    login.classList.add('show');
    await renderLoginScreen();
  }else{
    login.classList.remove('show');
    app.classList.add('show');
    await render();
  }
}
let pendingFacilityLogin = null; // {username, password, defaultFacilityId, facilities} while choosing between >1 authorized facility
let pendingPasswordChange = null; // {username, currentPassword, token, user} — logged in with a password someone else set

// Password rules — keep in step with src/utils/password.js.
const PASSWORD_MIN_LENGTH = 10;
function passwordProblem(pw, username){
  if(String(pw||'').length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if(username && String(pw).toLowerCase().includes(String(username).toLowerCase())) return 'Password must not contain the username.';
  return null;
}

async function renderLoginScreen(){
  const el = document.getElementById('loginScreen');
  el.innerHTML = `<div class="login-card"><div class="brand" style="padding:0 0 18px;border:none;">
    <div class="mark" style="color:var(--navy);">Atoll<span style="color:var(--teal);">LIS</span></div>
    <div class="sub" style="color:var(--mute);">Laboratory Information System</div></div>
    <p class="muted" style="font-size:12.5px;">Connecting…</p></div>`;

  let backendOk = true, loadError = '';
  try{ await apiRequest('/health', {auth:false}); }
  catch(e){ backendOk = false; loadError = e.message; }

  if(pendingPasswordChange){ renderPasswordChangeStep(); return; }
  if(pendingFacilityLogin){ renderFacilitySelectionStep(); return; }

  el.innerHTML = `
    <div class="login-card">
      <div class="brand" style="padding:0 0 18px;border:none;">
        <div class="mark" style="color:var(--navy);">Atoll<span style="color:var(--teal);">LIS</span></div>
        <div class="sub" style="color:var(--mute);">Laboratory Information System</div>
      </div>
      ${!backendOk? `<p style="color:var(--crimson);font-size:12px;">${escapeHtml(loadError)}</p><button class="btn btn-outline" style="width:100%;margin-bottom:14px;" onclick="renderLoginScreen()">Retry Connection</button>` : ''}
      <div class="grid grid-2">
        <div class="field"><label>Username</label><input id="login_user" autocomplete="username" onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('login_pass').focus();}"></div>
        <div class="field"><label>Password</label><input id="login_pass" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter'){event.preventDefault();doLogin();}"></div>
      </div>
      <button class="btn" style="width:100%;" onclick="doLogin()">Log In</button>
    </div>`;
}
// Shown only when the account is authorized at more than one facility — and only after the
// password has already verified correctly, never before.
function renderFacilitySelectionStep(){
  const { defaultFacilityId, facilities } = pendingFacilityLogin;
  const el = document.getElementById('loginScreen');
  el.innerHTML = `
    <div class="login-card">
      <div class="brand" style="padding:0 0 18px;border:none;">
        <div class="mark" style="color:var(--navy);">Atoll<span style="color:var(--teal);">LIS</span></div>
        <div class="sub" style="color:var(--mute);">Laboratory Information System</div>
      </div>
      <p class="muted" style="font-size:12.5px;margin-top:-6px;">Password verified. This account is authorized at more than one facility — choose which one.</p>
      <div class="field"><label>Facility</label>
        <select id="login_pick_fac">${facilities.map(f=>`<option value="${f.id}" ${f.id===defaultFacilityId?'selected':''}>${escapeHtml(f.name)} — ${TIER_SHORT[f.tier]||f.tier}</option>`).join('')}</select>
      </div>
      <button class="btn" style="width:100%;" onclick="doFacilityPickLogin()">Continue</button>
      <button class="btn btn-outline" style="width:100%;margin-top:8px;" onclick="pendingFacilityLogin=null;renderLoginScreen();">Cancel</button>
    </div>`;
}
// Shown after a login whose password was set by someone else (a new account, or a reset): the
// owner chooses their own before anything else. The password just typed is the current one.
function renderPasswordChangeStep(){
  const el = document.getElementById('loginScreen');
  el.innerHTML = `
    <div class="login-card">
      <div class="brand" style="padding:0 0 18px;border:none;">
        <div class="mark" style="color:var(--navy);">Atoll<span style="color:var(--teal);">LIS</span></div>
        <div class="sub" style="color:var(--mute);">Laboratory Information System</div>
      </div>
      <h2 style="font-size:15px;">Choose your own password</h2>
      <p class="muted" style="font-size:12.5px;margin-top:-6px;">Your password was set by someone else. Choose one only you know: at least ${PASSWORD_MIN_LENGTH} characters, not containing your username.</p>
      <div class="field"><label>New password</label><input id="first_pw_new" type="password" autocomplete="new-password" onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('first_pw_confirm').focus();}"></div>
      <div class="field"><label>Confirm new password</label><input id="first_pw_confirm" type="password" autocomplete="new-password" onkeydown="if(event.key==='Enter'){event.preventDefault();doFirstPasswordChange();}"></div>
      <button class="btn" style="width:100%;" onclick="doFirstPasswordChange()">Set my password</button>
      <button class="btn btn-outline" style="width:100%;margin-top:8px;" onclick="pendingPasswordChange=null;session={token:null,user:null};renderLoginScreen();">Cancel</button>
    </div>`;
  const first = document.getElementById('first_pw_new'); if(first) first.focus();
}
async function doFirstPasswordChange(){
  const next = document.getElementById('first_pw_new').value;
  const confirm2 = document.getElementById('first_pw_confirm').value;
  const { username, currentPassword, token, user } = pendingPasswordChange;
  const problem = passwordProblem(next, username);
  if(problem){ showToast(problem, 'error'); return; }
  if(next!==confirm2){ showToast('The two passwords do not match.', 'error'); return; }
  session.token = token; // not saved until the change succeeds
  try{
    const res = await api.changePassword(currentPassword, next);
    pendingPasswordChange = null;
    await finishLogin({ token: res.token, user: { ...user, mustChangePassword: false } });
  }catch(e){
    showToast(e.message, 'error');
  }
}
// Everything after a successful login, whichever step it came through.
async function finishLogin(data, username, password){
  if(data.user.mustChangePassword){
    pendingPasswordChange = { username, currentPassword: password, token: data.token, user: data.user };
    renderPasswordChangeStep();
    return;
  }
  session.token = data.token; session.user = data.user;
  await bootstrapCaches();
  state.activeView = 'dashboard';
  saveSession();
  noteActivity();
  await renderApp();
}
async function doFacilityPickLogin(){
  const actingFacilityId = document.getElementById('login_pick_fac').value;
  const { username, password } = pendingFacilityLogin;
  try{
    const data = await api.login(username, password, actingFacilityId);
    pendingFacilityLogin = null;
    await finishLogin(data, username, password);
  }catch(e){
    showToast(e.message);
    pendingFacilityLogin = null;
    await renderLoginScreen();
  }
}
async function doLogin(){
  const username = (document.getElementById('login_user').value||'').trim();
  const password = document.getElementById('login_pass').value;
  if(!username || !password){ showToast('Enter username and password.'); return; }
  try{
    const data = await api.login(username, password);
    if(data.requiresFacilitySelection){
      pendingFacilityLogin = { username, password, defaultFacilityId: data.defaultFacilityId, facilities: data.facilities };
      renderFacilitySelectionStep();
      return;
    }
    await finishLogin(data, username, password);
  }catch(e){
    showToast(e.message, 'error');
  }
}
async function bootstrapCaches(){
  try{ facilitiesCache = await api.facilities(); }catch(e){ facilitiesCache = []; }
  try{ catalogCache = await api.catalog(); }catch(e){ catalogCache = []; }
  try{ categoriesCache = await api.categories(); }catch(e){ categoriesCache = []; }
  try{ roleCapabilitiesCache = await api.roleCapabilities(); }catch(e){ roleCapabilitiesCache = {roles:[], allCapabilities:[]}; }
}
// Demo convenience only: seeded accounts all use username=facilityId, password=password123, so
// Regional admin can "view as" another lab without re-typing credentials. A real deployment would
// not have this shortcut — each facility's staff would hold their own credentials.
function doLogout(){
  session = { token:null, user:null };
  pendingPasswordChange = null;
  saveSession(); getCache.clear();
  closeModal(); document.getElementById('confirmRoot').innerHTML = '';
  hideIdleWarning();
  facilitiesCache = []; catalogCache = []; categoriesCache = []; roleCapabilitiesCache = {roles:[], allCapabilities:[]};
  closeSidebar();
  renderApp();
}

// Idle logout (owner's setting, 2026-10-26): a bench PC left logged in is anyone's access to
// patient results. After IDLE_MINUTES without a key, click, touch or scroll the session ends; a
// minute before that, a notice on top of everything says so and any activity cancels it.
const IDLE_MINUTES = 15, IDLE_WARNING_SECONDS = 60;
let lastActivity = Date.now();
function noteActivity(){ lastActivity = Date.now(); hideIdleWarning(); }
['mousedown','keydown','scroll','touchstart','wheel'].forEach(ev=>document.addEventListener(ev, ()=>{ if(session.token) noteActivity(); }, {passive:true, capture:true}));
function idleRoot(){
  let el = document.getElementById('idleRoot');
  if(!el){ el = document.createElement('div'); el.id = 'idleRoot'; document.body.appendChild(el); }
  return el;
}
function showIdleWarning(secondsLeft){
  idleRoot().innerHTML = `<div class="modal-overlay" style="z-index:300;"><div class="modal" role="alertdialog" aria-labelledby="idleTitle" style="max-width:380px;">
    <h2 id="idleTitle">Still there?</h2>
    <p style="font-size:13.5px;">You will be logged out in <b class="mono">${secondsLeft}</b> seconds because nothing has been done on this screen for ${IDLE_MINUTES - 1} minutes. Anything not yet saved will be lost.</p>
    <div class="actions-row"><button class="btn" onclick="noteActivity()">Stay logged in</button><button class="btn btn-outline" onclick="doLogout()">Log out now</button></div>
  </div></div>`;
}
function hideIdleWarning(){ const el = document.getElementById('idleRoot'); if(el) el.innerHTML = ''; }
setInterval(()=>{
  if(!session.token || pendingPasswordChange) return;
  const idleSeconds = (Date.now() - lastActivity) / 1000;
  if(idleSeconds >= IDLE_MINUTES*60){
    doLogout();
    showToast(`You were logged out after ${IDLE_MINUTES} minutes without activity.`, 'error');
  }else if(idleSeconds >= IDLE_MINUTES*60 - IDLE_WARNING_SECONDS){
    showIdleWarning(Math.ceil(IDLE_MINUTES*60 - idleSeconds));
  }
}, 1000);

