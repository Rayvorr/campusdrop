import express from "express";
import http from "http";
import cors from "cors";
import path from "path";
import { Server as SocketIOServer } from "socket.io";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";

const app = express();
app.use(express.json());
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.static(__dirname));

// Sessions en mémoire (nettoyage auto après 30 min)
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Sessions
app.post("/api/sessions", (req, res) => {
  let code;
  do { code = randomCode(); } while (sessions.has(code));
  sessions.set(code, { createdAt: Date.now() });
  setTimeout(() => sessions.delete(code), SESSION_TTL);
  res.json({ code });
});

app.post("/api/sessions/join", (req, res) => {
  const code = (req.body.code || "").toUpperCase();
  if (!sessions.has(code)) return res.status(404).json({ error: "Session inconnue" });
  res.json({ ok: true });
});

// Socket.IO — Signaling WebRTC (sans auth)
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: FRONTEND_ORIGIN } });
const rooms = new Map();

io.on("connection", (socket) => {
  socket.on("join-session", ({ code, username }) => {
    code = code.toUpperCase();
    socket.username = username || "Anonyme";
    socket.join(code);
    socket.currentRoom = code;
    if (!rooms.has(code)) rooms.set(code, []);
    const room = rooms.get(code);
    if (!room.find(p => p.id === socket.id)) room.push({ id: socket.id, username: socket.username });

    // Dire au nouveau arrivant qui est déjà là
    const others = room.filter(p => p.id !== socket.id);
    if (others.length > 0) socket.emit("room-info", { peers: others });

    // Prévenir les autres
    socket.to(code).emit("peer-joined", { peerId: socket.id, username: socket.username });
  });

  // Relayer signal WebRTC vers le bon socket
  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("disconnect", () => {
    if (!socket.currentRoom) return;
    const room = rooms.get(socket.currentRoom);
    if (!room) return;
    const idx = room.findIndex(p => p.id === socket.id);
    if (idx !== -1) {
      room.splice(idx, 1);
      socket.to(socket.currentRoom).emit("peer-left", { peerId: socket.id, username: socket.username });
      if (room.length === 0) rooms.delete(socket.currentRoom);
    }
  });
});

server.listen(PORT, () => console.log(`Serveur sur le port ${PORT}`));
