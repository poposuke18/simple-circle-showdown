/* v2/js/plan.js — 隊長の作戦（Obsidian [[v2ゲーム設計]] 第6段 v2.s6.*）。
 * 隊長（性格から決まる）の性格で、指揮の型（選べない）・選べる方針・選べる隊形が変わる。隊員が方針に乗るか（気乗り）は隊員の小カテゴリで決まる。
 * 相手の部隊は隊長の性格から方針を選ぶ（乱数なし）。エンジンへは opts.plan = { P:{lead,style,policy,say,word,will[]}, C:{…} } で渡す。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // 指揮の型（v2.s6.style）
  const STYLE = { cmd: "号令で動かす", read: "見てから決める", front: "背中で引っ張る", free: "好きにやらせる" };
  // 方針（v2.s6.policy）：key・言葉・隊長の台詞
  const POLICIES = [
    { k: "atk", w: "押し切る", say: "押せ、押し切れ" },
    { k: "def", w: "受けて返す", say: "崩すな、受けてから返せ" },
    { k: "focus", w: "一体ずつ仕留める", say: "一体ずつだ、散らすな" },
    { k: "guard", w: "後ろを守る", say: "後ろを抜かせるな" },
    { k: "probe", w: "様子を見る", say: "まず出方を見る" },
    { k: "free", w: "好きにやれ", say: "好きにやれ" },
  ];
  const POL = {}; for (const p of POLICIES) POL[p.k] = p;
  const FORMS = ["散開", "戦列", "楔", "円陣"];
  // c＝隊長の大カテゴリの値（0〜3）[闘争心, リスク, 冷静さ, 忍耐, 規律, 順応性, 誇り, 非情さ, 自信, 好奇心]
  const styleOf = (c) => (c[4] >= 3 ? "cmd" : (c[5] >= 2 && c[2] >= 2 && c[0] <= 2) ? "read" : (c[4] >= 2 || (c[8] >= 2 && c[2] >= 1 && c[4] >= 1)) ? "cmd" : c[0] >= 2 ? "front" : "free");
  const allowedForms = (c) => ({ 散開: true, 戦列: c[4] >= 2 || c[3] >= 2, 楔: c[0] >= 2 || c[8] >= 2 || c[1] >= 2, 円陣: c[4] >= 2 || c[6] >= 2 || c[0] <= 1 });   // v2.s6.form
  const allowedPolicies = (c) => ({ atk: c[0] >= 2 || c[8] >= 2, def: c[0] <= 1 || c[4] >= 2 || c[3] >= 2, focus: c[4] >= 2 || c[7] >= 2, guard: c[6] >= 2 || c[0] <= 1, probe: c[2] >= 2 || c[3] >= 2 || c[5] >= 2, free: true });
  // 相手の隊長が選ぶ方針（v2.s6.rival）＝選べる物の中で得点が一番高い物。同点は POLICIES の順
  const scoreOf = (c) => ({ atk: c[0] + c[8] - 2, def: (3 - c[0]) + c[3] - 2, focus: c[4] + c[7] - 2.5, guard: c[6] + (3 - c[0]) - 2.5, probe: c[2] + c[5] + c[3] / 2 - 3, free: (3 - c[4]) + (3 - c[8]) / 2 - 2 });
  function preferPolicy(c) { const ok = allowedPolicies(c), s = scoreOf(c); let b = "free", bv = -Infinity; for (const p of POLICIES) if (ok[p.k] && s[p.k] > bv) { bv = s[p.k]; b = p.k; } return b; }
  // 気乗り（v2.s6.willing）＝隊員の小カテゴリと協調性から 0〜1
  function willing(k, m, coop) {
    if (k === "atk") return clamp(0.5 + (m.A2 - 0.5) + (m.C2 - 0.5) * 0.6, 0, 1);
    if (k === "def") return clamp(0.5 + (m.B2 - 0.5) * 0.6 + (m.C1 - 0.5) * 0.6 + (0.5 - m.A2) * 0.4, 0, 1);
    if (k === "focus") return clamp(0.5 + (m.B4 - 0.5) + (m.D2 - 0.5) * 0.5, 0, 1);
    if (k === "guard") return clamp(0.3 + coop * 0.6 + (m.C6 - 0.5) * 0.3, 0, 1);
    if (k === "probe") return clamp(0.5 + (0.5 - m.A2) * 0.8 + (m.D1 - 0.5) * 0.6, 0, 1);
    return 1;
  }
  const willWord = (w) => (w >= 0.6 ? "乗り気" : w >= 0.3 ? "まあまあ" : "気が乗らない");
  // 部隊の作戦。choices＝3体の性格、lead＝隊長の番号、policy＝選んだ方針（選べなければ隊長の得点が一番高い物）。form を渡すと選べなければ散開
  function planFor(choices, lead, policy, form) {
    const c = choices[lead] || choices[0], ok = allowedPolicies(c), pk = policy && ok[policy] ? policy : preferPolicy(c), p = POL[pk], forms = allowedForms(c);
    const us = choices.map((ch) => SCS.derive.buildUnit("x", ch));
    const will = us.map((u, i) => (i === lead ? 1 : willing(pk, u.micros, SCS.coopRating3(u))));
    return { lead, style: styleOf(c), policy: pk, say: p.say, word: p.w, will, forms, form: form ? (forms[form] ? form : "散開") : null, allowed: ok };
  }
  SCS2.plan = { STYLE, POLICIES, POL, FORMS, styleOf, allowedForms, allowedPolicies, preferPolicy, willing, willWord, planFor };
})();
