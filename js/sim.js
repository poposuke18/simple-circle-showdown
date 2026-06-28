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
  const FACTOR_JP = { hp: "HP収支", trade: "トレード収支", engage: "射撃好機", winRange: "勝てる間合い", threat: "脅威回避", cover: "遮蔽優位", terrain: "地形利用", pos: "位置取り", kill: "仕留め", danger: "自己保存", tempo: "テンポ", avoid: "危険距離回避", hazard: "危険地帯回避", flank: "側背面取り", exposed: "背後警戒" };

  SCS.makeBattle = function (plrUnit, cpuUnit, seed, arenaName, modName) {
    const D = SCS.DATA, S = D.SIM, T = D.TERRAIN, rng = SCS.makeRNG(seed);

    // --- 戦場の選択（ランダム or 指定） ---
    let arena;
    if (arenaName && arenaName !== "ランダム") arena = D.ARENAS.find((a) => a.name === arenaName) || D.ARENAS[0];
    else arena = D.ARENAS[SCS.makeRNG((seed ^ 0x5bd1e995) >>> 0).int(D.ARENAS.length)];
    // --- 戦況モディファイア（毎戦のルール変化。ランダム＝重み付き or 指定）---
    let mod;
    if (modName && modName !== "ランダム") mod = D.MODIFIERS.find((m) => m.name === modName) || D.MODIFIERS[0];
    else { const mr = SCS.makeRNG((seed ^ 0x27d4eb2f) >>> 0); let tot = 0; D.MODIFIERS.forEach((m) => (tot += m.weight || 1)); let r = mr.next() * tot; mod = D.MODIFIERS.find((m) => (r -= m.weight || 1) < 0) || D.MODIFIERS[0]; }
    const modAcc = mod.acc || 1, modSta = mod.staMul || 1, modCrit = mod.crit || 0; // 命中/気力消費/会心への作用
    const field = { w: arena.w, h: arena.h }, baseTerrain = T[arena.base];
    const obstacles = arena.obstacles.map((o) => ({ ...o, hp: 70 })); // ★遮蔽はHPを持ち、撃ち込みで崩れる（戦場が試合中に変化）。共有DATAは複製して非破壊
    const hazards = []; // ★動的ハザード（燃え広がる炎）{ x, y, w, h, turns, dmg }
    const maxDist = Math.hypot(arena.w, arena.h), turnCap = S.turnCap;

    function initUnit(u, side, start) { return Object.assign(u, { side, x: start.x, y: start.y, faceX: side === "PLR" ? 1 : -1, faceY: 0, speed: 0.5 + u.micros.B5 * 0.5 + u.micros.B3 * 0.2, oppModel: { recent: [] }, hurtAt: {}, plan: null, planPressure: 0, ammo: u.ranged.mag, reloadLeft: 0, charged: false, spread: 0, windLeft: 0, statuses: [], stun: 0, stamina: 1, momentum: 0, oppProfile: { atk: 0, adv: 0, dist: 0, dodge: 0, guard: 0, n: 0 }, strategy: null, stratPressure: 0, flinch: 0, opening: 0, secondWind: 0, swUsed: false, resolve: 0, combo: 0 }); }
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
    // 気力(スタミナ0..1)＝攻め続けると消耗し攻撃出力・機動が落ちる。流れ(モメンタム-1..1)＝勢いで攻撃出力が微増減。
    // ★決定論：これらは実ユニットの状態を読むだけ（先読みでは現在値を定数として扱う＝乱数非消費）
    const outFac = (u) => (0.7 + 0.3 * clamp(u.stamina, 0, 1)) * (1 + clamp(u.momentum, -1, 1) * 0.07) * (u.flinch > 0 ? 0.7 : 1) * (u.secondWind > 0 ? 1.3 : 1); // 攻撃出力倍率（気力/流れ/怯み/火事場）
    function dmgMod() { let m = mod.dmgMul || 1; if (mod.sudden && turn >= 12) m *= 1 + (turn - 12) * 0.07; return m; } // 戦況モディファイア：全ダメージ倍率（サドンデス＝終盤ほど増）
    function tickStatuses(u) { let dmg = 0; const types = []; for (const s of u.statuses) { if (s.dmg) { dmg += s.dmg; types.push(s.type); } s.turns--; } u.statuses = u.statuses.filter((s) => s.turns > 0); return { dmg, types }; }

    // ===== 戦闘統計（分析フィードバック用・パラメータは見せず挙動の結果で語る）=====
    const mkStat = () => ({ shots: 0, hits: 0, crits: 0, dmgDealt: 0, dmgTaken: 0, ranged: 0, melee: 0, reloads: 0, empties: 0, statusOut: {}, mv: {}, near: 0, mid: 0, far: 0, distSum: 0, distN: 0, guile: 0, biggest: 0, biggestTurn: 0, firstHit: 0, hpSeries: [], dodges: 0, counters: 0, winded: 0, strat: {}, charges: 0, guards: 0, grabs: 0, grabFails: 0, flankSide: 0, flankRear: 0, ults: 0, corners: 0, envThrows: 0, maxCombo: 0, punishes: 0, openSeen: 0, openTaken: 0, wasFlanked: 0, ultIdle: 0, gaveOpening: 0, resPeak: 0 });
    const stats = { p: mkStat(), c: mkStat() };

    const losClear = (a, b) => !obstacles.some((r) => r.hp > 0 && segIntersectsRect(a, b, r));
    const blockingObstacle = (a, b) => obstacles.find((r) => r.hp > 0 && segIntersectsRect(a, b, r)); // 射線を遮る遮蔽（崩す対象）
    function hazardAt(p) { let d = 0; for (const h of hazards) if (h.turns > 0 && ptInRect(p, h)) d += h.dmg; return d; } // 立っている地点の炎ダメージ
    const displayDist = () => Math.round(clamp((dist(plr, cpu) / maxDist) * 100, 0, 100));
    const cx = (x) => clamp(x, 0, field.w), cy = (y) => clamp(y, 0, field.h);
    // 障害物との当たり判定：遮蔽の中に入れない（一番近い辺へ押し出す）＝壁抜け防止。回り込みが物理的に必要になる
    function pushOutObstacle(x, y) {
      for (const o of obstacles) {
        if (o.hp <= 0) continue;
        if (x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h) {
          const dl = x - o.x, dr = o.x + o.w - x, dt = y - o.y, db = o.y + o.h - y, m = Math.min(dl, dr, dt, db);
          if (m === dl) x = o.x - 0.02; else if (m === dr) x = o.x + o.w + 0.02; else if (m === dt) y = o.y - 0.02; else y = o.y + o.h + 0.02;
        }
      }
      return { x: cx(x), y: cy(y) };
    }
    const clampUnit = (u) => { const q = pushOutObstacle(u.x, u.y); u.x = q.x; u.y = q.y; };
    function terrainAt(p) { for (const z of arena.terrain) if (ptInRect(p, z)) return T[z.t]; return baseTerrain; }
    const terrainDmg = (p) => terrainAt(p).dmg || 0; // 溶岩など、立つと毎ターン被弾する地形
    const stepLen = (u, p) => S.baseStep * (0.6 + 0.8 * u.micros.B5) * terrainAt(p).move * slowOf(u) * (0.78 + 0.22 * clamp(u.stamina, 0, 1)); // 息切れで足が止まる

    function shotsFor(r, g) { let n = Math.floor(r); if (g.chance(r - n)) n++; return n; }
    function nearestObstacle(p) { let best = null, bd = Infinity; for (const r of obstacles) { if (r.hp <= 0) continue; const ox = r.x + r.w / 2, oy = r.y + r.h / 2, d = Math.hypot(ox - p.x, oy - p.y); if (d < bd) { bd = d; best = { x: ox, y: oy }; } } return best; }
    function applyMove(sp, self, fp, move) {
      const st = stepLen(self, sp), dx = fp.x - sp.x, dy = fp.y - sp.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      let nx = sp.x, ny = sp.y;
      if (move === "ADVANCE") { nx += ux * st; ny += uy * st; }
      else if (move === "RETREAT") { nx -= ux * st; ny -= uy * st; }
      else if (move === "STRAFE_L") { nx += -uy * st; ny += ux * st; }
      else if (move === "STRAFE_R") { nx += uy * st; ny += -ux * st; }
      else if (move === "COVER") { const o = nearestObstacle(sp); if (o) { const ox = o.x - sp.x, oy = o.y - sp.y, ol = Math.hypot(ox, oy) || 1; nx += (ox / ol) * st; ny += (oy / ol) * st; } }
      return pushOutObstacle(nx, ny); // 障害物の中で止まらない（押し出し）
    }

    // 命中・期待ダメージ（地形：防御側の回避/被ダメ減・攻撃側の高所命中）
    function rangedHit(w, atkPos, defPos, foeS, d, los, moved) {
      if (!los) return 0;
      const rf = d <= w.effRange ? 1 : Math.max(0, 1 - (d - w.effRange) / w.falloff);
      const ev = Math.min(0.7, foeS.micros.B3 * 0.4);
      let h = w.accuracy * rf * (1 - ev) * (moved ? w.moveAccuracy : 1);
      h *= 1 - terrainAt(defPos).avoid; h *= 1 + terrainAt(atkPos).aim; h *= modAcc;
      return clamp(h, 0, 1);
    }
    const meleeHit = (foeS, defPos) => clamp(0.9 * (1 - Math.min(0.6, foeS.micros.B3 * 0.4) * 0.7) * (1 - terrainAt(defPos).avoid) * modAcc, 0, 1);
    const defMult = (defPos) => 1 - terrainAt(defPos).def;
    // ===== Wave5：側背面（フランク）＝相手の向きに対しどこから攻めたか。背後は防御を貫く =====
    // facing は毎ターン開始時に相手を向く（step冒頭で設定）。攻め手が相手の正面/側面/背後どこにいるかで補正
    function flankOf(att, def) {
      const dx = att.x - def.x, dy = att.y - def.y, l = Math.hypot(dx, dy) || 1, dot = (def.faceX * dx + def.faceY * dy) / l; // 1=正面, 0=真横, -1=真後ろ
      if (dot > 0.45) return { tier: "front", acc: 1, crit: 0, dmg: 1, defMul: 1 };
      if (dot > -0.35) return { tier: "side", acc: 1.07, crit: 0.04, dmg: 1.03, defMul: 0.72 }; // 側面：やや有利・回避/受けを削ぐ
      return { tier: "rear", acc: 1.16, crit: 0.10, dmg: 1.10, defMul: 0.45 };                  // 背後：大きく有利・防御をほぼ貫く
    }
    // ===== Wave5：崩し（GRAB/投げ）＝受け不能。ガード・棒立ちに通るが、攻撃を合わされると潰れる =====
    function grabDamage(u) { return Math.round((9 + u.micros.A6 * 9 + u.micros.A2 * 6) * outFac(u)); } // 投げの威力（受け無視）
    const grabReachOK = (att, def) => dist(att, def) <= att.melee.reach + 3; // 組み付きが届く間合い
    // ===== Wave6：壁際の追い込み＝逃げ場が無く回避が効かない／必殺＝気迫を解き放つ一撃必殺 =====
    const cornered = (u) => Math.min(u.x, field.w - u.x, u.y, field.h - u.y) < 7; // 場の端7以内＝追い詰められ
    const ULT_NAME = { precise: "零距離の一射", auto: "弾幕の嵐", shotgun: "至近の一掃", flame: "業火の渦", mlt: "嵐の連撃", hvy: "全霊の一撃", bal: "会心の一閃" };
    function expEx(atk, def, atkPos, defPos, d, los) {
      let dmg = 0;
      if (los) dmg += atk.ranged.fireRate * rangedHit(atk.ranged, atkPos, defPos, def, d, los, false) * atk.ranged.damage * defMult(defPos);
      if (d <= atk.melee.reach) dmg += atk.melee.rate * meleeHit(def, defPos) * atk.melee.damage * defMult(defPos);
      return dmg * outFac(atk); // 気力・流れで実効出力が変わる
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
    function baitNudge(self, foe) { const dx = foe.x - self.x, dy = foe.y - self.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, step = clamp(self.prefRange - len, -3, 3); foe.x = cx(self.x + ux * (len + step)); foe.y = cy(self.y + uy * (len + step)); clampUnit(foe); }
    function guilePrefix(ge) { const p = []; if (ge.feint) p.push("牽制で揺さぶり"); if (ge.exploit) p.push("相手の隙を突き"); if (ge.bait) p.push("誘い込み"); if (ge.disinfo) p.push("気配を断ち"); if (ge.outwit) p.push("機先を制し"); return p.length ? p.slice(0, 2).join("、") + "、" : ""; }

    function genCandidates(state, side) {
      const self = stat(side), fp = state[other(side)], sp = state[side], out = [];
      const hasCover = obstacles.some((o) => o.hp > 0); // 遮蔽が無い戦場ではCOVER行動を出さない（「遮蔽の陰へ」誤描写を防ぐ）
      for (const move of MOVES) {
        if (move === "COVER" && (!hasCover || noDamageTurns >= 3)) continue; // 膠着中は遮蔽に隠れない（自分の射線を自分で塞ぐ愚を防ぐ）
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
      if (cand.attack === "RANGED" && cand.los2) ns[fo].hp = Math.max(0, ns[fo].hp - self.ranged.fireRate * rangedHit(self.ranged, cand.newPos, fp, foe, cand.d2, true, cand.moved) * self.ranged.damage * defMult(fp) * outFac(self));
      else if (cand.attack === "MELEE" && cand.d2 <= self.melee.reach) ns[fo].hp = Math.max(0, ns[fo].hp - self.melee.rate * meleeHit(foe, fp) * self.melee.damage * defMult(fp) * outFac(self));
      return ns;
    }
    function applyStochastic(state, side, cand, g) {
      const ns = { p: { ...state.p }, c: { ...state.c } }, fo = other(side), self = stat(side), foe = stat(fo), fp = { x: state[fo].x, y: state[fo].y }, of = outFac(self);
      ns[side].x = cand.newPos.x; ns[side].y = cand.newPos.y;
      if (cand.attack === "RANGED" && cand.los2) { const hc = rangedHit(self.ranged, cand.newPos, fp, foe, cand.d2, true, cand.moved); let dmg = 0; for (let i = 0; i < shotsFor(self.ranged.fireRate, g); i++) if (g.chance(hc)) dmg += self.ranged.damage * defMult(fp) * of; ns[fo].hp = Math.max(0, ns[fo].hp - dmg); }
      else if (cand.attack === "MELEE" && cand.d2 <= self.melee.reach) { const hc = meleeHit(foe, fp); let dmg = 0; for (let i = 0; i < shotsFor(self.melee.rate, g); i++) if (g.chance(hc)) dmg += self.melee.damage * defMult(fp) * of; ns[fo].hp = Math.max(0, ns[fo].hp - dmg); }
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
      // 側背面：自分が相手の背を取れているか／自分の背が晒されているか（facingは今ターンの向き）
      const dd = d || 1, flankMine = -((foe.faceX * (sp.x - fp.x) + foe.faceY * (sp.y - fp.y)) / dd); // 正→相手の側背面に回れている
      const flankFoe = -((self.faceX * (fp.x - sp.x) + self.faceY * (fp.y - sp.y)) / dd); // 正→相手が自分の側背面にいる（被フランク）
      const f = {
        hp: shpf - fhpf, trade: clamp((myE - foeE) / 40, -1, 1), engage: clamp(myE / 40, 0, 1),
        winRange: 1 - clamp(Math.abs(d - self.prefRange) / (55 - m.B4 * 25), 0, 1.4),
        threat: -clamp(foeE / 40, 0, 1) * perc, cover: !los ? clamp((foeOpen - myOpen) / 30, 0, 1) : 0,
        terrain: clamp(tr.def + Math.max(0, tr.avoid) - (tr.move < 1 ? (1 - tr.move) * 0.4 : 0) + tr.aim * 0.6, -0.5, 0.8),
        pos: clamp(margin / 12, 0, 1) * 2 - 1,
        kill: fhpf < 0.3 ? (0.3 - fhpf) / 0.3 : 0, danger: shpf < 0.35 ? -(0.35 - shpf) / 0.35 : 0,
        tempo: turnsLeft < 8 && shpf - fhpf < -0.05 ? -0.6 : 0, avoid: dz != null && Math.abs(d - dz) < 15 ? -1 : 0,
        hazard: -clamp((hazardAt(sp) + (terrainAt(sp).dmg || 0)) / 8, 0, 1.2), // 炎/溶岩の中＝危険、避ける
        flank: d <= 30 ? clamp(flankMine, -0.3, 1) : 0, exposed: d <= 30 ? -clamp(flankFoe, -0.3, 1) : 0, // 近間でのみ意味を持つ
      };
      const tilt = shpf < 0.4 ? (1 - self.cog.evalStability) * 0.6 : 0;
      const desp = shpf < 0.3 ? m.C6 : 0; // C6 背水：瀕死で恐怖↓・攻め↑
      const w = {
        hp: 1.0, trade: 0.4 + m.C2 * 0.6, engage: 0.25 + m.A2 * 0.3 + m.A6 * 0.2 + desp * 0.4, winRange: 0.55 + m.A3 * 0.2 + m.B2 * 0.2,
        threat: (0.3 + m.C1 * 0.5) * (1 + tilt) * (1 - desp * 0.6), cover: 0.15 + m.B1 * 0.6 + m.D5 * 0.2, terrain: 0.2 + m.B1 * 0.4 + m.D5 * 0.4,
        pos: 0.1 + m.B6 * 0.3 + m.D5 * 0.2, kill: 0.4 + m.A6 * 0.5 + m.C3 * 0.4, danger: 0.5 * (1 + tilt) * (1 - desp * 0.7), tempo: 0.3, avoid: self.cog.learning * 0.5, hazard: 0.8,
        flank: 0.2 + m.B5 * 0.3 + m.B6 * 0.2 + m.D5 * 0.3, exposed: 0.25 + m.C1 * 0.3 + perc * 0.1, // 回り込みで側背面を取る／背後を晒さない
      };
      const lead = shpf - fhpf, late = turnsLeft < 12; // D4 時間の駆け引き
      if (late && lead > 0.05) w.threat *= 1 + m.D4 * 0.5;  // 有利→逃げ切り上手（脅威回避↑）
      if (late && lead < -0.05) w.engage += m.D4 * 0.3;     // 不利→急かし上手（攻め↑）
      // 戦略レイヤー：複数ターンの方針で評価重み・狙う間合いが傾く（Wave2）
      const sm = self.strategy;
      if (sm) {
        let prefT = self.prefRange;
        if (sm === "RUSHDOWN") { prefT = Math.max(self.melee.reach * 0.8, self.prefRange - 12); w.engage += 0.28; w.kill += 0.15; w.threat *= 0.72; w.danger *= 0.78; }
        else if (sm === "KITE") { prefT = self.prefRange + 7; w.winRange += 0.22; w.threat += 0.15; }
        else if (sm === "COUNTER") { w.threat += 0.2; w.engage *= 0.88; w.danger += 0.08; }
        else if (sm === "ZONE") { prefT = self.prefRange + 3; w.cover += 0.2; w.terrain += 0.2; w.pos += 0.2; }
        else if (sm === "ATTRITION") { w.threat += 0.12; w.trade += 0.14; w.engage *= 0.9; }
        if (prefT !== self.prefRange) f.winRange = 1 - clamp(Math.abs(d - prefT) / (55 - m.B4 * 25), 0, 1.4);
      }
      // アンチストールは戦略より後＝最優先（守り戦略/受け回避が増えても膠着・時間切れを防ぐ）
      const stall = Math.min(1, noDamageTurns / 3);
      if (stall > 0) {
        w.engage += stall * 0.9; w.winRange += stall * 0.4; w.threat *= 1 - stall * 0.7; w.cover *= 1 - stall * 0.7; w.terrain *= 1 - stall * 0.6; w.danger *= 1 - stall * 0.4; // 膠着時は茂み/遮蔽に居座らず交戦へ
        const pT = Math.max(self.melee.reach, self.prefRange - stall * 30); // 膠着が深いほど近接へ寄せて強制接触
        f.winRange = 1 - clamp(Math.abs(d - pT) / (55 - m.B4 * 25), 0, 1.4);
        if (!los && d > self.melee.reach) f.engage = Math.min(f.engage, -0.5 * stall); // 射線も通らず近接も届かない位置（自分の遮蔽裏で撃てない等）＝膠着の元、強く避け射線を取りに動く
      }
      if (mod.ring && turn >= 5) w.pos += 0.7; // 戦況「狭まる戦場」＝中央を死守する
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
    // ===== Wave2：思考レイヤー（戦略・相手の性格推定・リスク評価）=====
    function inferOppStyle(u) { const p = u.oppProfile, n = p.n || 1; return { aggression: clamp((p.atk + p.adv * 0.6) / n, 0, 1), avgDist: p.dist / n, dodgy: p.dodge / n > 0.18, guardProne: clamp((p.guard || 0) / n, 0, 1), sampled: p.n >= 3 }; }
    const STRAT_JP = { RUSHDOWN: "速攻", KITE: "カイト", COUNTER: "カウンター狙い", ZONE: "制圧", BAIT: "誘い出し", ATTRITION: "持久" };
    function strategyScores(self, lead) {
      const m = self.micros, close = self.winDist <= 25, far = self.winDist >= 45, opp = inferOppStyle(self), adapt = self.cog.oppModelWeight > 0.45 || m.D2 > 0.6;
      const sc = {
        RUSHDOWN: 0.15 + m.A2 * 0.45 + m.A3 * 0.35 + m.C2 * 0.25 + (close ? 0.25 : 0) - m.C1 * 0.3,
        KITE: 0.18 + m.B2 * 0.55 + (far ? 0.35 : 0) + m.B5 * 0.25 + m.A1 * 0.2 - m.A3 * 0.3,
        COUNTER: 0.12 + m.D1 * 0.4 + m.D6 * 0.28 + m.B3 * 0.3 + m.C5 * 0.15 - m.A2 * 0.2,
        ZONE: 0.18 + m.B1 * 0.45 + m.B6 * 0.35 + m.D5 * 0.4 + m.B4 * 0.1,
        BAIT: 0.14 + m.D4 * 0.55 + m.D3 * 0.35 + m.D2 * 0.2,
        ATTRITION: 0.2 + m.C5 * 0.35 + m.B4 * 0.4 + (self.maxHp > 105 ? 0.3 : 0) + m.C1 * 0.2 - m.A2 * 0.35,
      };
      if (adapt && opp.sampled) { // 相手の攻守傾向に合わせて適応（順応/相手読みが高い人格のみ）
        if (opp.aggression > 0.55) { sc.COUNTER += 0.3; sc.KITE += 0.2; sc.RUSHDOWN -= 0.15; }
        else { sc.RUSHDOWN += 0.25; sc.ZONE += 0.2; sc.COUNTER -= 0.15; }
      }
      if (lead < -0.12) { sc.RUSHDOWN += 0.2; sc.BAIT += 0.15; }       // 負け→動いて変える
      else if (lead > 0.12) { sc.KITE += 0.2; sc.ATTRITION += 0.2; }   // 勝ち→逃げ切り
      if (self.stamina < 0.4) { sc.ATTRITION += 0.2; sc.RUSHDOWN -= 0.15; } // 息切れ→持久
      return sc;
    }
    function chooseStrategy(self, lead) { // ヒステリシス（順応D2が高いほど乗り換えやすい）
      const sc = strategyScores(self, lead);
      let best = null, bv = -Infinity; for (const k in sc) if (sc[k] > bv) { bv = sc[k]; best = k; }
      if (self.strategy == null) { self.strategy = best; return best; }
      if (best === self.strategy) { self.stratPressure = 0; return best; }
      const margin = 0.12 + (1 - self.micros.D2) * 0.25;
      if (bv > sc[self.strategy] + margin) { self.stratPressure++; if (self.stratPressure >= 2) { self.strategy = best; self.stratPressure = 0; } } else self.stratPressure = 0;
      return self.strategy;
    }
    function candVariance(c, self) { // 行動の分散（高いほど博打）。リスク評価用
      if (c.attack === "MELEE") return self.melee.pattern === "heavy" ? 0.9 : self.melee.pattern === "balanced" ? 0.5 : 0.25;
      if (c.attack === "RANGED") { const rw = self.ranged; return rw.mode === "charge" ? 0.85 : rw.key === "shotgun" ? 0.7 : rw.fireRate >= 6 ? 0.2 : 0.45; }
      if (c.attack === "ULT") return 0.85;   // 必殺＝気迫を懸けた一撃
      if (c.attack === "CHARGE") return 0.8; // 突進＝コミットの賭け
      if (c.attack === "GRAB") return 0.6;   // 崩し＝読み勝てば刺さる賭け
      if (c.attack === "DODGE") return 0.5;
      return 0.1;
    }
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
      return { cand: { ...best, attack: "RELOAD" }, reason: "弾込め", predFoe: null, depth: self.cog.searchDepth, mc: 0, plan: "リロード", second: null, readFoe: null, strat: self.strategy, stratChanged: false, gamble: false };
    }
    function decide(side) {
      const fo = other(side), self = stat(side), foe = stat(fo), cog = self.cog, s0 = snapshot();
      const ammoFrac = self.ammo / self.ranged.mag, caution = clamp((1 - self.micros.C2) * 0.40, 0, 0.45); // リスク低=早めに装填／博打打ちは弾切れまで撃つ
      if (self.reloadLeft > 0 || self.ammo === 0 || (ammoFrac < caution && (expEx(foe, self, { x: foe.x, y: foe.y }, { x: self.x, y: self.y }, dist(self, foe), losClear(self, foe)) < 12 || !losClear(self, foe)))) return reloadDecision(side);
      const lead = self.hp / self.maxHp - foe.hp / foe.maxHp;
      const oldStrat = self.strategy, strat = chooseStrategy(self, lead), stratChanged = oldStrat != null && oldStrat !== strat; // Wave2：戦略を選ぶ（評価重みに反映）
      const riskAppetite = (self.micros.C2 - 0.5) * 0.5 + (lead < -0.1 ? 0.25 : lead > 0.1 ? -0.2 : 0); // リスク選好＋戦況（負け→博打/勝ち→安全）
      const defDamp = 1 - Math.min(1, noDamageTurns / 4) * 0.7; // 膠着が続くと回避/受けの価値を下げ交戦を促す
      const predist = Math.round(dist(self, foe)), plan = commitPlan(self, foe, predist);
      const learned = predictMove(self), useModel = !!learned && cog.oppModelWeight > 0.5;
      const planW = 0.12 + (1 - self.micros.D2) * 0.18; // 順応低=プラン固執（バイアス強）

      let cands = genCandidates(s0, side);
      for (const c of cands) c.q = evalState(applyExpected(s0, side, c), side);
      cands.sort((a, b) => b.q - a.q);
      cands = cands.slice(0, cog.breadth);
      // 回避(DODGE)を常に候補へ：相手の脅威が高い時のみ価値が出る（B3回避巧者＋気力＋読みD1/D6で反撃EV）
      { const fpos = { x: s0[fo].x, y: s0[fo].y };
        const foeThreatNow = expEx(foe, self, fpos, { x: s0[side].x, y: s0[side].y }, predist, losClear(self, foe)); // 相手の見込み出力
        if (foeThreatNow > 3) { // 脅威がある時だけ回避/受けを候補に（遠間で無意味に守らない＝棒立ちの「受けを固め」乱発を防ぐ）
          const dpos = applyMove(s0[side], self, fpos, "STRAFE_R");
          cands.push({ move: "STRAFE_R", attack: "DODGE", newPos: dpos, moved: true, d2: dist(dpos, fpos), los2: losClear(dpos, fpos) });
          cands.push({ move: "HOLD", attack: "GUARD", newPos: { x: s0[side].x, y: s0[side].y }, moved: false, d2: dist(s0[side], fpos), los2: losClear(s0[side], fpos) });
        }
        const cpos = applyMove(s0[side], self, fpos, "ADVANCE"), cd = dist(cpos, fpos); // 突進＝踏み込んで強打（間合い外→内へ）
        if (predist > self.melee.reach && cd <= self.melee.reach + 3) cands.push({ move: "ADVANCE", attack: "CHARGE", newPos: cpos, moved: true, d2: cd, los2: losClear(cpos, fpos) });
        // 崩し（GRAB/投げ）：至近で組み付く。受け不能でガード/棒立ちに通るが、攻撃を合わされると潰れる
        if (predist <= self.melee.reach + 4 && self.stamina > 0.25) { const gp = applyMove(s0[side], self, fpos, "ADVANCE"); cands.push({ move: "ADVANCE", attack: "GRAB", newPos: gp, moved: true, d2: dist(gp, fpos), los2: true }); }
        // 必殺（ULT）：気迫が満ちたら解放可能。近接圏なら近接必殺・射線が通れば射撃必殺
        if ((self.resolve || 0) >= 1) {
          if (predist <= self.melee.reach + 2) { const up = applyMove(s0[side], self, fpos, "ADVANCE"); cands.push({ move: "ADVANCE", attack: "ULT", ultKind: "melee", newPos: up, moved: true, d2: dist(up, fpos), los2: losClear(up, fpos) }); }
          else if (losClear(s0[side], fpos) && self.ammo > 0) cands.push({ move: "HOLD", attack: "ULT", ultKind: "ranged", newPos: { x: s0[side].x, y: s0[side].y }, moved: false, d2: predist, los2: true });
        }
      }

      for (const c of cands) {
        const ns = applyExpected(s0, side, c);
        let v;
        if (c.attack === "DODGE") {
          v = evalState(ns, side);
          const ev2 = clamp(0.45 + self.micros.B3 * 0.35, 0, 0.85) * clamp(self.stamina * 1.4, 0, 1);
          const foeThreat = expEx(foe, self, { x: s0[fo].x, y: s0[fo].y }, c.newPos, c.d2, c.los2); // 相手の見込み出力
          const counterEV = (0.12 + self.micros.D1 * 0.4 + self.micros.D6 * 0.25) * (c.d2 <= self.melee.reach ? self.melee.damage : self.ranged.damage * 0.8) * 0.5;
          v += ((foeThreat * ev2 * 0.6) / self.maxHp + counterEV / foe.maxHp) * defDamp - (1 - self.stamina) * 0.12; // 回避で減らせる被ダメ＋反撃EV−気力不足（膠着時は割引）
        } else if (c.attack === "GUARD") {
          v = evalState(ns, side);
          const foeThreat = expEx(foe, self, { x: s0[fo].x, y: s0[fo].y }, c.newPos, c.d2, c.los2), red = clamp(0.4 + self.micros.C5 * 0.25 + self.micros.B1 * 0.15, 0, 0.7);
          v += (foeThreat * red * 0.6) / self.maxHp * defDamp; // 受けで減らせる被ダメ（膠着時は割引）
        } else if (c.attack === "CHARGE") {
          const hc = meleeHit(foe, { x: s0[fo].x, y: s0[fo].y }), exp = c.d2 <= self.melee.reach ? hc * self.melee.damage * 1.4 * outFac(self) : 0;
          v = evalState(ns, side) + exp / foe.maxHp - (c.d2 > self.melee.reach ? 0.1 : 0); // 踏み込んでの強打EV（届かない見込みは割引）
        } else if (c.attack === "GRAB") {
          // 崩しEV：相手が守り型(ガード/様子見)ほど通る／攻め型には合わされて潰れる。崩しを好む性格(攻撃即決A2・狡猾D4・非情A6)で価値↑
          v = evalState(ns, side);
          const opp = inferOppStyle(self), foeDef = opp.sampled ? Math.max(1 - opp.aggression, opp.guardProne) : 0.45; // 守り/受け偏重ほど高い（投げが通りやすい）
          const foeAggr = opp.sampled ? opp.aggression : 0.5; // 攻め偏重ほど高い（潰されるリスク）
          const want = 0.1 + self.micros.A2 * 0.25 + self.micros.D4 * 0.35 + self.micros.A6 * 0.2 - self.micros.A1 * 0.2;
          const reach = c.d2 <= self.melee.reach + 3 ? 1 : 0.3; // 届かない見込みは割引
          v += ((grabDamage(self) / foe.maxHp) * 1.4 + foeDef * 0.55) * want * reach - foeAggr * 0.5 * (1 - self.micros.C2 * 0.4);
        } else if (c.attack === "ULT") {
          // 必殺EV：大威力。攻め/非情/リスクは即撃ち、規律・慎重は仕留め機会(相手低HP)まで温存
          v = evalState(ns, side);
          const rn = c.ultKind === "ranged", w = rn ? self.ranged : self.melee, reachOK = rn ? c.los2 : c.d2 <= self.melee.reach + 2;
          const killOpp = foe.hp / foe.maxHp < 0.45 ? 0.5 : 0, eager = self.micros.A2 * 0.3 + self.micros.A6 * 0.3 + self.micros.C2 * 0.2;
          v += ((w.damage * (rn ? 2.0 : 1.9)) / foe.maxHp * 1.5 + killOpp + eager * 0.4) * (reachOK ? 1 : 0.15);
          if (foe.hp / foe.maxHp >= 0.45) v -= self.micros.B4 * 0.3 + self.micros.A1 * 0.15; // 規律・慎重は温存
        } else if (cog.searchDepth <= 1) v = evalState(ns, side);
        else { const reply = useModel ? bestCandWithMove(ns, fo, learned) : greedyBest(ns, fo); v = valueOf(reply.ns, side, cog.searchDepth - 2, side); }
        if (cog.mcSamples > 0 && c.attack !== "DODGE" && c.attack !== "GUARD" && c.attack !== "CHARGE" && c.attack !== "GRAB" && c.attack !== "ULT") { let sum = 0; for (let r = 0; r < cog.mcSamples; r++) { const think = SCS.makeRNG(((seed >>> 0) ^ (turn * 131) ^ (side === "p" ? 1 : 2) ^ ((cands.indexOf(c) + 1) * 977) ^ (r * 13)) >>> 0); sum += rollout(ns, fo, think, cog.searchDepth * 2, side); } v = v * 0.4 + (sum / cog.mcSamples) * 0.6; }
        v += planW * planBias(c, plan, self, predist);
        if (c.attack === "RANGED" && c.los2) { const hc = rangedHit(self.ranged, c.newPos, { x: s0[fo].x, y: s0[fo].y }, foe, c.d2, true, c.moved); const gate = clamp(self.micros.A5 * 0.6 - self.micros.A4 * 0.4, 0, 0.45); if (hc < gate) v -= (gate - hc) * 0.7; } // A5/A4: 命中見込み低なら撃たない/とにかく撃つ
        const isAtkType = c.attack === "MELEE" || c.attack === "RANGED" || c.attack === "CHARGE" || c.attack === "GRAB" || c.attack === "ULT";
        if (self.charged && c.attack === "RANGED") v += 0.55; // 溜めた一撃は撃ち切る（チャージのコミット＝「次の一射に懸ける」を反故にしない）
        if (foe.opening > 0 && isAtkType) v += 0.28; // 相手の空振りの隙を咎める＝確定反撃の好機
        if ((self.combo || 0) > 0 && isAtkType) v += Math.min(self.combo, 4) * 0.05; // 畳みかけ：流れを切らさず攻め続ける
        v += riskAppetite * candVariance(c, self) * 0.5; // Wave2 リスク/EV：博打を好む/避ける（性格×戦況）
        v += rng.range(-cog.explorationTemp, cog.explorationTemp);
        c.v = v; c.ns = ns;
      }
      cands.sort((a, b) => b.v - a.v);
      const best = cands[0], second = cands[1] ? cands[1].move : null;
      let predFoe = useModel ? learned : null;
      if (!predFoe && cog.searchDepth >= 2 && best.ns.p.hp > 0 && best.ns.c.hp > 0) predFoe = greedyBest(best.ns, fo).c.move;
      return { cand: best, reason: dominantFactor(best.ns, side), predFoe, depth: cog.searchDepth, mc: cog.mcSamples, plan, second, readFoe: useModel ? learned : null, strat, stratChanged, gamble: candVariance(best, self) > 0.6 && riskAppetite > 0.12 };
    }

    function moveUnit(side, cand) { const s = stat(side); s.x = cand.newPos.x; s.y = cand.newPos.y; }
    function knockback(att, tgt) { const dx = tgt.x - att.x, dy = tgt.y - att.y, len = Math.hypot(dx, dy) || 1; tgt.x = cx(tgt.x + (dx / len) * att.melee.knockback); tgt.y = cy(tgt.y + (dy / len) * att.melee.knockback); clampUnit(tgt); }
    // 崩しが通った：受け不能の投げ。ダメージ＋叩きつけ（引き離し）＋怯み・隙・気力削り
    function applyThrow(att, tgt, ev) {
      const dmg = Math.round(grabDamage(att) * vulnOf(tgt) * dmgMod());
      tgt.hp = Math.max(0, tgt.hp - dmg);
      ev.grabHit = true; ev.dmg = (ev.dmg || 0) + dmg;
      const dx = tgt.x - att.x, dy = tgt.y - att.y, len = Math.hypot(dx, dy) || 1, thr = 7;
      tgt.x = cx(tgt.x + (dx / len) * thr); tgt.y = cy(tgt.y + (dy / len) * thr); clampUnit(tgt);
      // 環境叩きつけ：投げ先が溶岩/炎なら焼き込み、壁際なら叩きつけで追加ダメージ
      let bonus = 0;
      if (terrainDmg(tgt) > 0 || hazardAt(tgt) > 0) { bonus = 6; ev.envThrow = true; }
      else if (cornered(tgt)) { bonus = 4; ev.wallThrow = true; }
      if (bonus) { const b2 = Math.round(bonus * dmgMod()); tgt.hp = Math.max(0, tgt.hp - b2); ev.dmg += b2; }
      tgt.flinch = 1; tgt.opening = 1; tgt.stamina = clamp(tgt.stamina - 0.18, 0, 1);
      return ev.dmg;
    }
    // 気迫ゲージ：与/被ダメ・背水で蓄積（攻め/非情/リスクで速い）。満タンで必殺を解放できる
    function resolveGain(side, dealt, taken) {
      const u = stat(side), m = u.micros;
      if (u.hp <= 0) return;
      const rate = 0.55 + m.A2 * 0.3 + m.C2 * 0.2 + m.A6 * 0.2;
      let g = (dealt / u.maxHp) * 0.9 * rate + (taken / u.maxHp) * 0.6;
      if (u.hp / u.maxHp < 0.3) g += 0.04 * (1 + m.C6); // 背水で気迫が高ぶる
      u.resolve = clamp((u.resolve || 0) + g, 0, 1);
    }
    // ===== Wave1：戦いの綾（気力/流れ/回避/カウンター）=====
    function defenseOf(cand, u) { // 回避＝命中減（気力依存）／受け＝被ダメ減（冷静・遮蔽利用）
      if (cand.attack === "DODGE") return { evade: clamp(0.45 + u.micros.B3 * 0.35, 0, 0.85) * clamp(u.stamina * 1.4, 0, 1), reduce: 0 };
      if (cand.attack === "GUARD") return { evade: 0, reduce: clamp(0.4 + u.micros.C5 * 0.25 + u.micros.B1 * 0.15, 0, 0.7) };
      return { evade: 0, reduce: 0 };
    }
    function staminaTick(side, ev) { // 攻め＝消耗・静止＝回復（冷静C5ほど早い）
      const u = stat(side); let d;
      if (ev.dodge) d = -0.16;
      else if (ev.guard) d = -0.06;       // 受けは安価
      else if (ev.charge) d = -0.18;      // 突進は消耗大
      else if (ev.grab) d = -0.15;        // 崩しも力を使う
      else if (ev.reloading) d = 0.05;
      else if (ev.attack === "NONE") d = (ev.moved ? 0.05 : 0.14) * (0.7 + 0.6 * u.micros.C5);
      else if (ev.shots) d = ev.attack === "RANGED" ? -(0.045 + 0.012 * Math.min(ev.shots, 8)) : -(u.melee.pattern === "heavy" ? 0.17 : u.melee.pattern === "multi" ? 0.13 : 0.10); // 連射の消耗に上限（乱射が過剰に不利にならない）
      else d = -0.03; // 構え・空振り・弾切れ
      if (d < 0 && ev.moved) d -= 0.02; // 動きながらは余計に消耗
      u.stamina = clamp(u.stamina + (d < 0 ? d * modSta : d), 0, 1); // 戦況「灼熱」＝消耗増
    }
    function momentumTick(side, dealt, taken, dodged) { // 当てる/見切る＝勢い・食らう＝萎む（減衰しつつ）
      const u = stat(side); let d = 0;
      if (dealt > 0) d += clamp(dealt / u.maxHp, 0, 0.3) * 1.2;
      if (taken > 0) d -= clamp(taken / u.maxHp, 0, 0.3);
      if (dodged) d += 0.12;
      u.momentum = clamp(u.momentum * 0.82 + d, -1, 1);
    }
    function counterStrike(defCand, def, atkEv, atk) { // 回避成功×相手の攻撃×読み(D1/D6/B3)＝反撃の一閃
      if (defCand.attack !== "DODGE" || !(atkEv.attack === "MELEE" || atkEv.attack === "RANGED") || !atkEv.shots) return 0;
      const read = clamp(0.12 + def.micros.D1 * 0.4 + def.micros.D6 * 0.25 + def.micros.B3 * 0.2, 0, 0.85);
      if (!rng.chance(read)) return 0;
      const d2 = dist(def, atk), dmg = d2 <= def.melee.reach ? def.melee.damage * 1.1 : def.ammo > 0 ? def.ranged.damage * 0.8 : def.melee.damage * 0.5;
      return Math.round(dmg * outFac(def) * vulnOf(atk) * dmgMod());
    }
    function trySecondWind(side) { // 火事場の馬鹿力：瀕死(HP<25%)で一度だけ発奮（C6粘りで確率）。気力全快＋出力↑数ターン
      const u = stat(side);
      if (u.swUsed || u.hp <= 0 || u.hp / u.maxHp >= 0.25) return false;
      u.swUsed = true;
      if (!rng.chance(0.3 + u.micros.C6 * 0.5)) return false;
      u.secondWind = 3; u.stamina = 1; u.momentum = clamp(u.momentum + 0.4, -1, 1);
      return true;
    }
    // ===== Wave3b：動的ハザード（崩れる遮蔽・燃え広がる炎） =====
    function chipCover(att, def, ev) { // 遮蔽を削る → 崩れるとLoSが開く。①阻まれた射撃が壁を撃つ ②近接/突進の重い一撃が近くの壁を割る
      let blk = null, amt = 0;
      if (ev.negated) { blk = blockingObstacle({ x: att.x, y: att.y }, { x: def.x, y: def.y }); amt = att.ranged.damage * 0.5 + 5; }
      else if ((ev.dmg || 0) >= 18 && (ev.attack === "MELEE" || ev.attack === "CHARGE")) { blk = obstacles.find((r) => r.hp > 0 && Math.abs(r.x + r.w / 2 - def.x) < 14 && Math.abs(r.y + r.h / 2 - def.y) < 14); amt = 18; }
      if (!blk) return false;
      blk.hp -= amt;
      return blk.hp <= 0;
    }
    function igniteFire(tx, ty) { if (hazards.filter((h) => h.turns > 0).length < 6) hazards.push({ x: cx(tx - 5), y: cy(ty - 5), w: 10, h: 10, turns: 3, dmg: 4 }); } // 地面が燃える
    function tickHazards() { // 今の炎ダメージを返す → 延焼（隣へ）＋寿命減
      const dmgP = hazardAt(plr), dmgC = hazardAt(cpu);
      const active = hazards.filter((h) => h.turns > 0);
      for (const h of active) {
        if (hazards.filter((x) => x.turns > 0).length < 6 && rng.chance(0.3)) { const ang = rng.range(0, 6.283); hazards.push({ x: cx(h.x + 5 + Math.cos(ang) * 9) - 5, y: cy(h.y + 5 + Math.sin(ang) * 9) - 5, w: 10, h: 10, turns: Math.max(1, h.turns - 1), dmg: h.dmg }); }
        h.turns--;
      }
      for (let i = hazards.length - 1; i >= 0; i--) if (hazards[i].turns <= 0) hazards.splice(i, 1);
      return { p: dmgP, c: dmgC };
    }
    // 攻撃のみ解決（移動は済・最終位置で判定）。ダメージは step 側で同時適用するため hp はここで変えない
    function resolveAttack(side, cand, deceived, edge, foeDef) {
      const self = stat(side), foe = stat(other(side)), ev = { move: cand.move, attack: cand.attack, moved: cand.moved };
      if (cand.attack !== "RANGED") self.charged = false; // 射撃をやめるとチャージ解除
      if (cand.attack !== "MELEE") self.windLeft = 0;     // 近接をやめると溜め解除
      if (cand.attack === "DODGE") { ev.dodge = true; return ev; } // 回避：攻撃せず・被弾を減らす（step側で相手命中に反映）
      if (cand.attack === "GUARD") { ev.guard = true; return ev; } // 受け：被ダメ減（step側で相手のダメージに反映）
      if (cand.attack === "GRAB") { ev.grab = true; return ev; }   // 崩し：受け不能の投げ（step側で三すくみ解決）
      const buff = 1 + lastStand(self) * 0.5, decoy = deceived ? 0.8 : 1, eg = edge || 1, fd = foeDef || { evade: 0, reduce: 0 };
      const precise = clamp(self.micros.A5 * 0.5 + self.micros.B4 * 0.3 - self.micros.A4 * 0.4, 0, 1); // 精密(急所)⇔乱射

      // リロード（選択 or 継続中）
      if (self.reloadLeft > 0 || cand.attack === "RELOAD") {
        if (self.reloadLeft === 0) { self.reloadLeft = self.ranged.reloadTurns; if (self.ammo === 0) { ev.emptyReload = true; self.opening = 1; } } // 弾切れ装填＝大きな隙
        self.reloadLeft--; self.spread = 0;
        if (self.reloadLeft <= 0) { self.ammo = self.ranged.mag; ev.reloadDone = true; }
        ev.attack = "RELOAD"; ev.reloading = true; return ev;
      }

      const d2 = dist(self, foe), los2 = losClear(self, foe), fp = { x: foe.x, y: foe.y };
      const fl = flankOf(self, foe); // 側背面：背後ほど命中/会心/威力↑＆相手の回避/受けを貫く
      const corner = cornered(foe) ? 1 : 0, fdEvMul = fl.defMul * (corner ? 0.72 : 1); // 壁際＝逃げ場が無く回避が効かない
      const punish = foe.opening > 0; // 確定反撃：相手が大技を空振り（隙）した好機に攻撃を合わせる
      const comboN = Math.min(self.combo || 0, 4); // 畳みかけ：連続ヒット中の上積み
      const aggAcc = (1 + comboN * 0.04) * (punish ? 1.5 : 1), aggDmg = (1 + comboN * 0.05) * (punish ? 1.3 : 1), aggFloor = punish ? 0.85 : 0;

      // 必殺（ULT）：気迫を解き放つ大威力の一撃必殺。当てやすいが空撃ちは大隙。気迫を使い切る
      if (cand.attack === "ULT") {
        self.resolve = 0;
        const rn = cand.ultKind === "ranged", w = rn ? self.ranged : self.melee, cat = weaponCat(w, rn);
        ev.attack = "ULT"; ev.ult = true; ev.ultName = ULT_NAME[cat]; ev.ultRn = rn; ev.shots = 1;
        if (rn && self.ammo <= 0) { ev.empty = true; ev.whiff = true; self.opening = 1; return ev; }
        const reachOK = rn ? los2 : d2 <= self.melee.reach + 2;
        if (!reachOK) { ev.whiff = true; self.opening = 1; return ev; }
        if (rn) self.ammo = Math.max(0, self.ammo - Math.min(self.ammo, Math.ceil(w.fireRate)));
        const hcBase = rn ? rangedHit(w, self, fp, foe, d2, true, cand.moved) : meleeHit(foe, fp);
        const hc = Math.min(1, hcBase * eg * fl.acc * (1 + corner * 0.1) * aggAcc + 0.18); // 必殺は当てやすい
        let dmg = 0;
        if (rng.chance(hc)) { let dd = w.damage * (rn ? 2.0 : 1.9); if (rng.chance(clamp(0.3 + fl.crit, 0, 0.55))) { dd *= w.critMult || 1.8; ev.crits = 1; } dmg = dd * defMult(fp) * vulnOf(foe) * (1 - fd.reduce * fdEvMul * 0.6); ev.hits = 1; }
        else { ev.whiff = true; self.opening = 1; }
        ev.dmg = Math.round(dmg * buff * outFac(self) * fl.dmg * aggDmg * dmgMod()); ev.kb = ev.hits > 0;
        if (ev.hits > 0 && fl.tier !== "front") ev.flank = fl.tier;
        if (ev.hits > 0 && corner) ev.corner = true;
        if (ev.hits > 0 && punish) ev.punish = true;
        if (ev.hits > 0 && comboN > 0) ev.comboLevel = comboN + 1;
        if (ev.hits > 0 && w.status) ev.applyStatus = w.status;
        return ev;
      }

      if (cand.attack === "RANGED") {
        if (!los2) { ev.negated = true; return ev; }
        const rw = self.ranged;
        if (rw.mode === "charge" && !self.charged) { self.charged = true; ev.charging = true; return ev; } // チャージ：1ターン溜めてから撃つ（移動では解除しない）
        if (self.ammo <= 0) { ev.empty = true; return ev; }
        if (rw.mode === "auto" && self.spread > 0.2 && rng.chance(0.05 + self.spread * 0.22)) { ev.jam = true; self.opening = 1; self.spread = 0; return ev; } // 過熱でジャム＝撃てず隙を晒す
        let shots = rw.mode === "charge" ? 1 : shotsFor(rw.fireRate, rng);
        if (precise > 0.55 && rw.mode !== "charge") shots = Math.max(1, Math.round(shots * (1 - precise * 0.5))); // 手数を絞る
        shots = Math.min(shots, self.ammo); self.ammo -= shots;
        if (rw.mode === "charge") self.charged = false;
        const critChance = clamp(rw.crit + precise * 0.2 + (rw.mode === "charge" ? 0.25 : 0) + modCrit + fl.crit, 0, 0.78); // 溜め撃ち＝狙い澄ました会心（＋戦況「一触即発」＋側背面）
        const hc = Math.min(1, Math.max(aggFloor, rangedHit(rw, self, fp, foe, d2, true, cand.moved) * decoy * eg * (1 - self.spread) * (1 - fd.evade * fdEvMul) * fl.acc * (1 + corner * 0.05) * aggAcc)); // 背後/壁際/確定反撃は回避が効かない
        let hits = 0, dmg = 0, crits = 0;
        for (let i = 0; i < shots; i++) if (rng.chance(hc)) { hits++; let dd = rw.damage; if (rng.chance(critChance)) { dd *= rw.critMult; crits++; } dmg += dd * defMult(fp) * vulnOf(foe); }
        ev.shots = shots; ev.hits = hits; ev.crits = crits; ev.dmg = Math.round(dmg * buff * outFac(self) * (1 - fd.reduce * fl.defMul) * fl.dmg * aggDmg * dmgMod());
        if (hits > 0 && fl.tier !== "front") ev.flank = fl.tier;
        if (hits > 0 && corner) ev.corner = true;
        if (hits > 0 && punish) ev.punish = true;
        if (hits > 0 && comboN > 0) ev.comboLevel = comboN + 1;
        if (rw.mode === "auto" && shots > 0) self.spread = Math.min(0.5, self.spread + rw.spreadGrowth * (1 - self.micros.B4 * 0.5)); // 規律で反動抑制
        if (hits > 0 && rw.status) ev.applyStatus = rw.status;
        return ev;
      }

      self.spread = Math.max(0, self.spread - 0.2); // 撃たないと拡散回復

      const isCharge = cand.attack === "CHARGE";
      if ((cand.attack === "MELEE" || isCharge) && d2 <= self.melee.reach) {
        const mw = self.melee;
        if (mw.windup > 0 && !isCharge) { // 大振り：溜めてから振る（突進は溜めなし）
          if (self.windLeft <= 0) { self.windLeft = mw.windup; ev.windup = true; return ev; }
          self.windLeft--; if (self.windLeft > 0) { ev.windup = true; return ev; }
        }
        let swings = isCharge ? 1 : mw.pattern === "heavy" ? 1 : shotsFor(mw.rate, rng);
        if (precise > 0.55 && mw.pattern === "multi" && !isCharge) swings = Math.max(1, Math.round(swings * (1 - precise * 0.4))); // 多段でも一点集中
        const critChance = clamp(mw.crit + precise * 0.2 + (isCharge ? 0.1 : 0) + modCrit + fl.crit, 0, 0.68), chargeMul = isCharge ? 1.4 : 1; // 突進＝威力UP（＋戦況「一触即発」＋側背面）
        const hc = Math.min(1, Math.max(aggFloor, meleeHit(foe, fp) * decoy * eg * (1 - fd.evade * fdEvMul) * fl.acc * (1 + corner * 0.05) * aggAcc)); // 背後/壁際/確定反撃は回避/受けが効かない
        let hits = 0, dmg = 0, crits = 0;
        for (let i = 0; i < swings; i++) if (rng.chance(hc)) { hits++; let dd = mw.damage * chargeMul; if (rng.chance(critChance)) { dd *= mw.critMult; crits++; } dmg += dd * defMult(fp) * vulnOf(foe); }
        ev.shots = swings; ev.hits = hits; ev.crits = crits; ev.dmg = Math.round(dmg * buff * outFac(self) * (1 - fd.reduce * fl.defMul) * fl.dmg * aggDmg * dmgMod()); ev.kb = hits > 0 && (mw.knockback > 0 || isCharge);
        if (hits > 0 && fl.tier !== "front") ev.flank = fl.tier;
        if (hits > 0 && corner) ev.corner = true;
        if (hits > 0 && punish) ev.punish = true;
        if (hits > 0 && comboN > 0) ev.comboLevel = comboN + 1;
        if (isCharge) ev.charge = true;
        if (hits > 0 && mw.status) ev.applyStatus = mw.status;
        if (hits === 0 && (mw.pattern === "heavy" || isCharge)) self.opening = 1; // 大振り/突進の空振り＝隙
        return ev;
      } else if (cand.attack === "MELEE") ev.outOfReach = true;
      else if (isCharge) { ev.charge = true; ev.whiff = true; self.opening = 1; } // 突進が届かず空を切る＝大きな隙
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
      winded: ["肩で大きく息をしながら", "息を切らし", "足が重くなり", "荒い呼吸のまま", "汗だくで肩を上下させ"],
      neutral: ["", "気を引き締め、", "呼吸を整え、", "視線を鋭くし、"],
    };
    function moodOf(self) {
      const f = self.hp / self.maxHp;
      if (lastStand(self) > 0.4) return "desperate";
      if (f < 0.4) return "hurt";
      if (self.stamina < 0.3) return "winded"; // 気力切れ＝息が上がる
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
      if (ranged) return w.key === "flamethrower" ? "flame" : w.mode === "charge" || w.key === "marksman" || w.key === "pistol" || w.key === "burst" ? "precise" : w.key === "shotgun" ? "shotgun" : "auto";
      return w.pattern === "multi" ? "mlt" : w.pattern === "heavy" ? "hvy" : "bal";
    }
    const ATK_HIT = {
      precise: ["{w}で狙い澄まして撃ち抜き", "{w}の一発を急所へ吸い込ませ", "{w}で精確に射貫き", "{w}の照準を寸分違わず合わせ"],
      auto: ["{w}の弾雨を浴びせ", "{w}を掃射して縫い止め", "{w}でなぎ払うように撃ち込み", "{w}の連射を叩き込み"],
      shotgun: ["至近から{w}を叩き込み", "{w}の散弾を抉り込ませ", "{w}を顔面へ撃ち込み"],
      flame: ["{w}で業火を浴びせ", "{w}の炎を吹き付け", "{w}で火炎を噴き上げ", "{w}で猛火を浴びせかけ"],
      mlt: ["{w}で目にも留まらぬ連撃を浴びせ", "{w}を閃かせて刻みつけ", "{w}の乱舞で切り裂き"],
      hvy: ["{w}を渾身で振り下ろし", "{w}の一撃を全身で叩きつけ", "唸りを上げる{w}を振り抜き"],
      bal: ["{w}を鋭く振り抜き", "{w}で間合いを断ち切り", "{w}を一閃させ", "{w}の刃を滑り込ませ"],
    };
    const ATK_MISS = {
      precise: ["{w}を放つも、紙一重で逸れる", "{w}の一発は虚しく宙を裂いた", "狙いはわずかに甘く、{w}は空を切る"],
      auto: ["{w}をばら撒くも捉えきれず", "{w}の連射は空を縫うばかり", "{w}を浴びせるが、すべて逸れる"],
      shotgun: ["{w}の散弾は届かず散る", "{w}を撃つも間合いが遠い"],
      flame: ["{w}の炎は届かず宙を舐める", "{w}を噴くも間合いが遠い", "{w}の火は虚しく空を焦がす"],
      mlt: ["{w}を閃かせるも空を切る", "{w}の連撃はかすりもしない"],
      hvy: ["{w}を振るうも大きく空振り", "{w}は虚しく地を叩いた"],
      bal: ["{w}を振り抜くも捉え損ね", "{w}の一閃は空を裂くのみ"],
    };
    const REACT = ["確かな手応え。", "鈍い衝撃が走った。", "血飛沫が舞う。", "効いている。", "深い傷を刻んだ。", "たまらず体勢が崩れる。", "苦痛の声が漏れた。", "重い一撃が通った。", "相手がぐらりとよろめく。", "確実に削った。", "顔をしかめ、後ずさる。", "息を呑む音が聞こえた。"];
    const REACT_LITE = ["かすかな手応え。", "わずかに削った。", "浅手を負わせた。", "軽い手傷。", "効きは薄いが、確かに当てた。"];
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
      if (rn && ev.jam) return px([`${name}が過熱してジャム！撃てず、隙を晒す。`, `${name}が動作不良——弾が出ない。無防備だ。`], slt);
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
    function composeAction(side, dec, ev, gpre, foeEv) {
      const self = stat(side), sd = self.side, foeAtk = !!(foeEv && foeEv.shots > 0); // 相手が実際にこのターン攻撃したか
      if (dec.stunned) return px(["痺れて動けない——！その場で隙を晒す。", "麻痺が全身を貫き、立ち尽くす。", "体が言うことを聞かない。動けないまま固まる。"], sideSalt(sd, 66)) + " 〈麻痺〉";
      if (ev.dodge) {
        const cnt = ev.counter ? px([`——読んでいた！回避から鋭い反撃、−${ev.counter}！`, `見切りざまの一閃が突き刺さる、−${ev.counter}！`, `紙一重でかわし、反撃を叩き込む、−${ev.counter}！`], sideSalt(sd, 67)) : "";
        const base = foeAtk // 相手が攻めてきた時だけ「かわした」、来なければ「来ると読んで備える」
          ? px(["身を翻し、紙一重でかわす。", "読んで、すっと攻撃線から外れる。", "半身でいなし、攻撃を受け流す。", "見切って横へ跳んだ。"], sideSalt(sd, 68))
          : px(["来ると読んで、ふっと身をずらす。", "警戒し、いつでも動ける体勢を取る。", "仕掛けを読み、半身に構える。", "誘いと見て、軽く身をかわした。"], sideSalt(sd, 68));
        return `${px(DEMEANOR[moodOf(self)], sideSalt(sd, 11))}${base}${cnt} 〈${dec.strat ? STRAT_JP[dec.strat] + "・" : ""}回避/深${dec.depth}〉`;
      }
      if (ev.guard) {
        const g = foeAtk
          ? px(["受けの構えで衝撃を受け止める。", "ガードを固め、攻撃を殺す。", "半身に構え、衝撃を受け流す。"], sideSalt(sd, 70))
          : px(["受けを固め、来るべき攻撃に備える。", "ガードを上げ、じっと機を窺う。", "守りを固めて様子を見る。"], sideSalt(sd, 70));
        return `${px(DEMEANOR[moodOf(self)], sideSalt(sd, 11))}${g} 〈${dec.strat ? STRAT_JP[dec.strat] + "・" : ""}受け/深${dec.depth}〉`;
      }
      if (ev.charge) {
        const line = ev.whiff ? px(["渾身の突進——空を切る！大きな隙を晒した。", "踏み込みざまの一撃は届かず、体勢が大きく崩れる。"], sideSalt(sd, 71)) : px([`渾身の突進から${self.melee.name}を叩き込み、−${ev.dmg}！`, `地を蹴って間合いを割り、${self.melee.name}が深々と入る、−${ev.dmg}！`], sideSalt(sd, 72)) + (ev.crits > 0 ? "会心！" : "");
        return `${px(DEMEANOR[moodOf(self)], sideSalt(sd, 11))}${line} 〈${dec.strat ? STRAT_JP[dec.strat] + "・" : ""}突進/深${dec.depth}〉`;
      }
      const dem = px(DEMEANOR[moodOf(self)], sideSalt(sd, 11));
      const gmb = dec.gamble ? px(["一か八か、", "乾坤一擲——", "ここで勝負と、"], sideSalt(sd, 69)) : ""; // リスク選好の博打
      const mvp = px(MV[dec.cand.move], sideSalt(sd, 12));
      const terr = terrainPhrase(terrainAt(self)), terrC = terr ? terr + "、" : "";
      const atk = composeAttack(self, stat(other(side)), ev);
      const body = `${dem}${gpre || ""}${gmb}${terrC}${mvp}、${atk}`;
      const read = dec.readFoe && hsh(sideSalt(sd, 13)) % 2 === 0 ? ` ${px(["相手の", "敵の"], sideSalt(sd, 14))}${MOVE_JP[dec.readFoe]}を見切っていた。` : "";
      const tags = ` 〈${dec.strat ? STRAT_JP[dec.strat] + "・" : ""}${dec.plan}/深${dec.depth}${dec.mc ? "+MC" : ""}・${dec.reason}〉`;
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
      if (evP.counter || evC.counter) out.push({ text: px(["── 見事なカウンター！読みが流れを引き寄せた。", "── 回避からの一閃——これは効く！"], 35), cls: "cm" });
      const flow = plr.momentum > 0.55 ? `PLR(${plr.name})` : cpu.momentum > 0.55 ? `CPU(${cpu.name})` : null;
      if (flow && hsh(37) % 3 === 0) out.push({ text: `── 流れは ${flow} に傾いている。勢いが乗ってきた。`, cls: "cm" });
      const lowNew = (hp0, u) => hp0 / u.maxHp >= 0.3 && u.hp / u.maxHp < 0.3 && u.hp > 0;
      if (lowNew(hpC0, cpu)) out.push({ text: px(CM_LOW, 32).replace("X", `CPU(${cpu.name})`), cls: "cm" });
      else if (lowNew(hpP0, plr)) out.push({ text: px(CM_LOW, 33).replace("X", `PLR(${plr.name})`), cls: "cm" });
      if (noDamageTurns >= 4 && hsh(34) % 2 === 0) out.push({ text: px(CM_STALL, 34), cls: "cm" });
      return out;
    }
    function situationLine(pre) {
      const pd = Math.round(clamp((dist(pre.p, pre.c) / maxDist) * 100, 0, 100));
      const dfeel = pd < 15 ? px(["息のかかる至近距離", "刃が触れ合う間合い"], 41) : pd < 35 ? px(["互いの表情も見える近間", "踏み込めば届く距離"], 42) : pd < 60 ? px(["射撃を交わす中距離", "睨み合う中間合い"], 43) : px(["遠く隔てた間合い", "遠間での睨み合い"], 44);
      const fd = pre.p.hp / plr.maxHp - pre.c.hp / cpu.maxHp; // ★ターン開始時のHPで形勢を判定（被弾適用後のhpを使うとラベルが逆転する）
      const mom = fd > 0.2 ? "あなたが圧倒する流れ" : fd > 0.08 ? "ややあなたに分がある" : fd < -0.2 ? `${cpu.name}が押し込む展開` : fd < -0.08 ? `やや${cpu.name}優勢` : "互角の睨み合い";
      return `${dfeel}（${pd}％）、${arena.name}。${mom}。`;
    }
    // ★決着ターン専用：倒れる側の「最後の行動（〜しようとした）＋死因＋崩れ方」を一文に（同時動作を保ったまま自然に）
    const FIN_MV = {
      ADVANCE: ["踏み込もうとした", "間合いを詰めようとした", "前へ出ようとした"],
      RETREAT: ["距離を取ろうとした", "退こうとした", "身を引こうとした"],
      STRAFE_L: ["左へ回り込もうとした", "横へ回ろうとした", "身をかわそうとした"],
      STRAFE_R: ["右へ回り込もうとした", "横へ流れようとした", "身をかわそうとした"],
      COVER: ["遮蔽へ逃れようとした", "物陰へ転がり込もうとした"],
      HOLD: ["構え直そうとした", "機を窺っていた", "踏み止まろうとした"],
    };
    function finishIntent(dec, ev, sd) {
      if (ev.ult) return px(["渾身の必殺を放った——が及ばず", "気迫を解き放った、が一歩遅く"], sideSalt(sd, 84));
      if (ev.grab) return px(["組み付こうと踏み込んだ刹那", "投げを仕掛けた、が一歩及ばず"], sideSalt(sd, 84));
      if (ev.dodge) return px(["紙一重でかわそうと身を翻した刹那", "見切ろうとした、まさにその瞬間"], sideSalt(sd, 84));
      if (ev.reloading) return px(["弾を込めようとした矢先", "リロードに入った刹那"], sideSalt(sd, 84));
      if (ev.guard) return px(["受けに回ろうとした、が", "防ごうと身構えた——が及ばず"], sideSalt(sd, 84));
      if (ev.charge) return px(["突進を仕掛けた——が及ばず", "踏み込んでの一撃を狙った、が"], sideSalt(sd, 84));
      if (ev.attack === "RANGED" || ev.attack === "MELEE") return px(["一撃を返そうとした、が", "迎え撃とうとした——が及ばず", "相討ちを狙った、が一歩遅く"], sideSalt(sd, 84));
      return px(FIN_MV[dec.cand.move] || ["動こうとした"], sideSalt(sd, 84));
    }
    function finishCause(cause, foe) {
      if (cause === "ult") return px(["渾身の必殺が炸裂し", "気迫の籠った一撃必殺に貫かれ"], 85);
      if (cause === "throw") return px(["渾身の投げで地に叩きつけられ", "受けごと投げ飛ばされ"], 85);
      if (cause === "counter") return px(["迎え撃つ反撃が深々と突き刺さり", "回避から放たれた一閃が捉え"], 85);
      if (cause === "fire") return px(["燃え盛る炎に呑まれ", "立ち上る業火に巻かれ"], 85);
      if (cause && cause.indexOf("status:") === 0) { const m = { bleed: "止まらぬ出血に力を奪われ", poison: "毒が全身に回り", burn: "燃え広がる炎に灼かれ" }; return m[cause.slice(7)] || "深手がもとで"; }
      return px([`${foe.name}の一撃が深々と突き刺さり`, "相手の渾身の一撃が捉え", "放たれた決定打が突き刺さり"], 85);
    }
    function composeFinish(side, dec, ev, cause) {
      const self = stat(side), sd = self.side, foe = stat(other(side));
      return `${finishIntent(dec, ev, sd)}——${finishCause(cause, foe)}、${px(FIN_KO, sideSalt(sd, 80))}`;
    }
    // ★相討ち専用：両者が同じ刹那に決め手を放ち、共に崩れる一連の描写
    function mutualBlow(side, ev) { // その者がこのターンに放った決め手（あれば）
      const self = stat(side);
      if (ev.dmg > 0 && (ev.attack === "RANGED" || ev.attack === "MELEE" || ev.attack === "CHARGE" || ev.attack === "ULT")) { if (ev.ult) return `必殺・${ev.ultName}を放ち、−${ev.dmg}`; const rn = ev.attack === "RANGED", w = rn ? self.ranged : self.melee; return `${px(ATK_HIT[weaponCat(w, rn)], sideSalt(self.side, 95)).replace("{w}", w.name)}、−${ev.dmg}`; }
      if (ev.counter) return `回避から反撃を返し、−${ev.counter}`;
      return null;
    }
    function mutualFinish(evP, evC) {
      const bP = mutualBlow("p", evP), bC = mutualBlow("c", evC);
      const fall = px(["両者、声もなく崩れ落ちた。相討ち——。", "どちらからともなく、二人同時に倒れ伏す。相討ち——。", "勝者なし。両者ともに膝をついた。相討ち——。"], 91);
      if (bP && bC) { const cross = px(["二つの攻撃が同じ刹那に交差した——", "互いの一撃が寸分違わず重なる——", "刹那、両者の攻撃が交錯し——"], 90); return { plr: `${bP}。`, cpu: `時を同じくして${bC}。${cross}${fall}` }; }
      return { plr: bP ? `${bP}。` : `力尽きかける——`, cpu: `${bC ? `時を同じくして${bC}。` : "時を同じくして相手も崩れ、"}${fall}` };
    }
    // ===== 統合描写（同時動作を1つの場面として・PLR/CPUを分けず相互作用を解決）=====
    const nameSpan = (side) => (side === "p" ? `<span class="np">あなた</span>` : `<span class="nc">${cpu.name}</span>`);
    const exDem = (side) => px(DEMEANOR[moodOf(stat(side))], sideSalt(stat(side).side, 11));
    const exMove = (side, dec) => px(MV[dec.cand.move] || MV.HOLD, sideSalt(stat(side).side, 12));
    const exTerr = (side) => { const t = terrainPhrase(terrainAt(stat(side))); return t && hsh(sideSalt(stat(side).side, 77)) % 3 === 0 ? t + "、" : ""; }; // 地形語は毎ターンでなく時々（全域同一地形での連呼を防ぐ）
    const isStrike = (ev) => (ev.attack === "RANGED" || ev.attack === "MELEE" || ev.attack === "CHARGE" || ev.attack === "ULT") && ev.shots > 0 && !ev.charging && !ev.windup;
    // 攻撃イベント1件＝攻め手の動作＋一撃＋相手の反応(回避/受け/被弾)＋反撃。実ダメージを反映するので「かわした」と「被弾」が矛盾しない
    function strikeClause(attSide, attEv, attDec, defSide, defEv, gpre) {
      const an = nameSpan(attSide), dn = nameSpan(defSide), self = stat(attSide), foe = stat(defSide);
      const isUlt = !!attEv.ult, rn = isUlt ? attEv.ultRn : attEv.attack === "RANGED", w = rn ? self.ranged : self.melee, slt = sideSalt(self.side, rn ? 63 : 64), cat = weaponCat(w, rn);
      const crit = attEv.crits > 0, dmg = attEv.dmg || 0;
      const flk = attEv.flank === "rear" ? px(["背後を取り、", "死角に回り込みざま、"], slt + 1) : attEv.flank === "side" ? px(["側面から、", "横合いを突いて、"], slt + 1) : "";
      const cornerPre = attEv.corner && !flk ? px(["壁際に追い詰め、", "逃げ場を塞ぎ、"], slt + 4) : "";
      const punishPre = attEv.punish ? px(["好機を逃さず——がら空きへ叩き込む！", "隙を突き、", "晒した隙を咎め、"], slt + 6) : "";
      const comboPre = attEv.comboLevel >= 2 ? `${attEv.comboLevel}連撃——畳みかけ、` : "";
      const critPre = (isUlt ? "気迫を解き放つ——" : "") + punishPre + comboPre + (crit ? px(["会心の一撃、", "渾身——！", "急所を捉え、"], slt + 3) : "");
      const verb = isUlt ? `${attEv.ultName}を${rn ? "放ち" : "叩き込み"}` : attEv.charge ? `渾身の突進から${w.name}を叩き込み` : px(ATK_HIT[cat], slt + (crit ? 7 : 0)).replace("{w}", w.name);
      const st = attEv.statusType ? statusApplyPhrase(attEv.statusType, slt) : "", kb = attEv.kb && dmg >= 12 ? "・大きく弾き飛ばす" : ""; // 弾き飛ばしは十分なダメージ時のみ描写
      const dd = exDem(defSide), cnt = defEv.counter ? ` ${dn}は見切りざま反撃を返し、${an}へ −${defEv.counter}！` : "";
      const moveClause = flk || (exMove(attSide, attDec) + "、"); // 側背面を取ったときは移動句の代わりにフランク描写を使う（「正面から…背後を取り」の矛盾回避）
      const lead = `${gpre || ""}${an}は${exDem(attSide)}${exTerr(attSide)}${moveClause}${cornerPre}`;
      if (isUlt && dmg <= 0 && !defEv.dodge && !defEv.guard) return `${lead}${attEv.ultName}を放つも——空を切った！大きな隙を晒す。`;
      if (defEv.dodge) {
        if (dmg <= 0) return `${lead}${critPre}${verb}——${dd}${dn}は紙一重で見切ってかわす。${cnt}`;
        return dmg < 0.15 * foe.maxHp // 小ダメージ＝掠り／大ダメージ＝かわしきれず（「掠られ −100」の矛盾を回避）
          ? `${lead}${critPre}${verb}——${dd}${dn}は身を翻すも掠られ −${dmg}${st}。${cnt}`
          : `${lead}${critPre}${verb}——${dd}${dn}はかわしきれず、まともに浴びる −${dmg}${st}。${cnt}`;
      }
      if (defEv.guard) return dmg <= 0
        ? `${lead}${critPre}${verb}——${dd}${dn}は受けに回り、完全に受け止める。`
        : `${lead}${critPre}${verb}——${dd}${dn}は受けで威力を殺し、−${dmg} に抑える${st}。`;
      if (dmg > 0) { const react = dmg >= 0.35 * foe.maxHp ? px(REACT_BIG, slt + 9) : dmg < 0.08 * foe.maxHp ? px(REACT_LITE, slt + 9) : px(REACT, slt + 9); return `${lead}${critPre}${verb}、${dn}へ −${dmg}${kb}${st}。${react}`; }
      return `${lead}${px(ATK_MISS[cat], slt).replace("{w}", w.name)}。`;
    }
    // 攻撃していない側（移動/リロード/チャージ/弾切れ/麻痺/読みの構え 等）の一節
    function standaloneClause(side, ev, dec, gpre, foeStruck) {
      const n = nameSpan(side), self = stat(side);
      if (ev.grab) { // 崩し（投げ）
        const dn = nameSpan(other(side));
        if (ev.grabHit) { const env = ev.envThrow ? "——溶岩/炎の中へ叩き込む" : ev.wallThrow ? "——壁へ叩きつける" : ""; return `${gpre || ""}${n}は${exDem(side)}相手の懐へ飛び込み、${ev.clinch ? "組み合いを制して" : "受けの構えごと"}投げ飛ばす${env}——${dn} へ −${ev.dmg}！`; }
        if (ev.grabFail) return ev.clinch ? "" : `${n}は組み付こうと踏み込むが、攻撃を合わされて潰された。隙を晒す。`;
        if (ev.grabWhiff) return `${n}は組み付こうと手を伸ばすが、相手は間合いの外。空を掴んで泳ぐ。`;
        return `${n}は組み付きを狙う。`;
      }
      const isFlame = self.ranged.key === "flamethrower"; // 火炎放射器は弾倉でなく燃料
      if (dec.stunned) return `${n}は麻痺で動けず、その場で隙を晒す。`;
      if (ev.reloading) return ev.emptyReload ? `${n}は${isFlame ? "燃料が尽き——慌てて補充する" : "弾切れ——慌てて弾倉を交換する"}。無防備な刹那だ。` : `${n}は${isFlame ? "燃料を補充する" : "弾を込め直す"}。`;
      if (ev.jam) return `${n}は${self.ranged.name}が過熱し${isFlame ? "噴射が詰まる" : "ジャム"}——撃てず隙を晒す。`;
      if (ev.charging) return `${n}は${exDem(side)}${self.ranged.name}に狙いを溜める。次の一射に懸ける。`;
      if (ev.windup) return `${n}は${self.melee.name}を大きく振りかぶる。`;
      if (ev.empty) return `${n}は${isFlame ? "噴射しようとするも——燃料切れだ" : "引き金を引くも——弾切れだ"}。`;
      if (ev.negated) return `${n}は${exMove(side, dec)}${isFlame ? px(["放つも、炎は遮蔽に阻まれる", "噴くが、火は壁に阻まれて届かない"], sideSalt(self.side, 59)) : px(["撃つも、射線は遮蔽に阻まれる", "撃つが、弾は壁に阻まれて通らない", "放った弾は遮蔽に弾かれた"], sideSalt(self.side, 59))}。`;
      if (ev.dodge && !foeStruck) return `${gpre || ""}${n}は${exDem(side)}${px(["来ると読んで身構え", "仕掛けを警戒し", "いつでも動ける体勢を取り", "誘いと見て半身に構え"], sideSalt(self.side, 68))}、${exMove(side, dec)}。`;
      if (ev.guard && !foeStruck) return `${n}は${px(["受けを固め、様子を窺う", "ガードを上げ、機を窺う", "守りを固めて出方を探る", "構えを崩さず間合いを計る"], sideSalt(self.side, 70))}。`;
      return `${gpre || ""}${n}は${exDem(side)}${exTerr(side)}${exMove(side, dec)}、${px(["好機を窺う", "出方を探る", "機を計る", "間合いを計り直す", "次の一手を窺う", "じっと隙を待つ"], sideSalt(self.side, 62))}。`;
    }
    function composeExchange(decP, evP, decC, evC, geP, geC) {
      const pStrike = isStrike(evP), cStrike = isStrike(evC);
      const pCovered = pStrike || ((evP.dodge || evP.guard) && cStrike);
      const cCovered = cStrike || ((evC.dodge || evC.guard) && pStrike);
      const clauses = [];
      if (pStrike) clauses.push(strikeClause("p", evP, decP, "c", evC, guilePrefix(geP)));
      if (cStrike) clauses.push(strikeClause("c", evC, decC, "p", evP, guilePrefix(geC)));
      if (!pCovered) clauses.push(standaloneClause("p", evP, decP, guilePrefix(geP), cStrike));
      if (!cCovered) clauses.push(standaloneClause("c", evC, decC, guilePrefix(geC), pStrike));
      return clauses.filter(Boolean).join(" ");
    }
    function tagLine(decP, decC) {
      const t = (d) => `${d.strat ? STRAT_JP[d.strat] : "—"}・${d.plan}/深${d.depth}${d.mc ? "+MC" : ""}`;
      return `〈<span class="np">YOU</span> ${t(decP)}　｜　<span class="nc">CPU</span> ${t(decC)}〉`;
    }
    // 決着ターンも統合描写に：交戦は composeExchange が両者の同時行動＋実ダメージを描くので、
    // ここでは倒れる側の「崩れ方」だけを添える（炎/状態異常での死は死因も。直撃/反撃/投げ/必殺は交戦描写で既出）。
    const MUTUAL_FALL = ["——二つの攻撃が同じ刹那に交差し、二人は時を同じくして崩れ落ちた。相討ち——。", "——刃が交わり、どちらからともなく二人倒れ伏す。相討ち——。", "——互いの一撃が寸分違わず重なり、両者ともに膝をついた。相討ち——。"];
    function fallClause(side, cause) {
      const n = nameSpan(side), foe = stat(other(side)), slt = sideSalt(stat(side).side, 80), ko = px(FIN_KO, slt);
      if (cause === "fire" || (cause && cause.indexOf("status:") === 0)) return `${finishCause(cause, foe)}、${n}は${ko}`;
      return `${n}は${px(["こらえきれず", "糸が切れたように", "もはや立っていられず", "力尽き、"], slt + 1)}${ko}`;
    }
    function narrateTurn(pre, decP, evP, decC, evC, hpP0, hpC0, geP, geC, ko) {
      const pd = Math.round(clamp((dist(pre.p, pre.c) / maxDist) * 100, 0, 100));
      const lines = [{ text: `【戦況】${situationLine(pre)}`, cls: "sit" }];
      // 通常ターンも決着ターンも「二人の相互作用を1場面」に統合（決着は倒れ方を末尾に添える）
      let ex = composeExchange(decP, evP, decC, evC, geP, geC);
      if (ko && (ko.p || ko.c)) ex += " " + (ko.p && ko.c ? px(MUTUAL_FALL, 90) : fallClause(ko.p ? "p" : "c", ko.p ? ko.causeP : ko.causeC));
      lines.push({ text: `　${ex}`, cls: "ex" });
      lines.push({ text: `　${tagLine(decP, decC)}`, cls: "tags" });
      lines.push({ text: `　└ 結果：間合い ${pd}→${displayDist()}％／PLR ${hpP0}→${plr.hp}${hpWord(plr)}・CPU ${hpC0}→${cpu.hp}${hpWord(cpu)}`, cls: "dim" });
      for (const c of commentary(evP, evC, hpP0, hpC0)) lines.push(c);
      if (decP.stratChanged) lines.push({ text: `── ${nameSpan("p")}、構えを変えた——${STRAT_JP[decP.strat]}へ。`, cls: "cm" });
      if (decC.stratChanged) lines.push({ text: `── ${nameSpan("c")}、構えを変えた——${STRAT_JP[decC.strat]}へ。`, cls: "cm" });
      return lines;
    }
    const FIN_KO = ["崩れ落ちた。", "ついに膝をついた。", "力尽きて倒れ込む。", "糸が切れたように沈黙した。", "もう立ち上がれない。"];
    function winFlavor(win) {
      if (win.hp / win.maxHp < 0.18) return px(["満身創痍、執念がもぎ取った勝利だった。", "倒れる寸前——気力だけで勝ち切った。", "紙一重、勝負はまさに薄氷の上にあった。"], 82);
      const ws = stats[win.side === "PLR" ? "p" : "c"], rn = (ws.ranged || 0) >= (ws.melee || 0), w = rn ? win.ranged : win.melee, cat = weaponCat(w, rn); // 実際に多く使った間合いで締めの言い回しを選ぶ（近接で倒したのに「一射が」を防ぐ）
      const pool = {
        precise: ["精緻な一射が、勝敗を断ち切った。", "狙い澄ました弾が、すべてを終わらせた。"],
        auto: ["浴びせ続けた弾幕が、相手をねじ伏せた。", "途切れぬ連射が、地力で押し切った。"],
        shotgun: ["至近の一撃が、勝負を吹き飛ばした。", "間合いを支配した者の、圧倒的な決着。"],
        flame: ["焼き尽くす炎が、勝敗を決した。", "燃え盛る業火が、すべてを呑み込んだ。"],
        mlt: ["疾風の連撃が、急所を捉え切った。", "目にも留まらぬ刃が、勝敗を刻んだ。"],
        hvy: ["渾身の一撃が、すべてを叩き伏せた。", "重き刃の一振りが、決着を告げた。"],
        bal: ["冴え渡る一閃が、勝負を決めた。", "間合いを制した刃が、見事に断ち切った。"],
      };
      return px(pool[cat] || pool.bal, 83);
    }
    function finishNarration(res) {
      const out = [{ text: "═══════════════  決　着  ═══════════════", cls: "result" }];
      if (res.type === "draw") {
        out.push({ text: `　${res.text === "相討ち" ? px(["両雄、並び立たず——刺し違えての痛み分け。", "刃を交え、勝敗は天に流れた。相討ち。", "互いの全てを出し切り、決着はつかなかった。"], 86) : "時は尽き、決着はつかなかった。"}`, cls: "result" });
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
    function stunnedDecision(side) { const self = stat(side); return { cand: { move: "HOLD", attack: "NONE", newPos: { x: self.x, y: self.y }, moved: false, d2: dist(plr, cpu), los2: losClear(plr, cpu) }, reason: "麻痺", predFoe: null, depth: self.cog.searchDepth, mc: 0, plan: "麻痺", second: null, readFoe: null, stunned: true, strat: self.strategy, stratChanged: false, gamble: false }; }

    const isAtkAttack = (a) => a === "MELEE" || a === "RANGED" || a === "CHARGE" || a === "GRAB" || a === "ULT";
    function recordStats(side, dec, ev, ge, dmgTaken, preDist, ctx) {
      const s = stats[side], band = Math.round(clamp((preDist / maxDist) * 100, 0, 100));
      // 観戦→調整の手がかり：見逃した好機・被フランク・気迫の温存・自分が晒した隙
      if (ctx) {
        if (ctx.foeOpenPre) { s.openSeen++; if (isAtkAttack(dec.cand.attack)) s.openTaken++; } // 相手の隙を咎められたか
        if (ctx.foeEv && ctx.foeEv.flank && (ctx.foeEv.dmg || 0) > 0) s.wasFlanked++;             // 側背面を取られた被弾
        if (ctx.resPre >= 1 && dec.cand.attack !== "ULT") s.ultIdle++;                            // 気迫満タンなのに必殺を撃たなかった
        if (ev.whiff || ev.jam || ev.emptyReload || ev.grabFail || ev.grabWhiff) s.gaveOpening++; // 自分が大技/弾切れで隙を晒した
        if ((ctx.resPre || 0) > s.resPeak) s.resPeak = ctx.resPre;
      }
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
      if (ev.dodge) s.dodges++;
      if (ev.counter) s.counters++;
      if (ev.charge && !ev.whiff) s.charges++;
      if (ev.guard) s.guards++;
      if (ev.grabHit) s.grabs++;
      if (ev.grabFail || ev.grabWhiff) s.grabFails++;
      if (ev.flank === "rear") s.flankRear++; else if (ev.flank === "side") s.flankSide++;
      if (ev.ult && ev.hits > 0) s.ults++;
      if (ev.corner) s.corners++;
      if (ev.envThrow || ev.wallThrow) s.envThrows++;
      if ((ev.comboLevel || 0) > (s.maxCombo || 0)) s.maxCombo = ev.comboLevel;
      if (ev.punish) s.punishes++;
      if (stat(side).stamina < 0.3) s.winded++;
      if (dec.strat) s.strat[dec.strat] = (s.strat[dec.strat] || 0) + 1;
      s.dmgTaken += dmgTaken;
      if (ge) for (const k of ["feint", "exploit", "bait", "disinfo", "outwit"]) if (ge[k]) s.guile++;
    }

    // 分析フィードバック：パラメータ(24小パラ)は見せず、戦闘の「結果」から挙動を要約＋次の方向性を示す
    function getAnalysis() {
      const STJP = D.STATUS_JP;
      function one(side, fs) {
        const u = stat(side), s = stats[side], n = s.distN || 1;
        const hitRate = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
        const atk = s.ranged + s.melee, atkRatio = Math.round((atk / n) * 100);
        const near = Math.round((s.near / n) * 100), mid = Math.round((s.mid / n) * 100), far = Math.round((s.far / n) * 100);
        const wpnMix = s.ranged + s.melee === 0 ? "—" : s.ranged > s.melee * 2 ? "遠距離主体" : s.melee > s.ranged * 2 ? "接近戦主体" : "遠近を併用";
        const won = !!result && result.type === "win" && (result.winner === u.side);
        const draw = !!result && result.type === "draw";
        const statusSummary = Object.keys(s.statusOut).map((t) => `${STJP[t] || t}×${s.statusOut[t]}`).join("・");
        const rangeName = near >= mid && near >= far ? "近距離" : far >= mid && far >= near ? "遠距離" : "中距離";
        const rangedWpn = u.winDist > 25;
        // ── 観戦→調整の手がかり（見逃した好機・被フランク・気迫の温存・自分の隙）──
        const missedPunish = Math.max(0, s.openSeen - s.openTaken);
        const flankedHard = s.wasFlanked >= 2;
        const ultUnused = s.ults === 0 && s.resPeak >= 1; // 気迫を満たしたのに必殺を一度も撃たなかった
        const winded = s.winded >= Math.max(3, n * 0.35);
        const overDefensive = atkRatio < 35;
        const dmgEdge = s.dmgDealt - s.dmgTaken;
        const outpaced = fs && fs.dmgDealt > s.dmgDealt * 1.3; // 相手の方が大きく削った＝押し込まれた
        const stratTop = Object.keys(s.strat).sort((a, b) => s.strat[b] - s.strat[a])[0];
        const notes = [], advice = [];
        // 戦いぶり（事実の要約・簡潔に）
        notes.push(`${stratTop ? `「${STRAT_JP[stratTop]}」中心、` : ""}主に${rangeName}（近${near}／中${mid}／遠${far}％）・${overDefensive ? "守勢" : atkRatio > 62 ? "終始攻勢" : "攻守均衡"}（攻撃${atkRatio}％）`);
        if (s.shots >= 6) notes.push(hitRate >= 68 ? `命中が安定（${hitRate}％）` : hitRate <= 42 ? `命中が不安定（${hitRate}％・手数の割に通らず）` : `命中率${hitRate}％`);
        notes.push(`与ダメ${s.dmgDealt}／被ダメ${s.dmgTaken}・${wpnMix}${outpaced ? "（火力で押し込まれた）" : dmgEdge > u.maxHp * 0.4 ? "（撃ち合いを優位に運んだ）" : ""}`);
        if (statusSummary) notes.push(`状態異常を与えた（${statusSummary}）`);
        // 光った技（最大2つだけ拾う）
        const hi = [];
        if (s.punishes > 0) hi.push(`確定反撃×${s.punishes}`);
        if (s.maxCombo >= 2) hi.push(`最大${s.maxCombo}連撃`);
        if (s.ults > 0) hi.push(`必殺×${s.ults}`);
        if (s.grabs > 0) hi.push(`崩し×${s.grabs}`);
        if (s.flankRear + s.flankSide >= 2) hi.push(`側背面取り（背${s.flankRear}／側${s.flankSide}）`);
        if (s.counters > 0) hi.push(`カウンター×${s.counters}`);
        if (s.envThrows > 0) hi.push(`環境叩きつけ×${s.envThrows}`);
        if (hi.length) notes.push(`光った攻め：${hi.slice(0, 3).join("・")}`);
        // 課題の兆候
        if (flankedHard) notes.push(`側背面を取られ被弾が嵩んだ（×${s.wasFlanked}）`);
        if (missedPunish >= 2) notes.push(`相手の隙を${missedPunish}回見逃した（好機に攻めきれず）`);
        if (ultUnused) notes.push(`気迫を満たしたが必殺を温存（${s.ultIdle}ターン未使用）`);
        if (winded) notes.push(`息切れが目立った（攻め急ぎ／持久不足）`);
        if (s.empties > 0) notes.push(`弾切れの場面（${s.empties}回）`);
        if (s.gaveOpening >= 2) notes.push(`大技の空振り等で隙を晒した（×${s.gaveOpening}）`);
        // ── 一言の総評（この一戦の物語）──
        let verdict;
        if (won) verdict = s.dmgTaken < u.maxHp * 0.4 ? "危なげない快勝" : (s.punishes > 0 || s.maxCombo >= 3) ? "好機を捉えて押し切った勝利" : "撃ち合いを制した辛勝";
        else if (draw) verdict = result.text === "相討ち" ? "刺し違えての痛み分け" : "決め手を欠いた引き分け";
        else if (overDefensive && outpaced) verdict = "守勢に回り押し切られた";
        else if (flankedHard) verdict = "側背面を取られ翻弄された";
        else if (winded) verdict = "攻め急ぎ、息切れして失速";
        else if (missedPunish >= 2) verdict = "好機を逃し、決め切れず競り負け";
        else if (ultUnused) verdict = "切り札を抱えたまま競り負け";
        else verdict = "紙一重の競り負け";
        // ── 次の方向性（優先度順・行動で示す。括弧内は寄せる人格軸のヒント）──
        // ④ 各助言に「寄せる軸(axis 0..9)＋方向(dir ±1)」を付与＝UIで押すと該当ダイヤルへ誘導＋1段ナッジ。axis=nullは誘導なし
        const adv = (text, axis, dir) => advice.push({ text, axis: axis == null ? null : axis, dir: dir || 0 });
        if (won) {
          adv("この方針は機能した。長所をさらに尖らせる余地がある。", null);
          if (s.dmgTaken > u.maxHp * 0.6) adv("被弾はやや多め——守りを一段厚く（闘争心↓）すると盤石に。", 0, -1);
          if (ultUnused) adv("気迫を抱えたまま終えた——必殺を仕留めに使えばより楽に勝てる（非情さ↑）。", 7, +1);
          if (missedPunish >= 2) adv(`相手の隙を${missedPunish}回見送った——確定反撃を拾えば完勝に近づく（順応性↑＝相手読み）。`, 5, +1);
        } else {
          if (overDefensive && (outpaced || dmgEdge < 0)) adv("守勢に寄りすぎ——攻めへ振ると展開が動く（闘争心↑）。", 0, +1);
          if (flankedHard) adv(`側背面を${s.wasFlanked}回取られた——回り込みへの警戒と動き直しを（順応性↑）。`, 5, +1);
          if (missedPunish >= 2) adv(`相手の隙を${missedPunish}回見逃した——空振りを咎める確定反撃を狙いたい（非情さ↑）。`, 7, +1);
          if (ultUnused) adv("気迫を溜めたのに必殺不発——仕留めの一撃に使う踏ん切りを（リスク選好↑）。", 1, +1);
          if (winded) adv("攻め急いで息切れ——緩急をつけて終盤に粘りたい（忍耐↑）。", 3, +1);
          if (hitRate <= 42 && s.shots >= 6) adv("攻撃が当たっていない——当てる間合い・タイミングを選ぶ堅実さを（リスク選好↓）。", 1, -1);
          if (rangedWpn && near > far) adv("遠武器なのに近づかれた——距離を保つと武器が活きる（忍耐↑＝間合い管理）。", 3, +1);
          if (!rangedWpn && far > near) adv("近接武器なのに距離が空いた——接近重視に寄せたい（闘争心↑）。", 0, +1);
          if (s.grabs === 0 && hitRate <= 58 && s.shots >= 5) adv("相手の守りが固い——崩しや側背面取りで破りたい（闘争心↑）。", 0, +1);
          if (s.maxCombo < 2 && s.punishes === 0 && atk > 0 && !overDefensive) adv("攻めが単発で途切れがち——畳みかけ・確定反撃で流れを作りたい（好機の食いつき＝非情さ↑）。", 7, +1);
          if (s.empties > 0) adv("弾切れが痛い——撃ち急がず弾を管理したい（規律↑）。", 4, +1);
          if (!advice.length) adv("僅差——細部の詰めで勝てる位置にいる。", null);
        }
        return { name: u.name, side: u.side, hp: `${u.hp}/${u.maxHp}`, weapon: `${u.ranged.name}＋${u.melee.name}`, hitRate, dmgDealt: s.dmgDealt, dmgTaken: s.dmgTaken, crits: s.crits, atkRatio, avgDist: Math.round(s.distSum / n), near, mid, far, wpnMix, status: statusSummary, guile: s.guile, biggest: s.biggest, biggestTurn: s.biggestTurn, verdict, notes, advice: advice.slice(0, 4), won };
      }
      return { turns: turn, arena: arena.name, over, result, plr: one("p", stats.c), cpu: one("c", stats.p) };
    }

    function step() {
      if (over) return { turn, lines: [], events: [], dist: displayDist(), over, result };
      turn++;
      const pre = snapshot(), hpP0 = plr.hp, hpC0 = cpu.hp;
      const preBucket = Math.round(Math.round(clamp((dist(pre.p, pre.c) / maxDist) * 100, 0, 100)) / 10) * 10;
      const preDist = dist(pre.p, pre.c);
      // 向き：各ユニットはターン開始時に相手を見据える（背後を取られたら不利＝側背面の前提）
      { const setFace = (u, fo) => { const dx = fo.x - u.x, dy = fo.y - u.y, l = Math.hypot(dx, dy); if (l > 0.001) { u.faceX = dx / l; u.faceY = dy / l; } }; setFace(plr, cpu); setFace(cpu, plr); } // 真上に重なった時は直前の向きを保持（向き0,0を防ぐ）
      const pStun = plr.stun > 0, cStun = cpu.stun > 0;
      const pFlinch0 = plr.flinch > 0, cFlinch0 = cpu.flinch > 0, pOpen0 = plr.opening > 0, cOpen0 = cpu.opening > 0; // Wave3：怯み/隙は前ターン由来（stun式）
      const pRes0 = plr.resolve || 0, cRes0 = cpu.resolve || 0; // 決断時点の気迫（必殺を撃てたか＝温存の判定用）
      const decP = pStun ? stunnedDecision("p") : decide("p"), decC = cStun ? stunnedDecision("c") : decide("c"); // 同時決定（麻痺中は硬直）
      const dd0 = dist(plr, cpu); // D4狡猾：状況に合った小ズルのみ発動
      const geP = guileEvents("p", { foeAttacks: decC.cand.attack, selfAttacks: decP.cand.attack, foeReads: cpu.cog.oppModelWeight, dist: dd0 });
      const geC = guileEvents("c", { foeAttacks: decP.cand.attack, selfAttacks: decC.cand.attack, foeReads: plr.cog.oppModelWeight, dist: dd0 });
      moveUnit("p", decP.cand); moveUnit("c", decC.cand);   // 同時移動
      if (geP.bait) baitNudge(plr, cpu); if (geC.bait) baitNudge(cpu, plr); // 誘い込み：間合いを少し操作
      if (noDamageTurns >= 4) { // 長い膠着＝場が狭まるように両者を引き寄せ、否応なく接触させる（大アリーナでのカイト無限ループ対策）
        const mx = (plr.x + cpu.x) / 2, my = (plr.y + cpu.y) / 2, pull = Math.min((noDamageTurns - 3) * 2, 10);
        const drawIn = (u) => { const dx = mx - u.x, dy = my - u.y, l = Math.hypot(dx, dy) || 1, st = Math.min(pull, l); u.x = cx(u.x + (dx / l) * st); u.y = cy(u.y + (dy / l) * st); clampUnit(u); };
        drawIn(plr); drawIn(cpu);
      }
      const edgeP = 1 + (geP.exploit ? 0.12 : 0) + (geP.outwit ? 0.1 : 0) + (cOpen0 ? 0.25 : 0), edgeC = 1 + (geC.exploit ? 0.12 : 0) + (geC.outwit ? 0.1 : 0) + (pOpen0 ? 0.25 : 0); // 相手の隙(OPENING)を突くと命中↑
      const defC = defenseOf(decC.cand, cpu), defP = defenseOf(decP.cand, plr); // 回避側の被弾減
      const evP = resolveAttack("p", decP.cand, geC.feint, edgeP, defC), evC = resolveAttack("c", decC.cand, geP.feint, edgeC, defP); // 同時解決（揺さぶり/隙突き＋相手の回避を反映）
      // 鍔迫り合い：双方が近接で噛み合うと押し合い、力(気力+流れ+威力+運)で負けた方の攻撃が乱れ怯む
      let clashWin = null;
      if ((evP.attack === "MELEE" || evP.attack === "CHARGE") && evP.shots && (evC.attack === "MELEE" || evC.attack === "CHARGE") && evC.shots) {
        const pp = plr.stamina + plr.momentum * 0.5 + (evP.dmg || 0) / 50 + rng.range(0, 0.7), cp = cpu.stamina + cpu.momentum * 0.5 + (evC.dmg || 0) / 50 + rng.range(0, 0.7);
        clashWin = pp >= cp ? "p" : "c";
        if (clashWin === "p") { evC.dmg = Math.round((evC.dmg || 0) * 0.4); cpu.flinch = 1; } else { evP.dmg = Math.round((evP.dmg || 0) * 0.4); plr.flinch = 1; }
        evP.clash = evC.clash = true;
      }
      cpu.hp = Math.max(0, cpu.hp - (evP.dmg || 0));         // 同時にダメージ適用（相討ちあり）
      plr.hp = Math.max(0, plr.hp - (evC.dmg || 0));
      if (evP.kb) knockback(plr, cpu);
      if (evC.kb) knockback(cpu, plr);
      // カウンター：回避が読み勝ちすると、生存している回避側が反撃の一閃
      const cntP = plr.hp > 0 ? counterStrike(decP.cand, plr, evC, cpu) : 0, cntC = cpu.hp > 0 ? counterStrike(decC.cand, cpu, evP, plr) : 0;
      if (cntP) { cpu.hp = Math.max(0, cpu.hp - cntP); evP.counter = cntP; }
      if (cntC) { plr.hp = Math.max(0, plr.hp - cntC); evC.counter = cntC; }
      // ===== 崩し（GRAB）三すくみ解決：受け不能でガード/棒立ちに通る。攻撃を当てられる or 回避されると潰れる =====
      let grabLine = null;
      const pGrab = evP.attack === "GRAB", cGrab = evC.attack === "GRAB";
      if (pGrab || cGrab) {
        const pHit = (evP.hits || 0) > 0, cHit = (evC.hits || 0) > 0; // 攻撃が当たっていれば崩しを潰す（崩し側は素手なので自分のhitsは0）
        if (pGrab && cGrab) { // 組み合い＝力比べ（気力＋流れ＋非情さ＋運）
          if (grabReachOK(plr, cpu)) {
            const pp = plr.stamina + plr.momentum * 0.5 + plr.micros.A6 * 0.3 + rng.range(0, 0.7), cp = cpu.stamina + cpu.momentum * 0.5 + cpu.micros.A6 * 0.3 + rng.range(0, 0.7);
            if (pp >= cp) { applyThrow(plr, cpu, evP); evC.grabFail = true; grabLine = `── 組み合い！PLR(${plr.name})が力で投げ勝った。`; }
            else { applyThrow(cpu, plr, evC); evP.grabFail = true; grabLine = `── 組み合い！CPU(${cpu.name})が力で投げ勝った。`; }
            evP.clinch = evC.clinch = true;
          } else { evP.grabWhiff = evC.grabWhiff = true; plr.opening = 1; cpu.opening = 1; }
        } else if (pGrab) {
          if (!grabReachOK(plr, cpu) || evC.dodge) { evP.grabWhiff = true; plr.opening = 1; }   // 間合い外/回避された＝空振り
          else if (cHit) { evP.grabFail = true; plr.opening = 1; }                                // 攻撃を合わされ潰れた（受けたダメージは通常解決済）
          else applyThrow(plr, cpu, evP);                                                         // ガード/棒立ち/リロード等に通る
        } else { // cGrab
          if (!grabReachOK(cpu, plr) || evP.dodge) { evC.grabWhiff = true; cpu.opening = 1; }
          else if (pHit) { evC.grabFail = true; cpu.opening = 1; }
          else applyThrow(cpu, plr, evC);
        }
      }
      const brokeP = chipCover(plr, cpu, evP), brokeC = chipCover(cpu, plr, evC); // 崩れる遮蔽：阻まれた射撃が壁を削る
      // 状態異常：今ターンの命中で付与（麻痺は確率で発動）→ DoTをtick（結果行に反映）
      if (evP.applyStatus) evP.statusType = addStatus(cpu, evP.applyStatus);
      if (evC.applyStatus) evC.statusType = addStatus(plr, evC.applyStatus);
      const tkP = tickStatuses(plr), tkC = tickStatuses(cpu);
      plr.hp = Math.max(0, plr.hp - tkP.dmg); cpu.hp = Math.max(0, cpu.hp - tkC.dmg);
      const fire = tickHazards(); // 燃え広がる炎：今炎の中にいる者を焼く＋延焼
      if (evP.statusType === "burn") igniteFire(cpu.x, cpu.y); // 火炎放射器の着弾点が燃え上がる
      if (evC.statusType === "burn") igniteFire(plr.x, plr.y);
      // 地形ダメージ（溶岩）＋戦況モディファイア（狭まる戦場の外周崩壊／火の海の発火）
      const lavaP = terrainDmg(plr), lavaC = terrainDmg(cpu);
      let ringP = 0, ringC = 0;
      if (mod.ring && turn >= 5) { const ccx = field.w / 2, ccy = field.h / 2, rad = Math.max(field.w, field.h) * 0.5 * Math.max(0.32, 1 - (turn - 5) * 0.06); if (Math.hypot(plr.x - ccx, plr.y - ccy) > rad) ringP = 5; if (Math.hypot(cpu.x - ccx, cpu.y - ccy) > rad) ringC = 5; }
      if (mod.ignite && rng.chance(0.25)) igniteFire(rng.range(12, field.w - 12), rng.range(6, field.h - 6));
      const envP = fire.p + lavaP + ringP, envC = fire.c + lavaC + ringC;
      plr.hp = Math.max(0, plr.hp - envP); cpu.hp = Math.max(0, cpu.hp - envC);
      if (pStun) plr.stun = Math.max(0, plr.stun - 1); // 今ターン硬直した分を消費
      if (cStun) cpu.stun = Math.max(0, cpu.stun - 1);
      // 怯み(FLINCH)・隙(OPENING)の時間経過 → 大ヒットで新たに怯ませる（stun式タイミング）
      if (pFlinch0) plr.flinch = Math.max(0, plr.flinch - 1);
      if (cFlinch0) cpu.flinch = Math.max(0, cpu.flinch - 1);
      if (pOpen0) plr.opening = Math.max(0, plr.opening - 1);
      if (cOpen0) cpu.opening = Math.max(0, cpu.opening - 1);
      const tookP = (evC.dmg || 0) + cntC + tkP.dmg, tookC = (evP.dmg || 0) + cntP + tkC.dmg;
      if (tookC >= 0.22 * cpu.maxHp && cpu.hp > 0) cpu.flinch = 1;
      if (tookP >= 0.22 * plr.maxHp && plr.hp > 0) plr.flinch = 1;
      const swP = trySecondWind("p"), swC = trySecondWind("c"); // 火事場の馬鹿力
      if (!swP && plr.secondWind > 0) plr.secondWind--;
      if (!swC && cpu.secondWind > 0) cpu.secondWind--;
      staminaTick("p", evP); staminaTick("c", evC); // 気力：攻め＝消耗・静止＝回復
      const dealtP = (evP.dmg || 0) + cntP, dealtC = (evC.dmg || 0) + cntC; // 流れ：当てる/食らう/見切る
      momentumTick("p", dealtP, (evC.dmg || 0) + cntC + tkP.dmg, !!(evP.dodge && evC.shots));
      momentumTick("c", dealtC, (evP.dmg || 0) + cntP + tkC.dmg, !!(evC.dodge && evP.shots));
      resolveGain("p", dealtP, (evC.dmg || 0) + cntC + tkP.dmg); resolveGain("c", dealtC, (evP.dmg || 0) + cntP + tkC.dmg); // 気迫の蓄積
      // 畳みかけ：確かなヒットを当て被弾しなければ連撃が伸びる（回避/受け/被弾で途切れる）
      const comboBump = (u, ev, foe, took) => { const solid = ev.hits > 0 && (ev.dmg || 0) >= 0.06 * foe.maxHp; u.combo = solid && took < 0.06 * u.maxHp && u.hp > 0 ? Math.min((u.combo || 0) + 1, 4) : 0; };
      comboBump(plr, evP, cpu, tookP + envP); comboBump(cpu, evC, plr, tookC + envC);
      noDamageTurns = dealtP + dealtC + tkP.dmg + tkC.dmg + envP + envC > 0 ? 0 : noDamageTurns + 1; // アンチストール
      const mvForCpu = geP.disinfo ? falseMove(decP.cand.move) : decP.cand.move, mvForPlr = geC.disinfo ? falseMove(decC.cand.move) : decC.cand.move; // 撹乱：相手モデルへ偽情報
      cpu.oppModel.recent.push(mvForCpu); if (cpu.oppModel.recent.length > 8) cpu.oppModel.recent.shift();
      plr.oppModel.recent.push(mvForPlr); if (plr.oppModel.recent.length > 8) plr.oppModel.recent.shift();
      // 相手の性格推定の観測（plrはcpuを、cpuはplrを観察＝攻め型/守り型を蓄積）
      const obs = (u, fDec, fEv, d) => { const pf = u.oppProfile; pf.n++; if (fDec.cand.attack === "RANGED" || fDec.cand.attack === "MELEE") pf.atk++; if (fDec.cand.move === "ADVANCE") pf.adv++; if (fEv.dodge) pf.dodge++; if (fEv.guard) pf.guard = (pf.guard || 0) + 1; pf.dist += d; };
      obs(plr, decC, evC, preDist); obs(cpu, decP, evP, preDist);
      if (evP.dmg > 0) cpu.hurtAt[preBucket] = (cpu.hurtAt[preBucket] || 0) + evP.dmg;
      if (evC.dmg > 0) plr.hurtAt[preBucket] = (plr.hurtAt[preBucket] || 0) + evC.dmg;
      recordStats("p", decP, evP, geP, (evC.dmg || 0) + cntC + tkP.dmg, preDist, { foeEv: evC, foeOpenPre: cOpen0, resPre: pRes0 });
      recordStats("c", decC, evC, geC, (evP.dmg || 0) + cntP + tkC.dmg, preDist, { foeEv: evP, foeOpenPre: pOpen0, resPre: cRes0 });
      if (cntP) stats.p.dmgDealt += cntP;
      if (cntC) stats.c.dmgDealt += cntC;
      stats.p.hpSeries.push(plr.hp); stats.c.hpSeries.push(cpu.hp);
      const pDead = hpP0 > 0 && plr.hp <= 0, cDead = hpC0 > 0 && cpu.hp <= 0; // ★この決着ターンに倒れた側＋死因を判定し、描写を自然に
      const causeFor = (dead) => {
        const fEv = dead === "p" ? evC : evP, fCnt = dead === "p" ? cntC : cntP, mTick = dead === "p" ? tkP : tkC, mFire = dead === "p" ? fire.p : fire.c, dir = fEv.dmg || 0;
        if (fEv.ult && (fEv.dmg || 0) > 0) return "ult";
        if (fEv.grabHit) return "throw";
        if (fCnt > 0 && fCnt >= dir && fCnt >= mTick.dmg && fCnt >= mFire) return "counter";
        if (mFire > 0 && mFire >= dir && mFire >= mTick.dmg) return "fire";
        if (mTick.dmg > 0 && mTick.dmg >= dir) return "status:" + (mTick.types[0] || "bleed");
        return "attack";
      };
      const lines = narrateTurn(pre, decP, evP, decC, evC, hpP0, hpC0, geP, geC, { p: pDead, c: cDead, causeP: pDead ? causeFor("p") : null, causeC: cDead ? causeFor("c") : null });
      if (tkP.dmg > 0) lines.push({ text: `　　＊PLR(${plr.name}) ${tkP.types.map((t) => D.STATUS_JP[t]).join("・")}で −${tkP.dmg}${plr.hp <= 0 ? "（戦闘不能）" : ""}`, cls: "plr" });
      if (tkC.dmg > 0) lines.push({ text: `　　＊CPU(${cpu.name}) ${tkC.types.map((t) => D.STATUS_JP[t]).join("・")}で −${tkC.dmg}${cpu.hp <= 0 ? "（戦闘不能）" : ""}`, cls: "cpu" });
      if (swP) lines.push({ text: `── 火事場の馬鹿力——PLR(${plr.name})、最後の力を振り絞る！`, cls: "cm" });
      if (swC) lines.push({ text: `── 火事場の馬鹿力——CPU(${cpu.name})、最後の力を振り絞る！`, cls: "cm" });
      if (envP > 0) lines.push({ text: `　　＊PLR(${plr.name}) ${lavaP ? "溶岩に焼かれ" : ringP ? "崩れる外周に呑まれ" : "業火に巻かれ"} −${envP}${plr.hp <= 0 ? "（戦闘不能）" : ""}`, cls: "plr" });
      if (envC > 0) lines.push({ text: `　　＊CPU(${cpu.name}) ${lavaC ? "溶岩に焼かれ" : ringC ? "崩れる外周に呑まれ" : "業火に巻かれ"} −${envC}${cpu.hp <= 0 ? "（戦闘不能）" : ""}`, cls: "cpu" });
      if (brokeP || brokeC) lines.push({ text: `── 遮蔽が音を立てて崩れ落ちた！射線が開ける。`, cls: "cm" });
      if (clashWin) lines.push({ text: `── 鍔迫り合い！${clashWin === "p" ? `PLR(${plr.name})` : `CPU(${cpu.name})`}が力で押し勝った。`, cls: "cm" });
      if (grabLine) lines.push({ text: grabLine, cls: "cm" });
      if (evP.ult) lines.push({ text: `── 気迫炸裂！PLR(${plr.name}) の必殺・${evP.ultName}${evP.whiff ? "——空を切った！" : "！"}`, cls: "cm" });
      if (evC.ult) lines.push({ text: `── 気迫炸裂！CPU(${cpu.name}) の必殺・${evC.ultName}${evC.whiff ? "——空を切った！" : "！"}`, cls: "cm" });
      if (mod.sudden && turn === 12 && plr.hp > 0 && cpu.hp > 0) lines.push({ text: "── サドンデス！ここからは一撃が重くのしかかる。", cls: "cm" });
      // ===== 描画専用イベント（mini.jsの戦闘可視化が読む。乱数非消費・状態非干渉＝決定論を壊さない）=====
      // 最終位置(攻撃者from→相手to)＋既算のev/cntだけを写す。シム状態は一切変更しない。
      const events = [];
      const fxFor = (side, ev, cnt) => {
        const self = side === "p" ? plr : cpu, foe = side === "p" ? cpu : plr;
        const from = { x: self.x, y: self.y }, to = { x: foe.x, y: foe.y };
        const meta = (extra) => Object.assign({ side, from, to, hits: ev.hits || 0, dmg: ev.dmg || 0, crit: (ev.crits || 0) > 0, kb: !!ev.kb, status: ev.statusType || null, flank: ev.flank || null }, extra);
        if (ev.ult && (ev.shots || ev.whiff)) events.push(meta({ type: ev.ultRn ? "ult-ranged" : "ult-melee", whiff: !!ev.whiff }));
        else if (ev.attack === "RANGED" && ev.shots > 0) events.push(meta({ type: "ranged", whiff: (ev.hits || 0) === 0 }));
        else if ((ev.attack === "MELEE" || ev.attack === "CHARGE") && (ev.shots > 0 || (ev.charge && ev.whiff))) events.push(meta({ type: "melee", whiff: (ev.hits || 0) === 0 }));
        if (ev.dodge) events.push({ side, from, to, type: "dodge" });
        if (ev.guard) events.push({ side, from, to, type: "guard" });
        if (ev.grabHit || ev.clinch) events.push({ side, from, to, type: "grab", dmg: ev.dmg || 0 });
        if (cnt > 0) events.push({ side, from, to, type: "counter", hits: 1, dmg: cnt, crit: false });
      };
      fxFor("p", evP, cntP); fxFor("c", evC, cntC);
      result = finishCheck();
      if (result) { over = true; for (const fl of finishNarration(result)) lines.push(fl); }
      return { turn, lines, events, dist: displayDist(), over, result };
    }

    return { step, getAnalysis, get turn() { return turn; }, get over() { return over; }, get result() { return result; }, get plr() { return plr; }, get cpu() { return cpu; }, get arena() { return { name: arena.name, flavor: arena.flavor }; }, get modifier() { return mod.key === "none" ? null : { name: mod.name, flavor: mod.flavor }; }, displayDist, losClear, obstacles, field, maxDist, terrain: arena.terrain, baseTerrainKey: arena.base, get hazards() { return hazards; } };
  };
})();
