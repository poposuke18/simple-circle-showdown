/* lineageui.js — 系譜モードのUI（始祖設計→個体群を興す→世代を進める→観察）。[[系譜モード設計]]
 * エンジンは SCS.lineage（js/lineage.js）。squad.jsの makeSquadBattle をそのまま適応度テストに使う。
 * 勝敗でなく「何が生き残るか」を見せる＝非公開ラインは squad.js と同じ（HP/武器/役割/大パラ名のみ）。
 */
window.SCS = window.SCS || {};

(function () {
  const D = SCS.DATA, L = SCS.lineage, $ = (id) => document.getElementById(id);
  const AXIS_NAMES = D.MACROS.map((m) => m.name);

  // ===== 始祖設計の状態 =====
  let founders = [[2, 1, 2, 1, 2, 2, 2, 1, 1, 1]]; // 既定1体（中庸）。0〜3体まで増減可
  let activeFounder = 0;
  let hintsOn = true;

  // ===== 個体群の状態（永続化） =====
  const POP_KEY = "scs_ln_pop_v1";
  let run = null; // { seed, genIdx, pop, env, headlineLog, otherLog, events: [str,...], wildcardWatch: {name,gen}|null }
  function loadRun() { try { const j = JSON.parse(localStorage.getItem(POP_KEY) || "null"); if (j && j.pop && j.pop.length === L.POP) run = j; } catch (e) {} }
  function saveRun() { try { localStorage.setItem(POP_KEY, JSON.stringify(run)); } catch (e) {} }
  function clearRun() { run = null; try { localStorage.removeItem(POP_KEY); } catch (e) {} }
  loadRun();

  // ===== 始祖設計画面 =====
  function renderFounderRoster() {
    const r = $("lnFounderRoster"); if (!r) return; r.innerHTML = "";
    founders.forEach((ch, i) => {
      const u = SCS.derive.buildUnit("F", ch), role = SCS.ui.styleOf(u);
      const d = document.createElement("div"); d.className = "sq-rmini" + (i === activeFounder ? " active" : "");
      d.title = "クリックで設計";
      d.innerHTML = `<span class="sqr-n">始祖${i + 1}${i === activeFounder ? ' <span class="sqr-edit">設計中</span>' : ""}</span><span class="sqr-role">${role}</span><span class="sqr-w">${u.ranged.name}＋${u.melee.name}</span><span class="sqr-hp">HP${u.maxHp}</span>`;
      d.onclick = () => { activeFounder = i; renderFounderRoster(); renderFounderTabs(); renderFounderDials(); };
      r.appendChild(d);
    });
    const addBtn = $("lnAddFounder"); if (addBtn) addBtn.disabled = founders.length >= 3;
    const rmBtn = $("lnRemoveFounder"); if (rmBtn) rmBtn.disabled = founders.length <= 0;
  }
  function renderFounderTabs() {
    const t = $("lnFounderTabs"); if (!t) return;
    if (!founders.length) { t.innerHTML = `<span class="sqe-lead">始祖を設計しない ▸</span><span class="sqe-hint">残り12体は全てランダムから始まる</span>`; return; }
    const u = SCS.derive.buildUnit("F", founders[activeFounder]), role = SCS.ui.styleOf(u);
    t.innerHTML = `<span class="sqe-lead">設計中 ▸</span> <b>始祖${activeFounder + 1}</b> <span class="sqe-role">${role}</span><span class="sqe-hint">上のカードを選んで切替</span>`;
  }
  function renderFounderDials() {
    const bc = $("lnBuildCard"); if (bc) bc.innerHTML = founders.length ? SCS.ui.buildCardHtml(founders[activeFounder]) : "";
    const wrap = $("lnDials"); if (!wrap) return; wrap.innerHTML = "";
    if (!founders.length) return;
    const tog = document.createElement("button"); tog.type = "button"; tog.className = "dial-hints-tog";
    tog.textContent = hintsOn ? "▾ 各ダイヤルの効果を隠す" : "▸ 各ダイヤルが戦いに効く内容を見る";
    tog.onclick = () => { hintsOn = !hintsOn; renderFounderDials(); };
    wrap.appendChild(tog);
    D.MACROS.forEach((mac, i) => {
      const row = document.createElement("div"); row.className = "macro";
      const label = document.createElement("label"); label.className = "macro-lbl"; label.textContent = mac.name; label.title = SCS.ui.macroHint(i);
      const sel = document.createElement("select");
      mac.poles.forEach((p, ci) => { const o = document.createElement("option"); o.value = ci; o.textContent = p; sel.appendChild(o); });
      sel.value = founders[activeFounder][i];
      sel.onchange = () => { founders[activeFounder][i] = parseInt(sel.value, 10); renderFounderDials(); renderFounderRoster(); };
      row.appendChild(label); row.appendChild(sel);
      if (hintsOn) { const h = document.createElement("div"); h.className = "macro-hint"; h.textContent = SCS.ui.macroHint(i); row.appendChild(h); }
      wrap.appendChild(row);
    });
  }
  function buildGenesisScreen() {
    activeFounder = Math.min(activeFounder, Math.max(0, founders.length - 1));
    renderFounderRoster(); renderFounderTabs(); renderFounderDials();
  }

  // ===== 世代進行：個体群パネル =====
  const barHtml = (label, frac, extra) => `<div class="ln-bar-row"><span class="ln-bar-lbl">${label}</span><div class="ln-bar"><i style="width:${Math.max(0, Math.min(100, frac * 100))}%"></i></div>${extra || ""}</div>`;
  function renderPopPanel() {
    const el = $("lnPopPanel"); if (!el || !run) return;
    const avg = L.traitAverages(run.pop);
    const traitBars = avg.map((v, i) => barHtml(AXIS_NAMES[i], v / 3, `<span class="ln-bar-val">${v.toFixed(1)}</span>`)).join("");
    const lineageCounts = {}; run.pop.forEach((u) => (lineageCounts[u.lineageName] = (lineageCounts[u.lineageName] || 0) + 1));
    const dominant = Object.entries(lineageCounts).sort((a, b) => b[1] - a[1])[0];
    const roster = run.pop.map((u) => {
      const gen = u.gen, tag = gen > 0 ? `${u.lineageName}${gen}世` : u.lineageName;
      return `<span class="ln-indiv">${tag}</span>`;
    }).join(" ");
    el.innerHTML = `<b>個体群（第${run.genIdx}世代）</b>　${run.pop.length}体<br>${traitBars}<div class="ln-roster">${roster}</div>` +
      `<div class="ln-dominant">最大血統：${dominant[0]}（${dominant[1]}/${run.pop.length}体）</div>`;
  }
  function renderEvents() {
    const el = $("lnEventsPanel"); if (!el || !run) return;
    const recent = (run.events || []).slice(-8).reverse();
    el.innerHTML = `<b>群れの記録</b><ul class="ln-ev-list">${recent.map((e) => `<li>${e}</li>`).join("") || "<li>まだ何も起きていない。</li>"}</ul>`;
  }
  function renderHeadline() {
    const wrap = $("lnHeadline"); if (!wrap || !run) return;
    wrap.innerHTML = "";
    const append = (text, cls) => { const d = document.createElement("div"); d.className = "log-line " + (cls || ""); d.innerHTML = text; wrap.appendChild(d); };
    if (!run.headlineLog) { append("次の世代へ進むと、見出し戦の詳細がここに表示される。", "dim"); return; }
    append(`>> 見出し戦：${run.headlineLog.arena}${run.headlineLog.mod ? "・" + run.headlineLog.mod : ""}　${run.headlineLog.namesA.join("・")} vs ${run.headlineLog.namesB.join("・")}`, "arena");
    run.headlineLog.lines.forEach((l) => append(l.text, l.cls));
    if (run.otherLog) append(`── もう一戦：${run.otherLog.summary}`, "sys");
  }

  // ===== 特筆イベントの検出（観測可能な事実のみ・非公開ラインを出さない）=====
  function detectEvents(prevAvg, nextAvg, breedResult, genIdx) {
    const out = [];
    if (prevAvg) {
      AXIS_NAMES.forEach((name, i) => {
        const before = prevAvg[i], after = nextAvg[i];
        if (Math.abs(after - before) >= 0.6) out.push(`「${name}」が世代${genIdx}で大きく動いた（${before.toFixed(1)} → ${after.toFixed(1)}）。`);
        else if (after <= 0.15 && before > 0.15) out.push(`「${name}」が個体群からほぼ消えた。`);
        else if (after >= 2.85 && before < 2.85) out.push(`「${name}」が個体群全体に行き渡った。`);
      });
    }
    const lineageCounts = {}; breedResult.next.forEach((u) => (lineageCounts[u.lineageName] = (lineageCounts[u.lineageName] || 0) + 1));
    const dom = Object.entries(lineageCounts).sort((a, b) => b[1] - a[1])[0];
    if (dom && dom[1] >= 7) out.push(`血統「${dom[0]}」が個体群の過半（${dom[1]}/${L.POP}）を占めた。`);
    if (run.wildcardWatch) {
      const stillHere = breedResult.next.some((u) => u.lineageName === run.wildcardWatch.name);
      if (stillHere && genIdx - run.wildcardWatch.gen === 1) out.push(`刺客「${run.wildcardWatch.name}」の血が群れに残った。`);
      else if (!stillHere && genIdx - run.wildcardWatch.gen <= 2) { out.push(`刺客「${run.wildcardWatch.name}」の血は途絶えた。`); run.wildcardWatch = null; }
    }
    return out;
  }

  // ===== 個体群を興す／世代を進める =====
  function beginRun() {
    const seed = Math.floor(Math.random() * 0x7fffffff) >>> 0;
    const pop = L.genesis(seed, founders);
    run = { seed, genIdx: 0, pop, headlineLog: null, otherLog: null, events: [`個体群を興した（始祖${founders.length}体・残り${L.POP - founders.length}体はランダム）。`], wildcardWatch: null, prevAvg: null };
    saveRun();
    $("lnGenesis").classList.add("hidden"); $("lnRun").classList.remove("hidden");
    renderRunScreen();
  }
  function advanceGeneration() {
    if (!run) return;
    const prevAvg = L.traitAverages(run.pop);
    const { env, results, battleLogs } = L.resolveGeneration(run.pop, run.seed, run.genIdx);
    const head = battleLogs[0], other = battleLogs[1];
    const bres = L.breed(results, run.seed, run.genIdx);
    const events = detectEvents(prevAvg, L.traitAverages(bres.next), bres, run.genIdx + 1);
    run.events = (run.events || []).concat(events);
    run.headlineLog = { arena: head.arena, mod: head.mod, namesA: head.namesA, namesB: head.namesB, lines: head.lines };
    run.otherLog = { summary: summarizeBattle(other) };
    run.env = env; run.genIdx++; run.pop = bres.next;
    saveRun();
    renderRunScreen();
  }
  function summarizeBattle(bl) {
    const win = bl.result && bl.result.type === "win" ? (bl.result.winner === "PLR" ? bl.namesA : bl.namesB) : null;
    const lose = bl.result && bl.result.type === "win" ? (bl.result.winner === "PLR" ? bl.namesB : bl.namesA) : null;
    if (win) return `${bl.arena}にて、${win.join("・")}が${lose.join("・")}を下した（${bl.turns}ターン）。`;
    return `${bl.arena}にて、決着つかず（${bl.turns}ターン）。`;
  }
  function renderRunScreen() {
    if (!run) return;
    $("lnGenChip").textContent = `世代 ${run.genIdx}`;
    const ec = $("lnEnvChip"); if (ec) { if (run.env) { ec.textContent = run.env.arena + (run.env.mod !== "通常" ? "・" + run.env.mod : ""); ec.style.display = ""; } else ec.style.display = "none"; }
    renderPopPanel(); renderEvents(); renderHeadline();
  }

  // ===== 刺客投入（介入余地・毎世代1体まで）=====
  let wcChoices = [2, 1, 2, 1, 2, 2, 2, 1, 1, 1];
  function openWildcard() {
    $("lnWildcardWrap").classList.remove("hidden");
    renderWildcardDials();
  }
  function renderWildcardDials() {
    $("lnWcBuildCard").innerHTML = SCS.ui.buildCardHtml(wcChoices);
    const wrap = $("lnWcDials"); wrap.innerHTML = "";
    D.MACROS.forEach((mac, i) => {
      const row = document.createElement("div"); row.className = "macro";
      const label = document.createElement("label"); label.className = "macro-lbl"; label.textContent = mac.name;
      const sel = document.createElement("select");
      mac.poles.forEach((p, ci) => { const o = document.createElement("option"); o.value = ci; o.textContent = p; sel.appendChild(o); });
      sel.value = wcChoices[i];
      sel.onchange = () => { wcChoices[i] = parseInt(sel.value, 10); renderWildcardDials(); };
      row.appendChild(label); row.appendChild(sel);
      wrap.appendChild(row);
    });
  }
  function confirmWildcard() {
    if (!run) return;
    // まだ戦っていない個体群のランダムな1枠と入れ替える。以後は他の個体と同様、実際の戦闘で運命が決まる。
    const name = L.NAME_POOL[(run.genIdx + 99) % L.NAME_POOL.length] + "＊";
    run.pop = L.injectWildcard(run.pop, run.seed, run.genIdx, wcChoices, name);
    run.wildcardWatch = { name, gen: run.genIdx };
    run.events = (run.events || []).concat([`世代${run.genIdx}に刺客「${name}」を投入した。`]);
    saveRun();
    $("lnWildcardWrap").classList.add("hidden");
    renderRunScreen();
  }

  // ===== モード切替（story.jsから呼ばれる）=====
  SCS.lineageUI = {
    enter() {
      if (run) { $("lnGenesis").classList.add("hidden"); $("lnRun").classList.remove("hidden"); renderRunScreen(); }
      else { $("lnGenesis").classList.remove("hidden"); $("lnRun").classList.add("hidden"); buildGenesisScreen(); }
    },
    leave() {},
  };

  function init() {
    { const b = $("lnAddFounder"); if (b) b.addEventListener("click", () => { if (founders.length < 3) { founders.push([2, 1, 2, 1, 2, 2, 2, 1, 1, 1]); activeFounder = founders.length - 1; buildGenesisScreen(); } }); }
    { const b = $("lnRemoveFounder"); if (b) b.addEventListener("click", () => { if (founders.length > 0) { founders.pop(); activeFounder = Math.max(0, founders.length - 1); buildGenesisScreen(); } }); }
    { const b = $("lnBegin"); if (b) b.addEventListener("click", beginRun); }
    { const b = $("lnNextGen"); if (b) b.addEventListener("click", advanceGeneration); }
    { const b = $("lnWildcard"); if (b) b.addEventListener("click", openWildcard); }
    { const b = $("lnWcConfirm"); if (b) b.addEventListener("click", confirmWildcard); }
    { const b = $("lnWcCancel"); if (b) b.addEventListener("click", () => $("lnWildcardWrap").classList.add("hidden")); }
    { const b = $("lnReset"); if (b) b.addEventListener("click", () => { clearRun(); $("lnRun").classList.add("hidden"); $("lnGenesis").classList.remove("hidden"); buildGenesisScreen(); }); }
    { const t = $("lnToggleLog"); if (t) t.addEventListener("click", () => { const w = $("lnHeadlineWrap"); const show = w.classList.toggle("hidden") === false; t.textContent = show ? "▾ 見出し戦の詳細" : "▸ 見出し戦の詳細"; }); }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
