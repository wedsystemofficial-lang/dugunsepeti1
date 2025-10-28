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
    el('panel').style.display = 'block';

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

    // Kişiye özel davet linki üretimi (basit query paramlarla)
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

    // Show Services section in the middle after successful login
    (function ensureServices(){
      // 1) Create the Services section dynamically if it doesn't exist
      let sec = document.getElementById('servicesSection');
      if (!sec) {
        const panel = document.getElementById('panel');
        const wrapper = (panel && panel.parentElement) ? panel.parentElement : document.body;
        sec = document.createElement('div');
        sec.id = 'servicesSection';
        sec.className = 'card reveal';
        // sec.setAttribute('data-requires-auth', '');
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

      // ensure auth-ready state and visibility
      try { document.body.classList.remove('auth-locked'); document.body.classList.add('auth-ready'); } catch(_){}
      try { sec.removeAttribute('data-requires-auth'); } catch(_){}
      if (sec) sec.style.display = 'block';

      // 2) Wire button + fill wedding id and show section
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
}

// === Drag & Drop Seating ===
function enableDnD(){
  document.querySelectorAll('.table-slot').forEach(slot => {
    slot.addEventListener('dragover', e => e.preventDefault());
    slot.addEventListener('drop', e => {
      e.preventDefault();
      const guestId = e.dataTransfer.getData('text/plain');
      if (!guestId) return;
      const chip = document.querySelector(`.guest-chip[data-id="${guestId}"]`);
      if (chip) slot.appendChild(chip);
      ASSIGN[guestId] = { table: slot.dataset.table };
    });
  });
  const pool = el('guestPool');
  if (pool){
    pool.addEventListener('dragover', e => e.preventDefault());
    pool.addEventListener('drop', e => {
      e.preventDefault();
      const guestId = e.dataTransfer.getData('text/plain');
      const chip = document.querySelector(`.guest-chip[data-id="${guestId}"]`);
      if (chip) pool.appendChild(chip);
      delete ASSIGN[guestId];
    });
  }
}

async function loadSeating(){
  ASSIGN = {};
  const snap = await db.collection('seating').doc(CURRENT_WEDDING).collection('assignments').get();
  snap.forEach(doc => { ASSIGN[doc.id] = doc.data(); });
  Object.entries(ASSIGN).forEach(([guestId, v]) => {
    const chip = document.querySelector(`.guest-chip[data-id="${guestId}"]`);
    const slot = document.querySelector(`.table-slot[data-table="${v.table}"]`);
    if (chip && slot) slot.appendChild(chip);
  });
}

async function saveSeating(){
  const batch = db.batch();
  const base = db.collection('seating').doc(CURRENT_WEDDING).collection('assignments');
  for (const [guestId, v] of Object.entries(ASSIGN)){
    batch.set(base.doc(guestId), { table: v.table, updatedAt: new Date() }, { merge: true });
  }
  await batch.commit();
  alert('Oturma planı kaydedildi.');
}


function boot(){
  enableDnD();
  const lastWedding = localStorage.getItem('ws_admin_wedding');
  if (lastWedding) el('weddingId').value = lastWedding;

  el('loginBtn').onclick = login;
  el('refreshBtn').onclick = loadGuests;
  el('loadSeatingBtn').onclick = loadSeating;
  el('saveSeatingBtn').onclick = saveSeating;

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

  // === Rehberden Seç & Gönder ===
  const pickBtn = document.getElementById('pickContactsBtn');
  const waBtn   = document.getElementById('waSendSelected');
  const smsBtn  = document.getElementById('smsSelected');

  async function pickContacts(){
    if (!(navigator.contacts && navigator.contacts.select)) {
      alert('Tarayıcı telefon rehberine erişimi desteklemiyor. Telefon tarayıcısı kullanın.');
      return;
    }
    try {
      const props = ['name','tel'];
      const opts = { multiple: true };
      const contacts = await navigator.contacts.select(props, opts);
      if (!contacts.length) return alert('Hiç kişi seçilmedi.');
      localStorage.setItem('selectedContacts', JSON.stringify(contacts));
      alert(`${contacts.length} kişi eklendi.`);
    } catch(err){
      console.error('Rehber seçimi hatası', err);
      alert('Rehber erişimi reddedildi veya hata oluştu.');
    }
  }

  function buildInviteLink(weddingId, name, phone){
    const base = window.location.origin + (window.location.pathname.replace(/\/admin\.html$/, '/index.html'));
    const url = new URL(base);
    url.searchParams.set('wedding', weddingId);
    if (name) url.searchParams.set('fn', name);
    if (phone) url.searchParams.set('ph', phone);
    return url.toString();
  }

  async function sendWhatsApp(){
    const data = JSON.parse(localStorage.getItem('selectedContacts')||'[]');
    if (!data.length) return alert('Hiç kişi seçilmedi.');
    const wid = CURRENT_WEDDING || el('weddingId').value;
    data.forEach((c, i) => {
      const name = (c.name && c.name[0]) || '';
      const phone = (c.tel && c.tel[0]) || '';
      const link = buildInviteLink(wid, name, phone);
      const msg = `Merhaba ${name}! Düğün davet linkimiz: ${link}`;
      const num = phone.replace(/[^0-9]/g, '');
      const wa = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
      setTimeout(()=> window.open(wa, '_blank'), i*400);
    });
  }

  async function sendSMS(){
    const data = JSON.parse(localStorage.getItem('selectedContacts')||'[]');
    if (!data.length) return alert('Hiç kişi seçilmedi.');
    const wid = CURRENT_WEDDING || el('weddingId').value;
    data.forEach((c, i) => {
      const name = (c.name && c.name[0]) || '';
      const phone = (c.tel && c.tel[0]) || '';
      const link = buildInviteLink(wid, name, phone);
      const msg = `Merhaba ${name}! Düğün davet linkimiz: ${link}`;
      const sms = `sms:${phone}?body=${encodeURIComponent(msg)}`;
      setTimeout(()=> window.open(sms, '_blank'), i*400);
    });
  }

  if (pickBtn) pickBtn.addEventListener('click', pickContacts);
  if (waBtn)   waBtn.addEventListener('click', sendWhatsApp);
  if (smsBtn)  smsBtn.addEventListener('click', sendSMS);
}
document.addEventListener('DOMContentLoaded', boot);

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  alert('Beklenmeyen hata: ' + (e.reason && (e.reason.code||e.reason.name)) + '\n' + (e.reason && e.reason.message));
});