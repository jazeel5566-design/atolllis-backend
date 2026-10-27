/* ============================= PROCESS FLOW ============================= */
async function viewProcessFlow(){
  const fid = session.user.facilityId, f = fac(fid);
  const [pendingCollection, referralPending, pendingAcceptance, analyserQ, validationQ, reportable] = await Promise.all([
    api.orders('pending_collection'), api.orders('referral_pending'), api.orders('pending_acceptance'),
    api.orders('analyser_queue'), api.orders('validation_queue'), api.orders('reportable'),
  ]);
  const awaitingCollect = pendingCollection.length;
  const referralPendingCount = referralPending.reduce((n,o)=>n+o.tests.filter(t=>t.status==='awaiting_referral').length,0);
  const awaitingAccept = pendingAcceptance.length;
  const analyserCount = analyserQ.reduce((n,o)=>n+o.tests.filter(t=>t.performingFacilityId===fid && ['received','processing'].includes(t.status)).length,0);
  const validationCount = validationQ.reduce((n,o)=>n+o.tests.filter(t=>t.performingFacilityId===fid && ['received','interfaced'].includes(t.status)).length,0);
  const reportsReady = reportable.filter(o=>o.tests.some(t=>t.status==='completed')).length;

  const steps = [
    {title:'Memo Generation', desc:'Order memo fed from the HIS — or Billing if no HIS is available.', badge:null, action:"newMemoFocus()"},
    {title:'Sample Collection & Referral', desc:'Find by memo number, select tests, collect & print label. Higher-level tests are assigned and sent right here.', badge:awaitingCollect+referralPendingCount, action:"goTo('collection')"},
    {title:'Sample Acceptance', desc:'Read the barcode, then Accept or Reject with a reason — local tests only.', badge:awaitingAccept, action:"goTo('acceptance')"},
    {title:'Analyser Processing', desc:'Load locally-collected samples to the analyser; results interface back automatically.', badge:analyserCount, action:"goToProcessing('analyser')"},
    {title:'Result Validation', desc:'Validate & certify interfaced or manually entered results.', badge:validationCount, action:"goToProcessing('analyser','interfaced')"},
    {title:'Report Issue', desc:'Completed results become a standard laboratory report.', badge:reportsReady, action:"goToReports('samples')"},
  ];
  const track = steps.map((s,i)=>{
    const step = `<div class="flow-step" onclick="${s.action}">
      <div class="flow-num">${i+1}</div>
      <div class="flow-title">${escapeHtml(s.title)}</div>
      <div class="flow-desc">${escapeHtml(s.desc)}</div>
      ${s.badge!==null ? `<div class="flow-badge"><span class="pill ${s.badge>0?'pill-amber':'pill-grey'}">${s.badge} ${s.badge===1?'item':'items'}</span></div>` : ''}
    </div>`;
    const arrow = i<steps.length-1 ? `<div class="flow-arrow">→</div>` : '';
    return step + arrow;
  }).join('');
  return `
    <div class="pagehead"><h1>Process Flow</h1><p>The sample journey at ${escapeHtml(f.name)}, from memo to issued report. Click any step to jump straight to it.</p></div>
    <div class="card"><div class="flow-track">${track}</div></div>
  `;
}

