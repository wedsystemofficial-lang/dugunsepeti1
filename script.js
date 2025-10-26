// Form ve Firestore entegrasyonu
let __dbRef = null;
function getDb(){
  if (__dbRef) return __dbRef;
  try {
    if (window.db) { __dbRef = window.db; return __dbRef; }
    if (window.firebase && firebase.firestore) { __dbRef = firebase.firestore(); return __dbRef; }
  } catch(e) {}
  return null;
}

// URL'den wedding parametresi (örn: ?wedding=kerem-yagmur)
const urlParams = new URLSearchParams(window.location.search);
const weddingId = urlParams.get('wedding');

// Basit yardımcılar
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const normalizePhone = (p) => (p || '').replace(/\s+/g, '').replace(/[^+\d]/g, '');

// UI: weddingId rozeti ve uyarı
const badgeEl = document.getElementById('weddingBadge');
const warnEl  = document.getElementById('weddingWarning');
if (!weddingId) {
  if (badgeEl) badgeEl.textContent = '(weddingId eksik)';
  if (warnEl)  warnEl.style.display = 'block';
  // Form gönderimini devre dışı bırak
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

const formEl = document.getElementById('rsvpForm');
if (!formEl) {
  // Bu sayfada form yoksa (ör. landing/admin), hata vermeden çık
  console.info('RSVP formu bu sayfada bulunamadı.');
} else formEl.addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = e.target.querySelector('button[type="submit"]');

  const firstName  = $('#firstName').value.trim();
  const lastName   = $('#lastName').value.trim();
  const phone      = normalizePhone($('#phone').value);
  const guestCount = Number($('#guestCount').value);
  const attendance = (document.querySelector('input[name="attendance"]:checked') || {}).value;

  if (!firstName || !lastName || !phone || !guestCount || !attendance) {
    alert('Lütfen tüm alanları doldurun ve katılım durumunu seçin.');
    return;
  }
  if (guestCount < 1) {
    alert('Kişi sayısı en az 1 olmalıdır.');
    return;
  }
  if (submitBtn) submitBtn.disabled = true;
  if (window.wsSetLoading) wsSetLoading('#rsvpForm .card', true);

  if (!weddingId) {
    alert('Bu form özel düğün linki olmadan gönderilemez. Lütfen düğün sahibinin gönderdiği linki kullanın.');
    if (submitBtn) submitBtn.disabled = false;
    if (window.wsSetLoading) wsSetLoading('#rsvpForm .card', false);
    return;
  }

  try {
    const db = getDb();
    if (!db) {
      alert('Veritabanı başlatılamadı. Lütfen Firebase scriptlerinin yüklü olduğundan emin olun.');
      if (submitBtn) submitBtn.disabled = false;
      if (window.wsSetLoading) wsSetLoading('#rsvpForm .card', false);
      return;
    }
    // Basit mükerrer kontrol (wedding + phone)
    const existingSnap = await db
      .collection('rsvp')
      .where('weddingId', '==', weddingId)
      .where('phone', '==', phone)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      alert('Bu telefon ile zaten bir kayıt mevcut.');
      if (submitBtn) submitBtn.disabled = false;
      if (window.wsSetLoading) wsSetLoading('#rsvpForm .card', false);
      return;
    }

    await db.collection('rsvp').add({
      weddingId,
      firstName,
      lastName,
      phone,
      attendance,
      guestCount,
      createdAt: (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue)
        ? window.firebase.firestore.FieldValue.serverTimestamp()
        : new Date()
    });

    e.target.reset();

    if (window.wsSetLoading) wsSetLoading('#rsvpForm .card', false);
    if (submitBtn) submitBtn.disabled = false;

    const confirmEl = document.getElementById('confirmation');
    if (confirmEl) {
      confirmEl.classList.remove('hidden');
      confirmEl.classList.add('show');
      const cdEl = document.getElementById('countdown');
      let left = 5;
      if (cdEl) cdEl.textContent = String(left);

      const hideConfirm = () => {
        confirmEl.classList.remove('show');
        setTimeout(() => confirmEl.classList.add('hidden'), 200);
      };

      const timer = setInterval(() => {
        left -= 1;
        if (cdEl) cdEl.textContent = String(left);
        if (left <= 0) {
          clearInterval(timer);
          hideConfirm();
        }
      }, 1000);

      const btn = document.getElementById('closeConfirm');
      if (btn) {
        btn.onclick = () => {
          clearInterval(timer);
          hideConfirm();
        };
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (window.showToast) showToast('Bilgileriniz kaydedildi');
    else alert('Bilgileriniz kaydedildi');

    // Tüm UI state'lerini güvenli şekilde kapat
    if (window.wsSetLoading) wsSetLoading('#rsvpForm .card', false);
    if (submitBtn) submitBtn.disabled = false;

    // Onay kutusunu kısa bir gecikmeyle gizle
    setTimeout(() => {
      const confirmEl2 = document.getElementById('confirmation');
      if (confirmEl2) {
        confirmEl2.classList.remove('show');
        confirmEl2.classList.add('hidden');
      }
    }, 300);

    setTimeout(() => {
      location.href = location.pathname + location.search;
    }, 3000);

    setTimeout(() => {
      try {
        var card = document.querySelector('#rsvpForm .card');
        if (card) card.classList.remove('skeleton');
        var frm = document.getElementById('rsvpForm');
        if (frm) frm.removeAttribute('aria-busy');
        Array.from(document.querySelectorAll('#rsvpForm button, #rsvpForm input, #rsvpForm select, #rsvpForm textarea')).forEach(function(el){ el.disabled = false; });
        document.body.style.pointerEvents = '';
      } catch(_) {}
    }, 1200);
  } catch (err) {
    if (window.showToast) showToast('Hata: ' + (err && err.message ? err.message : 'İşlem tamamlanamadı'));
    console.error('Kayıt hatası:', err);
    const code = err && (err.code || err.error || err.name);
    const msg  = err && (err.message || String(err));
    alert('Hata Kodu: ' + code + '\nMesaj: ' + msg + '\n' +
          'Eğer kod permission-denied ise Rules/Enforcement ayarlarını kontrol et.\n' +
          'failed-precondition ise konsoldaki Create index linkine tıkla.');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (window.wsSetLoading) wsSetLoading('#rsvpForm .card', false);
    try {
      formEl.style.pointerEvents = '';
      formEl.classList.remove('skeleton');
      formEl.removeAttribute('aria-busy');
      e.target.querySelectorAll('button, input, select, textarea').forEach(el=>{ el.disabled = false; });
    } catch(_) {}
  }
});
