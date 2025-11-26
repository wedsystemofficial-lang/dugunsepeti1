// ===== WedSystem Admin JS =====
const db = window.db || firebase.firestore();
const WEDDINGS_COL = 'weddings';

// ==== Admin master secret (only you know the plaintext) ====
// Store only the SHA-256 hash in code. Plain password is shared with owner separately.
const ADMIN_SECRET_SHA256 = 'sha256:dd7c2a1e66deb01d3a50260d8837fc4d1c78b664cb90cefc4ac7a3e8a2dedc21';

async function requireAdminSecret(){
  try{
    const input = prompt('Admin şifresi (gerekli):');
    if (!input) return false;
    const cand = await sha256Hex(input);
    return ('sha256:'+cand) === ADMIN_SECRET_SHA256;
  }catch(e){
    console.error('Secret check error', e);
    return false;
  }
}

function el(id){ return document.getElementById(id); }
function esc(s){ return String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function rowHtml(g){
  const name = `${g.firstName || ''} ${g.lastName || ''}`.trim();
  const tel = g.phone || '';
  const att = g.attendance || '-';
  const cnt = g.guestCount || 1;
  return `<tr data-id="${esc(g._id)}"><td>${esc(name)}</td><td>${esc(tel)}</td><td>${esc(att)}</td><td>${esc(cnt)}</td></tr>`;
}

function toCsv(rows){
  const header = ['firstName','lastName','phone','attendance','guestCount','weddingId'];
  const q = v => '"' + String(v ?? '').replace(/"/g,'""') + '"';
  const body = rows.map(r => header.map(k => q(r[k])).join(',')).join('\n');
  return header.join(',') + '\n' + body;
}
function download(filename, text){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type:'text/csv'}));
  a.download = filename;
  a.click();
}

// === Weddings (Firestore) ===
async function addWeddingFirebase(){
  try{
    const id = el('newWeddingId')?.value.trim();
    const pw = el('newWeddingPassword')?.value;
    if (!id || !pw) return alert('Düğün ID ve şifre zorunlu.');
    const hash = await sha256Hex(pw);
    await db.collection(WEDDINGS_COL).doc(id).set({
      passwordHash: `sha256:${hash}`,
      createdAt: (firebase.firestore && firebase.firestore.FieldValue)
        ? firebase.firestore.FieldValue.serverTimestamp() : new Date(),
      updatedAt: (firebase.firestore && firebase.firestore.FieldValue)
        ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
    }, { merge: true });
    el('newWeddingPassword').value = '';
    await renderWeddingListFirebase();
    alert('Düğün Firestore\'a eklendi. Üstteki Giriş alanından bu ID + şifre ile giriş yapabilirsin.');
  }catch(err){
    console.error('addWeddingFirebase error:', err);
    alert('Düğün eklenemedi. Kod: ' + (err.code||err.name) + '\nMesaj: ' + err.message);
  }
}

async function renderWeddingListFirebase(){
  const list = el('weddingList');
  if (!list) return;
  try{
    list.innerHTML = '<li>Yükleniyor…</li>';
    const snap = await db.collection(WEDDINGS_COL).get();
    const ids = [];
    snap.forEach(doc => ids.push(doc.id));
    ids.sort();
    if (!ids.length){ list.innerHTML = '<li>(Henüz kayıt yok)</li>'; return; }
    list.innerHTML = '';
    ids.forEach(k => {
      const li = document.createElement('li');
      li.innerHTML = `${esc(k)} <button data-k="${esc(k)}" class="remove-wedding" style="margin-left:8px">Sil</button>`;
      list.appendChild(li);
    });
    list.querySelectorAll('.remove-wedding').forEach(btn => {
      btn.onclick = async () => {
        try{
          const k = btn.getAttribute('data-k');
          // Admin secret verification
          const ok = await requireAdminSecret();
          if (!ok){ alert('Yetkisiz işlem: Admin şifresi hatalı veya iptal edildi.'); return; }
          if (!confirm(`${k} düğünü silmek istediğine emin misin?`)) return;
          await db.collection(WEDDINGS_COL).doc(k).delete();
          renderWeddingListFirebase();
        }catch(err){
          console.error('Wedding delete error:', err);
          alert('Silinemedi. Kod: ' + (err.code||err.name) + '\nMesaj: ' + err.message);
        }
      };
    });
  }catch(err){
    console.error('renderWeddingListFirebase error:', err);
    list.innerHTML = '<li style="color:#f88">Listeleme hatası</li>';
    alert('Listeleme hatası. Kod: ' + (err.code||err.name) + '\nMesaj: ' + err.message);
  }
}

// === Login & Panel ===
let CURRENT_WEDDING = null;
let ASSIGN = {}; // guestId -> { table }
let FILTER = { attendance: 'ALL', q: '' };
let MENU_UNSUB = null;
let RSVP_MENU_UNSUB = null;

// Menü listesi için ek durumlar
let MENU_FILTER = { q: '', choice: 'ALL' }; // choice: ALL|RED|WHITE|VEG|VEGAN|CHILD
let LAST_MENU_ROWS = []; // en son render edilen ham satırlar
let _menuSearchDebounce = null;

