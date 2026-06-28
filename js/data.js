/* data.js — 設計書 v0.1 の確定数値をそのまま保持する唯一のデータ層
 * 出典: Obsidian「ゲーム開発/Simple Circle Showdown/ゲーム設計書.md」
 * ★ここの値は設計書と1:1。勝手な仮値を入れない。設計書を変えたらここも同期する。
 *
 * 注: sim定数（射程の絶対値・間合い・移動量・命中式の係数・アリーナ・ターン上限）は
 *     設計書で「実装時に詰める／実戦チューニング前提」とされた実装レベルの値。SIM以下に集約。
 */
window.SCS = window.SCS || {};

(function () {
  // 4択 → 内部数値（中立なし）
  const CHOICE_VALUES = [-1.0, -0.4, 0.4, 1.0];

  // 10 大パラ（人格）。id は 1..10、設計書の①..⑩に対応
  const MACROS = [
    { id: 1, key: "belligerence", name: "闘争心", poles: ["専守防衛", "慎重派", "攻め志向", "猪突猛進"] },
    { id: 2, key: "risk", name: "リスク選好", poles: ["石橋を叩く", "堅実", "勝負師", "一か八か"] },
    { id: 3, key: "composure", name: "冷静さ", poles: ["短気・激情", "熱くなりやすい", "おおむね冷静", "沈着冷静"] },
    { id: 4, key: "patience", name: "忍耐(テンポ)", poles: ["せっかち", "早仕掛け", "じっくり", "待ち徹底"] },
    { id: 5, key: "discipline", name: "規律", poles: ["気まぐれ", "即興肌", "几帳面", "鉄の規律"] },
    { id: 6, key: "adaptivity", name: "順応性", poles: ["頑固・我流", "マイペース", "観察派", "変幻自在"] },
    { id: 7, key: "pride", name: "誇り", poles: ["手段選ばず", "実利寄り", "誇り高い", "騎士道"] },
    { id: 8, key: "ruthlessness", name: "非情さ", poles: ["お人好し", "抑制的", "仕留めにいく", "冷酷無慈悲"] },
    { id: 9, key: "confidence", name: "自信", poles: ["弱気", "等身大", "強気", "過信・慢心"] },
    { id: 10, key: "curiosity", name: "好奇心", poles: ["教科書通り", "基本重視", "試行好き", "何でも試す"] },
  ];

  // 24 小パラ（挙動）。base=0.5、w は { 大パラid: 重み }。空欄=0。
  // inter / dyn は静的相互作用・動的修飾の識別子（derive/sim 側で処理）
  const MICROS = [
    // A. 交戦・攻撃
    { id: "A1", cat: "A", name: "交戦距離選好", lo: "近接張り付き", hi: "遠距離維持", w: { 1: -0.30, 2: -0.10, 4: 0.15 } },
    { id: "A2", cat: "A", name: "攻撃開始の早さ", lo: "様子見", hi: "即攻撃", w: { 1: 0.30, 4: -0.15, 9: 0.10 } },
    { id: "A3", cat: "A", name: "近接傾倒", lo: "遠距離主体", hi: "接近して殴る", w: { 1: 0.30, 2: 0.15, 4: -0.10 }, inter: "dive" },
    { id: "A4", cat: "A", name: "連射・手数", lo: "精密一発", hi: "とにかく手数", w: { 1: 0.15, 4: -0.30, 5: -0.10 } },
    { id: "A5", cat: "A", name: "命中見込み閾値", lo: "低確率でも撃つ", hi: "当たる時だけ", w: { 2: -0.30, 5: 0.15, 9: -0.10 } },
    { id: "A6", cat: "A", name: "フィニッシュ性向", lo: "深追いせず", hi: "容赦なく詰める", w: { 1: 0.15, 7: -0.10, 8: 0.30 } },
    // B. 移動・位置取り
    { id: "B1", cat: "B", name: "遮蔽物利用", lo: "正面無視", hi: "積極的に隠れる", w: { 2: -0.15, 7: -0.30, 10: 0.10 } },
    { id: "B2", cat: "B", name: "間合い管理(カイト)", lo: "突っ込む", hi: "ヒット&アウェイ", w: { 1: -0.15, 4: 0.30, 7: -0.10 } },
    { id: "B3", cat: "B", name: "回避・ステップ", lo: "棒立ち", hi: "よく避ける", w: { 1: -0.10, 2: -0.15, 3: 0.30 } },
    { id: "B4", cat: "B", name: "スペーシング維持", lo: "ふらふら", hi: "きっちり保つ", w: { 3: 0.10, 4: 0.15, 5: 0.30 } },
    { id: "B5", cat: "B", name: "動き回り", lo: "拠点的", hi: "常に動く", w: { 4: -0.15, 5: -0.30, 10: 0.10 } },
    { id: "B6", cat: "B", name: "陣取り選好", lo: "隅・壁際で守る", hi: "中央を取る攻勢", w: { 1: 0.30, 2: 0.10, 7: 0.15 } },
    // C. 状況判断・リスク
    { id: "C1", cat: "C", name: "撤退閾値", lo: "死ぬまで戦う", hi: "早めに退く", w: { 2: -0.15, 3: 0.10, 7: -0.30 } },
    { id: "C2", cat: "C", name: "リスク許容", lo: "安全第一", hi: "被弾覚悟で勝負", w: { 1: 0.10, 2: 0.30, 9: 0.15 } },
    { id: "C3", cat: "C", name: "好機の食いつき", lo: "慎重に見送る", hi: "即飛びつく", w: { 4: -0.10, 6: 0.15, 8: 0.30 } },
    { id: "C4", cat: "C", name: "状況評価バイアス", lo: "過大評価=弱気", hi: "過小評価=強気", w: { 1: 0.15, 9: 0.30 }, dyn: "confbias" },
    { id: "C5", cat: "C", name: "プレッシャー耐性", lo: "パニック", hi: "泰然", w: { 3: 0.30, 5: 0.15, 7: 0.10 } },
    { id: "C6", cat: "C", name: "粘り・最後の抵抗", lo: "諦め/逃げ", hi: "死中に活=特攻", w: { 2: 0.15, 3: -0.10, 7: 0.30 }, dyn: "laststand" },
    // D. 対応・適応
    { id: "D1", cat: "D", name: "相手読み", lo: "自分本位", hi: "相手基準で動く", w: { 3: 0.15, 5: 0.10, 6: 0.30 }, inter: "counter" },
    { id: "D2", cat: "D", name: "戦術切替", lo: "同じ手を繰り返す", hi: "すぐ切替", w: { 5: -0.10, 6: 0.30, 10: 0.15 } },
    { id: "D3", cat: "D", name: "予測不能性", lo: "読まれやすい", hi: "撹乱", w: { 5: -0.30, 6: 0.10, 10: 0.15 } },
    { id: "D4", cat: "D", name: "狡猾さ(権謀術数)", lo: "正々堂々", hi: "海千山千", w: { 7: -0.30, 10: 0.15, 6: 0.10 } },
    { id: "D5", cat: "D", name: "環境の創造的活用", lo: "ただの障害", hi: "罠/壁打ちに使う", w: { 2: -0.10, 6: 0.15, 10: 0.30 } },
    { id: "D6", cat: "D", name: "学習・記憶", lo: "学ばない", hi: "同じ手を食らわない", w: { 3: 0.15, 5: 0.10, 6: 0.30 } },
  ];

  // 静的相互作用（化学反応）。設計書「重み行列・係数」より
  const INTERACTIONS = {
    dive: { target: "A3", lambda: 0.35, a: 1, b: 2 }, // +0.35·relu(①)·relu(②)
    counter: { target: "D1", lambda: 0.25, a: 6, b: 3 }, // +0.25·relu(⑥)·relu(③)
  };

  // HP 式: clamp(100 -12·① -10·② +8·④ -6·⑨, 70, 130)
  const HP = { base: 100, min: 70, max: 130, coef: { 1: -12, 2: -10, 4: 8, 9: -6 } };

  /* 武器プール（設計書 v0.1）。
   * 表示系ステータスは設計書通り。effRange/reach/falloff/knockback は sim 実装定数（field=100幅基準）。
   * affinity: { 大パラid: 重み }、baseline 込みで score = baseline + Σ aff·m、各プールで argmax。
   */
  // 遠距離武器（拡張版）。mode=auto/semi/burst/charge, mag=マガジン弾数, reloadTurns=リロード所要,
  // spreadGrowth=連射での拡散増, crit/critMult=会心, status=状態異常({type,dmg,turns}|null), moveAccuracy=移動射撃倍率
  const RANGED = [
    { key: "sniper", name: "スナイパーライフル", damage: 45, rangeFrac: 0.95, fireRate: 0.5, accuracy: 0.97, effRange: 95, falloff: 60, moveAccuracy: 0.42, mode: "charge", mag: 8, reloadTurns: 1, spreadGrowth: 0, crit: 0.30, critMult: 2.5, status: null, aff: { 4: 1.0, 1: -0.7, 3: 0.5, 5: 0.5 }, base: 0 },
    { key: "marksman", name: "マークスマンライフル", damage: 26, rangeFrac: 0.80, fireRate: 1.2, accuracy: 0.90, effRange: 80, falloff: 45, moveAccuracy: 0.55, mode: "semi", mag: 10, reloadTurns: 1, spreadGrowth: 0, crit: 0.15, critMult: 2.0, status: null, aff: { 5: 0.6, 3: 0.4, 4: 0.3 }, base: 0.1 },
    { key: "assault", name: "アサルトライフル", damage: 9, rangeFrac: 0.65, fireRate: 6, accuracy: 0.75, effRange: 65, falloff: 30, moveAccuracy: 0.75, mode: "auto", mag: 30, reloadTurns: 1, spreadGrowth: 0.12, crit: 0.05, critMult: 1.5, status: null, aff: { 5: 0.2 }, base: 0.3 },
    { key: "smg", name: "SMG", damage: 9, rangeFrac: 0.45, fireRate: 12, accuracy: 0.66, effRange: 52, falloff: 20, moveAccuracy: 0.90, mode: "auto", mag: 25, reloadTurns: 1, spreadGrowth: 0.15, crit: 0.03, critMult: 1.5, status: null, aff: { 1: 1.0, 4: -0.7, 2: 0.5 }, base: 0 },
    { key: "lmg", name: "LMG", damage: 8, rangeFrac: 0.60, fireRate: 9, accuracy: 0.60, effRange: 60, falloff: 28, moveAccuracy: 0.70, mode: "auto", mag: 60, reloadTurns: 2, spreadGrowth: 0.10, crit: 0.03, critMult: 1.5, status: null, aff: { 1: 0.7, 4: 0.4, 9: 0.4, 5: -0.2 }, base: 0 },
    { key: "shotgun", name: "ショットガン", damage: 44, rangeFrac: 0.30, fireRate: 1.2, accuracy: 0.90, effRange: 30, falloff: 12, moveAccuracy: 0.90, mode: "semi", mag: 6, reloadTurns: 2, spreadGrowth: 0, crit: 0.10, critMult: 1.5, status: null, aff: { 1: 0.8, 2: 0.6, 4: -0.3 }, base: 0 },
    { key: "pistol", name: "拳銃", damage: 15, rangeFrac: 0.50, fireRate: 2.5, accuracy: 0.82, effRange: 50, falloff: 30, moveAccuracy: 0.85, mode: "semi", mag: 12, reloadTurns: 1, spreadGrowth: 0, crit: 0.10, critMult: 1.8, status: null, aff: { 5: 0.3 }, base: 0.25 },
    { key: "burst", name: "バーストライフル", damage: 10, rangeFrac: 0.60, fireRate: 3, accuracy: 0.86, effRange: 60, falloff: 30, moveAccuracy: 0.78, mode: "burst", mag: 24, reloadTurns: 1, spreadGrowth: 0.06, crit: 0.07, critMult: 1.6, status: null, aff: { 5: 0.5, 3: 0.4, 6: 0.3 }, base: 0 },
    { key: "flamethrower", name: "火炎放射器", damage: 4, rangeFrac: 0.25, fireRate: 10, accuracy: 0.95, effRange: 30, falloff: 12, moveAccuracy: 0.90, mode: "auto", mag: 40, reloadTurns: 2, spreadGrowth: 0.05, crit: 0, critMult: 1, status: { type: "burn", dmg: 6, turns: 3 }, aff: { 1: 0.7, 8: 0.7, 10: 0.4, 2: 0.4 }, base: 0 },
  ];
  // 近接武器（拡張版）。pattern=multi(多段)/balanced(均整)/heavy(大振り), windup=溜めターン
  const MELEE = [
    { key: "knife", name: "ナイフ", damage: 7, reach: 6, rate: 4, pattern: "multi", windup: 0, knockback: 0, crit: 0.15, critMult: 2.0, status: { type: "bleed", dmg: 3, turns: 2 }, aff: { 4: -1.0, 7: -0.7, 5: -0.5, 10: 0.3 }, base: 0 },
    { key: "dualblades", name: "二刀", damage: 6, reach: 7, rate: 5, pattern: "multi", windup: 0, knockback: 0, crit: 0.10, critMult: 1.8, status: null, aff: { 4: -0.8, 10: 0.6, 6: 0.5 }, base: 0 },
    { key: "katana", name: "刀", damage: 20, reach: 10, rate: 1.4, pattern: "balanced", windup: 0, knockback: 3, crit: 0.12, critMult: 2.0, status: { type: "bleed", dmg: 5, turns: 3 }, aff: { 7: 1.0, 5: 0.5, 3: 0.3 }, base: 0.2 },
    { key: "rapier", name: "レイピア", damage: 16, reach: 11, rate: 1.8, pattern: "balanced", windup: 0, knockback: 1, crit: 0.20, critMult: 2.2, status: { type: "poison", dmg: 3, turns: 3 }, aff: { 5: 0.7, 7: 0.4, 3: 0.4, 10: 0.3 }, base: 0 },
    { key: "greatsword", name: "大剣", damage: 38, reach: 11, rate: 0.7, pattern: "heavy", windup: 0, knockback: 6, crit: 0.10, critMult: 1.8, status: { type: "weaken", turns: 2, amt: 0.30 }, aff: { 1: 0.8, 9: 0.6, 7: 0.4 }, base: 0 },
    { key: "hammer", name: "大槌・斧", damage: 44, reach: 9, rate: 0.7, pattern: "heavy", windup: 0, knockback: 6, crit: 0.08, critMult: 1.6, status: { type: "stun", turns: 1, chance: 0.45 }, aff: { 1: 1.0, 2: 0.7, 9: 0.5 }, base: 0 },
    { key: "spear", name: "槍", damage: 21, reach: 16, rate: 1.0, pattern: "balanced", windup: 0, knockback: 5, crit: 0.10, critMult: 1.8, status: null, aff: { 1: -0.8, 4: 0.7, 2: -0.5 }, base: 0 },
    { key: "chain", name: "鎖鎌", damage: 14, reach: 13, rate: 1.3, pattern: "balanced", windup: 0, knockback: 8, crit: 0.10, critMult: 1.8, status: { type: "slow", turns: 2, mult: 0.55 }, aff: { 10: 0.7, 6: 0.5, 8: 0.4, 7: -0.3 }, base: 0 },
  ];
  const STATUS_JP = { burn: "燃焼", bleed: "出血", poison: "毒", stun: "麻痺", weaken: "脆弱", slow: "鈍足" };

  // CPU アーキタイプ・プリセット（10軸の選択 index 0..3）。設計書のアーキタイプを再現
  const PRESETS = {
    "猪突ガラスキャノン": [3, 3, 1, 0, 2, 2, 1, 2, 3, 1], // → SMG+大槌・斧(麻痺) / HP70 ・超攻撃／脆い
    "専守要塞": [0, 0, 3, 3, 2, 2, 2, 1, 0, 1], //         → スナイパー+槍 / HP130 ・待ちの要塞
    "中庸バランス": [2, 1, 2, 1, 2, 2, 2, 1, 1, 1], //      → バーストライフル+刀(出血) / HP≈98 ・万能
    "海千山千の暗殺者": [2, 3, 1, 0, 0, 3, 0, 2, 2, 3], //   → SMG+ナイフ(出血) / HP75 ・狡猾MAXの紙装甲
    "鉄律の射手": [1, 1, 3, 1, 3, 2, 2, 2, 1, 1], //        → バーストライフル+刀(出血) / HP108 ・規律・先読み深い中距離
    "かく乱の火付け": [2, 2, 2, 1, 0, 3, 0, 2, 2, 3], //     → 火炎放射器(燃焼)+ナイフ(出血) / HP86 ・状態異常と撹乱
    "重剣の闘士": [3, 0, 2, 1, 2, 1, 2, 1, 2, 1], //        → SMG+大剣(脆弱) / HP92 ・堅実な重量級
    "毒手の刺客": [1, 1, 3, 2, 3, 2, 1, 2, 1, 2], //        → スナイパー+レイピア(毒) / HP114 ・遠近両用の毒使い
  };

  const SIM = { turnCap: 30, baseStep: 12 }; // 共通定数（実戦チューニング前提）

  // 地形効果（その上に立つユニットへの修飾）。def=被ダメ減%, avoid=回避%, move=移動倍率, aim=攻撃側命中ボーナス
  const TERRAIN = {
    plains: { name: "平地", def: 0, avoid: 0, move: 1.0, aim: 0 },
    forest: { name: "茂み", def: 0.15, avoid: 0.15, move: 0.85, aim: 0 },
    rubble: { name: "瓦礫", def: 0.35, avoid: 0.05, move: 0.70, aim: 0 },
    swamp: { name: "沼地", def: 0, avoid: -0.10, move: 0.50, aim: 0 },
    highground: { name: "高所", def: 0.10, avoid: 0, move: 1.0, aim: 0.15 },
    lava: { name: "溶岩", def: 0, avoid: 0, move: 0.7, aim: 0, dmg: 7 }, // 立つと毎ターン被弾＝避けるべき危険地帯
  };

  // 戦場プール（ランダム選択）。obstacles=射線を遮る固体、terrain=立つと効果のゾーン、base=全域の既定地形
  const ARENAS = [
    { key: "plain", name: "開けた平原", flavor: "遮蔽ほぼ無し・長射程有利（近接は接近地獄）", w: 140, h: 60, base: "plains",
      obstacles: [{ x: 66, y: 26, w: 8, h: 8 }],
      terrain: [{ x: 30, y: 10, w: 18, h: 14, t: "forest" }, { x: 92, y: 36, w: 18, h: 14, t: "forest" }],
      start: { p: { x: 24, y: 30 }, c: { x: 116, y: 30 } } },
    { key: "ruins", name: "市街の廃墟", flavor: "遮蔽多・接近戦／側面取り有利", w: 100, h: 52, base: "plains",
      obstacles: [{ x: 30, y: 8, w: 10, h: 8 }, { x: 62, y: 34, w: 10, h: 9 }, { x: 46, y: 22, w: 6, h: 6 }],
      terrain: [{ x: 12, y: 18, w: 14, h: 16, t: "rubble" }, { x: 74, y: 18, w: 14, h: 16, t: "rubble" }],
      start: { p: { x: 8, y: 26 }, c: { x: 92, y: 26 } } },
    { key: "arena", name: "狭い闘技場", flavor: "狭くカイト不能・強制接近", w: 62, h: 40, base: "plains",
      obstacles: [{ x: 28, y: 17, w: 6, h: 6 }],
      terrain: [{ x: 26, y: 5, w: 10, h: 6, t: "highground" }],
      start: { p: { x: 8, y: 20 }, c: { x: 54, y: 20 } } },
    { key: "forest", name: "深い森", flavor: "全域が茂み・回避/防御高・遠距離弱体", w: 110, h: 56, base: "forest",
      obstacles: [{ x: 40, y: 14, w: 6, h: 6 }, { x: 64, y: 36, w: 6, h: 6 }],
      terrain: [{ x: 48, y: 24, w: 16, h: 12, t: "swamp" }],
      start: { p: { x: 10, y: 28 }, c: { x: 100, y: 28 } } },
    { key: "bunker", name: "中央遮蔽", flavor: "中央に大遮蔽・角度取りと回り込み", w: 112, h: 52, base: "plains",
      obstacles: [{ x: 48, y: 18, w: 16, h: 16 }],
      terrain: [{ x: 18, y: 20, w: 12, h: 12, t: "rubble" }, { x: 82, y: 20, w: 12, h: 12, t: "rubble" }, { x: 46, y: 5, w: 20, h: 6, t: "swamp" }, { x: 46, y: 41, w: 20, h: 6, t: "swamp" }],
      start: { p: { x: 10, y: 26 }, c: { x: 102, y: 26 } } },
    { key: "volcano", name: "溶岩洞窟", flavor: "溶岩が点在・立ち位置が命取り（押し込まれると焼かれる）", w: 96, h: 50, base: "plains",
      obstacles: [{ x: 30, y: 8, w: 8, h: 7 }, { x: 60, y: 35, w: 8, h: 7 }],
      terrain: [{ x: 42, y: 0, w: 12, h: 17, t: "lava" }, { x: 42, y: 33, w: 12, h: 17, t: "lava" }, { x: 22, y: 12, w: 9, h: 8, t: "lava" }, { x: 65, y: 30, w: 9, h: 8, t: "lava" }, { x: 12, y: 23, w: 8, h: 6, t: "rubble" }],
      start: { p: { x: 8, y: 25 }, c: { x: 88, y: 25 } } },
    { key: "bridge", name: "吊り橋", flavor: "細い一本道・遮蔽も足場も無い超接近の殴り合い", w: 80, h: 18, base: "plains",
      obstacles: [],
      terrain: [],
      start: { p: { x: 8, y: 9 }, c: { x: 72, y: 9 } } },
    { key: "collapse", name: "崩れゆく遺跡", flavor: "脆い遮蔽だらけ・撃ち込みで崩落多発", w: 104, h: 50, base: "plains",
      obstacles: [{ x: 26, y: 10, w: 8, h: 8 }, { x: 48, y: 30, w: 8, h: 8 }, { x: 70, y: 12, w: 8, h: 8 }, { x: 52, y: 8, w: 7, h: 6 }, { x: 30, y: 34, w: 7, h: 6 }],
      terrain: [{ x: 12, y: 20, w: 12, h: 12, t: "rubble" }, { x: 80, y: 20, w: 12, h: 12, t: "rubble" }],
      start: { p: { x: 8, y: 25 }, c: { x: 96, y: 25 } } },
  ];

  // 戦況モディファイア（毎戦ランダム or 指定）。戦闘のルール自体を変えて毎戦に変化を付ける
  // acc=全命中倍率, staMul=気力消費倍率, crit=会心率加算, dmgMul=全ダメージ倍率, sudden=終盤被ダメ増, ring=外周崩壊(中央へ), ignite=各所で発火
  const MODIFIERS = [
    { key: "none", name: "通常", flavor: "", weight: 4 },
    { key: "fog", name: "濃霧", flavor: "視界が悪く、命中が落ちる", acc: 0.78, weight: 2 },
    { key: "heat", name: "灼熱", flavor: "うだる暑さ、消耗が激しい", staMul: 1.7, weight: 2 },
    { key: "sudden", name: "サドンデス", flavor: "終盤、被ダメージが跳ね上がる", sudden: true, weight: 2 },
    { key: "ring", name: "狭まる戦場", flavor: "外周が崩れ、中央へ追い込まれる", ring: true, weight: 2 },
    { key: "edge", name: "一触即発", flavor: "会心が出やすく、誰もが脆い", crit: 0.15, dmgMul: 1.12, weight: 2 },
    { key: "inferno", name: "火の海", flavor: "そこかしこで炎が噴き上がる", ignite: true, weight: 2 },
  ];

  SCS.DATA = { CHOICE_VALUES, MACROS, MICROS, INTERACTIONS, HP, RANGED, MELEE, PRESETS, SIM, TERRAIN, ARENAS, STATUS_JP, MODIFIERS };
})();
