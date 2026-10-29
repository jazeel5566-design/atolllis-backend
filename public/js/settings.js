/* ============================= SETTINGS ============================= */
let settingsTab = 'catalog';
let catalogSearch = '';
let catalogCategoryFilter = '';
let aliasSearch = '';
let organismSearch = '';
let antibioticSearch = '';
let usersFacilityFilter = null;
let wardsFacilityFilter = null;
// Settings sections grouped by the job they belong to. `show` decides who sees each one.
const SETTINGS_GROUPS = [
  {label:'Test catalog', tabs:[
    {id:'catalog', label:'Tests', show:()=>true},
    {id:'categories', label:'Categories', show:()=>hasCapability('manage_catalog')},
    {id:'panels', label:'Panels', show:()=>hasCapability('manage_catalog')},
    {id:'aliases', label:'HIS aliases', show:()=>hasCapability('manage_catalog')},
    {id:'reflex', label:'Reflex rules', show:()=>hasCapability('manage_catalog')},
    {id:'rejectreasons', label:'Rejection reasons', show:()=>hasCapability('manage_catalog')},
  ]},
  {label:'Microbiology', tabs:[
    {id:'organisms', label:'Organisms', show:()=>hasCapability('manage_catalog')},
    {id:'antibiotics', label:'Antibiotics', show:()=>hasCapability('manage_catalog')},
  ]},
  {label:'People and wards', tabs:[
    {id:'users', label:'Users and roles', show:()=>hasCapability('manage_users')},
    {id:'wards', label:'Wards', show:()=>hasCapability('manage_users')},
    {id:'account', label:'My account', show:()=>true},
  ]},
  {label:'Labs and instruments', tabs:[
    {id:'instruments', label:'Instruments', show:()=>hasCapability('manage_users')},
    {id:'admin', label:'Labs', show:()=>hasCapability('manage_labs')},
    {id:'networks', label:'Network mapping', show:()=>hasCapability('manage_labs')},
    {id:'connection', label:'Connection', show:()=>isRegional()},
  ]},
  {label:'Audit log', tabs:[
    {id:'audit', label:'Audit log', show:()=>hasCapability('view_audit')},
  ]},
];
async function viewSettings(){
  const f = fac(session.user.facilityId);
  const groups = SETTINGS_GROUPS.map(g=>({label:g.label, tabs:g.tabs.filter(t=>t.show())})).filter(g=>g.tabs.length);
  let group = groups.find(g=>g.tabs.some(t=>t.id===settingsTab));
  if(!group){ group = groups[0]; settingsTab = group.tabs[0].id; }
  return `
    <div class="pagehead"><h1>Settings</h1><p>Configuration for ${escapeHtml(f.name)}.</p></div>
    <div class="tabs">
      ${groups.map(g=>`<div class="tab ${g===group?'active':''}" onclick="settingsTab='${g.tabs[0].id}';render();">${g.label}</div>`).join('')}
    </div>
    ${group.tabs.length>1? `<div class="subtabs">${group.tabs.map(t=>`<div class="subtab ${settingsTab===t.id?'active':''}" onclick="settingsTab='${t.id}';render();">${t.label}</div>`).join('')}</div>`:''}
    ${settingsTab==='catalog'? viewCatalog()
      : settingsTab==='categories'? viewCategories()
      : settingsTab==='panels'? await viewPanels()
      : settingsTab==='aliases'? await viewAliases()
      : settingsTab==='reflex'? await viewReflexRules()
      : settingsTab==='organisms'? await viewOrganisms()
      : settingsTab==='antibiotics'? await viewAntibiotics()
      : settingsTab==='rejectreasons'? await viewRejectionReasons()
      : settingsTab==='networks'? await viewNetworks()
      : settingsTab==='users'? await viewUsers()
      : settingsTab==='wards'? await viewWards()
      : settingsTab==='instruments'? await viewInstruments()
      : settingsTab==='audit'? await viewAuditLog()
      : settingsTab==='account'? viewMyAccount()
      : settingsTab==='connection'? await viewConnection()
      : await viewAdmin()}
  `;
}