async function login(){
  try{
    const weddingId = el('weddingId').value.trim();
    const password  = el('password').value;
    if (!weddingId || !password) return alert('WeddingId ve şifre zorunludur.');

    const wdoc = await db.collection(WEDDINGS_COL).doc(weddingId).get();
    if (!wdoc.exists){
      alert('Bu weddingId için kayıt yok. Önce "Düğün Ekle" bölümünden ekleyin.');
      return;
    }
    const cfgHash = (wdoc.data() && wdoc.data().passwordHash) || '';
    const candidate = await sha256Hex(password);
    if (candidate !== cfgHash.replace(/^sha256:/,'')){
      alert('Şifre yanlış.');
      return;
    }
    CURRENT_WEDDING = weddingId;
    localStorage.setItem('ws_admin_wedding', weddingId);
    el('currentWedding').textContent = weddingId;
    const panelEl = el('panel');
    if (panelEl) {
      panelEl.style.display = 'block';
    }

    // RSVP linkini göster (basit ve uyumlu: ?wedding=...)
    const rsvp = document.getElementById('rsvpLink');
    const copy = document.getElementById('copyLinkBtn');
    if (rsvp) {
      const base = window.location.origin + (window.location.pathname.replace(/\/admin\.html$/, '/index.html'));
      const link = `${base}?wedding=${encodeURIComponent(CURRENT_WEDDING)}`;
      rsvp.textContent = link;
    }
    if (copy) {
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(document.getElementById('rsvpLink').textContent);
          alert('Link kopyalandı!');
        } catch (e) {
          alert('Kopyalanamadı, linki elle seçip kopyalayabilirsin.');
        }
      };
    }

    // Kişiye özel davet linki (opsiyonel isim/telefon parametreleri)
    const buildBtn = document.getElementById('buildPersonalLinkBtn');
    const fullNameInput = document.getElementById('guestFullName');
    const phoneInput = document.getElementById('guestPhoneOpt');
    const outLink = document.getElementById('personalLink');
    const copyPL = document.getElementById('copyPersonalLinkBtn');

    function splitName(full){
      const t = String(full||'').trim();
      if (!t) return {fn:'', ln:''};
      const parts = t.split(/\s+/);
      const fn = parts.shift() || '';
      const ln = parts.join(' ');
      return {fn, ln};
    }

    function buildPersonalLink(){
      if (!outLink) return;
      const base = window.location.origin + (window.location.pathname.replace(/\/admin\.html$/, '/index.html'));
      const name = fullNameInput && fullNameInput.value ? fullNameInput.value : '';
      const phone = phoneInput && phoneInput.value ? phoneInput.value : '';
      const {fn, ln} = splitName(name);
      const url = new URL(base);
      url.searchParams.set('wedding', CURRENT_WEDDING);
      if (fn) url.searchParams.set('fn', fn);
      if (ln) url.searchParams.set('ln', ln);
      if (phone) url.searchParams.set('ph', phone);
      outLink.textContent = url.toString();
    }

    if (buildBtn) buildBtn.onclick = buildPersonalLink;
    if (copyPL) {
      copyPL.onclick = async () => {
        try { await navigator.clipboard.writeText(outLink.textContent); alert('Kişiye özel link kopyalandı!'); }
        catch { alert('Kopyalanamadı, linki elle seçip kopyalayabilirsin.'); }
      };
    }

    await loadGuests();
    await loadSeating();

    // === Menü Seçimleri: canlı dinleme + manuel yenile ===
    ensureMenuSection();
    ensureMenuControls();
    startMenuLive();
    (function bindMenuRefresh(){
      const lm = document.getElementById('loadMenuBtn');
      if (lm && !lm.dataset.bound){
        lm.dataset.bound = '1';
        lm.onclick = loadMenuSelections;
      }
    })();

    // Giriş başarılı olunca Hizmetler bölümü (ortada büyük buton)
    (function ensureServices(){
      let sec = document.getElementById('servicesSection');
      if (!sec) {
        const panel = document.getElementById('panel');
        const wrapper = (panel && panel.parentElement) ? panel.parentElement : document.body;
        sec = document.createElement('div');
        sec.id = 'servicesSection';
        sec.className = 'card reveal';
        sec.style.cssText = 'margin:18px auto; text-align:center; max-width:860px';
        sec.innerHTML = `
          <h2 style="margin:0 0 8px; font-size:28px; letter-spacing:.2px">💼 Hizmetler</h2>
          <p class="muted" style="margin:0 0 14px">Kuaför/berber, fotoğrafçı ve daha fazlası — çiftinize özel öneriler ve randevu planlama.</p>
          <button id="openServicesBtn" style="font-size:20px; font-weight:800; padding:16px 22px; border-radius:16px; border:0; color:#fff; cursor:pointer; background:linear-gradient(135deg,#8b5cf6,#06b6d4); box-shadow:0 14px 36px rgba(6,182,212,.32); transition:transform .18s ease, filter .18s ease">Hizmetleri Aç</button>
          <div style="margin-top:10px; font-size:12px; color:#aeb7c2">Düğün ID: <span id="svcWid">—</span></div>
        `;
        if (panel && panel.nextSibling) {
          wrapper.insertBefore(sec, panel.nextSibling);
        } else {
          wrapper.appendChild(sec);
        }
      }
      try { document.body.classList.remove('auth-locked'); document.body.classList.add('auth-ready'); } catch(_){}
      try { sec.removeAttribute('data-requires-auth'); } catch(_){}
      if (sec) sec.style.display = 'block';

      const btn = document.getElementById('openServicesBtn');
      const wid = document.getElementById('svcWid');
      if (wid) wid.textContent = CURRENT_WEDDING || '-';
      if (sec) sec.style.display = 'block';
      if (btn) {
        btn.onclick = () => {
          const target = `vendors.html?wedding=${encodeURIComponent(CURRENT_WEDDING)}`;
          window.location.href = target;
        };
      }
    })();
  }catch(err){
    console.error('Login error:', err);
    alert('Giriş hatası. Kod: ' + (err.code||err.name) + '\nMesaj: ' + err.message);
  }
}

// === RSVP Liste ===
async function loadGuests(){
  const tbody = document.querySelector('#guestTable tbody');
  tbody.innerHTML = '<tr><td class="muted" colspan="4">Yükleniyor…</td></tr>';

  const snap = await db.collection('rsvp').where('weddingId','==', CURRENT_WEDDING).get();
  let rows = [];
  snap.forEach(doc => rows.push({ _id: doc.id, ...doc.data() }));

  if (FILTER.attendance !== 'ALL') rows = rows.filter(r => (r.attendance || '') === FILTER.attendance);
  const q = (FILTER.q || '').trim().toLowerCase();
  if (q) rows = rows.filter(r => (((r.firstName||'') + ' ' + (r.lastName||'')).toLowerCase().includes(q) || String(r.phone||'').toLowerCase().includes(q)));

  const countShown = rows.length;
  const sumShown   = rows.reduce((a, r) => a + Number(r.guestCount||0), 0);
  const sumEvet    = rows.filter(r => (r.attendance||'') === 'Evet').reduce((a, r) => a + Number(r.guestCount||0), 0);

  tbody.innerHTML = rows.map(rowHtml).join('') || '<tr><td class="muted" colspan="4">Kayıt bulunamadı</td></tr>';
  el('count').textContent = String(countShown);
  const cs = el('countShown'); if (cs) cs.textContent = String(countShown);
  const ss = el('sumShown');  if (ss) ss.textContent = String(sumShown);
  const se = el('sumEvet');   if (se) se.textContent = String(sumEvet);

  const pool = el('guestPool');
  if (pool) {
    pool.innerHTML = '';
    rows.forEach(g => {
      const chip = document.createElement('div');
      chip.className = 'guest-chip';
      chip.textContent = `${g.firstName || ''} ${g.lastName || ''}`.trim() || g.phone || g._id;
      chip.draggable = true;
      chip.dataset.id = g._id;
      chip.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', g._id); chip.classList.add('ghost'); });
      chip.addEventListener('dragend', () => chip.classList.remove('ghost'));
      pool.appendChild(chip);
    });
  }

  // Misafir kovaları (Genel / Yerleştirilen / Yerleştirilmeyen) özetini güncelle
  if (typeof renderGuestBuckets === 'function') {
    renderGuestBuckets().catch?.(console.warn);
  }
}

