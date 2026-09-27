"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../public/game.js");

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

test("forgetting UNO costs two cards, calling it does not", () => {
  const S = rig(2);
  S.cur = 0; S.discard = [card("b", "5", 900)]; S.color = "b";
  S.players[0].hand = [card("b", "1", 901), card("r", "2", 902)];
  G.act(S, 0, { t: "play", id: 901 });
  assert.strictEqual(S.players[0].hand.length, 3);

  S.cur = 1; S.discard.push(card("b", "3", 903)); S.color = "b"; S.phase = "play";
  S.players[1].hand = [card("b", "1", 904), card("r", "2", 905)];
  assert.strictEqual(G.act(S, 1, { t: "uno" }).ok, true);
  G.act(S, 1, { t: "play", id: 904 });
  assert.strictEqual(S.players[1].hand.length, 1);
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
  assert.strictEqual(total(S), 108);
});

test("random games stay consistent", () => {
  for (let g = 0; g < 200; g++) {
    const S = G.newGame(["a", "b", "c", "d"].slice(0, 2 + (g % 3)), 0);
    for (let step = 0; step < 2000 && S.phase !== "roundEnd"; step++) {
      const p = S.players[S.cur];
      if (p.hand.length === 2) G.act(S, S.cur, { t: "uno" });
      const c = p.hand.find((x) => (S.phase === "drawn" ? x.id === S.drawnId : true) && G.canPlay(S, x));
      if (c) assert.ok(G.act(S, S.cur, { t: "play", id: c.id, color: "r" }).ok);
      else if (S.phase === "drawn") G.act(S, S.cur, { t: "keep" });
      else G.act(S, S.cur, { t: "draw" });
      assert.strictEqual(total(S), 108);
    }
  }
});
