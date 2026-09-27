"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

const size = (S) => (S.rules.chaos ? 140 : 108);
const total = (S) => S.deck.length + S.discard.length + S.players.reduce((a, p) => a + p.hand.length, 0);
const card = (c, v, id) => ({ id, c, v });

function rig(n = 3) {
  const S = G.newGame(Array.from({ length: n }, (_, i) => `P${i}`), 500);
  return S;
}

test("deck has 108 cards and deal gives 7 each", () => {
  assert.strictEqual(G.buildDeck().length, 108);
  const S = rig(4);
  S.players.forEach((p) => assert.strictEqual(p.hand.length, 7));
  assert.ok(G.isNum(S.discard[0]));
  assert.strictEqual(total(S), 108);
});

test("only the current player may act", () => {
  const S = rig();
  const other = (S.cur + 1) % 3;
  assert.strictEqual(G.act(S, other, { t: "draw" }).ok, false);
});

test("playing a non-matching card is rejected", () => {
  const S = rig();
  S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[S.cur].hand = [card("b", "7", 901), card("g", "1", 902)];
  assert.strictEqual(G.act(S, S.cur, { t: "play", id: 901 }).ok, false);
});

test("skip, reverse, +2 and +4 effects with the skip-after-draw rule", () => {
  const S = G.newGame(["P0", "P1", "P2", "P3"], 500, { skipAfterDraw: true });
  S.cur = 0; S.dir = 1; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "skip", 901), card("r", "1", 950), card("r", "2", 951)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.cur, 2);

  S.players[2].hand = [card("r", "rev", 902), card("r", "1", 952), card("r", "2", 953)];
  G.act(S, 2, { t: "play", id: 902 });
  assert.strictEqual(S.dir, -1);
  assert.strictEqual(S.cur, 1);

  const before = S.players[0].hand.length;
  S.players[1].hand = [card("r", "d2", 903), card("r", "1", 954), card("r", "2", 955)];
  G.act(S, 1, { t: "play", id: 903 });
  assert.strictEqual(S.players[0].hand.length, before + 2);
  assert.strictEqual(S.cur, 3);

  const b2 = S.players[2].hand.length;
  S.players[3].hand = [card("w", "d4", 904), card("r", "1", 956), card("r", "2", 957)];
  assert.strictEqual(G.act(S, 3, { t: "play", id: 904 }).ok, false, "wild needs a color");
  G.act(S, 3, { t: "play", id: 904, color: "g" });
  assert.strictEqual(S.color, "g");
  assert.strictEqual(S.players[2].hand.length, b2 + 4);
  assert.strictEqual(S.cur, 1);
});

test("reverse with two players acts like skip", () => {
  const S = rig(2);
  S.cur = 0; S.discard = [card("b", "5", 900)]; S.color = "b";
  S.players[0].hand = [card("b", "rev", 901), card("r", "1", 950), card("r", "2", 951)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.cur, 0);
});

test("second-to-last card opens a 3 second UNO window", () => {
  const S = rig(3);
  S.cur = 0; S.discard = [card("b", "5", 900)]; S.color = "b";
  S.players[0].hand = [card("b", "1", 901), card("r", "2", 902)];
  const res = G.act(S, 0, { t: "play", id: 901 });
  assert.ok(res.events.some((e) => e.t === "unoWait" && e.pi === 0));
  assert.strictEqual(S.cur, 1, "play goes on while the window is open");
  assert.strictEqual(G.act(S, 2, { t: "uno" }).ok, false, "only the waiting player can call");
  assert.strictEqual(G.act(S, 0, { t: "uno" }).ok, true, "allowed although it is not player 0's turn");
  assert.strictEqual(S.unoWaits.length, 0);
  assert.deepStrictEqual(G.tick(S, Date.now() + 60000), []);
  assert.strictEqual(S.players[0].hand.length, 1);
});

