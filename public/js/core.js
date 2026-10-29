/* ============================= CONSTANTS ============================= */
// When this page is served BY the backend itself (the recommended combined-deployment setup),
// the API lives at the same origin, so no configuration is needed at all. When the file is opened
// directly (file://) for local dev against a separately-running backend, fall back to localhost.
const DEFAULT_API_BASE = (location.protocol === 'file:')
  ? 'http://localhost:4000/api'
  : (location.origin + '/api');
const TIER_SHORT = {health_centre:'Health Centre', atoll:'Atoll Hospital', regional:'Regional Hospital'};
const TIER_CLASS = {health_centre:'tier-health_centre', atoll:'tier-atoll', regional:'tier-regional'};
const ROLE_LABELS = {phlebotomist:'Phlebotomist', reception_clerk:'Reception Clerk', clinician:'Clinician', technologist:'Technologist', pathologist:'Pathologist', lab_manager:'Lab Manager', admin:'Administrator'};
// Which capabilities each role has is editable (Settings → Users → Role Permissions), so this is
// fetched fresh at login rather than fixed in this file — roleCapabilitiesCache is the live copy.
let roleCapabilitiesCache = { roles: [], allCapabilities: [] };
function hasCapability(cap){
  if(!session.user) return false;
  const entry = roleCapabilitiesCache.roles.find(r=>r.role===session.user.role);
  return entry ? entry.capabilities.includes(cap) : false;
}

// `needs` lists capabilities, any one of which makes the section useful to a role; sections without
// it are for everyone. A role is not shown a section it cannot act in. `icon` names a drawing in
// NAV_ICONS (shell.js).
const LAB_WORK = ['collect','accept','process','certify'];
const NAV_ITEMS = [
  {id:'dashboard', label:'My work', icon:'home'},
  {id:'processflow', label:'Process flow', icon:'flow', needs:LAB_WORK},
  {id:'collection', label:'Collection', icon:'tube', needs:['collect']},
  {id:'acceptance', label:'Acceptance', icon:'check', needs:['accept']},
  {id:'processing', label:'Processing', icon:'flask', needs:['process','certify']},
  {id:'reports', label:'Reports', icon:'report', needs:['view_reports']},
  {id:'patients', label:'Patients', icon:'folder', needs:['view_patient_records']},
  {id:'settings', label:'Settings', icon:'gear'},
];
function isLabStaff(){ return LAB_WORK.some(hasCapability); }
function navItemsForRole(){ return NAV_ITEMS.filter(n=>!n.needs || n.needs.some(hasCapability)); }

const STATUS_META = {
  deselected:{label:'Not Collected (deselected)', cls:'pill-grey'},
  ordered:{label:'Awaiting Collection', cls:'pill-grey'},
  collected:{label:'Sample Collected — Awaiting Acceptance', cls:'pill-amber'},
  rejected:{label:'Sample Rejected', cls:'pill-crimson'},
  awaiting_referral:{label:'Ready — Refer Upward', cls:'pill-purple'},
  awaiting_receipt:{label:'In Transit to Higher-Level Lab', cls:'pill-purple'},
  received:{label:'Received — Awaiting Processing', cls:'pill-amber'},
  processing:{label:'Loaded to Analyser — Processing', cls:'pill-amber'},
  interfaced:{label:'Result In — Awaiting Validation', cls:'pill-amber'},
  completed:{label:'Validated & Certified — Completed', cls:'pill-teal'},
};

/* ============================= SESSION & CACHES ============================= */
let API_BASE = DEFAULT_API_BASE;
let session = { token: null, user: null }; // user: { name, facilityId, facilityName, tier }
let facilitiesCache = [];
let catalogCache = [];
let categoriesCache = [];
let organismsCache = [];
let antibioticsCache = [];
let wardsCache = [];
let state = { activeView: 'dashboard' };
// Kept for this browser tab only, so a refresh does not log the user out. Closing the tab ends it.
function saveSession(){
  try{
    if(session.token) sessionStorage.setItem('atolllis.session', JSON.stringify({token:session.token, user:session.user, activeView:state.activeView}));
    else sessionStorage.removeItem('atolllis.session');
  }catch(e){ /* storage unavailable — the session simply will not survive a refresh */ }
}
function restoreSession(){
  try{
    const saved = JSON.parse(sessionStorage.getItem('atolllis.session')||'null');
    if(saved && saved.token && saved.user){ session = {token:saved.token, user:saved.user}; state.activeView = saved.activeView || 'dashboard'; return true; }
  }catch(e){ /* ignore a damaged entry */ }
  return false;
}

