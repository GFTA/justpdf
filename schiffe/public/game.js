// Schiffe versenken engine. Pure state + rules, shared by the browser (one-phone mode)
// and the Node server (online mode). No DOM, no I/O.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SchiffeGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // board size -> fleet (ship lengths)
  const FLEETS = { 8: [4, 3, 2, 2], 10: [5, 4, 3, 3, 2], 12: [5, 4, 4, 3, 3, 2] };
  const SHIP = { 5: "Schlachtschiff", 4: "Kreuzer", 3: "Zerstörer", 2: "U-Boot" };
  const COLS = "ABCDEFGHIJKL";
  const MAX_PLAYERS = 4;
  const BOT_NAMES = ["Admiral Byte", "Käpt'n Blech", "Maat Robo", "Lotse Chip"];

  // Marks on a board, one character per cell. Everyone sees every board's marks.
  //   "." not shot   "o" miss   "~" certainly water (around a sunk ship)   "x" hit   "#" sunk
  const UNKNOWN = ".", MISS = "o", WATER = "~", HIT = "x", SUNK = "#";

  // House rules. Shared with the UI, which renders one switch per entry.
  const RULES = [
    { k: "again", def: true, name: "Treffer = nochmal", desc: "Wer trifft, darf gleich nochmal schießen. Aus: nach jedem Schuss ist der Nächste dran." },
    { k: "salvo", name: "Salve", desc: "Pro Zug so viele Schüsse, wie du noch Schiffe hast. Treffer bringen dann keinen Extraschuss." },
    { k: "touch", name: "Schiffe dürfen sich berühren", desc: "Aus: zwischen zwei Schiffen muss mindestens ein Feld Wasser sein, auch diagonal. Rund um versenkte Schiffe wird das Wasser dann automatisch aufgedeckt." },
    { k: "sonar", name: "Sonar", desc: "Einmal pro Runde statt eines Schusses: zeigt, wie viele Schiffsteile in einem 3×3-Feld liegen. Nur du siehst das Ergebnis." },
    { k: "teams", name: "Teams 2 gegen 2", desc: "Nur zu viert: Platz 1 und 3 gegen Platz 2 und 4. Ihr seht die Flotte eures Partners und gewinnt zusammen.", four: true }
  ];
  function normRules(r) {
    const o = {};
    for (const x of RULES) o[x.k] = r && typeof r[x.k] === "boolean" ? r[x.k] : !!x.def;
    return o;
  }
  const normSize = (n) => (FLEETS[+n] ? +n : 10);
  const normGoal = (n) => ([1, 2, 3].includes(+n) ? +n : 1);

  const cellName = (size, i) => COLS[i % size] + (Math.floor(i / size) + 1);
  const shipName = (len) => SHIP[len] || `${len}er`;
  const rand = (n) => Math.floor(Math.random() * n);

  function around(size, c, diag) {
    const r = Math.floor(c / size), k = c % size, out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      if (!diag && dr && dc) continue;
      const rr = r + dr, kk = k + dc;
      if (rr >= 0 && rr < size && kk >= 0 && kk < size) out.push(rr * size + kk);
    }
    return out;
  }

  // Cells of a ship whose bow sits at `head`, pushed back inside the board if it sticks out.
  function shipCells(size, head, len, horiz) {
    let r = Math.floor(head / size), c = head % size;
    if (horiz) c = Math.min(c, size - len); else r = Math.min(r, size - len);
    const out = [];
    for (let i = 0; i < len; i++) out.push(horiz ? r * size + c + i : (r + i) * size + c);
    return out;
  }

  // Geometry check for any number of ships (the UI uses it while placing). Returns an error or null.
  function placeError(size, touch, ships) {
    const occ = new Map();
    for (let k = 0; k < ships.length; k++) {
      const cells = ships[k];
      if (!Array.isArray(cells) || !cells.length) return "Ungültiges Schiff.";
      for (const c of cells) if (!Number.isInteger(c) || c < 0 || c >= size * size) return "Das Schiff ragt aus dem Feld.";
      const s = [...cells].sort((a, b) => a - b);
      const row = Math.floor(s[0] / size);
      const horiz = s.every((c, j) => c === s[0] + j && Math.floor(c / size) === row);
      const vert = s.every((c, j) => c === s[0] + j * size);
      if (!horiz && !vert) return "Schiffe müssen gerade liegen.";
      for (const c of s) {
        if (occ.has(c)) return "Da liegt schon ein Schiff.";
        occ.set(c, k);
      }
    }
    if (!touch) for (const [c, k] of occ) for (const n of around(size, c, true))
      if (occ.has(n) && occ.get(n) !== k) return "Schiffe dürfen sich nicht berühren, auch nicht über Eck.";
    return null;
  }

  function fleetError(size, touch, ships) {
    if (!Array.isArray(ships)) return "Ungültige Flotte.";
    const want = [...FLEETS[size]].sort((a, b) => b - a).join();
    const got = ships.map((s) => (Array.isArray(s) ? s.length : 0)).sort((a, b) => b - a).join();
    if (want !== got) return "Die Flotte ist nicht vollständig.";
    return placeError(size, touch, ships);
  }

  function randomFleet(size, touch) {
    const lens = FLEETS[size];
    for (;;) {
      const ships = [];
      let ok = true;
      for (const len of lens) {
        let placed = false;
        for (let tries = 0; tries < 300 && !placed; tries++) {
          const cells = shipCells(size, rand(size * size), len, Math.random() < 0.5);
          if (!placeError(size, touch, ships.concat([cells]))) { ships.push(cells); placed = true; }
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) return ships;
    }
  }

  function log(S, msg) {
    S.log.push(msg);
    if (S.log.length > 40) S.log.shift();
  }
  const setMark = (P, c, m) => { P.marks = P.marks.slice(0, c) + m + P.marks.slice(c + 1); };
  const shipsLeft = (P) => (P.fleet ? P.fleet.filter((s) => !s.sunk).length : 0);
  const foe = (S, a, b) => a !== b && (!S.teams || S.players[a].team !== S.players[b].team);
  const side = (S, i) => (S.teams ? S.players[i].team : i);

  // players: [{ name, bot }]; goal: wins needed (1-3); size: 8, 10 or 12
  function newGame(players, goal, size, rules) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p) => ({ name: p.name, bot: !!p.bot, wins: 0 })),
      size: normSize(size), goal: normGoal(goal), rules: normRules(rules),
      round: 0, turn: 0, starter: rand(players.length), log: [], last: null
    };
    startRound(S);
    return S;
  }

  function startRound(S) {
    S.round++;
    const n = S.players.length;
    S.teams = S.rules.teams && n === 4;
    S.players.forEach((p, i) => {
      Object.assign(p, { fleet: null, ready: false, out: false, sonar: false, shots: 0, hits: 0, team: S.teams ? i % 2 : i });
      p.marks = UNKNOWN.repeat(S.size * S.size);
    });
    S.phase = "place";
    S.cur = -1;
    S.shotsLeft = 0;
    S.sonars = [];
    S.lastShot = null;
    S.last = null;
    S.log = [];
    S.starter = S.starter % n;
    log(S, `Runde ${S.round}: Alle stellen ihre Flotte auf.`);
    for (const p of S.players) if (p.bot) placeFleet(S, p, randomFleet(S.size, S.rules.touch));
    maybeBegin(S, []);
  }

  function placeFleet(S, P, ships) {
    P.fleet = ships.map((cells) => ({ len: cells.length, cells: [...cells].sort((a, b) => a - b), sunk: false }));
    P.ready = true;
  }

  function maybeBegin(S, events) {
    if (S.phase !== "place" || !S.players.every((p) => p.ready)) return;
    S.phase = "play";
    S.turn = 0;
    const first = S.starter;
    S.starter = (S.starter + 1) % S.players.length;
    log(S, `Alle Flotten liegen bereit. ${S.players[first].name} schießt zuerst.`);
    events.push({ t: "begin" });
    beginTurn(S, first, events);
  }

  function beginTurn(S, pi, events) {
    S.cur = pi;
    S.turn++;
    S.shotsLeft = S.rules.salvo ? shipsLeft(S.players[pi]) : 1;
    events.push({ t: "turn", pi });
  }

  function nextTurn(S, events) {
    const n = S.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (S.cur + k) % n;
      if (!S.players[i].out) return beginTurn(S, i, events);
    }
  }

  // one side (a player, or a team) left: round over
  function checkEnd(S, events) {
    const alive = new Set(S.players.map((p, i) => (p.out ? null : side(S, i))).filter((x) => x !== null));
    if (alive.size > 1) return false;
    const w = [...alive][0];
    const winners = S.players.map((p, i) => i).filter((i) => side(S, i) === w);
    for (const i of winners) S.players[i].wins++;
    const over = winners.some((i) => S.players[i].wins >= S.goal);
    S.phase = "roundEnd";
    S.cur = -1;
    S.shotsLeft = 0;
    S.last = { winners, over };
    const names = winners.map((i) => S.players[i].name).join(" & ");
    log(S, over ? `${names} ${winners.length > 1 ? "gewinnen" : "gewinnt"} das Spiel!` : `${names} ${winners.length > 1 ? "gewinnen" : "gewinnt"} die Runde.`);
    events.push({ t: "end", winners });
    return true;
  }

  // after a shot: shoot again, or hand over
  function afterShot(S, events, hit) {
    if (S.rules.salvo) {
      S.shotsLeft--;
      if (S.shotsLeft > 0) return;
    } else if (hit && S.rules.again) return;
    nextTurn(S, events);
  }

  function knockOut(S, ti, events, by) {
    const T = S.players[ti];
    T.out = true;
    log(S, by == null ? `${T.name} gibt auf.` : `Die Flotte von ${T.name} ist komplett versenkt!`);
    events.push({ t: "out", pi: ti, by });
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }.
  // Actions: {t:"place", ships} {t:"unready"} {t:"shoot", target, cell} {t:"sonar", target, cell}
  //          {t:"giveup"} {t:"skip"} {t:"next"}
  function act(S, pi, a) {
    const events = [];
    const fail = (error) => ({ ok: false, error, events });
    const ok = () => ({ ok: true, events });
    const P = S.players[pi];
    if (!P) return fail("Unbekannter Spieler.");
    if (!a || typeof a.t !== "string") return fail("Unbekannte Aktion.");

    switch (a.t) {
      case "place": {
        if (S.phase !== "place") return fail("Die Flotten liegen schon bereit.");
        const err = fleetError(S.size, S.rules.touch, a.ships);
        if (err) return fail(err);
        placeFleet(S, P, a.ships);
        events.push({ t: "ready", pi });
        maybeBegin(S, events);
        return ok();
      }
      case "unready": {
        if (S.phase !== "place") return fail("Das Spiel läuft schon.");
        P.ready = false;
        return ok();
      }
      case "next": {
        if (S.phase !== "roundEnd") return fail("Die Runde läuft noch.");
        if (S.last && S.last.over) { S.players.forEach((p) => { p.wins = 0; }); S.round = 0; }
        startRound(S);
        return ok();
      }
      case "skip": { // host moves on when the current player is away
        if (S.phase !== "play") return fail("Gerade ist niemand dran.");
        log(S, `${S.players[S.cur].name} wird übersprungen.`);
        nextTurn(S, events);
        return ok();
      }
      case "giveup": {
        if (S.phase !== "play" || P.out) return fail("Aufgeben geht gerade nicht.");
        knockOut(S, pi, events, null);
        if (checkEnd(S, events)) return ok();
        if (S.cur === pi) nextTurn(S, events);
        return ok();
      }
      case "shoot":
      case "sonar": {
        if (S.phase !== "play") return fail("Gerade wird nicht geschossen.");
        if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);
        const ti = +a.target, T = S.players[ti], cell = +a.cell;
        if (!T || ti === pi || T.out) return fail("Auf diese Flotte kannst du nicht schießen.");
        if (!foe(S, pi, ti)) return fail("Das ist dein Teampartner!");
        if (!Number.isInteger(cell) || cell < 0 || cell >= S.size * S.size) return fail("Dieses Feld gibt es nicht.");
        const where = cellName(S.size, cell);

        if (a.t === "sonar") {
          if (!S.rules.sonar) return fail("Sonar ist in diesem Spiel aus.");
          if (P.sonar) return fail("Dein Sonar ist in dieser Runde schon verbraucht.");
          const area = [cell].concat(around(S.size, cell, true));
          const n = area.filter((c) => T.marks[c] === UNKNOWN && T.fleet.some((s) => s.cells.includes(c))).length;
          P.sonar = true;
          S.sonars.push({ by: pi, target: ti, cell, n, turn: S.turn });
          log(S, `${P.name} lauscht mit dem Sonar bei ${T.name} um ${where}.`);
          events.push({ t: "sonar", pi, target: ti, cell });
          afterShot(S, events, false);
          return ok();
        }

        const m = T.marks[cell];
        if (m === WATER) return fail("Da ist sicher Wasser, direkt neben einem versenkten Schiff.");
        if (m !== UNKNOWN) return fail("Da wurde schon hingeschossen.");
        const ship = T.fleet.find((s) => s.cells.includes(cell));
        P.shots++;
        let res = "miss";
        if (!ship) {
          setMark(T, cell, MISS);
          log(S, `${P.name} → ${T.name} ${where}: Wasser.`);
        } else {
          P.hits++;
          setMark(T, cell, HIT);
          res = "hit";
          if (ship.cells.every((c) => T.marks[c] === HIT)) {
            ship.sunk = true;
            res = "sunk";
            for (const c of ship.cells) setMark(T, c, SUNK);
            if (!S.rules.touch) for (const c of ship.cells) for (const n of around(S.size, c, true))
              if (T.marks[n] === UNKNOWN) setMark(T, n, WATER);
            log(S, `${P.name} → ${T.name} ${where}: ${shipName(ship.len)} versenkt!`);
          } else log(S, `${P.name} → ${T.name} ${where}: Treffer!`);
        }
        S.lastShot = { pi, target: ti, cell, res, turn: S.turn, n: P.shots };
        events.push({ t: "shot", pi, target: ti, cell, res, len: res === "sunk" ? ship.len : 0 });
        if (res === "sunk" && T.fleet.every((s) => s.sunk)) {
          knockOut(S, ti, events, pi);
          if (checkEnd(S, events)) return ok();
        }
        afterShot(S, events, res !== "miss");
        return ok();
      }
    }
    return fail("Unbekannte Aktion.");
  }

  // Where a computer player shoots. Only uses what everyone can see: marks and ship lengths.
  function botMove(S, pi) {
    const P = S.players[pi];
    if (!P) return null;
    if (S.phase === "place") return P.ready ? null : { t: "place", ships: randomFleet(S.size, S.rules.touch) };
    if (S.phase !== "play" || S.cur !== pi) return null;
    const foes = S.players.map((_, i) => i).filter((i) => !S.players[i].out && foe(S, pi, i));
    if (!foes.length) return null;
    const open = foes.filter((i) => S.players[i].marks.includes(HIT));
    let ti;
    if (open.length) ti = open[rand(open.length)];
    else { // go for whoever has the fewest ships left, with a bit of luck
      const min = Math.min(...foes.map((i) => shipsLeft(S.players[i])));
      const weak = foes.filter((i) => shipsLeft(S.players[i]) === min);
      ti = Math.random() < 0.6 ? weak[rand(weak.length)] : foes[rand(foes.length)];
    }
    return { t: "shoot", target: ti, cell: aim(S, S.players[ti]) };
  }

  function aim(S, T) {
    const size = S.size, m = T.marks, N = size * size;
    const at = (r, c) => (r >= 0 && r < size && c >= 0 && c < size ? m[r * size + c] : null);
    const pick = (a) => a[rand(a.length)];
    const hits = [];
    for (let c = 0; c < N; c++) if (m[c] === HIT) hits.push(c);
    if (hits.length) {
      // a line of hits: extend it at either end
      const line = [];
      for (const h of hits) {
        const r = Math.floor(h / size), c = h % size;
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          if (at(r + dr, c + dc) !== HIT && at(r - dr, c - dc) !== HIT) continue;
          for (const s of [1, -1]) {
            let k = 1;
            while (at(r + s * dr * k, c + s * dc * k) === HIT) k++;
            if (at(r + s * dr * k, c + s * dc * k) === UNKNOWN) line.push((r + s * dr * k) * size + c + s * dc * k);
          }
        }
      }
      if (line.length) return pick(line);
      const next = [];
      for (const h of hits) for (const n of around(size, h, false)) if (m[n] === UNKNOWN) next.push(n);
      if (next.length) return pick(next);
    }
    // hunt: count how many of the remaining ships could cover each cell, shoot at a likely one
    const lens = T.fleet.filter((s) => !s.sunk).map((s) => s.len);
    const heat = new Array(N).fill(0);
    for (const len of lens) for (let c = 0; c < N; c++) for (const horiz of [true, false]) {
      const r = Math.floor(c / size), k = c % size;
      if (horiz ? k + len > size : r + len > size) continue;
      const cells = shipCells(size, c, len, horiz);
      if (cells.every((x) => m[x] === UNKNOWN)) for (const x of cells) heat[x]++;
    }
    const free = [];
    for (let c = 0; c < N; c++) if (m[c] === UNKNOWN) free.push(c);
    if (!free.length) return 0;
    if (Math.random() < 0.15) return pick(free); // not a perfect machine
    const best = Math.max(...free.map((c) => heat[c]));
    return pick(free.filter((c) => heat[c] >= best * 0.9));
  }

  // What player `pi` may see. pi = -1 shows no fleet (spectator / hand-off screen).
  function view(S, pi) {
    const P = S.players[pi], me = P ? pi : -1, reveal = S.phase === "roundEnd";
    return {
      me, phase: S.phase, cur: S.cur, turn: S.turn, round: S.round, goal: S.goal, size: S.size,
      fleet: FLEETS[S.size], rules: S.rules, teams: !!S.teams, shotsLeft: S.shotsLeft,
      players: S.players.map((p, i) => {
        const see = i === me || reveal || (S.teams && P && p.team === P.team);
        return {
          name: p.name, bot: p.bot, wins: p.wins, team: p.team, out: p.out, ready: p.ready, sonar: p.sonar,
          shots: p.shots, hits: p.hits, marks: p.marks,
          left: p.fleet ? p.fleet.filter((s) => !s.sunk).map((s) => s.len) : FLEETS[S.size].slice(),
          ships: see && p.fleet ? p.fleet.map((s) => s.cells.slice()) : null
        };
      }),
      sonars: S.sonars.filter((s) => s.by === me),
      lastShot: S.lastShot, log: S.log.slice(-6), last: S.last
    };
  }

  return {
    FLEETS, SHIP, COLS, MAX_PLAYERS, BOT_NAMES, RULES, normRules, normSize, normGoal, cellName, shipName,
    around, shipCells, placeError, fleetError, randomFleet, newGame, startRound, act, botMove, view
  };
});
