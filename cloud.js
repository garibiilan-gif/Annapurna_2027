/* Shared trips: sign-in (Firebase Auth) and trip records (Firestore).
   The page works without this file (the trip kept in this browser); it adds:
   - live loading and saving of a shared trip (?trip=<id>),
   - who you are: owner, the trip's admin, or a viewer,
   - the sign-in box and the owner's trip list.
   Who may change what is enforced by firestore.rules, not here. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBkRjxyJNyxa_hrQGUsVWqgKDlZrjGKGAE",
  authDomain: "trek-manager-b0325.firebaseapp.com",
  projectId: "trek-manager-b0325",
  storageBucket: "trek-manager-b0325.firebasestorage.app",
  messagingSenderId: "304766019578",
  appId: "1:304766019578:web:ec1088476bf41045026643"
};
/* The owner's Firebase user id (not secret; the same value is in firestore.rules) */
const OWNER_UID = "UAvLjeR3A8MMG8nLMiy2990jO3E3";

/* Testing on this computer only: localhost with ?emu uses the local Firebase emulators (npm run emulators), never the real data */
const EMU = location.hostname === "localhost" && new URLSearchParams(location.search).has("emu");
if (EMU) firebaseConfig.projectId = "demo-trek";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
/* Trips opened once stay readable offline, on the trail */
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
if (EMU) { connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true }); connectFirestoreEmulator(db, "127.0.0.1", 8080); }

const App = window.TripApp;   // hooks from the page: tripId, applyTrip(data), setRole(role, user), onTrips(list)
const tripRef = id => doc(db, "trips", id);
const adminsRef = id => doc(db, "tripAdmins", id);
const clean = v => JSON.parse(JSON.stringify(v ?? null));   // Firestore refuses undefined values
const cleanEmails = s => [...new Set(String(s).split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];

let user = null, role = "viewer";

/* ---------- The open trip: live from the database ---------- */
if (App.tripId !== "local") {
  onSnapshot(tripRef(App.tripId), { includeMetadataChanges: false }, snap => {
    if (snap.metadata.hasPendingWrites) return;   // our own save, already on screen
    if (!snap.exists() && snap.metadata.fromCache) { App.applyTrip(null, "offline"); return; }   // not reached yet, nothing saved here
    App.applyTrip(snap.exists() ? snap.data() : null);
  }, err => App.applyTrip(null, err));
}
let saves = 0;
async function saveTrip(trip) {
  if (App.tripId === "local" || (role !== "admin" && role !== "owner")) return;
  const n = ++saves;
  App.saveState("saving");
  /* The write is kept on this device at once; the promise settles when the server has it */
  const slow = setTimeout(() => { if (n === saves) App.saveState("offline"); }, 4000);
  try {
    await updateDoc(tripRef(App.tripId), { start: trip.start || null, flights: clean(trip.flights), updatedAt: serverTimestamp() });
    if (n === saves) App.saveState("saved");
  } catch (e) { App.saveState("failed", e); }
  finally { clearTimeout(slow); }
}

/* ---------- Who is signed in, and what they may do here ---------- */
async function roleFor(u) {
  if (!u) return "viewer";
  if (u.uid === OWNER_UID) return "owner";
  if (App.tripId === "local" || !u.emailVerified) return "viewer";
  try {   // readable only by the owner and the trip's own admins (firestore.rules)
    const a = await getDoc(adminsRef(App.tripId));
    return a.exists() && (a.data().emails || []).includes((u.email || "").toLowerCase()) ? "admin" : "viewer";
  } catch (e) { return "viewer"; }
}
async function applyRole() {
  role = await roleFor(user);
  App.setRole(role, user && { email: user.email, uid: user.uid, verified: user.emailVerified });
  renderBox();
}
onAuthStateChanged(auth, u => { user = u; applyRole(); });
/* Back on the tab: admin rights may have been given or removed, or the email confirmed, meanwhile */
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !user) return;
  const before = role;
  if (!user.emailVerified) { try { await user.reload(); if (user.emailVerified) await user.getIdToken(true); } catch (e) {} }
  const now = await roleFor(user);
  if (now !== before) applyRole();
});