test("missing the UNO window costs two cards", () => {
  const S = rig(3);
  S.cur = 0; S.discard = [card("b", "5", 900)]; S.color = "b";
  S.players[0].hand = [card("b", "1", 901), card("r", "2", 902)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.deepStrictEqual(G.tick(S, Date.now() + 1000), [], "still inside the window");
  const ev = G.tick(S, Date.now() + G.UNO_MS + 5000);
  assert.deepStrictEqual(ev, [{ t: "penalty", pi: 0 }]);
  assert.strictEqual(S.players[0].hand.length, 3);
  assert.strictEqual(G.act(S, 0, { t: "uno" }).ok, false, "too late");
  assert.strictEqual(G.nextDeadline(S), -1);
});

test("playing the last card without having called UNO costs two cards", () => {
  const S = rig(2);
  S.cur = 0; S.discard = [card("b", "5", 900)]; S.color = "b";
  S.players[0].hand = [card("b", "skip", 901), card("b", "2", 902)];
  G.act(S, 0, { t: "play", id: 901 }); // skip with two players: own turn again
  assert.strictEqual(S.cur, 0);
  G.act(S, 0, { t: "play", id: 902 });
  assert.strictEqual(S.phase, "play", "no win: penalty cards came first");
  assert.strictEqual(S.players[0].hand.length, 2);
});

test("+2 is drawn automatically and the victim plays on", () => {
  const S = rig(3);
  S.cur = 0; S.dir = 1; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "d2", 901), card("r", "1", 950), card("r", "2", 951)];
  S.players[1].hand = [card("b", "d2", 902), card("y", "7", 953)];
  const res = G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.players[1].hand.length, 4, "drawn right away");
  assert.ok(res.events.some((e) => e.t === "took" && e.pi === 1 && e.n === 2));
  assert.strictEqual(S.cur, 1, "no skipping by default");
  assert.strictEqual(S.pending, 0);
  assert.strictEqual(S.phase, "play");
});

test("stacking: counter or draw everything; auto-draw when nothing fits", () => {
  const S = G.newGame(["a", "b", "c"], 0, { stack: true });
  S.cur = 0; S.dir = 1; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "d2", 901), card("r", "1", 950), card("r", "2", 951)];
  S.players[1].hand = [card("b", "d2", 902), card("g", "d2", 952), card("y", "7", 953)];
  S.players[2].hand = [card("w", "d4", 903), card("b", "d2", 954), card("y", "8", 955)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.cur, 1);
  assert.strictEqual(S.pending, 2, "b can counter, so nothing drawn yet");
  assert.strictEqual(S.players[1].hand.length, 3);
  assert.strictEqual(G.act(S, 1, { t: "play", id: 953 }).ok, false, "only +2/+4 while stacking");
  G.act(S, 1, { t: "play", id: 902 });
  assert.strictEqual(S.pending, 4);
  G.act(S, 2, { t: "play", id: 903, color: "g" });
  // player 0 has no +4: the 8 cards are drawn automatically and it is still their turn
  assert.strictEqual(S.pending, 0);
  assert.strictEqual(S.players[0].hand.length, 2 + 8);
  assert.strictEqual(S.cur, 0);
  assert.strictEqual(S.phase, "play");
});

test("stacking: choosing to draw instead of countering", () => {
  const S = G.newGame(["a", "b"], 0, { stack: true, skipAfterDraw: true });
  S.cur = 0; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "d2", 901), card("r", "1", 950)];
  S.players[1].hand = [card("b", "d2", 902), card("y", "7", 953)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.pending, 2);
  G.act(S, 1, { t: "draw" });
  assert.strictEqual(S.players[1].hand.length, 4);
  assert.strictEqual(S.cur, 0, "skip-after-draw rule sends the turn on");
});

test("+2 on +4 is not allowed while a stack is open", () => {
  const S = G.newGame(["a", "b"], 0, { stack: true });
  S.cur = 0; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("w", "d4", 901), card("r", "1", 950), card("r", "2", 951)];
  S.players[1].hand = [card("r", "d2", 902), card("w", "d4", 903), card("r", "3", 952)];
  G.act(S, 0, { t: "play", id: 901, color: "r" });
  assert.strictEqual(G.act(S, 1, { t: "play", id: 902 }).ok, false);
});

