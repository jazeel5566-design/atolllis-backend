/* ============================= SAMPLE COLLECTION ============================= */
let worklistSearch = '';
let collectionOpenOrderId = null;
let collectionOpenOrder = null;
let memoFetchStatus = null;
let memoSearchMatches = null;
let memoFetchError = '';
let pendingCollect = null;
let pendingReprintGroups = null;

async function viewCollectionPage(){
  const f = fac(session.user.facilityId);
  const header = `
    <div class="pagehead"><h1>Sample Collection</h1><p>${escapeHtml(f.name)} — fetch a memo from the HIS or Billing system, then collect.</p></div>
    <div class="card">
      <div class="field" style="max-width:440px;margin-bottom:0;">
        <label>Memo Number, Hospital No., or ID No. — type it, or scan the barcode on the memo</label>
        <input id="memoFetchField" placeholder="e.g. HIS-2026-004821, H-00981, or A123456" autocomplete="off"
          onkeydown="if(event.key==='Enter'){event.preventDefault();fetchMemo();}">
      </div>
      ${memoFetchStatus==='loading'? `<p class="muted" style="font-size:12.5px;margin-top:8px;">Contacting HIS/Billing system…</p>`:''}
      ${memoFetchStatus==='error'? `<p style="color:var(--crimson);font-size:12.5px;margin-top:8px;">${escapeHtml(memoFetchError)}</p>`:''}
      ${session.user.role==='admin'? `<p class="muted" style="font-size:11.5px;margin-top:10px;">Testing the system? <a href="#" onclick="event.preventDefault();openCreateTestMemoModal();" style="color:var(--teal);">Create a test memo</a> with real patient and test fields, the way the HIS would send one.</p>`:''}
    </div>`;

  if(collectionOpenOrderId){
    let order;
    try{ order = await api.order(collectionOpenOrderId); collectionOpenOrder = order; }
    catch(e){ collectionOpenOrderId=null; collectionOpenOrder=null; showToast(e.message); return header + await renderCollectionQueue(f); }
    if(!order.sampleStatus && !wardsCache.length){ try{ wardsCache = await api.wards(); }catch(e){ wardsCache = []; } }
    return header + renderCollectionPanel(order, f);
  }

  if(memoSearchMatches && memoSearchMatches.length>1){
    const matchesHtml = `<div class="card">
      <h2>Multiple memos found</h2>
      <p class="muted" style="font-size:12.5px;margin-top:-6px;">More than one memo matched — select the right one.</p>
      ${memoSearchMatches.map(m=>`<div class="order-card" style="cursor:pointer;" onclick="loadMemoByNumber('${escapeHtml(m.memoNumber)}')">
        <div class="order-card-head">
          <div><span class="order-id">${escapeHtml(m.memoNumber)}</span> <span class="pill pill-grey">${escapeHtml(m.source)}</span> — ${escapeHtml(m.patientName)} <span class="muted">(Hospital No. ${escapeHtml(m.patientHospitalNumber||'—')})</span>
            <div class="muted" style="font-size:11.5px;">${(m.testCodes||[]).join(', ')} · Ordered by ${escapeHtml(m.orderedBy)}</div>
          </div>
        </div>
      </div>`).join('')}
    </div>`;
    return header + matchesHtml;
  }

  const [referralPending, queueHtml] = await Promise.all([api.orders('referral_pending'), renderCollectionQueue(f)]);
  return header + (referralPending.length ? renderReferralPendingBlock(referralPending, f) : '') + queueHtml;
}
async function renderCollectionQueue(f){
  const orders = await api.orders('pending_collection');
  const listHtml = orders.length ? orders.map(o=>{
    const p = o.patient;
    return `<div class="order-card" style="cursor:pointer;" onclick="collectionOpenOrderId='${o.id}';render();">
      <div class="order-card-head">
        <div><span class="order-id">${escapeHtml(o.memoNumber)}</span> <span class="pill pill-grey">${o.memoSource}</span>
          — ${escapeHtml(p?.name||'Unknown')} <span class="muted">(Hospital No. ${escapeHtml(p?.hospitalNumber||'—')})</span>
          <div class="muted" style="font-size:11.5px;">${o.tests.length} test(s) ordered · ${escapeHtml(o.orderedBy)} · ${fmtDate(o.createdAt)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="pill pill-grey">Awaiting Collection</span>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();cancelMemo('${o.id}',this)">Cancel</button>
        </div>
      </div>
    </div>`;
  }).join('') : `<div class="card empty">No memos awaiting collection — fetch one by number above.</div>`;
  return listHtml;
}
function renderReferralPendingBlock(orders, f){
  return `<div class="card">
    <h2>Collected — Referral Pending</h2>
    <p class="muted" style="font-size:12px;margin-top:-6px;">Higher-level tests are assigned and sent from here, right after collection — the receiving lab accepts them on arrival, so no local acceptance step is needed for these.</p>
    ${orders.map(o=>{
      const p = o.patient;
      const pending = o.tests.filter(t=>t.status==='awaiting_referral');
      return `<div class="order-card">
        <div class="order-card-head">
          <div><span class="order-id">${escapeHtml(o.memoNumber||o.id)}</span> — ${escapeHtml(p?.name||'Unknown')} <span class="muted">(Hospital No. ${escapeHtml(p?.hospitalNumber||'—')})</span></div>
          <span class="pill pill-purple">${pending.length} test(s) ready to refer</span>
        </div>
        ${pending.map(t=>{
          const spec = (o.specimens||[]).find(s=>s.id===t.specimenId);
          return `<div class="test-row"><span>${escapeHtml(t.name)} <span class="mono muted">(${t.code})</span></span><span class="mono muted" style="font-size:11px;">${spec?escapeHtml(spec.specimenNumber):''}</span></div>`;
        }).join('')}
        <div class="actions-row" style="margin-top:10px;">
          <button class="btn btn-teal" onclick="referOrder('${o.id}')">Refer these tests to the higher-level lab</button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}
