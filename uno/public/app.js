// Pass-Uno UI: local pass-and-play and online rooms share one table renderer.
(() => {
  "use strict";
  const G = window.UnoGame;
  const $ = (s) => document.querySelector(s);
  const CVAR = { r: "var(--red)", y: "var(--yellow)", g: "var(--green)", b: "var(--blue)" };
  const ORDER = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "rev", "d2", "wild", "d4"];
  const ICON = {
    skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M6.6 17.4 17.4 6.6"/></svg>',
    rev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h14l-4-4"/><path d="M20 15H6l4 4"/></svg>',
    wildMini: '<svg viewBox="0 0 24 24"><path d="M12 12V3a9 9 0 0 1 9 9z" fill="#e0393e"/><path d="M12 12h9a9 9 0 0 1-9 9z" fill="#2d6fd6"/><path d="M12 12v9a9 9 0 0 1-9-9z" fill="#f2c230"/><path d="M12 12H3a9 9 0 0 1 9-9z" fill="#2fa35b"/></svg>'
  };
  const K = { local: "passuno.v2", names: "passuno.names", online: "passuno.online", me: "passuno.me" };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  let mode = null;        // "local" | "online" | null
  let L = null;           // local engine state
  let hidden = true;      // local: hand-off screen is up
  let R = null;           // last online room message
  let V = null;           // view currently on screen
  let sel = null;         // selected card id (tap fallback)
  let pendingWild = null;
  let server = null;      // /info of the Pass-Uno server, null when there is none
  let tab = "online";
  let goalLocal = 500, goalOnline = 500;
  let names = store.get(K.names) || ["", "", ""];
  let lastTurn = null;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const myTurn = () => !!V && (V.phase === "play" || V.phase === "drawn") && V.cur === V.me;
  const fits = (c) => c.c === "w" || c.c === V.color || c.v === V.top.v;
  const playable = (c) => myTurn() && (V.phase === "drawn" ? c.id === V.drawnId && fits(c) : fits(c));
  const pname = (i) => (i === V.me && mode === "online" ? "du" : V.players[i].name);
  function whyNot(c) {
    if (!myTurn()) return `Warte, ${V.players[V.cur].name} ist dran.`;
    if (V.phase === "drawn" && c.id !== V.drawnId) return "Nach dem Ziehen darfst du nur die gezogene Karte legen.";
    return `Passt nicht. Gesucht: ${G.CNAME[V.color]} oder ${V.top.c === "w" ? "eine Farbwahl-Karte" : G.VNAME[V.top.v] || V.top.v}.`;
  }
  const sortHand = (h) => [...h].sort((a, b) =>
    "rygbw".indexOf(a.c) - "rygbw".indexOf(b.c) || ORDER.indexOf(a.v) - ORDER.indexOf(b.v) || a.id - b.id);

  function cardHTML(c, extra = "", tag = "span") {
    let mid, corner;
    if (G.isNum(c)) { const u = c.v === "6" || c.v === "9" ? ' class="u"' : ""; mid = `<span${u}>${c.v}</span>`; corner = mid; }
    else if (c.v === "skip" || c.v === "rev") { mid = ICON[c.v]; corner = ICON[c.v]; }
    else if (c.v === "d2") { mid = corner = "+2"; }
    else if (c.v === "d4") { mid = corner = "+4"; }
    else { mid = ""; corner = ICON.wildMini; }
    const attrs = tag === "button" ? ` type="button" aria-label="${G.cardName(c)}"` : ` role="img" aria-label="${G.cardName(c)}"`;
    return `<${tag} class="card c-${c.c} ${extra}" data-id="${c.id}"${attrs}>` +
      `<span class="corner tl">${corner}</span><span class="oval"><span class="mid">${mid}</span></span><span class="corner br">${corner}</span></${tag}>`;
  }

  let toastT;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.remove("off");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("off"), 2800);
  }
  function flashUno(who) {
    const f = $("#unoFlash"); $("#unoWho").textContent = who || "";
    f.hidden = false;
    const s = f.firstElementChild; s.style.animation = "none"; void s.offsetWidth; s.style.animation = "";
    clearTimeout(flashUno.t); flashUno.t = setTimeout(() => { f.hidden = true; }, 800);
  }
  function shake(id) {
    const el = document.querySelector(`#hand [data-id="${id}"]`);
    if (el) { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }
  }
  const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

  // ---------- actions ----------
  function doAct(a) {
    if (mode === "local") {
      const before = L.turn, actor = L.cur;
      const res = G.act(L, actor, a);
      if (!res.ok) { toast(res.error); return false; }
      sel = null;
      for (const ev of res.events || []) {
        if (ev.t === "uno") flashUno();
        if (ev.t === "penalty") toast(`${L.players[ev.pi].name} hat UNO vergessen: 2 Strafkarten!`);
        if (ev.t === "drew" && L.turn !== before) {
          const c = L.players[ev.pi].hand.find((x) => x.id === ev.id);
          if (c) toast(`Gezogen: ${G.cardName(c)}. Passt nicht, dein Zug ist vorbei.`);
        }
      }
      if (L.phase !== "roundEnd" && L.turn !== before) hidden = true;
      store.set(K.local, L);
      render();
      return true;
    }
    if (mode === "online") {
      if (!wsSend({ t: "act", a })) { toast("Keine Verbindung zum Server."); return false; }
      sel = null;
      return true;
    }
    return false;
  }

  function tryPlay(id) {
    const c = V.hand.find((x) => x.id === id);
    if (!c) return false;
    if (!playable(c)) { shake(id); toast(whyNot(c)); return false; }
    if (c.c === "w") { pendingWild = id; $("#picker").hidden = false; return true; }
    return doAct({ t: "play", id });
  }
  function tryDraw() {
    if (!myTurn()) { toast(V ? `Warte, ${V.players[V.cur].name} ist dran.` : ""); return; }
    if (V.phase !== "play") { toast("Du hast schon gezogen. Leg die Karte oder tippe „Behalten“."); return; }
    doAct({ t: "draw" });
  }
  function tapCard(id) {
    const c = V.hand.find((x) => x.id === id); if (!c) return;
    if (!playable(c)) { shake(id); toast(whyNot(c)); return; }
    if (sel === id) { tryPlay(id); return; }
    sel = id; renderGame();
    toast("Zieh die Karte auf den Ablagestapel oder tippe sie nochmal an.");
  }

  // ---------- drag and drop ----------
  let drag = null;
  function dropZone(kind, y) {
    const dock = $("#dock").getBoundingClientRect();
    if (kind === "card") return y < dock.top - 10;
    return y > dock.top - 30;
  }
  function onDown(e) {
    if (e.button > 0 || drag) return;
    const cardEl = e.target.closest("#hand .card[data-id]");
    const deckEl = e.target.closest("#drawPile");
    if (cardEl) drag = { kind: "card", id: +cardEl.dataset.id, el: cardEl };
    else if (deckEl) drag = { kind: "deck", el: deckEl.querySelector(".card:last-child") };
    else return;
    Object.assign(drag, { pid: e.pointerId, x0: e.clientX, y0: e.clientY, active: false });
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < 9) return;
      if (drag.kind === "card" && Math.abs(dy) < Math.abs(dx) * 0.8) { drag = null; return; } // sideways: scroll the hand
      if (!myTurn()) { toast(`Warte, ${V.players[V.cur].name} ist dran.`); drag = null; return; }
      if (drag.kind === "deck" && V.phase !== "play") { toast("Du hast schon gezogen."); drag = null; return; }
      if (drag.kind === "card") {
        const c = V.hand.find((x) => x.id === drag.id);
        if (!c || !playable(c)) { shake(drag.id); toast(c ? whyNot(c) : ""); drag = null; return; }
      }
      const r = drag.el.getBoundingClientRect();
      const g = drag.el.cloneNode(true);
      g.classList.remove("sel", "fresh", "no", "shake");
      g.classList.add("ghost");
      g.style.width = r.width + "px";
      g.style.setProperty("--cw", r.width + "px");
      document.body.appendChild(g);
      drag.ghost = g; drag.ox = drag.x0 - r.left; drag.oy = drag.y0 - r.top;
      drag.active = true;
      if (drag.kind === "card") drag.el.classList.add("lifted"); else $("#drawPile").classList.add("dragging");
      buzz(10);
    }
    e.preventDefault();
    const x = e.clientX - drag.ox, y = e.clientY - drag.oy;
    drag.ghost.style.transform = `translate(${x}px,${y}px) rotate(${Math.max(-12, Math.min(12, dx / 12))}deg) scale(1.06)`;
    const over = dropZone(drag.kind, e.clientY);
    $("#discard").classList.toggle("drop", drag.kind === "card" && over);
    $("#dock").classList.toggle("drop", drag.kind === "deck" && over);
  }
  function endDrag(e, cancelled) {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    const d = drag; drag = null;
    $("#discard").classList.remove("drop"); $("#dock").classList.remove("drop"); $("#drawPile").classList.remove("dragging");
    if (!d.active) {
      if (cancelled) return;
      if (d.kind === "card") tapCard(d.id); else tryDraw();
      return;
    }
    d.ghost.remove();
    const el = document.querySelector(`#hand [data-id="${d.id}"]`); if (el) el.classList.remove("lifted");
    if (cancelled || !dropZone(d.kind, e.clientY)) return;
    if (d.kind === "card") tryPlay(d.id); else tryDraw();
  }
  document.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", (e) => endDrag(e, false));
  window.addEventListener("pointercancel", (e) => endDrag(e, true));
  // keyboard users: Enter/Space on a card or the pile
  $("#hand").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b && e.detail === 0) tapCard(+b.dataset.id); });
  $("#drawPile").addEventListener("click", (e) => { if (e.detail === 0) tryDraw(); });
  document.addEventListener("contextmenu", (e) => { if (e.target.closest(".card")) e.preventDefault(); });

  // ---------- rendering ----------
  function showScreen(id) {
    for (const s of ["home", "lobby", "game"]) $("#" + s).hidden = s !== id;
  }

  function render() {
    if (mode === "local" && L) {
      V = G.view(L, L.cur);
      showScreen("game");
      renderGame();
      $("#handoff").hidden = !(hidden && L.phase !== "roundEnd");
      if (!$("#handoff").hidden) renderHandoff();
    } else if (mode === "online" && R) {
      $("#handoff").hidden = true;
      if (!R.view) { V = null; showScreen("lobby"); renderLobby(); $("#roundEnd").hidden = true; }
      else { V = R.view; showScreen("game"); renderGame(); }
    } else {
      V = null;
      $("#handoff").hidden = true; $("#roundEnd").hidden = true;
      showScreen("home"); renderHome();
    }
    $("#net").hidden = !(mode === "online" && wantOnline && !(ws && ws.readyState === 1));
  }

  function fanMini(n) {
    const k = Math.min(n, 12), spread = Math.min(11, 70 / Math.max(k, 1));
    let h = "";
    for (let i = 0; i < k; i++) h += `<i style="transform:rotate(${((i - (k - 1) / 2) * spread).toFixed(1)}deg)"></i>`;
    return h;
  }

  function renderGame() {
    const n = V.players.length;
    const members = mode === "online" && R ? R.members : null;
    // opponents in seating order, starting with the player after me
    let opps = "";
    for (let k = 1; k < n; k++) {
      const i = (V.me + k) % n, p = V.players[i];
      const away = members && !members[i].online;
      const cls = ["opp", i === V.cur && V.phase !== "roundEnd" ? "active" : "", away ? "away" : ""].join(" ");
      opps += `<div class="${cls}" data-seat="${i}" title="${esc(p.name)}: ${p.count} Karten${away ? " (offline)" : ""}">` +
        `<span class="ocount">${p.count}</span><div class="fanmini">${fanMini(p.count)}</div>` +
        `<div class="oname">${esc(p.name)}</div>${p.count === 1 ? '<span class="ouno">UNO</span>' : ""}</div>`;
    }
    const oppsEl = $("#opps");
    oppsEl.innerHTML = opps;
    const act = oppsEl.querySelector(".opp.active");
    if (act) oppsEl.scrollLeft = act.offsetLeft - (oppsEl.clientWidth - act.offsetWidth) / 2;

    // table
    const disc = $("#discard");
    if (disc.dataset.top !== String(V.top.id)) { disc.innerHTML = cardHTML(V.top); disc.dataset.top = V.top.id; }
    disc.style.setProperty("--ring", CVAR[V.color]);
    $("#colorTag").style.setProperty("--ring", CVAR[V.color]);
    $("#colorName").textContent = `Farbe: ${G.CNAME[V.color]}`;
    $("#deckCount").textContent = `${V.deckCount} Karten`;
    $("#dir").classList.toggle("ccw", V.dir < 0);
    $("#dirText").textContent = `Danach: ${pname(V.next)}`;
    $("#drawPile").classList.toggle("can", myTurn() && V.phase === "play");

    // dock
    const mine = myTurn();
    $("#dock").classList.toggle("myturn", mine);
    const drawn = V.drawnId != null ? V.hand.find((c) => c.id === V.drawnId) : null;
    let who, hint;
    if (V.phase === "roundEnd") { who = "Runde vorbei"; hint = ""; }
    else if (mine) {
      who = mode === "local" ? `${V.players[V.me].name}, du bist dran` : "Du bist dran";
      if (V.phase === "drawn" && drawn) hint = `Gezogen: ${G.cardName(drawn)}. Leg sie auf den Stapel oder behalte sie.`;
      else hint = V.hand.some(fits) ? "Zieh eine helle Karte auf den Ablagestapel." : "Nichts passt. Zieh eine Karte vom Stapel zu dir.";
    } else {
      who = `${V.players[V.cur].name} ist dran`;
      hint = V.log[V.log.length - 1] || "";
    }
    $("#whoName").textContent = who;
    $("#whoHint").textContent = hint;
    $("#keepBtn").hidden = !(mine && V.phase === "drawn");
    const unoBtn = $("#unoBtn");
    unoBtn.hidden = !(mine && V.hand.length === 2);
    unoBtn.classList.toggle("on", !!V.uno);
    unoBtn.textContent = V.uno ? "✓ UNO" : "UNO!";

    // hand
    if (sel != null && !V.hand.some((c) => c.id === sel && playable(c))) sel = null;
    const hand = $("#hand");
    hand.innerHTML = sortHand(V.hand).map((c) => {
      const ok = playable(c);
      const cls = [mine && !ok ? "no" : "", c.id === sel ? "sel" : "", c.id === V.drawnId ? "fresh" : ""].join(" ");
      return cardHTML(c, cls, "button");
    }).join("");
    layoutHand();

    // turn change feedback
    const key = `${V.round}:${V.turn}`;
    if (mode === "online" && mine && lastTurn !== key && lastTurn !== null) buzz([40, 60, 40]);
    lastTurn = key;

    $("#roundEnd").hidden = V.phase !== "roundEnd";
    if (V.phase === "roundEnd") renderRoundEnd();
  }

  function layoutHand() {
    const hand = $("#hand"), first = hand.querySelector(".card");
    if (!first) return;
    const n = V.hand.length, cw = first.offsetWidth, W = hand.clientWidth - 8;
    let step = cw + 6;
    if (n > 1 && n * cw + (n - 1) * 6 > W) step = Math.max((W - cw) / (n - 1), cw * 0.42);
    hand.style.setProperty("--step", step + "px");
    const s = hand.querySelector(".sel, .fresh");
    if (s && (s.offsetLeft < hand.scrollLeft || s.offsetLeft + cw > hand.scrollLeft + hand.clientWidth)) hand.scrollLeft = s.offsetLeft - W / 2;
  }
  window.addEventListener("resize", () => { if (V) layoutHand(); });

  function renderHandoff() {
    $("#hoName").textContent = V.players[V.me].name;
    const others = V.players.filter((_, i) => i !== V.me).map((p) => `${p.name} ${p.count}`).join(" · ");
    $("#hoMeta").textContent = `Du hast ${V.hand.length} Karten. Die anderen: ${others}`;
    $("#hoLog").innerHTML = V.log.slice(-4).map((l) => `<li>${esc(l)}</li>`).join("");
    $("#hoBtn").textContent = `Ich bin ${V.players[V.me].name}, Karten zeigen`;
  }

  function scoreList(el, winner) {
    const ranked = V.players.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score);
    el.innerHTML = ranked.map((p) =>
      `<li class="${p.i === winner ? "win" : ""}"><span>${esc(p.name)}${p.i === V.me && mode === "online" ? " (du)" : ""}</span><b>${p.score} Pkt.</b></li>`).join("");
  }

  function renderRoundEnd() {
    const last = V.last, w = V.players[last.winner];
    const winnerName = mode === "online" && last.winner === V.me ? "Du gewinnst" : `${w.name} gewinnt`;
    $("#reLabel").textContent = last.over ? "Spiel vorbei" : `Runde ${V.round} vorbei`;
    $("#reTitle").textContent = `${winnerName} ${last.over ? "das Spiel" : "die Runde"}!`;
    $("#reText").textContent = `${last.pts} Punkte aus den Karten der anderen.` + (V.goal > 0 && !last.over ? ` Gespielt wird bis ${V.goal}.` : "");
    scoreList($("#reScores"), last.winner);
    $("#reBtn").textContent = last.over ? "Revanche" : "Nächste Runde";
    const back = $("#reBack");
    if (mode === "local") { back.hidden = false; back.textContent = "Zur Spieler-Auswahl"; }
    else { back.hidden = R.host !== V.me; back.textContent = "Zurück in den Warteraum"; }
  }

  function renderHome() {
    for (const b of document.querySelectorAll("#modeTabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
    $("#onlinePanel").hidden = tab !== "online" || !server;
    $("#onlineOff").hidden = tab !== "online" || !!server;
    $("#localPanel").hidden = tab !== "local";
    for (const b of document.querySelectorAll("#goalOnline button")) b.setAttribute("aria-pressed", String(+b.dataset.goal === goalOnline));
    for (const b of document.querySelectorAll("#goalLocal button")) b.setAttribute("aria-pressed", String(+b.dataset.goal === goalLocal));

    const saved = store.get(K.local);
    $("#resumePanel").hidden = !(saved && saved.players);
    if (saved && saved.players) $("#resumeHint").textContent = `${saved.players.map((p) => p.name).join(", ")} · Runde ${saved.round}`;
    const list = $("#plist");
    if (!list.contains(document.activeElement)) {
      list.innerHTML = names.map((n, i) =>
        `<div class="prow"><span class="seat">${i + 1}</span>` +
        `<input class="field" id="pname-${i}" data-i="${i}" maxlength="18" autocomplete="off" enterkeyhint="next" placeholder="Spieler ${i + 1}" value="${esc(n)}">` +
        (names.length > 2 ? `<button class="rm" type="button" data-rm="${i}" aria-label="Spieler ${i + 1} entfernen">×</button>` : "") +
        `</div>`).join("");
    }
    $("#addPlayer").hidden = names.length >= 10;
  }

  function joinUrl() {
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    const base = local && server && server.ips && server.ips.length
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
    const on = R.members.filter((m) => m.online).length;
    $("#membersLabel").textContent = `Spieler (${R.members.length}/10)`;
    $("#members").innerHTML = R.members.map((m, i) =>
      `<li class="${i === R.you ? "me" : ""}"><span class="on${m.online ? "" : " off"}"></span><span class="nm">${esc(m.name)}</span>` +
      `${i === R.host ? '<span class="tag">Host</span>' : ""}${i === R.you ? '<span class="tag">du</span>' : ""}</li>`).join("");
    const host = R.you === R.host;
    $("#startOnline").hidden = !host;
    $("#startOnline").disabled = R.members.length < 2;
    const goalTxt = R.goal ? `Gespielt wird bis ${R.goal} Punkte.` : "Gespielt wird eine Runde.";
    $("#lobbyHint").textContent = host
      ? (R.members.length < 2 ? `Warte auf Mitspieler. ${goalTxt}` : `${on} von ${R.members.length} online. ${goalTxt}`)
      : `Warte, bis ${R.members[R.host].name} das Spiel startet. ${goalTxt}`;
  }

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

  // ---------- online connection ----------
  let ws = null, wantOnline = false, retry = 0, queue = [];
  function connect() {
    if (ws && ws.readyState <= 1) return;
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws.onopen = () => {
      retry = 0;
      const s = store.get(K.online);
      if (s && !queue.some((m) => m.t === "create" || m.t === "join")) ws.send(JSON.stringify({ t: "resume", code: s.code, secret: s.secret }));
      for (const m of queue.splice(0)) ws.send(JSON.stringify(m));
      render();
    };
    ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = () => {
      ws = null;
      if (wantOnline) setTimeout(connect, Math.min(8000, 400 * 2 ** retry++));
      render();
    };
  }
  function wsSend(m) {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; }
    if (m.t === "create" || m.t === "join") { queue.push(m); wantOnline = true; connect(); return true; }
    return false;
  }
  function onMsg(m) {
    if (m.t === "joined") {
      store.set(K.online, { code: m.code, secret: m.secret });
      mode = "online";
      if (location.search) history.replaceState(null, "", location.pathname);
      wake();
    } else if (m.t === "room") {
      R = m; mode = "online";
      if (m.view) {
        const v = m.view;
        for (const ev of m.events || []) {
          if (ev.t === "uno") flashUno(ev.pi === v.me ? "" : v.players[ev.pi].name);
          if (ev.t === "penalty") toast(ev.pi === v.me ? "UNO vergessen: 2 Strafkarten!" : `${v.players[ev.pi].name} hat UNO vergessen: 2 Strafkarten!`);
          if (ev.t === "drew" && ev.pi === v.me && v.drawnId == null) {
            const c = v.hand.find((x) => x.id === ev.id);
            if (c) toast(`Gezogen: ${G.cardName(c)}. Passt nicht, dein Zug ist vorbei.`);
          }
        }
      }
      render();
    } else if (m.t === "error") {
      toast(m.msg);
    } else if (m.t === "gone" || m.t === "left") {
      store.del(K.online); R = null; mode = null; wantOnline = false;
      if (ws) ws.close();
      if (m.t === "gone") toast("Diesen Raum gibt es nicht mehr.");
      render();
    }
  }

  // ---------- events ----------
  $("#fan").innerHTML = [{ id: -1, c: "r", v: "7" }, { id: -2, c: "y", v: "skip" }, { id: -3, c: "g", v: "d2" }, { id: -4, c: "w", v: "d4" }].map((c) => cardHTML(c)).join("");
  $("#modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; renderHome(); } });
  $("#goalOnline").addEventListener("click", (e) => { const b = e.target.closest("[data-goal]"); if (b) { goalOnline = +b.dataset.goal; renderHome(); } });
  $("#goalLocal").addEventListener("click", (e) => { const b = e.target.closest("[data-goal]"); if (b) { goalLocal = +b.dataset.goal; renderHome(); } });

  $("#myName").value = store.get(K.me) || "";
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
    wsSend({ t: "join", code, name: n });
  }
  $("#joinBtn").addEventListener("click", join);
  $("#joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  $("#createBtn").addEventListener("click", () => {
    const n = myName(); if (!n) return;
    store.del(K.online);
    wsSend({ t: "create", name: n, goal: goalOnline });
  });

  $("#plist").addEventListener("input", (e) => { if (e.target.dataset.i != null) { names[+e.target.dataset.i] = e.target.value; store.set(K.names, names); } });
  $("#plist").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) { names.splice(+b.dataset.rm, 1); store.set(K.names, names); renderHome(); } });
  $("#plist").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const nx = document.getElementById(`pname-${+e.target.dataset.i + 1}`);
    if (nx) nx.focus(); else e.target.blur();
  });
  $("#addPlayer").addEventListener("click", () => {
    if (names.length >= 10) return;
    names.push(""); renderHome();
    const el = document.getElementById(`pname-${names.length - 1}`); if (el) el.focus();
  });
  $("#startLocal").addEventListener("click", () => {
    L = G.newGame(names.map((n, i) => n.trim() || `Spieler ${i + 1}`), goalLocal);
    mode = "local"; hidden = true; store.set(K.local, L); render(); wake();
  });
  $("#resumeBtn").addEventListener("click", () => {
    L = store.get(K.local); if (!L) return render();
    mode = "local"; hidden = true; render(); wake();
  });

  $("#startOnline").addEventListener("click", () => wsSend({ t: "start" }));
  $("#leaveLobby").addEventListener("click", () => wsSend({ t: "leave" }));
  $("#copyBtn").addEventListener("click", () => {
    const url = $("#joinUrl").textContent;
    const ok = () => toast("Link kopiert.");
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($("#joinUrl")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Link markiert, jetzt kopieren."); };
    try { navigator.clipboard.writeText(url).then(ok, fallback); } catch (e) { fallback(); }
  });

  $("#hoBtn").addEventListener("click", () => { hidden = false; render(); });
  $("#unoBtn").addEventListener("click", () => doAct({ t: "uno" }));
  $("#keepBtn").addEventListener("click", () => doAct({ t: "keep" }));
  $("#picker").addEventListener("click", (e) => {
    const b = e.target.closest("[data-color]"); if (!b) return;
    $("#picker").hidden = true;
    const id = pendingWild; pendingWild = null;
    if (id != null) doAct({ t: "play", id, color: b.dataset.color });
  });
  $("#pickCancel").addEventListener("click", () => { $("#picker").hidden = true; pendingWild = null; });

  $("#reBtn").addEventListener("click", () => doAct({ t: "next" }));
  $("#reBack").addEventListener("click", () => {
    if (mode === "local") { store.del(K.local); L = null; mode = null; render(); }
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
    scoreList($("#menuScores"), -1);
    const box = $("#menuActions"); box.innerHTML = "";
    if (mode === "local") {
      box.append(
        armed("Runde neu mischen", () => { L.round--; G.startRound(L); hidden = true; store.set(K.local, L); render(); }),
        armed("Spiel beenden", () => { store.del(K.local); L = null; mode = null; render(); })
      );
    } else if (mode === "online" && R) {
      if (R.you === R.host && V && (V.phase === "play" || V.phase === "drawn") && V.cur !== V.me)
        box.append(armed(`${V.players[V.cur].name} überspringen`, () => wsSend({ t: "act", a: { t: "skip" } })));
      if (R.you === R.host) box.append(armed("Spiel beenden, zurück in den Warteraum", () => wsSend({ t: "end" })));
      box.append(armed("Raum verlassen", () => wsSend({ t: "leave" })));
    }
    $("#menu").hidden = false;
  });
  $("#menuClose").addEventListener("click", () => { $("#menu").hidden = true; });

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
  async function detectServer() {
    if (!/^https?:$/.test(location.protocol)) return null;
    try {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 2500);
      const r = await fetch("/info", { cache: "no-store", signal: ctl.signal });
      const j = await r.json();
      return j && j.uno ? j : null;
    } catch (e) { return null; }
  }
  const code = new URLSearchParams(location.search).get("r");
  if (code) $("#joinCode").value = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  tab = "local";
  render();
  detectServer().then((info) => {
    server = info;
    tab = server ? "online" : "local";
    if (server && store.get(K.online) && !code) { wantOnline = true; connect(); }
    render();
    if (server && code && !$("#myName").value) $("#myName").focus();
  });
})();
