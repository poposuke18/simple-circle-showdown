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

  // ===== 設計の永続化＋命名＋通算戦績（愛着装置・[[クオリティ向上ロードマップ]]製品化スプリント①）=====
  const DESIGN_KEY = "scs_sq_design_v1", CAREER_KEY = "scs_sq_career_v1";
  let names = ["戦士1", "戦士2", "戦士3"];
  let career = [{ b: 0, w: 0, k: 0, d: 0 }, { b: 0, w: 0, k: 0, d: 0 }, { b: 0, w: 0, k: 0, d: 0 }]; // 出撃/勝利/撃破/脱落（スロット別）
  const sanitizeName = (s) => String(s || "").replace(/[<>&"'`\\]/g, "").trim().slice(0, 8);
  function loadDesign() {
    try { const j = JSON.parse(localStorage.getItem(DESIGN_KEY) || "null"); if (j && j.squad && j.squad.length === SIZE) { squad = j.squad.map((c) => c.slice()); if (j.names) names = j.names.map((n, i) => sanitizeName(n) || `戦士${i + 1}`); if (j.form) form = j.form; } } catch (e) {}
    try { const c = JSON.parse(localStorage.getItem(CAREER_KEY) || "null"); if (c && c.length === SIZE) career = c; } catch (e) {}
  }
  function saveDesign() { try { localStorage.setItem(DESIGN_KEY, JSON.stringify({ squad, names, form })); } catch (e) {} }
  function saveCareer() { try { localStorage.setItem(CAREER_KEY, JSON.stringify(career)); } catch (e) {} }
  function recordCareer() {
    if (!battle || !battle.result) return;
    const win = battle.result.winner === "PLR", lose = battle.result.winner === "CPU";
    const cards = battle.getAnalysis().plr.cards;
    cards.forEach((c, i) => { if (!career[i]) return; career[i].b++; if (win) career[i].w++; career[i].k += c.kills || 0; if (!c.alive) career[i].d++; });
    saveCareer();
    stats.b++; if (win) stats.w++; else if (lose) stats.l++; else stats.d++;
    saveStats();
  }
  const careerLine = (i) => { const s = career[i]; return s && s.b > 0 ? `${s.b}戦${s.w}勝・撃破${s.k}・脱落${s.d}` : "初陣を待つ"; };
  loadDesign();

  // ===== 挑戦モード：本日の挑戦（全員同条件のデイリーパズル）＋連勝闘技場（段階強化の連破）＋総合戦績 =====
  const CHAL_KEY = "scs_sq_chal_v1", STATS_KEY = "scs_sq_stats_v1";
  let chal = { daily: { lastClear: "", streak: 0 }, ladder: { streak: 0, best: 0 } };
  let stats = { b: 0, w: 0, l: 0, d: 0 };
  let chalKind = "daily"; // 出撃時にどちらの挑戦か
  try { const j = JSON.parse(localStorage.getItem(CHAL_KEY) || "null"); if (j && j.daily && j.ladder) chal = j; } catch (e) {}
  try { const j = JSON.parse(localStorage.getItem(STATS_KEY) || "null"); if (j && typeof j.b === "number") stats = j; } catch (e) {}
  const saveChal = () => { try { localStorage.setItem(CHAL_KEY, JSON.stringify(chal)); } catch (e) {} };
  const saveStats = () => { try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {} };
  const jstDate = (off) => new Date(Date.now() + 9 * 3600e3 - (off || 0) * 86400e3).toISOString().slice(0, 10);
  function dailyInfo() { // 日付→生成seed＝全プレイヤー同条件。戦闘seedも固定＝同じ敵を「設計で解く」パズル
    const dstr = jstDate(0), n = +dstr.replace(/-/g, "");
    const rng = SCS.makeRNG((n * 2654435761) >>> 0);
    const squad = Array.from({ length: SIZE }, () => Array.from({ length: 10 }, () => rng.int(4)));
    return { date: dstr, seed: (n ^ 0x5bd17e) >>> 0, squad, arena: D.ARENAS[rng.int(D.ARENAS.length)].name, mod: D.MODIFIERS[rng.int(D.MODIFIERS.length)].name, form: D.FORMATIONS[rng.int(D.FORMATIONS.length)].name };
  }
  function ladderOpponent(n) { // 連勝数の純関数＝プレビューと実戦が必ず一致
    const r = SCS.makeRNG((0xA11CE ^ (n * 7919)) >>> 0), P = D.PRESETS;
    const tiers = [
      () => ({ sq: ["中庸バランス", "かく乱の火付け", "海千山千の暗殺者"].map((x) => P[x].slice()), form: "散開", name: "寄せ集めの挑戦者" }),
      () => ({ sq: CPU_SQUADS["均衡分隊"].map((x) => P[x].slice()), form: "散開", name: "均衡分隊" }),
      () => ({ sq: CPU_SQUADS["撹乱分隊"].map((x) => P[x].slice()), form: "散開", name: "撹乱分隊" }),
      () => ({ sq: CPU_SQUADS["猛攻分隊"].map((x) => P[x].slice()), form: "楔", name: "猛攻分隊" }),
      () => ({ sq: CPU_SQUADS["鉄壁分隊"].map((x) => P[x].slice()), form: "散開", name: "鉄壁分隊" }),
    ];
    let pick;
    if (n < tiers.length) pick = tiers[n]();
    else { const pool = CAMP.filter((s) => !s.mirror); const st = pool[(n - tiers.length) % pool.length]; pick = { sq: st.squad.map((s) => (typeof s === "string" ? P[s].slice() : s.slice())), form: st.form, name: st.name }; }
    pick.arena = D.ARENAS[r.int(D.ARENAS.length)].name;
    pick.mod = n >= 8 ? D.MODIFIERS[r.int(D.MODIFIERS.length)].name : "通常";
    return pick;
  }
  function renderChal() {
    const el = $("sqChalInfo"); if (!el) return;
    const d = dailyInfo(), today = d.date, done = chal.daily.lastClear === today;
    const prev = (sq) => sq.map((ch, i) => { const u = SCS.derive.buildUnit("U", ch); return `　敵${i + 1}：${u.ranged.name}＋${u.melee.name}（HP${u.maxHp}）／${SCS.ui.styleOf(u)}`; }).join("<br>");
    const o = ladderOpponent(chal.ladder.streak);
    el.innerHTML =
      `<div class="chal-card"><b>本日の挑戦</b>　${today}　${done ? '<span class="chal-done">［制圧済］</span>' : '<span class="chal-open">［未制圧］</span>'}　連続 ${chal.daily.streak} 日<br>` +
      `全プレイヤー共通の一戦（同じ敵・同じ戦場・同じ乱数）。編成と隊形の設計だけで解く。<br>` +
      `ホーム：${d.arena}${d.mod !== "通常" ? "・" + d.mod : ""}・敵隊形〔${d.form}〕<br>${prev(d.squad)}<br>` +
      `<button id="sqDailyGo" class="btn primary" type="button">この一戦に挑む</button></div>` +
      `<div class="chal-card"><b>連勝闘技場</b>　現在 ${chal.ladder.streak} 連勝・最高 ${chal.ladder.best}<br>` +
      `勝つほど強い相手が現れる。敗北か引き分けで連勝は途切れる。<br>` +
      `次の相手：${o.name}（${o.arena}${o.mod !== "通常" ? "・" + o.mod : ""}・隊形〔${o.form}〕）<br>${prev(o.sq)}<br>` +
      `<button id="sqLadderGo" class="btn primary" type="button">第 ${chal.ladder.streak + 1} 戦に挑む</button></div>`;
    const dg = $("sqDailyGo"); if (dg) dg.onclick = () => { chalKind = "daily"; sortie(); };
    const lg = $("sqLadderGo"); if (lg) lg.onclick = () => { chalKind = "ladder"; sortie(); };
  }
  function recordChalResult() {
    if (playMode !== "chal" || !battle || !battle.result) return;
    const win = battle.result.winner === "PLR";
    if (chalKind === "daily") {
      const today = jstDate(0);
      if (win && chal.daily.lastClear !== today) { chal.daily.streak = chal.daily.lastClear === jstDate(1) ? chal.daily.streak + 1 : 1; chal.daily.lastClear = today; saveChal(); append(`── 本日の挑戦、制圧！ 連続 ${chal.daily.streak} 日目。また明日。`, "arena"); }
      else if (win) append(`── 本日はすでに制圧済み——貫録の再演。`, "sys");
      else append(`── 敗北——設計を変えて解き直せ（敵も乱数も毎回同じ＝腕の問題だ）。`, "sys");
    } else {
      if (win) { chal.ladder.streak++; chal.ladder.best = Math.max(chal.ladder.best, chal.ladder.streak); saveChal(); append(`── ${chal.ladder.streak} 連勝！ 次はさらに強い。`, "arena"); }
      else { const was = chal.ladder.streak; chal.ladder.streak = 0; saveChal(); append(`── 連勝が ${was} で途絶えた。最初から登り直せ。`, "sys"); }
    }
  }
  function renderRecords() {
    const el = $("sqRecordsPanel"); if (!el) return;
    const wr = stats.b ? Math.round((stats.w / stats.b) * 100) : 0;
    const campN = CAMP.filter((s) => camp.cleared[s.key]).length;
    el.innerHTML = `<b>総合戦績</b>　${stats.b}戦 ${stats.w}勝${stats.l}敗${stats.d}分（勝率${wr}%）<br>` +
      `制圧戦 ${campN}/${CAMP.length}　｜　本日の挑戦 連続${chal.daily.streak}日（最終 ${chal.daily.lastClear || "—"}）　｜　闘技場 最高${chal.ladder.best}連勝<br>` +
      names.map((n, i) => `　${n}：${careerLine(i)}`).join("<br>") +
      `<div class="rec-io"><button id="sqExport" class="btn ghost small" type="button">データを書き出す</button><button id="sqImport" class="btn ghost small" type="button">データを読み込む</button></div>`;
    const ex = $("sqExport"); if (ex) ex.onclick = () => { const dump = {}; for (const k of [DESIGN_KEY, CAREER_KEY, CHAL_KEY, STATS_KEY, CAMP_KEY]) { const v = localStorage.getItem(k); if (v) dump[k] = v; } copyText(JSON.stringify(dump), ex, "書き出した"); };
    const im = $("sqImport"); if (im) im.onclick = () => { const t = prompt("書き出したデータを貼り付け"); if (!t) return; try { const j = JSON.parse(t); for (const k in j) if (/^scs_/.test(k)) localStorage.setItem(k, j[k]); location.reload(); } catch (e) { im.textContent = "読み込み失敗"; setTimeout(() => (im.textContent = "データを読み込む"), 1600); } };
  }

  // ===== 分隊コード＋リプレイURL（決定論＝コード＋seedだけで同一戦闘を完全再現・サーバー不要の共有）=====
  const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
  function encodeSquad(sq, formName) {
    let v = 0n;
    for (const ch of sq) for (const c of ch) v = v * 4n + BigInt(c & 3);
    const fi = Math.max(0, D.FORMATIONS.findIndex((f) => f.name === formName || f.key === formName));
    v = v * 4n + BigInt(fi);
    let s = ""; if (v === 0n) s = "0"; while (v > 0n) { s = B36[Number(v % 36n)] + s; v /= 36n; }
    return "S1" + s;
  }
  function decodeSquad(code) {
    if (!code || !/^S1[0-9a-z]+$/.test(code = String(code).trim().toLowerCase().replace(/^s1/, "S1"))) return null;
    let v = 0n; for (const ch of code.slice(2)) { const d = B36.indexOf(ch); if (d < 0) return null; v = v * 36n + BigInt(d); }
    const fi = Number(v % 4n); v /= 4n;
    const digits = []; for (let i = 0; i < 30; i++) { digits.unshift(Number(v % 4n)); v /= 4n; }
    if (v !== 0n) return null; // 桁あふれ＝不正コード
    const sq = [digits.slice(0, 10), digits.slice(10, 20), digits.slice(20, 30)];
    return { squad: sq, form: (D.FORMATIONS[fi] || D.FORMATIONS[0]).name };
  }
  function copyText(t, btn, done) {
    const ok = () => { if (btn) { const o = btn.textContent; btn.textContent = done || "コピーした"; setTimeout(() => (btn.textContent = o), 1400); } };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(ok, () => prompt("コピーしてください", t)); return; } } catch (e) {}
    prompt("コピーしてください", t);
  }
  let lastBattleParams = null; // 共有URL用（実際に解決された条件を保持）
  let isDemo = false;          // 観戦デモ中は戦績/進行に記録しない

  // ===== 初回デモ（30秒のワオ）：厳選した決定論シードの一戦を自動再生（seed52/中央遮蔽＝5撃破・奇襲・必殺KO・12T）=====
  const DEMO_KEY = "scs_sq_demo_v1";
  function runDemo() {
    try { localStorage.setItem(DEMO_KEY, "1"); } catch (e) {}
    const db = $("sqDemo"); if (db && db.parentElement) db.parentElement.style.display = "none";
    isDemo = true;
    const p = ["重剣の闘士", "鉄律の射手", "海千山千の暗殺者"].map((n) => D.PRESETS[n].slice());
    const e = ["猪突ガラスキャノン", "重剣の闘士", "海千山千の暗殺者"].map((n) => D.PRESETS[n].slice());
    battle = SCS.makeSquadBattle(p, e, 52, "中央遮蔽", "通常", "散開", "楔", ["ガロ", "レイ", "カゲ"]);
    lastSeed = 52; lastBattleParams = { p, e, seed: 52, arenaName: "中央遮蔽", modName: "通常", formP: battle.formP, formC: battle.formC };
    if (SCS.mini) SCS.mini.reset();
    $("squadDesign").classList.add("hidden");
    $("squadStage").classList.remove("hidden");
    $("sqArenaChip").textContent = battle.arena.name;
    $("sqLog").innerHTML = "";
    append(">> 観戦デモ — これがS.C.S.。人格と隊形を設計したら、あとは観るだけ。", "arena");
    for (const l of battlefieldBriefing(battle)) append(l.t, l.c);
    $("sqParamsWrap").classList.add("hidden");
    render();
    speedIdx = 1; const sb = $("sqSpeed"); if (sb) sb.textContent = "速度 ×2";
    auto();
  }
  function buildShareURL() {
    if (!lastBattleParams) return null;
    const p = lastBattleParams;
    const ai = D.ARENAS.findIndex((a) => a.name === p.arenaName), mi = D.MODIFIERS.findIndex((m) => m.name === p.modName);
    const fp = Math.max(0, D.FORMATIONS.findIndex((f) => f.key === p.formP)), fc = Math.max(0, D.FORMATIONS.findIndex((f) => f.key === p.formC));
    const base = location.origin + location.pathname;
    return `${base}?r=1.${encodeSquad(p.p, D.FORMATIONS[fp].name)}.${encodeSquad(p.e, D.FORMATIONS[fc].name)}.${p.seed.toString(36)}.${Math.max(0, ai)}.${Math.max(0, mi)}`;
  }
  function parseReplayURL() {
    try {
      const m = /[?&]r=([^&]+)/.exec(location.search); if (!m) return null;
      const parts = decodeURIComponent(m[1]).split("."); if (parts[0] !== "1" || parts.length < 6) return null;
      const pd = decodeSquad(parts[1]), ed = decodeSquad(parts[2]); if (!pd || !ed) return null;
      const seed = parseInt(parts[3], 36) >>> 0, ai = +parts[4] | 0, mi = +parts[5] | 0;
      const arenaName = (D.ARENAS[ai] || D.ARENAS[0]).name, modName = (D.MODIFIERS[mi] || D.MODIFIERS[0]).name;
      return { p: pd.squad, e: ed.squad, pForm: pd.form, eForm: ed.form, seed, arenaName, modName };
    } catch (e) { return null; }
  }
  function startReplay(rp) {
    battle = SCS.makeSquadBattle(rp.p.map((c) => c.slice()), rp.e.map((c) => c.slice()), rp.seed, rp.arenaName, rp.modName, rp.pForm, rp.eForm);
    lastSeed = rp.seed; lastBattleParams = { p: rp.p, e: rp.e, seed: rp.seed, arenaName: rp.arenaName, modName: rp.modName, formP: battle.formP, formC: battle.formC };
    if (SCS.mini) SCS.mini.reset();
    $("squadDesign").classList.add("hidden");
    $("squadStage").classList.remove("hidden");
    $("sqArenaChip").textContent = battle.arena.name;
    $("sqLog").innerHTML = "";
    append(`>> 共有リプレイ — この一戦は送り主と完全に同じ経過をたどる（決定論）。`, "arena");
    for (const l of battlefieldBriefing(battle)) append(l.t, l.c);
    $("sqParamsWrap").classList.add("hidden");
    render();
  }

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
    const btns = { free: $("sqModeFree"), camp: $("sqModeCamp"), chal: $("sqModeChal") };
    for (const k in btns) if (btns[k]) btns[k].classList.toggle("active", m === k);
    const campBox = $("sqCamp"); if (campBox) campBox.classList.toggle("hidden", m !== "camp");
    const chalBox = $("sqChal"); if (chalBox) chalBox.classList.toggle("hidden", m !== "chal");
    // 制圧戦/挑戦＝戦場/戦況/敵は固定（セレクタを隠す）。隊形はプレイヤーの作戦＝常に選べる。
    for (const id of ["sqArena", "sqMod", "sqCpu"]) { const el = $(id); if (el && el.parentElement) el.parentElement.style.display = m === "free" ? "" : "none"; }
    const ch = $("sqCpuHint"); if (ch) ch.style.display = m === "free" ? "" : "none";
    const so = $("sqSortie"); if (so) so.style.display = m === "chal" ? "none" : ""; // 挑戦は各カードの出撃ボタンから
    if (m === "camp") { campSel = campFrontier(); renderCampaign(); }
    if (m === "chal") renderChal();
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
    fillSelect("sqForm", D.FORMATIONS.map((f) => f.name), form, (v) => { form = v; saveDesign(); renderFormHint(); });
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
    const t = $("sqTabs"); if (!t) return;
    const role = SCS.ui.styleOf(SCS.derive.buildUnit("P", squad[active]));
    t.innerHTML = `<span class="sqe-lead">設計中 ▸</span> <input id="sqNameIn" class="sq-name-in" maxlength="8" value="${names[active]}" title="この戦士に名前を付ける（8字まで）"> <span class="sqe-role">${role}</span><span class="sqe-career">${careerLine(active)}</span><span class="sqe-hint">上のカードを選んで切替</span>`;
    const ni = $("sqNameIn");
    if (ni) ni.onchange = () => { names[active] = sanitizeName(ni.value) || `戦士${active + 1}`; ni.value = names[active]; saveDesign(); renderRoster(); };
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
      sel.onchange = () => { squad[active][i] = parseInt(sel.value, 10); saveDesign(); renderDials(); renderRoster(); renderTabs(); };
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
      d.innerHTML = `<span class="sqr-n">${names[i]}${i === active ? ' <span class="sqr-edit">設計中</span>' : ''}</span><span class="sqr-role">${role}</span>${shield}<span class="sqr-w">${u.ranged.name}＋${u.melee.name}</span><span class="sqr-hp">HP${u.maxHp}</span><span class="sqr-career">${careerLine(i)}</span>`;
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
      const nm = side === "P" ? names[i] : `敵${i + 1}`;
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
    isDemo = false;
    let seed = fixedSeed != null ? (fixedSeed >>> 0) : (Math.floor(Math.random() * 0x7fffffff) >>> 0);
    // モード別の対戦条件（enemy/戦場/戦況/敵隊形/ヘッダ行）
    let cpuChoices, bArena, bMod, formC, enemyLabel, headLine = null;
    if (playMode === "camp") {
      const st = CAMP[campSel];
      cpuChoices = resolveCampSquad(st); bArena = st.arena; bMod = st.mod; formC = campEnemyForm(st); enemyLabel = st.name;
      headLine = `>> 制圧戦 第${campSel + 1}戦「${st.name}」${st.boss ? "【BOSS】" : ""} — ${st.flavor}`;
    } else if (playMode === "chal" && chalKind === "daily") {
      const d = dailyInfo();
      seed = d.seed; // ★全プレイヤー・毎回同一＝敵も乱数も固定の「設計パズル」
      cpuChoices = d.squad.map((c) => c.slice()); bArena = d.arena; bMod = d.mod; formC = d.form; enemyLabel = "本日の挑戦";
      headLine = `>> 本日の挑戦（${d.date}）— 全プレイヤー共通の一戦。敵も乱数も同じ＝設計で解け。`;
    } else if (playMode === "chal") {
      const o = ladderOpponent(chal.ladder.streak);
      cpuChoices = o.sq.map((c) => c.slice()); bArena = o.arena; bMod = o.mod; formC = o.form; enemyLabel = o.name;
      headLine = `>> 連勝闘技場 第${chal.ladder.streak + 1}戦 — ${o.name}`;
    } else {
      cpuChoices = cpuName === "ランダム" ? randomCpu(seed) : CPU_SQUADS[cpuName].map((n) => D.PRESETS[n]);
      bArena = arena; bMod = mod; formC = "ランダム"; enemyLabel = cpuName === "ランダム" ? "ランダム編成" : cpuName;
    }
    lastSeed = seed;
    const reBtn = $("sqRematch"); if (reBtn) reBtn.style.display = (playMode === "free" || playMode === "camp") ? "" : "none"; // 挑戦は再戦で記録が歪むため隠す
    battle = SCS.makeSquadBattle(squad.map((c) => c.slice()), cpuChoices.map((c) => c.slice()), seed, bArena, bMod, form, formC, names.slice());
    lastBattleParams = { p: squad.map((c) => c.slice()), e: cpuChoices.map((c) => c.slice()), seed, arenaName: battle.arena.name, modName: battle.modifier ? battle.modifier.name : "通常", formP: battle.formP, formC: battle.formC };
    if (SCS.mini) SCS.mini.reset();
    $("squadDesign").classList.add("hidden");
    $("squadStage").classList.remove("hidden");
    maybeShowLegendFirstRun();
    $("sqArenaChip").textContent = battle.arena.name;
    const fc = $("sqFormChip"); if (fc) { const pf = battle.formP && battle.formP !== "loose" ? (D.FORMATIONS.find((f) => f.key === battle.formP) || {}).name : null; fc.textContent = pf ? ("陣形：" + pf) : ""; fc.style.display = pf ? "" : "none"; }
    const mc = $("sqModChip"); if (battle.modifier) { mc.textContent = battle.modifier.name; mc.style.display = ""; } else mc.style.display = "none";
    $("sqLog").innerHTML = "";
    if (headLine) append(headLine, "arena");
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
    if (!battle || battle.over) return null;
    const r = battle.step();
    append(`━━ TURN ${r.turn} ━━`, "turnhdr");
    r.lines.forEach((l) => append(l.text, l.cls));
    if (SCS.mini) SCS.mini.pushFx(r.events);
    if (r.kos > 0) koFlash(); // KOの緩急（表示のみ）
    render();
    if (r.over) {
      stopAuto();
      if (isDemo) { append(">> デモ終了 — 次はあなたの分隊を設計する番だ（名前も付けられる）。", "arena"); isDemo = false; }
      else { recordCareer(); recordCampResult(); recordChalResult(); }
      $("sqParamsWrap").classList.remove("hidden"); renderAnalysis();
    }
    return r;
  }
  function koFlash() { const cv = $("miniSquad"); if (!cv || !cv.classList) return; cv.classList.remove("koflash"); void (cv.offsetWidth); cv.classList.add("koflash"); setTimeout(() => cv.classList.remove("koflash"), 650); }
  // 自動再生：速度×1/×2/×4＋KOターンは約2.4倍の間＝山場で息を呑む間を作る
  const SPEEDS = [380, 190, 95];
  let speedIdx = 0;
  function cycleSpeed() { speedIdx = (speedIdx + 1) % SPEEDS.length; const b = $("sqSpeed"); if (b) b.textContent = `速度 ×${[1, 2, 4][speedIdx]}`; }
  function auto() {
    if (autoT) { stopAuto(); return; }
    $("sqAuto").textContent = "■ 停止";
    const tick = () => {
      if (!battle || battle.over) { stopAuto(); return; }
      const r = nextStep();
      const delay = SPEEDS[speedIdx] * (r && r.kos > 0 ? 2.4 : 1);
      autoT = setTimeout(tick, delay);
    };
    autoT = setTimeout(tick, SPEEDS[speedIdx]);
  }
  function stopAuto() { if (autoT) { clearTimeout(autoT); autoT = null; } const b = $("sqAuto"); if (b) b.textContent = "▶ 自動実行"; }
  function skipToEnd() { stopAuto(); let g = 0; while (battle && !battle.over && g < 200) { nextStep(); g++; } }

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

  function backToDesign() { stopAuto(); $("squadStage").classList.add("hidden"); $("squadDesign").classList.remove("hidden"); buildDesign(); if (playMode === "camp") renderCampaign(); if (playMode === "chal") renderChal(); }

  // ===== 勝率試算（設計→試算→出撃の閉ループ）：現在の編成×条件で固定seed20戦＝決定論の推定 =====
  function estimate() {
    const wrap = $("sqPredictWrap"); if (!wrap) return;
    if (playMode === "chal" && chalKind === "daily") { // デイリーは敵も乱数も固定＝その一戦を1回走らせて判定
      const dd = dailyInfo();
      const b = SCS.makeSquadBattle(squad.map((c) => c.slice()), dd.squad.map((c) => c.slice()), dd.seed, dd.arena, dd.mod, form, dd.form);
      let g = 0; while (!b.over && g < 60) { b.step(); g++; }
      const win = b.result && b.result.winner === "PLR";
      wrap.innerHTML = `<div class="predict-line"><b>この設計は${win ? "解ける" : "敗れる"}</b>（${g}ターン・vs 本日の挑戦）</div><div class="predict-sub">本日の一戦は敵も乱数も固定＝設計だけが変数。</div>`;
      wrap.classList.remove("hidden"); return;
    }
    const N = 20; let w = 0, l = 0, d = 0, tsum = 0;
    const st = playMode === "camp" ? CAMP[campSel] : null;
    const lo = playMode === "chal" ? ladderOpponent(chal.ladder.streak) : null;
    for (let i = 0; i < N; i++) {
      const seed = (90210 + i * 7717) >>> 0;
      const cpuChoices = st ? resolveCampSquad(st) : lo ? lo.sq : (cpuName === "ランダム" ? randomCpu(seed) : CPU_SQUADS[cpuName].map((n) => D.PRESETS[n]));
      const b = SCS.makeSquadBattle(squad.map((c) => c.slice()), cpuChoices.map((c) => c.slice()), seed,
        st ? st.arena : lo ? lo.arena : arena, st ? st.mod : lo ? lo.mod : mod, form, st ? campEnemyForm(st) : lo ? lo.form : "ランダム");
      let g = 0; while (!b.over && g < 60) { b.step(); g++; }
      tsum += g;
      const win = b.result && b.result.winner;
      if (win === "PLR") w++; else if (win === "CPU") l++; else d++;
    }
    const rate = Math.round((w / N) * 100);
    const vs = st ? `vs ${CAMP[campSel].name}` : lo ? `vs ${lo.name}（次の相手）` : `vs ${cpuName}`;
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
    { const xb = $("sqModeChal"); if (xb) xb.addEventListener("click", () => setPlayMode("chal")); }
    { const rb = $("sqRecords"); if (rb) rb.addEventListener("click", () => { const p = $("sqRecordsPanel"); if (!p) return; const show = p.classList.contains("hidden"); p.classList.toggle("hidden", !show); if (show) renderRecords(); }); }
    { const pb = $("sqPredict"); if (pb) pb.addEventListener("click", estimate); }
    { const pp = $("sqParams"); if (pp) pp.addEventListener("click", (e) => { const li = e.target.closest ? e.target.closest("li.adv-link") : null; if (!li) return; const axes = axesInText(li.textContent || ""); backToDesign(); if (axes.length) flashDials(axes); }); }
    { const cc = $("sqCodeCopy"); if (cc) cc.addEventListener("click", () => copyText(encodeSquad(squad, form), cc)); }
    { const cl = $("sqCodeLoad"); if (cl) cl.addEventListener("click", () => { const code = prompt("分隊コードを貼り付け（S1…）"); if (!code) return; const d = decodeSquad(code); if (!d) { cl.textContent = "コードが不正"; setTimeout(() => (cl.textContent = "コードを読み込む"), 1600); return; } squad = d.squad.map((c) => c.slice()); form = d.form; saveDesign(); buildDesign(); cl.textContent = "読み込んだ"; setTimeout(() => (cl.textContent = "コードを読み込む"), 1400); }); }
    { const sb = $("sqShare"); if (sb) sb.addEventListener("click", () => { const url = buildShareURL(); if (url) copyText(url, sb, "URLをコピーした"); }); }
    { const db = $("sqDemo"); if (db) { let seen = false; try { seen = localStorage.getItem(DEMO_KEY) === "1"; } catch (e) {} if (seen && db.parentElement) db.parentElement.style.display = "none"; db.addEventListener("click", runDemo); } }
    { const rp = parseReplayURL(); if (rp) setTimeout(() => { const tb = $("tabSquad"); if (tb && tb.click) tb.click(); startReplay(rp); }, 0); }
    $("sqNext").addEventListener("click", nextStep);
    $("sqAuto").addEventListener("click", auto);
    { const sp = $("sqSpeed"); if (sp) sp.addEventListener("click", cycleSpeed); }
    { const sk = $("sqSkip"); if (sk) sk.addEventListener("click", skipToEnd); }
    $("sqAnalyze").addEventListener("click", () => { const w = $("sqParamsWrap"); w.classList.toggle("hidden"); if (!w.classList.contains("hidden")) renderAnalysis(); });
    $("sqBack").addEventListener("click", backToDesign);
    const kt = $("sqKeyTog"); if (kt) kt.addEventListener("click", () => { const k = $("sqKey"); k.classList.toggle("hidden"); kt.textContent = k.classList.contains("hidden") ? "▸ 見方" : "▾ 見方"; });
    const ct = $("sqConeTog"); if (ct) ct.addEventListener("click", () => { const on = !(SCS.mini && SCS.mini.conesOn && SCS.mini.conesOn()); if (SCS.mini && SCS.mini.setCones) SCS.mini.setCones(on); ct.textContent = on ? "視界 ON" : "視界 OFF"; ct.classList.toggle("on", on); render(); });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
