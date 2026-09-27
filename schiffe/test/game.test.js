"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

const two = () => [{ name: "Anna" }, { name: "Ben" }];
// a fixed 10×10 fleet: ships on rows 0, 2, 4, 6, 8, starting at column 0
const FLEET = [[0, 1, 2, 3, 4], [20, 21, 22, 23], [40, 41, 42], [60, 61, 62], [80, 81]];
function ready(S, fleets) {
  S.players.forEach((p, i) => { if (!p.ready) assert.ok(G.act(S, i, { t: "place", ships: (fleets && fleets[i]) || FLEET }).ok); });
}
const shoot = (S, pi, target, cell) => G.act(S, pi, { t: "shoot", target, cell });

test("rules, sizes and goals are normalised", () => {
  const off = { again: true, salvo: false, touch: false, weapons: false, sonar: false, clock: false, teams: false };
  assert.deepStrictEqual(G.normRules(), off);
  assert.deepStrictEqual(G.normRules({ again: false, salvo: true, bogus: 1, touch: "yes" }), { ...off, again: false, salvo: true });
  assert.strictEqual(G.normSize(5), 5);
  assert.strictEqual(G.normSize(16), 16);
  assert.strictEqual(G.normLevel(3), 3);
  assert.strictEqual(G.normLevel(7), 2);
  assert.strictEqual(G.normSize(12), 12);
  assert.strictEqual(G.normSize(9), 10);
  assert.strictEqual(G.normGoal(3), 3);
  assert.strictEqual(G.normGoal("x"), 1);
  assert.strictEqual(G.cellName(10, 0), "A1");
  assert.strictEqual(G.cellName(10, 99), "J10");
});

test("fleet placement is checked", () => {
  assert.strictEqual(G.fleetError(10, false, FLEET), null);
  assert.match(G.fleetError(10, false, FLEET.slice(1)), /vollständig/);
  assert.match(G.fleetError(10, false, [[0, 1, 2, 3, 4], [10, 11, 12, 13], [40, 41, 42], [60, 61, 62], [80, 81]]), /berühren/);
  assert.strictEqual(G.fleetError(10, true, [[0, 1, 2, 3, 4], [10, 11, 12, 13], [40, 41, 42], [60, 61, 62], [80, 81]]), null);
  assert.match(G.fleetError(10, true, [[0, 1, 2, 3, 4], [4, 14, 24, 34], [40, 41, 42], [60, 61, 62], [80, 81]]), /schon ein Schiff/);
  assert.match(G.fleetError(10, false, [[8, 9, 10, 11, 12], [20, 21, 22, 23], [40, 41, 42], [60, 61, 62], [80, 81]]), /Schiffsform/);
  assert.match(G.fleetError(10, false, FLEET.slice(0, 4).concat([[99, 100]])), /ragt/);
  assert.deepStrictEqual(G.place(10, "L3", 0, 9, 0), [7, 8, 9]);
  assert.deepStrictEqual(G.place(10, "L2", 1, 95, 0), [85, 95]);
  assert.deepStrictEqual(G.place(10, "L3", 0, 5, 2), [3, 4, 5]); // grabbed at the stern
  for (const size of [5, 8, 10, 12, 14, 16]) for (const touch of [false, true]) {
    const f = G.randomFleet(size, touch);
    assert.strictEqual(G.fleetError(size, touch, f), null, `random fleet ${size} ${touch}`);
  }
});

