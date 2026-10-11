/* v2/js/board.js — 戦場の描画（地図・駒・狙い線・残像・演出・吹き出し・因果の矢印）。
 * 座標は「地図の絵の px」（1920×1080・1単位＝12px）。呼ぶ側が ctx.setTransform でカメラを決める。
 * 描くのは見えるものだけ：駒の状態（位置・向き・HP・行動ラベル）とエンジンの events。挙動24（小カテゴリ）は使わない。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const W = 1920, H = 1080, R = 41;
  let PX = 12;                                                    // 1単位の px＝1920/戦場の幅（戦場ごとに違う。描く前に usePX）
  const usePX = (arena) => { PX = W / arena.w; return PX; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const circ = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); };
  const DEF_P = { rgb: "80,170,255", rimA: "#58aeff", rimB: "#0f4fcf", side: "#082a6e", fx: "120,200,255", dot: "#3d9bff" };
  const DEF_C = { rgb: "255,80,80", rimA: "#ff6262", rimB: "#b3161c", side: "#5e0b10", fx: "255,110,110", dot: "#ff4d4d" };
  const PALS = { P: DEF_P, C: DEF_C };                             // いま描いている戦いの両軍の色（描く前に usePal）
  const usePal = (pal) => { PALS.P = (pal && pal.P) || DEF_P; PALS.C = (pal && pal.C) || DEF_C; };
  const palT = (P) => (P ? PALS.P : PALS.C);
  const teamCol = (P, a) => `rgba(${palT(P).rgb},${a})`;

  const IMGS = {};
  function img(src) { let im = IMGS[src]; if (!im) { im = new Image(); im.onload = () => { if (SCS2.board.onLoad) SCS2.board.onLoad(); }; im.src = src; IMGS[src] = im; } return im.complete && im.naturalWidth ? im : null; }
  const emb = (k) => img("assets/emblem/" + k + ".png");

  // ===== 地図 =====
  // 地図の外（引いた時に見える余白）：地図をぼかして暗くし、外へ続いているように見せる。戦場ごとに一度だけ作る
  const BLEED = {}, BL = 420;
  function drawBleed(ctx, st) {
    const src = st.arena.map; let c = BLEED[src];
    if (!c) { const m = img(src); if (!m) return; c = document.createElement("canvas"); c.width = Math.round((W + 2 * BL) / 4); c.height = Math.round((H + 2 * BL) / 4);
      const x = c.getContext("2d"); x.filter = "blur(5px) brightness(.42) saturate(.75)"; x.drawImage(m, -6, -6, c.width + 12, c.height + 12); BLEED[src] = c; }
    ctx.drawImage(c, -BL, -BL, W + 2 * BL, H + 2 * BL);
  }
  function drawMap(ctx, st) {
    const m = img(st.arena.map);
    if (m) ctx.drawImage(m, 0, 0, W, H); else { ctx.fillStyle = "#1c2a1c"; ctx.fillRect(0, 0, W, H); }
    st.arena.terrain.forEach((z, i) => {                                                        // 溶岩の揺らぎ
      if (z.t !== "lava" && z.t !== "lavapit") return;
      ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = `rgba(255,120,30,${0.05 + 0.05 * Math.sin(st.clock / 520 + i * 1.7)})`;
      ctx.fillRect(z.x * PX, z.y * PX, z.w * PX, z.h * PX); ctx.globalCompositeOperation = "source-over";
    });
    for (const ob of st.obstacles || []) if (ob.hp <= 0) { ctx.fillStyle = "rgba(28,22,16,.5)"; ctx.fillRect(ob.x * PX, ob.y * PX, ob.w * PX, ob.h * PX); } // 崩れた遮蔽
    for (const hz of st.hazards || []) {                                                         // 燃える地面（火炎放射器の延焼）
      if (!(hz.turns > 0)) continue;
      const cx = (hz.x + hz.w / 2) * PX, cy = (hz.y + hz.h / 2) * PX, r = Math.max(hz.w, hz.h) * PX * 0.6;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, `rgba(255,170,60,${0.55 + 0.15 * Math.sin(st.clock / 90 + cx)})`); g.addColorStop(1, "rgba(255,60,0,0)");
      ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = g; circ(ctx, cx, cy, r); ctx.fill(); ctx.globalCompositeOperation = "source-over";
    }
  }
  // ===== 天気（[[v2ゲーム設計]] v2.fx.spec）：濃霧＝流れる濃い霧。灼熱は戦場には描かず、枠が赤く光る（v2.fx.heat2・画面の CSS）=====
  function drawWeather(ctx, st) {
    const t = st.clock;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();                               // 天気は地図の中だけ（地図の外の余白にはかけない）
    if (st.mod === "濃霧") {
      ctx.fillStyle = "rgba(200,214,226,.20)"; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 11; i++) {
        const sp = 0.010 + (i % 4) * 0.004, dir = i % 2 ? 1 : -1, r = 300 + (i * 97) % 260;
        const x = ((i * 389 + t * sp * dir) % (W + 2 * r) + (W + 2 * r)) % (W + 2 * r) - r, y = (i * 211 + Math.sin(t / 4000 + i) * 60) % H;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(222,232,240,${0.30 + 0.08 * Math.sin(t / 1700 + i)})`); g.addColorStop(1, "rgba(222,232,240,0)");
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    ctx.restore();
  }

  // ===== 隊形：位置を保っている味方どうしを細い線で結ぶ（戦列＝横並び・楔＝先頭から両翼・円陣＝三角）=====
  function drawFormation(ctx, st) {
    for (const tm of ["P", "C"]) {
      const us = st.views.filter((v) => v.team === tm && v.alive && v.formHeld); if (us.length < 2) continue;
      const fk = us[0].form, P = tm === "P", edges = [];
      if (fk === "line") { const s2 = us.slice().sort((a, b) => a.y - b.y); for (let i = 1; i < s2.length; i++) edges.push([s2[i - 1], s2[i]]); }
      else if (fk === "wedge") { const s2 = us.slice().sort((a, b) => a.rank - b.rank); for (let i = 1; i < s2.length; i++) edges.push([s2[0], s2[i]]); }
      else { for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) edges.push([us[i], us[j]]); }
      ctx.save(); ctx.lineCap = "round"; ctx.shadowColor = teamCol(P, 0.9); ctx.shadowBlur = 10;
      for (const [a, b] of edges) {
        const ax = a.x * PX, ay = a.y * PX, bx = b.x * PX, by = b.y * PX, d = Math.hypot(bx - ax, by - ay); if (d < R * 2.2) continue;
        const ux = (bx - ax) / d, uy = (by - ay) / d;
        ctx.strokeStyle = teamCol(P, 0.38); ctx.lineWidth = 5; ctx.setLineDash([2, 12]); ctx.lineDashOffset = -st.clock / 80;
        ctx.beginPath(); ctx.moveTo(ax + ux * R * 1.1, ay + uy * R * 1.1); ctx.lineTo(bx - ux * R * 1.1, by - uy * R * 1.1); ctx.stroke();
      }
      ctx.restore();
    }
  }
  // ===== 地形と駒の状態（見えるだけ。文字は出さない）=====
  function terrainOf(st, v) { for (const z of st.arena.terrain) if (v.x >= z.x && v.x <= z.x + z.w && v.y >= z.y && v.y <= z.y + z.h) return z.t; return null; }
  function drawUnder(ctx, st, v) {                                                           // 駒の下：沼の波紋・高所の光の輪
    if (!v.alive) return;
    const tt = terrainOf(st, v), x = v.x * PX, y = v.y * PX;
    if (tt === "swamp") {
      ctx.save(); ctx.lineWidth = 4.5; ctx.shadowColor = "rgba(0,40,40,.6)"; ctx.shadowBlur = 4;
      for (let k = 0; k < 3; k++) { const p = ((st.clock / 1400 + k / 3) % 1); ctx.strokeStyle = `rgba(215,255,245,${0.9 * (1 - p)})`; ctx.beginPath(); ctx.ellipse(x, y + R * 0.25, R * (1.05 + p * 0.95), R * (0.6 + p * 0.55), 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    } else if (tt === "highground") {
      ctx.save(); const g = ctx.createRadialGradient(x, y + 8, R * 0.6, x, y + 8, R * 1.8); g.addColorStop(0, "rgba(255,230,150,.0)"); g.addColorStop(0.55, "rgba(255,230,150,.55)"); g.addColorStop(1, "rgba(255,230,150,0)");
      ctx.fillStyle = g; circ(ctx, x, y + 8, R * 1.8); ctx.fill();
      ctx.shadowColor = "rgba(60,40,0,.8)"; ctx.shadowBlur = 5; ctx.strokeStyle = "rgba(255,246,200,.95)"; ctx.lineWidth = 4; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -st.clock / 60; circ(ctx, x, y + 8, R * 1.4); ctx.stroke(); ctx.restore();
    }
  }
  function drawOver(ctx, st, v) {                                                            // 駒の上：茂みの葉・疲れの湯気
    if (!v.alive) return;
    const tt = terrainOf(st, v), x = v.x * PX, y = v.y * PX;
    if (tt === "forest") {
      ctx.save();
      for (let k = 0; k < 6; k++) {                                                          // 縁に葉がかぶる（紋章と陣営の色は見える）
        const a = k * 1.05 + 0.3, rr = R * (0.98 + (k % 2) * 0.08), sw = Math.sin(st.clock / 700 + k) * 0.14;
        const lx = x + Math.cos(a) * rr, ly = y + Math.sin(a) * rr * 0.92;
        ctx.fillStyle = k % 2 ? "rgba(52,120,48,.85)" : "rgba(78,150,60,.82)";
        ctx.beginPath(); ctx.ellipse(lx, ly, R * 0.36, R * 0.16, a + 1.4 + sw, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(20,50,20,.5)"; ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.restore();
    }
    if (v.stamina != null && v.stamina < 0.4) {
      ctx.save(); const n = v.stamina < 0.2 ? 3 : 2;
      for (let k = 0; k < n; k++) { const p = ((st.clock / 1100 + k / n) % 1), px = x - R * 0.5 + k * R * 0.5 + Math.sin(p * 6 + k) * 6, py = y - R * 0.9 - p * R * 1.3;
        ctx.fillStyle = `rgba(245,248,252,${0.8 * (1 - p)})`; ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 6; circ(ctx, px, py, 9 + p * 14); ctx.fill(); }
      ctx.restore();
    }
  }
  // ===== 当たりの文字（ダメージの数字・会心・外れ）=====
  function drawPops(ctx, st) {
    const pops = st.pops || []; ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let i = pops.length - 1; i >= 0; i--) { const q = (st.clock - pops[i].t0) / 950; if (q > 1) pops.splice(i, 1); }
    const stack = new Map();                                                                    // 同じ駒に重なる文字は上へ積む（吹き出しと反対の左上に出す）
    for (const p of pops.slice().sort((a, b) => a.t0 - b.t0)) {
      const q = (st.clock - p.t0) / 950; if (q < 0) continue;
      const k = stack.get(p.v) || 0; stack.set(p.v, k + 1);
      const x = p.v.x * PX - R * 0.75, y = p.v.y * PX - R * 1.05 - k * 40 - q * 40, a = q < 0.75 ? 1 : (1 - q) / 0.25, big = p.kind === "crit";
      ctx.globalAlpha = a; ctx.font = `${big ? 900 : 800} ${big ? 46 : p.kind === "miss" ? 26 : 34}px "Noto Sans JP", sans-serif`;
      const hw = ctx.measureText(p.text).width / 2 + 14, tx = Math.max(hw, Math.min(W - hw, x)), ty = Math.max(30, y);   // 戦場の端の駒でも文字が切れないように
      ctx.lineWidth = big ? 8 : 6; ctx.strokeStyle = "rgba(6,10,18,.9)"; ctx.strokeText(p.text, tx, ty);
      ctx.fillStyle = big ? "#ffd84a" : p.kind === "miss" ? "#c9d4e2" : "#ffffff"; ctx.fillText(p.text, tx, ty);
    }
    ctx.restore();
  }

  // ===== 狙い線（射撃・集中・必殺・温存の駒→的）=====
  function drawAim(ctx, st) {
    ctx.save(); ctx.lineWidth = 4.5; ctx.lineCap = "round";
    for (const v of st.views) {
      if (!v.alive || !v.tgt || !v.tgt.alive) continue;
      if (!(v.label === "射撃" || v.label === "集中" || v.label === "必殺" || v.label === "温存")) continue;
      const ax = v.x * PX, ay = v.y * PX, bx = v.tgt.x * PX, by = v.tgt.y * PX, d = Math.hypot(bx - ax, by - ay); if (d < R * 2.4) continue;
      const ux = (bx - ax) / d, uy = (by - ay) / d, sx = ax + ux * (R + 6), sy = ay + uy * (R + 6), ex = bx - ux * (R + 10), ey = by - uy * (R + 10), P = v.team === "P";
      ctx.setLineDash([16, 11]); ctx.lineDashOffset = -st.clock / 40;
      ctx.strokeStyle = teamCol(P, 0.85); ctx.shadowColor = teamCol(P, 0.9); ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = teamCol(P, 0.95); ctx.beginPath();
      ctx.moveTo(ex + ux * 12, ey + uy * 12); ctx.lineTo(ex - uy * 9, ey + ux * 9); ctx.lineTo(ex + uy * 9, ey - ux * 9); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function drawTrails(ctx, st) {
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
    for (const v of st.views) {
      const tr = v.trail; if (!tr || tr.length < 2) continue;
      const P = v.team === "P", strong = v.label === "退避" || v.label === "立て直し" || v === st.focus;
      for (let i = 1; i < tr.length; i++) {
        const a = tr[i - 1], b = tr[i], f = i / tr.length, age = clamp(1 - (st.clock - b.t) / 520, 0, 1);
        ctx.strokeStyle = teamCol(P, (strong ? 0.5 : 0.28) * f * age); ctx.lineWidth = R * (strong ? 1.5 : 1.0) * f;
        ctx.beginPath(); ctx.moveTo(a.x * PX, a.y * PX); ctx.lineTo(b.x * PX, b.y * PX); ctx.stroke();
        ctx.strokeStyle = `rgba(230,245,255,${(strong ? 0.55 : 0.25) * f * age})`; ctx.lineWidth = R * 0.18 * f;
        ctx.beginPath(); ctx.moveTo(a.x * PX, a.y * PX); ctx.lineTo(b.x * PX, b.y * PX); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ===== 駒 =====
  function token(ctx, x, y, r, o) {                                                            // o: {team, emb, dead, hpf, ang, hit, dim}
    const P = o.team === "P", dead = !!o.dead;
    const pp = o.pal || palT(P), rimA = dead ? "#71767e" : pp.rimA, rimB = dead ? "#3b3f45" : pp.rimB, side = dead ? "#24272c" : pp.side;
    ctx.save();
    if (dead) ctx.globalAlpha = 0.82;
    if (!dead) { ctx.shadowColor = `rgba(${pp.rgb},.75)`; ctx.shadowBlur = r * 0.55; ctx.fillStyle = side; circ(ctx, x, y + r * 0.07, r); ctx.fill(); }
    ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = r * 0.4; ctx.shadowOffsetY = r * 0.22;
    ctx.fillStyle = side; circ(ctx, x, y + r * 0.17, r); ctx.fill();
    ctx.shadowColor = "transparent";
    const g = ctx.createLinearGradient(x, y - r, x, y + r); g.addColorStop(0, rimA); g.addColorStop(1, rimB);
    ctx.fillStyle = g; circ(ctx, x, y, r); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = r * 0.05; ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.lineWidth = r * 0.05; ctx.beginPath(); ctx.arc(x, y, r * 0.96, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    const fr = r * 0.72, fg = ctx.createRadialGradient(x - fr * 0.3, y - fr * 0.35, fr * 0.1, x, y, fr);
    fg.addColorStop(0, dead ? "#3a3c40" : "#4a505c"); fg.addColorStop(1, "#1b1e24"); ctx.fillStyle = fg; circ(ctx, x, y, fr); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = r * 0.06; circ(ctx, x, y, fr); ctx.stroke();
    const im = emb(o.emb); if (im) { ctx.globalAlpha = dead ? 0.3 : 0.9; const s = fr * 1.22; ctx.drawImage(im, x - s / 2, y - s / 2, s, s); ctx.globalAlpha = dead ? 0.82 : 1; }
    if (!dead) {
      const f = o.hpf == null ? 1 : clamp(o.hpf, 0, 1);                                          // 縁の暗い弧＝失ったHP
      if (f < 0.999) { ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = r - fr - r * 0.07; ctx.beginPath(); ctx.arc(x, y, (r + fr) / 2, -Math.PI / 2 + f * Math.PI * 2, Math.PI * 1.5); ctx.stroke(); }
      if (o.ang != null) {                                                                        // 向きの切り欠き
        const nx = Math.cos(o.ang), ny = Math.sin(o.ang), k = r / 41;
        ctx.fillStyle = rimA; ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1.5 * k; ctx.beginPath();
        ctx.moveTo(x + nx * (r + 11 * k), y + ny * (r + 11 * k)); ctx.lineTo(x + nx * (r - 2 * k) - ny * 9 * k, y + ny * (r - 2 * k) + nx * 9 * k); ctx.lineTo(x + nx * (r - 2 * k) + ny * 9 * k, y + ny * (r - 2 * k) - nx * 9 * k); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    } else {
      ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = r * 0.12; ctx.lineCap = "round"; const k = fr * 0.55;
      ctx.beginPath(); ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); ctx.stroke();
    }
    if (o.hit) { ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = "rgba(255,255,255,.55)"; circ(ctx, x, y, r); ctx.fill(); }
    ctx.restore();
  }
  function drawToken(ctx, st, v) {
    const dead = !v.alive && st.clock >= (v.koT || 0), hit = st.clock >= v.hitT && st.clock < v.hitT + 150;
    const sh = hit ? Math.sin(st.clock / 12) * 3 : 0;
    const ghost = !dead && v.hidden, bush = !dead && terrainOf(st, v) === "forest";           // 敵にまだ見つかっていない／茂みの中＝薄く
    if (ghost || bush) { ctx.save(); ctx.globalAlpha = ghost && bush ? 0.42 : 0.6; }
    token(ctx, v.x * PX + sh, v.y * PX, R, { team: v.team, emb: v.emb, dead, hpf: v.hp / v.maxHp, ang: v.ang, hit });
    if (ghost || bush) ctx.restore();
    if (ghost) { ctx.save(); ctx.strokeStyle = teamCol(v.team === "P", 0.85); ctx.lineWidth = 3; ctx.setLineDash([7, 7]); ctx.lineDashOffset = st.clock / 50; circ(ctx, v.x * PX + sh, v.y * PX, R + 6); ctx.stroke(); ctx.restore(); }
  }
  // 注目している駒が向かおうとしている所（v3 の頭の目的地）：細い点線と小さな印
  function drawPlan(ctx, st, v) {
    if (!v.plan) return; const x0 = v.x * PX, y0 = v.y * PX, x1 = v.plan.x * PX, y1 = v.plan.y * PX; if (Math.hypot(x1 - x0, y1 - y0) < R * 1.6) return;
    const P = v.team === "P"; ctx.save(); ctx.lineCap = "round";
    ctx.strokeStyle = teamCol(P, 0.55); ctx.lineWidth = 3; ctx.setLineDash([2, 11]); ctx.lineDashOffset = -st.clock / 60;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = teamCol(P, 0.75); ctx.lineWidth = 2.5; const k = 9; ctx.beginPath(); ctx.moveTo(x1 - k, y1); ctx.lineTo(x1 + k, y1); ctx.moveTo(x1, y1 - k); ctx.lineTo(x1, y1 + k); ctx.stroke();
    circ(ctx, x1, y1, 14); ctx.stroke(); ctx.restore();
  }
  function drawRing(ctx, st, v, strong) {
    if (!v) return;
    const x = v.x * PX, y = v.y * PX, P = v.team === "P";
    ctx.save(); ctx.shadowColor = teamCol(P, 1); ctx.shadowBlur = 22;
    ctx.strokeStyle = "rgba(235,248,255,.95)"; ctx.lineWidth = strong ? 5 : 4; circ(ctx, x, y, R + 9); ctx.stroke();
    ctx.setLineDash([10, 8]); ctx.lineDashOffset = st.clock / 30; ctx.strokeStyle = teamCol(P, 0.9); ctx.lineWidth = 3; circ(ctx, x, y, R + 17); ctx.stroke();
    ctx.restore();
  }

  // ===== 演出（エンジンの events から）=====
  function drawFx(ctx, st) {
    const fx = st.fx || []; ctx.save(); ctx.lineCap = "round";
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], p = (st.clock - f.t0) / f.dur; if (p < 0) continue; if (p > 1) { fx.splice(i, 1); continue; }
      const P = f.team === "P", ax = f.va.x * PX, ay = f.va.y * PX, bx = f.vb.x * PX, by = f.vb.y * PX, d = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / d, uy = (by - ay) / d;
      const col = palT(P).fx;
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
        const sc = palT(P).fx;
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
      }
      ctx.globalCompositeOperation = "source-over"; ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // ===== 吹き出し（行動ラベル→アイコン。理由の中身は書かない＝見えるのは何をしようとしているかだけ）=====
  const ICON_OF = { 射撃: "aim", 集中: "aim", 斬: "swords", 背後: "swords", 側面: "swords", 剝がし: "swords", かばう: "shield", 盾: "shield", 遮蔽: "shield",
    立て直し: "run", 退避: "run", 必殺: "bang", 攻勢: "bang", 詰め: "bang", 装填: "reload", 温存: "dots", 索敵: "dots", 様子見: "dots", 待機: "dots" };
  function icon(c, kind, x, y, s, col) {
    c.save(); c.translate(x, y); c.strokeStyle = c.fillStyle = col || "#1b2029"; c.lineWidth = s * 0.2; c.lineCap = c.lineJoin = "round";
    if (kind === "aim") { circ(c, 0, 0, s * 0.6); c.stroke(); c.beginPath(); c.moveTo(0, -s); c.lineTo(0, -s * 0.3); c.moveTo(0, s * 0.3); c.lineTo(0, s); c.moveTo(-s, 0); c.lineTo(-s * 0.3, 0); c.moveTo(s * 0.3, 0); c.lineTo(s, 0); c.stroke(); circ(c, 0, 0, s * 0.13); c.fill(); }
    else if (kind === "swords") { c.beginPath(); c.moveTo(-s * 0.8, -s * 0.8); c.lineTo(s * 0.55, s * 0.55); c.moveTo(s * 0.8, -s * 0.8); c.lineTo(-s * 0.55, s * 0.55); c.moveTo(-s * 0.8, s * 0.3); c.lineTo(-s * 0.3, s * 0.8); c.moveTo(s * 0.8, s * 0.3); c.lineTo(s * 0.3, s * 0.8); c.stroke(); }
    else if (kind === "shield") { c.beginPath(); c.moveTo(0, -s * 0.9); c.lineTo(s * 0.75, -s * 0.58); c.lineTo(s * 0.64, s * 0.2); c.quadraticCurveTo(s * 0.35, s * 0.72, 0, s * 0.92); c.quadraticCurveTo(-s * 0.35, s * 0.72, -s * 0.64, s * 0.2); c.lineTo(-s * 0.75, -s * 0.58); c.closePath(); c.fill(); }
    else if (kind === "run") { circ(c, s * 0.3, -s * 0.66, s * 0.19); c.fill(); c.beginPath(); c.moveTo(s * 0.15, -s * 0.38); c.lineTo(-s * 0.1, s * 0.15); c.moveTo(-s * 0.55, -s * 0.2); c.lineTo(s * 0.05, -s * 0.32); c.lineTo(s * 0.5, -s * 0.02); c.moveTo(-s * 0.1, s * 0.15); c.lineTo(-s * 0.6, s * 0.55); c.moveTo(-s * 0.1, s * 0.15); c.lineTo(s * 0.25, s * 0.45); c.lineTo(s * 0.12, s * 0.9); c.stroke(); }
    else if (kind === "bang") { c.beginPath(); c.moveTo(-s * 0.16, -s * 0.85); c.lineTo(s * 0.16, -s * 0.85); c.lineTo(s * 0.08, s * 0.28); c.lineTo(-s * 0.08, s * 0.28); c.closePath(); c.fill(); circ(c, 0, s * 0.66, s * 0.17); c.fill(); }
    else if (kind === "reload") { c.beginPath(); c.arc(0, 0, s * 0.62, -0.3, Math.PI * 1.45); c.stroke(); c.beginPath(); c.moveTo(s * 0.62, -s * 0.62); c.lineTo(s * 0.66, -s * 0.05); c.lineTo(s * 0.1, -s * 0.2); c.closePath(); c.fill(); }
    else { for (const dx of [-0.52, 0, 0.52]) { circ(c, s * dx, 0, s * 0.15); c.fill(); } }
    c.restore();
  }
  function drawBubbles(ctx, st) {
    if (!st.whyOn) return;
    for (const v of st.views) {
      if (!v.alive || !v.icon) continue;
      const x = v.x * PX, y = v.y * PX, pp = clamp((st.clock - v.iconT) / 260, 0, 1), k = pp < 1 ? 1 + 0.18 * Math.sin(pp * Math.PI) : 1;
      const bx = x + R * 0.62, by = y - R * 1.48, br = 26 * k;
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; ctx.fillStyle = "#f7f9fc";
      circ(ctx, x + R * 0.34, y - R * 0.98, 4.2); ctx.fill(); circ(ctx, x + R * 0.48, y - R * 1.16, 6); ctx.fill();
      circ(ctx, bx, by, br); ctx.fill(); ctx.restore();
      icon(ctx, v.icon, bx, by, br * 0.6);
    }
  }

  // ===== 因果の矢印（なぜ、そう動いた？）: arrows=[{a:view,b:view,n:番号,team}] =====
  function drawArrows(ctx, st) {
    if (!st.arrows) return;
    ctx.save(); ctx.lineCap = "round";
    const badge = (mx, my, n, P) => {
      ctx.shadowColor = teamCol(P, 1); ctx.shadowBlur = 10; ctx.fillStyle = "#0b1a2c"; circ(ctx, mx, my, 24); ctx.fill(); ctx.strokeStyle = teamCol(P, 1); ctx.lineWidth = 3.5; circ(ctx, mx, my, 24); ctx.stroke();
      ctx.shadowBlur = 0; ctx.fillStyle = "#fff"; ctx.font = "bold 28px 'Russo One', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(n), mx, my + 1);
    };
    for (const ar of st.arrows) {
      if (ar.mark) {                                                                           // 矢印なしの番号札（その場で起きた事）。吹き出しの無い下側に、番号ごとに向きを変えて
        const ang = [0, 2.36, 0.79, 0.15][ar.n] || 0.79, rr = R + 20;
        badge(ar.at.x * PX + Math.cos(ang) * rr, ar.at.y * PX + Math.sin(ang) * rr, ar.n, ar.team === "P"); continue;
      }
      let ax = ar.a.x * PX, ay = ar.a.y * PX, bx = ar.b.x * PX, by = ar.b.y * PX; const d = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / d, uy = (by - ay) / d;
      const flip = ax < bx || (ax === bx && ay < by) ? 1 : -1, nx = -uy * flip, ny = ux * flip;   // 向きに依らない横方向（往復の矢印を左右に分ける）
      const lane = ar.lane || 0; ax += nx * lane * 16; ay += ny * lane * 16; bx += nx * lane * 16; by += ny * lane * 16;
      const sx = ax + ux * (R + 8), sy = ay + uy * (R + 8), ex = bx - ux * (R + 14), ey = by - uy * (R + 14), P = ar.team === "P";
      ctx.shadowColor = teamCol(P, 1); ctx.shadowBlur = 16; ctx.strokeStyle = "rgba(240,250,255,.95)"; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = "rgba(240,250,255,.95)"; ctx.beginPath(); ctx.moveTo(ex + ux * 20, ey + uy * 20); ctx.lineTo(ex - uy * 15, ey + ux * 15); ctx.lineTo(ex + uy * 15, ey - ux * 15); ctx.closePath(); ctx.fill();
      const side = lane < 0 ? -1 : 1; badge((sx + ex) / 2 + nx * side * 34, (sy + ey) / 2 + ny * side * 34, ar.n, P);
    }
    ctx.restore();
  }

  function drawBoard(ctx, st) {
    usePX(st.arena); usePal(st.pal);
    if (st.bleed) drawBleed(ctx, st);
    drawMap(ctx, st);
    if (st.bleed) { ctx.save(); ctx.shadowColor = "rgba(0,0,0,.8)"; ctx.shadowBlur = 24; ctx.strokeStyle = "rgba(4,10,18,.9)"; ctx.lineWidth = 6; ctx.strokeRect(-3, -3, W + 6, H + 6); ctx.restore(); }   // 地図の縁
    drawFormation(ctx, st);
    if (st.aim !== false) drawAim(ctx, st);
    drawTrails(ctx, st);
    st.views.filter((v) => !v.alive).forEach((v) => drawToken(ctx, st, v));
    const live = st.views.filter((v) => v.alive).sort((a, b) => a.y - b.y);
    live.forEach((v) => drawUnder(ctx, st, v)); live.forEach((v) => { drawToken(ctx, st, v); drawOver(ctx, st, v); });
    if (st.focus && st.focus.alive) { drawPlan(ctx, st, st.focus); drawRing(ctx, st, st.focus); }
    if (st.highlight) drawRing(ctx, st, st.highlight, true);
    drawFx(ctx, st); drawWeather(ctx, st); drawBubbles(ctx, st); drawArrows(ctx, st); drawPops(ctx, st);
  }
  // ミニマップ（地図の縮小＋駒の点＋カメラ枠）
  function drawMini(mctx, mw, mh, st, cam) {
    usePX(st.arena); usePal(st.pal); const k = mw / W, m = img(st.arena.mini);
    if (m) mctx.drawImage(m, 0, 0, mw, mh); else { mctx.fillStyle = "#1c2a1c"; mctx.fillRect(0, 0, mw, mh); }
    mctx.fillStyle = "rgba(4,10,20,.25)"; mctx.fillRect(0, 0, mw, mh);
    for (const v of st.views) {
      const x = v.x * PX * k, y = v.y * PX * k;
      if (!v.alive) { mctx.strokeStyle = "rgba(200,200,200,.7)"; mctx.lineWidth = 1.5; mctx.beginPath(); mctx.moveTo(x - 3, y - 3); mctx.lineTo(x + 3, y + 3); mctx.moveTo(x + 3, y - 3); mctx.lineTo(x - 3, y + 3); mctx.stroke(); continue; }
      mctx.fillStyle = palT(v.team === "P").dot; mctx.strokeStyle = "#fff"; mctx.lineWidth = 1.2; circ(mctx, x, y, 5); mctx.fill(); mctx.stroke();
    }
    if (cam) { const vw = cam.vw || W, vh = cam.vh || H; mctx.strokeStyle = "rgba(255,255,255,.9)"; mctx.lineWidth = 1.6; mctx.strokeRect((cam.x - vw / 2 / cam.z) * k, (cam.y - vh / 2 / cam.z) * k, (vw / cam.z) * k, (vh / cam.z) * k); }
  }
  // カメラ：生き残りが全員収まる範囲で寄る（topPad/botPad＝ロゴとパネルの分の余白）
  function camGoal(views, opt) {
    if (opt && opt.arena) usePX(opt.arena);
    const vw = (opt && opt.vw) || W, vh = (opt && opt.vh) || H, own = !!(opt && opt.vw);        // own＝パネルの無い専用の枠（観戦）
    const al = views.filter((v) => v.alive); if (!al.length) return { x: W / 2, y: H / 2, z: Math.max(vw / W, vh / H) };
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const v of al) { x0 = Math.min(x0, v.x * PX); x1 = Math.max(x1, v.x * PX); y0 = Math.min(y0, v.y * PX); y1 = Math.max(y1, v.y * PX); }
    // 駒が全員映るなら地図の外（暗い余白）も少し見せてよい（最大 margin。全員が映ることを優先）
    const M = (opt && opt.margin) || 0;
    const padX = (opt && opt.padX) || (own ? 170 : 230), padY = (opt && opt.padY) || (own ? 300 : 470), zMax = (opt && opt.zMax) || 1.32;
    const zMin = own ? Math.min(vw / (W + 2 * M), vh / (H + 2 * M)) : Math.max(vw / W, vh / H);   // 両端に分かれた時は、地図の幅いっぱいまで引ける
    const z = clamp(Math.min(vw / (x1 - x0 + 2 * padX), vh / (y1 - y0 + padY)), zMin, Math.max(zMin, zMax));
    let x = (x0 + x1) / 2, y = (y0 + y1) / 2 + ((opt && opt.dy) || 30);
    if (own) {                                                                                    // 狙う位置は、端の駒が切れる分しか地図の外へ出さない
      const hw = vw / 2 / z, hh = vh / 2 / z, eg = R + 30, mL = Math.max(0, eg - x0), mR = Math.max(0, x1 - (W - eg)), mT = Math.max(0, R + 75 - y0), mB = Math.max(0, y1 - (H - eg));
      const fit = (v, h, L, a, b) => { const lo = h - a, hi = L - h + b; return lo > hi ? (lo + hi) / 2 : clamp(v, lo, hi); };
      x = fit(x, hw, W, mL, mR); y = fit(y, hh, H, mT, mB);
    }
    return { x, y, z };
  }
  function camStep(cam, goal, cf) {
    cam.z += (goal.z - cam.z) * cf; const hw = (cam.vw || W) / 2 / cam.z, hh = (cam.vh || H) / 2 / cam.z, M = cam.m || 0;
    const fit = (v, h, L) => (h - M > L - h + M ? L / 2 : clamp(v, h - M, L - h + M));
    cam.x = fit(cam.x + (goal.x - cam.x) * cf, hw, W); cam.y = fit(cam.y + (goal.y - cam.y) * cf, hh, H);
  }
  // world px → canvas：中心 (cx,cy)・拡大 z（canvas の css 幅 cw・高さ ch・解像度 s）
  function view(ctx, s, cw, ch, cx, cy, z) { ctx.setTransform(s * z, 0, 0, s * z, s * (cw / 2 - cx * z), s * (ch / 2 - cy * z)); }

  SCS2.board = { W, H, R, img, emb, token, ICON_OF, drawBoard, drawMini, camGoal, camStep, view, circ };   // 外から使うものだけ
})();