test("a +2 as the winning card is still drawn before scoring", () => {
  const S = G.newGame(["a", "b"], 0, { stack: true });
  S.cur = 0; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "d2", 901)];
  S.players[1].hand = [card("r", "3", 952)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.players[1].hand.length, 3);
});

test("draw until it fits", () => {
  const S = G.newGame(["a", "b"], 0, { drawUntil: true });
  S.cur = 0; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.deck.push(card("b", "9", 960), card("g", "3", 961), card("r", "8", 962), card("y", "1", 963), card("b", "2", 964));
  const before = S.players[0].hand.length;
  const res = G.act(S, 0, { t: "draw" });
  assert.strictEqual(S.players[0].hand.length, before + 3, "yellow 1, blue 2 ... stop at red 8");
  assert.strictEqual(S.phase, "drawn");
  assert.strictEqual(S.drawnId, 962);
  assert.ok(res.events.some((e) => e.t === "drew" && e.n === 3));
});

test("7 swaps hands with a chosen player, 0 rotates all hands", () => {
  const S = G.newGame(["a", "b", "c"], 0, { sevenZero: true });
  S.cur = 0; S.dir = 1; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "7", 901), card("y", "1", 950), card("y", "2", 951)];
  S.players[1].hand = [card("b", "1", 960)];
  S.players[2].hand = [card("r", "0", 970), card("g", "4", 971), card("g", "5", 972), card("g", "6", 973)];
  assert.strictEqual(G.act(S, 0, { t: "play", id: 901 }).ok, false, "needs a target");
  G.act(S, 0, { t: "play", id: 901, target: 2 });
  assert.deepStrictEqual(S.players[0].hand.map((c) => c.id), [970, 971, 972, 973]);
  assert.deepStrictEqual(S.players[2].hand.map((c) => c.id), [950, 951]);
  assert.strictEqual(S.cur, 1);
  S.players[1].hand.push(card("r", "0", 961));
  G.act(S, 1, { t: "play", id: 961 });
  // hands move one seat in play direction: 0 -> 1, 1 -> 2, 2 -> 0
  assert.deepStrictEqual(S.players[1].hand.map((c) => c.id), [970, 971, 972, 973]);
  assert.deepStrictEqual(S.players[2].hand.map((c) => c.id), [960]);
  assert.deepStrictEqual(S.players[0].hand.map((c) => c.id), [950, 951]);
});

test("jump-in with the identical card takes over the turn", () => {
  const S = G.newGame(["a", "b", "c"], 0, { jumpIn: true });
  S.cur = 0; S.dir = 1; S.discard = [card("g", "4", 900)]; S.color = "g";
  S.players[2].hand = [card("g", "4", 901), card("g", "5", 902), card("r", "1", 903)];
  assert.strictEqual(G.act(S, 2, { t: "play", id: 902 }).ok, false, "only the identical card");
  const res = G.act(S, 2, { t: "play", id: 901 });
  assert.ok(res.ok);
  assert.ok(res.events.some((e) => e.t === "jump"));
  assert.strictEqual(S.cur, 0, "play continues after the jumper");
  const T = G.newGame(["a", "b", "c"], 0, {});
  T.cur = 0; T.discard = [card("g", "4", 900)]; T.color = "g";
  T.players[2].hand = [card("g", "4", 901), card("r", "1", 903)];
  assert.strictEqual(G.act(T, 2, { t: "play", id: 901 }).ok, false, "rule off");
});

test("giving up: skipped for the round, last one standing wins", () => {
  const S = G.newGame(["a", "b", "c"], 0, {});
  S.cur = 0; S.dir = 1; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "1", 950), card("y", "2", 951)];
  assert.ok(G.act(S, 1, { t: "surrender" }).ok, "any time, not only on your turn");
  assert.strictEqual(G.act(S, 1, { t: "draw" }).ok, false);
  G.act(S, 0, { t: "play", id: 950 });
  assert.strictEqual(S.cur, 2, "b is skipped");
  assert.strictEqual(G.view(S, 0).players[1].out, true);
  const res = G.act(S, 2, { t: "surrender" });
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.last.winner, 0);
  assert.ok(res.events.some((e) => e.t === "surrender"));
  G.act(S, 0, { t: "next" });
  assert.ok(S.players.every((p) => !p.out), "back in next round");
});