test("wide and diagonal ships", () => {
  assert.deepStrictEqual(G.place(14, "W3", 0, 0, 0).sort((a, b) => a - b), [0, 1, 2, 14, 15, 16]);
  assert.deepStrictEqual(G.place(14, "W3", 1, 0, 0).sort((a, b) => a - b), [0, 1, 14, 15, 28, 29]);
  assert.deepStrictEqual(G.place(14, "D3", 0, 0, 0), [0, 15, 30]);
  assert.deepStrictEqual(G.place(14, "D3", 1, 0, 0), [2, 15, 28]); // ↙ pushed inside the board
  assert.strictEqual(G.matchKey(14, [28, 15, 2]), "D3");
  assert.strictEqual(G.matchKey(14, [0, 1, 14, 15]), "W2");
  assert.strictEqual(G.matchKey(14, [0, 15, 31]), null);
  assert.strictEqual(G.orientOf(14, "D3", [2, 15, 28]), 1);
  assert.deepStrictEqual(G.canon(14, "D3", [28, 2, 15]), [2, 15, 28]);
  // a whole 14×14 fleet with special ships, checked and played
  const fleet = [G.place(14, "W3", 0, 0, 0), G.place(14, "L5", 0, 70, 0), G.place(14, "L4", 0, 126, 0), G.place(14, "D3", 1, 11, 0),
    G.place(14, "L3", 1, 150, 0), G.place(14, "L2", 0, 180, 0), G.place(14, "L2", 0, 186, 0)];
  assert.strictEqual(G.fleetError(14, false, fleet), null);
  assert.match(G.fleetError(14, false, fleet.slice(0, 6).concat([G.place(14, "L3", 0, 186, 0)])), /vollständig/);
  const S = G.newGame(two(), 1, 14, { again: false });
  ready(S, [fleet, fleet]);
  S.cur = 0;
  for (const c of [11, 24, 37]) { shoot(S, 0, 1, c); shoot(S, 1, 0, 195); if (S.cur === 1) S.cur = 0; }
  assert.strictEqual(S.players[1].fleet.find((s) => s.key === "D3").sunk, true);
  assert.match(S.log.join("\n"), /Schnellboot versenkt/);
});

test("aim help knows where no ship can lie any more", () => {
  const m = ".".repeat(100).split("");
  for (let i = 0; i < 10; i++) { m[i * 10 + 1] = "o"; m[10 + i] = "o"; }
  const ok = G.possible(10, m.join(""), ["L3", "L2"]);
  assert.strictEqual(ok[0], false); // boxed in by misses
  assert.strictEqual(ok[55], true);
  assert.strictEqual(G.possible(10, m.join(""), ["D3"])[0], false);
});

test("avatars: people keep theirs, computer players wear the robot", () => {
  assert.strictEqual(G.AVATARS.length, 16);
  const S = G.newGame([{ name: "A", avatar: "🐙" }, { name: "B", avatar: "nope" }, { name: "C", bot: true, avatar: "🐙" }], 1, 10);
  assert.deepStrictEqual(S.players.map((p) => p.avatar), ["🐙", G.AVATARS[1], "🤖"]);
  assert.deepStrictEqual(G.view(S, 0).players.map((p) => p.avatar), ["🐙", G.AVATARS[1], "🤖"]);
});

test("placing, then the first player shoots", () => {
  const S = G.newGame(two(), 1, 10);
  assert.strictEqual(S.phase, "place");
  assert.match(shoot(S, 0, 1, 50).error, /nicht geschossen/);
  assert.ok(G.act(S, 0, { t: "place", ships: FLEET }).ok);
  assert.ok(G.act(S, 0, { t: "unready" }).ok);
  assert.strictEqual(S.players[0].ready, false);
  const r = G.act(S, 1, { t: "place", ships: [[0, 1]] });
  assert.ok(!r.ok);
  ready(S);
  assert.strictEqual(S.phase, "play");
  assert.ok(S.cur === 0 || S.cur === 1);
});

