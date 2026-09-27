// Pass-Uno game engine. Pure state + rules, shared by the browser (local mode)
// and the Node server (online mode). No DOM, no I/O.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.UnoGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const COLORS = ["r", "y", "g", "b"];
  const CNAME = { r: "Rot", y: "Gelb", g: "Grün", b: "Blau" };
  const VNAME = { skip: "Aussetzen", rev: "Richtungswechsel", d2: "+2", wild: "Farbwahl", d4: "+4 Farbwahl" };
  const UNO_MS = 3000;   // time to hit UNO after playing the second-to-last card
  const UNO_GRACE = 700; // extra slack for slow phones and networks

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Standard deck: 108 cards. Chaos mode doubles every action and wild card: 140.
  function buildDeck(chaos) {
    const d = [];
    const k = chaos ? 2 : 1;
    let id = 0;
    for (const c of COLORS) {
      d.push({ id: id++, c, v: "0" });
      for (const v of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
        d.push({ id: id++, c, v });
        d.push({ id: id++, c, v });
      }
      for (const v of ["skip", "rev", "d2"]) for (let i = 0; i < 2 * k; i++) d.push({ id: id++, c, v });
    }
    for (let i = 0; i < 4 * k; i++) {
      d.push({ id: id++, c: "w", v: "wild" });
      d.push({ id: id++, c: "w", v: "d4" });
    }
    return shuffle(d);
  }

  // House rules. Shared with the UI, which renders one switch per entry.
  const RULES = [
    { k: "stack", name: "+2 und +4 stapeln", desc: "Auf eine +2 darfst du eine +2 oder +4 legen, auf eine +4 nur eine +4. Wer nicht kontern kann, zieht alles." },
    { k: "skipAfterDraw", name: "Nach +2/+4 aussetzen", desc: "Wer Strafkarten zieht, ist danach nicht dran. Aus: nach dem Ziehen ganz normal weiterspielen." },
    { k: "drawUntil", name: "Ziehen, bis es passt", desc: "Wer vom Stapel zieht, zieht so lange, bis eine passende Karte kommt." },
    { k: "sevenZero", name: "7 tauscht, 0 dreht", desc: "Mit einer 7 tauschst du deine Hand mit jemandem. Bei einer 0 geben alle ihre Hand in Spielrichtung weiter." },
    { k: "jumpIn", name: "Reinwerfen", desc: "Wer genau dieselbe Karte hat (Farbe und Wert), darf sie sofort legen, auch wenn er nicht dran ist.", onlineOnly: true },
    { k: "chaos", name: "Chaos-Modus", desc: "Alle Sonderkarten doppelt im Stapel (140 statt 108 Karten)." },
    { k: "turnTimer", name: "Zugzeit 30 Sekunden", desc: "Wer zu lange überlegt, zieht automatisch eine Karte und ist fertig.", onlineOnly: true }
  ];
  const TURN_MS = 30000;
  function normRules(r) {
    const o = {};
    for (const x of RULES) o[x.k] = !!(r && r[x.k]);
    return o;
  }
  // games saved before house rules existed kept chaos/stack flags and always skipped after drawing
  const rulesOf = (S) => S.rules || (S.rules = normRules({ chaos: S.chaos, stack: S.stack, skipAfterDraw: true }));

  const isNum = (c) => /^\d$/.test(c.v);
  const cardName = (c) => (c.c === "w" ? VNAME[c.v] : `${CNAME[c.c]} ${VNAME[c.v] || c.v}`);
  const points = (c) => (isNum(c) ? +c.v : c.c === "w" ? 50 : 20);
  const top = (S) => S.discard[S.discard.length - 1];

  // while +2/+4 cards are pending, only a +2 or +4 on a +2, or a +4 on a +4, can be added
  function stackable(S, c) {
    if (!S.pending) return true;
    return top(S).v === "d2" ? c.v === "d2" || c.v === "d4" : c.v === "d4";
  }

  function canPlay(S, c) {
    if (!stackable(S, c)) return false;
    if (c.c === "w") return true;
    return c.c === S.color || c.v === top(S).v;
  }

  // same colour and value as the top card: may be thrown in out of turn with the jump-in rule
  function canJumpIn(S, c) {
    const t = top(S);
    return rulesOf(S).jumpIn && !S.pending && c.c !== "w" && c.c === t.c && c.v === t.v;
  }

  // next seat in play direction, skipping players who gave up this round
  function nextIdx(S, from, steps = 1) {
    const n = S.players.length;
    let i = from;
    for (let s = 0; s < steps; s++) {
      for (let k = 0; k < n; k++) {
        i = (((i + S.dir) % n) + n) % n;
        if (!S.players[i].out || i === from) break;
      }
    }
    return i;
  }
  const activeCount = (S) => S.players.filter((p) => !p.out).length;

  function draw(S, pi, n) {
    const got = [];
    for (let i = 0; i < n; i++) {
      if (!S.deck.length && S.discard.length > 1) {
        const keep = S.discard.pop();
        S.deck = shuffle(S.discard);
        S.discard = [keep];
      }
      if (!S.deck.length) break;
      const c = S.deck.pop();
      S.players[pi].hand.push(c);
      got.push(c);
    }
    return got;
  }

  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 40) S.log.shift();
  }

  function newGame(names, goal, rules) {
    const S = {
      players: names.map((name) => ({ name, hand: [], score: 0 })),
      deck: [], discard: [], cur: 0, dir: 1, color: "r",
      phase: "play", drawnId: null, unoWaits: [], pending: 0, rules: normRules(rules),
      goal: goal || 0, round: 0, turn: 0,
      starter: Math.floor(Math.random() * names.length),
      log: [], last: null
    };
    startRound(S);
    return S;
  }

  function startRound(S) {
    S.round++;
    S.deck = buildDeck(rulesOf(S).chaos);
    S.unoWaits = [];
    S.pending = 0;
    S.discard = [];
    S.dir = 1;
    S.log = [];
    S.last = null;
    S.players.forEach((p) => { p.hand = []; p.out = false; });
    for (let k = 0; k < 7; k++) S.players.forEach((_, i) => draw(S, i, 1));
    let c = S.deck.pop();
    while (!isNum(c)) {
      S.deck.splice(Math.floor(Math.random() * S.deck.length), 0, c);
      c = S.deck.pop();
    }
    S.discard.push(c);
    S.color = c.c;
    S.cur = S.starter % S.players.length;
    S.starter = (S.starter + 1) % S.players.length;
    log(S, `Runde ${S.round}: Die erste Karte ist ${cardName(c)}. ${S.players[S.cur].name} beginnt.`);
    beginTurn(S, S.cur, []);
  }

  // Start player pi's turn. Pending +2/+4 cards are drawn right away unless the
  // player can stack on them.
  function beginTurn(S, pi, events) {
    S.cur = pi;
    S.phase = "play";
    S.drawnId = null;
    S.turn++;
    if (!S.pending) return;
    const p = S.players[pi];
    if (rulesOf(S).stack && p.hand.some((c) => stackable(S, c))) {
      log(S, `${p.name} muss ${S.pending} Karten ziehen oder stapeln.`);
      return;
    }
    takePending(S, pi, events);
  }

  function takePending(S, pi, events) {
    const n = S.pending, p = S.players[pi];
    S.pending = 0;
    draw(S, pi, n);
    events.push({ t: "took", pi, n });
    if (rulesOf(S).skipAfterDraw) {
      log(S, `${p.name} zieht ${n} Karten und setzt aus.`);
      beginTurn(S, nextIdx(S, pi), events);
    } else {
      log(S, `${p.name} zieht ${n} Karten und ist jetzt dran.`);
    }
  }

  function endRound(S, wi) {
    if (S.pending) { // a +2/+4 as the last card still has to be drawn
      const v = nextIdx(S, wi);
      draw(S, v, S.pending);
      log(S, `${S.players[v].name} zieht noch ${S.pending} Karten.`);
      S.pending = 0;
    }
    let pts = 0;
    S.players.forEach((p, i) => { if (i !== wi) p.hand.forEach((c) => { pts += points(c); }); });
    S.players[wi].score += pts;
    const over = S.goal > 0 ? S.players[wi].score >= S.goal : true;
    S.last = { winner: wi, pts, over };
    S.phase = "roundEnd";
    S.unoWaits = [];
    log(S, over ? `${S.players[wi].name} gewinnt das Spiel!` : `${S.players[wi].name} gewinnt die Runde (+${pts}).`);
  }

  function unoPenalty(S, pi, events) {
    if (S.players[pi].hand.length !== 1) return; // hand changed meanwhile, nothing left to call
    draw(S, pi, 2);
    log(S, `${S.players[pi].name} hat nicht rechtzeitig „UNO!“ gerufen und zieht 2 Strafkarten.`);
    events.push({ t: "penalty", pi });
  }

  // Resolve UNO windows that ran out. Returns events; call it on a timer and before actions.
  function tick(S, now) {
    now = now || Date.now();
    const events = [];
    if (!S.unoWaits || !S.unoWaits.length) return events;
    if (S.phase === "roundEnd") { S.unoWaits = []; return events; }
    S.unoWaits = S.unoWaits.filter((w) => {
      if (now <= w.until + UNO_GRACE) return true;
      unoPenalty(S, w.pi, events);
      return false;
    });
    return events;
  }

  // Milliseconds until the next UNO window closes on the server side, or -1.
  function nextDeadline(S, now) {
    if (!S.unoWaits || !S.unoWaits.length) return -1;
    now = now || Date.now();
    return Math.max(0, Math.min(...S.unoWaits.map((w) => w.until + UNO_GRACE)) - now);
  }

  // Apply an action by player `pi`. Returns { ok, error?, events? }.
  // Actions: {t:"play", id, color?, target?} {t:"draw"} {t:"keep"} {t:"uno"} {t:"next"} {t:"skip"}
  function act(S, pi, a) {
    const fail = (error) => ({ ok: false, error, events });
    let events = [];
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");
    if (!S.unoWaits) S.unoWaits = [];
    const R = rulesOf(S);

    if (a.t === "uno") { // allowed any time during your own UNO window, even if it is not your turn
      const w = S.unoWaits.find((x) => x.pi === pi);
      if (!w || Date.now() > w.until + UNO_GRACE) return fail("Zu spät für UNO.");
      S.unoWaits = S.unoWaits.filter((x) => x !== w);
      log(S, `${S.players[pi].name} ruft UNO!`);
      return { ok: true, events: [{ t: "uno", pi }] };
    }
    events = tick(S);

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.score = 0; }); S.round = 0; }
      startRound(S);
      return { ok: true, events };
    }
    if (a.t === "skip") { // host moves on when the current player is away
      if (S.phase !== "play" && S.phase !== "drawn") return fail("Gerade ist niemand dran.");
      log(S, `${S.players[S.cur].name} wird übersprungen.`);
      if (S.pending) { draw(S, S.cur, S.pending); S.pending = 0; }
      beginTurn(S, nextIdx(S, S.cur), events);
      return { ok: true, events };
    }

    if (a.t === "surrender") { // give up this round; the cards stay and count for the winner
      const q = S.players[pi];
      if (!q || q.out || S.phase === "roundEnd") return fail("Das geht gerade nicht.");
      q.out = true;
      S.unoWaits = S.unoWaits.filter((w) => w.pi !== pi);
      log(S, `${q.name} gibt diese Runde auf.`);
      events.push({ t: "surrender", pi });
      if (activeCount(S) === 1) { S.pending = 0; endRound(S, S.players.findIndex((x) => !x.out)); return { ok: true, events }; }
      if (S.cur === pi) beginTurn(S, nextIdx(S, pi), events);
      return { ok: true, events };
    }

    if (S.phase !== "play" && S.phase !== "drawn") return fail("Gerade ist niemand dran.");
    const p = S.players[pi];
    if (!p) return fail("Unbekannter Spieler.");
    if (p.out) return fail("Du hast diese Runde aufgegeben.");

    if (a.t === "timeout") { // the server's turn clock ran out
      if (pi !== S.cur) return fail("Nicht dran.");
      log(S, `${p.name}: Zeit abgelaufen.`);
      events.push({ t: "timeout", pi });
      if (S.pending) { takePending(S, pi, events); if (S.cur !== pi) return { ok: true, events }; }
      else if (S.phase === "play") { const got = draw(S, pi, 1); if (got.length) events.push({ t: "drew", pi, id: got[0].id, n: 1 }); }
      beginTurn(S, nextIdx(S, pi), events);
      return { ok: true, events };
    }

    if (pi !== S.cur) {
      const c = a.t === "play" && p.hand.find((x) => x.id === a.id);
      if (!c || !canJumpIn(S, c)) return fail(`${S.players[S.cur].name} ist dran.`);
      log(S, `${p.name} wirft rein!`);
      events.push({ t: "jump", pi });
      S.cur = pi; S.phase = "play"; S.drawnId = null; S.turn++;
    }

    if (a.t === "draw") {
      if (S.phase !== "play") return fail("Du hast schon gezogen.");
      if (S.pending) { takePending(S, pi, events); return { ok: true, events }; }
      let last = null, n = 0;
      for (;;) {
        const got = draw(S, pi, 1);
        if (!got.length) break;
        n++; last = got[0];
        if (!R.drawUntil || canPlay(S, last)) break;
      }
      if (!last) {
        log(S, `${p.name} kann nicht ziehen, der Stapel ist leer.`);
        beginTurn(S, nextIdx(S, pi), events);
        return { ok: true, events };
      }
      const what = n === 1 ? "eine Karte" : `${n} Karten`;
      if (canPlay(S, last)) {
        S.phase = "drawn";
        S.drawnId = last.id;
        log(S, `${p.name} zieht ${what}.`);
      } else {
        log(S, `${p.name} zieht ${what} und ist fertig.`);
        beginTurn(S, nextIdx(S, pi), events);
      }
      events.push({ t: "drew", pi, id: last.id, n });
      return { ok: true, events };
    }

    if (a.t === "keep") {
      if (S.phase !== "drawn") return fail("Du hast noch nicht gezogen.");
      log(S, `${p.name} behält die gezogene Karte.`);
      beginTurn(S, nextIdx(S, pi), events);
      return { ok: true, events };
    }

    if (a.t === "play") {
      const i = p.hand.findIndex((x) => x.id === a.id);
      if (i < 0) return fail("Diese Karte hast du nicht.");
      const c = p.hand[i];
      if (S.phase === "drawn" && c.id !== S.drawnId) return fail("Nach dem Ziehen darfst du nur die gezogene Karte legen.");
      if (!canPlay(S, c)) {
        const t = top(S);
        if (S.pending) return fail(`Leg eine ${t.v === "d2" ? "+2 oder +4" : "+4"} drauf oder zieh ${S.pending} Karten.`);
        return fail(`Passt nicht. Gesucht: ${CNAME[S.color]} oder ${t.c === "w" ? "eine Farbwahl-Karte" : VNAME[t.v] || t.v}.`);
      }
      if (c.c === "w" && !COLORS.includes(a.color)) return fail("Bitte eine Farbe wählen.");
      const swap = R.sevenZero && c.v === "7" && p.hand.length > 1;
      if (swap && !(Number.isInteger(a.target) && a.target !== pi && S.players[a.target] && !S.players[a.target].out)) return fail("Wähle, mit wem du die Hand tauschst.");

      // still waiting for your own UNO from earlier: you did not call it in time
      if (S.unoWaits.some((w) => w.pi === pi)) {
        S.unoWaits = S.unoWaits.filter((w) => w.pi !== pi);
        unoPenalty(S, pi, events);
      }

      p.hand.splice(i, 1);
      S.discard.push(c);
      S.color = c.c === "w" ? a.color : c.c;
      log(S, `${p.name} legt ${cardName(c)}${c.c === "w" ? ` und wünscht sich ${CNAME[a.color]}` : ""}.`);
      events.push({ t: "played", pi, id: c.id });

      if (p.hand.length && swap) {
        const o = S.players[a.target];
        [p.hand, o.hand] = [o.hand, p.hand];
        log(S, `${p.name} tauscht die Hand mit ${o.name}.`);
        events.push({ t: "swap", pi, with: a.target });
      }
      if (p.hand.length && R.sevenZero && c.v === "0") {
        const hands = S.players.map((x) => x.hand);
        S.players.forEach((x, k) => { if (!x.out) S.players[nextIdx(S, k)].hand = hands[k]; });
        log(S, "Alle geben ihre Hand in Spielrichtung weiter.");
        events.push({ t: "rotate" });
      }

      if (p.hand.length === 1) {
        S.unoWaits.push({ pi, until: Date.now() + UNO_MS, id: S.turn });
        events.push({ t: "unoWait", pi });
      }

      const n = activeCount(S);
      let steps = 1;
      if (c.v === "skip") { steps = 2; log(S, `${S.players[nextIdx(S, pi)].name} muss aussetzen.`); }
      if (c.v === "rev") {
        S.dir *= -1;
        if (n === 2) { steps = 2; log(S, `Richtungswechsel: ${S.players[nextIdx(S, pi)].name} setzt aus.`); }
        else log(S, "Die Spielrichtung dreht sich.");
      }
      if (c.v === "d2" || c.v === "d4") S.pending = (S.pending || 0) + (c.v === "d2" ? 2 : 4);

      if (p.hand.length === 0) { endRound(S, pi); return { ok: true, events }; }
      beginTurn(S, nextIdx(S, pi, steps), events);
      return { ok: true, events };
    }

    return fail("Unbekannte Aktion.");
  }

  // The computer player, also used for the hint button. Works on a view, so it only
  // knows what that player could see.
  function suggest(v) {
    if (!v || !v.hand) return null;
    if ((v.unoWaits || []).some((w) => w.pi === v.me)) return { t: "uno" };
    if ((v.phase !== "play" && v.phase !== "drawn") || v.cur !== v.me) return null;
    const stackOk = (c) => !v.pending || (v.top.v === "d2" ? c.v === "d2" || c.v === "d4" : c.v === "d4");
    const fits = (c) => stackOk(c) && (c.c === "w" || c.c === v.color || c.v === v.top.v);
    let options = v.hand.filter(fits);
    if (v.phase === "drawn") options = options.filter((c) => c.id === v.drawnId);
    if (!options.length) return { t: v.phase === "drawn" ? "keep" : "draw" };
    const count = {};
    for (const c of v.hand) if (c.c !== "w") count[c.c] = (count[c.c] || 0) + 1;
    const nextCount = v.players[v.next] ? v.players[v.next].count : 7;
    const danger = nextCount <= 2;
    const score = (c) => {
      if (c.v === "d4") return danger || v.pending ? 40 : -12;
      if (c.v === "wild") return danger ? 20 : -8;
      let s = 10 + (count[c.c] || 0) * 2;
      if (c.v === "skip" || c.v === "rev" || c.v === "d2") s += nextCount <= 3 ? 24 : 5;
      if (isNum(c)) s += +c.v * 0.4; // get rid of expensive cards first
      return s;
    };
    const best = options.slice().sort((a, b) => score(b) - score(a))[0];
    const a = { t: "play", id: best.id };
    if (best.c === "w") {
      const left = v.hand.filter((c) => c.id !== best.id && c.c !== "w");
      const tally = {};
      for (const c of left) tally[c.c] = (tally[c.c] || 0) + 1;
      a.color = COLORS.slice().sort((x, y) => (tally[y] || 0) - (tally[x] || 0))[0];
    }
    if (best.v === "7" && v.rules && v.rules.sevenZero && v.hand.length > 1) {
      let target = -1;
      v.players.forEach((p, i) => { if (i !== v.me && !p.out && (target < 0 || p.count < v.players[target].count)) target = i; });
      a.target = target;
    }
    return a;
  }

  // What player `pi` may see. pi = -1 shows no hand (spectator / hand-off screen).
  function view(S, pi) {
    const me = S.players[pi];
    return {
      players: S.players.map((p) => ({ name: p.name, count: p.hand.length, score: p.score, out: !!p.out, bot: !!p.bot })),
      me: pi,
      hand: me ? me.hand.slice() : [],
      top: top(S),
      discardCount: S.discard.length,
      color: S.color, dir: S.dir, cur: S.cur,
      next: nextIdx(S, S.cur),
      phase: S.phase, drawnId: pi === S.cur ? S.drawnId : null,
      unoWaits: (S.unoWaits || []).map((w) => ({ pi: w.pi, id: w.id, ms: Math.max(0, w.until - Date.now()) })),
      rules: rulesOf(S), chaos: rulesOf(S).chaos, pending: S.pending || 0,
      deckCount: S.deck.length,
      round: S.round, goal: S.goal, turn: S.turn,
      log: S.log.slice(-6), last: S.last
    };
  }

  return { COLORS, CNAME, VNAME, UNO_MS, TURN_MS, suggest, RULES, normRules, canJumpIn, newGame, startRound, act, tick, nextDeadline, view, canPlay, cardName, isNum, points, nextIdx, buildDeck };
});