test("chaos mode doubles every action and wild card", () => {
  const d = G.buildDeck(true);
  assert.strictEqual(d.length, 140);
  const n = (v) => d.filter((c) => c.v === v).length;
  assert.deepStrictEqual([n("skip"), n("rev"), n("d2"), n("wild"), n("d4"), n("7")], [16, 16, 16, 8, 8, 8]);
  assert.strictEqual(new Set(d.map((c) => c.id)).size, 140);
  const S = G.newGame(["a", "b"], 0, { chaos: true });
  assert.strictEqual(total(S), 140);
  assert.strictEqual(G.view(S, 0).rules.chaos, true);
});

test("drawing an unplayable card ends the turn, a playable one can be played or kept", () => {
  const S = rig(3);
  S.cur = 0; S.discard = [card("b", "5", 900)]; S.color = "b";
  S.deck.push(card("r", "1", 950));
  G.act(S, 0, { t: "draw" });
  assert.strictEqual(S.cur, 1);

  S.deck.push(card("b", "9", 951));
  G.act(S, 1, { t: "draw" });
  assert.strictEqual(S.phase, "drawn");
  assert.strictEqual(S.drawnId, 951);
  const other = S.players[1].hand.find((c) => c.id !== 951 && G.canPlay(S, c));
  if (other) assert.strictEqual(G.act(S, 1, { t: "play", id: other.id }).ok, false);
  G.act(S, 1, { t: "keep" });
  assert.strictEqual(S.cur, 2);
});

test("round end scores the other hands and view hides foreign cards", () => {
  const S = rig(2);
  S.cur = 0; S.discard = [card("b", "5", 900)]; S.color = "b"; S.uno = true;
  S.players[0].hand = [card("b", "1", 901)];
  S.players[1].hand = [card("r", "7", 902), card("w", "wild", 903), card("g", "skip", 904)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.players[0].score, 77);
  const v = G.view(S, 1);
  assert.strictEqual(v.hand.length, 3);
  assert.deepStrictEqual(v.players.map((p) => p.count), [0, 3]);
  assert.ok(!("hand" in v.players[0]));
  G.act(S, 1, { t: "next" });
  assert.strictEqual(S.round, 2);
  assert.strictEqual(total(S), size(S));
});

test("random games stay consistent", () => {
  for (let g = 0; g < 300; g++) {
    const pick = () => Math.random() < 0.5;
    const S = G.newGame(["a", "b", "c", "d"].slice(0, 2 + (g % 3)), 0,
      { chaos: pick(), stack: pick(), skipAfterDraw: pick(), drawUntil: pick(), sevenZero: pick(), jumpIn: pick() });
    for (let step = 0; step < 2000 && S.phase !== "roundEnd"; step++) {
      const p = S.players[S.cur];
      for (const w of S.unoWaits) if (g % 3) G.act(S, w.pi, { t: "uno" });
      if (g % 3 === 0) G.tick(S, Date.now() + 10000);
      // somebody else may throw in first
      const j = S.players.findIndex((q, k) => k !== S.cur && q.hand.some((x) => G.canJumpIn(S, x)));
      if (j >= 0 && step % 2) {
        const x = S.players[j].hand.find((y) => G.canJumpIn(S, y));
        assert.ok(G.act(S, j, { t: "play", id: x.id, target: (j + 1) % S.players.length }).ok);
        assert.strictEqual(total(S), size(S));
        continue;
      }
      const c = p.hand.find((x) => (S.phase === "drawn" ? x.id === S.drawnId : true) && G.canPlay(S, x));
      if (c) assert.ok(G.act(S, S.cur, { t: "play", id: c.id, color: "r", target: (S.cur + 1) % S.players.length }).ok);
      else if (S.phase === "drawn") G.act(S, S.cur, { t: "keep" });
      else G.act(S, S.cur, { t: "draw" });
      assert.strictEqual(total(S), size(S));
    }
  }
});