/* ---------- Network Mapping (manage_labs) — which local network belongs to which facility ---------- */
async function viewNetworks(){
  const networks = await api.facilityNetworks();
  const rows = networks.map(n=>`<tr>
    <td>${escapeHtml(n.facilityName)}</td>
    <td>${escapeHtml(n.label)}</td>
    <td class="mono">${escapeHtml(n.cidr)}</td>
    <td><button class="btn btn-danger btn-sm" onclick="deleteFacilityNetwork('${n.id}',this)">Remove</button></td>
  </tr>`).join('');
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:center;">
      <div><h1>Network Mapping</h1><p>Devices on a registered network are recognized as that facility automatically at login.</p></div>
      <button class="btn" onclick="openNetworkModal()">+ New Mapping</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>Facility</th><th>Label</th><th>Network (CIDR)</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" class="empty">No networks registered yet — everyone sees the manual facility picker until at least one is added.</td></tr>`}</tbody></table>
    </div>
  `;
}
async function openNetworkModal(){
  const facilities = await api.facilities();
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:420px;">
      <div class="modal-head"><h2>New Network Mapping</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="field"><label>Facility</label>
        <select id="net_facility">${facilities.map(f=>`<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Label</label><input id="net_label" placeholder="e.g. Main Building WiFi"></div>
      <div class="field"><label>Network (CIDR)</label><input id="net_cidr" placeholder="e.g. 203.0.113.42 or 203.0.113.0/24"></div>
      <p class="muted" style="font-size:11.5px;">A single IP works too — it's treated as a /32 (exactly one address).</p>
      <div class="actions-row"><button class="btn" onclick="saveNetwork()">Save</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function saveNetwork(){
  const facilityId = document.getElementById('net_facility').value;
  const label = (document.getElementById('net_label').value||'').trim();
  const cidr = (document.getElementById('net_cidr').value||'').trim();
  if(!label || !cidr){ showToast('Enter a label and a network/CIDR.'); return; }
  await withErrorToast(async ()=>{
    await api.createFacilityNetwork({facilityId, label, cidr});
    closeModal(); await render();
    showToast('Network mapping saved.');
  });
}
async function deleteFacilityNetwork(id, btn){
  const name = itemNameFrom(btn);
  if(!await confirmAction({title:`Remove this network mapping?`, body:`<b>${escapeHtml(name||'This network')}</b> will no longer be recognised at login — staff there will be asked to choose their facility.`, confirmLabel:`Remove mapping`})) return;
  await withErrorToast(async ()=>{
    await api.deleteFacilityNetwork(id);
    await render();
  });
}

/* ---------- My Account (everyone) ---------- */
/* ---------- Audit Log (view_audit capability) ---------- */
let auditFacilityFilter = null;
let auditActionFilter = '';
async function viewAuditLog(){
  const isAdmin = session.user.role==='admin';
  let facilities = [];
  if(isAdmin) facilities = await api.facilities();
  const params = new URLSearchParams();
  if(isAdmin && auditFacilityFilter) params.set('facilityId', auditFacilityFilter);
  if(auditActionFilter) params.set('action', auditActionFilter);
  const entries = await api.auditLog(params.toString());
  const actionLabel = {
    login:'Login', memo_imported:'Memo Fetched', memo_cancelled:'Memo Cancelled', collect:'Sample Collected',
    recollect:'Sample Recollected', refer:'Referred', receive_referral:'Referral Received',
    load_analyser:'Loaded to Analyser', accept:'Specimen Accepted', reject:'Specimen Rejected',
    critical_notified:'Critical Value Notified', critical_attempt_failed:'Critical Notification Attempt Failed',
    reject_referral:'Referred Specimen Rejected', rejection_reason_created:'Rejection Reason Added', rejection_reason_deleted:'Rejection Reason Removed',
    analyser_result:'Analyser Result', manual_result:'Manual Result', certify:'Certified',
    result_amended:'Result Amended', result_withdrawn:'Result Withdrawn', amendment_notified:'Amendment Notified', amendment_attempt_failed:'Amendment Notification Attempt Failed',
    user_created:'User Created', user_updated:'User Updated', user_removed:'User Removed',
    facility_access_granted:'Facility Access Granted', facility_access_revoked:'Facility Access Revoked',
    report_handover:'Report Handed Out', report_reprint:'Report Printed Again', patient_folder_viewed:'Patient Folder Opened',
    patient_dhivehi_name:'Patient Dhivehi Name Set', facility_dhivehi:'Lab Dhivehi Text Set', patient_registered:'Patient Registered',
  };
  const rows = entries.map(e=>`<tr>
    <td class="muted" style="font-size:12px;white-space:nowrap;">${fmtDate(e.createdAt)}</td>
    <td>${escapeHtml(e.userName)}</td>
    <td>${escapeHtml(e.facilityName)}</td>
    <td><span class="pill pill-grey">${escapeHtml(actionLabel[e.action]||e.action)}</span></td>
    <td style="font-size:12.5px;">${escapeHtml(e.details||'')}</td>
  </tr>`).join('');
  return `
    <div class="pagehead"><h1>Audit Log</h1><p>Every logged action, at both the user and facility level.</p></div>
    <div class="card">
      <div class="grid grid-2">
        ${isAdmin? `<div class="field" style="margin-bottom:0;"><label>Facility</label>
          <select onchange="auditFacilityFilter=this.value||null;render();">
            <option value="">All facilities</option>
            ${facilities.map(f=>`<option value="${f.id}" ${auditFacilityFilter===f.id?'selected':''}>${escapeHtml(f.name)}</option>`).join('')}
          </select></div>` : ''}
        <div class="field" style="margin-bottom:0;"><label>Action</label>
          <select onchange="auditActionFilter=this.value;render();">
            <option value="">All actions</option>
            ${Object.entries(actionLabel).map(([k,label])=>`<option value="${k}" ${auditActionFilter===k?'selected':''}>${escapeHtml(label)}</option>`).join('')}
          </select></div>
      </div>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>When</th><th>User</th><th>Facility</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="empty">No matching entries.</td></tr>`}</tbody></table>
    </div>
    <p class="muted" style="font-size:11px;">Showing the most recent ${entries.length} entries.</p>
  `;
}
function viewMyAccount(){
  return `<div class="card" style="max-width:420px;">
    <h2>My Account</h2>
    <div class="field"><label>Name</label><input value="${escapeHtml(session.user.name)}" readonly style="background:#F7F9FB;color:var(--mute);"></div>
    <div class="field"><label>Role</label><input value="${escapeHtml(session.user.roleLabel||ROLE_LABELS[session.user.role]||session.user.role)}" readonly style="background:#F7F9FB;color:var(--mute);"></div>
    <hr style="border:none;border-top:1px solid var(--border);margin:16px 0;">
    <h2 style="font-size:14px;">Change Password</h2>
    <div class="field"><label>Current Password</label><input id="pw_current" type="password"></div>
    <div class="field"><label>New Password (at least ${PASSWORD_MIN_LENGTH} characters, not containing your username)</label><input id="pw_new" type="password" autocomplete="new-password"></div>
    <div class="field"><label>Confirm New Password</label><input id="pw_confirm" type="password"></div>
    <button class="btn" onclick="changeOwnPassword()">Update Password</button>
  </div>`;
}
async function changeOwnPassword(){
  const current = document.getElementById('pw_current').value;
  const next = document.getElementById('pw_new').value;
  const confirm2 = document.getElementById('pw_confirm').value;
  if(!current || !next){ showToast('Fill in your current and new password.'); return; }
  const problem = passwordProblem(next, session.user.username);
  if(problem){ showToast(problem, 'error'); return; }
  if(next!==confirm2){ showToast('New password and confirmation do not match.'); return; }
  await withErrorToast(async ()=>{
    const res = await api.changePassword(current, next);
    session.token = res.token; saveSession(); // other sessions of this account have ended; this one goes on
    showToast('Password updated. Any other place you were logged in has been logged out.');
    ['pw_current','pw_new','pw_confirm'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  });
}

/* ---------- Users (Lab Manager / Admin only — manage_users capability) ---------- */
async function viewUsers(){
  const isAdmin = session.user.role==='admin';
  let facilities = [];
  if(isAdmin) facilities = await api.facilities();
  const targetFacilityId = isAdmin ? (usersFacilityFilter || session.user.facilityId) : session.user.facilityId;
  const users = await api.users(isAdmin ? targetFacilityId : undefined);
  const facilityPicker = isAdmin ? `<div class="field" style="max-width:320px;"><label>Facility</label>
    <select onchange="usersFacilityFilter=this.value;render();">
      ${facilities.map(fc=>`<option value="${fc.id}" ${targetFacilityId===fc.id?'selected':''}>${escapeHtml(fc.name)}</option>`).join('')}
    </select></div>` : '';
  // Only an administrator changes an administrator's account (the server refuses it too).
  const canManage = u => isAdmin || u.role!=='admin';
  const statusOf = u => [
    !u.active ? `<span class="pill pill-grey">Disabled</span>` : '',
    u.locked ? `<span class="pill pill-crimson" title="Until ${escapeHtml(fmtDate(u.lockedUntil))}">Locked</span>` : '',
    u.active && u.mustChangePassword ? `<span class="pill pill-amber">Sets own password at next login</span>` : '',
  ].join(' ') || `<span class="muted">Active</span>`;
  const rows = users.map(u=>`<tr>
    <td>${escapeHtml(u.name)}${u.id===session.user.userId?' <span class="muted">(you)</span>':''}</td>
    <td class="mono">${escapeHtml(u.username)}</td>
    <td>${escapeHtml(u.roleLabel)}</td>
    <td>${u.facilityAccess.map(a=>escapeHtml(a.facilityName)).join(', ')}${u.facilityAccess.length>1?` <span class="pill pill-teal" style="font-size:10px;">picks at login</span>`:''}</td>
    <td>${statusOf(u)}</td>
    <td style="white-space:nowrap;">
      ${canManage(u)? `<button class="btn btn-outline btn-sm" onclick="openUserModal('${u.id}','${targetFacilityId}')">Edit</button>`:''}
      ${canManage(u) && u.locked? `<button class="btn btn-outline btn-sm" onclick="unlockUser('${u.id}',this)">Unlock</button>`:''}
      ${canManage(u) && u.id!==session.user.userId? `<button class="btn btn-outline btn-sm" onclick="setUserActive('${u.id}',${!u.active},this)">${u.active?'Disable':'Enable'}</button>`:''}
      ${canManage(u) && u.id!==session.user.userId? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}',this)">Remove</button>`:''}
    </td>
  </tr>`).join('');
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px;">
      <div>${facilityPicker}</div>
      <button class="btn" onclick="openUserModal(null,'${targetFacilityId}')">+ New User</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Facility Access</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="empty">No users found.</td></tr>`}</tbody></table>
    </div>
    ${isAdmin? await renderRolePermissions() : ''}
  `;
}
// Which tasks each role can perform — Admin only. A capability-based gate wouldn't be safe here,
// since a role could then grant itself more power; this matches the backend's raw role==='admin'
// check rather than hasCapability().
let pendingRoleCaps = null; // { role: Set(capabilities) } while there are unsaved ticks
function roleCapChanges(){
  if(!pendingRoleCaps) return [];
  const out = [];
  roleCapabilitiesCache.roles.forEach(r=>{
    const now = pendingRoleCaps[r.role]; if(!now) return;
    const label = c => (roleCapabilitiesCache.allCapabilities.find(x=>x.capability===c)||{label:c}).label;
    const added = [...now].filter(c=>!r.capabilities.includes(c)), removed = r.capabilities.filter(c=>!now.has(c));
    if(added.length || removed.length) out.push({role:r.role, label:r.label, caps:[...now], added:added.map(label), removed:removed.map(label)});
  });
  return out;
}
async function renderRolePermissions(){
  const data = await api.roleCapabilities();
  roleCapabilitiesCache = data; // keep the live cache in sync with what's shown here
  const has = (r,c) => pendingRoleCaps && pendingRoleCaps[r.role] ? pendingRoleCaps[r.role].has(c) : r.capabilities.includes(c);
  const rows = data.roles.map(r=>`<tr>
    <td style="font-weight:600;">${escapeHtml(r.label)}</td>
    ${data.allCapabilities.map(c=>`<td style="text-align:center;">
      <input type="checkbox" aria-label="${escapeHtml(r.label)} — ${escapeHtml(c.label)}" data-role="${r.role}" data-cap="${c.capability}" ${has(r,c.capability)?'checked':''} onchange="toggleRoleCapability(this)">
    </td>`).join('')}
  </tr>`).join('');
  const changes = roleCapChanges();
  return `
    <div class="card" style="margin-top:20px;">
      <h2>Role permissions</h2>
      <p class="muted" style="font-size:12.5px;margin-top:-6px;">Which tasks each role is allowed to perform. Tick or untick, then save — nothing changes until you do.</p>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Role</th>${data.allCapabilities.map(c=>`<th style="font-size:11px;">${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="actions-row" id="roleCapActions">
        <button class="btn" ${changes.length?'':'disabled'} onclick="saveRoleCapabilities()">Save permission changes${changes.length?` (${changes.length} role${changes.length===1?'':'s'})`:''}</button>
        ${changes.length? `<button class="btn btn-outline" onclick="pendingRoleCaps=null;render();">Discard changes</button>`:''}
      </div>
    </div>
  `;
}
function toggleRoleCapability(checkbox){
  const role = checkbox.dataset.role;
  pendingRoleCaps = pendingRoleCaps || {};
  if(!pendingRoleCaps[role]){
    const entry = roleCapabilitiesCache.roles.find(r=>r.role===role);
    pendingRoleCaps[role] = new Set(entry ? entry.capabilities : []);
  }
  if(checkbox.checked) pendingRoleCaps[role].add(checkbox.dataset.cap); else pendingRoleCaps[role].delete(checkbox.dataset.cap);
  const changes = roleCapChanges();
  const row = document.getElementById('roleCapActions');
  if(row) row.innerHTML = `<button class="btn" ${changes.length?'':'disabled'} onclick="saveRoleCapabilities()">Save permission changes${changes.length?` (${changes.length} role${changes.length===1?'':'s'})`:''}</button>
    ${changes.length? `<button class="btn btn-outline" onclick="pendingRoleCaps=null;render();">Discard changes</button>`:''}`;
}
async function saveRoleCapabilities(){
  const changes = roleCapChanges();
  if(!changes.length) return;
  const mine = changes.find(c=>c.role===session.user.role && c.removed.length);
  const ok = await confirmAction({
    title: 'Save these permission changes?',
    body: changes.map(c=>`<b>${escapeHtml(c.label)}</b>: ${[c.added.length?`gains ${c.added.map(escapeHtml).join(', ')}`:'', c.removed.length?`loses ${c.removed.map(escapeHtml).join(', ')}`:''].filter(Boolean).join('; ')}`).join('<br>')
      + `<br><span class="muted">Takes effect at once for everyone with ${changes.length===1?'that role':'those roles'}.</span>`
      + (mine? `<br><b style="color:var(--crimson);">This removes permissions from your own role.</b>`:''),
    confirmLabel: 'Save changes', danger: !!mine,
  });
  if(!ok) return;
  await withErrorToast(async ()=>{
    for(const c of changes) await api.updateRoleCapabilities(c.role, c.caps);
    pendingRoleCaps = null;
    roleCapabilitiesCache = await api.roleCapabilities();
    await render();
    showToast('Role permissions saved.');
  });
}
async function openUserModal(userId, facilityId){
  const existing = userId ? (await api.users(facilityId)).find(u=>u.id===userId) : null;
  const isAdmin = session.user.role==='admin';
  const grantable = isAdmin
    ? ['reception_clerk','clinician','phlebotomist','technologist','pathologist','lab_manager','admin']
    : ['reception_clerk','clinician','phlebotomist','technologist','pathologist','lab_manager'];
  const allFacilities = isAdmin ? await api.facilities() : facilitiesCache;
  const accessSection = existing ? `
    <hr style="border:none;border-top:1px solid var(--border);margin:16px 0;">
    <h2 style="font-size:14px;">Facility Access</h2>
    <p class="muted" style="font-size:11.5px;margin-top:-6px;">Beyond one facility, this account is asked which one to use right after the password verifies at login.</p>
    <div class="checklist" style="max-height:none;">
      ${existing.facilityAccess.map(a=>`<div class="test-row">
        <span>${escapeHtml(a.facilityName)}${a.facilityId===existing.facilityId?' <span class="muted">(home)</span>':''}</span>
        ${a.facilityId!==existing.facilityId? `<button class="btn btn-danger btn-sm" onclick="revokeFacilityAccess('${existing.id}','${a.facilityId}','${facilityId}')">Revoke</button>`:''}
      </div>`).join('')}
    </div>
    <div class="grid grid-2" style="margin-top:8px;align-items:end;">
      <div class="field" style="margin-bottom:0;"><label>Grant access to</label>
        <select id="u_grant_facility">${allFacilities.filter(f=>!existing.facilityAccess.some(a=>a.facilityId===f.id)).map(f=>`<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('') || '<option value="">— already has access everywhere available —</option>'}</select>
      </div>
      <button class="btn btn-outline btn-sm" onclick="grantFacilityAccess('${existing.id}','${facilityId}')">+ Grant</button>
    </div>
  ` : `<p class="muted" style="font-size:11.5px;margin-top:14px;">You can grant access to additional facilities after creating this user.</p>`;
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:440px;">
      <div class="modal-head"><h2>${existing?'Edit User':'New User'}</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="field"><label>Name</label><input id="u_name" value="${escapeHtml(existing?.name||'')}" placeholder="e.g. Aminath Nazima"></div>
      <div class="field"><label>Username</label><input id="u_username" value="${escapeHtml(existing?.username||'')}" placeholder="e.g. anazima" ${existing?'readonly style="background:#F7F9FB;color:var(--mute);"':''}></div>
      <div class="field"><label>Role</label>
        <select id="u_role">${grantable.map(r=>`<option value="${r}" ${existing?.role===r?'selected':''}>${escapeHtml(ROLE_LABELS[r])}</option>`).join('')}</select>
      </div>
      <div class="field"><label>${existing?'Reset Password (leave blank to keep current)':'First Password'}</label><input id="u_password" type="password" autocomplete="new-password" placeholder="at least ${PASSWORD_MIN_LENGTH} characters">
        <div class="muted" style="font-size:11.5px;margin-top:4px;">${existing?'A reset logs this person out everywhere.':'Give it to the person privately.'} They choose their own password the next time they log in.</div></div>
      <div class="actions-row"><button class="btn" onclick="saveUser(${existing?`'${existing.id}'`:'null'},'${facilityId}')">Save</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
      ${accessSection}
    </div>
  </div>`;
}
async function grantFacilityAccess(userId, currentFacilityFilter){
  const facilityId = document.getElementById('u_grant_facility').value;
  if(!facilityId){ showToast('Choose a facility to grant.'); return; }
  await withErrorToast(async ()=>{
    await api.grantFacilityAccess(userId, facilityId);
    await openUserModal(userId, currentFacilityFilter);
    showToast('Facility access granted.');
  });
}
async function revokeFacilityAccess(userId, facilityId, currentFacilityFilter){
  if(!await confirmAction({title:'Revoke facility access?', body:'This user will no longer be able to work at that facility. Their home facility is not affected.', confirmLabel:'Revoke access'})) return;
  await withErrorToast(async ()=>{
    await api.revokeFacilityAccess(userId, facilityId);
    await openUserModal(userId, currentFacilityFilter);
    showToast('Facility access revoked.');
  });
}
async function saveUser(userId, facilityId){
  const name = (document.getElementById('u_name').value||'').trim();
  const username = (document.getElementById('u_username').value||'').trim();
  const role = document.getElementById('u_role').value;
  const password = document.getElementById('u_password').value;
  if(!name || !username){ showToast('Name and username are required.'); return; }
  const problem = (password || !userId) ? passwordProblem(password, username) : null;
  if(problem){ showToast(problem, 'error'); return; }
  await withErrorToast(async ()=>{
    if(userId){
      const data = {name, role};
      if(password) data.newPassword = password;
      await api.updateUser(userId, data);
    }else{
      await api.createUser({name, username, password, role, facilityId});
    }
    closeModal(); await render();
    showToast('User saved.');
  });
}
async function unlockUser(userId, btn){
  const name = itemNameFrom(btn);
  await withErrorToast(async ()=>{
    await api.updateUser(userId, {unlock:true});
    await render();
    showToast(`${name||'The account'} can log in again.`);
  });
}
async function setUserActive(userId, active, btn){
  const name = itemNameFrom(btn);
  if(!active && !await confirmAction({title:'Disable this account?', body:`<b>${escapeHtml(name||'This user')}</b> is logged out everywhere at once and cannot log in until the account is enabled again. Their name stays on everything they have already done.`, confirmLabel:'Disable account'})) return;
  await withErrorToast(async ()=>{
    await api.updateUser(userId, {active});
    await render();
    showToast(active ? `${name||'The account'} is enabled.` : `${name||'The account'} is disabled.`);
  });
}
async function deleteUser(userId, btn){
  const name = itemNameFrom(btn);
  if(!await confirmAction({title:`Remove this user?`, body:`<b>${escapeHtml(name||'This user')}</b> will no longer be able to log in. Their name stays on everything they have already done. This cannot be undone.`, confirmLabel:`Remove user`})) return;
  await withErrorToast(async ()=>{
    await api.deleteUser(userId);
    await render();
  });
}

