// Firebase config (sen kendi bilgilerini buraya gireceksin)
const firebaseConfig = {
  apiKey: "SENİN_API_KEY",
  authDomain: "SENİN_DOMAIN",
  databaseURL: "SENİN_DB_URL",
  projectId: "SENİN_PROJECT_ID",
  storageBucket: "SENİN_BUCKET",
  messagingSenderId: "SENİN_MSG_ID",
  appId: "SENİN_APP_ID"
};

// Firebase başlat
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.database(app);

document.getElementById("rsvpForm").addEventListener("submit", function (e) {
  e.preventDefault();

  const firstName = document.getElementById("firstName").value;
  const lastName = document.getElementById("lastName").value;
  const phone = document.getElementById("phone").value;
  const attendance = document.getElementById("attendance").value;
  const guests = document.getElementById("guests").value;

  const newGuestRef = db.ref("guests").push();
  newGuestRef.set({
    firstName,
    lastName,
    phone,
    attendance,
    guests
  });

  document.getElementById("message").innerText = "Bilgileriniz kaydedildi 🎉";
  document.getElementById("rsvpForm").reset();
});
