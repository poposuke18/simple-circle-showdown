/* mini.js — 2D上空ミニマップ（CRTフォスファー・レーダー調）。
 * シムの実2D状態（field/obstacles/両ユニットのx,y,facing,hp）を読んで描くだけ＝決定論・戦闘に非干渉。
 * 位置はrequestAnimationFrameで補間（ターン間を滑らかに）。描画は ui.render から sync() で駆動。
 */
window.SCS = window.SCS || {};

(function () {
  let cv = null, ctx = null, battle = null, raf = null, running = false;
  const disp = { px: 0, py: 0, cx: 0, cy: 0, init: false };
  let needSnap = false;
  let fx = []; // ③ 戦闘エフェクト（寿命付き・描画専用）。step()のevents由来＝決定論を壊さない
  const COL_P = "#5cc8ff", COL_C = "#ff5e5e";
  const perfNow = () => (typeof performance !== "undefined" ? performance.now() : 0);
  // 地形ゾーンの色（テキストの「茂みに紛れ/瓦礫を盾に/高所/溶岩」と整合させる）
  const TCOL = { forest: "rgba(60,150,90,.13)", rubble: "rgba(125,125,108,.16)", swamp: "rgba(95,112,55,.17)", highground: "rgba(120,170,210,.11)", lava: "rgba(255,105,35,.22)" };
  const TSTROKE = { rubble: "rgba(150,150,132,.22)", highground: "rgba(140,190,220,.2)", lava: "rgba(255,140,60,.45)" };

  function sync(b) {
    battle = b;
    if (b && (needSnap || !disp.init)) { disp.px = b.plr.x; disp.py = b.plr.y; disp.cx = b.cpu.x; disp.cy = b.cpu.y; disp.init = true; needSnap = false; }
    start();
  }
  function reset() { needSnap = true; fx = []; } // 新規対戦：次のsyncで位置をスナップ＋エフェクト消去

  // ③ step()の描画専用eventsを寿命付きエフェクトに変換（field座標で保持→描画時にSX/SYで投影）
  function pushFx(events) {
    if (!events || !events.length) return;
    const now = perfNow();
    for (const e of events) {
      const f = e.from || {}, t = e.to || {};
      const base = { side: e.side, t0: now, ax: f.x || 0, ay: f.y || 0, bx: t.x || 0, by: t.y || 0, hit: (e.hits || 0) > 0, crit: !!e.crit, whiff: !!e.whiff, dmg: e.dmg || 0, status: e.status || null };
      if (e.type === "ranged") fx.push(Object.assign({}, base, { kind: "tracer", dur: 340 }));
      else if (e.type === "melee") fx.push(Object.assign({}, base, { kind: "slash", dur: 320 }));
      else if (e.type === "ult-ranged") fx.push(Object.assign({}, base, { kind: "beam", dur: 540 }));
      else if (e.type === "ult-melee") fx.push(Object.assign({}, base, { kind: "burst", dur: 540 }));
      else if (e.type === "dodge") fx.push(Object.assign({}, base, { kind: "dodge", dur: 380 }));
      else if (e.type === "guard") fx.push(Object.assign({}, base, { kind: "guard", dur: 340 }));
      else if (e.type === "grab") fx.push(Object.assign({}, base, { kind: "grab", dur: 420 }));
      else if (e.type === "counter") fx.push(Object.assign({}, base, { kind: "counter", dur: 400 }));
      if (base.hit && (e.type === "ranged" || e.type === "melee" || e.type === "ult-ranged" || e.type === "ult-melee" || e.type === "counter" || e.type === "grab")) fx.push(Object.assign({}, base, { kind: "impact", dur: 300 }));
    }
    if (fx.length > 64) fx.splice(0, fx.length - 64); // 暴走防止
    start();
  }
  function start() { if (running || typeof requestAnimationFrame === "undefined") return; running = true; loop(); }
  // 堅牢性：draw() が「まだ動くものがある」と返した時だけ次フレームを予約＝アイドルで回し続けない（電池/CPU節約）。sync/pushFxで再開
  function loop() { let more = false; try { more = draw(); } catch (e) { more = false; } if (more) raf = requestAnimationFrame(loop); else running = false; }

  function draw() {
    if (!cv) cv = document.getElementById("mini");
    if (!cv || !battle) return false;
    const cssW = cv.clientWidth;
    if (!cssW) return false; // 非表示（ストーリーのマップ/スカウト等）＝ループ停止（再表示時にsyncで再開）
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

    // 射線（LoS）：シムと同じ battle.losClear で判定＝戦闘挙動と必ず一致。通れば実線、遮蔽で切れれば破線
    const losOK = battle.losClear ? battle.losClear({ x: battle.plr.x, y: battle.plr.y }, { x: battle.cpu.x, y: battle.cpu.y }) : true;
    const near = Math.hypot(disp.px - disp.cx, disp.py - disp.cy) / f.w < 0.08;
    ctx.lineWidth = 1;
    if (losOK) { ctx.setLineDash([]); ctx.strokeStyle = near ? "rgba(255,207,92,.4)" : "rgba(109,255,160,.26)"; }
    else { ctx.setLineDash([3, 4]); ctx.strokeStyle = "rgba(255,94,94,.34)"; } // 射線が遮蔽で切れている
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, cy); ctx.stroke();
    ctx.setLineDash([]);
    if (near) { const mx = (px + cx) / 2, my = (py + cy) / 2; ctx.fillStyle = "rgba(255,207,92,.5)"; ctx.shadowColor = "#ffcf5c"; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0; }

    drawFx(SX, SY); // ③ 撃ち合いの可視化（トレーサー/斬撃/ビーム/回避残像/着弾）
    drawUnit(px, py, battle.plr, COL_P);
    drawUnit(cx, cy, battle.cpu, COL_C);
    // 動くものが残っているか（位置補間中／エフェクト残／瀕死脈動／延焼）＝無ければループを畳む
    const conv = Math.abs(battle.plr.x - disp.px) + Math.abs(battle.plr.y - disp.py) + Math.abs(battle.cpu.x - disp.cx) + Math.abs(battle.cpu.y - disp.cy) < 0.1;
    const lowHp = (battle.plr.hp > 0 && battle.plr.hp / battle.plr.maxHp < 0.3) || (battle.cpu.hp > 0 && battle.cpu.hp / battle.cpu.maxHp < 0.3);
    return fx.length > 0 || !conv || (!battle.over && (lowHp || haz.some((h) => h.turns > 0)));
  }

  // ③ 寿命付きエフェクトを減衰描画。始点=攻め手・終点=相手の【補間後dist座標】で結ぶ＝本体ドットから線が外れない
  function drawFx(SX, SY) {
    if (!fx.length) return;
    const now = perfNow();
    const next = [];
    for (const e of fx) {
      const p = (now - e.t0) / e.dur; // 0→1
      if (p >= 1) continue;
      next.push(e);
      const a = 1 - p, col = e.side === "p" ? COL_P : COL_C;
      // 攻め手(side)と相手の現在の補間位置で投影＝スライド中もドットと線が一致
      const aX = e.side === "p" ? disp.px : disp.cx, aY = e.side === "p" ? disp.py : disp.cy;
      const tX = e.side === "p" ? disp.cx : disp.px, tY = e.side === "p" ? disp.cy : disp.py;
      const ax = SX(aX), ay = SY(aY), bx = SX(tX), by = SY(tY);
      ctx.save();
      if (e.kind === "tracer") {
        if (e.whiff) { // 逸れる：着弾点を法線方向へずらす
          const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, off = 7;
          ctx.globalAlpha = a * 0.5; ctx.lineWidth = 1; ctx.strokeStyle = col;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx + nx * off, by + ny * off); ctx.stroke();
        } else {
          ctx.globalAlpha = a; ctx.lineWidth = e.crit ? 2.2 : 1.4; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = e.crit ? 10 : 5;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          if (e.crit) { ctx.shadowBlur = 0; ctx.globalAlpha = a; ctx.fillStyle = "#ffcf5c"; spark(bx, by, 4, a); }
        }
      } else if (e.kind === "slash") {
        const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux, r = e.hit ? 9 : 6;
        const ex = e.hit ? bx : ax + dx * 0.45, ey = e.hit ? by : ay + dy * 0.45; // 空振りは相手ではなく前方の空を切る（届かぬ突進が相手の真上に出ない）
        ctx.globalAlpha = e.hit ? a : a * 0.5; ctx.lineWidth = e.crit ? 2.4 : 1.6; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = e.hit ? 8 : 3;
        ctx.beginPath(); ctx.moveTo(ex - ux * 3 + nx * r, ey - uy * 3 + ny * r); ctx.quadraticCurveTo(ex + ux * 4, ey + uy * 4, ex - ux * 3 - nx * r, ey - uy * 3 - ny * r); ctx.stroke();
        if (e.crit && e.hit) { ctx.shadowBlur = 0; ctx.fillStyle = "#ffcf5c"; spark(ex, ey, 4, a); }
      } else if (e.kind === "beam") {
        if (e.whiff) { // 空撃ち：相手に届かず手前で霧散（着弾リング無し）＝ログ「空を切った」と一致
          const mx = ax + (bx - ax) * 0.55, my = ay + (by - ay) * 0.55;
          ctx.globalAlpha = a * 0.45; ctx.lineWidth = 2 * (0.5 + a * 0.5); ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(mx, my); ctx.stroke();
        } else {
          ctx.globalAlpha = a; ctx.lineWidth = (e.hit ? 4 : 2.5) * (0.5 + a * 0.5); ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 14;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          ring(bx, by, 4 + (1 - a) * 16, a, col);
        }
      } else if (e.kind === "burst") {
        if (e.whiff) ring(ax + (bx - ax) * 0.4, ay + (by - ay) * 0.4, 3 + (1 - a) * 6, a * 0.5, col); // 空撃ち：不発の小さな霧散のみ（満開の爆発を出さない）
        else {
          ring(bx, by, 3 + (1 - a) * 20, a, col);
          ctx.globalAlpha = a * 0.8; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.lineWidth = 2;
          for (let k = 0; k < 6; k++) { const ang = (k / 6) * 6.2832, rr = 5 + (1 - a) * 14; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(ang) * rr, by + Math.sin(ang) * rr); ctx.stroke(); }
        }
      } else if (e.kind === "dodge") { // 残像：相手方向の法線へ流れる薄い輪
        const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, sl = (1 - a) * 10;
        ctx.globalAlpha = a * 0.55; ctx.strokeStyle = col; ctx.lineWidth = 1.4;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(ax + nx * sl * s, ay + ny * sl * s, 3, 0, 6.2832); ctx.stroke(); }
      } else if (e.kind === "guard") { // 盾フリック：相手方向に小さな弧
        const dx = bx - ax, dy = by - ay, ang = Math.atan2(dy, dx);
        ctx.globalAlpha = a * 0.8; ctx.strokeStyle = "#bfe9ff"; ctx.lineWidth = 2; ctx.shadowColor = col; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(ax, ay, 8, ang - 0.7, ang + 0.7); ctx.stroke();
      } else if (e.kind === "grab") {
        ctx.globalAlpha = a; ctx.strokeStyle = "#ffcf5c"; ctx.lineWidth = 2; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
        ring(bx, by, 4 + (1 - a) * 9, a, "#ffcf5c");
      } else if (e.kind === "counter") {
        ctx.globalAlpha = a; ctx.lineWidth = 2; ctx.strokeStyle = "#ffe08a"; ctx.shadowColor = "#ffcf5c"; ctx.shadowBlur = 9;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.shadowBlur = 0; ctx.fillStyle = "#ffe08a"; spark(bx, by, 4, a);
      } else if (e.kind === "impact") {
        const r = 3 + Math.min(14, e.dmg * 0.5) * (1 - a);
        ctx.globalAlpha = a * 0.9; ctx.fillStyle = "#ffffff"; ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(bx, by, Math.max(1.5, r * 0.4), 0, 6.2832); ctx.fill();
        ctx.shadowBlur = 0; ctx.globalAlpha = a * 0.6; ctx.lineWidth = 1.4; ctx.strokeStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(bx, by, r, 0, 6.2832); ctx.stroke();
      }
      ctx.restore();
    }
    fx = next;
  }
  function spark(x, y, r, a) { ctx.globalAlpha = a; for (let k = 0; k < 4; k++) { const ang = k * 1.5708 + 0.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r); ctx.lineWidth = 1; ctx.strokeStyle = "#ffcf5c"; ctx.stroke(); } }
  function ring(x, y, r, a, col) { ctx.globalAlpha = a * 0.8; ctx.lineWidth = 1.6; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke(); ctx.shadowBlur = 0; }

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

  SCS.mini = { sync, reset, pushFx };
})();
