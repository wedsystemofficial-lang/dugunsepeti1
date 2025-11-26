// === script.js — MENÜSÜZ, YENİ SÜRÜM ===

// === Firestore Koleksiyonlarını Otomatik Başlat (index tarafı) ===
(function ensureFirestoreCollections(){
  function waitForDb(){
    return new Promise((resolve) => {
      (function poll(){
        if (window.db || (window.firebase && window.firebase.firestore)) return resolve();
        setTimeout(poll, 300);
      })();
    });
  }

  (async function run(){
    try{
      await waitForDb();
      const db = window.db || (window.firebase && window.firebase.firestore && window.firebase.firestore());
      if (!db) return;
      const fv = (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) || null;
      // menus KALKTI
      const needed = ['weddings','rsvp','seating'];
      for (const col of needed){
        try {
          const snap = await db.collection(col).limit(1).get();
          if (snap.empty){
            await db.collection(col).doc('_init').set({
              system: true,
              createdAt: fv ? fv.serverTimestamp() : new Date(),
              note: 'Otomatik oluşturuldu (index)'
            });
            console.log(`[Firestore] '${col}' koleksiyonu oluşturuldu (index).`);
          } else {
            console.log(`[Firestore] '${col}' mevcut (index).`);
          }
        } catch(err){
          console.warn('Koleksiyon kontrol hatası (index):', col, err);
        }
      }
    } catch(e){
      console.error('ensureFirestoreCollections hata:', e);
    }
  })();
})();

// === UI yardımcıları ===
function __setBusy(selectorOrEl, busy){
  try{
    const el = (typeof selectorOrEl === 'string') ? document.querySelector(selectorOrEl) : selectorOrEl;
    if (!el) return;
    if (busy){
      el.setAttribute('aria-busy','true');
      el.classList.add('skeleton');
    } else {
      el.removeAttribute('aria-busy');
      el.classList.remove('skeleton');
    }
  }catch(_){}
}

function setFormBusy(formEl, on){
  try{
    if (!formEl) return;
    const btn = formEl.querySelector('button[type="submit"]');
    if (btn) btn.disabled = !!on;
    if (window.wsSetLoading){
      window.wsSetLoading('#rsvpForm .card', !!on);
    } else {
      __setBusy(formEl, !!on);
    }
  }catch(_){}
}

// === Firestore erişimi ===
let __dbRef = null;
function getDb(){
  if (__dbRef) return __dbRef;
  try {
    if (window.db) { __dbRef = window.db; return __dbRef; }
    if (window.firebase && firebase.firestore) { __dbRef = firebase.firestore(); return __dbRef; }
  } catch(e) {}
  return null;
}

// === URL parametreleri ===
const urlParams = new URLSearchParams(window.location.search);
const weddingId = urlParams.get('wedding');

// Basit yardımcılar
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const normalizePhone = (p) => (p || '').replace(/\s+/g, '').replace(/[^+\d]/g, '');

// === weddingId rozeti ve uyarı ===
const badgeEl = document.getElementById('weddingBadge');
const warnEl  = document.getElementById('weddingWarning');

if (!weddingId) {
  if (badgeEl) badgeEl.textContent = '(weddingId eksik)';
  if (warnEl)  warnEl.style.display = 'block';

  const form = document.getElementById('rsvpForm');
  if (form) {
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      alert('Bu form özel düğün linki olmadan gönderilemez. Örn: index.html?wedding=kerem-yagmur');
    });
  }
} else {
  if (badgeEl) badgeEl.textContent = weddingId;
}