// === Drag & Drop Seating ===
function enableDnD(){
  // Aynı dinleyicileri birden fazla kez eklememek için guard
  if (window._wsDndBound) return;
  window._wsDndBound = true;

  const root = document;

  // Masa ve havuz hedeflerine dragover izni ver
  root.addEventListener('dragover', (e) => {
    const slot = e.target.closest('.table-slot, .table-node, #guestPool');
    if (slot) {
      e.preventDefault();
    }
  });

  // Drop işlemini yakala (masa veya havuz)
  root.addEventListener('drop', (e) => {
    const slot = e.target.closest('.table-slot, .table-node, #guestPool');
    if (!slot) return;
    e.preventDefault();

    const guestId = e.dataTransfer.getData('text/plain');
    if (!guestId) return;

    const chip = document.querySelector(`.guest-chip[data-id="${guestId}"]`);
    if (!chip) return;

    // Eğer havuza bırakıldıysa masadan çıkar ve chip havuza gider
    if (slot.id === 'guestPool') {
      slot.appendChild(chip);
      delete ASSIGN[guestId];
      return;
    }

    // Masa node'una bırakıldıysa:
    // data-table yoksa text/id'den üret, SADECE atamayı güncelle
    if (!slot.dataset.table){
      const label = (slot.textContent || '').trim() || slot.getAttribute('data-label') || slot.id || '';
      if (label) slot.dataset.table = label;
    }
    const key = slot.dataset.table || (slot.textContent || '').trim();
    if (!key) return;

    // Chip'i masanın üstüne taşımıyoruz; sadece atamayı tutuyoruz
    ASSIGN[guestId] = { table: key };
  });

  // Masa detayı (modal) için tıklama - dinamik masalar dahil
  root.addEventListener('click', (e) => {
    const slot = e.target.closest('.table-slot, .table-node');
    if (!slot) return;
    const key = slot.dataset.table || (slot.textContent || '').trim() || slot.getAttribute('data-label') || slot.id || '';
    if (!key) return;
    openTableDetail(key, slot);
  });
}

async function loadSeating(){
  ASSIGN = {};
  const snap = await db.collection('seating').doc(CURRENT_WEDDING).collection('assignments').get();
  snap.forEach(doc => { ASSIGN[doc.id] = doc.data(); });

  // Masa hedeflerine data-table atanmış olduğundan emin ol
  const tableTargets = document.querySelectorAll('.table-slot, .table-node');
  tableTargets.forEach(slot => {
    if (!slot.dataset.table){
      const label = (slot.textContent || '').trim() || slot.getAttribute('data-label') || slot.id || '';
      if (label) slot.dataset.table = label;
    }
  });

  // Misafir chip'lerini masaların üstüne taşımıyoruz; atamalar sadece ASSIGN içinde tutuluyor.

  // Oturma planı yüklendikten sonra da kovaları güncelle
  if (typeof renderGuestBuckets === 'function') {
    renderGuestBuckets().catch?.(console.warn);
  }
}

/* ========= MİSAFİRLER — GENEL / YERLEŞTİRİLEN / YERLEŞTİRİLMEYEN ========= */

async function renderGuestBuckets(){
  if (!CURRENT_WEDDING) return;

  // RSVP'deki tüm misafirler
  const guestsMap = await getGuestsMap();

  // Hangi misafir hangi masaya atanmış?
  const placedIds = new Set(
    Object.entries(ASSIGN || {})
      .filter(([id, info]) => info && info.table)
      .map(([id]) => id)
  );

  const placed = [];       // yerleştirilenler
  const unplaced = [];     // yerleştirilmeyenler
  let totalHeadcount = 0;  // genel kişi sayısı (guestCount toplamı)

  Object.values(guestsMap).forEach(g => {
    const id   = g._id;
    const cnt  = Number(g.guestCount || 1);
    const name = `${g.firstName || ''} ${g.lastName || ''}`.trim() || g.phone || id;

    totalHeadcount += cnt;

    const bucket = placedIds.has(id) ? placed : unplaced;
    bucket.push({
      id,
      name,
      phone: g.phone || '',
      guestCount: cnt,
      attendance: g.attendance || '',
    });
  });

  // İsimlere göre sırala
  const sortByName = arr => arr.sort((a,b) =>
    a.name.localeCompare(b.name, 'tr', { sensitivity:'base' })
  );
  sortByName(placed);
  sortByName(unplaced);

  // HTML elemanlarını yakala (ID'ler admin.html tarafındaki bloklara göre)
  const elSummary       = document.getElementById('guestSummaryOverall');   // Genel info metni
  const elPlacedList    = document.getElementById('guestListPlaced');      // Yerleştirilenler UL
  const elUnplacedList  = document.getElementById('guestListUnplaced');    // Yerleştirilmeyenler UL
  const elPlacedCount   = document.getElementById('guestPlacedCount');     // Yerleştirilen misafir sayısı
  const elUnplacedCount = document.getElementById('guestUnplacedCount');   // Yerleştirilmeyen misafir sayısı
  const elTotalHead     = document.getElementById('guestTotalHeadcount');  // Toplam kişi sayısı

  if (elSummary){
    elSummary.textContent =
      `Toplam kişi: ${totalHeadcount} · Yerleştirilen: ${placed.length} misafir · Yerleştirilmeyen: ${unplaced.length} misafir`;
  }
  if (elTotalHead)     elTotalHead.textContent     = String(totalHeadcount);
  if (elPlacedCount)   elPlacedCount.textContent   = String(placed.length);
  if (elUnplacedCount) elUnplacedCount.textContent = String(unplaced.length);

  if (elPlacedList){
    elPlacedList.innerHTML = placed.map(g => `
      <li class="guest-row">
        <div class="guest-main">
          <span class="guest-name">${esc(g.name)}</span>
          <span class="guest-meta">Kişi sayısı: ${g.guestCount} · Tel: ${esc(g.phone || '—')}</span>
        </div>
      </li>
    `.trim()).join('') || '<li class="muted">Yerleştirilen misafir yok.</li>';
  }

  if (elUnplacedList){
    elUnplacedList.innerHTML = unplaced.map(g => `
      <li class="guest-row">
        <div class="guest-main">
          <span class="guest-name">${esc(g.name)}</span>
          <span class="guest-meta">Kişi sayısı: ${g.guestCount} · Tel: ${esc(g.phone || '—')}</span>
        </div>
      </li>
    `.trim()).join('') || '<li class="muted">Tüm misafirler masalara yerleştirilmiş.</li>';
  }
}
// === MENÜ SEÇİMLERİ ===
function ensureMenuSection(){
  return document.getElementById('menuSection');
}

