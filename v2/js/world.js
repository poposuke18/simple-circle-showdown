/* v2/js/world.js — v2 の世界の定義（Obsidian [[v2ゲーム設計]]）。
 * 戦場「遺跡の円形広場」（地図の絵に合わせた当たり判定）・駒の紋章・武器アイコン・相手（元のゲームの分隊戦キャンペーンの部隊）。
 * エンジン（squad.js / data.js）は書き換えない。戦場はここで DATA.ARENAS に足すだけ。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const D = SCS.DATA;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ===== 戦場（160×90・1単位＝12px）。proto/arena.js と同じ当たり判定 =====
  const o = (x, y, w, h) => ({ x, y, w, h }), t = (x, y, w, h, k) => ({ x, y, w, h, t: k });
  const PLAZA = {
    key: "plaza", name: "遺跡の円形広場", flavor: "川と溶岩に挟まれた古い広場", w: 160, h: 90, base: "plains",
    obstacles: [
      o(41, 3.5, 17, 2), o(41, 3.5, 2, 15.5), o(55, 3.5, 3, 7), o(47, 17, 5, 2.5), o(55, 14.5, 3, 4.5),
      o(31, 25, 2.5, 6.5), o(31, 29, 9.5, 3),
      o(76.5, 5.5, 3, 9), o(80, 11.5, 11, 2.5), o(90, 13, 1.5, 5),
      o(101, 3, 14, 2.5), o(99.5, 5, 3.5, 14.5), o(113, 5, 3, 13), o(103, 16.5, 7, 3),
      o(103.5, 31.5, 5, 3), o(113, 31.5, 6, 3), o(103.5, 31.5, 2.5, 16.5), o(116, 33, 3, 13), o(104, 45.5, 6, 3),
      o(101, 63, 17, 3.5), o(100.5, 64, 3.5, 16), o(115, 63, 4, 12), o(103, 76.5, 9, 3.5), o(114, 75, 4, 4),
      o(113, 53, 5, 2), o(80, 78, 4.5, 3), o(32, 48, 2.5, 10),
      o(41, 65.5, 18, 3.5), o(42, 66, 3.5, 18), o(56.5, 66, 3, 13), o(42, 80.5, 15.5, 3.5),
      o(67.5, 68, 2, 6), o(67.5, 72, 12.5, 3),
    ],
    terrain: [
      t(51, 31, 22, 22, "highground"),
      t(9, 0, 16, 38.5, "swamp"), t(9, 46, 16, 44, "swamp"),
      t(129.5, 0, 23.5, 37.5, "lava"), t(129.5, 46, 23.5, 44, "lava"),
      t(0, 0, 9, 90, "forest"), t(25, 0, 16, 12, "forest"), t(58, 0, 18, 8, "forest"), t(25, 68, 16, 22, "forest"),
      t(58, 80, 42, 10, "forest"), t(119, 0, 10.5, 30, "forest"), t(119, 50, 10.5, 40, "forest"), t(153, 0, 7, 90, "forest"),
    ],
    start: { p: { x: 36, y: 45 }, c: { x: 124, y: 45 } },
    map: "assets/map_plaza.jpg", mini: "assets/map_plaza_mini.jpg",
  };
  if (!D.ARENAS.some((a) => a.key === PLAZA.key)) D.ARENAS.push(PLAZA);

  // ===== 紋章 =====
  const EMB = ["wolf", "flame", "shield", "frost", "skull", "leaf", "sun", "crown"];
  const EMB_NAME = { wolf: "WOLF", flame: "FLAME", shield: "AEGIS", frost: "FROST", skull: "SKULL", leaf: "LEAF", sun: "SOL", crown: "CROWN" };
  function embScores(c) {
    const [bel, risk, comp, pat, disc, adapt, pride, ruth, conf, cur] = c;
    return { wolf: bel * 1.2 + (3 - pat) * 0.6, flame: risk * 1.1 + (3 - comp) * 0.7, shield: (3 - bel) + pat * 0.6 + disc * 0.3, frost: comp + disc * 0.6,
      skull: ruth * 1.1 + (3 - pride) * 0.6, leaf: adapt * 0.8 + cur * 0.8, sun: pride * 1.1 + conf * 0.5, crown: conf + pride * 0.4 + disc * 0.3 };
  }
  function assignEmblems(team) { const used = new Set(); return team.map((c) => { const s = embScores(c); const k = EMB.filter((e) => !used.has(e)).sort((a, b) => s[b] - s[a])[0]; used.add(k); return k; }); }

  // 人格の言葉（振り切った軸から2つ）＝カードの見出し用。大カテゴリの言葉だけ（v2.hidden）
  function wordsOf(c) { return c.map((v, i) => ({ i, v, e: Math.abs(v - 1.5) })).sort((a, b) => b.e - a.e || a.i - b.i).slice(0, 2).map((x) => D.MACROS[x.i].poles[x.v]); }

  // ===== 武器アイコン（assets/weapon/*.png）=====
  const WEAPON_ICON = { "スナイパーライフル": "sniper", "マークスマンライフル": "marksman", "アサルトライフル": "assault", "SMG": "smg", "LMG": "lmg", "ショットガン": "shotgun",
    "拳銃": "pistol", "バーストライフル": "burst", "火炎放射器": "flamer", "ナイフ": "knife", "二刀": "dual", "刀": "katana", "レイピア": "rapier", "大剣": "greatsword",
    "大槌・斧": "hammer", "槍": "spear", "鎖鎌": "kusarigama" };
  function bodyOf(choices) { const u = SCS.derive.buildUnit("U", choices); return { hp: u.maxHp, ranged: u.ranged.name, melee: u.melee.name }; }

  // ===== 戦況：squad.js で効くものだけ（狭まる戦場・火の海は squad.js 未対応＝実測 2026-10-11）=====
  const MODS = ["通常", "濃霧", "灼熱", "サドンデス", "一触即発"];
  const FORMS = D.FORMATIONS.map((f) => f.name);

  // ===== 相手：元のゲームの分隊戦キャンペーンの部隊（外の現実）=====
  const resolve = (x) => (Array.isArray(x) ? x.slice() : (D.PRESETS[x] || D.PRESETS[Object.keys(D.PRESETS)[0]]).slice());
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const RIVALS = D.SQUAD_CAMPAIGN.map((c) => {
    if (c.mirror || !Array.isArray(c.squad)) return { key: c.key, name: c.name, flavor: c.flavor || "", scout: c.scout || "", mirror: true, squad: null, emb: null, names: null, form: null, mod: "通常" }; // 写し身＝出撃時にあなたの部隊を写す
    const squad = c.squad.map(resolve), emb = assignEmblems(squad), g = SCS.makeRNG(hashStr(c.key)), used = new Set();
    const names = emb.map((e) => { let n; do n = EMB_NAME[e] + "-" + (1 + g.int(9)); while (used.has(n)); used.add(n); return n; });
    const mod = MODS.includes(c.mod) ? c.mod : "通常";
    return { key: c.key, name: c.name, flavor: c.flavor || "", scout: c.scout || "", squad, emb, names, form: c.form || "散開", mod };
  });

  // ===== 既定の部隊（初めて開いた時）=====
  const DEFAULT_SQUAD = [
    { name: "WOLF-7", emb: "wolf", choices: [3, 3, 0, 0, 1, 2, 0, 2, 2, 2] },
    { name: "AEGIS-2", emb: "shield", choices: D.PRESETS["専守要塞"].slice() },
    { name: "FROST-4", emb: "frost", choices: D.PRESETS["鉄律の射手"].slice() },
  ];

  SCS2.world = { PLAZA, EMB, EMB_NAME, assignEmblems, wordsOf, WEAPON_ICON, bodyOf, MODS, FORMS, RIVALS, DEFAULT_SQUAD, hashStr, clamp };
})();
