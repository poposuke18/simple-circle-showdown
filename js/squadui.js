/* squadui.js — 分隊戦モードのUI（設計→出撃→観戦→分析）。[[分隊戦設計]]
 * 自己完結：専用キャンバス(miniSquad)・専用ログ・専用コントロール。1v1のui.jsには非干渉。
 * ビルドカルテ/戦法ラベルは SCS.ui の公開ヘルパを再利用。エンジンは SCS.makeSquadBattle。
 */
window.SCS = window.SCS || {};

(function () {
  const D = SCS.DATA, $ = (id) => document.getElementById(id);
  const SIZE = 3;
  const DEFAULT = [D.PRESETS["重剣の闘士"], D.PRESETS["鉄律の射手"], D.PRESETS["海千山千の暗殺者"]]; // 補完的な叩き台（壁/射手/遊撃）
  let squad = DEFAULT.map((c) => c.slice());
  let active = 0;
  let hintsOn = true; // 各ダイヤルの効果説明をインライン表示（初見が各軸の意味を掴めるよう既定ON・トグルで消せる）
  const CPU_SQUADS = {
    "鉄壁分隊": ["専守要塞", "鉄律の射手", "毒手の刺客"],
    "猛攻分隊": ["猪突ガラスキャノン", "重剣の闘士", "海千山千の暗殺者"],
    "撹乱分隊": ["かく乱の火付け", "海千山千の暗殺者", "毒手の刺客"],
    "均衡分隊": ["中庸バランス", "中庸バランス", "中庸バランス"],
  };
  let cpuName = "鉄壁分隊", arena = "ランダム", mod = "ランダム", form = "散開";
  let battle = null, autoT = null, lastSeed = null;

  // ===== キャンペーン「制圧戦」（[[分隊戦設計]]§12）＝線形8ステージ・進行はlocalStorage・鏡は直近勝利編成のコピー =====
  const CAMP = D.SQUAD_CAMPAIGN || [];
  const CAMP_KEY = "scs_sqcamp_v1";
  let playMode = "free";           // "free"=模擬戦 / "camp"=制圧戦
  let campSel = 0;                 // 選択中ステージ
  let camp = loadCamp();
  function loadCamp() { try { const j = JSON.parse(localStorage.getItem(CAMP_KEY) || "null"); if (j && j.cleared) return j; } catch (e) {} return { cleared: {}, lastWin: null, lastWinForm: "散開" }; }
  function saveCamp() { try { localStorage.setItem(CAMP_KEY, JSON.stringify(camp)); } catch (e) {} }
  const campUnlocked = (i) => i === 0 || !!camp.cleared[CAMP[i - 1].key];
  const campFrontier = () => { for (let i = 0; i < CAMP.length; i++) if (!camp.cleared[CAMP[i].key]) return i; return CAMP.length - 1; };
  function resolveCampSquad(st) {
    if (st.mirror) return (camp.lastWin || squad).map((c) => c.slice());
    return st.squad.map((s) => (typeof s === "string" ? D.PRESETS[s].slice() : s.slice()));
  }
  const campEnemyForm = (st) => st.mirror ? (camp.lastWinForm || "散開") : st.form;
  function renderCampaign() {
    const strip = $("sqCampStrip"), info = $("sqCampInfo"); if (!strip || !info) return;
    strip.innerHTML = "";
    CAMP.forEach((st, i) => {
      const cleared = !!camp.cleared[st.key], unlocked = campUnlocked(i);
      const d = document.createElement("div");
      d.className = "camp-st" + (cleared ? " cleared" : "") + (!unlocked ? " locked" : "") + (i === campSel ? " sel" : "") + (i === campFrontier() && !cleared ? " current" : "");
      d.textContent = `${i + 1}. ${st.name} ${cleared ? "［済］" : unlocked ? "" : "［未開放］"}`;
      if (unlocked) d.onclick = () => { campSel = i; renderCampaign(); };
      strip.appendChild(d);
    });
    const st = CAMP[campSel];
    if (!st) { info.innerHTML = ""; return; }
    const sq = resolveCampSquad(st);
    const rows = sq.map((ch, i) => { const u = SCS.derive.buildUnit("U", ch), role = SCS.ui.styleOf(u); return `　敵${i + 1}：${u.ranged.name}＋${u.melee.name}（HP${u.maxHp}）／${role}`; }).join("<br>");
    info.innerHTML = `<b>${st.name}</b>${st.boss ? '　<span class="camp-boss">BOSS</span>' : ""}　${st.flavor}<br>` +
      `偵察：${st.scout}<br>教訓：${st.lesson}<br>` +
      `ホーム：${st.arena}${st.mod !== "通常" ? "・" + st.mod : ""}・敵隊形〔${st.mirror ? (camp.lastWinForm || "散開") : st.form}〕<br>${rows}`;
  }
  function setPlayMode(m) {
    playMode = m;
    const fb = $("sqModeFree"), cb = $("sqModeCamp");
    if (fb) fb.classList.toggle("active", m === "free");
    if (cb) cb.classList.toggle("active", m === "camp");
    const campBox = $("sqCamp"); if (campBox) campBox.classList.toggle("hidden", m !== "camp");
    // 制圧戦＝戦場/戦況/敵は固定（セレクタを隠す）。隊形はプレイヤーの作戦＝常に選べる。
    for (const id of ["sqArena", "sqMod", "sqCpu"]) { const el = $(id); if (el && el.parentElement) el.parentElement.style.display = m === "camp" ? "none" : ""; }
    const ch = $("sqCpuHint"); if (ch) ch.style.display = m === "camp" ? "none" : "";
    if (m === "camp") { campSel = campFrontier(); renderCampaign(); }
    const pw = $("sqPredictWrap"); if (pw) pw.classList.add("hidden");
  }

  function fillSelect(id, opts, cur, on) {
    const sel = $(id); if (!sel) return; sel.innerHTML = "";
    opts.forEach((o) => { const e = document.createElement("option"); e.value = o; e.textContent = o; sel.appendChild(e); });
    sel.value = cur; sel.onchange = () => on(sel.value);
  }
  function buildDesign() {
    fillSelect("sqArena", ["ランダム"].concat(D.ARENAS.map((a) => a.name)), arena, (v) => (arena = v));
    fillSelect("sqMod", ["ランダム"].concat(D.MODIFIERS.map((m) => m.name)), mod, (v) => (mod = v));
    fillSelect("sqCpu", Object.keys(CPU_SQUADS).concat(["ランダム"]), cpuName, (v) => { cpuName = v; renderCpuHint(); });
    fillSelect("sqForm", D.FORMATIONS.map((f) => f.name), form, (v) => { form = v; renderFormHint(); });
    renderFormHint(); renderCpuHint();
    renderTabs(); renderDials(); renderRoster();
  }
  function renderCpuHint() { // 敵分隊の編成プレビュー（武器/HP）＝何と戦うか分かってカウンターを設計できる
    const el = $("sqCpuHint"); if (!el) return;
    if (cpuName === "ランダム") { el.textContent = "敵分隊：ランダム編成（毎回変化）"; return; }
    const names = CPU_SQUADS[cpuName] || [];
    const parts = names.map((n) => { const u = SCS.derive.buildUnit("U", D.PRESETS[n]); return `${n}〔${u.ranged.name}・HP${u.maxHp}〕`; });
    el.textContent = "▸ 敵「" + cpuName + "」＝ " + parts.join("　");
  }
  function renderFormHint() {
    const el = $("sqFormHint"); if (!el) return;
    const f = D.FORMATIONS.find((x) => x.name === form); el.textContent = f ? f.flavor : "";
  }
  function renderTabs() {
    // 旧：戦士1/2/3 の重複タブ → 廃止。ロスターのカード自体が選択UI。ここは「どの戦士を設計中か」の指標に置換。
    const t = $("sqTabs"); if (!t) return;
    const role = SCS.ui.styleOf(SCS.derive.buildUnit("P", squad[active]));
    t.innerHTML = `<span class="sqe-lead">設計中 ▸</span> <b>戦士${active + 1}</b> <span class="sqe-role">${role}</span><span class="sqe-hint">上のカードを選んで切替</span>`;
  }
  function renderDials() {
    $("sqBuildCard").innerHTML = SCS.ui.buildCardHtml(squad[active]);
    const wrap = $("sqDials"); wrap.innerHTML = "";
    const tog = document.createElement("button"); tog.type = "button"; tog.className = "dial-hints-tog";
    tog.textContent = hintsOn ? "▾ 各ダイヤルの効果を隠す" : "▸ 各ダイヤルが戦いに効く内容を見る";
    tog.onclick = () => { hintsOn = !hintsOn; renderDials(); };
    wrap.appendChild(tog);
    D.MACROS.forEach((mac, i) => {
      const row = document.createElement("div"); row.className = "macro";
      const label = document.createElement("label"); label.className = "macro-lbl"; label.textContent = mac.name; label.title = SCS.ui.macroHint(i);
      const sel = document.createElement("select");
      mac.poles.forEach((p, ci) => { const o = document.createElement("option"); o.value = ci; o.textContent = p; sel.appendChild(o); });
      sel.value = squad[active][i];
      sel.onchange = () => { squad[active][i] = parseInt(sel.value, 10); renderDials(); renderRoster(); renderTabs(); };
      row.appendChild(label); row.appendChild(sel);
      if (hintsOn) { const h = document.createElement("div"); h.className = "macro-hint"; h.textContent = SCS.ui.macroHint(i); row.appendChild(h); }
      wrap.appendChild(row);
    });
  }
  function renderRoster() {
    const r = $("sqRoster"); if (!r) return; r.innerHTML = "";
    for (let i = 0; i < SIZE; i++) {
      const u = SCS.derive.buildUnit("P-" + (i + 1), squad[i]), role = SCS.ui.styleOf(u);
      const tk = SCS.squadTank ? SCS.squadTank(squad[i]) : null; // 盾資質（目立つ×持ちこたえる）を設計時に可視化
      const shield = tk && tk.isTank ? `<span class="sqr-tank">盾</span>` : "";
      const d = document.createElement("div"); d.className = "sq-rmini" + (i === active ? " active" : "");
      d.title = "クリックで設計";
      d.innerHTML = `<span class="sqr-n">戦士${i + 1}${i === active ? ' <span class="sqr-edit">設計中</span>' : ''}</span><span class="sqr-role">${role}</span>${shield}<span class="sqr-w">${u.ranged.name}＋${u.melee.name}</span><span class="sqr-hp">HP${u.maxHp}</span>`;
      d.onclick = () => { active = i; renderTabs(); renderDials(); renderRoster(); };
      r.appendChild(d);
    }
  }

  function randomCpu(seed) {
    const r = SCS.makeRNG((seed ^ 0x1234567) >>> 0), names = Object.keys(D.PRESETS);
    return Array.from({ length: SIZE }, () => D.PRESETS[names[r.int(names.length)]]);
  }
  // 戦場ブリーフィング：出撃時に戦場の状況を詳細に描写（遮蔽の性質・地形効果・戦況）＝戦う前に盤面が読める
  const TERRAIN_DESC = {
    forest: "茂み＝身を隠して被弾を減らし回避も上がる（動きは鈍る・遠距離に強い）",
    rubble: "瓦礫＝被ダメを大きく減らす頑丈な盾（移動が重い）",
    swamp: "沼地＝足を取られて移動が激減し避けにくい罠地帯",
    highground: "高所＝見晴らしが良く命中が上がる、わずかに硬い好陣地",
    lava: "溶岩＝立つと毎ターン焼かれる即死級の危険地帯",
  };
  function battlefieldBriefing(b) {
    const out = [{ t: `>> 戦場：${b.arena.name} — ${b.arena.flavor}`, c: "arena" }];
    const obs = b.obstacles || [];
    if (!obs.length) out.push({ t: `　遮蔽物：なし。身を隠す壁は無く、開けた撃ち合いになる。`, c: "brief" });
    else {
      const big = obs.some((o) => Math.max(o.w, o.h) >= 14);
      const head = big
        ? `${obs.length}箇所（大きな壁あり）。人がすっぽり隠れ、間に入れば射線を完全に遮る`
        : `${obs.length}箇所（小〜中）。間に入れば射線は完全に切れるが、角度を変えられると撃たれる`;
      out.push({ t: `　遮蔽物：${head}。実体の壁＝通り抜け不可。撃ち込めば崩れ、壊れると射線が開く。`, c: "brief" });
    }
    if (b.baseTerrainKey && TERRAIN_DESC[b.baseTerrainKey]) out.push({ t: `　地形：全域が${TERRAIN_DESC[b.baseTerrainKey]}`, c: "brief" });
    const seen = {};
    for (const z of b.terrain || []) { if (z.t === b.baseTerrainKey || seen[z.t] || !TERRAIN_DESC[z.t]) continue; seen[z.t] = 1; out.push({ t: `　地形：${TERRAIN_DESC[z.t]}（局所的に点在）`, c: "brief" }); }
    if (b.modifier) out.push({ t: `>> 戦況：${b.modifier.name} — ${b.modifier.flavor}`, c: "arena" });
    if (b.formP && b.formP !== "loose") { const f = D.FORMATIONS.find((x) => x.key === b.formP); if (f) out.push({ t: `>> 隊形：${f.name} — ${f.flavor}`, c: "arena" }); }
    return out;
  }
  // 開戦時の布陣＝各ユニットの状況（武器/HP/役割＋盾/一匹狼/連携）。観測可能なラベルのみ（24小パラ数値は出さない）。
  function lineupLines(arr, side, label) {
    const out = [{ t: `>> ${label}`, c: "arena" }];
    arr.forEach((ch, i) => {
      const u = SCS.derive.buildUnit("U", ch), role = (SCS.ui && SCS.ui.styleOf) ? SCS.ui.styleOf(u) : "";
      const tk = SCS.squadTank ? SCS.squadTank(ch) : null, cp = SCS.squadCoop ? SCS.squadCoop(ch) : null;
      const tags = [tk && tk.isTank ? "盾" : "", cp && cp.isLoner ? "一匹狼" : (cp && cp.isTeam ? "連携型" : "")].filter(Boolean).join("・");
      const nm = side === "P" ? `戦士${i + 1}` : `敵${i + 1}`;
      out.push({ t: `　${nm}：${u.ranged.name}＋${u.melee.name}（HP${u.maxHp}）／${role}${tags ? "・" + tags : ""}`, c: "brief" });
    });
    return out;
  }
  function maybeShowLegendFirstRun() { // 初回だけ「見方（凡例）」を開いてレーダー記号を説明（以後は閉じておく）
    let seen = false; try { seen = localStorage.getItem("scs_sq_legend") === "1"; } catch (e) {}
    if (seen) return;
    const k = $("sqKey"); if (k) k.classList.remove("hidden");
    const kt = $("sqKeyTog"); if (kt) kt.textContent = "▾ 見方";
    try { localStorage.setItem("scs_sq_legend", "1"); } catch (e) {}
  }
  function sortie(fixedSeed) {
    const seed = fixedSeed != null ? (fixedSeed >>> 0) : (Math.floor(Math.random() * 0x7fffffff) >>> 0);
    lastSeed = seed; // 同条件で再戦できるよう保持（戦場/戦況/敵/隊形はseed由来なので同seedで完全再現）
    const reBtn = $("sqRematch"); if (reBtn) reBtn.style.display = "";
    const st = playMode === "camp" ? CAMP[campSel] : null;
    const cpuChoices = st ? resolveCampSquad(st) : (cpuName === "ランダム" ? randomCpu(seed) : CPU_SQUADS[cpuName].map((n) => D.PRESETS[n]));
    const enemyLabel = st ? st.name : (cpuName === "ランダム" ? "ランダム編成" : cpuName);
    battle = SCS.makeSquadBattle(squad.map((c) => c.slice()), cpuChoices.map((c) => c.slice()), seed,
      st ? st.arena : arena, st ? st.mod : mod, form, st ? campEnemyForm(st) : "ランダム");
    if (SCS.mini) SCS.mini.reset();
    $("squadDesign").classList.add("hidden");
    $("squadStage").classList.remove("hidden");
    maybeShowLegendFirstRun();
    $("sqArenaChip").textContent = battle.arena.name;
    const fc = $("sqFormChip"); if (fc) { const pf = battle.formP && battle.formP !== "loose" ? (D.FORMATIONS.find((f) => f.key === battle.formP) || {}).name : null; fc.textContent = pf ? ("陣形：" + pf) : ""; fc.style.display = pf ? "" : "none"; }
    const mc = $("sqModChip"); if (battle.modifier) { mc.textContent = battle.modifier.name; mc.style.display = ""; } else mc.style.display = "none";
    $("sqLog").innerHTML = "";
    if (st) append(`>> 制圧戦 第${campSel + 1}戦「${st.name}」${st.boss ? "【BOSS】" : ""} — ${st.flavor}`, "arena");
    for (const l of battlefieldBriefing(battle)) append(l.t, l.c);
    for (const l of lineupLines(squad, "P", "あなたの布陣")) append(l.t, l.c);
    for (const l of lineupLines(cpuChoices, "C", "敵の布陣（" + enemyLabel + "）")) append(l.t, l.c);
    append(`>> 分隊戦開始：あなた${SIZE}体 vs ${enemyLabel}（${SIZE}体）`, "sys");
    $("sqParamsWrap").classList.add("hidden");
    render();
  }
  // キャンペーンの勝利記録：クリア＋直近勝利編成（鏡ボスの素体）を保存
  function recordCampResult() {
    if (playMode !== "camp" || !battle || !battle.result) return;
    const st = CAMP[campSel]; if (!st) return;
    if (battle.result.winner !== "PLR") { append(`── 敗北——「${st.name}」は落とせなかった。編成を見直し、再び挑め。`, "sys"); return; }
    const first = !camp.cleared[st.key];
    camp.cleared[st.key] = true;
    camp.lastWin = squad.map((c) => c.slice()); camp.lastWinForm = form;
    saveCamp();
    if (first) campSel = campFrontier(); // 初制圧なら選択を次の戦場へ（設計に戻った時にそのまま挑める）
    const allDone = CAMP.every((s) => camp.cleared[s.key]);
    append(allDone ? `── 制圧完了！ 全${CAMP.length}戦場を制した——制圧戦、完遂。` : first ? `── 制圧！ 「${st.name}」を下した。次の戦場が開かれる。` : `── 再制圧——「${st.name}」に貫録を見せた。`, "arena");
  }

  function render() {
    if (!battle) return;
    if (SCS.mini) SCS.mini.syncSquad(battle, "miniSquad");
    $("sqTurn").textContent = `TURN ${battle.turn}`;
    renderHud();
  }
  function renderHud() {
    const teamHtml = (team, cls) => {
      const rows = team.map((u) => { const f = Math.max(0, Math.round((u.hp / u.maxHp) * 100)); const lbl = u.alive ? (u.label || "") : "—"; return `<div class="sqh-u ${u.alive ? "" : "down"}"><span class="sqh-n">${u.name}</span><div class="sqh-bar"><i style="width:${f}%"></i></div><span class="sqh-hp">${Math.max(0, u.hp)}</span><span class="sqh-lbl">${lbl}</span></div>`; }).join("");
      return `<div class="sqh-team ${cls}">${rows}</div>`;
    };
    $("sqHud").innerHTML = teamHtml(battle.teams.P, "plr") + `<div class="sqh-vs">VS</div>` + teamHtml(battle.teams.C, "cpu");
  }
  function append(text, cls) { const d = document.createElement("div"); d.className = "log-line " + (cls || ""); d.innerHTML = text; $("sqLog").appendChild(d); $("sqLog").scrollTop = $("sqLog").scrollHeight; }

  function nextStep() {
    if (!battle || battle.over) return;
    const r = battle.step();
    append(`━━ TURN ${r.turn} ━━`, "turnhdr");
    r.lines.forEach((l) => append(l.text, l.cls));
    if (SCS.mini) SCS.mini.pushFx(r.events);
    render();
    if (r.over) { stopAuto(); recordCampResult(); $("sqParamsWrap").classList.remove("hidden"); renderAnalysis(); }
  }
  function auto() { if (autoT) { stopAuto(); return; } $("sqAuto").textContent = "■ 停止"; autoT = setInterval(() => { if (!battle || battle.over) { stopAuto(); return; } nextStep(); }, 380); }
  function stopAuto() { if (autoT) { clearInterval(autoT); autoT = null; } const b = $("sqAuto"); if (b) b.textContent = "▶ 自動実行"; }

  function renderAnalysis() {
    if (!battle) return;
    const a = battle.getAnalysis();
    const col = (s, label, isP) => {
      const badge = a.over ? (a.result.type === "draw" ? `<span class="abadge draw">DRAW</span>` : (a.result.winner === (isP ? "PLR" : "CPU") ? `<span class="abadge win">WIN</span>` : `<span class="abadge lose">LOSE</span>`)) : "";
      let h = `<div class="acol"><h4>${label} ${badge}</h4>`;
      if (s.verdict) h += `<div class="averdict">${s.verdict}</div>`;
      h += `<div class="aweap">与ダメ計 ${s.dealt}／撃破 ${s.kills}／生存 ${s.survivors}/${s.cards.length}</div><table class="atab">`;
      for (const c of s.cards) { const tags = [c.counters ? "反撃" + c.counters : "", c.grabs ? "投げ" + c.grabs : "", c.wasFlanked ? "被側背" + c.wasFlanked : ""].filter(Boolean).join("・"); h += `<tr><td>${c.name}<span class="sqc-role">${c.role}</span></td><td>${c.alive ? "生存" : "T" + c.downTurn + "脱落"}・与${c.dealt}/被${c.taken}${c.kills ? "・撃破" + c.kills : ""}${tags ? "・" + tags : ""}</td></tr>`; }
      h += `</table>`;
      if (s.notes.length) h += `<div class="anotes"><b>戦評</b><ul>${s.notes.map((n) => `<li>${n}</li>`).join("")}</ul></div>`;
      if (s.advice && s.advice.length) h += `<div class="aadvice"><b>次の方向性</b><ul>${s.advice.map((n) => `<li class="adv-link" title="クリックで設計画面へ（該当ダイヤルを強調）">${n}</li>`).join("")}</ul></div>`;
      return h + `</div>`;
    };
    $("sqParams").innerHTML = `<div class="ameta">分隊戦：${a.arena}${a.mod ? "・" + a.mod : ""}・全${a.turns}ターン</div><div class="acols">${col(a.plr, "あなたの分隊", true)}${col(a.cpu, "敵分隊", false)}</div><p class="ahint">※ 役割の補完と相性を設計するのが分隊戦の肝。総評と「次の方向性」を手がかりに、人格のダイヤルを回して再設計しよう。</p>`;
  }

  function backToDesign() { stopAuto(); $("squadStage").classList.add("hidden"); $("squadDesign").classList.remove("hidden"); buildDesign(); if (playMode === "camp") renderCampaign(); }

  // ===== 勝率試算（設計→試算→出撃の閉ループ）：現在の編成×条件で固定seed20戦＝決定論の推定 =====
  function estimate() {
    const N = 20; let w = 0, l = 0, d = 0, tsum = 0;
    const st = playMode === "camp" ? CAMP[campSel] : null;
    for (let i = 0; i < N; i++) {
      const seed = (90210 + i * 7717) >>> 0;
      const cpuChoices = st ? resolveCampSquad(st) : (cpuName === "ランダム" ? randomCpu(seed) : CPU_SQUADS[cpuName].map((n) => D.PRESETS[n]));
      const b = SCS.makeSquadBattle(squad.map((c) => c.slice()), cpuChoices.map((c) => c.slice()), seed,
        st ? st.arena : arena, st ? st.mod : mod, form, st ? campEnemyForm(st) : "ランダム");
      let g = 0; while (!b.over && g < 60) { b.step(); g++; }
      tsum += g;
      const win = b.result && b.result.winner;
      if (win === "PLR") w++; else if (win === "CPU") l++; else d++;
    }
    const wrap = $("sqPredictWrap"); if (!wrap) return;
    const rate = Math.round((w / N) * 100);
    const vs = st ? `vs ${CAMP[campSel].name}` : `vs ${cpuName}`;
    wrap.innerHTML = `<div class="predict-line"><b>推定勝率 ${rate}%</b>（${w}勝${l}敗${d}分・平均${(tsum / N).toFixed(1)}ターン・${vs}）</div><div class="predict-sub">固定20戦の決定論推定。設計を変えて数字がどう動くか試そう。</div>`;
    wrap.classList.remove("hidden");
  }

  // ===== 分析→設計ディープリンク：「次の方向性」の〈大パラ名〉を該当ダイヤルへ（クリック→設計画面＋強調） =====
  const AXIS_ALIASES = [["闘争心", "攻め志向", "慎重"], ["リスク選好", "リスク"], ["冷静さ", "沈着"], ["忍耐", "待ち"], ["規律"], ["順応性", "順応", "観察"], ["誇り", "騎士道"], ["非情さ", "非情"], ["自信"], ["好奇心"]];
  function axesInText(t) { const out = []; AXIS_ALIASES.forEach((names, i) => { if (names.some((n) => t.includes("〈" + n) || t.includes(n + "〉") || t.includes("〈" + n + "（"))) out.push(i); }); return out; }
  function flashDials(axes) {
    const wrap = $("sqDials"); if (!wrap) return;
    axes.forEach((i) => { const row = wrap.children[i + 1]; if (row) { row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 3400); } });
    const first = wrap.children[(axes[0] || 0) + 1]; if (first && first.scrollIntoView) first.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  SCS.squad = {
    enter() { buildDesign(); $("squadStage").classList.add("hidden"); $("squadDesign").classList.remove("hidden"); },
    leave() { stopAuto(); },
  };
  function init() {
    $("sqSortie").addEventListener("click", () => sortie());
    { const rb = $("sqRematch"); if (rb) rb.addEventListener("click", () => { if (lastSeed != null) sortie(lastSeed); }); }
    { const fb = $("sqModeFree"); if (fb) fb.addEventListener("click", () => setPlayMode("free")); }
    { const cb = $("sqModeCamp"); if (cb) cb.addEventListener("click", () => setPlayMode("camp")); }
    { const pb = $("sqPredict"); if (pb) pb.addEventListener("click", estimate); }
    { const pp = $("sqParams"); if (pp) pp.addEventListener("click", (e) => { const li = e.target.closest ? e.target.closest("li.adv-link") : null; if (!li) return; const axes = axesInText(li.textContent || ""); backToDesign(); if (axes.length) flashDials(axes); }); }
    $("sqNext").addEventListener("click", nextStep);
    $("sqAuto").addEventListener("click", auto);
    $("sqAnalyze").addEventListener("click", () => { const w = $("sqParamsWrap"); w.classList.toggle("hidden"); if (!w.classList.contains("hidden")) renderAnalysis(); });
    $("sqBack").addEventListener("click", backToDesign);
    const kt = $("sqKeyTog"); if (kt) kt.addEventListener("click", () => { const k = $("sqKey"); k.classList.toggle("hidden"); kt.textContent = k.classList.contains("hidden") ? "▸ 見方" : "▾ 見方"; });
    const ct = $("sqConeTog"); if (ct) ct.addEventListener("click", () => { const on = !(SCS.mini && SCS.mini.conesOn && SCS.mini.conesOn()); if (SCS.mini && SCS.mini.setCones) SCS.mini.setCones(on); ct.textContent = on ? "視界 ON" : "視界 OFF"; ct.classList.toggle("on", on); render(); });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
