// ── Config ──────────────────────────────────────────────────────
const API_URL = "https://campusdrop-production.up.railway.app";

// ─────────────────────────────────────────────────────────────
// TURN : remplace les 3 placeholders ci-dessous par les valeurs
// obtenues sur https://www.expressturn.com après inscription.
// EXPRESSTURN_HOST     → ex: "xxxx.turn.expressturn.com"
// EXPRESSTURN_USERNAME → ex: "efXXXXXXXXXXXXXX"
// EXPRESSTURN_CREDENTIAL → ex: "xxxxxxxxxxxxxxxx"
// ─────────────────────────────────────────────────────────────
const ICE_CONFIG = {
  iceServers: [
    // STUN Google gratuit (connexions directes P2P)
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },

    // TURN UDP — réseaux normaux
    {
      urls: "turn:free.expressturn.com:3478?transport=udp",
      username: "000000002092863896",
      credential: "1hGVbVDR9s2iIJpW0kzOogi4R6Y="
    },

    // TURN TCP — si UDP bloqué
    {
      urls: "turn:free.expressturn.com:3478?transport=tcp",
      username: "000000002092863896",
      credential: "1hGVbVDR9s2iIJpW0kzOogi4R6Y="
    },

    // TURN TLS port 443 — passe partout (universités, entreprises)
    // C'est ce mode qui résout le problème des réseaux restrictifs
    {
      urls: "turn:free.expressturn.com:443?transport=tcp",
      username: "000000002092863896",
      credential: "1hGVbVDR9s2iIJpW0kzOogi4R6Y="
    }
  ],
  iceCandidatePoolSize: 10
};

// ── Pseudo anonyme ────────────────────────────────────────────────
const adjectives = ["Swift","Bold","Bright","Rapid","Sharp","Silent","Wild","Iron","Calm","Dark"];
const animals = ["Fox","Wolf","Hawk","Bear","Lynx","Raven","Tiger","Falcon","Otter","Viper"];
const username = adjectives[Math.floor(Math.random()*10)] + animals[Math.floor(Math.random()*10)] + Math.floor(Math.random()*90+10);

document.getElementById("usernameDisplay").textContent = username;

// ── Socket.IO ────────────────────────────────────────────────────
const socket = io(API_URL);

// ── État ─────────────────────────────────────────────────────────
let peer = null;
let currentCode = null;
let peerSocketId = null;
let isInitiator = false;
let receiveBuffers = [];
let receiveSize = 0;
let receiveMeta = null;

// ── Signaling ────────────────────────────────────────────────────
socket.on("room-info", ({ peers }) => {
  if (peers.length > 0) {
    peerSocketId = peers[0].id;
    document.getElementById("peerName").textContent = peers[0].username;
    startPeer(false);
  }
});

socket.on("peer-joined", ({ peerId, username: peerUsername }) => {
  peerSocketId = peerId;
  document.getElementById("peerName").textContent = peerUsername;
  startPeer(true);
});

socket.on("peer-left", () => {
  showToast("L'autre utilisateur a quitté la session", "info");
  resetTransferUI();
});

socket.on("signal", ({ from, data }) => {
  peerSocketId = from;
  if (peer) peer.signal(data);
});

// ── SimplePeer ───────────────────────────────────────────────────
function startPeer(initiator) {
  isInitiator = initiator;
  peer = new SimplePeer({
    initiator,
    trickle: true,
    config: ICE_CONFIG
  });

  peer.on("signal", (data) => socket.emit("signal", { to: peerSocketId, data }));

  peer.on("connect", () => {
    document.getElementById("waitingZone").style.display = "none";
    document.getElementById("setupZone").style.display = "none";
    document.getElementById("transferZone").style.display = "block";
    showToast("Connexion P2P établie !", "success");

    if (peer._pc) {
      peer._pc.getStats().then(stats => {
        stats.forEach(report => {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            const isRelay = [...stats.values()].find(s =>
              s.id === report.remoteCandidateId && s.candidateType === "relay"
            );
            updateConnectionBadge(isRelay ? "relay" : "direct");
          }
        });
      });
    }
  });

  peer.on("data", handleIncomingData);
  peer.on("error", (err) => { console.error(err); showToast("Erreur de connexion P2P", "error"); resetTransferUI(); });
  peer.on("close", resetTransferUI);
}

function updateConnectionBadge(mode) {
  const label = document.getElementById("connectionLabel");
  const dot = document.querySelector(".dot.connected");
  if (mode === "relay") {
    if (label) label.textContent = "Connecté via relais TURN (réseau restrictif détecté)";
    if (dot) dot.style.background = "#ffc850";
  } else {
    if (label) label.textContent = "Connexion directe P2P";
  }
}

