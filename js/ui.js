/* ui.js — テキスト描画＋人格設定＋ステップ進行。シム核を読んで距離/HP/ログに落とすだけ。 */
window.SCS = window.SCS || {};

(function () {
  const D = SCS.DATA;
  const $ = (id) => document.getElementById(id);

  let plrChoices = D.PRESETS["中庸バランス"].slice();
  let cpuPresetName = "専守要塞";
  let arenaName = "ランダム";
  let seed = 12345;
  let battle = null;
  let autoTimer = null;

  const weaponStr = (u) => `${u.ranged.name}＋${u.melee.name}`;
  // 狭い画面（スマホ縦）ではバー長を短く＝はみ出し防止
  const mini = (big, small) => (typeof window !== "undefined" && window.innerWidth && window.innerWidth < 520 ? small : big);

  function buildConfig() {
    const wrap = $("plrParams");
    wrap.innerHTML = "";
    D.MACROS.forEach((mac, i) => {
      const row = document.createElement("div");
      row.className = "cfg-row";
      const label = document.createElement("label");
      label.textContent = mac.name;
      const sel = document.createElement("select");
      mac.poles.forEach((p, ci) => {
        const o = document.createElement("option");
        o.value = ci; o.textContent = p; sel.appendChild(o);
      });
      sel.value = plrChoices[i];
      sel.addEventListener("change", () => { plrChoices[i] = parseInt(sel.value, 10); });
      row.appendChild(label); row.appendChild(sel); wrap.appendChild(row);
    });

    const csel = $("cpuPreset");
    csel.innerHTML = "";
    Object.keys(D.PRESETS).concat(["ランダム"]).forEach((name) => {
      const o = document.createElement("option");
      o.value = name; o.textContent = name; csel.appendChild(o);
    });
    csel.value = cpuPresetName;
    csel.addEventListener("change", () => { cpuPresetName = csel.value; });

    const asel = $("arenaSel");
    asel.innerHTML = "";
    ["ランダム"].concat(D.ARENAS.map((a) => a.name)).forEach((name) => {
      const o = document.createElement("option");
      o.value = name; o.textContent = name; asel.appendChild(o);
    });
    asel.value = arenaName;
    asel.addEventListener("change", () => { arenaName = asel.value; });

    $("seed").value = seed;
  }

  // CPU「ランダム」用：seedから10軸人格を生成（戦闘乱数とは別系列）
  function genRandomChoices(s) {
    const r = SCS.makeRNG((s ^ 0x9e3779b9) >>> 0);
    return Array.from({ length: 10 }, () => r.int(4));
  }

  function newBattle() {
    stopAuto();
    if (!$("randSeed") || $("randSeed").checked) { seed = Math.floor(Math.random() * 0x7fffffff) >>> 0; $("seed").value = seed; } // 毎回ランダム＝非決定論（一期一会）
    else seed = parseInt($("seed").value, 10) || 1; // チェックを外せば seed 固定で同じ戦闘を再現
    const plr = SCS.derive.buildUnit("YOU", plrChoices);
    let cpuChoices, cpuName;
    if (cpuPresetName === "ランダム") { cpuChoices = genRandomChoices(seed); cpuName = `ランダム#${seed}`; }
    else { cpuChoices = D.PRESETS[cpuPresetName]; cpuName = cpuPresetName; }
    const cpu = SCS.derive.buildUnit(cpuName, cpuChoices);
    arenaName = $("arenaSel").value;
    battle = SCS.makeBattle(plr, cpu, seed, arenaName);
    $("log").innerHTML = "";
    appendRaw(`⚔ 戦場：${battle.arena.name} — ${battle.arena.flavor}`, "arena");
    appendRaw(`>> 対戦開始  PLR:${weaponStr(plr)} HP${plr.maxHp}  vs  CPU(${cpu.name}):${weaponStr(cpu)} HP${cpu.maxHp}`, "sys");
    appendRaw(`>> seed=${seed}（同じ人格＋同じseed → 必ず同じ戦闘）`, "dim");
    $("paramsWrap").classList.add("hidden"); // 新規対戦時は分析を畳む（決着で自動展開）
    render();
    updateConfigLock();
  }

  // 戦闘進行中（turn≥1かつ未決着）は人格・CPU・seedをロック
  function setConfigEnabled(enabled) {
    document.querySelectorAll("#plrParams select").forEach((s) => (s.disabled = !enabled));
    $("cpuPreset").disabled = !enabled;
    $("arenaSel").disabled = !enabled;
    $("seed").disabled = !enabled;
    $("config").classList.toggle("locked", !enabled);
    $("cfgLock").textContent = enabled ? "" : "🔒 戦闘中：性格はロック（決着後 or 新規対戦で解除）";
  }
  function updateConfigLock() {
    const locked = !!battle && battle.turn >= 1 && !battle.over;
    setConfigEnabled(!locked);
  }

  // 両ユニットの実X座標を 0..field.w → 0..W に投影（PLRもCPUも動く・左右は戦場の左右で固定側ではない）
  function distBarHtml() {
    const W = mini(36, 24), fw = battle.field.w;
    const pos = (x) => Math.max(0, Math.min(W - 1, Math.round((x / fw) * (W - 1))));
    const px = pos(battle.plr.x), cx = pos(battle.cpu.x);
    const cells = new Array(W).fill("·");
    cells[cx] = '<span class="mc">■</span>';
    cells[px] = '<span class="mp">■</span>';
    if (px === cx) cells[px] = '<span class="mx">◈</span>';
    return cells.join("");
  }
  function hpBar(u) {
    const W = mini(20, 14);
    const f = Math.max(0, Math.round((u.hp / u.maxHp) * W));
    return "[" + "|".repeat(f) + "·".repeat(W - f) + "]";
  }

  function render() {
    if (!battle) return;
    const p = battle.plr, c = battle.cpu, d = battle.displayDist();
    $("dist").innerHTML = `位置 ${distBarHtml()}　距離 ${d}%\n<span class="mp">■</span>PLR <span class="mc">■</span>CPU`;
    $("hpPlr").textContent = `PLAYER HP ${hpBar(p)} ${p.hp}/${p.maxHp}`;
    $("hpCpu").textContent = `CPU HP    ${hpBar(c)} ${c.hp}/${c.maxHp}`;
    $("turnInfo").textContent = `TURN ${battle.turn} / ${D.SIM.turnCap}`;
  }

  function appendRaw(text, cls) {
    const div = document.createElement("div");
    div.className = "log-line " + (cls || "");
    div.textContent = text;
    $("log").appendChild(div);
    $("log").scrollTop = $("log").scrollHeight;
  }

  function nextStep() {
    if (!battle || battle.over) return;
    const r = battle.step();
    appendRaw(`━━ TURN ${r.turn} ━━`, "turnhdr");
    r.lines.forEach((l) => appendRaw(l.text, l.cls));
    render();
    updateConfigLock();
    if (r.over) { stopAuto(); $("paramsWrap").classList.remove("hidden"); renderParams(); } // 決着→総括(戦闘分析)を自動表示。決着演出はシム側のログに含まれる
    else if (!$("paramsWrap").classList.contains("hidden")) renderParams(); // 分析を開いている間は毎ターン更新
  }

  function showResult(res) {
    stopAuto();
    const p = battle.plr, c = battle.cpu;
    appendRaw("═══════════════════════════════", "result");
    if (res.type === "draw") {
      appendRaw(`  ☒ DRAW — ${res.text}`, "result");
      appendRaw(`  両者倒れる（PLR ${p.hp}/${p.maxHp}・CPU ${c.hp}/${c.maxHp}）`, "dim");
    } else {
      const win = res.winner === "PLR" ? p : c, lose = res.winner === "PLR" ? c : p;
      const banner = res.text === "KO" ? "★ K.O. ★" : "★ 決着 ★";
      appendRaw(`  ${banner}　WINNER ▶ ${res.winner}（${win.name}）`, "result");
      appendRaw(`  ${res.text}／勝 ${win.hp}/${win.maxHp} — 敗 ${lose.hp}/${lose.maxHp}`, "dim");
      appendRaw(`  「${finishFlavor(res, win, lose)}」`, "result");
    }
    appendRaw("═══════════════════════════════", "result");
  }
  function finishFlavor(res, win, lose) {
    if (res.text && res.text.indexOf("時間切れ") === 0) return "間合いを支配し続けた者が、判定を制した";
    if (lose.hp <= 0 && win.hp / win.maxHp < 0.2) return "満身創痍、執念がもぎ取った勝利";
    const rpool = { sniper: "狙い澄ました一射が、勝敗を断ち切った", mg: "浴びせ続けた弾幕が、ねじ伏せた", shotgun: "至近の一撃が、すべてを吹き飛ばした", pistol: "堅実な撃ち合いを、確実に制した" };
    const mpool = { hammer: "渾身の一撃が、とどめを刺した", knife: "刃の連撃が、急所を捉えた", katana: "一閃が、勝負を決めた", spear: "穂先が、間合いの果てを貫いた" };
    return (win.winDist <= 25 ? mpool[win.melee.key] : rpool[win.ranged.key]) || rpool[win.ranged.key] || mpool[win.melee.key] || "巧みな立ち回りが、勝敗を分けた";
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

  // 戦闘分析：内部パラメータ(24小パラ)は見せず、戦いぶり（結果）から総括＋次の方向性を示す
  function renderParams() {
    if (!battle) return;
    const a = battle.getAnalysis();
    const head = a.over
      ? `観戦終了：${a.arena}・全${a.turns}ターン`
      : `観戦中：${a.arena}・${a.turns}ターン経過（決着すると総括が確定します）`;
    $("params").innerHTML =
      `<div class="ameta">${head}</div>` +
      `<div class="acols">${unitAnalysisHtml(a.plr, "YOU（あなたの人格）", a)}${unitAnalysisHtml(a.cpu, `CPU（${a.cpu.name}）`, a)}</div>` +
      `<p class="ahint">※ 内部パラメータは非公開。戦いぶりから人格をどちらへ寄せるか考えるのが、このゲームの肝です。</p>`;
  }
  function unitAnalysisHtml(u, label, a) {
    const badge = a.over
      ? (u.won ? `<span class="abadge win">WIN</span>` : (a.result && a.result.type === "draw" ? `<span class="abadge draw">DRAW</span>` : `<span class="abadge lose">LOSE</span>`))
      : "";
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    let s = `<div class="acol"><h4>${label} ${badge}</h4>`;
    s += `<div class="aweap">${u.weapon}　HP ${u.hp}</div>`;
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
    s += `<div class="aadvice"><b>次の方向性</b><ul>${u.advice.map((n) => `<li>${n}</li>`).join("")}</ul></div>`;
    s += `</div>`;
    return s;
  }

  function toggleParams() { const w = $("paramsWrap"); w.classList.toggle("hidden"); if (!w.classList.contains("hidden")) renderParams(); }

  function init() {
    buildConfig();
    $("btnNew").addEventListener("click", newBattle);
    $("btnNext").addEventListener("click", nextStep);
    $("btnAuto").addEventListener("click", auto);
    $("btnParams").addEventListener("click", toggleParams);
    window.addEventListener("resize", () => { if (battle) render(); }); // 回転・幅変更でバー長を再調整
    newBattle();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
