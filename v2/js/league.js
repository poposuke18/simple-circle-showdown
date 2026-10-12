/* v2/js/league.js — リーグ（Obsidian [[v2ゲーム設計]] v2.k5.league・連戦の状態 v2.s4.cond）。
 * あなた＋ライバル7部隊（写し身は除く）の総当たり7節。勝ち3・引き分け1・負け0。
 * あなたの試合は観戦し、同じ節のほかの3試合は裏で同じエンジンに戦わせる（ホーム側の本拠地と天気）。
 * 連戦の状態：部隊ごとに隊長（性格から自動）と信頼、駒ごとに体力（疲労）と士気が節をまたいで残り、次の試合に効く。相手部隊も同じ。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const W = SCS2.world;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const RIV = W.RIVALS.filter((r) => !r.mirror);
  const TEAMS = ["you"].concat(RIV.map((r) => r.key));
  const rivalOf = (k) => RIV.find((r) => r.key === k) || null;

  // 組み合わせ：円卓方式（1つ固定・残りを回す）。シーズンごとに並びを混ぜる
  const schedCache = new Map();
  function schedule(season) {
    if (schedCache.has(season)) return schedCache.get(season);
    const g = SCS.makeRNG(W.hashStr("league-" + season)), ids = TEAMS.slice(1);
    for (let i = ids.length - 1; i > 0; i--) { const j = g.int(i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const arr = ["you"].concat(ids), n = arr.length, rounds = [], homes = {};
    for (let r = 0; r < n - 1; r++) {
      const m = [];
      for (let i = 0; i < n / 2; i++) {                                                      // 前がホーム（ホームの少ない方を前に＝3〜4回ずつ）
        const a = arr[i], b = arr[n - 1 - i], ha = homes[a] || 0, hb = homes[b] || 0, aHome = ha < hb || (ha === hb && (r + i) % 2 === 0);
        const p = aHome ? [a, b] : [b, a]; homes[p[0]] = (homes[p[0]] || 0) + 1; m.push(p);
      }
      rounds.push(m);
      arr.splice(1, 0, arr.pop());
    }
    schedCache.set(season, rounds);
    return rounds;
  }
  // ===== 連戦の状態（v2.s4.cond）=====
  const condFresh = () => { const cond = {}; for (const k of TEAMS) cond[k] = { trust: 0.6, units: [0, 1, 2].map(() => ({ fat: 0, mor: 0 })) }; return cond; };
  const condOk = (c) => !!c && TEAMS.every((k) => c[k] && Number.isFinite(c[k].trust) && Array.isArray(c[k].units) && c[k].units.length === 3 && c[k].units.every((u) => u && Number.isFinite(u.fat) && Number.isFinite(u.mor)));
  const ensureCond = (L) => { if (!condOk(L.cond)) L.cond = condFresh(); return L.cond; };   // 古い保存には無い
  // 隊長＝性格から（v2.s4.cond.lead）：規律・誇り・忍耐・順応性。同点は並びの先
  function leaderOf(choices) {
    let best = 0, bv = -Infinity;
    choices.forEach((c, i) => { const mv = SCS.derive.buildUnit("x", c).mv, v = 0.4 * mv[4] + 0.25 * mv[6] + 0.2 * mv[3] + 0.15 * mv[5]; if (v > bv + 1e-9) { bv = v; best = i; } });
    return best;
  }
  // エンジンに渡す形
  function condFor(L, key, choices) { const c = ensureCond(L)[key]; return { lead: leaderOf(choices), trust: c.trust, units: c.units.map((u) => ({ fat: u.fat, mor: u.mor })) }; }
  // 試合の後に更新（v2.s4.cond.fat / mor / lead）。units＝エンジンの駒（u.st・micros・coop・mv を読む）、res＝その部隊から見て w/l/d
  function settle(L, key, units, res, turns, leadIdx) {
    const c = ensureCond(L)[key], leader = units[leadIdx] || null, down = units.filter((u) => !u.alive).length;
    units.forEach((u, i) => {
      const cu = c.units[i]; if (!cu) return;
      const C5 = u.micros.C5, coop = u.coop, lone = coop < 0.35;
      let d = res === "w" ? 0.25 : res === "l" ? -0.25 : 0; if (lone && d < 0) d *= 0.5;
      d += u.st.kills * 0.12 * (lone ? 1.5 : 1) + u.st.flanks * 0.04;
      if (!u.alive) d -= 0.2;
      d -= (down - (u.alive ? 0 : 1)) * 0.08 * coop;
      if (leader && !leader.alive && leader !== u) d -= 0.1 * c.trust;
      d *= 1 - 0.7 * C5;                                                                   // 冷静な駒は揺れにくい
      cu.mor = clamp(cu.mor * 0.6 + d, -1, 1);
      const hpf = u.alive ? clamp(u.hp / u.maxHp, 0, 1) : 0, gain = 0.15 * (1 - hpf) + (u.alive ? 0 : 0.2) + 0.1 * Math.min(1, u.st.winded / Math.max(1, turns));   // 倒れると0.35（一度で「疲れが残る」）
      cu.fat = clamp(cu.fat * (0.45 - 0.12 * Math.max(0, u.mv[3])) + gain, 0, 1);                 // 節の間に回復（忍耐が強いほど）
    });
    let t = res === "w" ? 0.12 : res === "l" ? -0.12 : 0;
    if (leader) { if (!leader.alive) t -= 0.1; if (leader.st.kills > 0 && units.every((u) => u.st.kills <= leader.st.kills)) t += 0.05; }
    c.trust = clamp(c.trust + t, 0.15, 1);
  }
  // 画面用の言葉（v2.s4.cond.ui）
  const fatWord = (f) => (f < 0.15 ? "万全" : f < 0.35 ? "少し疲れ" : f < 0.55 ? "疲れが残る" : "消耗が激しい");
  const morWord = (m) => (m > 0.4 ? "高い" : m > 0.1 ? "やや高い" : m > -0.1 ? "普通" : m > -0.4 ? "やや低い" : "低い");
  const trustWord = (t) => (t > 0.75 ? "厚い" : t > 0.45 ? "普通" : "薄い");

  function fresh(season) {
    const table = {}; for (const k of TEAMS) table[k] = { p: 0, w: 0, d: 0, l: 0, pts: 0 };
    return { season, round: 0, table, log: [], cond: condFresh() };
  }
  const nat = (v) => Number.isInteger(v) && v >= 0;
  const valid = (L) => !!L && Number.isInteger(L.season) && L.season >= 1 && Number.isInteger(L.round) && L.round >= 0 && L.round <= TEAMS.length - 1
    && !!L.table && TEAMS.every((k) => { const t = L.table[k]; return t && nat(t.p) && nat(t.w) && nat(t.d) && nat(t.l) && nat(t.pts); })
    && Array.isArray(L.log) && L.log.length === L.round && L.log.every((r) => Array.isArray(r) && r.every((m) => m && TEAMS.includes(m.a) && TEAMS.includes(m.b) && (m.res === "a" || m.res === "b" || m.res === "d")))
    && (L.pending == null || (Number.isInteger(L.pending.round) && Number.isFinite(L.pending.seed)));

  // ほかの試合を裏で戦わせる（ホーム側＝前の部隊の本拠地と天気）。L を渡すと連戦の状態を使い、終わったら更新する
  function simulate(ka, kb, seed, L) {
    const A = rivalOf(ka), B = rivalOf(kb), home = A, arena = W.arenaFor(home);
    const opts = { formation: 0.6, brain: { P: "v3", C: "v3" } };
    if (L) opts.cond = { P: condFor(L, ka, A.squad), C: condFor(L, kb, B.squad) };
    const b = SCS.makeSquadBattle3(A.squad.map((c) => c.slice()), B.squad.map((c) => c.slice()), seed, arena.name, W.modOf(arena), A.form, B.form, A.names.slice(), B.names.slice(), opts);
    let n = 0; while (!b.over && n++ < 200) b.step();
    const r = b.result || {}, res = r.type === "draw" || !b.over ? "d" : r.winner === "PLR" ? "a" : "b";
    if (L) { settle(L, ka, b.teams.P, res === "a" ? "w" : res === "b" ? "l" : "d", b.turn, opts.cond.P.lead); settle(L, kb, b.teams.C, res === "b" ? "w" : res === "a" ? "l" : "d", b.turn, opts.cond.C.lead); }
    return res;
  }
  function apply(L, a, b, res) {
    const ta = L.table[a], tb = L.table[b]; ta.p++; tb.p++;
    if (res === "d") { ta.d++; tb.d++; ta.pts++; tb.pts++; } else if (res === "a") { ta.w++; tb.l++; ta.pts += 3; } else { tb.w++; ta.l++; tb.pts += 3; }
  }
  // あなたの試合の結果（w/l/d・あなたから見て）で、その節を締める。battle＝観戦した戦い（連戦の状態の更新に使う。P＝あなた・C＝相手）
  function finishRound(L, yourRes, battle, yourChoices) {
    if (L.round >= TEAMS.length - 1) return null;                                            // シーズンは終わっている
    ensureCond(L);
    const ms = schedule(L.season)[L.round], out = [];
    ms.forEach(([a, b], i) => {
      let res;
      if (a === "you" || b === "you") {
        const mine = { w: "a", l: "b", d: "d" }[yourRes]; res = a === "you" ? mine : mine === "a" ? "b" : mine === "b" ? "a" : "d";
        if (battle) { const foe = a === "you" ? b : a, foeRes = { w: "l", l: "w", d: "d" }[yourRes];
          settle(L, "you", battle.teams.P, yourRes, battle.turn, yourChoices ? leaderOf(yourChoices) : 0); settle(L, foe, battle.teams.C, foeRes, battle.turn, leaderOf(rivalOf(foe).squad)); }
      }
      else res = simulate(a, b, W.hashStr(`m-${L.season}-${L.round}-${i}`), L);
      apply(L, a, b, res); out.push({ a, b, res });
    });
    L.log.push(out); L.round++; delete L.pending; return out;                                // この節の戦いの種はもう要らない
  }
  function standings(L) {
    return TEAMS.slice().sort((x, y) => L.table[y].pts - L.table[x].pts || L.table[y].w - L.table[x].w || (L.table[x].l - L.table[y].l) || TEAMS.indexOf(x) - TEAMS.indexOf(y));
  }
  function nextMatch(L) {
    if (L.round >= TEAMS.length - 1) return null;
    const m = schedule(L.season)[L.round].find((p) => p.includes("you")); return { home: m[0], away: m[1], foe: rivalOf(m[0] === "you" ? m[1] : m[0]) };
  }
  SCS2.league = { TEAMS, ROUNDS: TEAMS.length - 1, rivalOf, schedule, fresh, valid, finishRound, standings, nextMatch, simulate, ensureCond, condFor, leaderOf, settle, fatWord, morWord, trustWord };
})();
