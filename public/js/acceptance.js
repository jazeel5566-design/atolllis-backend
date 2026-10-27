/* ============================= SAMPLE ACCEPTANCE ============================= */
let acceptanceTab = 'pending';
let acceptanceScanResult = null;

// Rejection log period — defaults to the last 30 days; both ends are plain YYYY-MM-DD strings.
function localDateStr(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
let rejectionLogTo = localDateStr(new Date());
let rejectionLogFrom = localDateStr(new Date(Date.now() - 29*24*60*60*1000));
function rejectionLogParams(){
  const params = new URLSearchParams();
  if(rejectionLogFrom) params.set('from', new Date(rejectionLogFrom+'T00:00:00').toISOString());
  if(rejectionLogTo) params.set('to', new Date(rejectionLogTo+'T23:59:59.999').toISOString());
  return params.toString();
}

async function viewAcceptancePage(){
  const f = fac(session.user.facilityId);
  const [pendingRaw, rejectedSpecimens] = await Promise.all([api.orders('pending_acceptance'), api.rejections(rejectionLogParams())]);
  return `
    <div class="pagehead"><h1>Sample Acceptance</h1><p>${escapeHtml(f.name)} — accept or reject each specimen individually.</p></div>
    <div class="tabs">
      <div class="tab ${acceptanceTab==='pending'?'active':''}" onclick="acceptanceTab='pending';worklistSearch='';acceptanceScanResult=null;render();">Awaiting Acceptance (${pendingRaw.length})</div>
      <div class="tab ${acceptanceTab==='rejected'?'active':''}" onclick="acceptanceTab='rejected';worklistSearch='';render();">Sample Rejection Log (${rejectedSpecimens.length})</div>
    </div>
    ${acceptanceTab==='pending' ? renderAcceptanceTab(pendingRaw, f) : renderRejectedLog(rejectedSpecimens, f)}
  `;
}
// Acceptance is per specimen (per tube, per category) — scan-first, same pattern as Analyser Processing.
function renderAcceptanceTab(orders, f){
  const scanBox = `<div class="card">
    <div class="field" style="max-width:400px;margin-bottom:8px;">
      <label>Scan or enter the Specimen Barcode Number</label>
      <input id="acceptScanField" placeholder="e.g. H268271001" autocomplete="off"
        onkeydown="if(event.key==='Enter'){event.preventDefault();scanSpecimenForAcceptance();}">
    </div>
    <button class="btn" onclick="scanSpecimenForAcceptance()">Load Specimen</button>
  </div>`;

  const scanPanel = acceptanceScanResult ? renderAcceptancePanel(acceptanceScanResult) : '';

  const rows = orders.map(o=>{
    const p = o.patient;
    const specimens = (o.specimens||[]).filter(s=>s.status==='collected' && o.tests.some(t=>t.specimenId===s.id && t.status==='collected'));
    if(!specimens.length) return '';
    return `<div class="order-card">
      <div class="order-card-head"><div><span class="order-id">${escapeHtml(o.memoNumber)}</span> — ${escapeHtml(p?.name||'Unknown')} <span class="muted">(Hospital No. ${escapeHtml(p?.hospitalNumber||'—')})</span>
        <div class="muted" style="font-size:11.5px;">Collected ${fmtDate(o.collectedAt)} by ${escapeHtml(o.collectedBy||'—')}</div></div>
        ${specimens.length>1 && hasCapability('accept')? `<button class="btn btn-outline btn-sm" onclick="acceptAllSpecimens(${JSON.stringify(specimens.map(s=>s.specimenNumber))})">Accept All (${specimens.length})</button>`:''}
      </div>
      ${specimens.map(s=>`<div class="test-row" style="cursor:pointer;" onclick="document.getElementById('acceptScanField').value='${s.specimenNumber}';scanSpecimenForAcceptance();">
        <div><b class="mono">${escapeHtml(s.specimenNumber)}</b> <span class="muted">(${escapeHtml(s.category)} · ${escapeHtml(s.bottleType)})</span></div>
        <div><span class="pill pill-amber">Awaiting Acceptance</span></div>
      </div>`).join('')}
    </div>`;
  }).join('');

  return scanBox + scanPanel + (rows || (!acceptanceScanResult ? `<div class="card empty">No specimens awaiting acceptance.</div>` : ''));
}
function renderAcceptancePanel(s){
  const right = `<div style="display:flex;gap:10px;align-items:center;"><span class="mono" style="font-size:13px;">${escapeHtml(s.specimenNumber)}</span><button class="btn btn-outline btn-sm" onclick="acceptanceScanResult=null;render();">Close specimen</button></div>`;
  return `<div class="card">
    ${patientBar(s.patient, {patientType:s.patientType, wardName:s.wardName, right})}
    <div class="muted" style="font-size:12.5px;margin:8px 0 12px;">${escapeHtml(s.category)} · ${escapeHtml(s.bottleType)} · Memo ${escapeHtml(s.memoNumber||'—')}${s.collectedAt?` · Collected ${fmtDate(s.collectedAt)}`:''}</div>
    <div class="field"><label>Tests on this specimen</label>
      <div class="checklist">${s.tests.map(t=>`<div class="test-row ${t.isStat?'stat-row':''}"><span>${escapeHtml(t.name)} <span class="mono muted">(${escapeHtml(t.code)})</span>${t.isStat?` <span class="pill pill-crimson">STAT</span>`:''}</span></div>`).join('') || '<p class="muted">No tests on this specimen.</p>'}</div>
    </div>
    ${s.status==='collected'
      ? (hasCapability('accept')
        ? `<div class="actions-row">
          <button class="btn btn-teal" id="acceptSpecimenBtn" onclick="acceptSpecimen('${s.specimenNumber}')">Accept specimen ↵</button>
          <button class="btn btn-danger" onclick="rejectSpecimen('${s.specimenNumber}')">Reject specimen</button>
        </div>`
        : `<p class="muted" style="font-size:12.5px;">Only a Technologist, Pathologist, or Lab Manager can accept or reject a specimen.</p>`)
      : `<p class="muted" style="font-size:12.5px;">This specimen is already <b>${escapeHtml(s.status)}</b>${s.rejectionReason?` — ${escapeHtml(s.rejectionReason)}`:''}. Scan the next one.</p>`}
  </div>`;
}
function renderRejectedLog(rejections, f){
  const periodCard = `<div class="card">
    <div class="grid grid-4">
      <div class="field" style="margin-bottom:0;"><label>From</label>
        <input type="date" value="${rejectionLogFrom}" onchange="rejectionLogFrom=this.value;render();"></div>
      <div class="field" style="margin-bottom:0;"><label>To</label>
        <input type="date" value="${rejectionLogTo}" onchange="rejectionLogTo=this.value;render();"></div>
    </div>
  </div>`;
  if(!rejections.length) return periodCard + `<div class="card empty">No rejected specimens in this period.</div>`;

  // Summary: one row per reason, one column per category, counted over the period shown.
  const categories = [...new Set(rejections.map(r=>r.category))].sort();
  const counts = {}; // reasonName -> { category -> n }
  rejections.forEach(r=>{ (counts[r.reasonName] = counts[r.reasonName] || {})[r.category] = (counts[r.reasonName][r.category]||0) + 1; });
  const rowTotal = name => categories.reduce((n,c)=>n+(counts[name][c]||0), 0);
  const reasonNames = Object.keys(counts).sort((x,y)=>rowTotal(y)-rowTotal(x) || x.localeCompare(y));
  const summaryCard = `<div class="card" style="padding:0;overflow-x:auto;">
    <table><thead><tr><th>Reason</th>${categories.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}<th>Total</th></tr></thead>
    <tbody>
      ${reasonNames.map(name=>`<tr><td>${escapeHtml(name)}</td>${categories.map(c=>`<td>${counts[name][c]||'—'}</td>`).join('')}<td><b>${rowTotal(name)}</b></td></tr>`).join('')}
      <tr><td><b>Total</b></td>${categories.map(c=>`<td><b>${rejections.filter(r=>r.category===c).length}</b></td>`).join('')}<td><b>${rejections.length}</b></td></tr>
    </tbody></table>
  </div>`;

  const rows = rejections.map(r=>{
    const elsewhere = r.facilityId !== f.id;           // rejected by a receiving lab, on our specimen
    const notOurs = r.orderingFacilityId !== f.id;     // we rejected it as the receiving lab
    return `<div class="order-card">
      <div class="order-card-head">
        <div><span class="order-id">${escapeHtml(r.specimenNumber)}</span> — ${escapeHtml(r.patient?.name||'Unknown')} <span class="muted">(Hospital No. ${escapeHtml(r.patient?.hospitalNumber||'—')})</span>
          <div class="muted" style="font-size:11.5px;">${escapeHtml(r.category)} · ${escapeHtml(r.bottleType)} · Memo ${escapeHtml(r.memoNumber)}${notOurs?` · Referred from ${escapeHtml(r.orderingFacilityName)}`:''}</div>
          <div class="muted" style="font-size:11.5px;">Rejected ${fmtDate(r.rejectedAt)} by ${escapeHtml(r.rejectedBy||'—')}${elsewhere?` at ${escapeHtml(r.facilityName)} (receiving lab)`:''}</div>
          ${r.note?`<div style="font-size:12.5px;margin-top:4px;">${escapeHtml(r.note)}</div>`:''}
        </div>
        <span class="pill pill-crimson">Rejected: ${escapeHtml(r.reasonName)}</span>
      </div>
    </div>`;
  }).join('');
  return periodCard + summaryCard + rows;
}
async function scanSpecimenForAcceptance(){
  const el = document.getElementById('acceptScanField');
  const num = (el.value||'').trim();
  if(!num){ showToast('Enter or scan a specimen number.'); return; }
  await withErrorToast(async ()=>{
    acceptanceScanResult = await api.getSpecimen(num);
    await render();
    // Scan, then Enter again to accept: the Accept button holds the cursor while a specimen is open.
    const btn = document.getElementById('acceptSpecimenBtn'); if(btn) btn.focus();
  });
}
async function acceptSpecimen(specimenNumber){
  await withErrorToast(async ()=>{
    await api.acceptSpecimen(specimenNumber);
    acceptanceScanResult = null; // done — back to the scan field for the next tube
    await render();
    showToast(`Specimen ${specimenNumber} accepted. Scan the next one.`);
  });
}
async function acceptAllSpecimens(specimenNumbers){
  if(!await confirmAction({title:`Accept ${specimenNumbers.length} specimens?`, body:`All on this memo: <span class="mono">${specimenNumbers.map(escapeHtml).join(', ')}</span>.<br>Check each tube is present and labelled before accepting them together.`, confirmLabel:`Accept ${specimenNumbers.length} specimens`, danger:false})) return;
  await withErrorToast(async ()=>{
    for(const num of specimenNumbers) await api.acceptSpecimen(num);
    await render();
    showToast(`${specimenNumbers.length} specimen(s) accepted.`);
  });
}
let rejectModalSpecimenNumber = null;
let rejectModalMode = 'acceptance'; // 'acceptance' (ordering lab) | 'referral' (receiving lab, referred specimen)
async function rejectSpecimen(specimenNumber, mode){
  rejectModalSpecimenNumber = specimenNumber;
  rejectModalMode = mode || 'acceptance';
  let reasons = [], spec = null;
  try{ reasons = await api.rejectionReasons(); }catch(e){ /* fall through with only "Other" */ }
  try{ spec = await api.getSpecimen(specimenNumber); }catch(e){ /* the dialog still works without the detail */ }
  const affected = spec ? spec.tests.filter(t=>rejectModalMode==='referral' ? t.status==='awaiting_receipt' : t.status==='collected') : [];
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:480px;">
      <div class="modal-head"><h2>Reject specimen <span class="mono muted" style="font-weight:400;font-size:13px;">${escapeHtml(specimenNumber)}</span></h2><button class="modal-close" aria-label="Close" onclick="closeModal()">✕</button></div>
      ${spec? patientBar(spec.patient, {patientType:spec.patientType, wardName:spec.wardName}) : ''}
      ${spec? `<p style="font-size:13px;margin-top:0;">${escapeHtml(spec.category)} · ${escapeHtml(spec.bottleType)}. Rejecting it stops ${affected.length===1?'this test':`these ${affected.length} tests`} until the specimen is collected again${rejectModalMode==='referral'?' by the ordering facility':''}:<br><b>${affected.map(t=>escapeHtml(t.name)).join(', ')||'—'}</b></p>`:''}
      <div class="field"><label>Reason</label>
        <select id="reject_reason" onchange="syncRejectNoteField()">
          <option value="">Select a reason…</option>
          ${reasons.map(r=>`<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join('')}
          <option value="other">Other — explain below</option>
        </select>
      </div>
      <div class="field"><label id="reject_note_label" for="reject_note"></label><input id="reject_note"></div>
      <div class="actions-row"><button class="btn btn-danger" onclick="confirmRejectSpecimen()">Reject specimen</button><button class="btn btn-outline" onclick="closeModal()">Keep specimen</button></div>
    </div>
  </div>`;
  syncRejectNoteField();
  document.getElementById('reject_reason').focus();
}
function syncRejectNoteField(){
  const isOther = document.getElementById('reject_reason').value==='other';
  document.getElementById('reject_note_label').textContent = isOther ? 'Explanation (required)' : 'Additional note (optional)';
}
async function confirmRejectSpecimen(){
  const reasonId = document.getElementById('reject_reason').value;
  const note = (document.getElementById('reject_note').value||'').trim();
  if(!reasonId){ showToast('Select the reason for rejecting this specimen.'); return; }
  if(reasonId==='other' && !note){ showToast('Enter an explanation for "Other".'); return; }
  await withErrorToast(async ()=>{
    if(rejectModalMode==='referral'){
      await api.rejectReferredSpecimen(rejectModalSpecimenNumber, reasonId, note);
    }else{
      await api.rejectSpecimen(rejectModalSpecimenNumber, reasonId, note);
      acceptanceScanResult = null;
    }
    closeModal();
    await render();
    showToast(rejectModalMode==='referral' ? 'Referred specimen rejected — returned to the ordering facility for recollection.' : 'Specimen rejected.');
  });
}

