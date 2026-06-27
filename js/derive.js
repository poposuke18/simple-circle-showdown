/* derive.js — 人格(10大パラ) → 24小パラ / HP / 武器 の派生（設計書 v0.1 の式）
 *   小パラ01 = clamp01( 0.5 + Σ W·m + 静的相互作用 )
 *   ※ C6(粘り)の動的項・C4(過信)の乗数は戦闘中(sim)で適用
 */
window.SCS = window.SCS || {};

(function () {
  const D = SCS.DATA;
  const relu = (x) => Math.max(0, x);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // 選択 index[10] → 大パラ値の配列（mv[id-1] でアクセス, -1.0..+1.0）
  function macroValues(choices) {
    return choices.map((c) => D.CHOICE_VALUES[c]);
  }

  // 攻撃発生率に関わる小パラは最小0.10（完全に撃たない人格を作らない）
  const ATTACK_FLOOR = { A2: 1, A3: 1, A4: 1, A6: 1, C3: 1 };

  // 24小パラ（0..1）。静的相互作用込み。動的修飾は含めない（sim で加える）
  function deriveMicros(mv) {
    const out = {};
    for (const m of D.MICROS) {
      let v = 0.5;
      for (const id in m.w) v += m.w[id] * mv[id - 1];
      if (m.inter) {
        const it = D.INTERACTIONS[m.inter];
        v += it.lambda * relu(mv[it.a - 1]) * relu(mv[it.b - 1]);
      }
      out[m.id] = clamp01(v);
      if (ATTACK_FLOOR[m.id]) out[m.id] = Math.max(0.1, out[m.id]);
    }
    return out;
  }

  // HP = clamp(100 -12·① -10·② +8·④ -6·⑨, 70, 130)
  function deriveHP(mv) {
    let hp = D.HP.base;
    for (const id in D.HP.coef) hp += D.HP.coef[id] * mv[id - 1];
    return Math.round(Math.max(D.HP.min, Math.min(D.HP.max, hp)));
  }

  // 各プールで score = base + Σ aff·m が最大の武器を選ぶ
  function pickWeapon(pool, mv) {
    let best = null, bestScore = -Infinity;
    for (const w of pool) {
      let s = w.base || 0;
      for (const id in w.aff) s += w.aff[id] * mv[id - 1];
      if (s > bestScore) { bestScore = s; best = w; }
    }
    return best;
  }

  function selectWeapons(mv) {
    return { ranged: pickWeapon(D.RANGED, mv), melee: pickWeapon(D.MELEE, mv) };
  }

  // 人格 → 思考の質（メタ思考パラメータ）。設計書「思考エンジンv2／人格→思考の質」より
  // mv[id-1]: ③冷静=mv[2] ⑤規律=mv[4] ⑥順応=mv[5] ⑩好奇=mv[9]
  function deriveCognition(mv, micros) {
    const searchDepth =
      1 + Math.round(3 * clamp01(0.5 + 0.4 * mv[5] + 0.3 * mv[2] + 0.2 * mv[4] - 0.3 * relu(-mv[2]))); // 1..4
    const breadth = 3 + Math.round(2 * clamp01(0.5 + 0.5 * mv[9])); // 3..5
    const mcSamples = searchDepth >= 3 ? 4 + Math.round(8 * clamp01(0.5 + 0.5 * mv[5])) : 0; // 高思考のみMC
    return {
      searchDepth, //     先読み手数（1..4）
      breadth, //         move ordering 上位K件のみ深く探索
      mcSamples, //       モンテカルロ・ロールアウト数（高思考人格のみ）
      evalStability: micros.C5, // 低HPで評価が崩れにくいか
      explorationTemp: 0.05 + micros.D3 * 0.3 + relu(mv[9]) * 0.1, // 奇手・非貪欲の温度
      oppModelWeight: micros.D1, // 相手モデルの信頼（D1相手読み）
      learning: micros.D6, // 痛打を受けた間合いの学習回避（D6）
      // 知覚バイアスは評価関数内で micros.C4 を直接使用
    };
  }

  // 完全なユニット定義（戦闘前の派生結果一式）
  function buildUnit(name, choices) {
    const mv = macroValues(choices);
    const micros = deriveMicros(mv);
    const weapons = selectWeapons(mv);
    const hp = deriveHP(mv);
    return {
      name, choices, mv, micros,
      cog: deriveCognition(mv, micros),
      ranged: weapons.ranged, melee: weapons.melee,
      maxHp: hp, hp,
    };
  }

  SCS.derive = { macroValues, deriveMicros, deriveHP, selectWeapons, deriveCognition, buildUnit, relu, clamp01 };
})();
