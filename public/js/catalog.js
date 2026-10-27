/* ---------- Test Categories (Regional admin only — controls barcode letters) ---------- */
function viewCategories(){
  if(!isRegional()) return `<div class="card empty">Only the Regional Hospital Laboratory manages test categories.</div>`;
  const rows = categoriesCache.map(c=>{
    const inUse = catalogCache.filter(t=>t.category===c.name).length;
    return `<tr>
      <td class="mono" style="font-weight:700;font-size:15px;">${escapeHtml(c.letter)}</td>
      <td>${escapeHtml(c.name)}</td>
      <td>${inUse} test(s)</td>
      <td style="white-space:nowrap;"><button class="btn btn-outline btn-sm" onclick="openCategoryModal('${c.id}')">Edit</button> <button class="btn btn-danger btn-sm" onclick="deleteCategory('${c.id}',this)">Delete</button></td>
    </tr>`;
  }).join('');
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:center;">
      <div><h1>Test Categories</h1><p>Each category's letter becomes the first character of every specimen barcode generated for it (e.g. Hematology → H268271001). Move a test between categories by editing it in the Test Catalog.</p></div>
      <button class="btn" onclick="openCategoryModal()">+ New Category</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>Letter</th><th>Category</th><th>Tests</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" class="empty">No categories defined yet.</td></tr>`}</tbody></table>
    </div>
  `;
}
function openCategoryModal(id){
  const existing = id ? categoriesCache.find(c=>c.id===id) : null;
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:420px;">
      <div class="modal-head"><h2>${existing?'Edit Category':'New Category'}</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="field"><label>Category Name</label><input id="cat_name" value="${escapeHtml(existing?.name||'')}" placeholder="e.g. Immunology"></div>
      <div class="field"><label>Barcode Letter</label><input id="cat_letter" maxlength="1" style="text-transform:uppercase;max-width:80px;" value="${escapeHtml(existing?.letter||'')}" placeholder="e.g. I"></div>
      <p class="muted" style="font-size:11.5px;">Must be a single letter not already used by another category.</p>
      <div class="actions-row"><button class="btn" onclick="saveCategory(${existing?`'${existing.id}'`:'null'})">Save Category</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function saveCategory(id){
  const name = (document.getElementById('cat_name').value||'').trim();
  const letter = (document.getElementById('cat_letter').value||'').trim();
  if(!name){ showToast('Enter a category name.'); return; }
  await withErrorToast(async ()=>{
    if(id) await api.updateCategory(id, {name, letter});
    else await api.createCategory({name, letter});
    categoriesCache = await api.categories();
    closeModal(); await render();
    showToast(`Category "${name}" saved.`);
  });
}
async function deleteCategory(id, btn){
  const name = itemNameFrom(btn);
  if(!await confirmAction({title:`Delete this category?`, body:`<b>${escapeHtml(name||'This category')}</b> will be deleted. Tests in it must be moved to another category first.`, confirmLabel:`Delete category`})) return;
  await withErrorToast(async ()=>{
    await api.deleteCategory(id);
    categoriesCache = await api.categories();
    await render();
  });
}

/* ---------- Test Panels (manage_catalog) — organizational bundles, e.g. "Renal Panel" ---------- */
async function viewPanels(){
  const panels = await api.testPanels();
  const rows = panels.map(p=>`<tr>
    <td>${escapeHtml(p.name)}</td>
    <td>${p.testCodes.map(c=>`<span class="mono muted">${escapeHtml(c)}</span>`).join(', ')}</td>
    <td style="white-space:nowrap;"><button class="btn btn-outline btn-sm" onclick="openPanelModal('${p.id}')">Edit</button> <button class="btn btn-danger btn-sm" onclick="deletePanel('${p.id}',this)">Delete</button></td>
  </tr>`).join('');
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:center;">
      <div><h1>Test Panels</h1><p>Named bundles of tests (e.g. "Renal Panel") for organizing the Test Catalog and Sample Collection display. Orders still arrive from the HIS as individual test codes — a panel doesn't change how an order is built.</p></div>
      <button class="btn" onclick="openPanelModal()">+ New Panel</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>Name</th><th>Tests</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="empty">No panels defined yet.</td></tr>`}</tbody></table>
    </div>
  `;
}
let panelModalSearch = '';
let panelModalSelected = new Set();
let panelModalEditing = null;
async function openPanelModal(id){
  const panels = id ? await api.testPanels() : [];
  panelModalEditing = id ? panels.find(p=>p.id===id) : null;
  panelModalSearch = '';
  panelModalSelected = new Set(panelModalEditing ? panelModalEditing.testCodes : []);
  renderPanelModalBody();
}
function renderPanelModalBody(){
  const existing = panelModalEditing;
  const q = panelModalSearch.trim().toLowerCase();
  const filtered = q ? catalogCache.filter(t=>(t.name||'').toLowerCase().includes(q) || (t.code||'').toLowerCase().includes(q)) : catalogCache;
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:460px;">
      <div class="modal-head"><h2>${existing?'Edit Panel':'New Panel'}</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="field"><label>Panel Name</label><input id="panel_name" value="${escapeHtml(existing?.name||'')}" placeholder="e.g. Renal Panel"></div>
      <div class="field"><label>Tests <span class="muted" style="font-weight:400;">(${panelModalSelected.size} selected)</span></label>
        <input id="panel_test_search" value="${escapeHtml(panelModalSearch)}" placeholder="Search by name or code…" style="margin-bottom:8px;"
          oninput="panelModalSearch=this.value;renderPanelModalBody();const el=document.getElementById('panel_test_search');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}">
        <div class="checklist">
          ${filtered.map(t=>`<label class="check-item" style="cursor:pointer;">
            <input type="checkbox" ${panelModalSelected.has(t.code)?'checked':''} onchange="togglePanelTest('${t.code}',this.checked)">
            <span>${escapeHtml(t.name)} <span class="mono muted">(${t.code})</span></span>
          </label>`).join('') || '<p class="muted" style="padding:8px;">No matching tests.</p>'}
        </div>
      </div>
      <div class="actions-row"><button class="btn" onclick="savePanel(${existing?`'${existing.id}'`:'null'})">Save Panel</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
function togglePanelTest(code, checked){
  if(checked) panelModalSelected.add(code); else panelModalSelected.delete(code);
}
async function savePanel(id){
  const name = (document.getElementById('panel_name').value||'').trim();
  const testCodes = Array.from(panelModalSelected);
  if(!name || !testCodes.length){ showToast('Enter a name and select at least one test.'); return; }
  await withErrorToast(async ()=>{
    if(id) await api.updateTestPanel(id, {name, testCodes});
    else await api.createTestPanel({name, testCodes});
    closeModal(); await render();
    showToast('Panel saved.');
  });
}
async function deletePanel(id, btn){
  const name = itemNameFrom(btn);
  if(!await confirmAction({title:`Delete this panel?`, body:`<b>${escapeHtml(name||'This panel')}</b> will be deleted. The tests in it stay in the catalog.`, confirmLabel:`Delete panel`})) return;
  await withErrorToast(async ()=>{ await api.deleteTestPanel(id); await render(); });
}

/* ---------- HIS Code Aliases (manage_catalog) ---------- */
async function viewAliases(){
  const aliases = await api.testAliases();
  const q = aliasSearch.trim().toLowerCase();
  const filtered = q ? aliases.filter(a=>
    (a.hisCode||'').toLowerCase().includes(q) || (a.internalCode||'').toLowerCase().includes(q) ||
    (test(a.internalCode)?.name||'').toLowerCase().includes(q)
  ) : aliases;
  const rows = filtered.map(a=>`<tr>
    <td class="mono">${escapeHtml(a.hisCode)}</td>
    <td class="mono">${escapeHtml(a.internalCode)}</td>
    <td>${escapeHtml(test(a.internalCode)?.name||'—')}</td>
    <td><button class="btn btn-danger btn-sm" onclick="deleteAlias('${a.id}',this)">Delete</button></td>
  </tr>`).join('');
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:center;">
      <div><h1>HIS Code Aliases</h1><p>If a memo arrives with a test code that doesn't match the catalog exactly, it's mapped here to the correct internal code — otherwise it becomes an unrecognized test with no category or specimen type.</p></div>
      <button class="btn" onclick="openAliasModal()">+ New Alias</button>
    </div>
    <div class="card">
      <div class="field" style="max-width:360px;margin-bottom:0;"><label>Search by HIS code, internal code, or test name</label>
        <input id="aliasSearchField" value="${escapeHtml(aliasSearch)}" placeholder="Type to filter…"
          oninput="aliasSearch=this.value;renderCached();const el=document.getElementById('aliasSearchField');if(el)el.focus();"></div>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>HIS Code</th><th>Internal Code</th><th>Maps To</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" class="empty">${q?'No matching aliases.':'No aliases defined yet.'}</td></tr>`}</tbody></table>
    </div>
  `;
}
function openAliasModal(){
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:420px;">
      <div class="modal-head"><h2>New Alias</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="field"><label>HIS/Billing Code (as it arrives on the memo)</label><input id="alias_his" placeholder="e.g. GLUC-F"></div>
      <div class="field"><label>Internal Catalog Code</label>
        <select id="alias_internal">${catalogCache.map(t=>`<option value="${t.code}">${escapeHtml(t.name)} (${t.code})</option>`).join('')}</select>
      </div>
      <div class="actions-row"><button class="btn" onclick="saveAlias()">Save Alias</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function saveAlias(){
  const hisCode = (document.getElementById('alias_his').value||'').trim();
  const internalCode = document.getElementById('alias_internal').value;
  if(!hisCode){ showToast('Enter the HIS code.'); return; }
  await withErrorToast(async ()=>{
    await api.createTestAlias({hisCode, internalCode});
    closeModal(); await render();
    showToast('Alias saved.');
  });
}
async function deleteAlias(id, btn){
  const name = itemNameFrom(btn);
  if(!await confirmAction({title:`Delete this HIS alias?`, body:`HIS code <b>${escapeHtml(name||'')}</b> will no longer be matched to a catalog test. A memo using it will arrive with an unrecognised test.`, confirmLabel:`Delete alias`})) return;
  await withErrorToast(async ()=>{ await api.deleteTestAlias(id); await render(); });
}

/* ---------- Reflex Rules (manage_catalog) — suggestion only, never auto-orders ---------- */
const REFLEX_CONDITIONS = ['>','<','>=','<=','=='];
async function viewReflexRules(){
  const rules = await api.reflexRules();
  const rows = rules.map(r=>`<tr>
    <td>${escapeHtml(r.name)}</td>
    <td class="mono">${escapeHtml(r.triggerTestCode)} ${escapeHtml(r.condition)} ${r.thresholdValue}</td>
    <td class="mono">${escapeHtml(r.resultTestCode)}</td>
    <td><label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
      <input type="checkbox" ${r.enabled?'checked':''} onchange="toggleReflexRule('${r.id}', this.checked)"> ${r.enabled?'Enabled':'Disabled'}
    </label></td>
    <td><button class="btn btn-danger btn-sm" onclick="deleteReflexRule('${r.id}',this)">Delete</button></td>
  </tr>`).join('');
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:center;">
      <div><h1>Reflex Rules</h1><p>"If [test] is [condition] [value], suggest adding [test]." Never orders anything automatically — the certifying staff member sees the suggestion and adds it with one click if they agree.</p></div>
      <button class="btn" onclick="openReflexRuleModal()">+ New Rule</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>Name</th><th>If</th><th>Suggest</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="empty">No reflex rules defined yet.</td></tr>`}</tbody></table>
    </div>
  `;
}
function openReflexRuleModal(){
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:460px;">
      <div class="modal-head"><h2>New Reflex Rule</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="field"><label>Rule Name</label><input id="reflex_name" placeholder="e.g. High glucose → suggest HbA1c"></div>
      <div class="field"><label>If this test's result...</label>
        <select id="reflex_trigger">${catalogCache.map(t=>`<option value="${t.code}">${escapeHtml(t.name)} (${t.code})</option>`).join('')}</select>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>Condition</label>
          <select id="reflex_condition">${REFLEX_CONDITIONS.map(c=>`<option value="${c}">${c}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Value</label><input id="reflex_threshold" type="number" step="any" placeholder="e.g. 200"></div>
      </div>
      <div class="field"><label>...suggest adding this test</label>
        <select id="reflex_result">${catalogCache.map(t=>`<option value="${t.code}">${escapeHtml(t.name)} (${t.code})</option>`).join('')}</select>
      </div>
      <div class="actions-row"><button class="btn" onclick="saveReflexRule()">Save Rule</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function saveReflexRule(){
  const name = (document.getElementById('reflex_name').value||'').trim();
  const triggerTestCode = document.getElementById('reflex_trigger').value;
  const condition = document.getElementById('reflex_condition').value;
  const thresholdValue = document.getElementById('reflex_threshold').value;
  const resultTestCode = document.getElementById('reflex_result').value;
  if(!name || thresholdValue===''){ showToast('Fill in the rule name and threshold value.'); return; }
  if(triggerTestCode===resultTestCode){ showToast('The trigger test and suggested test must be different.'); return; }
  await withErrorToast(async ()=>{
    await api.createReflexRule({name, triggerTestCode, condition, thresholdValue: parseFloat(thresholdValue), resultTestCode});
    closeModal(); await render();
    showToast('Reflex rule saved.');
  });
}
async function toggleReflexRule(id, enabled){
  await withErrorToast(async ()=>{
    await api.updateReflexRule(id, {enabled});
    await render();
    showToast(`Rule ${enabled?'enabled':'disabled'}.`);
  });
}
async function deleteReflexRule(id, btn){
  const name = itemNameFrom(btn);
  if(!await confirmAction({title:`Delete this reflex rule?`, body:`<b>${escapeHtml(name||'This rule')}</b> will be deleted and will no longer be suggested at validation. To pause it instead, untick Enabled.`, confirmLabel:`Delete rule`})) return;
  await withErrorToast(async ()=>{ await api.deleteReflexRule(id); await render(); });
}

