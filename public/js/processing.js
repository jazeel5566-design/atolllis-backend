/* ============================= RESULT PROCESSING ============================= */
let processingTab = 'analyser';

let analyserScanResult = null;
async function viewProcessingPage(){
  const fid = session.user.facilityId, f = fac(fid);
  const [allOrders, incomingQ, critical, iface, pendingAmendments] = await Promise.all([
    api.orders(), api.orders('incoming_referrals'),
    api.criticalWorklist().catch(()=>({items:[], escalated:[], overdueMinutes:30, escalateMinutes:60})),
    api.interfaceMessages(processingTab==='interface' ? interfaceLogView : 'held').catch(()=>({held:0, messages:[]})),
    api.amendments(true).catch(()=>[]),
  ]);
  const amendmentLog = processingTab==='critical' ? await api.amendments().catch(()=>[]) : [];
  const toTell = critical.items.length + pendingAmendments.length;
  lastCriticalItems = critical.items;
  const criticalLog = processingTab==='critical' ? await api.criticalLog(criticalLogParams()).catch(()=>[]) : [];
  const analyserQ = allOrders.filter(o=>o.tests.some(t=>t.performingFacilityId===fid && ['received','processing','interfaced'].includes(t.status)));
  return `
    <div class="pagehead"><h1>Result Processing</h1><p>Analyser interface and validation for ${escapeHtml(f.name)}.</p></div>
    <div class="tabs">
      <div class="tab ${processingTab==='analyser'?'active':''}" onclick="processingTab='analyser';worklistSearch='';processingCategoryFilter='';processingStatusFilter='';processingDateFilter='';processingPatientTypeFilter='';processingStatOnly=false;render();">Analyser Processing (${analyserQ.length})</div>
      <div class="tab ${processingTab==='incoming'?'active':''}" onclick="processingTab='incoming';worklistSearch='';render();">Incoming Referrals (${incomingQ.length})</div>
      <div class="tab ${processingTab==='critical'?'active':''}" onclick="processingTab='critical';worklistSearch='';render();" ${toTell?'style="color:var(--crimson);font-weight:700;"':''}>${toTell?'⚠ ':''}Critical Values (${critical.items.length})${pendingAmendments.length?` · Amendments (${pendingAmendments.length})`:''}</div>
      <div class="tab ${processingTab==='interface'?'active':''}" onclick="processingTab='interface';worklistSearch='';render();" ${iface.held?'style="color:var(--amber);font-weight:700;"':''}>Analyser Interface (${iface.held} held)</div>
    </div>
    ${processingTab==='analyser'? renderProcessingTab(allOrders, f)
      : processingTab==='critical'? renderCriticalTab(critical, criticalLog) + renderAmendmentsSection(pendingAmendments, amendmentLog)
      : processingTab==='interface'? renderInterfaceTab(iface)
      : renderIncomingTab(incomingQ, f)}
  `;
}
/* ---------- Analyser Interface: what the analysers asked and sent ---------- */
let interfaceLogView = 'held';
const INTERFACE_STATUS = {
  accepted:{label:'Accepted', cls:'pill-teal'}, duplicate:{label:'Duplicate', cls:'pill-grey'},
  unmatched:{label:'Held', cls:'pill-amber'}, refused:{label:'Refused', cls:'pill-crimson'},
  logged:{label:'QC — logged', cls:'pill-purple'}, resolved:{label:'Resolved', cls:'pill-teal'}, dismissed:{label:'Dismissed', cls:'pill-grey'},
};
function renderInterfaceTab(iface){
  const rows = iface.messages.map(m=>{
    const st = INTERFACE_STATUS[m.status] || {label:m.status, cls:'pill-grey'};
    const t = m.testCode ? test(m.testCode) : null;
    const detail = [m.detail, m.resolvedBy ? `${m.status==='dismissed'?'Dismissed':'Resolved'} by ${m.resolvedBy}, ${fmtDate(m.resolvedAt)}${m.resolveNote?': '+m.resolveNote:''}` : ''].filter(Boolean).join(' · ');
    return `<tr>
      <td style="white-space:nowrap;">${fmtDate(m.createdAt)}</td>
      <td>${escapeHtml(m.instrumentName)}</td>
      <td>${m.kind==='query'?'Query':m.kind==='qc'?'QC':'Result'}</td>
      <td class="mono">${escapeHtml(m.specimenNumber||'—')}</td>
      <td>${m.instrumentCode?`<span class="mono">${escapeHtml(m.instrumentCode)}</span>`:'—'}${t?` <span class="muted">→ ${escapeHtml(t.name)}</span>`:''}</td>
      <td class="mono">${m.value?`${escapeHtml(m.value)} ${escapeHtml(m.unit||'')}`:'—'}</td>
      <td><span class="pill ${st.cls}">${st.label}</span></td>
      <td style="font-size:12px;">${escapeHtml(detail)}</td>
      <td style="white-space:nowrap;">${m.status==='unmatched'? `${m.kind==='result'?`<button class="btn btn-sm btn-outline" onclick="retryInterfaceMessage('${m.id}')">Retry</button> `:''}<button class="btn btn-sm btn-outline" onclick="openDismissInterfaceModal('${m.id}')">Dismiss</button>` : ''}</td>
    </tr>`;
  }).join('');
  return `
    <div class="card">
      <div class="actions-row" style="margin-top:0;">
        <button class="btn btn-sm ${interfaceLogView==='held'?'':'btn-outline'}" onclick="interfaceLogView='held';render();">Held for review (${iface.held})</button>
        <button class="btn btn-sm ${interfaceLogView==='all'?'':'btn-outline'}" onclick="interfaceLogView='all';render();">Full log</button>
      </div>
      <p class="muted" style="font-size:12px;margin:10px 0 0;">A result is held when the interface cannot place it safely — an unknown barcode, an analyser code with no mapping, a wrong unit. Fix the cause and press Retry, or Dismiss it with a note. Nothing held is ever written to a patient.</p>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>Time</th><th>Instrument</th><th>Type</th><th>Specimen No.</th><th>Analyser code</th><th>Value</th><th>Outcome</th><th>Detail</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="9" class="empty">${interfaceLogView==='held'?'Nothing is waiting for review.':'No interface activity yet.'}</td></tr>`}</tbody></table>
    </div>`;
}
async function retryInterfaceMessage(id){
  await withErrorToast(async ()=>{
    const r = await api.retryInterfaceMessage(id);
    await render();
    showToast(r.status==='unmatched' ? `Still held: ${r.detail}` : r.status==='accepted' ? 'Result accepted — awaiting validation.' : (r.detail||'Resolved.'));
  });
}
function openDismissInterfaceModal(id){
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:440px;">
      <div class="modal-head"><h2>Dismiss held entry</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <p class="muted" style="font-size:12.5px;margin-top:-6px;">The entry stays in the full log with your name and this note. It will not be written to any patient.</p>
      <div class="field"><label>Why is it being dismissed?</label><input id="iface_dismiss_note" placeholder="Required"></div>
      <div class="actions-row"><button class="btn" onclick="dismissInterfaceMessage('${id}')">Dismiss</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function dismissInterfaceMessage(id){
  const note = (document.getElementById('iface_dismiss_note').value||'').trim();
  if(!note){ showToast('Enter a note saying why.'); return; }
  await withErrorToast(async ()=>{
    await api.dismissInterfaceMessage(id, note);
    closeModal(); await render();
    showToast('Entry dismissed.');
  });
}

let processingCategoryFilter = '';
let processingStatusFilter = '';
let processingDateFilter = '';
let processingPatientTypeFilter = '';
let processingStatOnly = false;
const PROCESSING_STATUS_GROUPS = {
  received: { label: 'Received', testStatuses: ['received'] },
  processing: { label: 'Loaded to Analyser', testStatuses: ['processing'] },
  interfaced: { label: 'Interfaced (Awaiting Validation)', testStatuses: ['interfaced'] },
  certified: { label: 'Certified', testStatuses: ['completed'] },
};
function renderProcessingTab(orders, f){
  const filterCard = `<div class="card">
    <div class="grid grid-4">
      <div class="field" style="margin-bottom:0;"><label>Search</label>
        <input id="procSearch" value="${escapeHtml(worklistSearch)}" placeholder="Patient, Hospital No., ID No., Memo No., or Specimen No."
          onkeydown="if(event.key==='Enter'){event.preventDefault();searchProcessingEnter();}"
          oninput="worklistSearch=this.value;renderCached();const el=document.getElementById('procSearch');if(el)el.focus();"></div>
      <div class="field" style="margin-bottom:0;"><label>Category</label>
        <select onchange="processingCategoryFilter=this.value;renderCached();">
          <option value="">All categories</option>
          ${categoriesCache.map(c=>`<option value="${escapeHtml(c.name)}" ${processingCategoryFilter===c.name?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
        </select></div>
      <div class="field" style="margin-bottom:0;"><label>Status</label>
        <select onchange="processingStatusFilter=this.value;renderCached();">
          <option value="">All statuses</option>
          ${Object.entries(PROCESSING_STATUS_GROUPS).map(([k,g])=>`<option value="${k}" ${processingStatusFilter===k?'selected':''}>${g.label}</option>`).join('')}
        </select></div>
      <div class="field" style="margin-bottom:0;"><label>Collected Date</label>
        <input type="date" value="${processingDateFilter}" onchange="processingDateFilter=this.value;renderCached();"></div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:14px 0;">
    <div style="display:flex;gap:28px;flex-wrap:wrap;align-items:center;">
      <div style="display:flex;gap:14px;align-items:center;">
        <span class="muted" style="font-size:12.5px;font-weight:600;">Patient Type:</span>
        ${['','outpatient','inpatient'].map(v=>`<label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;">
          <input type="radio" name="procPatientType" value="${v}" ${processingPatientTypeFilter===v?'checked':''} onchange="processingPatientTypeFilter='${v}';renderCached();">
          ${v===''?'All':v==='inpatient'?'In-Patient':'Out-Patient'}
        </label>`).join('')}
      </div>
      <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;font-weight:600;">
        <input type="checkbox" ${processingStatOnly?'checked':''} onchange="processingStatOnly=this.checked;renderCached();"> STAT only
      </label>
    </div>
  </div>`;

  const scanPanel = analyserScanResult ? renderSpecimenScanPanel(analyserScanResult) : '';

  const q = worklistSearch.trim().toLowerCase();
  const anyFilterActive = !!(q || processingCategoryFilter || processingStatusFilter || processingDateFilter || processingPatientTypeFilter || processingStatOnly);
  // With no filter set the list is the work itself: everything accepted here that still needs a
  // result or a validation. Certified work only appears when asked for.
  const ACTION_STATUSES = ['received','processing','interfaced'];
  const shownStatuses = anyFilterActive ? ['received','processing','interfaced','completed'] : ACTION_STATUSES;

  const cards = [];
  orders.forEach(o=>{
    const p = o.patient;
    if(q){
      const specMatch = (o.specimens||[]).some(s=>s.specimenNumber.toLowerCase().includes(q));
      const matchOrder = specMatch || (o.memoNumber||'').toLowerCase().includes(q) || (p?.hospitalNumber||'').toLowerCase().includes(q) || (p?.idNumber||'').toLowerCase().includes(q) || (p?.name||'').toLowerCase().includes(q);
      if(!matchOrder) return;
    }
    if(processingPatientTypeFilter && o.patientType!==processingPatientTypeFilter) return;
    // Only ever show specimens that have been accepted into this facility — a specimen still
    // sitting as 'collected' (awaiting acceptance) belongs to Sample Acceptance, not here.
    const mine = s => o.tests.filter(t=>t.specimenId===s.id && t.performingFacilityId===f.id);
    let specimens = (o.specimens||[]).filter(s => mine(s).some(t=>shownStatuses.includes(t.status)));
    if(processingCategoryFilter) specimens = specimens.filter(s=>s.category===processingCategoryFilter);
    if(processingStatusFilter){
      const group = PROCESSING_STATUS_GROUPS[processingStatusFilter];
      specimens = specimens.filter(s=>mine(s).some(t=>group.testStatuses.includes(t.status)));
    }
    if(processingStatOnly) specimens = specimens.filter(s=>mine(s).some(t=>t.isStat));
    // Date always means "collected on" — a specimen's collection date never changes, regardless
    // of which stage (Received/Processing/Interfaced/Certified) it's currently sitting in.
    if(processingDateFilter) specimens = specimens.filter(s=>s.collectedAt && s.collectedAt.slice(0,10)===processingDateFilter);
    if(!specimens.length) return;

    const info = specimens.map(s=>{
      const stests = mine(s);
      const open = stests.filter(t=>ACTION_STATUSES.includes(t.status));
      const toResult = stests.filter(t=>t.status==='received'||t.status==='processing').length;
      const toValidate = stests.filter(t=>t.status==='interfaced').length;
      // Target turnaround is the shortest of the unfinished tests on the tube, counted from collection.
      const targets = open.map(t=>test(t.code)?.tat).filter(h=>h>0);
      const targetH = targets.length ? Math.min(...targets) : null;
      const late = !!(open.length && targetH && s.collectedAt && (Date.now()-new Date(s.collectedAt)) > targetH*3600000);
      return { s, stat: open.some(t=>t.isStat) || (!open.length && stests.some(t=>t.isStat)), open:open.length, toResult, toValidate, targetH, late };
    }).sort((x,y)=> (y.stat-x.stat) || (new Date(x.s.collectedAt||0)-new Date(y.s.collectedAt||0)));

    const html = `<div class="order-card">
      <div class="order-card-head"><div><span class="order-id">${escapeHtml(o.memoNumber)}</span> — ${escapeHtml(p?.name||'Unknown')} <span class="muted">(Hospital No. ${escapeHtml(p?.hospitalNumber||'—')}${p?.dob?` · ${fmtAge(p.dob)}`:''}${p?.sex?` · ${escapeHtml(p.sex)}`:''})</span>${o.patientType? ` <span class="pill pill-grey" style="font-size:10.5px;">${o.patientType==='inpatient'?'In-Patient'+(o.wardName?' · '+escapeHtml(o.wardName):''):'Out-Patient'}</span>`:''}</div></div>
      ${info.map(i=>{
        const s = i.s;
        const work = [i.toResult?`${i.toResult} to result`:'', i.toValidate?`${i.toValidate} to validate`:''].filter(Boolean).join(' · ') || 'Certified';
        return `<div class="test-row ${i.stat?'stat-row':''}" data-specimen-row="${escapeHtml(s.specimenNumber)}" style="cursor:pointer;" onclick="loadSpecimenPanel('${s.specimenNumber}');">
          <div><b class="mono">${escapeHtml(s.specimenNumber)}</b> <span class="muted">(${escapeHtml(s.category)} · ${escapeHtml(s.bottleType)})</span>${i.stat? ` <span class="pill pill-crimson">STAT</span>`:''}</div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            ${i.open && s.collectedAt? `<span class="wait ${i.late?'late':''}">${i.late?'⚠ ':''}Waiting ${fmtWait(s.collectedAt)}${i.late?` — over the ${i.targetH}h target`:''}</span>`:''}
            <span class="pill ${i.open?'pill-amber':'pill-teal'}">${work}</span>
          </div>
        </div>`;
      }).join('')}
    </div>`;
    const openInfo = info.filter(i=>i.open);
    cards.push({ html, stat: openInfo.some(i=>i.stat), late: openInfo.some(i=>i.late),
      oldest: Math.min(...info.map(i=>new Date(i.s.collectedAt||Date.now()).getTime())) });
  });
  // STAT first, then anything over its target, then longest waiting.
  cards.sort((x,y)=> (y.stat-x.stat) || (y.late-x.late) || (x.oldest-y.oldest));
  const rows = cards.map(c=>c.html).join('');
  const heading = `<p class="muted" style="font-size:12.5px;margin:0 0 10px;">${anyFilterActive
    ? `${cards.length} memo${cards.length===1?' matches':'s match'} the filters.`
    : `Everything waiting for a result or a validation at this lab — STAT first, then longest waiting. ${cards.length} memo${cards.length===1?'':'s'}.`}</p>`;

  const emptyState = analyserScanResult ? '' : (anyFilterActive
    ? `<div class="card empty">No specimen matches these filters. Clear a filter, or check the specimen has been accepted at Sample Acceptance.</div>`
    : `<div class="card empty">Nothing is waiting for a result or a validation. Accepted specimens appear here by themselves.</div>`);

  return filterCard + scanPanel + (rows ? heading + rows : emptyState);
}
// Pressing Enter in Search acts like a scan: if it narrows to exactly one specimen, jump straight
// into it — same ergonomics as scanning a barcode, without a separate dedicated field for it.
function searchProcessingEnter(){
  const q = worklistSearch.trim().toLowerCase();
  if(!q) return;
  const matches = [];
  document.querySelectorAll('[data-specimen-row]').forEach(el=>{
    const num = el.getAttribute('data-specimen-row');
    if(num.toLowerCase().includes(q)) matches.push(num);
  });
  if(matches.length===1) loadSpecimenPanel(matches[0]);
}
async function loadSpecimenPanel(specimenNumber){
  await withErrorToast(async ()=>{
    analyserScanResult = await api.getSpecimen(specimenNumber);
    await render();
    const panel = document.getElementById('specimenPanel'); if(panel) panel.scrollIntoView({block:'start', behavior:'smooth'});
  });
}
function flagOf(s, t){
  const tc = test(t.code);
  if(t.status==='completed' && isWithdrawn(t)) return {flag:'N/A', flagLabel:'', rangeText:''};
  return (tc && s.patient) ? evalResult(tc, s.patient, t.value, s.collectedAt) : {flag:'N/A', flagLabel:'', rangeText:''};
}
function renderSpecimenScanPanel(s){
  const anyReceived = s.tests.some(t=>t.status==='received');
  const normalToValidate = s.tests.filter(t=>t.status==='interfaced' && flagOf(s,t).flag==='Normal');
  const right = `<div style="display:flex;gap:10px;align-items:center;"><span class="mono" style="font-size:13px;">${escapeHtml(s.specimenNumber)}</span><button class="btn btn-outline btn-sm" onclick="analyserScanResult=null;render();">Close specimen</button></div>`;
  return `<div class="card" id="specimenPanel">
    ${patientBar(s.patient, {patientType:s.patientType, wardName:s.wardName, right})}
    <div class="muted" style="font-size:12.5px;margin-top:8px;">${escapeHtml(s.category)} · ${escapeHtml(s.bottleType)} · Memo ${escapeHtml(s.memoNumber)}${s.orderedBy?` · Ordered by ${escapeHtml(s.orderedBy)}`:''}${s.collectedAt?` · Collected ${fmtDate(s.collectedAt)}`:''}</div>
    <div class="actions-row" style="margin-top:10px;">
      ${anyReceived && hasCapability('process')? `<button class="btn btn-sm btn-outline" onclick="loadSpecimenToAnalyser('${s.specimenNumber}')">Mark as loaded to analyser</button>`:''}
      ${normalToValidate.length>1 && hasCapability('certify')? `<button class="btn btn-sm" onclick="certifyNormalResults()">Validate ${normalToValidate.length} normal results</button>`:''}
    </div>
    ${s.tests.map(t=>renderProcessingTestRow(s, t)).join('')}
  </div>`;
}
// An analyser that asks the LIS for its orders does this by itself; the button is for instruments
// that are loaded by hand.
async function loadSpecimenToAnalyser(specimenNumber){
  await withErrorToast(async ()=>{
    await api.loadSpecimenAnalyser(specimenNumber);
    analyserScanResult = await api.getSpecimen(specimenNumber);
    await render();
    showToast('Marked as loaded to the analyser.');
  });
}
// Handles all four post-acceptance stages in one place — Received / Loaded to Analyser (enter a
// result by hand, or the culture form), Interfaced (validate), Certified (read-only).
function renderProcessingTestRow(s, t){
  const meta = STATUS_META[t.visibleStatus||t.status] || {label:t.status, cls:'pill-grey'};
  const tc = test(t.code);
  const orderId = s.orderId;
  const unit = escapeHtml(t.unit||(tc?tc.units:'')||'');
  const range = (tc && s.patient) ? matchRange(tc, s.patient, s.collectedAt) : null;
  const rangeText = range ? `Reference ${range.low} – ${range.high} ${escapeHtml(tc.units||'')}` : (tc && !tc.isCulture ? 'No reference range for this age and sex' : '');
  const previous = t.previous ? `<div class="muted" style="font-size:12px;">Previous: <span class="mono">${escapeHtml(t.previous.value)} ${escapeHtml(t.previous.unit||'')}</span>, ${fmtDate(t.previous.validatedAt)}</div>` : '';
  let body = `<span class="pill ${meta.cls}">${meta.label}</span>`;
  let under = '';

  if((t.status==='received' || t.status==='processing') && hasCapability('process')){
    if(tc?.isCulture){
      body += ` <button class="btn btn-sm" onclick="openCultureResultModal('${orderId}','${t.code}')">Enter culture result</button>`;
    }else{
      body = `<input class="result-input mono" id="mval_${orderId}_${t.code}" inputmode="decimal" autocomplete="off" style="text-align:right;" aria-label="Result for ${escapeHtml(t.name)}"
          oninput="previewResultFlag(this,'${t.code}')" onkeydown="if(event.key==='Enter'){event.preventDefault();enterManualResult('${orderId}','${t.code}');}">
        <span class="mono muted" style="font-size:12.5px;">${unit}</span>
        <button class="btn btn-sm btn-outline" onclick="enterManualResult('${orderId}','${t.code}')">Save result ↵</button>
        <span class="live-flag" id="mflag_${orderId}_${t.code}"></span>`;
      under = `<div class="muted" style="font-size:12px;">${t.status==='processing'?'Loaded to the analyser — its result arrives here by itself. Enter by hand only if the analyser cannot report it. · ':''}${rangeText}</div>${previous}`;
    }
  }else if(t.status==='interfaced'){
    const info = flagOf(s,t);
    if((t.amendments||[]).length) under += `<div style="font-size:12px;font-weight:600;">Corrected value — the earlier report is being amended. It is released when validated.</div>`;
    body = `<span class="mono" style="font-size:15px;font-weight:600;">${escapeHtml(t.value)} ${unit}</span> <span class="flag-${(info.flag||'').replace(' ','')}">${escapeHtml(info.flagLabel)}</span>
      ${hasCapability('certify')
        ? `<button class="btn btn-sm" onclick="certifyResult('${orderId}','${t.code}')">Validate result</button>`
        : `<span class="muted" style="font-size:12px;">Waiting for a Pathologist or Lab Manager to validate</span>`}`;
    under += `<div class="muted" style="font-size:12px;">${rangeText}${t.enteredBy?` · Entered by ${escapeHtml(t.enteredBy)}, ${fmtDate(t.enteredAt)}`:''}</div>${previous}${amendmentNotes(t)}`;
  }else if(t.status==='completed'){
    const info = flagOf(s,t);
    const amended = (t.amendments||[]).length>0, withdrawn = isWithdrawn(t);
    const canAmend = hasCapability('certify') && t.performingFacilityId===session.user.facilityId && !tc?.isCulture;
    body = `${withdrawn ? `<span style="font-size:15px;font-weight:600;">Result withdrawn</span>` : `<span class="mono" style="font-size:15px;font-weight:600;">${escapeHtml(t.value)} ${unit}</span> <span class="flag-${(info.flag||'').replace(' ','')}">${escapeHtml(info.flagLabel)}</span>`}
      ${amended?`<span class="pill pill-amber">${withdrawn?'Withdrawn':'Amended'}</span>`:''}
      ${canAmend?`<button class="btn btn-sm btn-outline" onclick="openAmendModal('${orderId}','${t.code}')">Amend result</button>`:''}`;
    under = `<div class="muted" style="font-size:12px;">${withdrawn?'':rangeText+' · '}${withdrawn?'Withdrawn':amended?'Amended result validated':'Validated'} by ${escapeHtml(t.validatedBy||'—')}, ${fmtDate(t.validatedAt)}</div>${withdrawn?'':previous}${amendmentNotes(t)}`;
  }

  return `<div class="test-row ${t.isStat?'stat-row':''}"><div><div class="test-name">${escapeHtml(t.name)} <span class="mono muted">(${escapeHtml(t.code)})</span>${t.isStat?` <span class="pill pill-crimson">STAT</span>`:''}</div>${under}</div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">${body}</div></div>`;
}
// Shows what the value means while it is being typed — before it is saved, not after.
function previewResultFlag(input, code){
  const out = document.getElementById(input.id.replace('mval_','mflag_'));
  const s = analyserScanResult, tc = test(code);
  if(!out || !s || !tc) return;
  const value = (input.value||'').trim();
  if(!value){ out.innerHTML = ''; return; }
  const info = evalResult(tc, s.patient, value, s.collectedAt);
  if(Number.isNaN(numericValue(value))){
    const numeric = (tc.refRanges||[]).length || tc.criticalLow!=null || tc.criticalHigh!=null;
    out.innerHTML = numeric ? `<span style="color:var(--amber);font-weight:600;">Not a number — check before saving</span>` : '';
    return;
  }
  out.innerHTML = info.flag==='N/A' ? '' : `<span class="flag-${info.flag}">${escapeHtml(info.flagLabel)}</span>`;
}
async function enterManualResult(orderId, code){
  const val = (document.getElementById(`mval_${orderId}_${code}`).value||'').trim();
  if(val===''){ showToast('Type a result first.'); return; }
  const s = analyserScanResult, tc = test(code);
  const info = (s && tc) ? evalResult(tc, s.patient, val, s.collectedAt) : {flag:'N/A'};
  // A critical value is confirmed before it is saved: a slipped decimal point is the usual cause.
  if(info.flag==='CriticalHigh' || info.flag==='CriticalLow'){
    const t = s.tests.find(x=>x.code===code);
    const ok = await confirmAction({
      title: `${info.flagLabel} — save this result?`,
      body: `<b>${escapeHtml(t?.name||code)}</b> for <b>${escapeHtml(s.patient?.name||'this patient')}</b>: <span class="mono" style="font-size:15px;">${escapeHtml(val)} ${escapeHtml(tc.units||'')}</span>.<br>Check the value. Once saved, the clinician must be notified before it can be validated.`,
      confirmLabel: 'Save critical result',
    });
    if(!ok) return;
  }
  await withErrorToast(async ()=>{
    await api.manualResult(orderId, code, val);
    if(analyserScanResult) analyserScanResult = await api.getSpecimen(analyserScanResult.specimenNumber);
    await render(); // the cursor lands in the next empty result field
    showToast(`Result saved for ${tc?tc.name:code} — waiting for validation.`);
  });
}

