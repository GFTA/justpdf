// Pass-Uno server: serves the web app and runs online rooms over WebSockets.
// Start with `node server.js` (PORT, HOST and DATA_DIR are optional env vars).
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const Uno = require("./public/game.js");

const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SAVE_FILE = path.join(DATA_DIR, "rooms.json");
const MAX_PLAYERS = 10;
const MAX_ROOMS = 200;
const ROOM_TTL = 12 * 3600 * 1000;
const REACTIONS = ["👍", "😂", "😱", "😡", "🎉", "🙈"];
const QR_LIB = require.resolve("qrcode-generator/qrcode.js");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json"
};

// ---------- rooms ----------
/** code -> { code, host, goal, members: [{ name, secret }], state, touched } */
const rooms = new Map();
/** code -> Set<ws> */
const sockets = new Map();
/** code -> timeout that closes the next UNO window */
const unoTimers = new Map();

function scheduleUno(room) {
  clearTimeout(unoTimers.get(room.code));
  unoTimers.delete(room.code);
  if (!room.state) return;
  const ms = Uno.nextDeadline(room.state);
  if (ms < 0) return;
  unoTimers.set(room.code, setTimeout(() => {
    unoTimers.delete(room.code);
    if (!rooms.has(room.code) || !room.state) return;
    const events = Uno.tick(room.state);
    if (events.length) { broadcast(room, events); saveRooms(); }
    scheduleUno(room);
  }, ms + 30));
}

function loadRooms() {
  try {
    const list = JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
    for (const r of list) if (Date.now() - r.touched < ROOM_TTL) { rooms.set(r.code, r); scheduleUno(r); }
    console.log(`${rooms.size} Räume aus ${SAVE_FILE} geladen`);
  } catch (e) { /* first start */ }
}
let saveTimer = null;
function saveRooms() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SAVE_FILE + ".tmp", JSON.stringify([...rooms.values()]));
      fs.renameSync(SAVE_FILE + ".tmp", SAVE_FILE);
    } catch (e) { console.error("Speichern fehlgeschlagen:", e.message); }
  }, 500);
}

function newCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid mix-ups with 1/0
  for (;;) {
    let c = "";
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!rooms.has(c)) return c;
  }
}
const cleanName = (n) => String(n || "").replace(/\s+/g, " ").trim().slice(0, 18);

function online(code) {
  const on = new Set();
  for (const ws of sockets.get(code) || []) if (ws.pid != null) on.add(ws.pid);
  return on;
}

