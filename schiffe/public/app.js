// Schiffe versenken UI: one-phone pass-and-play and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.SchiffeGame;
  // An old cached game.js next to a new app.js: reload once without cache instead of breaking.
  if (!G || !G.botMove || !G.place || !G.SHAPES) {
    let tried = false;
    try { tried = sessionStorage.getItem("schiffe.reloaded") === "1"; sessionStorage.setItem("schiffe.reloaded", "1"); } catch (e) {}
    if (!tried) { const u = new URL(location.href); u.searchParams.set("fresh", Date.now()); location.replace(u.toString()); }
    else document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px;margin:0;background:#e0393e;color:#fff;font-weight:700">Alte Version im Speicher. Bitte die Seite neu laden (oder den Browser-Cache leeren).</p>');
    return;
  }
  try { sessionStorage.removeItem("schiffe.reloaded"); } catch (e) {}
  const $ = (s) => document.querySelector(s);
  const K = { local: "schiffe.v2", players: "schiffe.players", online: "schiffe.online", me: "schiffe.me", rules: "schiffe.rules", size: "schiffe.size", goal: "schiffe.goal", sound: "schiffe.sound", level: "schiffe.level", help: "schiffe.help", stats: "schiffe.stats",
    avatar: "schiffe.avatar", avatars: "schiffe.avatars", look: "schiffe.look" };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const BOT_MS = 1100;

  // ---------- look: table design and board size (applied before anything is drawn) ----------
  const TABLES = [["night", "Nacht", "#1a1426"], ["felt", "Filz", "#15372a"], ["ocean", "Ozean", "#15243a"], ["light", "Hell", "#eceff5"]];
  const LOOK_SIZES = [["0.85", "Klein"], ["1", "Normal"], ["1.15", "Groß"]];
  let look = Object.assign({ table: "night", size: "1" }, store.get(K.look) || {});
  function applyLook() {
    const root = document.documentElement, t = TABLES.find((x) => x[0] === look.table) || TABLES[0];
    if (t[0] === "night") delete root.dataset.table; else root.dataset.table = t[0];
    root.style.setProperty("--cs", (LOOK_SIZES.find((x) => x[0] === look.size) || LOOK_SIZES[1])[0]);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", getComputedStyle(root).getPropertyValue("--bg").trim() || t[2]);
  }
  applyLook();

  // ---------- avatars ----------
  const randomAvatar = () => G.AVATARS[Math.floor(Math.random() * G.AVATARS.length)];
  let myAvatar = G.AVATARS.includes(store.get(K.avatar)) ? store.get(K.avatar) : randomAvatar();
  store.set(K.avatar, myAvatar);
  let localAvatars = Array.isArray(store.get(K.avatars)) ? store.get(K.avatars) : [];
  const avatarFor = (i) => (G.AVATARS.includes(localAvatars[i]) ? localAvatars[i] : G.AVATARS[i % G.AVATARS.length]);
  const nextAvatar = (a) => G.AVATARS[(G.AVATARS.indexOf(a) + 1) % G.AVATARS.length];
  const avi = (a) => (a ? `<i class="av-i" aria-hidden="true">${a}</i>` : "");
  const SIZES = [[5, "5×5", "Swiftplay"], [8, "8×8", "schnell"], [10, "10×10", "klassisch"],
    [12, "12×12", "groß"], [14, "14×14", "Sonderschiffe"], [16, "16×16", "riesig"]];
  const LEVELS = [[1, "Leicht"], [2, "Normal"], [3, "Profi"]];
  const GOALS = [[1, "Eine Runde"], [2, "Bis 2 Siege"], [3, "Bis 3 Siege"]];
  const ICON = {
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" /></svg>'
  };

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let shown = -1;         // local: whose fleet is on screen (-1: nobody's)
  let hidden = true;      // local: hand-off screen is up
  let R = null;           // last online room message
  let V = null;           // view currently on screen
  let focus = null;       // board shown big in the arena (player index)
  let pref = null;        // the opponent I last picked
  let aimCell = null, aimAt = null, weapon = "shot", inflight = false;
  let draft = null, draftKey = null, pick = null, orient = 0, lastPlaced = null, badCells = null;
  let anim = null;        // { target, cell, cls } for the next board render
  let ping = null;        // { target, res }: light up the chip of a board that was just shot at
  let peek = false;       // round over, looking at the revealed fleets
  let server = null;      // server info once found ({} when only the WebSocket answered)
  let serverState = "checking"; // "checking" | "ok" | "none"
  const webHost = /^https?:$/.test(location.protocol);
  let tab = webHost ? "online" : "local", tabTouched = false;
  let players = store.get(K.players) || [{ name: "", bot: false }, { name: "", bot: true }];
  let sizeLocal = G.normSize(store.get(K.size) || 10), goalLocal = G.normGoal(store.get(K.goal) || 1);
  let localRules = G.normRules(store.get(K.rules));
  let levelLocal = G.normLevel(store.get(K.level) || 2);
  let lastTurn = null;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const myTurn = () => !!V && V.phase === "play" && V.cur === V.me && V.me >= 0;
  const isFoe = (i) => !!V && V.me >= 0 && i !== V.me && !(V.teams && V.players[i].team === V.players[V.me].team);
  const isMate = (i) => !!V && V.teams && V.me >= 0 && i !== V.me && V.players[i].team === V.players[V.me].team;
  const targets = () => V.players.map((_, i) => i).filter((i) => isFoe(i) && !V.players[i].out);
  const canShoot = (i) => myTurn() && isFoe(i) && !V.players[i].out;
  const pname = (i, cap) => (i === V.me && mode === "online" ? (cap ? "Du" : "du") : V.players[i].name);
  const cname = (c) => G.cellName(V.size, c);
  const humans = () => L.players.map((_, i) => i).filter((i) => !L.players[i].bot);

  let toastT;
  function toast(msg) {
    if (!msg) return;
    const t = $("#toast"); t.textContent = msg; t.classList.remove("off");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("off"), 2800);
  }
  function flash(text, sub, cls) {
    const f = $("#flash"), s = $("#flashText");
    s.className = cls || "";
    s.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : "");
    f.hidden = false;
    s.style.animation = "none"; void s.offsetWidth; s.style.animation = "";
    clearTimeout(flash.t); flash.t = setTimeout(() => { f.hidden = true; }, 900);
  }
  function shakeBoard() {
    const b = $("#board"); b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake");
  }
  let soundOn = store.get(K.sound) !== false;
  const buzz = (ms) => { if (!soundOn) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

  // tiny synthesized sound effects, no files needed; iOS unlocks audio on the first touch
  let actx = null, noiseBuf = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (actx.state === "suspended") actx.resume().catch(() => {});
    return actx;
  }
  document.addEventListener("pointerdown", () => { if (soundOn) audio(); }, { once: true, capture: true });
  function tone(freq, start, dur, type = "sine", vol = 0.18, to) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + start, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(start, dur, vol, freq) {
    const a = audio(); if (!a) return;
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = a.currentTime + start, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noiseBuf; f.type = "lowpass"; f.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(a.destination); s.start(t); s.stop(t + dur + 0.02);
  }
  const SFX = {
    fire: () => tone(900, 0, 0.22, "triangle", 0.1, 180),
    splash: () => { noise(0.18, 0.4, 0.22, 1400); tone(420, 0.18, 0.12, "sine", 0.06, 200); },
    boom: () => { noise(0.18, 0.55, 0.5, 700); tone(110, 0.18, 0.4, "sine", 0.3, 40); },
    sunk: () => { noise(0.18, 0.9, 0.55, 500); tone(90, 0.18, 0.7, "sawtooth", 0.12, 30); [392, 330, 262].forEach((f, i) => tone(f, 0.55 + i * 0.12, 0.2, "triangle", 0.1)); },
    turn: () => { tone(660, 0, 0.12); tone(880, 0.12, 0.18); },
    sonar: () => { tone(1320, 0, 0.5, "sine", 0.12); tone(1320, 0.55, 0.5, "sine", 0.05); },
    bad: () => { tone(300, 0, 0.14, "sawtooth", 0.08); tone(200, 0.14, 0.24, "sawtooth", 0.08); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, "triangle", 0.16)),
    pop: () => tone(740, 0, 0.06, "sine", 0.12),
    tick: () => tone(1200, 0, 0.05, "square", 0.06),
    torpedo: () => { noise(0, 0.9, 0.12, 400); tone(160, 0, 0.8, "sine", 0.08, 90); }
  };
  const sfx = (k) => { if (soundOn && document.visibilityState === "visible") try { SFX[k](); } catch (e) {} };

  // ---------- events → feedback ----------
  // v is the view after the events, from the viewer's side (me = -1 on a shared phone between players)
  function handleEvents(events, v) {
    if (!v) return;
    const me = v.me, name = (i) => (i === me && mode === "online" ? "Du" : v.players[i].name);
    for (const ev of events || []) {
      if (ev.t === "shot") {
        sfx("fire");
        const cls = ev.res === "miss" ? "splash" : "boom";
        anim = { target: ev.target, cell: ev.cell, cls };
        ping = { target: ev.target, res: ev.res };
        if (ev.res === "miss") sfx("splash");
        else if (ev.res === "hit") sfx("boom");
        else {
          sfx("sunk");
          const whose = ev.target === me ? "Dein" : `${v.players[ev.target].name}s`;
          flash("Versenkt!", `${whose} ${G.shipName(ev.key)}`);
        }
        if (ev.target === me && ev.res !== "miss") {
          buzz(ev.res === "sunk" ? [80, 50, 160] : 60);
          const d = $("#dock"); d.classList.remove("hit"); void d.offsetWidth; d.classList.add("hit");
        }
      }
      if (ev.t === "out" && !events.some((e) => e.t === "end")) {
        setTimeout(() => flash(ev.pi === me ? "Du bist raus!" : "Ausgeschieden!", ev.pi === me ? "Deine Flotte liegt am Meeresgrund." : v.players[ev.pi].name, "blue"), 950);
        if (ev.pi === me) sfx("bad");
      }
      if (ev.t === "sonar") {
        sfx("sonar");
        const s = v.sonars[v.sonars.length - 1];
        if (ev.pi === me && s) toast(`Sonar: ${s.n === 0 ? "kein Schiffsteil" : s.n === 1 ? "1 Schiffsteil" : s.n + " Schiffsteile"} rund um ${G.cellName(v.size, s.cell)}.`);
        else toast(`${name(ev.pi)} benutzt das Sonar.`);
      }
      if (ev.t === "timeout") { toast(ev.pi === me && mode === "online" ? "Zu langsam! Das Spiel hat für dich geschossen." : `${v.players[ev.pi].name} war zu langsam, Zufallsschuss!`); sfx("bad"); }
      if (ev.t === "weapon") {
        toast(`${name(ev.pi)} ${ev.kind === "bomb" ? "wirft eine Bombe!" : "schickt einen Torpedo los!"}`);
        if (ev.kind === "torpedo") { sfx("torpedo"); if (!events.some((e) => e.t === "shot")) anim = { target: ev.target, cell: ev.cell, cls: "splash" }; }
        else sfx("sunk");
      }
      if (ev.t === "begin") { toast("Alle Flotten liegen bereit. Feuer frei!"); sfx("turn"); }
      if (ev.t === "ready" && ev.pi !== me) sfx("pop");
    }
  }

  // ---------- actions ----------
  function doAct(a, actor) {
    if (mode === "local") {
      const res = G.act(L, actor == null ? L.cur : actor, a);
      if (!res.ok) { toast(res.error); sfx("bad"); return false; }
      aimCell = null; weapon = "shot";
      handleEvents(res.events, G.view(L, shown));
      store.set(K.local, L);
      render();
      scheduleBot();
      return true;
    }
    if (mode === "online") {
      if (!wsSend({ t: "act", a })) { toast("Keine Verbindung zum Server."); return false; }
      return true;
    }
    return false;
  }

  // computer players in the one-phone mode (online the server moves them)
  let botT = null;
  function scheduleBot() {
    clearTimeout(botT);
    if (mode !== "local" || !L || L.phase !== "play" || !L.players[L.cur].bot) return;
    botT = setTimeout(() => {
      if (mode !== "local" || !L || L.phase !== "play" || !L.players[L.cur].bot) return;
      if (!$("#menu").hidden) { scheduleBot(); return; } // paused while the menu is open
      const pi = L.cur, a = G.botMove(L, pi);
      const res = a ? G.act(L, pi, a) : null;
      if (res && res.ok) { handleEvents(res.events, G.view(L, shown)); store.set(K.local, L); render(); }
      scheduleBot();
    }, BOT_MS);
  }

  function fire() {
    if (!myTurn()) return;
    if (aimCell == null || !canShoot(aimAt)) { toast("Tippe zuerst auf ein Feld, um zu zielen."); return; }
    if (inflight) return;
    if (weapon === "shot" && V.players[aimAt].marks[aimCell] !== ".") { toast("Da wurde schon hingeschossen."); shakeBoard(); return; }
    const a = { t: weapon === "shot" ? "shoot" : weapon, target: aimAt, cell: aimCell };
    if (mode === "online") { inflight = true; setTimeout(() => { inflight = false; }, 3000); }
    if (doAct(a) && mode === "online") { aimCell = null; weapon = "shot"; }
  }

  function tapBoard(c) {
    if (!V) return;
    if (V.phase === "place") return placeTap(c);
    if (V.phase !== "play") return;
    if (!myTurn()) {
      toast(V.me >= 0 && V.players[V.me].out ? "Deine Flotte ist versenkt, du schaust nur noch zu." : `Warte, ${V.players[V.cur].name} ist dran.`);
      return;
    }
    if (!canShoot(focus)) {
      toast(focus === V.me ? "Das ist deine eigene Flotte. Tippe oben auf einen Gegner." : isMate(focus) ? "Das ist dein Teampartner. Tippe oben auf einen Gegner." : "Tippe oben auf einen Gegner.");
      return;
    }
    const m = V.players[focus].marks[c];
    if (weapon === "shot" && m !== ".") {
      shakeBoard();
      toast(m === "~" ? "Da ist sicher Wasser, direkt neben einem versenkten Schiff." : "Da wurde schon hingeschossen.");
      return;
    }
    if (aimCell === c && aimAt === focus) { fire(); return; }
    aimCell = c; aimAt = focus;
    buzz(8);
    renderGame();
  }

  // ---------- placing the fleet ----------
  const ori = (s) => G.orientOf(V.size, s.key, s.cells);
  const oriName = (key, o) => (G.SHAPES[key].kind === "diag" ? (o ? "↙" : "↘") : o ? "längs" : "quer");
  const others = (k) => draft.filter((x, i) => i !== k && x.cells).map((x) => x.cells);
  function toDraft(ships) {
    const want = G.FLEETS[V.size].slice();
    return ships.map((cells) => {
      const key = G.matchKey(V.size, cells, [...new Set(want)]);
      want.splice(want.indexOf(key), 1);
      return { key, cells: G.canon(V.size, key, cells) };
    });
  }
  function ensureDraft() {
    const key = `${mode}:${V.round}:${V.me}:${V.size}`;
    if (draftKey === key && draft) return;
    draftKey = key;
    const mine = V.players[V.me].ships;
    draft = toDraft(mine ? mine.map((s) => s.cells) : G.randomFleet(V.size, V.rules.touch));
    pick = null; orient = 0; lastPlaced = null;
  }
  function pickUp(i) {
    if (draft[i].cells) orient = ori(draft[i]);
    draft[i].cells = null;
    pick = i;
  }
  function placeTap(c) {
    if (!draft || V.me < 0 || V.players[V.me].ready) return;
    const at = draft.findIndex((s) => s.cells && s.cells.includes(c));
    if (at >= 0) { turnInPlace(at); return; }
    if (pick == null) { toast("Zieh ein Schiff hierher oder tippe unten eins an."); return; }
    const s = draft[pick];
    const cells = G.place(V.size, s.key, orient, c, 0);
    const err = G.placeError(V.size, V.rules.touch, others(pick).concat([cells]));
    if (err) {
      badCells = cells; toast(err); sfx("bad"); renderGame(); shakeBoard();
      setTimeout(() => { badCells = null; if (V && V.phase === "place") renderGame(); }, 700);
      return;
    }
    s.cells = cells; lastPlaced = pick;
    const next = draft.findIndex((x) => !x.cells);
    pick = next >= 0 ? next : null;
    if (pick != null) orient = 0;
    sfx("pop"); buzz(8);
    renderGame();
  }
  // turn a placed ship around its bow; if there is no room, say so
  function turnInPlace(i) {
    const s = draft[i];
    const cells = G.place(V.size, s.key, 1 - ori(s), s.cells[0], 0);
    const err = G.placeError(V.size, V.rules.touch, others(i).concat([cells]));
    if (err) { toast("Kein Platz zum Drehen. Zieh das Schiff woanders hin."); sfx("bad"); shakeBoard(); return false; }
    s.cells = cells; lastPlaced = i; sfx("pop"); buzz(8); renderGame();
    return true;
  }

  // ---------- drag and drop while placing ----------
  // A ship from the board or the harbour follows the finger; the cell under it shows
  // where it would land (yellow) or that it does not fit (red). The board is never
  // re-rendered during a drag, so iOS keeps sending the pointer events.
  let drag = null, dragged = false;
  function cellAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const c = el && el.closest("#board [data-c]");
    return c ? +c.dataset.c : null;
  }
  const dragCells = (d, c) => (c == null ? null : G.place(V.size, draft[d.k].key, d.o, c, d.grab));
  function showGhost(cells) {
    for (const el of $("#board").querySelectorAll(".ghost, .bad, .lift")) el.classList.remove("ghost", "bad", "lift");
    if (!drag) return;
    if (drag.orig) for (const x of drag.orig) { const el = $(`#board [data-c="${x}"]`); if (el) el.classList.add("lift"); }
    if (!cells) return;
    const cls = G.placeError(V.size, V.rules.touch, others(drag.k).concat([cells])) ? "bad" : "ghost";
    for (const x of cells) { const el = $(`#board [data-c="${x}"]`); if (el) el.classList.add(cls); }
  }
  function dragStart(e) {
    if (e.button > 0 || !V || V.phase !== "place" || !draft || V.me < 0 || V.players[V.me].ready) return;
    const cellEl = e.target.closest("#board [data-c]"), chip = e.target.closest("#harbor [data-k]");
    let k, grab = 0;
    if (cellEl) {
      const c = +cellEl.dataset.c;
      k = draft.findIndex((s) => s.cells && s.cells.includes(c));
      if (k < 0) return;
      grab = draft[k].cells.indexOf(c);
    } else if (chip) k = +chip.dataset.k;
    else return;
    const s = draft[k];
    drag = { k, grab, orig: s.cells, o: s.cells ? ori(s) : (pick === k ? orient : 0), chip: !!chip,
      pid: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, src: cellEl ? $("#board") : $("#harbor") };
  }
  function dragMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < 8) return;
      if (drag.chip && Math.abs(dx) > Math.abs(dy) * 1.2) { drag = null; return; } // sideways: scroll the harbour
      drag.active = true;
      try { drag.src.setPointerCapture(drag.pid); } catch (err) {}
      buzz(10);
    }
    e.preventDefault();
    drag.cells = dragCells(drag, cellAt(e.clientX, e.clientY));
    showGhost(drag.cells);
  }
  function dragEnd(e, cancel) {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag; drag = null;
    showGhost(null);
    if (!d.active) return; // a plain tap: the click handlers take over
    dragged = true; setTimeout(() => { dragged = false; }, 0);
    const s = draft[d.k], err = d.cells && G.placeError(V.size, V.rules.touch, others(d.k).concat([d.cells]));
    if (!cancel && d.cells && !err) {
      s.cells = d.cells; lastPlaced = d.k;
      if (pick === d.k) { const next = draft.findIndex((x) => !x.cells); pick = next >= 0 ? next : null; }
      sfx("pop"); buzz(8);
    } else if (!cancel && d.cells) { toast(err); sfx("bad"); }
    renderGame();
  }
  document.addEventListener("pointerdown", dragStart);
  window.addEventListener("pointermove", dragMove, { passive: false });
  window.addEventListener("pointerup", (e) => dragEnd(e, false));
  window.addEventListener("pointercancel", (e) => dragEnd(e, true));
  // turning while dragging (desktop: R or right click)
  function dragTurn() {
    if (!drag || !drag.active) return false;
    const at = drag.cells && drag.cells[drag.grab];
    drag.o = 1 - drag.o;
    if (at != null) { drag.cells = dragCells(drag, at); showGhost(drag.cells); }
    return true;
  }

  $("#rotBtn").addEventListener("click", () => {
    if (!draft) return;
    if (pick != null) { orient = 1 - orient; toast(`Das Schiff liegt jetzt ${oriName(draft[pick].key, orient)}.`); renderGame(); return; }
    const s = lastPlaced != null && draft[lastPlaced];
    if (!s || !s.cells) { toast("Tippe zuerst ein Schiff an, dann auf Drehen."); return; }
    turnInPlace(lastPlaced);
  });
  $("#randBtn").addEventListener("click", () => {
    if (!draft) return;
    draft = toDraft(G.randomFleet(V.size, V.rules.touch));
    pick = null; lastPlaced = null; sfx("pop"); renderGame();
  });
  $("#clearBtn").addEventListener("click", () => {
    if (!draft) return;
    for (const s of draft) s.cells = null;
    pick = 0; orient = 0; lastPlaced = null; renderGame();
  });
  $("#harbor").addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]"); if (!b || !draft || dragged) return;
    const i = +b.dataset.k;
    if (pick === i) { orient = 1 - orient; renderGame(); return; } // second tap turns it
    pickUp(i); buzz(8); renderGame();
  });
  $("#readyBtn").addEventListener("click", () => {
    if (!draft || draft.some((s) => !s.cells)) { toast("Erst alle Schiffe aufs Feld setzen."); return; }
    doAct({ t: "place", ships: draft.map((s) => s.cells) }, mode === "local" ? shown : null);
  });
  $("#editBtn").addEventListener("click", () => doAct({ t: "unready" }));

  // ---------- rendering ----------
  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
  }

  // who has to hold the shared phone right now, or -1 (computer's turn, round over)
  function localNeed() {
    if (L.phase === "place") return L.players.findIndex((p) => !p.bot && !p.ready);
    if (L.phase === "play" && !L.players[L.cur].bot) return L.cur;
    return -1;
  }
  function localViewer() {
    const hs = humans();
    if (hs.length <= 1) { shown = hs.length ? hs[0] : -1; hidden = false; return; }
    if (L.phase === "roundEnd") { hidden = false; return; }
    const need = localNeed();
    if (need < 0) return;
    if (need === shown) { hidden = false; return; }
    if (L.phase === "place" || shown < 0) hidden = true; // otherwise: "pass the phone" button in the dock
  }
  const passing = () => mode === "local" && L && L.phase === "play" && !hidden && shown >= 0 && localNeed() >= 0 && localNeed() !== shown;

  function render() {
    if (mode === "local" && L) {
      localViewer();
      V = G.view(L, shown);
      showScreen("game");
      renderGame();
      $("#handoff").hidden = !hidden;
      if (hidden) renderHandoff();
      scheduleClock();
    } else if (mode === "online" && R) {
      $("#handoff").hidden = true;
      if (!R.view) { V = null; showScreen("lobby"); renderLobby(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null;
      $("#handoff").hidden = true; $("#roundEnd").hidden = true;
      showScreen("home"); renderHome();
    }
    updateNet();
  }

  const pieceHTML = (key, gone) => `<i class="${G.SHAPES[key].kind}${gone ? " gone" : ""}" style="--l:${G.SHAPES[key].len}" title="${G.shipName(key)}"></i>`;
  function fleetHTML(spec, left) {
    const rest = left.slice();
    return spec.map((key) => {
      const k = rest.indexOf(key);
      if (k >= 0) rest.splice(k, 1);
      return pieceHTML(key, k < 0);
    }).join("");
  }
  // "Flotte: Schlachtschiff, Kreuzer, 2× Zerstörer, …" for the settings
  function fleetDesc(size) {
    const count = {};
    for (const k of G.FLEETS[size]) count[k] = (count[k] || 0) + 1;
    const shape = (k) => { const s = G.SHAPES[k]; return s.kind === "wide" ? `2×${s.len}` : s.kind === "diag" ? `${s.len} schräg` : s.len; };
    return "Flotte: " + Object.keys(count).map((k) => `${count[k] > 1 ? count[k] + "× " : ""}${G.shipName(k)} (${shape(k)})`).join(", ") +
      (size === 5 ? ". Swiftplay: 8 Sekunden pro Schuss." : ".");
  }

  // o: { size, marks, ships, labels, buttons, aim, area, sonars, last, ghost, bad, anim }
  function boardHTML(o) {
    const n = o.size, own = new Map(), link = new Map();
    (o.ships || []).forEach((s, k) => (Array.isArray(s) ? s : s.cells).forEach((c) => own.set(c, k)));
    // diagonal ships get a little bridge from each part to the next one
    for (const [c, k] of own) {
      const r = Math.floor(c / n), q = c % n;
      if (r + 1 < n && q + 1 < n && own.get(c + n + 1) === k && own.get(c + 1) !== k) link.set(c, "d1");
      else if (r + 1 < n && q > 0 && own.get(c + n - 1) === k && own.get(c - 1) !== k) link.set(c, "d2");
    }
    // round the corners of a ship part where it has no neighbour of the same ship
    const shape = (i) => {
      const k = own.get(i), r = Math.floor(i / n), c = i % n;
      const same = (rr, cc) => rr >= 0 && rr < n && cc >= 0 && cc < n && own.get(rr * n + cc) === k;
      const t = same(r - 1, c), b = same(r + 1, c), l = same(r, c - 1), rt = same(r, c + 1), R = "48%", q = "8%";
      return ` style="border-radius:${!t && !l ? R : q} ${!t && !rt ? R : q} ${!b && !rt ? R : q} ${!b && !l ? R : q}"`;
    };
    const sn = new Map(), zone = new Set();
    for (const s of o.sonars || []) { sn.set(s.cell, s.n); zone.add(s.cell); for (const x of G.around(n, s.cell, true)) zone.add(x); }
    const tag = o.buttons ? "button" : "span";
    let h = "";
    if (o.labels) {
      h += "<span></span>";
      for (let c = 0; c < n; c++) h += `<span class="lb">${G.COLS[c]}</span>`;
    }
    for (let r = 0; r < n; r++) {
      if (o.labels) h += `<span class="lb">${r + 1}</span>`;
      for (let c = 0; c < n; c++) {
        const i = r * n + c, m = o.marks ? o.marks[i] : ".";
        const cls = ["cell"];
        if ((r + c) % 2) cls.push("alt");
        if (own.has(i)) cls.push("s");
        if (link.has(i)) cls.push(link.get(i));
        if (m === "o") cls.push("o"); else if (m === "~") cls.push("w"); else if (m === "x") cls.push("x"); else if (m === "#") cls.push("k");
        if (zone.has(i)) cls.push("son");
        if (o.area && o.area.has(i)) cls.push("area");
        if (o.ghost && o.ghost.includes(i)) cls.push("ghost");
        if (o.bad && o.bad.includes(i)) cls.push("bad");
        if (o.last === i) cls.push("last");
        if (o.nope && o.nope.has(i)) cls.push("nope");
        if (o.aim === i) cls.push("aim");
        if (o.anim && o.anim.cell === i) cls.push(o.anim.cls);
        const label = o.buttons ? ` type="button" aria-label="${G.COLS[c]}${r + 1}"` : "";
        h += `<${tag} class="${cls.join(" ").trim()}" data-c="${i}"${label}${own.has(i) ? shape(i) : ""}>${sn.has(i) ? `<span class="sn">${sn.get(i)}</span>` : ""}</${tag}>`;
      }
    }
    return h;
  }
  function paintBoard(el, o) {
    el.style.setProperty("--n", o.size);
    el.innerHTML = boardHTML(o);
  }

  const desktop = matchMedia("(min-width:900px) and (min-height:700px)");
  // desktop, two players: the opponent's sea on top, your own fleet underneath
  const duo = () => !!V && desktop.matches && V.players.length === 2 && V.me >= 0 && V.phase !== "place";
  // The board fills the room the arena has left; the size setting (--cs) scales that,
  // and a board bigger than the room makes the arena scroll.
  function layoutBoard() {
    const wrap = $("#boardWrap"), b = $("#board"), arena = $(".arena");
    if (!wrap.offsetParent) return;
    const two = !$("#duoOwn").hidden;
    const st = getComputedStyle(arena), kids = [...arena.children].filter((el) => el !== wrap && el.offsetParent !== null);
    const used = kids.reduce((h, el) => h + el.offsetHeight, 0) + kids.length * (parseFloat(st.rowGap) || 8);
    const room = arena.clientHeight - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom) - used;
    const h = two ? (room - 10 - 32) / 2 : room;
    const cs = parseFloat((LOOK_SIZES.find((x) => x[0] === look.size) || LOOK_SIZES[1])[0]);
    const fit = Math.max(120, Math.min(wrap.clientWidth, h, desktop.matches ? 640 : 480));
    const maxW = cs > 1 ? arena.clientWidth - 8 : wrap.clientWidth; // big boards may use the side margins
    const s = Math.floor(Math.min(maxW, fit * cs));
    $(".arena > .bhead").style.maxWidth = two && s > 0 ? s + "px" : "";
    if (s > 0) { b.style.setProperty("--bs", s + "px"); $("#duoOwn").style.setProperty("--bs", s + "px"); $("#board2").style.setProperty("--bs", s + "px"); }
  }
  desktop.addEventListener && desktop.addEventListener("change", () => { if (V) render(); });
  window.addEventListener("resize", () => { if (V) layoutBoard(); });
  if (window.ResizeObserver) new ResizeObserver(() => layoutBoard()).observe($(".arena"));

  // aim help (a personal setting): dim the cells where no ship that is left could still lie
  let aimHelp = store.get(K.help) === true;
  function impossible(F) {
    const ok = G.possible(V.size, F.marks, F.left), out = new Set();
    for (let c = 0; c < ok.length; c++) if (!ok[c] && F.marks[c] === ".") out.add(c);
    return out;
  }

  // special weapons: what they hit, what the buttons say
  const WEAPON = {
    shot: { label: "Schuss", key: "", idle: "Feuer!", fire: (c) => `Feuer auf ${cname(c)}!`, aimed: (c) => `Ziel ${cname(c)}`, hint: (n) => `Tippe auf ein Feld bei ${n}, um zu zielen.` },
    bomb: { label: "Bombe", key: "b", idle: "Bombe", fire: (c) => `Bombe auf ${cname(c)}!`, aimed: (c) => `Bombe: Kreuz um ${cname(c)}`, hint: () => "Wähle die Mitte des Kreuzes für die Bombe." },
    torpedo: { label: "Torpedo", key: "t", idle: "Torpedo", fire: (c) => `Torpedo durch Reihe ${Math.floor(c / V.size) + 1}!`, aimed: (c) => `Torpedo: Reihe ${Math.floor(c / V.size) + 1} von links`, hint: () => "Tippe in die Reihe, durch die der Torpedo laufen soll." },
    sonar: { label: "Sonar", key: "s", idle: "Sonar", fire: (c) => `Sonar über ${cname(c)}`, aimed: (c) => `Sonar über ${cname(c)}`, hint: () => "Wähle die Mitte des 3×3-Felds fürs Sonar." }
  };
  function weapons() {
    const P = V.players[V.me];
    return ["shot", V.rules.weapons && !P.bomb && "bomb", V.rules.weapons && !P.torpedo && "torpedo", V.rules.sonar && !P.sonar && "sonar"].filter(Boolean);
  }
  function weaponArea(c) {
    const n = V.size;
    if (weapon === "sonar") return new Set([c].concat(G.around(n, c, true)));
    if (weapon === "bomb") return new Set([c].concat(G.around(n, c, false)));
    if (weapon === "torpedo") { const r = Math.floor(c / n); return new Set(Array.from({ length: n }, (_, k) => r * n + k)); }
    return null;
  }
  $("#weapons").addEventListener("click", (e) => { const b = e.target.closest("[data-w]"); if (b) { weapon = b.dataset.w; renderGame(); } });

  // shot clock: a bar that runs out, beeps in the last seconds when it is your shot
  let clockEnd = 0, clockT = null, clockBeep = null;
  function renderClock() {
    const on = V.phase === "play" && V.clockMs > 0 && V.clock > 0 && !passing() && !V.players[V.cur].bot && (mode === "online" || V.cur === V.me);
    $("#clock").hidden = !on;
    clearInterval(renderClock.t);
    if (!on) return;
    clockEnd = Date.now() + V.clock;
    const bar = $("#clockBar"), total = V.clockMs;
    const step = () => {
      const left = Math.max(0, clockEnd - Date.now());
      bar.style.width = (left / total) * 100 + "%";
      $("#clock").classList.toggle("urgent", left < 3000);
      $("#clockSec").textContent = Math.ceil(left / 1000) + " s";
      const s = Math.ceil(left / 1000);
      if (myTurn() && left > 0 && s <= 3 && clockBeep !== `${V.turn}:${s}:${clockEnd}`) { clockBeep = `${V.turn}:${s}:${clockEnd}`; sfx("tick"); if (s === 1) buzz(30); }
      if (!left) clearInterval(renderClock.t);
    };
    step(); renderClock.t = setInterval(step, 100);
  }
  // one-phone mode keeps the clock itself, but only while the player really holds the phone
  function scheduleClock() {
    clearTimeout(clockT);
    if (mode !== "local" || !L || hidden || shown !== L.cur) return;
    const ms = G.nextDeadline(L);
    if (ms < 0) return;
    clockT = setTimeout(() => {
      if (mode !== "local" || !L || hidden || shown !== L.cur) return;
      const ev = G.tick(L);
      if (ev.length) { handleEvents(ev, G.view(L, shown)); store.set(K.local, L); render(); scheduleBot(); }
      else scheduleClock();
    }, ms + 30);
  }

  function pickFocus() {
    const n = V.players.length, valid = (i) => i != null && i >= 0 && i < n;
    const foes = targets();
    const tk = `${V.round}:${V.turn}:${V.cur}:${V.me}`;
    // The big board stays where the player put it. Only when it is your shot and the
    // board shown cannot be shot at (your own, your partner's, a sunk fleet) it moves
    // to your last target. Shots elsewhere light up the opponent's chip instead.
    if (tk !== pickFocus.turn) {
      pickFocus.turn = tk;
      aimCell = null; weapon = "shot";
      if (myTurn() && !foes.includes(focus)) focus = foes.includes(pref) ? pref : foes[0];
    }
    if (myTurn() && !foes.includes(focus) && focus !== V.me && !isMate(focus)) focus = foes[0];
    if (!valid(focus)) focus = V.me >= 0 ? (foes[0] != null ? foes[0] : V.me) : 0;
  }

  function renderGame() {
    const n = V.players.length, me = V.me, P = V.players[me];
    const placing = V.phase === "place" && me >= 0 && !P.ready;
    const members = mode === "online" && R ? R.members : null;
    if (V.phase !== "place") pickFocus();
    if (duo() && focus === me) focus = (me + 1) % n; // your own fleet has its own board below
    if (V.phase !== "roundEnd") peek = false;

    // opponents in seating order, starting with the player after me
    let opps = "";
    for (let k = me >= 0 ? 1 : 0; k < n; k++) {
      const i = ((me >= 0 ? me : 0) + k) % n, p = V.players[i];
      const away = members && !members[i].online;
      const cls = ["opp", V.phase === "play" && i === V.cur ? "active" : "", V.phase !== "place" && i === focus ? "sel" : "", p.out ? "out" : ""].join(" ");
      let tag = "";
      if (V.phase === "place") tag = p.ready ? "bereit ✓" : "stellt auf …";
      else if (p.out) tag = '<span class="otag dead">versenkt</span>';
      else if (isMate(i)) tag = '<span class="otag mate">Partner</span>';
      else if (p.bot) tag = "Computer";
      else if (away) tag = "offline";
      if (tag && tag[0] !== "<") tag = `<span class="otag">${tag}</span>`;
      opps += `<button type="button" class="${cls}" data-seat="${i}" aria-label="${esc(p.name)}: noch ${p.left.length} Schiffe">` +
        `<span class="ocount">${p.left.length}</span><span class="oname">${avi(p.avatar)}${esc(p.name)}</span>` +
        `<span class="fleet">${fleetHTML(V.fleet, p.left)}</span>${tag}</button>`;
    }
    const oppsEl = $("#opps");
    oppsEl.innerHTML = opps;
    $("#roundInfo").innerHTML = `Runde <b>${V.round}</b> · ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}` +
      (P ? ` · ${mode === "online" ? "du" : esc(P.name)}: <b>${P.wins}</b> ${P.wins === 1 ? "Sieg" : "Siege"}` : "");
    if (ping) {
      const el = ping.target === me ? (duo() ? $("#duoOwn") : $("#mine")) : oppsEl.querySelector(`[data-seat="${ping.target}"]`);
      if (el) { const c = ping.res === "miss" ? "ping" : "ping hot"; el.classList.remove("ping", "hot"); void el.offsetWidth; el.classList.add(...c.split(" ")); }
      ping = null;
    }
    const act = oppsEl.querySelector(".opp.sel") || oppsEl.querySelector(".opp.active");
    if (act) oppsEl.scrollLeft = act.offsetLeft - (oppsEl.clientWidth - act.offsetWidth) / 2;

    // arena
    const board = $("#board");
    $("#harbor").hidden = !placing;
    $("#placeBar").hidden = !placing;
    $("#lastMove").hidden = V.phase === "place";
    if (placing) {
      ensureDraft();
      $("#boardTitle").innerHTML = `<small>Aufstellen</small>${avi(P.avatar)}Deine Flotte`;
      $("#boardFleet").innerHTML = "";
      paintBoard(board, { size: V.size, ships: draft.filter((s) => s.cells).map((s) => s.cells), labels: true, buttons: true, bad: badCells });
      board.classList.remove("locked");
      $("#harbor").innerHTML = draft.map((s, i) =>
        `<button type="button" data-k="${i}" aria-pressed="${pick === i}" class="${s.cells ? "placed" : ""}"><span class="fleet">${pieceHTML(s.key)}</span>` +
        `${G.shipName(s.key)}${pick === i ? " · " + oriName(s.key, orient) : ""}</button>`).join("");
    } else if (V.phase === "place" && me < 0) { // shared phone between two players: show nothing
      $("#boardTitle").innerHTML = "<small>Aufstellen</small>Flotten";
      $("#boardFleet").innerHTML = "";
      paintBoard(board, { size: V.size, labels: true, buttons: true });
      board.classList.add("locked");
    } else {
      const f = V.phase === "place" ? me : focus, F = V.players[f];
      if (f === me) $("#boardTitle").innerHTML = `<small>${V.phase === "place" ? "Bereit" : "Du"}</small>${avi(F.avatar)}Deine Flotte`;
      else $("#boardTitle").innerHTML = `<small>${isMate(f) ? "Partner" : F.out ? "Versenkt" : "Ziel"}</small>${avi(F.avatar)}${esc(F.name)}`;
      $("#boardFleet").innerHTML = F ? fleetHTML(V.fleet, F.left) : "";
      const shoot = V.phase === "play" && canShoot(f);
      const aim = shoot && aimAt === f ? aimCell : null;
      let area = null;
      if (aim != null) area = weaponArea(aim);
      const ls = V.lastShot;
      paintBoard(board, {
        size: V.size, marks: F.marks, ships: F.ships, labels: true, buttons: true, aim, area,
        sonars: V.sonars.filter((s) => s.target === f), last: ls && ls.target === f && V.phase === "play" ? ls.cell : null,
        anim: anim && anim.target === f ? anim : null, nope: aimHelp && V.phase === "play" && f !== me && !isMate(f) && !F.out ? impossible(F) : null
      });
      board.classList.toggle("locked", !shoot);
    }
    board.classList.toggle("placing", placing);
    const two = duo();
    $("#game").classList.toggle("duo", two);
    $("#duoOwn").hidden = !two;
    if (two) {
      paintBoard($("#board2"), { size: V.size, marks: P.marks, ships: P.ships, labels: true,
        last: V.lastShot && V.lastShot.target === me && V.phase === "play" ? V.lastShot.cell : null, anim: anim && anim.target === me ? anim : null });
      $("#duoFleet").innerHTML = fleetHTML(V.fleet, P.left);
    }
    layoutBoard();

    // log
    const lm = $("#lastMove"), lines = V.log.slice(-2), lmKey = lines.join("\n");
    if (lm.dataset.k !== lmKey) {
      lm.dataset.k = lmKey;
      lm.innerHTML = lines.map((l, i) => `<div${i < lines.length - 1 ? ' class="old"' : ""}>${esc(l)}</div>`).join("");
      lm.classList.remove("fresh"); void lm.offsetWidth; lm.classList.add("fresh");
    }

    // dock: my own fleet
    const dock = $("#dock");
    dock.classList.toggle("placing", placing);
    dock.classList.toggle("myturn", myTurn() || placing);
    const own = $("#own"), veil = $("#veil");
    if (me >= 0) {
      own.hidden = false; veil.hidden = true;
      paintBoard(own, { size: V.size, marks: P.marks, ships: P.ships, anim: anim && anim.target === me ? anim : null });
      $("#mineCap").textContent = P.out ? "Versenkt" : "Deine Flotte";
      $("#mineFleet").innerHTML = fleetHTML(V.fleet, P.left);
    } else {
      own.hidden = true; veil.hidden = false;
      veil.textContent = mode === "online" ? "Du schaust zu" : "Flotten verdeckt";
      $("#mineCap").textContent = "";
      $("#mineFleet").innerHTML = "";
    }
    $("#mine").classList.toggle("sel", V.phase !== "place" && focus === me);
    anim = null;

    // dock: status and buttons
    const show = { fireBtn: false, weapons: false, readyBtn: false, editBtn: false, passBtn: false, resultBtn: false };
    let who = "", hint = "";
    const curName = V.cur >= 0 ? V.players[V.cur].name : "";
    if (V.phase === "place") {
      if (placing) {
        who = mode === "local" ? `${P.name}, stell deine Flotte auf` : "Stell deine Flotte auf";
        hint = pick != null ? `Tippe aufs Feld, wo es hin soll (${oriName(draft[pick].key, orient)}), oder zieh es hin.` : "Schiffe ziehen zum Verschieben, antippen dreht sie.";
        show.readyBtn = true;
      } else {
        const wait = V.players.filter((p) => !p.ready).map((p) => p.name);
        who = "Warte auf die anderen";
        hint = wait.length ? `Noch am Aufstellen: ${wait.join(", ")}.` : "";
        show.editBtn = mode === "online" && me >= 0;
      }
    } else if (V.phase === "roundEnd") {
      who = "Runde vorbei";
      hint = "Alle Flotten sind aufgedeckt. Tippe oben auf die Namen.";
      show.resultBtn = peek;
    } else if (passing()) {
      const ls = V.lastShot;
      const mine = ls && ls.pi === shown && ls.turn === V.turn - 1;
      who = mine ? (ls.res === "miss" ? "Wasser!" : ls.res === "hit" ? "Treffer!" : "Versenkt!") : `${V.players[localNeed()].name} ist dran`;
      hint = mine ? `Als Nächstes ist ${V.players[localNeed()].name} dran.` : "Gib das Handy weiter.";
      show.passBtn = true;
      $("#passBtn").textContent = `Weitergeben an ${V.players[localNeed()].name}`;
    } else if (myTurn()) {
      who = mode === "local" && humans().length > 1 ? `${P.name}, du bist dran` : "Du bist dran";
      if (!canShoot(focus)) hint = "Tippe oben auf einen Gegner, um auf seine Flotte zu zielen.";
      else if (aimCell != null && aimAt === focus) hint = `${WEAPON[weapon].aimed(aimCell)}. Nochmal antippen zum Feuern.`;
      else hint = WEAPON[weapon].hint(V.players[focus].name);
      show.fireBtn = true;
      const avail = weapons();
      if (!avail.includes(weapon)) weapon = "shot";
      show.weapons = avail.length > 1;
      if (show.weapons) $("#weapons").innerHTML = avail.map((w) => `<button type="button" data-w="${w}" aria-pressed="${w === weapon}">${WEAPON[w].label}</button>`).join("");
    } else if (me >= 0 && P.out) {
      who = `${curName} ist dran`;
      hint = "Deine Flotte ist versenkt. Du schaust zu.";
    } else if (me < 0 && mode === "online") {
      who = `${curName} ist dran`;
      hint = "Du schaust zu. Tippe oben auf die Namen, um die Meere zu wechseln.";
    } else {
      who = `${curName} ist dran`;
      hint = V.players[V.cur].bot ? "Der Computer zielt …" : "Warte auf deinen Zug.";
    }
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    for (const k in show) $("#" + k).hidden = !show[k];
    const fb = $("#fireBtn");
    const aimed = aimCell != null && aimAt === focus && canShoot(focus);
    fb.disabled = !aimed;
    fb.textContent = aimed ? WEAPON[weapon].fire(aimCell) : WEAPON[weapon].idle;
    fb.className = "btn " + (weapon === "shot" ? "btn-danger" : "btn-primary");
    renderClock();
    $("#readyBtn").disabled = !!draft && placing && draft.some((s) => !s.cells);
    const salvo = V.rules.salvo && myTurn();
    $("#shots").hidden = !salvo;
    if (salvo) {
      const total = P.left.length;
      $("#shots").innerHTML = Array.from({ length: total }, (_, k) => `<i class="${k < total - V.shotsLeft ? "used" : ""}"></i>`).join("") +
        `<span class="hint">&nbsp;${V.shotsLeft} ${V.shotsLeft === 1 ? "Schuss" : "Schüsse"} übrig</span>`;
    }
    $("#reactBtn").hidden = mode !== "online";
    $("#keys").innerHTML = placing ? "Schiffe mit der Maus ziehen · Klick dreht · <kbd>R</kbd> oder Rechtsklick dreht beim Ziehen"
      : myTurn() ? `<kbd>←↑→↓</kbd> zielen · <kbd>Enter</kbd> Feuer${n > 2 ? ` · <kbd>1</kbd>–<kbd>${n - 1}</kbd> Gegner` : ""}` +
        (show.weapons ? ` · ${weapons().filter((w) => w !== "shot").map((w) => `<kbd>${WEAPON[w].key.toUpperCase()}</kbd> ${WEAPON[w].label}`).join(" · ")}` : "") : "";

    // turn change feedback
    const key = `${V.round}:${V.turn}:${V.cur}`;
    if (mode === "online" && myTurn() && lastTurn !== key && lastTurn !== null) { buzz([40, 60, 40]); sfx("turn"); }
    lastTurn = key;

    $("#roundEnd").hidden = V.phase !== "roundEnd" || peek;
    if (V.phase === "roundEnd") {
      if (!peek) renderRoundEnd();
      const k = `${V.round}:${V.last.winners.join(",")}:${V.players.map((p) => p.wins).join(",")}`;
      if (confettiFor !== k) { confettiFor = k; confetti(); sfx("win"); record(k); }
    }
  }

  $("#board").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (b && !dragged) tapBoard(+b.dataset.c); });

  // desktop: while placing, the held ship follows the mouse; right click turns it
  function preview(c) {
    if (drag) return;
    for (const el of $("#board").querySelectorAll(".ghost, .bad")) el.classList.remove("ghost", "bad");
    if (c == null || !draft || pick == null || !V || V.phase !== "place") return;
    const cells = G.place(V.size, draft[pick].key, orient, c, 0);
    const cls = G.placeError(V.size, V.rules.touch, others(pick).concat([cells])) ? "bad" : "ghost";
    for (const x of cells) { const el = $(`#board [data-c="${x}"]`); if (el) el.classList.add(cls); }
  }
  let hoverCell = null;
  $("#board").addEventListener("mouseover", (e) => { const b = e.target.closest("[data-c]"); hoverCell = b ? +b.dataset.c : null; preview(hoverCell); });
  $("#board").addEventListener("mouseleave", () => { hoverCell = null; preview(null); });
  $("#board").addEventListener("contextmenu", (e) => {
    if (V && V.phase === "place" && dragTurn()) { e.preventDefault(); return; }
    if (!V || V.phase !== "place" || pick == null) return;
    e.preventDefault(); orient = 1 - orient; renderGame(); preview(hoverCell);
  });

  // desktop: arrows aim, Enter fires, 1-3 pick an opponent, S sonar, R turns a ship, Esc closes
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const open = ["#menu", "#reactBar"].find((s) => !$(s).hidden);
    if (e.key === "Escape") {
      if (open) $(open).hidden = true;
      else if (V && V.phase === "place" && pick != null) { pick = null; renderGame(); }
      else if (aimCell != null || weapon !== "shot") { aimCell = null; weapon = "shot"; if (V) renderGame(); }
      return;
    }
    if (open || $("#game").hidden || !$("#handoff").hidden || !$("#roundEnd").hidden || !V) return;
    const k = e.key.toLowerCase();
    if (V.phase === "place") {
      if (k === "r") { if (!dragTurn()) { $("#rotBtn").click(); preview(hoverCell); } e.preventDefault(); }
      return;
    }
    if (/^[1-9]$/.test(k)) {
      const chip = $("#opps").children[+k - 1];
      if (chip) { chip.click(); e.preventDefault(); }
      return;
    }
    if (!myTurn() || !canShoot(focus)) return;
    const n = V.size, moves = { arrowleft: [0, -1], arrowright: [0, 1], arrowup: [-1, 0], arrowdown: [1, 0] };
    if (moves[k]) {
      e.preventDefault();
      let c = aimCell != null && aimAt === focus ? aimCell : V.players[focus].marks.indexOf(".");
      if (aimCell != null && aimAt === focus) {
        const r = Math.min(n - 1, Math.max(0, Math.floor(c / n) + moves[k][0])), q = Math.min(n - 1, Math.max(0, (c % n) + moves[k][1]));
        c = r * n + q;
      }
      aimCell = Math.max(0, c); aimAt = focus; renderGame();
    } else if (k === "enter" || k === " ") {
      e.preventDefault();
      if (aimCell != null && aimAt === focus) {
        const m = V.players[focus].marks[aimCell];
        if (weapon === "shot" && m !== ".") { toast("Da wurde schon hingeschossen."); shakeBoard(); } else fire();
      }
    } else {
      const w = weapons().find((x) => WEAPON[x].key === k);
      if (w) { weapon = weapon === w ? "shot" : w; renderGame(); }
    }
  });
  $("#opps").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seat]"); if (!b || !V || V.phase === "place") return;
    const i = +b.dataset.seat;
    focus = i;
    if (isFoe(i) && !V.players[i].out) pref = i;
    renderGame();
  });
  $("#mine").addEventListener("click", () => {
    if (!V || V.me < 0 || V.phase === "place") return;
    focus = V.me; renderGame();
  });
  $("#fireBtn").addEventListener("click", fire);
  $("#passBtn").addEventListener("click", () => { shown = -1; hidden = true; render(); });
  $("#resultBtn").addEventListener("click", () => { peek = false; render(); });

  // ---------- house rules ----------
  const activeNames = (r) => G.RULES.filter((x) => r && r[x.k]).map((x) => x.name);
  function rulesHTML(r, editable, pre) {
    return G.RULES.map((x) =>
      `<label class="toggle" for="rule-${pre}-${x.k}"><input type="checkbox" id="rule-${pre}-${x.k}" data-rule="${x.k}"` +
      `${r[x.k] ? " checked" : ""}${editable ? "" : " disabled"}><span>${x.name}<small>${x.desc}</small></span></label>`).join("");
  }
  function renderLocalRules() {
    const box = $("#rulesLocal");
    if (!box.firstChild) box.innerHTML = rulesHTML(localRules, true, "l");
    const on = activeNames(localRules);
    $("#rulesLocalSum").textContent = on.length ? on.join(", ") : "keine";
  }
  $("#rulesLocal").addEventListener("change", (e) => {
    const k = e.target.dataset.rule; if (!k) return;
    localRules[k] = e.target.checked; store.set(K.rules, localRules); renderLocalRules();
  });
  $("#rulesLobby").addEventListener("change", (e) => {
    const k = e.target.dataset.rule; if (!k || !R || R.you !== R.host) return;
    const next = Object.assign({}, R.rules, { [k]: e.target.checked });
    store.set(K.rules, Object.assign(localRules, next));
    wsSend({ t: "settings", rules: next });
  });

  // ---------- confetti ----------
  let confettiFor = null;
  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cv = $("#confetti"), ctx = cv.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cv.hidden = false;
    const cols = ["#e0393e", "#f2c230", "#2fa35b", "#2d6fd6", "#ffffff"];
    const ps = Array.from({ length: 140 }, () => ({
      x: Math.random() * cv.width, y: -Math.random() * cv.height * 0.5, w: (6 + Math.random() * 6) * dpr, h: (10 + Math.random() * 8) * dpr,
      vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: cols[(Math.random() * 5) | 0]
    }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05 * dpr; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      if (t - t0 < 3200) requestAnimationFrame(frame); else { ctx.clearRect(0, 0, cv.width, cv.height); cv.hidden = true; }
    })(t0);
  }

  // ---------- reactions (online) ----------
  function bubble(pi, e, who) {
    const host = pi >= 0 && pi === (R && R.you) ? $("#dock") : pi >= 0 ? document.querySelector(`#opps [data-seat="${pi}"]`) : $("#dock");
    if (!host) return;
    const b = document.createElement("span");
    const text = e.length > 3;
    b.className = "bubble" + (text ? " say" : ""); b.textContent = pi < 0 && who ? `${who}: ${e}` : e;
    host.appendChild(b);
    setTimeout(() => b.remove(), 2500);
    sfx("pop");
  }
  $("#reactBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#reactBar").hidden = !$("#reactBar").hidden; });
  $("#reactBar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-e]"); if (!b) return;
    $("#reactBar").hidden = true;
    wsSend({ t: "react", e: b.dataset.e });
  });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#reactBar, #reactBtn")) $("#reactBar").hidden = true; });

  function renderHandoff() {
    const need = localNeed();
    if (need < 0) { hidden = false; $("#handoff").hidden = true; return; }
    const p = L.players[need];
    $("#hoName").textContent = p.name;
    $("#hoAvatar").textContent = p.avatar || "";
    if (L.phase === "place") {
      $("#hoMeta").textContent = "Stell deine Flotte auf. Die anderen schauen bitte weg!";
      $("#hoLog").innerHTML = "";
    } else {
      const others = L.players.filter((x, i) => i !== need && !x.out).map((x) => `${x.name} ${x.fleet.filter((s) => !s.sunk).length}`).join(" · ");
      $("#hoMeta").textContent = `Du hast noch ${p.fleet.filter((s) => !s.sunk).length} Schiffe. Die anderen: ${others}`;
      $("#hoLog").innerHTML = L.log.slice(-4).map((l) => `<li>${esc(l)}</li>`).join("");
    }
    $("#hoBtn").textContent = `Ich bin ${p.name}, Flotte zeigen`;
  }
  $("#hoBtn").addEventListener("click", () => { shown = localNeed(); hidden = false; if (L.phase === "play") G.resetClock(L); render(); });

  function scoreList(el, winners) {
    const ranked = V.players.map((p, i) => ({ ...p, i })).sort((a, b) => b.wins - a.wins || b.hits - a.hits);
    el.innerHTML = ranked.map((p) => {
      const q = p.shots ? Math.round((p.hits / p.shots) * 100) : 0;
      const you = p.i === V.me && mode === "online" ? " (du)" : "";
      return `<li class="${winners.includes(p.i) ? "win" : ""}"><span>${avi(p.avatar)}${esc(p.name)}${you}<small>${p.shots ? `${q} % Treffer · ${p.sinks} versenkt` : ""}</small></span>` +
        `<b>${p.wins} ${p.wins === 1 ? "Sieg" : "Siege"}</b></li>`;
    }).join("");
  }

  // little awards for the round, from everyone's shooting stats
  function awards() {
    const top = (f, min) => {
      let bi = -1, bv = min;
      V.players.forEach((p, i) => { const v = f(p); if (v != null && v > bv) { bv = v; bi = i; } });
      return bi < 0 ? null : { i: bi, v: bv };
    };
    const out = [], nm = (i) => esc(V.players[i].name);
    let a;
    if ((a = top((p) => (p.shots >= 5 ? p.hits / p.shots : null), 0))) out.push(`🎯 <b>Scharfschütze</b> ${nm(a.i)} (${Math.round(a.v * 100)} %)`);
    if ((a = top((p) => p.sinks, 0))) out.push(`⚓ <b>Versenker</b> ${nm(a.i)} (${a.v} ${a.v === 1 ? "Schiff" : "Schiffe"})`);
    if ((a = top((p) => p.steals, 0))) out.push(`🦅 <b>Aasgeier</b> ${nm(a.i)} (${a.v}× fremde Beute fertig versenkt)`);
    if ((a = top((p) => p.best, 2))) out.push(`🔥 <b>Trefferserie</b> ${nm(a.i)} (${a.v} in Folge)`);
    if ((a = top((p) => p.worstMiss, 4))) out.push(`🌊 <b>Pechvogel</b> ${nm(a.i)} (${a.v}× Wasser am Stück)`);
    return out;
  }

  function renderRoundEnd() {
    const last = V.last, ws = last.winners;
    const iWin = ws.includes(V.me) && (mode === "online" || humans().length === 1);
    const names = ws.map((i) => V.players[i].name).join(" & ");
    const title = iWin ? (ws.length > 1 ? `Ihr gewinnt, ${names}` : "Du gewinnst") : `${names} ${ws.length > 1 ? "gewinnen" : "gewinnt"}`;
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} vorbei`;
    $("#reTitle").textContent = `${title} ${last.over ? "das Spiel" : "die Runde"}!`;
    $("#reText").textContent = (last.over ? "" : `Gespielt wird bis ${V.goal} Siege. `) + "So lagen alle Flotten:";
    scoreList($("#reScores"), ws);
    $("#reAwards").innerHTML = awards().map((x) => `<li>${x}</li>`).join("");
    $("#reFleets").innerHTML = V.players.map((p, i) =>
      `<figure class="${ws.includes(i) ? "win" : ""}"><div class="board bare" style="--n:${V.size}">${boardHTML({ size: V.size, marks: p.marks, ships: p.ships })}</div>` +
      `<figcaption>${avi(p.avatar)}${esc(p.name)}${i === V.me && mode === "online" ? " (du)" : ""}</figcaption></figure>`).join("");
    const box = $("#reFleets"), w = box.clientWidth || 300, cols = V.players.length > 2 ? 2 : V.players.length;
    box.style.setProperty("--fbs", Math.floor(Math.min(240, (w - (cols - 1) * 12) / cols)) + "px");
    $("#reBtn").textContent = last.over ? "Revanche" : "Nächste Runde";
    $("#reBtn").hidden = mode === "online" && V.me < 0;
    const back = $("#reBack");
    if (mode === "local") { back.hidden = false; back.textContent = "Zur Spieler-Auswahl"; }
    else { back.hidden = R.host !== V.me; back.textContent = "Zurück in den Warteraum"; }
  }

  // Bilanz: results per name on this device (people only, online just yourself)
  function record(key) {
    const st = store.get(K.stats) || {};
    if (st._last === key) return;
    st._last = key;
    const who = mode === "online" ? (V.me >= 0 ? [V.me] : []) : V.players.map((p, i) => (p.bot ? -1 : i)).filter((i) => i >= 0);
    for (const i of who) {
      const p = V.players[i], s = st[p.name] || (st[p.name] = { rounds: 0, wins: 0, shots: 0, hits: 0, sinks: 0 });
      s.rounds++; s.shots += p.shots; s.hits += p.hits; s.sinks += p.sinks;
      if (V.last.winners.includes(i)) s.wins++;
    }
    store.set(K.stats, st);
  }
  function renderStats() {
    const st = store.get(K.stats) || {};
    const rows = Object.keys(st).filter((k) => k !== "_last").map((name) => ({ name, ...st[name] }))
      .sort((a, b) => b.wins - a.wins || b.rounds - a.rounds).slice(0, 8);
    $("#statsPanel").hidden = !rows.length;
    $("#statsList").innerHTML = rows.map((r) =>
      `<li><span>${esc(r.name)}<small>${r.shots ? Math.round((r.hits / r.shots) * 100) : 0} % Treffer · ${r.sinks} versenkt</small></span><b>${r.wins} von ${r.rounds}</b></li>`).join("");
  }

  function segHTML(list, cur) {
    return list.map(([v, a, b]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${a}${b ? `<small>${b}</small>` : ""}</button>`).join("");
  }

  function renderHome(force) {
    renderLocalRules();
    renderLook();
    $("#myAvatar").textContent = myAvatar;
    renderStats();
    for (const b of document.querySelectorAll("#modeTabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
    // never hide the online form on a web address: a failed check (ad blocker, slow
    // network) must not lock people out; connecting will tell if there really is no server
    $("#onlinePanel").hidden = tab !== "online" || !webHost;
    $("#onlineOff").hidden = tab !== "online" || webHost;
    const sh = $("#serverHint");
    sh.hidden = serverState === "ok";
    sh.textContent = serverState === "checking" ? "Suche den Spiel-Server …"
      : "Unter dieser Adresse antwortet kein Spiel-Server. Du kannst es trotzdem versuchen, „Ein Handy für alle“ geht immer.";
    $("#localPanel").hidden = tab !== "local";
    $("#sizeLocal").innerHTML = segHTML(SIZES, sizeLocal);
    $("#sizeHintLocal").textContent = fleetDesc(sizeLocal);
    $("#goalLocal").innerHTML = segHTML(GOALS, goalLocal);
    $("#levelLocal").innerHTML = segHTML(LEVELS, levelLocal);

    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players);
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(", ")} · Runde ${saved.round}`;
    const list = $("#plist");
    if (force || !list.contains(document.activeElement)) {
      list.innerHTML = players.map((p, i) =>
        `<div class="prow"><button class="avbtn" type="button" data-av="${i}" aria-label="Avatar für Platz ${i + 1} wechseln"${p.bot ? " disabled" : ""}>${p.bot ? G.BOT_AVATAR : avatarFor(i)}</button>` +
        `<input class="field" id="pname-${i}" data-i="${i}" maxlength="18" autocomplete="off" enterkeyhint="next" placeholder="${p.bot ? G.BOT_NAMES[i] : `Spieler ${i + 1}`}" value="${esc(p.name)}">` +
        `<button class="kind" type="button" data-kind="${i}" aria-pressed="${p.bot}">${p.bot ? ICON.bot + "Computer" : ICON.person + "Mensch"}</button>` +
        (players.length > 2 ? `<button class="rm" type="button" data-rm="${i}" aria-label="Spieler ${i + 1} entfernen">×</button>` : "") +
        `</div>`).join("");
    }
    $("#addPlayer").hidden = players.length >= G.MAX_PLAYERS;
  }

  function joinUrl() {
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    const base = local && server && server.ips && server.ips.length && !/^172\.(1[6-9]|2\d|3[01])\./.test(server.ips[0])
      ? `${location.protocol}//${server.ips[0]}:${location.port || server.port}/`
      : location.origin + location.pathname;
    return `${base}?r=${R.code}`;
  }

  let qrFor = null;
  function renderLobby() {
    $("#roomCode").textContent = R.code;
    const url = joinUrl();
    $("#joinUrl").textContent = url;
    if (qrFor !== url) { qrFor = url; drawQr(url); }
    const lan = /^http:\/\/(\d+\.){3}\d+[:/]/.test(url);
    $("#joinHint").textContent = "Die anderen scannen den QR-Code oder öffnen den Link und geben den Code ein." + (lan ? " Alle müssen im selben WLAN sein." : "");
    const host = R.you === R.host;
    const teams = R.rules.teams && R.members.length === 4;
    const watching = R.you < 0, seen = R.watchers || [];
    $("#membersLabel").textContent = `Spieler (${R.members.length}/${G.MAX_PLAYERS})` + (seen.length ? ` · ${seen.length} ${seen.length === 1 ? "schaut" : "schauen"} zu` : "");
    $("#sitBtn").hidden = !watching || R.members.length >= G.MAX_PLAYERS;
    $("#members").innerHTML = R.members.map((m, i) =>
      `<li class="${i === R.you ? "me" : ""}">${m.bot ? `<span class="botico">${ICON.bot}</span>` : `<span class="on${m.online ? "" : " off"}"></span>`}` +
      (i === R.you ? `<button class="av" type="button" data-myav aria-label="Avatar wechseln">${m.avatar}</button>` : `<span class="av" aria-hidden="true">${m.avatar || ""}</span>`) +
      `<span class="nm">${esc(m.name)}</span>` +
      `${teams ? `<span class="tag team t${i % 2}">${i % 2 ? "Team Rot" : "Team Blau"}</span>` : ""}` +
      `${i === R.host ? '<span class="tag">Host</span>' : ""}${i === R.you ? '<span class="tag">du</span>' : ""}${m.bot ? '<span class="tag">Computer</span>' : ""}` +
      `${m.bot && host ? `<button class="rm" type="button" data-unbot="${i}" aria-label="${esc(m.name)} entfernen">×</button>` : ""}</li>`).join("");
    $("#addBot").hidden = !host || R.members.length >= G.MAX_PLAYERS;
    $("#startOnline").hidden = !host;
    $("#startOnline").disabled = R.members.length < 2;
    $("#startOnline").textContent = R.members.length < 2 ? "Warte auf Mitspieler …" : "Spiel starten";
    $("#sizeHintOnline").textContent = fleetDesc(R.size);
    for (const [id, list, cur] of [["#sizeOnline", SIZES, R.size], ["#goalOnline", GOALS, R.goal], ["#levelOnline", LEVELS, R.level || 2]]) {
      const el = $(id), k = cur + ":" + host;
      if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = segHTML(list, cur); for (const b of el.children) b.disabled = !host; }
    }
    const rl = $("#rulesLobby"), key = JSON.stringify(R.rules) + host;
    if (rl.dataset.k !== key) { rl.dataset.k = key; rl.innerHTML = rulesHTML(R.rules || {}, host, "o"); }
    const onR = activeNames(R.rules);
    $("#rulesLobbySum").textContent = onR.length ? onR.join(", ") : "keine";
    $("#rulesLobbyHint").textContent = host ? "Tippe an, was gelten soll. Alle sehen deine Auswahl." : `${R.members[R.host].name} legt die Regeln fest.`;
    const humansOn = R.members.filter((m) => !m.bot && m.online).length, humansAll = R.members.filter((m) => !m.bot).length;
    $("#lobbyHint").textContent = watching
      ? (R.members.length >= G.MAX_PLAYERS ? "Du schaust zu. Der Raum ist voll, wird ein Platz frei, kannst du mitspielen." : "Du schaust zu. Tippe auf „Mitspielen“, um einen freien Platz zu nehmen.")
      : host
      ? (R.members.length < 2 ? "Warte auf Mitspieler, oder hol dir einen Computer-Gegner dazu." : `${humansOn} von ${humansAll} Menschen online.${R.rules.teams && !teams ? " Teams gibt es nur zu viert." : ""}`)
      : `Warte, bis ${R.members[R.host].name} das Spiel startet.`;
  }
  $("#members").addEventListener("click", (e) => { const b = e.target.closest("[data-unbot]"); if (b) wsSend({ t: "unbot", i: +b.dataset.unbot }); });
  $("#addBot").addEventListener("click", () => wsSend({ t: "bot" }));
  $("#sitBtn").addEventListener("click", () => wsSend({ t: "sit" }));
  $("#members").addEventListener("click", (e) => {
    if (!e.target.closest("[data-myav]")) return;
    myAvatar = nextAvatar(myAvatar); store.set(K.avatar, myAvatar);
    wsSend({ t: "avatar", avatar: myAvatar });
  });

  // avatar picker in the online form
  $("#myAvatar").addEventListener("click", () => {
    const g = $("#avatarGrid");
    g.innerHTML = G.AVATARS.map((a) => `<button type="button" data-pick="${a}" aria-pressed="${a === myAvatar}">${a}</button>`).join("");
    g.hidden = !g.hidden;
  });
  $("#avatarGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]"); if (!b) return;
    myAvatar = b.dataset.pick; store.set(K.avatar, myAvatar);
    $("#avatarGrid").hidden = true; $("#myAvatar").textContent = myAvatar;
  });

  // look settings on the start screen and in the menu
  function renderLook() {
    const html = `<div class="label">Tisch</div><div class="seg">${TABLES.map(([k, n, c]) =>
      `<button type="button" data-table="${k}" aria-pressed="${look.table === k}"><span class="swatch" style="background:${c}"></span>${n}</button>`).join("")}</div>` +
      `<div class="label">Größe</div><div class="seg three">${LOOK_SIZES.map(([k, n]) =>
      `<button type="button" data-size="${k}" aria-pressed="${look.size === k}">${n}</button>`).join("")}</div>`;
    for (const id of ["#lookHome", "#lookMenu"]) if ($(id).innerHTML !== html) $(id).innerHTML = html;
    $("#lookSum").textContent = `${(TABLES.find((x) => x[0] === look.table) || TABLES[0])[1]} · ${(LOOK_SIZES.find((x) => x[0] === look.size) || LOOK_SIZES[1])[1]}`;
  }
  for (const id of ["#lookHome", "#lookMenu"]) $(id).addEventListener("click", (e) => {
    const t = e.target.closest("[data-table]"), z = e.target.closest("[data-size]");
    if (!t && !z) return;
    if (t) look.table = t.dataset.table;
    if (z) look.size = z.dataset.size;
    store.set(K.look, look); applyLook(); renderLook();
    if (V && !$("#game").hidden) layoutBoard();
  });
  $("#statsReset").addEventListener("click", (e) => { // second tap within 3 s deletes
    const b = e.currentTarget;
    if (b.dataset.armed) { store.del(K.stats); delete b.dataset.armed; b.textContent = "Bilanz löschen"; b.classList.remove("btn-danger"); renderStats(); return; }
    b.dataset.armed = "1"; b.textContent = "Sicher? Nochmal tippen"; b.classList.add("btn-danger");
    setTimeout(() => { delete b.dataset.armed; b.textContent = "Bilanz löschen"; b.classList.remove("btn-danger"); }, 3000);
  });
  $("#sizeOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", size: +b.dataset.v }); });
  $("#goalOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", goal: +b.dataset.v }); });
  $("#levelOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && R && R.you === R.host) wsSend({ t: "settings", level: +b.dataset.v }); });

  function drawQr(url) {
    const box = $("#qr");
    const paint = () => {
      try {
        const q = window.qrcode(0, "M"); q.addData(url); q.make();
        box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
        box.hidden = false;
      } catch (e) { box.hidden = true; }
    };
    if (window.qrcode) return paint();
    const s = document.createElement("script");
    s.src = "vendor/qrcode.js"; s.onload = paint; s.onerror = () => { box.hidden = true; };
    document.head.appendChild(s);
  }

  // connection pill: only after a short grace period, phones drop sockets all the time
  let netT = null;
  function updateNet() {
    const down = mode === "online" && wantOnline && !(ws && ws.readyState === 1);
    if (!down) { clearTimeout(netT); netT = null; $("#net").hidden = true; return; }
    if (!netT && $("#net").hidden) netT = setTimeout(() => { netT = null; if (mode === "online" && !(ws && ws.readyState === 1)) $("#net").hidden = false; }, 2000);
  }

  // ---------- online connection ----------
  let ws = null, wantOnline = false, retry = 0, queue = [];
  function connect() {
    if (ws && ws.readyState <= 1) return;
    // each socket only ever touches itself: a late close of an old socket must not
    // wipe out the new one
    const sock = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) { sock.close(); return; }
      retry = 0; clearTimeout(giveUpT);
      if (serverState !== "ok") { serverState = "ok"; server = server || {}; }
      const s = store.get(K.online);
      if (s && !queue.some((m) => m.t === "create" || m.t === "join"))
        sock.send(JSON.stringify(s.watch ? { t: "join", code: s.code, name: s.watch } : { t: "resume", code: s.code, secret: s.secret }));
      for (const m of queue.splice(0)) sock.send(JSON.stringify(m));
      render();
    };
    sock.onmessage = (e) => { if (ws !== sock) return; try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (wantOnline) setTimeout(connect, Math.min(8000, 400 * 2 ** retry++));
      render();
    };
  }
  let giveUpT = null;
  function wsSend(m) {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; }
    if (m.t === "create" || m.t === "join") {
      queue.push(m); wantOnline = true; retry = 0; connect();
      clearTimeout(giveUpT);
      giveUpT = setTimeout(() => {
        if (ws && ws.readyState === 1) return;
        queue = []; wantOnline = false;
        if (ws) ws.close();
        toast("Der Spiel-Server antwortet nicht. Prüf die Adresse oder die Internetverbindung.");
        render();
      }, 8000);
      return true;
    }
    return false;
  }
  function onMsg(m) {
    if (m.t === "watching") {
      store.set(K.online, { code: m.code, watch: m.name });
      wantOnline = true; mode = "online";
      if (location.search) history.replaceState(null, "", location.pathname);
      toast("Das Spiel läuft schon oder der Raum ist voll: Du schaust zu.");
    } else if (m.t === "joined") {
      store.set(K.online, { code: m.code, secret: m.secret });
      wantOnline = true;
      mode = "online";
      if (location.search) history.replaceState(null, "", location.pathname);
      wake();
    } else if (m.t === "room") {
      R = m; mode = "online"; inflight = false;
      if (m.view) handleEvents(m.events, m.view);
      render();
    } else if (m.t === "react") {
      bubble(m.pi, m.e, m.name);
    } else if (m.t === "error") {
      inflight = false;
      toast(m.msg);
    } else if (m.t === "gone" || m.t === "left") {
      // keep the socket: a join or create sent a moment ago is answered on it
      store.del(K.online); R = null; mode = null;
      if (m.t === "gone") toast("Diesen Raum gibt es nicht mehr.");
      render();
    }
  }

  // ---------- events ----------
  // a small board on the start screen: a ship half sunk, some splashes
  (() => {
    const n = 6, marks = "......" + ".o..x." + "....x." + ".~...." + "...o.." + "......";
    paintBoard($("#heroBoard"), { size: n, marks, ships: [[10, 16, 22], [31, 32]] });
  })();
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; tabTouched = true; renderHome(); } });
  $("#sizeLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { sizeLocal = +b.dataset.v; store.set(K.size, sizeLocal); renderHome(); } });
  $("#goalLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { goalLocal = +b.dataset.v; store.set(K.goal, goalLocal); renderHome(); } });
  $("#levelLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { levelLocal = +b.dataset.v; store.set(K.level, levelLocal); renderHome(); } });

  $("#myName").value = store.get(K.me) || "";
  $("#soundOn").checked = soundOn;
  $("#soundOn").addEventListener("change", (e) => { soundOn = e.target.checked; store.set(K.sound, soundOn); if (soundOn) { audio(); sfx("pop"); } });
  $("#myName").addEventListener("input", (e) => store.set(K.me, e.target.value));
  $("#joinCode").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ""); });
  const myName = () => {
    const n = $("#myName").value.trim();
    if (!n) { toast("Bitte gib zuerst deinen Namen ein."); $("#myName").focus(); }
    return n;
  };
  function join() {
    const n = myName(); if (!n) return;
    const code = $("#joinCode").value.trim();
    if (code.length !== 4) { toast("Der Raum-Code hat 4 Buchstaben."); $("#joinCode").focus(); return; }
    store.del(K.online);
    wsSend({ t: "join", code, name: n, avatar: myAvatar });
  }
  $("#joinBtn").addEventListener("click", join);
  $("#joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  $("#createBtn").addEventListener("click", () => {
    const n = myName(); if (!n) return;
    store.del(K.online);
    wsSend({ t: "create", name: n, goal: goalLocal, size: sizeLocal, rules: localRules, level: levelLocal, avatar: myAvatar });
  });

  $("#plist").addEventListener("input", (e) => { if (e.target.dataset.i != null) { players[+e.target.dataset.i].name = e.target.value; store.set(K.players, players); } });
  $("#plist").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]"), kind = e.target.closest("[data-kind]"), av = e.target.closest("[data-av]");
    if (av) {
      const i = +av.dataset.av; if (players[i].bot) return;
      localAvatars[i] = nextAvatar(avatarFor(i)); store.set(K.avatars, localAvatars); renderHome(true); return;
    }
    if (rm) { players.splice(+rm.dataset.rm, 1); localAvatars.splice(+rm.dataset.rm, 1); store.set(K.avatars, localAvatars); }
    else if (kind) players[+kind.dataset.kind].bot = !players[+kind.dataset.kind].bot;
    else return;
    store.set(K.players, players); renderHome(true);
  });
  $("#plist").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const nx = document.getElementById(`pname-${+e.target.dataset.i + 1}`);
    if (nx) nx.focus(); else e.target.blur();
  });
  $("#addPlayer").addEventListener("click", () => {
    if (players.length >= G.MAX_PLAYERS) return;
    players.push({ name: "", bot: false }); store.set(K.players, players); renderHome();
    const el = document.getElementById(`pname-${players.length - 1}`); if (el) el.focus();
  });
  function startLocal(state) {
    L = state; mode = "local"; shown = -1; hidden = true; focus = null; pref = null; peek = false; draftKey = null;
    if (L.phase === "play") G.resetClock(L);
    store.set(K.local, L); render(); wake(); scheduleBot();
  }
  $("#startLocal").addEventListener("click", () => {
    if (!players.some((p) => !p.bot)) { toast("Mindestens ein Mensch muss mitspielen."); return; }
    const list = players.map((p, i) => ({ name: p.name.trim() || (p.bot ? G.BOT_NAMES[i] : `Spieler ${i + 1}`), bot: p.bot, avatar: avatarFor(i) }));
    startLocal(G.newGame(list, goalLocal, sizeLocal, localRules, levelLocal));
  });
  $("#resumeBtn").addEventListener("click", () => {
    const s = store.get(K.local); if (!s) return render();
    startLocal(s);
  });

  $("#startOnline").addEventListener("click", () => wsSend({ t: "start" }));
  $("#leaveLobby").addEventListener("click", () => wsSend({ t: "leave" }));
  $("#copyBtn").addEventListener("click", () => {
    const url = $("#joinUrl").textContent;
    const ok = () => toast("Link kopiert.");
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($("#joinUrl")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Link markiert, jetzt kopieren."); };
    try { navigator.clipboard.writeText(url).then(ok, fallback); } catch (e) { fallback(); }
  });

  $("#reBtn").addEventListener("click", () => {
    if (mode === "local") { shown = -1; hidden = true; peek = false; }
    doAct({ t: "next" }, mode === "local" ? 0 : null);
  });
  $("#reLook").addEventListener("click", () => { peek = true; render(); });
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; clearTimeout(botT); render(); }
    else wsSend({ t: "end" });
  });

  // menu with in-page two-step confirmation
  function armed(label, run) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn btn-ghost btn-block"; b.textContent = label;
    let t = null;
    b.addEventListener("click", () => {
      if (t) { clearTimeout(t); t = null; $("#menu").hidden = true; run(); return; }
      b.textContent = "Sicher? Nochmal tippen"; b.classList.add("btn-danger");
      t = setTimeout(() => { t = null; b.textContent = label; b.classList.remove("btn-danger"); }, 3500);
    });
    return b;
  }
  $("#menuBtn").addEventListener("click", () => {
    renderLook();
    scoreList($("#menuScores"), []);
    $("#menuLog").innerHTML = V ? V.log.slice().reverse().map((l) => `<li>${esc(l)}</li>`).join("") : "";
    $("#aimHelp").checked = aimHelp;
    const on = activeNames(V ? V.rules : {});
    const size = V ? `Spielfeld ${V.size}×${V.size}, ${V.goal === 1 ? "eine Runde" : `bis ${V.goal} Siege`}.` : "";
    $("#menuRules").textContent = `${size} ${on.length ? `Hausregeln: ${on.join(", ")}.` : "Keine Hausregeln."}`;
    const box = $("#menuActions"); box.innerHTML = "";
    if (mode === "local") {
      box.append(
        armed("Runde neu starten", () => { L.round--; G.startRound(L); shown = -1; hidden = true; peek = false; draftKey = null; store.set(K.local, L); render(); scheduleBot(); }),
        armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; clearTimeout(botT); render(); })
      );
    } else if (mode === "online" && R) {
      const host = R.you === R.host;
      if (host && V && V.phase === "play" && V.cur !== V.me && !V.players[V.cur].bot)
        box.append(armed(`${V.players[V.cur].name} überspringen`, () => wsSend({ t: "act", a: { t: "skip" } })));
      if (V && V.phase === "play" && V.me >= 0 && !V.players[V.me].out)
        box.append(armed("Aufgeben", () => wsSend({ t: "act", a: { t: "giveup" } })));
      if (host) box.append(armed("Spiel beenden, zurück in den Warteraum", () => wsSend({ t: "end" })));
      box.append(armed("Raum verlassen", () => wsSend({ t: "leave" })));
    }
    $("#menu").hidden = false;
  });
  $("#menuClose").addEventListener("click", () => { $("#menu").hidden = true; });
  $("#aimHelp").addEventListener("change", (e) => { aimHelp = e.target.checked; store.set(K.help, aimHelp); if (V) renderGame(); });

  // keep the screen on while playing (needs HTTPS; silently skipped otherwise)
  let lock = null;
  async function wake() {
    try { if ("wakeLock" in navigator && !lock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } } catch (e) {}
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (mode) wake();
    if (wantOnline && !(ws && ws.readyState <= 1)) { retry = 0; connect(); }
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---------- boot ----------
  // Is there a game server behind this address? Ask twice over HTTP (some ad blockers
  // eat such requests), then simply try the WebSocket.
  async function getJson(path, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(path, { cache: "no-store", signal: ctl.signal });
      const j = await r.json();
      return j && j.schiffe ? j : null;
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  function probeSocket(ms) {
    return new Promise((res) => {
      let w;
      try { w = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws"); } catch (e) { return res(false); }
      const t = setTimeout(() => { w.close(); res(false); }, ms);
      w.onopen = () => { clearTimeout(t); w.close(); res(true); };
      w.onerror = () => { clearTimeout(t); res(false); };
    });
  }
  async function detectServer() {
    if (!webHost) return null;
    return (await getJson("/schiffe-server", 6000)) || (await getJson("/info", 4000)) || ((await probeSocket(6000)) ? {} : null);
  }
  const code = new URLSearchParams(location.search).get("r");
  if (code) $("#joinCode").value = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  render();
  if (webHost && (store.get(K.online) && !code)) { wantOnline = true; connect(); }
  detectServer().then((info) => {
    if (info) { server = Object.assign(server || {}, info); serverState = "ok"; }
    else if (serverState !== "ok") { serverState = "none"; if (!tabTouched && !code) tab = "local"; }
    render();
    if (serverState === "ok" && code && !$("#myName").value) $("#myName").focus();
  });
})();