/* ============================= DASHBOARD ============================= */
async function viewDashboard(){
  const fid = session.user.facilityId, f = fac(fid);
  const [pendingCollection, referralPending, pendingAcceptance, incoming, activeLocal, completedToday] = await Promise.all([
    api.orders('pending_collection'), api.orders('referral_pending'), api.orders('pending_acceptance'),
    api.orders('incoming_referrals'), api.orders('analyser_queue'), api.orders('reportable'),
  ]);
  let critical = {items:[], escalated:[]};
  try{ critical = await api.criticalWorklist(); }catch(e){ /* dashboard still renders without it */ }
  const criticalOverdue = critical.items.filter(c=>c.level!=='pending').length;
  const awaitingCollect = pendingCollection.length;
  const awaitingReferAction = referralPending.length;
  const awaitingAccept = pendingAcceptance.length;
  const localActive = activeLocal.reduce((n,o)=>n+o.tests.filter(t=>t.performingFacilityId===fid && ['received','processing','interfaced'].includes(t.status)).length,0);
  const incomingAwaitingReceipt = incoming.reduce((n,o)=>n+o.tests.filter(t=>t.referred && t.performingFacilityId===fid && t.status==='awaiting_receipt').length,0);
  const today = new Date().toDateString();
  const completedTodayCount = completedToday.reduce((n,o)=>n+o.tests.filter(t=>t.status==='completed' && t.performingFacilityId===fid && t.validatedAt && new Date(t.validatedAt).toDateString()===today).length,0);
  const anyOrders = awaitingCollect || awaitingAccept || localActive || completedTodayCount || incoming.length;

  return `
    <div class="pagehead"><h1>Dashboard</h1><p>Live snapshot for ${escapeHtml(f.name)}.</p></div>
    ${critical.items.length? `<div class="card" style="border:1.5px solid var(--crimson);background:var(--crimson-bg);">
      <h2 style="color:var(--crimson);">⚠ ${critical.items.length} critical value${critical.items.length===1?'':'s'} awaiting notification</h2>
      <p style="margin-top:-6px;font-size:13px;">${criticalOverdue? `<b>${criticalOverdue} overdue</b> — waiting more than ${critical.overdueMinutes} minutes.${hasCapability('certify')?' Senior staff action needed.':''}` : `Notify the clinician within ${critical.overdueMinutes} minutes of the result.`}</p>
      <button class="btn btn-sm" onclick="goToProcessing('critical')">Open Critical Values →</button>
    </div>`:''}
    ${critical.escalated.length? `<div class="card" style="border:1.5px solid var(--crimson);">
      <h2 style="color:var(--crimson);">⚠ Escalated to Regional — ${critical.escalated.length} critical value${critical.escalated.length===1?'':'s'} un-notified for over ${critical.escalateMinutes} minutes</h2>
      <p class="muted" style="margin-top:-6px;font-size:12.5px;">At other laboratories. Contact the lab — the result and patient stay with the performing lab until certified.</p>
      ${critical.escalated.map(c=>`<div class="test-row">
        <div><b>${escapeHtml(c.facilityName)}</b> — ${escapeHtml(c.name)} <span class="mono muted">(${escapeHtml(c.code)})</span>
          <div class="muted" style="font-size:11.5px;">Memo ${escapeHtml(c.memoNumber)}${c.specimenNumber?` · Specimen ${escapeHtml(c.specimenNumber)}`:''} · entered ${fmtDate(c.enteredAt)} · ${c.attempts} attempt${c.attempts===1?'':'s'} logged</div></div>
        <div><span class="flag-${c.flag}">${escapeHtml(c.flagLabel)}</span> <span class="pill pill-crimson">${c.minutes} min</span></div>
      </div>`).join('')}
    </div>`:''}
    <div class="grid grid-4">
      <div class="card kpi"><div class="n">${awaitingCollect}</div><div class="l">Memos awaiting sample collection</div></div>
      <div class="card kpi"><div class="n">${awaitingAccept}</div><div class="l">Samples awaiting acceptance</div></div>
      <div class="card kpi"><div class="n">${localActive}</div><div class="l">Local tests in processing / validation</div></div>
      <div class="card kpi"><div class="n">${completedTodayCount}</div><div class="l">Completed today at this lab</div></div>
    </div>
    ${awaitingReferAction || incoming.length ? `<div class="grid grid-2">
      ${awaitingReferAction? `<div class="card"><h2>Action needed</h2><p class="muted" style="margin-top:-6px;font-size:13px;">${awaitingReferAction} order(s) have higher-level tests ready to be referred upward — assign and send from Sample Collection.</p><button class="btn btn-sm" onclick="goTo('collection')">Open Sample Collection →</button></div>`:''}
      ${incoming.length? `<div class="card"><h2>Incoming referrals</h2><p class="muted" style="margin-top:-6px;font-size:13px;">${incomingAwaitingReceipt} in transit to this lab.</p><button class="btn btn-sm" onclick="goToProcessing('incoming')">Open Result Processing →</button></div>`:''}
    </div>`:''}
    ${!anyOrders? `<div class="card empty"><h2>No activity yet</h2><p>Fetch a memo from the HIS to get started, or (if you're an Admin) create a test memo from Sample Collection to try the system out.</p><button class="btn" style="margin-top:8px;" onclick="goTo('collection')">Open Sample Collection →</button></div>`:''}
    <div class="card">
      <h2>The sample-processing pipeline</h2>
      <ol style="margin:0;padding-left:18px;font-size:13px;color:var(--mute);line-height:1.9;">
        <li>A memo is generated from the HIS (or Billing, if no HIS) with patient and test details, then fetched into this app by number.</li>
        <li>At <b>Sample Collection</b>, tests are pre-selected and can be deselected; Collect prints a label with a unique specimen number and barcode. Higher-level tests are assigned and sent to the receiving lab right here.</li>
        <li>At <b>Sample Acceptance</b>, the remaining local tests are Accepted or Rejected (with a reason); already-referred tests skip this step.</li>
        <li>Local tests load to the analyser and results interface back automatically if the unit matches the catalog.</li>
        <li>At <b>Result Processing → Validation</b>, results are validated and certified — the sample becomes Completed and its report becomes viewable.</li>
        <li>Only the performing lab's technologists see the granular "Interfaced" state; everyone else sees "Processing" until it's Completed.</li>
      </ol>
    </div>
  `;
}


