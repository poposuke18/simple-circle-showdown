/* story.js — ストーリーモード（[[ストーリーモード設計]]）。
 * 進行状態＋画面（相棒作成/章マップ/スカウト/設計/結果）。戦闘は ui.js を SCS.ui 経由で起動。
 * 敵＝看板キャラ（ホーム＝アリーナ+戦況固定）。味方＝相棒1体（核1軸固定＋自由再設計）。
 */
window.SCS = window.SCS || {};

(function () {
  const D = SCS.DATA, $ = (id) => document.getElementById(id);
  const SAVE_KEY = "scs_story_v1";
  const DEFAULT_CHOICES = [2, 1, 2, 1, 2, 2, 2, 1, 1, 1]; // 中庸を叩き台に
  const ORDER = D.CHAPTERS.flatMap((c) => c.enemies); // 攻略順（章を平坦化）

  let st = null;        // { name, core:{axis,value}, choices:[10], cleared:[keys], lastWin:[10]|null }
  let curEnemy = null;  // 設計/戦闘中の敵key
  let mode = "free";    // "free" | "story"

  // ---- 永続化 ----
  function load() { try { const r = localStorage.getItem(SAVE_KEY); if (r) st = JSON.parse(r); } catch (e) { st = null; } }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(st)); } catch (e) {} }
  function resetProgress() { st = null; try { localStorage.removeItem(SAVE_KEY); } catch (e) {} renderHome(); }

  // ---- 進行ヘルパー ----
  const enemyByKey = (k) => D.ENEMIES.find((e) => e.key === k);
  const isCleared = (k) => !!st && st.cleared.indexOf(k) >= 0;
  const isUnlocked = (k) => { const i = ORDER.indexOf(k); return i === 0 || isCleared(ORDER[i - 1]); };
  const nextEnemy = () => ORDER.find((k) => !isCleared(k)) || null;
  const enemyChoices = (e) => e.mirror ? (st && (st.lastWin || st.choices) || DEFAULT_CHOICES) : e.choices;
  const enemyDisplayName = (e) => e.mirror ? `鏡（${st ? st.name : "あなた"}の写し）` : e.name;

  // ---- 画面切替 ----
  function show(id, on) { const el = $(id); if (el) el.classList.toggle("hidden", !on); }
  function setView(v) {
    const story = mode === "story";
    show("storyHome", story && v === "map");
    show("storyScout", story && v === "scout");
    show("storyResult", story && v === "result");
    show("config", !story || v === "design" || v === "battle"); // 設計/戦闘は既存の人格設計を再利用
    show("stage", !story || v === "design" || v === "battle" || v === "result"); // 結果では最終盤面を残す
    show("freeFoot", !story);
    show("storyFoot", story && v === "design");
    if (story && (v === "map" || v === "scout" || v === "design")) $("paramsWrap").classList.add("hidden"); // 分析はbattle/result時のみ（ui.jsが決着で展開）
  }

  // ---- モード切替 ----
  function setMode(m) {
    mode = m;
    $("tabFree").classList.toggle("active", m === "free");
    $("tabStory").classList.toggle("active", m === "story");
    if (m === "free") { SCS.ui.clearStory(); setView("free"); }
    else { SCS.ui.clearStory(); curEnemy = null; renderHome(); }
  }

  // ---- 相棒作成 / 章マップ ----
  function renderHome() {
    const wrap = $("storyHome");
    if (!st) { // 相棒作成
      let opts = D.MACROS.map((m, i) => `<option value="${i}">${m.name}</option>`).join("");
      wrap.innerHTML =
        `<div class="story-card"><h3>相棒を創る</h3>` +
        `<p class="story-lead">丸い闘士に名と"魂"を授ける。<b>核となる軸を1つ</b>選ぶと、その性質は旅の間ずっと変わらない（残りは戦いの前に何度でも再設計できる）。</p>` +
        `<div class="story-form">` +
        `<label class="fld">名前<input id="pName" type="text" maxlength="8" value="まる" /></label>` +
        `<label class="fld">核となる軸<select id="pCoreAxis">${opts}</select></label>` +
        `<label class="fld">その性質<select id="pCoreVal"></select></label>` +
        `</div>` +
        `<button id="pCreate" class="btn primary big">この相棒で始める</button></div>`;
      const fillVal = () => { const ax = +$("pCoreAxis").value; $("pCoreVal").innerHTML = D.MACROS[ax].poles.map((p, ci) => `<option value="${ci}">${p}</option>`).join(""); $("pCoreVal").value = 2; };
      fillVal();
      $("pCoreAxis").addEventListener("change", fillVal);
      $("pCreate").addEventListener("click", () => {
        const name = ($("pName").value || "まる").slice(0, 8), axis = +$("pCoreAxis").value, value = +$("pCoreVal").value;
        const choices = DEFAULT_CHOICES.slice(); choices[axis] = value;
        st = { name, core: { axis, value }, choices, cleared: [], lastWin: null }; save(); renderHome();
      });
    } else { // 章マップ
      const coreMac = D.MACROS[st.core.axis];
      let html = `<div class="story-card"><div class="story-partner"><span class="sp-name">▶ ${st.name}</span><span class="sp-core">核：${coreMac.name}「${coreMac.poles[st.core.value]}」</span><button id="pReset" class="btn ghost tiny">最初から</button></div>`;
      D.CHAPTERS.forEach((ch) => {
        html += `<div class="story-chapter"><div class="sc-head">${ch.title}<span class="sc-theme">${ch.theme}</span></div><div class="sc-enemies">`;
        ch.enemies.forEach((k) => {
          const e = enemyByKey(k), cleared = isCleared(k), unlocked = isUnlocked(k);
          const cls = cleared ? "ene cleared" : unlocked ? "ene open" : "ene locked";
          const mark = cleared ? "✓" : unlocked ? "▷" : "🔒";
          html += `<button class="${cls}" data-ene="${k}" ${unlocked ? "" : "disabled"}>${mark} ${e.name}${e.boss ? "（章ボス）" : ""}</button>`;
        });
        html += `</div></div>`;
      });
      const done = ORDER.every(isCleared);
      html += done ? `<p class="story-clear">★ 全ての敵を制した。あなたは真の設計者だ。</p>` : "";
      html += `</div>`;
      wrap.innerHTML = html;
      wrap.querySelectorAll("button[data-ene]").forEach((b) => b.addEventListener("click", () => renderScout(b.dataset.ene)));
      const rb = $("pReset"); if (rb) rb.addEventListener("click", () => { if (confirm("進行を最初からやり直しますか？")) resetProgress(); });
    }
    setView("map");
  }

  // ---- スカウト ----
  function renderScout(k) {
    curEnemy = k; const e = enemyByKey(k);
    $("storyScout").innerHTML =
      `<div class="story-card"><div class="scout-tag">SCOUT REPORT</div>` +
      `<h3>${enemyDisplayName(e)}${e.boss ? " <span class='boss-tag'>章ボス</span>" : ""}</h3>` +
      `<p class="scout-flavor">${e.flavor}</p>` +
      `<table class="scout-tab">` +
      `<tr><td>傾向</td><td>${e.scout}</td></tr>` +
      `<tr><td>ホーム</td><td><b>${e.arena}</b> ／ 戦況：<b>${e.mod}</b></td></tr>` +
      `<tr><td>狙い</td><td>${e.lesson}</td></tr>` +
      `</table>` +
      `<p class="scout-note">※相手は自分に一番都合のいい舞台で待つ。それ前提で人格を設計せよ。</p>` +
      `<div class="scout-foot"><button id="scBack" class="btn ghost">章マップ</button><button id="scDesign" class="btn primary big">設計して挑む</button></div></div>`;
    $("scBack").addEventListener("click", renderHome);
    $("scDesign").addEventListener("click", () => enterDesign(k));
    setView("scout");
  }

  // ---- 設計（既存の人格設計を再利用・核をロック）----
  function enterDesign(k) {
    curEnemy = k; const e = enemyByKey(k);
    SCS.ui.setPlrChoices(st.choices);   // 前回の設計を叩き台に
    SCS.ui.lockAxis(st.core.axis);      // 核をロック
    const coreMac = D.MACROS[st.core.axis];
    $("storyFoot").innerHTML =
      `<div class="sf-info">対 <b>${enemyDisplayName(e)}</b> ／ ホーム <b>${e.arena}・${e.mod}</b> ／ 核 <b>${coreMac.name}「${coreMac.poles[st.core.value]}」</b>（固定）</div>` +
      `<button id="sfBack" class="btn ghost">スカウトへ</button><button id="sfSortie" class="btn primary big">出撃</button>`;
    $("sfBack").addEventListener("click", () => renderScout(k));
    $("sfSortie").addEventListener("click", sortie);
    $("log").innerHTML = "";
    setView("design");
  }

  // ---- 出撃 ----
  function sortie() {
    const e = enemyByKey(curEnemy);
    st.choices = SCS.ui.getPlrChoices(); save(); // 設計を記憶（核は固定のまま）
    setView("battle");
    SCS.ui.launchStoryBattle({ cpuChoices: enemyChoices(e), cpuName: enemyDisplayName(e), arena: e.arena, mod: e.mod, onOver: onOver });
  }

  // ---- 決着 ----
  function onOver(result) {
    const e = enemyByKey(curEnemy), won = result && result.type === "win" && result.winner === "PLR";
    if (won) {
      if (st.cleared.indexOf(curEnemy) < 0) st.cleared.push(curEnemy);
      st.lastWin = st.choices.slice(); // 鏡用：直近の勝利ビルド
      save();
    }
    const nxt = nextEnemy();
    let html = `<div class="story-card story-result ${won ? "win" : "lose"}">`;
    html += won ? `<div class="res-banner win">勝　利</div>` : `<div class="res-banner lose">${result && result.type === "draw" ? "引き分け" : "敗　北"}</div>`;
    html += `<p class="res-line">対 ${enemyDisplayName(e)}</p>`;
    if (won) {
      html += e.mirror ? `<p class="res-flavor">あなたは、自分自身を超えた。</p>` : `<p class="res-flavor">「${e.name}」の流派を会得した（自由対戦のCPUに追加）。</p>`;
      html += `<div class="res-foot">`;
      html += nxt ? `<button id="rNext" class="btn primary big">次の敵：${enemyByKey(nxt).name} へ</button>` : `<span class="story-clear">★ 全制覇！</span>`;
      html += `<button id="rMap" class="btn ghost">章マップ</button></div>`;
    } else {
      html += `<p class="res-flavor">敗因は下の「戦闘分析」に。人格を見直してもう一度。</p>`;
      html += `<div class="res-foot"><button id="rRetry" class="btn primary big">人格を見直して再挑戦</button><button id="rMap" class="btn ghost">章マップ</button></div>`;
    }
    html += `</div>`;
    $("storyResult").innerHTML = html;
    show("storyResult", true);
    const nb = $("rNext"); if (nb) nb.addEventListener("click", () => renderScout(nxt));
    const rt = $("rRetry"); if (rt) rt.addEventListener("click", () => enterDesign(curEnemy));
    const mp = $("rMap"); if (mp) mp.addEventListener("click", renderHome);
    setView("result");
  }

  // ---- 起動 ----
  function init() {
    load();
    $("tabFree").addEventListener("click", () => setMode("free"));
    $("tabStory").addEventListener("click", () => setMode("story"));
    setMode("free"); // 既定は自由対戦（従来通り）
  }
  document.addEventListener("DOMContentLoaded", init);
})();