// ── Réception ────────────────────────────────────────────────────
function handleIncomingData(chunk) {
  if (typeof chunk === "string" || chunk instanceof String) {
    processMessage(chunk.toString());
    return;
  }
  const str = new TextDecoder().decode(chunk);
  if (str.startsWith("{")) {
    try { processMessage(str); return; } catch {}
  }
  if (!receiveMeta) return;
  receiveBuffers.push(chunk);
  receiveSize += chunk.byteLength || chunk.length;
  updateReceiveProgress(receiveSize / receiveMeta.size);
  if (receiveSize >= receiveMeta.size) {
    const blob = new Blob(receiveBuffers, { type: receiveMeta.type || "application/octet-stream" });
    addReceivedFile(receiveMeta.name, receiveMeta.size, blob, receiveMeta.type);
    receiveBuffers = []; receiveSize = 0; receiveMeta = null;
  }
}

function processMessage(str) {
  const msg = JSON.parse(str);
  if (msg.type === "file-start") {
    receiveMeta = { name: msg.name, size: msg.size, type: msg.mimeType };
    receiveBuffers = []; receiveSize = 0;
    addReceiveProgressItem(msg.name, msg.size);
  }
}

// ── Envoi ────────────────────────────────────────────────────────
const CHUNK = 64 * 1024;

async function sendFiles(files) {
  if (!peer || !peer.connected) return showToast("Non connecté", "error");
  for (const file of files) await sendFile(file);
}

async function sendFile(file) {
  const itemId = addSendItem(file.name, file.size);
  peer.send(JSON.stringify({ type: "file-start", name: file.name, size: file.size, mimeType: file.type }));
  let offset = 0;
  while (offset < file.size) {
    const buffer = await file.slice(offset, offset + CHUNK).arrayBuffer();
    await new Promise(resolve => {
      const wait = () => {
        if (peer._channel && peer._channel.bufferedAmount > CHUNK * 8) setTimeout(wait, 50);
        else resolve();
      };
      wait();
    });
    peer.send(buffer);
    offset += buffer.byteLength;
    updateSendProgress(itemId, offset / file.size);
  }
}