/* ---------- Owner: trips and their admins ---------- */
const slug = s => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 40);
async function listTrips() {
  const snap = await getDocs(collection(db, "trips"));
  const trips = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (role === "owner") await Promise.all(trips.map(async t => {
    try { const a = await getDoc(adminsRef(t.id)); t.admins = a.exists() ? a.data().emails || [] : []; } catch (e) { t.admins = []; }
  }));
  return trips.sort((a, b) => (a.start || "9999").localeCompare(b.start || "9999") || a.name.localeCompare(b.name));
}
async function createTrip({ name, trek, admins }) {
  /* The link carries a random code, so a viewer of one trip can't guess another's */
  const code = [...crypto.getRandomValues(new Uint8Array(10))].map(b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
  const id = `${slug(name).slice(0, 30) || "trip"}-${code}`;
  if ((await getDoc(tripRef(id))).exists()) throw new Error(`A trip with the link name “${id}” already exists. Choose another name.`);
  await setDoc(tripRef(id), { trek, name: name.trim(), start: null, flights: {}, updatedAt: serverTimestamp() });
  await setDoc(adminsRef(id), { emails: cleanEmails(admins) });
  return id;
}

/* ---------- The sign-in box ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ROLE_TXT = { owner: "Owner", admin: "Trip admin", viewer: "" };
const dlg = $("acct-dlg");
let msg = "";

function tripLink(id) { const u = new URL(location.href); u.search = `?trip=${encodeURIComponent(id)}${EMU ? "&emu" : ""}`; u.hash = ""; return u.href; }

async function renderBox() {
  $("acct-btn").textContent = user ? (ROLE_TXT[role] ? `${ROLE_TXT[role]} ✓` : "Signed in") : "Sign in";
  $("acct-btn").title = user ? `Signed in as ${user.email}. Opens your account${role === "owner" ? " and the trip list" : ""}.` : "Trip admins and the owner sign in here to edit. Viewers don't need to.";
  if (!dlg.open) return;
  const box = $("acct-body");
  if (!user) {
    box.innerHTML = `<h2>Sign in</h2>
      <p class="hint">Only the trip's admin and the site owner sign in. Everyone else just opens the trip link.</p>
      <button type="button" class="fl-btn" data-act="google">Sign in with Google</button>
      <form id="acct-form" class="acct-form" novalidate>
        <label>Email<input type="email" id="acct-email" autocomplete="email" required></label>
        <label>Password<input type="password" id="acct-pass" autocomplete="current-password" minlength="6" required></label>
        <div class="acct-row">
          <button type="submit" class="fl-btn">Sign in</button>
          <button type="button" class="fl-btn ghost" data-act="signup" title="Creates an account with this email and password, and sends a link to confirm the email. Admin rights work once it is confirmed.">Create account</button>
          <button type="button" class="linkish" data-act="reset">Forgot password?</button>
        </div>
      </form>
      <p class="acct-msg" role="status">${esc(msg)}</p>`;
    return;
  }
  let html = `<h2>${esc(user.email)}</h2>
    <p>${role === "owner" ? "You are the <b>owner</b>: you can create trips and choose their admins."
      : role === "admin" ? "You are this trip's <b>admin</b>: you can set its dates and flights."
      : App.tripId === "local" ? "Open a trip link to see what you can do there."
      : "You can view this trip. Only its admins can change it."}</p>
    ${!user.emailVerified ? `<p class="fl-err">Your email isn't confirmed yet, so admin rights don't apply. Check your inbox for the link, then sign in again.
      <button type="button" class="linkish" data-act="verify">Send the link again</button></p>` : ""}
    <p class="hint">User id: <code>${esc(user.uid)}</code></p>
    <button type="button" class="fl-btn ghost" data-act="signout">Sign out</button>
    <p class="acct-msg" role="status">${esc(msg)}</p>`;
  if (role === "owner") {
    html += `<h3>Trips</h3><div id="acct-trips"><p class="hint">Loading…</p></div>
      <form id="trip-form" class="acct-form" novalidate>
        <h3>New trip</h3>
        <label>Name<input id="trip-name-in" maxlength="80" placeholder="e.g. Annapurna, April group" required></label>
        <label>Trek<select id="trip-trek">${Object.values(App.treks).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></label>
        <label>Admin emails<input id="trip-admins" placeholder="one or more, separated by commas"
          title="People who may set this trip's dates, flights and hotels. They sign in with this email (Google, or an email and password they create)."></label>
        <div class="acct-row"><button type="submit" class="fl-btn">Create trip</button></div>
      </form>`;
  }
  box.innerHTML = html;
  if (role === "owner") renderTrips();
}
async function renderTrips() {
  const el = $("acct-trips");
  try {
    const trips = await listTrips();
    el.innerHTML = trips.length ? trips.map(t => `<div class="acct-trip" data-id="${esc(t.id)}">
        <div><a href="${esc(tripLink(t.id))}"><b>${esc(t.name)}</b></a> <span class="hint">${esc(App.treks[t.trek]?.name || t.trek)} · ${t.start ? esc(t.start) : "no date yet"}</span></div>
        <label class="acct-admins">Admins<input value="${esc((t.admins || []).join(", "))}" data-admins="${esc(t.id)}"
          title="Change the emails and press Enter or leave the field to save."></label>
        <div class="acct-row">
          <button type="button" class="linkish" data-copy="${esc(t.id)}">Copy link</button>
          <button type="button" class="linkish danger" data-del-trip="${esc(t.id)}">Delete</button>
        </div></div>`).join("") : `<p class="hint">No trips yet. Create the first one below.</p>`;
  } catch (e) { el.innerHTML = `<p class="fl-err">Couldn't load the trips: ${esc(e.message)}</p>`; }
}
const say = t => { msg = t; renderBox(); };
const authErr = e => ({
  "auth/invalid-credential": "Wrong email or password.", "auth/wrong-password": "Wrong email or password.",
  "auth/user-not-found": "No account with this email. Use Create account.", "auth/email-already-in-use": "This email already has an account. Sign in instead.",
  "auth/weak-password": "Choose a password of at least 6 characters.", "auth/invalid-email": "That doesn't look like an email address.",
  "auth/unauthorized-domain": `Sign-in isn't allowed from ${location.hostname} yet. Use http://localhost:8765/ on this computer, or add ${location.hostname} under Firebase → Authentication → Settings → Authorized domains.`,
  "auth/operation-not-allowed": "This sign-in method is off. Turn it on in Firebase → Authentication → Sign-in method.",
  "auth/popup-closed-by-user": "The Google window was closed before signing in.", "auth/too-many-requests": "Too many tries. Wait a few minutes and try again."
}[e.code] || e.message);

dlg.addEventListener("click", async e => {
  if (e.target === dlg) { dlg.close(); return; }   // click on the backdrop
  const b = e.target.closest("button"); if (!b) return;
  const email = $("acct-email")?.value.trim(), pass = $("acct-pass")?.value;
  try {
    if (b.dataset.act === "google") { await signInWithPopup(auth, new GoogleAuthProvider()); msg = ""; }
    else if (b.dataset.act === "signup") {
      const c = await createUserWithEmailAndPassword(auth, email, pass);
      await sendEmailVerification(c.user); say(`Account created. We sent a confirmation link to ${email}.`);
    }
    else if (b.dataset.act === "reset") { await sendPasswordResetEmail(auth, email); say(`If ${email} has an account, a reset link is on its way.`); }
    else if (b.dataset.act === "verify") { await sendEmailVerification(user); say("Sent. Check your inbox."); }
    else if (b.dataset.act === "signout") { await signOut(auth); msg = ""; }
    else if (b.dataset.act === "close") dlg.close();
    else if (b.dataset.copy) { await navigator.clipboard.writeText(tripLink(b.dataset.copy)); b.textContent = "Copied"; }
    else if (b.dataset.delTrip) {
      if (!confirm(`Delete the trip “${b.dataset.delTrip}”? Its dates and flights are removed for everyone. This can't be undone.`)) return;
      await deleteDoc(adminsRef(b.dataset.delTrip)); await deleteDoc(tripRef(b.dataset.delTrip)); renderTrips();
    }
  } catch (err) { say(authErr(err)); }
});
dlg.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    if (e.target.id === "acct-form") { await signInWithEmailAndPassword(auth, $("acct-email").value.trim(), $("acct-pass").value); msg = ""; }
    else if (e.target.id === "trip-form") {
      const name = $("trip-name-in").value.trim();
      if (!name) return say("Give the trip a name.");
      const id = await createTrip({ name, trek: $("trip-trek").value, admins: $("trip-admins").value });
      say(`Created. Its link: ${tripLink(id)}`);
    }
  } catch (err) { say(authErr(err)); }
});
dlg.addEventListener("change", async e => {
  const id = e.target.dataset.admins; if (!id) return;
  try { await setDoc(adminsRef(id), { emails: cleanEmails(e.target.value) }); e.target.value = cleanEmails(e.target.value).join(", "); }
  catch (err) { say(`Couldn't save the admins: ${err.message}`); }
});
$("acct-btn").addEventListener("click", () => { msg = ""; dlg.showModal(); renderBox(); });

App.cloud = { saveTrip };
App.cloudReady();
