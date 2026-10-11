/* v2/js/world.js — v2 の世界の定義（Obsidian [[v2ゲーム設計]]）。
 * 戦場「遺跡の円形広場」（地図の絵に合わせた当たり判定）・駒の紋章・武器アイコン・相手（元のゲームの分隊戦キャンペーンの部隊）。
 * data.js は書き換えない（戦場・地形の種類はここで DATA に足す）。通れない地形は squad.js が nav:true の戦場だけで扱う（[[分隊戦設計]]§16）。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const D = SCS.DATA;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ===== 地形の種類を足す（[[v2ゲーム設計]] v2.terrain）：通れないが見通せる。squad.js は戦場に nav:true がある時だけ使う =====
  Object.assign(D.TERRAIN, {
    lavapit: { name: "溶岩の谷", def: 0, avoid: 0, move: 1, aim: 0, block: true },
    deepwater: { name: "深い水", def: 0, avoid: 0, move: 1, aim: 0, block: true },
    thicket: { name: "密林", def: 0, avoid: 0, move: 1, aim: 0, block: true },
  });
  // ===== 戦場（160×90・1単位＝12px）。遮蔽物は proto/arena.js と同じ =====
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
    nav: true,
    terrain: [
      t(9.5, 0, 15, 37.5, "deepwater"), t(9.5, 46.5, 15, 43.5, "deepwater"),       // 左の川（滝あり・橋 y37.5〜46.5 だけ渡れる）
      t(130, 0, 25, 37.5, "lavapit"), t(130, 46.5, 25, 43.5, "lavapit"),          // 右の溶岩（橋 y37.5〜46.5 だけ渡れる）
      t(51, 31, 22, 22, "highground"),                                             // 中央の円盤
      t(0, 0, 9.5, 90, "forest"), t(155, 0, 5, 90, "forest"),                      // 川・溶岩の向こうの密林（橋から入れる・遅い）
      t(25, 0, 16, 12, "forest"), t(58, 0, 18, 8, "forest"), t(25, 68, 16, 22, "forest"),
      t(58, 80, 42, 10, "forest"), t(119, 0, 11, 30, "forest"), t(119, 50, 11, 40, "forest"),
    ],
    start: { p: { x: 50, y: 45 }, c: { x: 110, y: 45 } },                     // proto は 36/124。3対3で時間切れ 18.5%→12.5%（元のゲームの市街の廃墟と同じ水準・2026-10-11 実測）
    map: "assets/map_plaza.jpg", mini: "assets/map_plaza_mini.jpg",
  };
  // 溶岩の橋（128×72）：中央を縦に溶岩の谷、3本の石橋。左右の台地に遺跡と岩（GPT Image 2.5 の地図に合わせて引いた）
  const LAVA = {
    key: "lavabridge", name: "溶岩の橋", flavor: "溶岩の谷を3本の石橋が渡る", w: 128, h: 72, base: "plains",
    obstacles: [
      o(56, 6, 2, 5), o(72, 6, 2, 5), o(50.5, 27, 2.5, 6), o(73.5, 29, 2.5, 6), o(54, 53, 2, 6), o(72.5, 52.5, 2, 6),   // 橋の上の柱
      o(12, 4, 2.5, 7), o(18, 4, 2.5, 7), o(22.5, 3, 2, 6), o(2.5, 13, 2.5, 8), o(5.5, 13, 2.5, 7), o(15, 15, 3, 6),     // 左の台地
      o(26, 20, 2, 6), o(28, 12, 5, 4), o(0.5, 29, 7, 6), o(15, 34.5, 2.5, 6), o(28, 30, 6, 4),
      o(9, 48, 9, 2.5), o(12.5, 53, 9, 2.5), o(18, 57, 3, 3), o(0, 58, 9, 14), o(24, 61, 6, 8),
      o(116, 3, 2.5, 8.5), o(121.5, 8, 2.5, 7.5), o(119, 2.5, 5, 2), o(99, 2.5, 2, 6), o(97, 11, 6, 3), o(99.5, 14.5, 8, 5), // 右の台地
      o(110.5, 25.5, 2, 11), o(115.5, 24.5, 6, 2.5), o(110.5, 36, 8, 2.5), o(122.5, 27, 2.5, 12), o(94, 27, 5, 4.5), o(92.5, 41, 5.5, 5),
      o(101, 50.5, 6.5, 2), o(101, 50.5, 2, 8.5), o(106, 51.5, 2, 8), o(108.5, 49, 6, 6), o(122, 48, 3, 7), o(119.5, 38.5, 6, 3), o(117, 62, 11, 10),
    ],
    nav: true,
    terrain: [t(37.5, 0, 53, 7.5, "lavapit"), t(37.5, 15, 53, 15.5, "lavapit"), t(37.5, 38.5, 53, 14.5, "lavapit"), t(37.5, 62, 53, 10, "lavapit")], // 溶岩の谷（3本の橋だけ渡れる）
    start: { p: { x: 28, y: 36 }, c: { x: 100, y: 36 } },
    map: "assets/map_lava.jpg", mini: "assets/map_lava_mini.jpg",
  };
  // 霧の森（144×81）：密林の中の空き地。中央に沼、周りに遺跡・苔むした岩・茂み。左右の小道から入る
  const FOREST = {
    key: "mistwood", name: "霧の森", flavor: "密林の空き地。中央に沼、茂みに身を隠せる", w: 144, h: 81, base: "plains",
    obstacles: [
      o(36, 9, 4, 13.5), o(38, 2, 15, 6.5), o(31, 4, 3, 4), o(41, 12.5, 6, 6), o(57.5, 7, 3, 9.5), o(13, 24.5, 8, 7),
      o(90, 8, 2.5, 9), o(93, 10, 2, 6), o(100.5, 5, 3, 10.5), o(110, 3, 3.5, 13), o(113, 5, 4, 8), o(116.5, 16.5, 11, 11), o(115.5, 29.5, 3.5, 4.5),
      o(94.5, 27.5, 4.5, 4), o(96, 32.5, 7, 7),
      o(22, 53, 10, 16), o(40, 57, 6, 15), o(50.5, 68.5, 13, 6),
      o(103.5, 48.5, 4, 10), o(106, 56, 4, 8), o(100, 64, 9, 6), o(92.3, 63, 3, 7), o(82, 55.5, 4, 4),
    ],
    nav: true,
    terrain: [
      t(0, 0, 24, 33, "thicket"), t(0, 42, 22, 39, "thicket"), t(22, 71, 28, 10, "thicket"), t(24, 0, 10, 4, "thicket"),   // 密林の木々（通れない）
      t(120, 0, 24, 34, "thicket"), t(124, 46, 20, 35, "thicket"), t(66, 76, 46, 5, "thicket"),
      t(52, 25, 36, 30, "swamp"), t(57, 22, 26, 34, "swamp"),                       // 沼（浅い・足が遅い）
      t(108, 8, 20, 22, "rubble"), t(18, 50, 22, 22, "rubble"),                     // 大樹の根（足が遅い・身を守れる）
      t(33, 28.5, 11, 9.5, "forest"), t(94.5, 15, 11, 8.5, "forest"), t(110, 36, 14, 10, "forest"), t(52, 48, 9, 7.5, "forest"), t(28, 40, 7, 5.5, "forest"), t(112, 48, 12, 12, "forest"),
      t(62, 0, 26, 5, "forest"), t(118, 46, 6, 35, "forest"), t(50, 71, 16, 10, "forest"),
    ],
    start: { p: { x: 24, y: 37 }, c: { x: 120, y: 40 } },
    map: "assets/map_forest.jpg", mini: "assets/map_forest_mini.jpg",
  };
  const ARENAS = [PLAZA, LAVA, FOREST];
  ARENAS.forEach((A) => { if (!D.ARENAS.some((a) => a.key === A.key)) D.ARENAS.push(A); });
  // 相手の得意な戦場（元のゲームの戦場名から近いものへ）
  const ARENA_OF = { "溶岩洞窟": LAVA, "吊り橋": LAVA, "深い森": FOREST };
  const arenaFor = (r) => ARENA_OF[r.arena] || PLAZA;

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

  // ===== 戦況：戦場に見える天気だけ（狭まる戦場・火の海は squad.js 未対応／サドンデス・一触即発は見えない決まりなので外した）=====
  const MODS = ["通常", "濃霧", "灼熱"];                                                // 戦場に見える天気だけ（v2.fx.dec：サドンデス・一触即発は外した）
  const FORMS = D.FORMATIONS.map((f) => f.name);

  // ===== 相手：元のゲームの分隊戦キャンペーンの部隊（外の現実）=====
  const resolve = (x) => (Array.isArray(x) ? x.slice() : (D.PRESETS[x] || D.PRESETS[Object.keys(D.PRESETS)[0]]).slice());
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const RIVALS = D.SQUAD_CAMPAIGN.map((c) => {
    if (c.mirror || !Array.isArray(c.squad)) return { key: c.key, name: c.name, flavor: c.flavor || "", scout: c.scout || "", mirror: true, squad: null, emb: null, names: null, form: null, mod: "通常", arena: null }; // 写し身＝出撃時にあなたの部隊を写す
    const squad = c.squad.map(resolve), emb = assignEmblems(squad), g = SCS.makeRNG(hashStr(c.key)), used = new Set();
    const names = emb.map((e) => { let n; do n = EMB_NAME[e] + "-" + (1 + g.int(9)); while (used.has(n)); used.add(n); return n; });
    const mod = MODS.includes(c.mod) ? c.mod : "通常";
    return { key: c.key, name: c.name, flavor: c.flavor || "", scout: c.scout || "", squad, emb, names, form: c.form || "散開", mod, arena: c.arena };
  });

  // ===== 既定の部隊（初めて開いた時）=====
  const DEFAULT_SQUAD = [
    { name: "WOLF-7", emb: "wolf", choices: [3, 3, 0, 0, 1, 2, 0, 2, 2, 2] },
    { name: "AEGIS-2", emb: "shield", choices: D.PRESETS["専守要塞"].slice() },
    { name: "FROST-4", emb: "frost", choices: D.PRESETS["鉄律の射手"].slice() },
  ];

  SCS2.world = { PLAZA, LAVA, FOREST, ARENAS, arenaFor, EMB, EMB_NAME, assignEmblems, wordsOf, WEAPON_ICON, bodyOf, MODS, FORMS, RIVALS, DEFAULT_SQUAD, hashStr, clamp };
})();
