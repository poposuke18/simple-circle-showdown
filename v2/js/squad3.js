/* v2/js/squad3.js — v2 の分隊戦エンジン（思考エンジン v3 の土台）。Obsidian [[AI思考エンジン設計]]。
 *   js/squad.js（旧版・classic.html が使う。変えない）の写しから分けた。物理（命中・被ダメ・移動・視界）は同じ。
 *   チームごとに頭を選べる：opts.brain = { P: "v3" | "v2", C: ... }。"v2"＝分ける前の判断そのまま（新旧を同じ物理で比べるため）。
 *   決定論：攻撃ロール=本戦rng、判断は乱数非消費、固定順序(P[0..],C[0..])。
 */
window.SCS = window.SCS || {};

(function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function ptInRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }
  function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
  function segSeg(a, b, c, d) { const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)); }
  function segIntersectsRect(p, q, r) {
    if ((p.x > q.x ? p.x : q.x) < r.x || (p.x < q.x ? p.x : q.x) > r.x + r.w || (p.y > q.y ? p.y : q.y) < r.y || (p.y < q.y ? p.y : q.y) > r.y + r.h) return false;   // 外接箱が重ならない＝交わらない（結果は同じ・速いだけ）
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

  SCS.makeSquadBattle3 = function (teamPChoices, teamCChoices, seed, arenaName, modName, formPName, formCName, namesP, namesC, opts) {
    const FORM2 = !!(opts && opts.formation);                                      // v2：隊形が初期配置と動きに効く（[[分隊戦設計]]§17）。旧来の呼び出しは opts なし＝不変
    const ORDER_P = (opts && Array.isArray(opts.orderP) && opts.orderP.length === teamPChoices.length) ? opts.orderP.slice() : null; // v2：プレーヤーが配置した隊形の順
    const COND = (opts && opts.cond) || null;                                        // 連戦の状態（[[v2ゲーム設計]] v2.s4.cond）：{P:{lead,trust,units:[{fat,mor}]},C:{...}}。無ければ今までどおり
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
    const GM = arena.gimmick || null;                                                // 戦場のギミック（[[v2ゲーム設計]] v2.more）。無い戦場はギミックの処理を一切通らない
    const wallHp = (o) => Math.round(clamp(GM.hpk * Math.sqrt(o.w * o.h), GM.hpMin, GM.hpMax));   // 崩れる壁の固さ（大きい壁ほど固い）
    const obstacles = arena.obstacles.map((o) => (GM && GM.kind === "crumble" ? { ...o, hp: wallHp(o), hp0: wallHp(o) } : { ...o, hp: 70 }));
    const zones = arena.terrain.slice();                                             // 立つと効く地形（崩れた壁は瓦礫としてここに足す）
    const gim = { tide: 0, spring: "idle", vents: [] };                              // ギミックの今の状態（潮の高さ・泉・噴く所の予告）
    const hazards = [];
    const maxDist = Math.hypot(arena.w, arena.h), turnCap = Math.round(S.turnCap * 1.5); // 30×1.5=45ターン上限（タイムアップ率↑・待ち戦の余地）
    let turn = 0, over = false, result = null, noDmgTurns = 0, ambushShown = false, lastGap = null, everContact = false;
    let prevLeadSign = 0, lastResidual = "", lastFooterTurn = -9; // 形勢転換の演出／残存フッターの冗長抑制（70%が無変化だった）
    const snapSeen = {};   // 前状況スナップショット：キー→{text,turn}。静的事実の連続反復を抑える（変化 or 3T経過で再掲）

    // ===== 幾何・地形・命中（1v1から移植）=====
    const cx = (x) => clamp(x, 0, field.w), cy = (y) => clamp(y, 0, field.h);
    function pushOutObstacle(x, y) {
      for (const o of obstacles) { if (o.hp <= 0) continue; if (x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h) { const dl = x - o.x, dr = o.x + o.w - x, dt = y - o.y, db = o.y + o.h - y, m = Math.min(dl, dr, dt, db); if (m === dl) x = o.x - 0.02; else if (m === dr) x = o.x + o.w + 0.02; else if (m === dt) y = o.y - 0.02; else y = o.y + o.h + 0.02; } }
      if (NAV) { const q = pushOutBlocks(x, y); x = q.x; y = q.y; }
      return { x: cx(x), y: cy(y) };
    }
    // ===== 通れない地形と回り道（[[分隊戦設計]]§16・戦場データに nav:true がある時だけ。旧来の戦場は以下を一切通らない）=====
    const NAV = !!arena.nav;
    const BRAIN = { P: (opts && opts.brain && opts.brain.P) || "v2", C: (opts && opts.brain && opts.brain.C) || "v2" };   // チームごとの頭（[[AI思考エンジン設計]]）
    const FORM2_W = (opts && opts.formation) || 0;
    // 制圧（[[AI思考エンジン設計]] ai3.supp.*）：撃たれる（外れても）と次のターンの命中と足が落ちる。opts.suppress===false で切れる（比べる用）
    const SUP = opts && opts.suppress === false ? null : Object.assign({ acc: 0.45, move: 0.4, decay: 0.55, cap: 0.7, c5: 0.6, pin: 0.3, base: 0.1, dmgDiv: 500, pinK: 14, flankK: 1.2, duck: 1.2 }, (opts && opts.supp) || {});   // 値は新旧対戦で決めた（ai3.supp.meas）
    const supShot = (w) => SUP.base + w.damage / SUP.dmgDiv;                         // 1発で与える制圧（自動火器は数で大きく、狙撃は小さい）
    const suppAcc = (u) => (SUP && u.supp ? 1 - SUP.acc * u.supp : 1);                // 制圧された駒の射撃の命中
    const blocks = NAV ? arena.terrain.filter((z) => T[z.t] && T[z.t].block) : [];
    const solidRects = () => blocks.concat(obstacles.filter((o) => o.hp > 0));
    const insideAny = (x, y) => solidRects().some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
    function pushOutBlocks(x, y) {                                                    // 通れない地形・遮蔽物から一番近い「空いている」辺へ（地図の端に接した辺へは出さない）
      for (let it = 0; it < 4; it++) {
        const r = solidRects().find((q) => x > q.x && x < q.x + q.w && y > q.y && y < q.y + q.h); if (!r) return { x, y };
        const cand = [];
        if (r.x > 0.01) cand.push([x - r.x, r.x - 0.05, y]);
        if (r.x + r.w < field.w - 0.01) cand.push([r.x + r.w - x, r.x + r.w + 0.05, y]);
        if (r.y > 0.01) cand.push([y - r.y, x, r.y - 0.05]);
        if (r.y + r.h < field.h - 0.01) cand.push([r.y + r.h - y, x, r.y + r.h + 0.05]);
        if (!cand.length) break;
        cand.sort((a, b) => a[0] - b[0]);
        const free = cand.find((c) => !insideAny(c[1], c[2]));                       // 隣の壁へ押し込まない（行ったり来たりを防ぐ）
        if (free) return { x: free[1], y: free[2] };
        x = cand[0][1]; y = cand[0][2];
      }
      if (!insideAny(x, y)) return { x, y };
      let best = null, bd = Infinity;                                                 // それでも埋まる時は、一番近い空いた格子の中心へ
      for (let c = 0; c < GW * GH; c++) { if (navBlocked[c]) continue; const p = cellPt(c), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
      return best || { x, y };
    }
    const NC = 2, GW = Math.ceil(field.w / NC), GH = Math.ceil(field.h / NC);
    const navBlocked = NAV ? new Uint8Array(GW * GH) : null;
    const cellOf = (p) => clamp(Math.floor(p.y / NC), 0, GH - 1) * GW + clamp(Math.floor(p.x / NC), 0, GW - 1);
    const cellPt = (c) => ({ x: (c % GW + 0.5) * NC, y: (Math.floor(c / GW) + 0.5) * NC });
    // 抜け道の無い小部屋（遺跡の囲いなど）：点の動きなら狭い隙間から入れるが、道探しでは出られず固まる（2026-10-11 実測）。
    // 始めに、道でつながる一番大きな広がり（主領域）以外の空きを埋めて入れないようにする。NAV の時だけ＝旧来の戦場は不変
    const navComp = NAV ? new Int32Array(GW * GH).fill(-1) : null; let navMain = 0;
    function buildNav() {                                                             // 塞がった格子と主領域。始めに1回（崩れる壁の戦場は壁が崩れるたびに作り直す）
      for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].trap) blocks.splice(i, 1);
      navBlocked.fill(0); navComp.fill(-1); navMain = 0;
      const solid = blocks.concat(obstacles.filter((o) => o.hp > 0));
      for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
        const px = (i + 0.5) * NC, py = (j + 0.5) * NC;
        if (solid.some((r) => px > r.x - 0.8 && px < r.x + r.w + 0.8 && py > r.y - 0.8 && py < r.y + r.h + 0.8)) navBlocked[j * GW + i] = 1;
      }
      const sizes = [];
      for (let s0 = 0; s0 < GW * GH; s0++) {
        if (navBlocked[s0] || navComp[s0] >= 0) continue;
        const id = sizes.length, q = [s0]; navComp[s0] = id;
        for (let h = 0; h < q.length; h++) { const c = q[h], ci = c % GW, cj = (c - ci) / GW;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue; const n = nj * GW + ni; if (navBlocked[n] || navComp[n] >= 0) continue; navComp[n] = id; q.push(n); } }
        sizes.push(q.length);
      }
      sizes.forEach((v, i) => { if (v > sizes[navMain]) navMain = i; });
      for (let j = 0; j < GH; j++) for (let i = 0; i < GW;) {
        const c = j * GW + i; if (navBlocked[c] || navComp[c] === navMain) { i++; continue; }
        let k = i; while (k < GW && !navBlocked[j * GW + k] && navComp[j * GW + k] !== navMain) { navBlocked[j * GW + k] = 1; k++; }
        blocks.push({ x: i * NC, y: j * NC, w: (k - i) * NC, h: NC, trap: true }); i = k;
      }
    }
    if (NAV) buildNav();
    // それでも入り込んでいたら（壁際の隙間など）、主領域の一番近い所へ出す
    function rescueTrapped(u) {
      const c = cellOf(u); if (navComp[c] === navMain) return;
      let best = -1, bd = Infinity; for (let k = 0; k < GW * GH; k++) { if (navComp[k] !== navMain) continue; const p = cellPt(k), d = Math.hypot(p.x - u.x, p.y - u.y); if (d < bd) { bd = d; best = k; } }
      if (best >= 0 && bd > 2.5) { const p = cellPt(best); u.x = p.x; u.y = p.y; }
    }
    // 遮蔽物の升（8単位）：線分の外接箱にかかる升の遮蔽物だけを調べる。外接箱が重ならない遮蔽物はもともと交わらない＝結果は全部調べるのと同じ（壁の多い戦場で速い）
    const OBG = 8, obW = Math.ceil(field.w / OBG) + 1, obH = Math.ceil(field.h / OBG) + 1, obGrid = Array.from({ length: obW * obH }, () => []);
    for (const o of obstacles) for (let j = Math.max(0, Math.floor(o.y / OBG)); j <= Math.min(obH - 1, Math.floor((o.y + o.h) / OBG)); j++) for (let i = Math.max(0, Math.floor(o.x / OBG)); i <= Math.min(obW - 1, Math.floor((o.x + o.w) / OBG)); i++) obGrid[j * obW + i].push(o);
    let obStamp = 0;
    function segHitsObstacle(a, b) {
      const i0 = clamp(Math.floor(Math.min(a.x, b.x) / OBG), 0, obW - 1), i1 = clamp(Math.floor(Math.max(a.x, b.x) / OBG), 0, obW - 1), j0 = clamp(Math.floor(Math.min(a.y, b.y) / OBG), 0, obH - 1), j1 = clamp(Math.floor(Math.max(a.y, b.y) / OBG), 0, obH - 1);
      const st = ++obStamp;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const r of obGrid[j * obW + i]) { if (r._st === st) continue; r._st = st; if (r.hp > 0 && segIntersectsRect(a, b, r)) return true; }
      return false;
    }
    const moveBlocked = (a, b) => blocks.some((r) => segIntersectsRect(a, b, r)) || segHitsObstacle(a, b);
    let navCache = new Map();                                                         // 目標の格子→距離場（ターンごとに作り直す）
    function navField(goal) {
      let g = cellOf(goal);
      if (navBlocked[g]) { let best = -1, bd = Infinity; for (let c = 0; c < GW * GH; c++) { if (navBlocked[c]) continue; const p = cellPt(c), d = Math.hypot(p.x - goal.x, p.y - goal.y); if (d < bd) { bd = d; best = c; } } g = best; }
      if (navCache.has(g)) return navCache.get(g);
      const D2 = new Float32Array(GW * GH).fill(Infinity), q = [g]; D2[g] = 0;
      for (let h = 0; h < q.length; h++) {
        const c = q[h], ci = c % GW, cj = (c - ci) / GW;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue; const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          const n = nj * GW + ni; if (navBlocked[n]) continue;
          if (di && dj && (navBlocked[cj * GW + ni] || navBlocked[nj * GW + ci])) continue;   // 角のすり抜けをしない
          const nd = D2[c] + (di && dj ? 1.414 : 1); if (nd < D2[n]) { D2[n] = nd; q.push(n); }
        }
      }
      navCache.set(g, D2); return D2;
    }
    function waypoint(from, to) {                                                     // 直線で行ける時はそのまま。切れている時は道沿いの見通せる一番遠い点
      if (!NAV || !moveBlocked(from, to)) return to;
      const F = navField(to); let c = cellOf(from), last = null;
      if (F[c] === Infinity) { let bd = Infinity; for (let k = 0; k < GW * GH; k++) { if (F[k] === Infinity) continue; const p = cellPt(k), d = Math.hypot(p.x - from.x, p.y - from.y); if (d < bd) { bd = d; c = k; } } return cellPt(c); }
      for (let s = 0; s < 80; s++) {
        const ci = c % GW, cj = (c - ci) / GW; let nb = c;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue; const n = nj * GW + ni; if (F[n] < F[nb]) nb = n; }
        if (nb === c) break; c = nb;
        const p = cellPt(c); if (!moveBlocked(from, p)) last = p; else if (last) break;
      }
      return last || cellPt(c);
    }
    function pathDist(from, to) { if (!NAV || !moveBlocked(from, to)) return dist(from, to); const F = navField(to), v = F[cellOf(from)]; return v === Infinity ? dist(from, to) : v * NC; }
    const TIDE_T = { tidal: [T.wetsand, T.shallows, T.flood], tidepool: [T.shallows, T.flood, T.flood] };   // 潮の高さ（0 引き・1 満ちかけ・2 満ち）で変わる地形
    let zoneB = null; const ZB = 8;                                                   // ギミックの戦場は地形が多いので 8単位の升ごとに重なる地形を持つ（順番は保つ＝結果は同じ）
    function buildZoneB() {
      if (!GM) return; const bw = Math.ceil(field.w / ZB) + 1, bh = Math.ceil(field.h / ZB) + 1, b = Array.from({ length: bw * bh }, () => []);
      for (const z of zones) for (let j = Math.max(0, Math.floor(z.y / ZB)); j <= Math.min(bh - 1, Math.floor((z.y + z.h) / ZB)); j++) for (let i = Math.max(0, Math.floor(z.x / ZB)); i <= Math.min(bw - 1, Math.floor((z.x + z.w) / ZB)); i++) b[j * bw + i].push(z);
      zoneB = { bw, bh, b };
    }
    buildZoneB();
    const zonesAt = (p) => (zoneB ? zoneB.b[clamp(Math.floor(p.y / ZB), 0, zoneB.bh - 1) * zoneB.bw + clamp(Math.floor(p.x / ZB), 0, zoneB.bw - 1)] : zones);
    function terrainAt(p) { for (const z of zonesAt(p)) if (ptInRect(p, z)) return TIDE_T[z.t] ? TIDE_T[z.t][gim.tide] : T[z.t]; return baseTerrain; }
    // ===== 戦場のギミック（[[v2ゲーム設計]] v2.more）：時間で変わる戦場。予告と周期は目に見える＝AI もそれを見て動く =====
    const grng = GM ? SCS.makeRNG((seed ^ 0x6d2b79f5) >>> 0) : null;                // ギミックの乱数（戦いの乱数と分ける）
    const TIDE_COST = (GM && GM.cost) || { tidal: [0, 2.5, 6], tidepool: [1.2, 6, 6] };   // 水に浸かる所にいる損（足が鈍り、避けにくい）
    const tideAt = (t) => (GM && GM.kind === "tide" && t > 0 ? GM.cycle[(t - 1) % GM.cycle.length] : 0);
    function springAt(t) { if (!GM || GM.kind !== "spring") return "idle"; const ph = t - GM.first; if (ph < 0) return "idle"; const k = ph % GM.period; return k === 0 ? "warn" : k <= GM.surge ? "surge" : "idle"; }
    const inSpring = (p) => Math.hypot(p.x - GM.x, p.y - GM.y) <= GM.r;
    function tideKind(p) { for (const z of zonesAt(p)) if (ptInRect(p, z)) return TIDE_T[z.t] ? z.t : null; return null; }
    const ventDmg = () => GM.dmg + GM.burn.dmg * GM.burn.turns;
    const cautionOf = (u) => clamp(0.55 + (1 - u.micros.C2) * 0.5 + u.micros.C1 * 0.3 + u.micros.D5 * 0.25, 0.4, 1.6);   // 戦場の危険を避ける度合い（安全第一・早く退く・環境を読む性格ほど強い）
    function gimCost(u, p, k) {                                                       // k ターン先にそこにいる時の、戦場から受ける損（＋）と得（−）
      const t = turn + k;
      if (GM.kind === "erupt") { if (k !== 0) return 0; let d = 0; for (const v of gim.vents) if (v.at === t && Math.hypot(p.x - v.x, p.y - v.y) <= v.r + 0.8) d += ventDmg(); return d * cautionOf(u); }
      if (GM.kind === "tide") { const z = tideKind(p); return z ? TIDE_COST[z][tideAt(t)] * cautionOf(u) : 0; }
      if (GM.kind === "spring") { if (springAt(t) !== "surge" || !inSpring(p)) return 0; const f = clamp(u.hp / u.maxHp, 0, 1); const w = GM.want || [0.8, 2.2, 0.8]; return -Math.min(GM.heal, Math.max(0, u.maxHp - u.hp)) * (w[0] + (1 - f) * w[1] + u.micros.D5 * w[2]); }   // 傷が深いほど・環境を読む性格ほど泉を目指す
      return 0;
    }
    const gimK = (u, p, k) => (GM ? gimCost(u, p, k) : 0);
    const TIDE_LINE = ["潮が引き、干潟が姿を現す。", "潮が満ちはじめる——足元に水が寄せてくる。", "潮が満ちきった。干潟は膝まで水の中。"];
    function gimStart(out) {                                                          // ターンの始め：潮の高さ・泉の様子
      if (GM.kind === "tide") { const lv = tideAt(turn); if (lv !== gim.tide) out.push({ text: `── ${lv === 1 && gim.tide === 2 ? "潮が引きはじめる。" : TIDE_LINE[lv]}`, cls: "cm" }); gim.tide = lv; }
      if (GM.kind === "spring") { const sp = springAt(turn); if (sp !== gim.spring) { if (sp === "warn") out.push({ text: "── 泉が淡く光りはじめる。", cls: "cm" }); else if (sp === "surge") out.push({ text: "── 泉が湧き上がる！", cls: "cm" }); } gim.spring = sp; }
    }
    function wallNear(p, reach) { let best = null, bd = reach; for (const o of obstacles) { if (o.hp <= 0) continue; const qx = clamp(p.x, o.x, o.x + o.w), qy = clamp(p.y, o.y, o.y + o.h), d = Math.hypot(qx - p.x, qy - p.y); if (d < bd) { bd = d; best = o; } } return best; }
    function crumbleWalls(evs, events, out) {                                         // 外れ弾は狙われた駒のそばの壁を削る（必殺の外れは大きく）・叩きつけも削る
      for (const ev of evs) {
        if (!ev.def || !(ev.shots > 0)) continue;
        const rn = ev.ult ? ev.ultRn : (ev.attack === "RANGED" || ev.attack === "SNAP"); if (!rn) continue;
        const miss = ev.ult ? (ev.whiff ? 2 : 0) : ev.shots - (ev.hits || 0); if (miss <= 0) continue;
        const w = wallNear(ev.def, GM.reach); if (w) w.hp -= miss * ev.att.ranged.damage * GM.missK;
      }
      for (const u of ALL) { if (u._slam) { const w = u.alive ? wallNear(u, 1.6) : null; if (w) w.hp -= GM.slam; u._slam = false; } }
      let fell = 0;
      for (const o of obstacles) if (o.hp0 && o.hp <= 0 && !o.fell) {
        o.fell = true; o.hp = 0; fell++;
        zones.push({ x: o.x - 0.4, y: o.y - 0.4, w: o.w + 0.8, h: o.h + 0.8, t: "rubble" });   // 崩れた所は瓦礫（足が遅く、身を守れる）
        events.push({ type: "collapse", x: o.x, y: o.y, w: o.w, h: o.h });
      }
      if (fell) { buildZoneB(); if (NAV) { buildNav(); navCache = new Map(); } out.push({ text: `── 撃ち込まれた壁が${fell > 1 ? "次々と" : ""}崩れ落ち、射線が開く。`, cls: "cm" }); }
    }
    function erupt(events, out) {                                                     // 予告した所が噴く：中にいる駒は焼かれ、跡はしばらく燃える
      let dmg = 0, n = 0; const hit = [];
      for (const v of gim.vents) {
        if (v.at !== turn) continue;
        events.push({ type: "erupt", x: v.x, y: v.y, r: v.r }); n++;
        for (const u of ALL) { if (!u.alive || Math.hypot(u.x - v.x, u.y - v.y) > v.r) continue; u.hp = Math.max(0, u.hp - GM.dmg); addStatus(u, GM.burn); dmg += GM.dmg; u._erupted = turn; hit.push(u.name); events.push({ type: "hazard", dTeam: u.team, dIdx: u.idx, dmg: GM.dmg }); }
        hazards.push({ x: cx(v.x - 3), y: cy(v.y - 3), w: 6, h: 6, turns: 2, dmg: 5 });
      }
      if (n) out.push({ text: `── 溶岩が${n > 1 ? `${n}か所で` : ""}噴き上がる！${hit.length ? `${hit.join("・")} が炎に巻かれる。` : "間一髪、誰も巻き込まれない。"}`, cls: "cm" });
      gim.vents = gim.vents.filter((v) => v.at !== turn);
      return dmg;
    }
    function scheduleVents(out) {                                                     // 次のターンに噴く所を予告する（駒の近くほど選ばれやすい）
      const t1 = turn + 1; if (t1 < GM.first || (t1 - GM.first) % GM.every !== 0) return;
      const live = ALL.filter((u) => u.alive), pool = GM.vents.map((p) => ({ p, w: 1 + live.filter((u) => Math.hypot(u.x - p.x, u.y - p.y) < 16).length * 2.5 }));
      for (let n = 0; n < GM.n && pool.length; n++) {
        let tot = 0; for (const q of pool) tot += q.w; let r = grng.next() * tot, k = 0;
        for (; k < pool.length - 1; k++) { r -= pool[k].w; if (r <= 0) break; }
        const q = pool.splice(k, 1)[0]; gim.vents.push({ x: q.p.x, y: q.p.y, r: GM.r, at: t1 });
      }
      out.push({ text: "── 足元の岩が赤く光りはじめる——噴き上がる前触れだ。", cls: "cm" });
    }
    function springHeal(events, out) {                                                // 湧いている泉の中の駒は傷が癒える
      const healed = [];
      for (const u of ALL) { if (!u.alive || !inSpring(u)) continue; const h = Math.min(GM.heal, u.maxHp - u.hp); if (h <= 0) continue; u.hp += h; healed.push(u.name); events.push({ type: "heal", dTeam: u.team, dIdx: u.idx, amount: Math.round(h) }); }
      if (healed.length) out.push({ text: `　　＊泉の水が ${healed.join("・")} の傷を癒やす。`, cls: "dim" });
    }
    const terrainDmg = (p) => terrainAt(p).dmg || 0;
    const losClear = (a, b) => !segHitsObstacle(a, b);
    function hazardAt(p) { let d = 0; for (const h of hazards) if (h.turns > 0 && ptInRect(p, h)) d += h.dmg; return d; }
    function nearestObstacle(p) { let best = null, bd = Infinity; for (const r of obstacles) { if (r.hp <= 0) continue; const ox = r.x + r.w / 2, oy = r.y + r.h / 2, d = Math.hypot(ox - p.x, oy - p.y); if (d < bd) { bd = d; best = { x: ox, y: oy }; } } return best; }
    const cornered = (u) => Math.min(u.x, field.w - u.x, u.y, field.h - u.y) < 7;

    const vulnOf = (u) => 1 + u.statuses.reduce((a, s) => Math.max(a, s.type === "weaken" ? s.amt : 0), 0);
    const slowOf = (u) => u.statuses.reduce((a, s) => Math.min(a, s.type === "slow" ? s.mult : 1), 1);
    const outFac = (u) => (0.7 + 0.3 * clamp(u.stamina, 0, 1)) * (1 + clamp(u.momentum, -1, 1) * 0.07) * (u.flinch > 0 ? 0.7 : 1);
    function dmgMod() { let m = mod.dmgMul || 1; if (mod.sudden && turn >= 12) m *= 1 + (turn - 12) * 0.07; return m; }
    const stepLen = (u, p) => S.baseStep * (0.6 + 0.8 * u.micros.B5) * terrainAt(p).move * slowOf(u) * (0.78 + 0.22 * clamp(u.stamina, 0, 1)) * (SUP && u.supp ? 1 - SUP.move * u.supp : 1);
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
      if (los) { const rf = d <= atk.ranged.effRange ? 1 : Math.max(0, 1 - (d - atk.ranged.effRange) / atk.ranged.falloff); dmg += atk.ranged.fireRate * atk.ranged.accuracy * rf * (1 - Math.min(0.7, def.micros.B3 * 0.4)) * atk.ranged.damage * suppAcc(atk); }
      if (d <= atk.melee.reach) dmg += atk.melee.rate * 0.9 * (1 - Math.min(0.6, def.micros.B3 * 0.4) * 0.7) * atk.melee.damage;
      return dmg;
    }
    function expEx(atk, def, atkPos, defPos, d, los) {
      let dmg = 0;
      if (los) dmg += atk.ranged.fireRate * rangedHit(atk.ranged, atkPos, defPos, def, d, los, false) * atk.ranged.damage * defMult(defPos) * suppAcc(atk);
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
      u.name = team === "P" ? ((namesP && namesP[idx]) || `戦士${idx + 1}`) : ((namesC && namesC[idx]) || `敵${idx + 1}`); // 自軍=命名可（UI側でサニタイズ済のみ渡る）。敵軍は既定=敵N・namesC指定時のみ命名可（系譜モード＝両陣営とも個体群の一員で「敵」ではない）。
      const left = team === "P", baseX = left ? Math.max(10, arena.start.p.x) : Math.min(field.w - 10, arena.start.c.x);
      const y = field.h * (idx + 1) / (n + 1);
      const presence = basePresence(u), hold = holdFactor(u), tank = tankRating(u), coop = coopRating(u); // タンク度＝目立つ×持ちこたえる／協調性＝チームプレイ度
      Object.assign(u, { team, idx, alive: true, target: null, x: baseX, y: cy(y), faceX: left ? 1 : -1, faceY: 0, idleTurns: 0, label: "待機", guarding: false, peeling: false, engage: "poke", presence, hold, tank, coop, form: team === "P" ? formP : formC, _opened: null, _focusCount: 0, _wardRef: null,
        ammo: u.ranged.mag, reloadLeft: 0, charged: false, spread: 0, statuses: [], stun: 0, stamina: 1, momentum: 0, resolve: 0, flinch: 0, _ultHold: 0, _closing: false,
        st: { dealt: 0, taken: 0, kills: 0, shots: 0, hits: 0, crits: 0, ults: 0, flanks: 0, downTurn: 0, dodges: 0, counters: 0, grabs: 0, grabHits: 0, wasFlanked: 0, winded: 0, resPeak: 0 } });
      const cu = COND && COND[team] && COND[team].units && COND[team].units[idx];                 // 連戦の疲労・士気（v2.s4.cond.fat/mor）
      u.fat = cu ? clamp(cu.fat || 0, 0, 1) : 0; u.mor = cu ? clamp(cu.mor || 0, -1, 1) : 0;
      if (cu) { u.stamina = 1 - 0.55 * u.fat; u.momentum = 0.6 * u.mor; u.resolve = Math.max(0, 0.35 * u.mor); }
      return u;
    }
    const P = teamPChoices.map((c, i) => mkUnit(c, "P", i, teamPChoices.length));
    const C = teamCChoices.map((c, i) => mkUnit(c, "C", i, teamCChoices.length));
    const ALL = P.concat(C);
    // 指揮（v2.s4.cond.cmd）：隊長と信頼。隊長が生きている間、ほかの駒は信頼が厚いほど隊形と狙いがそろう（薄いとばらける）。cond が無ければ 0
    const LEAD = { P: null, C: null };
    for (const tm of ["P", "C"]) { const c = COND && COND[tm], arr = tm === "P" ? P : C; if (c && Number.isInteger(c.lead) && arr[c.lead]) LEAD[tm] = { u: arr[c.lead], trust: clamp(c.trust == null ? 0.6 : c.trust, 0, 1), fell: false }; }
    const leadK = (u) => { const L = LEAD[u.team]; return L && L.u.alive && L.u !== u ? (L.trust - 0.5) * 0.5 : 0; };
    for (const u of ALL) { u.supp = 0; u._supIn = 0; }                                 // 制圧（次のターンに効く値）と、このターンに受けた分
    const enemiesOf = (u) => (u.team === "P" ? C : P);
    const alliesOf = (u) => (u.team === "P" ? P : C);
    for (const u of ALL) { u.winDist = winDistVsTeam(u, enemiesOf(u)); } // 敵全体に対する勝てる間合い＝ロール判定が編成順でブレない
    // 役割で前後に配置：近接寄り(winDist小)は前線へ・遠距離寄り(winDist大)は後方へ＝後衛(射手)が前衛に守られる編成が成立
    for (const u of ALL) { const fwd = clamp((42 - u.winDist) / 42, -1, 1) * 16; const q = pushOutObstacle(cx(u.x + (u.team === "P" ? fwd : -fwd)), u.y); u.y = q.y; u.x = q.x; }
    if (FORM2) for (const team of [P, C]) {                                            // 隊形どおりに並べて始める（散開は今まで通り広く散る）
      const fk = team[0] && team[0].form; if (!fk) continue;
      if (fk === "loose") { if (team === P && ORDER_P) rankedOf(team).forEach((u, rank) => { const q = pushOutObstacle(u.x, cy(field.h * (rank + 1) / (team.length + 1))); u.x = q.x; u.y = q.y; }); continue; } // 散開：配置した順に上・中・下
      const left = team === P, sx = left ? arena.start.p.x : arena.start.c.x, sy = left ? arena.start.p.y : arena.start.c.y, fwd = left ? 1 : -1, n = team.length;
      const ranked = rankedOf(team);
      ranked.forEach((u, rank) => { const off = formSlot(fk, rank, n); if (!off) return; const q = pushOutObstacle(cx(sx + off.fx * 12 * fwd), cy(sy + off.fy * 12)); u.x = q.x; u.y = q.y; });
    }

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
      let best = null, bv = -Infinity, bestPeel = false, bestParts = null;
      for (const e of live) {
        const d = dist(u, e), fl = flankOf(u, e);
        const parts = { near: -d / maxDist * 1.0 }; let v = parts.near;                   // 考えの札（v2.s4.think）用：項目ごとの寄与                                   // 近いほど良い
        v += (parts.low = (1 - e.hp / e.maxHp) * (0.55 + u.micros.A6 * 0.9));       // 仕留め（非情ほど低HP優先）
        v += (parts.los = losClear(u, e) ? 0.3 : -0.25);                            // 撃てるか
        v += (parts.flank = fl.tier === "rear" ? 0.55 : fl.tier === "side" ? 0.22 : 0); // 側背面の取りやすさ
        // ★脅威優先：敵の出力(DPS見込み)が高い＝危険な敵キャリーを先に落とす（相手読みD1で評価）
        const eThreat = expEx0(e, u, d, true);
        v += (parts.threat = clamp(eThreat / 32, 0, 1) * (0.3 + u.micros.D1 * 0.35));
        // ★集中砲火：味方が既に狙う敵に束ねる（規律B4/順応D2で連携↑）＝キルオーダー収束
        const focus = alliesOf(u).filter((a) => a.alive && a !== u && a.target === e).length;
        v += (parts.focus = Math.min(focus, 2) * (0.2 + u.micros.B4 * 0.28 + u.micros.D2 * 0.22) * (0.45 + 0.55 * u.coop)); // 集中砲火＝協調性が低い一匹狼は味方の狙いに合わせない（我流）
        // ★連携アシスト（高coop＝味方思い）：味方が直前に崩した敵（_opened＝側背/投げ/大打）を逃さず突く＝集中の質↑。一匹狼はこれを重視しない。
        { const L = LEAD[u.team]; if (L && L.u !== u && L.u.alive && L.u.target === e) v += (parts.lead = 0.35 * L.trust * (0.4 + 0.6 * u.coop)); }   // 隊長と同じ的を狙う（v2.s4.cond.cmd）
        if (e._opened != null && turn - e._opened <= 1) v += (parts.opened = u.coop * (0.9 + u.micros.A2 * 0.3));
        // ★一匹狼（低coop＝我流・利己）：味方の連携でなく、手柄になる手負い/孤立の獲物を単騎で追う。
        v += (parts.lone = (1 - u.coop) * (clamp(isolationOf(e) / 40, 0, 1) * 0.45 + (1 - e.hp / e.maxHp) * 0.4));
        // ★ヘイト（脅威吸引）：タンク度の高い敵（目立つ×持ちこたえる）に火力が吸われる＝デコイ・タンク成立。
        //   A3近接傾倒で釣られやすく・D1相手読みで釣られにくい（脅威eThreatが主・tankは従）。脆い体はtankが低く吸引も弱い＝早死にしない
        v += (parts.tank = clamp((e.tank || 0) - 0.2, 0, 1.0) * (1.5 + u.micros.A3 * 0.4 - u.micros.D1 * 0.3)); // 床0.2＝タンク度の低い脆い体は吸引が立たない
        // ★各個撃破：味方から孤立した敵ほど狙う（囲んで飲みやすい・剝がされにくい）。順応D2/規律B4の連携で強まる
        v += (parts.iso = clamp(isolationOf(e) / 35, 0, 1) * (0.7 + u.micros.D2 * 0.5 + u.micros.B4 * 0.3));
        // ★釣り出し耐性：その敵を追うと【他の】敵の脅威下に晒される＝罠なら見送る（標的自身は除外して二重計上を防ぐ）
        const chaseThreat = threatAt(u, { x: e.x, y: e.y }, e);
        v -= (parts.trap = clamp(chaseThreat / 55, 0, 1) * (0.2 + u.micros.D1 * 0.3 + (1 - u.micros.C2) * 0.3));
        // ★迎撃：守る後衛に張り付いた敵を最優先で狙う＝前衛が戦線を離れず割り込める（誇りC6で死守）
        if (myWard && e === myWard.foe) v += (parts.ward = 1.2 + u.micros.C6 * 0.5);
        // ★タウント：味方をかばって割り込んでいる敵前衛は『邪魔』＝優先して狙う（前ターンのguardingフラグ）
        if (e.guarding) v += (parts.taunt = 0.3 + u.micros.A2 * 0.2);
        // ★ピール：サポート資質は後衛味方に近接で張り付いた敵を最優先で剝がしに行く
        let peel = false;
        if (iAmSupport) { for (const a of alliesOf(u)) { if (a.alive && a !== u && isBackline(a) && dist(e, a) <= imminentBand(e)) { peel = true; break; } } }
        if (peel) v += (parts.peel = 0.6 + u.micros.D1 * 0.4);
        if (u.target === e && e.alive) v += (parts.stick = 0.4 + u.micros.B4 * 0.3); // ヒステリシス（規律）＝狙いを定めた的を無駄に変えない
        if (v > bv) { bv = v; best = e; bestPeel = peel; bestParts = parts; }
      }
      u.peeling = bestPeel; // ラベル用（_focusCount は step でターゲット確定後に一括集計＝リングと同基準）
      u._aim = best ? { e: best, parts: bestParts, n: live.length } : null;
      return best;
    }

    // ===== 移動・脅威・セパレーション =====
    function applyMove(u, fp, move) {
      const st = stepLen(u, u), dx = fp.x - u.x, dy = fp.y - u.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      let nx = u.x, ny = u.y;
      if (move === "ADVANCE" && NAV) { const wp = waypoint(u, fp), wx = wp.x - u.x, wy = wp.y - u.y, wl = Math.hypot(wx, wy) || 1, sp = u._closing ? 1.25 : 1, k = Math.min(st * sp, wl); nx += (wx / wl) * k; ny += (wy / wl) * k; } // 回り道（§16）
      else if (move === "ADVANCE") { const sp = u._closing ? 1.25 : 1; nx += ux * st * sp; ny += uy * st * sp; } // 突撃時は接近速度UP（被弾時間短縮）＝遠距離型を割る
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
    // ===== v2：戦いの間ずっと保とうとする隊形（[[分隊戦設計]]§17・FORM2 の時だけ）=====
    // 隊形の位置＝味方の重心から、部隊の向き（見えている敵の重心、いなければ相手の陣の方）に合わせて回した相対位置
    function teamFace(tm) {
      const ks = []; for (const [e] of known[tm]) if (e.alive) ks.push(e);
      if (ks.length) return cen(ks);
      return tm === "P" ? { x: arena.start.c.x, y: arena.start.c.y } : { x: arena.start.p.x, y: arena.start.p.y };
    }
    // 隊形の中の順（位置）：プレーヤーが配置した順（opts.orderP・あなたの部隊だけ）、無ければ間合いの短い順＝近接が前
    function rankedOf(units) { const tm = units[0] && units[0].team; if (tm === "P" && ORDER_P) return ORDER_P.map((i) => units.find((u) => u.idx === i)).filter(Boolean); return units.slice().sort((p, q) => p.winDist - q.winDist); }
    function formSlot2(u) {
      if (!u.form || u.form === "loose") return null;
      const al = alliesOf(u).filter((a) => a.alive), n = al.length; if (n <= 1) return null;
      const rank = rankedOf(al).indexOf(u), off = formSlot(u.form, rank, n); if (!off) return null;
      const g = cen(al), f = teamFace(u.team); let fx = f.x - g.x, fy = f.y - g.y; const l = Math.hypot(fx, fy) || 1; fx /= l; fy /= l;
      const SP = 12;
      return { x: cx(g.x + fx * off.fx * SP - fy * off.fy * SP), y: cy(g.y + fy * off.fx * SP + fx * off.fy * SP), g };
    }
    // 隊形を保つ力（性格）：規律・忍耐・協調で保ち、攻め急ぐほど崩す
    const holdOf = (u) => clamp((0.2 + u.micros.B4 * 0.5 + Math.max(0, u.mv[3]) * 0.35 + u.coop * 0.3 + leadK(u)) * (1.15 - 0.6 * u.micros.A2), 0, 1.1);

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
        if (FORM2) {                                                                    // 隊形を組んだまま索敵する（遅れた・出すぎた駒は、保つ力が強いほど隊形の位置へ戻る）
          const sl = formSlot2(u);
          if (sl) { const h = holdOf(u); if (h > 0.45 && dist(u, sl) > 10) sp = { x: sl.x, y: sl.y }; else { sp = { x: sp.x + (sl.x - sl.g.x) * h, y: sp.y + (sl.y - sl.g.y) * h }; } }
        }
        if (Math.hypot(sp.x - u.x, sp.y - u.y) < 6) return { move: "HOLD", attack: "NONE", newPos: { x: u.x, y: u.y }, target: null, searchDir: sp }; // 索敵地点に到達＝その場で警戒
        const np = applyMove(u, sp, "ADVANCE");
        return { move: "ADVANCE", attack: "NONE", newPos: np, target: null, searchDir: sp };
      }
      const c = prepDecide(u, tgt), fp = c.fp;
      let best = null;
      for (const mv of MOVES) {
        const np = applyMove(u, fp, mv), d2 = dist(np, fp), los2 = losClear(np, fp);
        const atk = chooseAttack(u, tgt, np, d2, los2);
        const v = utilAt(u, tgt, c, np, d2, los2, atk, mv !== "HOLD") + (mv === "HOLD" ? 0.2 : 0);
        if (!best || v > best.v) best = { v, move: mv, attack: atk.attack, ultKind: atk.ultKind, newPos: np, d2, los2 };
      }
      return finishDecide(u, tgt, c, best);
    }
    // 判断の準備：攻め/守りの重み・交戦状態・割り込み（かばう）・隊形（v2 の頭も v3 の頭も使う）
    function prepDecide(u, tgt) {
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
      if (FORM2) { formSlotPos = formSlot2(u); if (formSlotPos) { const h = holdOf(u), reach = Math.max(u.melee.reach, u.ranged.effRange), urg = clamp(1 - (dist(u, fp) - reach) / 45, 0, 1); formW = h * FORM2_W * (1 - urg * (1 - h * 0.7)) * clamp(1 - Math.max(0, (u.idleTurns || 0) - 2) / 5, 0, 1); } } // 戦闘中も、保つ力が強い駒ほど隊形を捨てない。撃てないまま手が止まったら崩して動く
      else if (u.form && u.form !== "loose") {
        formSlotPos = formSlotWorld(u);
        if (formSlotPos) {
          const holdAbility = clamp(0.2 + u.micros.B4 * 0.5 + Math.max(0, u.mv[3]) * 0.35 + u.coop * 0.3 + leadK(u), 0, 1.1); // 一匹狼/気まぐれは守らない（隊長への信頼で上下）
          const reach = Math.max(u.melee.reach, u.ranged.effRange);
          const urgency = clamp(1 - (dist(u, fp) - reach) / 45, 0, 1);                          // 交戦圏に近いほど隊形より戦闘
          formW = holdAbility * (1 - urgency) * 0.10;                                            // ★ごく小さい＝接近フェーズに見える緩い癖。戦闘判断が常に上回る＝支配しない・罠にしない
        }
      }
      return { fp, pref, wAtk, wDef, regroupTo, ward, interpose, guardScale, holdInterDist, formSlotPos, formW };
    }
    // ある位置 np に立った時の見込み（1ターン分）。moving＝そのターン動いている（移動射撃は当たりにくい）
    function utilAt(u, tgt, c, np, d2, los2, atk, moving) {
      const fp = c.fp, pref = c.pref, interpose = c.interpose, regroupTo = c.regroupTo, formSlotPos = c.formSlotPos, formW = c.formW;
        let offense = expEx(u, tgt, np, fp, d2, los2);
        if (moving && los2 && atk.attack === "RANGED") offense *= u.ranged.moveAccuracy; // 移動射撃は命中が落ちる＝据え置いて撃つ価値を評価に反映
        const threat = threatAt(u, np);
        const rangeFit = -(Math.abs((NAV && pref < 20 ? pathDist(np, fp) : d2) - pref) / maxDist) * 22; // 近接寄りは回り道の距離で（§16）
        const fl = flankOf(np, tgt), flankTerm = (fl.tier === "rear" ? 9 : fl.tier === "side" ? 3.5 : 0);
        const sep = sepPenalty(u, np), hz = hazardAt(np) + terrainDmg(np) * 1.5 + gimK(u, np, 0);
        const interceptTerm = interpose ? -Math.hypot(np.x - interpose.x, np.y - interpose.y) * c.guardScale : 0; // 割り込み位置に近いほど良い（実距離）
        const regroupTerm = regroupTo ? -Math.hypot(np.x - regroupTo.x, np.y - regroupTo.y) * 0.12 : 0; // 撤退時＝味方へ寄る再集結
        const formTerm = formSlotPos ? (FORM2 ? -dist(np, formSlotPos) * formW : -(dist(np, formSlotPos) / maxDist) * 22 * formW) : 0; // 隊形スロットへ寄る（v2 は距離そのもので効かせる）
        return offense * c.wAtk - threat * c.wDef + rangeFit + flankTerm - sep - hz * 1.2 + interceptTerm + regroupTerm + formTerm;
    }
    // 個体テクスチャ（回避・崩し）と、かばう表示の確定（v2 の頭も v3 の頭も使う）
    function finishDecide(u, tgt, c, best) {
      const fp = c.fp, wAtk = c.wAtk, wDef = c.wDef, interpose = c.interpose, ward = c.ward, holdInterDist = c.holdInterDist;
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
          const vD = -incoming * (1 - evd) * wDef + counterEV - sepPenalty(u, dp) - (hazardAt(dp) + terrainDmg(dp) * 1.5 + gimK(u, dp, 0)) * 1.2 - (1 - u.stamina) * 3;
          if (vD > best.v + 3) best = { v: vD, move: "HOLD", attack: "DODGE", newPos: dp, d2: d2d, los2: los2d }; // 攻撃よりはっきり得な時だけ見切る＝稀
        }
      }
      // 崩し（投げ）：盾/受け型に受け不能の投げ＝固い相手を割る手段（チーム戦の核＝盾と噛み合う）。盾でない相手には基本選ばない。
      if (grabReachOK(u, fp) && u.stamina > 0.3 && (tgt.tank || 0) > 0.35) {
        const gp = applyMove(u, fp, "ADVANCE"), d2g = dist(gp, fp);
        if (d2g <= u.melee.reach + 3) {
          const want = 0.6 + u.micros.A2 * 0.3 + u.micros.A6 * 0.3 + u.micros.D4 * 0.2;            // 崩しを好む性格（攻め/非情/狡猾）
          const offG = grabDamage(u) * (0.5 + clamp((tgt.tank || 0) * 1.1, 0, 1.1));               // 受け不能＝盾ほど刺さる
          const vG = offG * wAtk * want - threatAt(u, gp) * wDef - sepPenalty(u, gp) - (hazardAt(gp) + terrainDmg(gp) * 1.5 + gimK(u, gp, 0)) * 1.2;
          if (vG > best.v) best = { v: vG, move: "ADVANCE", attack: "GRAB", newPos: gp, d2: d2g, los2: true };
        }
      }
      // 実際に割り込み位置へ寄った時だけ guarding（ラベルの誤表示を防ぐ＝据え置き/自target攻撃なら かばう表示しない）
      u.guarding = !!interpose && Math.hypot(best.newPos.x - interpose.x, best.newPos.y - interpose.y) < holdInterDist - 0.5;
      u._wardRef = u.guarding && ward ? ward.ward : null; // ボディブロックの守る相手
      best.target = tgt;
      return best;
    }


    // ===== 思考エンジン v3 段1：どこに立つか（[[AI思考エンジン設計]] ai3.s1.*）=====
    //   6通りの一歩でなく、歩いて数ターン以内の候補地（輪・目標の周りの弧・遮蔽の縁）を道のり込みで比べ、
    //   「着くまでの道中」と「着いてから」の見込みを足して目的地を選ぶ。目的地はしばらく保つ（規律で長く）。
    //   思考の深さ（何ターン先まで）と広さ（候補の数）は性格の cog から＝冷静・規律・順応ほど深く、好奇心ほど広く。
    const V3C = Object.assign({ cover: 0.81, peek: 1.04, flank: 1.092, noise: 1.502, terrain: 1.204, kite: 0.986, hmax: 4, hfix: 0, pred: 1, ptgt: 1, eng: 1, search: 0, inst: 0.5, shoot: 1, blur: 5, atk: 1, def: 0.838, gamma: 0.818, stick: 1, predw: 1.047, engc: 1.317, engr: 0.932, range: 1.123, sep: 0.972 }, (opts && opts.v3) || {});   // 既定値＝新旧対戦で自動調整した値（[[AI思考エンジン設計]] ai3.m.tune）
    const horizonOf = (u) => V3C.hfix || clamp(u.cog.searchDepth, 1, V3C.hmax);
    function fieldFrom(u) { return NAV ? navField({ x: u.x, y: u.y }) : null; }           // u までの道のり（格子・回り道込み）
    function pathLenFrom(F, u, p) { if (!F) return dist(u, p); const v = F[cellOf(p)]; return v === Infinity ? Infinity : v * NC; }
    // u から p への道を、1ターン分（st）ずつ進んだ位置の列に（H ターン分）
    function pathPoints(F, u, p, st, H) {
      const out = [];
      if (!F || !moveBlocked(u, p)) { const d = dist(u, p) || 1; for (let t = 1; t <= H; t++) { const k = Math.min(1, (st * t) / d); out.push({ x: u.x + (p.x - u.x) * k, y: u.y + (p.y - u.y) * k }); } return out; }
      const cells = []; let c = cellOf(p);
      for (let g = 0; g < 400; g++) {
        cells.push(c); if (F[c] <= 1.01) break;
        const ci = c % GW, cj = (c - ci) / GW; let nb = c;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue; const n = nj * GW + ni; if (F[n] < F[nb]) nb = n; }
        if (nb === c) break; c = nb;
      }
      cells.reverse();
      const pts = [{ x: u.x, y: u.y }].concat(cells.map(cellPt)); pts.push({ x: p.x, y: p.y });
      let i = 0, cur = pts[0];
      for (let t = 1; t <= H; t++) {
        let need = st;
        while (need > 0 && i < pts.length - 1) { const nx = pts[i + 1], seg = dist(cur, nx); if (seg >= need) { const k = need / (seg || 1); cur = { x: cur.x + (nx.x - cur.x) * k, y: cur.y + (nx.y - cur.y) * k }; need = 0; } else { need -= seg; cur = nx; i++; } }
        out.push({ x: cur.x, y: cur.y });
      }
      return out;
    }
    // 目標がこれから向く方向（目標の狙いの方。いなければ今の向き）＝どこから寄れば側面・背後か
    function faceOf3(t) { if (t.target && t.target.alive) { const dx = t.target.x - t.x, dy = t.target.y - t.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; } return { x: t.faceX, y: t.faceY }; }
    function flankVs3(pos, t, f) { const dx = pos.x - t.x, dy = pos.y - t.y, l = Math.hypot(dx, dy) || 1, dot = (f.x * dx + f.y * dy) / l; return dot > 0.45 ? 0 : dot > -0.35 ? 1 : 2; }   // 0前 1側面 2背後
    // 候補地：その場・歩ける輪（思考の幅で方向の数・深さで何ターン分）・目標の周りの弧（好む間合い・前/斜め/横/背後）・近くの遮蔽の縁
    function candidates3(u, tgt, st, H, F, f, pref) {
      const out = [{ x: u.x, y: u.y }];
      const nDir = 8 + (u.cog.breadth - 3) * 4;                                             // 8〜16方向
      for (let k = 1; k <= H; k++) for (let i = 0; i < nDir; i++) { const a = (i / nDir) * Math.PI * 2 + k * 0.37; out.push({ x: cx(u.x + Math.cos(a) * st * k), y: cy(u.y + Math.sin(a) * st * k) }); }
      const base = Math.atan2(f.y, f.x);
      for (const off of [0, 0.6, -0.6, 1.3, -1.3, 2.2, -2.2, Math.PI]) { const a = base + off; out.push({ x: cx(tgt.x + Math.cos(a) * pref), y: cy(tgt.y + Math.sin(a) * pref) }); }
      const obs = obstacles.filter((o) => o.hp > 0).map((o) => ({ o, d: Math.hypot(o.x + o.w / 2 - u.x, o.y + o.h / 2 - u.y) })).filter((q) => q.d < st * H + 12).sort((a, b) => a.d - b.d).slice(0, 6);
      for (const { o } of obs) { const ox = o.x + o.w / 2, oy = o.y + o.h / 2, m = 2.6; for (const [qx, qy] of [[o.x - m, o.y - m], [o.x + o.w + m, o.y - m], [o.x - m, o.y + o.h + m], [o.x + o.w + m, o.y + o.h + m], [o.x - m, oy], [o.x + o.w + m, oy], [ox, o.y - m], [ox, o.y + o.h + m]]) out.push({ x: cx(qx), y: cy(qy) }); }
      const lim = st * (H + 1) + 4;
      return out.filter((p, i) => i === 0 || (!insideAny(p.x, p.y) && !(NAV && blocks.some((r) => ptInRect(p, r))) && pathLenFrom(F, u, p) <= lim));   // 0番＝その場は必ず残す
    }
    // ===== 段2：先読み（[[AI思考エンジン設計]] ai3.s2）=====
    //   見えている敵が t ターン後どこにいるか：その敵の狙いへ、好む間合いまで寄る（手負いで撤退中なら離れる）。同時に動くので、今の位置でなく動いた後の位置で見積もる
    function predictPos3(e, t) {
      if (!e.alive) return { x: e.x, y: e.y };
      const tt = e.target && e.target.alive ? e.target : null; if (!tt) return { x: e.x, y: e.y };
      const st = stepLen(e, e) * t, dx = tt.x - e.x, dy = tt.y - e.y, d = Math.hypot(dx, dy) || 1;
      let pref = prefRangeOf(e); if (e.engage === "commit") pref = Math.max(4, pref - 10); else if (e.engage === "retreat") pref = Math.min(maxDist, pref + 18);
      const want = d - pref, mvd = clamp(want, -st, st);                                    // 好む間合いへ（遠ければ寄る・近すぎれば離れる）
      return { x: cx(e.x + (dx / d) * mvd), y: cy(e.y + (dy / d) * mvd) };
    }

    // a が今ターン e に出せる見込み（交戦判断で使う）
    function reachDps3(a, e) {                                                              // a が今ターン e に出せる見込み（一歩寄れる分を見込む）
      const d = Math.max(0, dist(a, e) - stepLen(a, a)), los = losClear(a, e) || d <= a.melee.reach;
      return expEx0(a, e, d, los) * outFac(a);
    }
    function threat3(u, pos, wP) {                                                          // 今の位置と次のターンの予測位置からの脅威を、相手読みで混ぜる
      let a = 0, b = 0;
      for (const e of knownEnemies(u)) {
        const d0 = dist(pos, e); a += expEx(e, u, e, pos, d0, losClear(e, pos));
        if (wP > 0) { const q = predictPos3(e, 1), d1 = dist(pos, q); b += expEx(e, u, q, pos, d1, losClear(q, pos)); }
      }
      return wP > 0 ? a * (1 - wP) + b * wP : a;
    }
    // utilAt の v3 版（同じ項・脅威と目標は先読み込み）
    function utilAt3(u, tgt, c, np, d2, los2, atk, moving, wP) {
      const fp = c.fp, pref = c.pref, interpose = c.interpose, regroupTo = c.regroupTo, formSlotPos = c.formSlotPos, formW = c.formW;
      let offense = expEx(u, tgt, np, fp, d2, los2);
      if (V3C.ptgt && wP > 0) { const tq = predictPos3(tgt, 1), dq = dist(np, tq); offense = offense * (1 - wP) + expEx(u, tgt, np, tq, dq, losClear(np, tq)) * wP; }   // 先回り：目標が動いた先を撃つ
      if (moving && los2 && atk.attack === "RANGED") offense *= u.ranged.moveAccuracy;
      const threat = threat3(u, np, wP);
      const rangeFit = -(Math.abs((NAV && pref < 20 ? pathDist(np, fp) : d2) - pref) / maxDist) * 22 * V3C.range;
      const fl = flankOf(np, tgt), flankTerm = (fl.tier === "rear" ? 9 : fl.tier === "side" ? 3.5 : 0);
      const sep = sepPenalty(u, np) * V3C.sep, hz = hazardAt(np) + terrainDmg(np) * 1.5;
      const interceptTerm = interpose ? -Math.hypot(np.x - interpose.x, np.y - interpose.y) * c.guardScale : 0;
      const regroupTerm = regroupTo ? -Math.hypot(np.x - regroupTo.x, np.y - regroupTo.y) * 0.12 : 0;
      const formTerm = formSlotPos ? (FORM2 ? -dist(np, formSlotPos) * formW : -(dist(np, formSlotPos) / maxDist) * 22 * formW) : 0;
      return { v: offense * c.wAtk - threat * c.wDef + rangeFit + flankTerm - sep - hz * 1.2 + interceptTerm + regroupTerm + formTerm, threat };
    }

    // ===== 段3：交戦判断（v3）＝その場の撃ち合いの勝ち負けを見積もる（[[AI思考エンジン設計]]）=====
    //   近くの味方と敵それぞれの「出せる火力の合計 × 体力の合計」を比べる（ランチェスターの二乗則）。性格で見え方が歪む（強気C4は有利に見える）。
    function updateEngage3(u) {
      const R = 58, hpFrac = clamp(u.hp / u.maxHp, 0, 1), m = u.micros;
      const foes = knownEnemies(u).filter((e) => dist(u, e) < R);
      if (!foes.length) { u._eng = null; updateEngage(u); return; }                       // 交戦していない＝今までどおり
      const allies = alliesOf(u).filter((a) => a.alive && dist(u, a) < R);
      let dU = 0, hU = 0, dT = 0, hT = 0;
      for (const a of allies) { let best = 0; for (const e of foes) best = Math.max(best, reachDps3(a, e)); dU += best; hU += a.hp; }
      for (const e of foes) { let best = 0; for (const a of allies) best = Math.max(best, reachDps3(e, a)); dT += best; hT += e.hp; }
      const ratio = (dU * hU + 1) / (dT * hT + 1) * (0.8 + m.C4 * 0.4);                     // >1＝この撃ち合いは勝てる（強気ほど甘く見る）
      const tgtLow = u.target ? (1 - clamp(u.target.hp / u.target.maxHp, 0, 1)) : 0;
      let commit = Math.log(ratio) * (0.9 + m.C2 * 0.8) * V3C.engc + tgtLow * (0.3 + m.A6 * 0.4) + (u.resolve > 0.7 ? 0.3 : 0) + (1 - m.A1) * 0.15 - (1 - hpFrac) * 0.3;
      let retreat = -Math.log(ratio) * (0.6 + m.C1 * 0.8) * V3C.engr + (1 - hpFrac) * (0.4 + m.C1 * 0.8) - m.C6 * (hpFrac < 0.35 ? 1.0 : 0.4) - u.resolve * 0.2 - 0.1;
      const stick = 0.12 + m.B4 * 0.18;
      if (COND) { commit += u.mor * 0.3; retreat -= u.mor * 0.3; }                              // 連戦の士気（v2.s4.cond.mor）
      if (u.engage === "commit") commit += stick; else if (u.engage === "retreat") retreat += stick;
      if (restless(u) && (u.idleTurns || 0) >= 5) commit += (u.idleTurns - 4) * 0.3;
      u.engage = (retreat > 0.33 && retreat > commit) ? "retreat" : (commit > 0.35 ? "commit" : "poke");
      u._eng = { ratio, hpFrac, tgtLow, foes: foes.length, allies: allies.length, up: aliveCount(u.team) > aliveCount(u.team === "P" ? "C" : "P") };   // 考えの札用
    }

    // ===== 段4：見えない敵を探す（[[AI思考エンジン設計]] ai3.s4）=====
    //   チームごとの「敵がいそうな所」の地図（格子）。毎ターン広がり（敵は動く）、味方の視界に入って誰もいなかった所は消え、
    //   見えた敵・聞こえた銃声の所に積もる。見えていない時は、いそうな所のうち近い所へ探しに行く（味方と同じ所は避ける）。
    //   旧い頭の「第六感＝本当の敵の重心へ寄せる」は、相手読みD1の勘として弱めて残す。
    const belief3 = { P: null, C: null }, lastShots3 = { P: [], C: [] };   // lastShots3[tm]＝そのチームに聞こえた敵の銃声（前のターン）
    function initBelief3(tm) {
      const b = new Float32Array(GW * GH), home = tm === "P" ? arena.start.c : arena.start.p;
      for (let c = 0; c < GW * GH; c++) { if (navBlocked && navBlocked[c]) continue; const p = cellPt(c), d = Math.hypot(p.x - home.x, p.y - home.y); b[c] = Math.exp(-(d * d) / (2 * 22 * 22)); }
      return b;
    }
    function seenByTeam3(tm, c) {                                                            // その格子が今、味方のだれかの視界に入っているか
      const p = cellPt(c);
      for (const u of (tm === "P" ? P : C)) {
        if (!u.alive) continue; const dx = p.x - u.x, dy = p.y - u.y, d = Math.hypot(dx, dy) || 0.001;
        if (d > u.sightR * 0.9) continue;
        if ((u.faceX * dx + u.faceY * dy) / d < Math.cos(u.sightHalf) && d > 6) continue;   // コーンの外（ごく近くは気配で分かる）
        if (losClear(u, p)) return true;
      }
      return false;
    }
    function freeCellNear3(c) {                                                             // 塞がっていない近くの格子（壁際の敵の印が次のならしで消えないように）
      if (!navBlocked || !navBlocked[c]) return c; const ci = c % GW, cj = (c - ci) / GW;
      for (let r = 1; r <= 3; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue; const n = nj * GW + ni; if (!navBlocked[n]) return n; }
      return c;
    }
    function updateBelief3(tm, heard) {
      let b = belief3[tm]; if (!b) b = belief3[tm] = initBelief3(tm);
      // ① 広がる（敵は1ターンに一歩ぶん動ける＝7〜17単位＝格子4〜8個）：3×3 で V3C.blur 回ならす
      for (let it = 0; it < V3C.blur; it++) {
        const nb = new Float32Array(GW * GH);
        for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
          const c = j * GW + i; if (navBlocked && navBlocked[c]) continue; let s0 = 0, n0 = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue; const n = nj * GW + ni; if (navBlocked && navBlocked[n]) continue; s0 += b[n]; n0++; }
          nb[c] = n0 ? s0 / n0 : 0;
        }
        b = nb;
      }
      // ② 見えている所で誰もいなかった所は消す（見えている敵の所は残す）
      const seenEnemyCells = new Set(); for (const [e] of known[tm]) if (e.alive && known[tm].get(e).lastSeen === turn) seenEnemyCells.add(cellOf(e));
      for (let c = 0; c < GW * GH; c++) { if (b[c] < 1e-4 || seenEnemyCells.has(c)) continue; if (seenByTeam3(tm, c)) b[c] *= 0.05; }
      // ③ 見えた敵・聞こえた銃声の所に積もる
      for (const c of seenEnemyCells) b[freeCellNear3(c)] += 2;
      for (const h of heard) b[freeCellNear3(cellOf(h))] += 1.2;
      belief3[tm] = b;
    }
    function search3(u) {
      const b = belief3[u.team]; if (!b) return decide(u);
      let sp = null, seen = -1;
      for (const info of known[u.team].values()) if (info.lastSeen > seen) { seen = info.lastSeen; sp = { x: info.x, y: info.y }; } // 見失った直後は最後の位置を最優先（今までどおり）
      if (!sp || turn - seen > 1) {
        const F = fieldFrom(u), st = stepLen(u, u), others = alliesOf(u).filter((a) => a !== u && a.alive && a._search3);
        let bestC = -1, bv = -Infinity;
        for (let c = 0; c < GW * GH; c += 2) {                                               // 半分の格子だけ見る（速さのため・決定論）
          const w = b[c]; if (w < 1e-3) continue;
          const p = cellPt(c), pd = pathLenFrom(F, u, p); if (pd === Infinity) continue;
          let v = Math.log(w + 1e-4) - pd / (st * 6);                                       // いそうで、近い所
          for (const a of others) if (Math.hypot(p.x - a._search3.x, p.y - a._search3.y) < 20) v -= 0.8;   // 味方と同じ所を探さない
          if (v > bv) { bv = v; bestC = c; }
        }
        if (bestC >= 0) {
          const p = cellPt(bestC), inst = clamp(u.micros.D1 * V3C.inst, 0, 0.95), ec = cenLive(enemiesOf(u));   // 勘（相手読み）が鋭い体ほど本当の気配へ寄る
          sp = ec ? { x: p.x + (ec.x - p.x) * inst, y: p.y + (ec.y - p.y) * inst } : p;
        }
      }
      if (!sp) return decide(u);
      u._search3 = sp;
      if (FORM2) { const sl = formSlot2(u); if (sl) { const h = holdOf(u); if (h > 0.45 && dist(u, sl) > 10) sp = { x: sl.x, y: sl.y }; else sp = { x: sp.x + (sl.x - sl.g.x) * h, y: sp.y + (sl.y - sl.g.y) * h }; } }
      if (Math.hypot(sp.x - u.x, sp.y - u.y) < 6) return { move: "HOLD", attack: "NONE", newPos: { x: u.x, y: u.y }, target: null, searchDir: sp };
      const np = applyMove(u, sp, "ADVANCE");
      return { move: "ADVANCE", attack: "NONE", newPos: np, target: null, searchDir: sp };
    }
    function mindBase(u) {
      const seen = [], sensed = []; for (const [e, info] of known[u.team]) if (e.alive) (info.lastSeen === turn ? seen : sensed).push(e.team + e.idx);
      return { eng: u.engage, engI: u._eng || null, sta: u.stamina, mom: u.momentum, res: u.resolve, supp: u.supp || 0, flinch: u.flinch > 0, hpf: clamp(u.hp / u.maxHp, 0, 1), ammo: u.ammo, reload: u.reloadLeft > 0, seen, sensed, hunted: 0, fat: u.fat || 0, mor: u.mor || 0, lead: LEAD[u.team] ? (LEAD[u.team].u === u ? "self" : LEAD[u.team].u.alive ? "alive" : "fell") : null };
    }
    function mindSearch(u, d0) {
      let age = -1; for (const info of known[u.team].values()) age = Math.max(age, turn - info.lastSeen);
      return Object.assign(mindBase(u), { search: true, dir: d0.searchDir ? { x: d0.searchDir.x, y: d0.searchDir.y } : null, age, move: d0.move, atk: d0.attack });
    }
    function decide3(u) {
      const tgt = u.target;
      if (!tgt) { const d0 = V3C.search ? search3(u) : decide(u); d0.mind = mindSearch(u, d0); return d0; }   // 見えている敵がいない＝探す（段4）
      const c = prepDecide(u, tgt), fp = c.fp, m = u.micros, H = horizonOf(u), st = stepLen(u, u), stClose = u._closing ? st * 1.25 : st;
      c.wAtk *= V3C.atk; c.wDef *= V3C.def;                                                   // 全体の倍率（調整用・性格の重みの上に乗る）
      if (SUP && u.supp) c.wDef *= 1 + u.supp * (1 - m.C5) * SUP.duck;                             // 釘付けの駒は頭を下げる（冷静さが低いほど）
      const F = fieldFrom(u), f = faceOf3(tgt);
      // 性格の重み（挙動24・非公開）：遮蔽物利用B1＝隠れと覗き撃ち／狡猾D4・相手読みD1＝回り込みの欲／カイトB2＝近接の敵から間合いを保つ／予測不能D3＝読まれにくい揺らぎ
      const wP = clamp((0.35 + m.D1 * 0.55) * V3C.predw, 0, 0.95);                          // 予測を信じる度合い（相手読み）
      const shooter = V3C.shoot ? clamp((u.winDist - 18) / 30, 0, 1) : 1;                     // 射手ほど遮蔽を使う（近接は寄って殴るのが仕事）
      const coverW = 1 + m.B1 * 0.7 * V3C.cover * shooter, peekW = m.B1 * 5 * V3C.peek * shooter, flankW = (0.7 + m.D4 * 0.9 + m.D1 * 0.4) * V3C.flank * (SUP && tgt.supp ? 1 + SUP.flankK * tgt.supp : 1), noiseW = m.D3 * 2.5 * V3C.noise;
      const meleeFoes = knownEnemies(u).filter((e) => e.melee.reach + stepLen(e, e) * 1.2 >= dist(u, e) && (e.winDist || 99) < 30);
      const kite = u.ranged.effRange > u.melee.reach + 15 && meleeFoes.length ? m.B2 * V3C.kite : 0;
      const meleeNext = kite ? meleeFoes.map((e) => predictPos3(e, 1)) : [];                // 近接の敵が次にいそうな所
      // 援護射撃：目標へ寄っていく味方がいる時、目標を撃てる場所に「与えられる制圧」の分だけ値を足す（協調性で強く）
      const exploit = SUP ? alliesOf(u).filter((a) => a !== u && a.alive && a.target === tgt && (a.winDist < 30 || a.engage === "commit") && dist(a, tgt) < 45).length : 0;
      const pinV = exploit && u.ammo > 0 ? Math.min(2, exploit) * u.ranged.fireRate * supShot(u.ranged) * (1 - tgt.micros.C5 * SUP.c5) * SUP.pinK * (0.3 + u.coop) : 0;
      const memo = new Map(), memoT = new Map();
      const U = (pos, moving) => {
        const key = cellOf(pos) * 2 + (moving ? 1 : 0); if (memo.has(key)) return memo.get(key);
        const d2 = dist(pos, fp), los2 = losClear(pos, fp), atk = chooseAttack(u, tgt, pos, d2, los2);
        const ua = utilAt3(u, tgt, c, pos, d2, los2, atk, moving, V3C.pred ? wP : 0), thr = ua.threat;   // 脅威は動いた後の敵の位置も見込む（段2）
        memoT.set(key, thr);
        let v = ua.v;
        if (pinV && los2 && atk.attack === "RANGED") v += pinV;
        v -= thr * c.wDef * (coverW - 1 + kite * 0.6);                                       // 隠れたがる性格ほど射線に身を晒すのを嫌う
        if (los2 && atk.attack !== "NONE") { let others = 0; for (const e of knownEnemies(u)) if (e !== tgt && dist(e, pos) <= e.ranged.effRange + e.ranged.falloff && losClear(e, pos)) others++; if (!others) v += peekW; } // 覗き撃ち：目標は撃てて他からは隠れる
        const ft = flankVs3(pos, tgt, f); v += (ft === 2 ? 6 : ft === 1 ? 2.2 : 0) * flankW;  // 回り込み（目標の向きから見た側面・背後）
        if (kite) { let kd = Infinity; for (const q of meleeNext) kd = Math.min(kd, dist(pos, q)); v -= Math.max(0, 22 - kd) * kite * 0.6; }   // 近接の敵には近寄らせない
        if (terrainAt(pos) === T.forest) v += (m.D5 * 2 + m.B1 * 1.5) * V3C.terrain;          // 茂みに身を潜める
        if (terrainAt(pos) === T.highground) v += (m.D5 * 1.5 + m.B6 * 1.5) * V3C.terrain;    // 高所を取る
        memo.set(key, v); return v;
      };
      let best = null; const kinds = {};                                                      // kinds＝候補の種類ごとの最良（考えの札の「迷い」）
      for (const p of candidates3(u, tgt, st, H, F, f, c.pref)) {
        const stay = dist(u, p) < 0.5;
        const pts = stay ? [] : pathPoints(F, u, p, st, H);
        let s1 = stay ? { x: u.x, y: u.y } : pushOutObstacle(pts[0].x, pts[0].y);              // 今ターンの一歩＝道の最初の1ターン分（候補ごとに道探しをやり直さない）
        if (!stay && stClose > st) { const q = pathPoints(F, u, p, stClose, 1)[0]; if (dist(q, fp) < dist(u, fp)) s1 = pushOutObstacle(q.x, q.y); }   // 目標へ詰める一歩だけ突撃の速さ
        if (!stay && dist(s1, u) < 1) s1 = { x: u.x, y: u.y };                                  // ごく小さな動きは動かないのと同じ（命中が落ちるだけ）
        let v = U(s1, !stay) + (stay ? 0.2 : 0) - gimK(u, s1, 0) * 1.2, g = 1;
        for (let t = 2; t <= H; t++) { g *= V3C.gamma; const q = pts[t - 1] || p, arrived = dist(q, p) < 0.5, qq = arrived ? p : q; v += g * (U(qq, !arrived) - gimK(u, qq, t - 1) * 1.2); }   // 戦場のギミックは何ターン先かで見る
        if (u._plan && u._plan.tgt === tgt && u._plan.turn === turn - 1 && dist(p, u._plan) < 3) v += (1.5 + m.B4 * 4) * V3C.stick;   // 前のターンに決めた目的地はしばらく保つ（規律で長く）
        if (noiseW) v += ((hsh(turn, u.idx * 31 + (u.team === "P" ? 0 : 7), Math.round(p.x), Math.round(p.y), 17) % 1000) / 1000 - 0.5) * noiseW; // 予測不能：決定論の揺らぎ
        if (!best || v > best.v) best = { v, p, s1 };
        {                                                                                     // 候補の種類（記録の文の why3 と同じ見方）：その場／背後へ回る／側面へ回る／物陰へ／詰める／下がる／横へ
          let kd = "stay";
          if (!stay) { const farP = dist(u, p) > st * 1.2, ftP = flankVs3(p, tgt, f), t0 = memoT.get(cellOf(u) * 2), t1 = memoT.get(cellOf(s1) * 2 + 1), dd = dist(p, fp) - dist(u, fp);
            kd = farP && ftP === 2 ? "rear" : farP && ftP === 1 ? "side" : t0 != null && t1 != null && t0 > 3 && t1 < t0 * 0.6 ? "cover" : dd < -2 ? "adv" : dd > 2 ? "back" : "lat"; }
          if (!kinds[kd] || v > kinds[kd].v) kinds[kd] = { v, p };
        }
      }
      if (!best) return decide(u);                                                          // 念のため（その場を必ず残すので通常は来ない）
      u._plan = dist(best.p, u) < 1.5 ? null : { x: best.p.x, y: best.p.y, tgt, turn };
      u._search3 = null;
      const np = best.s1, d2 = dist(np, fp), los2 = losClear(np, fp), moved = dist(np, u) > 0.5;
      const atk = chooseAttack(u, tgt, np, d2, los2);
      // 記録の文が読む「動き」：目標へ近づいた/離れた/横に回った/遮蔽へ/その場
      let move = "HOLD";
      if (moved) { const d0 = dist(u, fp) || 1, ux = (fp.x - u.x) / d0, uy = (fp.y - u.y) / d0, dd = d2 - d0; move = dd < -2 ? "ADVANCE" : dd > 2 ? "RETREAT" : ((np.x - u.x) * -uy + (np.y - u.y) * ux > 0 ? "STRAFE_L" : "STRAFE_R"); }
      // 何を考えて動いたか（記録の文用・段5）：回り込み／物陰へ／覗き／間合いを保つ／待ち構え
      let why = null; const pl = best.p, far = dist(u, pl) > st * 1.2, ftP = flankVs3(pl, tgt, f);
      const thrHere = threat3(u, u, wP), thrNew = threat3(u, np, wP);
      if (kite && move === "RETREAT") why = "kite";
      else if (moved && far && ftP >= 1) why = (SUP && tgt.supp >= 0.3 ? "pin" : "") + (ftP === 2 ? "rear" : "side");   // 釘付けの隙に回り込む
      else if (moved && thrHere > 3 && thrNew < thrHere * 0.6) why = "cover";
      else if (!moved && los2) { let others = 0; for (const e of knownEnemies(u)) if (e !== tgt && dist(e, u) <= e.ranged.effRange + e.ranged.falloff && losClear(e, u)) others++; if (!others && knownEnemies(u).length > 1) why = "peek"; }
      if (!why && !moved && wP > 0) { const tq = predictPos3(tgt, 1); if (dist(tq, u) < dist(tgt, u) - 3) why = "wait"; }
      const dec = { v: U(np, moved) - gimK(u, np, 0) * 1.2, move, attack: atk.attack, ultKind: atk.ultKind, newPos: np, d2, los2, plan: u._plan ? { x: u._plan.x, y: u._plan.y } : null, why3: why };
      const out = finishDecide(u, tgt, c, dec);
      // 考えの札（[[v2ゲーム設計]] v2.s4.think）：何を狙い・どう構え・どこへ動こうとして・何と迷ったか。乱数は使わない
      const cands = Object.entries(kinds).map(([k, o]) => ({ k, v: o.v, on: o.p === best.p })).sort((a, b) => b.v - a.v).slice(0, 3);
      out.mind = Object.assign(mindBase(u), { tgt: tgt.team + tgt.idx, aim: u._aim && u._aim.e === tgt ? u._aim.parts : null, kind: (cands.find((x) => x.on) || cands[0]).k, cands, why3: why, move, atk: out.attack, grab: out.attack === "GRAB", dodge: out.attack === "DODGE", los: los2, d: d2 });
      return out;
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
        const hcBase = rn ? rangedHit(w, u, fp, tgt, d2, true, dec.move !== "HOLD") * suppAcc(u) : meleeHit(tgt, fp);
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
        const hc = Math.min(1, rangedHit(rw, u, fp, tgt, d2, true, dec.move !== "HOLD") * (1 - u.spread) * fl.acc * SNAP_ACC * (1 - evd) * suppAcc(u));
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
        const hc = Math.min(1, rangedHit(rw, u, fp, tgt, d2, true, dec.move !== "HOLD") * (1 - u.spread) * fl.acc * (1 + corner * 0.05) * (1 - evd) * suppAcc(u));
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

    function knockback(att, tgt) { const dx = tgt.x - att.x, dy = tgt.y - att.y, len = Math.hypot(dx, dy) || 1, kb = att.melee.knockback || 4; const ix = cx(tgt.x + (dx / len) * kb), iy = cy(tgt.y + (dy / len) * kb), q = pushOutObstacle(ix, iy); if (GM && GM.kind === "crumble" && Math.hypot(q.x - ix, q.y - iy) > 0.5) tgt._slam = true; tgt.x = q.x; tgt.y = q.y; }

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
      if (SUP && u.supp >= SUP.pin && !(ev && (ev.hits || 0) > 0)) return "釘付け";        // 弾幕で頭を上げられない
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
      turn++; if (NAV) navCache = new Map();
      const lines = [], events = [], envLines = [];
      if (GM) gimStart(envLines);
      const pre = new Map(); for (const u of ALL) pre.set(u, { x: u.x, y: u.y, hp: u.hp, alive: u.alive });
      for (const u of ALL) { u._counter = null; u._surged = false; u._shaken = false; u._lost = false; }
      if (turn === 1 && COND) for (const arr of [P, C]) {                                     // 連戦の状態を1ターン目に一言（部隊ごとに一番目立つ駒だけ・v2.s4.cond.ui）
        let pick = null, pv = 0; for (const u of arr) { const v = Math.max(u.fat - 0.45, Math.abs(u.mor) - 0.4); if (v > pv) { pv = v; pick = u; } }
        if (pick) envLines.push({ text: pick.fat - 0.45 >= Math.abs(pick.mor) - 0.4 ? `── ${pick.name} は前の試合の疲れが残っている。` : pick.mor > 0 ? `── ${pick.name} は連戦の勢いに乗っている。` : `── ${pick.name} は前の試合を引きずっている。`, cls: "cm" });
      }
      // 0) 索敵
      const detectedBefore = { P: new Set(known.P.keys()), C: new Set(known.C.keys()) };
      updateDetection();
      if (V3C.search) for (const tm of ["P", "C"]) if (BRAIN[tm] === "v3" && !fogless) updateBelief3(tm, lastShots3[tm]);
      // 1) ターゲット選定（発見済みのみ・固定順＝決定論）
      for (const u of ALL) if (u.alive) u.target = pickTarget(u);
      { const tc = new Map(); for (const u of ALL) if (u.alive && u.target) tc.set(u.target, (tc.get(u.target) || 0) + 1); for (const u of ALL) u._focusCount = (u.alive && u.target) ? (tc.get(u.target) || 0) : 0; }
      // 1.5) 交戦状態（OODA）
      for (const u of ALL) if (u.alive) { if (BRAIN[u.team] === "v3" && V3C.eng) updateEngage3(u); else updateEngage(u); }
      // 2) 意思決定
      const decs = new Map();
      for (const u of ALL) if (u.alive) decs.set(u, BRAIN[u.team] === "v3" ? decide3(u) : decide(u));
      for (const u of ALL) if (u.alive && u.target) { const d = decs.get(u.target); if (d && d.mind) d.mind.hunted++; }   // 考えの札：自分を狙う敵の数
      // 3) 同時移動
      for (const u of ALL) if (u.alive) { const d = decs.get(u); u.x = d.newPos.x; u.y = d.newPos.y; }
      if (FORM2) for (const u of ALL) { if (!u.alive) { u._formHeld = false; continue; } const sl = formSlot2(u); u._formHeld = !!sl && dist(u, sl) < 12; } // 表示用：隊形の位置にいるか
      // 3.5) アンチストール：膠着したら攻撃的な体だけ最寄り敵へ引き寄せる（専守・待ちは引かない→待ち戦はタイムアップ）
      if (noDmgTurns >= 3) {
        const pull = Math.min((noDmgTurns - 2) * 2.5, 12), longQuiet = NAV && noDmgTurns >= 6;   // 長い膠着（v2 の戦場だけ）＝待つ性格も動き出す
        for (const u of ALL) {
          if (!u.alive) continue;
          const calm = !restless(u); if (calm && !longQuiet) continue;
          const e = nearestKnownEnemy(u) || (longQuiet ? nearestLiveEnemy(u) : null); if (!e) continue;   // 見失っていても気配の方へ
          const d = dist(u, e);
          // 近接は距離で・射手は idleTurns で判断（射程内でも0ダメ往復の振動を強制接触で断ち切る）
          const inMelee = d <= u.melee.reach && losClear(u, e);
          const rangedEngaging = u.ranged.effRange > u.melee.reach + 12 && d <= u.ranged.effRange && losClear(u, e) && (u.idleTurns || 0) < 3;
          if (inMelee || rangedEngaging) continue;
          const tp = NAV ? waypoint(u, e) : e, dx = tp.x - u.x, dy = tp.y - u.y, l = Math.hypot(dx, dy) || 1, st = Math.min(calm ? pull * 0.6 : pull, l);
          const q = pushOutObstacle(cx(u.x + (dx / l) * st), cy(u.y + (dy / l) * st)); u.x = q.x; u.y = q.y;
        }
      }
      if (NAV) for (const u of ALL) if (u.alive) rescueTrapped(u);
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
        const side = u.team === "P" ? "p" : "c", from = { x: u.x, y: u.y }, to = { x: tgt.x, y: tgt.y }, dTeam = tgt.team, dIdx = tgt.idx;
        if (ev.ult && (ev.shots || ev.whiff)) events.push({ side, team: u.team, aTeam: u.team, aIdx: u.idx, dTeam, dIdx, type: ev.ultRn ? "ult-ranged" : "ult-melee", from, to, shots: ev.shots || 0, hits: ev.hits || 0, dmg: ev.dmg || 0, crit: !!ev.crit, whiff: !!ev.whiff });
        else if (ev.attack === "RANGED" && ev.shots > 0) events.push({ side, team: u.team, aTeam: u.team, aIdx: u.idx, dTeam, dIdx, type: "ranged", from, to, shots: ev.shots, hits: ev.hits || 0, dmg: ev.dmg || 0, crit: !!ev.crit, whiff: (ev.hits || 0) === 0, status: ev.applyStatus ? ev.applyStatus.type : null });
        else if (ev.attack === "MELEE" && ev.shots > 0) events.push({ side, team: u.team, aTeam: u.team, aIdx: u.idx, dTeam, dIdx, type: "melee", from, to, hits: ev.hits || 0, dmg: ev.dmg || 0, crit: !!ev.crit, whiff: (ev.hits || 0) === 0 });
        else if (ev.attack === "SNAP" && ev.shots > 0) events.push({ side, team: u.team, aTeam: u.team, aIdx: u.idx, dTeam, dIdx, type: "ranged", snap: true, from, to, shots: ev.shots, hits: ev.hits || 0, dmg: ev.dmg || 0, crit: !!ev.crit, whiff: (ev.hits || 0) === 0 });   // 溜め無しの速射も射撃として描く
      }
      if (SUP) for (const ev of evs) { const rn = ev.ult ? ev.ultRn : (ev.attack === "RANGED" || ev.attack === "SNAP"); if (rn && ev.def && (ev.shots || 0) > 0) ev.def._supIn += ev.shots * supShot(ev.att.ranged) * (ev.ult ? 2 : 1); }   // 撃たれた（外れも）分の制圧
      lastShots3.P = []; lastShots3.C = [];
      for (const ev of evs) if (ev.att && (ev.attack === "RANGED" || ev.attack === "SNAP" || (ev.ult && ev.ultRn)) && (ev.shots || 0) > 0) (ev.att.team === "P" ? lastShots3.C : lastShots3.P).push({ x: ev.att.x, y: ev.att.y });
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
      for (const ev of evs) if (ev.grabHit) events.push({ side: ev.att.team === "P" ? "p" : "c", team: ev.att.team, aTeam: ev.att.team, aIdx: ev.att.idx, dTeam: ev.def.team, dIdx: ev.def.idx, type: "grab", from: { x: ev.att.x, y: ev.att.y }, to: { x: ev.def.x, y: ev.def.y }, hits: 1, dmg: ev.dmg || 0, crit: false, whiff: false });   // 描画イベント（投げ）
      // 6) 適用（同時＝相討ちあり）
      const deadThisTurn = [];
      for (const [tgt, a] of acc) {
        const before = tgt.hp;
        tgt.hp = Math.max(0, tgt.hp - a.dmg);
        tgt.st.taken += Math.min(before, a.dmg);
        for (const s of a.status) { const ty = addStatus(tgt, s); if (ty === "burn") igniteFire(tgt.x, tgt.y); }
        if (a.kbFrom) knockback(a.kbFrom, tgt);
      }
      if (GM && GM.kind === "crumble") crumbleWalls(evs, events, envLines);
      // 6.5) 回避カウンター：見切った体が生存していて、自分を殴って当てた敵を読み勝てば反撃の一閃（生存判定後＝相手も生存していれば）
      for (const u of ALL) {
        if (u.hp <= 0) continue; const d = decs.get(u); if (!d || d.attack !== "DODGE") continue;
        const atkr = evs.find((e) => e.def === u && (e.hits || 0) > 0 && (e.attack === "MELEE" || e.attack === "RANGED" || e.attack === "SNAP") && e.att.hp > 0);
        if (!atkr) continue;
        const c = counterStrike(u, atkr.att);
        if (c) { const before = atkr.att.hp; atkr.att.hp = Math.max(0, atkr.att.hp - c); atkr.att.st.taken += Math.min(before, c); u._counter = { dmg: c, on: atkr.att }; u.st.counters = (u.st.counters || 0) + 1; u.st.dealt += c;
          events.push({ side: u.team === "P" ? "p" : "c", team: u.team, aTeam: u.team, aIdx: u.idx, dTeam: atkr.att.team, dIdx: atkr.att.idx, type: "counter", from: { x: u.x, y: u.y }, to: { x: atkr.att.x, y: atkr.att.y }, hits: 1, dmg: c, crit: false, whiff: false }); }   // 描画イベント（反撃）
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
      if (GM && GM.kind === "erupt") envDmg += erupt(events, envLines);
      for (let i = hazards.length - 1; i >= 0; i--) if (hazards[i].turns <= 0) hazards.splice(i, 1);
      // 7) 死亡判定・撃破帰属
      for (const u of ALL) { if (u.alive && u.hp <= 0) { u.alive = false; u.st.downTurn = turn; deadThisTurn.push(u); } }
      for (const u of deadThisTurn) { let best = null; for (const ev of evs) if (ev.def === u && (ev.dmg || 0) > 0) { if (!best || ev.dmg > best.dmg) best = ev; } if (best) { best._killed = u; best.att.st.kills++; } }
      if (GM && GM.kind === "spring" && gim.spring === "surge") springHeal(events, envLines);
      // 7.5) 終わりの再索敵（最終位置で一致させる）
      updateDetection();
      // 8) リソース更新
      for (const u of ALL) {
        if (!u.alive) continue;
        const dealt = u.st.dealt, taken = u.st.taken; // 累積だが増分で十分（簡易）
        const a = acc.get(u); const tookNow = a ? a.dmg : 0;
        const dec = decs.get(u), attacked = dec && (dec.attack === "RANGED" || dec.attack === "MELEE" || dec.attack === "ULT" || dec.attack === "SNAP");
        u.stamina = clamp(u.stamina + (attacked ? -0.09 * modSta : 0.07 * (1 - 0.4 * (u.fat || 0))), 0, 1);   // 疲れが残る駒は回復が遅い（v2.s4.cond.fat）
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
        const L = LEAD[d.team];
        if (L && L.u === d && !L.fell) {                                                     // 隊長が倒れた：残る味方が動揺する（信頼が厚く、味方思いなほど）。乱数は使わない
          L.fell = true;
          for (const u of (d.team === "P" ? P : C)) { if (!u.alive) continue; const k = L.trust * (0.3 + 0.7 * u.coop); u.momentum = clamp(u.momentum - 0.35 * k, -1, 1); u.stamina = clamp(u.stamina - 0.12 * k, 0, 1); u._lost = true; }
          envLines.push({ text: `── 隊長 ${d.name} が倒れ、残る味方の足並みが乱れる。`, cls: "cm" });
        }
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
      if (NAV) for (const u of ALL) { if (!u.alive) continue; if (insideAny(u.x, u.y)) { const q = pushOutBlocks(u.x, u.y); u.x = q.x; u.y = q.y; } rescueTrapped(u); }   // 吹き飛ばし等で壁・谷に入った駒を出す（v2 の戦場だけ）
      if (SUP) for (const u of ALL) {                                                    // 制圧の更新：前の分は0.4倍に薄れ、このターンに受けた分（冷静さで減る）を足す
        if (!u.alive) { u.supp = 0; u._supIn = 0; continue; }
        const prev = u.supp; u.supp = clamp(u.supp * SUP.decay + u._supIn * (1 - u.micros.C5 * SUP.c5), 0, SUP.cap); u._supIn = 0;
        if (prev < SUP.pin && u.supp >= SUP.pin) envLines.push({ text: `── ${u.name} は弾幕に釘付けにされる。`, cls: "cm" });
        if (u.supp >= SUP.pin) u.st.pinned = (u.st.pinned || 0) + 1;
      }
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
              let held = 0; for (const u of units) { if (FORM2) { if (u._formHeld) held++; continue; } const slot = formSlotWorld(u); if (slot && dist(u, slot) < 18) held++; }
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
          if (u.form && u.form !== "loose" && hsh(seed, turn, u.idx + 21) % 4 === 0) { const slot = FORM2 ? (u._formHeld ? u : null) : formSlotWorld(u); if (slot && dist(u, slot) < 18) { const fn = (D.FORMATIONS.find((f) => f.key === u.form) || {}).name; if (fn) return vary([`${fn}を保ちながら`, `${fn}を崩さず`, `${fn}の一角として`], seed, turn, u.idx + 21); } }
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
          if (dec && dec.why3) {                                                              // v3 の頭が何を考えて動いたか
            const W3 = { rear: [`${t}の背後へ回り込もうと遮蔽伝いに進んだ`, `${t}の死角へ大きく回り込んだ`, `${t}の背を取るべく迂回した`], side: [`${t}の側面へ回り込んだ`, `${t}の横腹を突ける位置へ動いた`],
              cover: ["射線を切れる物陰へ移った", "遮蔽の陰へ身を移した"], peek: [`物陰から${t}を窺った`, `遮蔽の縁から${t}に狙いをつけた`],
              kite: [`${t}を寄せつけず、間合いを保って下がった`, `${t}の踏み込みを外して距離を取った`], wait: [`${t}が踏み込んでくる所で待ち構えた`, `${t}の出鼻を待ち受けた`],
              pinrear: [`${t}が弾幕に釘付けの隙に、背後へ回り込んだ`, `味方の弾幕で${t}を縫い止めている間に、死角へ回った`], pinside: [`${t}が釘付けの隙に、側面へ回り込んだ`, `弾幕で頭を上げられない${t}の横へ回った`] };
            const pool = W3[dec.why3]; if (pool) return vary(pool, seed, turn, u.idx * 7 + 41);
          }
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
          if (u._lost) return vary(["隊長を失い動揺しつつ", "指揮を失って浮き足立ちながら"], seed, turn, u.idx + 17);       // 隊長が倒れた（v2.s4.cond.cmd）
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
      for (const u of deadThisTurn) if (!evs.some((ev) => ev._killed === u)) lines.push({ text: `── ${npc(u)}、${u._erupted === turn ? "噴き上がる溶岩に呑まれ、倒れる" : "力尽きて崩れ落ちる"}。`, cls: "cm" });
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
      if (GM && GM.kind === "erupt") scheduleVents(lines);
      result = finishCheck();
      if (result) { over = true; for (const fl of finishNarration(result)) lines.push(fl); }
      const minds = {}; for (const u of ALL) { const d = decs.get(u); if (d && d.mind) minds[u.team + u.idx] = d.mind; }   // 考えの札（駒ごと・画面が読む）
      return { turn, lines, events, over, result, kos: deadThisTurn.length, minds }; // kos＝表示用の緩急（KOターンは自動再生を長めに止める）。乱数非消費
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
      get gimmick() { return GM ? { kind: GM.kind, tide: gim.tide, tideNext: tideAt(turn + 1), spring: gim.spring, springNext: springAt(turn + 1), vents: gim.vents.map((v) => ({ x: v.x, y: v.y, r: v.r, at: v.at })) } : null; },   // 画面が描くギミックの状態
      teamHpFrac, aliveCount,
      spotted: (u) => known[u.team === "P" ? "C" : "P"].has(u), // その体が敵に発見されているか（レーダーのゴースト表示用）。視界扇は u.sightR/u.sightHalf/faceX/faceY
    };
  };

})();