/* ============================= API CLIENT ============================= */
// Typing in a search box or changing a filter re-draws the screen from the answers already
// loaded (renderCached), instead of asking the server again on every keystroke — that is what made
// search crawl on a slow line. Any change sent to the server empties this, so nothing stale is
// shown after an action.
const getCache = new Map();
let renderingFromCache = false;
async function apiRequest(path, opts){
  opts = opts || {};
  const isGet = !opts.method || opts.method==='GET';
  if(isGet && renderingFromCache && getCache.has(path)) return JSON.parse(getCache.get(path));
  const headers = {'Content-Type':'application/json'};
  if(opts.auth!==false && session.token) headers['Authorization'] = 'Bearer ' + session.token;
  let res;
  try{
    res = await fetch(API_BASE + path, { method: opts.method||'GET', headers, body: opts.body? JSON.stringify(opts.body) : undefined });
  }catch(networkErr){
    throw new Error(`Could not reach the backend at ${API_BASE} — is it running? (${networkErr.message})`);
  }
  let data = null;
  try{ data = await res.json(); }catch(e){ /* empty body */ }
  if(!res.ok){
    if(res.status===401 && opts.auth!==false && session.token){
      // The login has run out (or the server restarted): back to the login screen, saying why.
      doLogout();
      throw new Error('Your session has ended — log in again to continue.');
    }
    const err = new Error((data && data.error) || `Request failed (HTTP ${res.status})`);
    err.status = res.status; err.data = data;
    throw err;
  }
  if(isGet) getCache.set(path, JSON.stringify(data)); else getCache.clear();
  return data;
}
const api = {
  publicFacilities: () => apiRequest('/auth/facilities', {auth:false}),
  detectFacility: () => apiRequest('/auth/detect-facility', {auth:false}),
  login: (username, password, actingFacilityId) => apiRequest('/auth/login', {method:'POST', body:{username, password, actingFacilityId}, auth:false}),
  facilities: () => apiRequest('/facilities'),
  createFacility: (data) => apiRequest('/facilities', {method:'POST', body:data}),
  deleteFacility: (id) => apiRequest(`/facilities/${id}`, {method:'DELETE'}),
  catalog: () => apiRequest('/catalog'),
  createTest: (data) => apiRequest('/catalog', {method:'POST', body:data}),
  updateTest: (code,data) => apiRequest(`/catalog/${encodeURIComponent(code)}`, {method:'PUT', body:data}),
  deleteTest: (code) => apiRequest(`/catalog/${encodeURIComponent(code)}`, {method:'DELETE'}),
  categories: () => apiRequest('/categories'),
  createCategory: (data) => apiRequest('/categories', {method:'POST', body:data}),
  updateCategory: (id,data) => apiRequest(`/categories/${id}`, {method:'PUT', body:data}),
  deleteCategory: (id) => apiRequest(`/categories/${id}`, {method:'DELETE'}),
  users: (facilityId) => apiRequest(`/users${facilityId?('?facilityId='+facilityId):''}`),
  createUser: (data) => apiRequest('/users', {method:'POST', body:data}),
  updateUser: (id,data) => apiRequest(`/users/${id}`, {method:'PUT', body:data}),
  deleteUser: (id) => apiRequest(`/users/${id}`, {method:'DELETE'}),
  changePassword: (currentPassword,newPassword) => apiRequest('/auth/change-password', {method:'POST', body:{currentPassword,newPassword}}),
  facilityNetworks: () => apiRequest('/facility-networks'),
  createFacilityNetwork: (data) => apiRequest('/facility-networks', {method:'POST', body:data}),
  deleteFacilityNetwork: (id) => apiRequest(`/facility-networks/${id}`, {method:'DELETE'}),
  roleCapabilities: () => apiRequest('/role-capabilities'),
  updateRoleCapabilities: (role,capabilities) => apiRequest(`/role-capabilities/${role}`, {method:'PUT', body:{capabilities}}),
  grantFacilityAccess: (userId,facilityId) => apiRequest(`/users/${userId}/facility-access`, {method:'POST', body:{facilityId}}),
  revokeFacilityAccess: (userId,facilityId) => apiRequest(`/users/${userId}/facility-access/${facilityId}`, {method:'DELETE'}),
  auditLog: (params) => apiRequest(`/audit${params?('?'+params):''}`),
  importMemo: (memoNumber) => apiRequest('/orders/import', {method:'POST', body:{memoNumber}}),
  searchHis: (query) => apiRequest(`/his/search?query=${encodeURIComponent(query)}`),
  seedHisMemo: (data) => apiRequest('/his/memos', {method:'POST', body:data}),
  orders: (stage) => apiRequest(`/orders${stage?('?stage='+stage):''}`),
  order: (id) => apiRequest(`/orders/${id}`),
  cancelMemo: (id) => apiRequest(`/orders/${id}`, {method:'DELETE'}),
  collect: (id, selectedCodes, extra) => apiRequest(`/orders/${id}/collect`, {method:'POST', body:{selectedCodes, ...(extra||{})}}),
  wards: (facilityId) => apiRequest(`/wards${facilityId?('?facilityId='+encodeURIComponent(facilityId)):''}`),
  createWard: (name, facilityId) => apiRequest('/wards', {method:'POST', body:{name, facilityId}}),
  deleteWard: (id) => apiRequest(`/wards/${id}`, {method:'DELETE'}),
  rejectionReasons: () => apiRequest('/rejection-reasons'),
  createRejectionReason: (name) => apiRequest('/rejection-reasons', {method:'POST', body:{name}}),
  deleteRejectionReason: (id) => apiRequest(`/rejection-reasons/${id}`, {method:'DELETE'}),
  recollect: (id, testCodes) => apiRequest(`/orders/${id}/recollect`, {method:'POST', body:{testCodes}}),
  refer: (id) => apiRequest(`/orders/${id}/refer`, {method:'POST'}),
  receiveReferral: (id) => apiRequest(`/orders/${id}/receive-referral`, {method:'POST'}),
  getSpecimen: (specimenNumber) => apiRequest(`/specimens/${encodeURIComponent(specimenNumber)}`),
  loadSpecimenAnalyser: (specimenNumber) => apiRequest(`/specimens/${encodeURIComponent(specimenNumber)}/load-analyser`, {method:'POST'}),
  acceptSpecimen: (specimenNumber) => apiRequest(`/specimens/${encodeURIComponent(specimenNumber)}/accept`, {method:'POST'}),
  rejectSpecimen: (specimenNumber, reasonId, note) => apiRequest(`/specimens/${encodeURIComponent(specimenNumber)}/reject`, {method:'POST', body:{reasonId, note}}),
  receiveReferredSpecimen: (specimenNumber) => apiRequest(`/specimens/${encodeURIComponent(specimenNumber)}/receive-referral`, {method:'POST'}),
  rejectReferredSpecimen: (specimenNumber, reasonId, note) => apiRequest(`/specimens/${encodeURIComponent(specimenNumber)}/reject-referral`, {method:'POST', body:{reasonId, note}}),
  rejections: (params) => apiRequest(`/specimens/rejections${params?('?'+params):''}`),
  manualResult: (orderId, code, value) => apiRequest(`/tests/${orderId}/${encodeURIComponent(code)}/manual-result`, {method:'POST', body:{value}}),
  certify: (orderId, code) => apiRequest(`/tests/${orderId}/${encodeURIComponent(code)}/certify`, {method:'POST'}),
  criticalWorklist: () => apiRequest('/tests/critical'),
  amendResult: (orderId, code, data) => apiRequest(`/tests/${orderId}/${encodeURIComponent(code)}/amend`, {method:'POST', body:data}),
  amendments: (pending) => apiRequest('/tests/amendments' + (pending?'?pending=1':'')),
  recordAmendmentNotification: (id, data) => apiRequest(`/tests/amendments/${id}/notification`, {method:'POST', body:data}),
  criticalLog: (params) => apiRequest(`/tests/critical-log${params?('?'+params):''}`),
  instruments: (facilityId) => apiRequest(`/instruments${facilityId?('?facilityId='+encodeURIComponent(facilityId)):''}`),
  createInstrument: (data) => apiRequest('/instruments', {method:'POST', body:data}),
  updateInstrument: (id, data) => apiRequest(`/instruments/${id}`, {method:'PUT', body:data}),
  deleteInstrument: (id) => apiRequest(`/instruments/${id}`, {method:'DELETE'}),
  regenerateInstrumentKey: (id) => apiRequest(`/instruments/${id}/regenerate-key`, {method:'POST'}),
  instrumentMaps: (id) => apiRequest(`/instruments/${id}/maps`),
  createInstrumentMap: (id, data) => apiRequest(`/instruments/${id}/maps`, {method:'POST', body:data}),
  deleteInstrumentMap: (id, mapId) => apiRequest(`/instruments/${id}/maps/${mapId}`, {method:'DELETE'}),
  interfaceMessages: (view) => apiRequest(`/instruments/messages?view=${view||'held'}`),
  retryInterfaceMessage: (id) => apiRequest(`/instruments/messages/${id}/retry`, {method:'POST'}),
  dismissInterfaceMessage: (id, note) => apiRequest(`/instruments/messages/${id}/dismiss`, {method:'POST', body:{note}}),
  recordCriticalNotification: (orderId, code, data) => apiRequest(`/tests/${orderId}/${encodeURIComponent(code)}/critical-notification`, {method:'POST', body:data}),
  addReflexTest: (orderId, code) => apiRequest(`/tests/${orderId}/add-reflex-test`, {method:'POST', body:{code}}),
  testAliases: () => apiRequest('/test-aliases'),
  createTestAlias: (data) => apiRequest('/test-aliases', {method:'POST', body:data}),
  deleteTestAlias: (id) => apiRequest(`/test-aliases/${id}`, {method:'DELETE'}),
  testPanels: () => apiRequest('/test-panels'),
  createTestPanel: (data) => apiRequest('/test-panels', {method:'POST', body:data}),
  updateTestPanel: (id,data) => apiRequest(`/test-panels/${id}`, {method:'PUT', body:data}),
  deleteTestPanel: (id) => apiRequest(`/test-panels/${id}`, {method:'DELETE'}),
  reflexRules: () => apiRequest('/reflex-rules'),
  createReflexRule: (data) => apiRequest('/reflex-rules', {method:'POST', body:data}),
  updateReflexRule: (id,data) => apiRequest(`/reflex-rules/${id}`, {method:'PUT', body:data}),
  deleteReflexRule: (id) => apiRequest(`/reflex-rules/${id}`, {method:'DELETE'}),
  organisms: () => apiRequest('/organisms'),
  createOrganism: (data) => apiRequest('/organisms', {method:'POST', body:data}),
  deleteOrganism: (id) => apiRequest(`/organisms/${id}`, {method:'DELETE'}),
  organismPanel: (id) => apiRequest(`/organisms/${id}/panel`),
  updateOrganismPanel: (id,antibioticIds) => apiRequest(`/organisms/${id}/panel`, {method:'PUT', body:{antibioticIds}}),
  antibiotics: () => apiRequest('/antibiotics'),
  createAntibiotic: (data) => apiRequest('/antibiotics', {method:'POST', body:data}),
  deleteAntibiotic: (id) => apiRequest(`/antibiotics/${id}`, {method:'DELETE'}),
  cultureResult: (orderId,code) => apiRequest(`/tests/${orderId}/${encodeURIComponent(code)}/culture-result`),
  saveCultureResult: (orderId,code,data) => apiRequest(`/tests/${orderId}/${encodeURIComponent(code)}/culture-result`, {method:'POST', body:data}),
  reportDesk: (query) => apiRequest(`/reports/desk${query?('?query='+encodeURIComponent(query)):''}`),
  report: (orderId) => apiRequest(`/reports/${encodeURIComponent(orderId)}`),
  recordHandover: (orderId, receiverName, receiverPhone) => apiRequest(`/reports/${encodeURIComponent(orderId)}/handover`, {method:'POST', body:{receiverName, receiverPhone}}),
  recordReprint: (orderId) => apiRequest(`/reports/${encodeURIComponent(orderId)}/reprint`, {method:'POST'}),
  patientRecords: (query) => apiRequest(`/patients/records?query=${encodeURIComponent(query)}`),
  patientFolder: (id) => apiRequest(`/patients/${encodeURIComponent(id)}/folder`),
  setPatientDhivehiName: (id, nameDhivehi) => apiRequest(`/patients/${encodeURIComponent(id)}/dhivehi-name`, {method:'PUT', body:{nameDhivehi}}),
  setFacilityDhivehi: (id, data) => apiRequest(`/facilities/${encodeURIComponent(id)}/dhivehi`, {method:'PUT', body:data}),
};

