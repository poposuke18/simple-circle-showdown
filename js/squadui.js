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
  const CPU_SQUADS = {
    "鉄壁分隊": ["専守要塞", "鉄律の射手", "毒手の刺客"],
    "猛攻分隊": ["猪突ガラスキャノン", "重剣の闘士", "海千山千の暗殺者"],
    "撹乱分隊": ["かく乱の火付け", "海千山千の暗殺者", "毒手の刺客"],
    "均衡分隊": ["中庸バランス", "中庸バランス", "中庸バランス"],
  };
  let cpuName = "鉄壁分隊", arena = "ランダム", mod = "ランダム";
  let battle = null, autoT = null;

  function fillSelect(id, opts, cur, on) {
    const sel = $(id); if (!sel) return; sel.innerHTML = "";
    opts.forEach((o) => { const e = document.createElement("option"); e.value = o; e.textContent = o; sel.appendChild(e); });
    sel.value = cur; sel.onchange = () => on(sel.value);
  }
  function buildDesign() {
    fillSelect("sqArena", ["ランダム"].concat(D.ARENAS.map((a) => a.name)), arena, (v) => (arena = v));
    fillSelect("sqMod", ["ランダム"].concat(D.MODIFIERS.map((m) => m.name)), mod, (v) => (mod = v));
    fillSelect("sqCpu", Object.keys(CPU_SQUADS).concat(["ランダム"]), cpuName, (v) => (cpuName = v));
    renderTabs(); renderDials(); renderRoster();
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
    D.MACROS.forEach((mac, i) => {
      const row = document.createElement("div"); row.className = "macro";
      const label = document.createElement("label"); label.className = "macro-lbl"; label.textContent = mac.name; label.title = SCS.ui.macroHint(i);
      const sel = document.createElement("select");
      mac.poles.forEach((p, ci) => { const o = document.createElement("option"); o.value = ci; o.textContent = p; sel.appendChild(o); });
      sel.value = squad[active][i];
      sel.onchange = () => { squad[active][i] = parseInt(sel.value, 10); renderDials(); renderRoster(); renderTabs(); };
      row.appendChild(label); row.appendChild(sel); wrap.appendChild(row);
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
  function sortie() {
    const seed = Math.floor(Math.random() * 0x7fffffff) >>> 0;
    const cpuChoices = cpuName === "ランダム" ? randomCpu(seed) : CPU_SQUADS[cpuName].map((n) => D.PRESETS[n]);
    battle = SCS.makeSquadBattle(squad.map((c) => c.slice()), cpuChoices.map((c) => c.slice()), seed, arena, mod);
    if (SCS.mini) SCS.mini.reset();
    $("squadDesign").classList.add("hidden");
    $("squadStage").classList.remove("hidden");
    $("sqArenaChip").textContent = battle.arena.name;
    const mc = $("sqModChip"); if (battle.modifier) { mc.textContent = battle.modifier.name; mc.style.display = ""; } else mc.style.display = "none";
    $("sqLog").innerHTML = "";
    append(`>> 戦場：${battle.arena.name} — ${battle.arena.flavor}`, "arena");
    if (battle.modifier) append(`>> 戦況：${battle.modifier.name} — ${battle.modifier.flavor}`, "arena");
    append(`>> 分隊戦開始：あなた${SIZE}体 vs ${cpuName}（${SIZE}体）`, "sys");
    $("sqParamsWrap").classList.add("hidden");
    render();
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
    if (r.over) { stopAuto(); $("sqParamsWrap").classList.remove("hidden"); renderAnalysis(); }
  }
  function auto() { if (autoT) { stopAuto(); return; } $("sqAuto").textContent = "■ 停止"; autoT = setInterval(() => { if (!battle || battle.over) { stopAuto(); return; } nextStep(); }, 380); }
  function stopAuto() { if (autoT) { clearInterval(autoT); autoT = null; } const b = $("sqAuto"); if (b) b.textContent = "▶ 自動実行"; }

  function renderAnalysis() {
    if (!battle) return;
    const a = battle.getAnalysis();
    const col = (s, label, isP) => {
      const badge = a.over ? (a.result.type === "draw" ? `<span class="abadge draw">DRAW</span>` : (a.result.winner === (isP ? "PLR" : "CPU") ? `<span class="abadge win">WIN</span>` : `<span class="abadge lose">LOSE</span>`)) : "";
      let h = `<div class="acol"><h4>${label} ${badge}</h4><div class="aweap">与ダメ計 ${s.dealt}／撃破 ${s.kills}／生存 ${s.survivors}/${s.cards.length}</div><table class="atab">`;
      for (const c of s.cards) h += `<tr><td>${c.name}<span class="sqc-role">${c.role}</span></td><td>${c.alive ? "生存" : "T" + c.downTurn + "脱落"}・与${c.dealt}/被${c.taken}${c.kills ? "・撃破" + c.kills : ""}</td></tr>`;
      h += `</table>`;
      if (s.notes.length) h += `<div class="anotes"><b>戦評</b><ul>${s.notes.map((n) => `<li>${n}</li>`).join("")}</ul></div>`;
      return h + `</div>`;
    };
    $("sqParams").innerHTML = `<div class="ameta">分隊戦：${a.arena}${a.mod ? "・" + a.mod : ""}・全${a.turns}ターン</div><div class="acols">${col(a.plr, "あなたの分隊", true)}${col(a.cpu, "敵分隊", false)}</div><p class="ahint">※ 役割の補完と相性を設計するのが分隊戦の肝。沈黙した体・噛み合わなかった役割を見直そう。</p>`;
  }

  function backToDesign() { stopAuto(); $("squadStage").classList.add("hidden"); $("squadDesign").classList.remove("hidden"); buildDesign(); }

  SCS.squad = {
    enter() { buildDesign(); $("squadStage").classList.add("hidden"); $("squadDesign").classList.remove("hidden"); },
    leave() { stopAuto(); },
  };
  function init() {
    $("sqSortie").addEventListener("click", sortie);
    $("sqNext").addEventListener("click", nextStep);
    $("sqAuto").addEventListener("click", auto);
    $("sqAnalyze").addEventListener("click", () => { const w = $("sqParamsWrap"); w.classList.toggle("hidden"); if (!w.classList.contains("hidden")) renderAnalysis(); });
    $("sqBack").addEventListener("click", backToDesign);
  }
  document.addEventListener("DOMContentLoaded", init);
})();