/* ---------- Organisms (manage_catalog) — microbiology master data ---------- */
async function viewOrganisms(){
  organismsCache = await api.organisms();
  const q = organismSearch.trim().toLowerCase();
  const filtered = q ? organismsCache.filter(o=>(o.name||'').toLowerCase().includes(q) || (o.group||'').toLowerCase().includes(q)) : organismsCache;
  const rows = filtered.map(o=>`<tr>
    <td>${escapeHtml(o.name)}</td>
    <td class="muted">${escapeHtml(o.group||'—')}</td>
    <td style="white-space:nowrap;"><button class="btn btn-outline btn-sm" onclick="openOrganismPanelModal('${o.id}')">Antibiotic Panel</button> <button class="btn btn-danger btn-sm" onclick="deleteOrganism('${o.id}',this)">Delete</button></td>
  </tr>`).join('');
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:center;">
      <div><h1>Organisms</h1><p>Microbiology organism master list, used when entering a culture result. Each organism can have its own standard antibiotic sensitivity panel.</p></div>
      <button class="btn" onclick="openOrganismModal()">+ New Organism</button>
    </div>
    <div class="card">
      <div class="field" style="max-width:360px;margin-bottom:0;"><label>Search by name or group</label>
        <input id="organismSearchField" value="${escapeHtml(organismSearch)}" placeholder="Type to filter…"
          oninput="organismSearch=this.value;renderCached();const el=document.getElementById('organismSearchField');if(el)el.focus();"></div>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>Name</th><th>Group</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="empty">${q?'No matching organisms.':'No organisms defined yet.'}</td></tr>`}</tbody></table>
    </div>
  `;
}
function openOrganismModal(){
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:420px;">
      <div class="modal-head"><h2>New Organism</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="field"><label>Name</label><input id="org_name" placeholder="e.g. Escherichia coli"></div>
      <div class="field"><label>Group (optional)</label><input id="org_group" placeholder="e.g. GNB (gram negative bacilli)"></div>
      <div class="actions-row"><button class="btn" onclick="saveOrganism()">Save</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function saveOrganism(){
  const name = (document.getElementById('org_name').value||'').trim();
  const group = (document.getElementById('org_group').value||'').trim();
  if(!name){ showToast('Enter a name.'); return; }
  await withErrorToast(async ()=>{
    await api.createOrganism({name, group: group||null});
    closeModal(); await render();
    showToast('Organism saved.');
  });
}
async function deleteOrganism(id, btn){
  const name = itemNameFrom(btn);
  if(!await confirmAction({title:`Delete this organism?`, body:`<b>${escapeHtml(name||'This organism')}</b> and its antibiotic panel will be deleted from the list offered at culture entry.`, confirmLabel:`Delete organism`})) return;
  await withErrorToast(async ()=>{ await api.deleteOrganism(id); await render(); });
}
async function openOrganismPanelModal(organismId){
  if(!antibioticsCache.length) antibioticsCache = await api.antibiotics();
  const panel = await api.organismPanel(organismId);
  const selectedIds = new Set(panel.map(p=>p.antibioticId));
  const organism = organismsCache.find(o=>o.id===organismId);
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:460px;">
      <div class="modal-head"><h2>${escapeHtml(organism?.name||'')} — Antibiotic Panel</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <p class="muted" style="font-size:12.5px;margin-top:-6px;">These are the antibiotics offered by default when this organism is selected during culture result entry.</p>
      <div class="checklist">
        ${antibioticsCache.map(a=>`<label class="check-item" style="cursor:pointer;">
          <input type="checkbox" name="panelAb" value="${a.id}" ${selectedIds.has(a.id)?'checked':''}>
          <span>${escapeHtml(a.name)}</span>
        </label>`).join('') || '<p class="muted">No antibiotics defined yet — add some under Settings → Antibiotics first.</p>'}
      </div>
      <div class="actions-row"><button class="btn" onclick="saveOrganismPanel('${organismId}')">Save Panel</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function saveOrganismPanel(organismId){
  const antibioticIds = Array.from(document.querySelectorAll('input[name="panelAb"]:checked')).map(el=>el.value);
  await withErrorToast(async ()=>{
    await api.updateOrganismPanel(organismId, antibioticIds);
    closeModal();
    showToast('Antibiotic panel saved.');
  });
}

/* ---------- Antibiotics (manage_catalog) ---------- */
async function viewAntibiotics(){
  antibioticsCache = await api.antibiotics();
  const q = antibioticSearch.trim().toLowerCase();
  const filtered = q ? antibioticsCache.filter(a=>(a.name||'').toLowerCase().includes(q)) : antibioticsCache;
  const rows = filtered.map(a=>`<tr>
    <td>${escapeHtml(a.name)}</td>
    <td><button class="btn btn-danger btn-sm" onclick="deleteAntibiotic('${a.id}',this)">Delete</button></td>
  </tr>`).join('');
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:center;">
      <div><h1>Antibiotics</h1><p>Antibiotic master list, used to build each organism's sensitivity panel.</p></div>
      <button class="btn" onclick="openAntibioticModal()">+ New Antibiotic</button>
    </div>
    <div class="card">
      <div class="field" style="max-width:360px;margin-bottom:0;"><label>Search by name</label>
        <input id="antibioticSearchField" value="${escapeHtml(antibioticSearch)}" placeholder="Type to filter…"
          oninput="antibioticSearch=this.value;renderCached();const el=document.getElementById('antibioticSearchField');if(el)el.focus();"></div>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>Name</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="2" class="empty">${q?'No matching antibiotics.':'No antibiotics defined yet.'}</td></tr>`}</tbody></table>
    </div>
  `;
}
function openAntibioticModal(){
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:380px;">
      <div class="modal-head"><h2>New Antibiotic</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="field"><label>Name</label><input id="ab_name" placeholder="e.g. Amikacin"></div>
      <div class="actions-row"><button class="btn" onclick="saveAntibiotic()">Save</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function saveAntibiotic(){
  const name = (document.getElementById('ab_name').value||'').trim();
  if(!name){ showToast('Enter a name.'); return; }
  await withErrorToast(async ()=>{
    await api.createAntibiotic({name});
    closeModal(); await render();
    showToast('Antibiotic saved.');
  });
}
async function deleteAntibiotic(id, btn){
  const name = itemNameFrom(btn);
  if(!await confirmAction({title:`Delete this antibiotic?`, body:`<b>${escapeHtml(name||'This antibiotic')}</b> will be deleted and removed from every organism's panel.`, confirmLabel:`Delete antibiotic`})) return;
  await withErrorToast(async ()=>{ await api.deleteAntibiotic(id); await render(); });
}

/* ---------- Rejection Reasons (manage_catalog) — standardized specimen rejection wording ---------- */
async function viewRejectionReasons(){
  const reasons = await api.rejectionReasons();
  const rows = reasons.map(r=>`<tr>
    <td>${escapeHtml(r.name)}</td>
    <td><button class="btn btn-danger btn-sm" onclick="deleteRejectionReason('${r.id}',this)">Delete</button></td>
  </tr>`).join('');
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:center;">
      <div><h1>Rejection Reasons</h1><p>The standard list offered when rejecting a specimen, at Sample Acceptance or on arrival at a receiving lab — keeps wording consistent across every facility, and makes rejection patterns reportable.</p></div>
      <button class="btn" onclick="openRejectionReasonModal()">+ New Reason</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>Reason</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="2" class="empty">No reasons defined yet — only "Other" (with a required explanation) is offered until at least one exists.</td></tr>`}</tbody></table>
    </div>
  `;
}
function openRejectionReasonModal(){
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:380px;">
      <div class="modal-head"><h2>New Rejection Reason</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="field"><label>Reason</label><input id="rr_name" placeholder="e.g. Hemolyzed"></div>
      <div class="actions-row"><button class="btn" onclick="saveRejectionReason()">Save</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function saveRejectionReason(){
  const name = (document.getElementById('rr_name').value||'').trim();
  if(!name){ showToast('Enter a reason.'); return; }
  await withErrorToast(async ()=>{
    await api.createRejectionReason(name);
    closeModal(); await render();
    showToast('Rejection reason saved.');
  });
}
async function deleteRejectionReason(id, btn){
  const name = itemNameFrom(btn);
  if(!await confirmAction({title:`Delete this rejection reason?`, body:`<b>${escapeHtml(name||'This reason')}</b> will no longer be offered when rejecting a specimen. Past rejections keep their wording.`, confirmLabel:`Delete reason`})) return;
  await withErrorToast(async ()=>{ await api.deleteRejectionReason(id); await render(); });
}

/* ---------- Connection (read-only, Regional admin only) ---------- */
async function viewConnection(){
  let health = null, healthError = '';
  try{ health = await apiRequest('/health', {auth:false}); }
  catch(e){ healthError = e.message; }
  let detected = null, detectError = '';
  try{ detected = await api.detectFacility(); }
  catch(e){ detectError = e.message; }
  return `
    <div class="card">
      <h2>Backend Connection</h2>
      <p class="muted" style="font-size:12.5px;">This is informational only — the app connects to its backend automatically and this isn't meant to be changed during normal use.</p>
      <div class="field"><label>API Base URL</label><input value="${escapeHtml(API_BASE)}" readonly style="background:#F7F9FB;color:var(--mute);"></div>
      <div class="field"><label>Status</label>
        ${health? `<span class="pill pill-teal">Connected — ${escapeHtml(health.service||'OK')}</span>` : `<span class="pill pill-crimson">Unreachable — ${escapeHtml(healthError)}</span>`}
      </div>
      <button class="btn btn-outline btn-sm" onclick="render()">Re-check</button>
    </div>
    <div class="card">
      <h2>Network → Facility Resolution</h2>
      <p class="muted" style="font-size:12.5px;">What this device's current network resolves to at login — same check the login screen uses. Manage the mappings under Settings → Network Mapping.</p>
      <div class="field"><label>Detected Facility</label>
        ${detectError? `<span class="pill pill-crimson">Could not check — ${escapeHtml(detectError)}</span>`
          : detected && detected.facilityId
            ? `<span class="pill pill-teal">${escapeHtml(detected.facilityName)}</span>`
            : `<span class="pill pill-amber">No facility mapped to this network — manual picker shown at login</span>`}
      </div>
      ${detected && detected.ip? `<div class="field"><label>Detected IP</label><input value="${escapeHtml(detected.ip)}" readonly style="background:#F7F9FB;color:var(--mute);"></div>`:''}
    </div>
  `;
}

/* ---------- Test Catalog ---------- */
function viewCatalog(){
  const editable = isRegional();
  const q = catalogSearch.trim().toLowerCase();
  const filtered = catalogCache.filter(t=>{
    const matchesQ = !q || (t.code||'').toLowerCase().includes(q) || (t.name||'').toLowerCase().includes(q) ||
      (t.category||'').toLowerCase().includes(q) || (t.specimenType||'').toLowerCase().includes(q);
    const matchesCat = !catalogCategoryFilter || t.category === catalogCategoryFilter;
    return matchesQ && matchesCat;
  });
  const rows = filtered.map(t=>`
    <tr>
      <td class="mono">${escapeHtml(t.code)}</td>
      <td>${escapeHtml(t.name)}${t.isStat? ` <span class="pill pill-crimson" style="font-size:10px;">STAT</span>`:''}<div class="muted" style="font-size:11.5px;">${escapeHtml(t.specimenType||'')}</div></td>
      <td>${escapeHtml(t.category)} <span class="mono muted" style="font-size:11px;">(${escapeHtml((categoriesCache.find(c=>c.name===t.category)||{}).letter||'?')})</span></td>
      <td>${escapeHtml(t.method||'')}</td>
      <td class="mono">${escapeHtml(t.units||'')}</td>
      <td><span class="tier-badge ${TIER_CLASS[t.minTier]}">${TIER_SHORT[t.minTier]}</span></td>
      <td>${(t.refRanges||[]).length} range(s)</td>
      <td>${t.tat}h</td>
      <td style="white-space:nowrap;">${editable? `<button class="btn btn-outline btn-sm" onclick="openTestModal('${t.code}')">Edit</button> <button class="btn btn-danger btn-sm" onclick="deleteTest('${t.code}',this)">Delete</button>` : `<span class="muted" style="font-size:11.5px;">Read-only</span>`}</td>
    </tr>`).join('');
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:center;">
      <div><h1>Test Catalog</h1><p>${editable? 'Define test codes, parameters, methods, reference ranges and reporting comments — standardised across every lab in the network.' : `Centrally managed by the Regional Hospital. Atoll Hospitals and Health Centres use this catalog to place orders but cannot edit it.`}</p></div>
      ${editable? `<button class="btn" onclick="openTestModal()">+ New Test</button>` : ''}
    </div>
    <div class="card">
      <div class="grid grid-2">
        <div class="field" style="margin-bottom:0;"><label>Search by code, name, category, or specimen type</label>
          <input id="catalogSearchField" value="${escapeHtml(catalogSearch)}" placeholder="Type to filter…"
            oninput="catalogSearch=this.value;renderCached();const el=document.getElementById('catalogSearchField');if(el)el.focus();"></div>
        <div class="field" style="margin-bottom:0;"><label>Category</label>
          <select onchange="catalogCategoryFilter=this.value;renderCached();">
            <option value="">All categories</option>
            ${categoriesCache.map(c=>`<option value="${escapeHtml(c.name)}" ${catalogCategoryFilter===c.name?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
          </select></div>
      </div>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table>
        <thead><tr><th>Code</th><th>Test / Specimen</th><th>Category</th><th>Method</th><th>Units</th><th>Min. Facility Level</th><th>Ref. Ranges</th><th>TAT</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="9" class="empty">${q||catalogCategoryFilter?'No matching tests.':'No tests defined yet.'}</td></tr>`}</tbody>
      </table>
    </div>
  `;
}
let draftTest = null;
function openTestModal(code){
  const existing = code ? test(code) : null;
  draftTest = existing ? JSON.parse(JSON.stringify(existing)) : {
    code:'', name:'', category:'', specimenType:'', method:'', units:'', tat:24,
    minTier:'health_centre', criticalLow:null, criticalHigh:null, comment:'',
    refRanges:[{sex:'Any', ageMin:0, ageMax:150, ageUnit:'Y', low:'', high:''}]
  };
  document.getElementById('modalRoot').innerHTML = testModalHtml(!!existing);
}
function testModalHtml(isEdit){
  const t = draftTest;
  return `
  <div class="modal-overlay">
    <div class="modal">
      <div class="modal-head"><h2>${isEdit? 'Edit Test':'New Test'}</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="grid grid-2">
        <div class="field"><label>Test Code</label><input id="f_code" value="${escapeHtml(t.code)}" ${isEdit?'disabled':''} placeholder="Test code"></div>
        <div class="field"><label>Test Name</label><input id="f_name" value="${escapeHtml(t.name)}" placeholder="e.g. LDL Cholesterol"></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>Category</label>
          <select id="f_category">${categoriesCache.map(c=>`<option value="${escapeHtml(c.name)}" ${t.category===c.name?'selected':''}>${escapeHtml(c.name)} (${escapeHtml(c.letter)})</option>`).join('') || '<option value="">— add a category first, in Settings → Categories —</option>'}</select>
        </div>
        <div class="field"><label>Specimen Type</label><input id="f_specimen" value="${escapeHtml(t.specimenType||'')}" placeholder="e.g. Serum"></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>Test Method</label><input id="f_method" value="${escapeHtml(t.method||'')}" placeholder="e.g. Enzymatic Colorimetric"></div>
        <div class="field"><label>Reporting Units</label><input id="f_units" value="${escapeHtml(t.units||'')}" placeholder="e.g. mg/dL"></div>
      </div>
      <div class="grid grid-3">
        <div class="field"><label>Turnaround Time (hrs)</label><input id="f_tat" type="number" value="${t.tat}"></div>
        <div class="field"><label>Critical Low</label><input id="f_cl" type="number" step="any" value="${t.criticalLow??''}" placeholder="optional"></div>
        <div class="field"><label>Critical High</label><input id="f_ch" type="number" step="any" value="${t.criticalHigh??''}" placeholder="optional"></div>
      </div>
      <div class="field">
        <label>Minimum Facility Level Required to Perform This Test</label>
        <select id="f_tier">
          <option value="health_centre" ${t.minTier==='health_centre'?'selected':''}>Health Centre</option>
          <option value="atoll" ${t.minTier==='atoll'?'selected':''}>Atoll Hospital</option>
          <option value="regional" ${t.minTier==='regional'?'selected':''}>Regional Hospital only</option>
        </select>
      </div>
      <div class="field">
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" id="f_isculture" ${t.isCulture?'checked':''}> This is a microbiology culture test — results are entered as growth status + organism(s) + antibiotic sensitivity, not a single value.
        </label>
      </div>
      <div class="field">
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" id="f_isstat" ${t.isStat?'checked':''}> STAT-eligible — can be marked urgent at Sample Collection. Tests not checked here stay routine priority even if a collector tries to mark the sample STAT.
        </label>
      </div>
      <div class="field">
        <label>Reference Ranges</label>
        <div id="rangeTable">${rangeRowsHtml()}</div>
        <button type="button" class="btn btn-outline btn-sm" style="margin-top:6px;" onclick="addRangeRow()">+ Add reference range row</button>
      </div>
      <div class="field"><label>Comment / Interpretive Note</label><textarea id="f_comment">${escapeHtml(t.comment||'')}</textarea></div>
      <div class="actions-row">
        <button class="btn" onclick="saveTest()">Save Test</button>
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      </div>
    </div>
  </div>`;
}
function rangeRowsHtml(){
  const header = `<div class="range-row" style="font-size:11px;color:var(--mute);font-weight:600;"><div>Sex</div><div>Age from</div><div>Age to</div><div>Age in</div><div>Low</div><div>High</div><div></div></div>`;
  const rows = draftTest.refRanges.map((r,i)=>`
    <div class="range-row">
      <select aria-label="Sex" onchange="draftTest.refRanges[${i}].sex=this.value;showRangeWarnings()">
        <option value="Any" ${r.sex==='Any'?'selected':''}>Any</option>
        <option value="M" ${r.sex==='M'?'selected':''}>Male</option>
        <option value="F" ${r.sex==='F'?'selected':''}>Female</option>
      </select>
      <input type="number" min="0" aria-label="Age from" value="${r.ageMin}" onchange="draftTest.refRanges[${i}].ageMin=parseFloat(this.value)||0;showRangeWarnings()">
      <input type="number" min="0" aria-label="Age to" value="${r.ageMax}" onchange="draftTest.refRanges[${i}].ageMax=this.value===''?150:(parseFloat(this.value)||0);showRangeWarnings()">
      <select aria-label="Age in" onchange="draftTest.refRanges[${i}].ageUnit=this.value;showRangeWarnings()">
        <option value="D" ${r.ageUnit==='D'?'selected':''}>Days</option>
        <option value="M" ${r.ageUnit==='M'?'selected':''}>Months</option>
        <option value="Y" ${!r.ageUnit||r.ageUnit==='Y'?'selected':''}>Years</option>
      </select>
      <input type="number" step="any" aria-label="Low" value="${r.low}" onchange="draftTest.refRanges[${i}].low=parseFloat(this.value);showRangeWarnings()">
      <input type="number" step="any" aria-label="High" value="${r.high}" onchange="draftTest.refRanges[${i}].high=parseFloat(this.value);showRangeWarnings()">
      <button type="button" class="btn btn-danger btn-sm" style="padding:5px 8px;" aria-label="Remove this range" onclick="removeRangeRow(${i})">✕</button>
    </div>`).join('');
  return header + rows + `<div class="muted" style="font-size:11.5px;">Both ends are included, in completed days, months or years: “0 to 7 days” covers a 7-day-old; “1 to 12 years” covers a child until the 13th birthday. Age is taken on the day the specimen was collected.</div><div id="rangeWarnings">${rangeWarningsHtml()}</div>`;
}
// Bands laid on one line of days to spot holes and overlaps. A month is taken as 30.44 days and a
// year as 365.25, so differences of a few days between units are not reported.
function rangeProblems(ranges){
  const F = {D:1, M:30.4375, Y:365.25}, TOL = 3, END = 150*365.25;
  const out = [];
  const band = r => ({from:(r.ageMin||0)*F[r.ageUnit||'Y'], to:Math.min(END, ((r.ageMax??150)+1)*F[r.ageUnit||'Y']), r});
  const words = r => `${r.ageMin}–${r.ageMax} ${AGE_UNIT_WORDS[r.ageUnit||'Y']}`;
  ranges.forEach(r=>{ if((r.ageMax??150) < (r.ageMin||0)) out.push(`“${words(r)}”: the upper age is below the lower age.`); });
  for(const sex of ['M','F']){
    const label = sex==='M'?'Male':'Female';
    const own = ranges.filter(r=>r.sex===sex), any = ranges.filter(r=>r.sex==='Any');
    // Overlaps are only a problem between bands of the same sex setting (a sex-specific band is meant to override "Any").
    for(const group of [own, sex==='M'?any:[]]){
      const bands = group.map(band).sort((a,b)=>a.from-b.from);
      for(let i=1;i<bands.length;i++) if(bands[i].from < bands[i-1].to - TOL) out.push(`${group===any?'Any sex':label}: “${words(bands[i-1].r)}” and “${words(bands[i].r)}” overlap.`);
    }
    const all = [...own, ...any].map(band).sort((a,b)=>a.from-b.from);
    if(!all.length) continue;
    let covered = 0;
    for(const b of all){
      if(b.from > covered + TOL){ out.push(`${label}: no range between ${fmtAgeDays(covered)} and ${fmtAgeDays(b.from)}.`); }
      covered = Math.max(covered, b.to);
    }
    if(covered < END - TOL) out.push(`${label}: no range from ${fmtAgeDays(covered)} upward.`);
  }
  return [...new Set(out)];
}
function fmtAgeDays(days){
  if(days < 31) return `${Math.round(days)} days`;
  if(days < 730) return `${Math.round(days/30.4375)} months`;
  return `${Math.round(days/365.25)} years`;
}
function rangeWarningsHtml(){
  const filled = draftTest.refRanges.filter(r=>r.low!==''&&r.high!==''&&r.low!=null&&r.high!=null&&!Number.isNaN(r.low)&&!Number.isNaN(r.high));
  const problems = filled.length ? rangeProblems(filled) : [];
  return problems.length ? `<div style="margin-top:6px;padding:8px 10px;border-radius:8px;background:var(--amber-bg);color:var(--amber);font-size:12.5px;"><b>Check the age bands</b> — a gap leaves a patient with no reference range; where bands overlap, the one in the finer unit is used.<ul style="margin:4px 0 0 18px;padding:0;">${problems.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : '';
}
function showRangeWarnings(){ const el = document.getElementById('rangeWarnings'); if(el) el.innerHTML = rangeWarningsHtml(); }
function addRangeRow(){ draftTest.refRanges.push({sex:'Any', ageMin:0, ageMax:150, ageUnit:'Y', low:'', high:''}); document.getElementById('rangeTable').innerHTML = rangeRowsHtml(); }
function removeRangeRow(i){ draftTest.refRanges.splice(i,1); document.getElementById('rangeTable').innerHTML = rangeRowsHtml(); }
async function saveTest(){
  const code = document.getElementById('f_code').value.trim().toUpperCase();
  const name = document.getElementById('f_name').value.trim();
  if(!code || !name){ showToast('Test code and name are required.'); return; }
  const isNew = draftTest.code==='';
  const payload = {
    code, name,
    category: document.getElementById('f_category').value.trim() || 'General',
    specimenType: document.getElementById('f_specimen').value.trim(),
    method: document.getElementById('f_method').value.trim(),
    units: document.getElementById('f_units').value.trim(),
    tat: parseFloat(document.getElementById('f_tat').value) || 24,
    minTier: document.getElementById('f_tier').value,
    criticalLow: document.getElementById('f_cl').value===''? null : parseFloat(document.getElementById('f_cl').value),
    criticalHigh: document.getElementById('f_ch').value===''? null : parseFloat(document.getElementById('f_ch').value),
    isCulture: document.getElementById('f_isculture').checked,
    isStat: document.getElementById('f_isstat').checked,
    comment: document.getElementById('f_comment').value,
    refRanges: draftTest.refRanges.filter(r=>r.low!==''&&r.high!==''&&r.low!=null&&r.high!=null),
  };
  await withErrorToast(async ()=>{
    if(isNew) await api.createTest(payload); else await api.updateTest(draftTest.code, payload);
    catalogCache = await api.catalog();
    closeModal(); await render();
    showToast(`Test ${code} saved to catalog.`);
  });
}
async function deleteTest(code, btn){
  const name = itemNameFrom(btn);
  if(!await confirmAction({title:`Delete this test from the catalog?`, body:`Test <b>${escapeHtml(code)}</b> will be deleted from the catalog for every lab. Existing orders and results keep it; new memos with this code will arrive as an unrecognised test.`, confirmLabel:`Delete test`})) return;
  await withErrorToast(async ()=>{
    await api.deleteTest(code);
    catalogCache = await api.catalog();
    await render();
  });
}

/* ---------- Patients ---------- */
/* ---------- Admin — Manage Labs ---------- */
async function viewAdmin(){
  if(!isRegional()){
    return `<div class="card empty">Only the Regional Hospital Laboratory (top-level, hosting) lab has admin rights to manage labs.</div>`;
  }
  const reg = facilitiesCache.find(f=>f.tier==='regional') || {name:'Regional Hospital'};
  const atollRows = facilitiesCache.filter(f=>f.tier==='atoll').map(f=>`<tr>
      <td class="mono">${escapeHtml(f.id)}</td><td>${escapeHtml(f.name)}</td>
      <td><span class="tier-badge ${TIER_CLASS[f.tier]}">${TIER_SHORT[f.tier]}</span></td>
      <td><button class="btn btn-danger btn-sm" onclick="removeFacility('${f.id}',this)">Remove</button></td>
    </tr>`).join('');
  const hcRows = facilitiesCache.filter(f=>f.tier==='health_centre').map(f=>{
    const parent = facilitiesCache.find(x=>x.id===f.parentAtollId);
    return `<tr>
      <td class="mono">${escapeHtml(f.id)}</td><td>${escapeHtml(f.name)}</td>
      <td>${parent? escapeHtml(parent.name) : `${escapeHtml(reg.name)} <span class="muted">(direct — no Atoll Hospital)</span>`}</td>
      <td><button class="btn btn-danger btn-sm" onclick="removeFacility('${f.id}',this)">Remove</button></td>
    </tr>`;
  }).join('');
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:center;">
      <div><h1>Admin — Manage Labs</h1><p>This platform is hosted by ${escapeHtml(reg.name)}. Create and manage the Atoll Hospital and Health Centre labs that connect to it.</p></div>
      <button class="btn" onclick="openLabModal()">+ Create Lab</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <h2 style="padding:16px 20px 0;">Atoll Hospital labs</h2>
      <table><thead><tr><th>Lab ID</th><th>Name</th><th>Level</th><th></th></tr></thead>
      <tbody>${atollRows || `<tr><td colspan="4" class="empty">No Atoll Hospital labs created yet.</td></tr>`}</tbody></table>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <h2 style="padding:16px 20px 0;">Health Centre labs</h2>
      <table><thead><tr><th>Lab ID</th><th>Name</th><th>Parent Atoll Hospital</th><th></th></tr></thead>
      <tbody>${hcRows || `<tr><td colspan="4" class="empty">No Health Centre labs created yet.</td></tr>`}</tbody></table>
    </div>
    <p class="muted" style="font-size:11.5px;">To view a facility's data, grant your own account access to it under Settings → Users → Edit → Facility Access.</p>
  `;
}
function openLabModal(){
  const atolls = facilitiesCache.filter(f=>f.tier==='atoll');
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:460px;">
      <div class="modal-head"><h2>Create Lab</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="field"><label>Lab Level</label>
        <select id="lab_tier" onchange="document.getElementById('parentField').style.display=this.value==='health_centre'?'block':'none';">
          <option value="atoll">Atoll Hospital</option>
          <option value="health_centre">Health Centre</option>
        </select>
      </div>
      <div class="field"><label>Lab Name</label><input id="lab_name" placeholder="e.g. Dhiffushi Health Centre"></div>
      <div class="field" id="parentField" style="display:none;">
        <label>Parent Atoll Hospital</label>
        ${atolls.length ? `<select id="lab_parent"><option value="">— No Atoll Hospital (refer directly to Regional) —</option>${atolls.map(f=>`<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}</select>`
          : `<p class="muted" style="font-size:11.5px;">No Atoll Hospital exists yet — the Regional Hospital will automatically act as the parent lab.</p>`}
      </div>
      <div class="actions-row"><button class="btn" onclick="saveLab()">Create Lab</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function saveLab(){
  const name = (document.getElementById('lab_name').value||'').trim();
  const tier = document.getElementById('lab_tier').value;
  if(!name){ showToast('Enter a name for the new lab.'); return; }
  const parentSelect = document.getElementById('lab_parent');
  const parentAtollId = (tier==='health_centre' && parentSelect) ? parentSelect.value : undefined;
  await withErrorToast(async ()=>{
    await api.createFacility({ name, tier, parentAtollId: parentAtollId || undefined });
    facilitiesCache = await api.facilities();
    closeModal(); await render();
    showToast(`${name} created.`);
  });
}
async function removeFacility(id, btn){
  const name = itemNameFrom(btn);
  if(!await confirmAction({title:`Remove this lab?`, body:`<b>${escapeHtml(name||'This lab')}</b> will be removed from the network. Health Centres that referred to it will refer directly to the Regional Hospital.`, confirmLabel:`Remove lab`})) return;
  await withErrorToast(async ()=>{
    const result = await api.deleteFacility(id);
    facilitiesCache = await api.facilities();
    await render();
    showToast(result.reparentedHealthCentres ? `Removed. ${result.reparentedHealthCentres} Health Centre(s) now refer directly to Regional.` : 'Lab removed.');
  });
}

