/* ============================= REPORTS ============================= */
// The report desk: a work-list (left), the report itself (middle) and what can be done with it
// (right) — handing it over at reception, or the hand-over history and the patient folder for a
// clinician. Only a final report can be handed out; a preliminary one is shown to clinicians and
// lab staff only (the server enforces both).
let reportSearch = '';
let reportCollectedDateFilter = '';
let reportCategoryFilter = '';
let reportStatusFilter = '';
let deskTab = null;        // which list is open
let deskSelected = null;   // the order whose report is shown
let deskFilter = '';       // narrows the open list, typed on this screen
let deskQuery = '';        // a search sent to the server, from the scan field
const REPORT_STATE = {
  final:{label:'Final', cls:'pill-teal'},
  preliminary:{label:'Preliminary', cls:'pill-amber'},
  in_lab:{label:'In the lab', cls:'pill-grey'},
};

function deskTabs(){
  const tabs = hasCapability('dispatch_reports')
    ? [{id:'todo', label:'To hand out'}, {id:'done', label:'Handed out today'}, {id:'lab', label:'In the lab'}]
    : [{id:'finished', label:'Finished'}, {id:'lab', label:'In the lab'}];
  if(hasCapability('view_patient_records')) tabs.push({id:'all', label:'All memos'});
  return tabs;
}
function goToReports(tab){ state.activeView = 'reports'; deskTab = tab; deskQuery = ''; deskSelected = null; saveSession(); render(); closeSidebar(); }
const isToday = iso => !!iso && new Date(iso).toDateString()===new Date().toDateString();
const lastOf = list => list[list.length-1];
function deskLists(items){
  const byNewest = key => (a,b)=> new Date(key(b)||0) - new Date(key(a)||0);
  const handOvers = i => i.handovers.filter(h=>h.kind==='handover');
  return {
    todo: items.filter(i=>i.due).sort(byNewest(i=>i.lastCertifiedAt)),
    done: items.filter(i=>handOvers(i).some(h=>isToday(h.handedAt))).sort(byNewest(i=>lastOf(handOvers(i)).handedAt)),
    // Someone who hands reports out waits for the final one; a clinician reads a preliminary one.
    lab: items.filter(i=> hasCapability('dispatch_reports') ? i.state!=='final' : i.state==='in_lab'),
    finished: items.filter(i=>i.state!=='in_lab').sort(byNewest(i=>i.lastCertifiedAt)),
  };
}

