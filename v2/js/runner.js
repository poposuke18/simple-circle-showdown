/* v2/js/runner.js — 1戦を進める係。エンジン squad3.js（v2 用・頭は既定で両軍 v3）を1ターンずつ回し、
 * 描画用の駒（view）・演出（fx）・毎ターンの記録（snaps＝結果とハイライト・なぜ？の材料）を持つ。
 * 表示の押し離し（駒が重ならないよう描く位置だけずらす）は戦闘に一切影響しない。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const TURN = 1000;

  // cfg: {mine:{choices[],emb[],names[]}, foe:{...}, seed, arena, mod, formP, formC}
  SCS2.makeRunner = function (cfg) {
    const W = SCS2.board.W, H = SCS2.board.H, R = SCS2.board.R, FW = cfg.arena.w, FH = cfg.arena.h, PX = W / FW;
    const battle = SCS.makeSquadBattle3(cfg.mine.choices.map((c) => c.slice()), cfg.foe.choices.map((c) => c.slice()), cfg.seed, cfg.arena.name, cfg.mod, cfg.formP, cfg.formC, cfg.mine.names.slice(), cfg.foe.names.slice(), { formation: 0.6, orderP: cfg.orderP || null, brain: cfg.brain || { P: "v3", C: "v3" } }); // 隊形が配置と動きに効く・あなたの部隊は配置した順（分隊戦設計§17）
    const views = battle.teams.P.concat(battle.teams.C).map((u) => {
      const P = u.team === "P", a = Math.atan2(u.faceY, u.faceX);
      return { u, id: u.team + u.idx, team: u.team, idx: u.idx, name: u.name, emb: (P ? cfg.mine.emb : cfg.foe.emb)[u.idx], words: SCS2.world.wordsOf((P ? cfg.mine.choices : cfg.foe.choices)[u.idx]),
        x: u.x, y: u.y, fx: u.x, fy: u.y, tx: u.x, ty: u.y, ang: a, ang0: a, ang1: a, alive: true, hp: u.hp, maxHp: u.maxHp, hp0: u.hp, label: u.label, tgt: null,
        trail: [], icon: "dots", iconT: -1e9, hitT: -1e9, koT: 0 };
    });
    const byU = new Map(views.map((v) => [v.u, v]));
    for (const tm of ["P", "C"]) {                                                            // 隊形の中の順（あなたの部隊は配置した順・相手は間合いの短い順）＝隊形の線の描き方に使う
      const us = views.filter((v) => v.team === tm), ord = tm === "P" && cfg.orderP ? cfg.orderP : us.slice().sort((a, b) => a.u.winDist - b.u.winDist).map((v) => v.idx);
      us.forEach((v) => { v.rank = ord.indexOf(v.idx); });
    }
    const fx = [], pops = [], snaps = [], hist = [];
    let turnStart = 0, nextAt = 600, focus = null, focusUntil = 0, focusLock = 0;
    const cam = { x: W / 2, y: H / 2, z: 1.1, vw: cfg.vw || W, vh: cfg.vh || H, m: cfg.vw ? 160 : 0 };               // vw×vh＝戦場を映す枠の大きさ

    function sync(v) { const u = v.u; v.plan = u.alive && u.target && u._plan && u._plan.turn === battle.turn ? { x: u._plan.x, y: u._plan.y } : null; v.alive = u.alive; v.hp = u.hp; v.label = u.label; v.tgt = u.target ? byU.get(u.target) || null : null; v.stamina = u.stamina; v.supp = u.alive ? u.supp || 0 : 0; v.hidden = u.alive && !battle.spotted(u); v.formHeld = u.alive && !!u._formHeld; v.form = u.form; } // hidden＝敵にまだ見つかっていない
    function separate(snap) {
      const minD = (R * 2 * 0.92) / PX, pts = views.map((v) => ({ v, x: v.u.x, y: v.u.y }));
      for (let it = 0; it < 6; it++) for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j]; let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 1e-3) { dx = i % 2 ? 1 : -1; dy = 0.35; d = Math.hypot(dx, dy); }
        const wa = a.v.u.alive ? 1 : 0.2, wb = b.v.u.alive ? 1 : 0.2, s = wa + wb, push = minD - d, ux = dx / d, uy = dy / d;
        a.x -= ux * push * wa / s; a.y -= uy * push * wa / s; b.x += ux * push * wb / s; b.y += uy * push * wb / s;
      }
      const solid = cfg.arena.terrain.filter((z) => (SCS.DATA.TERRAIN[z.t] || {}).block).concat(battle.obstacles.filter((o) => o.hp > 0)), inside = (x, y) => solid.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
      const pushOut = (x, y) => { for (let it = 0; it < 3; it++) { const r = solid.find((q) => x > q.x && x < q.x + q.w && y > q.y && y < q.y + q.h); if (!r) break;
          const c = [[x - r.x, r.x - 0.1, y], [r.x + r.w - x, r.x + r.w + 0.1, y], [y - r.y, x, r.y - 0.1], [r.y + r.h - y, x, r.y + r.h + 0.1]].filter((k) => k[1] >= 3 && k[1] <= FW - 3 && k[2] >= 3 && k[2] <= FH - 3).sort((a, b) => a[0] - b[0]);
          if (!c.length) break; x = c[0][1]; y = c[0][2]; } return { x, y }; };
      const edge = (x, y) => ({ x: clamp(x, 3, FW - 3), y: clamp(y, 3, FH - 3) });     // 駒が画面の端で切れない余白。壁の判定より先に寄せる（寄せた先が谷・壁の中にならないように）
      for (const p of pts) {
        let q = edge(p.x, p.y); p.x = q.x; p.y = q.y;
        if (inside(p.x, p.y)) { q = pushOut(p.x, p.y); if (inside(q.x, q.y)) q = edge(p.v.u.x, p.v.u.y); p.x = q.x; p.y = q.y; } // ずらした先が谷・壁の中なら外へ（出せなければ本当の位置）
        p.v.tx = p.x; p.v.ty = p.y; if (snap) { p.v.x = p.v.fx = p.v.tx; p.v.y = p.v.fy = p.v.ty; } }
    }
    function snapshot(res, died) {
      snaps.push({ turn: battle.turn, units: views.map((v) => ({ id: v.id, team: v.team, name: v.name, emb: v.emb, x: v.tx, y: v.ty, ang: v.ang1, alive: v.u.alive, hp: v.u.hp, maxHp: v.maxHp, label: v.u.label, tgt: v.u.alive && v.u.target ? byU.get(v.u.target).id : null, stamina: v.u.stamina, supp: v.u.alive ? v.u.supp || 0 : 0, hidden: v.u.alive && !battle.spotted(v.u) })),
        events: res ? res.events || [] : [], lines: res ? res.lines || [] : [], died: died || [], obstacles: battle.obstacles.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h, hp: o.hp, hp0: o.hp0 })), hazards: battle.hazards.map((h) => ({ ...h })), gimmick: battle.gimmick });
    }
    separate(true); views.forEach(sync); snapshot(null, []);

    function nearest(p, notTeam) { let b = null, bd = 1e9; for (const v of views) { if (v.team === notTeam) continue; const d = Math.hypot(v.u.x - p.x, v.u.y - p.y); if (d < bd) { bd = d; b = v; } } return b; }
    function pushFx(events, clock) {
      SCS2.board.gimFx(events, clock, (id) => views.find((v) => v.id === id), fx, pops);   // 戦場のギミック（噴火・壁の崩れ・泉の回復）
      let k = 0;
      for (const e of events) {
        if (!e.from || !e.to) continue;
        const aT = e.aTeam || e.team, va = views.find((v) => v.team === aT && v.idx === e.aIdx) || nearest(e.from);
        const vb = (e.dTeam && views.find((v) => v.team === e.dTeam && v.idx === e.dIdx)) || nearest(e.to, aT);
        if (!va || !vb) continue;
        const kind = { ranged: "tracer", melee: "slash", "ult-ranged": "beam", "ult-melee": "burst", counter: "slash", grab: "slash" }[e.type]; if (!kind) continue;   // 反撃・投げは斬撃と同じ見た目
        const t0 = clock + Math.min(300, k++ * 55), base = { t0, va, vb, team: va.team, hit: (e.hits || 0) > 0, crit: !!e.crit };
        fx.push(Object.assign({}, base, { kind, dur: kind === "beam" || kind === "burst" ? 640 : 380 }));
        if (base.hit) fx.push(Object.assign({}, base, { kind: "impact", t0: t0 + (kind === "tracer" || kind === "beam" ? 210 : 120), dur: 340 }));
        const pt0 = t0 + (kind === "tracer" || kind === "beam" ? 230 : 140);                        // 当たりの文字（数字・会心・外れ）
        if ((e.hits || 0) > 0 && (e.dmg || 0) > 0) pops.push({ v: vb, t0: pt0, kind: e.crit ? "crit" : "dmg", text: (e.crit ? "会心 " : "") + "-" + Math.round(e.dmg) });
        else if (e.whiff || (e.hits || 0) === 0) pops.push({ v: vb, t0: pt0, kind: "miss", text: "外れ" });
      }
      if (fx.length > 90) fx.splice(0, fx.length - 90); if (pops.length > 40) pops.splice(0, pops.length - 40);
    }
    // 1ターン進める（clock＝演出の時刻。instant＝演出なしで一気に解くとき）
    let prevVents = [];                                                                       // このターンに噴く所の予告（噴くまで画面に残す）
    function doTurn(clock, instant) {
      for (const v of views) { v.fx = instant ? v.tx : v.x; v.fy = instant ? v.ty : v.y; v.hp0 = v.u.hp; v.ang0 = v.ang; }
      prevVents = battle.gimmick ? battle.gimmick.vents : [];
      const res = battle.step(), died = [];
      hist.unshift(res.lines || []); if (hist.length > 4) hist.pop();
      separate(false);
      for (const v of views) {
        if (v.u.hp < v.hp0) v.hitT = clock + 240;
        if (!v.u.alive && !v.koT) { v.koT = clock + 320; died.push(v.id); }
        const ic = v.u.alive ? SCS2.board.ICON_OF[v.u.label] || "dots" : null; if (ic !== v.icon) { v.icon = ic; v.iconT = clock; }
        v.ang1 = Math.atan2(v.u.faceY, v.u.faceX);
        sync(v);
        if (instant) { v.x = v.tx; v.y = v.ty; v.ang = v.ang0 = v.ang1; v.trail.length = 0; }
      }
      snapshot(res, died);
      if (!instant) { pushFx(res.events || [], clock); chooseFocus(clock); }
      turnStart = clock;
      return res;
    }
    function interest(v) {
      if (!v.alive) return -1;
      const base = { 必殺: 6, 退避: 4.2, 立て直し: 4, 背後: 3.6, 側面: 3, かばう: 3.4, 盾: 2.6, 斬: 2.5, 集中: 2, 剝がし: 2.6 }[v.label] || 0;
      return base + Math.min(3, Math.hypot(v.tx - v.fx, v.ty - v.fy) / 4) + (v.team === "P" ? 0.4 : 0);
    }
    function chooseFocus(clock) {
      if (focus && focus.alive && (clock < focusUntil || clock < focusLock)) return;
      let best = null, bs = -1; for (const v of views) { const s = interest(v); if (s > bs) { bs = s; best = v; } }
      if (best && best !== focus) { focus = best; focusUntil = clock + 3 * TURN; } else focusUntil = clock + TURN;
    }
    // 毎フレーム：時刻を進めてターンを回し、補間・残像・カメラを更新
    function tick(clock, dt, speed) {
      if (!battle.over && clock >= nextAt) { doTurn(clock, false); nextAt = clock + TURN; }
      const e = ease(clamp((clock - turnStart) / (TURN * 0.8), 0, 1));
      for (const v of views) {
        const px = v.x, py = v.y; v.x = lerp(v.fx, v.tx, e); v.y = lerp(v.fy, v.ty, e);
        let da = v.ang1 - v.ang0; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; v.ang = v.ang0 + da * e;
        if (Math.hypot(v.x - px, v.y - py) > 0.02 && Math.hypot(v.tx - v.fx, v.ty - v.fy) > 2.5) v.trail.push({ x: v.x, y: v.y, t: clock });
        while (v.trail.length && clock - v.trail[0].t > 520) v.trail.shift();
      }
      SCS2.board.camStep(cam, SCS2.board.camGoal(views, { arena: cfg.arena, vw: cfg.vw, vh: cfg.vh, margin: cam.m }), clamp(dt * speed * 0.0022, 0, 1));
    }
    // 残りを一瞬で解く（「結果へ」）
    function finish(clock) { let n = 0; while (!battle.over && n++ < 200) doTurn(clock, true); }
    // 注目の駒が主語の記録（「〜ため、X は …した」）を直近のターンから探す
    const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/^[\s　─]+/, "").replace(/（[^）]*）/g, "").trim();
    function whyOf(v) {
      const n = v.name;
      for (const ls of hist) { const l = ls.find((x) => (x.cls === "ex" || x.cls === "cm") && x.text.indexOf(">" + n + "</span> は") >= 0); if (l) return strip(l.text); }
      for (const ls of hist) { const l = ls.find((x) => x.text.indexOf(">" + n + "</span>") >= 0 && x.cls !== "dim"); if (l) return strip(l.text); }
      return "";
    }
    if (cfg.vw) SCS2.board.camStep(cam, SCS2.board.camGoal(views, { arena: cfg.arena, vw: cfg.vw, vh: cfg.vh, margin: cam.m }), 1);   // 始めから全員が映る位置に
    return {
      battle, views, fx, pops, snaps, cam, tick, finish, whyOf, arena: cfg.arena,
      gimmickAt(clock) { const g = battle.gimmick; return g && clock < turnStart + SCS2.board.ERUPT_AT && prevVents.some((v) => v.at === battle.turn) ? Object.assign({}, g, { vents: prevVents }) : g; },   // 描くギミック：このターンに噴く所は、噴くまで前の予告を見せる
      get focus() { return focus; }, setFocus(v, clock) { focus = v; focusLock = clock + 8 * TURN; },
    };
  };
})();
