import crypto from "crypto";
import fs from "fs";
import { promises as fsp } from "fs";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
const SHARE_TTL_HOURS = Number(process.env.SHARE_TTL_HOURS || 24);
const MAX_FILES = Number(process.env.MAX_FILES || 10);
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 250);
const MAX_TOTAL_SIZE_MB = Number(process.env.MAX_TOTAL_SIZE_MB || 500);
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 15 * 60 * 1000);

const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "uploads");
const TEMP_DIR = path.join(UPLOAD_ROOT, "_tmp");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cors({ origin: FRONTEND_ORIGIN }));

fs.mkdirSync(TEMP_DIR, { recursive: true });

const upload = multer({
  dest: TEMP_DIR,
  limits: {
    files: MAX_FILES,
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024
  }
});

// Stockage en mémoire volontairement isolé pour pouvoir migrer plus tard
// vers une base de données sans changer les routes publiques.
const shares = new Map();
const SHARE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SHARE_CODE_LENGTH = 6;

function now() {
  return Date.now();
}

function generateCode() {
  let code = "";
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) {
    code += SHARE_CODE_CHARS[crypto.randomInt(SHARE_CODE_CHARS.length)];
  }
  return code;
}

function uniqueCode() {
  for (let i = 0; i < 20; i++) {
    const code = generateCode();
    if (!shares.has(code)) return code;
  }
  throw new Error("Impossible de générer un code unique");
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || "fichier"));
  return base
    .normalize("NFKC")
    .replace(/[\x00-\x1f\x80-\x9f]/g, "")
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "fichier";
}

function fileExtension(name) {
  const ext = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return ext.slice(0, 16);
}

function publicShare(share, req) {
  const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  return {
    code: share.code,
    shareUrl: `${baseUrl}/s/${share.code}`,
    createdAt: new Date(share.createdAt).toISOString(),
    expiresAt: new Date(share.expiresAt).toISOString(),
    expiresInHours: SHARE_TTL_HOURS,
    files: share.files.map(file => ({
      id: file.id,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      downloadUrl: `/api/shares/${share.code}/files/${file.id}/download`
    }))
  };
}

function isExpired(share) {
  return !share || share.expiresAt <= now();
}

async function removePath(target) {
  if (!target) return;
  await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
}

async function deleteShare(code) {
  const share = shares.get(code);
  if (!share) return;
  shares.delete(code);
  await removePath(share.directory);
}

async function cleanupExpiredShares() {
  const expiredCodes = [];
  for (const [code, share] of shares.entries()) {
    if (isExpired(share)) expiredCodes.push(code);
  }
  await Promise.all(expiredCodes.map(deleteShare));

  // Nettoie aussi les fichiers temporaires oubliés par un upload interrompu.
  const tempEntries = await fsp.readdir(TEMP_DIR, { withFileTypes: true }).catch(() => []);
  const staleBefore = now() - 60 * 60 * 1000;
  await Promise.all(tempEntries.map(async entry => {
    const target = path.join(TEMP_DIR, entry.name);
    const stat = await fsp.stat(target).catch(() => null);
    if (stat && stat.mtimeMs < staleBefore) await removePath(target);
  }));
}

function getActiveShare(code) {
  const share = shares.get(normalizeCode(code));
  if (!share) return null;
  if (isExpired(share)) {
    deleteShare(share.code);
    return null;
  }
  return share;
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

app.post("/api/shares", upload.array("files", MAX_FILES), async (req, res, next) => {
  const uploadedFiles = req.files || [];

  try {
    if (uploadedFiles.length === 0) {
      return sendError(res, 400, "Ajoutez au moins un fichier à partager.");
    }

    const totalSize = uploadedFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE_MB * 1024 * 1024) {
      await Promise.all(uploadedFiles.map(file => removePath(file.path)));
      return sendError(res, 413, `Le partage dépasse la limite de ${MAX_TOTAL_SIZE_MB} Mo.`);
    }

    const code = uniqueCode();
    const shareDir = path.join(UPLOAD_ROOT, code);
    await fsp.mkdir(shareDir, { recursive: true });

    const files = [];
    for (const file of uploadedFiles) {
      const safeName = sanitizeFilename(file.originalname);
      const id = crypto.randomUUID();
      const storedName = `${id}${fileExtension(safeName)}`;
      const targetPath = path.join(shareDir, storedName);

      await fsp.rename(file.path, targetPath);

      files.push({
        id,
        name: safeName,
        storedName,
        path: targetPath,
        size: file.size,
        mimeType: file.mimetype || "application/octet-stream"
      });
    }

    const share = {
      code,
      directory: shareDir,
      createdAt: now(),
      expiresAt: now() + SHARE_TTL_HOURS * 60 * 60 * 1000,
      files
    };

    shares.set(code, share);
    return res.status(201).json(publicShare(share, req));
  } catch (err) {
    await Promise.all(uploadedFiles.map(file => removePath(file.path)));
    return next(err);
  }
});

app.get("/api/shares/:code", (req, res) => {
  const share = getActiveShare(req.params.code);
  if (!share) return sendError(res, 404, "Partage introuvable ou expiré.");
  return res.json(publicShare(share, req));
});

app.get("/api/shares/:code/files/:fileId/download", (req, res) => {
  const share = getActiveShare(req.params.code);
  if (!share) return sendError(res, 404, "Partage introuvable ou expiré.");

  const file = share.files.find(item => item.id === req.params.fileId);
  if (!file) return sendError(res, 404, "Fichier introuvable.");

  const resolvedPath = path.resolve(file.path);
  const shareRoot = path.resolve(share.directory);
  if (!resolvedPath.startsWith(shareRoot + path.sep)) {
    return sendError(res, 400, "Chemin de fichier invalide.");
  }

  return res.download(resolvedPath, file.name, err => {
    if (err && !res.headersSent) {
      sendError(res, 500, "Téléchargement impossible.");
    }
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/style.css", (req, res) => {
  res.sendFile(path.join(__dirname, "style.css"));
});

app.get("/app.js", (req, res) => {
  res.type("application/javascript").sendFile(path.join(__dirname, "app.js"));
});

app.get("/s/:code", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use(async (err, req, res, next) => {
  if (req.files) {
    await Promise.all(req.files.map(file => removePath(file.path)));
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return sendError(res, 413, `Un fichier dépasse la limite de ${MAX_FILE_SIZE_MB} Mo.`);
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return sendError(res, 413, `Vous pouvez envoyer ${MAX_FILES} fichiers maximum.`);
    }
    return sendError(res, 400, "Upload invalide.");
  }

  console.error(err);
  return sendError(res, 500, "Erreur serveur.");
});

setInterval(cleanupExpiredShares, CLEANUP_INTERVAL_MS).unref();
cleanupExpiredShares();

app.listen(PORT, () => {
  console.log(`CampusDrop prêt sur le port ${PORT}`);
  console.log(`Uploads temporaires : ${UPLOAD_ROOT}`);
});