test("miss passes the turn, hit shoots again, sinking marks water around", () => {
  const S = G.newGame(two(), 1, 10);
  ready(S);
  const a = S.cur, b = 1 - a;
  assert.match(shoot(S, b, a, 0).error, /ist dran/);
  assert.match(shoot(S, a, a, 0).error, /nicht schießen/);
  // miss
  let r = shoot(S, a, b, 99);
  assert.ok(r.ok);
  assert.strictEqual(r.events.find((e) => e.t === "shot").res, "miss");
  assert.strictEqual(S.cur, b);
  assert.match(shoot(S, b, a, 200).error, /gibt es nicht/);
  // hit: again
  r = shoot(S, b, a, 80);
  assert.strictEqual(r.events.find((e) => e.t === "shot").res, "hit");
  assert.strictEqual(S.cur, b);
  assert.match(shoot(S, b, a, 80).error, /schon/);
  r = shoot(S, b, a, 81);
  const shot = r.events.find((e) => e.t === "shot");
  assert.strictEqual(shot.res, "sunk");
  assert.strictEqual(shot.len, 2);
  assert.strictEqual(S.players[a].marks[80], "#");
  assert.strictEqual(S.players[a].marks[70], "~");
  assert.strictEqual(S.players[a].marks[92], "~");
  assert.match(shoot(S, b, a, 70).error, /sicher Wasser/);
  assert.match(S.log[S.log.length - 1], /U-Boot versenkt/);
});

test("without 'again' every shot passes the turn", () => {
  const S = G.newGame(two(), 1, 10, { again: false });
  ready(S);
  const a = S.cur;
  shoot(S, a, 1 - a, 0);
  assert.strictEqual(S.cur, 1 - a);
});

test("sinking the whole fleet wins; goal counts wins; rematch resets", () => {
  const S = G.newGame(two(), 2, 10);
  ready(S);
  const a = S.cur, b = 1 - a;
  let last;
  for (const ship of FLEET) for (const c of ship) last = shoot(S, a, b, c);
  assert.ok(last.events.some((e) => e.t === "out" && e.pi === b));
  assert.ok(last.events.some((e) => e.t === "end"));
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last, { winners: [a], over: false });
  assert.strictEqual(S.players[a].wins, 1);
  assert.strictEqual(S.players[a].hits, 17);
  assert.ok(G.act(S, 0, { t: "next" }).ok);
  assert.strictEqual(S.phase, "place");
  assert.strictEqual(S.round, 2);
  ready(S);
  const c = S.cur;
  for (const ship of FLEET) for (const x of ship) shoot(S, c, 1 - c, x);
  assert.ok(S.last.over === (S.players[c].wins >= 2));
});

test("three players: knocked-out players are skipped", () => {
  const S = G.newGame([{ name: "A" }, { name: "B" }, { name: "C" }], 1, 10);
  ready(S);
  S.cur = 0; // let player 0 start
  for (const ship of FLEET) for (const c of ship) shoot(S, 0, 1, c);
  assert.strictEqual(S.players[1].out, true);
  assert.strictEqual(S.phase, "play");
  assert.strictEqual(S.cur, 0); // last shot was a hit, so still player 0
  assert.match(shoot(S, 0, 1, 99).error, /nicht schießen/);
  shoot(S, 0, 2, 99); // miss
  assert.strictEqual(S.cur, 2); // player 1 is out, so player 2 is next
  shoot(S, 2, 0, 99);
  assert.strictEqual(S.cur, 0);
});

test("salvo: one shot per remaining ship, no extra shots for hits", () => {
  const S = G.newGame(two(), 1, 10, { salvo: true });
  ready(S);
  const a = S.cur, b = 1 - a;
  assert.strictEqual(S.shotsLeft, 5);
  for (let k = 0; k < 4; k++) { shoot(S, a, b, k); assert.strictEqual(S.cur, a); }
  shoot(S, a, b, 50);
  assert.strictEqual(S.cur, b);
  shoot(S, b, a, 80); shoot(S, b, a, 81); // sinks the submarine of a
  assert.strictEqual(S.players[a].fleet.filter((s) => !s.sunk).length, 4);
  for (let k = 0; k < 3; k++) shoot(S, b, a, 90 + k * 2 + 5);
  assert.strictEqual(S.cur, a);
  assert.strictEqual(S.shotsLeft, 4); // a lost a ship: only 4 shots
});