/* ============================= HELPERS ============================= */
function fac(id){ return facilitiesCache.find(f=>f.id===id) || {id, name:id||'Unknown facility', tier:'health_centre'}; }
function test(code){ return catalogCache.find(t=>t.code===code); }
function isRegional(){ return session.user && session.user.tier==='regional'; }
// A birth date is a calendar date: "2026-06-10" is that local day, not UTC midnight. Keep in step
// with parseDob() in src/utils/domain.js.
function parseDob(dob){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob||'').trim());
  return m ? new Date(Number(m[1]), Number(m[2])-1, Number(m[3])) : new Date(dob);
}
function calcAge(dob){
  const d = parseDob(dob), n = new Date();
  let a = n.getFullYear()-d.getFullYear();
  const m = n.getMonth()-d.getMonth();
  if(m<0 || (m===0 && n.getDate()<d.getDate())) a--;
  return a;
}
// Age in completed days, months and years on a date. Keep in step with ageParts() in src/utils/domain.js.
function ageParts(dob, at){
  const d = parseDob(dob);
  let n = at ? new Date(at) : new Date();
  if(Number.isNaN(n.getTime())) n = new Date();
  if(!dob || Number.isNaN(d.getTime())) return null;
  let months = (n.getFullYear()-d.getFullYear())*12 + (n.getMonth()-d.getMonth());
  if(n.getDate()<d.getDate()) months--;
  const days = Math.floor((Date.UTC(n.getFullYear(),n.getMonth(),n.getDate()) - Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()))/86400000);
  return {D:Math.max(0,days), M:Math.max(0,months), Y:Math.max(0,Math.floor(months/12))};
}
const AGE_UNIT_ORDER = {D:0, M:1, Y:2};
const AGE_UNIT_WORDS = {D:'days', M:'months', Y:'years'};
// Mirrors matchRange() in src/utils/domain.js: each band is in its own unit and includes both
// ends; `at` is the specimen's collection date.
function matchRange(t, patient, at){
  const age = ageParts(patient.dob, at), sex = patient.sex;
  if(!age) return null;
  const unitOf = r => AGE_UNIT_ORDER[r.ageUnit]!==undefined ? r.ageUnit : 'Y';
  const cands = (t.refRanges||[]).filter(r => (r.sex==='Any'||r.sex===sex) && age[unitOf(r)]>=(r.ageMin??0) && age[unitOf(r)]<=(r.ageMax??150));
  if(!cands.length) return null;
  cands.sort((a,b)=> ((a.sex==='Any'?1:0)-(b.sex==='Any'?1:0)) || (AGE_UNIT_ORDER[unitOf(a)]-AGE_UNIT_ORDER[unitOf(b)]));
  return cands[0];
}
// A result as a number, or NaN if it isn't one. "<0.05" / ">400" are read as their boundary.
function numericValue(value){ return parseFloat(String(value??'').trim().replace(/^[<>≤≥]=?\s*/, '')); }
// Mirrors evalResult() in src/utils/domain.js — keep the two in step.
function evalResult(t, patient, value, at){
  if(!t) return {flag:'N/A', flagLabel:'Unknown test', rangeText:''};
  const range = matchRange(t, patient, at);
  const rangeText = range ? `${range.low} – ${range.high} ${t.units||''}`.trim() : 'Not established for age/sex';
  const v = numericValue(value);
  if(Number.isNaN(v)) return {flag:'N/A', flagLabel: range?'':'Not established', rangeText};
  // Critical limits first, independent of any reference range.
  if(t.criticalLow!=null && v<=t.criticalLow) return {flag:'CriticalLow', flagLabel:'CRITICAL LOW', rangeText};
  if(t.criticalHigh!=null && v>=t.criticalHigh) return {flag:'CriticalHigh', flagLabel:'CRITICAL HIGH', rangeText};
  if(!range) return {flag:'N/A', flagLabel:'Not established', rangeText};
  if(v<range.low) return {flag:'Low', flagLabel:'Low', rangeText};
  if(v>range.high) return {flag:'High', flagLabel:'High', rangeText};
  return {flag:'Normal', flagLabel:'Normal', rangeText};
}
// One date format on every computer (the browser's own varies): 12 Oct 2026, 22:10.
function fmtDate(iso){ if(!iso) return '—'; const d=new Date(iso); if(Number.isNaN(d.getTime())) return '—'; return d.toLocaleString('en-GB',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}); }
function fmtDob(dob){ if(!dob) return '—'; const d=parseDob(dob); if(Number.isNaN(d.getTime())) return String(dob); return d.toLocaleDateString('en-GB',{year:'numeric',month:'short',day:'numeric'}); }
// Age for display: years from 2 upward; months, then days, below that. Keep in step with
// formatAge() in src/utils/domain.js.
function fmtAge(dob){
  const d = parseDob(dob), n = new Date();
  if(!dob || Number.isNaN(d.getTime())) return '?';
  let months = (n.getFullYear()-d.getFullYear())*12 + (n.getMonth()-d.getMonth());
  if(n.getDate()<d.getDate()) months--;
  if(months>=24) return Math.floor(months/12)+'y';
  if(months>=1) return months+'m';
  return ageParts(dob, n).D+'d'; // calendar days, so the count doesn't depend on the time of day
}
const SEX_LABELS = {M:'Male', F:'Female'};
// "2h 10m" since a moment in time.
function fmtWait(iso){
  const mins = Math.max(0, Math.floor((Date.now()-new Date(iso))/60000));
  if(mins<60) return mins+'m';
  const h = Math.floor(mins/60);
  return h<48 ? `${h}h ${mins%60}m` : `${Math.floor(h/24)}d ${h%24}h`;
}
// The identity block shown wherever a result or a specimen is being acted on.
function patientBar(p, extra){
  const visit = extra?.patientType==='inpatient' ? `In-Patient${extra.wardName?' · '+escapeHtml(extra.wardName):''}` : extra?.patientType==='outpatient' ? 'Out-Patient' : '';
  return `<div class="patient-bar">
    <div><div class="who">${escapeHtml(p?.name||'Unknown patient')}</div>
      <div class="ids">Hospital No. <b>${escapeHtml(p?.hospitalNumber||'—')}</b> · ID No. ${escapeHtml(p?.idNumber||'—')} · ${p?.dob?`${fmtAge(p.dob)} (born ${fmtDob(p.dob)})`:'age unknown'} · ${escapeHtml(SEX_LABELS[p?.sex]||p?.sex||'sex unknown')}${visit?` · ${visit}`:''}</div></div>
    ${extra?.right||''}
  </div>`;
}
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }
// A confirmation fades by itself; an error stays until it is dismissed, so it cannot be missed.
let toastTimer = null;
function showToast(msg, kind){
  const root = document.getElementById('toastRoot');
  clearTimeout(toastTimer);
  if(kind==='error'){
    root.innerHTML = `<div class="toast toast-error" role="alert"><span>${escapeHtml(msg)}</span><button class="toast-close" onclick="document.getElementById('toastRoot').innerHTML=''">Dismiss</button></div>`;
    return;
  }
  root.innerHTML = `<div class="toast" role="status">${escapeHtml(msg)}</div>`;
  toastTimer = setTimeout(()=>{ root.innerHTML=''; }, 3500);
}
// Asks before a change that cannot be undone, saying exactly what will change. Resolves true/false.
// Lives in its own layer so it can sit on top of an open dialog.
let confirmResolve = null;
function confirmAction({title, body, confirmLabel, danger}){
  return new Promise(resolve=>{
    confirmResolve = resolve;
    document.getElementById('confirmRoot').innerHTML = `
    <div class="modal-overlay" role="dialog" aria-modal="true">
      <div class="modal" style="max-width:440px;">
        <div class="modal-head"><h2>${escapeHtml(title)}</h2></div>
        <p style="font-size:13.5px;margin-top:-4px;line-height:1.5;">${body}</p>
        <div class="actions-row"><button class="btn ${danger===false?'':'btn-danger'}" id="confirmYes" onclick="answerConfirm(true)">${escapeHtml(confirmLabel)}</button><button class="btn btn-outline" onclick="answerConfirm(false)">Cancel</button></div>
      </div>
    </div>`;
    const yes = document.getElementById('confirmYes'); if(yes) yes.focus();
  });
}
// What a row's button is about to act on, read from the row itself (its first cell or first line),
// so a confirmation can name it.
function itemNameFrom(btn){
  if(!btn || !btn.closest) return '';
  const tr = btn.closest('tr');
  const src = tr ? tr.cells[0] : (btn.closest('.test-row') || btn.closest('.order-card'));
  if(!src) return '';
  const first = src.querySelector('.order-id, b, span') || src;
  return (((tr ? src.innerText : first.innerText) || '').split('\n')[0] || '').trim().slice(0, 80);
}
function answerConfirm(value){
  document.getElementById('confirmRoot').innerHTML = '';
  const r = confirmResolve; confirmResolve = null;
  if(r) r(value);
}
// Code 128 (code set B) — a real barcode a scanner or an analyser can read. Each entry is one
// symbol as bars (1) and spaces (0); 104 is Start B, 106 is Stop. The check symbol is the weighted
// sum of the values modulo 103.
const CODE128 = '11011001100,11001101100,11001100110,10010011000,10010001100,10001001100,10011001000,10011000100,10001100100,11001001000,11001000100,11000100100,10110011100,10011011100,10011001110,10111001100,10011101100,10011100110,11001110010,11001011100,11001001110,11011100100,11001110100,11101101110,11101001100,11100101100,11100100110,11101100100,11100110100,11100110010,11011011000,11011000110,11000110110,10100011000,10001011000,10001000110,10110001000,10001101000,10001100010,11010001000,11000101000,11000100010,10110111000,10110001110,10001101110,10111011000,10111000110,10001110110,11101110110,11010001110,11000101110,11011101000,11011100010,11011101110,11101011000,11101000110,11100010110,11101101000,11101100010,11100011010,11101111010,11001000010,11110001010,10100110000,10100001100,10010110000,10010000110,10000101100,10000100110,10110010000,10110000100,10011010000,10011000010,10000110100,10000110010,11000010010,11001010000,11110111010,11000010100,10001111010,10100111100,10010111100,10010011110,10111100100,10011110100,10011110010,11110100100,11110010100,11110010010,11011011110,11011110110,11110110110,10101111000,10100011110,10001011110,10111101000,10111100010,11110101000,11110100010,10111011110,10111101110,11101011110,11110101110,11010000100,11010010000,11010011100,1100011101011'.split(',');
function code128Modules(text){
  const values = [104];
  for(const ch of String(text||'')){
    const v = ch.charCodeAt(0) - 32;
    if(v<0 || v>94) return null; // not encodable in set B
    values.push(v);
  }
  const check = values.reduce((sum,v,i)=> sum + v*(i===0?1:i), 0) % 103;
  return [...values, check, 106].map(v=>CODE128[v]).join('');
}
function barcodeSvg(code, h){
  h = h||46;
  const modules = code128Modules(code);
  if(!modules || !code) return `<div class="muted" style="font-size:11px;">No barcode — this number cannot be encoded.</div>`;
  const quiet = 10; // blank margin each side, in modules — scanners need it
  let bars = '', x = quiet;
  for(let i=0;i<modules.length;){
    let run = 1;
    while(i+run<modules.length && modules[i+run]===modules[i]) run++;
    if(modules[i]==='1') bars += `<rect x="${x}" y="0" width="${run}" height="${h}"/>`;
    x += run; i += run;
  }
  return `<svg viewBox="0 0 ${x+quiet} ${h}" width="100%" height="${h}" preserveAspectRatio="none" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" style="display:block;background:#fff;" role="img" aria-label="Barcode ${escapeHtml(code)}"><g fill="#000">${bars}</g></svg>`;
}
async function withErrorToast(fn){
  try{ await fn(); }
  catch(e){ showToast(e.message || 'Something went wrong. Nothing was saved — try again.', 'error'); }
}

