/* Chasiq — local-first collection tracker. No login, no server. All data in IndexedDB. */
(function(){
'use strict';

/* Offline-first: cache the app shell so it loads with no connection. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}

/* ============================== utilities ============================== */
const $ = (sel, el) => (el||document).querySelector(sel);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);

function toast(msg){
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  $('#toast-root').appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .4s'; setTimeout(()=>t.remove(), 400); }, 2200);
}
function modal(html){
  const root = $('#modal-root');
  const veil = document.createElement('div');
  veil.className = 'modal-veil';
  veil.innerHTML = '<div class="modal">' + html + '</div>';
  veil.addEventListener('click', e => { if(e.target === veil) closeModal(); });
  root.appendChild(veil);
  return veil;
}
function closeModal(){ $('#modal-root').innerHTML=''; }
function download(filename, text, mime){
  const b = new Blob([text], {type: mime||'application/octet-stream'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

/* ============================== database ============================== */
const DB_NAME = 'chasiq', DB_VER = 1;
let db = null;
function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if(!d.objectStoreNames.contains('collection')) d.createObjectStore('collection', {keyPath:'id', autoIncrement:true});
      if(!d.objectStoreNames.contains('wishlist')) d.createObjectStore('wishlist', {keyPath:'cid'});
      if(!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', {keyPath:'k'});
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}
function tx(store, mode){ return db.transaction(store, mode||'readonly').objectStore(store); }
function all(store){ return new Promise((res, rej)=>{ const r = tx(store).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); }
function put(store, val){ return new Promise((res, rej)=>{ const r = tx(store,'readwrite').put(val); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function del(store, key){ return new Promise((res, rej)=>{ const r = tx(store,'readwrite').delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
function kvGet(k){ return new Promise((res)=>{ const r = tx('kv').get(k); r.onsuccess=()=>res(r.result?r.result.v:null); r.onerror=()=>res(null); }); }
function kvSet(k, v){ return put('kv', {k, v}); }

/* ============================== catalog ============================== */
function catalog(){ return (window.DC_CATALOG||[]); }
function catById(cid){ return catalog().find(c=>c.id===cid); }
function brands(){ const s=new Set(); catalog().forEach(c=>s.add(c.brand)); return [...s].sort(); }
function seriesFor(brand){
  const s=new Set();
  catalog().forEach(c=>{ if(!brand||c.brand===brand) s.add(c.series); });
  return [...s].sort();
}
function yearsFor(brand, series){
  const s=new Set();
  catalog().forEach(c=>{ if((!brand||c.brand===brand)&&(!series||c.series===series) && c.year) s.add(c.year); });
  return [...s].sort((a,b)=>b-a);
}
function seriesGroups(){
  const m = {};
  catalog().forEach(c=>{ const k=c.brand+'|||'+c.series; (m[k]=m[k]||[]).push(c); });
  return Object.keys(m).sort().map(k=>({key:k, brand:k.split('|||')[0], series:k.split('|||')[1], items:m[k]}));
}

/* ============================== state ============================== */
const S = {
  tab:'catalog',
  f:{ q:'', brand:'', series:'', year:'' },
  detailId:null, detailTab:null,
  scanStream:null, scanRAF:0,
};

/* ============================== photos ============================== */
function fileToPhoto(file, maxDim){
  maxDim = maxDim||1200;
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = ()=>{
      let w=img.width, h=img.height;
      const sc = Math.min(1, maxDim/Math.max(w,h));
      w=Math.round(w*sc); h=Math.round(h*sc);
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', .82));
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}
function pickPhoto(cb){
  const inp = document.createElement('input');
  inp.type='file'; inp.accept='image/*';
  inp.onchange = async ()=>{
    if(!inp.files||!inp.files[0]) return;
    try{ cb(await fileToPhoto(inp.files[0])); }
    catch(e){ toast('Could not read that photo'); }
  };
  inp.click();
}

/* ============================== catalog images ============================== */
/* Wiki-sourced hotlinked images (c.img). Never a broken-image icon: onerror
   swaps in a styled placeholder tile. */
window.__chasiqImgErr = function(el){
  const d = document.createElement('div');
  d.className = el.dataset.phcls || 'cimg-ph';
  d.setAttribute('aria-hidden','true');
  d.textContent = el.dataset.ph || '🚗';
  el.replaceWith(d);
};
function brandInitial(c){ return (((c.brand||'?').trim().charAt(0))||'🚗').toUpperCase(); }
function catImgHTML(c, big){
  const initial = esc(brandInitial(c));
  const cls = big ? 'cimg big' : 'cimg';
  const phcls = big ? 'cimg-ph big' : 'cimg-ph';
  if(c.img){
    return `<div class="${cls}"><img loading="lazy" src="${c.img}" alt="${esc(c.name)}" data-ph="${initial}" data-phcls="${phcls}" onerror="__chasiqImgErr(this)"></div>`;
  }
  return `<div class="${cls}"><div class="${phcls}" aria-hidden="true">${initial}</div></div>`;
}
function thumbHTML(c, emoji){
  if(c.img) return `<img class="g-thumb" src="${c.img}" alt="" loading="lazy" data-ph="${emoji||'🚗'}" data-phcls="g-thumb ph" onerror="__chasiqImgErr(this)">`;
  return `<div class="g-thumb ph">${emoji||'🚗'}</div>`;
}

/* ============================== tabs ============================== */
const TABS = ['catalog','collection','wishlist','stats','history','more'];
function go(tab, arg){
  S.tab = tab;
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  window.scrollTo(0,0);
  if(tab==='catalog') renderCatalog();
  else if(tab==='collection') renderCollection();
  else if(tab==='wishlist') renderWishlist();
  else if(tab==='stats') renderStats();
  else if(tab==='history') renderHistory();
  else if(tab==='histbrand') renderHistoryDetail(arg);
  else if(tab==='catdetail') renderCatDetail(arg);
  else if(tab==='more') renderMore();
  else if(tab==='detail') renderDetail(arg);
}
document.addEventListener('DOMContentLoaded', ()=>{
  document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click', ()=>go(b.dataset.tab)));
  $('#hdr-scan').addEventListener('click', openScanner);
  openDB().then(()=>go('catalog')).catch(()=>{ $('#view').innerHTML='<div class="notice">IndexedDB is unavailable in this browser — the app cannot store your collection.</div>'; });
});
document.addEventListener('click', e=>{
  const t = e.target.closest('[data-go]');
  if(t){ go(t.dataset.go, t.dataset.arg||null); }
});

/* ============================== catalog view ============================== */
function renderCatalog(){
  const f = S.f, br = brands();
  const v = $('#view');
  v.innerHTML = `
    <div class="notice">📚 <b>${catalog().length.toLocaleString()} castings</b> across ${br.length} brands — sourced from collector wikis, growing every release. Tap 📚 History for the stories behind the brands.</div>
    <input id="f-q" class="search" placeholder="🔍 Search casting, series…" value="${esc(f.q)}">
    <div class="chips" id="f-brands">
      <button class="chip ${!f.brand?'on':''}" data-b="">All brands</button>
      ${br.map(b=>`<button class="chip ${f.brand===b?'on':''}" data-b="${esc(b)}">${esc(b)}</button>`).join('')}
    </div>
    <div class="row2">
      <select id="f-series"><option value="">All series</option>
        ${seriesFor(f.brand).map(s=>`<option ${f.series===s?'selected':''} value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
      <select id="f-year"><option value="">All years</option>
        ${yearsFor(f.brand,f.series).map(y=>`<option ${String(f.year)===String(y)?'selected':''}>${y}</option>`).join('')}</select>
    </div>
    <div class="count-line" id="f-count"></div>
    <div class="grid" id="f-grid"></div>`;
  const apply = ()=>{
    const q = f.q.trim().toLowerCase();
    const list = catalog().filter(c =>
      (!f.brand || c.brand===f.brand) &&
      (!f.series || c.series===f.series) &&
      (!f.year || String(c.year)===String(f.year)) &&
      (!q || (c.name+' '+c.series+' '+c.brand).toLowerCase().includes(q)));
    const CAP = 300;
    const shown = list.slice(0, CAP);
    $('#f-count').textContent = list.length.toLocaleString() + ' casting' + (list.length===1?'':'s')
      + (list.length>CAP ? ` — showing first ${CAP}, refine your search` : '');
    $('#f-grid').innerHTML = shown.map(c=>`
      <div class="card" data-cat="${c.id}">
        <div class="cbrand">${esc(c.brand)}</div>
        ${catImgHTML(c)}
        <div class="cname">${esc(c.name)}</div>
        <div class="cmeta">${esc(c.series)} · ${esc(c.year)}${c.debut && c.debut!=c.year ? ' · debut '+esc(c.debut) : ''}</div>
        <div class="cscale">${esc(c.scale)}</div>
        <div class="crow">
          <button class="btn pri sm" data-add="${c.id}">+ Garage</button>
          <button class="btn sec sm" data-wish="${c.id}">☆ Wish</button>
        </div>
      </div>`).join('') || '<div class="notice">No castings match those filters.</div>';
  };
  $('#f-q').addEventListener('input', e=>{ f.q=e.target.value; apply(); });
  $('#f-brands').addEventListener('click', e=>{
    const b=e.target.closest('[data-b]'); if(!b) return;
    f.brand=b.dataset.b; f.series=''; f.year='';
    document.querySelectorAll('#f-brands .chip').forEach(x=>x.classList.toggle('on', x===b));
    renderCatalogKeepQ();
  });
  $('#f-series').addEventListener('change', e=>{ f.series=e.target.value; f.year=''; renderCatalogKeepQ(); });
  $('#f-year').addEventListener('change', e=>{ f.year=e.target.value; apply(); });
  if(!v.dataset.catBound){ v.addEventListener('click', onCardButtons); v.dataset.catBound='1'; }
  apply();

  function renderCatalogKeepQ(){
    const q = f.q;
    renderCatalog();
    $('#f-q').value = q;
  }
}
function onCardButtons(e){
  const a = e.target.closest('[data-add]'), w = e.target.closest('[data-wish]');
  if(a){ addToCollection(a.dataset.add); }
  else if(w){ addToWishlist(w.dataset.wish); }
  else if(!e.target.closest('.mate-strip')){ const card = e.target.closest('[data-cat]'); if(card) go('catdetail', card.dataset.cat); }
}
async function addToCollection(cid, extra){
  const c = catById(cid); if(!c) return;
  const item = Object.assign({
    cid, brand:c.brand, name:c.name, series:c.series, year:c.year, scale:c.scale,
    qty:1, condition:'Loose – Mint', price:'', date:'', notes:'', upc:'', photos:[], addedAt:new Date().toISOString()
  }, extra||{});
  const id = await put('collection', item);
  toast('Added to your garage 🏠');
  return id;
}
async function addToWishlist(cid){
  const c = catById(cid); if(!c) return;
  const have = await all('wishlist');
  if(have.some(x=>x.cid===cid)){ toast('Already on your wishlist'); return; }
  await put('wishlist', {cid, addedAt:new Date().toISOString()});
  toast('Added to wishlist ⭐');
}

/* ============================== catalog detail view ============================== */
async function renderCatDetail(cid){
  const c = catById(cid);
  const v = $('#view');
  if(!c){ v.innerHTML='<div class="notice">That casting is gone.</div><button class="btn sec" data-go="catalog">← Catalog</button>'; return; }
  const [items, wish] = await Promise.all([all('collection'), all('wishlist')]);
  const owned = items.filter(i=>i.cid===cid).reduce((n,i)=>n+(+i.qty||1),0);
  const wished = wish.some(w=>w.cid===cid);
  const hIx = (window.DC_HISTORY||[]).findIndex(h=>h.brand===c.brand);
  const h = hIx>=0 ? window.DC_HISTORY[hIx] : null;
  const matesAll = catalog().filter(x=>x.id!==cid && x.brand===c.brand && x.series===c.series);
  const mates = matesAll.slice(0,24);
  v.innerHTML = `
    <button class="btn ghost sm" data-go="catalog">← Catalog</button>
    <div style="height:10px"></div>
    ${catImgHTML(c, true)}
    <h2 style="font-size:20px;margin:10px 0 4px">${esc(c.name)}</h2>
    <div><span class="badge brand">${esc(c.brand)}</span></div>
    <div class="mut small" style="margin-top:6px">${esc(c.series)} · ${c.year||'—'} · ${esc(c.scale)}${c.debut && c.debut!=c.year ? ' · debut '+esc(c.debut) : ''}</div>
    ${owned?`<div class="notice" style="margin-top:10px">🏠 In your garage × ${owned}</div>`:''}
    <div class="row2" style="margin-top:10px">
      <button class="btn pri" id="cd-add" style="flex:1">+ Garage</button>
      <button class="btn sec" id="cd-wish" style="flex:1">${wished?'★ Wished':'☆ Wish'}</button>
    </div>
    <div class="sec-title">About this casting</div>
    <div class="form small" style="line-height:1.55">
      ${c.debut?`<div style="margin-bottom:8px">🎂 <b>Debut:</b> first released in ${esc(c.debut)}.</div>`:''}
      ${h?`<div>${esc(h.story.split('. ').slice(0,3).join('. '))}.</div>
      <div style="margin-top:8px"><button class="btn ghost sm" data-go="histbrand" data-arg="${hIx}">📚 Full ${esc(h.brand)} history →</button></div>`
      :'<div class="mut">No history notes yet for this brand.</div>'}
      <div class="small mut" style="margin-top:8px">Catalog photo: community wiki. Your own garage photos always take precedence in the Garage tab.</div>
    </div>
    ${mates.length?`<div class="sec-title">More from ${esc(c.series)} (${matesAll.length})</div>
    <div class="mate-strip">${mates.map(m=>`
      <div class="mate" data-cat="${m.id}">${catImgHTML(m)}<div class="mn">${esc(m.name)}</div></div>`).join('')}</div>`:''}
    <div style="height:24px"></div>`;
  $('#cd-add').addEventListener('click', async ()=>{ await addToCollection(cid); renderCatDetail(cid); });
  $('#cd-wish').addEventListener('click', async ()=>{
    const wl = await all('wishlist');
    if(wl.some(w=>w.cid===cid)){ if(confirm('Remove from wishlist?')) await del('wishlist', cid); }
    else await addToWishlist(cid);
    renderCatDetail(cid);
  });
  const strip = v.querySelector('.mate-strip');
  if(strip) strip.addEventListener('click', e=>{
    const m = e.target.closest('[data-cat]'); if(m) go('catdetail', m.dataset.cat);
  });
}

/* ============================== collection view ============================== */
const CONDITIONS = ['Carded – Mint','Carded – Near Mint','Carded – Good','Loose – Mint','Loose – Excellent','Loose – Played','Custom / Repaint','Other'];
async function renderCollection(){
  const items = await all('collection');
  items.sort((a,b)=>(b.addedAt||'').localeCompare(a.addedAt||''));
  const pieces = items.reduce((n,i)=>n+(+i.qty||1),0);
  const v = $('#view');
  v.innerHTML = `
    <div class="stat-tiles">
      <div class="tile"><div class="tv">${pieces}</div><div class="tl">pieces</div></div>
      <div class="tile"><div class="tv">${items.length}</div><div class="tl">unique castings</div></div>
    </div>
    <div class="sec-title">My garage</div>
    <div class="notice">Tap a car to edit it, add photos, or scan its barcode. <b>+ Custom</b> adds a car not in the catalog yet.</div>
    <button class="btn sec block" id="btn-custom">＋ Add custom car (not in catalog)</button>
    <div style="height:10px"></div>
    <div id="g-list">${items.map(gItemHTML).join('') || '<div class="notice">Your garage is empty. Add cars from the Catalog tab 📦</div>'}</div>
    <button class="btn pri block" id="btn-scan2">📷 Scan a barcode</button>`;
  $('#btn-scan2').addEventListener('click', openScanner);
  $('#btn-custom').addEventListener('click', openCustomAdd);
  $('#g-list').addEventListener('click', e=>{
    const g = e.target.closest('[data-g]'); if(g) go('detail', +g.dataset.g);
  });
}
function gItemHTML(it){
  const ph = (it.photos&&it.photos[0])
    ? `<img class="g-thumb" src="${it.photos[0]}" alt="">`
    : `<div class="g-thumb ph">🚗</div>`;
  return `<div class="g-item" data-g="${it.id}">${ph}
    <div class="g-info"><div class="n">${esc(it.name)}</div>
    <div class="m">${esc(it.brand)} · ${esc(it.series)} · ${esc(it.year)}</div>
    <div class="m mut">${esc(it.condition||'')}</div></div>
    <div class="g-qty">×${esc(it.qty||1)}</div></div>`;
}
function openCustomAdd(prefill){
  const br = brands();
  prefill = prefill||{};
  const veil = modal(`<h3>＋ ${prefill.ai?'Confirm identified car':'Custom car'}</h3>
    ${prefill.ai?'<div class="small mut" style="margin-bottom:8px">✨ Pre-filled from the AI identification. Review everything before saving — the AI can be wrong.</div>':''}
    <div class="form">
      <div class="frow"><label>Brand</label><select id="ca-brand">${br.map(b=>`<option ${prefill.brand===b?'selected':''}>${esc(b)}</option>`).join('')}<option ${!prefill.brand||prefill.brand==='Other'?'selected':''}>Other</option></select></div>
      <div class="frow"><label>Name *</label><input id="ca-name" placeholder="e.g. Custom '69 Camaro" value="${esc(prefill.name||'')}"></div>
      <div class="f2">
        <div class="frow"><label>Series</label><input id="ca-series" placeholder="e.g. Mainline" value="${esc(prefill.series||'')}"></div>
        <div class="frow"><label>Year</label><input id="ca-year" inputmode="numeric" placeholder="2024" value="${esc(prefill.year||'')}"></div>
      </div>
      <div class="frow"><label>Scale</label><input id="ca-scale" value="${esc(prefill.scale||'1:64')}"></div>
      <button class="btn pri block" id="ca-save">Add to garage</button>
      <button class="btn ghost block" id="ca-cancel">Cancel</button>
    </div>`);
  veil.querySelector('#ca-cancel').onclick = closeModal;
  veil.querySelector('#ca-save').onclick = async ()=>{
    const name = veil.querySelector('#ca-name').value.trim();
    if(!name){ toast('Give the car a name'); return; }
    await put('collection', {
      cid:prefill.cid||null,
      brand:veil.querySelector('#ca-brand').value, name,
      series:veil.querySelector('#ca-series').value.trim()||'Custom',
      year:veil.querySelector('#ca-year').value.trim()||'—',
      scale:veil.querySelector('#ca-scale').value.trim()||'1:64',
      qty:1, condition:'Loose – Mint', price:'', date:'',
      notes:prefill.notes||'', upc:'', photos:prefill.photo?[prefill.photo]:[],
      addedAt:new Date().toISOString(), custom:!prefill.cid, aiIdentified:!!prefill.ai
    });
    closeModal(); toast('Added to your garage 🏠'); renderCollection();
  };
}

/* ============================== detail view ============================== */
async function renderDetail(id){
  const items = await all('collection');
  const it = items.find(x=>x.id===id);
  const v = $('#view');
  if(!it){ v.innerHTML='<div class="notice">That car is gone.</div><button class="btn sec" data-go="collection">← Back</button>'; return; }
  const apiKey = await kvGet('ebayKey');
  const ph = (it.photos&&it.photos[0]) ? `<img class="big" src="${it.photos[0]}" alt="">` : `<div class="big g-thumb ph">🚗</div>`;
  v.innerHTML = `
    <button class="btn ghost sm" data-go="collection">← Garage</button>
    <div style="height:10px"></div>
    <div class="detail-head">${ph}
      <div><h2 style="font-size:18px">${esc(it.name)}</h2>
      <div class="mut small">${esc(it.brand)} · ${esc(it.series)} · ${esc(it.year)} · ${esc(it.scale)}</div>
      ${it.upc?`<div class="small mut">UPC ${esc(it.upc)}</div>`:''}</div>
    </div>

    <div class="sec-title">Photos</div>
    <div class="photos" id="d-photos">
      ${(it.photos||[]).map((p,i)=>`<img src="${p}" data-ph="${i}" alt="photo ${i+1}">`).join('')}
      <button class="photo-add" id="d-addphoto" title="Add photo">＋</button>
    </div>
    <button class="btn sec block" id="d-identify">✨ Identify from photo</button>

    <div class="sec-title">Details</div>
    <div class="form">
      <div class="f2">
        <div class="frow"><label>Quantity</label><input id="d-qty" type="number" min="1" value="${esc(it.qty||1)}"></div>
        <div class="frow"><label>Condition</label><select id="d-cond">${CONDITIONS.map(c=>`<option ${it.condition===c?'selected':''}>${c}</option>`).join('')}</select></div>
      </div>
      <div class="f2">
        <div class="frow"><label>Paid ($)</label><input id="d-price" inputmode="decimal" value="${esc(it.price||'')}" placeholder="0.00"></div>
        <div class="frow"><label>Date acquired</label><input id="d-date" type="date" value="${esc(it.date||'')}"></div>
      </div>
      <div class="frow"><label>Notes</label><textarea id="d-notes" placeholder="Where you found it, variant details…">${esc(it.notes||'')}</textarea></div>
      <div class="frow"><label>UPC / barcode</label><input id="d-upc" value="${esc(it.upc||'')}" placeholder="Scan or type"></div>
      <div class="row2">
        <button class="btn pri" id="d-save" style="flex:1">💾 Save</button>
        <button class="btn danger" id="d-del">🗑</button>
      </div>
    </div>

    <div class="sec-title">Market value <span class="badge soon">soon</span></div>
    <div class="stub-box"><span class="big">💹</span>
      ${apiKey
        ? 'eBay API key saved on this device. Live sold-price lookup is still being built — your key is stored locally and nothing is sent anywhere yet.'
        : 'Live sold-listing values need an eBay API key. Add one under More → Market values — no fake prices will ever be shown.'}
    </div>

    <div style="height:24px"></div>`;
  $('#d-addphoto').addEventListener('click', ()=>pickPhoto(async dataUrl=>{
    it.photos = (it.photos||[]).concat([dataUrl]);
    await put('collection', it); toast('Photo added 📸'); renderDetail(id);
  }));
  $('#d-photos').addEventListener('click', async e=>{
    const im = e.target.closest('[data-ph]'); if(!im) return;
    if(!confirm('Delete this photo?')) return;
    it.photos.splice(+im.dataset.ph,1); await put('collection', it); renderDetail(id);
  });
  $('#d-identify').addEventListener('click', ()=>identifyCarFlow(it));
  $('#d-save').addEventListener('click', async ()=>{
    it.qty = Math.max(1, +$('#d-qty').value||1);
    it.condition = $('#d-cond').value;
    it.price = $('#d-price').value.trim();
    it.date = $('#d-date').value;
    it.notes = $('#d-notes').value.trim();
    it.upc = $('#d-upc').value.trim();
    await put('collection', it); toast('Saved 💾');
  });
  $('#d-del').addEventListener('click', async ()=>{
    if(!confirm('Remove this car from your garage?')) return;
    await del('collection', it.id); toast('Removed'); go('collection');
  });
}

/* ============================== barcode scanner ============================== */
async function openScanner(){
  const supported = ('BarcodeDetector' in window);
  const veil = modal(`<h3>📷 Barcode scanner</h3>
    ${supported
      ? '<video id="scan-video" class="scan-video" playsinline muted></video><div class="scan-code" id="scan-code">point at a UPC…</div>'
      : '<div class="stub-box"><span class="big">🚫</span>This browser does not support on-device barcode detection.<br>Type the UPC into the car\'s detail page instead.</div>'}
    <div id="scan-actions" class="hidden">
      <button class="btn pri block" id="scan-use">Use this code</button>
    </div>
    <button class="btn ghost block" id="scan-close">Close</button>`);
  let scanned = null;
  veil.querySelector('#scan-close').onclick = stopScanner;
  async function stopScanner(){ 
    if(S.scanRAF) cancelAnimationFrame(S.scanRAF); S.scanRAF=0;
    if(S.scanStream){ S.scanStream.getTracks().forEach(t=>t.stop()); S.scanStream=null; }
    closeModal();
  }
  veil.querySelector('#scan-use').onclick = async ()=>{
    await stopScanner();
    if(scanned) afterScan(scanned);
  };
  if(!supported) return;
  try{
    const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}, audio:false});
    S.scanStream = stream;
    const video = veil.querySelector('#scan-video');
    video.srcObject = stream; await video.play();
    const det = new BarcodeDetector({formats:['ean_13','upc_a','upc_e','ean_8','code_128']});
    const loop = async ()=>{
      if(!S.scanStream) return;
      try{
        const codes = await det.detect(video);
        if(codes && codes.length){
          scanned = codes[0].rawValue;
          veil.querySelector('#scan-code').textContent = scanned;
          veil.querySelector('#scan-actions').classList.remove('hidden');
          if(navigator.vibrate) navigator.vibrate(60);
          return; // freeze on first hit
        }
      }catch(e){/* keep trying */}
      S.scanRAF = requestAnimationFrame(loop);
    };
    loop();
  }catch(e){
    veil.querySelector('#scan-code').textContent = 'camera unavailable: ' + e.name;
  }
  async function afterScan(code){
    const items = await all('collection');
    const hit = items.find(i=>i.upc===code);
    if(hit){ toast('Already in your garage ✅'); go('detail', hit.id); return; }
    const veil2 = modal(`<h3>Barcode: ${esc(code)}</h3>
      <div class="notice">No catalog entry carries UPCs yet, so we can't auto-match this code (and we won't guess). Pick the casting below, or add it as a custom car with this UPC saved.</div>
      <input id="sc-q" class="search" placeholder="🔍 Search the catalog…">
      <div id="sc-list" style="max-height:40vh;overflow-y:auto"></div>
      <button class="btn ghost block" id="sc-custom">＋ Add as custom car with this UPC</button>
      <button class="btn sec block" id="sc-cancel">Cancel</button>`);
    const paint = q=>{
      const list = catalog().filter(c=>!q||(c.name+' '+c.series+' '+c.brand).toLowerCase().includes(q.toLowerCase())).slice(0,30);
      veil2.querySelector('#sc-list').innerHTML = list.map(c=>
        `<div class="g-item" data-sc="${c.id}">${thumbHTML(c)}<div class="g-info"><div class="n">${esc(c.name)}</div><div class="m">${esc(c.brand)} · ${esc(c.series)}</div></div></div>`).join('')
        || '<div class="notice">No matches.</div>';
    };
    veil2.querySelector('#sc-q').addEventListener('input', e=>paint(e.target.value));
    paint('');
    veil2.querySelector('#sc-list').addEventListener('click', async e=>{
      const g=e.target.closest('[data-sc]'); if(!g) return;
      const id = await addToCollection(g.dataset.sc, {upc:code});
      closeModal(); go('detail', id);
    });
    veil2.querySelector('#sc-cancel').onclick = closeModal;
    veil2.querySelector('#sc-custom').onclick = async ()=>{
      const id = await put('collection', {cid:null, brand:'', name:'Scanned item', series:'', year:'', scale:'1:64',
        qty:1, condition:'Carded – Mint', price:'', date:'', notes:'', upc:code, photos:[], addedAt:new Date().toISOString(), custom:true});
      closeModal(); go('detail', id);
    };
  }
}

/* ============================== wishlist + series completion ============================== */
async function renderWishlist(){
  const [wish, items] = await Promise.all([all('wishlist'), all('collection')]);
  const ownedCids = new Set(items.map(i=>i.cid).filter(Boolean));
  const groups = seriesGroups().map(g=>{
    const owned = g.items.filter(c=>ownedCids.has(c.id)).length;
    return Object.assign({}, g, {owned, total:g.items.length});
  }).filter(g=>g.owned>0 || wish.some(w=>g.items.some(c=>c.id===w.cid)));
  groups.sort((a,b)=> (b.owned/b.total) - (a.owned/a.total));
  const v = $('#view');
  v.innerHTML = `
    <div class="sec-title">Series completion <span class="badge live">live</span></div>
    <div class="notice">Progress across the starter catalog. As the catalog grows, so does your hunt list. 🎯</div>
    <div id="prog-list">${groups.map(g=>`
      <div class="prog ${g.owned===g.total?'done':''}">
        <div class="ph"><b>${esc(g.series)}</b><span class="mut">${esc(g.brand)}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round(g.owned/g.total*100)}%"></div></div>
        <div class="ph" style="margin:6px 0 0"><span>${g.owned===g.total?'✅ Complete!':`You own ${g.owned} of ${g.total}`}</span><span class="mut">${g.total-g.owned} to hunt</span></div>
      </div>`).join('') || '<div class="notice">Add cars to your garage or wishlist and series progress will appear here.</div>'}</div>
    <div class="sec-title">Wishlist (${wish.length})</div>
    <div id="w-list">${wish.map(w=>{
      const c = catById(w.cid); if(!c) return '';
      return `<div class="g-item" data-w="${esc(w.cid)}">${thumbHTML(c,'⭐')}
        <div class="g-info"><div class="n">${esc(c.name)}</div><div class="m">${esc(c.brand)} · ${esc(c.series)} · ${esc(c.year)}</div></div>
        <button class="btn pri sm" data-wa="${esc(w.cid)}">+ Garage</button></div>`;
    }).join('') || '<div class="notice">Nothing on the wishlist yet. Tap ☆ on any catalog car.</div>'}</div>`;
  $('#w-list').addEventListener('click', async e=>{
    const add = e.target.closest('[data-wa]');
    if(add){ e.stopPropagation(); await del('wishlist', add.dataset.wa); await addToCollection(add.dataset.wa); renderWishlist(); return; }
    const row = e.target.closest('[data-w]');
    if(row){
      if(confirm('Remove from wishlist?')){ await del('wishlist', row.dataset.w); renderWishlist(); }
    }
  });
}

/* ============================== stats ============================== */
async function renderStats(){
  const items = await all('collection');
  const pieces = items.reduce((n,i)=>n+(+i.qty||1),0);
  const byBrand = {}, byYear = {};
  let spent = 0, spentKnown = 0;
  items.forEach(i=>{
    const q = +i.qty||1;
    byBrand[i.brand||'Other'] = (byBrand[i.brand||'Other']||0)+q;
    byYear[i.year||'—'] = (byYear[i.year||'—']||0)+q;
    const p = parseFloat(i.price);
    if(!isNaN(p)){ spent += p*q; spentKnown++; }
  });
  const bar = (obj, limit)=>{
    const entries = Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0, limit||12);
    const max = entries.length?entries[0][1]:1;
    return entries.map(([k,n])=>`<div class="bar-row"><div class="bl">${esc(k)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(n/max*100)}%"></div></div>
      <div class="bv">${n}</div></div>`).join('') || '<div class="notice">No data yet.</div>';
  };
  $('#view').innerHTML = `
    <div class="stat-tiles">
      <div class="tile"><div class="tv">${pieces}</div><div class="tl">total pieces</div></div>
      <div class="tile"><div class="tv">${items.length}</div><div class="tl">unique castings</div></div>
      <div class="tile"><div class="tv">${Object.keys(byBrand).length}</div><div class="tl">brands</div></div>
      <div class="tile"><div class="tv">$${spent.toFixed(0)}</div><div class="tl">spent${spentKnown<items.length?'*':''}</div></div>
    </div>
    ${spentKnown<items.length&&items.length?'<div class="small mut">*spend total only counts cars where you entered a price.</div>':''}
    <div class="sec-title">By brand</div><div class="form">${bar(byBrand)}</div>
    <div class="sec-title">By year</div><div class="form">${bar(byYear)}</div>`;
}

/* ============================== more: import / export / key / about ============================== */
function parseCSV(text){
  const rows=[]; let row=[], cur='', q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(q){
      if(ch==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else q=false; }
      else cur+=ch;
    }else{
      if(ch==='"') q=true;
      else if(ch===','){ row.push(cur); cur=''; }
      else if(ch==='\n'||ch==='\r'){ if(ch==='\r'&&text[i+1]==='\n')i++; row.push(cur); rows.push(row); row=[]; cur=''; }
      else cur+=ch;
    }
  }
  if(cur!==''||row.length){ row.push(cur); rows.push(row); }
  return rows.filter(r=>r.length&&r.some(c=>String(c).trim()!==''));
}
const CSV_COLS = ['name','brand','series','year','scale','quantity','condition','price','date','notes','upc'];
function renderMore(){
  const v = $('#view');
  v.innerHTML = `
    <div class="sec-title">📥 Import / 📤 Export</div>
    <div class="form">
      <div class="frow"><label>Import from CSV (Excel → Save as CSV)</label>
        <div class="small mut" style="margin-bottom:8px">Columns: ${CSV_COLS.join(', ')}. Header row optional — if the first row looks like headers it is skipped.</div>
        <button class="btn sec block" id="m-csv">Choose CSV file</button></div>
      <div class="frow"><label>Backup / restore (JSON)</label>
        <div class="row2">
          <button class="btn sec" id="m-exp" style="flex:1">⬇ Export JSON</button>
          <button class="btn sec" id="m-imp" style="flex:1">⬆ Import JSON</button>
        </div></div>
    </div>
    <div class="sec-title">💹 Market values <span class="badge soon">soon</span></div>
    <div class="form">
      <div class="frow"><label>eBay API key (stored only on this device)</label>
        <input id="m-key" type="password" placeholder="paste key when integration is live">
        <div class="small mut" style="margin:6px 0">Honest status: the live sold-price lookup is not built yet. Saving a key does nothing except store it locally for the day the integration ships. No fake prices, ever.</div>
        <div class="row2"><button class="btn sec" id="m-keysave" style="flex:1">Save key</button>
        <button class="btn ghost" id="m-keydel" style="flex:1">Clear</button></div></div>
    </div>
    <div class="sec-title">✨ AI visual ID</div>
    <div class="form">
      <div class="frow"><label>Google AI Studio key (stored only on this device)</label>
        <input id="m-vkey" type="password" placeholder="paste your AI Studio key">
        <div class="small mut" style="margin:6px 0">Free key: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. The key lives in this browser's local storage only — it is sent to Google's API and nowhere else. Photos are processed in memory and never uploaded to Chasiq (there are no Chasiq servers).</div>
        <div class="small mut" id="m-vstatus" style="margin:6px 0"></div>
        <div class="row2"><button class="btn sec" id="m-vkeysave" style="flex:1">Save key</button>
        <button class="btn ghost" id="m-vkeydel" style="flex:1">Clear</button></div></div>
    </div>
    <div class="sec-title">ℹ️ About</div>
    <div class="form">
      <div class="sec-title" style="margin-top:0">Live today ✅</div>
      ${['Multi-brand starter catalog ('+catalog().length+' verified castings, 8 brands)','Browse, search & filter by brand, series, year','My Garage: quantity, condition, price, dates, notes, photos','UPC barcode scanner for carded cars','✨ AI photo ID for loose cars (needs your free Google AI Studio key — More → AI visual ID)','Wishlist + series completion tracking','Stats dashboard','CSV import & JSON backup — everything stays on your device'].map(t=>`<div class="about-li"><span class="e">✅</span><span>${t}</span></div>`).join('')}
      <div class="sec-title">Coming soon 🔜</div>
      ${['Live market values from sold listings','Trade matching with nearby collectors','Hunt mode: release calendar + sighting alerts','Cloud sync across devices'].map(t=>`<div class="about-li"><span class="e">🔜</span><span>${t}</span></div>`).join('')}
      <div class="small mut" style="margin-top:8px">Chasiq MVP · 100% local-first · no account · no tracking. Your collection never leaves this device.</div>
    </div>`;
  $('#m-exp').addEventListener('click', async ()=>{
    const [c,w] = await Promise.all([all('collection'), all('wishlist')]);
    download('chasiq-backup.json', JSON.stringify({app:'chasiq', version:1, exportedAt:new Date().toISOString(), collection:c, wishlist:w}, null, 1), 'application/json');
    toast('Backup downloaded ⬇');
  });
  $('#m-imp').addEventListener('click', ()=>{
    const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json';
    inp.onchange = ()=>{
      const f=inp.files[0]; if(!f) return;
      const r=new FileReader();
      r.onload = async ()=>{
        try{
          const data=JSON.parse(r.result);
          if(!data||!Array.isArray(data.collection)) throw new Error('bad file');
          if(!confirm(`Import ${data.collection.length} cars and ${data.wishlist?data.wishlist.length:0} wishlist items? This adds to (does not replace) your data.`)) return;
          for(const it of data.collection){ const c=Object.assign({},it); delete c.id; await put('collection', c); }
          for(const wobj of (data.wishlist||[])){ try{ await put('wishlist', wobj); }catch(e){} }
          toast('Backup imported ✅'); 
        }catch(e){ toast('That file is not a Chasiq backup'); }
      };
      r.readAsText(f);
    };
    inp.click();
  });
  $('#m-csv').addEventListener('click', ()=>{
    const inp=document.createElement('input'); inp.type='file'; inp.accept='.csv,text/csv';
    inp.onchange = ()=>{
      const f=inp.files[0]; if(!f) return;
      const r=new FileReader();
      r.onload = async ()=>{
        try{
          const rows=parseCSV(r.result);
          if(!rows.length){ toast('CSV is empty'); return; }
          let start=0;
          const head=rows[0].map(c=>String(c).toLowerCase().trim());
          if(head.includes('name')||head.includes('brand')) start=1;
          let n=0;
          for(let i=start;i<rows.length;i++){
            const row=rows[i];
            const get=k=>{ const ix=CSV_COLS.indexOf(k); return ix<row.length?String(row[ix]).trim():''; };
            const name=get('name'); if(!name) continue;
            const qty=Math.max(1, parseInt(get('quantity'))||1);
            await put('collection', {
              cid:null, brand:get('brand')||'Other', name,
              series:get('series')||'Imported', year:get('year')||'—', scale:get('scale')||'1:64',
              qty, condition:get('condition')||'Loose – Mint', price:get('price'), date:get('date'),
              notes:get('notes'), upc:get('upc'), photos:[], addedAt:new Date().toISOString(), imported:true
            });
            n++;
          }
          toast(`Imported ${n} cars ✅`);
        }catch(e){ toast('Could not parse that CSV'); }
      };
      r.readAsText(f);
    };
    inp.click();
  });
  kvGet('ebayKey').then(k=>{ if(k) $('#m-key').value=k; });
  $('#m-keysave').addEventListener('click', async ()=>{
    const k=$('#m-key').value.trim();
    if(k) await kvSet('ebayKey', k); else await del('kv','ebayKey');
    toast(k?'Key saved locally 🔑':'Key cleared');
  });
  $('#m-keydel').addEventListener('click', async ()=>{ await del('kv','ebayKey'); $('#m-key').value=''; toast('Key cleared'); });
  // AI visual ID key (localStorage only — never IndexedDB, never transmitted except to Google)
  const vstat = $('#m-vstatus');
  const vkey = visionKey();
  if(vkey){ $('#m-vkey').value = vkey; vstat.innerHTML = '✅ Key saved on this device — photo ID is ready.'; }
  else { vstat.innerHTML = '⚪ No key saved — photo ID will ask you to add one.'; }
  $('#m-vkeysave').addEventListener('click', ()=>{
    const k = $('#m-vkey').value.trim();
    if(k){ setVisionKey(k); vstat.innerHTML = '✅ Key saved on this device — photo ID is ready.'; toast('Vision key saved 🔑'); }
    else { clearVisionKey(); vstat.innerHTML = '⚪ No key saved — photo ID will ask you to add one.'; toast('Key cleared'); }
  });
  $('#m-vkeydel').addEventListener('click', ()=>{ clearVisionKey(); $('#m-vkey').value=''; vstat.innerHTML = '⚪ No key saved — photo ID will ask you to add one.'; toast('Key cleared'); });
}

/* ============================== history ============================== */
const BRAND_EMOJI = { 'Hot Wheels':'🔥', 'Matchbox':'📦', 'Tomica':'🗾', 'M2 Machines':'🔧', 'GreenLight':'🚦', 'Mini GT':'🏁', 'Auto World':'🇺🇸', 'Kaido House':'🌊' };
function renderHistory(){
  const v = $('#view');
  const hist = window.DC_HISTORY||[];
  const counts = {}, yrMin = {}, yrMax = {};
  catalog().forEach(c=>{
    counts[c.brand]=(counts[c.brand]||0)+1;
    const y = parseInt(c.year)||0;
    if(y){ yrMin[c.brand]=Math.min(yrMin[c.brand]||9999,y); yrMax[c.brand]=Math.max(yrMax[c.brand]||0,y); }
  });
  v.innerHTML = `
    <div class="sec-title">📚 Brand histories</div>
    <div class="small mut" style="margin-bottom:10px">The stories behind the brands in your garage — researched from public sources. Tap a brand for the full story.</div>
    ${hist.map((h,i)=>`
      <div class="g-item" data-go="histbrand" data-arg="${i}">
        <div class="g-thumb ph">${BRAND_EMOJI[h.brand]||'🏎️'}</div>
        <div class="g-info"><div class="n">${esc(h.brand)}</div>
        <div class="m">Est. ${h.founded} · ${esc(h.founder)}</div>
        <div class="m mut">${(counts[h.brand]||0).toLocaleString()} castings in catalog${yrMin[h.brand]?` · ${yrMin[h.brand]}–${yrMax[h.brand]}`:''}</div></div>
        <div class="mut">›</div></div>`).join('')}
    <div class="sec-title">🔍 Data sources</div>
    <div class="form small">${(window.DC_SOURCES||[]).map(s=>`<div class="about-li"><span class="e">📖</span><span><b>${esc(s.name)}</b> — ${esc(s.what)} (${esc(s.via)})</span></div>`).join('')}</div>
    <div class="small mut" style="margin-top:8px">Catalog data comes from community-maintained collector wikis. Histories were researched Oct 2026 from Wikipedia, manufacturer sites, and hobby press.</div>`;
}
function renderHistoryDetail(ix){
  const h = (window.DC_HISTORY||[])[+ix];
  const v = $('#view');
  if(!h){ go('history'); return; }
  const items = catalog().filter(c=>c.brand===h.brand);
  const years = items.map(c=>parseInt(c.year)||0).filter(y=>y>0).sort((a,b)=>a-b);
  // castings per decade
  const decades = {};
  years.forEach(y=>{ const d = Math.floor(y/10)*10; decades[d]=(decades[d]||0)+1; });
  const maxD = Math.max(1, ...Object.values(decades));
  v.innerHTML = `
    <button class="btn ghost sm" data-go="history">← Histories</button>
    <div style="height:10px"></div>
    <h2 style="font-size:20px">${BRAND_EMOJI[h.brand]||'🏎️'} ${esc(h.brand)}</h2>
    <div class="small mut">Est. ${h.founded} · ${esc(h.founder)} · ${esc(h.hq)}</div>
    <div class="form" style="margin-top:10px"><div class="small" style="line-height:1.55">${esc(h.story)}</div></div>
    <div class="sec-title">Milestones</div>
    <div class="form">${h.milestones.map(m=>`<div class="about-li"><span class="e"><b>${m.year}</b></span><span>${esc(m.text)}</span></div>`).join('')}</div>
    <div class="sec-title">In the Chasiq catalog</div>
    <div class="stat-tiles">
      <div class="tile"><div class="tv">${items.length.toLocaleString()}</div><div class="tl">castings</div></div>
      <div class="tile"><div class="tv">${years.length?years[0]:'—'}</div><div class="tl">earliest</div></div>
      <div class="tile"><div class="tv">${years.length?years[years.length-1]:'—'}</div><div class="tl">latest</div></div>
    </div>
    ${Object.keys(decades).length?`<div class="form">${Object.keys(decades).sort().map(d=>`
      <div class="small" style="display:flex;align-items:center;gap:8px;margin:4px 0">
        <span style="width:44px" class="mut">${d}s</span>
        <span style="flex:1;background:rgba(255,255,255,.06);border-radius:4px"><span style="display:block;height:10px;border-radius:4px;background:linear-gradient(90deg,var(--acc),var(--acc2));width:${Math.round(decades[d]/maxD*100)}%"></span></span>
        <span style="width:52px;text-align:right" class="mut">${decades[d].toLocaleString()}</span>
      </div>`).join('')}</div>`:''}
    <div style="height:24px"></div>`;
}

/* ============================== AI visual ID ============================== */
/* Local-first: the key lives in this browser's localStorage only. It is sent
   to Google's Generative Language API and nowhere else. Photos are processed
   in memory; Chasiq has no servers to upload to. */
const VISION_LS_KEY = 'chasiq_vision_key';
const VISION_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const VISION_MODEL = 'gemini-3.8-flash';
function visionKey(){ try{ return localStorage.getItem(VISION_LS_KEY)||''; }catch(e){ return ''; } }
function setVisionKey(k){ try{ localStorage.setItem(VISION_LS_KEY, k); }catch(e){} }
function clearVisionKey(){ try{ localStorage.removeItem(VISION_LS_KEY); }catch(e){} }

const VISION_PROMPT = 'You are a die-cast model car expert. Look at this photo and identify the die-cast car. '
  + 'Return STRICT JSON only — no markdown, no commentary, just the JSON object: '
  + '{"casting":"<casting name as sold, e.g. \'Bone Shaker\'>","brand":"<one of: Hot Wheels, Matchbox, M2 Machines, GreenLight, Mini GT, Tomica, Auto World, Kaido House, Other>","series":"<series or line if visible, else empty string>","year":"<release year if you know it, else empty string>","confidence":<0-100>,"notes":"<what you actually see: color, tampos, wheels, carded or loose>"} '
  + 'If you cannot identify it, set casting to "" and confidence to 0. Never invent a casting name.';

async function callVisionIdentify(dataUrl, key){
  const res = await fetch(VISION_ENDPOINT, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+key },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 600,
      messages:[{ role:'user', content:[
        { type:'text', text:VISION_PROMPT },
        { type:'image_url', image_url:{ url:dataUrl } }
      ]}]
    })
  });
  if(!res.ok){
    const t = await res.text().catch(()=>'');
    throw new Error('vision-api-'+res.status+(t?': '+t.slice(0,160):''));
  }
  const j = await res.json();
  const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  const m = text.match(/\{[\s\S]*\}/);
  if(!m) throw new Error('vision-no-json');
  return JSON.parse(m[0]);
}

function normTok(s){ return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function fuzzyCandidates(casting, brand){
  const ct = normTok(casting).split(' ').filter(Boolean);
  if(!ct.length) return [];
  const bnorm = normTok(brand);
  return catalog().map(c=>{
    const nt = normTok(c.name).split(' ').filter(Boolean);
    let hit = 0;
    for(const t of ct){ if(nt.indexOf(t)>=0) hit++; }
    let score = hit/ct.length;
    if(normTok(c.name)===normTok(casting)) score += 1.5;      // exact name
    if(bnorm && normTok(c.brand)===bnorm) score += 0.35;      // brand bonus
    else if(bnorm && normTok(c.brand).indexOf(bnorm)>=0) score += 0.15;
    return { c:c, score:score, hit:hit };
  }).filter(x=>x.hit>0 && x.score>0.2).sort((a,b)=>b.score-a.score).slice(0,3);
}

async function identifyCarFlow(it){
  const photos = it.photos||[];
  if(!photos.length){ toast('Add a photo of the car first 📸'); return; }
  const key = visionKey();
  if(!key){
    modal(`<h3>✨ Identify from photo</h3>
      <div class="stub-box"><span class="big">🔑</span>
      <b>Photo ID needs your free Google AI Studio key.</b><br><br>
      Add it under <b>More → ✨ AI visual ID</b> (get one free at aistudio.google.com/apikey). The key stays on this device — it's only ever sent to Google's API.</div>
      <button class="btn sec block" id="vi-goset">Open AI visual ID settings</button>
      <button class="btn ghost block" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>`);
    document.getElementById('vi-goset').onclick = ()=>{ closeModal(); go('more'); };
    return;
  }
  const veil = modal(`<h3>✨ Identify from photo</h3>
    <div class="form">
      <div class="frow"><label>Photo to identify</label>
        <div class="photos" id="vi-pick">${photos.map((p,i)=>`<img src="${p}" data-vi="${i}" class="${i===0?'vi-sel':''}" alt="photo ${i+1}" style="${i===0?'outline:2px solid var(--acc)':''}">`).join('')}</div>
        <div class="small mut">Tap a photo to choose it, then Identify.</div></div>
      <div id="vi-result"></div>
      <button class="btn pri block" id="vi-go">🔍 Identify this car</button>
      <button class="btn ghost block" id="vi-cancel">Cancel</button>
    </div>`);
  let sel = 0;
  veil.querySelector('#vi-pick').addEventListener('click', e=>{
    const im = e.target.closest('[data-vi]'); if(!im) return;
    sel = +im.dataset.vi;
    veil.querySelectorAll('#vi-pick img').forEach(x=>x.style.outline='');
    im.style.outline = '2px solid var(--acc)';
  });
  veil.querySelector('#vi-cancel').onclick = closeModal;
  veil.querySelector('#vi-go').onclick = async ()=>{
    const btn = veil.querySelector('#vi-go'), out = veil.querySelector('#vi-result');
    btn.disabled = true; btn.textContent = '🧠 Asking the AI…';
    out.innerHTML = '<div class="small mut" style="margin:8px 0">Sending the photo to Google\'s vision model…</div>';
    try{
      const r = await callVisionIdentify(photos[sel], key);
      const conf = Math.max(0, Math.min(100, +r.confidence||0));
      if(!r.casting || conf===0){
        out.innerHTML = `<div class="stub-box"><span class="big">🤷</span><b>Couldn't identify it.</b><br><br>The AI couldn't confidently name this car.${r.notes?'<br><br>What it saw: '+esc(r.notes):''}<br><br>Try a clearer photo — front 3/4 angle, good light.</div>`;
        btn.disabled = false; btn.textContent = '🔍 Try again';
        return;
      }
      const cands = fuzzyCandidates(r.casting, r.brand);
      out.innerHTML = `
        <div class="vi-ai"><div class="small mut">AI identification <span class="badge">${conf}% confident</span></div>
        <div style="font-weight:700;font-size:16px;margin:4px 0">${esc(r.casting)}</div>
        <div class="small">${esc(r.brand||'')} ${r.series?'· '+esc(r.series):''} ${r.year?'· '+esc(r.year):''}</div>
        ${r.notes?`<div class="small mut" style="margin-top:6px">👁 ${esc(r.notes)}</div>`:''}</div>
        <div class="sec-title" style="margin-top:10px">Confirm against the catalog</div>
        ${cands.length ? cands.map((x,i)=>`
          <div class="g-item">${thumbHTML(x.c)}
            <div class="g-info"><div class="n">${esc(x.c.name)}</div>
            <div class="m">${esc(x.c.brand)} · ${esc(x.c.series)} · ${esc(x.c.year)}</div></div>
            <button class="btn pri sm" data-viadd="${i}">Review &amp; add</button></div>`).join('')
        : '<div class="notice">No close catalog matches — you can still add it as a custom car with the AI details pre-filled.</div>'}
        <button class="btn sec block" id="vi-custom" style="margin-top:8px">＋ Add as custom (AI details pre-filled)</button>
        <div class="small mut" style="margin-top:8px">Nothing is added automatically — you confirm first. The AI can be wrong; check the notes.</div>`;
      const prefillBase = { ai:true, name:r.casting, brand:r.brand||'', series:r.series||'', year:String(r.year||''), scale:'1:64', photo:photos[sel],
        notes:'AI visual ID ('+conf+'%): '+(r.notes||'') };
      out.querySelectorAll('[data-viadd]').forEach(b=>b.addEventListener('click', ()=>{
        const x = cands[+b.dataset.viadd];
        closeModal();
        openCustomAdd(Object.assign({}, prefillBase, { cid:x.c.id, brand:x.c.brand, name:x.c.name, series:x.c.series, year:String(x.c.year), scale:x.c.scale }));
      }));
      out.querySelector('#vi-custom').addEventListener('click', ()=>{ closeModal(); openCustomAdd(prefillBase); });
      btn.style.display = 'none';
    }catch(err){
      const msg = String(err.message||err);
      let friendly = 'Something went wrong talking to the vision API.';
      if(msg.indexOf('vision-api-401')===0||msg.indexOf('vision-api-400')===0) friendly = 'Google rejected the key ('+msg.split(':')[0].replace('vision-api-','HTTP ')+'). Check it under More → AI visual ID — it must be a valid AI Studio key.';
      else if(msg.indexOf('vision-api-429')===0) friendly = 'Rate limited by Google (HTTP 429). Wait a minute and try again.';
      else if(msg.indexOf('vision-no-json')===0) friendly = 'The AI answered but not in the expected format. Try again.';
      else if(msg.indexOf('Failed to fetch')>=0||msg.indexOf('NetworkError')>=0) friendly = 'Network error — check your connection and try again.';
      out.innerHTML = `<div class="stub-box"><span class="big">⚠️</span><b>Identification failed.</b><br><br>${esc(friendly)}</div>`;
      btn.disabled = false; btn.textContent = '🔍 Try again';
    }
  };
}

})();
