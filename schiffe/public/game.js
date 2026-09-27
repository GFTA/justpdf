// Schiffe versenken engine. Pure state + rules, shared by the browser (one-phone mode)
// and the Node server (online mode). No DOM, no I/O.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SchiffeGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Ship shapes. "line" is 1 wide, "wide" is 2 wide, "diag" runs diagonally.
  const SHAPES = {
    L2: { kind: "line", len: 2, name: "U-Boot" },
    L3: { kind: "line", len: 3, name: "Zerstörer" },
    L4: { kind: "line", len: 4, name: "Kreuzer" },
    L5: { kind: "line", len: 5, name: "Schlachtschiff" },
    W2: { kind: "wide", len: 2, name: "Bohrinsel" },
    W3: { kind: "wide", len: 3, name: "Frachter" },
    W4: { kind: "wide", len: 4, name: "Flugzeugträger" },
    D3: { kind: "diag", len: 3, name: "Schnellboot" },
    D4: { kind: "diag", len: 4, name: "Korvette" }
  };
  // board size -> fleet
  const FLEETS = {
    5: ["L3", "L2", "L2"],
    8: ["L4", "L3", "L2", "L2"],
    10: ["L5", "L4", "L3", "L3", "L2"],
    12: ["L5", "L4", "L4", "L3", "L3", "L2"],
    14: ["W3", "L5", "L4", "D3", "L3", "L2", "L2"],
    16: ["W4", "L5", "W2", "L4", "D4", "D3", "L3", "L2"]
  };
  const COLS = "ABCDEFGHIJKLMNOP";
  const MAX_PLAYERS = 4;
  const BOT_NAMES = ["Admiral Byte", "Käpt'n Blech", "Maat Robo", "Lotse Chip"];
  const LEVELS = { 1: "Leicht", 2: "Normal", 3: "Profi" };
  const SWIFT_MS = 8000, CLOCK_MS = 15000, GRACE = 600;

  // Marks on a board, one character per cell. Everyone sees every board's marks.
  //   "." not shot   "o" miss   "~" certainly water (around a sunk ship)   "x" hit   "#" sunk
  const UNKNOWN = ".", MISS = "o", WATER = "~", HIT = "x", SUNK = "#";

  // House rules. Shared with the UI, which renders one switch per entry.
  const RULES = [
    { k: "again", def: true, name: "Treffer = nochmal", desc: "Wer trifft, darf gleich nochmal schießen. Aus: nach jedem Schuss ist der Nächste dran." },
    { k: "salvo", name: "Salve", desc: "Pro Zug so viele Schüsse, wie du noch Schiffe hast. Treffer bringen dann keinen Extraschuss." },
    { k: "touch", name: "Schiffe dürfen sich berühren", desc: "Aus: zwischen zwei Schiffen muss mindestens ein Feld Wasser sein, auch diagonal. Rund um versenkte Schiffe wird das Wasser dann automatisch aufgedeckt." },
    { k: "weapons", name: "Spezialwaffen", desc: "Jeder hat pro Runde eine Bombe (trifft ein Kreuz aus 5 Feldern) und einen Torpedo (läuft von links durch eine Reihe, bis er auf ein Schiff trifft)." },
    { k: "sonar", name: "Sonar", desc: "Einmal pro Runde statt eines Schusses: zeigt, wie viele Schiffsteile in einem 3×3-Feld liegen. Nur du siehst das Ergebnis." },
    { k: "clock", name: "Schussuhr", desc: "15 Sekunden pro Schuss, sonst schießt das Spiel zufällig für dich. Im 5×5-Swiftplay immer an, dort mit 8 Sekunden." },
    { k: "teams", name: "Teams 2 gegen 2", desc: "Nur zu viert: Platz 1 und 3 gegen Platz 2 und 4. Ihr seht die Flotte eures Partners und gewinnt zusammen.", four: true }
  ];
  function normRules(r) {
    const o = {};
    for (const x of RULES) o[x.k] = r && typeof r[x.k] === "boolean" ? r[x.k] : !!x.def;
    return o;
  }
  const normSize = (n) => (FLEETS[+n] ? +n : 10);
  const normGoal = (n) => ([1, 2, 3].includes(+n) ? +n : 1);
  const normLevel = (n) => (LEVELS[+n] ? +n : 2);

  const cellName = (size, i) => COLS[i % size] + (Math.floor(i / size) + 1);
  const shipName = (key) => (SHAPES[key] ? SHAPES[key].name : key);
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (a) => a[rand(a.length)];

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

  // Cell offsets [row, col] of a shape in orientation 0 or 1, top-left at 0,0.
  // line: 0 across, 1 down · wide: 0 across (2 rows), 1 down (2 columns) · diag: 0 ↘, 1 ↙
  function offsets(key, o) {
    const { kind, len } = SHAPES[key], out = [];
    for (let i = 0; i < len; i++) {
      if (kind === "line") out.push(o ? [i, 0] : [0, i]);
      else if (kind === "diag") out.push(o ? [i, len - 1 - i] : [i, i]);
      else { out.push(o ? [i, 0] : [0, i]); out.push(o ? [i, 1] : [1, i]); }
    }
    return out;
  }

  // Cells of a ship so that its part number `grab` lies on `cell`, pushed back inside the board.
  function place(size, key, o, cell, grab) {
    const off = offsets(key, o), g = off[grab || 0] || off[0];
    const h = Math.max(...off.map((x) => x[0])) + 1, w = Math.max(...off.map((x) => x[1])) + 1;
    const r = Math.min(size - h, Math.max(0, Math.floor(cell / size) - g[0]));
    const c = Math.min(size - w, Math.max(0, (cell % size) - g[1]));
    return off.map(([a, b]) => (r + a) * size + c + b);
  }

  const sig = (coords) => {
    const r0 = Math.min(...coords.map((x) => x[0])), c0 = Math.min(...coords.map((x) => x[1]));
    return coords.map(([r, c]) => `${r - r0},${c - c0}`).sort().join(";");
  };
  const SIGS = {};
  for (const key in SHAPES) SIGS[key] = [sig(offsets(key, 0)), sig(offsets(key, 1))];
  const cellSig = (size, cells) => sig(cells.map((x) => [Math.floor(x / size), x % size]));
  // which shape (and orientation) a list of cells forms, or null
  function matchKey(size, cells, want) {
    const s = cellSig(size, cells);
    for (const key of want || Object.keys(SHAPES)) if (SIGS[key].includes(s)) return key;
    return null;
  }
  const orientOf = (size, key, cells) => (SIGS[key][0] === cellSig(size, cells) ? 0 : 1);
  // the same ship with its cells in shape order (so part numbers are stable)
  function canon(size, key, cells) {
    const o = orientOf(size, key, cells);
    const r0 = Math.min(...cells.map((x) => Math.floor(x / size))), c0 = Math.min(...cells.map((x) => x % size));
    return offsets(key, o).map(([a, b]) => (r0 + a) * size + c0 + b);
  }

  // Geometry check for any number of ships (the UI uses it while placing). Returns an error or null.
  function placeError(size, touch, ships) {
    const occ = new Map();
    for (let k = 0; k < ships.length; k++) {
      const cells = ships[k];
      if (!Array.isArray(cells) || !cells.length) return "Ungültiges Schiff.";
      for (const c of cells) {
        if (!Number.isInteger(c) || c < 0 || c >= size * size) return "Das Schiff ragt aus dem Feld.";
        if (occ.has(c)) return "Da liegt schon ein Schiff.";
        occ.set(c, k);
      }
    }
    if (!touch) for (const [c, k] of occ) for (const n of around(size, c, true))
      if (occ.has(n) && occ.get(n) !== k) return "Schiffe dürfen sich nicht berühren, auch nicht über Eck.";
    return null;
  }

  function fleetError(size, touch, ships) {
    if (!Array.isArray(ships) || ships.length !== FLEETS[size].length) return "Die Flotte ist nicht vollständig.";
    const want = FLEETS[size].slice();
    for (const cells of ships) {
      if (!Array.isArray(cells) || !cells.every((c) => Number.isInteger(c) && c >= 0 && c < size * size)) return "Das Schiff ragt aus dem Feld.";
      const key = matchKey(size, cells, [...new Set(want)]);
      if (!key) return matchKey(size, cells) ? "Die Flotte ist nicht vollständig." : "Ungültige Schiffsform.";
      want.splice(want.indexOf(key), 1);
    }
    return placeError(size, touch, ships);
  }

  function randomFleet(size, touch) {
    for (;;) {
      const ships = [];
      let ok = true;
      for (const key of FLEETS[size]) {
        let placed = false;
        for (let tries = 0; tries < 400 && !placed; tries++) {
          const cells = place(size, key, rand(2), rand(size * size), 0);
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
  const clockMs = (S) => (S.size === 5 ? SWIFT_MS : S.rules.clock ? CLOCK_MS : 0);

  // players: [{ name, bot }]; goal: wins needed (1-3); size: a key of FLEETS; level: computer strength 1-3
  function newGame(players, goal, size, rules, level) {
    const S = {
      players: players.slice(0, MAX_PLAYERS).map((p) => ({ name: p.name, bot: !!p.bot, wins: 0 })),
      size: normSize(size), goal: normGoal(goal), rules: normRules(rules), level: normLevel(level),
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
      Object.assign(p, {
        fleet: null, ready: false, out: false, sonar: false, bomb: false, torpedo: false, team: S.teams ? i % 2 : i,
        shots: 0, hits: 0, sinks: 0, steals: 0, streak: 0, best: 0, missRun: 0, worstMiss: 0
      });
      p.marks = UNKNOWN.repeat(S.size * S.size);
    });
    S.phase = "place";
    S.cur = -1;
    S.shotsLeft = 0;
    S.deadline = 0;
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
    const want = FLEETS[S.size].slice();
    P.fleet = ships.map((cells) => {
      const key = matchKey(S.size, cells, [...new Set(want)]);
      want.splice(want.indexOf(key), 1);
      return { key, len: cells.length, cells: canon(S.size, key, cells), sunk: false, hitters: [] };
    });
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

  // the shot clock runs for people only, computer players are quick anyway
  function armClock(S, now) {
    const P = S.players[S.cur], ms = clockMs(S);
    S.deadline = S.phase === "play" && P && !P.bot && ms ? (now || Date.now()) + ms : 0;
  }

  function beginTurn(S, pi, events) {
    S.cur = pi;
    S.turn++;
    S.shotsLeft = S.rules.salvo ? shipsLeft(S.players[pi]) : 1;
    armClock(S);
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
    S.deadline = 0;
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
      if (S.shotsLeft > 0) return armClock(S);
    } else if (hit && S.rules.again) return armClock(S);
    nextTurn(S, events);
  }

  function knockOut(S, ti, events, by) {
    const T = S.players[ti];
    T.out = true;
    log(S, by == null ? `${T.name} gibt auf.` : `Die Flotte von ${T.name} ist komplett versenkt!`);
    events.push({ t: "out", pi: ti, by });
  }

  // one cell hit by player pi on player ti's board; returns "miss", "hit" or "sunk"
  function fireAt(S, pi, ti, cell, events) {
    const P = S.players[pi], T = S.players[ti];
    const ship = T.fleet.find((s) => s.cells.includes(cell));
    P.shots++;
    let res = "miss";
    if (!ship) {
      setMark(T, cell, MISS);
      P.streak = 0; P.missRun++; P.worstMiss = Math.max(P.worstMiss, P.missRun);
    } else {
      P.hits++; P.streak++; P.best = Math.max(P.best, P.streak); P.missRun = 0;
      ship.hitters.push(pi);
      setMark(T, cell, HIT);
      res = "hit";
      if (ship.cells.every((c) => T.marks[c] === HIT)) {
        ship.sunk = true;
        res = "sunk";
        P.sinks++;
        if (ship.hitters.some((h) => h !== pi)) P.steals++;
        for (const c of ship.cells) setMark(T, c, SUNK);
        if (!S.rules.touch) for (const c of ship.cells) for (const n of around(S.size, c, true))
          if (T.marks[n] === UNKNOWN) setMark(T, n, WATER);
      }
    }
    S.lastShot = { pi, target: ti, cell, res, turn: S.turn, n: P.shots };
    events.push({ t: "shot", pi, target: ti, cell, res, key: res === "sunk" ? ship.key : null, len: res === "sunk" ? ship.len : 0 });
    if (res === "sunk" && T.fleet.every((s) => s.sunk)) knockOut(S, ti, events, pi);
    return res;
  }

  // Apply an action by player `pi`. Returns { ok, error?, events }.
  // Actions: {t:"place", ships} {t:"unready"} {t:"shoot"|"sonar"|"bomb"|"torpedo", target, cell}
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
      case "sonar":
      case "bomb":
      case "torpedo": {
        if (S.phase !== "play") return fail("Gerade wird nicht geschossen.");
        if (S.cur !== pi) return fail(`${S.players[S.cur].name} ist dran.`);
        const ti = +a.target, T = S.players[ti], cell = +a.cell, n = S.size;
        if (!T || ti === pi || T.out) return fail("Auf diese Flotte kannst du nicht schießen.");
        if (!foe(S, pi, ti)) return fail("Das ist dein Teampartner!");
        if (!Number.isInteger(cell) || cell < 0 || cell >= n * n) return fail("Dieses Feld gibt es nicht.");
        const where = cellName(n, cell);

        if (a.t === "sonar") {
          if (!S.rules.sonar) return fail("Sonar ist in diesem Spiel aus.");
          if (P.sonar) return fail("Dein Sonar ist in dieser Runde schon verbraucht.");
          const area = [cell].concat(around(n, cell, true));
          const cnt = area.filter((c) => T.marks[c] === UNKNOWN && T.fleet.some((s) => s.cells.includes(c))).length;
          P.sonar = true;
          S.sonars.push({ by: pi, target: ti, cell, n: cnt, turn: S.turn });
          log(S, `${P.name} lauscht mit dem Sonar bei ${T.name} um ${where}.`);
          events.push({ t: "sonar", pi, target: ti, cell });
          afterShot(S, events, false);
          return ok();
        }

        if (a.t === "bomb") {
          if (!S.rules.weapons) return fail("Spezialwaffen sind in diesem Spiel aus.");
          if (P.bomb) return fail("Deine Bombe ist in dieser Runde schon verbraucht.");
          const area = [cell].concat(around(n, cell, false)).filter((c) => T.marks[c] === UNKNOWN);
          if (!area.length) return fail("Da gibt es nichts mehr zu treffen.");
          P.bomb = true;
          events.push({ t: "weapon", kind: "bomb", pi, target: ti, cell });
          const res = area.map((c) => (T.out ? null : fireAt(S, pi, ti, c, events))).filter(Boolean);
          const hits = res.filter((r) => r !== "miss").length, sunk = res.filter((r) => r === "sunk").length;
          log(S, `${P.name} wirft eine Bombe auf ${T.name} ${where}: ${hits ? `${hits} ${hits === 1 ? "Treffer" : "Treffer"}${sunk ? `, ${sunk} versenkt` : ""}!` : "nur Wasser."}`);
          if (checkEnd(S, events)) return ok();
          afterShot(S, events, false);
          return ok();
        }

        if (a.t === "torpedo") {
          if (!S.rules.weapons) return fail("Spezialwaffen sind in diesem Spiel aus.");
          if (P.torpedo) return fail("Dein Torpedo ist in dieser Runde schon verbraucht.");
          const row = Math.floor(cell / n);
          P.torpedo = true;
          let end = row * n + n - 1, res = "miss";
          for (let c = 0; c < n; c++) {
            const x = row * n + c, ship = T.fleet.find((s) => s.cells.includes(x));
            if (ship) { end = x; if (T.marks[x] === UNKNOWN) res = fireAt(S, pi, ti, x, events); else res = "wreck"; break; }
            if (T.marks[x] === UNKNOWN) setMark(T, x, MISS);
          }
          events.push({ t: "weapon", kind: "torpedo", pi, target: ti, cell: end, row });
          log(S, `${P.name} schickt einen Torpedo durch Reihe ${row + 1} bei ${T.name}: ` +
            (res === "miss" ? "läuft ins Leere." : res === "wreck" ? "prallt an einem Wrack ab." : res === "sunk" ? `versenkt bei ${cellName(n, end)}!` : `Treffer bei ${cellName(n, end)}!`));
          if (checkEnd(S, events)) return ok();
          afterShot(S, events, false);
          return ok();
        }

        const m = T.marks[cell];
        if (m === WATER) return fail("Da ist sicher Wasser, direkt neben einem versenkten Schiff.");
        if (m !== UNKNOWN) return fail("Da wurde schon hingeschossen.");
        const res = fireAt(S, pi, ti, cell, events);
        const ship = res === "sunk" ? T.fleet.find((s) => s.cells.includes(cell)) : null;
        log(S, `${P.name} → ${T.name} ${where}: ${res === "miss" ? "Wasser." : res === "hit" ? "Treffer!" : `${shipName(ship.key)} versenkt!`}`);
        if (checkEnd(S, events)) return ok();
        afterShot(S, events, res !== "miss");
        return ok();
      }
    }
    return fail("Unbekannte Aktion.");
  }

  // Resolve a shot clock that ran out: the game fires a random shot for the player.
  function tick(S, now) {
    now = now || Date.now();
    if (S.phase !== "play" || !S.deadline || now <= S.deadline + GRACE) return [];
    const pi = S.cur, P = S.players[pi];
    const foes = S.players.map((_, i) => i).filter((i) => !S.players[i].out && foe(S, pi, i));
    const ti = pick(foes), free = [];
    for (let c = 0; c < S.size * S.size; c++) if (S.players[ti].marks[c] === UNKNOWN) free.push(c);
    log(S, `${P.name} war zu langsam, das Spiel schießt zufällig.`);
    const r = act(S, pi, { t: "shoot", target: ti, cell: pick(free) });
    return [{ t: "timeout", pi }].concat(r.events);
  }
  // Milliseconds until the shot clock runs out (plus grace), or -1.
  function nextDeadline(S, now) {
    if (S.phase !== "play" || !S.deadline) return -1;
    return Math.max(0, S.deadline + GRACE - (now || Date.now()));
  }
  // one-phone mode: the clock starts when the player has the phone in hand
  const resetClock = (S) => armClock(S);

  // Where a computer player shoots. Only uses what everyone can see: marks and ship shapes.
  function botMove(S, pi) {
    const P = S.players[pi];
    if (!P) return null;
    if (S.phase === "place") return P.ready ? null : { t: "place", ships: randomFleet(S.size, S.rules.touch) };
    if (S.phase !== "play" || S.cur !== pi) return null;
    const foes = S.players.map((_, i) => i).filter((i) => !S.players[i].out && foe(S, pi, i));
    if (!foes.length) return null;
    const open = foes.filter((i) => S.players[i].marks.includes(HIT));
    let ti;
    if (open.length) ti = pick(open);
    else { // go for whoever has the fewest ships left, with a bit of luck
      const min = Math.min(...foes.map((i) => shipsLeft(S.players[i])));
      const weak = foes.filter((i) => shipsLeft(S.players[i]) === min);
      ti = Math.random() < 0.6 ? pick(weak) : pick(foes);
    }
    const T = S.players[ti], cell = aim(S, T, S.level || 2);
    if (S.rules.weapons && !P.bomb && S.level >= 2 && !T.marks.includes(HIT) && Math.random() < 0.3) return { t: "bomb", target: ti, cell };
    return { t: "shoot", target: ti, cell };
  }

  function aim(S, T, level) {
    const size = S.size, m = T.marks, N = size * size;
    const free = [], hits = [];
    for (let c = 0; c < N; c++) { if (m[c] === UNKNOWN) free.push(c); else if (m[c] === HIT) hits.push(c); }
    if (!free.length) return 0;
    const keys = T.fleet.filter((s) => !s.sunk).map((s) => s.key);
    const diag = keys.some((k) => SHAPES[k].kind === "diag");
    if (level === 1) { // easy: shoots next to a hit now and then, otherwise at random
      const near = [...new Set(hits.flatMap((h) => around(size, h, diag)))].filter((c) => m[c] === UNKNOWN);
      return near.length && Math.random() < 0.6 ? pick(near) : pick(free);
    }
    // count how many ways the remaining ships could lie over each cell; ways through known hits count a lot
    const heat = new Array(N).fill(0);
    for (const key of new Set(keys)) for (const o of [0, 1]) {
      const off = offsets(key, o);
      const h = Math.max(...off.map((x) => x[0])) + 1, w = Math.max(...off.map((x) => x[1])) + 1;
      for (let r = 0; r + h <= size; r++) for (let c = 0; c + w <= size; c++) {
        let cover = 0, okk = true;
        for (const [a, b] of off) {
          const x = m[(r + a) * size + c + b];
          if (x === HIT) cover++; else if (x !== UNKNOWN) { okk = false; break; }
        }
        if (!okk || (hits.length && !cover)) continue;
        const wgt = 1 + cover * 40;
        for (const [a, b] of off) { const x = (r + a) * size + c + b; if (m[x] === UNKNOWN) heat[x] += wgt; }
      }
    }
    if (level === 2 && Math.random() < (hits.length ? 0.25 : 0.5)) { // not a perfect machine
      const near = [...new Set(hits.flatMap((h) => around(size, h, true)))].filter((c) => m[c] === UNKNOWN);
      return pick(near.length ? near : free);
    }
    if (level === 3 && !hits.length) for (const c of free) if ((Math.floor(c / size) + c) % 2) heat[c] *= 0.85;
    const best = Math.max(...free.map((c) => heat[c]));
    if (best <= 0) return pick(free);
    return pick(free.filter((c) => heat[c] === best));
  }

  // What player `pi` may see. pi = -1 shows no fleet (spectator / hand-off screen).
  function view(S, pi) {
    const P = S.players[pi], me = P ? pi : -1, reveal = S.phase === "roundEnd";
    return {
      me, phase: S.phase, cur: S.cur, turn: S.turn, round: S.round, goal: S.goal, size: S.size, level: S.level || 2,
      fleet: FLEETS[S.size], rules: S.rules, teams: !!S.teams, shotsLeft: S.shotsLeft,
      clockMs: clockMs(S), clock: S.deadline ? Math.max(0, S.deadline - Date.now()) : 0,
      players: S.players.map((p, i) => {
        const see = i === me || reveal || (S.teams && P && p.team === P.team);
        return {
          name: p.name, bot: p.bot, wins: p.wins, team: p.team, out: p.out, ready: p.ready,
          sonar: p.sonar, bomb: p.bomb, torpedo: p.torpedo, marks: p.marks,
          shots: p.shots, hits: p.hits, sinks: p.sinks, steals: p.steals, best: p.best, worstMiss: p.worstMiss,
          left: p.fleet ? p.fleet.filter((s) => !s.sunk).map((s) => s.key) : FLEETS[S.size].slice(),
          ships: see && p.fleet ? p.fleet.map((s) => ({ key: s.key, cells: s.cells.slice() })) : null
        };
      }),
      sonars: S.sonars.filter((s) => s.by === me),
      lastShot: S.lastShot, log: S.log.slice(-6), last: S.last
    };
  }

  return {
    SHAPES, FLEETS, COLS, MAX_PLAYERS, BOT_NAMES, LEVELS, RULES, normRules, normSize, normGoal, normLevel, cellName, shipName,
    around, offsets, place, matchKey, orientOf, canon, placeError, fleetError, randomFleet,
    newGame, startRound, act, tick, nextDeadline, resetClock, botMove, view
  };
});