// ---- Menü özet rozetleri + tablo render ve filtre yardımcıları ----
function renderMenuStats(rows){
  const read = id => document.getElementById(id);
  const norm = s => String(s||'').toLowerCase();
  const get = (...names) => rows.filter(r => {
    const x = norm(r.menuChoice);
    return names.some(n => x === n);
  }).length;
  const red   = get('kırmızı et','kirmizi et','kirmizi','red');
  const white = get('beyaz et','beyaz','white','tavuk','chicken');
  const veg   = get('vejetaryen','vejeteryan','vegetarian');
  const vegan = get('vegan');
  const child = get('çocuk menüsü','cocuk menusu','çocuk','child');
  const total = rows.length;
  const put = (id,val)=>{ const el = document.getElementById(id); if (el){ const b = el.querySelector('b'); if (b) b.textContent = String(val); }};
  put('statRed', red); put('statWhite', white); put('statVeg', veg); put('statVegan', vegan); put('statChild', child); put('statTotal', total);
}

function _norm(s){ return String(s||'').toLowerCase(); }
function _matchChoice(choice, text){
  const t = _norm(text);
  if (choice === 'ALL') return true;
  if (choice === 'RED')   return ['kırmızı et','kirmizi et','kirmizi','red'].includes(t);
  if (choice === 'WHITE') return ['beyaz et','beyaz','white','tavuk','chicken'].includes(t);
  if (choice === 'VEG')   return ['vejetaryen','vejeteryan','vegetarian'].includes(t);
  if (choice === 'VEGAN') return ['vegan'].includes(t);
  if (choice === 'CHILD') return ['çocuk menüsü','cocuk menusu','çocuk','child'].includes(t);
  return true;
}

function applyMenuFilter(rows){
  const q = _norm(MENU_FILTER.q);
  return rows.filter(r => {
    const name = _norm(((r.firstName||'')+' '+(r.lastName||''))).trim();
    const phone= _norm(r.phone||'');
    const menu = _norm(r.menuChoice||'');
    const passQ = !q || name.includes(q) || phone.includes(q) || menu.includes(q);
    const passC = _matchChoice(MENU_FILTER.choice, r.menuChoice);
    return passQ && passC;
  });
}

