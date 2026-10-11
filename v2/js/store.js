/* v2/js/store.js — 部隊と対戦成績の保存（このブラウザの localStorage）。読めない環境でも既定値で動く。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const KEY = "scs2.save.v1";
  const W = SCS2.world;
  const fresh = () => ({ squad: W.DEFAULT_SQUAD.map((f) => ({ name: f.name, emb: f.emb, choices: f.choices.slice() })), form: "散開", records: {}, order: null, league: null });
  const validOrder = (o) => Array.isArray(o) && o.length === 3 && [0, 1, 2].every((i) => o.includes(i)); // 隊形の中の並び（位置の順に部隊の番号）
  function valid(s) {
    return s && Array.isArray(s.squad) && s.squad.length === 3 && s.squad.every((f) => f && typeof f.name === "string" && W.EMB.includes(f.emb) &&
      Array.isArray(f.choices) && f.choices.length === 10 && f.choices.every((v) => v === 0 || v === 1 || v === 2 || v === 3));
  }
  let data = fresh();
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (valid(s)) data = { squad: s.squad, form: W.FORMS.includes(s.form) ? s.form : "散開", records: s.records || {}, order: validOrder(s.order) ? s.order : null, league: s.league || null }; } catch (e) { /* 保存なし */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 保存できない環境 */ } }
  function record(rivalKey, res) { const r = data.records[rivalKey] || (data.records[rivalKey] = { w: 0, l: 0, d: 0 }); r[res]++; save(); }
  SCS2.store = { get data() { return data; }, save, record };
})();
