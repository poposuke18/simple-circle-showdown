/* v2/js/app.js — 画面の流れ（Obsidian [[v2ゲーム設計]] v2.flow.*）：
 * タイトル → 部隊 → 性格を決める → 出撃準備 → 観戦 → 結果とハイライト → なぜ、そう動いた？ ／ 記録
 * プレーヤーが触れるのは人格10軸の言葉・名前・相手・戦況・隊形だけ。挙動24（小カテゴリ）は出さない（v2.hidden）。 */
(function () {
  "use strict";
  const D = SCS.DATA, Wd = SCS2.world, St = SCS2.store, Bd = SCS2.board;
  const W = 1920, H = 1080;
  const pxOf = (arena) => W / arena.w;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const cleanName = (s) => String(s || "").replace(/[<>&"'`\\]/g, "").trim().slice(0, 10);
  const axName = (i) => D.MACROS[i].name.replace(/\(.*\)/, "");
  const palCss = (p) => (p ? ` style="--rim:${p.rimA};--side:${p.side};--glow:rgba(${p.rgb},.45)"` : "");
  const tkHtml = (team, emb, cls, pal) => `<div class="tk ${team === "C" ? "c" : ""} ${cls || ""}"${palCss(pal)}><img src="assets/emblem/${emb}.png" alt=""></div>`;
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
    CVS.forEach(size); if (cur === "result") drawCards(); if (cur === "why") drawWhy(); if (cur === "line") drawTree();
  }

  // ===== 画面切り替え =====
  let cur = "title";
  const SC = { title: "scTitle", squad: "scSquad", edit: "scEdit", prep: "scPrep", league: "scLeague", line: "scLine", spec: "scSpec", watch: "scWatch", result: "scResult", why: "scWhy", records: "scRecords" };
  let navLock = 0;                                                                           // 画面を切り替えた直後のクリックを捨てる時刻
  document.addEventListener("click", (e) => { if (e.isTrusted && performance.now() < navLock) { e.stopPropagation(); e.preventDefault(); } }, true);
  function go(name) {
    if (!SC[name]) return;
    if (cur === "edit") St.save();
    cur = name; navLock = performance.now() + 350;
    Object.entries(SC).forEach(([k, id]) => $(id).classList.toggle("on", k === name));
    ({ squad: enterSquad, prep: enterPrep, league: enterLeague, line: enterLine, spec: enterSpec, records: enterRecords, title: enterTitle })[name]?.();
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) { e.preventDefault(); go(b.getAttribute("data-go")); } });

  // ===== 時計（観戦は一時停止・速度あり）=====
  let real = 0, clock = 0, speed = 1, paused = false;

  // ===== タイトル：後ろでほかの作り手の部隊どうしが戦っている =====
  let demo = null, demoEnd = 0, demoClock = 0;
  const cvTitle = reg($("cvTitle"), W, H);
  function newDemo() {
    let DA;
    const g = SCS.makeRNG((Date.now() & 0x7fffffff) >>> 0), n = Wd.RIVALS.length, a = g.int(n); let b = g.int(n - 1); if (b >= a) b++;
    const pool = Wd.RIVALS.filter((r) => !r.mirror), A = pool[a % pool.length], Bv = pool[b % pool.length] === A ? pool[(b + 1) % pool.length] : pool[b % pool.length];
    demo = SCS2.makeRunner({ mine: { choices: A.squad, emb: A.emb, names: A.names }, foe: { choices: Bv.squad, emb: Bv.emb, names: uniqNames(A.names, Bv.names) }, seed: g.int(0x7fffffff), arena: DA = Wd.ARENAS[g.int(Wd.ARENAS.length)], mod: Wd.modOf(DA), formP: A.form, formC: Bv.form });
    demo.pal = { P: A.pal, C: Bv.pal }; demo.mod = Wd.modOf(DA); demoClock = 0; demoEnd = 0;
  }
  function enterTitle() { if (!demo) newDemo(); }
  function frameTitle(dt) {
    if (!demo) newDemo();
    demoClock += dt; demo.tick(demoClock, dt, 1);
    if (demo.battle.over) { if (!demoEnd) demoEnd = demoClock; else if (demoClock - demoEnd > 3000) newDemo(); }
    const o = cvTitle, c = o.ctx; Bd.view(c, o.s, W, H, demo.cam.x, demo.cam.y, demo.cam.z);
    Bd.drawBoard(c, { clock: demoClock, views: demo.views, fx: demo.fx, focus: null, whyOn: false, obstacles: demo.battle.obstacles, hazards: demo.battle.hazards, mod: demo.mod, arena: demo.arena, pal: demo.pal });
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
    core.gears = gearsFor(f.choices); core.old = []; core.t0 = -1e9; $("edPick").classList.remove("show");
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
  // 紋章を選ぶ（見た目だけ。戦いには関係しない）
  function openPick() {
    const f = St.data.squad[editI], taken = new Set(St.data.squad.filter((x, i) => i !== editI).map((x) => x.emb));
    $("edPick").innerHTML = Wd.EMB.map((e) => `<button class="pk ${e === f.emb ? "on" : ""} ${taken.has(e) ? "taken" : ""}" data-e="${e}"><img src="assets/emblem/${e}.png" alt=""></button>`).join("");
    $("edPick").classList.add("show");
  }
  $("edEmb").addEventListener("click", (e) => { e.stopPropagation(); if ($("edPick").classList.contains("show")) $("edPick").classList.remove("show"); else openPick(); });
  $("cvCore").addEventListener("click", (e) => { e.stopPropagation(); openPick(); });
  $("edPick").addEventListener("click", (e) => {
    e.stopPropagation(); const b = e.target.closest(".pk"); if (!b) return;
    const f = St.data.squad[editI], other = St.data.squad.find((x, i) => i !== editI && x.emb === b.dataset.e);
    if (other) other.emb = f.emb;                                                            // 仲間が使っている紋章なら取り替える
    f.emb = b.dataset.e; St.save(); $("edPick").classList.remove("show");
    core.t0 = real;
  });
  document.addEventListener("click", () => { const p = $("edPick"); if (p && p.classList.contains("show")) p.classList.remove("show"); });
  $("edName").addEventListener("change", () => {
    const f = St.data.squad[editI]; let n = cleanName($("edName").value);
    if (n) { const others = new Set(St.data.squad.filter((x) => x !== f).map((x) => x.name)); if (others.has(n)) { const base = n.replace(/-?\d+$/, ""); for (let d = 2; d <= 9 && others.has(n); d++) n = `${base}-${d}`; } f.name = n; }   // 仲間と同じ名前なら番号を変える
    $("edName").value = f.name; St.save();
  });
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

  // 両軍で名前が重ならないようにする（記録の文は名前で駒を指すため）
  function uniqNames(mine, foe) {
    const used = new Set(mine);
    return foe.map((n) => { if (!used.has(n)) { used.add(n); return n; } const base = n.replace(/-?\d+$/, ""); for (let d = 1; d <= 9; d++) { const c = `${base}-${d}`; if (!used.has(c)) { used.add(c); return c; } } const c = n + "′"; used.add(c); return c; });
  }
  // ===== 出撃準備 =====
  // 相手の部隊（写し身＝いまのあなたの部隊を写す）
  function foeOf(r) {
    if (!r.mirror) return { choices: r.squad, emb: r.emb, names: r.names, form: r.form };
    const sq = St.data.squad; return { choices: sq.map((f) => f.choices.slice()), emb: sq.map((f) => f.emb), names: sq.map((f) => f.name + "′"), form: St.data.form };
  }
  let rivalI = 0, pArena = null;
  function recOf(k) { const r = St.data.records[k]; return r ? `${r.w}勝 ${r.l}敗${r.d ? ` ${r.d}分` : ""}` : "初対戦"; }
  function enterPrep() {
    placeSel = -1;
    $("rvList").innerHTML = Wd.RIVALS.map((r, i) => `<div class="rv ${i === rivalI ? "on" : ""}" data-i="${i}"><div class="rv-t">${esc(r.name)}<small>${esc(recOf(r.key))}</small></div><div class="rv-f">${esc(r.flavor)}</div>
      <div class="rv-tks">${foeOf(r).emb.map((e) => tkHtml("C", e, "tk-sm", r.pal)).join("")}</div></div>`).join("");
    selectRival(rivalI, true);
    const FIC = { 散開: "loose", 戦列: "line", 楔: "wedge", 円陣: "circle" };
    $("pForm").innerHTML = Wd.FORMS.map((f) => `<span class="chip wchip ${f === St.data.form ? "on" : ""}" data-f="${esc(f)}"><i class="fic fic-${FIC[f] || "loose"}"></i>${esc(f)}</span>`).join("");
    renderPlace();
  }
  function selectRival(i, keepArena) {
    rivalI = i; const r = Wd.RIVALS[i];
    document.querySelectorAll("#rvList .rv").forEach((x) => x.classList.toggle("on", +x.dataset.i === i));
    $("rvName").textContent = r.name; $("rvRec").textContent = recOf(r.key); $("rvFlavor").textContent = r.flavor; $("rvScout").textContent = r.scout;
    $("rvTokens").innerHTML = foeOf(r).emb.map((e) => tkHtml("C", e, "", r.pal)).join("");
    if (!keepArena || !pArena) pArena = r.mirror ? (pArena || Wd.PLAZA) : Wd.arenaFor(r);
    $("pArena").innerHTML = Wd.ARENAS.map((a, i) => `<div class="acard ${a === pArena ? "on" : ""}" data-a="${i}"><img src="${a.mini}" alt=""><span>${esc(a.name)}</span></div>`).join("");
  }
  $("rvList").addEventListener("click", (e) => { const c = e.target.closest(".rv"); if (c) { selectRival(+c.dataset.i, false); renderPlace(); } });
  $("pArena").addEventListener("click", (e) => { const c = e.target.closest(".acard"); if (!c) return; pArena = Wd.ARENAS[+c.dataset.a]; $("pArena").querySelectorAll(".acard").forEach((x) => x.classList.toggle("on", x === c)); });
  $("pForm").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; St.data.form = c.dataset.f; St.save(); $("pForm").querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === c)); renderPlace(); });
  // ===== 配置：隊形の図の上で3体の位置を入れ替える（敵は右）。入れ替えていない時は間合いの短い駒が前（エンジンの既定）=====
  const SLOT_XY = { 散開: [[-0.2, -1], [0.25, 0], [-0.1, 1]], 戦列: [[0, -1], [0, 0], [0, 1]], 楔: [[1, 0], [-0.6, 0.8], [-0.6, -0.8]], 円陣: [[0.6, -0.45], [0.6, 0.45], [-0.9, 0]] };
  let placeSel = -1;
  function autoOrder() {                                                                    // 既定の並び＝エンジンと同じ（相手に対する間合いの短い順）
    const r = Wd.RIVALS[rivalI], foe = foeOf(r), sq = St.data.squad;
    const b = SCS.makeSquadBattle3(sq.map((f) => f.choices.slice()), foe.choices.map((c) => c.slice()), 1, (pArena || Wd.PLAZA).name, "通常", "散開", "散開");
    return b.teams.P.slice().sort((p, q) => p.winDist - q.winDist).map((u) => u.idx);
  }
  const curOrder = () => St.data.order || autoOrder();
  function renderPlace() {
    const box = $("pPlace"); if (!box) return;
    const xy = SLOT_XY[St.data.form] || SLOT_XY["散開"], ord = curOrder(), sq = St.data.squad, U = 52, cx0 = 128, cy0 = 84;
    box.innerHTML = `<i class="pl-foe"></i>` + ord.map((si, rank) => { const [x, y] = xy[rank], f = sq[si];
      return `<button class="pl-slot ${placeSel === rank ? "sel" : ""}" data-r="${rank}" title="${esc(f.name)}" style="left:${cx0 + x * U - 29}px;top:${cy0 + y * U - 29}px">${tkHtml("P", f.emb, "tk-sm")}</button>`; }).join("");
  }
  $("pPlace").addEventListener("click", (e) => {
    const b = e.target.closest(".pl-slot"); if (!b) return; const r = +b.dataset.r;
    if (placeSel < 0) placeSel = r; else if (placeSel === r) placeSel = -1;
    else { const o = curOrder().slice(); [o[placeSel], o[r]] = [o[r], o[placeSel]]; St.data.order = o; St.save(); placeSel = -1; }
    renderPlace();
  });
  $("pGo").addEventListener("click", () => { if (sortieCfg) sortieCfg.spec = false; sortie(); });

  // ===== 観戦 =====
  let run = null, sortieCfg = null, ended = false, endAt = 0, result = null;
  const FW = 1420, FH = 1080;                                                                // 観戦の戦場の枠（左の列はパネル専用。戦場にパネルを重ねない）
  const cvWatch = reg($("cvWatch"), FW, FH), cvMini = reg($("cvMini"), 436, 245);
  const newSeed = () => ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) & 0x7fffffff) >>> 0;
  function sortie() {
    if (sortieCfg && sortieCfg.spec) return spectate();
    const r = Wd.RIVALS[rivalI], sq = St.data.squad, foe = foeOf(r);
    const seed = newSeed();
    sortieCfg = { mine: { choices: sq.map((f) => f.choices.slice()), emb: sq.map((f) => f.emb), names: sq.map((f) => f.name) }, foe: { choices: foe.choices, emb: foe.emb, names: uniqNames(sq.map((f) => f.name), foe.names) },
      seed, arena: pArena || Wd.PLAZA, mod: Wd.modOf(pArena || Wd.PLAZA), formP: St.data.form, formC: foe.form, rival: r, orderP: St.data.order ? St.data.order.slice() : null, pal: { P: Wd.YOU, C: r.pal } };
    startRun(`VS ${r.name}`);
  }
  function startRun(vs) {
    sortieCfg.vw = FW; sortieCfg.vh = FH; run = SCS2.makeRunner(sortieCfg);
    const heat = sortieCfg.mod === "灼熱"; $("scWatch").classList.toggle("heat", heat); $("rsCards").classList.toggle("heat", heat); $("cvWhy").parentElement.classList.toggle("heat", heat);   // 灼熱＝枠が赤く光る（v2.fx.heat2）
    clock = 0; paused = false; ended = false; endAt = 0; result = null;
    $("wVs").textContent = vs; $("wVs").classList.toggle("long", vs.length > 12); $("wSub").textContent = sortieCfg.arena.name;
    $("wEnd").classList.remove("show"); setPause(false);
    buildHud(); go("watch"); updWatch();
  }
  // 観戦中の表示：ターン＋両軍3体ずつの駒とHP（v2.k6.hud）。駒を押すとその駒に注目
  let hudEls = [];
  function buildHud() {
    hudEls = [];
    for (const tm of ["P", "C"]) {
      const box = $(tm === "P" ? "huP" : "huC"), pal = sortieCfg.pal[tm];
      box.innerHTML = run.views.filter((v) => v.team === tm).map((v) => `<button class="hu" data-id="${v.id}">${tkHtml(tm, v.emb, "tk-xs", pal)}<i class="hu-hp"><b style="background:${pal.rimA}"></b></i></button>`).join("");
      box.querySelectorAll(".hu").forEach((el) => hudEls.push({ el, tk: el.querySelector(".tk"), bar: el.querySelector("b"), v: run.views.find((x) => x.id === el.dataset.id), w: -1, dead: false, on: false }));
    }
  }
  function updHud() {
    for (const h of hudEls) {
      const w = h.v.alive ? Math.round(clamp(h.v.hp / h.v.maxHp, 0, 1) * 100) : 0; if (w !== h.w) { h.w = w; h.bar.style.width = w + "%"; }
      if (!h.v.alive !== h.dead) { h.dead = !h.v.alive; h.tk.classList.toggle("dead", h.dead); }
      const on = run.focus === h.v; if (on !== h.on) { h.on = on; h.el.classList.toggle("on", on); }
    }
  }
  $("huP").parentElement.addEventListener("click", (e) => { const b = e.target.closest(".hu"); if (!b || !run) return; const v = run.views.find((x) => x.id === b.dataset.id); if (v && v.alive) { run.setFocus(v, clock); updWatch(); } });

  // ===== 観戦する：ライバル同士を戦わせて眺める（記録に残らない・v2.k3.spectate）=====
  const SPEC = Wd.RIVALS.filter((r) => !r.mirror);
  let specA = 0, specB = 1, sArena = null;
  function enterSpec() {
    if (sArena == null) { const g = SCS.makeRNG(newSeed()); specA = g.int(SPEC.length); specB = (specA + 1 + g.int(SPEC.length - 1)) % SPEC.length; sArena = Wd.arenaFor(SPEC[specB]); }
    renderSpec();
  }
  function renderSpec() {
    const col = (side, sel, other) => SPEC.map((r, i) => `<div class="sp-rv ${i === sel ? "on" : ""} ${i === other ? "off" : ""}" data-s="${side}" data-i="${i}" style="--rc:${r.pal.rimA}"><b>${esc(r.name)}</b><span class="sp-tks">${r.emb.map((e) => tkHtml(side === "A" ? "P" : "C", e, "tk-xs", r.pal)).join("")}</span></div>`).join("");
    $("spA").innerHTML = col("A", specA, specB); $("spB").innerHTML = col("B", specB, specA);
    $("sArena").innerHTML = Wd.ARENAS.map((a, i) => `<div class="acard ${a === sArena ? "on" : ""}" data-a="${i}"><img src="${a.mini}" alt=""><span>${esc(a.name)}</span></div>`).join("");
  }
  for (const id of ["spA", "spB"]) $(id).addEventListener("click", (e) => { const c = e.target.closest(".sp-rv"); if (!c || c.classList.contains("off")) return; if (c.dataset.s === "A") specA = +c.dataset.i; else specB = +c.dataset.i; renderSpec(); });
  $("sArena").addEventListener("click", (e) => { const c = e.target.closest(".acard"); if (!c) return; sArena = Wd.ARENAS[+c.dataset.a]; renderSpec(); });
  function spectate() {
    const A = SPEC[specA], B = SPEC[specB];
    sortieCfg = { spec: true, mine: { choices: A.squad.map((c) => c.slice()), emb: A.emb, names: A.names }, foe: { choices: B.squad.map((c) => c.slice()), emb: B.emb, names: uniqNames(A.names, B.names) },
      seed: newSeed(), arena: sArena || Wd.PLAZA, mod: Wd.modOf(sArena || Wd.PLAZA), formP: A.form, formC: B.form, rival: B, rivalA: A, orderP: null, pal: { P: A.pal, C: B.pal } };
    startRun(`${A.name} VS ${B.name}`);
  }
  $("sGo").addEventListener("click", () => spectate());

  // ===== リーグ：あなた＋ライバル7部隊の総当たり7節（v2.k5.league）=====
  const Lg = SCS2.league;
  const lgData = () => { let L = St.data.league; if (!Lg.valid(L)) { L = St.data.league = Lg.fresh(1); St.save(); } return L; };
  const lgName = (k) => (k === "you" ? "あなたの部隊" : Lg.rivalOf(k).name);
  const lgToks = (k) => (k === "you" ? St.data.squad.map((f) => tkHtml("P", f.emb, "tk-xs", Wd.YOU)) : Lg.rivalOf(k).emb.map((e) => tkHtml("C", e, "tk-xs", Lg.rivalOf(k).pal))).join("");
  function enterLeague() {
    const L = lgData(), done = L.round >= Lg.ROUNDS, order = Lg.standings(L);
    $("lgSeason").textContent = `シーズン ${L.season}`;
    $("lgTable").innerHTML = `<div class="lg-row h"><span>順位</span><span>部隊</span><b>試合</b><b>勝</b><b>分</b><b>敗</b><b>勝点</b></div>`
      + order.map((k, i) => { const t = L.table[k]; return `<div class="lg-row ${k === "you" ? "me" : ""}"><span class="rk">${i + 1}</span><span class="nm"><i class="tks">${lgToks(k)}</i>${esc(lgName(k))}</span><b>${t.p}</b><b>${t.w}</b><b>${t.d}</b><b>${t.l}</b><b class="pt">${t.pts}</b></div>`; }).join("");
    const last = L.log[L.log.length - 1], mark = (m, side) => (m.res === "d" ? "分" : (m.res === "a") === (side === "a") ? "勝" : "負");
    const lastHtml = last ? `<div class="lg-h2">第${L.log.length}節の結果</div>` + last.map((m) => `<div class="lg-m ${m.a === "you" || m.b === "you" ? "me" : ""}"><span class="${mark(m, "a") === "勝" ? "win" : ""}">${esc(lgName(m.a))}</span><i class="r r-${{ 勝: "w", 負: "l", 分: "d" }[mark(m, "a")]}">${mark(m, "a")}</i><i class="r r-${{ 勝: "w", 負: "l", 分: "d" }[mark(m, "b")]}">${mark(m, "b")}</i><span class="${mark(m, "b") === "勝" ? "win" : ""}">${esc(lgName(m.b))}</span></div>`).join("") : "";
    if (done) {
      const rank = order.indexOf("you") + 1;
      $("lgSide").innerHTML = `<div class="lg-final"><small>最終順位</small><b>${rank}<span>位</span></b><div class="lg-champ">優勝　${esc(lgName(order[0]))}</div></div>` + lastHtml;
      $("lgGo").textContent = "新しいシーズン";
    } else {
      const nm = Lg.nextMatch(L), foe = nm.foe, ar = Wd.arenaFor(foe), others = Lg.schedule(L.season)[L.round].filter((p) => !p.includes("you"));
      $("lgSide").innerHTML = `<div class="lg-h">第${L.round + 1}節</div>
        <div class="lg-next" style="--rc:${foe.pal.rimA}"><div class="lg-vs"><span>${esc(foe.name)}</span><span class="tks">${lgToks(foe.key)}</span></div>
          <div class="lg-where"><img src="${ar.mini}" alt=""><div>${esc(ar.name)}</div></div></div>
        <div class="lg-h2">ほかの試合</div>${others.map(([a, b]) => `<div class="lg-m"><span>${esc(lgName(a))}</span><i class="vs">VS</i><span>${esc(lgName(b))}</span></div>`).join("")}` + lastHtml;
      $("lgGo").textContent = "試合へ";
    }
  }
  // ===== 系譜：12体の世代交代（v2.k4.lineage）。家系図＝新しい5世代、あなたの3体の血筋を色で追う =====
  const Ln = SCS2.lineage, cvTree = reg($("cvTree"), 1840, 740);
  const BLOOD_PAL = [Wd.PAL.blue, { rgb: "70,220,210", rimA: "#4fe3d6", rimB: "#0f8f86", side: "#063d39", fx: "", dot: "" }, { rgb: "160,140,255", rimA: "#a596ff", rimB: "#4b3fcf", side: "#1d175e", fx: "", dot: "" }];
  const NEUTRAL = { rgb: "150,160,175", rimA: "#8b95a5", rimB: "#4a5260", side: "#20252c", fx: "", dot: "" };
  let lnSel = null;
  const lnData = () => { let L = St.data.lineage; if (!Ln.valid(L)) { L = St.data.lineage = Ln.genesis(newSeed(), St.data.squad); St.save(); } return L; };
  const bloodOf = (x) => x.line;
  const palOfX = (x) => { const k = bloodOf(x); return k < 0 ? NEUTRAL : BLOOD_PAL[k]; };
  const TX = (i) => 200 + (i + 0.5) * 135, TY = (r) => 78 + r * 148;
  function enterLine() { lnSel = null; $("lnPop").classList.remove("show"); renderLine(); }
  function renderLine() {
    const L = lnData(), cur = L.rows[L.rows.length - 1];
    $("lnGen").textContent = `第${cur.gen}世代`;
    const share = Ln.bloodShare(L);
    $("lnBlood").innerHTML = `<div class="lb-h">血筋</div>` + L.founders.map((f, k) => `<div class="lb">${tkHtml("P", f.emb, "tk-xs", BLOOD_PAL[k])}<i class="lb-bar"><b style="width:${(share[k] * 100).toFixed(0)}%;background:${BLOOD_PAL[k].rimA}"></b></i><span>${Math.round(share[k] * 100)}%</span></div>`).join("");
    drawTree();
  }
  function drawTree() {
    const L = lnData(), o = cvTree, c = o.ctx; c.setTransform(o.s, 0, 0, o.s, 0, 0); c.clearRect(0, 0, 1840, 740);
    const rows = L.rows, posOf = new Map(); rows.forEach((row, r) => row.pop.forEach((x, i) => posOf.set(x.id, { x: TX(i), y: TY(r), x0: x })));
    const selIds = new Set(); if (lnSel) { selIds.add(lnSel); const s = posOf.get(lnSel); if (s) { if (s.x0.pa) selIds.add(s.x0.pa); if (s.x0.pb) selIds.add(s.x0.pb); } }
    rows.forEach((row, r) => {                                                                  // 世代の札（戦場）
      const A = Ln.arenaOf(row.env.arena), y = TY(r);
      c.fillStyle = "#eaf3ff"; c.font = "900 24px 'Noto Sans JP', sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(`第${row.gen}世代`, 24, y - 13);
      c.fillStyle = "#9fb4cc"; c.font = "700 17px 'Noto Sans JP', sans-serif"; c.fillText(A.name, 24, y + 16);
      if (r > 0) row.pop.forEach((x, i) => {                                                   // 親から子への線（あなたの血筋は色つき）
        const k = bloodOf(x), col = k < 0 ? "150,160,175" : BLOOD_PAL[k].rgb;
        for (const [pid, w] of [[x.pa, 1], [x.pb, 0.55]]) {
          const p = posOf.get(pid); if (!p) continue; const on = lnSel === x.id || lnSel === pid;
          c.strokeStyle = `rgba(${col},${on ? 0.95 : (k < 0 ? 0.16 : 0.42) * w})`; c.lineWidth = on ? 4 : 2.2 * w + 0.6;
          c.beginPath(); c.moveTo(p.x, p.y + 34); c.bezierCurveTo(p.x, p.y + 80, TX(i), TY(r) - 80, TX(i), TY(r) - 34); c.stroke();
        }
      });
    });
    rows.forEach((row, r) => row.pop.forEach((x, i) => {
      const fought = !!row.parents, parent = fought && row.parents.includes(x.id);
      c.globalAlpha = fought && !parent ? 0.38 : 1;
      Bd.token(c, TX(i), TY(r), 34, { team: "P", emb: x.emb, pal: palOfX(x) });
      c.globalAlpha = 1;
      if (lnSel === x.id || selIds.has(x.id)) { c.strokeStyle = lnSel === x.id ? "#fff" : "rgba(255,255,255,.55)"; c.lineWidth = 3; c.setLineDash(lnSel === x.id ? [] : [6, 6]); Bd.circ(c, TX(i), TY(r), 44); c.stroke(); c.setLineDash([]); }
    }));
  }
  $("cvTree").addEventListener("click", (e) => {
    const L = lnData(), rc = $("cvTree").getBoundingClientRect(), mx = (e.clientX - rc.left) / rc.width * 1840, my = (e.clientY - rc.top) / rc.height * 740;
    let hit = null; L.rows.forEach((row, r) => row.pop.forEach((x, i) => { if (Math.hypot(mx - TX(i), my - TY(r)) < 40) hit = { x, i, r }; }));
    const pop = $("lnPop");
    if (!hit || lnSel === hit.x.id) { lnSel = null; pop.classList.remove("show"); drawTree(); return; }
    lnSel = hit.x.id; const x = hit.x, pal = palOfX(x);
    pop.innerHTML = `<div class="lp-h">${tkHtml("P", x.emb, "tk-xs", pal)}<b>${esc(x.fam)}</b><small>第${x.gen}世代</small></div><div class="lp-w">${Wd.wordsOf(x.choices).map((w) => `<span>${esc(w)}</span>`).join("")}</div>`;
    const left = clamp(TX(hit.i) + 52, 10, 1840 - 330), top = clamp(TY(hit.r) - 60, 10, 740 - 150);
    pop.style.left = left + "px"; pop.style.top = top + "px"; pop.classList.add("show"); drawTree();
  });
  function lnStep(n) { const L = lnData(); for (let i = 0; i < n; i++) Ln.step(L); St.save(); lnSel = null; $("lnPop").classList.remove("show"); renderLine(); }
  $("lnNext").addEventListener("click", () => lnStep(1));
  $("lnFive").addEventListener("click", () => lnStep(5));
  $("lnReset").addEventListener("click", () => { St.data.lineage = Ln.genesis(newSeed(), St.data.squad); St.save(); enterLine(); });

  $("lgGo").addEventListener("click", () => {
    const L = lgData();
    if (L.round >= Lg.ROUNDS) { St.data.league = Lg.fresh(L.season + 1); St.save(); enterLeague(); return; }
    const foe = Lg.nextMatch(L).foe, sq = St.data.squad;
    if (!L.pending || L.pending.round !== L.round) { L.pending = { round: L.round, seed: newSeed() }; St.save(); }   // この節の戦いの種（決着まで保つ）
    sortieCfg = { league: true, mine: { choices: sq.map((f) => f.choices.slice()), emb: sq.map((f) => f.emb), names: sq.map((f) => f.name) }, foe: { choices: foe.squad.map((c) => c.slice()), emb: foe.emb, names: uniqNames(sq.map((f) => f.name), foe.names) },
      seed: L.pending.seed, arena: Wd.arenaFor(foe), mod: Wd.modOf(Wd.arenaFor(foe)), formP: St.data.form, formC: foe.form, rival: foe, orderP: St.data.order ? St.data.order.slice() : null, pal: { P: Wd.YOU, C: foe.pal } };
    startRun(`第${L.round + 1}節　VS ${foe.name}`);
  });
  function setPause(p) { paused = p; $("icPause").setAttribute("d", paused ? "M16 12 L36 24 L16 36 Z" : "M17 13 V35 M31 13 V35"); $("icPause").style.fill = paused ? "#8fe0ff" : "none"; }
  $("wPause").onclick = () => setPause(!paused);
  $("wSpeed").onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; $("wSpd").textContent = "×" + speed; };
  let bubOn = true;
  $("wBub").onclick = () => { bubOn = !bubOn; $("wBub").classList.toggle("on", bubOn); };
  $("wFocus").onclick = () => { if (!run) return; const al = run.views.filter((v) => v.alive); if (!al.length) return; run.setFocus(al[(al.indexOf(run.focus) + 1) % al.length], clock); updWatch(); };
  $("wSkip").onclick = () => { if (!run) return; run.finish(clock); endBattle(true); };
  function updWatch() {
    if (!run) return; const b = run.battle;
    $("cT").textContent = b.turn;
    const v = run.focus || run.views.find((x) => x.team === "P" && x.alive) || run.views[0]; if (!v) return;   // 注目が決まるまでは青の先頭
    const fp = sortieCfg.pal[v.team]; $("fTk").className = "tk tk-lg" + (v.team === "C" ? " c" : ""); $("fTk").style.cssText = `--rim:${fp.rimA};--side:${fp.side};--glow:rgba(${fp.rgb},.45)`; $("fTk").querySelector("img").src = `assets/emblem/${v.emb}.png`;
    $("fName").textContent = v.name; $("fWord").textContent = v.words.join("・");
    $("fHp").style.width = (clamp(v.hp / v.maxHp, 0, 1) * 100).toFixed(1) + "%"; $("fHpT").textContent = `${Math.max(0, Math.round(v.hp))} / ${v.maxHp}`;
    $("fAct").textContent = ACT_OF[v.label] || v.label || "待機";
    const w = run.whyOf(v); if (w) $("fWhy").textContent = w;
  }
  let lastTurnShown = -1, lastFocus = null;
  function frameWatch(dt) {
    if (!run) return;
    if (!paused) { clock += dt * speed; run.tick(clock, dt, speed); }
    if (run.battle.turn !== lastTurnShown || run.focus !== lastFocus) { if (run.focus !== lastFocus) $("fWhy").textContent = ""; lastTurnShown = run.battle.turn; lastFocus = run.focus; updWatch(); }
    if (run.battle.over && !ended) endBattle(false);
    if (ended && !paused && clock - endAt > 2600) showResult();
    const o = cvWatch, c = o.ctx; c.setTransform(o.s, 0, 0, o.s, 0, 0); c.fillStyle = "#050b14"; c.fillRect(0, 0, FW, FH);   // 地図の外（端に寄った時の余白）は暗い色
    Bd.view(c, o.s, FW, FH, run.cam.x, run.cam.y, run.cam.z);
    Bd.drawBoard(c, { clock, views: run.views, fx: run.fx, pops: run.pops, focus: run.focus, whyOn: bubOn, obstacles: run.battle.obstacles, hazards: run.battle.hazards, mod: sortieCfg.mod, arena: sortieCfg.arena, pal: sortieCfg.pal, bleed: true });
    updHud();
    c.setTransform(o.s, 0, 0, o.s, 0, 0);
    const vg = c.createRadialGradient(FW / 2, FH / 2, FH * 0.42, FW / 2, FH / 2, FH * 1.05); vg.addColorStop(0, "rgba(4,8,16,0)"); vg.addColorStop(1, "rgba(4,8,16,.45)"); c.fillStyle = vg; c.fillRect(0, 0, FW, FH);
    const m = cvMini; m.ctx.setTransform(m.s, 0, 0, m.s, 0, 0); Bd.drawMini(m.ctx, 436, 245, { views: run.views, arena: sortieCfg.arena, pal: sortieCfg.pal }, run.cam);
  }
  const bannerOf = (r) => (sortieCfg.spec ? (r === "d" ? "引き分け" : `${(r === "w" ? sortieCfg.rivalA : sortieCfg.rival).name} の勝ち`) : { w: "勝利", l: "敗北", d: "引き分け" }[r]);
  function outcome() { const r = run.battle.result || {}; return r.type === "draw" ? "d" : r.winner === "PLR" ? "w" : "l"; }
  function endBattle(skip) {
    if (ended) { if (skip) showResult(); return; }
    ended = true; endAt = clock; result = outcome();
    if (!sortieCfg.spec) St.record(sortieCfg.rival.key, result);
    if (sortieCfg.league) { SCS2.league.finishRound(lgData(), result); St.save(); }   // ended で一度だけ   // 同じ節のほかの試合もここで決まる
    $("wEndMain").textContent = bannerOf(result); $("wEnd").classList.add("show");
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
        const vic = s.units.find((u) => u.id === id), killer = SCS2.insight.killerOf(s, id);
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
    const choicesOf = (id) => { const i = +id.slice(1); return id[0] === "P" ? sortieCfg.mine.choices[i] : sortieCfg.foe.choices[i]; };
    out.push(...SCS2.insight.surprises(snaps, choicesOf));                                     // 「そう来たか」＝性格の言葉と逆の行動（v2.k1.surprise）
    const pick = [];
    for (const h of out.sort((a, b) => b.score - a.score)) { if (pick.length >= 3) break; if (pick.some((p) => p.t === h.t || (p.id === h.id && (p.cap === h.cap || Math.abs(p.t - h.t) < 3)))) continue; pick.push(h); }
    return pick.sort((a, b) => a.t - b.t);
  }
  function showResult() {
    if (cur === "result" || !run) return;
    const r = result || outcome(), an = run.battle.getAnalysis();
    $("rsBanner").textContent = bannerOf(r); $("rsBanner").className = "rs-banner " + (sortieCfg.spec ? "spec" : { w: "", l: "lose", d: "draw" }[r]);
    if (sortieCfg.spec) { $("rsBanner").style.cssText = r === "d" ? "" : `--rc:${sortieCfg.pal[r === "w" ? "P" : "C"].rimA}`; $("rsVerdict").textContent = `${run.battle.turn} ターン・${sortieCfg.rivalA.name} VS ${sortieCfg.rival.name}`; }
    else { $("rsBanner").style.cssText = ""; $("rsVerdict").textContent = `${an.plr.verdict}　（${run.battle.turn} ターン・VS ${sortieCfg.rival.name}）`; }
    hls = findHighlights(run.snaps);
    $("rsCards").style.gridTemplateColumns = `repeat(${Math.max(1, hls.length)}, 600px)`;
    $("rsCards").innerHTML = hls.length ? hls.map((h, i) => `<div class="hl ${h.surprise ? "sp" : ""}" data-i="${i}"><div class="hl-cv"><canvas></canvas><span class="hl-rp">REPLAY</span></div><div class="hl-cap">${esc(h.cap)}</div><div class="hl-sub">${esc(h.sub ? h.sub + "・" : "")}ターン ${run.snaps[h.t].turn}</div></div>`).join("")
      : `<div class="rs-empty">見どころのない静かな戦いだった。</div>`;
    for (let i = CVS.length - 1; i >= 0; i--) if (!document.body.contains(CVS[i].cv)) CVS.splice(i, 1);
    cardCvs.length = 0; document.querySelectorAll("#rsCards canvas").forEach((cv) => cardCvs.push(reg(cv, 564, 317)));
    const last = run.snaps[run.snaps.length - 1];
    const stripT = sortieCfg.spec && r === "l" ? "C" : "P";                                        // 観戦では勝った側を並べる
    $("rsStrip").innerHTML = last.units.filter((u) => u.team === stripT).map((u) => `<div class="rs-u">${tkHtml(stripT, u.emb, u.alive ? "" : "dead", sortieCfg.pal[stripT])}<div>${esc(u.name)}<small>${u.alive ? `残り HP ${Math.max(0, Math.round(u.hp))}` : "倒れた"}</small></div></div>`).join("");
    replays = hls.map((h) => {                                                                // 見どころは動きで繰り返す（前2ターン〜後1ターン・決め手はゆっくり）
      const PX = pxOf(sortieCfg.arena), sn = run.snaps[h.t], sub = sn.units.find((u) => u.id === h.id), oth = h.other ? sn.units.find((u) => u.id === h.other) : null;
      const pts = [sub].concat(oth ? [oth] : []).concat(h.t > 0 ? [run.snaps[h.t - 1].units.find((u) => u.id === h.id)] : []).filter(Boolean);
      const xs = pts.map((p) => p.x * PX), ys = pts.map((p) => p.y * PX);
      const z = clamp(Math.min(564 / (Math.max(...xs) - Math.min(...xs) + 420), 317 / (Math.max(...ys) - Math.min(...ys) + 300)), 0.32, 0.69);
      const cx = clamp((Math.max(...xs) + Math.min(...xs)) / 2, 282 / z, W - 282 / z), cy = clamp((Math.max(...ys) + Math.min(...ys)) / 2, 158 / z, H - 158 / z);
      return { h, z, cx, cy, rp: SCS2.insight.makeReplay(run.snaps, h.t - 2, h.t + 1, h.t) };
    });
    $("rsAgain").textContent = sortieCfg.league ? "リーグへ" : "もう一度";
    resClock = 0; go("result"); drawCards();
  }
  let replays = [], resClock = 0;
  function drawCards() {
    replays.forEach((r, i) => {
      const o = cardCvs[i]; if (!o) return; r.rp.tick(resClock); const vs = r.rp.views, sub = vs.find((v) => v.id === r.h.id);
      Bd.view(o.ctx, o.s, 564, 317, r.cx, r.cy, r.z);
      Bd.drawBoard(o.ctx, { clock: resClock, views: vs, fx: r.rp.fx, pops: r.rp.pops, focus: null, highlight: sub && sub.alive ? sub : null, whyOn: true, obstacles: run.snaps[r.h.t].obstacles, hazards: run.snaps[r.h.t].hazards, mod: sortieCfg.mod, arena: sortieCfg.arena, pal: sortieCfg.pal });
    });
  }
  function frameResult(dt) { resClock += dt; drawCards(); }
  $("rsCards").addEventListener("click", (e) => { const c = e.target.closest(".hl"); if (c) openWhy(hls[+c.dataset.i]); });
  $("rsAgain").addEventListener("click", () => (sortieCfg && sortieCfg.league ? go("league") : sortie()));

  // ===== なぜ、そう動いた？ =====
  const cvWhy = reg($("cvWhy"), 1278, 738);
  let why = null, whyTimer = null;
  function openWhy(h) { why = { t: h.t, id: h.id, cap: h.cap }; $("whyRange").max = run.snaps.length - 1; $("whyRange").value = h.t; stopWhyPlay(); go("why"); drawWhy(); }
  function drawWhy() {
    if (!why || !run) return;
    const PX = pxOf(sortieCfg.arena), snap = run.snaps[why.t], { vs, by } = snapViews(snap), sub = by.get(why.id);
    const steps = SCS2.insight.chainFor(run.snaps, why.t, why.id, ACT_OF);                 // ①きっかけ→②した事→③その結果（v2.k2.chain）
    const same = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1, arrows = [];
    for (const st of steps) {
      if (!st.a || !st.b) continue;
      const short = st.still || Math.hypot(st.a.x - st.b.x, st.a.y - st.b.y) * PX < 110;
      if (short || arrows.some((o) => !o.mark && same(o.a, st.a) && same(o.b, st.b))) { arrows.push({ at: st.n === 1 ? st.a : st.b, n: st.n, team: st.team, mark: true }); continue; }   // 同じ矢印は重ねず、番号札だけ
      const back = arrows.find((o) => !o.mark && same(o.a, st.b) && same(o.b, st.a)); if (back) back.lane = 1;
      arrows.push({ a: st.a, b: st.b, n: st.n, team: st.team, lane: back ? -1 : 0 });
    }
    const pts = [sub].concat(steps.flatMap((st) => [st.a, st.b]).filter(Boolean)); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of pts) { x0 = Math.min(x0, p.x * PX); x1 = Math.max(x1, p.x * PX); y0 = Math.min(y0, p.y * PX); y1 = Math.max(y1, p.y * PX); }
    const z = clamp(Math.min(1278 / (x1 - x0 + 600), 738 / (y1 - y0 + 420)), 0.69, 1.25);   // 0.69＝地図（1920×1080）が枠を覆う一番引いた所
    const cx = clamp((x0 + x1) / 2, 639 / z, W - 639 / z), cy = clamp((y0 + y1) / 2, 369 / z, H - 369 / z);
    const o = cvWhy; o.ctx.setTransform(o.s, 0, 0, o.s, 0, 0); o.ctx.fillStyle = "#050b14"; o.ctx.fillRect(0, 0, 1278, 738);
    Bd.view(o.ctx, o.s, 1278, 738, cx, cy, z);
    Bd.drawBoard(o.ctx, { clock: 1000, views: vs, fx: [], focus: null, highlight: sub, arrows, aim: false, whyOn: true, obstacles: snap.obstacles, hazards: snap.hazards, mod: sortieCfg.mod, arena: sortieCfg.arena, pal: sortieCfg.pal });
    const TAG = { cause: "きっかけ", act: "した事", result: "その結果" };
    $("whySide").innerHTML = `<div class="ws-head">${tkHtml(sub.team, sub.emb, "", sortieCfg.pal[sub.team])}<div><div class="ws-name">${esc(sub.name)}</div><div class="ws-cap">${esc(why.cap)}</div></div></div>`
      + `<div class="ws-chain">` + steps.map((st) => `<div class="ws-step"><b class="ws-n">${st.n}</b><div><small>${TAG[st.kind] || ""}</small><p>${esc(st.text)}</p></div></div>`).join(`<i class="ws-arrow"></i>`) + `</div>`;
    $("whyTurn").textContent = `ターン ${snap.turn}`;
  }
  $("whyRange").addEventListener("input", () => { if (!why) return; why.t = +$("whyRange").value; drawWhy(); });
  function stopWhyPlay() { if (whyTimer) clearInterval(whyTimer); whyTimer = null; $("icWhyPlay").setAttribute("d", "M16 12 L36 24 L16 36 Z"); }
  $("whyPlay").addEventListener("click", () => {
    if (whyTimer) return stopWhyPlay();
    if (why.t >= run.snaps.length - 1) { why.t = 0; $("whyRange").value = 0; drawWhy(); }
    $("icWhyPlay").setAttribute("d", "M17 13 H23 V35 H17 Z M27 13 H33 V35 H27 Z");
    whyTimer = setInterval(() => { if (why.t >= run.snaps.length - 1) return stopWhyPlay(); why.t++; $("whyRange").value = why.t; drawWhy(); }, 700);
  });
  $("whyBack").addEventListener("click", () => { stopWhyPlay(); go("result"); });

  // ===== 記録 =====
  function enterRecords() {
    $("recTable").innerHTML = `<div class="rec-row h"><span>相手</span><b>勝</b><b>敗</b><b>分</b></div>` + Wd.RIVALS.map((r) => { const x = St.data.records[r.key] || { w: 0, l: 0, d: 0 };
      return `<div class="rec-row"><span class="n">${esc(r.name)}</span><b>${x.w}</b><b>${x.l}</b><b>${x.d}</b></div>`; }).join("");
  }

  // ===== ループ =====
  function frame(now) { try { step(now); } catch (err) { console.error(err); } requestAnimationFrame(frame); }
  function step(now) {
    const dt = real ? clamp(now - real, 0, 100) : 16; real = now;
    if (cur === "title") frameTitle(dt); else if (cur === "edit") frameEdit(); else if (cur === "watch") frameWatch(dt); else if (cur === "result") frameResult(dt);
  }
  // 絵が読み込まれたら止まっている画面（結果・なぜ？）を描き直す。先に読み込んでおく
  Bd.onLoad = () => { if (cur === "result") drawCards(); else if (cur === "why") drawWhy(); else if (cur === "line") drawTree(); };
  Wd.ARENAS.forEach((a) => { Bd.img(a.map); Bd.img(a.mini); });
  Wd.EMB.forEach((e) => Bd.emb(e));
  Object.values(Wd.WEAPON_ICON).forEach((k) => Bd.img(`assets/weapon/${k}.png`));               // 武器アイコンも先に読む（初回に遅れて出ないように）
  addEventListener("resize", fit); fit();
  requestAnimationFrame(frame);
  // 検証用：タブが裏で requestAnimationFrame が止まっていても時間を進めて描く（遊びには使わない）
  window.__v2 = { run(ms) { let r = performance.now(); real = r; for (let i = 0; i < ms / 16; i++) { r += 16; step(r); } real = performance.now(); return { cur, turn: run && run.battle.turn, over: run && run.battle.over }; }, go, get runner() { return run; }, get hls() { return hls; } };
})();
