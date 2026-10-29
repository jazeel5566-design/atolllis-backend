/* ============================= PATIENTS AND THE PATIENT FOLDER ============================= */
// For clinicians and lab staff (view_patient_records): find a patient with lab work at this
// facility and open their folder — results over time, every report with its hand-overs. Until the
// hospital modules exist there are no visits to limit this by, so the server writes each folder
// opened to the audit log.
let patientsQuery = '';
let folderPatientId = null;
let folderTab = 'trend';
let folderReturnTo = null; // the screen the folder was opened from, for the Back button
const FOLDER_COLUMNS = 8;  // most recent memos shown side by side in Results over time
let folderOrders = [];     // the open folder's memos, for opening one on the report desk

function openPatientFolder(patientId){
  folderReturnTo = state.activeView==='patients' ? null : state.activeView;
  folderPatientId = patientId; folderTab = 'trend';
  state.activeView = 'patients'; saveSession();
  render();
}
function closePatientFolder(){
  folderPatientId = null;
  if(folderReturnTo){ state.activeView = folderReturnTo; folderReturnTo = null; saveSession(); }
  render();
}

async function viewPatientsPage(){
  if(folderPatientId) return viewPatientFolder();
  return `
    <div class="pagehead"><h1>Patients</h1><p>Patients with lab work at ${escapeHtml(fac(session.user.facilityId).name)}. Opening a folder is recorded in the audit log.</p></div>
    <div class="card">
      <div class="field" style="max-width:460px;margin-bottom:0;">
        <label for="patientsSearch">Name, hospital number or ID number</label>
        <input id="patientsSearch" value="${escapeHtml(patientsQuery)}" autocomplete="off" placeholder="Type at least 2 characters"
          oninput="patientsQuery=this.value;clearTimeout(patientsTimer);patientsTimer=setTimeout(searchPatients,350);"
          onkeydown="if(event.key==='Enter'){event.preventDefault();clearTimeout(patientsTimer);searchPatients();}">
      </div>
    </div>
    <div id="patientsResults"></div>`;
}
let patientsTimer = null, patientsSeq = 0;
async function searchPatients(){
  const root = document.getElementById('patientsResults');
  if(!root) return;
  const q = patientsQuery.trim();
  const seq = ++patientsSeq;
  if(q.length<2){ root.innerHTML = ''; return; }
  root.innerHTML = `<p class="muted">Searching…</p>`;
  let rows;
  try{ rows = await api.patientRecords(q); }
  catch(e){ if(seq===patientsSeq) root.innerHTML = `<p style="color:var(--crimson);">${escapeHtml(e.message)}</p>`; return; }
  if(seq!==patientsSeq) return; // a newer search has been typed since
  root.innerHTML = rows.length ? `<div class="card" style="padding:0;overflow-x:auto;"><table>
      <thead><tr><th>Patient</th><th>Hospital No.</th><th>Age / sex</th><th>Memos</th><th>Last collected</th><th></th></tr></thead>
      <tbody>${rows.map(r=>`<tr style="cursor:pointer;" onclick="openPatientFolder('${r.patient.id}')">
        <td><b>${escapeHtml(r.patient.name)}</b></td><td class="mono">${escapeHtml(r.patient.hospitalNumber||'—')}</td>
        <td>${fmtAge(r.patient.dob)} · ${escapeHtml(SEX_LABELS[r.patient.sex]||r.patient.sex||'—')}</td>
        <td>${r.visits}</td><td>${fmtDate(r.lastCollectedAt)}</td>
        <td><button class="btn btn-sm btn-outline" onclick="event.stopPropagation();openPatientFolder('${r.patient.id}')">Open folder</button></td></tr>`).join('')}</tbody>
    </table></div>`
    : `<p class="muted">No patient with lab work here matches “${escapeHtml(q)}”.</p>`;
}

