/* ============================= REPORTS ============================= */
let reportSearch = '';
let reportCollectedDateFilter = '';
let reportCategoryFilter = '';
let reportStatusFilter = '';
let reportsTab = 'samples';

async function viewReportsPage(){
  const f = fac(session.user.facilityId);
  return `
    <div class="pagehead"><h1>Reports</h1><p>Standard laboratory reports and patient history for ${escapeHtml(f.name)}.</p></div>
    <div class="tabs">
      <div class="tab ${reportsTab==='samples'?'active':''}" onclick="reportsTab='samples';render();">Sample Reports</div>
      <div class="tab ${reportsTab==='history'?'active':''}" onclick="reportsTab='history';render();">Patient History</div>
    </div>
    ${reportsTab==='samples'? await viewReportsInner() : viewHistoryInner()}
  `;
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
async function openReportPdf(orderId){
  // The tab has to be opened in the click itself, or the browser treats it as a pop-up.
  const tab = window.open('', '_blank');
  if(!tab){ showToast('The browser blocked the report tab — allow pop-ups for this site.'); return; }
  tab.document.title = 'Laboratory Report';
  tab.document.body.innerHTML = '<p style="font-family:sans-serif;color:#555;padding:24px;">Preparing report…</p>';
  try{
    const res = await fetch(`${API_BASE}/reports/${encodeURIComponent(orderId)}/pdf`, { headers:{ 'Authorization':'Bearer ' + session.token } });
    if(!res.ok){
      let msg = `Could not open the report (HTTP ${res.status})`;
      try{ msg = (await res.json()).error || msg; }catch(e){ /* not JSON */ }
      throw new Error(msg);
    }
    tab.location.replace(URL.createObjectURL(await res.blob()));
  }catch(e){
    tab.close();
    showToast(e.message);
  }
}

/* ============================= PATIENT HISTORY ============================= */
let histSearchQuery = '';
function viewHistoryInner(){
  return `
    <div class="card">
      <p class="muted" style="font-size:12.5px;margin-top:0;">Scoped to this facility: its own orders in full, plus only the specific tests that were referred to or from it.</p>
      <div class="field" style="max-width:420px;">
        <label>Search patient by Name, Hospital No., or ID No.</label>
        <input id="histSearch" value="${escapeHtml(histSearchQuery)}" placeholder="Type a name, hospital no., or ID…"
          oninput="histSearchQuery=this.value;clearTimeout(histTimer);histTimer=setTimeout(searchHistory,350);"
          onkeydown="if(event.key==='Enter'){event.preventDefault();clearTimeout(histTimer);searchHistory();}">
      </div>
      <div id="histResults"></div>
    </div>
  `;
}
let histTimer = null, histSeq = 0;
async function searchHistory(){
  const q = histSearchQuery.trim();
  const root = document.getElementById('histResults');
  if(!root) return;
  const seq = ++histSeq;
  if(q.length<2){ root.innerHTML = q ? `<p class="muted">Type at least 2 characters.</p>` : ''; return; }
  root.innerHTML = `<p class="muted">Searching…</p>`;
  let results;
  try{ results = await api.history(q); }
  catch(e){ if(seq===histSeq) root.innerHTML = `<p style="color:var(--crimson);">${escapeHtml(e.message)}</p>`; return; }
  if(seq!==histSeq) return; // a newer search has been typed since
  if(!results.length){ root.innerHTML = `<p class="muted">No patient matches “${escapeHtml(q)}” at this facility. Check the spelling, or search by Hospital No.</p>`; return; }
  root.innerHTML = results.map(({patient:p, orders})=>{
    const entries = orders.map(o=>{
      const rows = o.tests.map(t=>{
        if(t.status){
          return `<div class="test-row"><span>${escapeHtml(t.name)}${t.isStat?` <span class="pill pill-crimson" style="font-size:10px;">STAT</span>`:''}</span><span class="pill ${(STATUS_META[t.status]||{cls:'pill-grey'}).cls}">${(STATUS_META[t.status]||{label:t.status}).label}</span></div>`;
        }
        return `<div class="test-row"><span>${escapeHtml(t.name)}${t.isStat?` <span class="pill pill-crimson" style="font-size:10px;">STAT</span>`:''} <span class="mono muted">(${escapeHtml(t.code)})</span> ${t.specimenNumber?`<span class="mono muted" style="font-size:11px;">${escapeHtml(t.specimenNumber)}</span>`:''}${(t.amendments||[]).length?` <span class="pill pill-amber" style="font-size:10px;">${t.withdrawn?'Withdrawn':'Amended'}</span>`:''}</span>
          <span class="mono flag-${(t.flag||'').replace(' ','')}">${escapeHtml(t.value)} ${escapeHtml(t.unit||'')} ${t.flag && t.flag!=='Normal' && t.flag!=='N/A'?`— ${escapeHtml(t.flagLabel)}`:''}</span></div>
          <div class="muted" style="font-size:12px;margin:-4px 0 6px;">${t.withdrawn?'Withdrawn by':`Ref: ${escapeHtml(t.rangeText||'')} · ${(t.amendments||[]).length?'Amended result certified by':'Certified by'}`} ${escapeHtml(t.validatedBy||'')}, ${fmtDate(t.validatedAt)}</div>${(t.amendments||[]).length?`<div style="margin:-2px 0 8px;">${amendmentNotes(t)}</div>`:''}`;
      }).join('');
      const visitType = o.patientType==='inpatient'? `In-Patient${o.wardName?' · '+escapeHtml(o.wardName):''}` : o.patientType==='outpatient'? 'Out-Patient' : null;
      return `<div class="order-card">
        <div class="order-card-head"><div><span class="order-id">${escapeHtml(o.memoNumber||o.orderId)}</span> <span class="muted">— ${o.own? `ordered here, ${fmtDate(o.createdAt)}` : `referred in, ${fmtDate(o.createdAt)}`}${visitType?` · ${visitType}`:''}</span></div>
        ${!o.own? `<span class="pill pill-purple">Referred tests only</span>`:''}</div>
        ${rows}
      </div>`;
    }).join('');
    return `<div style="margin-top:14px;"><h2>${escapeHtml(p.name)} <span class="mono muted" style="font-weight:400;">(${escapeHtml(p.hospitalNumber||p.id)})</span></h2>
      <p class="muted" style="margin-top:-8px;font-size:12.5px;">Born ${fmtDob(p.dob)} · ${fmtAge(p.dob)} · ${escapeHtml(SEX_LABELS[p.sex]||p.sex||'—')}</p>
      ${entries}</div>`;
  }).join('');
}

