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
    const f = battle.field, aspect = f.h / f.w;
    const cssH = Math.max(70, Math.min(210, Math.round(cssW * aspect)));
    const dpr = window.devicePixelRatio || 1;
    if (cv.style.height !== cssH + "px") cv.style.height = cssH + "px";
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const pad = 7, iw = cssW - pad * 2, ih = cssH - pad * 2;
    const SX = (x) => pad + (x / f.w) * iw, SY = (y) => pad + (y / f.h) * ih;

    // 走査線グリッド（淡）
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(31,107,67,.22)";
    for (let gx = 1; gx < 6; gx++) { const x = pad + (iw * gx) / 6; ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, pad + ih); ctx.stroke(); }
    for (let gy = 1; gy < 3; gy++) { const y = pad + (ih * gy) / 3; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + iw, y); ctx.stroke(); }
    // 戦場の枠
    ctx.lineWidth = 1.3; ctx.strokeStyle = "#1f6b43"; ctx.strokeRect(pad + .5, pad + .5, iw - 1, ih - 1);

    // 障害物（遮蔽。HPで濃さが変わり、崩れると消える＝回り込みが読める文脈）
    for (const o of battle.obstacles || []) {
      if (o.hp <= 0) continue;
      const x = SX(o.x), y = SY(o.y), w = (o.w / f.w) * iw, h = (o.h / f.h) * ih, fr = Math.max(0, Math.min(1, o.hp / 70));
      ctx.fillStyle = "rgba(58,116,86," + (0.1 + 0.14 * fr) + ")";
      ctx.fillRect(x, y, w, h);
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(95,160,120," + (0.25 + 0.4 * fr) + ")";
      ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
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
