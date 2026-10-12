/* v2/js/mind.js — 考えの札（[[v2ゲーム設計]] v2.s4.think）。エンジンが残した mind（狙いの内訳・候補の種類・構え・気持ち・目）を言葉と棒にする。
 * 数値は見せない（性格の裏の値は出さない）。観戦の札と、なぜ？の再生の札で同じ文を使う。文は駒の考えを三人称で書く。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KIND = { stay: "その場で構える", adv: "間合いを詰める", back: "下がる", lat: "横へずれる", rear: "背後へ回る", side: "側面へ回る", cover: "物陰へ入る" };
  const MV = { stay: "その場で", adv: "間合いを詰めて", back: "下がって", lat: "横へずれて", rear: "背後へ回って", side: "側面へ回って", cover: "物陰へ入って" };
  const ATK = { RANGED: "撃つ", SNAP: "即撃ち", MELEE: "斬る", ULT: "必殺", RELOAD: "装填", GRAB: "投げ", DODGE: "見切り", NONE: "撃てない" };
  // 狙いの理由（寄与の大きい順に2つ）。stick（狙いを変えない）は順位に入れず、末尾に添える
  const AIM = [
    ["ward", 0.01, "守る味方に迫っている"], ["peel", 0.01, "後衛に食らいついている"], ["taunt", 0.01, "割り込んで盾になっている"],
    ["cmd", 0.01, "隊長の号令"], ["opened", 0.3, "味方が崩したばかり"], ["lead", 0.01, "隊長と同じ的"], ["focus", 0.35, "味方と狙いを合わせる"], ["low", 0.3, "手負いで仕留めやすい"],
    ["iso", 0.8, "味方から孤立している"], ["threat", 0.3, "放っておくと危ない相手"], ["flank", 0.2, "側面や背後を取りやすい"],
    ["tank", 0.4, "目立つ固い敵から目が離せない"], ["lone", 0.3, "単騎で獲れる手柄"], ["near", -0.25, "一番近くにいる"], ["los", 0.01, "今すぐ撃てる"],
  ];
  function aimWhy(parts, alt, altName) {
    if (!parts) return { main: [], tail: [] };
    const xs = AIM.filter(([k, th]) => parts[k] != null && parts[k] > th).map(([k, , w]) => ({ v: k === "near" ? parts[k] + 1 : parts[k], w }));
    xs.sort((a, b) => b.v - a.v);
    const tail = [];
    if (alt && alt.gap < 0.35) tail.push(`${altName}とも迷った`);
    else if (alt && parts.stick > 0 && alt.gap < parts.stick) tail.push(`${altName}に変えるほどではないと、狙いを保つ`);   // 狙いの粘りが効いて的を変えなかった時だけ
    if (parts.trap != null && parts.trap > 0.4) tail.push("追えば他の敵の的になる");
    return { main: xs.slice(0, 2).map((x) => x.w), tail };
  }
  function stance(m) {
    const e = m.engI || {}, r = e.ratio || 1;
    if (m.search) return { w: "探る", why: m.age < 0 ? "まだ敵を見ていない" : "敵を見失っている" };
    if (m.eng === "retreat") return { w: "立て直す", why: m.hpf < 0.45 ? "傷が深い" : r < 0.7 ? "この撃ち合いは分が悪い" : "一度退いて間合いを取り直す" };
    if (m.eng === "commit") return { w: "攻める", why: e.up ? "数で勝っている" : r > 1.4 ? "この撃ち合いは勝てる" : (e.tgtLow || 0) > 0.5 ? "相手は手負い" : m.res > 0.7 ? "闘気が乗っている" : "押し切れると見た" };
    return { w: "探る", why: !m.engI ? "まだ本格的な撃ち合いではない" : r > 0.8 && r < 1.25 ? "五分の撃ち合い" : "様子を見ながら" };
  }
  function action(m, t) {
    if (m.search) {
      if (m.dir === "here") return m.age >= 0 ? "見失った敵の気配をその場で探る" : "その場で辺りを窺う";
      const d = { fwd: "前へ進む", back: "後ろへ下がる", up: "上手へ向かう", down: "下手へ向かう" }[m.dir] || "進む";
      return (m.age >= 0 ? "見失った敵の気配を追い、" : "敵影を求めて") + d + (m.hold ? "。隊形は崩さない" : "");
    }
    const W3 = { rear: `${t}の背後へ回り込む`, side: `${t}の側面へ回り込む`, cover: "射線を切れる物陰へ移る", peek: `物陰から${t}を窺って撃つ`, kite: `${t}を寄せつけず、間合いを保って下がる`, wait: `${t}が踏み込んでくる所で待ち構える`,
      pinrear: `${t}が弾幕に釘付けの隙に、背後へ回る`, pinside: `${t}が釘付けの隙に、側面へ回る` };
    let s;
    if (m.why3 && W3[m.why3]) s = W3[m.why3];
    else if (m.dodge) s = "攻撃を捨てて、見切りに専念する";
    else if (m.grab) s = `${t}に組み付いて投げる`;
    else {
      const at = { RANGED: `${t}を撃つ`, SNAP: `${t}へ据銃もそこそこに即撃ちする`, MELEE: `${t}に斬りかかる`, ULT: `必殺を${t}に叩き込む`, RELOAD: "装填する", NONE: m.ammo <= 0 ? "装填の間を探す" : m.los ? "撃てる間合いを作る" : `${t}を撃てる位置を探す` }[m.atk] || "様子を見る";
      s = m.kind === "back" && m.atk === "MELEE" ? `引きながら${t}に斬りかかる` : (MV[m.kind] || "") + at;
    }
    const roundabout = m.why3 ? /rear|side|cover/.test(m.why3) : (m.kind === "rear" || m.kind === "side" || m.kind === "cover");
    if (m.plan >= 2 && roundabout) s += `（あと${m.plan}ターンほど）`;
    if (m.tgtSeen === false) s += "。姿は見えず、最後に見た位置を頼りに動く";
    return s;
  }
  const predWord = (p) => (p == null ? "" : p < -5 ? "相手は寄ってくると読む" : p > 5 ? "相手は離れると読む" : "");   // 大きく動くと読んだ時だけ
  function mood(m) {
    const out = [];
    if (m.hpf < 0.25) out.push("満身創痍"); else if (m.hpf < 0.5) out.push("傷が深い");
    if (m.flinch) out.push("体勢を崩されている");
    if (m.supp >= 0.3) out.push("弾幕に釘付け");
    if (m.sta < 0.35) out.push("息が上がっている"); else if (m.sta > 0.85 && out.length < 2) out.push("気力は十分");
    if (m.mom > 0.4) out.push("勢いに乗っている"); else if (m.mom < -0.4) out.push("気圧されている");
    if (m.res >= 1) out.push("必殺の機を窺う"); else if (m.res > 0.6) out.push("闘気が高まっている");
    if (m.reload) out.push("装填中"); else if (m.ammo <= 0) out.push("弾切れ");
    if (m.fat >= 0.55) out.push("消耗が激しい"); else if (m.fat >= 0.35) out.push("疲れが残る");                 // 連戦の状態（v2.s4.cond）
    if (m.mor >= 0.4) out.push("士気が高い"); else if (m.mor <= -0.4) out.push("士気が低い");
    const OW = { fallback: "退け", guard: "守れ", focus: "集中", charge: "突っ込め", hold: "固まれ" };
    if (m.lead === "self") out.push(m.order && m.order.startsWith("give:") ? `隊長・号令「${OW[m.order.slice(5)] || ""}」` : "隊長"); else if (m.lead === "fell") out.push("隊長を失った");
    else if (m.order) out.push(m.obey >= 0.35 ? `号令に従う（${OW[m.order] || m.order}）` : "号令を無視");
    return out.slice(0, 5);
  }
  function eyes(m, nameOf) {
    const seen = (m.seen || []).map(nameOf), sensed = (m.sensed || []).map(nameOf), out = [];
    out.push(seen.length ? `見えている：${seen.join("・")}` : "見えている敵はいない");
    if (sensed.length) out.push(`気配だけ：${sensed.join("・")}`);
    out.push(m.hunted ? `自分を狙う敵 ${m.hunted}` : "今は狙われていない");
    return out;
  }
  const bar = (top, v) => Math.round(100 * Math.exp(-(top - v) / 10));
  // 札の HTML。unit＝{name, team, emb}、nameOf＝id→名前、pal＝色、opt.close＝閉じるボタン
  function card(m, unit, turn, nameOf, tkHtml, pal, opt) {
    const t = m && m.tgt ? nameOf(m.tgt) : "敵";
    const head = `<div class="mc-head">${tkHtml(unit.team, unit.emb, "tk-xs", pal)}<b>${esc(unit.name)}</b><small>ターン ${turn}</small>${opt && opt.close ? `<button class="mc-x" id="${opt.close}" title="閉じる">×</button>` : ""}</div>`;
    if (!m) return head + `<div class="mc-sec"><p>${unit.alive === false ? "倒れている" : "まだ考えが出ていない"}</p></div>`;
    const secs = [];
    if (m.search) secs.push(["狙い", `<p>見えている敵がいない</p>`]);
    else {
      const why = aimWhy(m.aim, m.alt, m.alt ? nameOf(m.alt.id) : ""), ps = [`<b>${esc(t)}</b>${why.main.length ? "——" + esc(why.main.join("。")) : ""}`];
      if (why.tail.length) ps.push(esc(why.tail.join("。")));
      const pw = predWord(m.pred); if (pw) ps.push(pw);
      secs.push(["狙い", `<p>${ps.join("。")}</p>`]);
    }
    const st = stance(m); secs.push(["構え", `<p><b>${st.w}</b>——${esc(st.why)}</p>`]);
    secs.push(["動き", `<p>${esc(action(m, t))}</p>`]);
    if (m.cands && m.cands.length > 1) {
      const top = m.cands[0].v, gap = top - m.cands[1].v, verdict = gap < 2 ? "ほぼ互角で迷った" : gap < 6 ? "少し迷った" : "迷いなく";
      secs.push(["迷い", `<div class="mc-cands">${m.cands.map((c) => `<div class="mc-c ${c.on ? "on" : ""}"><span>${KIND[c.k] || c.k}<small>${ATK[c.atk] || ""}</small></span><i><b style="width:${bar(top, c.v)}%"></b></i></div>`).join("")}</div><em>${verdict}</em>`]);
    }
    const md = mood(m); if (md.length) secs.push(["気持ち", `<p>${md.map((x) => `<span class="mc-tag">${x}</span>`).join("")}</p>`]);
    secs.push(["目", `<p>${eyes(m, nameOf).map(esc).join("<br>")}</p>`]);
    return head + secs.map(([h, b]) => `<div class="mc-sec"><small>${h}</small>${b}</div>`).join("");
  }
  SCS2.mind = { card, action, mood, stance, aimWhy, KIND };
})();
