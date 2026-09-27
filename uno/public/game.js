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

  const isNum = (c) => /^\d$/.test(c.v);
  const cardName = (c) => (c.c === "w" ? VNAME[c.v] : `${CNAME[c.c]} ${VNAME[c.v] || c.v}`);
  const points = (c) => (isNum(c) ? +c.v : c.c === "w" ? 50 : 20);
  const top = (S) => S.discard[S.discard.length - 1];

  function canPlay(S, c) {
    if (c.c === "w") return true;
    return c.c === S.color || c.v === top(S).v;
  }

  function nextIdx(S, from, steps = 1) {
    const n = S.players.length;
    return (((from + S.dir * steps) % n) + n) % n;
  }

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

  function newGame(names, goal, opts) {
    const S = {
      players: names.map((name) => ({ name, hand: [], score: 0 })),
      deck: [], discard: [], cur: 0, dir: 1, color: "r",
      phase: "play", drawnId: null, unoWaits: [], chaos: !!(opts && opts.chaos),
      goal: goal || 0, round: 0, turn: 0,
      starter: Math.floor(Math.random() * names.length),
      log: [], last: null
    };
    startRound(S);
    return S;
  }

  function startRound(S) {
    S.round++;
    S.deck = buildDeck(S.chaos);
    S.unoWaits = [];
    S.discard = [];
    S.dir = 1;
    S.log = [];
    S.last = null;
    S.players.forEach((p) => { p.hand = []; });
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
    beginTurn(S, S.cur);
  }

  function beginTurn(S, pi) {
    S.cur = pi;
    S.phase = "play";
    S.drawnId = null;
    S.turn++;
  }

  function endRound(S, wi) {
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
  // Actions: {t:"play", id, color?} {t:"draw"} {t:"keep"} {t:"uno"} {t:"next"} {t:"skip"}
  function act(S, pi, a) {
    const fail = (error) => ({ ok: false, error });
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");
    if (!S.unoWaits) S.unoWaits = [];

    if (a.t === "uno") { // allowed any time during your own UNO window, even if it is not your turn
      const w = S.unoWaits.find((x) => x.pi === pi);
      if (!w || Date.now() > w.until + UNO_GRACE) return fail("Zu spät für UNO.");
      S.unoWaits = S.unoWaits.filter((x) => x !== w);
      log(S, `${S.players[pi].name} ruft UNO!`);
      return { ok: true, events: [{ t: "uno", pi }] };
    }
    const events = tick(S);

    if (a.t === "next") {
      if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
      if (S.last && S.last.over) { S.players.forEach((p) => { p.score = 0; }); S.round = 0; }
      startRound(S);
      return { ok: true, events };
    }
    if (a.t === "skip") { // host moves on when the current player is away
      if (S.phase !== "play" && S.phase !== "drawn") return fail("Gerade ist niemand dran.");
      log(S, `${S.players[S.cur].name} wird übersprungen.`);
      beginTurn(S, nextIdx(S, S.cur));
      return { ok: true, events };
    }

    if (S.phase !== "play" && S.phase !== "drawn") return { ok: false, error: "Gerade ist niemand dran.", events };
    if (pi !== S.cur) return { ok: false, error: `${S.players[S.cur].name} ist dran.`, events };
    const p = S.players[pi];

    if (a.t === "draw") {
      if (S.phase !== "play") return fail("Du hast schon gezogen.");
      const got = draw(S, pi, 1);
      if (!got.length) {
        log(S, `${p.name} kann nicht ziehen, der Stapel ist leer.`);
        beginTurn(S, nextIdx(S, pi));
        return { ok: true, events };
      }
      const c = got[0];
      if (canPlay(S, c)) {
        S.phase = "drawn";
        S.drawnId = c.id;
        log(S, `${p.name} zieht eine Karte.`);
      } else {
        log(S, `${p.name} zieht eine Karte und ist fertig.`);
        beginTurn(S, nextIdx(S, pi));
      }
      events.push({ t: "drew", pi, id: c.id });
      return { ok: true, events };
    }

    if (a.t === "keep") {
      if (S.phase !== "drawn") return fail("Du hast noch nicht gezogen.");
      log(S, `${p.name} behält die gezogene Karte.`);
      beginTurn(S, nextIdx(S, pi));
      return { ok: true, events };
    }

    if (a.t === "play") {
      const i = p.hand.findIndex((x) => x.id === a.id);
      if (i < 0) return fail("Diese Karte hast du nicht.");
      const c = p.hand[i];
      if (S.phase === "drawn" && c.id !== S.drawnId) return fail("Nach dem Ziehen darfst du nur die gezogene Karte legen.");
      if (!canPlay(S, c)) {
        const t = top(S);
        return fail(`Passt nicht. Gesucht: ${CNAME[S.color]} oder ${t.c === "w" ? "eine Farbwahl-Karte" : VNAME[t.v] || t.v}.`);
      }
      if (c.c === "w" && !COLORS.includes(a.color)) return fail("Bitte eine Farbe wählen.");

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

      if (p.hand.length === 1) {
        S.unoWaits.push({ pi, until: Date.now() + UNO_MS, id: S.turn });
        events.push({ t: "unoWait", pi });
      }

      const n = S.players.length;
      let steps = 1;
      if (c.v === "skip") { steps = 2; log(S, `${S.players[nextIdx(S, pi)].name} muss aussetzen.`); }
      if (c.v === "rev") {
        S.dir *= -1;
        if (n === 2) { steps = 2; log(S, `Richtungswechsel: ${S.players[nextIdx(S, pi)].name} setzt aus.`); }
        else log(S, "Die Spielrichtung dreht sich.");
      }
      if (c.v === "d2" || c.v === "d4") {
        const v = nextIdx(S, pi), k = c.v === "d2" ? 2 : 4;
        draw(S, v, k);
        steps = 2;
        log(S, `${S.players[v].name} zieht ${k} Karten und setzt aus.`);
      }

      if (p.hand.length === 0) { endRound(S, pi); return { ok: true, events }; }
      beginTurn(S, nextIdx(S, pi, steps));
      return { ok: true, events };
    }

    return fail("Unbekannte Aktion.");
  }

  // What player `pi` may see. pi = -1 shows no hand (spectator / hand-off screen).
  function view(S, pi) {
    const me = S.players[pi];
    return {
      players: S.players.map((p) => ({ name: p.name, count: p.hand.length, score: p.score })),
      me: pi,
      hand: me ? me.hand.slice() : [],
      top: top(S),
      discardCount: S.discard.length,
      color: S.color, dir: S.dir, cur: S.cur,
      next: nextIdx(S, S.cur),
      phase: S.phase, drawnId: pi === S.cur ? S.drawnId : null,
      unoWaits: (S.unoWaits || []).map((w) => ({ pi: w.pi, id: w.id, ms: Math.max(0, w.until - Date.now()) })),
      chaos: !!S.chaos,
      deckCount: S.deck.length,
      round: S.round, goal: S.goal, turn: S.turn,
      log: S.log.slice(-6), last: S.last
    };
  }

  return { COLORS, CNAME, VNAME, UNO_MS, newGame, startRound, act, tick, nextDeadline, view, canPlay, cardName, isNum, points, nextIdx, buildDeck };
});