function broadcast(room, events) {
  const on = online(room.code);
  const members = room.members.map((m, i) => ({ name: m.name, online: on.has(i) }));
  for (const ws of sockets.get(room.code) || []) {
    if (ws.pid == null) continue;
    send(ws, {
      t: "room", code: room.code, you: ws.pid, host: room.host, goal: room.goal, chaos: !!room.chaos, stack: !!room.stack, members,
      view: room.state ? Uno.view(room.state, ws.pid) : null, events: events || []
    });
  }
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function attach(ws, room, pid) {
  detach(ws);
  ws.code = room.code;
  ws.pid = pid;
  if (!sockets.has(room.code)) sockets.set(room.code, new Set());
  sockets.get(room.code).add(ws);
  room.touched = Date.now();
  send(ws, { t: "joined", code: room.code, pid, secret: room.members[pid].secret });
}
function detach(ws) {
  if (!ws.code) return;
  const set = sockets.get(ws.code);
  if (set) { set.delete(ws); if (!set.size) sockets.delete(ws.code); }
  const room = rooms.get(ws.code);
  ws.code = null; ws.pid = null;
  if (room) broadcast(room);
}

function handle(ws, msg) {
  const err = (m) => send(ws, { t: "error", msg: m });
  const room = ws.code ? rooms.get(ws.code) : null;

  switch (msg.t) {
    case "create": {
      const name = cleanName(msg.name);
      if (!name) return err("Bitte gib deinen Namen ein.");
      if (rooms.size >= MAX_ROOMS) return err("Der Server ist voll. Versuch es später nochmal.");
      const goal = [0, 250, 500].includes(+msg.goal) ? +msg.goal : 500;
      const r = { code: newCode(), host: 0, goal, chaos: !!msg.chaos, stack: !!msg.stack, members: [{ name, secret: crypto.randomUUID() }], state: null, touched: Date.now() };
      rooms.set(r.code, r);
      attach(ws, r, 0);
      broadcast(r); saveRooms();
      return;
    }
    case "join": {
      const r = rooms.get(String(msg.code || "").toUpperCase().trim());
      const name = cleanName(msg.name);
      if (!r) return err("Diesen Raum gibt es nicht. Prüf den Code.");
      if (!name) return err("Bitte gib deinen Namen ein.");
      const same = r.members.findIndex((m) => m.name.toLowerCase() === name.toLowerCase());
      if (same >= 0) {
        // same name: only allowed to take the seat back when that player is offline
        if (online(r.code).has(same)) return err(`Der Name „${name}“ ist schon vergeben.`);
        attach(ws, r, same); broadcast(r); return;
      }
      if (r.state) return err("Das Spiel läuft schon. Neue Spieler können erst in einem neuen Raum mitmachen.");
      if (r.members.length >= MAX_PLAYERS) return err("Der Raum ist voll (10 Spieler).");
      r.members.push({ name, secret: crypto.randomUUID() });
      attach(ws, r, r.members.length - 1);
      broadcast(r); saveRooms();
      return;
    }
    case "resume": {
      const r = rooms.get(String(msg.code || ""));
      const pid = r ? r.members.findIndex((m) => m.secret === msg.secret) : -1;
      if (pid < 0) return send(ws, { t: "gone" });
      attach(ws, r, pid); broadcast(r);
      return;
    }
    case "leave": {
      if (!room) return;
      const pid = ws.pid;
      if (!room.state) {
        room.members.splice(pid, 1);
        for (const s of sockets.get(room.code) || []) if (s.pid > pid) s.pid--;
        if (room.host === pid) room.host = 0;
        else if (room.host > pid) room.host--;
      }
      send(ws, { t: "left" });
      detach(ws);
      if (!room.members.length) rooms.delete(room.code);
      else broadcast(room);
      saveRooms();
      return;
    }
    case "start": {
      if (!room) return;
      if (ws.pid !== room.host) return err("Nur wer den Raum erstellt hat, kann starten.");
      if (room.state) return;
      if (room.members.length < 2) return err("Es braucht mindestens 2 Spieler.");
      room.state = Uno.newGame(room.members.map((m) => m.name), room.goal, { chaos: room.chaos, stack: room.stack });
      broadcast(room); saveRooms();
      return;
    }
    case "act": {
      if (!room || !room.state) return;
      const a = msg.a || {};
      if (a.t === "skip" && ws.pid !== room.host) return err("Nur der Host kann Spieler überspringen.");
      const expired = Uno.tick(room.state); // resolve run-out UNO windows first
      const res = Uno.act(room.state, ws.pid, a);
      room.touched = Date.now();
      if (!res.ok) {
        err(res.error);
        if (expired.length) { broadcast(room, expired); saveRooms(); }
        return;
      }
      broadcast(room, expired.concat(res.events || [])); saveRooms();
      scheduleUno(room);
      return;
    }
    case "react": { // emoji for everyone at the table, at most one per second
      if (!room || !REACTIONS.includes(msg.e)) return;
      const now = Date.now();
      if (now - (ws.lastReact || 0) < 1000) return;
      ws.lastReact = now;
      for (const s of sockets.get(room.code) || []) if (s.pid != null) send(s, { t: "react", pi: ws.pid, e: msg.e });
      return;
    }
    case "end": { // host closes the game and returns everyone to the lobby
      if (!room || ws.pid !== room.host) return;
      room.state = null;
      scheduleUno(room);
      broadcast(room); saveRooms();
      return;
    }
  }
}

// ---------- http ----------
function lanIps() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) ips.push(a.address);
  return ips;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/info") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ uno: true, ips: lanIps(), port: PORT, rooms: rooms.size }));
  }
  if (url.pathname === "/vendor/qrcode.js") {
    return fs.readFile(QR_LIB, (e, data) => {
      if (e) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "public, max-age=86400" });
      res.end(data);
    });
  }
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("Nicht gefunden"); }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": path.extname(file) === ".png" ? "public, max-age=86400" : "no-cache"
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });
wss.on("connection", (ws) => {
  ws.alive = true;
  ws.on("pong", () => { ws.alive = true; });
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg && typeof msg.t === "string") {
      try { handle(ws, msg); } catch (e) { console.error(e); send(ws, { t: "error", msg: "Serverfehler." }); }
    }
  });
  ws.on("close", () => detach(ws));
});

// keep connections alive through phones' sleep and home routers; drop dead ones
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
  for (const [code, r] of rooms) {
    if (Date.now() - r.touched > ROOM_TTL && !sockets.has(code)) { rooms.delete(code); saveRooms(); }
  }
}, 25000).unref();

loadRooms();
server.listen(PORT, HOST, () => {
  console.log(`Pass-Uno läuft auf Port ${PORT}`);
  for (const ip of lanIps()) console.log(`  im WLAN öffnen: http://${ip}:${PORT}`);
});

module.exports = { server, rooms };
