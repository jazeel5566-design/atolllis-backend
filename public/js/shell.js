/* ============================= SHELL / ROUTER ============================= */
function renderShell(){
  const navEl = document.getElementById('nav');
  const items = navItemsForRole();
  if(!items.some(n=>n.id===state.activeView)) state.activeView = 'dashboard';
  navEl.innerHTML = items.map(n=>`<button class="${state.activeView===n.id?'active':''}" ${state.activeView===n.id?'aria-current="page"':''} onclick="goTo('${n.id}')">${n.label}</button>`).join('');

  const f = fac(session.user.facilityId);
  document.getElementById('topbarFacility').innerHTML = `<div class="facility-name">${escapeHtml(f.name)}</div>`;

  document.getElementById('topbarUser').innerHTML = `
    <div style="text-align:right;">
      <div class="user-name">${escapeHtml(session.user.name)}</div>
      <div class="user-role">${escapeHtml(session.user.roleLabel || ROLE_LABELS[session.user.role] || session.user.role)}</div>
    </div>
    <button class="btn btn-sm btn-logout" onclick="doLogout()">Log Out</button>`;
}
function openSidebar(){ document.getElementById('topbarMain').classList.add('open'); document.getElementById('sidebarOverlay').classList.add('open'); }
function closeSidebar(){ document.getElementById('topbarMain').classList.remove('open'); document.getElementById('sidebarOverlay').classList.remove('open'); }
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

