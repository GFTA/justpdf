"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

process.env.PORT = "0";
process.env.BOT_MS = "20";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "schiffe-"));
const { server, wss } = require("../server.js");
test.after(() => { for (const ws of wss.clients) ws.terminate(); server.close(); });

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  let waiter = null;
  ws.on("message", (d) => { inbox.push(JSON.parse(d)); if (waiter) waiter(); });
  const next = (pred, ms = 2000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout")), ms);
    const check = () => {
      const i = inbox.findIndex(pred);
      if (i >= 0) { clearTimeout(t); waiter = null; res(inbox.splice(0, i + 1).pop()); }
    };
    waiter = check; check();
  });
  return { ws, next, send: (m) => ws.send(JSON.stringify(m)), open: new Promise((r) => ws.on("open", r)) };
}

const FLEET = [[0, 1, 2, 3, 4], [20, 21, 22, 23], [40, 41, 42], [60, 61, 62], [80, 81]];

test("create, join, place and play over WebSockets, with a computer player", async () => {
  await new Promise((r) => server.listening ? r() : server.on("listening", r));
  const port = server.address().port;

  const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
  assert.strictEqual(info.schiffe, true);
  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.match(await page.text(), /Schiffe versenken/);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/vendor/qrcode.js`)).status, 200);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../server.js`)).status, 404);

  const a = client(port), b = client(port);
  await a.open; await b.open;
  a.send({ t: "create", name: "Anna", goal: 2, size: 12, rules: { salvo: true, bogus: true } });
  const joined = await a.next((m) => m.t === "joined");
  b.send({ t: "join", code: joined.code.toLowerCase(), name: "Ben" });
  await b.next((m) => m.t === "joined");
  const lobby = await a.next((m) => m.t === "room" && m.members.length === 2);
  assert.strictEqual(lobby.view, null);
  assert.strictEqual(lobby.size, 12);
  assert.strictEqual(lobby.goal, 2);

  b.send({ t: "join", code: joined.code, name: "anna" });
  assert.match((await b.next((m) => m.t === "error")).msg, /vergeben/);

  b.send({ t: "settings", size: 8 }); // not the host: ignored
  b.send({ t: "bot" });
  a.send({ t: "settings", size: 10, goal: 1, level: 3, rules: { again: true, sonar: true } });
  const set = await b.next((m) => m.t === "room" && m.size === 10);
  assert.deepStrictEqual(set.rules, { again: true, salvo: false, touch: false, weapons: false, sonar: true, clock: false, teams: false });
  assert.strictEqual(set.members.length, 2);
  assert.strictEqual(set.level, 3);

  a.send({ t: "bot" });
  const withBot = await b.next((m) => m.t === "room" && m.members.length === 3);
  assert.deepStrictEqual(withBot.members[2], { name: "Admiral Byte", bot: true, online: true });

  b.send({ t: "start" });
  assert.match((await b.next((m) => m.t === "error")).msg, /Nur/);
  a.send({ t: "start" });
  const sa = await a.next((m) => m.t === "room" && m.view);
  assert.strictEqual(sa.view.phase, "place");
  assert.strictEqual(sa.view.players[2].ready, true); // the computer is ready right away
  assert.strictEqual(sa.view.players[1].ships, null);

  // joining a running game: Chris watches without seeing any fleet
  const c = client(port); await c.open;
  c.send({ t: "join", code: joined.code, name: "Chris" });
  assert.deepStrictEqual(await c.next((m) => m.t === "watching"), { t: "watching", code: joined.code, name: "Chris" });
  const watched = await c.next((m) => m.t === "room" && m.view);
  assert.strictEqual(watched.you, -1);
  assert.strictEqual(watched.view.me, -1);
  assert.ok(watched.view.players.every((p) => p.ships === null));
  assert.deepStrictEqual((await a.next((m) => m.t === "room" && m.watchers.length === 1)).watchers, ["Chris"]);
  c.send({ t: "act", a: { t: "place", ships: FLEET } });
  assert.match((await c.next((m) => m.t === "error")).msg, /Unbekannter/);
  c.send({ t: "sit" });
  assert.match((await c.next((m) => m.t === "error")).msg, /Warte/);

  a.send({ t: "act", a: { t: "place", ships: [[0, 1]] } });
  assert.match((await a.next((m) => m.t === "error")).msg, /vollständig/);
  a.send({ t: "act", a: { t: "place", ships: FLEET } });
  b.send({ t: "act", a: { t: "place", ships: FLEET } });
  const go = await b.next((m) => m.t === "room" && m.view && m.view.phase === "play");
  assert.ok(go.events.some((e) => e.t === "begin"));
  assert.deepStrictEqual(go.view.players[1].ships.map((s) => s.cells), FLEET);
  assert.strictEqual(go.view.players[0].ships, null);

  // play until the round is over: humans fire at the computer, the computer fires back on its own
  const clients = [a, b];
  let view = go.view, guard = 0;
  while (view.phase === "play" && guard++ < 2000) {
    if (view.cur === 2) { // wait for the computer
      const m = await a.next((x) => x.t === "room" && x.view && x.view.round === view.round &&
        (x.view.phase === "roundEnd" || (x.view.cur !== 2 && x.view.turn > view.turn)));
      view = m.view;
      continue;
    }
    const me = clients[view.cur];
    const target = view.players[2].out ? (view.cur === 0 ? 1 : 0) : 2;
    const marks = view.players[target].marks;
    const cell = marks.indexOf(".");
    me.send({ t: "act", a: { t: "shoot", target, cell } });
    const m = await me.next((x) => x.t === "error" || (x.t === "room" && x.view && x.view.lastShot &&
      x.view.lastShot.turn === view.turn && x.view.lastShot.target === target && x.view.lastShot.cell === cell));
    assert.notStrictEqual(m.t, "error", m.msg);
    view = m.view;
  }
  assert.strictEqual(view.phase, "roundEnd");
  assert.ok(view.players.every((p) => p.ships), "fleets revealed at the end");

  // reactions and quick messages reach everyone, spectators included
  b.send({ t: "react", e: "🎉" });
  assert.deepStrictEqual(await a.next((m) => m.t === "react"), { t: "react", pi: 1, e: "🎉" });
  c.send({ t: "react", e: "Gut gespielt!" });
  assert.deepStrictEqual(await b.next((m) => m.t === "react" && m.pi === -1), { t: "react", pi: -1, e: "Gut gespielt!", name: "Chris" });

  // reconnect with the secret keeps the seat
  const secret = joined.secret;
  a.ws.close();
  const a2 = client(port); await a2.open;
  a2.send({ t: "resume", code: joined.code, secret });
  const back = await a2.next((m) => m.t === "room");
  assert.strictEqual(back.you, 0);

  // the host goes back to the waiting room, removes the computer, and people can join again
  a2.send({ t: "end" });
  await a2.next((m) => m.t === "room" && !m.view);
  a2.send({ t: "unbot", i: 2 });
  const noBot = await a2.next((m) => m.t === "room" && m.members.length === 2);
  assert.ok(!noBot.members.some((m) => m.bot));
  // the spectator takes the free seat
  c.send({ t: "sit" });
  assert.strictEqual((await c.next((m) => m.t === "joined")).pid, 2);
  await a2.next((m) => m.t === "room" && m.members.length === 3 && m.watchers.length === 0);
  c.send({ t: "leave" });
  await c.next((m) => m.t === "left");
  await a2.next((m) => m.t === "room" && m.members.length === 2);
  a2.send({ t: "leave" });
  await a2.next((m) => m.t === "left");
  const hostNow = await b.next((m) => m.t === "room" && m.members.length === 1);
  assert.strictEqual(hostNow.host, 0);
  assert.strictEqual(hostNow.you, 0);

  a2.ws.close(); b.ws.close(); c.ws.close();
});
