/* sim.js — 思考エンジン v2（Stage 2＋戦場/地形）
 *   戦場をランダム選択（広さ・遮蔽・地形が変わる）。地形効果（茂み=回避/防御・瓦礫=高防御・沼地=鈍足・高所=命中↑）。
 *   AI：勝てる間合い/射撃好機/多因子評価＋先読み(最大4)＋MC＋相手モデリング学習＋プランのコミット＋地形考慮。
 *   描写v2＋：戦場紹介・形勢・有利間合い・地形・次善手・相手の癖。
 *   決定論：本戦ロール=battle-rng、MC=think-rng（別系列）、探索本体は期待値で乱数非消費。
 */
window.SCS = window.SCS || {};

(function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function ptInRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }
  function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
  function segSeg(a, b, c, d) { const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)); }
  function segIntersectsRect(p, q, r) {
    if (ptInRect(p, r) || ptInRect(q, r)) return true;
    const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
    return segSeg(p, q, { x: x1, y: y1 }, { x: x2, y: y1 }) || segSeg(p, q, { x: x2, y: y1 }, { x: x2, y: y2 }) || segSeg(p, q, { x: x2, y: y2 }, { x: x1, y: y2 }) || segSeg(p, q, { x: x1, y: y2 }, { x: x1, y: y1 });
  }
  const MOVES = ["ADVANCE", "RETREAT", "STRAFE_L", "STRAFE_R", "COVER", "HOLD"];
  const MOVE_JP = { ADVANCE: "前進", RETREAT: "後退", STRAFE_L: "左へ回り込み", STRAFE_R: "右へ回り込み", COVER: "遮蔽へ", HOLD: "据え置き" };
  const ATK_JP = { RANGED: "遠距離", MELEE: "近接", NONE: "攻撃せず" };
  const FACTOR_JP = { hp: "HP収支", trade: "トレード収支", engage: "射撃好機", winRange: "勝てる間合い", threat: "脅威回避", cover: "遮蔽優位", terrain: "地形利用", pos: "位置取り", kill: "仕留め", danger: "自己保存", tempo: "テンポ", avoid: "危険距離回避" };

  SCS.makeBattle = function (plrUnit, cpuUnit, seed, arenaName) {
    const D = SCS.DATA, S = D.SIM, T = D.TERRAIN, rng = SCS.makeRNG(seed);

    // --- 戦場の選択（ランダム or 指定） ---
    let arena;
    if (arenaName && arenaName !== "ランダム") arena = D.ARENAS.find((a) => a.name === arenaName) || D.ARENAS[0];
    else arena = D.ARENAS[SCS.makeRNG((seed ^ 0x5bd1e995) >>> 0).int(D.ARENAS.length)];
    const field = { w: arena.w, h: arena.h }, obstacles = arena.obstacles, baseTerrain = T[arena.base];
    const maxDist = Math.hypot(arena.w, arena.h), turnCap = S.turnCap;

    function initUnit(u, side, start) { return Object.assign(u, { side, x: start.x, y: start.y, speed: 0.5 + u.micros.B5 * 0.5 + u.micros.B3 * 0.2, oppModel: { recent: [] }, hurtAt: {}, plan: null, planPressure: 0, ammo: u.ranged.mag, reloadLeft: 0, charged: false, spread: 0, windLeft: 0, statuses: [], stun: 0 }); }
    const plr = initUnit(plrUnit, "PLR", arena.start.p), cpu = initUnit(cpuUnit, "CPU", arena.start.c);
    const stat = (s) => (s === "p" ? plr : cpu), other = (s) => (s === "p" ? "c" : "p");
    let turn = 0, over = false, result = null, noDamageTurns = 0;

    // ===== 状態異常 =====
    // DoT(燃焼/出血/毒)・持続(脆弱=被ダメ増/鈍足=移動減)は statuses 配列で、麻痺(stun)は stun カウンタで管理。
    function addStatus(u, s) { // 実際に付与できたら type を返す（麻痺は確率判定で外すと null）
      if (s.type === "stun") { if (s.chance && !rng.chance(s.chance)) return null; u.stun = Math.max(u.stun, s.turns); return "stun"; }
      const ex = u.statuses.find((x) => x.type === s.type);
      if (ex) ex.turns = Math.max(ex.turns, s.turns); else u.statuses.push({ ...s });
      return s.type;
    }
    const vulnOf = (u) => 1 + u.statuses.reduce((a, s) => Math.max(a, s.type === "weaken" ? s.amt : 0), 0); // 脆弱：被ダメ倍率
    const slowOf = (u) => u.statuses.reduce((a, s) => Math.min(a, s.type === "slow" ? s.mult : 1), 1); // 鈍足：移動倍率
    function tickStatuses(u) { let dmg = 0; const types = []; for (const s of u.statuses) { if (s.dmg) { dmg += s.dmg; types.push(s.type); } s.turns--; } u.statuses = u.statuses.filter((s) => s.turns > 0); return { dmg, types }; }

    // ===== 戦闘統計（分析フィードバック用・パラメータは見せず挙動の結果で語る）=====
    const mkStat = () => ({ shots: 0, hits: 0, crits: 0, dmgDealt: 0, dmgTaken: 0, ranged: 0, melee: 0, reloads: 0, empties: 0, statusOut: {}, mv: {}, near: 0, mid: 0, far: 0, distSum: 0, distN: 0, guile: 0, biggest: 0, biggestTurn: 0, firstHit: 0, hpSeries: [] });
    const stats = { p: mkStat(), c: mkStat() };

    const losClear = (a, b) => !obstacles.some((r) => segIntersectsRect(a, b, r));
    const displayDist = () => Math.round(clamp((dist(plr, cpu) / maxDist) * 100, 0, 100));
    const cx = (x) => clamp(x, 0, field.w), cy = (y) => clamp(y, 0, field.h);
    function terrainAt(p) { for (const z of arena.terrain) if (ptInRect(p, z)) return T[z.t]; return baseTerrain; }
    const stepLen = (u, p) => S.baseStep * (0.6 + 0.8 * u.micros.B5) * terrainAt(p).move * slowOf(u);

    function shotsFor(r, g) { let n = Math.floor(r); if (g.chance(r - n)) n++; return n; }
    function nearestObstacle(p) { let best = null, bd = Infinity; for (const r of obstacles) { const ox = r.x + r.w / 2, oy = r.y + r.h / 2, d = Math.hypot(ox - p.x, oy - p.y); if (d < bd) { bd = d; best = { x: ox, y: oy }; } } return best; }
    function applyMove(sp, self, fp, move) {
      const st = stepLen(self, sp), dx = fp.x - sp.x, dy = fp.y - sp.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      let nx = sp.x, ny = sp.y;
      if (move === "ADVANCE") { nx += ux * st; ny += uy * st; }
      else if (move === "RETREAT") { nx -= ux * st; ny -= uy * st; }
      else if (move === "STRAFE_L") { nx += -uy * st; ny += ux * st; }
      else if (move === "STRAFE_R") { nx += uy * st; ny += -ux * st; }
      else if (move === "COVER") { const o = nearestObstacle(sp); if (o) { const ox = o.x - sp.x, oy = o.y - sp.y, ol = Math.hypot(ox, oy) || 1; nx += (ox / ol) * st; ny += (oy / ol) * st; } }
      return { x: cx(nx), y: cy(ny) };
    }

    // 命中・期待ダメージ（地形：防御側の回避/被ダメ減・攻撃側の高所命中）
    function rangedHit(w, atkPos, defPos, foeS, d, los, moved) {
      if (!los) return 0;
      const rf = d <= w.effRange ? 1 : Math.max(0, 1 - (d - w.effRange) / w.falloff);
      const ev = Math.min(0.7, foeS.micros.B3 * 0.4);
      let h = w.accuracy * rf * (1 - ev) * (moved ? w.moveAccuracy : 1);
      h *= 1 - terrainAt(defPos).avoid; h *= 1 + terrainAt(atkPos).aim;
      return clamp(h, 0, 1);
    }
    const meleeHit = (foeS, defPos) => clamp(0.9 * (1 - Math.min(0.6, foeS.micros.B3 * 0.4) * 0.7) * (1 - terrainAt(defPos).avoid), 0, 1);
    const defMult = (defPos) => 1 - terrainAt(defPos).def;
    function expEx(atk, def, atkPos, defPos, d, los) {
      let dmg = 0;
      if (los) dmg += atk.ranged.fireRate * rangedHit(atk.ranged, atkPos, defPos, def, d, los, false) * atk.ranged.damage * defMult(defPos);
      if (d <= atk.melee.reach) dmg += atk.melee.rate * meleeHit(def, defPos) * atk.melee.damage * defMult(defPos);
      return dmg;
    }
    function expEx0(atk, def, d, los) { // winDist用（地形非依存・平地仮定）
      let dmg = 0;
      if (los) { const rf = d <= atk.ranged.effRange ? 1 : Math.max(0, 1 - (d - atk.ranged.effRange) / atk.ranged.falloff); dmg += atk.ranged.fireRate * atk.ranged.accuracy * rf * (1 - Math.min(0.7, def.micros.B3 * 0.4)) * atk.ranged.damage; }
      if (d <= atk.melee.reach) dmg += atk.melee.rate * 0.9 * (1 - Math.min(0.6, def.micros.B3 * 0.4) * 0.7) * atk.melee.damage;
      return dmg;
    }
    function winDistOf(self, foe) { let best = 18, bv = -Infinity; for (const d of [8, 18, 30, 45, 60, 80, 95]) { if (d > maxDist + 6) continue; const v = expEx0(self, foe, d, true) - expEx0(foe, self, d, true); if (v > bv) { bv = v; best = d; } } return best; }
    plr.winDist = winDistOf(plr, cpu); cpu.winDist = winDistOf(cpu, plr);
    // A1: 最適間合い(winDist)を人格で前後にずらした「好みの間合い」
    const prefRangeOf = (u) => clamp(u.winDist + (u.micros.A1 - 0.5) * 2 * 25, 4, maxDist);
    plr.prefRange = prefRangeOf(plr); cpu.prefRange = prefRangeOf(cpu);
    // C6: 瀕死(HP<30%)での背水の陣係数（火力UP・恐怖減）
    const lastStand = (u) => (u.hp / u.maxHp < 0.3 ? u.micros.C6 : 0);
    // D4: フェイント（高D4のみ・turn由来の決定論イベント）。相手の照準を乱す
    // D4 狡猾さ(権謀術数)＝小さなズルの束。各効果は「効く状況」でのみ・控えめな頻度。乱数非消費(turn由来)
    const gtick = (side, salt) => (((turn * 2654435761 + (side === "p" ? 101 : 211) + salt * 40503) >>> 0) % 1000) / 1000;
    function guileEvents(side, ctx) {
      const self = stat(side), g = self.micros.D4, e = { g, feint: false, exploit: false, bait: false, disinfo: false, outwit: false };
      if (g <= 0.45) return e;
      const r = (g - 0.45) * 1.1; // 狡猾の余剰ぶんだけ控えめに発動
      const foeAtk = ctx.foeAttacks === "RANGED" || ctx.foeAttacks === "MELEE";
      const selfAtk = ctx.selfAttacks === "RANGED" || ctx.selfAttacks === "MELEE";
      e.feint = foeAtk && gtick(side, 1) < r * 0.55;                                       // 揺さぶり：相手が撃ってくる時のみ
      e.exploit = !foeAtk && selfAtk && gtick(side, 2) < r * 0.6;                           // 隙突き：相手が攻めない隙＆自分が攻める時
      e.bait = Math.abs(ctx.dist - self.prefRange) > 15 && gtick(side, 3) < r * 0.45;       // 誘い込み：間合いを変えたい時
      e.disinfo = ctx.foeReads > 0.5 && gtick(side, 4) < r * 0.5;                           // 撹乱：相手が読んでくる時のみ
      e.outwit = selfAtk && gtick(side, 5) < r * 0.35;                                      // 出し抜き：自分が仕掛ける時のみ
      return e;
    }
    const falseMove = (mv) => MOVES[(MOVES.indexOf(mv) + 1 + (turn % 4)) % MOVES.length];
    function baitNudge(self, foe) { const dx = foe.x - self.x, dy = foe.y - self.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, step = clamp(self.prefRange - len, -3, 3); foe.x = cx(self.x + ux * (len + step)); foe.y = cy(self.y + uy * (len + step)); }
    function guilePrefix(ge) { const p = []; if (ge.feint) p.push("牽制で揺さぶり"); if (ge.exploit) p.push("相手の隙を突き"); if (ge.bait) p.push("誘い込み"); if (ge.disinfo) p.push("気配を断ち"); if (ge.outwit) p.push("機先を制し"); return p.length ? p.slice(0, 2).join("、") + "、" : ""; }

    function genCandidates(state, side) {
      const self = stat(side), fp = state[other(side)], sp = state[side], out = [];
      for (const move of MOVES) {
        const newPos = applyMove(sp, self, fp, move), moved = move !== "HOLD", d2 = dist(newPos, fp), los2 = losClear(newPos, fp);
        out.push({ move, attack: "NONE", newPos, moved, d2, los2 });
        if (los2 && self.ammo > 0) out.push({ move, attack: "RANGED", newPos, moved, d2, los2 });
        if (d2 <= self.melee.reach) out.push({ move, attack: "MELEE", newPos, moved, d2, los2 });
      }
      return out;
    }
    const snapshot = () => ({ p: { x: plr.x, y: plr.y, hp: plr.hp }, c: { x: cpu.x, y: cpu.y, hp: cpu.hp } });
    function applyExpected(state, side, cand) {
      const ns = { p: { ...state.p }, c: { ...state.c } }, fo = other(side), self = stat(side), foe = stat(fo), fp = { x: state[fo].x, y: state[fo].y };
      ns[side].x = cand.newPos.x; ns[side].y = cand.newPos.y;
      if (cand.attack === "RANGED" && cand.los2) ns[fo].hp = Math.max(0, ns[fo].hp - self.ranged.fireRate * rangedHit(self.ranged, cand.newPos, fp, foe, cand.d2, true, cand.moved) * self.ranged.damage * defMult(fp));
      else if (cand.attack === "MELEE" && cand.d2 <= self.melee.reach) ns[fo].hp = Math.max(0, ns[fo].hp - self.melee.rate * meleeHit(foe, fp) * self.melee.damage * defMult(fp));
      return ns;
    }
    function applyStochastic(state, side, cand, g) {
      const ns = { p: { ...state.p }, c: { ...state.c } }, fo = other(side), self = stat(side), foe = stat(fo), fp = { x: state[fo].x, y: state[fo].y };
      ns[side].x = cand.newPos.x; ns[side].y = cand.newPos.y;
      if (cand.attack === "RANGED" && cand.los2) { const hc = rangedHit(self.ranged, cand.newPos, fp, foe, cand.d2, true, cand.moved); let dmg = 0; for (let i = 0; i < shotsFor(self.ranged.fireRate, g); i++) if (g.chance(hc)) dmg += self.ranged.damage * defMult(fp); ns[fo].hp = Math.max(0, ns[fo].hp - dmg); }
      else if (cand.attack === "MELEE" && cand.d2 <= self.melee.reach) { const hc = meleeHit(foe, fp); let dmg = 0; for (let i = 0; i < shotsFor(self.melee.rate, g); i++) if (g.chance(hc)) dmg += self.melee.damage * defMult(fp); ns[fo].hp = Math.max(0, ns[fo].hp - dmg); }
      return ns;
    }
    function dangerDist(self) { let best = null, bv = 0; for (const k in self.hurtAt) if (self.hurtAt[k] > bv) { bv = self.hurtAt[k]; best = +k; } return bv > 0 ? best : null; }

    function evalParts(state, side) {
      const self = stat(side), foe = stat(other(side)), sp = state[side], fp = state[other(side)], m = self.micros;
      const d = dist(sp, fp), los = losClear(sp, fp), shpf = sp.hp / self.maxHp, fhpf = fp.hp / foe.maxHp;
      const myE = expEx(self, foe, sp, fp, d, los), foeE = expEx(foe, self, fp, sp, d, los);
      const myOpen = expEx(self, foe, sp, fp, d, true), foeOpen = expEx(foe, self, fp, sp, d, true);
      const perc = 1.4 - 0.8 * m.C4, margin = Math.min(sp.x, field.w - sp.x, sp.y, field.h - sp.y), turnsLeft = turnCap - turn, dz = dangerDist(self);
      const tr = terrainAt(sp);
      const f = {
        hp: shpf - fhpf, trade: clamp((myE - foeE) / 40, -1, 1), engage: clamp(myE / 40, 0, 1),
        winRange: 1 - clamp(Math.abs(d - self.prefRange) / (55 - m.B4 * 25), 0, 1.4),
        threat: -clamp(foeE / 40, 0, 1) * perc, cover: !los ? clamp((foeOpen - myOpen) / 30, 0, 1) : 0,
        terrain: clamp(tr.def + Math.max(0, tr.avoid) - (tr.move < 1 ? (1 - tr.move) * 0.4 : 0) + tr.aim * 0.6, -0.5, 0.8),
        pos: clamp(margin / 12, 0, 1) * 2 - 1,
        kill: fhpf < 0.3 ? (0.3 - fhpf) / 0.3 : 0, danger: shpf < 0.35 ? -(0.35 - shpf) / 0.35 : 0,
        tempo: turnsLeft < 8 && shpf - fhpf < -0.05 ? -0.6 : 0, avoid: dz != null && Math.abs(d - dz) < 15 ? -1 : 0,
      };
      const tilt = shpf < 0.4 ? (1 - self.cog.evalStability) * 0.6 : 0;
      const desp = shpf < 0.3 ? m.C6 : 0; // C6 背水：瀕死で恐怖↓・攻め↑
      const w = {
        hp: 1.0, trade: 0.4 + m.C2 * 0.6, engage: 0.25 + m.A2 * 0.3 + m.A6 * 0.2 + desp * 0.4, winRange: 0.55 + m.A3 * 0.2 + m.B2 * 0.2,
        threat: (0.3 + m.C1 * 0.5) * (1 + tilt) * (1 - desp * 0.6), cover: 0.15 + m.B1 * 0.6 + m.D5 * 0.2, terrain: 0.2 + m.B1 * 0.4 + m.D5 * 0.4,
        pos: 0.1 + m.B6 * 0.3 + m.D5 * 0.2, kill: 0.4 + m.A6 * 0.5 + m.C3 * 0.4, danger: 0.5 * (1 + tilt) * (1 - desp * 0.7), tempo: 0.3, avoid: self.cog.learning * 0.5,
      };
      const lead = shpf - fhpf, late = turnsLeft < 12; // D4 時間の駆け引き
      if (late && lead > 0.05) w.threat *= 1 + m.D4 * 0.5;  // 有利→逃げ切り上手（脅威回避↑）
      if (late && lead < -0.05) w.engage += m.D4 * 0.3;     // 不利→急かし上手（攻め↑）
      const stall = Math.min(1, noDamageTurns / 4); // 膠着が続くほど全員が交戦を急ぐ＝膠着打破（早めに発火）
      if (stall > 0) { w.engage += stall * 0.6; w.winRange += stall * 0.3; w.threat *= 1 - stall * 0.5; w.cover *= 1 - stall * 0.6; }
      let v = 0; for (const k in f) v += f[k] * w[k];
      return { v, f, w };
    }
    const evalState = (s, side) => evalParts(s, side).v;
    function dominantFactor(s, side) { const { f, w } = evalParts(s, side); let b = "hp", bv = -Infinity; for (const k in f) { const c = Math.abs(f[k] * w[k]); if (c > bv) { bv = c; b = k; } } return FACTOR_JP[b]; }

    const terminal = (s) => s.p.hp <= 0 || s.c.hp <= 0;
    function greedyBest(state, side) { let best = null; for (const c of genCandidates(state, side)) { const ns = applyExpected(state, side, c); const v = evalState(ns, side); if (!best || v > best.v) best = { c, ns, v }; } return best; }
    function bestCandWithMove(state, side, move) { let best = null; for (const c of genCandidates(state, side)) { if (c.move !== move) continue; const ns = applyExpected(state, side, c); const v = evalState(ns, side); if (!best || v > best.v) best = { c, ns, v }; } return best || greedyBest(state, side); }
    function valueOf(state, mover, depth, forWhom) { if (depth <= 0 || terminal(state)) return evalState(state, forWhom); const gb = greedyBest(state, mover); return depth <= 1 ? evalState(gb.ns, forWhom) : valueOf(gb.ns, other(mover), depth - 1, forWhom); }
    function rollout(state, first, g, horizon, forWhom) { let s = { p: { ...state.p }, c: { ...state.c } }, mv = first; for (let i = 0; i < horizon && !terminal(s); i++) { const gb = greedyBest(s, mv); s = applyStochastic(s, mv, gb.c, g); mv = other(mv); } return evalState(s, forWhom); }

    function predictMove(self) { const r = self.oppModel.recent.slice(-5); if (!r.length) return null; const c = {}; let b = null, bv = 0; for (const mv of r) { c[mv] = (c[mv] || 0) + 1; if (c[mv] > bv) { bv = c[mv]; b = mv; } } return bv >= 2 ? b : null; }
    function naturalPlan(self, foe, d) { if (foe.hp / foe.maxHp < 0.3) return "仕留め"; if (self.hp / self.maxHp < 0.25 && self.micros.C6 < 0.5) return "退避"; if (d > self.prefRange + 12) return "接近"; if (d < self.prefRange - 12) return "距離取り"; return "定間合い"; }
    function commitPlan(self, foe, d) { // 順応(D2)が高いほど乗り換えやすい・規律寄りは固執
      const np = naturalPlan(self, foe, d), hard = np === "仕留め" || np === "退避";
      if (self.plan == null || hard) { self.plan = np; self.planPressure = 0; return np; }
      if (np === self.plan) { self.planPressure = 0; return self.plan; }
      self.planPressure++; if (self.planPressure >= 1 + Math.round((1 - self.micros.D2) * 3)) { self.plan = np; self.planPressure = 0; }
      return self.plan;
    }
    function planBias(cand, plan, self, predist) {
      const dd = cand.d2;
      if (plan === "接近") return (predist - dd) / 30;
      if (plan === "距離取り") return (dd - predist) / 30;
      if (plan === "仕留め") return (predist - dd) / 30 + (cand.attack !== "NONE" ? 0.3 : 0);
      if (plan === "退避") return (cand.attack === "NONE" ? 0.1 : 0) + (!cand.los2 ? 0.3 : 0) + (dd - predist) / 40;
      return -Math.abs(dd - self.prefRange) / 40;
    }

    function reloadDecision(side) {
      const s0 = snapshot(), cands = genCandidates(s0, side).filter((c) => c.attack === "NONE");
      let best = cands[0], bv = -Infinity;
      for (const c of cands) { const v = evalState(applyExpected(s0, side, c), side); if (v > bv) { bv = v; best = c; } }
      const self = stat(side);
      return { cand: { ...best, attack: "RELOAD" }, reason: "弾込め", predFoe: null, depth: self.cog.searchDepth, mc: 0, plan: "リロード", second: null, readFoe: null };
    }
    function decide(side) {
      const fo = other(side), self = stat(side), foe = stat(fo), cog = self.cog, s0 = snapshot();
      const ammoFrac = self.ammo / self.ranged.mag, caution = clamp((1 - self.micros.C2) * 0.40, 0, 0.45); // リスク低=早めに装填／博打打ちは弾切れまで撃つ
      if (self.reloadLeft > 0 || self.ammo === 0 || (ammoFrac < caution && (expEx(foe, self, { x: foe.x, y: foe.y }, { x: self.x, y: self.y }, dist(self, foe), losClear(self, foe)) < 12 || !losClear(self, foe)))) return reloadDecision(side);
      const predist = Math.round(dist(self, foe)), plan = commitPlan(self, foe, predist);
      const learned = predictMove(self), useModel = !!learned && cog.oppModelWeight > 0.5;
      const planW = 0.12 + (1 - self.micros.D2) * 0.18; // 順応低=プラン固執（バイアス強）

      let cands = genCandidates(s0, side);
      for (const c of cands) c.q = evalState(applyExpected(s0, side, c), side);
      cands.sort((a, b) => b.q - a.q);
      cands = cands.slice(0, cog.breadth);

      for (const c of cands) {
        const ns = applyExpected(s0, side, c);
        let v;
        if (cog.searchDepth <= 1) v = evalState(ns, side);
        else { const reply = useModel ? bestCandWithMove(ns, fo, learned) : greedyBest(ns, fo); v = valueOf(reply.ns, side, cog.searchDepth - 2, side); }
        if (cog.mcSamples > 0) { let sum = 0; for (let r = 0; r < cog.mcSamples; r++) { const think = SCS.makeRNG(((seed >>> 0) ^ (turn * 131) ^ (side === "p" ? 1 : 2) ^ ((cands.indexOf(c) + 1) * 977) ^ (r * 13)) >>> 0); sum += rollout(ns, fo, think, cog.searchDepth * 2, side); } v = v * 0.4 + (sum / cog.mcSamples) * 0.6; }
        v += planW * planBias(c, plan, self, predist);
        if (c.attack === "RANGED" && c.los2) { const hc = rangedHit(self.ranged, c.newPos, { x: s0[fo].x, y: s0[fo].y }, foe, c.d2, true, c.moved); const gate = clamp(self.micros.A5 * 0.6 - self.micros.A4 * 0.4, 0, 0.45); if (hc < gate) v -= (gate - hc) * 0.7; } // A5/A4: 命中見込み低なら撃たない/とにかく撃つ
        v += rng.range(-cog.explorationTemp, cog.explorationTemp);
        c.v = v; c.ns = ns;
      }
      cands.sort((a, b) => b.v - a.v);
      const best = cands[0], second = cands[1] ? cands[1].move : null;
      let predFoe = useModel ? learned : null;
      if (!predFoe && cog.searchDepth >= 2 && best.ns.p.hp > 0 && best.ns.c.hp > 0) predFoe = greedyBest(best.ns, fo).c.move;
      return { cand: best, reason: dominantFactor(best.ns, side), predFoe, depth: cog.searchDepth, mc: cog.mcSamples, plan, second, readFoe: useModel ? learned : null };
    }

    function moveUnit(side, cand) { const s = stat(side); s.x = cand.newPos.x; s.y = cand.newPos.y; }
    function knockback(att, tgt) { const dx = tgt.x - att.x, dy = tgt.y - att.y, len = Math.hypot(dx, dy) || 1; tgt.x = cx(tgt.x + (dx / len) * att.melee.knockback); tgt.y = cy(tgt.y + (dy / len) * att.melee.knockback); }
    // 攻撃のみ解決（移動は済・最終位置で判定）。ダメージは step 側で同時適用するため hp はここで変えない
    function resolveAttack(side, cand, deceived, edge) {
      const self = stat(side), foe = stat(other(side)), ev = { move: cand.move, attack: cand.attack, moved: cand.moved };
      if (cand.attack !== "RANGED") self.charged = false; // 射撃をやめるとチャージ解除
      if (cand.attack !== "MELEE") self.windLeft = 0;     // 近接をやめると溜め解除
      const buff = 1 + lastStand(self) * 0.5, decoy = deceived ? 0.8 : 1, eg = edge || 1;
      const precise = clamp(self.micros.A5 * 0.5 + self.micros.B4 * 0.3 - self.micros.A4 * 0.4, 0, 1); // 精密(急所)⇔乱射

      // リロード（選択 or 継続中）
      if (self.reloadLeft > 0 || cand.attack === "RELOAD") {
        if (self.reloadLeft === 0) { self.reloadLeft = self.ranged.reloadTurns; if (self.ammo === 0) ev.emptyReload = true; }
        self.reloadLeft--; self.spread = 0;
        if (self.reloadLeft <= 0) { self.ammo = self.ranged.mag; ev.reloadDone = true; }
        ev.attack = "RELOAD"; ev.reloading = true; return ev;
      }

      const d2 = dist(self, foe), los2 = losClear(self, foe), fp = { x: foe.x, y: foe.y };

      if (cand.attack === "RANGED") {
        if (!los2) { ev.negated = true; return ev; }
        const rw = self.ranged;
        if (rw.mode === "charge" && !self.charged) { self.charged = true; ev.charging = true; return ev; } // チャージ：1ターン溜めてから撃つ（移動では解除しない）
        if (self.ammo <= 0) { ev.empty = true; return ev; }
        let shots = rw.mode === "charge" ? 1 : shotsFor(rw.fireRate, rng);
        if (precise > 0.55 && rw.mode !== "charge") shots = Math.max(1, Math.round(shots * (1 - precise * 0.5))); // 手数を絞る
        shots = Math.min(shots, self.ammo); self.ammo -= shots;
        if (rw.mode === "charge") self.charged = false;
        const critChance = clamp(rw.crit + precise * 0.2 + (rw.mode === "charge" ? 0.25 : 0), 0, 0.7); // 溜め撃ち＝狙い澄ました会心
        const hc = Math.min(1, rangedHit(rw, self, fp, foe, d2, true, cand.moved) * decoy * eg * (1 - self.spread));
        let hits = 0, dmg = 0, crits = 0;
        for (let i = 0; i < shots; i++) if (rng.chance(hc)) { hits++; let dd = rw.damage; if (rng.chance(critChance)) { dd *= rw.critMult; crits++; } dmg += dd * defMult(fp) * vulnOf(foe); }
        ev.shots = shots; ev.hits = hits; ev.crits = crits; ev.dmg = Math.round(dmg * buff);
        if (rw.mode === "auto" && shots > 0) self.spread = Math.min(0.5, self.spread + rw.spreadGrowth * (1 - self.micros.B4 * 0.5)); // 規律で反動抑制
        if (hits > 0 && rw.status) ev.applyStatus = rw.status;
        return ev;
      }

      self.spread = Math.max(0, self.spread - 0.2); // 撃たないと拡散回復

      if (cand.attack === "MELEE" && d2 <= self.melee.reach) {
        const mw = self.melee;
        if (mw.windup > 0) { // 大振り：溜めてから振る
          if (self.windLeft <= 0) { self.windLeft = mw.windup; ev.windup = true; return ev; }
          self.windLeft--; if (self.windLeft > 0) { ev.windup = true; return ev; }
        }
        let swings = mw.pattern === "heavy" ? 1 : shotsFor(mw.rate, rng);
        if (precise > 0.55 && mw.pattern === "multi") swings = Math.max(1, Math.round(swings * (1 - precise * 0.4))); // 多段でも一点集中
        const critChance = clamp(mw.crit + precise * 0.2, 0, 0.6);
        const hc = Math.min(1, meleeHit(foe, fp) * decoy * eg);
        let hits = 0, dmg = 0, crits = 0;
        for (let i = 0; i < swings; i++) if (rng.chance(hc)) { hits++; let dd = mw.damage; if (rng.chance(critChance)) { dd *= mw.critMult; crits++; } dmg += dd * defMult(fp) * vulnOf(foe); }
        ev.shots = swings; ev.hits = hits; ev.crits = crits; ev.dmg = Math.round(dmg * buff); ev.kb = hits > 0 && mw.knockback > 0;
        if (hits > 0 && mw.status) ev.applyStatus = mw.status;
        return ev;
      } else if (cand.attack === "MELEE") ev.outOfReach = true;
      return ev;
    }

    // 文章的・同時進行の描写（肉付け版）。乱数は使わず turn 由来の決定論的バリエーション
    // ===== リッチ描写エンジン（決定論・多彩バリエーション・自然な言い回し）=====
    function hsh(a) { let x = ((turn * 2654435761) ^ (a * 40503) ^ ((seed >>> 0) * 0x85ebca6b) ^ 0x9e3779b9) >>> 0; x ^= x >>> 13; x = (x * 1274126177) >>> 0; return x >>> 0; }
    const px = (arr, salt) => arr[hsh(salt) % arr.length];
    const sideSalt = (side, t) => (side === "PLR" ? 1000 : 2000) + t;

    const DEMEANOR = {
      desperate: ["もう後がない——", "傷だらけの体に鞭打ち、", "死をも恐れぬ目で、", "追い詰められた獣のごとく、", "なりふり構わず、", "最後の一滴まで振り絞り、", "退路を断たれてなお、"],
      hurt: ["肩で大きく息をしながら", "傷口を押さえつつ", "脂汗を滲ませ", "ふらつく足を踏みしめ", "苦悶を噛み殺し", "片膝を震わせながら"],
      cunning: ["不敵な笑みを浮かべ", "舌なめずりするように", "底の知れぬ表情で", "目を細め、", "罠を張るように"],
      aggressive: ["獰猛に牙を剥き、", "血気に逸り、", "猛々しく", "闘志を剥き出しに", "攻めの気を漲らせ"],
      calm: ["涼しい顔で", "眉一つ動かさず", "落ち着き払って", "静かな闘気を湛え、", "冷徹に"],
      cautious: ["慎重に", "じりじりと様子を窺い、", "用心深く", "間合いを測りながら", "焦らず"],
      neutral: ["", "気を引き締め、", "呼吸を整え、", "視線を鋭くし、"],
    };
    function moodOf(self) {
      const f = self.hp / self.maxHp;
      if (lastStand(self) > 0.4) return "desperate";
      if (f < 0.4) return "hurt";
      if (self.micros.D4 > 0.6 && hsh(99) % 3 === 0) return "cunning";
      if (self.micros.A2 > 0.62) return "aggressive";
      if (self.micros.C5 > 0.62) return "calm";
      if (self.micros.A1 > 0.6 || self.micros.B2 > 0.6) return "cautious";
      return "neutral";
    }
    const MV = {
      ADVANCE: ["距離を一気に詰め", "間合いを潰しにかかり", "ぐいと踏み込み", "前へ前へと圧をかけ", "詰め寄り", "地を蹴って迫り", "じわりと間合いを侵し", "正面から踏み込み", "歩を進めて圧をかけ"],
      RETREAT: ["すっと距離を取り", "後ろへ跳んで間合いを開け", "じりっと退き", "間合いを作り直し", "一旦引いて", "身を翻して離れ", "半歩引いて出方を窺い", "間合いをほどき"],
      STRAFE_L: ["左へ回り込み", "弧を描いて左へ流れ", "左へ身を滑らせ", "左へステップを刻み"],
      STRAFE_R: ["右へ回り込み", "弧を描いて右へ流れ", "右へ身を滑らせ", "右へステップを刻み"],
      COVER: ["遮蔽の陰へ身を滑り込ませ", "物陰へ転がり込み", "壁を盾に取り", "遮蔽へ飛び込み"],
      HOLD: ["その場に踏み止まり", "足を止めてじっと構え", "腰を据え", "微動だにせず機を計り"],
    };
    function terrainPhrase(tr) {
      if (tr.name === "茂み") return px(["茂みに紛れ", "草陰を利して"], 71);
      if (tr.name === "瓦礫") return px(["瓦礫を盾に", "崩れた壁を利し"], 72);
      if (tr.name === "沼地") return px(["沼に足を取られながら", "ぬかるみを踏みしめ"], 73);
      if (tr.name === "高所") return px(["高所から見下ろし", "一段高い足場から"], 74);
      return "";
    }
    function weaponCat(w, ranged) {
      if (ranged) return w.mode === "charge" || w.key === "marksman" || w.key === "pistol" || w.key === "burst" ? "precise" : w.key === "shotgun" ? "shotgun" : "auto";
      return w.pattern === "multi" ? "mlt" : w.pattern === "heavy" ? "hvy" : "bal";
    }
    const ATK_HIT = {
      precise: ["{w}で狙い澄まして撃ち抜き", "{w}の一発を急所へ吸い込ませ", "{w}で精確に射貫き", "{w}の照準を寸分違わず合わせ"],
      auto: ["{w}の弾雨を浴びせ", "{w}を掃射して縫い止め", "{w}でなぎ払うように撃ち込み", "{w}の連射を叩き込み"],
      shotgun: ["至近から{w}を叩き込み", "{w}の散弾を抉り込ませ", "{w}を顔面へ撃ち込み"],
      mlt: ["{w}で目にも留まらぬ連撃を浴びせ", "{w}を閃かせて刻みつけ", "{w}の乱舞で切り裂き"],
      hvy: ["{w}を渾身で振り下ろし", "{w}の一撃を全身で叩きつけ", "唸りを上げる{w}を振り抜き"],
      bal: ["{w}を鋭く振り抜き", "{w}で間合いを断ち切り", "{w}を一閃させ", "{w}の刃を滑り込ませ"],
    };
    const ATK_MISS = {
      precise: ["{w}を放つも、紙一重で逸れる", "{w}の一発は虚しく宙を裂いた", "狙いはわずかに甘く、{w}は空を切る"],
      auto: ["{w}をばら撒くも捉えきれず", "{w}の連射は空を縫うばかり", "{w}を浴びせるが、すべて逸れる"],
      shotgun: ["{w}の散弾は届かず散る", "{w}を撃つも間合いが遠い"],
      mlt: ["{w}を閃かせるも空を切る", "{w}の連撃はかすりもしない"],
      hvy: ["{w}を振るうも大きく空振り", "{w}は虚しく地を叩いた"],
      bal: ["{w}を振り抜くも捉え損ね", "{w}の一閃は空を裂くのみ"],
    };
    const REACT = ["確かな手応え。", "鈍い衝撃が走った。", "血飛沫が舞う。", "効いている。", "深い傷を刻んだ。", "たまらず体勢が崩れる。", "苦痛の声が漏れた。", "重い一撃が通った。", "相手がぐらりとよろめく。", "確実に削った。", "顔をしかめ、後ずさる。", "息を呑む音が聞こえた。"];
    const REACT_BIG = ["致命的な一撃だ！", "戦況を変える痛打！", "骨まで断つ一撃——！", "完全に捉えた！"];

    function statusApplyPhrase(type, slt) {
      const m = {
        burn: ["・炎が燃え移り、じりじりと焼く", "——衣服に火が点いた"],
        bleed: ["・傷口が開き、血が滴る", "——鮮血がしたたり落ちる"],
        poison: ["・毒が血に回り始める", "——刃に塗られた毒がじわりと効く"],
        stun: ["・脳を揺らし、動きを止めた！", "——たまらず硬直する"],
        weaken: ["・防御が崩れ、隙が大きくなる", "——構えが甘くなった"],
        slow: ["・足を絡め取り、動きを鈍らせる", "——身のこなしが重くなる"],
      };
      return px(m[type] || [""], slt + 5);
    }
    function composeAttack(self, foe, ev) {
      const sd = self.side, rn = ev.attack === "RANGED", w = rn ? self.ranged : self.melee, name = w.name;
      if (ev.attack === "RELOAD") {
        if (ev.emptyReload) return px(["弾が尽きた——！慌てて弾倉を交換する。", "空撃ち！急いでリロードに入る。", "弾切れだ、装填の隙を晒す。"], sideSalt(sd, 65));
        return ev.reloadDone
          ? px(["弾倉を素早く入れ替えた。再装填完了。", "新しいマガジンを叩き込む。装填完了だ。", "手早く弾を込め直す。これでまた撃てる。"], sideSalt(sd, 60))
          : px(["弾倉を抜き、装填にかかる——一瞬の無防備。", "弾込めの隙。今は撃てない。", "リロードに入る。最も危うい刹那だ。"], sideSalt(sd, 61));
      }
      if (ev.attack === "NONE") return px(["好機を窺う。", "相手の出方を探る。", "間合いを計りながら機を待つ。", "そっと様子を見る。", "じっと呼吸を読む。"], sideSalt(sd, 62));
      const slt = sideSalt(sd, rn ? 63 : 64);
      if (rn && ev.charging) return px([`${name}に狙いを溜める。エネルギーが満ちていく。`, `${name}を構え、照準を絞り込む。次の一射に懸ける。`, `${name}のチャージを開始。狙うは一撃必殺。`], slt);
      if (rn && ev.empty) return px([`引き金を引くも——${name}は弾切れだ！`, `${name}が沈黙する。弾がない！`, `カチ、と乾いた音。${name}は空だ。`], slt);
      if (rn && ev.negated) return px([`${name}を撃つも、遮蔽に阻まれ通らない。`, `放った弾は壁に弾かれた。`, `${name}の射線は遮られている。`], slt);
      if (!rn && ev.windup) return px([`${name}を大きく振りかぶる。次の一撃に全てを乗せる。`, `${name}を頭上高く構え、力を溜める。`, `${name}を引き絞るように振り上げた。`], slt);
      if (!rn && ev.outOfReach) return px([`${name}を振るうが、間合いがわずかに足りない。`, `${name}の切っ先は空を掠めるのみ。`, `あと一歩——${name}は届かない。`], slt);
      const cat = weaponCat(w, rn);
      if (ev.dmg > 0) {
        const crit = ev.crits > 0;
        const verb = px(ATK_HIT[cat], slt + (crit ? 7 : 0)).replace("{w}", name);
        const critPre = crit ? px(["会心の一撃！", "渾身——！", "急所を捉えた！"], slt + 3) : "";
        const st = ev.statusType ? statusApplyPhrase(ev.statusType, slt) : "";
        const kb = ev.kb ? "・大きく弾き飛ばす" : "";
        const react = ev.dmg >= 0.35 * foe.maxHp || (crit && ev.dmg >= 0.25 * foe.maxHp) ? px(REACT_BIG, slt + 9) : px(REACT, slt + 9);
        return `${critPre}${verb}、−${ev.dmg}${kb}${st}。${react}`;
      }
      return px(ATK_MISS[cat], slt).replace("{w}", name) + "。";
    }
    function composeAction(side, dec, ev, gpre) {
      const self = stat(side), sd = self.side;
      if (dec.stunned) return px(["痺れて動けない——！その場で隙を晒す。", "麻痺が全身を貫き、立ち尽くす。", "体が言うことを聞かない。動けないまま固まる。"], sideSalt(sd, 66)) + " 〈麻痺〉";
      const dem = px(DEMEANOR[moodOf(self)], sideSalt(sd, 11));
      const mvp = px(MV[dec.cand.move], sideSalt(sd, 12));
      const terr = terrainPhrase(terrainAt(self)), terrC = terr ? terr + "、" : "";
      const atk = composeAttack(self, stat(other(side)), ev);
      const body = `${dem}${gpre || ""}${terrC}${mvp}、${atk}`;
      const read = dec.readFoe && hsh(sideSalt(sd, 13)) % 2 === 0 ? ` ${px(["相手の", "敵の"], sideSalt(sd, 14))}${MOVE_JP[dec.readFoe]}を見切っていた。` : "";
      const tags = ` 〈${dec.plan}/深${dec.depth}${dec.mc ? "+MC" : ""}・${dec.reason}〉`;
      return `${body}${read}${tags}`;
    }
    const hpWord = (u) => { const f = u.hp / u.maxHp; return u.hp <= 0 ? "（戦闘不能）" : f < 0.25 ? "（瀕死）" : f < 0.5 ? "（手負い）" : ""; };
    const CM_BIGHIT = ["── 観客がどよめくような一撃が突き刺さった！", "── 今のは効いた。流れが動く。", "── 鮮烈な一撃、見ていて鳥肌が立つ。"];
    const CM_LOW = ["── 〈X〉、満身創痍。崩れるのは時間の問題か。", "── 〈X〉の足元が覚束ない。決着は近い。", "── 追い詰められた〈X〉、ここからが本当の勝負だ。"];
    const CM_STALL = ["── 互いに一歩も譲らず、張り詰めた静寂が続く。", "── 牽制の応酬。誰もが息を呑む睨み合いだ。", "── 動いた方が不利——そんな緊張が漂う。"];
    function commentary(evP, evC, hpP0, hpC0) {
      const out = [];
      const big = (evP.crits > 0 && evP.dmg >= 18) || (evC.crits > 0 && evC.dmg >= 18);
      if (big && hsh(31) % 2 === 0) out.push({ text: px(CM_BIGHIT, 31), cls: "cm" });
      const lowNew = (hp0, u) => hp0 / u.maxHp >= 0.3 && u.hp / u.maxHp < 0.3 && u.hp > 0;
      if (lowNew(hpC0, cpu)) out.push({ text: px(CM_LOW, 32).replace("X", `CPU(${cpu.name})`), cls: "cm" });
      else if (lowNew(hpP0, plr)) out.push({ text: px(CM_LOW, 33).replace("X", `PLR(${plr.name})`), cls: "cm" });
      if (noDamageTurns >= 4 && hsh(34) % 2 === 0) out.push({ text: px(CM_STALL, 34), cls: "cm" });
      return out;
    }
    function situationLine(pre) {
      const pd = Math.round(clamp((dist(pre.p, pre.c) / maxDist) * 100, 0, 100)), los = losClear(pre.p, pre.c);
      const dfeel = pd < 15 ? px(["息のかかる至近距離", "刃が触れ合う間合い"], 41) : pd < 35 ? px(["互いの表情も見える近間", "踏み込めば届く距離"], 42) : pd < 60 ? px(["射撃を交わす中距離", "睨み合う中間合い"], 43) : px(["遠く隔てた間合い", "遠間での睨み合い"], 44);
      const ln = los ? px(["射線は通っている", "視界はクリア"], 46) : px(["遮蔽が射線を断つ", "障害物が間に立ち塞がる"], 47);
      const fd = plr.hp / plr.maxHp - cpu.hp / cpu.maxHp;
      const mom = fd > 0.2 ? "PLRが圧倒する流れ" : fd > 0.08 ? "ややPLRに分がある" : fd < -0.2 ? "CPUが押し込む展開" : fd < -0.08 ? "ややCPU優勢" : "互角の睨み合い";
      return `${dfeel}（${pd}％）、${arena.name}。${ln}。${mom}。`;
    }
    function narrateTurn(pre, decP, evP, decC, evC, hpP0, hpC0, geP, geC) {
      const pd = Math.round(clamp((dist(pre.p, pre.c) / maxDist) * 100, 0, 100));
      const lines = [
        { text: `【戦況】${situationLine(pre)}`, cls: "sit" },
        { text: `　▸ PLR（${plr.name}）　${composeAction("p", decP, evP, guilePrefix(geP))}`, cls: "plr" },
        { text: `　▸ CPU（${cpu.name}）　${composeAction("c", decC, evC, guilePrefix(geC))}`, cls: "cpu" },
        { text: `　└ 結果：間合い ${pd}→${displayDist()}％／PLR ${hpP0}→${plr.hp}${hpWord(plr)}・CPU ${hpC0}→${cpu.hp}${hpWord(cpu)}`, cls: "dim" },
      ];
      for (const c of commentary(evP, evC, hpP0, hpC0)) lines.push(c);
      return lines;
    }
    const FIN_KO = ["崩れ落ちた。", "ついに膝をついた。", "力尽きて倒れ込む。", "糸が切れたように沈黙した。", "もう立ち上がれない。"];
    function winFlavor(win) {
      if (win.hp / win.maxHp < 0.18) return px(["満身創痍、執念がもぎ取った勝利だった。", "倒れる寸前——気力だけで勝ち切った。", "紙一重、勝負はまさに薄氷の上にあった。"], 82);
      const rn = win.winDist > 25, w = rn ? win.ranged : win.melee, cat = weaponCat(w, rn);
      const pool = {
        precise: ["精緻な一射が、勝敗を断ち切った。", "狙い澄ました弾が、すべてを終わらせた。"],
        auto: ["浴びせ続けた弾幕が、相手をねじ伏せた。", "途切れぬ連射が、地力で押し切った。"],
        shotgun: ["至近の一撃が、勝負を吹き飛ばした。", "間合いを支配した者の、圧倒的な決着。"],
        mlt: ["疾風の連撃が、急所を捉え切った。", "目にも留まらぬ刃が、勝敗を刻んだ。"],
        hvy: ["渾身の一撃が、すべてを叩き伏せた。", "重き刃の一振りが、決着を告げた。"],
        bal: ["冴え渡る一閃が、勝負を決めた。", "間合いを制した刃が、見事に断ち切った。"],
      };
      return px(pool[cat], 83);
    }
    function finishNarration(res) {
      const out = [{ text: "═══════════════  決　着  ═══════════════", cls: "result" }];
      if (res.type === "draw") {
        out.push({ text: `　${res.text === "相討ち" ? "両者、同時に崩れ落ちた——相討ち！" : "時は尽き、決着はつかなかった。"}`, cls: "result" });
        out.push({ text: `　最終 PLR ${plr.hp}/${plr.maxHp} ・ CPU ${cpu.hp}/${cpu.maxHp}（${res.text}）`, cls: "dim" });
      } else {
        const win = res.winner === "PLR" ? plr : cpu, lose = res.winner === "PLR" ? cpu : plr;
        const wl = `${res.winner}（${win.name}）`, ll = `${res.winner === "PLR" ? "CPU" : "PLR"}（${lose.name}）`;
        out.push({ text: res.text === "KO" ? `　${ll}、${px(FIN_KO, 81)}　勝者 ── ${wl}！` : `　時間切れ。HPを残した ${wl} が判定を制した！`, cls: "result" });
        out.push({ text: `　${winFlavor(win)}`, cls: "cm" });
        out.push({ text: `　最終 ${wl} ${win.hp}/${win.maxHp} ・ ${ll} ${lose.hp}/${lose.maxHp}（決まり手：${res.text}）`, cls: "dim" });
      }
      out.push({ text: "══════════════════════════════════════", cls: "result" });
      return out;
    }
    function finishCheck() {
      if (plr.hp <= 0 && cpu.hp <= 0) return { type: "draw", text: "相討ち" };
      if (cpu.hp <= 0) return { type: "win", winner: "PLR", text: "KO" };
      if (plr.hp <= 0) return { type: "win", winner: "CPU", text: "KO" };
      if (turn >= turnCap) { const pf = plr.hp / plr.maxHp, cf = cpu.hp / cpu.maxHp; if (Math.abs(pf - cf) < 0.05) return { type: "draw", text: "時間切れ・僅差" }; return { type: "win", winner: pf > cf ? "PLR" : "CPU", text: "時間切れ・HP判定" }; }
      return null;
    }
    // 麻痺中は行動不能（その場で硬直）
    function stunnedDecision(side) { const self = stat(side); return { cand: { move: "HOLD", attack: "NONE", newPos: { x: self.x, y: self.y }, moved: false, d2: dist(plr, cpu), los2: losClear(plr, cpu) }, reason: "麻痺", predFoe: null, depth: self.cog.searchDepth, mc: 0, plan: "麻痺", second: null, readFoe: null, stunned: true }; }

    function recordStats(side, dec, ev, ge, dmgTaken, preDist) {
      const s = stats[side], band = Math.round(clamp((preDist / maxDist) * 100, 0, 100));
      s.mv[dec.cand.move] = (s.mv[dec.cand.move] || 0) + 1;
      if (band < 25) s.near++; else if (band < 55) s.mid++; else s.far++;
      s.distSum += band; s.distN++;
      if (ev.attack === "RANGED" && ev.shots) s.ranged++;
      if (ev.attack === "MELEE" && ev.shots) s.melee++;
      if (ev.reloading) s.reloads++;
      if (ev.emptyReload) s.empties++;
      if (ev.shots) { s.shots += ev.shots; s.hits += ev.hits || 0; s.crits += ev.crits || 0; }
      if (ev.dmg) { s.dmgDealt += ev.dmg; if (ev.dmg > s.biggest) { s.biggest = ev.dmg; s.biggestTurn = turn; } if (!s.firstHit) s.firstHit = turn; }
      if (ev.statusType) s.statusOut[ev.statusType] = (s.statusOut[ev.statusType] || 0) + 1;
      s.dmgTaken += dmgTaken;
      if (ge) for (const k of ["feint", "exploit", "bait", "disinfo", "outwit"]) if (ge[k]) s.guile++;
    }

    // 分析フィードバック：パラメータ(24小パラ)は見せず、戦闘の「結果」から挙動を要約＋次の方向性を示す
    function getAnalysis() {
      const STJP = D.STATUS_JP;
      function one(side) {
        const u = stat(side), s = stats[side], n = s.distN || 1;
        const hitRate = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
        const atk = s.ranged + s.melee, atkRatio = Math.round((atk / n) * 100);
        const near = Math.round((s.near / n) * 100), mid = Math.round((s.mid / n) * 100), far = Math.round((s.far / n) * 100);
        const wpnMix = s.ranged + s.melee === 0 ? "—" : s.ranged > s.melee * 2 ? "遠距離主体" : s.melee > s.ranged * 2 ? "接近戦主体" : "遠近を併用";
        const won = !!result && result.type === "win" && (result.winner === u.side);
        const statusSummary = Object.keys(s.statusOut).map((t) => `${STJP[t] || t}×${s.statusOut[t]}`).join("・");
        const rangeName = near >= mid && near >= far ? "近距離" : far >= mid && far >= near ? "遠距離" : "中距離";
        const notes = [], advice = [];
        notes.push(`主に${rangeName}で渡り合った（近${near}／中${mid}／遠${far}％）`);
        notes.push(atkRatio < 35 ? `守勢が中心（攻撃に出たのは${atkRatio}％）` : atkRatio > 62 ? `終始攻め続けた（攻撃${atkRatio}％）` : `攻守のバランス型（攻撃${atkRatio}％）`);
        if (s.shots >= 6) notes.push(hitRate >= 68 ? `命中が安定（${hitRate}％）` : hitRate <= 42 ? `命中が不安定（${hitRate}％）＝手数の割に通らず` : `命中率${hitRate}％`);
        notes.push(`${wpnMix}（与ダメ${s.dmgDealt}／被ダメ${s.dmgTaken}）`);
        if (statusSummary) notes.push(`状態異常を継続的に与えた（${statusSummary}）`);
        if (s.guile >= 4) notes.push(`揺さぶり・駆け引きを多用（${s.guile}回）`);
        if (s.empties > 0) notes.push(`弾切れを起こす場面があった（${s.empties}回）`);
        if (s.biggest > 0) notes.push(`最大の一撃は${s.biggestTurn}ターン目の −${s.biggest}`);
        // 次の方向性（パラメータ名は出さず、人格をどちらへ寄せるかだけ示唆）
        const rangedWpn = u.winDist > 25;
        if (won) {
          advice.push("この方針は機能した。さらに長所を尖らせる余地がある。");
          if (s.dmgTaken > u.maxHp * 0.6) advice.push("被弾はやや多め——守りを少し厚くすると安定するかも。");
        } else {
          if (atkRatio < 35 && s.dmgDealt < s.dmgTaken) advice.push("守勢に寄りすぎた——もっと攻めへ振ると展開が動くかも。");
          if (s.dmgTaken > u.maxHp * 0.7) advice.push("被弾が多い——慎重さ・間合い管理を上げて被弾を減らしたい。");
          if (rangedWpn && near > far) advice.push("遠武器なのに近づかれた——距離を保つ人格にすると武器が活きる。");
          if (!rangedWpn && far > near) advice.push("近接武器なのに距離が空いた——接近重視に寄せたい。");
          if (hitRate <= 42 && s.shots >= 6) advice.push("当たらない——当てる間合い/タイミングを選ぶ慎重さを。");
          if (s.empties > 0) advice.push("弾の管理（撃ち急がない）を見直すと良い。");
          if (!advice.length) advice.push("僅差の負け——細部の詰めで勝てる位置にいる。");
        }
        return { name: u.name, side: u.side, hp: `${u.hp}/${u.maxHp}`, weapon: `${u.ranged.name}＋${u.melee.name}`, hitRate, dmgDealt: s.dmgDealt, dmgTaken: s.dmgTaken, crits: s.crits, atkRatio, avgDist: Math.round(s.distSum / n), near, mid, far, wpnMix, status: statusSummary, guile: s.guile, biggest: s.biggest, biggestTurn: s.biggestTurn, notes, advice, won };
      }
      return { turns: turn, arena: arena.name, over, result, plr: one("p"), cpu: one("c") };
    }

    function step() {
      if (over) return { turn, lines: [], dist: displayDist(), over, result };
      turn++;
      const pre = snapshot(), hpP0 = plr.hp, hpC0 = cpu.hp;
      const preBucket = Math.round(Math.round(clamp((dist(pre.p, pre.c) / maxDist) * 100, 0, 100)) / 10) * 10;
      const preDist = dist(pre.p, pre.c);
      const pStun = plr.stun > 0, cStun = cpu.stun > 0;
      const decP = pStun ? stunnedDecision("p") : decide("p"), decC = cStun ? stunnedDecision("c") : decide("c"); // 同時決定（麻痺中は硬直）
      const dd0 = dist(plr, cpu); // D4狡猾：状況に合った小ズルのみ発動
      const geP = guileEvents("p", { foeAttacks: decC.cand.attack, selfAttacks: decP.cand.attack, foeReads: cpu.cog.oppModelWeight, dist: dd0 });
      const geC = guileEvents("c", { foeAttacks: decP.cand.attack, selfAttacks: decC.cand.attack, foeReads: plr.cog.oppModelWeight, dist: dd0 });
      moveUnit("p", decP.cand); moveUnit("c", decC.cand);   // 同時移動
      if (geP.bait) baitNudge(plr, cpu); if (geC.bait) baitNudge(cpu, plr); // 誘い込み：間合いを少し操作
      const edgeP = 1 + (geP.exploit ? 0.12 : 0) + (geP.outwit ? 0.1 : 0), edgeC = 1 + (geC.exploit ? 0.12 : 0) + (geC.outwit ? 0.1 : 0);
      const evP = resolveAttack("p", decP.cand, geC.feint, edgeP), evC = resolveAttack("c", decC.cand, geP.feint, edgeC); // 同時解決（揺さぶりで命中↓／隙突き・出し抜きで↑）
      cpu.hp = Math.max(0, cpu.hp - (evP.dmg || 0));         // 同時にダメージ適用（相討ちあり）
      plr.hp = Math.max(0, plr.hp - (evC.dmg || 0));
      if (evP.kb) knockback(plr, cpu);
      if (evC.kb) knockback(cpu, plr);
      // 状態異常：今ターンの命中で付与（麻痺は確率で発動）→ DoTをtick（結果行に反映）
      if (evP.applyStatus) evP.statusType = addStatus(cpu, evP.applyStatus);
      if (evC.applyStatus) evC.statusType = addStatus(plr, evC.applyStatus);
      const tkP = tickStatuses(plr), tkC = tickStatuses(cpu);
      plr.hp = Math.max(0, plr.hp - tkP.dmg); cpu.hp = Math.max(0, cpu.hp - tkC.dmg);
      if (pStun) plr.stun = Math.max(0, plr.stun - 1); // 今ターン硬直した分を消費
      if (cStun) cpu.stun = Math.max(0, cpu.stun - 1);
      noDamageTurns = (evP.dmg || 0) + (evC.dmg || 0) + tkP.dmg + tkC.dmg > 0 ? 0 : noDamageTurns + 1; // アンチストール
      const mvForCpu = geP.disinfo ? falseMove(decP.cand.move) : decP.cand.move, mvForPlr = geC.disinfo ? falseMove(decC.cand.move) : decC.cand.move; // 撹乱：相手モデルへ偽情報
      cpu.oppModel.recent.push(mvForCpu); if (cpu.oppModel.recent.length > 8) cpu.oppModel.recent.shift();
      plr.oppModel.recent.push(mvForPlr); if (plr.oppModel.recent.length > 8) plr.oppModel.recent.shift();
      if (evP.dmg > 0) cpu.hurtAt[preBucket] = (cpu.hurtAt[preBucket] || 0) + evP.dmg;
      if (evC.dmg > 0) plr.hurtAt[preBucket] = (plr.hurtAt[preBucket] || 0) + evC.dmg;
      recordStats("p", decP, evP, geP, (evC.dmg || 0) + tkP.dmg, preDist);
      recordStats("c", decC, evC, geC, (evP.dmg || 0) + tkC.dmg, preDist);
      stats.p.hpSeries.push(plr.hp); stats.c.hpSeries.push(cpu.hp);
      const lines = narrateTurn(pre, decP, evP, decC, evC, hpP0, hpC0, geP, geC);
      if (tkP.dmg > 0) lines.push({ text: `　　＊PLR(${plr.name}) ${tkP.types.map((t) => D.STATUS_JP[t]).join("・")}で −${tkP.dmg}${plr.hp <= 0 ? "（戦闘不能）" : ""}`, cls: "plr" });
      if (tkC.dmg > 0) lines.push({ text: `　　＊CPU(${cpu.name}) ${tkC.types.map((t) => D.STATUS_JP[t]).join("・")}で −${tkC.dmg}${cpu.hp <= 0 ? "（戦闘不能）" : ""}`, cls: "cpu" });
      result = finishCheck();
      if (result) { over = true; for (const fl of finishNarration(result)) lines.push(fl); }
      return { turn, lines, dist: displayDist(), over, result };
    }

    return { step, getAnalysis, get turn() { return turn; }, get over() { return over; }, get result() { return result; }, get plr() { return plr; }, get cpu() { return cpu; }, get arena() { return { name: arena.name, flavor: arena.flavor }; }, displayDist, losClear, obstacles, field, maxDist };
  };
})();
