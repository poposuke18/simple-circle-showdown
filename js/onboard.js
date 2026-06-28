/* onboard.js — ⑤ 初回オンボーディング＋コアループの明示。
 * 「君は戦わない。性格を設計し、観て、直す」を最初に渡す。初回のみ自動表示（localStorageでスキップ可）、ヘッダーの「？」で再生。
 * 描画/DOMのみ＝シム・決定論に非干渉。CRT調・絵文字不使用。
 */
window.SCS = window.SCS || {};

(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = "scs_onboarded_v1";
  let i = 0, spot = null;

  // 4ステップ：① コンセプト ② 設計＝カルテ ③ 観戦 ④ 分析→再設計（ループ）
  const STEPS = [
    { t: "ようこそ — これは『戦わない』対戦ゲーム", target: null,
      b: "君は戦闘を操作しない。<b>AIの“性格”を設計</b>し、その子が自動で戦うのを<b>観て・分析して・また設計し直す</b>——それがこのゲームだ。<br><span class=\"ob-dim\">10軸の人格が、HP・武器・戦い方に化ける。攻めれば脆くなる——そのトレードオフを握るのが君。</span>" },
    { t: "① 設計する — ダイヤルが“ビルドカルテ”に化ける", target: "config",
      b: "下の<b>人格設計</b>で10軸のダイヤルを回すと、すぐ上の<b>〔ビルドカルテ〕</b>にHP・武器・戦法が即反映される。<br>右の<b>〔勝率を試算〕</b>を押せば、決定論で20戦回した推定勝率も出る（1戦のブレに惑わされない）。" },
    { t: "② 観戦する — レーダーとログで“なぜ”を読む", target: "stage",
      b: "<b>〔次の手〕</b>か<b>〔自動実行〕</b>で観戦。上の<b>レーダー</b>に撃ち合い（射線・斬撃・必殺・回避）が描かれ、<b>ログ</b>が「なぜその行動を選んだか」まで語る。<br><span class=\"ob-dim\">決定論だから、同じ設計＋同じseedは必ず同じ結末になる。</span>" },
    { t: "③ 直す — 分析が設計に直結する", target: "modeBar",
      b: "決着すると<b>〔戦闘分析〕</b>が開く。「次の方向性」を押すと、<b>直すべきダイヤルへ飛んで1段寄る</b>。前回設計との差分も出る。<br>これが <b>設計 → 観戦 → 分析 → 再設計</b> のループ。まずは上の<b>〔ストーリー〕</b>＝調教場から始めるのがおすすめ。" },
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

  function open(fromHelp) { i = 0; const ov = $("onboard"); if (!ov) return; ov.classList.remove("hidden"); render(); }
  function finish() {
    clearSpot();
    const ov = $("onboard"); if (ov) ov.classList.add("hidden");
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
