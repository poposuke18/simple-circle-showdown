/* v2/js/store.js — 部隊と対戦成績の保存（このブラウザの localStorage）。読めない環境でも既定値で動く。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const KEY = "scs2.save.v1";
  const W = SCS2.world;
  const fresh = () => ({ squad: W.DEFAULT_SQUAD.map((f) => ({ name: f.name, emb: f.emb, choices: f.choices.slice() })), form: "散開", records: {}, order: null, plan: null, league: null, lineage: null });   // plan＝隊長の作戦の方針（v2.s6）
  const validOrder = (o) => Array.isArray(o) && o.length === 3 && [0, 1, 2].every((i) => o.includes(i)); // 隊形の中の並び（位置の順に部隊の番号）
  const validSquad = (q) => Array.isArray(q) && q.length === 3 && q.every((f) => f && typeof f.name === "string" && f.name && W.EMB.includes(f.emb) &&
    Array.isArray(f.choices) && f.choices.length === 10 && f.choices.every((v) => v === 0 || v === 1 || v === 2 || v === 3));
  const cnt = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  function cleanRecords(r) {                                                                  // 相手ごとの {w,l,d}（数でない・配列などは捨てる）
    const out = {}; if (!r || typeof r !== "object" || Array.isArray(r)) return out;
    for (const k of Object.keys(r)) { const x = r[k]; if (x && typeof x === "object") out[k] = { w: cnt(x.w), l: cnt(x.l), d: cnt(x.d) }; }
    return out;
  }
  // 項目ごとに確かめる：部隊が読めない（紋章の名前が変わった等）時も、記録・リーグ・系譜・隊形は残す。リーグと系譜の中身はそれぞれの valid で確かめる
  let data = fresh();
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && typeof s === "object") data = { squad: validSquad(s.squad) ? s.squad : data.squad, form: W.FORMS.includes(s.form) ? s.form : "散開", records: cleanRecords(s.records), order: validOrder(s.order) ? s.order : null, plan: typeof s.plan === "string" || (s.plan && typeof s.plan === "object") ? s.plan : null, league: s.league || null, lineage: s.lineage || null };
  } catch (e) { /* 保存なし・読めない */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 保存できない環境 */ } }
  function record(rivalKey, res) { const r = data.records[rivalKey] || (data.records[rivalKey] = { w: 0, l: 0, d: 0 }); r[res]++; save(); }
  SCS2.store = { get data() { return data; }, save, record };
})();
