/* ui.js — テキスト描画＋人格設定＋ステップ進行。シム核を読んで距離/HP/ログに落とすだけ。 */
window.SCS = window.SCS || {};

(function () {
  const D = SCS.DATA;
  const $ = (id) => document.getElementById(id);

  let plrChoices = D.PRESETS["中庸バランス"].slice();
  let cpuPresetName = "専守要塞";
  let arenaName = "ランダム";
  let modName = "ランダム";
  let seed = 12345;
  let battle = null;
  let autoTimer = null;
  // ストーリーモード連携：敵の人格/ホームを外部指定、決着でコールバック、核軸をロック
  let storyCpuChoices = null, storyCpuName = null, onBattleOver = null, lockedAxis = -1;
  // ④ 前回設計との差分：直近の決着サマリ＋今戦が戦った人格を保持
  let prevRun = null, battleChoices = null;

  // ⑤ 各軸が「どんな振る舞いを支配するか」の一言ヒント（ツールチップ用。数値は出さず傾向だけ）
  const MACRO_HINT = [
    "攻めの強さ。前に出る・接近して殴る傾向を支配。高いほど脆くなりがち。",
    "勝負の振り幅。被弾覚悟の博打・低確率でも撃つかを支配。",
    "頭の冷たさ。回避・受けの安定とプレッシャー耐性を支配。",
    "仕掛けの早さ。せっかち⇔待ち＝カイト/間合い管理を支配。",
    "手堅さ。反動制御・弾管理・先読みの深さに効く。",
    "相手への合わせ。観察・戦術切替・確定反撃の読みを支配。",
    "矜持。正攻法⇔搦め手（遮蔽・狡猾さ）の好みを支配。",
    "仕留めの容赦。深追い・必殺・好機の食いつきを支配。",
    "強気さ。状況を強気に見る／HPを削って攻めるかを支配。",
    "試す心。奇手・予測不能・環境の活用を支配。",
  ];
  const weaponStr = (u) => `${u.ranged.name}＋${u.melee.name}`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), clamp01 = (v) => clamp(v, 0, 1);

  function buildConfig() {
    const wrap = $("plrParams");
    wrap.innerHTML = "";
    D.MACROS.forEach((mac, i) => {
      const row = document.createElement("div");
      row.className = "macro";
      const label = document.createElement("label");
      label.className = "macro-lbl";
      label.textContent = mac.name;
      label.title = MACRO_HINT[i] || ""; // ⑤ 支配クラスター注記（ツールチップ）
      const sel = document.createElement("select");
      mac.poles.forEach((p, ci) => {
        const o = document.createElement("option");
        o.value = ci; o.textContent = p; sel.appendChild(o);
      });
      sel.value = plrChoices[i];
      sel.addEventListener("change", () => { plrChoices[i] = parseInt(sel.value, 10); renderBuildCard(); markPredictStale(); }); // 回す→即・カルテへ反映（入口の手応え）／試算は要再計算
      row.appendChild(label); row.appendChild(sel); wrap.appendChild(row);
    });

    const csel = $("cpuPreset");
    csel.innerHTML = "";
    Object.keys(D.PRESETS).concat(["ランダム"]).forEach((name) => {
      const o = document.createElement("option");
      o.value = name; o.textContent = name; csel.appendChild(o);
    });
    csel.value = cpuPresetName;
    csel.addEventListener("change", () => { cpuPresetName = csel.value; markPredictStale(); });

    const asel = $("arenaSel");
    asel.innerHTML = "";
    ["ランダム"].concat(D.ARENAS.map((a) => a.name)).forEach((name) => {
      const o = document.createElement("option");
      o.value = name; o.textContent = name; asel.appendChild(o);
    });
    asel.value = arenaName;
    asel.addEventListener("change", () => { arenaName = asel.value; markPredictStale(); });

    const msel = $("modSel");
    msel.innerHTML = "";
    ["ランダム"].concat(D.MODIFIERS.map((m) => m.name)).forEach((name) => {
      const o = document.createElement("option");
      o.value = name; o.textContent = name; msel.appendChild(o);
    });
    msel.value = modName;
    msel.addEventListener("change", () => { modName = msel.value; markPredictStale(); });

    $("seed").value = seed;
    renderBuildCard();
  }

  // CPU「ランダム」用：seedから10軸人格を生成（戦闘乱数とは別系列）
  function genRandomChoices(s) {
    const r = SCS.makeRNG((s ^ 0x9e3779b9) >>> 0);
    return Array.from({ length: 10 }, () => r.int(4));
  }

  function newBattle() {
    stopAuto();
    markPredictStale(); // 実行中の勝率試算を打ち切る（出撃で生戦闘と並走させない）
    if (!$("randSeed") || $("randSeed").checked) { seed = Math.floor(Math.random() * 0x7fffffff) >>> 0; $("seed").value = seed; } // 毎回ランダム＝非決定論（一期一会）
    else seed = parseInt($("seed").value, 10) || 1; // チェックを外せば seed 固定で同じ戦闘を再現
    const plr = SCS.derive.buildUnit("YOU", plrChoices);
    let cpuChoices, cpuName;
    if (storyCpuChoices) { cpuChoices = storyCpuChoices; cpuName = storyCpuName; } // ストーリー：敵キャラを外部指定
    else if (cpuPresetName === "ランダム") { cpuChoices = genRandomChoices(seed); cpuName = `ランダム#${seed}`; }
    else { cpuChoices = D.PRESETS[cpuPresetName]; cpuName = cpuPresetName; }
    const cpu = SCS.derive.buildUnit(cpuName, cpuChoices);
    battleChoices = plrChoices.slice(); // ④ この対戦が戦った人格（決着時に前回差分の基準として保存）
    if (!storyCpuChoices) { arenaName = $("arenaSel").value; modName = $("modSel").value; } // ストーリーはホーム固定（外部指定）
    battle = SCS.makeBattle(plr, cpu, seed, arenaName, modName);
    if (SCS.mini) SCS.mini.reset(); // 新規対戦：ミニマップの位置をスナップ
    $("arenaChip").textContent = battle.arena.name;
    const mc = $("modChip");
    if (battle.modifier) { mc.textContent = battle.modifier.name; mc.style.display = ""; } else { mc.textContent = ""; mc.style.display = "none"; }
    $("log").innerHTML = "";
    appendRaw(`>> 戦場：${battle.arena.name} — ${battle.arena.flavor}`, "arena");
    if (battle.modifier) appendRaw(`>> 戦況：${battle.modifier.name} — ${battle.modifier.flavor}`, "arena");
    appendRaw(`>> 対戦開始  PLR:${weaponStr(plr)} HP${plr.maxHp}  vs  CPU(${cpu.name}):${weaponStr(cpu)} HP${cpu.maxHp}`, "sys");
    appendRaw(`>> seed=${seed}（同じ人格＋同じseed → 必ず同じ戦闘）`, "dim");
    $("paramsWrap").classList.add("hidden"); // 新規対戦時は分析を畳む（決着で自動展開）
    render();
    updateConfigLock();
  }

  // 戦闘進行中（turn≥1かつ未決着）は人格・CPU・seedをロック
  function setConfigEnabled(enabled) {
    document.querySelectorAll("#plrParams select").forEach((s, i) => (s.disabled = !enabled || i === lockedAxis));
    $("cpuPreset").disabled = !enabled;
    $("arenaSel").disabled = !enabled;
    $("modSel").disabled = !enabled;
    $("seed").disabled = !enabled;
    $("config").classList.toggle("locked", !enabled);
    $("cfgLock").textContent = enabled ? "" : "[ LOCK ] 戦闘中：性格はロック（決着後 or 新規対戦で解除）";
  }
  // 核軸ロック表示。lk=false で必ず disabled を戻す（旧版は一方向ラッチで解除経路が無くダイヤルが固まった）
  function applyLockUI() { document.querySelectorAll("#plrParams select").forEach((s, i) => { const lk = i === lockedAxis; s.disabled = lk; s.classList.toggle("locked-axis", lk); }); }
  function updateConfigLock() {
    const locked = !!battle && battle.turn >= 1 && !battle.over;
    setConfigEnabled(!locked);
  }

  // 状態異常チップ（DoT/脆弱/鈍足は statuses、麻痺は stun、火事場は secondWind）
  function chipsHtml(u) {
    const out = [];
    (u.statuses || []).forEach((s) => out.push(`<span class="chip ${s.type}">${D.STATUS_JP[s.type] || s.type}</span>`));
    if (u.stun > 0) out.push(`<span class="chip stun">麻痺</span>`);
    if (u.secondWind > 0) out.push(`<span class="chip sw">火事場</span>`);
    return out.join("");
  }
  function setUnit(side, u, label) {
    const f = Math.round(clamp01(u.hp / u.maxHp) * 100);
    const hpf = $("hpf" + side);
    hpf.style.width = f + "%";
    hpf.parentElement.classList.toggle("low", u.hp > 0 && u.hp / u.maxHp < 0.3);
    $("hpn" + side).textContent = `${u.hp} / ${u.maxHp}`;
    $("sta" + side).style.width = Math.round(clamp01(u.stamina == null ? 1 : u.stamina) * 100) + "%";
    const rf = clamp01(u.resolve || 0); // 気迫ゲージ（満タンで必殺解放＝発光）
    $("res" + side).style.width = Math.round(rf * 100) + "%";
    $("resRow" + side).classList.toggle("full", rf >= 1);
    $("chips" + side).innerHTML = chipsHtml(u);
    $("name" + side).textContent = label;
    $("weap" + side).textContent = weaponStr(u);
  }
  // 実X座標を 0..field.w → 0..100% に投影（PLR/CPUとも動く・左右は固定でない）。HP/気力/流れ/状態異常を可視化
  function render() {
    if (!battle) return;
    const p = battle.plr, c = battle.cpu;
    if (SCS.mini) SCS.mini.sync(battle); // 2D上空ミニマップ（mini.jsが補間描画）
    $("distNum").textContent = `距離 ${battle.displayDist()}%`;
    setUnit("P", p, "YOU");
    setUnit("C", c, c.name);
    const net = clamp(((p.momentum || 0) - (c.momentum || 0)) / 1.5, -1, 1); // 流れ：PLR側(左)↔CPU側(右)
    $("moFill").style.left = clamp(50 - net * 42, 4, 96) + "%";
    $("turnInfo").textContent = `TURN ${battle.turn} / ${D.SIM.turnCap}`;
  }

  // ===== ① 設計ライブプレビュー（人格カルテ）=====
  // choices→buildUnitで即派生し「HP／武器／戦法ラベル／際立つ気質／綱引き」を表示。
  // ★非公開ライン厳守：24小パラ数値・重み行列は出さない。可視3層（HP・武器・戦法の一語）＋プレイヤー自身が選んだ気質のみ。
  const TRAIT_PRIORITY = [0, 1, 7, 8, 3, 2, 5, 4, 9, 6]; // 際立つ気質を選ぶ優先順（闘争心/リスク/非情/自信/テンポ…）
  // 戦法ラベル：派生済みの「振る舞いの偏り」を一語に。choices（プレイヤー自身の選択）＋実武器の射程＋小パラの傾きから決める。
  // 注：これは挙動の要約であって小パラ数値の開示ではない（非公開ライン内）。turtle/kiteは機動(B5)で分ける。
  function styleLabel(u, ch) {
    const m = u.micros, er = u.ranged.effRange;
    const agg = Math.max(ch[0] / 3, m.A2);                  // 攻撃性（闘争心の選択 or 攻撃開始の早さ）
    const meleeLean = m.A3 >= 0.6 || er <= 34;              // 接近寄り（近接傾倒 or 至近武器）
    const rangeLean = m.A1 >= 0.55 || (er >= 72 && m.A3 < 0.52); // 遠距離寄り
    const passive = ch[0] <= 0 || (m.A2 <= 0.42 && ch[3] >= 2);  // 専守 or 様子見×待ち
    const mobile = m.B5 >= 0.45;                            // よく動くか（拠点的か）
    if (passive && (rangeLean || m.B1 >= 0.55)) return (mobile && m.B2 >= 0.6) ? { tag: "カイト・間合い管理", k: "kite" } : { tag: "待ち・要塞", k: "turtle" };
    if (rangeLean && m.B2 >= 0.6 && mobile) return { tag: "カイト・間合い管理", k: "kite" };
    if (agg >= 0.66 && meleeLean) return { tag: "速攻・接近", k: "rush" };
    if (meleeLean) return { tag: "接近戦主体", k: "melee" };
    if (rangeLean) return { tag: "遠距離・射撃主体", k: "range" };
    if (m.B3 >= 0.62) return { tag: "回避・捌き", k: "evade" };
    return { tag: "万能・バランス", k: "allround" };
  }
  const TRADEOFF = {
    rush: "尖った火力。攻めきれねば脆い——打たれ弱さと表裏。",
    kite: "間合いを保てば有利。捕まると一気に崩れる。",
    turtle: "守りは固い。好機を逃すと手数で押し負ける。",
    range: "距離を取れれば強い。接近を許すと脆い。",
    melee: "近接の地力で押す。間合いの外では何もできない。",
    evade: "捌いて返す型。被弾が続くと脆い。",
    allround: "大きな穴は無いが、尖りも無い。状況対応で勝つ。",
  };
  function wslot(lbl, w) {
    const st = w.status ? `<em class="wtag ${w.status.type}">${D.STATUS_JP[w.status.type] || w.status.type}</em>` : "";
    return `<span class="wslot"><span class="ws-lbl">${lbl}</span><b>${w.name}</b>${st}</span>`;
  }
  // 任意 choices からカルテHTMLを生成（分隊戦UIからも再利用）
  function buildCardHtml(choices) {
    const u = SCS.derive.buildUnit("U", choices), sty = styleLabel(u, choices);
    const hpPct = Math.round(((u.maxHp - 70) / 60) * 92 + 8);
    const ex = [];
    for (const i of TRAIT_PRIORITY) { if (choices[i] === 0 || choices[i] === 3) ex.push(`<span class="bc-trait">${D.MACROS[i].poles[choices[i]]}</span>`); if (ex.length >= 3) break; }
    const traits = ex.length ? ex.join("") : `<span class="bc-trait neutral">中庸（突出した気質なし）</span>`;
    return `<div class="bc-head"><span class="bc-tag ${sty.k}">${sty.tag}</span>` +
      `<span class="bc-hp"><span class="bc-lbl">HP</span><span class="bc-hpbar"><i style="width:${hpPct}%"></i></span><b>${u.maxHp}</b></span></div>` +
      `<div class="bc-weap">${wslot("射撃", u.ranged)}${wslot("近接", u.melee)}</div>` +
      `<div class="bc-traits">${traits}</div>` +
      `<div class="bc-trade">${TRADEOFF[sty.k]}</div>`;
  }
  function renderBuildCard() { const el = $("buildCard"); if (el) el.innerHTML = buildCardHtml(plrChoices); }

  // ===== ② 決定論バッチ勝率エンジン＋A/B差分 =====
  // 固定seed群でフル精度の実戦を多数回し、勝率/決着T/KO率を集計。観戦する実戦と一致させる（先読み/MCを削らない）。
  // チャンク非同期で進捗を出しつつ、同一設定はキャッシュ＝再設計の試行を軽快に。
  const PREDICT_SEEDS = 20;
  let predictCtx = null, predictRun = 0, lastEstimate = null;
  const predictCache = {}; const predictCacheKeys = []; // 簡易LRU（無制限肥大を防ぐ）
  function predictContext() {
    if (predictCtx) return { plrChoices: plrChoices.slice(), cpuChoices: predictCtx.cpuChoices, cpuName: predictCtx.cpuName, arena: predictCtx.arena, mod: predictCtx.mod, rnd: false };
    const aSel = $("arenaSel").value, mSel = $("modSel").value, preset = $("cpuPreset").value;
    let cc, cn, rnd = false;
    if (preset === "ランダム") { const s = parseInt($("seed").value, 10) || 12345; cc = genRandomChoices(s); cn = `ランダム#${s}`; rnd = true; }
    else { cc = D.PRESETS[preset]; cn = preset; }
    return { plrChoices: plrChoices.slice(), cpuChoices: cc, cpuName: cn, arena: aSel, mod: mSel, rnd };
  }
  function predictKey(ctx) { return ctx.plrChoices.join("") + "|" + (ctx.cpuChoices || []).join("") + "|" + ctx.arena + "|" + ctx.mod; }
  function predictHtml(ctx, t, prevEst) {
    const w = t.winRate, dr = t.drawRate, l = Math.max(0, 100 - w - dr); // 独立丸めで和が100超でも敗率は負にしない（進捗中の負値表示を防ぐ）
    const prog = t.done ? "" : `<span class="pg-prog">試算中 ${t.n}/${t.total}…</span>`;
    let delta = "";
    if (prevEst && t.done) { const d = w - prevEst.winRate, arr = d === 0 ? "±0" : (d > 0 ? `+${d}` : `${d}`); delta = `<span class="pg-delta ${d > 0 ? "dgood" : d < 0 ? "dbad" : "d0"}">前回試算 ${prevEst.winRate}％ → <b>${w}％</b>（${arr}pt）</span>`; }
    const note = ctx.rnd ? `<span class="pg-note">相手＝ランダム#（seed固定の1体）との対戦推定</span>` : `<span class="pg-note">対 ${ctx.cpuName}・${ctx.arena}／${ctx.mod}・${t.total}戦平均</span>`;
    return `<div class="pg-head"><span class="pg-title">推定勝率</span><span class="pg-big">${w}<small>％</small></span>${prog}</div>` +
      `<div class="pg-bar"><i class="pg-win" style="width:${w}%"></i><i class="pg-draw" style="width:${dr}%"></i><i class="pg-lose" style="width:${l}%"></i></div>` +
      `<div class="pg-legend"><span class="lg-w">勝 ${w}％</span><span class="lg-d">分 ${dr}％</span><span class="lg-l">敗 ${l}％</span></div>` +
      (delta ? `<div class="pg-deltas">${delta}</div>` : "") +
      `<div class="pg-stats">平均決着 ${t.avgTurns}T・KO率 ${t.koRate}％・与/被 ${t.avgDealt}/${t.avgTaken}</div>` + note;
  }
  function runPredict() {
    const ctx = predictContext(), key = predictKey(ctx), wrap = $("predictWrap");
    wrap.classList.remove("hidden"); wrap.classList.remove("stale");
    const prevEst = (lastEstimate && lastEstimate.key !== key) ? lastEstimate : null;
    if (predictCache[key]) { wrap.innerHTML = predictHtml(ctx, predictCache[key], prevEst); lastEstimate = { key, winRate: predictCache[key].winRate }; return; }
    const myRun = ++predictRun, btn = $("btnPredict");
    btn.disabled = true; btn.textContent = "試算中…";
    const draw = (t) => { if (myRun === predictRun) wrap.innerHTML = predictHtml(ctx, t, prevEst); };
    SCS.batchSimAsync(ctx.plrChoices, ctx.cpuChoices, ctx.arena, ctx.mod, SCS.batchSeeds(PREDICT_SEEDS), { cpuName: ctx.cpuName, chunk: 2, cancelled: () => myRun !== predictRun, onProgress: draw })
      .then((t) => {
        if (myRun !== predictRun) return;
        if (t.done) { if (!predictCache[key]) { predictCacheKeys.push(key); if (predictCacheKeys.length > 64) delete predictCache[predictCacheKeys.shift()]; } predictCache[key] = t; draw(t); lastEstimate = { key, winRate: t.winRate }; }
        btn.disabled = false; btn.textContent = "▶ 勝率を再試算（20戦）";
      });
  }
  function markPredictStale() { predictRun++; const w = $("predictWrap"); if (w && !w.classList.contains("hidden")) w.classList.add("stale"); const b = $("btnPredict"); if (b) { b.disabled = false; b.textContent = "▶ 勝率を試算（20戦）"; } }

  function appendRaw(text, cls) {
    const div = document.createElement("div");
    div.className = "log-line " + (cls || "");
    div.innerHTML = text; // 描写は全て内部生成（ユーザー入力なし）。PLR/CPU名の色分けspanを反映
    $("log").appendChild(div);
    $("log").scrollTop = $("log").scrollHeight;
  }

  function nextStep() {
    if (!battle || battle.over) return;
    const r = battle.step();
    appendRaw(`━━ TURN ${r.turn} ━━`, "turnhdr");
    r.lines.forEach((l) => appendRaw(l.text, l.cls));
    if (SCS.mini) SCS.mini.pushFx(r.events); // ③ 撃ち合いをレーダーに描く
    render();
    updateConfigLock();
    if (r.over) { stopAuto(); $("paramsWrap").classList.remove("hidden"); renderParams(); const fin = battle.getAnalysis(); if (onBattleOver) onBattleOver(battle.result, fin); prevRun = runSummary(fin); } // 決着→総括を表示（旧prevRunと差分）→ストーリー通知→prevRunを今戦で更新
    else if (!$("paramsWrap").classList.contains("hidden")) renderParams(); // 分析を開いている間は毎ターン更新
  }

  function auto() {
    if (autoTimer) { stopAuto(); return; }
    $("btnAuto").textContent = "■ 停止";
    autoTimer = setInterval(() => {
      if (!battle || battle.over) { stopAuto(); return; }
      nextStep();
    }, 350);
  }
  function stopAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    const b = $("btnAuto");
    if (b) b.textContent = "▶ 自動実行";
  }

  // ④ 決着サマリ（前回差分の基準）
  function runSummary(a) {
    return { choices: (battleChoices || plrChoices).slice(), hitRate: a.plr.hitRate, dmgDealt: a.plr.dmgDealt, dmgTaken: a.plr.dmgTaken, atkRatio: a.plr.atkRatio, won: a.plr.won, result: a.result, enemy: a.cpu.name };
  }
  // ④ 前回設計→今戦の「変えた軸」＋「指標デルタ」を一目で。敗因と再設計を因果で結ぶ
  function diffStripHtml(cur) {
    if (!prevRun) return "";
    const changed = [];
    for (let i = 0; i < 10; i++) { const o = prevRun.choices[i], n = cur.choices[i]; if (o !== n) changed.push(`${D.MACROS[i].name}：${D.MACROS[i].poles[o]}→<b>${D.MACROS[i].poles[n]}</b>`); }
    const chHtml = changed.length ? changed.join("　／　") : "<span class=\"ds-same\">設計は前回と同じ</span>";
    const sameEnemy = prevRun.enemy === cur.enemy;
    let metrics;
    if (sameEnemy) {
      const dm = (label, o, n, goodDown) => { const d = n - o, arr = d === 0 ? "±0" : (d > 0 ? `+${d}` : `${d}`), good = goodDown ? d < 0 : d > 0, cls = d === 0 ? "d0" : (good ? "dgood" : "dbad"); return `<span class="dm ${cls}">${label} ${o}→${n}<i>(${arr})</i></span>`; };
      const rl = (r, won) => won ? "勝" : (r && r.type === "draw" ? "分" : "敗");
      const rp = rl(prevRun.result, prevRun.won), rc = rl(cur.result, cur.won);
      metrics = dm("被ダメ", prevRun.dmgTaken, cur.dmgTaken, true) + dm("命中%", prevRun.hitRate, cur.hitRate, false) + dm("攻撃%", prevRun.atkRatio, cur.atkRatio, false) +
        `<span class="dm ${cur.won && !prevRun.won ? "dgood" : (!cur.won && prevRun.won ? "dbad" : "d0")}">結果 ${rp}→${rc}</span>`;
    } else metrics = `<span class="dm d0">前回は別の相手（${prevRun.enemy}）との比較は指標のみ参考</span>`;
    return `<div class="diff-strip"><span class="ds-h">前回との差分</span><div class="ds-ch">${chHtml}</div><div class="ds-mx">${metrics}</div></div>`;
  }
  // 戦闘分析：内部パラメータ(24小パラ)は見せず、戦いぶり（結果）から総括＋次の方向性を示す
  function renderParams() {
    if (!battle) return;
    const a = battle.getAnalysis();
    const head = a.over
      ? `観戦終了：${a.arena}・全${a.turns}ターン`
      : `観戦中：${a.arena}・${a.turns}ターン経過（決着すると総括が確定します）`;
    $("params").innerHTML =
      `<div class="ameta">${head}</div>` +
      (a.over ? diffStripHtml(runSummary(a)) : "") +
      `<div class="acols">${unitAnalysisHtml(a.plr, "YOU（あなたの人格）", a, true)}${unitAnalysisHtml(a.cpu, `CPU（${a.cpu.name}）`, a, false)}</div>` +
      `<p class="ahint">※ 内部パラメータは非公開。戦いぶりから人格をどちらへ寄せるか考えるのが、このゲームの肝です。<span class="ahint2">「次の方向性」を押すと、その軸のダイヤルへ移動して1段寄せます。</span></p>`;
  }
  function unitAnalysisHtml(u, label, a, clickable) {
    const badge = a.over
      ? (u.won ? `<span class="abadge win">WIN</span>` : (a.result && a.result.type === "draw" ? `<span class="abadge draw">DRAW</span>` : `<span class="abadge lose">LOSE</span>`))
      : "";
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    let s = `<div class="acol"><h4>${label} ${badge}</h4>`;
    s += `<div class="aweap">${u.weapon}　HP ${u.hp}</div>`;
    if (u.verdict) s += `<div class="averdict">${u.verdict}</div>`;
    s += `<table class="atab">`;
    s += row("命中率", `${u.hitRate}%`);
    s += row("与ダメ / 被ダメ", `${u.dmgDealt} / ${u.dmgTaken}`);
    s += row("会心", `${u.crits}回`);
    s += row("攻撃に出た割合", `${u.atkRatio}%`);
    s += row("間合い（近/中/遠）", `${u.near}/${u.mid}/${u.far}%`);
    if (u.status) s += row("与えた状態異常", u.status);
    if (u.guile) s += row("駆け引き", `${u.guile}回`);
    s += `</table>`;
    s += `<div class="anotes"><b>戦いぶり</b><ul>${u.notes.map((n) => `<li>${n}</li>`).join("")}</ul></div>`;
    const adviceLi = (n) => {
      const t = typeof n === "string" ? n : n.text;
      if (clickable && n && n.axis != null && lockedAxis !== n.axis) return `<li><button class="adv-link" data-axis="${n.axis}" data-dir="${n.dir}">${t}</button></li>`;
      return `<li>${t}</li>`;
    };
    s += `<div class="aadvice"><b>次の方向性</b><ul>${u.advice.map(adviceLi).join("")}</ul></div>`;
    s += `</div>`;
    return s;
  }
  // ④ 助言→ダイヤル：該当軸へスクロール＋ハイライト＋推奨方向に1段ナッジ→①カードが即連動
  function nudgeAxis(axis, dir) {
    axis = parseInt(axis, 10); dir = parseInt(dir, 10) || 0;
    if (isNaN(axis) || axis < 0 || axis > 9 || axis === lockedAxis) return;
    const v = clamp(plrChoices[axis] + dir, 0, 3);
    plrChoices[axis] = v;
    const sel = document.querySelectorAll("#plrParams select")[axis];
    if (sel) {
      sel.value = v;
      const macro = sel.closest(".macro");
      if (macro) { macro.classList.add("nudged"); setTimeout(() => macro.classList.remove("nudged"), 1300); }
      if (sel.offsetParent !== null) sel.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    renderBuildCard();
    markPredictStale();
  }

  function toggleParams() { const w = $("paramsWrap"); w.classList.toggle("hidden"); if (!w.classList.contains("hidden")) renderParams(); }

  // ストーリーモードが呼ぶ最小API（人格の読み書き・核ロック・敵指定の戦闘起動）
  SCS.ui = {
    setPlrChoices(c) { plrChoices = c.slice(); document.querySelectorAll("#plrParams select").forEach((s, i) => { if (plrChoices[i] != null) s.value = plrChoices[i]; }); renderBuildCard(); },
    getPlrChoices() { return plrChoices.slice(); },
    lockAxis(idx) { lockedAxis = idx; applyLockUI(); },
    launchStoryBattle(opts) { storyCpuChoices = opts.cpuChoices; storyCpuName = opts.cpuName; arenaName = opts.arena; modName = opts.mod; onBattleOver = opts.onOver || null; newBattle(); },
    clearStory() { stopAuto(); storyCpuChoices = null; storyCpuName = null; onBattleOver = null; lockedAxis = -1; predictCtx = null; markPredictStale(); applyLockUI(); }, // stopAuto＝モード切替で旧バトルの自動進行を裏で走らせない
    freeBattle() { storyCpuChoices = null; storyCpuName = null; onBattleOver = null; lockedAxis = -1; predictCtx = null; applyLockUI(); newBattle(); },
    setPredictContext(ctx) { predictCtx = ctx; markPredictStale(); }, // ② ストーリー設計時：試算の相手＝この敵のホーム
    buildCardHtml: (choices) => buildCardHtml(choices), // 分隊戦UIが各体のカルテに使う
    styleOf: (u) => styleLabel(u, u.choices).tag,        // 分隊分析の役割ラベル
    macroHint: (i) => MACRO_HINT[i] || "",
    nextStep, auto,
  };

  function init() {
    buildConfig();
    $("btnNew").addEventListener("click", newBattle);
    $("btnNext").addEventListener("click", nextStep);
    $("btnAuto").addEventListener("click", auto);
    $("btnParams").addEventListener("click", toggleParams);
    $("params").addEventListener("click", (e) => { const b = e.target.closest(".adv-link"); if (b) nudgeAxis(b.dataset.axis, b.dataset.dir); }); // ④ 助言クリックでダイヤル誘導＋ナッジ
    $("btnPredict").addEventListener("click", runPredict); // ② 勝率試算
    window.addEventListener("resize", () => { if (battle) render(); }); // 回転・幅変更でバー長を再調整
    newBattle();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
