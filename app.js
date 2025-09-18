import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// ✅ Ton projet
const firebaseConfig = {
  apiKey: "AIzaSyArmx-_3pcbTHkESpiJoUuODzAmxUQr3ZY",
  authDomain: "pokemon-c5b1b.firebaseapp.com",
  projectId: "pokemon-c5b1b",
  storageBucket: "pokemon-c5b1b.firebasestorage.app",
  messagingSenderId: "232864437078",
  appId: "1:232864437078:web:348aa379dbecde0e103cf7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

document.getElementById("btn").addEventListener("click", async () => {
  const status = document.getElementById("status");
  try {
    const docRef = await addDoc(collection(db, "user"), {
      username: "testUser",
      createdAt: Date.now()
    });
    status.textContent = "✅ User créé avec ID : " + docRef.id;
  } catch (err) {
    console.error(err);
    status.textContent = "❌ Erreur : " + err.message;
  }
});
