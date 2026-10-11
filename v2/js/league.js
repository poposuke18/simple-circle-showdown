/* v2/js/league.js — リーグ（Obsidian [[v2ゲーム設計]] v2.k5.league）。
 * あなた＋ライバル7部隊（写し身は除く）の総当たり7節。勝ち3・引き分け1・負け0。
 * あなたの試合は観戦し、同じ節のほかの3試合は裏で同じエンジンに戦わせる（ホーム側の本拠地と天気）。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const W = SCS2.world;
  const RIV = W.RIVALS.filter((r) => !r.mirror);
  const TEAMS = ["you"].concat(RIV.map((r) => r.key));
  const rivalOf = (k) => RIV.find((r) => r.key === k) || null;

  // 組み合わせ：円卓方式（1つ固定・残りを回す）。シーズンごとに並びを混ぜる
  function schedule(season) {
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
    return rounds;
  }
  function fresh(season) {
    const table = {}; for (const k of TEAMS) table[k] = { p: 0, w: 0, d: 0, l: 0, pts: 0 };
    return { season, round: 0, table, log: [] };
  }
  const valid = (L) => L && typeof L.season === "number" && typeof L.round === "number" && L.table && TEAMS.every((k) => L.table[k]) && Array.isArray(L.log);

  // ほかの試合を裏で戦わせる（ホーム側＝前の部隊の本拠地と天気）
  function simulate(ka, kb, seed) {
    const A = rivalOf(ka), B = rivalOf(kb), home = A, arena = W.arenaFor(home);
    const b = SCS.makeSquadBattle(A.squad.map((c) => c.slice()), B.squad.map((c) => c.slice()), seed, arena.name, W.modOf(arena), A.form, B.form, A.names.slice(), B.names.slice(), { formation: 0.6 });
    let n = 0; while (!b.over && n++ < 200) b.step();
    const r = b.result || {}; return r.type === "draw" || !b.over ? "d" : r.winner === "PLR" ? "a" : "b";
  }
  function apply(L, a, b, res) {
    const ta = L.table[a], tb = L.table[b]; ta.p++; tb.p++;
    if (res === "d") { ta.d++; tb.d++; ta.pts++; tb.pts++; } else if (res === "a") { ta.w++; tb.l++; ta.pts += 3; } else { tb.w++; ta.l++; tb.pts += 3; }
  }
  // あなたの試合の結果（w/l/d・あなたから見て）で、その節を締める
  function finishRound(L, yourRes) {
    const ms = schedule(L.season)[L.round], out = [];
    ms.forEach(([a, b], i) => {
      let res;
      if (a === "you" || b === "you") { const mine = { w: "a", l: "b", d: "d" }[yourRes]; res = a === "you" ? mine : mine === "a" ? "b" : mine === "b" ? "a" : "d"; }
      else res = simulate(a, b, W.hashStr(`m-${L.season}-${L.round}-${i}`));
      apply(L, a, b, res); out.push({ a, b, res });
    });
    L.log.push(out); L.round++; return out;
  }
  function standings(L) {
    return TEAMS.slice().sort((x, y) => L.table[y].pts - L.table[x].pts || L.table[y].w - L.table[x].w || (L.table[x].l - L.table[y].l) || TEAMS.indexOf(x) - TEAMS.indexOf(y));
  }
  function nextMatch(L) {
    if (L.round >= TEAMS.length - 1) return null;
    const m = schedule(L.season)[L.round].find((p) => p.includes("you")); return { home: m[0], away: m[1], foe: rivalOf(m[0] === "you" ? m[1] : m[0]) };
  }
  SCS2.league = { TEAMS, ROUNDS: TEAMS.length - 1, rivalOf, schedule, fresh, valid, finishRound, standings, nextMatch, simulate };
})();