function renderMenuRows(rows){
  LAST_MENU_ROWS = Array.isArray(rows) ? rows.slice() : [];
  const tbody = document.querySelector('#menuTable tbody');
  if (!tbody) return;

  const filtered = applyMenuFilter(LAST_MENU_ROWS);
  if (!filtered.length){
    tbody.innerHTML = '<tr><td colspan="3" class="muted">Menü verisi bulunamadı.</td></tr>';
    renderMenuStats([]);
    return;
  }
  const toTs = (t)=> t && t.toDate ? t.toDate().getTime() : (t? new Date(t).getTime():0);
  filtered.sort((a,b)=> toTs(b.createdAt||b.menuUpdatedAt) - toTs(a.createdAt||a.menuUpdatedAt));
  const fmt = (ts) => { try{ if (!ts) return ''; if (ts.toDate) return ts.toDate().toLocaleString('tr-TR'); return new Date(ts).toLocaleString('tr-TR'); }catch{ return ''; } };
  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td>${esc(((r.firstName||'') + ' ' + (r.lastName||'')).trim())}</td>
      <td>${esc(r.menuChoice || '—')}</td>
      <td>${esc(fmt(r.createdAt || r.menuUpdatedAt))}</td>
    </tr>
  `).join('');
  renderMenuStats(filtered);
}

async function loadMenuSelections(){
  if (!CURRENT_WEDDING){ return; }
  const tbody = document.querySelector('#menuTable tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="muted">Yükleniyor…</td></tr>';

  const fromMenus = [];
  try{
    const snap = await db.collection('menus').where('weddingId','==', CURRENT_WEDDING).get();
    snap.forEach(doc => fromMenus.push({ _id: doc.id, ...doc.data() }));
  }catch(e){ console.warn('menus read fail', e); }

  if (fromMenus.length){ renderMenuRows(fromMenus); return; }

  const fromRsvp = [];
  try{
    const rs = await db.collection('rsvp').where('weddingId','==', CURRENT_WEDDING).get();
    rs.forEach(doc => { const d = doc.data()||{}; if (d.menuChoice) fromRsvp.push({ _id: doc.id, ...d }); });
  }catch(e){ console.error('rsvp fallback fail', e); }

  renderMenuRows(fromRsvp);
}

function startMenuLive(){
  // varsa eski dinleyicileri kapat
  if (MENU_UNSUB){ try{ MENU_UNSUB(); }catch{} MENU_UNSUB=null; }
  if (RSVP_MENU_UNSUB){ try{ RSVP_MENU_UNSUB(); }catch{} RSVP_MENU_UNSUB=null; }
  if (!CURRENT_WEDDING) return;

  const qMenus = db.collection('menus').where('weddingId','==', CURRENT_WEDDING);
  MENU_UNSUB = qMenus.onSnapshot(snap => {
    const rows = [];
    snap.forEach(doc => rows.push({ _id: doc.id, ...doc.data() }));
    if (rows.length){
      renderMenuRows(rows);
      if (RSVP_MENU_UNSUB){ try{ RSVP_MENU_UNSUB(); }catch{} RSVP_MENU_UNSUB=null; }
    } else {
      if (!RSVP_MENU_UNSUB){
        const qR = db.collection('rsvp').where('weddingId','==', CURRENT_WEDDING);
        RSVP_MENU_UNSUB = qR.onSnapshot(rs => {
          const r = [];
          rs.forEach(doc => { const d = doc.data()||{}; if (d.menuChoice) r.push({ _id: doc.id, ...d }); });
          renderMenuRows(r);
        });
      }
    }
  }, err => console.error('menus onSnapshot error', err));
}

function ensureMenuControls(){
  const sec = ensureMenuSection();
  if (!sec) return;
  let bar = sec.querySelector('#menuCtrlBar');
  if (!bar){
    bar = document.createElement('div');
    bar.id = 'menuCtrlBar';
    bar.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:6px 0 12px';
    bar.innerHTML = `
      <input id="menuSearch" type="search" placeholder="Menülerde ara (isim/telefon/menü)" style="padding:8px 10px; border-radius:10px; border:1px solid #d0d6dd; outline:none; min-width:240px" />
      <select id="menuChoiceFilter" style="padding:8px 10px; border-radius:10px; border:1px solid #d0d6dd; outline:none">
        <option value="ALL">Tümü</option>
        <option value="RED">Kırmızı Et</option>
        <option value="WHITE">Beyaz Et</option>
        <option value="VEG">Vejetaryen</option>
        <option value="VEGAN">Vegan</option>
        <option value="CHILD">Çocuk</option>
      </select>
      <button id="exportMenuCsvBtn" class="secondary">CSV İndir</button>
      <button id="clearMenuFiltersBtn" class="ghost">Filtreleri Temizle</button>
    `;
    const header = sec.querySelector('h2')?.parentElement || sec;
    header.parentElement.insertBefore(bar, header.nextSibling);
  }
  const s = document.getElementById('menuSearch');
  const c = document.getElementById('menuChoiceFilter');
  const e = document.getElementById('exportMenuCsvBtn');
  const clr = document.getElementById('clearMenuFiltersBtn');
  if (s && !s.dataset.bound){
    s.dataset.bound='1';
    s.addEventListener('input', ()=>{
      clearTimeout(_menuSearchDebounce);
      _menuSearchDebounce = setTimeout(()=>{ MENU_FILTER.q = s.value||''; renderMenuRows(LAST_MENU_ROWS); }, 200);
    });
  }
  if (c && !c.dataset.bound){
    c.dataset.bound='1';
    c.addEventListener('change', ()=>{ MENU_FILTER.choice = c.value||'ALL'; renderMenuRows(LAST_MENU_ROWS); });
  }
  if (clr && !clr.dataset.bound){
    clr.dataset.bound='1';
    clr.onclick = ()=>{ MENU_FILTER = { q:'', choice:'ALL' }; if (s) s.value=''; if (c) c.value='ALL'; renderMenuRows(LAST_MENU_ROWS); };
  }
  if (e && !e.dataset.bound){
    e.dataset.bound='1';
    e.onclick = exportMenusCsv;
  }
  const bindBadge = (id, choice)=>{
    const el = document.getElementById(id);
    if (el && !el.dataset.bound){
      el.dataset.bound='1';
      el.style.cursor='pointer';
      el.title='Bu kategoriye filtrele';
      el.onclick = ()=>{ MENU_FILTER.choice = choice; const c = document.getElementById('menuChoiceFilter'); if (c) c.value = choice; renderMenuRows(LAST_MENU_ROWS); };
    }
  };
  bindBadge('statRed', 'RED');
  bindBadge('statWhite', 'WHITE');
  bindBadge('statVeg', 'VEG');
  bindBadge('statVegan', 'VEGAN');
  bindBadge('statChild', 'CHILD');
  const total = document.getElementById('statTotal');
  if (total && !total.dataset.bound){
    total.dataset.bound='1';
    total.style.cursor='pointer';
    total.title='Tümünü göster';
    total.onclick = ()=>{ MENU_FILTER = { q:'', choice:'ALL' }; const s=document.getElementById('menuSearch'); const c=document.getElementById('menuChoiceFilter'); if (s) s.value=''; if (c) c.value='ALL'; renderMenuRows(LAST_MENU_ROWS); };
  }
}

function exportMenusCsv(){
  const header = ['firstName','lastName','menuChoice','createdAt'];
  const q = v => '"' + String(v ?? '').replace(/"/g,'""') + '"';
  const toTs=(t)=> t && t.toDate ? t.toDate().toISOString() : (t? new Date(t).toISOString(): '');
  const filtered = applyMenuFilter(LAST_MENU_ROWS);
  const body = filtered.map(r => [q(r.firstName), q(r.lastName), q(r.menuChoice), q(toTs(r.createdAt||r.menuUpdatedAt))].join(',')).join('\n');
  const csv = header.join(',') + '\n' + body;
  const wid = (typeof CURRENT_WEDDING==='string' && CURRENT_WEDDING) ? CURRENT_WEDDING : 'unknown';
  download(`menus-${wid}.csv`, csv);
}

// === Seating CSV Export ===
async function exportSeatingCsv(){
  if (!CURRENT_WEDDING){
    alert('Önce weddingId ile giriş yapın.');
    return;
  }

  // Eğer hiç atama yoksa uyar
  if (!ASSIGN || !Object.keys(ASSIGN).length){
    alert('Henüz masa ataması yapılmamış görünüyor. Önce misafirleri masalara yerleştirin.');
    return;
  }

  try{
    // RSVP tarafındaki tüm misafirleri çek (isim, telefon, katılım, kişi sayısı)
    const guestsMap = await getGuestsMap();

    // ASSIGN içindeki her misafir-id için tablo satırı oluştur
    const rows = [];
    for (const [guestId, info] of Object.entries(ASSIGN)){
      const g = guestsMap[guestId] || {};
      const table = info && info.table ? info.table : '';
      if (!table) continue; // masası olmayanları alma

      const firstName  = g.firstName || '';
      const lastName   = g.lastName  || '';
      const phone      = g.phone     || '';
      const attendance = g.attendance || '';
      const guestCount = g.guestCount || 1;

      rows.push({ table, firstName, lastName, phone, attendance, guestCount });
    }

    if (!rows.length){
      alert('Masa düzeni için atanmış misafir bulunamadı.');
      return;
    }

    // CSV hazırla
    const header = ['table','firstName','lastName','phone','attendance','guestCount','weddingId'];
    const q = v => '"' + String(v ?? '').replace(/"/g,'""') + '"';
    const wid = (typeof CURRENT_WEDDING === 'string' && CURRENT_WEDDING) ? CURRENT_WEDDING : 'unknown';
    const body = rows.map(r => [
      q(r.table),
      q(r.firstName),
      q(r.lastName),
      q(r.phone),
      q(r.attendance),
      q(r.guestCount),
      q(wid)
    ].join(',')).join('\n');
    const csv = header.join(',') + '\n' + body;

    // İndir
    download(`seating-${wid}.csv`, csv);
  }catch(e){
    console.error('exportSeatingCsv error:', e);
    alert('Masa düzeni CSV indirilemedi: ' + (e.code || e.name || '') + ' ' + (e.message || ''));
  }
}
// === Seating kaydet ===
async function saveSeating(){
  const batch = db.batch();
  const base = db.collection('seating').doc(CURRENT_WEDDING).collection('assignments');
  for (const [guestId, v] of Object.entries(ASSIGN)){
    batch.set(base.doc(guestId), { table: v.table, updatedAt: new Date() }, { merge: true });
  }
  await batch.commit();
  alert('Oturma planı kaydedildi.');
}

/* ==== MİSAFİR SEKMELERİ ==== */
function setupGuestTabs(){
  const btnAll  = document.getElementById('tabAllGuests');
  const btnAsg  = document.getElementById('tabAssignedGuests');
  const btnUn   = document.getElementById('tabUnassignedGuests');

  const tabAll  = document.getElementById('tabAll');
  const tabAsg  = document.getElementById('tabAssigned');
  const tabUn   = document.getElementById('tabUnassigned');

  if (!btnAll || !btnAsg || !btnUn) return;

  btnAll.onclick = () => {
    tabAll.style.display = 'block';
    tabAsg.style.display = 'none';
    tabUn.style.display  = 'none';
  };

  btnAsg.onclick = async () => {
    tabAll.style.display = 'none';
    tabAsg.style.display = 'block';
    tabUn.style.display  = 'none';

    const guests = await getGuestsMap();
    const list = [];
    for(const [gid, info] of Object.entries(ASSIGN)){
      const g = guests[gid] || {};
      const name = `${g.firstName||''} ${g.lastName||''}`.trim() || g.phone || gid;
      list.push(`• ${name} — Masa ${info.table}`);
    }
    document.getElementById('assignedList').innerHTML =
      list.length ? list.join('<br>') : '<span class="muted">Hiç yerleştirilen yok</span>';
  };

  btnUn.onclick = async () => {
    tabAll.style.display = 'none';
    tabAsg.style.display = 'none';
    tabUn.style.display  = 'block';

    const guests = await getGuestsMap();
    const list = [];
    for(const [gid, g] of Object.entries(guests)){
      if (!ASSIGN[gid]){
        const nm = `${g.firstName||''} ${g.lastName||''}`.trim() || g.phone || gid;
        list.push({ name: nm, _id: g._id });
      }
    }
    const box = document.getElementById('unassignedList');
    if (!list.length){
      box.innerHTML = '<span class="muted">Yerleştirilmeyen yok</span>';
    } else {
      box.innerHTML = '';
      list.forEach(item => {
        const chip = document.createElement('div');
        chip.className = 'guest-chip';
        chip.textContent = item.name;
        chip.draggable = true;
        chip.dataset.id = item._id;  // gerçek id bağlayabilmek için
        chip.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', item._id); chip.classList.add('ghost'); });
        chip.addEventListener('dragend', () => chip.classList.remove('ghost'));
        box.appendChild(chip);
      });
    }
  };
}

function boot(){
  setupGuestTabs();
  enableDnD();
  const lastWedding = localStorage.getItem('ws_admin_wedding');
  if (lastWedding) el('weddingId').value = lastWedding;

  el('loginBtn').onclick = login;
  el('refreshBtn').onclick = loadGuests;
  el('loadSeatingBtn').onclick = loadSeating;
  el('saveSeatingBtn').onclick = saveSeating;

  const downloadSeatingBtn = el('downloadSeatingBtn');
  if (downloadSeatingBtn){
    downloadSeatingBtn.onclick = exportSeatingCsv;
  }

  // Menü kontrol barını garantiye al
  ensureMenuControls();
  (function bindMenuRefresh(){
    const lm = el('loadMenuBtn');
    if (lm && !lm.dataset.bound){
      lm.dataset.bound = '1';
      lm.onclick = loadMenuSelections;
    }
  })();

  el('exportCsvBtn').onclick = async () => {
    const snap = await db.collection('rsvp').where('weddingId','==', CURRENT_WEDDING).get();
    let rows = [];
    snap.forEach(doc => rows.push(doc.data()));
    if (FILTER.attendance !== 'ALL') rows = rows.filter(r => (r.attendance||'') === FILTER.attendance);
    const q = (FILTER.q||'').trim().toLowerCase();
    if (q) rows = rows.filter(r => (((r.firstName||'') + ' ' + (r.lastName||'')).toLowerCase().includes(q) || String(r.phone||'').toLowerCase().includes(q)));
    download(`rsvp-${CURRENT_WEDDING}.csv`, toCsv(rows));
  };

  const attSel = el('attFilter');
  const qBox   = el('searchBox');
  const apply  = el('applyFilterBtn');
  if (attSel) attSel.onchange = () => { FILTER.attendance = attSel.value; loadGuests(); };
  if (qBox)   qBox.onkeypress = (e) => { if (e.key === 'Enter') { FILTER.q = qBox.value; loadGuests(); } };
  if (apply)  apply.onclick = () => { FILTER.q = qBox ? qBox.value : ''; loadGuests(); };

  const addBtn = el('addWeddingBtn');
  if (addBtn) addBtn.onclick = addWeddingFirebase;

  renderWeddingListFirebase();

  // Üst buton ile paneli aç (varsa)
  (function bindTopOpenIfAny(){
    const t = document.getElementById('openNotifyPanelBtnTop');
    if (t && !t.dataset.bound){
      t.dataset.bound='1';
      t.onclick = async ()=>{ const list = await prepareSeatNotifications(); renderNotifyPanel(list); };
    }
  })();

  // === WhatsApp Davet (rehbersiz, tek link) ===
  const waInviteBtn   = document.getElementById('waInviteBtn');
  const copyInviteBtn = document.getElementById('copyInviteBtn');

  function baseInvite(){
    const p = window.location.pathname;
    return /\/admin\.html$/.test(p)
      ? window.location.origin + p.replace(/\/admin\.html$/, '/index.html')
      : window.location.origin + '/index.html';
  }
  function buildInviteLinkOnly(wid){
    const url = new URL(baseInvite());
    url.searchParams.set('wedding', wid);
    return url.toString();
  }
  function openWhatsAppGeneric(){
    const wid = CURRENT_WEDDING || (el('weddingId') && el('weddingId').value) || '';
    if (!wid){ alert('Önce weddingId ile giriş yapın.'); return; }
    const link = buildInviteLinkOnly(wid);
    const msg  = `Düğün davet linkimiz: ${link}`;
    const wa   = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(wa, '_blank');
  }
  async function copyInviteGeneric(){
    const wid = CURRENT_WEDDING || (el('weddingId') && el('weddingId').value) || '';
    if (!wid){ alert('Önce weddingId ile giriş yapın.'); return; }
    const link = buildInviteLinkOnly(wid);
    try{ await navigator.clipboard.writeText(link); alert('Davet linki kopyalandı.'); }
    catch{ prompt('Linki kopyalayın:', link); }
  }

  if (waInviteBtn)   waInviteBtn.addEventListener('click', openWhatsAppGeneric);
  if (copyInviteBtn) copyInviteBtn.addEventListener('click', copyInviteGeneric);

  // Masa detay modalini hazırla
  bindTableDetailUi();
}

document.addEventListener('DOMContentLoaded', boot);

/* ===== MASA DETAY MODALI JS ===== */
async function openTableDetail(tableKey, anchor){
  const key = String(tableKey||'').trim();
  if (!key) return;

  // Remove old tooltip if exists
  let tip = document.getElementById('tableTooltip');
  if (tip) tip.remove();

  tip = document.createElement('div');
  tip.id = 'tableTooltip';
  tip.style.position = 'fixed';
  tip.style.background = '#fff';
  tip.style.border = '1px solid #ccc';
  tip.style.borderRadius = '8px';
  tip.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)';
  tip.style.padding = '12px';
  tip.style.fontSize = '14px';
  tip.style.zIndex = 9999;
  tip.style.maxWidth = '240px';
  tip.style.color = '#0f172a';         // Koyu yazı rengi
  tip.style.opacity = '1';             // Tam opak
  tip.style.filter = 'none';           // Her türlü blur / soluk efekti kaldır

  const rect = anchor.getBoundingClientRect();
  tip.style.left = (rect.right + 10) + 'px';
  tip.style.top  = rect.top + 'px';

  tip.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px">Masa ${key}</div>
    <div id="ttList" style="margin-bottom:6px">Yükleniyor…</div>
    <button id="ttNotify" style="margin-top:2px;padding:4px 8px;border:0;border-radius:6px;background:#16a34a;color:#fff;cursor:pointer;display:block;width:100%;font-size:13px;">
      Bu masadakilere SMS gönder.
    </button>
    <button id="ttClose" style="margin-top:6px;padding:4px 8px;border:0;border-radius:6px;background:#eee;cursor:pointer;display:block;width:100%;font-size:13px;">
      Kapat
    </button>`;

  document.body.appendChild(tip);

  document.getElementById('ttClose').onclick = () => tip.remove();

  try{
    const guestsMap = await getGuestsMap();
    const items=[];
    let html='';

    for(const [gid,val] of Object.entries(ASSIGN)){
      if(String(val.table||'').trim()===key){
        const g=guestsMap[gid]||{};
        const nm=`${g.firstName||''} ${g.lastName||''}`.trim()||g.phone||gid;
        html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                   <span>${esc(nm)}</span>
                   <button data-gid="${gid}" style="border:0;background:#ffeded;padding:2px 6px;border-radius:4px;cursor:pointer">✕</button>
                 </div>`;
      }
    }

    if(!html){
      html=`<div style="color:#666">Bu masada misafir yok.</div>`;
    }

    document.getElementById('ttList').innerHTML=html;

    document.querySelectorAll('#tableTooltip button[data-gid]').forEach(btn=>{
      btn.onclick = () => {
        const id=btn.getAttribute('data-gid');
        delete ASSIGN[id];
        openTableDetail(key, anchor);
      };
    });
        // Bind SMS notify button
        const notifyBtn = document.getElementById('ttNotify');
        if (notifyBtn && !notifyBtn.dataset.bound){
          notifyBtn.dataset.bound = '1';
          notifyBtn.onclick = async () => {
            try{
              await notifyTableWhatsApp(key);
            }catch(e){
              console.error('notifyTableWhatsApp error', e);
              alert('Bu masaya SMS gönderilirken hata oluştu.');
            }
          };
        }

  }catch(e){
    document.getElementById('ttList').innerHTML='<div style="color:red">Hata oluştu</div>';
  }
}

function bindTableDetailUi(){
  const overlay = el('tableDetailOverlay');
  const closeBtn = el('tableDetailClose');
  if (overlay && !overlay.dataset.bound){
    overlay.dataset.bound = '1';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay){
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden','true');
      }
    });
  }
  if (closeBtn && !closeBtn.dataset.bound){
    closeBtn.dataset.bound = '1';
    closeBtn.addEventListener('click', () => {
      const ov = el('tableDetailOverlay');
      if (!ov) return;
      ov.classList.remove('show');
      ov.setAttribute('aria-hidden','true');
    });
  }
}

/* ========= MASA MESAJLARI — SMS Bildirimleri ========= */


// RSVP haritası: gerektikçe taze okur (cache kullanmıyoruz ki tutarsızlık olmasın)
async function getGuestsMap(){
  const map = {};
  const snap = await db.collection('rsvp').where('weddingId','==', CURRENT_WEDDING).get();
  snap.forEach(doc => { map[doc.id] = { _id: doc.id, ...(doc.data()||{}) }; });
  return map;
}

function normalizePhoneForWa(ph){
  return String(ph||'').replace(/\D+/g,'');
}

function buildRsvpLink(){
  const base = window.location.origin + (window.location.pathname.replace(/\/admin\.html$/, '/index.html'));
  const url = new URL(base);
  url.searchParams.set('wedding', CURRENT_WEDDING);
  return url.toString();
}

function buildSeatMessage(name, tableNo, rsvpLink){
  return `Merhaba, düğünümüzde masa numaranız: ${tableNo}`;
}

async function prepareSeatNotifications(){
  const guests = await getGuestsMap();
  const rsvpLink = buildRsvpLink();
  const list = [];
  for (const [guestId, info] of Object.entries(ASSIGN)){
    const g = guests[guestId] || {};
    const fullName = `${g.firstName||''} ${g.lastName||''}`.trim();
    // Eskiden sadece attendance == "Evet" olanlara gönderiyorduk.
    // Artık masa ataması yapılmış herkese mesaj hazırlanacak.
    const tableNo = info && info.table ? info.table : '';
    if (!tableNo) continue;
    const phone   = g.phone || '';
    const waPhone = normalizePhoneForWa(phone);
    const message = buildSeatMessage(fullName, tableNo, rsvpLink);
    list.push({ guestId, fullName, tableNo, phone, waPhone, message });
  }
  return list;
}

async function notifyTableWhatsApp(tableKey){
  const key = String(tableKey || '').trim();
  if (!key){
    alert('Masa bilgisi bulunamadı.');
    return;
  }

  // Bu masadaki tüm misafirleri al
  const all = await prepareSeatNotifications();
  const list = all.filter(it => String(it.tableNo || '').trim() === key);

  if (!list.length){
    alert(`Masa ${key} için gönderilecek misafir bulunamadı.`);
    return;
  }

  // Benzersiz yap
  const numbers = list
    .map(it => {
      const raw = String(it.phone || '').replace(/\D+/g, '');
      const norm = String(it.waPhone || '').replace(/\D+/g, '');
      return [raw, norm];
    })
    .flat()
    .filter(n => n && n.length >= 8);
  const recipients = Array.from(new Set(numbers));

  // Tek ortak mesaj
  const msg = `Merhaba, düğünümüzde masa numaranız: ${key}`;

  // --- iOS ve macOS iMessage toplu numara denemesi ---
  // macOS ve iOS aynı formatı kullanıyor: sms:&addresses=NUM1,NUM2&body=...
  const appleSms = `sms:&addresses=${recipients.join(',')}&body=${encodeURIComponent(msg)}`;

  // --- Android toplu SMS ---
  const androidSms = `sms:${recipients.join(',')}?body=${encodeURIComponent(msg)}`;

  // Önce Apple formatını aç (Mac/iPhone için)
  window.location.href = appleSms;

  // 300ms sonra Android formatını da aç (Android cihazlarda çalışıyor)
  setTimeout(() => {
    window.location.href = androidSms;
  }, 300);
}
async function markNotified(guestId, tableNo){
  try{
    const sentAt = (firebase.firestore && firebase.firestore.FieldValue)
      ? firebase.firestore.FieldValue.serverTimestamp() : new Date();
    await db.collection('seatingNotifications')
      .doc(`${CURRENT_WEDDING}__${guestId}`)
      .set({ weddingId: CURRENT_WEDDING, guestId, table: tableNo, sentAt }, { merge: true });
    await db.collection('seating').doc(CURRENT_WEDDING)
      .collection('assignments').doc(guestId)
      .set({ notifiedAt: sentAt }, { merge: true });
  }catch(e){ console.warn('markNotified fail', e); }
}

function renderNotifyPanel(list){
  const sec = document.getElementById('notifySection');
  const ul  = document.getElementById('notifyList');
  const cnt = document.getElementById('notifyCount');
  const btnAll = document.getElementById('sendAllWaBtn');
  const btnCopyAll = document.getElementById('copyAllTextBtn');
  if (!sec) return;

  sec.style.display = 'block';

  if (!list || !list.length){
    if (cnt) cnt.textContent = '0';
    if (ul) ul.innerHTML = '<li class="muted">Gönderilecek kimse bulunamadı. (Masa ataması ve “Evet” katılımı olanlar listelenir.)</li>';
    sec.scrollIntoView({behavior:'smooth'});
    return;
  }

  if (cnt) cnt.textContent = String(list.length);
  if (ul){
    ul.innerHTML = list.map(item => {
      // SMS link: telefondaki SMS uygulamasını açar, mesaj gövdesi hazır gelir
      const sms = item.waPhone
        ? `sms:${item.waPhone}?&body=${encodeURIComponent(item.message)}`
        : `sms:?&body=${encodeURIComponent(item.message)}`;

      return `
        <li class="notify-item">
          <div><b>${esc(item.fullName||'(İsimsiz)')}</b> · Masa <b>${esc(item.tableNo||'?')}</b> · Tel: ${esc(item.phone||'–')}</div>
          <div class="notify-actions">
            <a href="${sms}" class="btn small secondary">SMS</a>
            <button class="btn small ghost" data-copy="${esc(item.message)}">Metni Kopyala</button>
          </div>
        </li>`;
    }).join('');
    ul.querySelectorAll('button[data-copy]').forEach(b=>{
      if (!b.dataset.bound){
        b.dataset.bound='1';
        b.onclick = async () => {
          try{ await navigator.clipboard.writeText(b.getAttribute('data-copy')||''); alert('Mesaj panoya kopyalandı.'); }
          catch{ /* no-op */ }
        };
      }
    });
  }

  if (btnAll && !btnAll.dataset.bound){
    btnAll.dataset.bound='1';
    btnAll.onclick = async ()=>{
      for (let i=0; i<list.length; i++){
        const it = list[i];
        const sms = it.waPhone
          ? `sms:${it.waPhone}?&body=${encodeURIComponent(it.message)}`
          : `sms:?&body=${encodeURIComponent(it.message)}`;
        window.open(sms, '_blank');
        await markNotified(it.guestId, it.tableNo);
        await new Promise(r=>setTimeout(r, 500));
      }
      alert('SMS pencereleri açıldı. Göndermeyi SMS uygulamasında onaylayın.');
    };
  }

  if (btnCopyAll && !btnCopyAll.dataset.bound){
    btnCopyAll.dataset.bound='1';
    btnCopyAll.onclick = async ()=>{
      const bulk = list.map(it => `• ${it.fullName||'(İsimsiz)'} — Masa ${it.tableNo}\n${it.message}\n`).join('\n');
      try{ await navigator.clipboard.writeText(bulk); alert('Tüm mesajlar panoya kopyalandı.'); }
      catch{ prompt('Kopyalamak için Ctrl/Cmd+C:', bulk); }
    };
  }

  sec.scrollIntoView({behavior:'smooth', block:'start'});
}

// Kaydet sonrasında paneli otomatik açmak için saveSeating'i sarmala
const _origSaveSeating = saveSeating;
saveSeating = async function(){
  await _origSaveSeating();
  try{
    const list = await prepareSeatNotifications();
    renderNotifyPanel(list);
  }catch(e){ console.warn('notify panel error', e); }
};

// Girişten sonra manuel açma butonu
(function bindNotifyOpen(){
  // Birkaç denemeli bağla (DOM geç yüklenebilir)
  const tryBind = () => {
    const btn = document.getElementById('openNotifyPanelBtn');
    if (btn && !btn.dataset.bound){
      btn.dataset.bound='1';
      btn.onclick = async ()=>{ const list = await prepareSeatNotifications(); renderNotifyPanel(list); };
    }
  };
  tryBind();
  setTimeout(tryBind, 300);
  setTimeout(tryBind, 1000);
})();

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  alert('Beklenmeyen hata: ' + (e.reason && (e.reason.code||e.reason.name)) + '\n' + (e.reason && e.reason.message));
});