/* ---------- Wards (facility-scoped, manage_users capability) ---------- */
async function viewWards(){
  const isAdmin = session.user.role==='admin';
  let facilities = [];
  if(isAdmin) facilities = await api.facilities();
  const targetFacilityId = isAdmin ? (wardsFacilityFilter || session.user.facilityId) : session.user.facilityId;
  const wards = await api.wards(isAdmin ? targetFacilityId : undefined);
  const facilityPicker = isAdmin ? `<div class="field" style="max-width:320px;"><label>Facility</label>
    <select onchange="wardsFacilityFilter=this.value;render();">
      ${facilities.map(fc=>`<option value="${fc.id}" ${targetFacilityId===fc.id?'selected':''}>${escapeHtml(fc.name)}</option>`).join('')}
    </select></div>` : '';
  const rows = wards.map(w=>`<tr>
    <td>${escapeHtml(w.name)}</td>
    <td><button class="btn btn-danger btn-sm" onclick="deleteWard('${w.id}','${targetFacilityId}',this)">Remove</button></td>
  </tr>`).join('');
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px;">
      <div>${facilityPicker}<h1 style="margin-top:8px;">Wards</h1><p>In-patient wards for this facility — selected at Sample Collection when the patient is an in-patient, and shown on the report for that visit.</p></div>
      <button class="btn" onclick="openWardModal('${targetFacilityId}')">+ New Ward</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>Ward</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="2" class="empty">No wards defined yet — a Health Centre with no admissions can simply leave this empty.</td></tr>`}</tbody></table>
    </div>
  `;
}
function openWardModal(facilityId){
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:380px;">
      <div class="modal-head"><h2>New Ward</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="field"><label>Ward Name</label><input id="ward_name" placeholder="e.g. Medical Ward"></div>
      <div class="actions-row"><button class="btn" onclick="saveWard('${facilityId}')">Save</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function saveWard(facilityId){
  const name = (document.getElementById('ward_name').value||'').trim();
  if(!name){ showToast('Enter a ward name.'); return; }
  await withErrorToast(async ()=>{
    await api.createWard(name, facilityId);
    wardsCache = [];
    closeModal(); await render();
    showToast('Ward saved.');
  });
}
async function deleteWard(id, facilityId, btn){
  const name = itemNameFrom(btn);
  if(!await confirmAction({title:`Remove this ward?`, body:`<b>${escapeHtml(name||'This ward')}</b> will no longer be offered at Sample Collection. Reports already issued keep the ward name.`, confirmLabel:`Remove ward`})) return;
  await withErrorToast(async ()=>{
    await api.deleteWard(id);
    wardsCache = [];
    await render();
  });
}

/* ---------- Instruments (facility-scoped, manage_users capability) ---------- */
// An analyser is connected through a bridge program on a lab PC (the bridge/ folder of this
// project), which identifies itself with the key issued here.
let instrumentsFacilityFilter = null;
const INSTRUMENT_PROTOCOLS = {astm:'ASTM (CLSI LIS01-A2 / LIS02-A2)', hl7:'HL7 v2.5.1 (MLLP)'};
const INSTRUMENT_CONNECTIONS = {tcp:'Network (TCP/IP)', serial:'Serial cable (RS-232)'};
async function viewInstruments(){
  const isAdmin = session.user.role==='admin';
  let facilities = [];
  if(isAdmin) facilities = await api.facilities();
  const targetFacilityId = isAdmin ? (instrumentsFacilityFilter || session.user.facilityId) : session.user.facilityId;
  const instruments = await api.instruments(isAdmin ? targetFacilityId : undefined);
  const facilityPicker = isAdmin ? `<div class="field" style="max-width:320px;"><label>Facility</label>
    <select onchange="instrumentsFacilityFilter=this.value;render();">
      ${facilities.map(fc=>`<option value="${fc.id}" ${targetFacilityId===fc.id?'selected':''}>${escapeHtml(fc.name)}</option>`).join('')}
    </select></div>` : '';
  const rows = instruments.map(i=>`<tr>
    <td><b>${escapeHtml(i.name)}</b>${(i.manufacturer||i.model)?`<div class="muted" style="font-size:11.5px;">${escapeHtml([i.manufacturer,i.model].filter(Boolean).join(' '))}</div>`:''}</td>
    <td>${INSTRUMENT_PROTOCOLS[i.protocol]||escapeHtml(i.protocol)}<div class="muted" style="font-size:11.5px;">${INSTRUMENT_CONNECTIONS[i.connection]||escapeHtml(i.connection)}</div></td>
    <td class="mono">${escapeHtml(i.keyPrefix)}…</td>
    <td>${i.mappedTests||0}</td>
    <td>${i.lastSeenAt? fmtDate(i.lastSeenAt) : '<span class="muted">Never connected</span>'}</td>
    <td><span class="pill ${i.enabled?'pill-teal':'pill-grey'}">${i.enabled?'On':'Off'}</span></td>
    <td style="white-space:nowrap;">
      <button class="btn btn-sm btn-outline" onclick="openInstrumentMapsModal('${i.id}')">Test Codes</button>
      <button class="btn btn-sm btn-outline" onclick="toggleInstrument('${i.id}', ${!i.enabled})">${i.enabled?'Switch Off':'Switch On'}</button>
      <button class="btn btn-sm btn-outline" onclick="regenerateInstrumentKey('${i.id}')">New Key</button>
      <button class="btn btn-danger btn-sm" onclick="deleteInstrument('${i.id}',this)">Remove</button>
    </td>
  </tr>`).join('');
  return `
    <div class="pagehead" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px;">
      <div>${facilityPicker}<h1 style="margin-top:8px;">Instruments</h1><p>Analysers connected to the LIS at this facility. Each one talks through the bridge program on a lab PC, using the key issued here. Results it sends still wait for validation by a person.</p></div>
      <button class="btn" onclick="openInstrumentModal('${targetFacilityId}')">+ New Instrument</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table><thead><tr><th>Instrument</th><th>Protocol</th><th>Key</th><th>Mapped tests</th><th>Bridge last seen</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="empty">No instruments registered at this facility.</td></tr>`}</tbody></table>
    </div>
  `;
}
function openInstrumentModal(facilityId){
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:460px;">
      <div class="modal-head"><h2>New Instrument</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="field"><label>Name used in the lab</label><input id="ins_name"></div>
      <div class="grid grid-2">
        <div class="field"><label>Manufacturer</label><input id="ins_manufacturer"></div>
        <div class="field"><label>Model</label><input id="ins_model"></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>Protocol</label><select id="ins_protocol">${Object.entries(INSTRUMENT_PROTOCOLS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label>Connection</label><select id="ins_connection">${Object.entries(INSTRUMENT_CONNECTIONS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div>
      </div>
      <p class="muted" style="font-size:12px;">The protocol and connection are in the analyser's host-interface manual. HL7 instruments connect over the network only.</p>
      <div class="actions-row"><button class="btn" onclick="saveInstrument('${facilityId}')">Save</button><button class="btn btn-outline" onclick="closeModal()">Cancel</button></div>
    </div>
  </div>`;
}
async function saveInstrument(facilityId){
  const v = id => (document.getElementById(id).value||'').trim();
  if(!v('ins_name')){ showToast('Enter a name for the instrument.'); return; }
  await withErrorToast(async ()=>{
    const created = await api.createInstrument({ facilityId, name:v('ins_name'), manufacturer:v('ins_manufacturer'), model:v('ins_model'), protocol:v('ins_protocol'), connection:v('ins_connection') });
    await render();
    showInstrumentKey(created.name, created.key);
  });
}
// The key is only ever available at the moment it is issued.
function showInstrumentKey(name, key){
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-overlay">
    <div class="modal" style="max-width:520px;">
      <div class="modal-head"><h2>Key for ${escapeHtml(name)}</h2></div>
      <p style="font-size:13px;">Copy this key into the bridge's <span class="mono">config.json</span> on the lab PC now. <b>It is shown only this once</b> — if it is lost, issue a new one with "New Key".</p>
      <div class="field"><input id="ins_key_show" class="mono" readonly value="${escapeHtml(key)}" onclick="this.select()"></div>
      <div class="actions-row"><button class="btn" onclick="copyInstrumentKey()">Copy Key</button><button class="btn btn-outline" onclick="closeModal()">I have saved it</button></div>
    </div>
  </div>`;
}
async function copyInstrumentKey(){
  const el = document.getElementById('ins_key_show');
  el.select();
  try{ await navigator.clipboard.writeText(el.value); showToast('Key copied.'); }
  catch(e){ showToast('Could not copy automatically — select the key and copy it by hand.'); }
}
async function toggleInstrument(id, enabled){
  await withErrorToast(async ()=>{ await api.updateInstrument(id, {enabled}); await render(); });
}
async function regenerateInstrumentKey(id){
  if(!await confirmAction({title:'Issue a new key?', body:'The current key stops working at once. The bridge for this instrument will not be accepted until the new key is put in its <span class="mono">config.json</span> and it is restarted.', confirmLabel:'Issue new key'})) return;
  await withErrorToast(async ()=>{
    const r = await api.regenerateInstrumentKey(id);
    await render();
    showInstrumentKey(r.name, r.key);
  });
}
async function deleteInstrument(id, btn){
  const name = itemNameFrom(btn);
  if(!await confirmAction({title:`Remove this instrument?`, body:`<b>${escapeHtml(name||'This instrument')}</b> and its test-code mappings will be removed, and its bridge will stop being accepted. Its log entries are kept.`, confirmLabel:`Remove instrument`})) return;
  await withErrorToast(async ()=>{ await api.deleteInstrument(id); await render(); });
}
async function openInstrumentMapsModal(id){
  await withErrorToast(async ()=>{
    const maps = await api.instrumentMaps(id);
    const mapped = new Set(maps.map(m=>m.testCode));
    const options = catalogCache.filter(t=>!t.isCulture && !mapped.has(t.code))
      .map(t=>`<option value="${escapeHtml(t.code)}">${escapeHtml(t.code)} — ${escapeHtml(t.name)}${t.units?` (${escapeHtml(t.units)})`:''}</option>`).join('');
    const rows = maps.map(m=>{
      const t = test(m.testCode);
      return `<tr>
        <td class="mono">${escapeHtml(m.instrumentCode)}</td>
        <td><span class="mono">${escapeHtml(m.testCode)}</span> ${escapeHtml(t?t.name:'(not in catalog)')}</td>
        <td>${m.units? `<span class="mono">${escapeHtml(m.units)}</span>` : `<span class="muted">${escapeHtml(t&&t.units||'—')}</span>`}${m.acceptBlankUnit?' <span class="pill pill-grey" style="font-size:10px;">blank ok</span>':''}</td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteInstrumentMap('${id}','${m.id}')">Remove</button></td>
      </tr>`;
    }).join('');
    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-overlay">
      <div class="modal" style="max-width:760px;">
        <div class="modal-head"><h2>Test Codes</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
        <p class="muted" style="font-size:12.5px;margin-top:-6px;">The code this analyser uses for each test, from its host-interface manual. Only mapped tests are sent to the analyser, and only mapped results are accepted.</p>
        <div style="max-height:300px;overflow:auto;border:1px solid var(--border);border-radius:8px;">
          <table><thead><tr><th>Analyser code</th><th>LIS test</th><th>Unit expected</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="empty">No test codes mapped yet.</td></tr>`}</tbody></table>
        </div>
        <h3 style="margin:16px 0 8px;font-size:13px;">Add a mapping</h3>
        <div class="grid grid-2">
          <div class="field"><label>Analyser code</label><input id="map_code"></div>
          <div class="field"><label>LIS test</label><select id="map_test"><option value="">Select a test…</option>${options}</select></div>
        </div>
        <div class="field"><label>Unit as the analyser writes it (leave blank if it is the same as the catalog unit)</label><input id="map_units"></div>
        <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;"><input type="checkbox" id="map_blank"> This analyser sends no unit for this test — accept it as the catalog unit</label>
        <p class="muted" style="font-size:12px;">Only enter a different unit spelling when it means exactly the same unit. A result in any other unit is held for review, never converted.</p>
        <div class="actions-row"><button class="btn" onclick="saveInstrumentMap('${id}')">Add Mapping</button><button class="btn btn-outline" onclick="closeModal();render();">Done</button></div>
      </div>
    </div>`;
  });
}
async function saveInstrumentMap(id){
  const instrumentCode = (document.getElementById('map_code').value||'').trim();
  const testCode = document.getElementById('map_test').value;
  if(!instrumentCode || !testCode){ showToast('Enter the analyser code and choose a test.'); return; }
  await withErrorToast(async ()=>{
    await api.createInstrumentMap(id, { instrumentCode, testCode, units:(document.getElementById('map_units').value||'').trim(), acceptBlankUnit:document.getElementById('map_blank').checked });
    await openInstrumentMapsModal(id);
  });
}
async function deleteInstrumentMap(id, mapId){
  if(!await confirmAction({title:'Remove this test-code mapping?', body:'The test will no longer be sent to this analyser, and results with this analyser code will be held for review until it is mapped again.', confirmLabel:'Remove mapping'})) return;
  await withErrorToast(async ()=>{ await api.deleteInstrumentMap(id, mapId); await openInstrumentMapsModal(id); });
}

