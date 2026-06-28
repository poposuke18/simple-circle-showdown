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

    const msel = $("modSel");
    msel.innerHTML = "";
    ["ランダム"].concat(D.MODIFIERS.map((m) => m.name)).forEach((name) => {
      const o = document.createElement("option");
      o.value = name; o.textContent = name; msel.appendChild(o);
    });
    msel.value = modName;
    msel.addEventListener("change", () => { modName = msel.value; });

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
    arenaName = $("arenaSel").value; modName = $("modSel").value;
    battle = SCS.makeBattle(plr, cpu, seed, arenaName, modName);
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
    document.querySelectorAll("#plrParams select").forEach((s) => (s.disabled = !enabled));
    $("cpuPreset").disabled = !enabled;
    $("arenaSel").disabled = !enabled;
    $("modSel").disabled = !enabled;
    $("seed").disabled = !enabled;
    $("config").classList.toggle("locked", !enabled);
    $("cfgLock").textContent = enabled ? "" : "🔒 戦闘中：性格はロック（決着後 or 新規対戦で解除）";
  }
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
    $("chips" + side).innerHTML = chipsHtml(u);
    $("name" + side).textContent = label;
    $("weap" + side).textContent = weaponStr(u);
  }
  // 実X座標を 0..field.w → 0..100% に投影（PLR/CPUとも動く・左右は固定でない）。HP/気力/流れ/状態異常を可視化
  function render() {
    if (!battle) return;
    const p = battle.plr, c = battle.cpu, fw = battle.field.w;
    $("mP").style.left = clamp01(p.x / fw) * 100 + "%";
    $("mC").style.left = clamp01(c.x / fw) * 100 + "%";
    $("track").classList.toggle("clash", Math.abs(p.x - c.x) / fw < 0.04);
    $("distNum").textContent = `距離 ${battle.displayDist()}%`;
    setUnit("P", p, "YOU");
    setUnit("C", c, c.name);
    const net = clamp(((p.momentum || 0) - (c.momentum || 0)) / 1.5, -1, 1); // 流れ：PLR側(左)↔CPU側(右)
    $("moFill").style.left = clamp(50 - net * 42, 4, 96) + "%";
    $("turnInfo").textContent = `TURN ${battle.turn} / ${D.SIM.turnCap}`;
  }

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
    render();
    updateConfigLock();
    if (r.over) { stopAuto(); $("paramsWrap").classList.remove("hidden"); renderParams(); } // 決着→総括(戦闘分析)を自動表示。決着演出はシム側のログに含まれる
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