function renderCollectionPanel(o, f){
  const p = o.patient;
  const header = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
      <div>
        <h2 style="margin-bottom:2px;">${escapeHtml(p?.name||'Unknown')}</h2>
        <div class="muted" style="font-size:12.5px;">Hospital No. ${escapeHtml(p?.hospitalNumber||'—')} · ID No. ${escapeHtml(p?.idNumber||'—')} · ${p?fmtAge(p.dob):'?'} (born ${fmtDob(p?.dob)}) · ${escapeHtml(SEX_LABELS[p?.sex]||p?.sex||'—')}<br>${escapeHtml(p?.address||'')}</div>
        <div class="muted" style="font-size:11.5px;margin-top:4px;">Memo ${escapeHtml(o.memoNumber)} (${o.memoSource}) · Ordered by ${escapeHtml(o.orderedBy)} · ${fmtDate(o.createdAt)}</div>
        ${o.sampleStatus? `<div class="muted" style="font-size:11.5px;">Collected by ${escapeHtml(o.collectedBy||'—')}, ${fmtDate(o.collectedAt)}</div>`:''}
      </div>
      <div style="display:flex;gap:8px;">
        ${!o.sampleStatus? `<button class="btn btn-danger btn-sm" data-memo="${escapeHtml(o.memoNumber)}" onclick="cancelMemo('${o.id}',this)">Cancel Memo</button>`:''}
        <button class="btn btn-outline btn-sm" onclick="collectionOpenOrderId=null;collectionOpenOrder=null;render();">← Back to list</button>
      </div>
    </div>`;

  if(!o.sampleStatus){
    // Not yet collected — selectable table, Collect Sample generates the barcodes.
    const statEligibleSelected = o.tests.filter(t=>test(t.code)?.isStat);
    return `<div class="card">${header}
      <div class="grid grid-2" style="margin-top:14px;">
        <div class="field" style="margin-bottom:0;"><label>Patient Type</label>
          <select id="f_patientType" onchange="document.getElementById('wardFieldWrap').style.display=this.value==='inpatient'?'block':'none';">
            <option value="outpatient">Out-Patient</option>
            <option value="inpatient">In-Patient</option>
          </select></div>
        <div class="field" id="wardFieldWrap" style="margin-bottom:0;display:none;"><label>Ward</label>
          <select id="f_ward">${wardsCache.map(w=>`<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('') || '<option value="">— no wards set up yet, see Settings —</option>'}</select></div>
      </div>
      ${statEligibleSelected.length? `<div class="field" style="margin-top:10px;">
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;">
          <input type="checkbox" id="f_statMode"> Mark as STAT
        </label>
        <p class="muted" style="font-size:11px;margin-top:2px;">Only applies to test(s) already marked STAT-eligible in the Test Catalog: ${statEligibleSelected.map(t=>escapeHtml(t.name)).join(', ')}. Other tests on this memo stay routine priority even if checked.</p>
      </div>`:''}
      <div class="field" style="margin-top:14px;">
        <label>Tests — selected by default; deselect any not being collected now</label>
        <div class="actions-row" style="margin-bottom:8px;">
          <button class="btn btn-outline btn-sm" onclick="document.querySelectorAll('input[name=collectTest]').forEach(cb=>cb.checked=true);">Select All</button>
          <button class="btn btn-outline btn-sm" onclick="document.querySelectorAll('input[name=collectTest]').forEach(cb=>cb.checked=false);">Deselect All</button>
        </div>
        <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;">
          <table>
            <thead><tr><th></th><th>Test Code</th><th>Test Name</th><th>Category</th><th>Sample Type</th></tr></thead>
            <tbody>
              ${o.tests.map(t=>{
                const tc = test(t.code);
                const ref = tc ? needsReferralClient(tc, f) : false;
                return `<tr>
                  <td><input type="checkbox" name="collectTest" value="${t.code}" checked></td>
                  <td class="mono">${t.code}</td>
                  <td>${escapeHtml(t.name)}${ref? `<div class="muted" style="font-size:11px;">Requires referral</div>`:''}${tc?.isStat? ` <span class="pill pill-crimson" style="font-size:10px;">STAT-eligible</span>`:''}</td>
                  <td>${escapeHtml(tc?.category||'—')}</td>
                  <td>${escapeHtml(tc?.specimenType||'—')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="field" style="margin-top:14px;border:1.5px solid var(--navy);border-radius:9px;padding:10px 12px;">
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;color:var(--text);font-size:13.5px;">
          <input type="checkbox" id="f_idConfirmed">
          <span>I have checked this patient's identity against <b>two identifiers</b> — name <b>${escapeHtml(p?.name||'—')}</b> and Hospital No. <b>${escapeHtml(p?.hospitalNumber||'—')}</b>${p?.dob?` (born ${fmtDob(p.dob)})`:''} — asked of the patient or read from the wristband.</span>
        </label>
      </div>
      <div class="actions-row"><button class="btn btn-teal" onclick="openPrintDialog()">Collect sample and print labels</button></div>
    </div>`;
  }

  // Already collected — read-only status view. Reprint existing labels, recollect anything
  // rejected, or collect anything newly added since (e.g. a reflex-suggested test).
  const rejectedTests = o.tests.filter(t=>t.status==='rejected');
  const newlyAddedTests = o.tests.filter(t=>t.status==='ordered');
  const activeSpecimens = (o.specimens||[]).filter(s=>s.status!=='rejected');
  const rows = o.tests.filter(t=>t.status!=='deselected').map(t=>{
    const tc = test(t.code);
    const spec = (o.specimens||[]).find(s=>s.id===t.specimenId);
    const meta = STATUS_META[t.visibleStatus||t.status] || {label:t.status, cls:'pill-grey'};
    return `<tr>
      <td class="mono">${t.code}</td>
      <td>${escapeHtml(t.name)}</td>
      <td>${escapeHtml(tc?.category||'—')}</td>
      <td>${escapeHtml(tc?.specimenType||'—')}</td>
      <td class="mono muted" style="font-size:11px;">${spec?escapeHtml(spec.specimenNumber):'—'}</td>
      <td><span class="pill ${meta.cls}">${meta.label}</span></td>
    </tr>`;
  }).join('');
  return `<div class="card">${header}
    <div class="field" style="margin-top:14px;">
      <label>Tests on this memo</label>
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;">
        <table>
          <thead><tr><th>Test Code</th><th>Test Name</th><th>Category</th><th>Sample Type</th><th>Specimen No.</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <div class="actions-row">
      ${activeSpecimens.length? `<button class="btn btn-teal" onclick="openReprintDialog()">Reprint Barcode</button>`:''}
      ${rejectedTests.length? `<button class="btn btn-danger" onclick="openRecollectDialog()">Recollect Rejected Test(s)</button>`:''}
      ${newlyAddedTests.length? `<button class="btn" onclick="openCollectAddedDialog()">Collect Added Test(s)</button>`:''}
    </div>
  </div>`;
}
// Client-side mirror of the backend's tier check, just for the "Requires referral" hint here —
// the backend is the actual source of truth for whether a test gets referred at collect time.
function needsReferralClient(tc, f){
  const TIER_RANK_CLIENT = {health_centre:1, atoll:2, regional:3};
  return TIER_RANK_CLIENT[f.tier] < TIER_RANK_CLIENT[tc.minTier];
}
/* ---------- Create Test Memo (Admin only) — for exercising the system without a real HIS ---------- */
let testMemoSearch = '';
let testMemoSelected = new Set();
function openCreateTestMemoModal(){
  testMemoSearch = '';
  testMemoSelected = new Set();
  renderCreateTestMemoModal();
}
function renderCreateTestMemoModal(){
  const q = testMemoSearch.trim().toLowerCase();
  const filtered = q ? catalogCache.filter(t=>(t.name||'').toLowerCase().includes(q) || (t.code||'').toLowerCase().includes(q)) : catalogCache;
  const suggestedMemoNumber = 'HIS-TEST-' + Math.floor(100000+Math.random()*900000);
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:560px;">
      <div class="modal-head"><h2>Create Test Memo</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <p class="muted" style="font-size:12.5px;margin-top:-6px;">Creates a memo in the mock HIS/Billing system, exactly like a real one — fetch it from Sample Collection afterward the normal way.</p>
      <div class="grid grid-2">
        <div class="field"><label>Memo Number</label><input id="tm_memoNumber" value="${suggestedMemoNumber}"></div>
        <div class="field"><label>Source</label><select id="tm_source"><option value="HIS">HIS</option><option value="Billing">Billing</option></select></div>
      </div>
      <div class="field"><label>Ordering Clinician</label><input id="tm_orderedBy" placeholder="e.g. Dr. Ibrahim Shaan"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0;">
      <div class="grid grid-2">
        <div class="field"><label>Patient Name</label><input id="tm_name" placeholder="e.g. Mohamed Rasheed"></div>
        <div class="field"><label>Sex</label><select id="tm_sex"><option value="M">Male</option><option value="F">Female</option></select></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>Hospital Number</label><input id="tm_hospitalNumber" placeholder="e.g. H-01452"></div>
        <div class="field"><label>ID Number</label><input id="tm_idNumber" placeholder="e.g. A234567"></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>Date of Birth</label><input id="tm_dob" type="date"></div>
        <div class="field"><label>Address</label><input id="tm_address" placeholder="e.g. Maalhos, Ari Atoll"></div>
      </div>
      <div class="field"><label>Tests <span class="muted" style="font-weight:400;">(${testMemoSelected.size} selected)</span></label>
        <input id="tm_test_search" value="${escapeHtml(testMemoSearch)}" placeholder="Search by name or code…" style="margin-bottom:8px;"
          oninput="testMemoSearch=this.value;renderCreateTestMemoModal();const el=document.getElementById('tm_test_search');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}">
        <div class="checklist">
          ${filtered.map(t=>`<label class="check-item" style="cursor:pointer;">
            <input type="checkbox" ${testMemoSelected.has(t.code)?'checked':''} onchange="toggleTestMemoTest('${t.code}',this.checked)">
            <span>${escapeHtml(t.name)} <span class="mono muted">(${t.code})</span></span>
          </label>`).join('') || '<p class="muted" style="padding:8px;">No matching tests.</p>'}
        </div>
      </div>
      <div class="actions-row"><button class="btn btn-teal" onclick="saveCreateTestMemo()">Create Memo</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
function toggleTestMemoTest(code, checked){
  if(checked) testMemoSelected.add(code); else testMemoSelected.delete(code);
}
async function saveCreateTestMemo(){
  const memoNumber = (document.getElementById('tm_memoNumber').value||'').trim();
  const source = document.getElementById('tm_source').value;
  const orderedBy = (document.getElementById('tm_orderedBy').value||'').trim();
  const name = (document.getElementById('tm_name').value||'').trim();
  const sex = document.getElementById('tm_sex').value;
  const hospitalNumber = (document.getElementById('tm_hospitalNumber').value||'').trim();
  const idNumber = (document.getElementById('tm_idNumber').value||'').trim();
  const dob = document.getElementById('tm_dob').value;
  const address = (document.getElementById('tm_address').value||'').trim();
  const tests = Array.from(testMemoSelected);

  if(!memoNumber){ showToast('Enter a memo number.'); return; }
  if(!orderedBy){ showToast('Enter the ordering clinician.'); return; }
  if(!name || !dob){ showToast('Patient name and date of birth are required.'); return; }
  if(!tests.length){ showToast('Select at least one test.'); return; }

  await withErrorToast(async ()=>{
    await api.seedHisMemo({
      memoNumber, source, orderedBy,
      patient: { name, idNumber, hospitalNumber, dob, sex, address },
      tests,
    });
    closeModal();
    const el = document.getElementById('memoFetchField');
    if(el){ el.value = memoNumber; el.focus(); }
    showToast(`Memo ${memoNumber} created — press Enter in the Memo Number field to fetch it.`);
  });
}

async function fetchMemo(){
  const el = document.getElementById('memoFetchField');
  const num = (el.value||'').trim();
  if(!num){ showToast('Enter or scan a memo number, Hospital No., or ID No.'); return; }
  memoFetchStatus = 'loading'; memoFetchError = ''; memoSearchMatches = null; await render();
  try{
    const { matches } = await api.searchHis(num);
    if(!matches.length){
      memoFetchStatus = 'error'; memoFetchError = `No memo found in the HIS/Billing system for "${num}".`;
      await render();
      const el2 = document.getElementById('memoFetchField'); if(el2){ el2.value = num; el2.focus(); }
      return;
    }
    if(matches.length===1){
      await loadMemoByNumber(matches[0].memoNumber);
      return;
    }
    memoFetchStatus = null; memoFetchError = '';
    memoSearchMatches = matches;
    await render();
  }catch(e){
    memoFetchStatus = 'error'; memoFetchError = e.message;
    await render();
    const el2 = document.getElementById('memoFetchField'); if(el2){ el2.value = num; el2.focus(); }
  }
}
async function loadMemoByNumber(memoNumber){
  memoFetchStatus = 'loading'; memoFetchError = ''; await render();
  try{
    const order = await api.importMemo(memoNumber);
    memoFetchStatus = null; memoFetchError = ''; memoSearchMatches = null;
    collectionOpenOrderId = order.id; collectionOpenOrder = order;
    await render();
    showToast(order.sampleStatus
      ? `Memo ${order.memoNumber} already collected — showing current status.`
      : `Memo ${order.memoNumber} fetched from ${order.memoSource} — proceed to collect.`);
  }catch(e){
    memoFetchStatus = 'error'; memoFetchError = e.message;
    await render();
  }
}
async function cancelMemo(orderId, btn){
  const name = (btn && btn.dataset && btn.dataset.memo) || itemNameFrom(btn);
  if(!await confirmAction({title:`Cancel this memo?`, body:`Memo <b>${escapeHtml(name||'')}</b> has not been collected. Cancelling removes it from the collection list; it can be fetched again from the HIS if it was cancelled by mistake.`, confirmLabel:`Cancel memo`})) return;
  await withErrorToast(async ()=>{
    await api.cancelMemo(orderId);
    if(collectionOpenOrderId===orderId){ collectionOpenOrderId=null; collectionOpenOrder=null; }
    await render();
    showToast('Memo cancelled.');
  });
}
// Groups selected tests by (Category, Specimen Type) — matching the backend exactly, since that's
// the same key used there to decide how many distinct barcode labels this collection requires.
function slugify(s){ return String(s).replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_+|_+$/g,'') || 'bottle'; }
function openPrintDialog(){
  const selected = Array.from(document.querySelectorAll('input[name="collectTest"]:checked')).map(el=>el.value);
  if(!selected.length){ showToast('Select at least one test to collect. To drop the whole memo, use Cancel Memo.', 'error'); return; }
  if(!document.getElementById('f_idConfirmed')?.checked){ showToast('Confirm the patient\'s identity (tick the box) before collecting.', 'error'); return; }
  const patientType = document.getElementById('f_patientType')?.value || 'outpatient';
  const wardEl = document.getElementById('f_ward');
  const wardId = (patientType==='inpatient' && wardEl) ? wardEl.value : null;
  if(patientType==='inpatient' && !wardId){ showToast('Select a ward for an in-patient.'); return; }
  const statMode = document.getElementById('f_statMode')?.checked || false;
  buildPendingCollect(selected, 'collect');
  pendingCollect.extra = { patientType, wardId, statMode };
  if(!Object.keys(pendingCollect.groups).length){ confirmCollectAndPrint(); return; } // nothing selected — skip straight to collect
  renderPrintDialog();
}
function buildPendingCollect(codes, mode){
  const groups = {}; // "category||bottleType" -> {category, bottleType, tests:[{code,name}]}
  codes.forEach(code=>{
    const tc = test(code);
    const category = (tc && tc.category && tc.category.trim()) ? tc.category.trim() : 'General';
    const bottleType = (tc && tc.specimenType && tc.specimenType.trim()) ? tc.specimenType.trim() : 'Unspecified Specimen';
    const key = `${category}||${bottleType}`;
    const testName = (collectionOpenOrder.tests.find(t=>t.code===code)||{}).name || code;
    (groups[key] = groups[key] || {category, bottleType, tests:[]}).tests.push({code, name: testName});
  });
  pendingCollect = { orderId: collectionOpenOrderId, selectedCodes: codes, groups, mode };
}
// Fixed-width right column (not flex-wrap) so the quantity input always lands in the same place,
// regardless of how long the category/bottle-type heading or specimen number happens to be.
function renderQtyRow(category, bottleType, specimenNumber, testsLine, inputId, qtyLabel){
  return `<div style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-top:1px dashed #EAEEF3;">
    <div style="flex:1;min-width:0;">
      <b>${escapeHtml(category)} — ${escapeHtml(bottleType)}</b>
      ${specimenNumber? `<div class="mono muted" style="font-size:11px;margin-top:2px;">${escapeHtml(specimenNumber)}</div>`:''}
      <div class="muted" style="font-size:11px;margin-top:2px;">${testsLine}</div>
    </div>
    <div style="flex:0 0 84px;">
      <label class="muted" style="font-size:11px;display:block;margin-bottom:4px;">${qtyLabel}</label>
      <input type="number" min="0" value="1" id="${inputId}" style="width:100%;">
    </div>
  </div>`;
}
function renderPrintDialog(){
  const { groups, mode } = pendingCollect;
  const isRecollect = mode==='recollect';
  const isCollectAdded = mode==='collect_added';
  const title = isRecollect? 'Recollect & Print' : isCollectAdded? 'Collect Added Test(s)' : 'Print Barcode Labels';
  const subtitle = isRecollect
    ? 'This generates a fresh barcode for the rejected test(s) — the original specimen record stays on file as rejected.'
    : isCollectAdded
      ? 'This generates a barcode for the newly added test(s), which have not been drawn yet.'
      : 'One barcode per Category + Specimen Type combination, based on each test\'s Test Catalog settings.';
  const rows = Object.keys(groups).sort().map(key=>{
    const { category, bottleType, tests } = groups[key];
    const testsLine = tests.map(t=>`${escapeHtml(t.name)} (${escapeHtml(t.code)})`).join(', ');
    return renderQtyRow(category, bottleType, null, testsLine, `qty_${slugify(key)}`, 'Labels to print');
  }).join('');
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:480px;">
      <div class="modal-head"><h2>${title}</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <p class="muted" style="font-size:12.5px;margin-top:-6px;">${subtitle} Set how many copies of each to print.</p>
      <div class="checklist" style="max-height:none;">${rows}</div>
      <div class="actions-row"><button class="btn btn-teal" onclick="confirmCollectAndPrint()">${title}</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function confirmCollectAndPrint(){
  const { orderId, selectedCodes, groups, mode } = pendingCollect;
  const quantities = {};
  Object.keys(groups).forEach(key=>{
    const el = document.getElementById(`qty_${slugify(key)}`);
    quantities[key] = el ? Math.max(0, parseInt(el.value,10)||0) : 1;
  });
  await withErrorToast(async ()=>{
    const usesRecollectEndpoint = mode==='recollect' || mode==='collect_added';
    const order = usesRecollectEndpoint ? await api.recollect(orderId, selectedCodes) : await api.collect(orderId, selectedCodes, pendingCollect.extra);
    collectionOpenOrderId = null; collectionOpenOrder = null;
    await render();
    printLabelsForOrder(order, groups, quantities);
    showToast(usesRecollectEndpoint ? 'Specimen(s) drawn and barcoded.' : `Sample collected — ${order.specimens.length} specimen(s) barcoded.`);
  });
}
// Looks up each group's barcode via the exact specimen a test now belongs to (not by category +
// bottle type alone) — important after a recollect, where an old rejected specimen and a brand new
// one can share the same category/bottle type, and a plain string match would risk grabbing the
// wrong (rejected) barcode.
function printLabelsForOrder(o, groups, quantities){
  const p = o.patient;
  const keys = Object.keys(groups);
  let labelsHtml = '';
  if(!keys.length){
    labelsHtml = `<p class="muted">No tests were selected — nothing to label.</p>`;
  }else{
    keys.sort().forEach(key=>{
      const { category, bottleType, tests } = groups[key];
      const firstTest = tests[0] ? o.tests.find(t=>t.code===tests[0].code) : null;
      const specimen = firstTest ? (o.specimens||[]).find(s=>s.id===firstTest.specimenId) : null;
      const specimenNumber = specimen ? specimen.specimenNumber : '—';
      const qty = quantities[key] ?? 1;
      const codes = tests.map(t=>t.code).join(', ');
      for(let i=0;i<qty;i++) labelsHtml += renderOneLabel(p, specimenNumber, category, bottleType, codes, specimen?.collectedAt);
    });
  }
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:420px;">
      <div class="modal-head"><h2>Sample Labels</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div id="labelPrintArea">${labelsHtml}</div>
      <p class="muted no-print" style="font-size:12px;margin-top:10px;">Code 128 barcode. Check the first printed label scans before sticking the rest.</p>
      <div class="actions-row no-print"><button class="btn" onclick="window.print()">Print Labels</button><button class="btn btn-outline" onclick="closeModal()">Close</button></div>
    </div>
  </div>`;
}
function renderOneLabel(p, specimenNumber, category, bottleType, codes, collectedAt){
  return `<div class="print-label" style="border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:10px;background:#fff;color:#000;">
    <div style="font-weight:700;font-size:13.5px;">${escapeHtml(p?.name||'Unknown')}</div>
    <div class="mono" style="font-size:12px;">Hosp. No. ${escapeHtml(p?.hospitalNumber||'—')} · ${p?.dob?`${fmtDob(p.dob)} (${fmtAge(p.dob)})`:'DOB —'} · ${escapeHtml(p?.sex||'—')}</div>
    <div style="font-size:12px;font-weight:600;margin-top:4px;">${escapeHtml(category)} — ${escapeHtml(bottleType)}</div>
    <div style="font-size:11.5px;margin:2px 0 6px;">${escapeHtml(codes)||'—'}</div>
    ${barcodeSvg(specimenNumber)}
    <div class="mono" style="text-align:center;font-size:12.5px;letter-spacing:1px;margin-top:2px;">${escapeHtml(specimenNumber)}</div>
    <div style="font-size:10.5px;text-align:center;margin-top:2px;">Collected ${fmtDate(collectedAt||new Date())}</div>
  </div>`;
}

/* ---------- Reprint (no data change) and Recollect (rejected tests only) ---------- */
function openReprintDialog(){
  const o = collectionOpenOrder;
  const activeSpecimens = (o.specimens||[]).filter(s=>s.status!=='rejected');
  if(!activeSpecimens.length){ showToast('No active specimens to reprint.'); return; }
  const groups = {};
  activeSpecimens.forEach(s=>{
    const tests = o.tests.filter(t=>t.specimenId===s.id).map(t=>({code:t.code, name:t.name}));
    groups[s.id] = { category:s.category, bottleType:s.bottleType, tests, specimenNumber:s.specimenNumber, collectedAt:s.collectedAt };
  });
  pendingReprintGroups = groups;
  const rows = Object.keys(groups).sort().map(key=>{
    const { category, bottleType, tests, specimenNumber } = groups[key];
    const testsLine = tests.map(t=>`${escapeHtml(t.name)} (${escapeHtml(t.code)})`).join(', ');
    return renderQtyRow(category, bottleType, specimenNumber, testsLine, `rqty_${slugify(key)}`, 'Copies');
  }).join('');
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:480px;">
      <div class="modal-head"><h2>Reprint Barcode Labels</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <p class="muted" style="font-size:12.5px;margin-top:-6px;">Nothing is recorded by reprinting — the original collection time and staff stay exactly as they are.</p>
      <div class="checklist" style="max-height:none;">${rows}</div>
      <div class="actions-row"><button class="btn btn-teal" onclick="confirmReprint()">Print</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
function confirmReprint(){
  const groups = pendingReprintGroups;
  const p = collectionOpenOrder.patient;
  let labelsHtml = '';
  Object.keys(groups).sort().forEach(key=>{
    const { category, bottleType, tests, specimenNumber, collectedAt } = groups[key];
    const el = document.getElementById(`rqty_${slugify(key)}`);
    const qty = el ? Math.max(0, parseInt(el.value,10)||0) : 1;
    const codes = tests.map(t=>t.code).join(', ');
    for(let i=0;i<qty;i++) labelsHtml += renderOneLabel(p, specimenNumber, category, bottleType, codes, collectedAt);
  });
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:420px;">
      <div class="modal-head"><h2>Sample Labels (Reprint)</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div id="labelPrintArea">${labelsHtml}</div>
      <div class="actions-row no-print"><button class="btn" onclick="window.print()">Print Labels</button><button class="btn btn-outline" onclick="closeModal()">Close</button></div>
    </div>
  </div>`;
}
function openRecollectDialog(){
  const rejected = collectionOpenOrder.tests.filter(t=>t.status==='rejected');
  if(!rejected.length){ showToast('Nothing rejected to recollect.'); return; }
  buildPendingCollect(rejected.map(t=>t.code), 'recollect');
  renderPrintDialog();
}
function openCollectAddedDialog(){
  const added = collectionOpenOrder.tests.filter(t=>t.status==='ordered');
  if(!added.length){ showToast('Nothing newly added to collect.'); return; }
  buildPendingCollect(added.map(t=>t.code), 'collect_added');
  renderPrintDialog();
}
async function referOrder(orderId){
  await withErrorToast(async ()=>{
    const result = await api.refer(orderId);
    await render();
    showToast(`Referred to ${result.referredTo.join(' & ')} — same order, no duplicate created. Only these test(s) become visible there.`);
  });
}

