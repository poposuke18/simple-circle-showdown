/* lineage.js — 系譜モード：分隊戦の戦闘解決(squad.js)を「適応度テスト」として再利用し、
 * 個体群12体の世代交代（可変環境・交叉・変異・刺客介入）を観察する。[[系譜モード設計]]
 * squad.js / sim.js は不可触。既存の makeSquadBattle をそのまま2回呼ぶだけで1世代分を解決する。
 */
window.SCS = window.SCS || {};

(function () {
  const D = SCS.DATA;
  const POP = 12;                 // 個体群サイズ＝squad.jsの3v3を2戦（6体×2陣営、各3体×2チーム）でちょうど一周
  const PARENT_FRAC = 0.5;        // 上位50%が親
  const MUT_RATE = 0.15;          // 各軸が変異する確率
  const NAME_POOL = ["ガロ", "レイ", "カゲ", "スズ", "トキ", "ハル", "ユキ", "オニ", "カイ", "ソラ", "リン", "ジン", "アオ", "クロ", "ミナ", "タカ"];

  function clampAxis(v) { return v < 0 ? 0 : v > 3 ? 3 : v; }
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // 個体：{choices[10], lineageName, gen, alive, id}
  function mkIndividual(choices, name, gen, rng) {
    return { choices: choices.slice(), lineageName: name, gen, id: (rng ? rng.int(0x7fffffff) : Math.floor(Math.random() * 1e9)) };
  }

  // 第0世代：seedとfounders（プレイヤー手動設計・最大3体）から12体を作る
  function genesis(seed, founders) {
    const rng = SCS.makeRNG((seed ^ 0x9e3779b9) >>> 0);
    const pop = [];
    const fs = (founders || []).slice(0, 3);
    fs.forEach((ch, i) => pop.push(mkIndividual(ch, NAME_POOL[i % NAME_POOL.length], 0, rng)));
    while (pop.length < POP) { const ch = Array.from({ length: 10 }, () => rng.int(4)); pop.push(mkIndividual(ch, NAME_POOL[pop.length % NAME_POOL.length], 0, rng)); }
    return pop;
  }

  // その世代の環境（戦場・戦況）をseed由来で選ぶ（可変＝世代ごとに変わる。プレイヤーは選ばない＝観察対象）
  function pickEnvironment(seed, genIdx) {
    const rng = SCS.makeRNG((seed ^ (genIdx * 0x2545f491)) >>> 0);
    const arena = D.ARENAS[rng.int(D.ARENAS.length)].name;
    const mod = D.MODIFIERS[rng.int(D.MODIFIERS.length)].name;
    return { arena, mod };
  }

  // 12体を2戦（各3v3）に振り分ける：6体ずつ2陣営→各陣営を3体ずつ2チームに割る
  function splitIntoBattles(pop, seed, genIdx) {
    const rng = SCS.makeRNG((seed ^ (genIdx * 0x27d4eb2f)) >>> 0);
    const shuffled = pop.slice();
    for (let i = shuffled.length - 1; i > 0; i--) { const j = rng.int(i + 1); const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t; }
    return [
      { a: shuffled.slice(0, 3), b: shuffled.slice(3, 6) },
      { a: shuffled.slice(6, 9), b: shuffled.slice(9, 12) },
    ];
  }

  // 適応度＝生存(重)+撃破+与ダメ比-被ダメ比。既存statsのみ使用・新しい判定ロジックは作らない。数値は非公開（結果のみ表示）。
  function fitnessOf(u) {
    const maxHp = u.maxHp || 1, alive = u.alive ? 1 : 0;
    const dealt = clamp(u.st.dealt / maxHp, 0, 2);
    const taken = clamp(u.st.taken / maxHp, 0, 1);
    return alive * 3 + (u.st.kills || 0) * 1.5 + dealt - taken * 0.5;
  }

  // 1世代分の解決：2つの3v3を実際に走らせ（headless）、全12体の適応度と生存情報を得る
  function resolveGeneration(pop, seed, genIdx, onHeadlineEvent) {
    const env = pickEnvironment(seed, genIdx);
    const pairs = splitIntoBattles(pop, seed, genIdx);
    const results = []; // { indiv, fitness, alive, kills, dealt, taken, battleIdx, side }
    const battleLogs = [];
    pairs.forEach((pr, bi) => {
      const formSeed = SCS.makeRNG((seed ^ (genIdx * 0x9e3779b1) ^ (bi * 0x85ebca6b)) >>> 0);
      const formA = D.FORMATIONS[formSeed.int(D.FORMATIONS.length)].name, formB = D.FORMATIONS[formSeed.int(D.FORMATIONS.length)].name;
      const battleSeed = (seed ^ (genIdx * 0x41c64e6d) ^ (bi * 0xb5297a4d)) >>> 0;
      const namesA = pr.a.map((x) => x.lineageName), namesB = pr.b.map((x) => x.lineageName);
      const battle = SCS.makeSquadBattle(pr.a.map((x) => x.choices), pr.b.map((x) => x.choices), battleSeed, env.arena, env.mod, formA, formB, namesA, namesB);
      const lines = []; let g = 0;
      while (!battle.over && g < 60) { const r = battle.step(); lines.push(...r.lines); g++; }
      pr.a.forEach((indiv, i) => { const u = battle.teams.P[i]; results.push({ indiv, fitness: fitnessOf(u), alive: u.alive, kills: u.st.kills, dealt: u.st.dealt, taken: u.st.taken, battleIdx: bi }); });
      pr.b.forEach((indiv, i) => { const u = battle.teams.C[i]; results.push({ indiv, fitness: fitnessOf(u), alive: u.alive, kills: u.st.kills, dealt: u.st.dealt, taken: u.st.taken, battleIdx: bi }); });
      battleLogs.push({ arena: battle.arena.name, mod: battle.modifier ? battle.modifier.name : null, formA, formB, namesA, namesB, lines, turns: g, result: battle.result });
    });
    return { env, results, battleLogs };
  }

  // 交叉＋変異で次世代を作る：上位50%が親、seed由来でペアリングし12体を再充填
  function breed(results, seed, genIdx) {
    const ranked = results.slice().sort((a, b) => b.fitness - a.fitness);
    const nParents = Math.max(2, Math.round(POP * PARENT_FRAC));
    const parents = ranked.slice(0, nParents);
    const rng = SCS.makeRNG((seed ^ (genIdx * 0x6c62272e) ^ 0x1234567) >>> 0);
    const next = [];
    while (next.length < POP) {
      const pa = parents[rng.int(parents.length)].indiv, pb = parents[rng.int(parents.length)].indiv;
      const choices = Array.from({ length: 10 }, (_, i) => {
        let v = rng.chance(0.5) ? pa.choices[i] : pb.choices[i];
        if (rng.chance(MUT_RATE)) v = clampAxis(v + (rng.chance(0.5) ? 1 : -1));
        return v;
      });
      const parentName = (pa.gen >= pb.gen ? pa : pb).lineageName;
      next.push(mkIndividual(choices, parentName, genIdx + 1, rng));
    }
    return { next, parents: parents.map((p) => p.indiv), eliminated: ranked.slice(nParents).map((p) => p.indiv) };
  }

  // 刺客投入：まだ戦っていない個体群のランダムな1枠と入れ替える。以後は他の個体と同様、実際の戦闘で運命が決まる
  //（「最下位適応度と入れ替え」は当初案だったが、投入時点では新世代はまだ未戦闘＝適応度が存在しない。ランダム入替の方が
  //  介入するが介入しすぎない、という設計意図にも忠実——刺客が生き残るかはシミュレーションが決める。）
  function injectWildcard(pop, seed, genIdx, choices, name) {
    const rng = SCS.makeRNG((seed ^ (genIdx * 0x27220a95) ^ 0x5eed) >>> 0);
    const idx = rng.int(pop.length);
    const next = pop.slice();
    next[idx] = mkIndividual(choices, name || "刺客", pop[idx].gen, null);
    return next;
  }

  // 個体群の10軸平均（観測用の集計のみ・重み行列等の内部値は一切出さない）
  function traitAverages(pop) {
    const avg = Array(10).fill(0);
    pop.forEach((u) => u.choices.forEach((v, i) => (avg[i] += v)));
    return avg.map((v) => v / pop.length);
  }

  SCS.lineage = { POP, genesis, resolveGeneration, breed, injectWildcard, traitAverages, fitnessOf, NAME_POOL };
})();
