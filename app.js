const API_URL = window.location.origin;

let selectedFiles = [];
let currentShare = null;

const el = {
  usernameDisplay: document.getElementById("usernameDisplay"),
  setupZone: document.getElementById("setupZone"),
  waitingZone: document.getElementById("waitingZone"),
  transferZone: document.getElementById("transferZone"),
  createBtn: document.getElementById("createBtn"),
  joinBtn: document.getElementById("joinBtn"),
  joinCode: document.getElementById("joinCode"),
  fileInput: document.getElementById("fileInput"),
  dropZone: document.getElementById("dropZone"),
  sendList: document.getElementById("sendList"),
  receiveList: document.getElementById("receiveList"),
  createdFilesList: document.getElementById("createdFilesList"),
  uploadProgress: document.getElementById("uploadProgress"),
  uploadBar: document.getElementById("uploadBar"),
  uploadLabel: document.getElementById("uploadLabel"),
  codeText: document.getElementById("codeText"),
  shareLink: document.getElementById("shareLink"),
  expiresAtText: document.getElementById("expiresAtText"),
  shareCodeLabel: document.getElementById("shareCodeLabel"),
  shareExpiryLine: document.getElementById("shareExpiryLine"),
  expiryBadge: document.getElementById("expiryBadge"),
  toast: document.getElementById("toast")
};

el.usernameDisplay.textContent = "Stockage temporaire";

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(1)} Go`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "date inconnue";
  return date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function escHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function fileIcon(name, mimeType = "") {
  if (mimeType.startsWith("image/")) return "IMG";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("video/")) return "VID";
  if (mimeType.startsWith("audio/")) return "AUD";
  const ext = String(name).split(".").pop().toLowerCase();
  const map = {
    zip: "ZIP", rar: "ZIP", "7z": "ZIP",
    doc: "DOC", docx: "DOC",
    xls: "XLS", xlsx: "XLS",
    ppt: "PPT", pptx: "PPT",
    txt: "TXT", md: "TXT", csv: "CSV",
    js: "JS", ts: "TS", html: "HTML", css: "CSS", json: "JSON"
  };
  return map[ext] || "FILE";
}

function showToast(message, type = "info") {
  el.toast.textContent = message;
  el.toast.className = `toast show ${type}`;
  setTimeout(() => {
    el.toast.className = "toast";
  }, 3200);
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getShareCodeFromUrl() {
  const match = window.location.pathname.match(/^\/s\/([A-Z0-9]{6})\/?$/i);
  if (match) return normalizeCode(match[1]);
  return normalizeCode(new URLSearchParams(window.location.search).get("code"));
}

function handleSelectedFiles(fileList) {
  const incoming = Array.from(fileList || []);
  if (incoming.length === 0) return;
  selectedFiles = incoming;
  renderSelectedFiles();
}

function removeSelectedFile(index) {
  selectedFiles.splice(index, 1);
  renderSelectedFiles();
}

function renderSelectedFiles() {
  if (selectedFiles.length === 0) {
    el.sendList.innerHTML = '<p class="hint empty-state">Aucun fichier sélectionné.</p>';
    return;
  }

  el.sendList.innerHTML = selectedFiles.map((file, index) => `
    <div class="file-item">
      <span class="fi-icon">${fileIcon(file.name, file.type)}</span>
      <div class="fi-info">
        <div class="fi-name">${escHtml(file.name)}</div>
        <div class="fi-size">${fmtSize(file.size)}</div>
      </div>
      <div class="fi-actions">
        <button class="btn-preview" type="button" onclick="removeSelectedFile(${index})">Retirer</button>
      </div>
    </div>
  `).join("");
}

function renderShareFiles(container, files, withDownload, code) {
  if (!files || files.length === 0) {
    container.innerHTML = '<p class="hint empty-state">Aucun fichier disponible.</p>';
    return;
  }

  container.innerHTML = files.map(file => {
    const downloadUrl = `${API_URL}${file.downloadUrl}`;
    const action = withDownload
      ? `<a class="btn-dl" href="${downloadUrl}">Télécharger</a>`
      : "";

    return `
      <div class="file-item">
        <span class="fi-icon">${fileIcon(file.name, file.mimeType)}</span>
        <div class="fi-info">
          <div class="fi-name">${escHtml(file.name)}</div>
          <div class="fi-size">${fmtSize(file.size)}</div>
        </div>
        <div class="fi-actions">${action}</div>
      </div>
    `;
  }).join("");
}

function setUploadProgress(percent, label) {
  el.uploadProgress.style.display = "block";
  el.uploadBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  el.uploadLabel.textContent = label;
}

function uploadFiles(files) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    files.forEach(file => formData.append("files", file));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/shares`);

    xhr.upload.onprogress = event => {
      if (!event.lengthComputable) {
        setUploadProgress(20, "Envoi en cours…");
        return;
      }
      const percent = Math.round((event.loaded / event.total) * 100);
      setUploadProgress(percent, `Envoi ${percent}%`);
    };

    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        data = {};
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        reject(new Error(data.error || "Upload impossible."));
      }
    };

    xhr.onerror = () => reject(new Error("Connexion au serveur impossible."));
    xhr.send(formData);
  });
}

