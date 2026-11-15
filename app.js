import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, setPersistence,
  browserLocalPersistence, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, onSnapshot, serverTimestamp,
  increment, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig, LIVEKIT_URL, TOKEN_ENDPOINT } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

let me = null;
let isAdmin = false;
let myProfile = { blocked: [] };
let currentRoom = null;
let lkRoom = null;
let unsubs = [];

// Remember the login on this phone until Logout is tapped.
await setPersistence(auth, browserLocalPersistence);

function show(page) {
  ["login", "home", "golive", "profile", "watch", "admin"].forEach((p) => {
    $(p + "Page").classList.toggle("hidden", p !== page);
  });
}

document.querySelectorAll("nav button[data-page]").forEach((b) => {
  b.onclick = () => show(b.dataset.page);
});

$("signupBtn").onclick = async () => {
  try {
    const name = $("displayName").value.trim() || "Friend";
    const cred = await createUserWithEmailAndPassword(auth, $("email").value, $("password").value);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), { name, bio: "", blocked: [] });
  } catch (e) { $("loginMsg").textContent = e.message; }
};

$("loginBtn").onclick = async () => {
  try {
    await signInWithEmailAndPassword(auth, $("email").value, $("password").value);
  } catch (e) { $("loginMsg").textContent = "Login failed: " + e.message; }
};

$("logoutBtn").onclick = async () => {
  await signOut(auth);
};

onAuthStateChanged(auth, async (user) => {
  unsubs.forEach((u) => u());
  unsubs = [];
  me = user;
  if (!user) {
    $("nav").classList.add("hidden");
    show("login");
    return;
  }
  $("nav").classList.remove("hidden");
  const adminSnap = await getDoc(doc(db, "admins", user.uid));
  isAdmin = adminSnap.exists();
  $("adminTab").classList.toggle("hidden", !isAdmin);
  const uSnap = await getDoc(doc(db, "users", user.uid));
  myProfile = uSnap.exists() ? uSnap.data() : { name: user.displayName || "", bio: "", blocked: [] };
  if (!myProfile.blocked) myProfile.blocked = [];
  $("profileName").value = myProfile.name || "";
  $("profileBio").value = myProfile.bio || "";
  renderBlocked();
  listenLive();
  listenMyRequests();
  if (isAdmin) { listenPending(); listenReports(); }
  show("home");
});

// ---------- Profile ----------
$("saveProfileBtn").onclick = async () => {
  await setDoc(doc(db, "users", me.uid), {
    name: $("profileName").value, bio: $("profileBio").value, blocked: myProfile.blocked
  }, { merge: true });
  $("profileMsg").textContent = "Profile saved.";
};

function renderBlocked() {
  const box = $("blockedList");
  box.innerHTML = myProfile.blocked.length ? "" : "You have not blocked anyone.";
  myProfile.blocked.forEach((uid) => {
    const d = document.createElement("div");
    d.className = "card";
    d.textContent = uid + " ";
    const b = document.createElement("button");
    b.textContent = "Unblock";
    b.onclick = async () => {
      await updateDoc(doc(db, "users", me.uid), { blocked: arrayRemove(uid) });
      myProfile.blocked = myProfile.blocked.filter((x) => x !== uid);
      renderBlocked(); listenLive();
    };
    d.appendChild(b);
    box.appendChild(d);
  });
}

// ---------- Go live requests ----------
$("requestBtn").onclick = async () => {
  const title = $("roomTitle").value.trim();
  if (!title) { $("requestMsg").textContent = "Please enter a session title."; return; }
  await addDoc(collection(db, "rooms"), {
    title, hostId: me.uid, hostName: myProfile.name || me.displayName || "Friend",
    status: "pending", likes: 0, likedBy: [], createdAt: serverTimestamp()
  });
  $("requestMsg").textContent = "Request sent. Wait for admin approval.";
  $("roomTitle").value = "";
};

function listenMyRequests() {
  const q = query(collection(db, "rooms"), where("hostId", "==", me.uid));
  unsubs.push(onSnapshot(q, (snap) => {
    const box = $("myRequests");
    box.innerHTML = "";
    snap.forEach((d) => {
      const r = d.data();
      const div = document.createElement("div");
      div.className = "card";
      div.textContent = r.title + " - " + r.status + " ";
      if (r.status === "approved") {
        const b = document.createElement("button");
        b.textContent = "Start Live";
        b.onclick = () => joinRoom(d.id, r, true);
        div.appendChild(b);
      }
      box.appendChild(div);
    });
  }));
}

// ---------- Live list ----------
function listenLive() {
  const q = query(collection(db, "rooms"), where("status", "in", ["approved", "live"]));
  unsubs.push(onSnapshot(q, (snap) => {
    const box = $("liveList");
    box.innerHTML = "";
    let count = 0;
    snap.forEach((d) => {
      const r = d.data();
      if (myProfile.blocked.includes(r.hostId)) return;
      if (r.status !== "live") return;
      count++;
      const div = document.createElement("div");
      div.className = "card";
      div.textContent = r.title + " by " + r.hostName + " ";
      const b = document.createElement("button");
      b.textContent = "Watch";
      b.onclick = () => joinRoom(d.id, r, false);
      div.appendChild(b);
      box.appendChild(div);
    });
    if (!count) box.textContent = "No one is live right now.";
  }));
}

