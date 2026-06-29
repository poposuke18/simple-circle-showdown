/* squad.js — 分隊戦（N対N）エンジン。1v1の makeBattle は触らず独立。[[分隊戦設計]]
 *   buildUnit/DATA/makeRNG を再利用。戦闘式（命中/被ダメ/側背面/期待ダメ/勝間合い/必殺名）は1v1から移植（数値同一）。
 *   ターゲット選定AI＋貪欲1手評価（先読みなし・期待値＝乱数非消費）＋同時解決。集中砲火・側背面・崩壊の連鎖が創発。
 *   決定論：攻撃ロール=本戦rng、決定は乱数非消費、固定順序(P[0..],C[0..])。描画/集計は非干渉。
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
  const ULT_NAME = { precise: "零距離の一射", auto: "弾幕の嵐", shotgun: "至近の一掃", flame: "業火の渦", mlt: "嵐の連撃", hvy: "全霊の一撃", bal: "会心の一閃" };
  function weaponCat(w, ranged) {
    if (ranged) return w.key === "flamethrower" ? "flame" : w.mode === "charge" || w.key === "marksman" || w.key === "pistol" || w.key === "burst" ? "precise" : w.key === "shotgun" ? "shotgun" : "auto";
    return w.pattern === "multi" ? "mlt" : w.pattern === "heavy" ? "hvy" : "bal";
  }

  SCS.makeSquadBattle = function (teamPChoices, teamCChoices, seed, arenaName, modName) {
    const D = SCS.DATA, S = D.SIM, T = D.TERRAIN, rng = SCS.makeRNG(seed);

    // --- 戦場・戦況（makeBattleと同じ選び方）---
    let arena;
    if (arenaName && arenaName !== "ランダム") arena = D.ARENAS.find((a) => a.name === arenaName) || D.ARENAS[0];
    else arena = D.ARENAS[SCS.makeRNG((seed ^ 0x5bd1e995) >>> 0).int(D.ARENAS.length)];
    let mod;
    if (modName && modName !== "ランダム") mod = D.MODIFIERS.find((m) => m.name === modName) || D.MODIFIERS[0];
    else { const mr = SCS.makeRNG((seed ^ 0x27d4eb2f) >>> 0); let tot = 0; D.MODIFIERS.forEach((m) => (tot += m.weight || 1)); let r = mr.next() * tot; mod = D.MODIFIERS.find((m) => (r -= m.weight || 1) < 0) || D.MODIFIERS[0]; }
    const modAcc = mod.acc || 1, modSta = mod.staMul || 1, modCrit = mod.crit || 0;
    const field = { w: arena.w, h: arena.h }, baseTerrain = T[arena.base];
    const obstacles = arena.obstacles.map((o) => ({ ...o, hp: 70 }));
    const hazards = [];
    const maxDist = Math.hypot(arena.w, arena.h), turnCap = Math.round(S.turnCap * 1.6);
    let turn = 0, over = false, result = null, noDmgTurns = 0;

    // ===== 幾何・地形・命中（1v1から移植）=====
    const cx = (x) => clamp(x, 0, field.w), cy = (y) => clamp(y, 0, field.h);
    function pushOutObstacle(x, y) {
      for (const o of obstacles) { if (o.hp <= 0) continue; if (x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h) { const dl = x - o.x, dr = o.x + o.w - x, dt = y - o.y, db = o.y + o.h - y, m = Math.min(dl, dr, dt, db); if (m === dl) x = o.x - 0.02; else if (m === dr) x = o.x + o.w + 0.02; else if (m === dt) y = o.y - 0.02; else y = o.y + o.h + 0.02; } }
      return { x: cx(x), y: cy(y) };
    }
    function terrainAt(p) { for (const z of arena.terrain) if (ptInRect(p, z)) return T[z.t]; return baseTerrain; }
    const terrainDmg = (p) => terrainAt(p).dmg || 0;
    const losClear = (a, b) => !obstacles.some((r) => r.hp > 0 && segIntersectsRect(a, b, r));
    function hazardAt(p) { let d = 0; for (const h of hazards) if (h.turns > 0 && ptInRect(p, h)) d += h.dmg; return d; }
    function nearestObstacle(p) { let best = null, bd = Infinity; for (const r of obstacles) { if (r.hp <= 0) continue; const ox = r.x + r.w / 2, oy = r.y + r.h / 2, d = Math.hypot(ox - p.x, oy - p.y); if (d < bd) { bd = d; best = { x: ox, y: oy }; } } return best; }
    const cornered = (u) => Math.min(u.x, field.w - u.x, u.y, field.h - u.y) < 7;

    const vulnOf = (u) => 1 + u.statuses.reduce((a, s) => Math.max(a, s.type === "weaken" ? s.amt : 0), 0);
    const slowOf = (u) => u.statuses.reduce((a, s) => Math.min(a, s.type === "slow" ? s.mult : 1), 1);
    const outFac = (u) => (0.7 + 0.3 * clamp(u.stamina, 0, 1)) * (1 + clamp(u.momentum, -1, 1) * 0.07) * (u.flinch > 0 ? 0.7 : 1);
    function dmgMod() { let m = mod.dmgMul || 1; if (mod.sudden && turn >= 12) m *= 1 + (turn - 12) * 0.07; return m; }
    const stepLen = (u, p) => S.baseStep * (0.6 + 0.8 * u.micros.B5) * terrainAt(p).move * slowOf(u) * (0.78 + 0.22 * clamp(u.stamina, 0, 1));
    function shotsFor(r, g) { let n = Math.floor(r); if (g.chance(r - n)) n++; return n; }

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
    function flankOf(att, def) {
      const dx = att.x - def.x, dy = att.y - def.y, l = Math.hypot(dx, dy) || 1, dot = (def.faceX * dx + def.faceY * dy) / l;
      if (dot > 0.45) return { tier: "front", acc: 1, crit: 0, dmg: 1, defMul: 1 };
      if (dot > -0.35) return { tier: "side", acc: 1.07, crit: 0.04, dmg: 1.03, defMul: 0.72 };
      return { tier: "rear", acc: 1.16, crit: 0.10, dmg: 1.10, defMul: 0.45 };
    }
    function expEx0(atk, def, d, los) {
      let dmg = 0;
      if (los) { const rf = d <= atk.ranged.effRange ? 1 : Math.max(0, 1 - (d - atk.ranged.effRange) / atk.ranged.falloff); dmg += atk.ranged.fireRate * atk.ranged.accuracy * rf * (1 - Math.min(0.7, def.micros.B3 * 0.4)) * atk.ranged.damage; }
      if (d <= atk.melee.reach) dmg += atk.melee.rate * 0.9 * (1 - Math.min(0.6, def.micros.B3 * 0.4) * 0.7) * atk.melee.damage;
      return dmg;
    }
    function expEx(atk, def, atkPos, defPos, d, los) {
      let dmg = 0;
      if (los) dmg += atk.ranged.fireRate * rangedHit(atk.ranged, atkPos, defPos, def, d, los, false) * atk.ranged.damage * defMult(defPos);
      if (d <= atk.melee.reach) dmg += atk.melee.rate * meleeHit(def, defPos) * atk.melee.damage * defMult(defPos);
      return dmg * outFac(atk);
    }
    function winDistOf(self, foe) { let best = 18, bv = -Infinity; for (const d of [8, 18, 30, 45, 60, 80, 95]) { if (d > maxDist + 6) continue; const v = expEx0(self, foe, d, true) - expEx0(foe, self, d, true); if (v > bv) { bv = v; best = d; } } return best; }
    // 勝てる間合いを敵【全体】に対して算出（先頭1体の偶然でロールがブレないように＝排他ロール判定の前提を安定化）
    function winDistVsTeam(self, foes) { let best = 18, bv = -Infinity; for (const d of [8, 18, 30, 45, 60, 80, 95]) { if (d > maxDist + 6) continue; let v = 0; for (const f of foes) v += expEx0(self, f, d, true) - expEx0(f, self, d, true); if (v > bv) { bv = v; best = d; } } return best; }
    const prefRangeOf = (u) => clamp(u.winDist + (u.micros.A1 - 0.5) * 2 * 25, 4, maxDist);

    // ===== 状態異常 =====
    function addStatus(u, s) {
      if (s.type === "stun") { if (s.chance && !rng.chance(s.chance)) return null; u.stun = Math.max(u.stun, s.turns); return "stun"; }
      const ex = u.statuses.find((x) => x.type === s.type);
      if (ex) ex.turns = Math.max(ex.turns, s.turns); else u.statuses.push({ ...s });
      return s.type;
    }
    function tickStatuses(u) { let dmg = 0; const types = []; for (const s of u.statuses) { if (s.dmg) { dmg += s.dmg; types.push(s.type); } s.turns--; } u.statuses = u.statuses.filter((s) => s.turns > 0); return { dmg, types }; }
    function igniteFire(x, y) { const w = 10, h = 8; hazards.push({ x: cx(x - w / 2), y: cy(y - h / 2), w, h, turns: 3, dmg: 6 }); if (hazards.length > 24) hazards.shift(); }

    // ===== 分隊の構築・配置 =====
    function mkUnit(choices, team, idx, n) {
      const u = SCS.derive.buildUnit(`${team}-${idx + 1}`, choices);
      const left = team === "P", baseX = left ? Math.max(10, arena.start.p.x) : Math.min(field.w - 10, arena.start.c.x);
      const y = field.h * (idx + 1) / (n + 1);
      Object.assign(u, { team, idx, alive: true, target: null, x: baseX, y: cy(y), faceX: left ? 1 : -1, faceY: 0, idleTurns: 0, label: "待機", guarding: false, peeling: false, _focusCount: 0, _wardRef: null,
        ammo: u.ranged.mag, reloadLeft: 0, charged: false, spread: 0, statuses: [], stun: 0, stamina: 1, momentum: 0, resolve: 0, flinch: 0,
        st: { dealt: 0, taken: 0, kills: 0, shots: 0, hits: 0, crits: 0, ults: 0, flanks: 0, downTurn: 0 } });
      return u;
    }
    const P = teamPChoices.map((c, i) => mkUnit(c, "P", i, teamPChoices.length));
    const C = teamCChoices.map((c, i) => mkUnit(c, "C", i, teamCChoices.length));
    const ALL = P.concat(C);
    const enemiesOf = (u) => (u.team === "P" ? C : P);
    const alliesOf = (u) => (u.team === "P" ? P : C);
    for (const u of ALL) { u.winDist = winDistVsTeam(u, enemiesOf(u)); } // 敵全体に対する勝てる間合い＝ロール判定が編成順でブレない
    // 役割で前後に配置：近接寄り(winDist小)は前線へ・遠距離寄り(winDist大)は後方へ＝後衛(射手)が前衛に守られる編成が成立
    for (const u of ALL) { const fwd = clamp((42 - u.winDist) / 42, -1, 1) * 16; const q = pushOutObstacle(cx(u.x + (u.team === "P" ? fwd : -fwd)), u.y); u.x = q.x; u.y = q.y; }

    const liveEnemies = (u) => enemiesOf(u).filter((e) => e.alive);
    function nearestLiveEnemy(u) { let best = null, bd = Infinity; for (const e of liveEnemies(u)) { const d = dist(u, e); if (d < bd) { bd = d; best = e; } } return best; }
    // ===== 役割（人格→武器/winDistから自動分類・★排他。ラベル/トリニティ挙動に使う）=====
    const isBackline = (u) => u.winDist >= 45;                                   // 後衛＝遠距離志向の射手（守られるべき）
    const isFrontline = (u) => !isBackline(u) && (u.winDist < 40 || u.maxHp >= 100); // 前衛＝近接志向 or 高HPの壁（後衛は高HPでも前衛にしない）
    const hasControl = (u) => u.melee.knockback >= 6 || (u.melee.status && (u.melee.status.type === "slow" || u.melee.status.type === "stun")); // 妨害（鎖鎌/大槌/大剣等）
    const isSupport = (u) => hasControl(u) && (u.micros.D1 >= 0.5 || u.micros.D2 >= 0.5) && u.micros.A2 < 0.85; // 妨害武器＋相手読み＋猪突でない＝ピール役
    const imminentBand = (e) => Math.max(e.melee.reach + 18, 34);                // ★『迫る脅威』＝近接到達ベース（前衛が迎撃に動ける早さ・effRangeで全域発火するのは防ぐ）
    // 守るべき後衛味方＋それを差し迫って脅かす敵（かばう用）。最も近接された1組を返す
    function findWard(u) {
      let best = null, bd = Infinity;
      for (const a of alliesOf(u)) {
        if (!a.alive || a === u || !isBackline(a)) continue;
        const foe = nearestLiveEnemy(a); if (!foe) continue;
        const d = dist(foe, a);
        if (d < bd && d < imminentBand(foe)) { bd = d; best = { ward: a, foe }; }
      }
      return best;
    }
    const teamHpFrac = (team) => { const t = team === "P" ? P : C; let h = 0, m = 0; for (const u of t) { h += Math.max(0, u.hp); m += u.maxHp; } return m ? h / m : 0; };
    const aliveCount = (team) => (team === "P" ? P : C).filter((u) => u.alive).length;

    // ===== ターゲット選定（集中砲火＝キルオーダー収束＋脅威優先＋釣り出し耐性＋ピール）=====
    const sup = isSupport;
    function pickTarget(u) {
      const live = liveEnemies(u);
      if (!live.length) { u._focusCount = 0; u.peeling = false; return null; }
      const iAmSupport = sup(u);
      const myWard = isFrontline(u) ? findWard(u) : null; // 守る後衛がいれば、その後衛に迫る敵を迎撃対象に（前衛が自分の的を追って戦線を離れない＝かばうが成立する前提）
      let best = null, bv = -Infinity, bestPeel = false;
      for (const e of live) {
        const d = dist(u, e), fl = flankOf(u, e);
        let v = -d / maxDist * 1.0;                                   // 近いほど良い
        v += (1 - e.hp / e.maxHp) * (0.55 + u.micros.A6 * 0.9);       // 仕留め（非情ほど低HP優先）
        v += losClear(u, e) ? 0.3 : -0.25;                            // 撃てるか
        v += fl.tier === "rear" ? 0.55 : fl.tier === "side" ? 0.22 : 0; // 側背面の取りやすさ
        // ★脅威優先：敵の出力(DPS見込み)が高い＝危険な敵キャリーを先に落とす（相手読みD1で評価）
        const eThreat = expEx0(e, u, d, true);
        v += clamp(eThreat / 32, 0, 1) * (0.3 + u.micros.D1 * 0.35);
        // ★集中砲火：味方が既に狙う敵に束ねる（規律B4/順応D2で連携↑）＝キルオーダー収束
        const focus = alliesOf(u).filter((a) => a.alive && a !== u && a.target === e).length;
        v += Math.min(focus, 2) * (0.2 + u.micros.B4 * 0.28 + u.micros.D2 * 0.22);
        // ★釣り出し耐性：その敵を追うと【他の】敵の脅威下に晒される＝罠なら見送る（標的自身は除外して二重計上を防ぐ）
        const chaseThreat = threatAt(u, { x: e.x, y: e.y }, e);
        v -= clamp(chaseThreat / 55, 0, 1) * (0.2 + u.micros.D1 * 0.3 + (1 - u.micros.C2) * 0.3);
        // ★迎撃：守る後衛に張り付いた敵を最優先で狙う＝前衛が戦線を離れず割り込める（誇りC6で死守）
        if (myWard && e === myWard.foe) v += 1.2 + u.micros.C6 * 0.5;
        // ★タウント：味方をかばって割り込んでいる敵前衛は『邪魔』＝優先して狙う（前ターンのguardingフラグ）
        if (e.guarding) v += 0.3 + u.micros.A2 * 0.2;
        // ★ピール：サポート資質は後衛味方に近接で張り付いた敵を最優先で剝がしに行く
        let peel = false;
        if (iAmSupport) { for (const a of alliesOf(u)) { if (a.alive && a !== u && isBackline(a) && dist(e, a) <= imminentBand(e)) { peel = true; break; } } }
        if (peel) v += 0.6 + u.micros.D1 * 0.4;
        if (u.target === e && e.alive) v += 0.4 + u.micros.B4 * 0.3; // ヒステリシス（規律）＝狙いを定めた的を無駄に変えない
        if (v > bv) { bv = v; best = e; bestPeel = peel; }
      }
      u.peeling = bestPeel; // ラベル用（_focusCount は step でターゲット確定後に一括集計＝リングと同基準）
      return best;
    }

    // ===== 移動・脅威・セパレーション =====
    function applyMove(u, fp, move) {
      const st = stepLen(u, u), dx = fp.x - u.x, dy = fp.y - u.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      let nx = u.x, ny = u.y;
      if (move === "ADVANCE") { nx += ux * st; ny += uy * st; }
      else if (move === "RETREAT") { nx -= ux * st; ny -= uy * st; }
      else if (move === "STRAFE_L") { nx += -uy * st; ny += ux * st; }
      else if (move === "STRAFE_R") { nx += uy * st; ny += -ux * st; }
      else if (move === "COVER") { const o = nearestObstacle(u); if (o) { const ox = o.x - u.x, oy = o.y - u.y, ol = Math.hypot(ox, oy) || 1; nx += (ox / ol) * st; ny += (oy / ol) * st; } }
      return pushOutObstacle(nx, ny);
    }
    function threatAt(u, pos, except) { // 接近する全敵からの期待被ダメ合計（exceptを除外可＝釣り出し判定で標的自身を二重計上しない）
      let t = 0;
      for (const e of liveEnemies(u)) { if (e === except) continue; const d = dist(pos, e), los = losClear(e, pos); t += expEx(e, u, { x: e.x, y: e.y }, pos, d, los); }
      return t;
    }
    // 点pから線分ab（攻め手→ward）への最短距離＋射影位置t＝割り込み判定
    function segDist(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy; if (l2 < 0.001) return { d: dist(p, a), t: 0 }; let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2; t = clamp(t, 0, 1); return { d: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t }; }
    // ward(狙われた後衛)と攻め手attの【間に実際に割り込んでいる】味方前衛を返す＝ボディブロック対象
    function guardOf(ward, att) {
      for (const g of alliesOf(ward)) { if (g === ward || !g.alive || !g.guarding || g._wardRef !== ward) continue; const s = segDist(g, att, ward); if (s.d < 8 && s.t > 0.12 && s.t < 0.92) return g; }
      return null;
    }
    function sepPenalty(u, pos) { // 味方と重ならない
      let p = 0;
      for (const a of alliesOf(u)) { if (a === u || !a.alive) continue; const d = dist(pos, a); if (d < 8) p += (8 - d) * 1.6; }
      return p;
    }

    // ===== 攻撃チャンネル選択 =====
    function chooseAttack(u, tgt, pos, d2, los2) {
      if (u.reloadLeft > 0) return { attack: "RELOAD" };
      const meleeOk = d2 <= u.melee.reach, rangedOk = los2 && u.ammo > 0 && d2 <= u.ranged.effRange + u.ranged.falloff;
      if (u.resolve >= 1) { // 必殺：気迫満タンで好機なら解放（攻め/非情ほど即撃ち）
        if (meleeOk) return { attack: "ULT", ultKind: "melee" };
        if (los2 && u.ammo > 0) return { attack: "ULT", ultKind: "ranged" };
      }
      if (meleeOk) return { attack: "MELEE" };
      if (rangedOk) return { attack: "RANGED" };
      if (los2 && u.ammo <= 0) return { attack: "RELOAD" };
      return { attack: "NONE" };
    }

    // ===== 1手貪欲評価＝move×attackの最良を選ぶ（先読みなし・乱数非消費）=====
    function decide(u) {
      const tgt = u.target;
      if (!tgt) return { move: "HOLD", attack: "NONE", newPos: { x: u.x, y: u.y }, target: null };
      const fp = { x: tgt.x, y: tgt.y }, pref = prefRangeOf(u);
      // 攻め圧：与ダメが続かない体ほど焦って攻撃価値↑・脅威回避↓（遊兵化＝撃たない超防御型を戦線に引き戻す）
      const desp = Math.min((u.idleTurns || 0) / 6, 1);
      const wAtk = (0.7 + u.micros.A2 * 0.4 + u.micros.A6 * 0.2) * (1 + desp * 0.9), wDef = (0.4 + u.micros.C1 * 0.5 + (1 - u.micros.C2) * 0.35) * (1 - desp * 0.55);
      // かばう：前衛は脅威下の後衛味方と敵の間に割り込む（誇りC6/中央志向B6で強く・差し迫った1組に限定）
      const ward = isFrontline(u) ? findWard(u) : null;
      const interpose = ward ? { x: (ward.ward.x + ward.foe.x) / 2, y: (ward.ward.y + ward.foe.y) / 2 } : null;
      const guardScale = ward ? 0.6 + u.micros.B6 * 0.45 + u.micros.C6 * 0.45 : 0; // 実距離ベース＝offenseと同オーダーで実際に割り込む
      const holdInterDist = interpose ? Math.hypot(u.x - interpose.x, u.y - interpose.y) : 0;
      let best = null;
      for (const mv of MOVES) {
        const np = applyMove(u, fp, mv), d2 = dist(np, fp), los2 = losClear(np, fp);
        const atk = chooseAttack(u, tgt, np, d2, los2);
        let offense = expEx(u, tgt, np, fp, d2, los2);
        if (mv !== "HOLD" && los2 && atk.attack === "RANGED") offense *= u.ranged.moveAccuracy; // 移動射撃は命中が落ちる＝据え置いて撃つ価値を評価に反映
        const threat = threatAt(u, np);
        const rangeFit = -(Math.abs(d2 - pref) / maxDist) * 22;
        const fl = flankOf(np, tgt), flankTerm = (fl.tier === "rear" ? 9 : fl.tier === "side" ? 3.5 : 0);
        const sep = sepPenalty(u, np), hz = hazardAt(np) + terrainDmg(np) * 1.5;
        const interceptTerm = interpose ? -Math.hypot(np.x - interpose.x, np.y - interpose.y) * guardScale : 0; // 割り込み位置に近いほど良い（実距離）
        const v = offense * wAtk - threat * wDef + rangeFit + flankTerm - sep - hz * 1.2 + interceptTerm + (mv === "HOLD" ? 0.2 : 0);
        if (!best || v > best.v) best = { v, move: mv, attack: atk.attack, ultKind: atk.ultKind, newPos: np, d2, los2 };
      }
      // 実際に割り込み位置へ寄った時だけ guarding（ラベルの誤表示を防ぐ＝据え置き/自target攻撃なら かばう表示しない）
      u.guarding = !!interpose && Math.hypot(best.newPos.x - interpose.x, best.newPos.y - interpose.y) < holdInterDist - 0.5;
      u._wardRef = u.guarding && ward ? ward.ward : null; // ボディブロックの守る相手
      best.target = tgt;
      return best;
    }

    // ===== 攻撃解決（攻め手→自target。同時適用のためダメージは後でまとめて反映）=====
    // 間合い/射線は【移動後の最終位置】で再計算（全体が動いた後に解決＝同時性を保つ）
    function resolveAttack(u, dec) {
      const tgt = dec.target; if (!tgt || !tgt.alive) return null;
      const ev = { att: u, def: tgt, attack: dec.attack, move: dec.move };
      const fp = { x: tgt.x, y: tgt.y }, d2 = dist(u, tgt), los2 = losClear(u, tgt);
      const fl = flankOf(u, tgt), corner = cornered(tgt) ? 1 : 0, fdEvMul = fl.defMul * (corner ? 0.72 : 1);
      const precise = clamp(u.micros.A5 * 0.5 + u.micros.B4 * 0.3 - u.micros.A4 * 0.4, 0, 1);
      if (dec.attack === "RELOAD") { if (u.reloadLeft === 0) u.reloadLeft = u.ranged.reloadTurns; u.reloadLeft--; u.spread = 0; if (u.reloadLeft <= 0) u.ammo = u.ranged.mag; ev.reloading = true; return ev; }
      if (dec.attack === "ULT") {
        u.resolve = 0; u.st.ults++;
        const rn = dec.ultKind === "ranged", w = rn ? u.ranged : u.melee, cat = weaponCat(w, rn);
        ev.ult = true; ev.ultName = ULT_NAME[cat]; ev.ultRn = rn; ev.shots = 1;
        const reachOK = rn ? los2 && u.ammo > 0 : d2 <= u.melee.reach + 2;
        if (!reachOK) { ev.whiff = true; return ev; }
        if (rn) u.ammo = Math.max(0, u.ammo - Math.ceil(w.fireRate));
        const hcBase = rn ? rangedHit(w, u, fp, tgt, d2, true, dec.move !== "HOLD") : meleeHit(tgt, fp);
        const hc = Math.min(1, hcBase * fl.acc * (1 + corner * 0.1) + 0.18);
        if (rng.chance(hc)) { let dd = w.damage * (rn ? 2.0 : 1.9); if (rng.chance(clamp(0.3 + fl.crit, 0, 0.55))) { dd *= w.critMult || 1.8; ev.crit = true; } ev.dmg = Math.round(dd * defMult(fp) * vulnOf(tgt) * outFac(u) * fl.dmg * dmgMod()); ev.hits = 1; ev.kb = true; if (w.status) ev.applyStatus = w.status; }
        else ev.whiff = true;
        if (ev.hits && fl.tier !== "front") { ev.flank = fl.tier; u.st.flanks++; }
        return ev;
      }
      if (dec.attack === "RANGED") {
        const rw = u.ranged;
        if (rw.mode === "charge" && !u.charged) { u.charged = true; ev.charging = true; return ev; }
        if (u.ammo <= 0) { ev.empty = true; return ev; }
        let shots = rw.mode === "charge" ? 1 : shotsFor(rw.fireRate, rng);
        if (precise > 0.55 && rw.mode !== "charge") shots = Math.max(1, Math.round(shots * (1 - precise * 0.5)));
        shots = Math.min(shots, u.ammo); u.ammo -= shots; if (rw.mode === "charge") u.charged = false;
        const critChance = clamp(rw.crit + precise * 0.2 + (rw.mode === "charge" ? 0.25 : 0) + modCrit + fl.crit, 0, 0.78);
        const hc = Math.min(1, rangedHit(rw, u, fp, tgt, d2, true, dec.move !== "HOLD") * (1 - u.spread) * fl.acc * (1 + corner * 0.05));
        let hits = 0, dmg = 0, crits = 0;
        for (let i = 0; i < shots; i++) if (rng.chance(hc)) { hits++; let dd = rw.damage; if (rng.chance(critChance)) { dd *= rw.critMult; crits++; } dmg += dd * defMult(fp) * vulnOf(tgt); }
        u.st.shots += shots; u.st.hits += hits; u.st.crits += crits;
        ev.shots = shots; ev.hits = hits; ev.crit = crits > 0; ev.dmg = Math.round(dmg * outFac(u) * fl.dmg * dmgMod());
        if (rw.mode === "auto" && shots > 0) u.spread = Math.min(0.5, u.spread + rw.spreadGrowth * (1 - u.micros.B4 * 0.5));
        if (hits > 0 && rw.status) ev.applyStatus = rw.status;
        if (hits > 0 && fl.tier !== "front") { ev.flank = fl.tier; u.st.flanks++; }
        return ev;
      }
      u.spread = Math.max(0, u.spread - 0.2);
      if (dec.attack === "MELEE" && d2 <= u.melee.reach) {
        const mw = u.melee;
        let swings = mw.pattern === "heavy" ? 1 : shotsFor(mw.rate, rng);
        if (precise > 0.55 && mw.pattern === "multi") swings = Math.max(1, Math.round(swings * (1 - precise * 0.4)));
        const critChance = clamp(mw.crit + precise * 0.2 + modCrit + fl.crit, 0, 0.68);
        const hc = Math.min(1, meleeHit(tgt, fp) * fl.acc * (1 + corner * 0.05));
        let hits = 0, dmg = 0, crits = 0;
        for (let i = 0; i < swings; i++) if (rng.chance(hc)) { hits++; let dd = mw.damage; if (rng.chance(critChance)) { dd *= mw.critMult; crits++; } dmg += dd * defMult(fp) * vulnOf(tgt); }
        u.st.shots += swings; u.st.hits += hits; u.st.crits += crits;
        ev.shots = swings; ev.hits = hits; ev.crit = crits > 0; ev.dmg = Math.round(dmg * outFac(u) * fl.dmg * dmgMod()); ev.kb = hits > 0 && mw.knockback > 0;
        if (hits > 0 && mw.status) ev.applyStatus = mw.status;
        if (hits > 0 && fl.tier !== "front") { ev.flank = fl.tier; u.st.flanks++; }
        return ev;
      }
      return ev; // NONE / 届かず
    }

    function knockback(att, tgt) { const dx = tgt.x - att.x, dy = tgt.y - att.y, len = Math.hypot(dx, dy) || 1, kb = att.melee.knockback || 4; const q = pushOutObstacle(cx(tgt.x + (dx / len) * kb), cy(tgt.y + (dy / len) * kb)); tgt.x = q.x; tgt.y = q.y; }

    // 動的ラベル：この体の今ターンの役割行動を1語で（HUD/レーダーが表示・数値非公開のまま挙動を可読化）
    function dynLabel(u, ev, dec) {
      if (!u.alive) return "戦闘不能";
      if (ev && ev.ult) return "必殺";
      if (u.guarding) return "かばう";
      if (u.peeling) return "剝がし";
      if ((u._focusCount || 0) >= 2 && ev && (ev.hits || 0) > 0) return "集中";
      if (ev && ev.flank === "rear") return "背後";
      if (ev && ev.flank === "side") return "側面";
      if (dec && dec.attack === "RELOAD") return "装填";
      if (ev && ev.attack === "RANGED" && (ev.shots || 0) > 0) return "射撃";
      if (ev && ev.attack === "MELEE" && (ev.shots || 0) > 0) return "斬";
      if (dec && dec.move === "RETREAT") return "退避";
      if (dec && dec.move === "ADVANCE") return "詰め";
      return "様子見";
    }

    // ===== 1ターン =====
    function step() {
      if (over) return { turn, lines: [], events: [], over, result };
      turn++;
      const lines = [], events = [];
      // 1) ターゲット選定（固定順＝集中砲火の創発・決定論）
      for (const u of ALL) if (u.alive) u.target = pickTarget(u);
      // 集中度を一括集計（各敵の被ターゲット数）＝ラベル『集中』とレーダーのリングを同基準(>=2)に揃える
      { const tc = new Map(); for (const u of ALL) if (u.alive && u.target) tc.set(u.target, (tc.get(u.target) || 0) + 1); for (const u of ALL) u._focusCount = (u.alive && u.target) ? (tc.get(u.target) || 0) : 0; }
      // 2) 意思決定
      const decs = new Map();
      for (const u of ALL) if (u.alive) decs.set(u, decide(u));
      // 3) 同時移動
      for (const u of ALL) if (u.alive) { const d = decs.get(u); u.x = d.newPos.x; u.y = d.newPos.y; }
      // 3.5) アンチストール：膠着したら【交戦圏外の体だけ】を最寄り敵へ引き寄せ強制接触。
      //      ★既に射程＆射線で交戦できている射手は引き寄せない＝後衛が前に引きずり出されて溶ける現象を防ぐ
      if (noDmgTurns >= 3) {
        const pull = Math.min((noDmgTurns - 2) * 2.5, 12);
        for (const u of ALL) {
          if (!u.alive) continue;
          const e = nearestLiveEnemy(u); if (!e) continue;
          const d = dist(u, e), reach = Math.max(u.melee.reach, u.ranged.effRange);
          if (d <= reach && losClear(u, e)) continue; // 交戦圏内（当てられる距離＋射線）なら据え置き
          const dx = e.x - u.x, dy = e.y - u.y, l = Math.hypot(dx, dy) || 1, st = Math.min(pull, l);
          const q = pushOutObstacle(cx(u.x + (dx / l) * st), cy(u.y + (dy / l) * st)); u.x = q.x; u.y = q.y;
        }
      }
      // 4) 向き（自targetを見据える）
      for (const u of ALL) if (u.alive && u.target) { const dx = u.target.x - u.x, dy = u.target.y - u.y, l = Math.hypot(dx, dy); if (l > 0.001) { u.faceX = dx / l; u.faceY = dy / l; } }
      // 5) 同時解決（ダメージ等は accに溜めて後で適用）
      const acc = new Map(); // tgt -> { dmg, kbFrom, status[] }
      const evs = [];
      for (const u of ALL) {
        if (!u.alive) continue;
        const ev = resolveAttack(u, decs.get(u));
        if (!ev) continue;
        evs.push(ev);
        // ★かばう＝ボディブロック：tgtを守る前衛が攻め手との間に割り込んでいれば被ダメの半分を肩代わり（前衛が後衛の盾に）
        if ((ev.dmg || 0) > 0 && (ev.hits || 0) > 0 && ev.def) {
          const g = guardOf(ev.def, u);
          if (g && g !== u) { const cut = Math.round(ev.dmg * 0.5); ev.dmg -= cut; const ga = acc.get(g) || { dmg: 0, status: [], kbFrom: null }; ga.dmg += cut; acc.set(g, ga); ev.guardedBy = g; ev.guardCut = cut; }
        }
        const tgt = ev.def;
        if (ev.dmg > 0 || ev.applyStatus || ev.kb) {
          const a = acc.get(tgt) || { dmg: 0, status: [], kbFrom: null };
          a.dmg += ev.dmg || 0;
          if (ev.applyStatus) a.status.push(ev.applyStatus);
          if (ev.kb) a.kbFrom = u;
          acc.set(tgt, a);
        }
        // 描画イベント（mini squad radar が読む）
        const side = u.team === "P" ? "p" : "c", from = { x: u.x, y: u.y }, to = { x: tgt.x, y: tgt.y };
        if (ev.ult && (ev.shots || ev.whiff)) events.push({ side, team: u.team, type: ev.ultRn ? "ult-ranged" : "ult-melee", from, to, hits: ev.hits || 0, dmg: ev.dmg || 0, crit: !!ev.crit, whiff: !!ev.whiff });
        else if (ev.attack === "RANGED" && ev.shots > 0) events.push({ side, team: u.team, type: "ranged", from, to, hits: ev.hits || 0, dmg: ev.dmg || 0, crit: !!ev.crit, whiff: (ev.hits || 0) === 0, status: ev.applyStatus ? ev.applyStatus.type : null });
        else if (ev.attack === "MELEE" && ev.shots > 0) events.push({ side, team: u.team, type: "melee", from, to, hits: ev.hits || 0, dmg: ev.dmg || 0, crit: !!ev.crit, whiff: (ev.hits || 0) === 0 });
      }
      // 6) 適用（同時＝相討ちあり）
      const deadThisTurn = [];
      for (const [tgt, a] of acc) {
        const before = tgt.hp;
        tgt.hp = Math.max(0, tgt.hp - a.dmg);
        tgt.st.taken += Math.min(before, a.dmg);
        for (const s of a.status) { const ty = addStatus(tgt, s); if (ty === "burn") igniteFire(tgt.x, tgt.y); }
        if (a.kbFrom) knockback(a.kbFrom, tgt);
      }
      // 与ダメ記録（撃破は適用後に判定するので、ここで攻め手のdealtを反映）
      for (const ev of evs) if (ev.dmg > 0) ev.att.st.dealt += ev.dmg;
      // 状態異常DoT＋地形/ハザード（環境ダメージは膠着判定に算入）
      let envDmg = 0;
      for (const u of ALL) { if (!u.alive) continue; const tk = tickStatuses(u); if (tk.dmg) { u.hp = Math.max(0, u.hp - tk.dmg); envDmg += tk.dmg; lines.push({ text: `　　＊${u.name} ${tk.types.map((t) => D.STATUS_JP[t]).join("・")}で −${tk.dmg}`, cls: u.team === "P" ? "plr" : "cpu" }); } }
      // 燃え広がる炎の延焼＋立つ者を焼く
      for (const h of hazards) { if (h.turns <= 0) continue; h.turns--; for (const u of ALL) { if (u.alive && ptInRect(u, h)) { u.hp = Math.max(0, u.hp - h.dmg); envDmg += h.dmg; } } }
      for (const u of ALL) { if (!u.alive) continue; const lv = terrainDmg(u); if (lv) { u.hp = Math.max(0, u.hp - lv); envDmg += lv; } }
      // ハザード掃除
      for (let i = hazards.length - 1; i >= 0; i--) if (hazards[i].turns <= 0) hazards.splice(i, 1);
      // 7) 死亡判定＋撃破帰属（倒れた敵に当てた攻撃者のうち最大ダメージへ）
      for (const u of ALL) { if (u.alive && u.hp <= 0) { u.alive = false; u.st.downTurn = turn; deadThisTurn.push(u); } }
      for (const u of deadThisTurn) { let best = null; for (const ev of evs) if (ev.def === u && (ev.dmg || 0) > 0) { if (!best || ev.dmg > best.dmg) best = ev; } if (best) { best._killed = u; best.att.st.kills++; } }
      // 8) リソース更新
      for (const u of ALL) {
        if (!u.alive) continue;
        const dealt = u.st.dealt, taken = u.st.taken; // 累積だが増分で十分（簡易）
        const a = acc.get(u); const tookNow = a ? a.dmg : 0;
        const dec = decs.get(u), attacked = dec && (dec.attack === "RANGED" || dec.attack === "MELEE" || dec.attack === "ULT");
        u.stamina = clamp(u.stamina + (attacked ? -0.09 * modSta : 0.07), 0, 1);
        u.flinch = u.flinch > 0 ? u.flinch - 1 : 0;
        if (tookNow >= 0.22 * u.maxHp) u.flinch = 1;
      }
      // 与/被ダメ→momentum/resolve（このターン分）
      const dealtNow = new Map(); let directDmg = 0; for (const ev of evs) if (ev.dmg > 0) { dealtNow.set(ev.att, (dealtNow.get(ev.att) || 0) + ev.dmg); directDmg += ev.dmg; }
      for (const u of ALL) {
        if (!u.alive) continue;
        const d = dealtNow.get(u) || 0, a = acc.get(u), tk = a ? a.dmg : 0;
        u.momentum = clamp(u.momentum + (d - tk) / 60, -1, 1);
        u.resolve = clamp(u.resolve + (d + tk) / u.maxHp * 0.5, 0, 1);
      }
      noDmgTurns = directDmg + envDmg > 0 ? 0 : noDmgTurns + 1; // 膠着検知（次ターンのアンチストール引き寄せに使う）
      for (const u of ALL) if (u.alive) u.idleTurns = (dealtNow.get(u) || 0) > 0 ? 0 : u.idleTurns + 1; // 個体の遊兵化検知（攻め圧の累積）
      // 動的ラベル（今ターンの役割行動を1語で・HUD/レーダー用）
      const evByAtt = new Map(); for (const ev of evs) if (!evByAtt.has(ev.att)) evByAtt.set(ev.att, ev);
      for (const u of ALL) u.label = dynLabel(u, evByAtt.get(u), decs.get(u));

      // ===== 描写フィード（注目イベントを拾う）=====
      const npc = (u) => `<span class="${u.team === 'P' ? 'np' : 'nc'}">${u.name}</span>`;
      // KO
      for (const ev of evs) if (ev._killed) lines.push({ text: `── ${npc(ev.att)} が ${npc(ev._killed)} を撃破！${ev.ult ? `（必殺・${ev.ultName}）` : ev.flank === "rear" ? "（背後から）" : ""}`, cls: "cm" });
      for (const u of deadThisTurn) if (!evs.some((ev) => ev._killed === u)) lines.push({ text: `── ${npc(u)} 力尽きる。`, cls: "cm" });
      // 必殺（撃破に紐づかなかったもの）
      for (const ev of evs) if (ev.ult && !ev._killed) lines.push({ text: `── 気迫炸裂！${npc(ev.att)} の必殺・${ev.ultName}${ev.whiff ? "——空を切った！" : `、${npc(ev.def)}へ −${ev.dmg}！`}`, cls: "cm" });
      // かばう（ボディブロックで肩代わり・notable のみ）
      { let topG = null; for (const ev of evs) if (ev.guardedBy && (ev.guardCut || 0) >= 10 && (!topG || ev.guardCut > topG.guardCut)) topG = ev; if (topG) lines.push({ text: `── ${npc(topG.guardedBy)} が ${npc(topG.def)} をかばい、${topG.guardCut} を肩代わりした。`, cls: "cm" }); }
      // 大ヒット（上位2件・KO/必殺以外）
      const bigs = evs.filter((ev) => (ev.dmg || 0) > 0 && !ev._killed && !ev.ult).sort((a, b) => b.dmg - a.dmg).slice(0, 2);
      for (const ev of bigs) if (ev.dmg >= 0.14 * ev.def.maxHp || ev.crit || ev.flank) lines.push({ text: `${npc(ev.att)} が ${npc(ev.def)} を${ev.flank === "rear" ? "背後から" : ev.flank === "side" ? "側面から" : ""}捉える${ev.crit ? "——会心！" : ""} −${ev.dmg}`, cls: ev.att.team === "P" ? "ex" : "ex" });
      // その他サマリ
      const hitN = evs.filter((ev) => (ev.hits || 0) > 0).length, shown = lines.filter((l) => l.cls === "cm" || l.cls === "ex").length;
      if (hitN > shown) lines.push({ text: `　…両軍が各所で交戦（命中 ${hitN} 件）`, cls: "dim" });
      lines.push({ text: `　└ 残存 PLR ${aliveCount("P")}/${P.length}（HP${Math.round(teamHpFrac("P") * 100)}％）・CPU ${aliveCount("C")}/${C.length}（HP${Math.round(teamHpFrac("C") * 100)}％）`, cls: "dim" });

      // 9) 勝敗
      result = finishCheck();
      if (result) { over = true; for (const fl of finishNarration(result)) lines.push(fl); }
      return { turn, lines, events, over, result };
    }

    function finishCheck() {
      const pa = aliveCount("P"), ca = aliveCount("C");
      if (pa <= 0 && ca <= 0) return { type: "draw", text: "両軍全滅" };
      if (ca <= 0) return { type: "win", winner: "PLR", text: "殲滅" };
      if (pa <= 0) return { type: "win", winner: "CPU", text: "殲滅" };
      if (turn >= turnCap) { const pf = teamHpFrac("P"), cf = teamHpFrac("C"); if (Math.abs(pf - cf) < 0.05) return { type: "draw", text: "時間切れ・互角" }; return { type: "win", winner: pf > cf ? "PLR" : "CPU", text: "時間切れ・HP判定" }; }
      return null;
    }
    function finishNarration(r) {
      if (r.type === "draw") return [{ text: `══ 決着：${r.text}。両分隊、相果てる。 ══`, cls: "turnhdr" }];
      const win = r.winner === "PLR" ? "あなたの分隊" : "敵分隊";
      return [{ text: `══ 決着：${r.text}！ ${win}が戦場を制した。 ══`, cls: "turnhdr" }];
    }

    // ===== 分析（分隊サマリ＋各体）=====
    function getAnalysis() {
      function unitCard(u) {
        const won = !!result && result.type === "win" && (result.winner === (u.team === "P" ? "PLR" : "CPU"));
        const role = SCS.ui && SCS.ui.styleOf ? SCS.ui.styleOf(u) : "";
        const hitRate = u.st.shots ? Math.round((u.st.hits / u.st.shots) * 100) : 0;
        return { name: u.name, team: u.team, alive: u.alive, hp: `${Math.max(0, u.hp)}/${u.maxHp}`, weapon: `${u.ranged.name}＋${u.melee.name}`, role,
          dealt: u.st.dealt, taken: u.st.taken, kills: u.st.kills, hitRate, crits: u.st.crits, ults: u.st.ults, flanks: u.st.flanks, downTurn: u.st.downTurn, won };
      }
      // 撃破帰属の集計（evベースで step 内では一時的なので、ここは downTurn から近似不可→killsはstepで加算）
      function squad(team) {
        const t = team === "P" ? P : C, cards = t.map(unitCard);
        const dealt = cards.reduce((a, c) => a + c.dealt, 0), taken = cards.reduce((a, c) => a + c.taken, 0), kills = cards.reduce((a, c) => a + c.kills, 0);
        let mvp = null, silent = null;
        for (const c of cards) { if (!mvp || c.dealt > mvp.dealt) mvp = c; if (!silent || c.dealt < silent.dealt) silent = c; }
        const survivors = cards.filter((c) => c.alive).length;
        const notes = [];
        if (mvp) notes.push(`主力＝${mvp.name}（与ダメ${mvp.dealt}・撃破${mvp.kills}）`);
        if (silent && cards.length > 1 && silent !== mvp && silent.dealt < mvp.dealt * 0.4) notes.push(`${silent.name}が機能せず（与ダメ${silent.dealt}）＝役割/編成の見直し余地`);
        const firstDown = cards.filter((c) => c.downTurn > 0).sort((a, b) => a.downTurn - b.downTurn)[0];
        if (firstDown) notes.push(`${firstDown.name}が最初に脱落（T${firstDown.downTurn}）`);
        return { team, cards, dealt, taken, kills, survivors, notes };
      }
      return { turns: turn, arena: arena.name, mod: mod.key === "none" ? null : mod.name, over, result, plr: squad("P"), cpu: squad("C") };
    }

    // 撃破帰属（kills）は step 解決後に確定するので、step内で加算する
    return {
      step, getAnalysis,
      get turn() { return turn; }, get over() { return over; }, get result() { return result; },
      get teams() { return { P, C }; }, get arena() { return { name: arena.name, flavor: arena.flavor }; },
      get modifier() { return mod.key === "none" ? null : { name: mod.name, flavor: mod.flavor }; },
      field, obstacles, maxDist, losClear, terrain: arena.terrain, baseTerrainKey: arena.base, get hazards() { return hazards; },
      teamHpFrac, aliveCount,
    };
  };
})();
