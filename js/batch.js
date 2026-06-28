/* batch.js — headless バッチシミュレーション（決定論・無描画）。
 * 固定seed群で同じ人格対決を最後までフル完走し、勝率・平均ダメ収支・決着ターン・KO率を集計する。
 * 用途：設計画面の「勝率試算」と武器バランス検証。1戦の乱数ブレに埋もれる傾向を多数決で可視化する。
 * ★各seedで両ユニットを必ず作り直す（戦闘でユニット状態が変わるため）。描画層に非依存・乱数はseed由来＝決定論。
 */
window.SCS = window.SCS || {};

(function () {
  // 決定論の固定seed群（分散した値・countに依らず先頭から安定）
  function batchSeeds(count) {
    const out = [];
    let x = 0x2545f491 >>> 0;
    for (let i = 0; i < count; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; out.push(x); }
    return out;
  }

  // plrChoices/cpuChoices=10択配列。arena/mod=固定名（"ランダム"可）。seeds=seed配列。
  // 返り値：勝敗内訳・勝率%・平均ターン・平均与/被ダメ・KO率。
  function batchSim(plrChoices, cpuChoices, arena, mod, seeds, opts) {
    opts = opts || {};
    const cpuName = opts.cpuName || "CPU";
    let win = 0, lose = 0, draw = 0, turnsSum = 0, dealtSum = 0, takenSum = 0, ko = 0, n = 0;
    for (const s0 of seeds) {
      const s = s0 >>> 0;
      const plr = SCS.derive.buildUnit("YOU", plrChoices);
      const cpu = SCS.derive.buildUnit(cpuName, cpuChoices);
      const b = SCS.makeBattle(plr, cpu, s, arena, mod);
      let guard = 0;
      while (!b.over && guard++ < 400) b.step();
      const r = b.result || { type: "draw" };
      const a = b.getAnalysis();
      n++;
      if (r.type === "win") { if (r.winner === "PLR") win++; else lose++; }
      else draw++;
      if (r.type === "win" && r.winner === "PLR" && r.text === "KO") ko++;
      turnsSum += a.turns;
      dealtSum += a.plr.dmgDealt;
      takenSum += a.plr.dmgTaken;
    }
    const d = n || 1;
    return {
      n, win, lose, draw,
      winRate: Math.round((win / d) * 100),
      loseRate: Math.round((lose / d) * 100),
      drawRate: Math.round((draw / d) * 100),
      koRate: Math.round((ko / d) * 100),
      avgTurns: Math.round((turnsSum / d) * 10) / 10,
      avgDealt: Math.round(dealtSum / d),
      avgTaken: Math.round(takenSum / d),
    };
  }

  // 非同期・チャンク版：メインスレッドを塞がず（setTimeoutで制御を返す）フル精度で回す。
  // ★予測勝率は観戦する実戦と一致させる＝先読み/MCを削らない（削ると相性依存で6〜10ppズレる）。
  // 代わりにUIへ逐次 onProgress(tally) を返し、進捗バーを満たしながら待たせる。file://でも動く（Worker不使用）。
  // opts: { chunk, cpuName, onProgress(tally), cancelled():bool }
  function batchSimAsync(plrChoices, cpuChoices, arena, mod, seeds, opts) {
    opts = opts || {};
    const chunk = opts.chunk || 3, cpuName = opts.cpuName || "CPU", total = seeds.length;
    let i = 0, win = 0, lose = 0, draw = 0, turnsSum = 0, dealtSum = 0, takenSum = 0, ko = 0;
    const tally = (cancelled) => {
      const d = i || 1;
      return {
        n: i, total, win, lose, draw, cancelled: !!cancelled, done: i >= total,
        winRate: Math.round((win / d) * 100), loseRate: Math.round((lose / d) * 100), drawRate: Math.round((draw / d) * 100),
        koRate: Math.round((ko / d) * 100), avgTurns: Math.round((turnsSum / d) * 10) / 10,
        avgDealt: Math.round(dealtSum / d), avgTaken: Math.round(takenSum / d),
      };
    };
    return new Promise((resolve) => {
      const runChunk = () => {
        if (opts.cancelled && opts.cancelled()) { resolve(tally(true)); return; }
        const end = Math.min(i + chunk, total);
        for (; i < end; i++) {
          const s = seeds[i] >>> 0;
          const plr = SCS.derive.buildUnit("YOU", plrChoices), cpu = SCS.derive.buildUnit(cpuName, cpuChoices);
          const b = SCS.makeBattle(plr, cpu, s, arena, mod);
          let g = 0; while (!b.over && g++ < 400) b.step();
          const r = b.result || { type: "draw" }, a = b.getAnalysis();
          if (r.type === "win") { if (r.winner === "PLR") { win++; if (r.text === "KO") ko++; } else lose++; } else draw++;
          turnsSum += a.turns; dealtSum += a.plr.dmgDealt; takenSum += a.plr.dmgTaken;
        }
        if (opts.onProgress) opts.onProgress(tally(false));
        if (i < total) (typeof setTimeout !== "undefined" ? setTimeout(runChunk, 0) : runChunk());
        else resolve(tally(false));
      };
      runChunk();
    });
  }

  SCS.batchSim = batchSim;
  SCS.batchSimAsync = batchSimAsync;
  SCS.batchSeeds = batchSeeds;
})();
