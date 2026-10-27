/* ---------- Amending a validated result ---------- */
// The first-reported value is never overwritten: the server keeps it with who changed it, when and
// why, and the report says it was amended. Mirrors changesMeaning() in src/utils/amendment.js.
function isWithdrawn(t){ const a = t.amendments||[]; return a.length>0 && a[a.length-1].kind==='withdrawn' && t.value==='Result withdrawn'; }
function amendmentChangesMeaning(action, previousFlag, newFlag){
  if(action==='withdraw') return true;
  if(previousFlag==='N/A' || newFlag==='N/A') return true;
  return previousFlag!==newFlag;
}
function amendmentLine(a){
  const was = `${a.previousValue??''} ${a.previousUnit||''}`.trim() || '—';
  const told = !a.notifyRequired ? '' : a.notifiedAt ? ` Clinician told: ${escapeHtml(a.notifiedTo||'')}, ${fmtDate(a.notifiedAt)}.` : ` <b style="color:var(--crimson);">Clinician not yet told.</b>`;
  return `Previously reported as <span class="mono">${escapeHtml(was)}</span>${a.previousValidatedAt?` on ${fmtDate(a.previousValidatedAt)}`:''}. ${a.kind==='withdrawn'?'Withdrawn':'Amended'} ${fmtDate(a.amendedAt)} by ${escapeHtml(a.amendedBy)}. Reason: ${escapeHtml(a.reason)}.${told}`;
}
function amendmentNotes(t){
  return (t.amendments||[]).map(a=>`<div style="font-size:12px;margin-top:3px;padding-left:8px;border-left:3px solid var(--amber);">${amendmentLine(a)}</div>`).join('');
}
// The "who was told" fields, shared by the amend dialog and the outstanding-notification dialog.
function notifyFieldsHtml(){
  return `<div class="field"><label for="amd_outcome">Outcome</label>
      <select id="amd_outcome" onchange="syncNotifyFields()">
        <option value="reached">Reached — told about the amendment</option>
        <option value="not_reached">Not reached — no answer / unavailable</option>
      </select></div>
    <div class="grid grid-2">
      <div class="field"><label for="amd_person">Person told</label><input id="amd_person" placeholder="Name of the clinician or nurse"></div>
      <div class="field"><label for="amd_role">Their role (optional)</label><input id="amd_role" placeholder="Ordering clinician, ward nurse…"></div>
    </div>
    <div class="field"><label for="amd_method">Method</label>
      <select id="amd_method"><option value="phone">Phone</option><option value="in_person">In person</option></select></div>
    <div class="field" id="amd_readback_wrap"><label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="amd_readback"> Read-back confirmed — they repeated the result correctly</label></div>`;
}
function syncNotifyFields(){
  const o = document.getElementById('amd_outcome'), w = document.getElementById('amd_readback_wrap');
  if(o && w) w.style.display = o.value==='reached' ? 'block' : 'none';
}
// null when the person field is empty.
function readNotifyFields(){
  const personName = (document.getElementById('amd_person').value||'').trim();
  if(!personName) return null;
  return {
    personName, outcome: document.getElementById('amd_outcome').value,
    personRole: (document.getElementById('amd_role').value||'').trim(),
    method: document.getElementById('amd_method').value,
    readBack: document.getElementById('amd_readback').checked,
  };
}
let amendState = null;
function openAmendModal(orderId, code){
  const s = analyserScanResult;
  const t = s && s.orderId===orderId ? s.tests.find(x=>x.code===code) : null;
  if(!t){ showToast('Open the specimen first.'); return; }
  const tc = test(code);
  const withdrawn = isWithdrawn(t);
  amendState = { orderId, code, action:'correct', previousFlag: flagOf(s,t).flag, withdrawn };
  const unit = escapeHtml((tc?tc.units:t.unit)||'');
  const info = flagOf(s,t);
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:560px;">
      <div class="modal-head"><h2>Amend a validated result</h2><button class="modal-close" aria-label="Close" onclick="closeModal()">✕</button></div>
      ${patientBar(s.patient, {patientType:s.patientType, wardName:s.wardName})}
      <div style="border:1.5px solid var(--line, #d5dbe3);border-radius:9px;padding:10px 14px;margin-bottom:12px;">
        <div style="font-size:13px;">${escapeHtml(t.name)} <span class="mono muted">(${escapeHtml(code)})</span> · Specimen <span class="mono">${escapeHtml(s.specimenNumber)}</span></div>
        <div style="margin-top:4px;">Reported: ${withdrawn?'<b>Result withdrawn</b>':`<span class="mono" style="font-size:18px;font-weight:700;">${escapeHtml(t.value)} ${escapeHtml(t.unit||'')}</span> <span class="flag-${(info.flag||'').replace(' ','')}">${escapeHtml(info.flagLabel)}</span>`}</div>
        <div class="muted" style="font-size:12.5px;margin-top:4px;">Validated by ${escapeHtml(t.validatedBy||'—')}, ${fmtDate(t.validatedAt)}${s.orderedBy?` · Ordered by <b>${escapeHtml(s.orderedBy)}</b>`:''}</div>
      </div>
      <div class="field"><label>What needs to change</label>
        <label style="display:flex;align-items:center;gap:8px;font-weight:400;cursor:pointer;margin-bottom:4px;"><input type="radio" name="amd_action" value="correct" checked onchange="syncAmendModal()"> Correct the value</label>
        ${withdrawn?'':`<label style="display:flex;align-items:center;gap:8px;font-weight:400;cursor:pointer;"><input type="radio" name="amd_action" value="withdraw" onchange="syncAmendModal()"> Withdraw the result — there is no correct value to report (for example, wrong patient or wrong specimen)</label>`}
      </div>
      <div class="field" id="amd_value_wrap"><label for="amd_value">Corrected value</label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><input class="result-input mono" id="amd_value" inputmode="decimal" autocomplete="off" style="text-align:right;max-width:160px;" oninput="syncAmendModal()">
        <span class="mono muted" style="font-size:12.5px;">${unit}</span><span class="live-flag" id="amd_flag"></span></div></div>
      <div class="field"><label for="amd_reason">Reason for the amendment — printed on the amended report</label>
        <textarea id="amd_reason" rows="2" placeholder="What was wrong and why"></textarea></div>
      <div id="amd_notify_head" style="font-size:13px;font-weight:600;margin:6px 0;"></div>
      ${notifyFieldsHtml()}
      <div class="actions-row"><button class="btn btn-danger" id="amd_save" onclick="saveAmendment()">Amend result</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
  syncAmendModal();
  const v = document.getElementById('amd_value'); if(v) v.focus();
}
// Works out, as the dialog is filled in, what the new value means and whether someone must be told.
function amendDraft(){
  const st = amendState, s = analyserScanResult, tc = test(st.code);
  const action = (document.querySelector('input[name="amd_action"]:checked')||{}).value || 'correct';
  const value = (document.getElementById('amd_value').value||'').trim();
  const info = action==='correct' && value && tc && s ? evalResult(tc, s.patient, value, s.collectedAt) : {flag:'N/A', flagLabel:''};
  const required = action==='withdraw' || (value!=='' && amendmentChangesMeaning(action, st.previousFlag, info.flag));
  return { action, value, info, required, critical: /^Critical/.test(info.flag||'') };
}
function syncAmendModal(){
  if(!amendState) return;
  const d = amendDraft();
  document.getElementById('amd_value_wrap').style.display = d.action==='correct' ? 'block' : 'none';
  document.getElementById('amd_flag').innerHTML = d.action==='correct' && d.info.flag!=='N/A' ? `<span class="flag-${d.info.flag}">${escapeHtml(d.info.flagLabel)}</span>` : '';
  document.getElementById('amd_notify_head').innerHTML = d.required
    ? `<span style="color:var(--crimson);">This changes what the result means — record who was told.</span>${d.critical?' <span class="muted" style="font-weight:400;">The corrected value is critical: if nobody is reached it waits under Critical Values and is not released.</span>':' <span class="muted" style="font-weight:400;">If nobody can be reached, record the attempt: the amendment still goes out and stays on the outstanding list.</span>'}`
    : `Who was told <span class="muted" style="font-weight:400;">(optional — the meaning of the result does not change)</span>`;
  document.getElementById('amd_save').textContent = d.action==='withdraw' ? 'Withdraw result' : 'Amend result';
  syncNotifyFields();
}
async function saveAmendment(){
  const st = amendState, s = analyserScanResult;
  const t = s.tests.find(x=>x.code===st.code);
  const d = amendDraft();
  const reason = (document.getElementById('amd_reason').value||'').trim();
  if(d.action==='correct' && !d.value){ showToast('Type the corrected value.'); return; }
  if(d.action==='correct' && !st.withdrawn && d.value===String(t.value??'').trim()){ showToast('The corrected value is the same as the reported value.'); return; }
  if(reason.length<5){ showToast('Give the reason for the amendment.'); return; }
  const notification = readNotifyFields();
  if(d.required && !notification){ showToast('Record who was told — or who you tried to reach.'); return; }
  const was = st.withdrawn ? 'Result withdrawn' : `${t.value} ${t.unit||''}`.trim();
  const now = d.action==='withdraw' ? 'Result withdrawn' : `${d.value} ${(test(st.code)||{}).units||''}`.trim();
  const ok = await confirmAction({
    title: d.action==='withdraw' ? 'Withdraw this result?' : 'Amend this result?',
    body: `<b>${escapeHtml(t.name)}</b> for <b>${escapeHtml(s.patient?.name||'this patient')}</b> (Hospital No. ${escapeHtml(s.patient?.hospitalNumber||'—')})<br>
      Reported: <span class="mono">${escapeHtml(was)}</span><br>Now: <span class="mono" style="font-size:15px;"><b>${escapeHtml(now)}</b></span>${d.info.flag&&d.info.flag!=='N/A'?` <span class="flag-${d.info.flag}">${escapeHtml(d.info.flagLabel)}</span>`:''}<br>
      Reason: ${escapeHtml(reason)}<br><br>The report will be marked as amended and will show the earlier value. This cannot be undone, only amended again.`,
    confirmLabel: d.action==='withdraw' ? 'Withdraw result' : 'Amend result',
  });
  if(!ok) return;
  await withErrorToast(async ()=>{
    const res = await api.amendResult(st.orderId, st.code, { action:d.action, value:d.value, reason, notification });
    closeModal(); amendState = null;
    analyserScanResult = await api.getSpecimen(s.specimenNumber);
    await render();
    if(res.held) showToast('Corrected value saved. It is critical and nobody has been reached yet — notify the clinician under Critical Values, then validate it.', 'error');
    else if(d.required && notification.outcome!=='reached') showToast('Result amended. The clinician has not been told yet — it is listed under Critical Values until someone is.', 'error');
    else showToast(d.action==='withdraw' ? 'Result withdrawn. The report now says so.' : 'Result amended. The report is marked as amended.');
  });
}
// Amended results where the clinician still has to be told, then the lab's amendment log.
let lastAmendments = [];
function renderAmendmentsSection(pending, log){
  lastAmendments = [...pending, ...log];
  const what = a => `${escapeHtml(a.name)} <span class="mono muted">(${escapeHtml(a.code)})</span>`;
  const change = a => `<span class="mono">${escapeHtml(`${a.previousValue??''} ${a.previousUnit||''}`.trim()||'—')}</span> → <span class="mono"><b>${a.kind==='withdrawn'?'withdrawn':escapeHtml(`${a.newValue??''} ${a.newUnit||''}`.trim())}</b></span>`;
  const who = a => `${escapeHtml(a.patient?.name||'?')} <span class="muted">(${escapeHtml(a.patient?.hospitalNumber||'—')})</span>`;
  const pendingRows = pending.map(a=>`<tr>
      <td>${who(a)}<div class="muted" style="font-size:12px;">Memo ${escapeHtml(a.memoNumber||'—')}${a.orderedBy?` · Ordered by ${escapeHtml(a.orderedBy)}`:''}${a.wardName?` · ${escapeHtml(a.wardName)}`:''}</div></td>
      <td>${what(a)}<div style="font-size:12.5px;">${change(a)}</div></td>
      <td>${fmtDate(a.amendedAt)}<div class="muted" style="font-size:12px;">${fmtWait(a.amendedAt)} ago · by ${escapeHtml(a.amendedBy)}</div></td>
      <td>${hasCapability('process')?`<button class="btn btn-sm btn-danger" onclick="openAmendmentNotificationModal('${a.id}')">Record who was told</button>`:''}</td>
    </tr>`).join('');
  const logRows = log.map(a=>`<tr>
      <td style="white-space:nowrap;">${fmtDate(a.amendedAt)}</td><td>${who(a)}</td><td>${what(a)}<div style="font-size:12.5px;">${change(a)}</div></td>
      <td>${escapeHtml(a.reason)}<div class="muted" style="font-size:12px;">by ${escapeHtml(a.amendedBy)}</div></td>
      <td>${!a.notifyRequired?'<span class="muted">Not required</span>':a.notifiedAt?`${escapeHtml(a.notifiedTo||'')}<div class="muted" style="font-size:12px;">${fmtDate(a.notifiedAt)}</div>`:'<b style="color:var(--crimson);">Not yet told</b>'}</td>
    </tr>`).join('');
  return `
    ${pending.length?`<div class="card" style="padding:0;overflow-x:auto;border:1.5px solid var(--crimson);">
      <div style="padding:12px 16px 4px;"><h2 style="margin:0;">Amended results — clinician not yet told (${pending.length})</h2></div>
      <table><thead><tr><th>Patient</th><th>Result</th><th>Amended</th><th></th></tr></thead><tbody>${pendingRows}</tbody></table></div>`:''}
    <div class="card" style="padding:0;overflow-x:auto;">
      <div style="padding:12px 16px 4px;"><h2 style="margin:0;">Amended results log</h2></div>
      <table><thead><tr><th>Amended</th><th>Patient</th><th>Result</th><th>Reason</th><th>Clinician told</th></tr></thead>
      <tbody>${logRows || `<tr><td colspan="5" class="empty">No validated result has been amended at this lab.</td></tr>`}</tbody></table></div>`;
}
let amendmentNotifyId = null;
function openAmendmentNotificationModal(id){
  const a = lastAmendments.find(x=>x.id===id);
  if(!a) return;
  amendmentNotifyId = id;
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:520px;">
      <div class="modal-head"><h2>Record who was told of the amendment</h2><button class="modal-close" aria-label="Close" onclick="closeModal()">✕</button></div>
      ${patientBar(a.patient, {patientType:a.patientType, wardName:a.wardName})}
      <div style="border:1.5px solid var(--amber);border-radius:9px;padding:10px 14px;margin-bottom:12px;font-size:13px;">
        ${escapeHtml(a.name)} <span class="mono muted">(${escapeHtml(a.code)})</span><div style="margin-top:4px;">${amendmentLine({...a, notifyRequired:false})}</div>
        <div class="muted" style="font-size:12.5px;margin-top:4px;">Ordered by <b>${escapeHtml(a.orderedBy||'—')}</b></div>
      </div>
      ${notifyFieldsHtml()}
      <div class="actions-row"><button class="btn btn-danger" onclick="saveAmendmentNotification()">Save notification record</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
  syncNotifyFields();
  document.getElementById('amd_person').focus();
}
async function saveAmendmentNotification(){
  const data = readNotifyFields();
  if(!data){ showToast('Enter who was told — or who you tried to reach.'); return; }
  await withErrorToast(async ()=>{
    await api.recordAmendmentNotification(amendmentNotifyId, data);
    closeModal(); await render();
    showToast(data.outcome==='reached' ? 'Notification recorded.' : 'Attempt logged — the clinician still has to be told.');
  });
}