async function viewPatientFolder(){
  const {patient, orders} = await api.patientFolder(folderPatientId);
  folderOrders = orders;
  const tabs = [['trend','Results over time'],['reports','Reports'],['visits','Visits']];
  const body = folderTab==='reports' ? folderReportsHtml(orders) : folderTab==='visits' ? folderVisitsHtml() : folderTrendHtml(patient, orders);
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
      <div><h1>Patient folder</h1><p>Every lab memo of this patient that ${escapeHtml(fac(session.user.facilityId).name)} can see.</p></div>
      <button class="btn btn-outline btn-sm" onclick="closePatientFolder()">← Back</button>
    </div>
    ${patientBar(patient, {right: patient.nameDhivehi?`<span class="thaana" dir="rtl" lang="dv" style="font-size:16px;">${escapeHtml(patient.nameDhivehi)}</span>`:''})}
    <div class="tabs" style="margin-top:14px;">${tabs.map(([id,label])=>`<div class="tab ${folderTab===id?'active':''}" onclick="folderTab='${id}';renderCached();">${label}</div>`).join('')}</div>
    ${body}`;
}

// One row per test, one column per memo (oldest on the left), so a change over time reads across.
function folderTrendHtml(patient, orders){
  const cols = orders.slice(0, FOLDER_COLUMNS).reverse();
  const rows = new Map();
  cols.forEach((o, ci)=>o.tests.forEach(t=>{
    if(!rows.has(t.code)) rows.set(t.code, {name:t.name, category:t.category||'Other', cells:[], unit:'', range:''});
    const row = rows.get(t.code);
    row.cells[ci] = t;
    if(t.value!=null){ row.unit = t.unit||row.unit; row.range = t.rangeText||row.range; }
  }));
  if(!rows.size) return `<div class="card empty">No results yet.</div>`;
  const byCategory = [...rows.values()].sort((a,b)=>a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  let lastCat = null;
  const body = byCategory.map(r=>{
    const catRow = r.category!==lastCat ? `<tr class="trend-cat"><td colspan="${cols.length+2}">${escapeHtml(r.category)}</td></tr>` : '';
    lastCat = r.category;
    const cells = cols.map((o, ci)=>{
      const t = r.cells[ci];
      if(!t) return `<td></td>`;
      if(t.value==null) return `<td class="num muted" style="font-size:11.5px;">${t.status==='completed'?'—':'in lab'}</td>`;
      const flagged = t.flag && t.flag!=='Normal' && t.flag!=='N/A';
      const arrow = /High/.test(t.flag||'') ? ' ▲' : /Low/.test(t.flag||'') ? ' ▼' : '';
      return `<td class="num mono" style="${flagged?'color:var(--crimson);font-weight:700;':''}" title="${escapeHtml(t.flagLabel||'')}">${escapeHtml(t.withdrawn?'withdrawn':t.value)}${arrow}${(t.amendments||[]).length?' *':''}</td>`;
    }).join('');
    return `${catRow}<tr><td><b>${escapeHtml(r.name)}</b><div class="muted" style="font-size:11.5px;">${escapeHtml(r.unit)}${r.range?` · ${escapeHtml(r.range)}`:''}</div></td>${cells}</tr>`;
  }).join('');
  return `<div class="card" style="padding:0;overflow-x:auto;"><table class="trend">
    <thead><tr><th>Test</th>${cols.map(o=>`<th class="num">${fmtDob(o.collectedAt||o.createdAt)}<div style="font-weight:400;text-transform:none;">${o.state==='preliminary'?'<span class="pill pill-amber" style="font-size:10px;">Preliminary</span>':''}</div></th>`).join('')}</tr></thead>
    <tbody>${body}</tbody></table></div>
    <p class="muted" style="font-size:11.5px;">${orders.length>FOLDER_COLUMNS?`The ${FOLDER_COLUMNS} most recent memos of ${orders.length}; older ones are under Reports. `:''}▲ high, ▼ low; * the result was amended after it was first reported.</p>`;
}

function folderReportsHtml(orders){
  return orders.map(o=>`<div class="order-card">
    <div class="order-card-head">
      <div><span class="order-id">${escapeHtml(o.memoNumber)}</span> <span class="muted">— collected ${fmtDate(o.collectedAt||o.createdAt)}${o.own?'':' · referred in'}</span></div>
      <div style="display:flex;gap:6px;align-items:center;"><span class="pill ${REPORT_STATE[o.state].cls}">${REPORT_STATE[o.state].label}</span>
        ${o.state!=='in_lab'?`<button class="btn btn-sm btn-outline" onclick="${o.own?`openDeskOrder('${o.orderId}')`:`openReportPdf('${o.orderId}')`}">Open report</button>`:''}</div>
    </div>
    <div style="font-size:13px;">${escapeHtml(o.tests.map(t=>t.name).join(', '))}</div>
    ${o.own?`<div class="muted" style="font-size:12px;margin-top:6px;">${(o.handovers||[]).length?(o.handovers||[]).map(h=>handoverLine(h)).join('<br>'):'Not handed out yet.'}</div>`:''}
  </div>`).join('') || `<div class="card empty">No reports.</div>`;
}
// A report of this facility's own memo opens on the report desk.
function openDeskOrder(orderId){
  const order = folderOrders.find(o=>o.orderId===orderId);
  if(!order) return;
  folderPatientId = null; folderReturnTo = null;
  deskQuery = order.memoNumber; deskSelected = orderId; deskFilter = '';
  state.activeView = 'reports'; saveSession();
  render();
}
function folderVisitsHtml(){
  return `<div class="card empty"><h2>No visits yet</h2><p>Visits appear here once registration and consultations are part of AtollLIS. Until then this folder shows every lab memo of the patient at your facility.</p></div>`;
}