// ── Icône par type ────────────────────────────────────────────────
function fileIcon(name, mime) {
  if (mime && mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📕";
  if (mime && mime.startsWith("text/")) return "📝";
  if (mime && mime.startsWith("video/")) return "🎬";
  if (mime && mime.startsWith("audio/")) return "🎵";
  const ext = name.split(".").pop().toLowerCase();
  const map = { zip:"🗜️", rar:"🗜️", "7z":"🗜️", doc:"📘", docx:"📘", xls:"📗", xlsx:"📗", ppt:"📙", pptx:"📙", js:"💻", ts:"💻", py:"💻", html:"💻", css:"💻", json:"💻" };
  return map[ext] || "📄";
}

// ── Prévisualisation ──────────────────────────────────────────────
function canPreview(name, mime) {
  if (!mime) return false;
  if (mime.startsWith("image/")) return true;
  if (mime.startsWith("text/")) return true;
  if (mime === "application/pdf") return true;
  if (mime === "application/json") return true;
  return false;
}

function openPreview(name, mime, blob) {
  const bg = document.getElementById("previewBg");
  const body = document.getElementById("previewBody");
  document.getElementById("previewFilename").textContent = name;
  body.innerHTML = "";

  const url = URL.createObjectURL(blob);

  if (mime.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = name;
    body.appendChild(img);
  } else if (mime === "application/pdf") {
    const iframe = document.createElement("iframe");
    iframe.src = url;
    iframe.title = name;
    body.appendChild(iframe);
  } else if (mime.startsWith("text/") || mime === "application/json") {
    const reader = new FileReader();
    reader.onload = (e) => {
      const pre = document.createElement("pre");
      pre.textContent = e.target.result;
      body.appendChild(pre);
    };
    reader.readAsText(blob);
  } else {
    body.innerHTML = `<div class="preview-unsupported"><div class="big">🚫</div><p>Prévisualisation non disponible pour ce type de fichier</p></div>`;
  }

  bg.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closePreview(e) {
  if (e && e.target !== document.getElementById("previewBg") && !e.target.classList.contains("preview-close")) return;
  document.getElementById("previewBg").style.display = "none";
  document.getElementById("previewBody").innerHTML = "";
  document.body.style.overflow = "";
}

// ── UI helpers ────────────────────────────────────────────────────
function fmtSize(b) {
  if (b < 1024) return b + " o";
  if (b < 1048576) return (b / 1024).toFixed(1) + " Ko";
  return (b / 1048576).toFixed(1) + " Mo";
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function addSendItem(name, size) {
  const id = "s-" + Date.now();
  const el = document.createElement("div");
  el.className = "file-item";
  el.id = id;
  el.innerHTML = `<span class="fi-icon">📤</span><div class="fi-info"><div class="fi-name">${escHtml(name)}</div><div class="fi-size">${fmtSize(size)}</div><div class="fi-bar-wrap"><div class="fi-bar" style="width:0%"></div></div></div>`;
  document.getElementById("sendList").appendChild(el);
  return id;
}

function updateSendProgress(id, ratio) {
  const bar = document.querySelector(`#${id} .fi-bar`);
  if (bar) bar.style.width = Math.round(ratio * 100) + "%";
}

let currentReceiveItemId = null;
let currentReceiveBlob = null;

function addReceiveProgressItem(name, size) {
  const el = document.querySelector("#receiveList .hint");
  if (el) el.remove();
  const id = "r-" + Date.now();
  currentReceiveItemId = id;
  const div = document.createElement("div");
  div.className = "file-item";
  div.id = id;
  div.innerHTML = `<span class="fi-icon">⬇️</span><div class="fi-info"><div class="fi-name">${escHtml(name)}</div><div class="fi-size">${fmtSize(size)}</div><div class="fi-bar-wrap"><div class="fi-bar" style="width:0%"></div></div></div>`;
  document.getElementById("receiveList").appendChild(div);
}

function updateReceiveProgress(ratio) {
  if (!currentReceiveItemId) return;
  const bar = document.querySelector(`#${currentReceiveItemId} .fi-bar`);
  if (bar) bar.style.width = Math.round(ratio * 100) + "%";
}

function addReceivedFile(name, size, blob, mime) {
  if (currentReceiveItemId) {
    const item = document.getElementById(currentReceiveItemId);
    if (item) {
      updateReceiveProgress(1);

      const icon = item.querySelector(".fi-icon");
      if (icon) icon.textContent = fileIcon(name, mime);

      const actions = document.createElement("div");
      actions.className = "fi-actions";

      if (canPreview(name, mime)) {
        const prevBtn = document.createElement("button");
        prevBtn.className = "btn-preview";
        prevBtn.textContent = "👁 Voir";
        prevBtn.onclick = () => openPreview(name, mime, blob);
        actions.appendChild(prevBtn);
      }

      const link = document.createElement("a");
      link.className = "btn-dl";
      link.textContent = "⬇ Télécharger";
      link.href = URL.createObjectURL(blob);
      link.download = name;
      actions.appendChild(link);

      item.appendChild(actions);
    }
  }
  showToast(`Fichier reçu : ${name}`, "success");
  currentReceiveItemId = null;
}

// ── Actions ──────────────────────────────────────────────────────
document.getElementById("createBtn").addEventListener("click", async () => {
  const btn = document.getElementById("createBtn");
  btn.disabled = true;
  btn.textContent = "...";
  try {
    const res = await fetch(API_URL + "/api/sessions", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    currentCode = data.code;
    document.getElementById("codeText").textContent = data.code;
    document.getElementById("codeDisplay").style.display = "block";
    document.getElementById("waitCode").textContent = data.code;
    document.getElementById("setupZone").style.display = "none";
    document.getElementById("waitingZone").style.display = "block";
    socket.emit("join-session", { code: data.code, username });
  } catch (err) {
    showToast(err.message || "Erreur", "error");
    btn.disabled = false;
    btn.textContent = "Créer";
  }
});

document.getElementById("joinBtn").addEventListener("click", async () => {
  const code = document.getElementById("joinCode").value.trim().toUpperCase();
  if (code.length !== 6) return showToast("Le code doit faire 6 caractères", "error");
  try {
    const res = await fetch(API_URL + "/api/sessions/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    currentCode = code;
    document.getElementById("setupZone").style.display = "none";
    document.getElementById("waitingZone").style.display = "block";
    document.getElementById("waitCode").textContent = code;
    socket.emit("join-session", { code, username });
  } catch (err) {
    showToast(err.message || "Session introuvable", "error");
  }
});

// Rejoindre avec Entrée sur mobile
document.getElementById("joinCode").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("joinBtn").click();
});

// Drag & Drop
const dropZone = document.getElementById("dropZone");
dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("over"));
dropZone.addEventListener("drop", e => { e.preventDefault(); dropZone.classList.remove("over"); sendFiles(e.dataTransfer.files); });

// Fermer preview avec Echap
document.addEventListener("keydown", e => { if (e.key === "Escape") closePreview({}); });

function copyCode() {
  if (currentCode) navigator.clipboard.writeText(currentCode).then(() => showToast("Code copié !", "success"));
}

function resetTransferUI() {
  document.getElementById("transferZone").style.display = "none";
  document.getElementById("waitingZone").style.display = "none";
  document.getElementById("setupZone").style.display = "block";
  document.getElementById("codeDisplay").style.display = "none";
  document.getElementById("createBtn").disabled = false;
  document.getElementById("createBtn").textContent = "Créer";
  document.getElementById("sendList").innerHTML = "";
  document.getElementById("receiveList").innerHTML = '<p class="hint" style="text-align:center;padding:20px">En attente de fichiers…</p>';
  peer = null; currentCode = null; peerSocketId = null;
}

function disconnect() { if (peer) peer.destroy(); resetTransferUI(); }

function showToast(msg, type = "info") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show " + type;
  setTimeout(() => t.className = "toast", 3000);
}
