/* onboard.js — ⑤ 初回オンボーディング＋コアループの明示。
 * 「君は戦わない。性格を設計し、観て、直す」を最初に渡す。初回のみ自動表示（localStorageでスキップ可）、ヘッダーの「？」で再生。
 * 描画/DOMのみ＝シム・決定論に非干渉。CRT調・絵文字不使用。
 */
window.SCS = window.SCS || {};

(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = "scs_onboarded_v3"; // v3＝系譜モードを新主役に刷新（旧版を見た人にも新導入を出す）
  let i = 0, spot = null;

  // 4ステップ：① コンセプト（系譜） ② 始祖を興す ③ 世代を眺める ④ 介入余地・他モードへの案内
  const STEPS = [
    { t: "ようこそ — これは『勝敗を目指さない』観察ゲーム", target: null,
      b: "君は戦闘を操作しない。<b>AIの“性格”を持つ個体群</b>を興し、世代を重ねさせて<b>何が生き残るかを眺める</b>。<br><span class=\"ob-dim\">メインは<b>系譜</b>——勝つための編成でなく、変わり続ける環境の中で<b>気質がどう漂うか</b>を観察するゲームだ。</span>" },
    { t: "① 始祖を興す — 個体群の種を蒔く", target: "lnFounderRoster",
      b: "1〜3体だけ<b>始祖</b>の人格を手動で設計できる（残り12体まではランダム）。〔個体群を興す〕で、性質を継いだ子孫たちの世代交代が始まる。" },
    { t: "② 世代を眺める — 環境は毎世代変わる", target: "lnFoot",
      b: "〔個体群を興す〕から始め、以後は〔次の世代へ〕で戦場が動き、生き残った個体が交配して子を残す。<b>気質の分布バー</b>と<b>群れの記録</b>が「何が起きたか」だけを教える——勝敗でなく<b>消長そのもの</b>を見る。" },
    { t: "③ 介入する — だが、介入しすぎない", target: null,
      b: "世代を進める画面では、気が向いたら〔刺客を投入〕——1体だけ手動設計した個体を送り込める。生き残るかはシミュレーション任せ。<br><span class=\"ob-dim\">3体固定の編成で勝負したい時は<b>分隊戦</b>、1体の精密なデュエルは<b>自由対戦</b>・<b>ストーリー</b>タブから。</span>" },
  ];

  function clearSpot() { if (spot) { spot.classList.remove("ob-spot"); spot = null; } }
  function setSpot(id) {
    clearSpot();
    if (!id) return;
    const el = $(id); if (!el) return;
    spot = el; el.classList.add("ob-spot");
    try { el.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {} // nearest＝対象を中央ダイアログの背後へ送らない
  }

  function render() {
    const ov = $("onboard"); if (!ov) return;
    const s = STEPS[i], last = i === STEPS.length - 1;
    const dots = STEPS.map((_, k) => `<span class="ob-dot ${k === i ? "on" : ""}"></span>`).join("");
    ov.innerHTML =
      `<div class="ob-box">` +
      `<div class="ob-step">STEP ${i + 1} / ${STEPS.length}</div>` +
      `<h2 class="ob-title">${s.t}</h2>` +
      `<p class="ob-body">${s.b}</p>` +
      `<div class="ob-dots">${dots}</div>` +
      `<div class="ob-foot">` +
      `<button class="btn ghost tiny" id="obSkip">スキップ</button>` +
      `<span class="ob-spacer"></span>` +
      (i > 0 ? `<button class="btn ghost" id="obPrev">戻る</button>` : "") +
      `<button class="btn primary" id="obNext">${last ? "はじめる" : "次へ ▶"}</button>` +
      `</div></div>`;
    setSpot(s.target);
    $("obSkip").addEventListener("click", finish);
    $("obNext").addEventListener("click", () => { if (last) finish(); else { i++; render(); } });
    const pv = $("obPrev"); if (pv) pv.addEventListener("click", () => { i = Math.max(0, i - 1); render(); });
  }

  function open(fromHelp) { i = 0; const ov = $("onboard"); if (!ov) return; ov.classList.remove("hidden"); document.body.classList.add("ob-open"); render(); }
  function finish() {
    clearSpot();
    const ov = $("onboard"); if (ov) ov.classList.add("hidden");
    document.body.classList.remove("ob-open"); // 暗幕(body::before)を消す
    try { localStorage.setItem(KEY, "1"); } catch (e) {}
  }

  function init() {
    const help = $("btnHelp"); if (help) help.addEventListener("click", () => open(true));
    let seen = false;
    try { seen = !!localStorage.getItem(KEY); } catch (e) {}
    if (!seen) open(false); // 初回のみ自動表示（戦闘は静止状態のまま——観るより先に設計を促す）
  }
  document.addEventListener("DOMContentLoaded", init);
})();
