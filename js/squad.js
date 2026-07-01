/* squad.js — 分隊戦（N対N）エンジン。1v1の makeBattle は触らず独立。[[分隊戦設計]]
 *   buildUnit/DATA/makeRNG を再利用。戦闘式（命中/被ダメ/側背面/期待ダメ/勝間合い/必殺名）は1v1から移植（数値同一）。
 *   ターゲット選定AI＋貪欲1手評価（先読みなし・期待値＝乱数非消費）＋同時解決。集中砲火・側背面・崩壊の連鎖が創発。
 *   決定論：攻撃ロール=本戦rng、決定は乱数非消費、固定順序(P[0..],C[0..])。描画/集計は非干渉。
 */
window.SCS = window.SCS || {};

(function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function ptInRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }
  function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
  function segSeg(a, b, c, d) { const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)); }
  function segIntersectsRect(p, q, r) {
    if (ptInRect(p, r) || ptInRect(q, r)) return true;
    const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
    return segSeg(p, q, { x: x1, y: y1 }, { x: x2, y: y1 }) || segSeg(p, q, { x: x2, y: y1 }, { x: x2, y: y2 }) || segSeg(p, q, { x: x2, y: y2 }, { x: x1, y: y2 }) || segSeg(p, q, { x: x1, y: y2 }, { x: x1, y: y1 });
  }
  const MOVES = ["ADVANCE", "RETREAT", "STRAFE_L", "STRAFE_R", "COVER", "HOLD"];
  const ULT_NAME = { precise: "零距離の一射", auto: "弾幕の嵐", shotgun: "至近の一掃", flame: "業火の渦", mlt: "嵐の連撃", hvy: "全霊の一撃", bal: "会心の一閃" };

  // ===== 描写の語彙（武器カテゴリ別）＋決定論ハッシュ（乱数非消費＝seed/turnで一意に多彩化）=====
  function hsh(a, b, c, d, e) { let h = 2166136261 >>> 0; const ks = [a | 0, b | 0, c | 0, d | 0, e | 0]; for (const k of ks) { h ^= k; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function vary(pool, a, b, c, d, e) { return pool[hsh(a, b, c, d, e) % pool.length]; }
  const HIT_VERB = { // 一撃（過去形・武器カテゴリ別）＝actOfで使用。バリエーション拡充。
    precise: ["を狙い澄まして撃ち抜いた", "の急所へ一射を通した", "に風穴を開けた", "を正確に射抜いた", "の隙を逃さず撃ち抜いた", "へ静かに引き金を絞り撃ち込んだ", "を照準の芯で捉え撃ち抜いた"],
    auto: ["に弾幕を浴びせた", "を掃射で削り取った", "へ雨あられと撃ち込んだ", "を弾雨で射すくめた", "に連射を叩き込んだ", "を弾幕で押し包んだ"],
    shotgun: ["を至近で薙ぎ払った", "に散弾を叩き込んだ", "を吹き飛ばした", "へゼロ距離の一撃を見舞った", "を散弾で抉った"],
    flame: ["を業火で包んだ", "に火線を浴びせた", "を火達磨にした", "へ炎を吹きつけた", "を炎の舌で舐めた"],
    mlt: ["を切り刻んだ", "に刺突を連ねた", "を斬り立てた", "へ手数で押し込んだ", "を細かく刻んだ", "へ二の太刀三の太刀を継いだ"],
    hvy: ["に渾身の一撃を見舞った", "を叩き伏せた", "を打ち砕いた", "へ全体重の一撃を叩き込んだ", "を唸る刃で薙いだ"],
    bal: ["へ鋭く斬り込んだ", "を鋭く突いた", "を薙ぎ払った", "へ踏み込みざま斬りつけた", "の胴を払った", "へ半身から斬り上げた"],
  };
  const REACT = { // 手応え（被ダメの深さ・攻撃行の末尾に付す）
    graze: ["掠めるに留まる", "浅い、なお余力を残す", "紙一重で急所を外れる", "軽く弾かれる"],
    light: ["確かに削った", "浅く抉る手応え", "じわりと効く", "血がにじむ"],
    solid: ["深々と食い込む", "鈍い衝撃が奔る", "確かな手応え", "体勢が揺らぐ"],
    heavy: ["たまらず体勢が崩れる", "骨まで届く一撃", "大きくよろめかせる", "膝が折れかける"],
    huge: ["致命的な深手", "ひとたまりもない", "崩れ落ちる寸前まで追い込む", "戦線に穴が開く一撃"],
  };
  const MISS_VERB = { // 外し（過去形・武器カテゴリ別）
    precise: ["を狙うも、わずかに逸れた", "へ放った一射は的を捉えきれず", "を狙撃するも空を裂いた", "を狙うも紙一重で外した"],
    auto: ["へ乱射するも捉えきれず", "を狙うも弾は逸れた", "へ撃ち込むも当たらず", "を掃射するも空を薙いだ"],
    shotgun: ["を狙うも散弾は空を切った", "へ薙ぐも間合いが足りず"],
    flame: ["へ炎を伸ばすも届かず", "を焼こうとするも空を舐めた"],
    mlt: ["へ斬りかかるも空を切った", "の残像を斬った", "へ刃を振るうも捉えきれず"],
    hvy: ["の一撃は空振りに終わった", "を狙うも大きく外した", "の渾身が空を打った"],
    bal: ["へ斬りつけるもかわされた", "の一手は空を切った", "を狙うも捉えきれず"],
  };
  const KO_VERB = {
    precise: ["を撃ち倒した", "の急所を撃ち抜いた", "を沈黙させた", "を一射で仕留めた", "の眉間を撃ち抜いた"],
    auto: ["を弾幕で薙ぎ倒した", "を撃ち伏せた", "を蜂の巣にした", "を弾雨に沈めた"],
    shotgun: ["を至近で吹き飛ばした", "を散弾で薙ぎ倒した", "をゼロ距離で沈めた"],
    flame: ["を業火に呑んだ", "を焼き尽くした", "を灰にした"],
    mlt: ["を斬り刻んで倒した", "の急所を貫いた", "を細切れに斬り伏せた"],
    hvy: ["を一撃のもとに叩き伏せた", "を打ち砕いた", "を粉砕した"],
    bal: ["を斬り伏せた", "を討ち取った", "を一刀のもとに倒した", "を袈裟に斬り下ろした"],
  };
  const KO_LEAD = ["渾身の一撃——", "好機を逃さず——", "一瞬の隙を突き——", "刹那の交錯——", "静寂を裂いて——", "とどめとばかりに——"]; // KOのドラマの導入
  const SKIRMISH = ["両軍が各所で斬り結ぶ", "盤面の各所で撃ち合いが続く", "入り乱れての応酬", "至る所で小競り合いが起きる", "硝煙が視界を霞ませる中の乱戦", "遮蔽を挟んでの睨み合いと牽制"];
  const MANEUVER = ["両軍、間合いを計り直す。", "睨み合いが続く——誰が先に動くか。", "じりじりと間合いが詰まる。", "各々が射線と退路を探る。", "盤面が静かに動く。", "互いに位置を入れ替え、隙を窺う。", "前衛が圧をかけ、後衛が射点を探す。", "張り詰めた均衡——一手が雪崩を呼ぶ。", "遮蔽から遮蔽へ、影が滑る。", "誰もが引き金に指をかけ、瞬きを惜しむ。", "静寂が張り詰め、砂塵だけが舞う。"];
  const ATMO = ["硝煙が薄く棚引く。", "薬莢が地に散り、乾いた音を立てる。", "砂塵が視界の端を霞ませる。", "張り詰めた空気が肌を刺す。", "遠くで壁が崩れる音が響く。", "血と硝煙の匂いが漂う。"]; // 情景（一瞬の切り取り）
  const SEARCH_ACT = ["物陰を窺いながら進む", "遮蔽を伝って間合いを詰める", "視線を巡らせ敵影を探す", "足音を殺して前へ出る", "射線を確保しつつ索敵する", "気配を探りながら歩を進める", "銃を構えたまま角を回り込む", "息を潜め、敵の気配に耳を澄ます"]; // 個体の索敵動作（誰が、を明示）
  const INSTINCT_ACT = ["第六感で敵の気配を辿り、潜む方へ詰める", "勘を頼りに敵の潜伏点へ忍び寄る", "気配の揺らぎを嗅ぎ取り、そちらへ間合いを詰める", "研ぎ澄ました直感で敵の所在を探り当てにかかる"]; // 嗅覚(D1)が鋭い体の索敵（多彩化）
  const SPOT_VERB = ["を発見！", "を視界に捉えた！", "の姿を捉えた！", "の気配を掴んだ！", "を見つけた！"];
  const SNAP_ACC = 0.30;       // ノーチャージ速射の命中倍率。溜め無しは圧倒的に当たらない（近距離なら近接武器を使う判断が自然に出る）
  const FOG_MAX_DIST = 95;     // これ未満の対角 or 回廊(h<18)なら霧なし（狭い部屋・吊り橋）
  const BASE_SIGHT_RATIO = 0.30; // 基本視野距離 = maxDist × 比率（戦場全域を見渡せないよう絞る）
  const TVERB = { 茂み: "茂みに身を潜め", 瓦礫: "瓦礫に身を寄せ", 沼地: "沼地に足を取られ", 高所: "高所に陣取り", 溶岩: "溶岩の際に立ち" };
  const FORM_HELD  = { line: "横一線で崩れず正対する", wedge: "楔の陣で一点に圧をかける", circle: "円陣で後衛を抱え守る" };
  const FORM_BROKE = { line: "戦列が乱れ、横の連携が切れかける", wedge: "楔が崩れ、勢いが散る", circle: "円陣が解け、後衛が露出しかける" };
  function weaponCat(w, ranged) {
    if (ranged) return w.key === "flamethrower" ? "flame" : w.mode === "charge" || w.key === "marksman" || w.key === "pistol" || w.key === "burst" ? "precise" : w.key === "shotgun" ? "shotgun" : "auto";
    return w.pattern === "multi" ? "mlt" : w.pattern === "heavy" ? "hvy" : "bal";
  }

  // ===== タンク度（ヘイト）＝目立つ(presence)×持ちこたえる(hold)。設計UIにも公開（盾を設計可能に）=====
  //   人格システムは高HP前衛タンクを産まない（HP式の制約）ので、HPでなくアグロ＋受け太刀で「狙われる盾＝デコイ」を成立させる。
  //   ★アグロ単体は脆い前衛(猪突HP70)を早死にさせ逆効果（勝率A/Bで判明）→ presence×hold を単一指標に。脆い体は吸引が弱まり早死にしない。
  //   静的（人格由来）＝乱数非消費・決定論。数値は非公開、語『盾』のみ表示。
  function basePresence(u) { // 注意を引く力：⑦誇り/⑨自信/B6中央志向で↑・C1早逃げ/弱気で↓
    const pride = u.mv[6], conf = u.mv[8], central = u.micros.B6, retreat = u.micros.C1;
    return clamp(0.4 + 0.3 * Math.max(0, pride) + 0.3 * Math.max(0, conf) + 0.4 * (central - 0.5) - 0.5 * (retreat - 0.5) - 0.3 * Math.max(0, -conf), 0, 1.2);
  }
  function holdFactor(u) { // 火力を持ちこたえる力：沈着C5・規律B4・HP（強めに依存）。低い体（脆く激情＝猪突HP70）はタンク度が大きく下がる
    return clamp(0.15 + u.micros.C5 * 0.45 + u.micros.B4 * 0.25 + (u.maxHp - 80) / 80, 0.1, 1.0);
  }
  function tankRating(u) { return clamp(basePresence(u) * holdFactor(u), 0, 1.2); } // タンク度＝目立つ×持ちこたえる
  // 協調性 coop（0=一匹狼/我流・利己 〜 1=献身/味方思い）。静的・人格由来・乱数非消費・決定論。チーム特有行動をゲートする。
  //   ↑順応(観察/変幻=味方を読む)・騎士道(味方を守る)・規律(隊形に従う)／↓手段選ばず(利己)・過信(単騎で手柄)・猪突(単騎突撃)。
  function coopRating(u) {
    const adapt = u.mv[5], pride = u.mv[6], disc = u.mv[4], conf = u.mv[8], belli = u.mv[0];
    return clamp(0.35 + 0.32 * Math.max(0, adapt) + 0.30 * Math.max(0, pride) - 0.25 * Math.max(0, -pride) + 0.20 * Math.max(0, disc) - 0.28 * Math.max(0, conf) - 0.22 * Math.max(0, belli), 0, 1);
  }

  SCS.makeSquadBattle = function (teamPChoices, teamCChoices, seed, arenaName, modName, formPName, formCName) {
    const D = SCS.DATA, S = D.SIM, T = D.TERRAIN, rng = SCS.makeRNG(seed);
    // 隊形（プレーヤーの作戦・既定=散開）。CPU側未指定はランダム（seed由来＝決定論）。
    const formKey = (name, salt) => { if (name && name !== "ランダム") { const f = D.FORMATIONS.find((x) => x.key === name || x.name === name); if (f) return f.key; } if (!name) return "loose"; return D.FORMATIONS[SCS.makeRNG((seed ^ salt) >>> 0).int(D.FORMATIONS.length)].key; };
    const formP = formKey(formPName, 0x111), formC = formKey(formCName, 0x222);

    // --- 戦場・戦況（makeBattleと同じ選び方）---
    let arena;
    if (arenaName && arenaName !== "ランダム") arena = D.ARENAS.find((a) => a.name === arenaName) || D.ARENAS[0];
    else arena = D.ARENAS[SCS.makeRNG((seed ^ 0x5bd1e995) >>> 0).int(D.ARENAS.length)];
    let mod;
    if (modName && modName !== "ランダム") mod = D.MODIFIERS.find((m) => m.name === modName) || D.MODIFIERS[0];
    else { const mr = SCS.makeRNG((seed ^ 0x27d4eb2f) >>> 0); let tot = 0; D.MODIFIERS.forEach((m) => (tot += m.weight || 1)); let r = mr.next() * tot; mod = D.MODIFIERS.find((m) => (r -= m.weight || 1) < 0) || D.MODIFIERS[0]; }
    const modAcc = mod.acc || 1, modSta = mod.staMul || 1, modCrit = mod.crit || 0;
    const field = { w: arena.w, h: arena.h }, baseTerrain = T[arena.base];
    const obstacles = arena.obstacles.map((o) => ({ ...o, hp: 70 }));
    const hazards = [];
    const maxDist = Math.hypot(arena.w, arena.h), turnCap = Math.round(S.turnCap * 1.5); // 30×1.5=45ターン上限（タイムアップ率↑・待ち戦の余地）
    let turn = 0, over = false, result = null, noDmgTurns = 0, ambushShown = false, lastGap = null, everContact = false;
    let prevLeadSign = 0, lastResidual = "", lastFooterTurn = -9; // 形勢転換の演出／残存フッターの冗長抑制（70%が無変化だった）
    const snapSeen = {};   // 前状況スナップショット：キー→{text,turn}。静的事実の連続反復を抑える（変化 or 3T経過で再掲）

    // ===== 幾何・地形・命中（1v1から移植）=====
    const cx = (x) => clamp(x, 0, field.w), cy = (y) => clamp(y, 0, field.h);
    function pushOutObstacle(x, y) {
      for (const o of obstacles) { if (o.hp <= 0) continue; if (x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h) { const dl = x - o.x, dr = o.x + o.w - x, dt = y - o.y, db = o.y + o.h - y, m = Math.min(dl, dr, dt, db); if (m === dl) x = o.x - 0.02; else if (m === dr) x = o.x + o.w + 0.02; else if (m === dt) y = o.y - 0.02; else y = o.y + o.h + 0.02; } }
      return { x: cx(x), y: cy(y) };
    }
    function terrainAt(p) { for (const z of arena.terrain) if (ptInRect(p, z)) return T[z.t]; return baseTerrain; }
    const terrainDmg = (p) => terrainAt(p).dmg || 0;
    const losClear = (a, b) => !obstacles.some((r) => r.hp > 0 && segIntersectsRect(a, b, r));
    function hazardAt(p) { let d = 0; for (const h of hazards) if (h.turns > 0 && ptInRect(p, h)) d += h.dmg; return d; }
    function nearestObstacle(p) { let best = null, bd = Infinity; for (const r of obstacles) { if (r.hp <= 0) continue; const ox = r.x + r.w / 2, oy = r.y + r.h / 2, d = Math.hypot(ox - p.x, oy - p.y); if (d < bd) { bd = d; best = { x: ox, y: oy }; } } return best; }
    const cornered = (u) => Math.min(u.x, field.w - u.x, u.y, field.h - u.y) < 7;

    const vulnOf = (u) => 1 + u.statuses.reduce((a, s) => Math.max(a, s.type === "weaken" ? s.amt : 0), 0);
    const slowOf = (u) => u.statuses.reduce((a, s) => Math.min(a, s.type === "slow" ? s.mult : 1), 1);
    const outFac = (u) => (0.7 + 0.3 * clamp(u.stamina, 0, 1)) * (1 + clamp(u.momentum, -1, 1) * 0.07) * (u.flinch > 0 ? 0.7 : 1);
    function dmgMod() { let m = mod.dmgMul || 1; if (mod.sudden && turn >= 12) m *= 1 + (turn - 12) * 0.07; return m; }
    const stepLen = (u, p) => S.baseStep * (0.6 + 0.8 * u.micros.B5) * terrainAt(p).move * slowOf(u) * (0.78 + 0.22 * clamp(u.stamina, 0, 1));
    function shotsFor(r, g) { let n = Math.floor(r); if (g.chance(r - n)) n++; return n; }

    function rangedHit(w, atkPos, defPos, foeS, d, los, moved) {
      if (!los) return 0;
      const rf = d <= w.effRange ? 1 : Math.max(0, 1 - (d - w.effRange) / w.falloff);
      const ev = Math.min(0.7, foeS.micros.B3 * 0.4);
      let h = w.accuracy * rf * (1 - ev) * (moved ? w.moveAccuracy : 1);
      h *= 1 - terrainAt(defPos).avoid; h *= 1 + terrainAt(atkPos).aim; h *= modAcc;
      return clamp(h, 0, 1);
    }
    const meleeHit = (foeS, defPos) => clamp(0.9 * (1 - Math.min(0.6, foeS.micros.B3 * 0.4) * 0.7) * (1 - terrainAt(defPos).avoid) * modAcc, 0, 1);
    const defMult = (defPos) => 1 - terrainAt(defPos).def;
    // ===== 回避・カウンター・崩し（1v1から移植＝個体テクスチャ。集中砲火/盾/側背面等のチーム解決は不変、その後段に乗せる）=====
    let evadeMap = new Map();                                   // このターン回避を選んだ体→回避率（resolveAttackの命中に反映）
    const dodgeEvade = (u) => clamp(0.45 + u.micros.B3 * 0.35, 0, 0.85) * clamp(u.stamina * 1.4, 0, 1); // B3回避巧者＋気力
    const grabDamage = (u) => Math.round((9 + u.micros.A6 * 9 + u.micros.A2 * 6) * outFac(u)); // 投げの威力（受け不能＝盾の軽減を無視）
    const grabReachOK = (att, def) => dist(att, def) <= att.melee.reach + 3;
    function counterStrike(def, atk) {                          // 回避成功×読み(D1/D6/B3)＝反撃の一閃
      const read = clamp(0.12 + def.micros.D1 * 0.4 + def.micros.D6 * 0.25 + def.micros.B3 * 0.2, 0, 0.85);
      if (!rng.chance(read)) return 0;
      const d2 = dist(def, atk), dmg = d2 <= def.melee.reach ? def.melee.damage * 1.1 : def.ammo > 0 ? def.ranged.damage * 0.8 : def.melee.damage * 0.5;
      return Math.round(dmg * outFac(def) * vulnOf(atk) * dmgMod());
    }
    function applyThrow(att, tgt, ev) {                         // 崩しが通った：受け不能の投げ。直接ダメージ＋引き離し＋怯み（盾/受けを貫通）
      let dmg = Math.round(grabDamage(att) * vulnOf(tgt) * dmgMod());
      const dx = tgt.x - att.x, dy = tgt.y - att.y, len = Math.hypot(dx, dy) || 1, thr = 7;
      const q = pushOutObstacle(cx(tgt.x + (dx / len) * thr), cy(tgt.y + (dy / len) * thr)); tgt.x = q.x; tgt.y = q.y;
      if (terrainDmg(tgt) > 0) { dmg += Math.round(6 * dmgMod()); ev.envThrow = true; }      // 溶岩/炎へ叩き込む
      else if (cornered(tgt)) { dmg += Math.round(4 * dmgMod()); ev.wallThrow = true; }       // 壁際へ叩きつける
      tgt.flinch = 1; tgt.stamina = clamp(tgt.stamina - 0.18, 0, 1);
      ev.grabHit = true; ev.dmg = (ev.dmg || 0) + dmg; return dmg;
    }
    function flankOf(att, def) {
      const dx = att.x - def.x, dy = att.y - def.y, l = Math.hypot(dx, dy) || 1, dot = (def.faceX * dx + def.faceY * dy) / l;
      if (dot > 0.45) return { tier: "front", acc: 1, crit: 0, dmg: 1, defMul: 1 };
      if (dot > -0.35) return { tier: "side", acc: 1.07, crit: 0.04, dmg: 1.03, defMul: 0.72 };
      return { tier: "rear", acc: 1.16, crit: 0.10, dmg: 1.10, defMul: 0.45 };
    }
    function expEx0(atk, def, d, los) {
      let dmg = 0;
      if (los) { const rf = d <= atk.ranged.effRange ? 1 : Math.max(0, 1 - (d - atk.ranged.effRange) / atk.ranged.falloff); dmg += atk.ranged.fireRate * atk.ranged.accuracy * rf * (1 - Math.min(0.7, def.micros.B3 * 0.4)) * atk.ranged.damage; }
      if (d <= atk.melee.reach) dmg += atk.melee.rate * 0.9 * (1 - Math.min(0.6, def.micros.B3 * 0.4) * 0.7) * atk.melee.damage;
      return dmg;
    }
    function expEx(atk, def, atkPos, defPos, d, los) {
      let dmg = 0;
      if (los) dmg += atk.ranged.fireRate * rangedHit(atk.ranged, atkPos, defPos, def, d, los, false) * atk.ranged.damage * defMult(defPos);
      if (d <= atk.melee.reach) dmg += atk.melee.rate * meleeHit(def, defPos) * atk.melee.damage * defMult(defPos);
      return dmg * outFac(atk);
    }
    function winDistOf(self, foe) { let best = 18, bv = -Infinity; for (const d of [8, 18, 30, 45, 60, 80, 95]) { if (d > maxDist + 6) continue; const v = expEx0(self, foe, d, true) - expEx0(foe, self, d, true); if (v > bv) { bv = v; best = d; } } return best; }
    // 勝てる間合いを敵【全体】に対して算出（先頭1体の偶然でロールがブレないように＝排他ロール判定の前提を安定化）
    function winDistVsTeam(self, foes) { let best = 18, bv = -Infinity; for (const d of [8, 18, 30, 45, 60, 80, 95]) { if (d > maxDist + 6) continue; let v = 0; for (const f of foes) v += expEx0(self, f, d, true) - expEx0(f, self, d, true); if (v > bv) { bv = v; best = d; } } return best; }
    const prefRangeOf = (u) => clamp(u.winDist + (u.micros.A1 - 0.5) * 2 * 25, 4, maxDist);

    // ===== 状態異常 =====
    function addStatus(u, s) {
      if (s.type === "stun") { if (s.chance && !rng.chance(s.chance)) return null; u.stun = Math.max(u.stun, s.turns); return "stun"; }
      const ex = u.statuses.find((x) => x.type === s.type);
      if (ex) ex.turns = Math.max(ex.turns, s.turns); else u.statuses.push({ ...s });
      return s.type;
    }
    function tickStatuses(u) { let dmg = 0; const types = []; for (const s of u.statuses) { if (s.dmg) { dmg += s.dmg; types.push(s.type); } s.turns--; } u.statuses = u.statuses.filter((s) => s.turns > 0); return { dmg, types }; }
    function igniteFire(x, y) { const w = 10, h = 8; hazards.push({ x: cx(x - w / 2), y: cy(y - h / 2), w, h, turns: 3, dmg: 6 }); if (hazards.length > 24) hazards.shift(); }

    // ===== 分隊の構築・配置 =====
    function mkUnit(choices, team, idx, n) {
      const u = SCS.derive.buildUnit(`${team}-${idx + 1}`, choices);
      u.name = team === "P" ? `戦士${idx + 1}` : `敵${idx + 1}`; // ★表示名を設計側（戦士N）と統一（レーダーは番号表示で不変）。自軍=戦士・敵軍=敵、色で区別。
      const left = team === "P", baseX = left ? Math.max(10, arena.start.p.x) : Math.min(field.w - 10, arena.start.c.x);
      const y = field.h * (idx + 1) / (n + 1);
      const presence = basePresence(u), hold = holdFactor(u), tank = tankRating(u), coop = coopRating(u); // タンク度＝目立つ×持ちこたえる／協調性＝チームプレイ度
      Object.assign(u, { team, idx, alive: true, target: null, x: baseX, y: cy(y), faceX: left ? 1 : -1, faceY: 0, idleTurns: 0, label: "待機", guarding: false, peeling: false, engage: "poke", presence, hold, tank, coop, form: team === "P" ? formP : formC, _opened: null, _focusCount: 0, _wardRef: null,
        ammo: u.ranged.mag, reloadLeft: 0, charged: false, spread: 0, statuses: [], stun: 0, stamina: 1, momentum: 0, resolve: 0, flinch: 0, _ultHold: 0, _closing: false,
        st: { dealt: 0, taken: 0, kills: 0, shots: 0, hits: 0, crits: 0, ults: 0, flanks: 0, downTurn: 0, dodges: 0, counters: 0, grabs: 0, grabHits: 0, wasFlanked: 0, winded: 0, resPeak: 0 } });
      return u;
    }
    const P = teamPChoices.map((c, i) => mkUnit(c, "P", i, teamPChoices.length));
    const C = teamCChoices.map((c, i) => mkUnit(c, "C", i, teamCChoices.length));
    const ALL = P.concat(C);
    const enemiesOf = (u) => (u.team === "P" ? C : P);
    const alliesOf = (u) => (u.team === "P" ? P : C);
    for (const u of ALL) { u.winDist = winDistVsTeam(u, enemiesOf(u)); } // 敵全体に対する勝てる間合い＝ロール判定が編成順でブレない
    // 役割で前後に配置：近接寄り(winDist小)は前線へ・遠距離寄り(winDist大)は後方へ＝後衛(射手)が前衛に守られる編成が成立
    for (const u of ALL) { const fwd = clamp((42 - u.winDist) / 42, -1, 1) * 16; const q = pushOutObstacle(cx(u.x + (u.team === "P" ? fwd : -fwd)), u.y); u.y = q.y; u.x = q.x; }

    // ===== 索敵・視界（ビジョンコーン）[[索敵・視界システム設計]] =====
    //   各体に視界扇型（前方FOV・距離Range）＋隠密。敵がコーン+射線に入れば発見。観戦者は全可視・AIだけ発見済みに反応。
    //   静的（人格＋アリーナ規模由来）＝乱数非消費・決定論。
    // ★狭い部屋・回廊（吊り橋）は見渡せば相手がいる＝索敵フェーズ自体が不自然。霧なし＝開幕から相互発見済み。視界システムは中〜大アリーナだけ機能。
    const fogless = maxDist < FOG_MAX_DIST || arena.h < 18;
    const baseSight = maxDist * BASE_SIGHT_RATIO;
    for (const u of ALL) {
      const m = u.micros;
      u.sightR = baseSight * clamp(0.6 + m.D1 * 0.5 + m.C5 * 0.2 + m.A1 * 0.25, 0.5, 1.5);     // 視界距離：相手読み/冷静/遠距離選好で伸びる＝斥候
      u.sightHalf = (28 + m.D1 * 30 + clamp(0.5 + u.mv[5] * 0.5, 0, 1) * 10) * Math.PI / 180;  // 視界半角(rad)：全角56°(トンネル)〜136°(広い斥候)。相手読み/順応で広い
      u.stealth = clamp(0.5 * m.B1 + 0.4 * m.D4 + 0.3 * Math.max(0, -u.mv[6]) + 0.2 * (1 - m.B5), 0, 1); // 隠密：遮蔽利用/狡猾/手段選ばず/気配消し
    }
    const cen = (t) => { let x = 0, y = 0, n = 0; for (const u of t) { x += u.x; y += u.y; n++; } return { x: x / n, y: y / n }; };
    const cenLive = (t) => { let x = 0, y = 0, n = 0; for (const u of t) if (u.alive) { x += u.x; y += u.y; n++; } return n ? { x: x / n, y: y / n } : null; }; // 生存敵の重心＝本能(嗅覚)で向かう先
    const homeOf = { P: cen(C), C: cen(P) };          // 各チームの「敵の居た方向」＝索敵の漠然とした向き先（開幕位置）
    const known = { P: new Map(), C: new Map() };     // team → Map(敵 → {lastSeen, x, y})。即時共有＋鮮度減衰
    const DETECT_DECAY = 3;                            // 全員が見失ってこのターン超でロスト＝再索敵
    if (fogless) for (const u of ALL) known[u.team === "P" ? "C" : "P"].set(u, { lastSeen: 0, x: u.x, y: u.y }); // 霧なし：開幕から各体を敵チームの発見済みに登録（索敵描写も発生しない）
    function refreshFogless() { for (const tm of ["P", "C"]) { const km = known[tm]; for (const u of (tm === "P" ? C : P)) { if (u.alive) km.set(u, { lastSeen: turn, x: u.x, y: u.y }); else km.delete(u); } } }

    const liveEnemies = (u) => enemiesOf(u).filter((e) => e.alive);
    function nearestLiveEnemy(u) { let best = null, bd = Infinity; for (const e of liveEnemies(u)) { const d = dist(u, e); if (d < bd) { bd = d; best = e; } } return best; }
    // u が e を視認できるか＝コーン内（角度）×実効距離（隠密/地形）×射線。幾何のみ＝決定論。
    function detects(u, e) {
      const dx = e.x - u.x, dy = e.y - u.y, d = Math.hypot(dx, dy) || 0.001;
      const fl = Math.hypot(u.faceX, u.faceY) || 1, cosang = (u.faceX * dx + u.faceY * dy) / (fl * d);
      if (cosang < Math.cos(u.sightHalf)) return false;                                   // コーンの外（背後/側方）
      let range = u.sightR * (1 - (e.stealth || 0) * 0.4);                                 // 隠密ほど近づくまで見えない
      if (terrainAt(e) === T.forest) range *= 0.6;                                         // 茂みの敵は隠れる
      if (terrainAt(u) === T.highground) range *= 1.3;                                     // 高所からは見晴らし
      if (d > range) return false;
      return losClear(u, e);                                                               // 遮蔽が間にあれば見えない
    }
    // チーム探知更新（即時共有＋鮮度減衰）。pickTarget前に毎ターン。
    function updateDetection() {
      if (fogless) { refreshFogless(); return; }                                          // 霧なし：常に全敵発見済み（位置だけ更新）
      // 探知した瞬間に「誰が見つけたか（最寄りの発見者）」を記録＝描写で常に発見者を名指しできる（移動後の再判定では取りこぼす）
      for (const u of ALL) { if (!u.alive) continue; const km = known[u.team]; for (const e of enemiesOf(u)) { if (e.alive && detects(u, e)) { const prev = km.get(e), d = dist(u, e); if (!prev || prev.lastSeen !== turn || d < (prev._bd || Infinity)) km.set(e, { lastSeen: turn, x: e.x, y: e.y, by: u, _bd: d }); } } }
      for (const tm of ["P", "C"]) { const km = known[tm]; for (const [e, info] of km) if (!e.alive || turn - info.lastSeen > DETECT_DECAY) km.delete(e); }
    }
    const knownEnemies = (u) => enemiesOf(u).filter((e) => e.alive && known[u.team].has(e)); // AIが反応してよい敵＝発見済み
    function nearestKnownEnemy(u) { let best = null, bd = Infinity; for (const e of knownEnemies(u)) { const d = dist(u, e); if (d < bd) { bd = d; best = e; } } return best; }
    // ===== 役割（人格→武器/winDistから自動分類・★排他。ラベル/トリニティ挙動に使う）=====
    const isBackline = (u) => u.winDist >= 45;                                   // 後衛＝遠距離志向の射手（守られるべき）
    const isFrontline = (u) => !isBackline(u) && (u.winDist < 40 || u.maxHp >= 100); // 前衛＝近接志向 or 高HPの壁（後衛は高HPでも前衛にしない）
    const hasControl = (u) => u.melee.knockback >= 6 || (u.melee.status && (u.melee.status.type === "slow" || u.melee.status.type === "stun")); // 妨害（鎖鎌/大槌/大剣等）
    const isSupport = (u) => hasControl(u) && (u.micros.D1 >= 0.5 || u.micros.D2 >= 0.5) && u.micros.A2 < 0.85; // 妨害武器＋相手読み＋猪突でない＝ピール役
    // 盾状態＝タンク度が高く（presence×hold）敵2体以上の火力を吸っている（_focusCountは各ターンpickTarget後に確定）
    const isShielding = (u) => (u.tank || 0) >= 0.40 && (u._focusCount || 0) >= 2;
    // 受け太刀（bracing）：盾状態のとき被ダメ軽減＝吸った火力を効率よく受ける。タンク度（沈着/規律/HP込み）で↑。
    //   アグロ単体は耐久不足の前衛を早死にさせ逆効果（勝率A/Bで判明）→ 軽減とセットで「狙われる盾」を成立させる。
    const braceMult = (u) => isShielding(u) ? 1 - clamp(0.10 + u.tank * 0.30, 0, 0.35) : 1;
    const imminentBand = (e) => Math.max(e.melee.reach + 18, 34);                // ★『迫る脅威』＝近接到達ベース（前衛が迎撃に動ける早さ・effRangeで全域発火するのは防ぐ）
    // 攻めたがり＝アンチストールの強制接近/コミット対象。防御的な体（専守・待ち）は対象外＝両者防御的だと"待ち戦"が自然にタイムアップ
    const restless = (u) => u.micros.A2 >= 0.45 || u.mv[0] > 0;                  // A2攻撃開始の早さ or ①闘争心＝攻めたがり
    // 守るべき後衛味方＋それを差し迫って脅かす敵（かばう用）。最も近接された1組を返す
    function findWard(u) {
      let best = null, bd = Infinity;
      for (const a of alliesOf(u)) {
        if (!a.alive || a === u || !isBackline(a)) continue;
        const foe = nearestKnownEnemy(a); if (!foe) continue; // 発見済みの敵だけ＝未発見の脅威にはかばえない
        const d = dist(foe, a);
        if (d < bd && d < imminentBand(foe)) { bd = d; best = { ward: a, foe }; }
      }
      return best;
    }
    const teamHpFrac = (team) => { const t = team === "P" ? P : C; let h = 0, m = 0; for (const u of t) { h += Math.max(0, u.hp); m += u.maxHp; } return m ? h / m : 0; };
    const aliveCount = (team) => (team === "P" ? P : C).filter((u) => u.alive).length;

    // ===== ターゲット選定（集中砲火＝キルオーダー収束＋脅威優先＋釣り出し耐性＋ピール）=====
    const sup = isSupport;
    function pickTarget(u) {
      const live = knownEnemies(u);                  // ★発見済みの敵だけを狙える（未発見＝そもそも反応しない）
      if (!live.length) { u._focusCount = 0; u.peeling = false; return null; } // 未発見＝索敵へ（decideでhome方向へ前進）
      const iAmSupport = sup(u);
      const myWard = (isFrontline(u) && u.coop > 0.45) ? findWard(u) : null; // 守る後衛がいれば迎撃対象に。★協調性が高い前衛だけがかばう（一匹狼は味方を守らない）
      let best = null, bv = -Infinity, bestPeel = false;
      for (const e of live) {
        const d = dist(u, e), fl = flankOf(u, e);
        let v = -d / maxDist * 1.0;                                   // 近いほど良い
        v += (1 - e.hp / e.maxHp) * (0.55 + u.micros.A6 * 0.9);       // 仕留め（非情ほど低HP優先）
        v += losClear(u, e) ? 0.3 : -0.25;                            // 撃てるか
        v += fl.tier === "rear" ? 0.55 : fl.tier === "side" ? 0.22 : 0; // 側背面の取りやすさ
        // ★脅威優先：敵の出力(DPS見込み)が高い＝危険な敵キャリーを先に落とす（相手読みD1で評価）
        const eThreat = expEx0(e, u, d, true);
        v += clamp(eThreat / 32, 0, 1) * (0.3 + u.micros.D1 * 0.35);
        // ★集中砲火：味方が既に狙う敵に束ねる（規律B4/順応D2で連携↑）＝キルオーダー収束
        const focus = alliesOf(u).filter((a) => a.alive && a !== u && a.target === e).length;
        v += Math.min(focus, 2) * (0.2 + u.micros.B4 * 0.28 + u.micros.D2 * 0.22) * (0.45 + 0.55 * u.coop); // 集中砲火＝協調性が低い一匹狼は味方の狙いに合わせない（我流）
        // ★連携アシスト（高coop＝味方思い）：味方が直前に崩した敵（_opened＝側背/投げ/大打）を逃さず突く＝集中の質↑。一匹狼はこれを重視しない。
        if (e._opened != null && turn - e._opened <= 1) v += u.coop * (0.9 + u.micros.A2 * 0.3);
        // ★一匹狼（低coop＝我流・利己）：味方の連携でなく、手柄になる手負い/孤立の獲物を単騎で追う。
        v += (1 - u.coop) * (clamp(isolationOf(e) / 40, 0, 1) * 0.45 + (1 - e.hp / e.maxHp) * 0.4);
        // ★ヘイト（脅威吸引）：タンク度の高い敵（目立つ×持ちこたえる）に火力が吸われる＝デコイ・タンク成立。
        //   A3近接傾倒で釣られやすく・D1相手読みで釣られにくい（脅威eThreatが主・tankは従）。脆い体はtankが低く吸引も弱い＝早死にしない
        v += clamp((e.tank || 0) - 0.2, 0, 1.0) * (1.5 + u.micros.A3 * 0.4 - u.micros.D1 * 0.3); // 床0.2＝タンク度の低い脆い体は吸引が立たない
        // ★各個撃破：味方から孤立した敵ほど狙う（囲んで飲みやすい・剝がされにくい）。順応D2/規律B4の連携で強まる
        v += clamp(isolationOf(e) / 35, 0, 1) * (0.7 + u.micros.D2 * 0.5 + u.micros.B4 * 0.3);
        // ★釣り出し耐性：その敵を追うと【他の】敵の脅威下に晒される＝罠なら見送る（標的自身は除外して二重計上を防ぐ）
        const chaseThreat = threatAt(u, { x: e.x, y: e.y }, e);
        v -= clamp(chaseThreat / 55, 0, 1) * (0.2 + u.micros.D1 * 0.3 + (1 - u.micros.C2) * 0.3);
        // ★迎撃：守る後衛に張り付いた敵を最優先で狙う＝前衛が戦線を離れず割り込める（誇りC6で死守）
        if (myWard && e === myWard.foe) v += 1.2 + u.micros.C6 * 0.5;
        // ★タウント：味方をかばって割り込んでいる敵前衛は『邪魔』＝優先して狙う（前ターンのguardingフラグ）
        if (e.guarding) v += 0.3 + u.micros.A2 * 0.2;
        // ★ピール：サポート資質は後衛味方に近接で張り付いた敵を最優先で剝がしに行く
        let peel = false;
        if (iAmSupport) { for (const a of alliesOf(u)) { if (a.alive && a !== u && isBackline(a) && dist(e, a) <= imminentBand(e)) { peel = true; break; } } }
        if (peel) v += 0.6 + u.micros.D1 * 0.4;
        if (u.target === e && e.alive) v += 0.4 + u.micros.B4 * 0.3; // ヒステリシス（規律）＝狙いを定めた的を無駄に変えない
        if (v > bv) { bv = v; best = e; bestPeel = peel; }
      }
      u.peeling = bestPeel; // ラベル用（_focusCount は step でターゲット確定後に一括集計＝リングと同基準）
      return best;
    }

    // ===== 移動・脅威・セパレーション =====
    function applyMove(u, fp, move) {
      const st = stepLen(u, u), dx = fp.x - u.x, dy = fp.y - u.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      let nx = u.x, ny = u.y;
      if (move === "ADVANCE") { const sp = u._closing ? 1.25 : 1; nx += ux * st * sp; ny += uy * st * sp; } // 突撃時は接近速度UP（被弾時間短縮）＝遠距離型を割る
      else if (move === "RETREAT") { nx -= ux * st; ny -= uy * st; }
      else if (move === "STRAFE_L") { nx += -uy * st; ny += ux * st; }
      else if (move === "STRAFE_R") { nx += uy * st; ny += -ux * st; }
      else if (move === "COVER") { const o = nearestObstacle(u); if (o) { const ox = o.x - u.x, oy = o.y - u.y, ol = Math.hypot(ox, oy) || 1; nx += (ox / ol) * st; ny += (oy / ol) * st; } }
      return pushOutObstacle(nx, ny);
    }
    function threatAt(u, pos, except) { // 接近する全敵からの期待被ダメ合計（exceptを除外可＝釣り出し判定で標的自身を二重計上しない）
      let t = 0;
      for (const e of knownEnemies(u)) { if (e === except) continue; const d = dist(pos, e), los = losClear(e, pos); t += expEx(e, u, { x: e.x, y: e.y }, pos, d, los); } // 発見済みの敵からの脅威のみ（未発見の奇襲は読めない）
      return t;
    }
    // 点pから線分ab（攻め手→ward）への最短距離＋射影位置t＝割り込み判定
    function segDist(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy; if (l2 < 0.001) return { d: dist(p, a), t: 0 }; let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2; t = clamp(t, 0, 1); return { d: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t }; }
    // ward(狙われた後衛)と攻め手attの【間に実際に割り込んでいる】味方前衛を返す＝ボディブロック対象
    function guardOf(ward, att) {
      for (const g of alliesOf(ward)) { if (g === ward || !g.alive || !g.guarding || g._wardRef !== ward) continue; const s = segDist(g, att, ward); if (s.d < 8 && s.t > 0.12 && s.t < 0.92) return g; }
      return null;
    }
    function sepPenalty(u, pos) { // 味方と重ならない
      let p = 0;
      for (const a of alliesOf(u)) { if (a === u || !a.alive) continue; const d = dist(pos, a); if (d < 8) p += (8 - d) * 1.6; }
      return p;
    }
    // 局所兵力比：u周辺（半径R）で実際に交戦している味方/敵を近いほど重く数える（>1＝局所優勢・<1＝寡兵）。B-③でも再利用。
    //   ★近くに敵がいなければ局所戦闘なし＝中立1を返す（開幕や離れた局面で「味方が固まり敵が遠い」を優勢と誤認しない）。
    function localForce(u) {
      const R = 42; let foe = 0;
      for (const e of knownEnemies(u)) { const d = dist(u, e); if (d < R) foe += 1 - (d / R) * 0.6; } // 発見済みの敵で局所兵力比を評価
      if (foe < 0.25) return 1; // 交戦圏内に敵なし＝中立
      let ally = 1;
      for (const a of alliesOf(u)) { if (!a.alive || a === u) continue; const d = dist(u, a); if (d < R) ally += 1 - (d / R) * 0.6; }
      return ally / Math.max(0.5, foe);
    }
    // ===== 交戦状態機械（OODA：様子見→コミット→撤退）=====
    //   いつ飛び込み・いつ引くかの上位判断。局所兵力比・HP・気迫・標的の手負い・人格で遷移。乱数非消費＝決定論。
    //   粗いアンチストール（無条件前進）を質の良い形へ＝有利なら攻勢・不利かつ手負いなら退いて立て直す。
    function updateEngage(u) {
      const hpFrac = clamp(u.hp / u.maxHp, 0, 1);
      const adv = localForce(u) * (0.75 + u.micros.C4 * 0.5) - 1; // 知覚した優位（>0優勢・<0寡兵）。C4強気は有利に見える＝拙速
      const tgtLow = u.target ? (1 - clamp(u.target.hp / u.target.maxHp, 0, 1)) : 0;
      // コミット圧：優位×勝負師 ＋ 仕留め機会 ＋ 気迫満ちる ＋ 近接志向。手負いは抑える
      let commit = adv * (0.8 + u.micros.C2 * 0.8) + tgtLow * (0.3 + u.micros.A6 * 0.4)
        + (u.resolve > 0.7 ? 0.3 : 0) + (1 - u.micros.A1) * 0.18 - (1 - hpFrac) * 0.3;
      // 撤退圧：手負い×逃げ癖 ＋ 寡兵。背水C6/気迫が打ち消す（手負いでも退かず特攻）
      let retreat = (1 - hpFrac) * (0.5 + u.micros.C1 * 0.9) + Math.max(0, -adv) * 0.5
        - u.micros.C6 * (hpFrac < 0.35 ? 1.0 : 0.4) - u.resolve * 0.2 - 0.05;
      const stick = 0.12 + u.micros.B4 * 0.18;                                          // ヒステリシス（規律で状態を保つ・固着しすぎない程度）
      if (u.engage === "commit") commit += stick; else if (u.engage === "retreat") retreat += stick;
      if (restless(u) && (u.idleTurns || 0) >= 5) commit += (u.idleTurns - 4) * 0.3; // 強制コミット安全弁＝膠着を攻めへ（攻撃的な体のみ・防御的な体は待たせる）
      u.engage = (retreat > 0.33 && retreat > commit) ? "retreat" : (commit > 0.35 ? "commit" : "poke");
    }
    // ===== 局所兵力比による分断機動（各個撃破 / defeat in detail）=====
    //   ★発見：各個撃破は既にB-①集中砲火＋既存の脅威回避(threatAt×wDef＝敵集団＝高脅威を避ける＝劣勢ガード)から創発する。
    //   候補位置の局所優勢を移動評価に足しても1手移動では候補間でほぼ不変＝無効（A/Bで確認）。よって移動項は採らず、
    //   実効のある「孤立した敵を優先的に狙い飲む」ターゲティング項＋『各個撃破』の活写に絞る。
    // 敵eの孤立度＝eから同チーム最寄り味方への距離（大＝孤立＝囲んで飲みやすい/剝がされにくい）
    function isolationOf(e) {
      let bd = Infinity; for (const a of alliesOf(e)) { if (!a.alive || a === e) continue; const d = dist(e, a); if (d < bd) bd = d; }
      return bd === Infinity ? maxDist : bd;
    }
    // ===== 隊形スロット（緩いベースパターン・相対位置）。ランク=前→後(winDist順)。散開はスロット無し。=====
    function formSlot(fk, rank, n) {
      if (fk === "line") return { fx: 0, fy: (rank - (n - 1) / 2) * 1.0 };                    // 横一線（敵に正対）
      if (fk === "wedge") return rank === 0 ? { fx: 1, fy: 0 } : { fx: -0.6, fy: (rank % 2 ? 1 : -1) * 0.8 }; // 楔（先頭が点・後続が翼）
      if (fk === "circle") return rank < n - 1 ? { fx: 0.6, fy: (rank - (n - 2) / 2) * 0.9 } : { fx: -0.9, fy: 0 }; // 前衛screen＋最後尾carryを後ろに匿う
      return null;
    }
    function formSlotWorld(u) {
      if (!u.form || u.form === "loose") return null;
      const al = alliesOf(u).filter((a) => a.alive); const n = al.length; if (n <= 1) return null;
      const rank = al.slice().sort((p, q) => p.winDist - q.winDist).indexOf(u);
      const off = formSlot(u.form, rank, n); if (!off) return null;
      let ay = 0; for (const a of al) ay += a.y; ay /= n;
      // ★前後(fx)は自分のx基準で控えめ＝各体の射程の好み(winDist)を壊さない／左右(fy)は重心基準で隊形の形を作る
      const fwd = u.team === "P" ? 1 : -1, SP = 14;
      return { x: cx(u.x + off.fx * SP * fwd * 0.5), y: cy(ay + off.fy * SP) };
    }

    // ===== 必殺の打ち時（温存経済）：即撃ちでなく仕留め確/側背面/窮地でここぞと切る。死蔵防止に強制解放弁 =====
    function ultReady(u, tgt, pos, d2, los) {
      const meleeOk = d2 <= u.melee.reach, rn = !meleeOk, w = meleeOk ? u.melee : u.ranged;
      const desperate = u.hp / u.maxHp < 0.28;
      const forced = (u._ultHold || 0) >= 4;
      // ★命中見込みが低い時は必殺を切らない（空撃ち抑制／#12）。窮地・強制解放は捨て身なので除く。
      if (!desperate && !forced) {
        const hcEst = meleeOk ? meleeHit(tgt, tgt) : (los ? rangedHit(u.ranged, u, tgt, tgt, d2, los, false) : 0);
        if (hcEst < 0.42) return false;
      }
      // ★無駄撃ち抑制（overkill回避）：通常攻撃で仕留まる相手に必殺は切らない（窮地を除く）＝切り札を取っておく
      const normalEst = meleeOk ? u.melee.rate * 0.9 * u.melee.damage : u.ranged.fireRate * u.ranged.accuracy * u.ranged.damage;
      if (tgt.hp <= normalEst && !desperate && (u._ultHold || 0) < 4) return false;       // 通常で落ちる＝温存（強制解放と窮地は除く）
      const ultEst = w.damage * (rn ? 2.0 : 1.9) * 1.3;                                   // 必殺の推定ダメ（≈2倍＋会心込み）
      const killShot = tgt.hp <= ultEst * 1.05 && tgt.hp > normalEst;                     // 必殺でしか落とせない仕留め確＝理想の打ち時
      const flank = flankOf(pos, tgt).tier !== "front";
      const losing = aliveCount(u.team) < aliveCount(u.team === "P" ? "C" : "P");
      const opp = (killShot ? 1.0 : 0) + (flank ? 0.45 : 0) + (desperate ? 0.7 : 0) + (losing ? 0.3 : 0);
      const patience = clamp(0.45 + u.micros.C5 * 0.5 + u.micros.B4 * 0.4 - u.micros.A6 * 0.7 - u.micros.C2 * 0.35, 0, 1); // 冷静/規律=温存・非情/リスク=即撃ち
      return (u._ultHold || 0) >= 4 || desperate || opp >= patience * 0.95;               // 抱え込み4Tで強制解放
    }
    // ===== 攻撃チャンネル選択 =====
    function chooseAttack(u, tgt, pos, d2, los2) {
      if (u.reloadLeft > 0) return { attack: "RELOAD" };
      const meleeOk = d2 <= u.melee.reach, rangedOk = los2 && u.ammo > 0 && d2 <= u.ranged.effRange + u.ranged.falloff;
      if (u.resolve >= 1 && ultReady(u, tgt, pos, d2, los2)) { // 必殺：好機なら解放／好機でなければ温存して通常攻撃を続ける
        if (meleeOk) return { attack: "ULT", ultKind: "melee" };
        if (los2 && u.ammo > 0) return { attack: "ULT", ultKind: "ranged" };
      }
      if (meleeOk) return { attack: "MELEE" };
      if (rangedOk) {
        // チャージ武器（スナイパー）：★近接寄りの敵が一手で殴りに来る距離なら、溜めても中断される→ノーチャージ速射で即撃ち。
        //   ただし相手が射手（近接に来ない）なら中断されないので通常チャージ（精密射撃）。＝スナイパー同士の近距離で速射連発→冗長、を防ぐ。
        if (u.ranged.mode === "charge" && !u.charged) {
          let nd = Infinity; for (const e of enemiesOf(u)) if (e.alive) { const meleeThreat = e.ranged.effRange < 45 || (e.winDist || 99) < 30; if (!meleeThreat) continue; const dd = dist(pos, e); if (dd < nd) nd = dd; }
          if (nd <= u.melee.reach + (S.baseStep || 12) * 1.2) return { attack: "SNAP" };
        }
        return { attack: "RANGED" };
      }
      if (los2 && u.ammo <= 0) return { attack: "RELOAD" };
      return { attack: "NONE" };
    }

    // ===== 1手貪欲評価＝move×attackの最良を選ぶ（先読みなし・乱数非消費）=====
    function decide(u) {
      const tgt = u.target;
      if (!tgt) {
        // ★索敵：戦闘のプロらしく「敵の居そうな方」へ前進。鋭い相手読みD1＝第六感(嗅覚)で実際の敵集団へ直行、鈍い＝中央へ漠然と。faceを進行方向に＝コーンが前方を掃く。
        let sp = null, seen = -1;
        for (const info of known[u.team].values()) if (info.lastSeen > seen) { seen = info.lastSeen; sp = { x: info.x, y: info.y }; } // ロストした敵は最後の既知位置へ詰め直す（最優先）
        if (!sp) {
          const inst = u.micros.D1, ec = cenLive(enemiesOf(u)) || { x: field.w / 2, y: u.y };
          const gx = (u.x + field.w / 2) / 2, gy = u.y;       // 鈍い索敵＝中央寄りへ漠然と
          sp = { x: gx + (ec.x - gx) * inst, y: gy + (ec.y - gy) * inst }; // 本能で敵重心へ寄せる（D1鋭いほど直行）
        }
        if (Math.hypot(sp.x - u.x, sp.y - u.y) < 6) return { move: "HOLD", attack: "NONE", newPos: { x: u.x, y: u.y }, target: null, searchDir: sp }; // 索敵地点に到達＝その場で警戒
        const np = applyMove(u, sp, "ADVANCE");
        return { move: "ADVANCE", attack: "NONE", newPos: np, target: null, searchDir: sp };
      }
      const fp = { x: tgt.x, y: tgt.y };
      let pref = prefRangeOf(u);
      // 攻め圧：与ダメが続かない体ほど焦って攻撃価値↑・脅威回避↓（遊兵化＝撃たない超防御型を戦線に引き戻す）
      const desp = restless(u) ? Math.min((u.idleTurns || 0) / 6, 1) : Math.min((u.idleTurns || 0) / 16, 1) * 0.4; // 攻撃的な体は焦って攻める・防御的な体は焦らず待つ
      let wAtk = (0.7 + u.micros.A2 * 0.4 + u.micros.A6 * 0.2) * (1 + desp * 0.9), wDef = (0.4 + u.micros.C1 * 0.5 + (1 - u.micros.C2) * 0.35) * (1 - desp * 0.55);
      // 交戦状態（OODA）で重みを傾ける：攻勢は肉薄・撤退は退いて味方と立て直す
      let regroupTo = null;
      if (u.engage === "commit") { wAtk *= 1.35; wDef *= 0.65; pref = Math.max(4, pref - 10); }
      else if (u.engage === "retreat") {
        wAtk *= 0.55; wDef *= 1.6; pref = Math.min(maxDist, pref + 18);
        let bd = Infinity; for (const a of alliesOf(u)) { if (a.alive && a !== u) { const d = dist(u, a); if (d < bd) { bd = d; regroupTo = a; } } } // 最寄り味方へ寄って再集結
      }
      // 突撃（ギャップクローズ）：自分より長射程の敵へ commit で詰める体は接近を速める＝被弾時間を縮めて遠距離型を割る手段。
      //   遠距離＋高HPの防御スタック(亀)が近接・攻撃型を一方的に溶かす偏りの是正。squad内の移動のみ（武器/HP/1v1は不変）。
      const myReach = Math.max(u.ranged.effRange, u.melee.reach), tgtReach = Math.max(tgt.ranged.effRange, tgt.melee.reach);
      u._closing = u.engage === "commit" && tgtReach > myReach + 12 && dist(u, fp) > u.melee.reach;
      // かばう：前衛は脅威下の後衛味方と敵の間に割り込む（誇りC6/中央志向B6で強く・差し迫った1組に限定）。★協調性が高い体だけ（一匹狼はかばわない）
      const ward = (isFrontline(u) && u.coop > 0.45) ? findWard(u) : null;
      const interpose = ward ? { x: (ward.ward.x + ward.foe.x) / 2, y: (ward.ward.y + ward.foe.y) / 2 } : null;
      const guardScale = ward ? 0.6 + u.micros.B6 * 0.45 + u.micros.C6 * 0.45 : 0; // 実距離ベース＝offenseと同オーダーで実際に割り込む
      const holdInterDist = interpose ? Math.hypot(u.x - interpose.x, u.y - interpose.y) : 0;
      // 隊形（緩いベースパターン）：作戦スロットへ弱く寄る。遂行力=規律B4+忍耐(mv3)+協調coop。自targetが交戦圏に近いほど戦闘優先で隊形を捨てる。
      let formSlotPos = null, formW = 0;
      if (u.form && u.form !== "loose") {
        formSlotPos = formSlotWorld(u);
        if (formSlotPos) {
          const holdAbility = clamp(0.2 + u.micros.B4 * 0.5 + Math.max(0, u.mv[3]) * 0.35 + u.coop * 0.3, 0, 1.1); // 一匹狼/気まぐれは守らない
          const reach = Math.max(u.melee.reach, u.ranged.effRange);
          const urgency = clamp(1 - (dist(u, fp) - reach) / 45, 0, 1);                          // 交戦圏に近いほど隊形より戦闘
          formW = holdAbility * (1 - urgency) * 0.10;                                            // ★ごく小さい＝接近フェーズに見える緩い癖。戦闘判断が常に上回る＝支配しない・罠にしない
        }
      }
      let best = null;
      for (const mv of MOVES) {
        const np = applyMove(u, fp, mv), d2 = dist(np, fp), los2 = losClear(np, fp);
        const atk = chooseAttack(u, tgt, np, d2, los2);
        let offense = expEx(u, tgt, np, fp, d2, los2);
        if (mv !== "HOLD" && los2 && atk.attack === "RANGED") offense *= u.ranged.moveAccuracy; // 移動射撃は命中が落ちる＝据え置いて撃つ価値を評価に反映
        const threat = threatAt(u, np);
        const rangeFit = -(Math.abs(d2 - pref) / maxDist) * 22;
        const fl = flankOf(np, tgt), flankTerm = (fl.tier === "rear" ? 9 : fl.tier === "side" ? 3.5 : 0);
        const sep = sepPenalty(u, np), hz = hazardAt(np) + terrainDmg(np) * 1.5;
        const interceptTerm = interpose ? -Math.hypot(np.x - interpose.x, np.y - interpose.y) * guardScale : 0; // 割り込み位置に近いほど良い（実距離）
        const regroupTerm = regroupTo ? -Math.hypot(np.x - regroupTo.x, np.y - regroupTo.y) * 0.12 : 0; // 撤退時＝味方へ寄る再集結
        const formTerm = formSlotPos ? -(dist(np, formSlotPos) / maxDist) * 22 * formW : 0;     // 隊形スロットへ緩く寄る
        const v = offense * wAtk - threat * wDef + rangeFit + flankTerm - sep - hz * 1.2 + interceptTerm + regroupTerm + formTerm + (mv === "HOLD" ? 0.2 : 0);
        if (!best || v > best.v) best = { v, move: mv, attack: atk.attack, ultKind: atk.ultKind, newPos: np, d2, los2 };
      }
      // ＝＝個体テクスチャの追加候補（チーム評価の後段に乗せる・既存の集中砲火/盾/かばうは不変）＝＝
      // 回避：攻撃を捨てて見切る。★強い回避型(B3)が、実際にこのターン殴られる距離にいて、攻撃より明確に得な時だけ＝稀な個体テクスチャ。
      {
        const evd = dodgeEvade(u);
        // ★装填済みで標的が射程内・射線ありなら回避せず撃つ（射手が棒立ち回避で武器を腐らせるDODGEロックを防ぐ／#11）
        const canEngageRanged = u.ammo > 0 && dist(u, fp) <= u.ranged.effRange + u.ranged.falloff && losClear(u, fp);
        const canBeHit = !canEngageRanged && u.micros.B3 > 0.6 && evd > 0.5 && knownEnemies(u).some((e) => { const dd = dist(u, e); return dd <= e.melee.reach || (e.ammo > 0 && dd <= e.ranged.effRange + e.ranged.falloff && losClear(e, u)); }); // ★回避巧者(B3)だけが見切る＝性格テクスチャ
        if (canBeHit) {
          const dp = { x: u.x, y: u.y }, d2d = dist(dp, fp), los2d = losClear(dp, fp);
          const incoming = threatAt(u, dp);                                                       // 実際の被ダメ見込み
          const counterEV = (0.12 + u.micros.D1 * 0.4 + u.micros.D6 * 0.25 + u.micros.B3 * 0.2) * (d2d <= u.melee.reach ? u.melee.damage : u.ranged.damage * 0.8) * 0.4;
          const vD = -incoming * (1 - evd) * wDef + counterEV - sepPenalty(u, dp) - (hazardAt(dp) + terrainDmg(dp) * 1.5) * 1.2 - (1 - u.stamina) * 3;
          if (vD > best.v + 3) best = { v: vD, move: "HOLD", attack: "DODGE", newPos: dp, d2: d2d, los2: los2d }; // 攻撃よりはっきり得な時だけ見切る＝稀
        }
      }
      // 崩し（投げ）：盾/受け型に受け不能の投げ＝固い相手を割る手段（チーム戦の核＝盾と噛み合う）。盾でない相手には基本選ばない。
      if (grabReachOK(u, fp) && u.stamina > 0.3 && (tgt.tank || 0) > 0.35) {
        const gp = applyMove(u, fp, "ADVANCE"), d2g = dist(gp, fp);
        if (d2g <= u.melee.reach + 3) {
          const want = 0.6 + u.micros.A2 * 0.3 + u.micros.A6 * 0.3 + u.micros.D4 * 0.2;            // 崩しを好む性格（攻め/非情/狡猾）
          const offG = grabDamage(u) * (0.5 + clamp((tgt.tank || 0) * 1.1, 0, 1.1));               // 受け不能＝盾ほど刺さる
          const vG = offG * wAtk * want - threatAt(u, gp) * wDef - sepPenalty(u, gp) - (hazardAt(gp) + terrainDmg(gp) * 1.5) * 1.2;
          if (vG > best.v) best = { v: vG, move: "ADVANCE", attack: "GRAB", newPos: gp, d2: d2g, los2: true };
        }
      }
      // 実際に割り込み位置へ寄った時だけ guarding（ラベルの誤表示を防ぐ＝据え置き/自target攻撃なら かばう表示しない）
      u.guarding = !!interpose && Math.hypot(best.newPos.x - interpose.x, best.newPos.y - interpose.y) < holdInterDist - 0.5;
      u._wardRef = u.guarding && ward ? ward.ward : null; // ボディブロックの守る相手
      best.target = tgt;
      return best;
    }

    // ===== 攻撃解決（攻め手→自target。同時適用のためダメージは後でまとめて反映）=====
    // 間合い/射線は【移動後の最終位置】で再計算（全体が動いた後に解決＝同時性を保つ）
    function resolveAttack(u, dec) {
      const tgt = dec.target; if (!tgt || !tgt.alive) return null;
      const ev = { att: u, def: tgt, attack: dec.attack, move: dec.move };
      const fp = { x: tgt.x, y: tgt.y }, d2 = dist(u, tgt), los2 = losClear(u, tgt);
      const fl = flankOf(u, tgt), corner = cornered(tgt) ? 1 : 0, fdEvMul = fl.defMul * (corner ? 0.72 : 1);
      const precise = clamp(u.micros.A5 * 0.5 + u.micros.B4 * 0.3 - u.micros.A4 * 0.4, 0, 1);
      const evd = evadeMap.get(tgt) || 0;                       // 標的が回避中なら命中が落ちる（このターン分）
      if (dec.attack === "DODGE") { ev.dodge = true; u.st.dodges = (u.st.dodges || 0) + 1; return ev; }
      if (dec.attack === "GRAB") { ev.grab = true; u.st.grabs = (u.st.grabs || 0) + 1; return ev; } // 受け不能の投げ（step側で三すくみ解決）
      if (dec.attack === "RELOAD") { if (u.reloadLeft === 0) u.reloadLeft = u.ranged.reloadTurns; u.reloadLeft--; u.spread = 0; if (u.reloadLeft <= 0) u.ammo = u.ranged.mag; ev.reloading = true; return ev; }
      if (dec.attack === "ULT") {
        u.resolve = 0; u.st.ults++;
        const rn = dec.ultKind === "ranged", w = rn ? u.ranged : u.melee, cat = weaponCat(w, rn);
        ev.ult = true; ev.ultName = ULT_NAME[cat]; ev.ultRn = rn; ev.shots = 1;
        const reachOK = rn ? los2 && u.ammo > 0 : d2 <= u.melee.reach + 2;
        if (!reachOK) { ev.whiff = true; return ev; }
        if (rn) u.ammo = Math.max(0, u.ammo - Math.ceil(w.fireRate));
        const hcBase = rn ? rangedHit(w, u, fp, tgt, d2, true, dec.move !== "HOLD") : meleeHit(tgt, fp);
        const hc = Math.min(1, (hcBase * fl.acc * (1 + corner * 0.1) + 0.18) * (1 - evd));
        if (rng.chance(hc)) { let dd = w.damage * (rn ? 2.0 : 1.9); if (rng.chance(clamp(0.3 + fl.crit, 0, 0.55))) { dd *= w.critMult || 1.8; ev.crit = true; } ev.dmg = Math.round(dd * defMult(fp) * vulnOf(tgt) * outFac(u) * fl.dmg * dmgMod()); ev.hits = 1; ev.kb = true; if (w.status) ev.applyStatus = w.status; }
        else ev.whiff = true;
        if (ev.hits && fl.tier !== "front") { ev.flank = fl.tier; u.st.flanks++; }
        return ev;
      }
      if (dec.attack === "SNAP") { // ノーチャージ速射（チャージ武器を溜め無しで即撃ち）＝命中×SNAP_ACCで圧倒的に当たらない
        const rw = u.ranged;
        if (u.ammo <= 0) { ev.empty = true; return ev; }
        if (!los2) { ev.negated = true; return ev; }
        u.ammo -= 1; u.charged = false; ev.snap = true;
        const hc = Math.min(1, rangedHit(rw, u, fp, tgt, d2, true, dec.move !== "HOLD") * (1 - u.spread) * fl.acc * SNAP_ACC * (1 - evd));
        let hits = 0, dmg = 0, crits = 0;
        if (rng.chance(hc)) { hits = 1; let dd = rw.damage; if (rng.chance(clamp(rw.crit + modCrit + fl.crit, 0, 0.6))) { dd *= rw.critMult; crits = 1; } dmg += dd * defMult(fp) * vulnOf(tgt); }
        u.st.shots += 1; u.st.hits += hits; u.st.crits += crits;
        ev.shots = 1; ev.hits = hits; ev.crit = crits > 0; ev.dmg = Math.round(dmg * outFac(u) * fl.dmg * dmgMod());
        if (hits > 0 && rw.status) ev.applyStatus = rw.status;
        if (hits > 0 && fl.tier !== "front") { ev.flank = fl.tier; u.st.flanks++; }
        return ev;
      }
      if (dec.attack === "RANGED") {
        const rw = u.ranged;
        if (rw.mode === "charge" && !u.charged) { u.charged = true; ev.charging = true; return ev; }
        if (u.ammo <= 0) { ev.empty = true; return ev; }
        if (!los2) { ev.negated = true; return ev; } // ★射線が遮蔽で切れたら撃てない（撃つ判断は射線が通る位置だが、同時移動で標的が遮蔽裏へ動いた後は弾は壁に阻まれる）。弾薬/溜めは保持
        let shots = rw.mode === "charge" ? 1 : shotsFor(rw.fireRate, rng);
        if (precise > 0.55 && rw.mode !== "charge") shots = Math.max(1, Math.round(shots * (1 - precise * 0.5)));
        shots = Math.min(shots, u.ammo); u.ammo -= shots; if (rw.mode === "charge") u.charged = false;
        const critChance = clamp(rw.crit + precise * 0.2 + modCrit + fl.crit, 0, 0.78); // ★チャージは命中(狙い)を上げる行為＝威力(会心)は上げない。会心は武器固有値(スナイパー0.30/×2.5)が担う
        const hc = Math.min(1, rangedHit(rw, u, fp, tgt, d2, true, dec.move !== "HOLD") * (1 - u.spread) * fl.acc * (1 + corner * 0.05) * (1 - evd));
        let hits = 0, dmg = 0, crits = 0;
        for (let i = 0; i < shots; i++) if (rng.chance(hc)) { hits++; let dd = rw.damage; if (rng.chance(critChance)) { dd *= rw.critMult; crits++; } dmg += dd * defMult(fp) * vulnOf(tgt); }
        u.st.shots += shots; u.st.hits += hits; u.st.crits += crits;
        ev.shots = shots; ev.hits = hits; ev.crit = crits > 0; ev.dmg = Math.round(dmg * outFac(u) * fl.dmg * dmgMod());
        if (rw.mode === "auto" && shots > 0) u.spread = Math.min(0.5, u.spread + rw.spreadGrowth * (1 - u.micros.B4 * 0.5));
        if (hits > 0 && rw.status) ev.applyStatus = rw.status;
        if (hits > 0 && fl.tier !== "front") { ev.flank = fl.tier; u.st.flanks++; }
        return ev;
      }
      u.spread = Math.max(0, u.spread - 0.2);
      if (dec.attack === "MELEE" && d2 <= u.melee.reach) {
        const mw = u.melee;
        let swings = mw.pattern === "heavy" ? 1 : shotsFor(mw.rate, rng);
        if (precise > 0.55 && mw.pattern === "multi") swings = Math.max(1, Math.round(swings * (1 - precise * 0.4)));
        const critChance = clamp(mw.crit + precise * 0.2 + modCrit + fl.crit, 0, 0.68);
        const hc = Math.min(1, meleeHit(tgt, fp) * fl.acc * (1 + corner * 0.05) * (1 - evd));
        let hits = 0, dmg = 0, crits = 0;
        for (let i = 0; i < swings; i++) if (rng.chance(hc)) { hits++; let dd = mw.damage; if (rng.chance(critChance)) { dd *= mw.critMult; crits++; } dmg += dd * defMult(fp) * vulnOf(tgt); }
        u.st.shots += swings; u.st.hits += hits; u.st.crits += crits;
        ev.shots = swings; ev.hits = hits; ev.crit = crits > 0; ev.dmg = Math.round(dmg * outFac(u) * fl.dmg * dmgMod()); ev.kb = hits > 0 && mw.knockback > 0;
        if (hits > 0 && mw.status) ev.applyStatus = mw.status;
        if (hits > 0 && fl.tier !== "front") { ev.flank = fl.tier; u.st.flanks++; }
        return ev;
      }
      return ev; // NONE / 届かず
    }

    function knockback(att, tgt) { const dx = tgt.x - att.x, dy = tgt.y - att.y, len = Math.hypot(dx, dy) || 1, kb = att.melee.knockback || 4; const q = pushOutObstacle(cx(tgt.x + (dx / len) * kb), cy(tgt.y + (dy / len) * kb)); tgt.x = q.x; tgt.y = q.y; }

    // 動的ラベル：この体の今ターンの役割行動を1語で（HUD/レーダーが表示・数値非公開のまま挙動を可読化）
    function dynLabel(u, ev, dec) {
      if (!u.alive) return "戦闘不能";
      if (ev && ev.ult) return "必殺";
      if (u.guarding) return "かばう";
      if (isShielding(u)) return "盾"; // 高ヘイト＝敵2体以上の火力を吸い受け太刀している
      if (u.peeling) return "剝がし";
      if ((u._focusCount || 0) >= 2 && ev && (ev.hits || 0) > 0) return "集中";
      if (u.engage === "retreat") return "立て直し"; // 退く体は退くと読めるよう攻撃句より上位
      if (ev && ev.flank === "rear") return "背後";
      if (ev && ev.flank === "side") return "側面";
      if (u.resolve >= 1 && !(ev && ev.ult)) return "温存"; // 気迫満タンを抱え好機を待つ（ult-economy）
      if (dec && dec.attack === "RELOAD") return "装填";
      if (ev && ev.negated) return "遮蔽"; // 射線が壁に遮られ撃てなかった
      if (ev && ev.attack === "RANGED" && (ev.shots || 0) > 0) return "射撃";
      if (ev && ev.attack === "MELEE" && (ev.shots || 0) > 0) return "斬";
      if (dec && dec.searchDir && !u.target) return "索敵"; // 敵を発見しておらず探している
      if (u.engage === "commit") return "攻勢";
      if (dec && dec.move === "RETREAT") return "退避";
      if (dec && dec.move === "ADVANCE") return "詰め";
      return "様子見";
    }

    // ===== 1ターン =====
    function step() {
      if (over) return { turn, lines: [], events: [], over, result };
      turn++;
      const lines = [], events = [], envLines = [];
      const pre = new Map(); for (const u of ALL) pre.set(u, { x: u.x, y: u.y, hp: u.hp, alive: u.alive });
      for (const u of ALL) { u._counter = null; u._surged = false; u._shaken = false; }
      // 0) 索敵
      const detectedBefore = { P: new Set(known.P.keys()), C: new Set(known.C.keys()) };
      updateDetection();
      // 1) ターゲット選定（発見済みのみ・固定順＝決定論）
      for (const u of ALL) if (u.alive) u.target = pickTarget(u);
      { const tc = new Map(); for (const u of ALL) if (u.alive && u.target) tc.set(u.target, (tc.get(u.target) || 0) + 1); for (const u of ALL) u._focusCount = (u.alive && u.target) ? (tc.get(u.target) || 0) : 0; }
      // 1.5) 交戦状態（OODA）
      for (const u of ALL) if (u.alive) updateEngage(u);
      // 2) 意思決定
      const decs = new Map();
      for (const u of ALL) if (u.alive) decs.set(u, decide(u));
      // 3) 同時移動
      for (const u of ALL) if (u.alive) { const d = decs.get(u); u.x = d.newPos.x; u.y = d.newPos.y; }
      // 3.5) アンチストール：膠着したら攻撃的な体だけ最寄り敵へ引き寄せる（専守・待ちは引かない→待ち戦はタイムアップ）
      if (noDmgTurns >= 3) {
        const pull = Math.min((noDmgTurns - 2) * 2.5, 12);
        for (const u of ALL) {
          if (!u.alive || !restless(u)) continue;
          const e = nearestKnownEnemy(u); if (!e) continue;
          const d = dist(u, e);
          // 近接は距離で・射手は idleTurns で判断（射程内でも0ダメ往復の振動を強制接触で断ち切る）
          const inMelee = d <= u.melee.reach && losClear(u, e);
          const rangedEngaging = u.ranged.effRange > u.melee.reach + 12 && d <= u.ranged.effRange && losClear(u, e) && (u.idleTurns || 0) < 3;
          if (inMelee || rangedEngaging) continue;
          const dx = e.x - u.x, dy = e.y - u.y, l = Math.hypot(dx, dy) || 1, st = Math.min(pull, l);
          const q = pushOutObstacle(cx(u.x + (dx / l) * st), cy(u.y + (dy / l) * st)); u.x = q.x; u.y = q.y;
        }
      }
      // 4) 向き
      for (const u of ALL) {
        if (!u.alive) continue;
        let fx, fy;
        if (u.target) { fx = u.target.x - u.x; fy = u.target.y - u.y; }
        else { const d = decs.get(u); if (d && d.searchDir) { fx = d.searchDir.x - u.x; fy = d.searchDir.y - u.y; } else { fx = u.faceX; fy = u.faceY; } }
        const l = Math.hypot(fx, fy); if (l > 0.001) { u.faceX = fx / l; u.faceY = fy / l; }
      }
      // 5) 同時解決（ダメージ等は accに溜めて後で適用）
      evadeMap = new Map(); // このターン回避を選んだ体→回避率（攻め手の命中に反映）
      for (const u of ALL) if (u.alive) { const d = decs.get(u); if (d && d.attack === "DODGE") evadeMap.set(u, dodgeEvade(u)); }
      const acc = new Map(); // tgt -> { dmg, kbFrom, status[] }
      const evs = [];
      for (const u of ALL) {
        if (!u.alive) continue;
        const ev = resolveAttack(u, decs.get(u));
        if (!ev) continue;
        evs.push(ev);
        // ★受け太刀（bracing）：盾状態の体は集中砲火を腰を据えて受ける＝被ダメ軽減（アグロを「機能する盾」にする）
        if ((ev.dmg || 0) > 0 && ev.def) { const bm = braceMult(ev.def); if (bm < 1) { const after = Math.round(ev.dmg * bm); ev.braced = ev.dmg - after; ev.dmg = after; } }
        // ★かばう＝ボディブロック：tgtを守る前衛が攻め手との間に割り込んでいれば被ダメの半分を肩代わり（前衛が後衛の盾に）
        if ((ev.dmg || 0) > 0 && (ev.hits || 0) > 0 && ev.def) {
          const g = guardOf(ev.def, u);
          if (g && g !== u) { const cut = Math.round(ev.dmg * 0.5); ev.dmg -= cut; const ga = acc.get(g) || { dmg: 0, status: [], kbFrom: null }; ga.dmg += cut; acc.set(g, ga); ev.guardedBy = g; ev.guardCut = cut; }
        }
        const tgt = ev.def;
        if (ev.dmg > 0 || ev.applyStatus || ev.kb) {
          const a = acc.get(tgt) || { dmg: 0, status: [], kbFrom: null };
          a.dmg += ev.dmg || 0;
          if (ev.applyStatus) a.status.push(ev.applyStatus);
          if (ev.kb) a.kbFrom = u;
          acc.set(tgt, a);
        }
        // 描画イベント（mini squad radar が読む）
        const side = u.team === "P" ? "p" : "c", from = { x: u.x, y: u.y }, to = { x: tgt.x, y: tgt.y };
        if (ev.ult && (ev.shots || ev.whiff)) events.push({ side, team: u.team, aTeam: u.team, aIdx: u.idx, type: ev.ultRn ? "ult-ranged" : "ult-melee", from, to, hits: ev.hits || 0, dmg: ev.dmg || 0, crit: !!ev.crit, whiff: !!ev.whiff });
        else if (ev.attack === "RANGED" && ev.shots > 0) events.push({ side, team: u.team, aTeam: u.team, aIdx: u.idx, type: "ranged", from, to, hits: ev.hits || 0, dmg: ev.dmg || 0, crit: !!ev.crit, whiff: (ev.hits || 0) === 0, status: ev.applyStatus ? ev.applyStatus.type : null });
        else if (ev.attack === "MELEE" && ev.shots > 0) events.push({ side, team: u.team, aTeam: u.team, aIdx: u.idx, type: "melee", from, to, hits: ev.hits || 0, dmg: ev.dmg || 0, crit: !!ev.crit, whiff: (ev.hits || 0) === 0 });
      }
      // 5.5) 崩し三すくみ解決：受け不能だが、標的が①回避した②自分を殴って当てた③相互崩し(組み合い)だと潰れる。盾/棒立ち/リロードには通る。
      const grabDone = new Set();
      const addAcc = (tgt, dmg, from) => { const a = acc.get(tgt) || { dmg: 0, status: [], kbFrom: null }; a.dmg += dmg; if (from) a.kbFrom = a.kbFrom || from; acc.set(tgt, a); };
      for (const ev of evs) {
        if (ev.attack !== "GRAB" || grabDone.has(ev.att)) continue;
        const u = ev.att, t = ev.def, tDec = decs.get(t), tev = evs.find((e) => e.att === t);
        if (!grabReachOK(u, t)) { ev.grabWhiff = true; continue; }
        const tGrabsU = tDec && tDec.attack === "GRAB" && tDec.target === u && tev;
        const tDodged = tDec && tDec.attack === "DODGE";
        const tHitU = evs.some((e) => e.att === t && e.def === u && (e.hits || 0) > 0); // 標的が自分を殴って当てた
        if (tGrabsU) { // 組み合い＝力比べ（気力＋流れ＋非情さ＋運）。ペアにつき1回だけ解決
          grabDone.add(u); grabDone.add(t);
          const pu = u.stamina + u.momentum * 0.5 + u.micros.A6 * 0.3 + rng.range(0, 0.7);
          const pt = t.stamina + t.momentum * 0.5 + t.micros.A6 * 0.3 + rng.range(0, 0.7);
          const winU = pu >= pt; const wev = winU ? ev : tev, lev = winU ? tev : ev, win = winU ? u : t, los = winU ? t : u;
          addAcc(los, applyThrow(win, los, wev)); lev.grabFail = true; ev.clinch = tev.clinch = true;
        } else if (tDodged || tHitU) { ev.grabFail = true; }          // 回避された/殴られて潰れた＝隙
        else { addAcc(t, applyThrow(u, t, ev)); }                       // ガード/盾/棒立ち/リロードに通る
      }
      // 6) 適用（同時＝相討ちあり）
      const deadThisTurn = [];
      for (const [tgt, a] of acc) {
        const before = tgt.hp;
        tgt.hp = Math.max(0, tgt.hp - a.dmg);
        tgt.st.taken += Math.min(before, a.dmg);
        for (const s of a.status) { const ty = addStatus(tgt, s); if (ty === "burn") igniteFire(tgt.x, tgt.y); }
        if (a.kbFrom) knockback(a.kbFrom, tgt);
      }
      // 6.5) 回避カウンター：見切った体が生存していて、自分を殴って当てた敵を読み勝てば反撃の一閃（生存判定後＝相手も生存していれば）
      for (const u of ALL) {
        if (u.hp <= 0) continue; const d = decs.get(u); if (!d || d.attack !== "DODGE") continue;
        const atkr = evs.find((e) => e.def === u && (e.hits || 0) > 0 && (e.attack === "MELEE" || e.attack === "RANGED" || e.attack === "SNAP") && e.att.hp > 0);
        if (!atkr) continue;
        const c = counterStrike(u, atkr.att);
        if (c) { const before = atkr.att.hp; atkr.att.hp = Math.max(0, atkr.att.hp - c); atkr.att.st.taken += Math.min(before, c); u._counter = { dmg: c, on: atkr.att }; u.st.counters = (u.st.counters || 0) + 1; u.st.dealt += c; }
      }
      // 6.8) 与ダメ・統計記録
      for (const ev of evs) if (ev.dmg > 0) ev.att.st.dealt += ev.dmg;
      for (const ev of evs) { if (ev.flank && (ev.hits || 0) > 0 && ev.def) ev.def.st.wasFlanked++; if (ev.grabHit) ev.att.st.grabHits++; }
      for (const ev of evs) { if (ev.def && ev.def.alive && ((ev.flank && (ev.hits || 0) > 0) || ev.grabHit || (ev.dmg || 0) >= 0.15 * ev.def.maxHp)) ev.def._opened = turn; }
      // 6.9) DoT・地形・ハザード
      let envDmg = 0;
      for (const u of ALL) { if (!u.alive) continue; const tk = tickStatuses(u); if (tk.dmg) { u.hp = Math.max(0, u.hp - tk.dmg); envDmg += tk.dmg; envLines.push({ text: `　　＊${u.name} ${tk.types.map((t) => D.STATUS_JP[t]).join("・")}で −${tk.dmg}（残${Math.max(0, Math.round(u.hp))}/${u.maxHp}）`, cls: u.team === "P" ? "plr" : "cpu" }); } }
      for (const h of hazards) { if (h.turns <= 0) continue; h.turns--; for (const u of ALL) { if (u.alive && ptInRect(u, h)) { u.hp = Math.max(0, u.hp - h.dmg); envDmg += h.dmg; } } }
      for (const u of ALL) { if (!u.alive) continue; const lv = terrainDmg(u); if (lv) { u.hp = Math.max(0, u.hp - lv); envDmg += lv; } }
      for (let i = hazards.length - 1; i >= 0; i--) if (hazards[i].turns <= 0) hazards.splice(i, 1);
      // 7) 死亡判定・撃破帰属
      for (const u of ALL) { if (u.alive && u.hp <= 0) { u.alive = false; u.st.downTurn = turn; deadThisTurn.push(u); } }
      for (const u of deadThisTurn) { let best = null; for (const ev of evs) if (ev.def === u && (ev.dmg || 0) > 0) { if (!best || ev.dmg > best.dmg) best = ev; } if (best) { best._killed = u; best.att.st.kills++; } }
      // 7.5) 終わりの再索敵（最終位置で一致させる）
      updateDetection();
      // 8) リソース更新
      for (const u of ALL) {
        if (!u.alive) continue;
        const dealt = u.st.dealt, taken = u.st.taken; // 累積だが増分で十分（簡易）
        const a = acc.get(u); const tookNow = a ? a.dmg : 0;
        const dec = decs.get(u), attacked = dec && (dec.attack === "RANGED" || dec.attack === "MELEE" || dec.attack === "ULT" || dec.attack === "SNAP");
        u.stamina = clamp(u.stamina + (attacked ? -0.09 * modSta : 0.07), 0, 1);
        if (u.stamina < 0.35) u.st.winded++;                    // 息切れターン数（分析用）
        u.st.resPeak = Math.max(u.st.resPeak, u.resolve || 0);  // 気迫ピーク（温存しすぎ判定用）
        u.flinch = u.flinch > 0 ? u.flinch - 1 : 0;
        if (tookNow >= 0.22 * u.maxHp) u.flinch = 1;
        // ★チャージ中断：溜め中（charged・未発射）に近接で殴られる or 大きく被弾すると、据銃が崩れ一射を失う＝近づかれたスナイパーは撃てない
        if (u.charged) {
          const meleeHitOnU = evs.some((e) => e.def === u && (e.dmg || 0) > 0 && (e.attack === "MELEE" || (e.attack === "ULT" && e.ultRn === false)));
          if (meleeHitOnU || tookNow >= 0.10 * u.maxHp) { u.charged = false; const cev = evs.find((e) => e.att === u && e.charging); if (cev) { cev.charging = false; cev.chargeBroke = true; } }
        }
      }
      // 与/被ダメ→momentum/resolve（このターン分）
      const dealtNow = new Map(); let directDmg = 0; for (const ev of evs) if (ev.dmg > 0) { dealtNow.set(ev.att, (dealtNow.get(ev.att) || 0) + ev.dmg); directDmg += ev.dmg; }
      for (const u of ALL) {
        if (!u.alive) continue;
        const d = dealtNow.get(u) || 0, a = acc.get(u), tk = a ? a.dmg : 0;
        u.momentum = clamp(u.momentum + (d - tk) / 60, -1, 1);
        u.resolve = clamp(u.resolve + (d + tk) / u.maxHp * 0.5, 0, 1);
      }
      // ★味方の死への反応（協調性で連続的に）：一匹狼は奮い立ち流れを引き寄せ(+)、献身は気落ちして流れを失う(−)。
      //   ＋一定確率で気力ガクン（献身ほど高確率・大幅／一匹狼は低確率・小幅）。流れ/気力システムが活きる＝散開して仲間を失う一匹狼が、最後に流れを帯びた狂戦士として捲る目を持つ。
      for (const d of deadThisTurn) {
        for (const u of (d.team === "P" ? P : C)) {
          if (!u.alive || u === d) continue;
          const delta = (0.48 - u.coop) * 0.6;
          u.momentum = clamp(u.momentum + delta, -1, 1);                                 // coop低=奮起(+)・coop高=動揺(−)
          if (delta > 0.06) u._surged = true;                                            // 一匹狼が味方の死で奮い立つ
          if (rng.chance(clamp(0.12 + u.coop * 0.55, 0, 0.72))) { u.stamina = clamp(u.stamina - (0.10 + u.coop * 0.32), 0, 1); u._shaken = true; } // 動揺で気力ガクン
        }
      }
      noDmgTurns = directDmg + envDmg > 0 ? 0 : noDmgTurns + 1; // 膠着検知（次ターンのアンチストール引き寄せに使う）
      for (const u of ALL) if (u.alive) u.idleTurns = (dealtNow.get(u) || 0) > 0 ? 0 : u.idleTurns + 1; // 個体の遊兵化検知（攻め圧の累積）
      // 動的ラベル（今ターンの役割行動を1語で・HUD/レーダー用）
      const evByAtt = new Map(); for (const ev of evs) if (!evByAtt.has(ev.att)) evByAtt.set(ev.att, ev);
      for (const u of ALL) { if (!u.alive) { u._ultHold = 0; continue; } const evU = evByAtt.get(u); if (evU && evU.ult) u._ultHold = 0; else if (u.resolve >= 1) u._ultHold = (u._ultHold || 0) + 1; else u._ultHold = 0; }
      for (const u of ALL) u.label = dynLabel(u, evByAtt.get(u), decs.get(u));

      // 9) 描写フィード
      const npc = (u) => `<span class="${u.team === 'P' ? 'np' : 'nc'}">${u.name}</span>`;
      const armyOf = (u) => (u.team === "P" ? "あなたの分隊" : "敵分隊");
      const evCat = (ev) => { const rn = ev.ult ? ev.ultRn : ev.attack === "RANGED"; return weaponCat(rn ? ev.att.ranged : ev.att.melee, rn); };
      const flankPre = (ev) => ev.flank === "rear" ? "背後から" : ev.flank === "side" ? "側面を突き" : "";
      const stTag = (ev) => ev.applyStatus ? `（${D.STATUS_JP[ev.applyStatus.type] || ev.applyStatus.type}）` : "";
      // 9.1) 前状況スナップショット（間合い・陣形・HP・地形・形勢・孤立を活写。隠しパラ不使用）
      {
        const palive = (u) => pre.get(u).alive, phpf = (u) => pre.get(u).hp / u.maxHp;
        const aliveP = P.filter(palive), aliveC = C.filter(palive);
        if (aliveP.length && aliveC.length) {
          const all0 = aliveP.concat(aliveC);
          const cen = (arr) => { let x = 0, y = 0; for (const u of arr) { const q = pre.get(u); x += q.x; y += q.y; } return { x: x / arr.length, y: y / arr.length }; };
          const cp = cen(aliveP), cc = cen(aliveC), gap = Math.hypot(cp.x - cc.x, cp.y - cc.y);
          const fwd = (u, team) => team === "P" ? pre.get(u).x : -pre.get(u).x;
          const spear = (arr, team) => arr.slice().sort((a, b) => fwd(b, team) - fwd(a, team))[0];   // 最前（槍先）
          const terrName = (u) => { const t = terrainAt(pre.get(u)); return (t !== baseTerrain && t.name && TVERB[t.name]) ? t.name : null; };
          const hpBand = (f) => f < 0.25 ? "残りわずか" : f < 0.5 ? "半ば削られ" : "なお健在";
          const obs = [];
          // 各観測は sig（不変の中身署名）で連続反復を判定し、text（語り）は vary で多彩化。ord は読み順（情景→緊張）。
          // A) 間合いと推移（常時）。★距離は数値で語らない＝質的な「遠い/近い/鉢合わせ寸前」だけ（見えない敵まで歩数を測れる方が不自然）。
          const contact = (known.P.size + known.C.size) > 0;
          if (contact && !everContact) { everContact = true; lines.push({ text: `── 両軍、ついに互いを捉える——開戦！`, cls: "cm" }); } // ★索敵→交戦の転換点を1度だけ盛り上げる
          else if (contact) everContact = true;
          let aText, aSig;
          if (contact) {
            const r = gap / (maxDist || gap);                                                    // 戦場の対角比で間合いを質的に表現
            const bi = r < 0.15 ? 0 : r < 0.32 ? 1 : r < 0.55 ? 2 : 3;
            const band = [
              ["もう刃が届く間合い", "目と鼻の先で対峙する", "鼻先まで詰め合った"],
              ["この間合いなら鉢合わせは時間の問題", "互いの息遣いが届くほどに迫る", "あと数歩で刃が交わる隔たり"],
              ["まだ間合いはあるが、無視できる距離ではない", "中ほどの間合いで睨み合う", "射線が届くか届かぬかの隔たり"],
              ["まだだいぶ遠い", "戦場の端と端、隔たりは大きい", "遠く、互いの姿が小さく霞む"],
            ][bi];
            let trendC = "", ts = "0";
            if (lastGap != null) { const d = gap - lastGap; if (d < -2) { trendC = vary(["じりと詰まりつつある", "差は急速に縮まっている", "間合いが潰されていく"], seed, turn, 8); ts = "-"; } else if (d > 2) { trendC = vary(["じわり開き直されていく", "距離が取り直されていく"], seed, turn, 8); ts = "+"; } }
            aText = vary(band, seed, turn, 1) + (trendC ? "、" + trendC + "。" : "。");
            aSig = "Ac" + bi + ts;                                                                // 同じバンド＋推移なら再掲しない（状況が動いた時だけ出る）
          } else if (!everContact) {
            // 開幕の索敵フェーズ（まだ一度も接敵していない）
            aText = vary(["彼我はなお視界の外、互いの位置を探り合う。", "両軍まだ敵影を捉えられず、気配だけが漂う。", "姿は見えず、広い戦場に睨み合いだけが続く。"], seed, turn, 7);
            aSig = "As";
          } else {
            // ★戦闘の最中に遮蔽等で互いを見失った（市街戦で頻発）＝「まだ」でなく「見失い」表現に（終盤に開幕文が出る不自然を解消）
            aText = vary(["遮蔽に阻まれ、互いの姿を見失う。", "射線が切れ、敵影を探り直す。", "瓦礫の陰に紛れ、束の間の静寂。"], seed, turn, 7);
            aSig = "Al";
          }
          obs.push({ ord: 0, force: true, key: "A", sig: aSig, text: aText });
          // B) 陣形（両軍の槍先を1行に）
          if (all0.length >= 3) { const sp = spear(aliveP, "P"), sc = spear(aliveC, "C"); const tp = terrName(sp); if (sp && sc) obs.push({ ord: 1, key: "B", sig: "B" + sp.idx + sc.idx, text: `あなたの分隊は ${npc(sp)} を${vary(["前面に", "槍先に", "先頭に"], seed, turn, 2)}、敵は ${npc(sc)} を押し立て${tp ? `（${npc(sp)}は${TVERB[tp]}）` : ""}${vary(["対峙する", "にじり寄る", "隊列を組む"], seed, turn, 3)}。` }); }
          // F) 形勢（頭数）
          { const np = aliveP.length, ncc = aliveC.length; const s = np !== ncc ? `頭数は ${np} 対 ${ncc}、${np > ncc ? "あなたの分隊" : "敵分隊"}が数で押す。` : `${vary(["頭数は互角", "数の上では五分", "頭数は拮抗"], seed, turn, 5)}——${vary(["薄氷の均衡", "一手が雪崩を呼ぶ", "張り詰めた緊張"], seed, turn, 6)}。`; obs.push({ ord: 2, key: "F", sig: "F" + np + "v" + ncc, text: s }); }
          // E) 地形（特徴的な場所に立つ体）
          { const inT = all0.filter(terrName); if (inT.length) { const u = inT[turn % inT.length], n = terrName(u); obs.push({ ord: 3, key: "E", sig: "E" + u.idx + n, text: `${npc(u)} は${TVERB[n]}、機を計る。` }); } }
          // C) 照準の収束（動的）
          { const tcm = new Map(); for (const u of ALL) if (palive(u) && u.target && pre.has(u.target) && pre.get(u.target).alive) tcm.set(u.target, (tcm.get(u.target) || 0) + 1); let hot = null, hn = 0; for (const [t, n] of tcm) if (n >= 2 && n > hn) { hn = n; hot = t; } if (hot) obs.push({ ord: 4, key: "C", sig: "C" + hot.idx + hn, text: `${npc(hot)} に ${hn} 体の照準が集まり、包囲が締まる。` }); }
          // D) 手負い（最も削られた生存者・動的）
          { let w = null, wf = 1; for (const u of all0) { const f = phpf(u); if (f < 0.5 && f < wf) { wf = f; w = u; } } if (w) obs.push({ ord: 5, key: "D", sig: "D" + w.idx + Math.round(wf * 10), text: `${npc(w)} は ${hpBand(wf)}（HP${Math.round(wf * 100)}％）、${vary(["血路を探る", "なお退かない", "踏みとどまる"], seed, turn, 4)}。` }); }
          // G) 孤立（好機の兆し・動的）
          { let iso = null, iv = 0; for (const u of all0) { const v = isolationOf(u); if (v > 50 && v > iv) { iv = v; iso = u; } } if (iso) obs.push({ ord: 6, key: "G", sig: "G" + iso.idx, text: `${npc(iso)} が隊列から離れ孤立——突かれれば脆い。` }); }
          // H) 気迫/気力の気配（状態を前状況にも露出）。気迫満タン＝必殺の機を最優先、無ければ最も消耗した体。
          { let r = null; for (const u of all0) if ((u.resolve || 0) >= 1) { r = u; break; }
            if (r) obs.push({ ord: 7, key: "H", sig: "H" + r.idx + "r", text: `${npc(r)} は気迫を満たし、${vary(["必殺の時をうかがう", "解き放つ機を計る"], seed, turn, 11)}。` });
            else { let wd = null, ws = 0.35; for (const u of all0) { const s = u.stamina != null ? u.stamina : 1; if (s < ws) { ws = s; wd = u; } } if (wd) obs.push({ ord: 7, key: "H", sig: "H" + wd.idx + "s", text: `${npc(wd)} は息が上がり、${vary(["動きが鈍り始める", "足が止まりかける"], seed, turn, 12)}。` }); } }
          // I) 勢いの潮目（流れが大きく傾いた体）＝流れシステムを前状況に露出
          { let m = null, mv = 0.5; for (const u of all0) { const mm = u.momentum || 0; if (Math.abs(mm) > Math.abs(mv)) { mv = mm; m = u; } }
            if (m) obs.push({ ord: 5, key: "I", sig: "I" + m.idx + (mv > 0 ? "+" : "-"), text: mv > 0 ? `${npc(m)} に勢いが乗り、${vary(["押し始める", "波に乗る", "攻勢を強める"], seed, turn, 13)}。` : `${npc(m)} は勢いを失い、${vary(["防戦に回る", "気圧されていく"], seed, turn, 13)}。` }); }
          // J) 情景（一瞬の切り取り・低優先・たまに）＝硝煙/薬莢/砂塵で観戦に温度を足す
          if (hsh(seed, turn, 20) % 3 === 0) obs.push({ ord: 8, key: "J", sig: "J" + turn, text: vary(ATMO, seed, turn, 20) });
          // K) 隊形の維持状況
          { for (const tm of ["P", "C"]) { const fk = tm === "P" ? formP : formC; if (fk === "loose" || !FORM_HELD[fk]) continue;
              const units = (tm === "P" ? P : C).filter((u) => u.alive); if (units.length < 2) continue;
              let held = 0; for (const u of units) { const slot = formSlotWorld(u); if (slot && dist(u, slot) < 18) held++; }
              const ok = held / units.length >= 0.5, army = tm === "P" ? "あなたの分隊" : "敵分隊", fname = (D.FORMATIONS.find((f) => f.key === fk) || {}).name || fk;
              obs.push({ ord: 1.5, key: "K" + tm, sig: "K" + tm + fk + (ok ? "h" : "b"), text: ok ? `${army}は${fname}を保ち、${FORM_HELD[fk]}。` : `${army}の${fname}が乱れ——${FORM_BROKE[fk]}。` });
            } }
          // 選抜：★中身が変わった or 3T以上未掲載の「新鮮」な観測だけを出す（古い事実の水増し再掲はしない＝膠着時に同じ行を連発しない）。
          //   動ある時は複数が新鮮→厚く、膠着時はAだけ→静かに。Aは常時(force)。情報量UPで最大5行。
          for (const o of obs) { const pv = snapSeen[o.key]; o._fresh = o.force || !pv || pv.sig !== o.sig || (turn - pv.turn >= 3); }
          const dynPri = { C: 4, G: 4, KP: 3, D: 3, H: 3, KC: 2, I: 2, F: 2 };
          const show = obs.filter((o) => o._fresh).sort((a, b) => (dynPri[b.key] || 1) - (dynPri[a.key] || 1)).slice(0, 5);
          for (const o of show) snapSeen[o.key] = { sig: o.sig, turn };
          show.sort((a, b) => a.ord - b.ord);   // 表示は情景→緊張の読み順
          for (const o of show) lines.push({ text: `　${o.text}`, cls: "snap" });
          lastGap = gap;
        }
      }
      for (const l of envLines) lines.push(l);   // 環境ダメージ(毒/出血/地形)は前状況の直後に
      // 索敵：このターン新たに発見した／見失った敵をフィードに（探知時に記録した発見者を常に名指し。撃たれて倒れても発見の事実は残る＝.aliveで弾かない）
      for (const tm of ["P", "C"]) {
        const army = tm === "P" ? "あなたの分隊" : "敵分隊";
        for (const e of known[tm].keys()) if (!detectedBefore[tm].has(e) && e.alive) {
          const info = known[tm].get(e), spotter = info && info.by ? info.by : null;
          const v = vary(SPOT_VERB, seed, turn, e.idx * 5 + (spotter ? spotter.idx : 0));
          lines.push({ text: spotter ? `── ${npc(spotter)} が ${npc(e)}${v}` : `── ${army}が ${npc(e)}${v}`, cls: "cm" });
        }
        for (const e of detectedBefore[tm]) if (!known[tm].has(e) && e.alive) lines.push({ text: `　${army}は ${npc(e)} を見失った——気配を探り直す。`, cls: "dim" });
      }
      // 9.2) チーム連携の活写（因果・同時動作・隠しパラ不使用）
      {
        const otherCount = (tm) => aliveCount(tm === "P" ? "C" : "P");
        const fl2 = (ev) => ev.flank === "rear" ? "背後から" : ev.flank === "side" ? "側面から" : "";
        let focus = null; { const m = new Map(); for (const ev of evs) if ((ev.dmg || 0) > 0 && !ev.ult) m.set(ev.def, (m.get(ev.def) || []).concat(ev)); for (const [tgt, list] of m) if (list.length >= 2) { const sum = list.reduce((s, e) => s + e.dmg, 0); if (!focus || sum > focus.sum) focus = { tgt, list, sum, team: list[0].att.team }; } }
        const focusAtts = new Set(focus ? focus.list.map((e) => e.att) : []);
        const clauseOf = (u) => {
          const allies = alliesOf(u).filter((a) => a !== u), shielder = allies.find((a) => a.alive && isShielding(a));
          const frontFell = deadThisTurn.some((d) => d.team === u.team && isFrontline(d));
          const dec = decs.get(u), retreating = (dec && dec.move === "RETREAT") || u.engage === "retreat"; // ★実際に退いているなら攻勢句を出さない（逆因果防止）
          if (u.guarding && u._wardRef) return `味方後衛 ${npc(u._wardRef)} が狙われると見て`;
          if (u.peeling && u.target) return `後衛に食らいつく ${npc(u.target)} を引き剝がそうと`;
          if (retreating && frontFell) return `前衛が崩れ戦線が割れたため`;
          if (retreating) return vary(["押されていると見て", "間合いを取り直そうと", "一度退いて立て直そうと"], seed, turn, u.idx + 19);
          if (u.engage === "commit" && shielder) return `${npc(shielder)} が敵火力を引きつける隙を突き`;
          if (u.engage === "commit" && aliveCount(u.team) > otherCount(u.team)) return `数の有利を押し込もうと`;
          if (u._closing) return `長射程の的を黙らせるべく`;
          if (aliveCount(u.team) === 1) return `ただ一人生き残り`;
          // ★連携アシスト：味方が崩した敵を高協調の体が突く／一匹狼は我流で動く＝協調性を言葉で可視化
          if (u.coop > 0.6 && u.target && u.target._opened != null && turn - u.target._opened <= 1) return vary(["味方が崩した隙を逃さず", "味方の崩しに合わせて", "崩れた敵を仲間と挟もうと"], seed, turn, u.idx + 13);
          if (u.coop < 0.32) return vary(["我流に単騎で", "手柄を求めて単身", "仲間に構わず"], seed, turn, u.idx + 14);
          if (u.target && u.target.alive && isolationOf(u.target) > 45) return `孤立した標的を逃さじと`;
          // 隊形を保っている体は背景として明示（プレーヤーの作戦が戦闘描写に出る）。★毎ビートは煩いので稀に（状況説明のK観測が主・こちらは差し色）。
          if (u.form && u.form !== "loose" && hsh(seed, turn, u.idx + 21) % 4 === 0) { const slot = formSlotWorld(u); if (slot && dist(u, slot) < 18) { const fn = (D.FORMATIONS.find((f) => f.key === u.form) || {}).name; if (fn) return vary([`${fn}を保ちながら`, `${fn}を崩さず`, `${fn}の一角として`], seed, turn, u.idx + 21); } }
          return "";
        };
        // このターンに u が敵の実攻撃（射撃/必殺）の的になったか＝回避の「見切り」が因果として成立するかの判定
        const ev_isUlt = (e) => !!(e && e.ult && !e.whiff);
        const attackedThisTurn = (u) => evs.some((e) => e.def === u && e.att.team !== u.team && e.att.alive && ((e.shots || 0) > 0 || ev_isUlt(e)));
        const hpTag = (u) => `残${Math.max(0, Math.round(u.hp))}/${u.maxHp}`; // 命中後の残HP（数値情報）
        // 手応え（被ダメの深さ・攻撃行の末尾に付す・観測可能な結果のみ）
        const reactOf = (ev) => { if (!ev || !ev.def || !(ev.dmg > 0)) return ""; const f = ev.dmg / (ev.def.maxHp || 100); const lv = ev.def.hp <= 0 ? "huge" : f < 0.08 ? "graze" : f < 0.18 ? "light" : f < 0.32 ? "solid" : f < 0.5 ? "heavy" : "huge"; return vary(REACT[lv], seed, turn, ev.att.idx * 11 + ev.def.idx + (ev.dmg | 0)); };
        // 行動句（同時動作の「XXした」）。名前は粒子に密着（"C-1を"）、主語は "X は " と空白で挟む＝既存ログ体裁に合わせる。
        const actOf = (u) => {
          const ev = evByAtt.get(u), t = u.target ? npc(u.target) : "敵", st = (ev && ev.applyStatus) ? "・" + (D.STATUS_JP[ev.applyStatus.type] || ev.applyStatus.type) : "";
          if (u._counter) return `${npc(u._counter.on)}の一撃を見切り、返す刃で反撃を叩き込んだ（−${u._counter.dmg}）`;
          if (ev && ev.grabHit) { const env = ev.envThrow ? "——溶岩の只中へ叩き込む" : ev.wallThrow ? "——壁際へ叩きつける" : ""; return `${ev.clinch ? "組み合いを制し" : "受けの構えごと"}${t}を投げ飛ばした${env}（−${ev.dmg}）`; }
          if (ev && ev.grabFail) return `${t}に組み付こうと踏み込むが、攻撃を合わされて潰された——隙を晒す`;
          if (ev && ev.grabWhiff) return `${t}へ組み付こうと踏み込むも、空を切った`;
          // ★回避：実際に攻撃を受けた時だけ「見切って受け流した」。誰も攻撃していないターンは中立の構え（因果捏造を防ぐ）。
          if (ev && ev.dodge) return attackedThisTurn(u) ? `${t}の攻撃を見切り、紙一重で受け流した` : vary(["敵の出方を窺い、身構えた", "隙を見せず構えを取った", "間合いを測り直して様子を見た"], seed, turn, u.idx + 17);
          if (ev && ev.chargeBroke) return `狙いを定める間もなく踏み込まれ、照準が崩された`;
          if (ev && ev.snap) { const rc = reactOf(ev); return (ev.hits || 0) > 0 ? `${t}へ苦し紛れの即撃ち（−${ev.dmg}${ev.crit ? "・会心" : ""}${st}｜${hpTag(ev.def)}）${rc ? "、" + rc : ""}` : `据銃が間に合わず、${t}へ放った一射は大きく逸れた`; }
          if (ev && ev.charging) return `息を整え、${t}に狙いを定める`;
          if (ev && ev.ult && !ev.whiff) return `必殺・${ev.ultName}を解き放った`;
          if (ev && (ev.attack === "RANGED" || ev.attack === "MELEE") && (ev.hits || 0) > 0) { const cat = evCat(ev), verb = vary(HIT_VERB[cat] || HIT_VERB.bal, seed, turn, u.idx * 13 + (u.target ? u.target.idx : 0)), rc = reactOf(ev); const cnt = (ev.shots || 0) > 1 ? `${ev.shots}${ev.attack === "MELEE" ? "撃" : "射"}${ev.hits}中・` : ""; const am = ev.attack === "RANGED" && u.ammo <= 5 ? `・残弾${u.ammo}` : ""; return `${fl2(ev)}${t}${verb}（${cnt}−${ev.dmg}${ev.crit ? "・会心" : ""}${st}｜${hpTag(ev.def)}${am}）${rc ? "、" + rc : ""}`; }
          if (ev && (ev.shots || 0) > 0 && (ev.hits || 0) === 0) { const cat = evCat(ev), cnt = (ev.shots || 0) > 1 ? `${ev.shots}${ev.attack === "MELEE" ? "撃" : "射"}全外し——` : ""; return `${cnt}${t}${vary(MISS_VERB[cat] || MISS_VERB.bal, seed, turn, u.idx * 5 + turn)}`; }
          if (u.guarding) return `身を割り込ませて盾となった`;
          const dec = decs.get(u);
          if (dec && dec.move === "RETREAT") return `射線を切って退いた`;
          if (u.engage === "retreat") return `味方の元へ退いて立て直しを図った`;
          if (isShielding(u)) return `敵の只中で盾となり火力を受け止めた`;
          if (dec && dec.move === "ADVANCE") return u.target ? `${t}へ間合いを詰めた` : vary(["敵影を求めて前へ出た", "気配を探りつつ間合いを詰めた", "射線を確保しながら前進した"], seed, turn, u.idx + 18); // ★索敵中（未発見）は「敵へ」と言わない
          return u.target ? `その場で射線と退路を計った` : `物陰から敵の気配を窺った`;
        };
        // 状態の気配（気力/流れ/気迫/怯み/背水を一語で・最も顕著な1つ）。機構は走っているのに描写に出ていなかった部分を露出。
        const demeanorOf = (u) => {
          const hp = u.maxHp ? u.hp / u.maxHp : 1, dev = evByAtt.get(u), dhit = dev && (dev.hits || 0) > 0; // 当てた時だけ「勢い」を言う
          if (u._surged) return vary(["仲間の仇とばかりに闘志を燃やし", "むしろ気を吐き", "倒れた味方の分も背負い"], seed, turn, u.idx + 15); // 一匹狼＝味方の死で奮起
          if (u._shaken) return vary(["味方を失い動揺しながらも", "仲間の死に気を呑まれつつ"], seed, turn, u.idx + 16);       // 献身＝味方の死に気落ち
          if (u.flinch > 0) return vary(["体勢を崩されながらも", "たたらを踏みつつ"], seed, turn, u.idx + 5);
          if (hp > 0 && hp < 0.25) return vary(["満身創痍で", "血路を探りつつ", "気力を振り絞り"], seed, turn, u.idx + 6);
          if ((u.resolve || 0) >= 1) return vary(["闘気を滾らせ", "気迫を漲らせ"], seed, turn, u.idx + 7);          // 気迫満タン＝必殺の機
          if (dhit && (u.momentum || 0) > 0.4) return vary(["勢いに乗って", "波に乗り", "畳みかけるように"], seed, turn, u.idx + 8); // ★流れ＝勢い（当てた時だけ）
          if ((u.stamina || 1) < 0.35) return vary(["息を切らしながら", "足を重そうに", "肩で息をつきつつ"], seed, turn, u.idx + 9); // 気力＝消耗
          if ((u.momentum || 0) < -0.4) return vary(["気圧されながらも", "押されつつも"], seed, turn, u.idx + 10);   // 流れ＝萎え
          return "";
        };
        const beats = [];
        if (focus) { const army = focus.team === "P" ? "あなたの分隊" : "敵分隊", v = isolationOf(focus.tgt) > 45 ? `孤立した ${npc(focus.tgt)}を囲んで各個撃破にかかった` : `${npc(focus.tgt)}へ火力を一点に集中した`; beats.push({ sal: 50, txt: `${army}は ${v}（${focus.list.length}体で計 −${Math.min(focus.sum, focus.tgt.maxHp)}｜${npc(focus.tgt)} 残${Math.max(0, Math.round(focus.tgt.hp))}/${focus.tgt.maxHp}）` }); }
        for (const u of ALL) {
          if (!u.alive) continue; const ev = evByAtt.get(u);
          if (ev && ev._killed) continue;        // 撃破はKO行が描く
          if (focusAtts.has(u)) continue;        // 集中砲火に束ねた攻め手は個別に出さない
          const dec = decs.get(u), acted = ev && ((ev.shots || 0) > 0 || ev.ult || ev.charging || ev.chargeBroke || ev.grab || ev.grabHit || ev.grabFail || ev.grabWhiff || ev.dodge), moved = dec && (dec.move === "ADVANCE" || dec.move === "RETREAT");
          if (!(acted || moved || u.guarding || u.peeling || isShielding(u) || u._counter)) continue; // 何もしていない（その場待機）体は語らない＝意図倒れの文を出さない
          let sal = 0;
          if (u.guarding) sal += 6; if (isShielding(u)) sal += 5; if (u.peeling) sal += 5;
          if (ev && ev.crit) sal += 4; if (ev && ev.flank) sal += 3;
          if (u._counter) sal += 5; if (ev && ev.grabHit) sal += 5; if (ev && (ev.grabFail || ev.grabWhiff)) sal += 3; if (ev && ev.dodge) sal += 2;
          if (ev && ev.chargeBroke) sal += 4; if (ev && ev.snap) sal += 2; if (ev && ev.charging) sal += 1;
          if (u.engage === "retreat") sal += 3; else if (u.engage === "commit") sal += 2;
          if (ev && (ev.dmg || 0) > 0) sal += Math.min(4, ev.dmg / 15);
          const clause = clauseOf(u); if (clause) sal += 2;
          if (sal < 2) continue; // 情報量UP：閾値を下げて、より多くの体の動きを描く
          beats.push({ sal, u, clause });
        }
        beats.sort((a, b) => b.sal - a.sal);
        const shown = beats.slice(0, 4); // 情報量UP：1ターンに描く体を3→4に（観戦のボリューム増）
        let bi = 0;
        while (bi < shown.length) {
          const a = shown[bi], b = shown[bi + 1];
          // ★相互に狙い合っている（真の一騎打ち＝AとBが互いをtarget）時だけ1文に織る。「。一方、Bは」の機械的分断を避ける。
          const isAtk = (av) => av && ((av.shots || 0) > 0 || av.ult || av.grab || av.grabHit);
          const aev = a && a.u ? evByAtt.get(a.u) : null, bevm = b && b.u ? evByAtt.get(b.u) : null;
          // ★相互に狙い合う一騎打ち＋少なくとも一方が実攻撃している時だけ1文に織る（両者非攻撃の「対決」捏造を防ぐ）
          const canMerge = a && b && !a.txt && !b.txt && a.u && b.u && b.u !== a.u && a.u.target === b.u && b.u.target === a.u && (isAtk(aev) || isAtk(bevm));
          if (canMerge) {
            const dmA = demeanorOf(a.u), strikesBack = bevm && bevm.def === a.u && (bevm.hits || 0) > 0;
            const link = strikesBack ? vary(["——すかさず ", "——間髪入れず ", "——即座に "], seed, turn, bi) : "——対する ";
            const body = `${a.clause ? a.clause + "、" : ""}${npc(a.u)} は ${dmA ? dmA + "、" : ""}${actOf(a.u)}${link}${npc(b.u)} は ${actOf(b.u)}`;
            lines.push({ text: `── ${body}。`, cls: bi === 0 ? "cm" : "ex" });
            bi += 2;
          } else {
            // ★同時性の接続詞（一方、/時を同じくして、等）は撤去（不自然・ユーザー指摘）。同TURN内で「──」が並ぶ＝同時、は構造で伝わる。
            const dm = a.u ? demeanorOf(a.u) : "";
            const body = a.txt ? a.txt : `${a.clause ? a.clause + "、" : ""}${npc(a.u)} は ${dm ? dm + "、" : ""}${actOf(a.u)}`;
            lines.push({ text: `── ${body}。`, cls: bi === 0 ? "cm" : "ex" });
            bi += 1;
          }
        }
      }
      // ===== 結果（連携の帰結を後に置く）：奇襲→撃破→必殺 =====
      // 奇襲：本物の不意打ちだけ＝未発見のまま会心を当てた一撃（撃破はKO行が背後/側面で描くので除外）。1戦に1度きり＝特別感を保つ。
      if (!ambushShown) { let amb = null; for (const ev of evs) if ((ev.dmg || 0) > 0 && ev.crit && !ev._killed && !known[ev.att.team === "P" ? "C" : "P"].has(ev.att) && (!amb || ev.dmg > amb.dmg)) amb = ev; if (amb) { lines.push({ text: `── 奇襲！ ${npc(amb.att)} が死角から ${npc(amb.def)} に痛打を見舞う！ −${amb.dmg}`, cls: "cm" }); ambushShown = true; } }
      // KO（武器カテゴリ別の決め技・側背面・必殺）
      for (const ev of evs) if (ev._killed) {
        const verb = vary(KO_VERB[evCat(ev)] || KO_VERB.bal, seed, turn, ev.att.idx * 7 + ev.def.idx);
        const lead = ev.crit ? "会心の一撃——" : ev.flank === "rear" ? "背後を取り——" : ev.flank === "side" ? "側面を突き——" : vary(KO_LEAD, seed, turn, ev.att.idx * 7 + ev.def.idx); // KOにドラマの導入
        const txt = ev.ult ? `── 必殺・${ev.ultName}が炸裂——${npc(ev.att)} が ${npc(ev._killed)}${verb}！`
          : `── ${lead}${npc(ev.att)} が ${npc(ev._killed)}${verb}！`;
        lines.push({ text: txt, cls: "cm" });
      }
      for (const u of deadThisTurn) if (!evs.some((ev) => ev._killed === u)) lines.push({ text: `── ${npc(u)}、力尽きて崩れ落ちる。`, cls: "cm" });
      // 必殺（撃破に紐づかなかったもの）
      for (const ev of evs) if (ev.ult && !ev._killed) lines.push({ text: `── 気迫炸裂！${npc(ev.att)} の必殺・${ev.ultName}${ev.whiff ? "——惜しくも空を切る！" : `が ${npc(ev.def)} を捉える −${ev.dmg}！`}`, cls: "cm" });
      // 瀕死ドラマ（このターンで瀕死域に踏み込んだ体・1件）
      { let dying = null; for (const ev of evs) if (ev.dmg > 0 && ev.def.alive && ev.def.hp / ev.def.maxHp < 0.22 && (ev.def.hp + ev.dmg) / ev.def.maxHp >= 0.22) { dying = ev.def; break; } if (dying) lines.push({ text: `　${npc(dying)} 満身創痍——なお踏みとどまる。`, cls: "dim" }); }
      // その他サマリ（多彩化）／静かなターンは機動フレーバーで埋める
      const hitN = evs.filter((ev) => (ev.hits || 0) > 0).length, shown = lines.filter((l) => l.cls === "cm" || l.cls === "ex").length;
      if (hitN > shown) lines.push({ text: `　…${vary(SKIRMISH, seed, turn, hitN)}（命中 ${hitN} 件）`, cls: "dim" });
      else if (hitN === 0 && shown === 0) {
        const searchPhase = (known.P.size + known.C.size) === 0;
        if (searchPhase) {                                              // 索敵中：誰が探しているかを個体で描く（嗅覚=D1が鋭い体は第六感で敵方へ）
          const sr = ALL.filter((u) => u.alive); let prevAct = null;
          for (let k = 0, n = 0; k < sr.length && n < 2; k++, n++) {
            const u = sr[(turn * 2 + k) % sr.length], pool = u.micros.D1 >= 0.6 ? INSTINCT_ACT : SEARCH_ACT;
            let off = 0, act = vary(pool, seed, turn, u.idx * 3 + k);
            while (act === prevAct && off < pool.length) { off++; act = vary(pool, seed, turn, u.idx * 3 + k + off); } // 同ターン同文を回避（決定論）
            lines.push({ text: `　${npc(u)} が${act}。`, cls: "dim" });
            prevAct = act;
          }
        } else lines.push({ text: `　${vary(MANEUVER, seed, turn, aliveCount("P") * 5 + aliveCount("C"))}`, cls: "dim" });
      }
      // ★形勢転換の演出：頭数の優劣が覆った瞬間だけ盛り上げる（撃破が絡む時＝ドラマの山）。初撃破(0→±)では出さない。
      { const lead = aliveCount("P") - aliveCount("C"), sign = lead > 0 ? 1 : lead < 0 ? -1 : 0;
        if (sign !== prevLeadSign) {
          if (prevLeadSign !== 0 && deadThisTurn.length) { const txt = sign > 0 ? "あなたの分隊が数で押し返す" : sign < 0 ? "敵分隊が数で押し込む" : "数が並び、五分に戻る"; lines.push({ text: `── 形勢が動く——${txt}！`, cls: "cm" }); }
          prevLeadSign = sign;
        } }
      // ★残存フッターは変化した時だけ（毎ターン70%が無変化＝HUDと重複の冗長を解消）。10%帯で量子化＋5T毎に区切り＋決着。
      { const resSig = `${aliveCount("P")}/${Math.round(teamHpFrac("P") * 5)}|${aliveCount("C")}/${Math.round(teamHpFrac("C") * 5)}`;
        if (resSig !== lastResidual || turn - lastFooterTurn >= 5 || over) {
          const hpSum = (t) => (t === "P" ? P : C).reduce((a, u) => a + Math.max(0, Math.round(u.hp)), 0), hpMax = (t) => (t === "P" ? P : C).reduce((a, u) => a + u.maxHp, 0);
          lines.push({ text: `　└ 残存 あなた ${aliveCount("P")}/${P.length}（HP ${hpSum("P")}/${hpMax("P")}・${Math.round(teamHpFrac("P") * 100)}％）｜敵 ${aliveCount("C")}/${C.length}（HP ${hpSum("C")}/${hpMax("C")}・${Math.round(teamHpFrac("C") * 100)}％）`, cls: "dim" });
          lastResidual = resSig; lastFooterTurn = turn;
        } }

      // 9) 勝敗
      result = finishCheck();
      if (result) { over = true; for (const fl of finishNarration(result)) lines.push(fl); }
      return { turn, lines, events, over, result };
    }

    function finishCheck() {
      const pa = aliveCount("P"), ca = aliveCount("C");
      if (pa <= 0 && ca <= 0) return { type: "draw", text: "両軍全滅" };
      if (ca <= 0) return { type: "win", winner: "PLR", text: "殲滅" };
      if (pa <= 0) return { type: "win", winner: "CPU", text: "殲滅" };
      if (turn >= turnCap) { const pf = teamHpFrac("P"), cf = teamHpFrac("C"); if (Math.abs(pf - cf) < 0.05) return { type: "draw", text: "時間切れ・互角" }; return { type: "win", winner: pf > cf ? "PLR" : "CPU", text: "時間切れ・HP判定" }; }
      return null;
    }
    function finishNarration(r) {
      if (r.type === "draw") return [{ text: `══ 決着：${r.text}。両分隊、刺し違えて相果てる。 ══`, cls: "turnhdr" }];
      const winTeam = r.winner === "PLR" ? "P" : "C", win = r.winner === "PLR" ? "あなたの分隊" : "敵分隊";
      const surv = aliveCount(winTeam), n = (winTeam === "P" ? P : C).length, hp = Math.round(teamHpFrac(winTeam) * 100);
      const out = [{ text: `══ 決着：${r.text}！ ${win}が戦場を制した。 ══`, cls: "turnhdr" }];
      // 勝ち方のフレーバー（残存数で物語を変える）
      let flav;
      if (surv >= n) flav = `${n}体を一人も欠かず——完勝。`;
      else if (surv === 1) flav = `最後に立っていたのは ただ一騎。辛くも勝ち残った（残HP${hp}％）。`;
      else flav = `${surv}/${n} が生き残り、競り勝った（残HP${hp}％）。`;
      out.push({ text: `　${flav}`, cls: "dim" });
      return out;
    }

    // ===== 分析（分隊サマリ＋各体）=====
    function getAnalysis() {
      function unitCard(u) {
        const won = !!result && result.type === "win" && (result.winner === (u.team === "P" ? "PLR" : "CPU"));
        const role = SCS.ui && SCS.ui.styleOf ? SCS.ui.styleOf(u) : "";
        const hitRate = u.st.shots ? Math.round((u.st.hits / u.st.shots) * 100) : 0;
        return { name: u.name, team: u.team, alive: u.alive, hp: `${Math.max(0, u.hp)}/${u.maxHp}`, weapon: `${u.ranged.name}＋${u.melee.name}`, role, tank: u.tank || 0, coop: u.coop || 0,
          dealt: u.st.dealt, taken: u.st.taken, kills: u.st.kills, hitRate, crits: u.st.crits, ults: u.st.ults, flanks: u.st.flanks, downTurn: u.st.downTurn,
          dodges: u.st.dodges, counters: u.st.counters, grabs: u.st.grabHits, wasFlanked: u.st.wasFlanked, winded: u.st.winded, resPeak: u.st.resPeak, won };
      }
      const sum = (cs, k) => cs.reduce((a, c) => a + (c[k] || 0), 0);
      // 総評＝一戦の物語を一言／方向性＝弱点に応じて回す大パラを名指し（24小パラ・重み行列は非公開のまま）
      function build(team, cards, foe) {
        const dealt = sum(cards, "dealt"), taken = sum(cards, "taken"), kills = sum(cards, "kills");
        const survivors = cards.filter((c) => c.alive).length, foeSurv = foe.filter((c) => c.alive).length;
        let mvp = null, silent = null;
        for (const c of cards) { if (!mvp || c.dealt > mvp.dealt) mvp = c; if (!silent || c.dealt < silent.dealt) silent = c; }
        const firstDown = cards.filter((c) => c.downTurn > 0).sort((a, b) => a.downTurn - b.downTurn)[0];
        const notes = [];
        if (mvp) notes.push(`主力＝${mvp.name}（与ダメ${mvp.dealt}・撃破${mvp.kills}）`);
        if (silent && cards.length > 1 && silent !== mvp && silent.dealt < mvp.dealt * 0.4) notes.push(`${silent.name}が機能せず（与ダメ${silent.dealt}）`);
        if (firstDown) notes.push(`${firstDown.name}が最初に脱落（T${firstDown.downTurn}）`);
        const flanked = sum(cards, "wasFlanked"), winded = sum(cards, "winded"), dodges = sum(cards, "dodges"), counters = sum(cards, "counters"), grabs = sum(cards, "grabs");
        if (counters) notes.push(`回避からの反撃 ${counters}回`); if (grabs) notes.push(`崩し（投げ）成功 ${grabs}回`);
        const loners = cards.filter((c) => c.coop < 0.32), teamers = cards.filter((c) => c.coop > 0.6);
        if (loners.length) notes.push(`一匹狼＝${loners.map((c) => c.name).join("・")}（連携せず単騎で戦う）`);
        const fk = team === "P" ? formP : formC, avgCoop = sum(cards, "coop") / Math.max(1, cards.length);
        if (fk && fk !== "loose") { const fname = (D.FORMATIONS.find((f) => f.key === fk) || {}).name || fk; notes.push(`隊形『${fname}』${avgCoop < 0.4 ? "——だが我流が多く崩れがち" : avgCoop > 0.62 ? "——規律が高くよく保てる" : ""}`); }
        // 状況信号
        const won = !!result && result.type === "win" && (result.winner === (team === "P" ? "PLR" : "CPU"));
        const draw = !result || result.type !== "win";
        const hasTank = cards.some((c) => c.tank >= 0.4);
        const backLost = firstDown && firstDown.tank < 0.3;                    // 脆い/後衛役が先に落ちた
        const ultIdle = cards.some((c) => c.resPeak >= 1 && c.ults === 0);     // 気迫満タンに達したが必殺ゼロ
        const wOut = dealt < taken * 0.72;                                     // 火力負け
        // 総評
        let verdict;
        if (draw) verdict = "決着つかず——両軍、痛み分け。";
        else if (won) verdict = survivors === cards.length ? "無傷で殲滅——危なげない快勝。" : survivors >= 2 ? `${survivors}体を残して押し切った。` : "ただ一騎を残し、辛くも競り勝った。";
        else if (backLost) verdict = "前衛が支えきれず、後衛が裸にされて押し切られた。";
        else if (flanked >= 3) verdict = "側背面を取られ続け、陣形を崩されて敗れた。";
        else if (ultIdle) verdict = "切り札を抱えたまま、競り負けた。";
        else if (wOut) verdict = "火力で押し込まれ、削り負けた。";
        else verdict = "一進一退の末、最後の数で及ばなかった。";
        // 次の方向性（優先順・大パラ名指し・最大2件）
        const advice = [];
        if (backLost && !hasTank) advice.push("盾役が不在。前衛の体に〈誇り〉〈自信〉〈規律〉と〈冷静さ〉を寄せ、狙われても持ちこたえる盾を作る。");
        else if (backLost && hasTank) advice.push("後衛が早期に脱落。前衛の盾度を上げるか、後衛を〈慎重〉寄りにして射点を下げる。");
        if (advice.length < 2 && fk && fk !== "loose" && avgCoop < 0.38 && !won) advice.push(`選んだ隊形を保てる規律/協調が足りない（我流が多い）。〈規律〉〈順応性〉を寄せるか、隊形を『散開』にして各自の人格に任せる。`);
        if (advice.length < 2 && teamers.length === 0 && !won) advice.push("分隊に連携役がいない（全員が我流寄り）。〈順応性（観察）〉〈誇り（騎士道）〉〈規律〉を一部に寄せ、味方の崩しを活かす体を入れる。");
        if (advice.length < 2 && flanked >= 3) advice.push("側背面を取られすぎ。〈規律〉と〈観察（順応性）〉で隊形と射線を保つ。");
        if (advice.length < 2 && ultIdle) advice.push("気迫を抱え込んで終わった。〈非情さ〉〈リスク選好〉で必殺を早めに切る。");
        if (advice.length < 2 && winded >= (turn * 0.5)) advice.push("息切れで失速。〈忍耐（待ち）〉で消耗を抑えるか〈冷静さ〉で気力回復を速める。");
        if (advice.length < 2 && wOut) advice.push("火力不足。〈闘争心〉〈攻め志向〉で攻撃に出る体を増やす。");
        if (advice.length < 2 && silent && cards.length > 1 && silent.dealt < mvp.dealt * 0.4) advice.push(`${silent.name}の役割が噛み合っていない。武器と気質（間合い・攻め引き）の組み合わせを見直す。`);
        if (!advice.length && won) advice.push("噛み合った編成。今の役割分担を軸に、より厳しい戦場/編成へ。");
        if (!advice.length) advice.push("決着つかず。〈闘争心〉か〈リスク選好〉を一段上げ、仕掛けを早めて膠着を破る。");
        const formName = fk && fk !== "loose" ? ((D.FORMATIONS.find((f) => f.key === fk) || {}).name || fk) : "散開";
        return { team, cards, dealt, taken, kills, survivors, notes, verdict, advice: advice.slice(0, 2), formation: formName };
      }
      const pC = P.map(unitCard), cC = C.map(unitCard);
      return { turns: turn, arena: arena.name, mod: mod.key === "none" ? null : mod.name, over, result, plr: build("P", pC, cC), cpu: build("C", cC, pC) };
    }

    // 撃破帰属（kills）は step 解決後に確定するので、step内で加算する
    return {
      step, getAnalysis, formP, formC,
      get turn() { return turn; }, get over() { return over; }, get result() { return result; },
      get teams() { return { P, C }; }, get arena() { return { name: arena.name, flavor: arena.flavor }; },
      get modifier() { return mod.key === "none" ? null : { name: mod.name, flavor: mod.flavor }; },
      field, obstacles, maxDist, losClear, terrain: arena.terrain, baseTerrainKey: arena.base, get hazards() { return hazards; },
      teamHpFrac, aliveCount,
      spotted: (u) => known[u.team === "P" ? "C" : "P"].has(u), // その体が敵に発見されているか（レーダーのゴースト表示用）。視界扇は u.sightR/u.sightHalf/faceX/faceY
    };
  };

  // 設計UI向け公開：choices からタンク度（0..1.2）と盾資質ラベルを返す（戦闘前に「盾を設計できる」可読化）
  SCS.squadTank = function (choices) {
    const u = SCS.derive.buildUnit("U", choices);
    const tank = tankRating(u);
    return { tank, presence: basePresence(u), hold: holdFactor(u), isTank: tank >= 0.45, isFront: tank >= 0.30 };
  };
  SCS.squadCoop = function (choices) { // 協調性（チームプレイ度）＝設計UIの『連携/我流』バッジ用
    const u = SCS.derive.buildUnit("U", choices);
    const coop = coopRating(u);
    return { coop, isTeam: coop >= 0.6, isLoner: coop < 0.32 };
  };
})();
