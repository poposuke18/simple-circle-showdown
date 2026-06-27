/* rng.js — シード付き決定論乱数（mulberry32）
 * 同じ人格＋同じシード → 必ず同じ戦闘。リプレイ・公平な再調整・勝率予測の土台。
 */
window.SCS = window.SCS || {};

SCS.makeRNG = function (seed) {
  let s = (seed >>> 0) || 1;
  function next() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    chance: (p) => next() < p,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
};