async function createShare() {
  if (selectedFiles.length === 0) {
    showToast("Choisissez au moins un fichier.", "error");
    return;
  }

  el.createBtn.disabled = true;
  el.createBtn.textContent = "Envoi…";
  setUploadProgress(0, "Préparation de l'envoi…");

  try {
    const share = await uploadFiles(selectedFiles);
    currentShare = share;
    showCreatedShare(share);
    showToast("Partage créé.", "success");
  } catch (err) {
    showToast(err.message || "Erreur pendant l'envoi.", "error");
  } finally {
    el.createBtn.disabled = false;
    el.createBtn.textContent = "Créer le partage";
  }
}

function showCreatedShare(share) {
  el.setupZone.style.display = "none";
  el.transferZone.style.display = "none";
  el.waitingZone.style.display = "block";

  el.codeText.textContent = share.code;
  el.shareLink.value = share.shareUrl;
  el.expiresAtText.textContent = formatDate(share.expiresAt);
  el.expiryBadge.textContent = `Expire le ${formatDate(share.expiresAt)}`;
  renderShareFiles(el.createdFilesList, share.files, false, share.code);

  if (history.pushState) {
    history.pushState(null, "", `/s/${share.code}`);
  }
}

async function openShareByCode(code, updateUrl = true) {
  const normalizedCode = normalizeCode(code);
  if (normalizedCode.length !== 6) {
    showToast("Le code doit contenir 6 caractères.", "error");
    return;
  }

  el.joinBtn.disabled = true;
  el.joinBtn.textContent = "Ouverture…";

  try {
    const res = await fetch(`${API_URL}/api/shares/${normalizedCode}`);
    const share = await res.json();
    if (!res.ok) throw new Error(share.error || "Partage introuvable.");
    currentShare = share;
    showShareDownloadView(share);
    if (updateUrl && history.pushState) history.pushState(null, "", `/s/${share.code}`);
  } catch (err) {
    showToast(err.message || "Code invalide ou expiré.", "error");
  } finally {
    el.joinBtn.disabled = false;
    el.joinBtn.textContent = "Ouvrir";
  }
}

function showShareDownloadView(share) {
  el.setupZone.style.display = "none";
  el.waitingZone.style.display = "none";
  el.transferZone.style.display = "block";

  el.shareCodeLabel.textContent = share.code;
  el.shareExpiryLine.innerHTML = `Disponible jusqu'au <strong class="inline-code">${formatDate(share.expiresAt)}</strong>.`;
  el.expiryBadge.textContent = `Expire le ${formatDate(share.expiresAt)}`;
  renderShareFiles(el.receiveList, share.files, true, share.code);
}

async function copyText(value, successMessage) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast(successMessage, "success");
  } catch {
    const input = document.createElement("input");
    input.value = value;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    showToast(successMessage, "success");
  }
}

function copyCode() {
  copyText(currentShare?.code || el.codeText.textContent, "Code copié.");
}

function copyShareLink() {
  copyText(el.shareLink.value, "Lien copié.");
}

function resetUI() {
  currentShare = null;
  selectedFiles = [];
  el.fileInput.value = "";
  el.setupZone.style.display = "block";
  el.waitingZone.style.display = "none";
  el.transferZone.style.display = "none";
  el.uploadProgress.style.display = "none";
  el.uploadBar.style.width = "0%";
  el.uploadLabel.textContent = "Préparation de l'envoi…";
  el.joinCode.value = "";
  el.expiryBadge.textContent = "Expire automatiquement";
  renderSelectedFiles();
  if (history.pushState) history.pushState(null, "", "/");
}

el.createBtn.addEventListener("click", createShare);

el.joinBtn.addEventListener("click", () => {
  openShareByCode(el.joinCode.value);
});

el.joinCode.addEventListener("keydown", event => {
  if (event.key === "Enter") el.joinBtn.click();
});

el.dropZone.addEventListener("dragover", event => {
  event.preventDefault();
  el.dropZone.classList.add("over");
});

el.dropZone.addEventListener("dragleave", () => {
  el.dropZone.classList.remove("over");
});

el.dropZone.addEventListener("drop", event => {
  event.preventDefault();
  el.dropZone.classList.remove("over");
  handleSelectedFiles(event.dataTransfer.files);
});

window.addEventListener("popstate", () => {
  const code = getShareCodeFromUrl();
  if (code) openShareByCode(code, false);
  else resetUI();
});

renderSelectedFiles();

const initialCode = getShareCodeFromUrl();
if (initialCode) {
  el.joinCode.value = initialCode;
  openShareByCode(initialCode, false);
}
