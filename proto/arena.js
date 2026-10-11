/* proto/arena.js — キービジュ案5-1「硝子のアリーナ」の試作画面（Obsidian キービジュ案.md scs.proto1）。
 * 戦闘は本物のエンジン squad.js（無改変）。戦場「遺跡の円形広場」はこのページだけで追加し、壁・川・溶岩の当たり判定は地図の絵（assets/map_plaza.jpg）に合わせて引いた。
 * 描画の順：地図→溶岩の揺らぎ→狙い線→残像→駒→注目の輪→演出→吹き出し。パネルは DOM。
 * 6対6（エンジンは2陣営）。プレーヤーは何も操作しない＝下のボタンは観戦用（一時停止・速度・吹き出し・注目・次の戦い）。 */
(function () {
  "use strict";
  const D = SCS.DATA;
  const W = 1920, H = 1080, FW = 160, FH = 90, PX = W / FW, R = 41;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const Q = new URLSearchParams(location.search), DEBUG = Q.has("debug");

  // ===== 戦場：地図の絵に合わせた当たり判定（160×90・1単位＝12px）=====
  const o = (x, y, w, h) => ({ x, y, w, h }), t = (x, y, w, h, k) => ({ x, y, w, h, t: k });
  const ARENA = {
    key: "plaza", name: "遺跡の円形広場", flavor: "川と溶岩に挟まれた古い広場。中央の円盤は見晴らしの良い高台", w: FW, h: FH, base: "plains",
    obstacles: [
      o(41, 3.5, 17, 2), o(41, 3.5, 2, 15.5), o(55, 3.5, 3, 7), o(47, 17, 5, 2.5), o(55, 14.5, 3, 4.5),     // 北の廃屋
      o(31, 25, 2.5, 6.5), o(31, 29, 9.5, 3),                                                              // 西の鉤形の壁
      o(76.5, 5.5, 3, 9), o(80, 11.5, 11, 2.5), o(90, 13, 1.5, 5),                                          // 北の崩れ壁
      o(101, 3, 14, 2.5), o(99.5, 5, 3.5, 14.5), o(113, 5, 3, 13), o(103, 16.5, 7, 3),                       // 北東の廃屋
      o(103.5, 31.5, 5, 3), o(113, 31.5, 6, 3), o(103.5, 31.5, 2.5, 16.5), o(116, 33, 3, 13), o(104, 45.5, 6, 3), // 東の廃屋
      o(101, 63, 17, 3.5), o(100.5, 64, 3.5, 16), o(115, 63, 4, 12), o(103, 76.5, 9, 3.5), o(114, 75, 4, 4),  // 南東の廃屋
      o(113, 53, 5, 2), o(80, 78, 4.5, 3), o(32, 48, 2.5, 10),                                              // 石の欠片・柱
      o(41, 65.5, 18, 3.5), o(42, 66, 3.5, 18), o(56.5, 66, 3, 13), o(42, 80.5, 15.5, 3.5),                  // 南西の廃屋
      o(67.5, 68, 2, 6), o(67.5, 72, 12.5, 3),                                                              // 南の崩れ壁
    ],
    terrain: [
      t(51, 31, 22, 22, "highground"),                                         // 中央の円盤（羅針盤）
      t(9, 0, 16, 38.5, "swamp"), t(9, 46, 16, 44, "swamp"),                   // 西の川（橋 y38.5〜46 は通れる）
      t(129.5, 0, 23.5, 37.5, "lava"), t(129.5, 46, 23.5, 44, "lava"),         // 東の溶岩（橋 y37.5〜46）
      t(0, 0, 9, 90, "forest"), t(25, 0, 16, 12, "forest"), t(58, 0, 18, 8, "forest"), t(25, 68, 16, 22, "forest"),
      t(58, 80, 42, 10, "forest"), t(119, 0, 10.5, 30, "forest"), t(119, 50, 10.5, 40, "forest"), t(153, 0, 7, 90, "forest"),
    ],
    start: { p: { x: 36, y: 45 }, c: { x: 124, y: 45 } },
  };
  if (!D.ARENAS.some((a) => a.key === ARENA.key)) D.ARENAS.push(ARENA);

  // ===== 駒の紋章＝人格の色合い（外見はほぼ同じ、違いは中身）=====
  const EMB = ["wolf", "flame", "shield", "frost", "skull", "leaf", "sun", "crown"];
  const EMB_NAME = { wolf: "WOLF", flame: "FLAME", shield: "AEGIS", frost: "FROST", skull: "SKULL", leaf: "LEAF", sun: "SOL", crown: "CROWN" };
  const IMG = {}; EMB.forEach((k) => { const im = new Image(); im.src = "assets/emblem/" + k + ".png"; IMG[k] = im; });
  const mapImg = new Image(); mapImg.src = "assets/map_plaza.jpg";
  const miniImg = new Image(); miniImg.src = "assets/map_plaza_mini.jpg";
  function embScores(c) {
    const [bel, risk, comp, pat, disc, adapt, pride, ruth, conf, cur] = c;
    return { wolf: bel * 1.2 + (3 - pat) * 0.6, flame: risk * 1.1 + (3 - comp) * 0.7, shield: (3 - bel) + pat * 0.6 + disc * 0.3, frost: comp + disc * 0.6,
      skull: ruth * 1.1 + (3 - pride) * 0.6, leaf: adapt * 0.8 + cur * 0.8, sun: pride * 1.1 + conf * 0.5, crown: conf + pride * 0.4 + disc * 0.3 };
  }
  function assignEmblems(team) { const used = new Set(); return team.map((c) => { const s = embScores(c); const k = EMB.filter((e) => !used.has(e)).sort((a, b) => s[b] - s[a])[0]; used.add(k); return k; }); }
  function wordsOf(c) { return c.map((v, i) => ({ i, v, e: Math.abs(v - 1.5) })).sort((a, b) => b.e - a.e || a.i - b.i).slice(0, 2).map((x) => D.MACROS[x.i].poles[x.v]).join("・"); }
  const PK = Object.keys(D.PRESETS);
  function makeTeam(g) {
    const pool = PK.slice(), out = [];
    for (let i = 0; i < 6; i++) {
      const c = D.PRESETS[pool.splice(g.int(pool.length), 1)[0]].slice();
      for (let j = 0; j < 2; j++) { const a = g.int(10); c[a] = clamp(c[a] + (g.chance(0.5) ? 1 : -1), 0, 3); } // 型から少しずらす
      out.push(c);
    }
    return out;
  }

  // ===== 状態 =====
  const cv = $("cv"), ctx = cv.getContext("2d"), mini = $("mini"), mctx = mini.getContext("2d");
  let S = 1, clock = 0, lastReal = 0, speed = 1, paused = false, whyOn = true;
  let battle = null, views = [], seed = (Number(Q.get("seed")) || (Date.now() & 0x7fffffff)) >>> 0, battleNo = 0, kills = 0;
  let turnStart = 0, nextTurnAt = 0, overAt = 0, focus = null, focusUntil = 0, focusLock = 0, lastLines = [], hist = [], why = "";
  const TURN = 1000, fx = [], ZOOM = 1.25, cam = { x: W / 2, y: H / 2 }; // 自動カメラ：戦いの中心を少し寄って追う（キービジュの寄りの画角）

  function newBattle() {
    battleNo++;
    if (battleNo > 1 || !Q.get("seed")) seed = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0) || 7;
    const g = SCS.makeRNG(seed);
    const pc = makeTeam(g), cc = makeTeam(g), pe = assignEmblems(pc), ce = assignEmblems(cc);
    const used = new Set(), nm = (e) => { let n; do n = EMB_NAME[e] + "-" + (1 + g.int(9)); while (used.has(n)); used.add(n); return n; };
    const pn = pe.map(nm), cn = ce.map(nm);
    battle = SCS.makeSquadBattle(pc, cc, seed, ARENA.name, "通常", "散開", "散開", pn, cn);
    views = battle.teams.P.concat(battle.teams.C).map((u) => {
      const P = u.team === "P", a = Math.atan2(u.faceY, u.faceX);
      return { u, emb: (P ? pe : ce)[u.idx], words: wordsOf((P ? pc : cc)[u.idx]), x: u.x, y: u.y, fx: u.x, fy: u.y, tx: u.x, ty: u.y, trail: [], icon: "dots", iconT: -1e9, hitT: -1e9, koT: 0, ang: a, ang0: a, ang1: a, hp0: u.hp };
    });
    separate(true);
    kills = 0; focus = null; focusUntil = 0; focusLock = 0; fx.length = 0; overAt = 0; lastLines = []; hist = []; why = "";
    $("bTitle").textContent = "BATTLE " + battleNo; $("bSub").textContent = ARENA.name;
    $("result").classList.remove("show");
    turnStart = clock; nextTurnAt = clock + 900;
    chooseFocus(); updatePanels();
  }

  // 表示だけの押し離し：エンジンは点で戦うので、駒が重ならないよう描く位置だけずらす（戦闘には一切影響しない）
  function separate(snap) {
    const minD = (R * 2 * 0.92) / PX, pts = views.map((v) => ({ v, x: v.u.x, y: v.u.y }));
    for (let it = 0; it < 6; it++) for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j]; let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= minD) continue;
      if (d < 1e-3) { dx = i % 2 ? 1 : -1; dy = 0.35; d = Math.hypot(dx, dy); }
      const wa = a.v.u.alive ? 1 : 0.2, wb = b.v.u.alive ? 1 : 0.2, s = wa + wb, push = minD - d, ux = dx / d, uy = dy / d;
      a.x -= ux * push * wa / s; a.y -= uy * push * wa / s; b.x += ux * push * wb / s; b.y += uy * push * wb / s;
    }
    for (const p of pts) { p.v.tx = clamp(p.x, 3, FW - 3); p.v.ty = clamp(p.y, 3, FH - 3); if (snap) { p.v.x = p.v.fx = p.v.tx; p.v.y = p.v.fy = p.v.ty; } }
  }

  const ICON_OF = { 射撃: "aim", 集中: "aim", 斬: "swords", 背後: "swords", 側面: "swords", 剝がし: "swords", かばう: "shield", 盾: "shield", 遮蔽: "shield",
    立て直し: "run", 退避: "run", 必殺: "bang", 攻勢: "bang", 詰め: "bang", 装填: "reload", 温存: "dots", 索敵: "dots", 様子見: "dots", 待機: "dots" };
  const ACT_OF = { 射撃: "射撃中", 集中: "集中砲火", 斬: "斬り込み", 背後: "背後を突く", 側面: "側面を突く", 剝がし: "引き剝がし", かばう: "かばう", 盾: "盾になる", 遮蔽: "物陰に", 立て直し: "立て直し",
    退避: "退避中", 必殺: "必殺", 攻勢: "攻勢", 詰め: "詰め寄る", 装填: "装填中", 温存: "機を待つ", 索敵: "索敵中", 様子見: "様子見", 待機: "待機", 戦闘不能: "戦闘不能" };

  function doTurn() {
    for (const v of views) { v.fx = v.x; v.fy = v.y; v.hp0 = v.u.hp; v.ang0 = v.ang; }
    const res = battle.step();
    lastLines = res.lines || []; hist.unshift(lastLines); if (hist.length > 4) hist.pop();
    separate(false);
    for (const v of views) {
      const u = v.u;
      if (u.hp < v.hp0) v.hitT = clock + 240;
      if (!u.alive && !v.koT) { v.koT = clock + 320; kills++; }
      const ic = u.alive ? ICON_OF[u.label] || "dots" : null; if (ic !== v.icon) { v.icon = ic; v.iconT = clock; }
      v.ang1 = Math.atan2(u.faceY, u.faceX);
    }
    pushFx(res.events || []);
    chooseFocus();
    updatePanels();
    turnStart = clock;
    if (battle.over) { overAt = clock; showResult(); }
  }

  function nearestView(p) { let b = null, bd = 1e9; for (const v of views) { const d = Math.hypot(v.u.x - p.x, v.u.y - p.y); if (d < bd) { bd = d; b = v; } } return b; }
  function pushFx(events) {
    let k = 0;
    for (const e of events) {
      if (!e.from || !e.to) continue;
      const va = views.find((v) => v.u.team === (e.aTeam || e.team) && v.u.idx === e.aIdx) || nearestView(e.from), vb = nearestView(e.to);
      if (!va || !vb) continue;
      const t0 = clock + Math.min(300, k++ * 55), base = { t0, va, vb, team: va.u.team, hit: (e.hits || 0) > 0, crit: !!e.crit };
      const kind = { ranged: "tracer", melee: "slash", "ult-ranged": "beam", "ult-melee": "burst", dodge: "dodge", guard: "guard", counter: "slash", grab: "slash" }[e.type];
      if (!kind) continue;
      fx.push(Object.assign({}, base, { kind, dur: kind === "beam" || kind === "burst" ? 640 : 380 }));
      if (base.hit && kind !== "dodge" && kind !== "guard") fx.push(Object.assign({}, base, { kind: "impact", t0: t0 + (kind === "tracer" || kind === "beam" ? 210 : 120), dur: 340 }));
    }
    if (fx.length > 90) fx.splice(0, fx.length - 90);
  }

  // 注目：いま一番「そう来たか」に近い動きをした駒（必殺・退避・背後・かばう・大きく動いた）
  function interest(v) {
    const u = v.u; if (!u.alive) return -1;
    const L = u.label, base = { 必殺: 6, 退避: 4.2, 立て直し: 4, 背後: 3.6, 側面: 3, かばう: 3.4, 盾: 2.6, 斬: 2.5, 集中: 2, 剝がし: 2.6 }[L] || 0;
    return base + Math.min(3, Math.hypot(v.tx - v.fx, v.ty - v.fy) / 4) + (u.team === "P" ? 0.4 : 0);
  }
  function chooseFocus() {
    if (focus && focus.u.alive && clock < focusUntil) return;
    if (focus && focus.u.alive && clock < focusLock) return;
    let best = null, bs = -1; for (const v of views) { const s = interest(v); if (s > bs) { bs = s; best = v; } }
    if (best && best !== focus) { focus = best; focusUntil = clock + 3 * TURN; why = ""; } else focusUntil = clock + TURN;
  }
  const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/^[\s　─]+/, "").replace(/（[^）]*）/g, "").trim();
  function whyOf(v) {
    const n = v.u.name;                                                                    // 直近のターンから順に、その駒が主語の行（「〜ため、X は …した」）を探す
    for (const ls of hist) { const l = ls.find((x) => (x.cls === "ex" || x.cls === "cm") && x.text.indexOf(">" + n + "</span> は") >= 0); if (l) return strip(l.text); }
    for (const ls of hist) { const l = ls.find((x) => x.text.indexOf(">" + n + "</span>") >= 0 && x.cls !== "dim"); if (l) return strip(l.text); }
    return "";
  }

  function updatePanels() {
    if (!battle) return;
    $("cP").textContent = battle.teams.P.filter((u) => u.alive).length; $("cC").textContent = battle.teams.C.filter((u) => u.alive).length;
    $("cT").textContent = battle.turn; $("cK").textContent = kills;
    const v = focus; if (!v) return;
    const u = v.u, P = u.team === "P";
    $("fEmb").className = "f-emb" + (P ? "" : " c"); $("fImg").src = "assets/emblem/" + v.emb + ".png";
    $("fName").textContent = u.name; $("fWord").textContent = v.words;
    const hp = Math.max(0, Math.round(u.hp)); $("fHp").style.width = (clamp(u.hp / u.maxHp, 0, 1) * 100).toFixed(1) + "%"; $("fHpT").textContent = `${hp} / ${u.maxHp}`;
    const st = Math.round(clamp(u.stamina, 0, 1) * 100); $("fSt").style.width = st + "%"; $("fStT").textContent = `${st} / 100`;
    $("fAct").textContent = ACT_OF[u.label] || u.label || "待機";
    const w = whyOf(v); if (w) why = w; $("fWhy").textContent = why;
  }
  function showResult() {
    const r = battle.result || {}, win = r.winner === "PLR" ? "P" : r.winner === "CPU" ? "C" : null;
    $("rMain").textContent = win === "P" ? "青の勝利" : win === "C" ? "赤の勝利" : "引き分け"; $("rMain").className = "r-main" + (win === "C" ? " c" : "");
    $("rSub").textContent = `${r.text || "決着"}　${battle.turn} ターン`;
    $("result").classList.add("show");
  }

  // ===== 描画 =====
  const circ = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); };
  const teamCol = (P, a) => (P ? `rgba(80,170,255,${a})` : `rgba(255,80,80,${a})`);
  function drawMap() {
    if (mapImg.complete && mapImg.naturalWidth) ctx.drawImage(mapImg, 0, 0, W, H); else { ctx.fillStyle = "#1c2a1c"; ctx.fillRect(0, 0, W, H); }
    for (const [i, z] of ARENA.terrain.entries()) {                                           // 溶岩の揺らぎ
      if (z.t !== "lava") continue;
      ctx.fillStyle = `rgba(255,120,30,${0.05 + 0.05 * Math.sin(clock / 520 + i * 1.7)})`;
      ctx.globalCompositeOperation = "lighter"; ctx.fillRect(z.x * PX, z.y * PX, z.w * PX, z.h * PX); ctx.globalCompositeOperation = "source-over";
    }
    if (battle) for (const ob of battle.obstacles) if (ob.hp <= 0) { ctx.fillStyle = "rgba(28,22,16,.5)"; ctx.fillRect(ob.x * PX, ob.y * PX, ob.w * PX, ob.h * PX); } // 崩れた遮蔽
    if (DEBUG) {
      ctx.lineWidth = 2;
      for (const z of ARENA.terrain) { ctx.strokeStyle = { swamp: "#3cf", lava: "#f80", forest: "#3f6", highground: "#ff3" }[z.t] || "#fff"; ctx.strokeRect(z.x * PX, z.y * PX, z.w * PX, z.h * PX); }
      ctx.fillStyle = "rgba(255,0,255,.35)"; for (const ob of ARENA.obstacles) ctx.fillRect(ob.x * PX, ob.y * PX, ob.w * PX, ob.h * PX);
    }
  }
  function drawAim() {
    ctx.save(); ctx.setLineDash([16, 11]); ctx.lineWidth = 4.5; ctx.lineCap = "round";
    for (const v of views) {
      const u = v.u; if (!u.alive || !u.target || !u.target.alive) continue;
      if (!(u.label === "射撃" || u.label === "集中" || u.label === "必殺" || u.label === "温存")) continue;
      const tv = views.find((w) => w.u === u.target); if (!tv) continue;
      const ax = v.x * PX, ay = v.y * PX, bx = tv.x * PX, by = tv.y * PX, d = Math.hypot(bx - ax, by - ay); if (d < R * 2.4) continue;
      const ux = (bx - ax) / d, uy = (by - ay) / d, sx = ax + ux * (R + 6), sy = ay + uy * (R + 6), ex = bx - ux * (R + 10), ey = by - uy * (R + 10);
      ctx.strokeStyle = teamCol(u.team === "P", 0.85); ctx.shadowColor = teamCol(u.team === "P", 0.9); ctx.shadowBlur = 10;
      ctx.lineDashOffset = -clock / 40; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = teamCol(u.team === "P", 0.95); ctx.beginPath();          // 矢じり
      ctx.moveTo(ex + ux * 12, ey + uy * 12); ctx.lineTo(ex - uy * 9, ey + ux * 9); ctx.lineTo(ex + uy * 9, ey - ux * 9); ctx.closePath(); ctx.fill(); ctx.setLineDash([16, 11]);
    }
    ctx.restore();
  }
  function drawTrails() {
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
    for (const v of views) {
      const tr = v.trail; if (tr.length < 2) continue;
      const P = v.u.team === "P", strong = v.u.label === "退避" || v.u.label === "立て直し" || v === focus;
      for (let i = 1; i < tr.length; i++) {
        const a = tr[i - 1], b = tr[i], f = i / tr.length, age = clamp(1 - (clock - b.t) / 520, 0, 1);
        ctx.strokeStyle = teamCol(P, (strong ? 0.5 : 0.28) * f * age); ctx.lineWidth = R * (strong ? 1.5 : 1.0) * f;
        ctx.beginPath(); ctx.moveTo(a.x * PX, a.y * PX); ctx.lineTo(b.x * PX, b.y * PX); ctx.stroke();
        ctx.strokeStyle = `rgba(230,245,255,${(strong ? 0.55 : 0.25) * f * age})`; ctx.lineWidth = R * 0.18 * f;
        ctx.beginPath(); ctx.moveTo(a.x * PX, a.y * PX); ctx.lineTo(b.x * PX, b.y * PX); ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawToken(v) {
    const u = v.u, P = u.team === "P", dead = !u.alive && clock >= v.koT, hit = clock >= v.hitT && clock < v.hitT + 150;
    const sh = hit ? Math.sin(clock / 12) * 3 : 0, x = v.x * PX + sh, y = v.y * PX;
    const rimA = dead ? "#71767e" : P ? "#58aeff" : "#ff6262", rimB = dead ? "#3b3f45" : P ? "#0f4fcf" : "#b3161c", side = dead ? "#24272c" : P ? "#082a6e" : "#5e0b10";
    ctx.save();
    if (dead) ctx.globalAlpha = 0.82;
    if (!dead) { ctx.shadowColor = teamCol(P, 0.75); ctx.shadowBlur = 22; ctx.fillStyle = side; circ(ctx, x, y + 3, R); ctx.fill(); } // 陣営の色のにじみ
    ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 9;
    ctx.fillStyle = side; circ(ctx, x, y + 7, R); ctx.fill();                                  // 駒の厚み
    ctx.shadowColor = "transparent";
    const g = ctx.createLinearGradient(x, y - R, x, y + R); g.addColorStop(0, rimA); g.addColorStop(1, rimB);
    ctx.fillStyle = g; circ(ctx, x, y, R); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, R - 1.5, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    const fr = R * 0.72, fg = ctx.createRadialGradient(x - fr * 0.3, y - fr * 0.35, fr * 0.1, x, y, fr);
    fg.addColorStop(0, dead ? "#3a3c40" : "#4a505c"); fg.addColorStop(1, "#1b1e24"); ctx.fillStyle = fg; circ(ctx, x, y, fr); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 2.5; circ(ctx, x, y, fr); ctx.stroke();
    const im = IMG[v.emb]; if (im && im.complete && im.naturalWidth) { ctx.globalAlpha = dead ? 0.3 : 0.9; const s = fr * 1.22; ctx.drawImage(im, x - s / 2, y - s / 2, s, s); ctx.globalAlpha = dead ? 0.82 : 1; }
    if (!dead) {
      const f = clamp(u.hp / u.maxHp, 0, 1);                                                  // 縁の暗い弧＝失ったHP
      if (f < 0.999) { ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = R - fr - 3; ctx.beginPath(); ctx.arc(x, y, (R + fr) / 2, -Math.PI / 2 + f * Math.PI * 2, Math.PI * 1.5); ctx.stroke(); }
      const a = v.ang, nx = Math.cos(a), ny = Math.sin(a);                                      // 向きの切り欠き
      ctx.fillStyle = rimA; ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(x + nx * (R + 11), y + ny * (R + 11)); ctx.lineTo(x + nx * (R - 2) - ny * 9, y + ny * (R - 2) + nx * 9); ctx.lineTo(x + nx * (R - 2) + ny * 9, y + ny * (R - 2) - nx * 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 5; ctx.lineCap = "round"; const k = fr * 0.55;
      ctx.beginPath(); ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); ctx.stroke();
    }
    if (hit) { ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = "rgba(255,255,255,.55)"; circ(ctx, x, y, R); ctx.fill(); }
    ctx.restore();
  }
  function drawFocusRing() {
    const v = focus; if (!v || !v.u.alive) return;
    const x = v.x * PX, y = v.y * PX, P = v.u.team === "P";
    ctx.save(); ctx.shadowColor = teamCol(P, 1); ctx.shadowBlur = 22;
    ctx.strokeStyle = "rgba(235,248,255,.95)"; ctx.lineWidth = 4; circ(ctx, x, y, R + 9); ctx.stroke();
    ctx.setLineDash([10, 8]); ctx.lineDashOffset = clock / 30; ctx.strokeStyle = teamCol(P, 0.9); ctx.lineWidth = 3; circ(ctx, x, y, R + 17); ctx.stroke();
    ctx.restore();
  }
  function drawFx() {
    ctx.save(); ctx.lineCap = "round";
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], p = (clock - f.t0) / f.dur; if (p < 0) continue; if (p > 1) { fx.splice(i, 1); continue; }
      const P = f.team === "P", ax = f.va.x * PX, ay = f.va.y * PX, bx = f.vb.x * PX, by = f.vb.y * PX, d = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / d, uy = (by - ay) / d;
      const col = P ? "120,200,255" : "255,110,110";
      ctx.globalCompositeOperation = "lighter";
      if (f.kind === "tracer") {
        const h = clamp(p * 1.7, 0, 1), tl = clamp(p * 1.7 - 0.45, 0, 1), al = p > 0.7 ? (1 - p) / 0.3 : 1;
        const sx = ax + ux * R, sy = ay + uy * R, ex = bx - ux * R * 0.5, ey = by - uy * R * 0.5;
        ctx.shadowColor = `rgba(${col},1)`; ctx.shadowBlur = 14; ctx.strokeStyle = `rgba(${col},${0.9 * al})`; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(lerp(sx, ex, tl), lerp(sy, ey, tl)); ctx.lineTo(lerp(sx, ex, h), lerp(sy, ey, h)); ctx.stroke();
        ctx.shadowBlur = 0; ctx.strokeStyle = `rgba(255,255,255,${al})`; ctx.lineWidth = 1.8; ctx.stroke();
        if (p < 0.25) { ctx.fillStyle = `rgba(255,240,200,${1 - p * 4})`; circ(ctx, sx, sy, 10); ctx.fill(); }
      } else if (f.kind === "beam") {
        const al = 1 - p, sx = ax + ux * R, sy = ay + uy * R;
        ctx.shadowColor = `rgba(${col},1)`; ctx.shadowBlur = 26; ctx.strokeStyle = `rgba(${col},${0.85 * al})`; ctx.lineWidth = 18 * (1 - p * 0.5);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(bx, by); ctx.stroke(); ctx.shadowBlur = 0; ctx.strokeStyle = `rgba(255,255,255,${al})`; ctx.lineWidth = 5; ctx.stroke();
      } else if (f.kind === "slash") {
        const ang = Math.atan2(uy, ux), cx = bx - ux * R * 0.4, cy = by - uy * R * 0.4, rr = R * 1.45, sw = 2.3, a0 = ang - sw / 2 - Math.PI / 2 + 0.4, a1 = a0 + sw * clamp(p * 2.2, 0, 1), al = p > 0.55 ? (1 - p) / 0.45 : 1;
        const sc = P ? "140,220,255" : "255,90,130";
        ctx.shadowColor = `rgba(${sc},1)`; ctx.shadowBlur = 18;
        for (let k = 0; k < 3; k++) { ctx.strokeStyle = k === 2 ? `rgba(255,255,255,${al})` : `rgba(${sc},${(0.55 + k * 0.2) * al})`; ctx.lineWidth = [16, 9, 3][k]; ctx.beginPath(); ctx.arc(cx, cy, rr - k * 3, a0, a1); ctx.stroke(); }
      } else if (f.kind === "burst") {
        const al = 1 - p; ctx.shadowColor = `rgba(${col},1)`; ctx.shadowBlur = 24; ctx.strokeStyle = `rgba(${col},${al})`; ctx.lineWidth = 8 * al + 2; circ(ctx, bx, by, R * (1 + p * 1.8)); ctx.stroke();
        for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6 + p; ctx.beginPath(); ctx.moveTo(bx + Math.cos(a) * R * (0.8 + p), by + Math.sin(a) * R * (0.8 + p)); ctx.lineTo(bx + Math.cos(a) * R * (1.4 + p * 2), by + Math.sin(a) * R * (1.4 + p * 2)); ctx.stroke(); }
      } else if (f.kind === "impact") {
        const al = 1 - p; ctx.shadowColor = "rgba(255,200,90,1)"; ctx.shadowBlur = 18;
        ctx.fillStyle = `rgba(255,236,170,${0.75 * al})`; circ(ctx, bx, by, R * (0.35 + p * 0.7)); ctx.fill();
        ctx.strokeStyle = `rgba(255,190,80,${al})`; ctx.lineWidth = 3.5;
        for (let k = 0; k < 9; k++) { const a = k * 0.698 + (f.t0 % 7), r0 = R * (0.5 + p * 0.9), r1 = r0 + R * (0.35 + 0.25 * ((k * 37) % 5) / 5) * (f.crit ? 1.6 : 1); ctx.beginPath(); ctx.moveTo(bx + Math.cos(a) * r0, by + Math.sin(a) * r0); ctx.lineTo(bx + Math.cos(a) * r1, by + Math.sin(a) * r1); ctx.stroke(); }
      } else if (f.kind === "dodge") {
        ctx.strokeStyle = `rgba(220,240,255,${0.6 * (1 - p)})`; ctx.lineWidth = 3; ctx.setLineDash([6, 6]); circ(ctx, bx - ux * 14 * p, by - uy * 14 * p, R + 6); ctx.stroke(); ctx.setLineDash([]);
      } else if (f.kind === "guard") {
        const ang = Math.atan2(uy, ux); ctx.shadowColor = "rgba(120,220,255,1)"; ctx.shadowBlur = 20; ctx.strokeStyle = `rgba(150,230,255,${1 - p})`; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(ax, ay, R * 1.5, ang - 0.9, ang + 0.9); ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over"; ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
  function icon(kind, x, y, s) {
    const c = ctx; c.save(); c.translate(x, y); c.strokeStyle = c.fillStyle = "#1b2029"; c.lineWidth = s * 0.2; c.lineCap = c.lineJoin = "round";
    if (kind === "aim") { circ(c, 0, 0, s * 0.6); c.stroke(); c.beginPath(); c.moveTo(0, -s); c.lineTo(0, -s * 0.3); c.moveTo(0, s * 0.3); c.lineTo(0, s); c.moveTo(-s, 0); c.lineTo(-s * 0.3, 0); c.moveTo(s * 0.3, 0); c.lineTo(s, 0); c.stroke(); circ(c, 0, 0, s * 0.13); c.fill(); }
    else if (kind === "swords") { c.beginPath(); c.moveTo(-s * 0.8, -s * 0.8); c.lineTo(s * 0.55, s * 0.55); c.moveTo(s * 0.8, -s * 0.8); c.lineTo(-s * 0.55, s * 0.55); c.moveTo(-s * 0.8, s * 0.3); c.lineTo(-s * 0.3, s * 0.8); c.moveTo(s * 0.8, s * 0.3); c.lineTo(s * 0.3, s * 0.8); c.stroke(); }
    else if (kind === "shield") { c.beginPath(); c.moveTo(0, -s * 0.9); c.lineTo(s * 0.75, -s * 0.58); c.lineTo(s * 0.64, s * 0.2); c.quadraticCurveTo(s * 0.35, s * 0.72, 0, s * 0.92); c.quadraticCurveTo(-s * 0.35, s * 0.72, -s * 0.64, s * 0.2); c.lineTo(-s * 0.75, -s * 0.58); c.closePath(); c.fill(); }
    else if (kind === "run") { circ(c, s * 0.3, -s * 0.66, s * 0.19); c.fill(); c.beginPath(); c.moveTo(s * 0.15, -s * 0.38); c.lineTo(-s * 0.1, s * 0.15); c.moveTo(-s * 0.55, -s * 0.2); c.lineTo(s * 0.05, -s * 0.32); c.lineTo(s * 0.5, -s * 0.02); c.moveTo(-s * 0.1, s * 0.15); c.lineTo(-s * 0.6, s * 0.55); c.moveTo(-s * 0.1, s * 0.15); c.lineTo(s * 0.25, s * 0.45); c.lineTo(s * 0.12, s * 0.9); c.stroke(); }
    else if (kind === "bang") { c.beginPath(); c.moveTo(-s * 0.16, -s * 0.85); c.lineTo(s * 0.16, -s * 0.85); c.lineTo(s * 0.08, s * 0.28); c.lineTo(-s * 0.08, s * 0.28); c.closePath(); c.fill(); circ(c, 0, s * 0.66, s * 0.17); c.fill(); }
    else if (kind === "reload") { c.beginPath(); c.arc(0, 0, s * 0.62, -0.3, Math.PI * 1.45); c.stroke(); c.beginPath(); c.moveTo(s * 0.62, -s * 0.62); c.lineTo(s * 0.66, -s * 0.05); c.lineTo(s * 0.1, -s * 0.2); c.closePath(); c.fill(); }
    else { for (const dx of [-0.52, 0, 0.52]) { circ(c, s * dx, 0, s * 0.15); c.fill(); } }
    c.restore();
  }
  function drawBubbles() {
    if (!whyOn) return;
    for (const v of views) {
      if (!v.u.alive || !v.icon) continue;
      const x = v.x * PX, y = v.y * PX, pp = clamp((clock - v.iconT) / 260, 0, 1), sc = pp < 1 ? 1 + 0.18 * Math.sin(pp * Math.PI) : 1, k = pp === 0 ? 0 : sc;
      if (k <= 0) continue;
      const bx = x + R * 0.62, by = y - R * 1.48, br = 26 * k;
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; ctx.fillStyle = "#f7f9fc";
      circ(ctx, x + R * 0.34, y - R * 0.98, 4.2); ctx.fill(); circ(ctx, x + R * 0.48, y - R * 1.16, 6); ctx.fill();
      circ(ctx, bx, by, br); ctx.fill(); ctx.restore();
      icon(v.icon, bx, by, br * 0.6);
    }
  }
  function drawMini() {
    const mw = mini.width, mh = mini.height, k = mw / W;
    if (miniImg.complete && miniImg.naturalWidth) mctx.drawImage(miniImg, 0, 0, mw, mh); else { mctx.fillStyle = "#1c2a1c"; mctx.fillRect(0, 0, mw, mh); }
    mctx.fillStyle = "rgba(4,10,20,.25)"; mctx.fillRect(0, 0, mw, mh);
    for (const v of views) {
      const x = v.x * PX * k, y = v.y * PX * k;
      if (!v.u.alive) { mctx.strokeStyle = "rgba(200,200,200,.7)"; mctx.lineWidth = 1.5; mctx.beginPath(); mctx.moveTo(x - 3, y - 3); mctx.lineTo(x + 3, y + 3); mctx.moveTo(x + 3, y - 3); mctx.lineTo(x - 3, y + 3); mctx.stroke(); continue; }
      mctx.fillStyle = v.u.team === "P" ? "#3d9bff" : "#ff4d4d"; mctx.strokeStyle = "#fff"; mctx.lineWidth = 1.2; circ(mctx, x, y, 5); mctx.fill(); mctx.stroke();
    }
    mctx.strokeStyle = "rgba(255,255,255,.9)"; mctx.lineWidth = 1.6; mctx.strokeRect((cam.x - W / 2 / ZOOM) * k, (cam.y - H / 2 / ZOOM) * k, (W / ZOOM) * k, (H / ZOOM) * k); // カメラの範囲
  }

  function frame(real) { tick(real); requestAnimationFrame(frame); }
  function tick(real) {
    const dt = lastReal ? clamp(real - lastReal, 0, 100) : 16; lastReal = real;
    if (!paused) clock += dt * speed;
    if (!battle) newBattle();
    if (!paused) {
      if (overAt) { if (clock - overAt > 4200 * speed) newBattle(); }
      else if (clock >= nextTurnAt) { doTurn(); nextTurnAt = clock + TURN; }
    }
    const e = ease(clamp((clock - turnStart) / (TURN * 0.8), 0, 1));
    for (const v of views) {
      const px = v.x, py = v.y; v.x = lerp(v.fx, v.tx, e); v.y = lerp(v.fy, v.ty, e);
      let da = v.ang1 - v.ang0; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; v.ang = v.ang0 + da * e;
      if (Math.hypot(v.x - px, v.y - py) > 0.02 && Math.hypot(v.tx - v.fx, v.ty - v.fy) > 2.5) v.trail.push({ x: v.x, y: v.y, t: clock });
      while (v.trail.length && clock - v.trail[0].t > 520) v.trail.shift();
    }
    const al = views.filter((v) => v.u.alive); let gx = W / 2, gy = H / 2;
    if (al.length) { let sx = 0, sy = 0, n = 0; for (const v of al) { const w = v === focus ? 2.5 : 1; sx += v.x * PX * w; sy += v.y * PX * w; n += w; } gx = sx / n; gy = sy / n + 40; }
    const hw = W / 2 / ZOOM, hh = H / 2 / ZOOM, cf = clamp(dt * speed * 0.0025, 0, 1);
    cam.x = clamp(cam.x + (gx - cam.x) * cf, hw, W - hw); cam.y = clamp(cam.y + (gy - cam.y) * cf, hh, H - hh);
    ctx.setTransform(S * ZOOM, 0, 0, S * ZOOM, S * (W / 2 - cam.x * ZOOM), S * (H / 2 - cam.y * ZOOM));
    drawMap(); drawAim(); drawTrails();
    views.filter((v) => !v.u.alive).forEach(drawToken);
    views.filter((v) => v.u.alive).sort((a, b) => a.y - b.y).forEach(drawToken);
    drawFocusRing(); drawFx(); drawBubbles();
    ctx.setTransform(S, 0, 0, S, 0, 0);                                                      // 画面の四隅を締める
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.38, W / 2, H / 2, H * 1.05);
    vg.addColorStop(0, "rgba(4,8,16,0)"); vg.addColorStop(1, "rgba(4,8,16,.55)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    drawMini();
  }
  // 検証用：画面が裏に隠れて requestAnimationFrame が止まっていても、時間を進めて描ける（ゲームの挙動には使わない）
  window.__arena = { run(ms) { let r = performance.now(); lastReal = r; for (let i = 0; i < ms / 16; i++) { r += 16; tick(r); } lastReal = performance.now(); return { turn: battle && battle.turn, over: !!overAt }; }, get views() { return views; }, get clock() { return clock; } };

  function fit() {
    const k = Math.min(innerWidth / W, innerHeight / H), dpr = Math.min(2, window.devicePixelRatio || 1);
    $("stage").style.transform = `translate(${(innerWidth - W * k) / 2}px,${(innerHeight - H * k) / 2}px) scale(${k})`;
    cv.width = Math.round(W * k * dpr); cv.height = Math.round(H * k * dpr); S = k * dpr;
  }
  addEventListener("resize", fit); fit();

  $("btPause").onclick = () => { paused = !paused; $("icPause").setAttribute("d", paused ? "M16 12 L36 24 L16 36 Z" : "M17 13 V35 M31 13 V35"); };
  $("btSpeed").onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; $("spd").textContent = "×" + speed; };
  $("btWhy").onclick = () => { whyOn = !whyOn; $("btWhy").classList.toggle("on", whyOn); };
  $("btFocus").onclick = () => {
    const alive = views.filter((v) => v.u.alive); if (!alive.length) return;
    focus = alive[(alive.indexOf(focus) + 1) % alive.length]; focusLock = clock + 8 * TURN; why = ""; updatePanels();
  };
  $("btNext").onclick = () => newBattle();
  requestAnimationFrame(frame);
})();