// === RSVP FORM ===
const formEl = document.getElementById('rsvpForm');
if (!formEl) {
  console.info('RSVP formu bu sayfada bulunamadı.');
} else if (!formEl.dataset.bound) {

  formEl.dataset.bound = '1';

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();

    setFormBusy(formEl, true);

    const firstName    = $('#firstName')?.value.trim() || '';
    const lastName     = $('#lastName')?.value.trim() || '';
    const phone        = normalizePhone($('#phone')?.value || '');
    const adultCountEl = document.getElementById('adultCount');
    const childCountEl = document.getElementById('childCount');

    const adultCount = Math.max(1, parseInt((adultCountEl && adultCountEl.value) || '1', 10));
    const childCount = Math.max(0, parseInt((childCountEl && childCountEl.value) || '0', 10));
    const guestCount = adultCount + childCount;

    const attendance = (document.querySelector('input[name="attendance"]:checked') || {}).value;

    // === VALIDASYON ===
    if (!firstName || !lastName || !phone || !attendance) {
      alert('Lütfen ad, soyad, telefon ve katılım durumunu doldurun.');
      setFormBusy(formEl, false);
      return;
    }
    if (!Number.isFinite(adultCount) || adultCount < 1) {
      alert('Yetişkin sayısı en az 1 olmalıdır.');
      setFormBusy(formEl, false);
      return;
    }
    if (!Number.isFinite(childCount) || childCount < 0) {
      alert('Çocuk sayısı 0 veya üzeri olmalıdır.');
      setFormBusy(formEl, false);
      return;
    }
    if (!weddingId) {
      alert('Bu form özel düğün linki olmadan gönderilemez. Lütfen düğün sahibinin gönderdiği linki kullanın.');
      setFormBusy(formEl, false);
      return;
    }

    // === Onay kutusu (hemen göster) ===
    const confirmEl_imm = document.getElementById('confirmation');
    if (confirmEl_imm) {
      confirmEl_imm.classList.remove('hidden');
      confirmEl_imm.classList.add('show');
      const btn = document.getElementById('closeConfirm');
      if (btn) {
        btn.onclick = () => {
          confirmEl_imm.classList.remove('show');
          setTimeout(() => confirmEl_imm.classList.add('hidden'), 200);
        };
      }
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    try {
      const db = getDb();
      if (!db) {
        alert('Veritabanı başlatılamadı. Lütfen Firebase scriptlerinin yüklü olduğundan emin olun.');
        setFormBusy(formEl, false);
        return;
      }

      // Aynı telefonla birden fazla kayıt olmasın
      const existingSnap = await db
        .collection('rsvp')
        .where('weddingId', '==', weddingId)
        .where('phone', '==', phone)
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        alert('Bu telefon ile zaten bir kayıt mevcut.');
        setFormBusy(formEl, false);
        return;
      }

      // Firestore'a yaz
      const addPromise = db.collection('rsvp').add({
        weddingId,
        firstName,
        lastName,
        phone,
        attendance,
        adultCount: adultCount,
        childCount: childCount,
        guestCount: guestCount,
        createdAt: (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue)
          ? window.firebase.firestore.FieldValue.serverTimestamp()
          : new Date()
      });

      const timeoutPromise = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('İstek zaman aşımına uğradı (10sn).')), 10000)
      );

      const docRef = await Promise.race([addPromise, timeoutPromise]);

      try {
        if (docRef && docRef.id) {
          window.__RSVP_DOC_ID__ = docRef.id;
        }
      } catch (_){}

      try { formEl.reset(); } catch(_){}

      // Skeleton & busy temizleme
      setTimeout(() => {
        try {
          const card = document.querySelector('#rsvpForm .card');
          if (card) card.classList.remove('skeleton');
          const frm = document.getElementById('rsvpForm');
          if (frm) frm.removeAttribute('aria-busy');
          Array.from(document.querySelectorAll('#rsvpForm button, #rsvpForm input, #rsvpForm select, #rsvpForm textarea'))
            .forEach((el) => { el.disabled = false; });
          document.body.style.pointerEvents = '';
        } catch(_){}
      }, 800);

    } catch (err) {
      console.error('Kayıt hatası:', err);
      const code = err && (err.code || err.error || err.name);
      const msg  = err && (err.message || String(err));
      alert(
        'Hata Kodu: ' + code + '\nMesaj: ' + msg +
        '\n\nEğer kod permission-denied ise Rules/Enforcement ayarlarını kontrol et.' +
        '\nfailed-precondition ise konsoldaki Create index linkine tıkla.'
      );
    } finally {
      setFormBusy(formEl, false);
    }
  });
}