async function viewReportsPage(){
  const tabs = deskTabs();
  if(!tabs.some(t=>t.id===deskTab)) deskTab = tabs[0].id;
  const head = `<div class="pagehead"><h1>Reports</h1><p>Laboratory reports for patients of ${escapeHtml(fac(session.user.facilityId).name)}.</p></div>`;
  if(deskTab==='all' && !deskQuery){
    return head + deskTabsHtml(tabs, null) + await viewReportsInner();
  }
  const desk = await api.reportDesk(deskQuery);
  const lists = deskLists(desk.items);
  let shown = deskQuery ? desk.items : lists[deskTab];
  const q = deskFilter.trim().toLowerCase();
  if(q) shown = shown.filter(i=>[i.patient.name, i.patient.hospitalNumber, i.patient.idNumber, i.memoNumber, ...i.specimens].some(v=>(v||'').toLowerCase().includes(q)));
  if(!desk.items.some(i=>i.orderId===deskSelected)) deskSelected = null;
  if(!deskSelected && shown.length && window.innerWidth>860) deskSelected = shown[0].orderId;
  const sel = desk.items.find(i=>i.orderId===deskSelected) || null;
  let report = null, reportError = '';
  if(sel && sel.state!=='in_lab'){
    try{ report = await api.report(sel.orderId); }catch(e){ reportError = e.message; }
  }
  return `${head}
    ${deskQuery
      ? `<div class="card desk-query"><span>Showing memos matching <b>${escapeHtml(deskQuery)}</b>, from any date.</span><button class="btn btn-sm btn-outline" onclick="deskQuery='';deskSelected=null;render();">Back to the lists</button></div>`
      : deskTabsHtml(tabs, lists)}
    <div class="desk">
      <section class="desk-list card" aria-label="Reports">
        <input id="deskFilter" value="${escapeHtml(deskFilter)}" placeholder="Find in this list: name, hospital no., memo" oninput="deskFilter=this.value;renderCached();">
        <div class="desk-items">${shown.map(i=>deskItemHtml(i)).join('') || `<div class="empty">${deskEmptyText(q)}</div>`}</div>
        ${deskQuery?'':`<p class="muted" style="font-size:11.5px;margin:8px 2px 0;">Memos collected in the last ${desk.days} days. Use the scan field at the top for anything older.</p>`}
      </section>
      <section class="desk-report card" aria-label="Report">${sel ? deskReportHtml(sel, report, reportError) : `<div class="empty">Choose a report from the list.</div>`}</section>
      <section class="desk-side card" aria-label="Hand-over">${sel ? deskSideHtml(sel) : ''}</section>
    </div>`;
}
function deskTabsHtml(tabs, lists){
  return `<div class="tabs">${tabs.map(t=>`<div class="tab ${deskTab===t.id?'active':''}" onclick="deskTab='${t.id}';deskSelected=null;deskFilter='';render();">${escapeHtml(t.label)}${lists && lists[t.id]?` <span class="tab-count">${lists[t.id].length}</span>`:''}</div>`).join('')}</div>`;
}
function deskEmptyText(filtered){
  if(filtered) return 'Nothing in this list matches.';
  if(deskQuery) return 'No memo from this facility matches. Check the number, or search by hospital number.';
  return {todo:'Nothing to hand out.', done:'Nothing handed out yet today.', lab:'Nothing in the lab.', finished:'No finished reports.'}[deskTab] || 'Nothing here.';
}
function deskItemHtml(i){
  const when = i.lastCertifiedAt || i.collectedAt;
  const tags = [
    deskTab!=='lab' || deskQuery ? `<span class="pill ${REPORT_STATE[i.state].cls}">${REPORT_STATE[i.state].label}</span>` : '',
    i.abnormal ? `<span class="pill pill-crimson">Abnormal</span>` : '',
    i.amended ? `<span class="pill pill-purple">Amended</span>` : '',
    i.changedSinceHandover ? `<span class="pill pill-amber">Changed since handed out</span>` : '',
  ].join(' ');
  return `<div class="desk-item ${i.orderId===deskSelected?'active':''}" onclick="selectDeskItem('${i.orderId}')">
    <div class="desk-item-top"><b>${escapeHtml(i.patient.name)}</b><span class="muted" style="font-size:12px;white-space:nowrap;">${isToday(when)?fmtTime(when):fmtDate(when)}</span></div>
    <div class="muted" style="font-size:12px;">${escapeHtml(i.patient.hospitalNumber||'—')} · <span class="mono">${escapeHtml(i.memoNumber)}</span></div>
    <div style="font-size:12.5px;margin-top:2px;">${escapeHtml(i.tests.map(t=>t.name).join(', '))}</div>
    ${tags.trim()?`<div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap;">${tags}</div>`:''}
  </div>`;
}
function fmtTime(iso){ return new Date(iso).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false}); }
function selectDeskItem(orderId){
  deskSelected = orderId;
  render().then(()=>{ if(window.innerWidth<=860){ const el=document.querySelector('.desk-report'); if(el) el.scrollIntoView({block:'start'}); } });
}

function deskReportHtml(i, report, error){
  const folderBtn = hasCapability('view_patient_records') ? `<button class="btn btn-sm btn-outline" onclick="openPatientFolder('${i.patient.id}')">Patient folder →</button>` : '';
  const bar = patientBar(i.patient, {patientType:i.patientType, wardName:i.wardName, right:folderBtn});
  const meta = `<div class="desk-meta"><span>Memo <span class="mono">${escapeHtml(i.memoNumber)}</span> · Collected ${fmtDate(i.collectedAt)}${i.lastCertifiedAt?` · Last result ${fmtDate(i.lastCertifiedAt)}`:''}</span><span class="pill ${REPORT_STATE[i.state].cls}">${i.state==='in_lab'?'In the lab':`${REPORT_STATE[i.state].label} report`}</span></div>`;
  if(i.state==='in_lab'){
    return `${bar}${meta}
      <div class="desk-note">Results show here when the lab has finished${hasCapability('view_patient_records')?'':' every test on the memo'}.</div>
      ${i.tests.map(t=>`<div class="test-row"><span>${escapeHtml(t.name)}</span><span class="pill ${(STATUS_META[t.status]||{cls:'pill-grey'}).cls}">${escapeHtml((STATUS_META[t.status]||{label:t.status}).label)}</span></div>`).join('')}`;
  }
  if(!report) return `${bar}${meta}<p style="color:var(--crimson);">${escapeHtml(error||'This report could not be loaded.')}</p>`;
  const banners = [
    report.state==='preliminary' ? `<div class="desk-banner amber"><b>Preliminary, for doctors only.</b> Some tests on this memo are still in the lab. Reception hands out the final report when it is ready.</div>` : '',
    report.sheets.some(s=>s.amended) ? `<div class="desk-banner purple"><b>Amended report.</b> A result was changed after it was first reported; the first value and the reason are on the printed report.</div>` : '',
  ].join('');
  const sheets = report.sheets.map(sheet=>`
    ${report.sheets.length>1?`<h3 class="desk-sheet">${escapeHtml(sheet.facility.name)}${sheet.isOrderingFacility?'':' <span class="pill pill-purple">Referred</span>'}</h3>`:''}
    <div style="overflow-x:auto;"><table class="desk-table"><thead><tr><th>Test</th><th class="num">Result</th><th>Flag</th><th>Reference range</th></tr></thead>
    <tbody>${sheet.lines.map(deskLineHtml).join('')}</tbody></table></div>`).join('');
  const pdfBtn = hasCapability('view_patient_records') ? `<div class="actions-row"><button class="btn btn-sm btn-outline" onclick="openReportPdf('${i.orderId}')">View PDF</button></div>` : '';
  return `${bar}${meta}${banners}${sheets}${pdfBtn}`;
}
function deskLineHtml(l){
  const name = `${escapeHtml(l.name)}${l.isStat?' <span class="pill pill-crimson" style="font-size:10px;">STAT</span>':''}`;
  if(l.status) return `<tr><td>${name}</td><td colspan="3" class="muted"><i>${escapeHtml(l.underAmendment?'Being amended — awaiting validation':(STATUS_META[l.status]||{label:l.status}).label)}</i></td></tr>`;
  if(l.isCulture) return `<tr><td>${name}</td><td colspan="3">Culture result — shown in full on the PDF${l.cultureResult&&l.cultureResult.growthStatus?` (${escapeHtml(l.cultureResult.growthStatus.replace('_',' '))})`:''}</td></tr>`;
  if(l.withdrawn) return `<tr><td>${name}</td><td colspan="3"><b>Result withdrawn</b>${amendmentNotes(l)}</td></tr>`;
  const flagged = l.flag && l.flag!=='Normal' && l.flag!=='N/A';
  return `<tr><td>${name}${(l.amendments||[]).length?` <span class="pill pill-purple" style="font-size:10px;">Amended</span>${amendmentNotes(l)}`:''}</td>
    <td class="num mono" style="${flagged?'font-weight:700;color:var(--crimson);':''}">${escapeHtml(l.value)} <span class="muted" style="font-weight:400;">${escapeHtml(l.unit||'')}</span></td>
    <td>${flagged?`<span class="flag-${escapeHtml(l.flag)}">${escapeHtml(l.flagLabel)}</span>`:''}</td>
    <td class="muted">${escapeHtml(l.rangeText||'')}</td></tr>`;
}

function handoverLine(h){
  return h.kind==='reprint'
    ? `Printed again ${fmtDate(h.handedAt)} by ${escapeHtml(h.handedBy)}`
    : `Handed to <b>${escapeHtml(h.receiverName)}</b> (${escapeHtml(h.receiverPhone)}) ${fmtDate(h.handedAt)} by ${escapeHtml(h.handedBy)}`;
}
function deskSideHtml(i){
  const history = i.handovers.length
    ? `<ol class="desk-history">${i.handovers.slice().reverse().map(h=>`<li>${handoverLine(h)}</li>`).join('')}</ol>`
    : `<p class="muted" style="font-size:12.5px;">Not handed out yet.</p>`;
  if(!hasCapability('dispatch_reports')){
    return `<h2>Hand-overs</h2>${history}`;
  }
  if(i.state!=='final'){
    return `<h2>Hand over</h2><div class="desk-note">Not ready. The report can be handed out when every test on the memo is final.</div><h2 style="margin-top:16px;">History</h2>${history}`;
  }
  const last = lastOf(i.handovers.filter(h=>h.kind==='handover'));
  const form = `
    <div class="field"><label for="hoName">Name of the person receiving it</label><input id="hoName" autocomplete="off" placeholder="The patient, or who collects for them"></div>
    <div class="field"><label for="hoPhone">Their contact number</label><input id="hoPhone" inputmode="tel" autocomplete="off" placeholder="At least 7 digits"></div>
    <p id="hoError" class="form-error" role="alert"></p>
    <button class="btn btn-teal" style="width:100%;" onclick="printAndHandOver('${i.orderId}')">Print and record hand-over</button>`;
  const action = i.due
    ? `${i.changedSinceHandover?`<div class="desk-banner amber">This report changed after it was handed out on ${fmtDate(last.handedAt)}. Hand over the new copy.</div>`:''}${form}`
    : `<div class="desk-done">Handed to <b>${escapeHtml(last.receiverName)}</b> (${escapeHtml(last.receiverPhone)}) ${fmtDate(last.handedAt)} by ${escapeHtml(last.handedBy)}.</div>
       <div class="actions-row"><button class="btn btn-sm btn-outline" onclick="reprintReport('${i.orderId}')">Print again</button></div>
       <details style="margin-top:12px;"><summary style="cursor:pointer;font-size:13px;">Give a copy to someone else</summary><div style="margin-top:10px;">${form}</div></details>`;
  return `<h2>Hand over</h2>${action}
    <h2 style="margin-top:18px;">Patient name in Dhivehi</h2>
    <p class="muted" style="font-size:12px;margin-top:-6px;">Printed under the English name. Leave empty to print English only.</p>
    <div style="display:flex;gap:6px;"><input id="hoDhivehi" dir="rtl" lang="dv" class="thaana" value="${escapeHtml(i.patient.nameDhivehi||'')}" aria-label="Patient name in Dhivehi"><button class="btn btn-sm btn-outline" onclick="savePatientDhivehi('${i.patient.id}')">Save</button></div>
    <h2 style="margin-top:18px;">History</h2>${history}`;
}
async function printAndHandOver(orderId){
  const name = (document.getElementById('hoName').value||'').trim();
  const phone = (document.getElementById('hoPhone').value||'').trim();
  const err = document.getElementById('hoError');
  // Same rule as the server: digits, optionally a leading +, spaces and dashes ignored.
  const problem = !name ? 'Enter the name of the person receiving the report.'
    : !/^\+?\d{7,15}$/.test(phone.replace(/[\s()-]/g,'')) ? 'Enter a contact number of at least 7 digits.' : '';
  if(problem){ err.textContent = problem; return; }
  err.textContent = '';
  const ok = await openReportPdf(orderId, ()=>api.recordHandover(orderId, name, phone));
  if(ok){ showToast(`Handed to ${name}.`); await render(); }
}
async function reprintReport(orderId){
  const ok = await openReportPdf(orderId, ()=>api.recordReprint(orderId));
  if(ok){ showToast('Printed again — recorded.'); await render(); }
}
async function savePatientDhivehi(patientId){
  const value = (document.getElementById('hoDhivehi').value||'').trim();
  await withErrorToast(async ()=>{
    await api.setPatientDhivehiName(patientId, value);
    showToast(value ? 'Dhivehi name saved.' : 'Dhivehi name removed.');
    await render();
  });
}
async function viewReportsInner(){
  const q = reportSearch.trim().toLowerCase();
  let orders = await api.orders('report_list');
  if(q) orders = orders.filter(o=>{
    const p = o.patient;
    const specMatch = (o.specimens||[]).some(s=>s.specimenNumber.toLowerCase().includes(q));
    return specMatch || (o.memoNumber||'').toLowerCase().includes(q) || (p?.hospitalNumber||'').toLowerCase().includes(q) || (p?.idNumber||'').toLowerCase().includes(q) || (p?.name||'').toLowerCase().includes(q);
  });
  if(reportCollectedDateFilter) orders = orders.filter(o=>o.collectedAt && o.collectedAt.slice(0,10)===reportCollectedDateFilter);
  if(reportCategoryFilter) orders = orders.filter(o=>o.tests.some(t=>(test(t.code)?.category)===reportCategoryFilter));
  if(reportStatusFilter) orders = orders.filter(o=>{
    const doneCount = o.tests.filter(t=>t.status==='completed').length;
    const collectedCount = o.tests.filter(t=>t.status!=='deselected').length;
    if(reportStatusFilter==='not_completed') return doneCount===0;
    if(reportStatusFilter==='partial') return doneCount>0 && doneCount<collectedCount;
    if(reportStatusFilter==='fully_completed') return collectedCount>0 && doneCount===collectedCount;
    return true;
  });
  const list = orders.map(o=>{
    const p = o.patient;
    const doneCount = o.tests.filter(t=>t.status==='completed').length;
    const collectedCount = o.tests.filter(t=>t.status!=='deselected').length;
    const anyDone = doneCount>0;
    return `<tr>
      <td class="mono">${escapeHtml(o.memoNumber||o.id)}${o.viewerIsOrigin?'':`<div class="muted" style="font-family:inherit;font-size:11px;">Referred from ${escapeHtml(fac(o.orderingFacilityId).name)}</div>`}</td><td>${escapeHtml(p?.name||'?')} <span class="muted">(${escapeHtml(p?.hospitalNumber||'—')})</span></td><td>${fmtDate(o.collectedAt||o.createdAt)}</td>
      <td>${doneCount}/${collectedCount} completed${o.tests.some(t=>t.amended)?` <span class="pill pill-amber">Amended</span>`:''}</td>
      <td>${anyDone? `<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();openReportPdf('${o.id}')">View Report</button>` : `<span class="muted" style="font-size:12px;">Not yet completed</span>`}</td>
    </tr>`;
  }).join('');
  return `
    <div class="card">
      <div class="grid grid-4">
        <div class="field" style="margin-bottom:0;"><label>Search</label>
          <input id="repSearch" value="${escapeHtml(reportSearch)}" placeholder="Patient, Hospital No., ID No., Memo No., or Specimen No."
            oninput="reportSearch=this.value;renderCached();const el=document.getElementById('repSearch');if(el)el.focus();"></div>
        <div class="field" style="margin-bottom:0;"><label>Category</label>
          <select onchange="reportCategoryFilter=this.value;renderCached();">
            <option value="">All categories</option>
            ${categoriesCache.map(c=>`<option value="${escapeHtml(c.name)}" ${reportCategoryFilter===c.name?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
          </select></div>
        <div class="field" style="margin-bottom:0;"><label>Status</label>
          <select onchange="reportStatusFilter=this.value;renderCached();">
            <option value="">All statuses</option>
            <option value="not_completed" ${reportStatusFilter==='not_completed'?'selected':''}>Not Yet Completed</option>
            <option value="partial" ${reportStatusFilter==='partial'?'selected':''}>Partially Completed</option>
            <option value="fully_completed" ${reportStatusFilter==='fully_completed'?'selected':''}>Fully Completed</option>
          </select></div>
        <div class="field" style="margin-bottom:0;"><label>Collected Date</label>
          <input type="date" value="${reportCollectedDateFilter}" onchange="reportCollectedDateFilter=this.value;renderCached();"></div>
      </div>
      <p class="muted" style="font-size:11px;margin-top:8px;">Collected Date is useful when a walk-in patient knows the date but not their memo number.</p>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>Memo No.</th><th>Patient</th><th>Collected</th><th>Status</th><th></th></tr></thead>
      <tbody>${list || `<tr><td colspan="5" class="empty">${q||reportCollectedDateFilter||reportCategoryFilter||reportStatusFilter?'No matching samples.':'No samples found.'}</td></tr>`}</tbody></table>
    </div>
  `;
}
// Opens the report as a PDF in a new browser tab. The PDF is built by the server (one page per
// performing lab); it is fetched here rather than linked so the login token goes in a header.
// `before` (a hand-over or reprint) is recorded first; if that fails, no report is opened.
// Resolves true when the report opened.
async function openReportPdf(orderId, before){
  // The tab has to be opened in the click itself, or the browser treats it as a pop-up.
  const tab = window.open('', '_blank');
  if(!tab){ showToast('The browser blocked the report tab — allow pop-ups for this site.', 'error'); return false; }
  tab.document.title = 'Laboratory Report';
  tab.document.body.innerHTML = '<p style="font-family:sans-serif;color:#555;padding:24px;">Preparing report…</p>';
  try{
    if(before) await before();
    const res = await fetch(`${API_BASE}/reports/${encodeURIComponent(orderId)}/pdf`, { headers:{ 'Authorization':'Bearer ' + session.token } });
    if(!res.ok){
      let msg = `Could not open the report (HTTP ${res.status})`;
      try{ msg = (await res.json()).error || msg; }catch(e){ /* not JSON */ }
      throw new Error(msg);
    }
    tab.location.replace(URL.createObjectURL(await res.blob()));
    return true;
  }catch(e){
    tab.close();
    showToast(e.message, 'error');
    return false;
  }
}