test("sonar counts hidden ship parts once per round and uses a shot", () => {
  const S = G.newGame(two(), 1, 10, { sonar: true, again: false });
  ready(S);
  const a = S.cur, b = 1 - a;
  const r = G.act(S, a, { t: "sonar", target: b, cell: 11 });
  assert.ok(r.ok);
  assert.deepStrictEqual(S.sonars[0], { by: a, target: b, cell: 11, n: 6, turn: 1 });
  assert.strictEqual(S.cur, b);
  shoot(S, b, a, 99);
  assert.match(G.act(S, a, { t: "sonar", target: b, cell: 50 }).error, /verbraucht/);
  assert.deepStrictEqual(G.view(S, a).sonars.length, 1);
  assert.deepStrictEqual(G.view(S, b).sonars.length, 0);
  const off = G.newGame(two(), 1, 10);
  ready(off);
  assert.match(G.act(off, off.cur, { t: "sonar", target: 1 - off.cur, cell: 0 }).error, /aus/);
});

test("teams: partners cannot be shot, the team wins together", () => {
  const S = G.newGame([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }], 1, 10, { teams: true });
  assert.strictEqual(S.teams, true);
  ready(S);
  S.cur = 0;
  assert.match(shoot(S, 0, 2, 0).error, /Teampartner/);
  const v = G.view(S, 0);
  assert.ok(v.players[2].ships, "partner fleet visible");
  assert.strictEqual(v.players[1].ships, null);
  for (const t of [1, 3]) for (const ship of FLEET) for (const c of ship) shoot(S, 0, t, c);
  assert.strictEqual(S.phase, "roundEnd");
  assert.deepStrictEqual(S.last.winners, [0, 2]);
  assert.strictEqual(S.players[2].wins, 1);
  // teams need exactly four players
  const three = G.newGame([{ name: "A" }, { name: "B" }, { name: "C" }], 1, 10, { teams: true });
  assert.strictEqual(three.teams, false);
});

test("bomb hits a cross of five, torpedo runs along a row", () => {
  const S = G.newGame(two(), 1, 10, { weapons: true, again: true });
  ready(S);
  S.cur = 0; S.shotsLeft = 1;
  let r = G.act(S, 0, { t: "bomb", target: 1, cell: 21 }); // cross over 11, 20, 21, 22, 31
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.events.filter((e) => e.t === "shot").length, 5);
  assert.strictEqual(S.players[1].marks.slice(20, 23), "xxx");
  assert.strictEqual(S.players[0].bomb, true);
  assert.strictEqual(S.cur, 1); // special weapons never give an extra shot
  shoot(S, 1, 0, 99);
  assert.match(G.act(S, 0, { t: "bomb", target: 1, cell: 55 }).error, /verbraucht/);
  r = G.act(S, 0, { t: "torpedo", target: 1, cell: 69 }); // row 6: first ship part at 60
  assert.ok(r.ok, r.error);
  assert.strictEqual(S.players[1].marks[60], "x");
  S.cur = 0;
  r = G.act(S, 0, { t: "torpedo", target: 1, cell: 90 });
  assert.match(r.error, /verbraucht/);
  const T = G.newGame(two(), 1, 10, { weapons: true });
  ready(T); T.cur = 0;
  G.act(T, 0, { t: "torpedo", target: 1, cell: 55 }); // row 5 is empty: all water
  assert.strictEqual(T.players[1].marks.slice(50, 60), "oooooooooo");
  assert.match(G.newGame(two(), 1, 10).rules.weapons ? "" : "aus", /aus/);
});

test("shot clock: time out fires a random shot, swiftplay always has one", () => {
  const S = G.newGame(two(), 1, 10, { clock: true, again: false });
  ready(S);
  const a = S.cur;
  assert.ok(S.deadline > Date.now());
  assert.deepStrictEqual(G.tick(S), []);
  assert.ok(G.nextDeadline(S) > 14000);
  const ev = G.tick(S, S.deadline + 5000);
  assert.strictEqual(ev[0].t, "timeout");
  assert.ok(ev.some((e) => e.t === "shot" && e.pi === a));
  assert.strictEqual(S.cur, 1 - a);
  const W = G.newGame(two(), 1, 5);
  ready(W, [G.randomFleet(5, false), G.randomFleet(5, false)]);
  assert.strictEqual(G.view(W, 0).clockMs, 8000);
  assert.deepStrictEqual(G.view(W, 0).fleet, ["L3", "L2", "L2"]);
  const B = G.newGame([{ name: "A" }, { name: "B", bot: true }], 1, 10, { clock: true });
  ready(B); B.cur = 1; G.resetClock(B);
  assert.strictEqual(B.deadline, 0); // no clock for computer players
});

