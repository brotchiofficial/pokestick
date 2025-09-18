// app.js — Final: consolidated + animations + rarity weighting
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// ---- Firebase config ----
const firebaseConfig = {
  apiKey: "AIzaSyArmx-_3pcbTHkESpiJoUuODzAmxUQr3ZY",
  authDomain: "pokemon-c5b1b.firebaseapp.com",
  projectId: "pokemon-c5b1b",
  storageBucket: "pokemon-c5b1b.firebasestorage.app",
  messagingSenderId: "232864437078",
  appId: "1:232864437078:web:348aa379dbecde0e103cf7"
};

// ---- Init ----
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const usersRef = collection(db, "user");

// ---- TCGdex REST ----
const API_BASE = "https://api.tcgdex.net/v2";
const LANG = "fr";

// ---- Utilities ----
async function sha256(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function renderEnergyBar(n=0) {
  const bar = $("#energy-bar");
  bar.innerHTML = "";
  for (let i=0;i<10;i++) {
    const cell = document.createElement("div");
    cell.className = "cell" + (i < n ? " on" : "");
    bar.appendChild(cell);
  }
}

function fmtMMSS(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


function showToast(msg, type="success") {
  const wrap = document.getElementById("toast");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "toast-item " + type;
  const icon = type === "success" ? "✔" : "⚠";
  el.innerHTML = `<span class="icon">${icon}</span><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 200);
  }, 3000);
}



function closeOverlay() {
  const overlay = document.getElementById("overlay");
  const img = document.getElementById("overlay-image");
  const meta = document.getElementById("overlay-meta");
  if (!overlay) return;
  overlay.classList.add("hidden");
  if (img) img.src = "";
  if (meta) meta.textContent = "";
  document.removeEventListener("keydown", escCloser);
}

function escCloser(e) {
  if (e.key === "Escape") {
    closeOverlay();
  }
}


// ---- Rarity weighting (best-effort mapping FR/EN) ----
const rarityWeights = [
  { k: ["commun","common"], w: 60 },
  { k: ["peu commun","uncommon"], w: 25 },
  { k: ["rare","rare holo","holo","holographique"], w: 10 },
  { k: ["ultra","ultra rare","v","vmax","vstar","ex"], w: 3 },
  { k: ["secrète","secret","gold","rainbow"], w: 2 },
];
function weightFor(rarityText="") {
  const t = rarityText.toLowerCase();
  for (const {k,w} of rarityWeights) {
    if (k.some(s => t.includes(s))) return w;
  }
  return 15; // fallback
}

// ---- State ----
let currentUser = null; // { username, energy, collectionCount, lastEnergyGainMs }
const ENERGY_CAP = 10;
const ENERGY_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Debounced saver to limit writes
let saveTimer = null;
function scheduleSave(userDocRef, data) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await updateDoc(userDocRef, data);
  }, 1200);
}

// ---- Auth: Register ----

$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const username = $("#reg-username").value.trim();
  const password = $("#reg-password").value;
  const msg = $("#auth-msg");
  msg.textContent = "";

  if (!username || !password) { showToast("Pseudo et mot de passe requis.", "error"); return false; }

  try {
    const userDoc = doc(usersRef, username);
    const snap = await getDoc(userDoc);
    if (snap.exists()) {
      msg.textContent = "Ce pseudo existe déjà.";
      showToast("Ce pseudo existe déjà.", "error");
      return false;
    }
    const passHash = await sha256(password);
    const now = Date.now();
    await setDoc(userDoc, {
      username, passHash, energy: 10, collectionCount: 0,
      lastEnergyGainMs: now, createdAtMs: now
    });
    msg.textContent = "Compte créé ! Vous pouvez vous connecter.";
    showToast("Le compte a bien été créé ✔", "success");
    $("#reg-username").value = "";
    $("#reg-password").value = "";
    return false;
  } catch (err) {
    console.error(err);
    showToast("Erreur à la création du compte", "error");
    msg.textContent = "Erreur : " + (err.message || err.code || err);
    return false;
  }
});

  msg.textContent = "Compte créé ! Vous pouvez vous connecter.";
  $("#reg-username").value = "";
  $("#reg-password").value = "";
});

// ---- Auth: Login ----

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const username = $("#login-username").value.trim();
  const password = $("#login-password").value;
  const msg = $("#auth-msg");
  msg.textContent = "";

  if (!username || !password) { showToast("Pseudo et mot de passe requis.", "error"); return false; }

  try {
    const userDoc = doc(usersRef, username);
    const snap = await getDoc(userDoc);
    if (!snap.exists()) {
      msg.textContent = "Aucun compte pour ce pseudo.";
      showToast("Aucun compte pour ce pseudo.", "error");
      return false;
    }
    const data = snap.data();
    const passHash = await sha256(password);
    if (passHash !== data.passHash) {
      msg.textContent = "Mot de passe incorrect.";
      showToast("Mot de passe incorrect.", "error");
      return false;
    }
    currentUser = {
      username: data.username,
      energy: Math.min(data.energy ?? 0, ENERGY_CAP),
      collectionCount: data.collectionCount ?? 0,
      lastEnergyGainMs: data.lastEnergyGainMs ?? Date.now()
    };
    localStorage.setItem("pokeapp_user", currentUser.username);
    showToast("Connexion réussie ✔", "success");
    await enterApp();
    return false;
  } catch (err) {
    console.error(err);
    showToast("Erreur à la connexion", "error");
    msg.textContent = "Erreur : " + (err.message || err.code || err);
    return false;
  }
});
  }

  currentUser = {
    username: data.username,
    energy: Math.min(data.energy ?? 0, ENERGY_CAP),
    collectionCount: data.collectionCount ?? 0,
    lastEnergyGainMs
  };
  localStorage.setItem("pokeapp_user", username);
  await enterApp();
});

$("#login-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#loginForm").requestSubmit();
});

// ---- App Entry ----
function switchView(id) {
  ["dashboard", "view-booster", "view-combat", "view-collection"].forEach(v => {
    const el = (v === "dashboard") ? $("#dashboard") : document.getElementById(v);
    if (!el) return;
    if (v === id) show(el); else hide(el);
  });
}

$all(".nav").forEach(btn => {
  btn.addEventListener("click", () => {
    const v = btn.dataset.view;
    switchView("view-" + v);
  });
});

let energyTick = null;
async function enterApp() {
  $("#header-username").textContent = "@" + currentUser.username;
  renderEnergyBar(currentUser.energy ?? 0);
  $("#hello").textContent = `Bonjour ${currentUser.username} !`;
  $("#card-count").textContent = `Tu as ${currentUser.collectionCount ?? 0} carte${(currentUser.collectionCount ?? 0) > 1 ? "s" : ""}.`;

  hide($("#auth"));
  show($("#app"));

  if (energyTick) clearInterval(energyTick);
  energyTick = setInterval(tickEnergy, 1000);
  tickEnergy();

  $("#load-sets").addEventListener("click", loadSets, { once: true });
}

// ---- Energy Tick ----
async function tickEnergy() {
  if (!currentUser) return;
  const userDocRef = doc(usersRef, currentUser.username);

  const now = Date.now();
  let { energy, lastEnergyGainMs } = currentUser;
  energy = Math.min(energy ?? 0, ENERGY_CAP);

  if (energy >= ENERGY_CAP) {
    $("#energy-timer").textContent = "Énergie max";
    renderEnergyBar(energy);
    return;
  }

  const elapsed = now - (lastEnergyGainMs ?? now);
  const gained = Math.floor(elapsed / ENERGY_INTERVAL);
  if (gained > 0) {
    energy = Math.min(ENERGY_CAP, energy + gained);
    lastEnergyGainMs = (lastEnergyGainMs ?? now) + gained * ENERGY_INTERVAL;
    currentUser.energy = energy;
    currentUser.lastEnergyGainMs = lastEnergyGainMs;
    renderEnergyBar(energy);
    scheduleSave(userDocRef, { energy, lastEnergyGainMs });
  }

  if (energy < ENERGY_CAP) {
    const nextIn = ENERGY_INTERVAL - (now - lastEnergyGainMs);
    $("#energy-timer").textContent = `+1 énergie dans ${fmtMMSS(nextIn)}`;
  } else {
    $("#energy-timer").textContent = "Énergie max";
  }
}

// ---- Logout ----
$("#logout").addEventListener("click", () => {
  localStorage.removeItem("pokeapp_user");
  currentUser = null;
  show($("#auth"));
  hide($("#app"));
  if (energyTick) clearInterval(energyTick);
});

// ---- Auto-login ----
(async function autologin() {
  const saved = localStorage.getItem("pokeapp_user");
  if (!saved) return;
  const snap = await getDoc(doc(usersRef, saved));
  if (snap.exists()) {
    const data = snap.data();
    const now = Date.now();
    let lastEnergyGainMs = data.lastEnergyGainMs ?? now;
    if (data.lastEnergyGainMs == null) {
      await updateDoc(doc(usersRef, saved), { lastEnergyGainMs });
    }
    currentUser = {
      username: data.username,
      energy: Math.min(data.energy ?? 0, ENERGY_CAP),
      collectionCount: data.collectionCount ?? 0,
      lastEnergyGainMs
    };
    enterApp();
  }
})();

// ========================= TCGdex: Sets & Boosters =========================
const API_BASE = "https://api.tcgdex.net/v2";
const LANG = "fr";

async function loadSets() {
  const status = $("#sets-status");
  const list = $("#sets-list");
  status.textContent = "Chargement des séries...";
  list.innerHTML = "";

  try {
    const res = await fetch(`${API_BASE}/${LANG}/sets`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const sets = await res.json();
    status.textContent = `Séries trouvées : ${sets.length}. Clique pour afficher les boosters.`;

    for (const set of sets) {
      const block = document.createElement("div");
      block.className = "set-block";
      block.innerHTML = `
        <div class="set-head">
          <img class="set-logo" src="${(set.logo || "").toString()}" alt="Logo ${set.name || set.id}"/>
          <div class="set-name">${set.name || set.id}</div>
          <div class="set-toggle">▼</div>
        </div>
        <div class="set-content"><div class="boosters"></div></div>
      `;
      const head = block.querySelector(".set-head");
      const content = block.querySelector(".set-content");
      const boostersDiv = block.querySelector(".boosters");

      let loaded = false;
      head.addEventListener("click", async () => {
        content.classList.toggle("show");
        if (!loaded && content.classList.contains("show")) {
          boostersDiv.innerHTML = "<span class='muted'>Chargement des boosters…</span>";
          const res2 = await fetch(`${API_BASE}/${LANG}/sets/${set.id}`);
          const setFull = await res2.json();
          boostersDiv.innerHTML = "";
          if (setFull.boosters && setFull.boosters.length) {
            for (const b of setFull.boosters) {
              const btn = document.createElement("button");
              btn.className = "booster";
              const cost = boosterCost(b);
              btn.innerHTML = `
                <img src="${(b.logo || b.artwork_front || "").toString()}" alt="Booster"/>
                <div class="b-meta">
                  <div class="b-name">${b.name || b.id}</div>
                  <div class="b-cost">Coût: ${cost} énergie${cost>1?"s":""}</div>
                </div>
              `;
              btn.addEventListener("click", () => openBooster(setFull, b, cost));
              boostersDiv.appendChild(btn);
            }
          } else {
            boostersDiv.innerHTML = "<span class='muted'>Aucun booster pour cette série.</span>";
          }
          loaded = true;
        }
      });

      list.appendChild(block);
    }
  } catch (err) {
    status.textContent = "Erreur de chargement des séries (vérifie ta connexion).";
    console.error(err);
  }
}

function boosterCost(booster) {
  const n = (booster?.name || "").toLowerCase();
  const id = (booster?.id || "").toLowerCase();
  const heavy = ["premium","elite","special","collector","collection","ultra","etb","display","box"];
  return heavy.some(k => n.includes(k) || id.includes(k)) ? 10 : 1;
}

// ========================= Pack Opening =========================
async function openBooster(setFull, booster, cost) {
  if (!currentUser) return;
  if ((currentUser.energy ?? 0) < cost) {
    alert("Pas assez d'énergie.");
    return;
  }

  const size = parseInt($("#pack-size").value, 10) || 5;
  const anim = $("#anim-enabled").checked;

  // Deduct energy immediately (optimistic)
  const userDocRef = doc(usersRef, currentUser.username);
  currentUser.energy = Math.max(0, (currentUser.energy ?? 0) - cost);
  renderEnergyBar(currentUser.energy);
  scheduleSave(userDocRef, { energy: currentUser.energy });

  // Ensure set cards
  let cards = setFull.cards;
  if (!cards || !cards.length) {
    const res = await fetch(`${API_BASE}/${LANG}/sets/${setFull.id}`);
    const data = await res.json();
    cards = data.cards || [];
  }
  if (!cards.length) {
    alert("Aucune carte trouvée pour cette série.");
    return;
  }

  // Weighted random sample (no replacement)
  const pack = weightedSample(cards, size, c => weightFor(c.rarity || ""));
  await revealPack(pack, anim);

  // Save to Firestore
  let newCount = 0;
  for (const c of pack) {
    const colRef = doc(collection(userDocRef, "collection"), c.id);
    const snap = await getDoc(colRef);
    const prev = snap.exists() ? (snap.data().count || 0) : 0;
    await setDoc(colRef, { id: c.id, name: c.name, image: c.image, setId: c.set?.id || setFull.id, count: prev + 1 }, { merge: true });
    newCount++;
  }
  currentUser.collectionCount = (currentUser.collectionCount || 0) + newCount;
  $("#card-count").textContent = `Tu as ${currentUser.collectionCount} carte${currentUser.collectionCount>1?"s":""}.`;
  scheduleSave(userDocRef, { collectionCount: currentUser.collectionCount });

  refreshCollectionGrid();
}

function weightedSample(arr, n, weightFn) {
  const items = arr.map(a => ({ a, w: Math.max(1, Number(weightFn(a)) || 1) }));
  const result = [];
  let pool = [...items];
  for (let i=0; i<Math.min(n, pool.length); i++) {
    const totalW = pool.reduce((s,x)=>s+x.w,0);
    let r = Math.random() * totalW;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx].w;
      if (r <= 0) break;
    }
    result.push(pool[idx].a);
    pool.splice(idx,1);
  }
  return result;
}

async function revealPack(cards, anim=true) {
  const overlay = document.getElementById("overlay");
  const img = document.getElementById("overlay-image");
  const meta = document.getElementById("overlay-meta");
  const card3d = document.getElementById("overlay-card");
  let idx = 0;

  function showCard(i) {
    const c = cards[i];
    img.src = (c.image || "").toString();
    img.alt = c.name || c.id || "";
    meta.textContent = `${c.name || c.id || ""} — ${c.set?.name || c.set?.id || ""}${c.rarity ? " — " + c.rarity : ""}`;
    if (anim) {
      card3d.classList.remove("flip","glow");
      setTimeout(()=> card3d.classList.add("flip"), 20);
      setTimeout(()=> card3d.classList.add("glow"), 300);
    } else {
      card3d.classList.remove("flip","glow");
    }
  }

  // Show overlay only here
  overlay.classList.remove("hidden");
  showCard(idx);

  const next = async () => {
    idx++;
    if (idx >= cards.length) {
      overlay.removeEventListener("click", next);
      closeOverlay();
    } else {
      await sleep(80);
      showCard(idx);
    }
  };

  overlay.addEventListener("click", next);
  // ESC to close anytime
  document.addEventListener("keydown", escCloser);
}
  }

  show(overlay);
  showCard(idx);

  const next = async () => {
    idx++;
    if (idx >= cards.length) {
      overlay.classList.add("hidden");
      overlay.removeEventListener("click", next);
      img.src = "";
      meta.textContent = "";
    } else {
      await sleep(80);
      showCard(idx);
    }
  };

  overlay.addEventListener("click", next);
}

// ========================= Collection View =========================
async function refreshCollectionGrid() {
  if (!currentUser) return;
  const grid = $("#collection-grid");
  grid.innerHTML = "<span class='muted'>Chargement…</span>";

  const userDocRef = doc(usersRef, currentUser.username);
  const { getDocs } = await import("https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js");
  const snap = await getDocs(collection(userDocRef, "collection"));
  grid.innerHTML = "";
  snap.forEach(docSnap => {
    const d = docSnap.data();
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.innerHTML = `
      <img src="${(d.image || "").toString()}" alt="${d.name || d.id}" style="width:100%; border-radius:10px; margin-bottom:8px;">
      <div><strong>${d.name || d.id}</strong></div>
      <div class="muted">${d.id}</div>
      <div>Qté: ${d.count || 1}</div>
    `;
    grid.appendChild(tile);
  });
}

// ========================= Helpers =========================

// Attach boosters view when nav clicked
document.querySelector('[data-view="booster"]').addEventListener("click", () => {
  // user must click "Charger la liste des séries" to avoid huge initial fetch
});



// Ensure overlay is hidden/reset on startup
window.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("overlay");
  const img = document.getElementById("overlay-image");
  const meta = document.getElementById("overlay-meta");
  if (overlay) overlay.classList.add("hidden");
  if (img) img.src = "";
  if (meta) meta.textContent = "";
});