/* ---------- Culture & Sensitivity entry (microbiology) ---------- */
let cultureModalState = null;
async function openCultureResultModal(orderId, code){
  if(!organismsCache.length) organismsCache = await api.organisms();
  if(!antibioticsCache.length) antibioticsCache = await api.antibiotics();
  let existing = null;
  try{ existing = await api.cultureResult(orderId, code); }catch(e){ /* none yet */ }
  cultureModalState = {
    orderId, code,
    growthStatus: existing?.growthStatus || 'no_growth',
    organisms: (existing?.organisms||[]).map(o=>({
      organismId: o.organismId, colonyCount: o.colonyCount||'',
      sensitivities: Object.fromEntries((o.sensitivities||[]).map(s=>[s.antibioticId, s.result])),
      panelAntibiotics: (o.sensitivities||[]).map(s=>({id:s.antibioticId, name:s.antibiotic.name})),
    })),
  };
  renderCultureModal();
}
function renderCultureModal(){
  const st = cultureModalState;
  const tc = test(st.code);
  const orgRows = st.organisms.map((org,i)=>{
    const organism = organismsCache.find(o=>o.id===org.organismId);
    const panelRows = (org.panelAntibiotics||[]).map(ab=>`
      <div class="test-row" style="padding:4px 0;">
        <span style="font-size:12.5px;">${escapeHtml(ab.name)}</span>
        <div class="sir" tabindex="0" role="radiogroup" aria-label="${escapeHtml(ab.name)} — press S, I or R" data-org="${i}" data-ab="${ab.id}" onkeydown="sirKey(event,this)">
          ${['S','I','R'].map(v=>`<button type="button" tabindex="-1" role="radio" aria-checked="${org.sensitivities[ab.id]===v}" class="${org.sensitivities[ab.id]===v?'on':''}" onclick="sirPick(this.parentElement,'${v}')">${v}</button>`).join('')}
        </div>
      </div>`).join('');
    return `<div class="card" style="margin-top:10px;padding:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <b>${escapeHtml(organism?.name||'Unknown organism')}</b>
        <button class="btn btn-danger btn-sm" onclick="removeOrganismRow(${i})">Remove</button>
      </div>
      <div class="field" style="margin-top:8px;margin-bottom:8px;"><label>Colony Count (optional)</label>
        <input value="${escapeHtml(org.colonyCount)}" placeholder="e.g. > 100,000 CFU/mL" onchange="cultureModalState.organisms[${i}].colonyCount=this.value">
      </div>
      <label class="muted" style="font-size:12px;">Antibiotic sensitivity — click, or press S, I or R</label>
      ${panelRows || '<p class="muted" style="font-size:12px;">No standard panel for this organism yet — set one under Settings → Organisms.</p>'}
    </div>`;
  }).join('');
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:560px;">
      <div class="modal-head"><h2>Culture & Sensitivity — ${escapeHtml(tc?.name||st.code)}</h2><button class="modal-close" aria-label="Close" onclick="closeModal()">✕</button></div>
      ${analyserScanResult && analyserScanResult.orderId===st.orderId ? patientBar(analyserScanResult.patient, {patientType:analyserScanResult.patientType, wardName:analyserScanResult.wardName, right:`<span class="mono" style="font-size:13px;">${escapeHtml(analyserScanResult.specimenNumber)}</span>`}) : ''}
      <div class="field"><label>Growth Status</label>
        <select id="cult_growth" onchange="cultureModalState.growthStatus=this.value;renderCultureModal();">
          <option value="no_growth" ${st.growthStatus==='no_growth'?'selected':''}>No Growth</option>
          <option value="growth" ${st.growthStatus==='growth'?'selected':''}>Growth</option>
          <option value="contaminated" ${st.growthStatus==='contaminated'?'selected':''}>Contaminated Specimen</option>
        </select>
      </div>
      ${st.growthStatus==='growth'? `
        <div id="cultOrganisms">${orgRows}</div>
        <div class="grid grid-2" style="margin-top:10px;align-items:end;">
          <div class="field" style="margin-bottom:0;"><label>Add Organism</label>
            <select id="cult_add_organism">${organismsCache.filter(o=>!st.organisms.some(x=>x.organismId===o.id)).map(o=>`<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('') || '<option value="">— no organisms defined yet —</option>'}</select>
          </div>
          <button class="btn btn-outline btn-sm" onclick="addOrganismRow()">+ Add</button>
        </div>
      ` : ''}
      <div class="actions-row" style="margin-top:14px;"><button class="btn btn-teal" onclick="saveCultureResultModal()">Save Culture Result</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function addOrganismRow(){
  const organismId = document.getElementById('cult_add_organism').value;
  if(!organismId) return;
  const panel = await api.organismPanel(organismId);
  cultureModalState.organisms.push({
    organismId, colonyCount: '', sensitivities: {},
    panelAntibiotics: panel.map(p=>({id:p.antibioticId, name:p.antibioticName})),
  });
  renderCultureModal();
}
function removeOrganismRow(i){ cultureModalState.organisms.splice(i,1); renderCultureModal(); }
// Clicking the chosen letter again clears it. Keys S / I / R set it and move to the next antibiotic;
// Backspace or Delete clears.
function sirPick(group, value){
  const i = Number(group.dataset.org), ab = group.dataset.ab;
  const current = cultureModalState.organisms[i].sensitivities[ab];
  setSensitivity(i, ab, current===value ? '' : value);
  const now = cultureModalState.organisms[i].sensitivities[ab];
  group.querySelectorAll('button').forEach(b=>{ const on = b.textContent===now; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
}
function sirKey(e, group){
  const k = e.key.toUpperCase();
  if(['S','I','R'].includes(k)){
    e.preventDefault();
    if(cultureModalState.organisms[Number(group.dataset.org)].sensitivities[group.dataset.ab]!==k) sirPick(group, k);
    const all = [...document.querySelectorAll('#modalRoot .sir')]; const next = all[all.indexOf(group)+1]; if(next) next.focus();
  }else if(e.key==='Backspace' || e.key==='Delete'){
    e.preventDefault();
    const cur = cultureModalState.organisms[Number(group.dataset.org)].sensitivities[group.dataset.ab];
    if(cur) sirPick(group, cur);
  }
}
function setSensitivity(i, antibioticId, value){
  if(value) cultureModalState.organisms[i].sensitivities[antibioticId] = value;
  else delete cultureModalState.organisms[i].sensitivities[antibioticId];
}
async function saveCultureResultModal(){
  const st = cultureModalState;
  if(st.growthStatus==='growth' && !st.organisms.length){ showToast('Add at least one organism, or change growth status.'); return; }
  const payload = {
    growthStatus: st.growthStatus,
    organisms: st.growthStatus==='growth' ? st.organisms.map(o=>({
      organismId: o.organismId, colonyCount: o.colonyCount||null,
      sensitivities: Object.entries(o.sensitivities).map(([antibioticId,result])=>({antibioticId,result})),
    })) : [],
  };
  await withErrorToast(async ()=>{
    await api.saveCultureResult(st.orderId, st.code, payload);
    closeModal(); await render();
    showToast('Culture result saved.');
  });
}

async function certifyResult(orderId, code, skipConfirm){
  const s = analyserScanResult;
  const t = s && s.orderId===orderId ? s.tests.find(x=>x.code===code) : null;
  // A normal result validates in one click. An abnormal one is shown back first, with the last
  // result for comparison — validation cannot be undone from this screen.
  if(t && !skipConfirm){
    const info = flagOf(s,t);
    if(info.flag!=='Normal'){
      const ok = await confirmAction({
        title: 'Validate this result?',
        body: `<b>${escapeHtml(t.name)}</b> for <b>${escapeHtml(s.patient?.name||'this patient')}</b> (Hospital No. ${escapeHtml(s.patient?.hospitalNumber||'—')}):<br>
          <span class="mono" style="font-size:16px;font-weight:600;">${escapeHtml(t.value)} ${escapeHtml(t.unit||'')}</span> ${info.flagLabel?`<span class="flag-${info.flag}">${escapeHtml(info.flagLabel)}</span>`:''}<br>
          <span class="muted">${escapeHtml(info.rangeText||'')}${t.previous?` · Previous ${escapeHtml(t.previous.value)} ${escapeHtml(t.previous.unit||'')}, ${fmtDate(t.previous.validatedAt)}`:' · No previous result on record here'}</span><br>
          It will be released on the report under your name and cannot be changed from this screen.`,
        confirmLabel: 'Validate result', danger:false,
      });
      if(!ok) return;
    }
  }
  await withErrorToast(async ()=>{
    let result;
    try{
      result = await api.certify(orderId, code);
    }catch(e){
      if(e.data && e.data.requiresCriticalNotification){
        // Certification resumes by itself once a successful notification has been recorded.
        openCriticalNotificationModal(orderId, code, e.data.flagLabel, true);
        return;
      }else{
        throw e;
      }
    }
    if(analyserScanResult) analyserScanResult = await api.getSpecimen(analyserScanResult.specimenNumber);
    await render();
    showToast(`Result validated by ${session.user.name} — now on the report.`);
    if(result.reflexSuggestions && result.reflexSuggestions.length){
      renderReflexSuggestionModal(orderId, result.reflexSuggestions);
    }
  });
}
// Validates every NORMAL result on the open specimen in one action. Abnormal and critical results
// are left for individual review, on purpose.
async function certifyNormalResults(){
  const s = analyserScanResult; if(!s) return;
  const normal = s.tests.filter(t=>t.status==='interfaced' && flagOf(s,t).flag==='Normal');
  if(!normal.length) return;
  const ok = await confirmAction({
    title: `Validate ${normal.length} normal results?`,
    body: `For <b>${escapeHtml(s.patient?.name||'this patient')}</b> (Hospital No. ${escapeHtml(s.patient?.hospitalNumber||'—')}), specimen <span class="mono">${escapeHtml(s.specimenNumber)}</span>:<br>
      ${normal.map(t=>`${escapeHtml(t.name)}: <span class="mono">${escapeHtml(t.value)} ${escapeHtml(t.unit||'')}</span>`).join('<br>')}<br>
      <span class="muted">Abnormal and critical results are not included — validate those one by one.</span>`,
    confirmLabel: `Validate ${normal.length} results`, danger:false,
  });
  if(!ok) return;
  let done = 0; const suggestions = [];
  try{
    for(const t of normal){
      const result = await api.certify(s.orderId, t.code);
      done++;
      (result.reflexSuggestions||[]).forEach(x=>suggestions.push(x));
    }
  }catch(e){
    showToast(`${done} of ${normal.length} validated, then stopped: ${e.message}`, 'error');
  }
  analyserScanResult = await api.getSpecimen(s.specimenNumber).catch(()=>analyserScanResult);
  await render();
  if(done===normal.length) showToast(`${done} normal results validated by ${session.user.name}.`);
  if(suggestions.length) renderReflexSuggestionModal(s.orderId, suggestions);
}
function renderReflexSuggestionModal(orderId, suggestions){
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:440px;">
      <div class="modal-head"><h2>Reflex Suggestion${suggestions.length>1?'s':''}</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <p class="muted" style="font-size:12.5px;margin-top:-6px;">Based on this result, consider adding:</p>
      ${suggestions.map(s=>`<div class="test-row">
        <div><b>${escapeHtml(s.resultTestName)}</b> <span class="mono muted">(${escapeHtml(s.resultTestCode)})</span>
          <div class="muted" style="font-size:11px;">${escapeHtml(s.name)} — ${escapeHtml(s.reason)}</div></div>
        <button class="btn btn-sm" onclick="addReflexTest('${orderId}','${s.resultTestCode}', this)">+ Add</button>
      </div>`).join('')}
      <div class="actions-row" style="margin-top:10px;"><button class="btn btn-outline" onclick="closeModal()">Dismiss</button></div>
    </div>
  </div>`;
}
async function addReflexTest(orderId, code, btnEl){
  await withErrorToast(async ()=>{
    await api.addReflexTest(orderId, code);
    if(btnEl){ btnEl.disabled = true; btnEl.textContent = 'Added ✓'; }
    showToast(`${code} added to the order — collect it like any other test.`);
  });
}
/* ---------- Critical (panic) values: worklist, notification record, log ---------- */
let criticalLogTo = localDateStr(new Date());
let criticalLogFrom = localDateStr(new Date(Date.now() - 29*24*60*60*1000));
function criticalLogParams(){
  const params = new URLSearchParams();
  if(criticalLogFrom) params.set('from', new Date(criticalLogFrom+'T00:00:00').toISOString());
  if(criticalLogTo) params.set('to', new Date(criticalLogTo+'T23:59:59.999').toISOString());
  return params.toString();
}
const CRITICAL_LEVEL_META = {
  pending:{label:'Awaiting notification', cls:'pill-amber'},
  overdue:{label:'OVERDUE', cls:'pill-crimson'},
  escalated:{label:'OVERDUE — escalated to Regional', cls:'pill-crimson'},
};
const CRITICAL_METHOD_LABELS = {phone:'Phone', in_person:'In person'};
function renderCriticalAttempts(attempts){
  if(!attempts || !attempts.length) return '';
  return `<div style="margin-top:6px;font-size:12px;">${attempts.map(a=>`<div class="muted">
    ${fmtDate(a.createdAt)} — ${a.outcome==='reached'?'<b style="color:var(--teal-dark);">Reached</b>':'<b style="color:var(--crimson);">Not reached</b>'}:
    ${escapeHtml(a.personName)}${a.personRole?` (${escapeHtml(a.personRole)})`:''} · ${CRITICAL_METHOD_LABELS[a.method]||escapeHtml(a.method)}${a.outcome==='reached'?` · read-back ${a.readBack?'confirmed':'not confirmed'}`:''} · by ${escapeHtml(a.recordedBy)}${a.note?` — ${escapeHtml(a.note)}`:''}
  </div>`).join('')}</div>`;
}
function renderCriticalTab(critical, log){
  const items = critical.items;
  const worklist = items.length ? items.map(c=>{
    const meta = CRITICAL_LEVEL_META[c.level] || CRITICAL_LEVEL_META.pending;
    return `<div class="order-card" ${c.level!=='pending'?'style="border-color:var(--crimson);"':''}>
      <div class="order-card-head">
        <div><span class="order-id">${escapeHtml(c.memoNumber)}</span> — ${escapeHtml(c.patient?.name||'Unknown')} <span class="muted">(Hospital No. ${escapeHtml(c.patient?.hospitalNumber||'—')})</span>
          <div class="muted" style="font-size:11.5px;">Ordered by ${escapeHtml(c.orderedBy||'—')}${c.patientType==='inpatient'?` · In-patient${c.wardName?`, ${escapeHtml(c.wardName)}`:''}`:c.patientType==='outpatient'?' · Out-patient':''}${c.referred?` · Referred from ${escapeHtml(c.orderingFacilityName)}`:''}</div>
        </div>
        <span class="pill ${meta.cls}">${meta.label} · ${c.minutes} min</span>
      </div>
      <div class="test-row">
        <div>${escapeHtml(c.name)} <span class="mono muted">(${escapeHtml(c.code)})</span>${c.specimenNumber?` <span class="mono muted" style="font-size:11px;">${escapeHtml(c.specimenNumber)}</span>`:''}
          <div class="muted" style="font-size:11.5px;">Result entered ${fmtDate(c.enteredAt)} by ${escapeHtml(c.enteredBy||'—')}</div>
          ${renderCriticalAttempts(c.attempts)}
        </div>
        <div style="text-align:right;"><span class="mono">${escapeHtml(c.value)} ${escapeHtml(c.unit||'')}</span> <span class="flag-${c.flag}">${escapeHtml(c.flagLabel)}</span>
          ${hasCapability('process')? `<div style="margin-top:8px;"><button class="btn btn-danger btn-sm" onclick="openCriticalNotificationModal('${c.orderId}','${c.code}','${c.flagLabel}',false)">Record Notification</button></div>`:''}
        </div>
      </div>
    </div>`;
  }).join('') : `<div class="card empty">No critical values awaiting notification.</div>`;

  const notified = log.filter(l=>l.notified);
  const onTime = notified.filter(l=>l.onTime).length;
  const logRows = log.map(l=>`<tr>
    <td class="muted" style="font-size:12px;white-space:nowrap;">${fmtDate(l.enteredAt)}</td>
    <td>${escapeHtml(l.patient?.name||'Unknown')}<div class="muted mono" style="font-size:11px;">${escapeHtml(l.memoNumber)}</div></td>
    <td>${escapeHtml(l.name)} <span class="mono muted">(${escapeHtml(l.code)})</span></td>
    <td><span class="mono">${escapeHtml(l.value)} ${escapeHtml(l.unit||'')}</span> <span class="flag-${l.flag||'CriticalHigh'}">${escapeHtml(l.flagLabel)}</span></td>
    <td>${l.notified? `${escapeHtml(l.notifiedTo||'—')}<div class="muted" style="font-size:11px;">${fmtDate(l.notifiedAt)} · ${l.attempts.length} attempt${l.attempts.length===1?'':'s'} logged</div>` : `<span class="muted">Not yet · ${l.attempts.length} attempt${l.attempts.length===1?'':'s'}</span>`}</td>
    <td>${l.notified? `<span class="pill ${l.onTime?'pill-teal':'pill-crimson'}">${l.minutes} min${l.onTime?'':' — late'}</span>` : `<span class="pill pill-amber">${l.minutes} min waiting</span>`}</td>
  </tr>`).join('');

  return `
    <div class="card" style="font-size:12.5px;"><span class="muted">A critical value must be notified within <b>${critical.overdueMinutes} minutes</b> of the result being entered. After that it is marked Overdue for senior staff; after <b>${critical.escalateMinutes} minutes</b> it is also escalated to the Regional administrator. A critical result cannot be certified until someone has been reached.</span></div>
    ${worklist}
    <div class="pagehead" style="margin-top:22px;"><h1 style="font-size:17px;">Critical Value Log</h1></div>
    <div class="card">
      <div class="grid grid-4">
        <div class="field" style="margin-bottom:0;"><label>From</label><input type="date" value="${criticalLogFrom}" onchange="criticalLogFrom=this.value;render();"></div>
        <div class="field" style="margin-bottom:0;"><label>To</label><input type="date" value="${criticalLogTo}" onchange="criticalLogTo=this.value;render();"></div>
      </div>
    </div>
    <div class="grid grid-4">
      <div class="card kpi"><div class="n">${log.length}</div><div class="l">Critical values in period</div></div>
      <div class="card kpi"><div class="n">${onTime}</div><div class="l">Notified within ${critical.overdueMinutes} min</div></div>
      <div class="card kpi"><div class="n">${notified.length - onTime}</div><div class="l">Notified late</div></div>
      <div class="card kpi"><div class="n">${log.length - notified.length}</div><div class="l">Not yet notified</div></div>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>Result entered</th><th>Patient</th><th>Test</th><th>Result</th><th>Notified</th><th>Time to notify</th></tr></thead>
      <tbody>${logRows || `<tr><td colspan="6" class="empty">No critical values in this period.</td></tr>`}</tbody></table>
    </div>`;
}
let criticalModalState = null; // { orderId, code, certifyAfter }
let lastCriticalItems = [];
// Everything the caller needs to read out: found in the critical worklist, or on the open specimen.
function criticalContext(orderId, code){
  const c = lastCriticalItems.find(x=>x.orderId===orderId && x.code===code);
  if(c) return { patient:c.patient, name:c.name, value:c.value, unit:c.unit, orderedBy:c.orderedBy, patientType:c.patientType, wardName:c.wardName };
  const s = analyserScanResult;
  const t = s && s.orderId===orderId ? s.tests.find(x=>x.code===code) : null;
  if(t) return { patient:s.patient, name:t.name, value:t.value, unit:t.unit, orderedBy:s.orderedBy, patientType:s.patientType, wardName:s.wardName };
  return null;
}
function openCriticalNotificationModal(orderId, code, flagLabel, certifyAfter){
  criticalModalState = { orderId, code, certifyAfter: !!certifyAfter };
  const ctx = criticalContext(orderId, code);
  const what = ctx ? `
      ${patientBar(ctx.patient, {patientType:ctx.patientType, wardName:ctx.wardName})}
      <div style="border:1.5px solid var(--crimson);border-radius:9px;padding:10px 14px;margin-bottom:12px;">
        <div style="font-size:13px;">${escapeHtml(ctx.name)} <span class="mono muted">(${escapeHtml(code)})</span></div>
        <div style="margin-top:4px;"><span class="mono" style="font-size:20px;font-weight:700;">${escapeHtml(ctx.value)} ${escapeHtml(ctx.unit||'')}</span> <span class="flag-${/LOW/.test(flagLabel||'')?'CriticalLow':'CriticalHigh'}">${escapeHtml(flagLabel||'CRITICAL')}</span></div>
        <div class="muted" style="font-size:12.5px;margin-top:4px;">Ordered by <b>${escapeHtml(ctx.orderedBy||'—')}</b></div>
      </div>` : `<p class="muted" style="font-size:12.5px;">Test <span class="mono">${escapeHtml(code)}</span> — ${escapeHtml(flagLabel||'CRITICAL')}</p>`;
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:520px;">
      <div class="modal-head"><h2>Record critical value notification</h2><button class="modal-close" aria-label="Close" onclick="closeModal()">✕</button></div>
      ${what}
      <p class="muted" style="font-size:12.5px;margin-top:0;">Log every attempt — including one that did not get through.${certifyAfter?' The result is validated as soon as someone has been reached.':''}</p>
      <div class="field"><label>Outcome</label>
        <select id="crit_outcome" onchange="syncCriticalModal()">
          <option value="reached">Reached — result given</option>
          <option value="not_reached">Not reached — no answer / unavailable</option>
        </select></div>
      <div class="grid grid-2">
        <div class="field"><label>Person called</label><input id="crit_person" placeholder="Name of the clinician or nurse"></div>
        <div class="field"><label>Their role (optional)</label><input id="crit_role" placeholder="Ordering clinician, ward nurse…"></div>
      </div>
      <div class="field"><label>Method</label>
        <select id="crit_method"><option value="phone">Phone</option><option value="in_person">In person</option></select></div>
      <div class="field" id="crit_readback_wrap"><label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="crit_readback"> Read-back confirmed — they repeated the result correctly</label></div>
      <div class="field"><label>Note (optional)</label><input id="crit_note"></div>
      <div class="actions-row"><button class="btn btn-danger" onclick="saveCriticalNotification()">Save notification record</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
  syncCriticalModal();
  const person = document.getElementById('crit_person'); if(person) person.focus();
}
function syncCriticalModal(){
  const reached = document.getElementById('crit_outcome').value==='reached';
  document.getElementById('crit_readback_wrap').style.display = reached ? 'block' : 'none';
}
async function saveCriticalNotification(){
  const st = criticalModalState;
  const outcome = document.getElementById('crit_outcome').value;
  const personName = (document.getElementById('crit_person').value||'').trim();
  if(!personName){ showToast('Enter who was called.'); return; }
  const data = {
    outcome, personName,
    personRole: (document.getElementById('crit_role').value||'').trim(),
    method: document.getElementById('crit_method').value,
    readBack: document.getElementById('crit_readback').checked,
    note: (document.getElementById('crit_note').value||'').trim(),
  };
  await withErrorToast(async ()=>{
    await api.recordCriticalNotification(st.orderId, st.code, data);
    closeModal();
    if(outcome==='reached' && st.certifyAfter){
      await certifyResult(st.orderId, st.code, true); // already reviewed; renders and toasts itself
      return;
    }
    await render();
    showToast(outcome==='reached' ? 'Notification recorded — the result can now be validated.' : 'Attempt logged — still awaiting a successful notification.');
  });
}
function renderIncomingTab(orders, f){
  if(!orders.length) return `<div class="card empty">No referred samples in transit to this facility.</div>`;
  return orders.map(o=>{
    const p = o.patient;
    const referredTests = o.tests.filter(t=>t.referred && t.performingFacilityId===f.id && t.status==='awaiting_receipt');
    return `<div class="order-card">
      <div class="order-card-head">
        <div><span class="order-id">${escapeHtml(o.memoNumber)}</span> — ${escapeHtml(p?.name||'Unknown')} <span class="muted">(Hospital No. ${escapeHtml(p?.hospitalNumber||'—')})</span>
          <div class="muted" style="font-size:11.5px;">Referred by ${escapeHtml(o.referredByName||'—')} · Order placed ${fmtDate(o.createdAt)}</div>
        </div>
        <span class="pill pill-purple">Referred — same order, no duplicate</span>
      </div>
      <div class="actions-row"><button class="btn btn-sm" onclick="receiveReferral('${o.id}')">Receive All at ${escapeHtml(f.name)}</button></div>
      ${(o.specimens||[]).filter(s=>referredTests.some(t=>t.specimenId===s.id)).map(s=>`<div class="test-row">
        <div><b class="mono">${escapeHtml(s.specimenNumber)}</b> <span class="muted">(${escapeHtml(s.category)} · ${escapeHtml(s.bottleType)})</span>
          <div class="muted" style="font-size:11.5px;">${referredTests.filter(t=>t.specimenId===s.id).map(t=>`${escapeHtml(t.name)} (${escapeHtml(t.code)})`).join(', ')}</div></div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-teal btn-sm" onclick="receiveReferredSpecimen('${s.specimenNumber}')">Receive</button>
          ${hasCapability('accept')? `<button class="btn btn-danger btn-sm" onclick="rejectSpecimen('${s.specimenNumber}','referral')">Reject</button>`:''}
        </div>
      </div>`).join('')}
    </div>`;
  }).join('');
}
async function receiveReferredSpecimen(specimenNumber){
  await withErrorToast(async ()=>{
    await api.receiveReferredSpecimen(specimenNumber);
    await render();
    showToast('Referred specimen received into this lab.');
  });
}
async function receiveReferral(orderId){
  await withErrorToast(async ()=>{
    await api.receiveReferral(orderId);
    await render();
    showToast('Referred sample received into this lab.');
  });
}

