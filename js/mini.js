/* mini.js — 2D上空ミニマップ（CRTフォスファー・レーダー調）。
 * シムの実2D状態（field/obstacles/両ユニットのx,y,facing,hp）を読んで描くだけ＝決定論・戦闘に非干渉。
 * 位置はrequestAnimationFrameで補間（ターン間を滑らかに）。描画は ui.render から sync() で駆動。
 */
window.SCS = window.SCS || {};

(function () {
  let cv = null, ctx = null, battle = null, raf = null, running = false;
  const disp = { px: 0, py: 0, cx: 0, cy: 0, init: false };
  let needSnap = false;
  const COL_P = "#5cc8ff", COL_C = "#ff5e5e";
  // 地形ゾーンの色（テキストの「茂みに紛れ/瓦礫を盾に/高所/溶岩」と整合させる）
  const TCOL = { forest: "rgba(60,150,90,.13)", rubble: "rgba(125,125,108,.16)", swamp: "rgba(95,112,55,.17)", highground: "rgba(120,170,210,.11)", lava: "rgba(255,105,35,.22)" };
  const TSTROKE = { rubble: "rgba(150,150,132,.22)", highground: "rgba(140,190,220,.2)", lava: "rgba(255,140,60,.45)" };

  function sync(b) {
    battle = b;
    if (b && (needSnap || !disp.init)) { disp.px = b.plr.x; disp.py = b.plr.y; disp.cx = b.cpu.x; disp.cy = b.cpu.y; disp.init = true; needSnap = false; }
    start();
  }
  function reset() { needSnap = true; } // 新規対戦：次のsyncで位置をスナップ
  function start() { if (running || typeof requestAnimationFrame === "undefined") return; running = true; loop(); }
  function loop() { raf = requestAnimationFrame(loop); try { draw(); } catch (e) {} }

  function draw() {
    if (!cv) cv = document.getElementById("mini");
    if (!cv || !battle) return;
    const cssW = cv.clientWidth;
    if (!cssW) return; // 非表示（ストーリーのマップ/スカウト等）
    const f = battle.field;
    const cssH = Math.max(110, Math.min(190, Math.round(cssW * 0.46))); // 安定した横長レーダー
    const dpr = window.devicePixelRatio || 1;
    if (cv.style.height !== cssH + "px") cv.style.height = cssH + "px";
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // レターボックス：戦場の実縦横比を保ったまま中央に配置（正方形寄りの戦場が横に伸びる歪みを防ぐ）
    const pad = 8, availW = cssW - pad * 2, availH = cssH - pad * 2;
    const scale = Math.min(availW / f.w, availH / f.h);
    const drawW = f.w * scale, drawH = f.h * scale;
    const ox = Math.round((cssW - drawW) / 2), oy = Math.round((cssH - drawH) / 2);
    const SX = (x) => ox + (x / f.w) * drawW, SY = (y) => oy + (y / f.h) * drawH;

    // 地形ゾーン（全域の床＋個別ゾーン。テキストの地形描写と整合）
    const baseC = TCOL[battle.baseTerrainKey];
    if (baseC) { ctx.fillStyle = baseC; ctx.fillRect(ox, oy, drawW, drawH); }
    for (const z of battle.terrain || []) {
      const c = TCOL[z.t]; if (!c) continue;
      const x = SX(z.x), y = SY(z.y), w = z.w * scale, h = z.h * scale;
      ctx.fillStyle = c; ctx.fillRect(x, y, w, h);
      const sc = TSTROKE[z.t]; if (sc) { ctx.lineWidth = 1; ctx.strokeStyle = sc; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1); }
    }

    // 走査線グリッド（淡・戦場枠内）
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(31,107,67,.22)";
    for (let gx = 1; gx < 6; gx++) { const x = ox + (drawW * gx) / 6; ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + drawH); ctx.stroke(); }
    for (let gy = 1; gy < 3; gy++) { const y = oy + (drawH * gy) / 3; ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + drawW, y); ctx.stroke(); }
    // 戦場の枠
    ctx.lineWidth = 1.3; ctx.strokeStyle = "#1f6b43"; ctx.strokeRect(ox + .5, oy + .5, drawW - 1, drawH - 1);

    // 障害物（遮蔽。HPで濃さが変わり、崩れると消える＝回り込みが読める文脈）
    for (const o of battle.obstacles || []) {
      if (o.hp <= 0) continue;
      const x = SX(o.x), y = SY(o.y), w = o.w * scale, h = o.h * scale, fr = Math.max(0, Math.min(1, o.hp / 70));
      ctx.fillStyle = "rgba(58,116,86," + (0.1 + 0.14 * fr) + ")";
      ctx.fillRect(x, y, w, h);
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(95,160,120," + (0.25 + 0.4 * fr) + ")";
      ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    }

    // 動的ハザード：燃え広がる炎（テキストの「業火に巻かれ」と整合・ゆらぐ）
    const haz = battle.hazards || [];
    if (haz.length) {
      const fk = 0.5 + 0.5 * Math.abs(Math.sin((typeof performance !== "undefined" ? performance.now() : 0) / 170));
      for (const h of haz) { if (h.turns <= 0) continue; ctx.fillStyle = "rgba(255,120,40," + (0.16 + 0.2 * fk) + ")"; ctx.fillRect(SX(h.x), SY(h.y), h.w * scale, h.h * scale); }
    }

    // 位置を補間（ターン間を滑らかに）
    const k = 0.3;
    disp.px += (battle.plr.x - disp.px) * k; disp.py += (battle.plr.y - disp.py) * k;
    disp.cx += (battle.cpu.x - disp.cx) * k; disp.cy += (battle.cpu.y - disp.cy) * k;
    const px = SX(disp.px), py = SY(disp.py), cx = SX(disp.cx), cy = SY(disp.cy);

    // 交戦軸（淡い線）＋接近グロー
    const near = Math.hypot(disp.px - disp.cx, disp.py - disp.cy) / f.w < 0.08;
    ctx.lineWidth = 1; ctx.strokeStyle = near ? "rgba(255,207,92,.35)" : "rgba(109,255,160,.13)";
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, cy); ctx.stroke();
    if (near) { const mx = (px + cx) / 2, my = (py + cy) / 2; ctx.fillStyle = "rgba(255,207,92,.5)"; ctx.shadowColor = "#ffcf5c"; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0; }

    drawUnit(px, py, battle.plr, COL_P);
    drawUnit(cx, cy, battle.cpu, COL_C);
  }

  function drawUnit(x, y, u, color) {
    const fx = u.faceX || 0, fy = u.faceY || 0, fl = Math.hypot(fx, fy) || 1, ux = fx / fl, uy = fy / fl;
    // 向きの矢印（誰が誰を向いているか＝側背面が読める）
    const len = 13;
    ctx.lineWidth = 1.6; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ux * len, y + uy * len); ctx.stroke();
    const tipx = x + ux * len, tipy = y + uy * len, ax = -uy, ay = ux, hs = 3.4;
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(tipx, tipy); ctx.lineTo(tipx - ux * 4 + ax * hs, tipy - uy * 4 + ay * hs); ctx.lineTo(tipx - ux * 4 - ax * hs, tipy - uy * 4 - ay * hs); ctx.closePath(); ctx.fill();
    // 本体ドット（瀕死は脈動）
    if (u.hp <= 0) { ctx.lineWidth = 1.4; ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke(); return; }
    const low = u.hp / u.maxHp < 0.3, t = (typeof performance !== "undefined" ? performance.now() : 0) / 1000;
    const r = low ? 4 + Math.sin(t * 6) * 1.3 : 3.6;
    ctx.shadowColor = color; ctx.shadowBlur = 11; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0;
  }

  SCS.mini = { sync, reset };
})();
