/* title.js — タイトル画面（キービジュ採用・[[分隊戦設計]]§14）。
 * セッションに1回だけ表示し、クリック/キーで閉じる。共有リプレイURL（?r=）で開いた時は出さない（すぐ観戦させる）。
 * オンボーディング（onboard.js）より前面に重ね、閉じると下のオンボーディングがそのまま見える。
 */
(function () {
  const KEY = "scs_title_seen";
  function close() {
    const el = document.getElementById("titleSplash"); if (!el) return;
    el.classList.add("hidden");
    try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
  }
  function init() {
    const el = document.getElementById("titleSplash"); if (!el) return;
    let seen = false; try { seen = sessionStorage.getItem(KEY) === "1"; } catch (e) {}
    if (seen || /[?&]r=/.test(location.search)) return;
    el.classList.remove("hidden");
    el.addEventListener("click", close);
    document.addEventListener("keydown", function onKey(e) { if (el.classList.contains("hidden")) return document.removeEventListener("keydown", onKey); if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); close(); } });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
