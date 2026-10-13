/* v2/js/league.js — リーグ（Obsidian [[v2ゲーム設計]] v2.k5.league・連戦の状態 v2.s4.cond）。
 * あなた＋ライバル7部隊（写し身は除く）の総当たり7節。勝ち3・引き分け1・負け0。
 * あなたの試合は観戦し、同じ節のほかの3試合は裏で同じエンジンに戦わせる（ホーム側の本拠地と天気）。
 * 連戦の状態：部隊ごとに隊長（性格から自動）と信頼、駒ごとに体力（疲労）と士気が節をまたいで残り、次の試合に効く。相手部隊も同じ。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const W = SCS2.world;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const RIV = W.RIVALS.filter((r) => !r.mirror && r.base);                                 // リーグは元の7部隊（作り手の新しい部隊は depth.2 の昇降格で入る・v2.s5.ui）
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
  const condFresh = () => { const cond = {}; for (const k of TEAMS) cond[k] = { trust: 0.6, lead: null, log: [], streak: 0, units: [0, 1, 2].map(() => ({ fat: 0, mor: 0, ko: 0 })) }; return cond; };
  const condOk = (c) => !!c && TEAMS.every((k) => c[k] && Number.isFinite(c[k].trust) && Array.isArray(c[k].units) && c[k].units.length === 3 && c[k].units.every((u) => u && Number.isFinite(u.fat) && Number.isFinite(u.mor)));
  const ensureCond = (L) => { if (!condOk(L.cond)) L.cond = condFresh(); return L.cond; };   // 古い保存には無い
  // 隊長＝性格から（v2.s4.cmd.lead2）：規律・誇り・忍耐・自信。同点は並びの先。シーズン中の交代（c.lead）があればそれ
  const builtOf = (choices) => choices.map((c) => SCS.derive.buildUnit("x", c));
  const mvOf = (choices) => builtOf(choices).map((u) => u.mv);
  const leaderScore = (mv) => 0.35 * mv[4] + 0.25 * mv[6] + 0.2 * mv[3] + 0.2 * mv[8];
  function leaderOf(choices, c) {
    if (c && Number.isInteger(c.lead) && c.lead >= 0 && c.lead < choices.length) return c.lead;
    let best = 0, bv = -Infinity;
    mvOf(choices).forEach((mv, i) => { const v = leaderScore(mv); if (v > bv + 1e-9) { bv = v; best = i; } });
    return best;
  }
  // 相性（v2.s4.cmd.fit）：隊員ごとに、隊長との性格の組み合わせで −1〜+1。隊長自身は 0
  function fitOf(choices, lead) {
    const us = builtOf(choices), mvs = us.map((u) => u.mv), L = mvs[lead], ls = leaderScore(L);
    return mvs.map((m, i) => {
      if (i === lead) return 0;
      const mi = us[i].micros;
      let f = 0.28 + 0.35 * m[5] + 0.3 * m[4] + 0.2 * (mi.D2 - 0.5) + 0.15 * (mi.B4 - 0.5);      // 順応性・規律＝従う側の素質。小カテゴリ D2 戦術切替・B4 隊形に従う（v2.s4.micro）
      if (mi.C4 > 0.7) f -= 0.2;                                                               // 状況を強気に見る駒は自分の見立てを優先する
      if (m[8] > 0.4) { f -= 0.25; if (leaderScore(m) > ls) f -= 0.2; }                       // 過信＝自分が指揮すべきだと思う
      if (Math.abs(m[6]) >= 0.4 && Math.abs(L[6]) >= 0.4 && Math.sign(m[6]) !== Math.sign(L[6])) f -= 0.35;  // 誇りのぶつかり（騎士道 vs 手段選ばず）
      if (Math.abs(m[0] - L[0]) >= 1.0) f -= 0.25;                                             // 闘争心のずれ（猪突 vs 専守）
      if (m[2] < -0.3) f -= 0.1;                                                               // 短気
      return clamp(f, -1, 1);
    });
  }
  const fitWord = (f) => (f >= 0.1 ? "よく従う" : f >= -0.3 ? "渋々" : "反発");
  // エンジンに渡す形
  function condFor(L, key, choices) { const c = ensureCond(L)[key], lead = leaderOf(choices, c), fit = fitOf(choices, lead); return { lead, trust: c.trust, units: c.units.map((u, i) => ({ fat: u.fat, mor: u.mor, fit: fit[i] })) }; }
  // 試合の後に更新（v2.s4.cond.fat / mor / lead）。units＝エンジンの駒（u.st・micros・coop・mv を読む）、res＝その部隊から見て w/l/d
  function settle(L, key, units, res, turns, leadIdx) {
    const c = ensureCond(L)[key], leader = units[leadIdx] || null, down = units.filter((u) => !u.alive).length;
    const ev = [], trust0 = c.trust;                                                          // 出来事（v2.s4.story）：優先順に並べて1節に最大2つ
    c.streak = res === "w" ? Math.max(1, (c.streak || 0) + 1) : res === "l" ? Math.min(-1, (c.streak || 0) - 1) : 0;
    units.forEach((u, i) => {
      const cu = c.units[i]; if (!cu) return;
      const mor0 = cu.mor;
      cu.ko = u.alive ? 0 : (cu.ko || 0) + 1;
      const C5 = u.micros.C5, coop = u.coop, lone = coop < 0.35;
      let d = res === "w" ? 0.25 : res === "l" ? -0.25 : 0; if (lone && d < 0) d *= 0.5;
      d += u.st.kills * 0.12 * (lone ? 1.5 : 1) + u.st.flanks * 0.04;
      if (!u.alive) d -= 0.2;
      d -= (down - (u.alive ? 0 : 1)) * 0.08 * coop;
      if (leader && !leader.alive && leader !== u) d -= 0.1 * c.trust;
      if (res === "l" && (u.fit || 0) < -0.3) d -= 0.08;                                        // 反発の隊員は負けると余計に腐る（v2.s4.cmd.swap）
      d *= 1 - 0.7 * C5;                                                                   // 冷静な駒は揺れにくい
      cu.mor = clamp(cu.mor * 0.6 + d, -1, 1);
      const hpf = u.alive ? clamp(u.hp / u.maxHp, 0, 1) : 0, gain = 0.15 * (1 - hpf) + (u.alive ? 0 : 0.2) + 0.1 * Math.min(1, u.st.winded / Math.max(1, turns));   // 倒れると0.35（一度で「疲れが残る」）
      cu.fat = clamp(cu.fat * (0.45 - 0.12 * Math.max(0, u.mv[3])) + gain, 0, 1);                 // 節の間に回復（忍耐が強いほど）
      const dm = cu.mor - mor0;                                                                  // 士気の急変（性格で出方が違う）
      if (dm >= 0.3 && lone && u.st.kills > 0) ev.push({ p: 4, kind: "mor", text: `${u.name}、手柄に酔う（${u.st.kills}体撃破）` });
      else if (dm <= -0.3 && !u.alive) ev.push({ p: 4, kind: "mor", text: `${u.name}、倒されて腐る` });
      else if (dm <= -0.3 && coop > 0.6 && down - (u.alive ? 0 : 1) > 0) ev.push({ p: 4, kind: "mor", text: `${u.name}、仲間を失って沈む` });
      if (res === "l" && (u.fit || 0) < -0.3 && leader && u !== leader) ev.push({ p: 5, kind: "feud", text: `${u.name}、隊長 ${leader.name} への不満が募る` });
      if (cu.ko >= 2) ev.push({ p: 6, kind: "fat", text: `${u.name}、${cu.ko}試合続けて倒れ、疲労が抜けない` });
      if ((u.st.defy || 0) >= 2) ev.push({ p: 7, kind: "defy", text: `${u.name}、${u.st.defy}度も号令に背いた` });
    });
    let t = res === "w" ? 0.12 : res === "l" ? -0.12 : 0;
    const avgFit = units.reduce((a, u) => a + (u.fit || 0), 0) / Math.max(1, units.length - 1);
    if (t < 0 && avgFit < 0) t *= 1.5;                                                         // 不和の部隊は負けで信頼が早く崩れる
    if (leader) { if (!leader.alive) t -= 0.1; if (leader.st.kills > 0 && units.every((u) => u.st.kills <= leader.st.kills)) t += 0.05; }
    c.trust = clamp(c.trust + t, 0.15, 1);
    // 隊長交代（v2.s4.cmd.swap）：信頼が 0.3 を割ったら、隊長向き得点が二番目の駒（過信は +0.3 で奪いやすい）。信頼は 0.5 に戻る
    if (c.trust < 0.25 && leader && !(Number.isInteger(c.swapRound) && L.round - c.swapRound < 2)) {   // 交代は2節あける
      let best = -1, bv = -Infinity;
      units.forEach((u, i) => { if (i === leadIdx) return; const v = leaderScore(u.mv) + (u.mv[8] > 0.4 ? 0.3 : 0); if (v > bv) { bv = v; best = i; } });
      if (best >= 0) { c.lead = best; c.trust = 0.5; c.swapRound = L.round; ev.push({ p: 1, kind: "swap", text: `隊長交代：${leader.name} → ${units[best].name}（${units[best].mv[8] > 0.4 ? "指揮を奪った" : "推された"}）` }); }
    }
    if (leader && trustWord(trust0) !== trustWord(c.trust) && !ev.some((e) => e.kind === "swap")) ev.push({ p: 2, kind: "trust", text: `隊長 ${leader.name} への信頼が${c.trust > trust0 ? "厚くなる" : c.trust < 0.45 ? "薄れる" : "揺らぐ"}` });
    if (c.streak >= 3) ev.push({ p: 3, kind: "streak", text: `${c.streak}連勝、部隊が勢いづく` }); else if (c.streak <= -3) ev.push({ p: 3, kind: "streak", text: `${-c.streak}連敗、空気が重い` });
    if (res === "w" && leader && leader.alive && leader.st.kills > 0 && units.every((u) => u.st.kills <= leader.st.kills)) ev.push({ p: 8, kind: "lead", text: `隊長 ${leader.name} が先頭に立って勝利` });
    if (!c.log) c.log = [];
    for (const e of ev.sort((a, b) => a.p - b.p).slice(0, 2)) c.log.push({ round: L.round, kind: e.kind, text: e.text });
    while (c.log.length > 20) c.log.shift();
  }
  // あなたの部隊の性格が変わったら（v2.s4.qa.lg.edit.cond）：シーズン中の隊長交代は白紙にして性格から決め直す。体力・士気・信頼はそのまま。変わった時 true
  function syncYou(L, choices) {
    const c = ensureCond(L).you, sig = choices.map((x) => x.join("")).join("|");
    if (c.sig === sig) return false;
    const had = c.sig != null; c.sig = sig; if (had && c.lead != null) { c.lead = null; delete c.swapRound; }
    return true;
  }
  const storyOf = (L, key, n) => { const c = ensureCond(L)[key]; return (c.log || []).slice(-n); };
  // 画面用の言葉（v2.s4.cond.ui）
  const fatWord = (f) => (f < 0.15 ? "万全" : f < 0.35 ? "少し疲れ" : f < 0.55 ? "疲れが残る" : "消耗が激しい");
  const morWord = (m) => (m > 0.4 ? "高い" : m > 0.1 ? "やや高い" : m > -0.1 ? "普通" : m > -0.4 ? "やや低い" : "低い");
  const trustWord = (t) => (t > 0.75 ? "厚い" : t > 0.45 ? "普通" : "薄い");

  function fresh(season) {
    const table = {}; for (const k of TEAMS) table[k] = { p: 0, w: 0, d: 0, l: 0, pts: 0 };
    return { season, round: 0, table, log: [], cond: condFresh(), squad: null };
  }
  // シーズンの部隊（v2.s4.qa.lg.lock）：最初の試合に入った時点のあなたの3体（名前・紋章・性格）をシーズンの間固定する。null＝まだ固定していない
  const squadOk = (q) => q == null || (Array.isArray(q) && q.length === 3 && q.every((f) => f && typeof f.name === "string" && W.EMB.includes(f.emb) && Array.isArray(f.choices) && f.choices.length === 10 && f.choices.every((v) => v === 0 || v === 1 || v === 2 || v === 3)));
  function lockSquad(L, squad) { if (L.squad) return false; L.squad = squad.map((f) => ({ name: f.name, emb: f.emb, choices: f.choices.slice() })); return true; }
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
    const Pl = SCS2.plan; opts.plan = { P: Pl.planFor(A.squad, L ? opts.cond.P.lead : leaderOf(A.squad, null), null), C: Pl.planFor(B.squad, L ? opts.cond.C.lead : leaderOf(B.squad, null), null) };   // 相手の作戦＝隊長の性格から（v2.s6.rival）
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
          settle(L, "you", battle.teams.P, yourRes, battle.turn, yourChoices ? leaderOf(yourChoices, L.cond.you) : 0); settle(L, foe, battle.teams.C, foeRes, battle.turn, leaderOf(rivalOf(foe).squad, L.cond[foe])); }
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
  SCS2.league = { TEAMS, ROUNDS: TEAMS.length - 1, rivalOf, schedule, fresh, valid, squadOk, lockSquad, finishRound, standings, nextMatch, simulate, ensureCond, condFor, leaderOf, fitOf, leaderScore, settle, storyOf, syncYou, fatWord, morWord, trustWord, fitWord };
})();
