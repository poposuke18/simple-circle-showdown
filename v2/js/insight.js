/* v2/js/insight.js — 記録（毎ターンのスナップショット）から読み取るもの（Obsidian [[v2ゲーム設計]] v2.k1.* / v2.k2.chain）。
 * ①「そう来たか」＝見えている性格の言葉と逆の行動をした瞬間 ②リプレイ再生 ③なぜ？の因果の鎖。
 * 使うのは見えるもの（性格の言葉・行動ラベル・当たり・撃破・記録の文）だけ。挙動24（小カテゴリ）は使わない。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const D = SCS.DATA;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/^[\s　─]+/, "").replace(/（[^）]*）/g, "").trim();
  const FX_KIND = { ranged: "tracer", melee: "slash", "ult-ranged": "beam", "ult-melee": "burst", counter: "slash", grab: "slash" };   // エンジンが出す攻撃の記録（反撃・投げは斬撃の見た目）
  const attOf = (e) => (e.aTeam || e.team) + e.aIdx;                                          // 攻め手の id
  // 当てた相手の id：記録の dTeam/dIdx（無い古い記録だけ、攻め手の敵のうち当たった所に一番近い駒）
  function defOf(e, sn) {
    if (e.dTeam) return e.dTeam + e.dIdx;
    let b = null, bd = 1e9; for (const u of sn.units) { if (u.team === (e.aTeam || e.team)) continue; const d = Math.hypot(u.x - e.to.x, u.y - e.to.y); if (d < bd) { bd = d; b = u.id; } } return b;
  }
  // そのターンに id を倒した駒（id に一番多く当てた敵）。毒・炎・溶岩などで倒れた時は null
  function killerOf(sn, id) {
    let best = null, bd = 0; for (const e of sn.events) { if (!e.to || (e.hits || 0) <= 0 || !(e.dmg > 0) || defOf(e, sn) !== id) continue; if (e.dmg > bd) { bd = e.dmg; best = attOf(e); } } return best;
  }

  // ===== ①「そう来たか」：性格の言葉と逆の行動 =====
  // 振り切った言葉（4択の端）だけを見る。[軸, 段, 逆の行動ラベル]。した事は行動ラベルから
  const VERB = { 攻勢: "攻勢に出た", 詰め: "詰め寄った", 斬: "斬り込んだ", 背後: "背後を突いた", 必殺: "必殺を放った", 退避: "退いた", 立て直し: "退いた", かばう: "仲間をかばった", 盾: "盾になった" };
  const RULES = [
    [0, 0, ["攻勢", "詰め", "斬", "背後", "必殺"]],                                       // 専守防衛なのに攻めた
    [0, 3, ["退避", "立て直し"]],                                                          // 猪突猛進なのに退いた
    [6, 3, ["背後"]],                                                                      // 騎士道なのに背後を突いた
    [6, 0, ["かばう", "盾"]],                                                              // 手段選ばずなのに仲間をかばった
    [7, 3, ["かばう"]],                                                                    // 冷酷無慈悲なのに仲間をかばった
    [8, 0, ["攻勢", "必殺", "斬"]],                                                        // 弱気なのに攻めた
    [8, 3, ["退避", "立て直し"]],                                                          // 過信・慢心なのに退いた
    [3, 3, ["攻勢", "詰め", "斬"], 6],                                                     // 待ち徹底なのに序盤に仕掛けた（6ターン目まで）
  ];
  function surprises(snaps, choicesOf) {
    const out = [], usedUnit = new Set();
    for (let t = 1; t < snaps.length; t++) {
      const s = snaps[t], pv = new Map(snaps[t - 1].units.map((u) => [u.id, u]));
      for (const u of s.units) {
        if (!u.alive || usedUnit.has(u.id)) continue; const c = choicesOf(u.id); if (!c) continue;
        const was = pv.get(u.id); if (was && was.label === u.label) continue;            // その行動を始めた瞬間だけ
        const r = RULES.find(([ax, v, labels, until]) => c[ax] === v && labels.includes(u.label) && (!until || s.turn <= until)); if (!r) continue;
        // 行動ラベルだけでなく、実際の動きで確かめる（攻めた＝敵へ近づいた/攻撃した・退いた＝敵から離れた）
        const keep = (x) => x.alive && x.team !== u.team && !s.died.includes(x.id);
        const foes0 = snaps[t - 1].units.filter(keep), foes1 = s.units.filter(keep); if (!foes0.length || !foes1.length) continue;
        const dn = (p, fs) => fs.reduce((m, f) => Math.min(m, Math.hypot(f.x - p.x, f.y - p.y)), 1e9);
        const closer = was ? dn(was, foes0) - dn(u, foes1) : 0, attacked = s.events.some((e) => attOf(e) === u.id && (e.type === "melee" || e.type === "ult-melee" || e.type === "ult-ranged"));
        const isRetreat = r[2].includes("退避") || r[2].includes("立て直し");
        if (isRetreat ? closer > -3 : !(attacked || closer > 3 || u.label === "背後")) continue;
        usedUnit.add(u.id);                                                               // 1体につき1回（一番最初の「そう来たか」）
        out.push({ t, id: u.id, other: u.tgt, score: 5 + (u.team === "P" ? 0.8 : 0), cap: `${u.name}、${D.MACROS[r[0]].poles[r[1]]}なのに${VERB[u.label] || u.label}`, sub: "", surprise: true });
      }
      for (const id of s.died) {                                                          // お人好しなのに仕留めた
        const pu = pv.get(id); if (!pu) continue; const killer = killerOf(s, id);
        const c = killer && choicesOf(killer), ku = killer && s.units.find((x) => x.id === killer);
        if (c && ku && c[7] === 0) out.push({ t, id: killer, other: id, score: 5 + (ku.team === "P" ? 0.8 : 0), cap: `${ku.name}、${D.MACROS[7].poles[0]}なのに仕留めた`, sub: `${pu.name} が倒れた`, surprise: true });
      }
    }
    return out;
  }

  // ===== ② リプレイ：記録の from〜to ターンを補間して動かす（slowT のターンはゆっくり）=====
  function makeReplay(snaps, from, to, slowT) {
    from = clamp(from, 0, snaps.length - 1); to = clamp(to, from, snaps.length - 1);
    const vs = new Map(), fx = [], pops = [];
    let k = from, segStart = 0, holdUntil = 0, started = false, segBegun = -1;
    const iconOf = (u) => (u.alive ? SCS2.board.ICON_OF[u.label] || "dots" : null);
    function reset(clock) {
      vs.clear(); fx.length = 0; pops.length = 0;
      for (const u of snaps[from].units) vs.set(u.id, { ...u, trail: [], icon: iconOf(u), iconT: -1e9, hitT: -1e9, koT: 0, fx0: u.x, fy0: u.y, ang0: u.ang });
      vs.forEach((v) => (v.tgt = v.tgt && typeof v.tgt === "string" ? vs.get(v.tgt) || null : null));
      k = from; segStart = clock; holdUntil = 0; started = true; segBegun = -1;
    }
    function beginSeg(clock) {                                                              // k→k+1 の始まり：演出・ラベル・HP・撃破
      const nx = snaps[k + 1]; let n = 0;
      for (const v of vs.values()) { v.fx0 = v.x; v.fy0 = v.y; v.ang0 = v.ang; }
      SCS2.board.gimFx(nx.events, clock + 120, (id) => vs.get(id), fx, pops);                 // 戦場のギミック（噴火・壁の崩れ・泉の回復）
      for (const e of nx.events) {
        if (!e.from || !e.to) continue;
        const va = vs.get(attOf(e)), vb = vs.get(defOf(e, nx)); if (!va || !vb) continue;
        const kind = FX_KIND[e.type]; if (!kind) continue;
        const t0 = clock + 120 + Math.min(300, n++ * 70), hit = (e.hits || 0) > 0, slow = k + 1 === slowT ? 1.8 : 1;
        fx.push({ t0, va, vb, team: va.team, hit, crit: !!e.crit, kind, dur: (kind === "beam" || kind === "burst" ? 640 : 380) * slow });
        if (hit) fx.push({ t0: t0 + 200 * slow, va, vb, team: va.team, hit, crit: !!e.crit, kind: "impact", dur: 340 * slow });
        if (hit && (e.dmg || 0) > 0) pops.push({ v: vb, t0: t0 + 220 * slow, kind: e.crit ? "crit" : "dmg", text: (e.crit ? "会心 " : "") + "-" + Math.round(e.dmg) });
      }
      for (const u of nx.units) {
        const v = vs.get(u.id); if (!v) continue;
        if (u.hp < v.hp) v.hitT = clock + 300;
        if (!u.alive && v.alive) v.koT = clock + 450;
        v.alive = u.alive; v.hp = u.hp; v.label = u.label; v.stamina = u.stamina; v.hidden = false;
        const ic = iconOf(u); if (ic !== v.icon) { v.icon = ic; v.iconT = clock; }
        v.tgt = u.tgt ? vs.get(u.tgt) || null : null;
      }
    }
    function tick(clock) {
      if (!started) reset(clock);
      if (holdUntil) { if (clock >= holdUntil) reset(clock); else return; }
      if (k >= to) { holdUntil = clock + 1100; return; }
      const dur = k + 1 === slowT ? 1900 : 950;
      if (segBegun !== k) { segBegun = k; beginSeg(clock); }
      const e = ease(clamp((clock - segStart) / (dur * 0.85), 0, 1)), nx = snaps[k + 1];
      for (const u of nx.units) {
        const v = vs.get(u.id); if (!v) continue;
        const px = v.x, py = v.y; v.x = lerp(v.fx0, u.x, e); v.y = lerp(v.fy0, u.y, e);
        let da = (u.ang || 0) - (v.ang0 || 0); while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; v.ang = (v.ang0 || 0) + da * e;
        if (Math.hypot(v.x - px, v.y - py) > 0.02) v.trail.push({ x: v.x, y: v.y, t: clock });
        while (v.trail.length && clock - v.trail[0].t > (k + 1 === slowT ? 1100 : 520)) v.trail.shift();
      }
      if (clock - segStart >= dur) { k++; segStart = clock; }
    }
    // 今見せている区間の戦場：壁は区間の後（崩れた跡）、潮・泉は区間のターン、噴く前触れは区間の前のもの
    function field() { const a = snaps[k], b = snaps[Math.min(k < to ? k + 1 : k, snaps.length - 1)]; return { obstacles: b.obstacles, hazards: b.hazards, gimmick: b.gimmick && a.gimmick ? Object.assign({}, b.gimmick, { vents: a.gimmick.vents }) : b.gimmick }; }
    return { tick, get views() { return [...vs.values()]; }, fx, pops, field };
  }

  // ===== ③ なぜ？の因果の鎖 =====
  // 返り値: [{ n, kind:"cause"|"act"|"result", a:{x,y}, b:{x,y}, team, text }]（a→b の矢印と、その説明）
  function chainFor(snaps, t, id, ACT_OF) {
    const s = snaps[t], prev = snaps[Math.max(0, t - 1)], next = snaps[Math.min(snaps.length - 1, t + 1)];
    const U = (sn, uid) => sn.units.find((u) => u.id === uid), sub = U(s, id); if (!sub) return [];
    const defU = (e, sn) => U(sn, defOf(e, sn));                                              // 当てた相手の駒
    const nm = ">" + sub.name.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]) + "</span> は";
    const subjLines = s.lines.filter((l) => (l.cls === "ex" || l.cls === "cm") && l.text.indexOf(nm) >= 0);
    const myEv0 = s.events.find((e) => attOf(e) === id && e.to), def0 = myEv0 ? defU(myEv0, s) : null;
    const matched = def0 && subjLines.find((l) => strip(l.text).indexOf(def0.name) >= 0), line = matched || subjLines[0];
    let cause = "", act = "";
    if (line) { const raw = line.text, i = raw.indexOf(nm), before = strip(raw.slice(0, raw.lastIndexOf("<span", i) >= 0 ? raw.lastIndexOf("<span", i) : i)), after = strip(raw.slice(i + nm.length)); cause = before.replace(/、$/, "").trim(); act = after.replace(/。$/, ""); }
    if (def0 && !matched) act = `${def0.name} を${myEv0.type === "melee" || myEv0.type === "ult-melee" ? "斬った" : "撃った"}`;   // 記録の文が別の相手の時は、した事だけを短く
    const steps = [];
    // ① きっかけ
    let ca = null, ctext = "";
    const fellAlly = [t, t - 1].map((k) => snaps[Math.max(0, k)]).flatMap((sn) => sn.died.map((d) => U(sn, d))).find((u) => u && u.team === sub.team && u.id !== id);
    const hitBy = [s, prev].flatMap((sn) => sn.events.filter((e) => e.to && (e.hits || 0) > 0 && defOf(e, sn) === id))[0];   // 自分に当てた敵（記録どおり）
    if (fellAlly) { ca = fellAlly; ctext = `${fellAlly.name} が倒れた`; }
    else if (hitBy) { ca = U(s, attOf(hitBy)); if (ca) ctext = `${ca.name} に撃たれた`; }
    if (!ca) { ca = s.units.find((u) => u.alive && u.team !== sub.team && u.tgt === id); if (ca) ctext = `${ca.name} に狙われた`; }
    if (!ca && sub.tgt) { ca = U(s, sub.tgt); if (ca) ctext = `${ca.name} を見つけた`; }
    if (ca) steps.push({ n: 1, kind: "cause", a: { x: ca.x, y: ca.y }, b: { x: sub.x, y: sub.y }, team: ca.team, text: cause || ctext });
    // ② した事
    const myEv = myEv0;
    const was = U(prev, id), moved = was && Math.hypot(was.x - sub.x, was.y - sub.y) > 2;
    let bpt = null;
    if (myEv) { const d = defU(myEv, s); if (d && d.id !== id) bpt = d; }
    if (bpt) steps.push({ n: steps.length + 1, kind: "act", a: { x: sub.x, y: sub.y }, b: { x: bpt.x, y: bpt.y }, team: sub.team, text: act || `${bpt.name} を攻撃した` });
    else if (moved) steps.push({ n: steps.length + 1, kind: "act", a: { x: was.x, y: was.y }, b: { x: sub.x, y: sub.y }, team: sub.team, text: act || (ACT_OF[sub.label] || sub.label) });
    else steps.push({ n: steps.length + 1, kind: "act", a: { x: sub.x, y: sub.y }, b: { x: sub.x, y: sub.y }, team: sub.team, text: act || (ACT_OF[sub.label] || sub.label), still: true });
    // ③ その結果（この瞬間と次のターン）
    let rtext = "", ra = null, rb = null;
    if (bpt && myEv) {                                                                    // ②が攻撃なら、その攻撃の結果
      const hits = s.events.filter((e) => attOf(e) === id && e.to && defOf(e, s) === bpt.id), dmg = hits.reduce((a2, e) => a2 + ((e.hits || 0) > 0 ? e.dmg || 0 : 0), 0);
      rtext = s.died.includes(bpt.id) ? `${bpt.name} を仕留めた` : dmg > 0 ? `${bpt.name} に −${Math.round(dmg)}` : `${bpt.name} に外れた`; ra = sub; rb = bpt;
    }
    for (const sn of [s, next]) {
      if (rtext) break;
      if (sn.died.includes(id)) { const kid = killerOf(sn, id), k2 = kid && U(sn, kid); rtext = k2 ? `${k2.name} に倒された` : "倒れた"; if (k2) { ra = U(s, k2.id) || k2; rb = sub; } break; }
      const mine = sn.events.filter((e) => attOf(e) === id && (e.hits || 0) > 0 && e.to);
      if (mine.length) { const d = defU(mine[0], sn), dmg = mine.filter((e) => d && defOf(e, sn) === d.id).reduce((a, e) => a + (e.dmg || 0), 0); if (d) { rtext = sn.died.includes(d.id) ? `${d.name} を仕留めた` : `${d.name} に −${Math.round(dmg)}`; ra = sub; rb = U(s, d.id) || d; } }
    }
    if (!rtext) { const nu = U(next, id); if (nu) { rtext = nu.alive ? `${ACT_OF[nu.label] || nu.label}` : "倒れた"; } }
    if (rtext) steps.push({ n: steps.length + 1, kind: "result", a: ra ? { x: ra.x, y: ra.y } : null, b: rb ? { x: rb.x, y: rb.y } : null, team: ra ? ra.team : sub.team, text: rtext });
    return steps;
  }

  SCS2.insight = { surprises, makeReplay, chainFor, killerOf };
})();
