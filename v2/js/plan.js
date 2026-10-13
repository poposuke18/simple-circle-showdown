/* v2/js/plan.js — 隊長の作戦（Obsidian [[v2ゲーム設計]] 第6段 v2.s6.* / v2.s6.b.*）。
 * 隊長（性格から決まる）の性格で、指揮の型（選べない）・選べる方針／狙い／間合い／退き時／役目／連携／隊形が変わる。
 * 隊員がその指示に乗るか（気乗り）は隊員の小カテゴリで決まる。相手の部隊は隊長の性格から作戦を選ぶ（乱数なし）。
 * エンジンへは opts.plan = { P:{lead,style,policy,say,word,aim,range,back,link,roles[],will:{…[3]},…}, C:{…} } で渡す。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // c＝隊長の大カテゴリの値（0〜3）[闘争心, リスク, 冷静さ, 忍耐, 規律, 順応性, 誇り, 非情さ, 自信, 好奇心]
  // 指揮の型（v2.s6.style）
  const STYLE = { cmd: "号令で動かす", read: "見てから決める", front: "背中で引っ張る", free: "好きにやらせる" };
  const styleOf = (c) => (c[4] >= 3 ? "cmd" : (c[5] >= 2 && c[2] >= 2 && c[0] <= 2) ? "read" : (c[4] >= 2 || (c[8] >= 2 && c[2] >= 1 && c[4] >= 1)) ? "cmd" : c[0] >= 2 ? "front" : "free");
  const T = () => true;
  // 指示の束（v2.s6.b.parts）：key・名前・選択肢 {k, w（言葉）, say（台詞）, gate(c)（隊長が選べるか）, will(m, coop)（隊員の気乗り）}
  const DIMS = [
    { key: "policy", name: "方針", opts: [                                                // 方針（v2.s6.policy・v2.s6.willing）
      { k: "atk", w: "押し切る", say: "押せ、押し切れ", gate: (c) => c[0] >= 2 || c[8] >= 2, will: (m) => 0.5 + (m.A2 - 0.5) + (m.C2 - 0.5) * 0.6 },
      { k: "def", w: "受けて返す", say: "崩すな、受けてから返せ", gate: (c) => c[0] <= 1 || c[4] >= 2 || c[3] >= 2, will: (m) => 0.5 + (m.B2 - 0.5) * 0.6 + (m.C1 - 0.5) * 0.6 + (0.5 - m.A2) * 0.4 },
      { k: "focus", w: "一体ずつ仕留める", say: "一体ずつだ、散らすな", gate: (c) => c[4] >= 2 || c[7] >= 2, will: (m) => 0.5 + (m.B4 - 0.5) + (m.D2 - 0.5) * 0.5 },
      { k: "guard", w: "後ろを守る", say: "後ろを抜かせるな", gate: (c) => c[6] >= 2 || c[0] <= 1, will: (m, coop) => 0.3 + coop * 0.6 + (m.C6 - 0.5) * 0.3 },
      { k: "probe", w: "様子を見る", say: "まず出方を見る", gate: (c) => c[2] >= 2 || c[3] >= 2 || c[5] >= 2, will: (m) => 0.5 + (0.5 - m.A2) * 0.8 + (m.D1 - 0.5) * 0.6 },
      { k: "free", w: "好きにやれ", say: "好きにやれ", gate: T, will: () => 1 } ] },
    { key: "aim", name: "狙い", opts: [
      { k: "auto", w: "任せる", gate: T, will: () => 1 },
      { k: "near", w: "近い敵から", gate: T, will: (m) => 0.5 + (m.A2 - 0.5) * 0.8 },
      { k: "low", w: "手負いから", gate: (c) => c[7] >= 2 || c[4] >= 2, will: (m) => 0.4 + m.A6 * 0.6 },
      { k: "shooter", w: "射手から", gate: (c) => c[2] >= 2 || c[7] >= 2 || c[9] >= 2, will: (m) => 0.4 + m.D1 * 0.6 },
      { k: "tanklast", w: "固い敵は後回し", gate: (c) => c[2] >= 2 || c[5] >= 2, will: (m) => 0.4 + m.D1 * 0.4 + (1 - m.A3) * 0.4 } ] },
    { key: "range", name: "間合い", opts: [
      { k: "auto", w: "任せる", gate: T, will: () => 1 },
      { k: "close", w: "詰めろ", gate: (c) => c[0] >= 2 || c[1] >= 2, will: (m) => 0.3 + m.A3 * 0.5 + m.A2 * 0.3 },
      { k: "keep", w: "保て", gate: (c) => c[4] >= 2 || c[2] >= 2, will: (m) => 0.4 + m.B4 * 0.4 + m.B2 * 0.3 },
      { k: "far", w: "離れて撃て", gate: (c) => c[3] >= 2 || c[0] <= 1, will: (m) => 0.3 + m.A1 * 0.5 + m.B2 * 0.3 } ] },
    { key: "back", name: "退き時", opts: [
      { k: "auto", w: "任せる", gate: T, will: () => 1 },
      { k: "never", w: "退くな", gate: (c) => c[6] >= 2 || c[0] >= 2 || c[8] >= 2, will: (m) => 0.3 + m.C6 * 0.5 + (1 - m.C1) * 0.3 },
      { k: "deep", w: "深手なら退け", gate: T, will: (m) => 0.6 + (m.C1 - 0.5) * 0.4 },
      { k: "early", w: "早めに退け", gate: (c) => c[2] >= 2 || c[1] <= 1, will: (m) => 0.3 + m.C1 * 0.5 + m.B3 * 0.2 } ] },
    { key: "link", name: "連携", opts: [
      { k: "none", w: "各自で", gate: T, will: () => 1 },
      { k: "focus", w: "集中砲火", gate: (c) => c[4] >= 2, will: (m) => 0.4 + m.B4 * 0.4 + m.D2 * 0.3 },
      { k: "pincer", w: "挟み撃ち", gate: (c) => c[7] >= 2 || c[1] >= 2 || c[9] >= 2, will: (m) => 0.3 + m.D4 * 0.4 + m.D2 * 0.3 },
      { k: "relay", w: "交代", gate: (c) => c[2] >= 2 || c[5] >= 2, will: (m) => 0.3 + m.D2 * 0.4 + m.C1 * 0.3 },
      { k: "cover", w: "かばい合い", gate: (c) => c[6] >= 2, will: (m, coop) => 0.2 + coop * 0.6 + m.C6 * 0.2 } ] },
  ];
  // 役目（駒ごと・v2.s6.b.parts ⑥）
  const ROLES = [
    { k: "auto", w: "任せる", gate: T, will: () => 1 },
    { k: "van", w: "先鋒", gate: T, will: (m) => 0.3 + m.A3 * 0.4 + m.A2 * 0.3 },
    { k: "shield", w: "盾", gate: (c) => c[6] >= 2 || c[4] >= 2, will: (m, coop) => 0.2 + coop * 0.5 + m.C6 * 0.3 },
    { k: "archer", w: "射手", gate: T, will: (m) => 0.3 + m.A1 * 0.5 + (1 - m.A3) * 0.2 },
    { k: "rover", w: "遊撃", gate: (c) => c[9] >= 2 || c[7] >= 2 || c[5] >= 2, will: (m) => 0.3 + m.D4 * 0.4 + m.B5 * 0.3 },
    { k: "rear", w: "殿", gate: (c) => c[3] >= 2 || c[4] >= 2, will: (m) => 0.3 + m.B4 * 0.3 + m.C1 * 0.2 + (1 - m.A2) * 0.2 },
  ];
  const DIM = {}; for (const d of DIMS) DIM[d.key] = d;
  const OPT = {}; for (const d of DIMS) { OPT[d.key] = {}; for (const o of d.opts) OPT[d.key][o.k] = o; }
  const ROLE = {}; for (const r of ROLES) ROLE[r.k] = r;
  const POLICIES = DIM.policy.opts, POL = OPT.policy;
  const FORMS = ["散開", "戦列", "楔", "円陣"];
  const allowedForms = (c) => ({ 散開: true, 戦列: c[4] >= 2 || c[3] >= 2, 楔: c[0] >= 2 || c[8] >= 2 || c[1] >= 2, 円陣: c[4] >= 2 || c[6] >= 2 || c[0] <= 1 });   // v2.s6.form
  const allowedOf = (opts, c) => { const o = {}; for (const x of opts) o[x.k] = !!x.gate(c); return o; };
  const allowedPolicies = (c) => allowedOf(POLICIES, c);
  // 相手の隊長が選ぶ方針（v2.s6.rival）＝選べる物の中で得点が一番高い物。同点は並びの順
  const scoreOf = (c) => ({ atk: c[0] + c[8] - 2, def: (3 - c[0]) + c[3] - 2, focus: c[4] + c[7] - 2.5, guard: c[6] + (3 - c[0]) - 2.5, probe: c[2] + c[5] + c[3] / 2 - 3, free: (3 - c[4]) + (3 - c[8]) / 2 - 2 });
  function preferPolicy(c) { const ok = allowedPolicies(c), s = scoreOf(c); let b = "free", bv = -Infinity; for (const p of POLICIES) if (ok[p.k] && s[p.k] > bv) { bv = s[p.k]; b = p.k; } return b; }
  // 相手のほかの指示（v2.s6.b.rival）
  function rivalPlan(c) {
    const ok = (dim, k) => OPT[dim][k].gate(c);
    const aim = c[7] >= 2 && ok("aim", "low") ? "low" : c[2] >= 2 && c[9] >= 2 && ok("aim", "shooter") ? "shooter" : "auto";
    const range = c[0] >= 2 && ok("range", "close") ? "close" : c[3] >= 2 && c[0] <= 1 && ok("range", "far") ? "far" : "auto";
    const back = c[6] >= 2 && c[8] >= 2 && ok("back", "never") ? "never" : c[2] >= 2 && c[1] <= 1 && ok("back", "early") ? "early" : "auto";
    const link = c[4] >= 2 && ok("link", "focus") ? "focus" : (c[7] >= 2 || c[9] >= 2) && ok("link", "pincer") ? "pincer" : c[6] >= 2 && ok("link", "cover") ? "cover" : "none";
    return { policy: preferPolicy(c), aim, range, back, link, roles: ["auto", "auto", "auto"] };
  }
  const willing = (k, m, coop) => clamp(POL[k] ? POL[k].will(m, coop) : 1, 0, 1);         // 方針の気乗り（6a 互換）
  const willWord = (w) => (w >= 0.6 ? "乗り気" : w >= 0.3 ? "まあまあ" : "気が乗らない");
  const normPlan = (p) => { const o = { policy: null, aim: "auto", range: "auto", back: "auto", link: "none", roles: ["auto", "auto", "auto"] };   // 保存の形（古い文字列は方針だけ）
    if (typeof p === "string") o.policy = p; else if (p && typeof p === "object") { for (const k of ["policy", "aim", "range", "back", "link"]) if (typeof p[k] === "string") o[k] = p[k]; if (Array.isArray(p.roles)) o.roles = [0, 1, 2].map((i) => (typeof p.roles[i] === "string" ? p.roles[i] : "auto")); } return o; };
  // 部隊の作戦。choices＝3体の性格、lead＝隊長の番号、plan＝選んだ指示（選べなければ「任せる」／方針は隊長の得点が一番高い物）。form を渡すと選べなければ散開
  function planFor(choices, lead, plan, form) {
    const c = choices[lead] || choices[0], q = plan === "rival" ? rivalPlan(c) : normPlan(plan);
    const allowed = {}; for (const d of DIMS) allowed[d.key] = allowedOf(d.opts, c); allowed.roles = allowedOf(ROLES, c);
    const pick = (dim, k, dflt) => (k && allowed[dim][k] ? k : dflt);
    const out = { lead, style: styleOf(c), policy: pick("policy", q.policy, preferPolicy(c)), aim: pick("aim", q.aim, "auto"), range: pick("range", q.range, "auto"), back: pick("back", q.back, "auto"), link: pick("link", q.link, "none"),
      roles: q.roles.map((r) => (allowed.roles[r] ? r : "auto")), forms: allowedForms(c), allowed };
    out.say = POL[out.policy].say; out.word = POL[out.policy].w; out.form = form ? (out.forms[form] ? form : "散開") : null;
    const us = choices.map((ch) => SCS.derive.buildUnit("x", ch)), coops = us.map((u) => SCS.coopRating3(u));
    const w = (opt, i) => clamp(opt.will(us[i].micros, coops[i]), 0, 1);
    out.will = {};                                                                         // 指示ごとの3体の気乗り（隊長は自分の決めた事なので 1）
    for (const d of DIMS) out.will[d.key] = us.map((u, i) => (i === lead ? 1 : w(OPT[d.key][out[d.key]], i)));
    out.will.roles = us.map((u, i) => w(ROLE[out.roles[i]], i));                            // 役目は隊長にも気乗りがある（自分の役目）
    out.will.policy = us.map((u, i) => (i === lead ? 1 : w(POL[out.policy], i)));
    // 隊員ごとの気乗りのまとめ（画面用）：選んだ指示のうち気が乗らない物の言葉と、平均
    out.mood = us.map((u, i) => { const dis = [], vs = [];
      for (const d of DIMS) { const k = out[d.key]; if (d.key !== "policy" && (k === "auto" || k === "none")) continue; const v = out.will[d.key][i]; if (i === lead && d.key !== "roles") continue; vs.push(v); if (v < 0.3) dis.push(OPT[d.key][k].w); }
      if (out.roles[i] !== "auto") { const v = out.will.roles[i]; vs.push(v); if (v < 0.3) dis.push(ROLE[out.roles[i]].w); }
      const avg = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 1; return { avg, word: dis.length ? "気が乗らない" : willWord(avg), dis }; });
    return out;
  }
  SCS2.plan = { STYLE, DIMS, DIM, OPT, ROLES, ROLE, POLICIES, POL, FORMS, styleOf, allowedForms, allowedPolicies, preferPolicy, rivalPlan, willing, willWord, normPlan, planFor };
})();
