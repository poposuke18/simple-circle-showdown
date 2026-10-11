/* title.js — タイトル画面＝メインメニュー（キービジュ案3・[[分隊戦設計]]§15）。
 * 起動時に毎回表示（共有リプレイURL ?r= で開いた時は出さない＝すぐ観戦させる）。
 * メニュー：分隊戦（模擬戦）／制圧戦／挑戦／観戦デモ／系譜・自由対戦・ストーリー。
 * 各画面の〔≡ メニュー〕〔タイトルへ〕（data-go="title"）でここへ戻る。
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const TAB = { lineage: "tabLineage", free: "tabFree", story: "tabStory" };
  function show() {
    const el = $("titleSplash"); if (!el) return;
    const ab = $("sqAuto"); if (ab && /停止/.test(ab.textContent)) ab.click(); // 自動実行中なら止める
    el.classList.remove("hidden");
  }
  function hide() { const el = $("titleSplash"); if (el) el.classList.add("hidden"); }
  function go(target) {
    hide();
    if (target === "title") return show();
    if (target === "demo" || target.indexOf("squad") === 0) {
      const tb = $("tabSquad"); if (tb) tb.click();
      if (!window.SCS || !SCS.squad) return;
      if (target === "demo") SCS.squad.demo();
      else SCS.squad.setPlayMode(target.split("-")[1] || "free");
      return;
    }
    const b = $(TAB[target]); if (b) b.click();
  }
  function init() {
    const el = $("titleSplash"); if (!el) return;
    document.addEventListener("click", (e) => {
      const t = e.target && e.target.closest ? e.target.closest("[data-go]") : null;
      if (!t) return;
      e.preventDefault(); go(t.getAttribute("data-go"));
    });
    document.addEventListener("keydown", (e) => {
      if (el.classList.contains("hidden")) return;
      if (e.key === "Enter") { e.preventDefault(); go("squad-free"); }
    });
    if (/[?&]r=/.test(location.search)) return;
    show();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
