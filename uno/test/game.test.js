"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

const size = (S) => (S.chaos ? 140 : 108);
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

test("skip, reverse, +2 and +4 effects", () => {
  const S = rig(4);
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

test("stacking passes +2 and +4 on until someone draws", () => {
  const S = G.newGame(["a", "b", "c"], 0, { stack: true });
  S.cur = 0; S.dir = 1; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "d2", 901), card("r", "1", 950), card("r", "2", 951)];
  S.players[1].hand = [card("b", "d2", 902), card("g", "d2", 952), card("y", "7", 953)];
  S.players[2].hand = [card("w", "d4", 903), card("b", "d2", 954), card("y", "8", 955)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.cur, 1, "no skip yet");
  assert.strictEqual(S.pending, 2);
  assert.strictEqual(S.players[1].hand.length, 3, "nothing drawn yet");
  assert.strictEqual(G.act(S, 1, { t: "play", id: 953 }).ok, false, "only +2/+4 while stacking");
  G.act(S, 1, { t: "play", id: 902 });
  assert.strictEqual(S.pending, 4);
  G.act(S, 2, { t: "play", id: 903, color: "g" });
  assert.strictEqual(S.pending, 8);
  assert.strictEqual(S.cur, 0);
  assert.strictEqual(G.act(S, 0, { t: "play", id: 950 }).ok, false);
  G.act(S, 0, { t: "draw" });
  assert.strictEqual(S.players[0].hand.length, 2 + 8);
  assert.strictEqual(S.pending, 0);
  assert.strictEqual(S.cur, 1, "the drawer is skipped");
  assert.strictEqual(G.act(S, 1, { t: "play", id: 952 }).ok, true, "+2 on +4 is fine again once the stack is gone (colour green)");
});

test("+2 on +4 is not allowed while a stack is open", () => {
  const S = G.newGame(["a", "b"], 0, { stack: true });
  S.cur = 0; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("w", "d4", 901), card("r", "1", 950), card("r", "2", 951)];
  S.players[1].hand = [card("r", "d2", 902), card("r", "3", 952)];
  G.act(S, 0, { t: "play", id: 901, color: "r" });
  assert.strictEqual(G.act(S, 1, { t: "play", id: 902 }).ok, false);
});

test("a stacked +2 as the winning card is still drawn before scoring", () => {
  const S = G.newGame(["a", "b"], 0, { stack: true });
  S.cur = 0; S.discard = [card("r", "5", 900)]; S.color = "r";
  S.players[0].hand = [card("r", "d2", 901)];
  S.players[1].hand = [card("r", "3", 952)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.phase, "roundEnd");
  assert.strictEqual(S.players[1].hand.length, 3);
});

test("chaos mode doubles every action and wild card", () => {
  const d = G.buildDeck(true);
  assert.strictEqual(d.length, 140);
  const n = (v) => d.filter((c) => c.v === v).length;
  assert.deepStrictEqual([n("skip"), n("rev"), n("d2"), n("wild"), n("d4"), n("7")], [16, 16, 16, 8, 8, 8]);
  assert.strictEqual(new Set(d.map((c) => c.id)).size, 140);
  const S = G.newGame(["a", "b"], 0, { chaos: true });
  assert.strictEqual(total(S), 140);
  assert.strictEqual(G.view(S, 0).chaos, true);
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
    const S = G.newGame(["a", "b", "c", "d"].slice(0, 2 + (g % 3)), 0, { chaos: g % 2 === 1, stack: g % 4 < 2 });
    for (let step = 0; step < 2000 && S.phase !== "roundEnd"; step++) {
      const p = S.players[S.cur];
      for (const w of S.unoWaits) if (g % 3) G.act(S, w.pi, { t: "uno" });
      if (g % 3 === 0) G.tick(S, Date.now() + 10000);
      const c = p.hand.find((x) => (S.phase === "drawn" ? x.id === S.drawnId : true) && G.canPlay(S, x));
      if (c) assert.ok(G.act(S, S.cur, { t: "play", id: c.id, color: "r" }).ok);
      else if (S.phase === "drawn") G.act(S, S.cur, { t: "keep" });
      else G.act(S, S.cur, { t: "draw" });
      assert.strictEqual(total(S), size(S));
    }
  }
});
