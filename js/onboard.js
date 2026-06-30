/* onboard.js — ⑤ 初回オンボーディング＋コアループの明示。
 * 「君は戦わない。性格を設計し、観て、直す」を最初に渡す。初回のみ自動表示（localStorageでスキップ可）、ヘッダーの「？」で再生。
 * 描画/DOMのみ＝シム・決定論に非干渉。CRT調・絵文字不使用。
 */
window.SCS = window.SCS || {};

(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = "scs_onboarded_v2"; // v2＝分隊戦メイン化に伴い刷新（旧版を見た人にも新導入を出す）
  let i = 0, spot = null;

  // 4ステップ：① コンセプト ② 編成 ③ 観戦（群戦） ④ 分析→再設計（ループ）
  const STEPS = [
    { t: "ようこそ — これは『戦わない』対戦ゲーム", target: null,
      b: "君は戦闘を操作しない。<b>AIの“性格”を設計</b>し、その子たちが自動で戦うのを<b>観て・分析して・また設計し直す</b>。<br><span class=\"ob-dim\">メインは<b>分隊戦</b>——3体の人格を編成し、役割を補完させて勝つ。1体を完璧にするのでなく“チーム”を設計するゲームだ。</span>" },
    { t: "① 編成する — 3体の役割を補完させる", target: "sqRoster",
      b: "上の3枠が君の分隊。各<b>戦士</b>の人格を設計すると、HP・武器・<b>戦法ラベル</b>（速攻/カイト/要塞…）が即決まる。<br><b>前衛(壁/近接)</b>が射線と肉薄を引き受け、<b>後衛(射手)</b>が安全に削る——役割をかみ合わせよ。" },
    { t: "② 観戦する — レーダーに群戦が展開", target: "sqFoot",
      b: "<b>〔出撃〕</b>すると上空レーダーに6体の撃ち合いが描かれる。各体→狙う敵への線で<b>集中砲火</b>が一目。<b>側背面</b>の刺し合い、前衛が落ちると後衛が裸になる<b>崩壊の連鎖</b>——群戦のドラマを観る。" },
    { t: "③ 直す — 分隊分析で編成を磨く", target: "modeBar",
      b: "決着後の<b>分隊分析</b>が「誰が主力で、どの役割が噛み合わなかったか」を教える。それを見て編成を組み直す——これが <b>設計→観戦→分析</b> のループ。<br><span class=\"ob-dim\">1体ずつの精密なデュエルを楽しむ<b>自由対戦</b>・<b>ストーリー</b>も上のタブから。</span>" },
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
