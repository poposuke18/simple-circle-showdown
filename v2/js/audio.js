/* v2/js/audio.js — 曲（BGM）とジングル（Obsidian [[Steam公開計画]] depth.7.play）。
 * 描画層だけ＝戦いの乱数・エンジンには触れない。画面ごとに曲を選び、同じ曲なら続け、変わる時だけ 0.6 秒で入れ替える。
 * ファイルが無い・読めない時は黙って無音。音はブラウザの決まりで最初のクリック/キーから。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  const KEY = "scs2.audio.v1", DIR = "assets/audio/", XF = 0.6, MASTER = 0.8;
  const WATCH = { plaza: "arena", lavabridge: "lava", mistwood: "forest", city: "city", tide: "tide", spring: "spring" };   // 戦場 key → 観戦の曲
  const SCREEN = { title: "bgm_title", records: "bgm_title", line: "bgm_title", squad: "bgm_prep", edit: "bgm_prep", prep: "bgm_prep", league: "bgm_prep", spec: "bgm_prep", result: "bgm_prep", why: "bgm_prep" };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let vol = 70, muted = false;
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && typeof s === "object") { if (Number.isFinite(s.vol)) vol = clamp(Math.round(s.vol), 0, 100); muted = !!s.muted; } } catch (e) { /* 保存なし */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ vol, muted })); } catch (e) { /* 保存できない環境 */ } };
  const gainOf = () => (muted ? 0 : (vol / 100) * MASTER);

  let ctx = null, master = null;
  const bufs = {};                                                                          // 名前 → AudioBuffer（null＝無い・Promise＝読み込み中）
  let cur = null;                                                                           // 今鳴っている曲 {name, src, gain}
  let want = null;                                                                          // 求められている曲（解禁前・読み込み中・ジングル中はここに覚えて後で鳴らす）
  let jingling = false;
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = gainOf(); master.connect(ctx.destination);
    return ctx;
  }
  const running = () => ctx && ctx.state === "running";
  function unlock() {                                                                       // 最初の操作で解禁。待っていた曲があれば始める
    const c = ensure(); if (!c) return;
    if (c.state === "suspended") c.resume().then(() => { if (want) play(want); }).catch(() => {});
    else if (want && !cur) play(want);
  }
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);

  function load(name) {
    if (name in bufs) return Promise.resolve(bufs[name]);
    const p = fetch(DIR + name + ".ogg").then((r) => (r.ok ? r.arrayBuffer() : null)).then((ab) => (ab && ensure() ? ctx.decodeAudioData(ab) : null)).catch(() => null)
      .then((b) => { bufs[name] = b || null; return bufs[name]; });
    bufs[name] = p; return p;
  }
  function stopCur(t) {
    if (!cur) return;
    const { src, gain } = cur, now = ctx.currentTime; cur = null;
    gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now); gain.gain.linearRampToValueAtTime(0, now + t);
    try { src.stop(now + t + 0.05); } catch (e) { /* 既に止まっている */ }
  }
  function start(name, b) {
    const c = ctx, now = c.currentTime, g = c.createGain();
    g.gain.setValueAtTime(cur ? 0 : 0.0001, now); g.gain.linearRampToValueAtTime(1, now + XF); g.connect(master);
    const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.connect(g); s.start(now);
    stopCur(XF); cur = { name, src: s, gain: g };
  }
  function play(name) {                                                                     // 画面の曲を求める。同じ曲なら何もしない
    want = name;
    if (jingling || !ensure() || !running()) return;
    if (cur && cur.name === name) return;
    load(name).then((b) => {
      if (want !== name || jingling || !running()) return;
      if (cur && cur.name === name) return;
      if (!b) { stopCur(XF); return; }                                                      // 無いファイル＝無音
      start(name, b);
    });
  }
  function jingle(name) {                                                                   // 一度だけ鳴らし、終わったら求められている曲へ
    if (!ensure() || !running()) return;
    jingling = true;
    load(name).then((b) => {
      if (!b || !running()) { jingling = false; if (want) play(want); return; }
      stopCur(0.3);
      const c = ctx, g = c.createGain(); g.gain.value = 1; g.connect(master);
      const s = c.createBufferSource(); s.buffer = b; s.connect(g); s.onended = () => { jingling = false; if (want) play(want); };
      s.start(c.currentTime + 0.25);
    });
  }

  // ===== 画面との対応 =====
  function screen(name, arenaKey) {
    const track = name === "watch" ? "bgm_watch_" + (WATCH[arenaKey] || "arena") : SCREEN[name];
    if (track) play(track);
  }
  const result = (r) => jingle({ w: "jingle_win", l: "jingle_lose", d: "jingle_draw" }[r] || "jingle_draw");

  // ===== 音量 =====
  function apply() { if (master) { const now = ctx.currentTime; master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now); master.gain.linearRampToValueAtTime(gainOf(), now + 0.15); } }
  function setVol(v) { vol = clamp(Math.round(v), 0, 100); if (vol > 0 && muted) muted = false; apply(); save(); }
  function setMuted(m) { muted = !!m; apply(); save(); }

  SCS2.audio = { screen, result, play, setVol, setMuted, get vol() { return vol; }, get muted() { return muted; }, get playing() { return cur ? cur.name : null; } };
})();