test("stats count hits, streaks and ships finished off", () => {
  const S = G.newGame([{ name: "A" }, { name: "B" }, { name: "C" }], 1, 10, { again: false });
  ready(S);
  S.cur = 0; shoot(S, 0, 2, 80); // A hits C's submarine
  S.cur = 1; shoot(S, 1, 2, 81); // B finishes it off
  assert.strictEqual(S.players[1].sinks, 1);
  assert.strictEqual(S.players[1].steals, 1);
  S.cur = 0; shoot(S, 0, 1, 0); S.cur = 0; shoot(S, 0, 1, 1); S.cur = 0; shoot(S, 0, 1, 99);
  assert.strictEqual(S.players[0].best, 3);
  assert.strictEqual(S.players[0].missRun, 1);
});

test("giving up and skipping", () => {
  const S = G.newGame([{ name: "A" }, { name: "B" }, { name: "C" }], 1, 10);
  ready(S);
  S.cur = 0;
  assert.ok(G.act(S, 0, { t: "skip" }).ok);
  assert.strictEqual(S.cur, 1);
  assert.ok(G.act(S, 1, { t: "giveup" }).ok);
  assert.strictEqual(S.players[1].out, true);
  assert.strictEqual(S.cur, 2);
  const r = G.act(S, 2, { t: "giveup" });
  assert.ok(r.events.some((e) => e.t === "end"));
  assert.deepStrictEqual(S.last.winners, [0]);
});

test("views hide other fleets until the round is over", () => {
  const S = G.newGame(two(), 1, 8);
  ready(S, [G.randomFleet(8, false), G.randomFleet(8, false)]);
  const v0 = G.view(S, 0);
  assert.ok(v0.players[0].ships);
  assert.strictEqual(v0.players[1].ships, null);
  assert.strictEqual(G.view(S, -1).players[0].ships, null);
  assert.deepStrictEqual(v0.fleet, ["L4", "L3", "L2", "L2"]);
  G.act(S, 1, { t: "giveup" });
  assert.strictEqual(S.phase, "roundEnd");
  assert.ok(G.view(S, 0).players[1].ships);
});

test("computer players place, aim sensibly and finish games", () => {
  for (let g = 0; g < 60; g++) {
    const size = [8, 10, 12][g % 3];
    const S = G.newGame([{ name: "A", bot: true }, { name: "B", bot: true }, { name: "C", bot: true }, { name: "D", bot: true }].slice(0, 2 + (g % 3)),
      1, size, { touch: g % 2 === 0, salvo: g % 5 === 0, sonar: true, teams: g % 4 === 0 });
    assert.strictEqual(S.phase, "play", "bots are ready right away");
    let k = 0;
    while (S.phase === "play" && k++ < 3000) {
      const a = G.botMove(S, S.cur);
      const r = G.act(S, S.cur, a);
      assert.ok(r.ok, r.error);
    }
    assert.strictEqual(S.phase, "roundEnd");
  }
  // after a hit the bot shoots next to it
  const S = G.newGame([{ name: "A" }, { name: "B", bot: true }], 1, 10, { again: false }, 3);
  ready(S);
  S.cur = 0;
  shoot(S, 0, 1, 99);
  S.players[0].marks = S.players[0].marks.slice(0, 44) + "x" + S.players[0].marks.slice(45);
  const a = G.botMove(S, 1);
  assert.strictEqual(a.target, 0);
  assert.ok([34, 43, 45, 54].includes(a.cell), `aims next to the hit, got ${a.cell}`);
  // a line of hits gets extended along the line
  S.players[0].marks = S.players[0].marks.slice(0, 45) + "x" + S.players[0].marks.slice(46);
  assert.ok([43, 46].includes(G.botMove(S, 1).cell));
});
