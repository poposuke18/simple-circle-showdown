/* v2/js/app.js — 画面の流れ（Obsidian [[v2ゲーム設計]] v2.flow.*）：
 * タイトル → 部隊 → 性格を決める → 出撃準備 → 観戦 → 結果とハイライト → なぜ、そう動いた？ ／ 記録
 * プレーヤーが触れるのは人格10軸の言葉・名前・相手・戦況・隊形だけ。挙動24（小カテゴリ）は出さない（v2.hidden）。 */
(function () {
  "use strict";
  const D = SCS.DATA, Wd = SCS2.world, St = SCS2.store, Bd = SCS2.board;
  const W = 1920, H = 1080, PX = Bd.PX;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const cleanName = (s) => String(s || "").replace(/[<>&"'`\\]/g, "").trim().slice(0, 10);
  const axName = (i) => D.MACROS[i].name.replace(/\(.*\)/, "");
  const tkHtml = (team, emb, cls) => `<div class="tk ${team === "C" ? "c" : ""} ${cls || ""}"><img src="assets/emblem/${emb}.png" alt=""></div>`;
  const ACT_OF = { 射撃: "射撃中", 集中: "集中砲火", 斬: "斬り込み", 背後: "背後を突く", 側面: "側面を突く", 剝がし: "引き剝がし", かばう: "かばう", 盾: "盾になる", 遮蔽: "物陰に", 立て直し: "立て直し",
    退避: "退避中", 必殺: "必殺", 攻勢: "攻勢", 詰め: "詰め寄る", 装填: "装填中", 温存: "機を待つ", 索敵: "索敵中", 様子見: "様子見", 待機: "待機", 戦闘不能: "戦闘不能" };

  // ===== 画面サイズ（舞台 1920×1080 を拡大縮小）と canvas の解像度 =====
  let K = 1, DPR = 1;
  const CVS = [];
  function reg(cv, cw, ch) { const o = { cv, cw, ch, s: 1, ctx: cv.getContext("2d") }; CVS.push(o); size(o); return o; }
  function size(o) { o.cv.width = Math.round(o.cw * K * DPR); o.cv.height = Math.round(o.ch * K * DPR); o.s = K * DPR; }
  function fit() {
    K = Math.min(innerWidth / W, innerHeight / H); DPR = Math.min(2, window.devicePixelRatio || 1);
    $("stage").style.transform = `translate(${(innerWidth - W * K) / 2}px,${(innerHeight - H * K) / 2}px) scale(${K})`;
    CVS.forEach(size); if (cur === "result") drawCards(); if (cur === "why") drawWhy();
  }

  // ===== 画面切り替え =====
  let cur = "title";
  const SC = { title: "scTitle", squad: "scSquad", edit: "scEdit", prep: "scPrep", watch: "scWatch", result: "scResult", why: "scWhy", records: "scRecords" };
  function go(name) {
    if (!SC[name]) return;
    if (cur === "edit") St.save();
    cur = name;
    Object.entries(SC).forEach(([k, id]) => $(id).classList.toggle("on", k === name));
    ({ squad: enterSquad, prep: enterPrep, records: enterRecords, title: enterTitle })[name]?.();
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) { e.preventDefault(); go(b.getAttribute("data-go")); } });

  // ===== 時計（観戦は一時停止・速度あり）=====
  let real = 0, clock = 0, speed = 1, paused = false;

  // ===== タイトル：後ろでほかの作り手の部隊どうしが戦っている =====
  let demo = null, demoEnd = 0, demoClock = 0;
  const cvTitle = reg($("cvTitle"), W, H);
  function newDemo() {
    const g = SCS.makeRNG((Date.now() & 0x7fffffff) >>> 0), n = Wd.RIVALS.length, a = g.int(n); let b = g.int(n - 1); if (b >= a) b++;
    const pool = Wd.RIVALS.filter((r) => !r.mirror), A = pool[a % pool.length], Bv = pool[b % pool.length] === A ? pool[(b + 1) % pool.length] : pool[b % pool.length];
    demo = SCS2.makeRunner({ mine: { choices: A.squad, emb: A.emb, names: A.names }, foe: { choices: Bv.squad, emb: Bv.emb, names: Bv.names }, seed: g.int(0x7fffffff), arena: Wd.PLAZA, mod: "通常", formP: A.form, formC: Bv.form });
    demoClock = 0; demoEnd = 0;
  }
  function enterTitle() { if (!demo) newDemo(); }
  function frameTitle(dt) {
    if (!demo) newDemo();
    demoClock += dt; demo.tick(demoClock, dt, 1);
    if (demo.battle.over) { if (!demoEnd) demoEnd = demoClock; else if (demoClock - demoEnd > 3000) newDemo(); }
    const o = cvTitle, c = o.ctx; Bd.view(c, o.s, W, H, demo.cam.x, demo.cam.y, demo.cam.z);
    Bd.drawBoard(c, { clock: demoClock, views: demo.views, fx: demo.fx, focus: null, whyOn: false, obstacles: demo.battle.obstacles, hazards: demo.battle.hazards, mod: "通常", arena: Wd.PLAZA });
  }

  // ===== 部隊 =====
  function weapHtml(name) { const k = Wd.WEAPON_ICON[name]; return `<div class="weap">${k ? `<img src="assets/weapon/${k}.png" alt="" onerror="this.remove()">` : ""}<span>${esc(name)}</span></div>`; }
  function enterSquad() {
    $("sqCards").innerHTML = St.data.squad.map((f, i) => {
      const b = Wd.bodyOf(f.choices), w = Wd.wordsOf(f.choices);
      return `<div class="sq-card" data-i="${i}"><div class="sq-edit">性格を決める ›</div>${tkHtml("P", f.emb)}<div class="sq-name">${esc(f.name)}</div><div class="sq-words">${esc(w.join("・"))}</div>
        <div class="sq-body"><div class="sq-hp"><span>HP</span><b>${b.hp}</b></div><div class="weaps">${weapHtml(b.ranged)}${weapHtml(b.melee)}</div></div></div>`;
    }).join("");
  }
  $("sqCards").addEventListener("click", (e) => { const c = e.target.closest(".sq-card"); if (c) openEdit(+c.dataset.i); });

  // ===== 性格を決める（案8-1＋8-2の一行）=====
  let editI = 0;
  const cvCore = reg($("cvCore"), 560, 560);
  const core = { gears: [], old: [], t0: -1e9, seedOf: "" };
  function gearsFor(choices) {
    const g = SCS.makeRNG(Wd.hashStr(choices.join(""))), out = [];
    for (let i = 0; i < 8; i++) { const r = 26 + g.int(46), a = g.next() * Math.PI * 2, d = g.next() * (150 - r);
      out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r, teeth: Math.round(r / 6) + 6, spd: (g.chance(0.5) ? 1 : -1) * (0.0002 + g.next() * 0.0006), ph: g.next() * 6.28 }); }
    return out;
  }
  function openEdit(i) {
    editI = i; const f = St.data.squad[i];
    $("edName").value = f.name;
    $("edRows").innerHTML = D.MACROS.map((m, ax) => `<div class="ax" data-ax="${ax}"><div class="ax-name">${esc(axName(ax))}</div>${m.poles.map((p, k) => `<button class="opt ${f.choices[ax] === k ? "on" : ""}" data-ax="${ax}" data-k="${k}">${esc(p)}</button>`).join("")}</div>`).join("");
    core.gears = gearsFor(f.choices); core.old = []; core.t0 = -1e9;
    renderBody(false); go("edit");
  }
  function renderBody(flash) {
    const f = St.data.squad[editI], b = Wd.bodyOf(f.choices), hp = $("edHp");
    if (flash && hp.textContent !== String(b.hp)) { hp.classList.add("flash"); setTimeout(() => hp.classList.remove("flash"), 500); }
    hp.textContent = b.hp; $("edWeaps").innerHTML = weapHtml(b.ranged) + weapHtml(b.melee);
  }
  $("edRows").addEventListener("click", (e) => {
    const b = e.target.closest(".opt"); if (!b) return;
    const ax = +b.dataset.ax, k = +b.dataset.k, f = St.data.squad[editI]; if (f.choices[ax] === k) return;
    f.choices[ax] = k; St.save();
    b.parentElement.querySelectorAll(".opt").forEach((x) => x.classList.toggle("on", x === b));
    const row = b.parentElement; row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
    core.old = core.gears; core.gears = gearsFor(f.choices); core.t0 = real;                    // 中で何かが動いた気配だけ（何が変わったかは出さない）
    renderBody(true);
  });
  $("edName").addEventListener("change", () => { const n = cleanName($("edName").value); const f = St.data.squad[editI]; if (n) f.name = n; $("edName").value = f.name; St.save(); });
  function gearPath(c, g, rot) {
    const n = g.teeth, ro = g.r, ri = g.r * 0.82; c.beginPath();
    for (let i = 0; i < n * 2; i++) { const a = rot + (i / (n * 2)) * Math.PI * 2, rr = i % 2 ? ri : ro, a2 = a + Math.PI / (n * 2); c.lineTo(g.x + Math.cos(a) * rr, g.y + Math.sin(a) * rr); c.lineTo(g.x + Math.cos(a2) * rr, g.y + Math.sin(a2) * rr); }
    c.closePath(); c.moveTo(g.x + g.r * 0.35, g.y); c.arc(g.x, g.y, g.r * 0.35, 0, Math.PI * 2, true);
  }
  function frameEdit() {
    const o = cvCore, c = o.ctx, f = St.data.squad[editI]; c.setTransform(o.s, 0, 0, o.s, o.s * 280, o.s * 280); c.clearRect(-280, -280, 560, 560);
    const p = clamp((real - core.t0) / 1400, 0, 1), boost = 1 + 7 * Math.pow(1 - p, 2);
    for (let i = 0; i < 3; i++) { const a0 = real * 0.0004 * (i % 2 ? -1 : 1) + i * 2.1; c.strokeStyle = `rgba(110,210,255,${0.55 - i * 0.12})`; c.lineWidth = 5 - i; c.shadowColor = "#5fd2ff"; c.shadowBlur = 14; c.beginPath(); c.arc(0, 0, 262 - i * 8, a0, a0 + 1.4 + i * 0.4); c.stroke(); }
    c.shadowBlur = 0;
    const R = 232, side = "#082a6e";
    c.shadowColor = "rgba(47,134,255,.7)"; c.shadowBlur = 40; c.fillStyle = side; Bd.circ(c, 0, 12, R); c.fill(); c.shadowBlur = 0;
    const rg = c.createLinearGradient(0, -R, 0, R); rg.addColorStop(0, "#58aeff"); rg.addColorStop(1, "#0f4fcf"); c.fillStyle = rg; Bd.circ(c, 0, 0, R); c.fill();
    c.strokeStyle = "rgba(255,255,255,.35)"; c.lineWidth = 6; c.beginPath(); c.arc(0, 0, R - 4, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
    const FR = 178, fg = c.createRadialGradient(-50, -60, 10, 0, 0, FR); fg.addColorStop(0, "#2a3140"); fg.addColorStop(1, "#0c0f15"); c.fillStyle = fg; Bd.circ(c, 0, 0, FR); c.fill();
    c.save(); Bd.circ(c, 0, 0, FR - 2); c.clip();
    const drawSet = (set, alpha) => { if (alpha <= 0) return; c.filter = "blur(2.5px)"; c.fillStyle = `rgba(150,195,255,${0.3 * alpha})`; c.strokeStyle = `rgba(170,215,255,${0.4 * alpha})`; c.lineWidth = 2;
      for (const g of set) { gearPath(c, g, g.ph + real * g.spd * boost); c.fill("evenodd"); c.stroke(); } c.filter = "none"; };
    drawSet(core.old, 1 - p); drawSet(core.gears, p < 1 ? p : 1);
    for (let i = 0; i < 3; i++) { const q = clamp(p * 1.3 - i * 0.18, 0, 1); if (q <= 0 || q >= 1) continue; c.strokeStyle = `rgba(120,215,255,${(1 - q) * 0.8})`; c.lineWidth = 6 * (1 - q) + 1; c.shadowColor = "#5fd2ff"; c.shadowBlur = 18; Bd.circ(c, 0, 0, 30 + q * (FR - 30)); c.stroke(); }
    c.shadowBlur = 0; c.fillStyle = "rgba(10,14,24,.22)"; c.fillRect(-FR, -FR, FR * 2, FR * 2);
    c.restore();
    const im = Bd.emb(f.emb); if (im) { c.globalAlpha = 0.93; c.shadowColor = `rgba(120,210,255,${0.35 + 0.5 * (1 - p)})`; c.shadowBlur = 20; c.drawImage(im, -92, -92, 184, 184); c.globalAlpha = 1; c.shadowBlur = 0; }
    const gl = c.createLinearGradient(-FR, -FR, FR, FR); gl.addColorStop(0, "rgba(255,255,255,.14)"); gl.addColorStop(0.35, "rgba(255,255,255,0)"); c.fillStyle = gl; Bd.circ(c, 0, 0, FR); c.fill();
    c.strokeStyle = "rgba(0,0,0,.6)"; c.lineWidth = 6; Bd.circ(c, 0, 0, FR); c.stroke();
    c.fillStyle = "#58aeff"; c.strokeStyle = "rgba(0,0,0,.5)"; c.lineWidth = 2; c.beginPath(); c.moveTo(0, R + 26); c.lineTo(-20, R - 4); c.lineTo(20, R - 4); c.closePath(); c.fill(); c.stroke();
  }

  // ===== 出撃準備 =====
  // 相手の部隊（写し身＝いまのあなたの部隊を写す）
  function foeOf(r) {
    if (!r.mirror) return { choices: r.squad, emb: r.emb, names: r.names, form: r.form };
    const sq = St.data.squad; return { choices: sq.map((f) => f.choices.slice()), emb: sq.map((f) => f.emb), names: sq.map((f) => f.name + "′"), form: St.data.form };
  }
  let rivalI = 0, pMod = null;
  function recOf(k) { const r = St.data.records[k]; return r ? `${r.w}勝 ${r.l}敗${r.d ? ` ${r.d}分` : ""}` : "初対戦"; }
  function enterPrep() {
    $("rvList").innerHTML = Wd.RIVALS.map((r, i) => `<div class="rv ${i === rivalI ? "on" : ""}" data-i="${i}"><div class="rv-t">${esc(r.name)}<small>${esc(recOf(r.key))}</small></div><div class="rv-f">${esc(r.flavor)}</div>
      <div class="rv-tks">${foeOf(r).emb.map((e) => tkHtml("C", e, "tk-sm")).join("")}</div></div>`).join("");
    selectRival(rivalI, true);
    $("pForm").innerHTML = Wd.FORMS.map((f) => `<span class="chip ${f === St.data.form ? "on" : ""}" data-f="${esc(f)}">${esc(f)}</span>`).join("");
    $("pMine").innerHTML = `<span class="lbl">あなたの部隊</span>` + St.data.squad.map((f) => tkHtml("P", f.emb, "tk-sm") + `<span class="nm">${esc(f.name)}</span>`).join("");
  }
  function selectRival(i, keepMod) {
    rivalI = i; const r = Wd.RIVALS[i];
    document.querySelectorAll("#rvList .rv").forEach((x) => x.classList.toggle("on", +x.dataset.i === i));
    $("rvName").textContent = r.name; $("rvRec").textContent = recOf(r.key); $("rvFlavor").textContent = r.flavor; $("rvScout").textContent = r.scout;
    $("rvTokens").innerHTML = foeOf(r).emb.map((e) => tkHtml("C", e)).join("");
    if (!keepMod || !pMod) pMod = r.mod;
    $("pMod").innerHTML = Wd.MODS.map((m) => `<span class="chip ${m === pMod ? "on" : ""}" data-m="${esc(m)}">${esc(m)}</span>`).join("");
  }
  $("rvList").addEventListener("click", (e) => { const c = e.target.closest(".rv"); if (c) selectRival(+c.dataset.i, false); });
  $("pMod").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; pMod = c.dataset.m; $("pMod").querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === c)); });
  $("pForm").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; St.data.form = c.dataset.f; St.save(); $("pForm").querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === c)); });
  $("pGo").addEventListener("click", () => sortie());

  // ===== 観戦 =====
  let run = null, sortieCfg = null, ended = false, endAt = 0, result = null;
  const cvWatch = reg($("cvWatch"), W, H), cvMini = reg($("cvMini"), 276, 153);
  function sortie(sameSeed) {
    const r = Wd.RIVALS[rivalI], sq = St.data.squad, foe = foeOf(r);
    const seed = sameSeed && sortieCfg ? sortieCfg.seed : ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) & 0x7fffffff) >>> 0;
    sortieCfg = { mine: { choices: sq.map((f) => f.choices.slice()), emb: sq.map((f) => f.emb), names: sq.map((f) => f.name) }, foe: { choices: foe.choices, emb: foe.emb, names: foe.names },
      seed, arena: Wd.PLAZA, mod: pMod || r.mod, formP: St.data.form, formC: foe.form, rival: r };
    run = SCS2.makeRunner(sortieCfg); clock = 0; paused = false; ended = false; endAt = 0; result = null;
    $("wVs").textContent = `VS ${r.name}`; $("wSub").textContent = `${Wd.PLAZA.name}・${sortieCfg.mod}`;
    $("wEnd").classList.remove("show"); setPause(false);
    go("watch"); updWatch();
  }
  function setPause(p) { paused = p; $("icPause").setAttribute("d", paused ? "M16 12 L36 24 L16 36 Z" : "M17 13 V35 M31 13 V35"); $("icPause").style.fill = paused ? "#8fe0ff" : "none"; }
  $("wPause").onclick = () => setPause(!paused);
  $("wSpeed").onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; $("wSpd").textContent = "×" + speed; };
  let bubOn = true;
  $("wBub").onclick = () => { bubOn = !bubOn; $("wBub").classList.toggle("on", bubOn); };
  $("wFocus").onclick = () => { if (!run) return; const al = run.views.filter((v) => v.alive); if (!al.length) return; run.setFocus(al[(al.indexOf(run.focus) + 1) % al.length], clock); updWatch(); };
  $("wSkip").onclick = () => { if (!run) return; run.finish(clock); endBattle(true); };
  function updWatch() {
    if (!run) return; const b = run.battle;
    $("cP").textContent = b.teams.P.filter((u) => u.alive).length; $("cC").textContent = b.teams.C.filter((u) => u.alive).length; $("cT").textContent = b.turn;
    const v = run.focus; if (!v) return;
    $("fTk").className = "tk tk-lg" + (v.team === "C" ? " c" : ""); $("fTk").querySelector("img").src = `assets/emblem/${v.emb}.png`;
    $("fName").textContent = v.name; $("fWord").textContent = v.words.join("・");
    $("fHp").style.width = (clamp(v.hp / v.maxHp, 0, 1) * 100).toFixed(1) + "%"; $("fHpT").textContent = `${Math.max(0, Math.round(v.hp))} / ${v.maxHp}`;
    $("fAct").textContent = ACT_OF[v.label] || v.label || "待機";
    const w = run.whyOf(v); if (w) $("fWhy").textContent = w; else if (!$("fWhy").textContent) $("fWhy").textContent = "";
  }
  let lastTurnShown = -1, lastFocus = null;
  function frameWatch(dt) {
    if (!run) return;
    if (!paused) { clock += dt * speed; run.tick(clock, dt, speed); }
    if (run.battle.turn !== lastTurnShown || run.focus !== lastFocus) { if (run.focus !== lastFocus) $("fWhy").textContent = ""; lastTurnShown = run.battle.turn; lastFocus = run.focus; updWatch(); }
    if (run.battle.over && !ended) endBattle(false);
    if (ended && !paused && clock - endAt > 2600) showResult();
    const o = cvWatch, c = o.ctx; Bd.view(c, o.s, W, H, run.cam.x, run.cam.y, run.cam.z);
    Bd.drawBoard(c, { clock, views: run.views, fx: run.fx, focus: run.focus, whyOn: bubOn, obstacles: run.battle.obstacles, hazards: run.battle.hazards, mod: sortieCfg.mod, arena: Wd.PLAZA });
    c.setTransform(o.s, 0, 0, o.s, 0, 0);
    const vg = c.createRadialGradient(W / 2, H / 2, H * 0.38, W / 2, H / 2, H * 1.05); vg.addColorStop(0, "rgba(4,8,16,0)"); vg.addColorStop(1, "rgba(4,8,16,.55)"); c.fillStyle = vg; c.fillRect(0, 0, W, H);
    const m = cvMini; m.ctx.setTransform(m.s, 0, 0, m.s, 0, 0); Bd.drawMini(m.ctx, 276, 153, { views: run.views, arena: Wd.PLAZA }, run.cam);
  }
  function outcome() { const r = run.battle.result || {}; return r.type === "draw" ? "d" : r.winner === "PLR" ? "w" : "l"; }
  function endBattle(skip) {
    if (ended) { if (skip) showResult(); return; }
    ended = true; endAt = clock; result = outcome();
    St.record(sortieCfg.rival.key, result);
    $("wEndMain").textContent = { w: "勝利", l: "敗北", d: "引き分け" }[result]; $("wEnd").classList.add("show");
    updWatch();
    if (skip) showResult();
  }

  // ===== 結果とハイライト =====
  let hls = [];
  const cardCvs = [];
  function snapViews(snap) {
    const vs = snap.units.map((u) => ({ ...u, icon: u.alive ? Bd.ICON_OF[u.label] || "dots" : null, iconT: -1e9, hitT: -1e9, koT: 0, trail: [] }));
    const by = new Map(vs.map((v) => [v.id, v])); vs.forEach((v) => (v.tgt = v.tgt ? by.get(v.tgt) || null : null)); return { vs, by };
  }
  // 見どころを選ぶ：撃破・必殺・かばう/盾・背後・側面・立て直し・最後の一人（見えた出来事だけ。中の数値は使わない）
  function findHighlights(snaps) {
    const out = [], name = (u) => u.name;
    for (let t = 1; t < snaps.length; t++) {
      const s = snaps[t], prev = snaps[t - 1], pv = new Map(prev.units.map((u) => [u.id, u]));
      for (const id of s.died) {
        const vic = s.units.find((u) => u.id === id), pu = pv.get(id) || vic; let killer = null, bd = 1e9;
        for (const e of s.events) { if (!e.to || (e.hits || 0) <= 0 || (e.aTeam || e.team) === vic.team) continue; const d = Math.hypot(e.to.x - pu.x, e.to.y - pu.y); if (d < bd) { bd = d; killer = (e.aTeam || e.team) + e.aIdx; } }
        const ku = killer ? s.units.find((u) => u.id === killer) : null;
        if (ku) out.push({ t, id: ku.id, other: id, score: 3.2 + (ku.team === "P" ? 0.8 : 0), cap: `${name(ku)} が仕留めた`, sub: `${name(vic)} が倒れた` });
        else out.push({ t, id, score: 2.6, cap: `${name(vic)} が倒れた`, sub: "" });
      }
      for (const u of s.units) {
        if (!u.alive) continue;
        const mine = u.team === "P" ? 0.8 : 0, low = u.hp / u.maxHp < 0.35;
        const k = { かばう: [4.2, "盾が割り込んだ"], 盾: [3.0, "火力を引き受けた"], 必殺: [3.6, "必殺"], 背後: [3.4, "背後を取った"], 側面: [2.7, "側面を突いた"] }[u.label];
        if (k) out.push({ t, id: u.id, other: u.tgt, score: k[0] + mine, cap: `${name(u)}、${k[1]}`, sub: "" });
        else if ((u.label === "立て直し" || u.label === "退避") && low) out.push({ t, id: u.id, score: 2.4 + mine, cap: `${name(u)} が退いた`, sub: "深手を負って" });
      }
    }
    const last = snaps[snaps.length - 1];
    for (const tm of ["P", "C"]) { const al = last.units.filter((u) => u.team === tm && u.alive); if (al.length === 1 && last.units.filter((u) => u.team !== tm && u.alive).length === 0) out.push({ t: snaps.length - 1, id: al[0].id, score: 5 + (tm === "P" ? 1 : 0), cap: `最後の一人、${al[0].name}`, sub: "" }); }
    const pick = [];
    for (const h of out.sort((a, b) => b.score - a.score)) { if (pick.length >= 3) break; if (pick.some((p) => p.t === h.t || (p.id === h.id && (p.cap === h.cap || Math.abs(p.t - h.t) < 3)))) continue; pick.push(h); }
    return pick.sort((a, b) => a.t - b.t);
  }
  function showResult() {
    if (cur === "result" || !run) return;
    const r = result || outcome(), an = run.battle.getAnalysis();
    $("rsBanner").textContent = { w: "勝利", l: "敗北", d: "引き分け" }[r]; $("rsBanner").className = "rs-banner " + { w: "", l: "lose", d: "draw" }[r];
    $("rsVerdict").textContent = `${an.plr.verdict}　（${run.battle.turn} ターン・VS ${sortieCfg.rival.name}）`;
    hls = findHighlights(run.snaps);
    $("rsCards").style.gridTemplateColumns = `repeat(${Math.max(1, hls.length)}, 600px)`;
    $("rsCards").innerHTML = hls.length ? hls.map((h, i) => `<div class="hl" data-i="${i}"><canvas></canvas><div class="hl-cap">${esc(h.cap)}</div><div class="hl-sub">${esc(h.sub ? h.sub + "・" : "")}ターン ${run.snaps[h.t].turn}</div></div>`).join("")
      : `<div class="rs-empty">見どころのない静かな戦いだった。</div>`;
    for (let i = CVS.length - 1; i >= 0; i--) if (!document.body.contains(CVS[i].cv)) CVS.splice(i, 1);
    cardCvs.length = 0; document.querySelectorAll("#rsCards canvas").forEach((cv) => cardCvs.push(reg(cv, 564, 317)));
    const last = run.snaps[run.snaps.length - 1];
    $("rsStrip").innerHTML = last.units.filter((u) => u.team === "P").map((u) => `<div class="rs-u">${tkHtml("P", u.emb, u.alive ? "" : "dead")}<div>${esc(u.name)}<small>${u.alive ? `残り HP ${Math.max(0, Math.round(u.hp))}` : "倒れた"}</small></div></div>`).join("");
    go("result"); drawCards();
  }
  function drawCards() {
    hls.forEach((h, i) => {
      const o = cardCvs[i]; if (!o) return; const { vs, by } = snapViews(run.snaps[h.t]), sub = by.get(h.id), oth = h.other ? by.get(h.other) : null;
      const xs = [sub.x * PX].concat(oth ? [oth.x * PX] : []), ys = [sub.y * PX].concat(oth ? [oth.y * PX] : []);    // 主役と相手が両方入るように寄る
      const z = clamp(Math.min(564 / (Math.max(...xs) - Math.min(...xs) + 420), 317 / (Math.max(...ys) - Math.min(...ys) + 300)), 0.32, 0.69);
      const cx = clamp((Math.max(...xs) + Math.min(...xs)) / 2, 282 / z, W - 282 / z), cy = clamp((Math.max(...ys) + Math.min(...ys)) / 2, 158 / z, H - 158 / z);
      Bd.view(o.ctx, o.s, 564, 317, cx, cy, z);
      Bd.drawBoard(o.ctx, { clock: 1000, views: vs, fx: [], focus: null, highlight: sub, whyOn: true, obstacles: run.snaps[h.t].obstacles, hazards: run.snaps[h.t].hazards, mod: sortieCfg.mod, arena: Wd.PLAZA });
    });
  }
  $("rsCards").addEventListener("click", (e) => { const c = e.target.closest(".hl"); if (c) openWhy(hls[+c.dataset.i]); });
  $("rsAgain").addEventListener("click", () => sortie(false));

  // ===== なぜ、そう動いた？ =====
  const cvWhy = reg($("cvWhy"), 1278, 738);
  let why = null, whyTimer = null;
  function openWhy(h) { why = { t: h.t, id: h.id, cap: h.cap }; $("whyRange").max = run.snaps.length - 1; $("whyRange").value = h.t; stopWhyPlay(); go("why"); drawWhy(); }
  function cleanLine(t) { return t.replace(/^[\s　─]+/, "").replace(/（[^）]*）/g, ""); }
  function drawWhy() {
    if (!why || !run) return;
    const snap = run.snaps[why.t], { vs, by } = snapViews(snap), sub = by.get(why.id);
    const arrows = []; let n = 1;
    const nearestId = (p) => { let b = null, bd = 1e9; for (const u of snap.units) { const d = Math.hypot(u.x - p.x, u.y - p.y); if (d < bd) { bd = d; b = u.id; } } return b; };
    const evs = snap.events.filter((e) => e.from && e.to);
    const mine = evs.filter((e) => (e.aTeam || e.team) + e.aIdx === why.id || nearestId(e.to) === why.id);
    for (const e of (mine.length ? mine : evs).slice(0, 4)) { const a = by.get((e.aTeam || e.team) + e.aIdx), b = by.get(nearestId(e.to)); if (a && b && a !== b) arrows.push({ a, b, n: n++, team: a.team }); }
    const pts = [sub].concat(arrows.flatMap((a) => [a.a, a.b])); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of pts) { x0 = Math.min(x0, p.x * PX); x1 = Math.max(x1, p.x * PX); y0 = Math.min(y0, p.y * PX); y1 = Math.max(y1, p.y * PX); }
    const z = clamp(Math.min(1278 / (x1 - x0 + 600), 738 / (y1 - y0 + 420)), 0.66, 1.25);
    const cx = clamp((x0 + x1) / 2, 639 / z, W - 639 / z), cy = clamp((y0 + y1) / 2, 369 / z, H - 369 / z);
    const o = cvWhy; Bd.view(o.ctx, o.s, 1278, 738, cx, cy, z);
    Bd.drawBoard(o.ctx, { clock: 1000, views: vs, fx: [], focus: null, highlight: sub, arrows, aim: false, whyOn: true, obstacles: snap.obstacles, hazards: snap.hazards, mod: sortieCfg.mod, arena: Wd.PLAZA });
    const nm = `>${esc(sub.name)}</span>`, isSubj = (l) => l.text.indexOf(nm + " は") >= 0;
    const now = snap.lines.filter((l) => l.cls !== "dim" && l.text.indexOf(nm) >= 0).slice(0, 3);
    const before = [];                                                                          // それまで：この駒が主語の記録（「〜ため、X は …した」）を新しい順に
    for (let k = why.t - 1; k >= 1 && before.length < 3; k--) for (const l of run.snaps[k].lines) if (l.cls !== "dim" && isSubj(l) && before.length < 3) before.push({ l, turn: run.snaps[k].turn });
    const line = (l, tag) => `<div class="ws-line ${isSubj(l) ? "me" : ""}">${tag ? `<small class="ws-t">ターン ${tag}</small>` : ""}${cleanLine(l.text)}</div>`;
    $("whySide").innerHTML = `<div class="ws-head">${tkHtml(sub.team, sub.emb)}<div><div class="ws-name">${esc(sub.name)}</div><div class="ws-cap">${esc(why.cap)}</div></div></div>`
      + `<div class="ws-sec">この瞬間</div>` + (now.length ? now.map((l) => line(l)).join("") : `<div class="ws-line">${esc(sub.name)} は ${esc(ACT_OF[sub.label] || sub.label || "")}。</div>`)
      + (before.length ? `<div class="ws-sec">それまで</div>` + before.map((x) => line(x.l, x.turn)).join("") : "");
    $("whyTurn").textContent = `ターン ${snap.turn}`;
  }
  $("whyRange").addEventListener("input", () => { if (!why) return; why.t = +$("whyRange").value; drawWhy(); });
  function stopWhyPlay() { if (whyTimer) clearInterval(whyTimer); whyTimer = null; $("icWhyPlay").setAttribute("d", "M16 12 L36 24 L16 36 Z"); }
  $("whyPlay").addEventListener("click", () => {
    if (whyTimer) return stopWhyPlay();
    if (why.t >= run.snaps.length - 1) why.t = 0;
    $("icWhyPlay").setAttribute("d", "M17 13 H23 V35 H17 Z M27 13 H33 V35 H27 Z");
    whyTimer = setInterval(() => { if (why.t >= run.snaps.length - 1) return stopWhyPlay(); why.t++; $("whyRange").value = why.t; drawWhy(); }, 700);
  });
  $("whyBack").addEventListener("click", () => { stopWhyPlay(); go("result"); drawCards(); });

  // ===== 記録 =====
  function enterRecords() {
    $("recTable").innerHTML = `<div class="rec-row h"><span>相手</span><b>勝</b><b>敗</b><b>分</b></div>` + Wd.RIVALS.map((r) => { const x = St.data.records[r.key] || { w: 0, l: 0, d: 0 };
      return `<div class="rec-row"><span class="n">${esc(r.name)}</span><b>${x.w}</b><b>${x.l}</b><b>${x.d}</b></div>`; }).join("");
  }

  // ===== ループ =====
  function frame(now) { step(now); requestAnimationFrame(frame); }
  function step(now) {
    const dt = real ? clamp(now - real, 0, 100) : 16; real = now;
    if (cur === "title") frameTitle(dt); else if (cur === "edit") frameEdit(); else if (cur === "watch") frameWatch(dt);
  }
  // 絵が読み込まれたら止まっている画面（結果・なぜ？）を描き直す。先に読み込んでおく
  Bd.onLoad = () => { if (cur === "result") drawCards(); else if (cur === "why") drawWhy(); };
  Bd.img(Wd.PLAZA.map); Bd.img(Wd.PLAZA.mini); Wd.EMB.forEach((e) => Bd.emb(e));
  addEventListener("resize", fit); fit();
  requestAnimationFrame(frame);
  // 検証用：タブが裏で requestAnimationFrame が止まっていても時間を進めて描く（遊びには使わない）
  window.__v2 = { run(ms) { let r = performance.now(); real = r; for (let i = 0; i < ms / 16; i++) { r += 16; step(r); } real = performance.now(); return { cur, turn: run && run.battle.turn, over: run && run.battle.over }; }, go, get runner() { return run; }, get hls() { return hls; } };
})();