// ---------- Admin ----------
function listenPending() {
  const q = query(collection(db, "rooms"), where("status", "==", "pending"));
  unsubs.push(onSnapshot(q, (snap) => {
    const box = $("pendingList");
    box.innerHTML = snap.empty ? "No pending requests." : "";
    snap.forEach((d) => {
      const r = d.data();
      const div = document.createElement("div");
      div.className = "card";
      div.textContent = r.title + " by " + r.hostName + " ";
      const ok = document.createElement("button");
      ok.textContent = "Approve";
      ok.onclick = () => updateDoc(doc(db, "rooms", d.id), { status: "approved" });
      const no = document.createElement("button");
      no.textContent = "Reject";
      no.onclick = () => updateDoc(doc(db, "rooms", d.id), { status: "rejected" });
      div.append(ok, no);
      box.appendChild(div);
    });
  }));
}

function listenReports() {
  unsubs.push(onSnapshot(collection(db, "reports"), (snap) => {
    const box = $("reportList");
    box.innerHTML = snap.empty ? "No reports." : "";
    snap.forEach((d) => {
      const r = d.data();
      const div = document.createElement("div");
      div.className = "card";
      div.textContent = "Room " + r.roomId + " reported by " + r.reporterId + " ";
      const b = document.createElement("button");
      b.textContent = "Dismiss";
      b.onclick = () => deleteDoc(doc(db, "reports", d.id));
      const end = document.createElement("button");
      end.textContent = "End Session";
      end.onclick = () => updateDoc(doc(db, "rooms", r.roomId), { status: "ended" });
      div.append(b, end);
      box.appendChild(div);
    });
  }));
}

// ---------- Watch, comments, likes ----------
async function joinRoom(roomId, room, asHost) {
  currentRoom = { id: roomId, ...room, asHost };
  $("watchTitle").textContent = room.title + " - " + room.hostName;
  $("blockBtn").classList.toggle("hidden", asHost);
  show("watch");
  if (asHost) await updateDoc(doc(db, "rooms", roomId), { status: "live" });
  listenRoom(roomId);
  await connectVideo(roomId, asHost);
}

function listenRoom(roomId) {
  unsubs.push(onSnapshot(doc(db, "rooms", roomId), (d) => {
    if (d.exists()) $("likeCount").textContent = d.data().likes || 0;
  }));
  const q = query(collection(db, "rooms", roomId, "comments"), orderBy("createdAt"));
  unsubs.push(onSnapshot(q, (snap) => {
    const box = $("comments");
    box.innerHTML = "";
    snap.forEach((d) => {
      const c = d.data();
      if (myProfile.blocked.includes(c.uid)) return;
      const p = document.createElement("p");
      p.textContent = c.name + ": " + c.text;
      box.appendChild(p);
    });
  }));
}

$("commentBtn").onclick = async () => {
  const text = $("commentInput").value.trim();
  if (!text || !currentRoom) return;
  await addDoc(collection(db, "rooms", currentRoom.id, "comments"), {
    uid: me.uid, name: myProfile.name || me.displayName || "Friend",
    text, createdAt: serverTimestamp()
  });
  $("commentInput").value = "";
};

$("likeBtn").onclick = async () => {
  if (!currentRoom) return;
  const ref = doc(db, "rooms", currentRoom.id);
  const snap = await getDoc(ref);
  const liked = (snap.data().likedBy || []).includes(me.uid);
  await updateDoc(ref, liked
    ? { likes: increment(-1), likedBy: arrayRemove(me.uid) }
    : { likes: increment(1), likedBy: arrayUnion(me.uid) });
};

$("reportBtn").onclick = async () => {
  if (!currentRoom) return;
  await addDoc(collection(db, "reports"), {
    roomId: currentRoom.id, hostId: currentRoom.hostId,
    reporterId: me.uid, createdAt: serverTimestamp()
  });
  alert("Report sent to the admin. Thank you.");
};

$("blockBtn").onclick = async () => {
  if (!currentRoom) return;
  await updateDoc(doc(db, "users", me.uid), { blocked: arrayUnion(currentRoom.hostId) });
  myProfile.blocked.push(currentRoom.hostId);
  renderBlocked();
  alert("User blocked.");
  leave();
};

// ---------- LiveKit video (multi-friend) ----------
async function connectVideo(roomId, asHost) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: roomId, identity: me.uid, name: myProfile.name || "Friend", canPublish: asHost })
  });
  const { token } = await res.json();
  lkRoom = new LivekitClient.Room();
  lkRoom.on(LivekitClient.RoomEvent.TrackSubscribed, attachTrack);
  lkRoom.on(LivekitClient.RoomEvent.TrackUnsubscribed, (t) => t.detach().forEach((e) => e.remove()));
  await lkRoom.connect(LIVEKIT_URL, token);
  if (asHost) {
    await lkRoom.localParticipant.enableCameraAndMicrophone();
    lkRoom.localParticipant.videoTrackPublications.forEach((p) => p.track && attachTrack(p.track));
  }
}

function attachTrack(track) {
  const el = track.attach();
  el.setAttribute("playsinline", "true");
  $("videoGrid").appendChild(el);
}

async function leave() {
  if (lkRoom) { await lkRoom.disconnect(); lkRoom = null; }
  $("videoGrid").innerHTML = "";
  if (currentRoom && currentRoom.asHost) {
    await updateDoc(doc(db, "rooms", currentRoom.id), { status: "ended" });
  }
  currentRoom = null;
  show("home");
}
$("leaveBtn").onclick = leave;
