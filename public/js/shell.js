/* ============================= SHELL / ROUTER ============================= */
// Line drawings for the section rail, 24×24, drawn in the text colour.
const NAV_ICONS = {
  home:'<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  flow:'<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 12h3"/>',
  tube:'<path d="M9 3h6"/><path d="M10 3v14a2 2 0 0 0 4 0V3"/><path d="M10 11h4"/>',
  check:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  flask:'<path d="M9 3h6"/><path d="M10 3v6l-5 10a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7.5 15h9"/>',
  report:'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h7M9 16h7"/>',
  folder:'<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><circle cx="12" cy="13" r="2"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};
function navIcon(name){ return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_ICONS[name]||''}</svg>`; }
function renderShell(){
  const navEl = document.getElementById('nav');
  const items = navItemsForRole();
  if(!items.some(n=>n.id===state.activeView)) state.activeView = 'dashboard';
  navEl.innerHTML = items.map(n=>`<button class="${state.activeView===n.id?'active':''}" ${state.activeView===n.id?'aria-current="page"':''} onclick="goTo('${n.id}')">${navIcon(n.icon)}<span>${escapeHtml(n.label)}</span></button>`).join('');

  const f = fac(session.user.facilityId);
  document.getElementById('topbarFacility').innerHTML = `<div class="facility-name">${escapeHtml(f.name)}</div>`;

  document.getElementById('topbarUser').innerHTML = `
    <div class="user-text">
      <div class="user-name">${escapeHtml(session.user.name)}</div>
      <div class="user-role">${escapeHtml(session.user.roleLabel || ROLE_LABELS[session.user.role] || session.user.role)}</div>
    </div>
    <button class="btn btn-sm btn-logout" onclick="doLogout()">Log out</button>`;
}
function openSidebar(){ document.getElementById('nav').classList.add('open'); document.getElementById('sidebarOverlay').classList.add('open'); }
function closeSidebar(){ document.getElementById('nav').classList.remove('open'); document.getElementById('sidebarOverlay').classList.remove('open'); }
// The scan field at the top: a memo, specimen, hospital or ID number (or a name) opens the report
// desk on what matches. Someone without the Reports section is taken to Sample Acceptance instead.
async function submitScan(){
  const el = document.getElementById('scanField');
  const value = (el.value||'').trim();
  if(!value) return;
  el.value = '';
  closeSidebar();
  if(hasCapability('view_reports')){
    deskQuery = value; deskSelected = null; deskFilter = '';
    state.activeView = 'reports'; saveSession();
    await render();
  }else if(hasCapability('accept')){
    state.activeView = 'acceptance'; saveSession();
    await render();
    const field = document.getElementById('acceptScanField');
    if(field){ field.value = value; scanSpecimenForAcceptance(); }
  }
}
document.addEventListener('keydown', e=>{
  if(e.key!=='F2' || !session.token) return;
  e.preventDefault();
  const el = document.getElementById('scanField');
  if(el){ el.focus(); el.select(); }
});
function goTo(view){ state.activeView = view; saveSession(); render(); closeSidebar(); }
function goToProcessing(tab, statusFilter){ state.activeView = 'processing'; processingTab = tab; processingStatusFilter = statusFilter || ''; analyserScanResult = null; render(); closeSidebar(); }
function goToReports(tab){ state.activeView = 'reports'; reportsTab = tab; render(); closeSidebar(); }
function newMemoFocus(){ state.activeView='collection'; render().then(()=>{ const el=document.getElementById('memoFetchField'); if(el) el.focus(); }); closeSidebar(); }

let renderSeq = 0;
// opts.cached — redraw from data already loaded (search and filter changes).
// opts.quiet  — background refresh: no dimming, and the cursor is left where it is.
async function render(opts){
  opts = opts || {};
  renderShell();
  const c = document.getElementById('content');
  const seq = ++renderSeq;
  if(!c.innerHTML.trim()) c.innerHTML = `<div class="card muted">Loading…</div>`;
  else if(!opts.cached && !opts.quiet) c.classList.add('busy'); // the old screen stays readable while the new one loads
  renderingFromCache = !!opts.cached;
  try{
    let html = '';
    if(state.activeView==='processflow') html = await viewProcessFlow();
    else if(state.activeView==='dashboard') html = await viewDashboard();
    else if(state.activeView==='collection') html = await viewCollectionPage();
    else if(state.activeView==='acceptance') html = await viewAcceptancePage();
    else if(state.activeView==='processing') html = await viewProcessingPage();
    else if(state.activeView==='reports') html = await viewReportsPage();
    else if(state.activeView==='patients') html = await viewPatientsPage();
    else if(state.activeView==='settings') html = await viewSettings();
    if(seq!==renderSeq) return; // a newer draw has started; this one is out of date
    const act = document.activeElement;
    const keep = (opts.cached && act && act.id && c.contains(act)) ? {id:act.id, start:act.selectionStart, end:act.selectionEnd} : null;
    c.innerHTML = html;
    if(keep){
      const el = document.getElementById(keep.id);
      if(el){ el.focus(); try{ el.setSelectionRange(keep.start, keep.end); }catch(e){ /* not a text field */ } }
    }
  }catch(e){
    if(seq!==renderSeq || !session.token) return;
    c.innerHTML = `<div class="card" style="border-color:var(--crimson-bg);"><h2 style="color:var(--crimson);">This screen could not be loaded</h2><p class="muted">${escapeHtml(e.message)}</p><button class="btn btn-sm" onclick="render()">Try again</button></div>`;
  }finally{
    if(seq===renderSeq){ renderingFromCache = false; c.classList.remove('busy'); }
  }
  if(!opts.cached && !opts.quiet) focusPrimaryField();
}
function renderCached(){ return render({cached:true}); }
// Scan-first screens start with the cursor in the scan field; an open specimen starts in its first
// result field. Skipped on phones (it would pop the keyboard up) and while a dialog is open.
function focusPrimaryField(){
  if(window.innerWidth<=860 || document.getElementById('modalRoot').innerHTML.trim() || document.getElementById('confirmRoot').innerHTML.trim()) return;
  const id = state.activeView==='collection' ? 'memoFetchField'
    : state.activeView==='acceptance' ? 'acceptScanField'
    : state.activeView==='processing' && processingTab==='analyser' ? 'procSearch' : null;
  const el = (state.activeView==='processing' && document.querySelector('#content .result-input')) || (id && document.getElementById(id));
  if(el) el.focus();
}
// Worklists refresh by themselves once a minute so new samples, waiting times and overdue critical
// values stay current — but never while someone is typing, has a result half-entered, or has a
// dialog open.
setInterval(()=>{
  if(!session.token || !['dashboard','processflow','acceptance','processing'].includes(state.activeView)) return;
  if(document.getElementById('modalRoot').innerHTML.trim() || document.getElementById('confirmRoot').innerHTML.trim()) return;
  const active = document.activeElement;
  if(active && ['INPUT','TEXTAREA','SELECT'].includes(active.tagName) && (active.value||'').trim()) return;
  if([...document.querySelectorAll('#content .result-input')].some(el=>(el.value||'').trim())) return;
  render({quiet:true});
}, 60000);

// Keyboard and screen-reader access for things built as clickable blocks (tabs, order cards,
// specimen rows): they become focusable and answer Enter/Space; every field label is tied to its
// field. Applied to whatever is drawn, whenever it is drawn.
let fieldIdSeq = 0;
function enhanceAccessibility(root){
  root.querySelectorAll('[onclick]').forEach(el=>{
    if(['BUTTON','A','INPUT','SELECT','TEXTAREA','LABEL'].includes(el.tagName) || el.hasAttribute('tabindex')) return;
    el.setAttribute('tabindex','0'); el.setAttribute('role', el.classList.contains('tab')||el.classList.contains('subtab') ? 'tab' : 'button');
    if(el.classList.contains('active')) el.setAttribute('aria-selected','true');
  });
  root.querySelectorAll('.field').forEach(field=>{
    const label = field.querySelector(':scope > label');
    const input = field.querySelector('input:not([type=checkbox]):not([type=radio]),select,textarea');
    if(!label || !input || label.htmlFor || label.contains(input)) return;
    if(!input.id) input.id = 'fld_' + (++fieldIdSeq);
    label.htmlFor = input.id;
  });
}
document.addEventListener('keydown', e=>{
  if(e.key!=='Enter' && e.key!==' ') return;
  const el = e.target;
  if(el && el.getAttribute && el.hasAttribute('onclick') && ['button','tab'].includes(el.getAttribute('role'))){ e.preventDefault(); el.click(); }
});
window.addEventListener('DOMContentLoaded', ()=>{
  ['content','modalRoot','loginScreen'].forEach(id=>{
    const root = document.getElementById(id);
    new MutationObserver(()=>enhanceAccessibility(root)).observe(root, {childList:true, subtree:true});
  });
});

