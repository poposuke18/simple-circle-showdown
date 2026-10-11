/* v2/js/lineage2.js — 系譜（Obsidian [[v2ゲーム設計]] v2.k4.lineage）。
 * 12体（あなたの3体＋性格がばらばらの9体）。1世代＝3対3を2戦（同じエンジン・世代ごとに戦場と天気が変わる）。
 * 上位6体が親になり、交叉と変異（各軸15%で±1）で次の12体。式は classic の js/lineage.js と同じ。
 * v2 では家系図のために親（pa/pb）と血筋（line＝あなたの3体のどれの家か・名字のように強かった方の親から継ぐ。他の家は -1）を持たせる。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const W = SCS2.world, POP = 12, PARENTS = 6, MUT = 0.15, KEEP = 5;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const arenaOf = (key) => W.ARENAS.find((a) => a.key === key) || W.ARENAS[0];

  // 適応度＝生き残り(重)＋撃破＋与ダメ比−被ダメ比（classic と同じ。数値は画面に出さない）
  function fitnessOf(u) {
    const maxHp = u.maxHp || 1;
    return (u.alive ? 3 : 0) + (u.st.kills || 0) * 1.5 + clamp(u.st.dealt / maxHp, 0, 2) - clamp(u.st.taken / maxHp, 0, 1) * 0.5;
  }
  function envOf(seed, gen) { const g = SCS.makeRNG((seed ^ Math.imul(gen + 1, 0x2545f491)) >>> 0); return { arena: W.ARENAS[g.int(W.ARENAS.length)].key, mod: W.MODS[g.int(W.MODS.length)] }; }

  function genesis(seed, squad) {
    const g = SCS.makeRNG((seed ^ 0x9e3779b9) >>> 0), pop = [], used = new Set(squad.map((f) => f.emb));
    squad.forEach((f, i) => pop.push({ id: `0-${i}`, choices: f.choices.slice(), fam: f.name, emb: f.emb, gen: 0, pa: null, pb: null, line: i }));
    while (pop.length < POP) {
      const choices = Array.from({ length: 10 }, () => g.int(4)), free = W.EMB.filter((e) => !used.has(e)), emb = free[g.int(free.length)]; used.add(emb);
      pop.push({ id: `0-${pop.length}`, choices, fam: `${(W.EMB_NAME[emb] || emb.toUpperCase())}-${1 + g.int(9)}`, emb, gen: 0, pa: null, pb: null, line: -1 });
    }
    return { seed, founders: squad.map((f) => ({ fam: f.name, emb: f.emb })), rows: [{ gen: 0, env: envOf(seed, 0), pop, parents: null }] };
  }

  // いまの世代を戦わせ（2戦）、親を決め、次の世代を作る
  function step(L) {
    const row = L.rows[L.rows.length - 1], gen = row.gen, env = row.env, A = arenaOf(env.arena);
    const rng = SCS.makeRNG((L.seed ^ Math.imul(gen + 1, 0x27d4eb2f)) >>> 0), order = row.pop.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const fit = {};
    for (let bi = 0; bi < 2; bi++) {
      const a = order.slice(bi * 6, bi * 6 + 3), b = order.slice(bi * 6 + 3, bi * 6 + 6);
      const fa = W.FORMS[rng.int(W.FORMS.length)], fb = W.FORMS[rng.int(W.FORMS.length)];
      const nm = (xs, t) => xs.map((x, i) => `${x.fam}${t}${i}`);
      const battle = SCS.makeSquadBattle(a.map((x) => x.choices.slice()), b.map((x) => x.choices.slice()), (L.seed ^ Math.imul(gen + 1, 0x41c64e6d) ^ Math.imul(bi + 1, 0xb5297a4d)) >>> 0, A.name, env.mod, fa, fb, nm(a, "a"), nm(b, "b"), { formation: 0.6 });
      let n = 0; while (!battle.over && n++ < 200) battle.step();
      a.forEach((x, i) => (fit[x.id] = fitnessOf(battle.teams.P[i]))); b.forEach((x, i) => (fit[x.id] = fitnessOf(battle.teams.C[i])));
    }
    const ranked = row.pop.slice().sort((x, y) => fit[y.id] - fit[x.id]), parents = ranked.slice(0, PARENTS);
    row.parents = parents.map((p) => p.id);
    const br = SCS.makeRNG((L.seed ^ Math.imul(gen + 1, 0x6c62272e) ^ 0x1234567) >>> 0), next = [];
    while (next.length < POP) {
      let pa = parents[br.int(PARENTS)], pb = parents[br.int(PARENTS)];
      if (fit[pb.id] > fit[pa.id]) [pa, pb] = [pb, pa];                                        // 家の名と紋章は強かった方の親から
      const choices = Array.from({ length: 10 }, (_, i) => { let v = br.chance(0.5) ? pa.choices[i] : pb.choices[i]; if (br.chance(MUT)) v = clamp(v + (br.chance(0.5) ? 1 : -1), 0, 3); return v; });
      next.push({ id: `${gen + 1}-${next.length}`, choices, fam: pa.fam, emb: pa.emb, gen: gen + 1, pa: pa.id, pb: pb.id, line: pa.line });
    }
    const pos = new Map(row.pop.map((x, i) => [x.id, i]));                                      // 親の並びに沿って並べる（線が絡まないように）
    next.sort((x, y) => pos.get(x.pa) + pos.get(x.pb) * 0.01 - (pos.get(y.pa) + pos.get(y.pb) * 0.01)).forEach((x, i) => (x.id = `${gen + 1}-${i}`));
    L.rows.push({ gen: gen + 1, env: envOf(L.seed, gen + 1), pop: next, parents: null });
    while (L.rows.length > KEEP) L.rows.shift();
    return L;
  }
  const valid = (L) => L && typeof L.seed === "number" && Array.isArray(L.founders) && Array.isArray(L.rows) && L.rows.length > 0 && L.rows.every((r) => Array.isArray(r.pop) && r.pop.length === POP && r.pop.every((x) => typeof x.line === "number"));
  // あなたの3体の血筋が、いまの12体のうち何体に続いているか（0..1）
  const bloodShare = (L) => { const pop = L.rows[L.rows.length - 1].pop; return [0, 1, 2].map((k) => pop.filter((x) => x.line === k).length / POP); };

  SCS2.lineage = { POP, PARENTS, KEEP, genesis, step, valid, bloodShare, arenaOf };
})();
