"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "uno-"));
const { server } = require("../server.js");

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let waiter = null;
  ws.on("message", (d) => { inbox.push(JSON.parse(d)); if (waiter) waiter(); });
  const next = (pred) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout")), 2000);
    const check = () => {
      const i = inbox.findIndex(pred);
      if (i >= 0) { clearTimeout(t); waiter = null; res(inbox.splice(0, i + 1).pop()); }
    };
    waiter = check; check();
  });
  return { ws, next, send: (m) => ws.send(JSON.stringify(m)), open: new Promise((r) => ws.on("open", r)) };
}

test("create, join, start and play over WebSockets", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;

  const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
  assert.strictEqual(info.uno, true);
  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.match(await page.text(), /Pass-Uno/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/vendor/qrcode.js`)).status, 200);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port), b = client(port);
  await a.open; await b.open;
  a.send({ t: "create", name: "Anna", goal: 250, rules: { chaos: true, bogus: true } });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code.toLowerCase(), name: "Ben" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.view, null);

  b.send({ t: "join", code: joined.code, name: "anna" });
  assert.match((await b.next((m) => m.t === "error")).msg, /vergeben/);

  b.send({ t: "rules", rules: { stack: true } }); // not the host: ignored
  a.send({ t: "rules", rules: { chaos: true, stack: true } });
  const ruled = await b.next((m) => m.t === "room" && m.rules.stack);
  assert.deepStrictEqual(ruled.rules, { stack: true, skipAfterDraw: false, drawUntil: false, sevenZero: false, jumpIn: false, chaos: true });

  b.send({ t: "start" });
  assert.match((await b.next((m) => m.t === "error")).msg, /Nur/);
  a.send({ t: "start" });
  const sa = await a.next((m) => m.t === "room" && m.view);
  const sb = await b.next((m) => m.t === "room" && m.view);
  assert.strictEqual(sa.view.hand.length, 7);
  assert.strictEqual(sa.view.rules.chaos, true);
  assert.strictEqual(sa.view.deckCount + 1 + 14, 140);
  assert.strictEqual(sb.view.players[0].count, 7);
  assert.notDeepStrictEqual(sa.view.hand, sb.view.hand);

  // whoever is not on turn gets an error
  const cur = sa.view.cur;
  const [onTurn, waiting] = cur === 0 ? [a, b] : [b, a];
  waiting.send({ t: "act", a: { t: "draw" } });
  assert.match((await waiting.next((m) => m.t === "error")).msg, /dran/);
  onTurn.send({ t: "act", a: { t: "draw" } });
  const after = await waiting.next((m) => m.t === "room" && m.events.some((e) => e.t === "drew"));
  assert.strictEqual(after.view.players[cur].count, 8);

  // emoji reactions reach everybody, junk is ignored
  a.send({ t: "react", e: "<script>" });
  b.send({ t: "react", e: "🎉" });
  const r = await a.next((m) => m.t === "react");
  assert.deepStrictEqual([r.pi, r.e], [1, "🎉"]);

  // reconnect with the stored secret
  a.ws.close();
  const a2 = client(port); await a2.open;
  a2.send({ t: "resume", code: joined.code, secret: joined.secret });
  const back = await a2.next((m) => m.t === "room");
  assert.strictEqual(back.you, 0);
  assert.strictEqual(back.view.players[cur].count, 8);

  a2.ws.close(); b.ws.close();
  server.close();
});
