/* tools/make_root.js — v2/index.html から、リポ直下の入口 index.html を作る（Obsidian [[v2ゲーム設計]] v2.entry）。
 * 直下の index.html は手で直さない。v2/index.html を直したら `node tools/make_root.js` を実行する。
 * <base href="v2/"> で v2 のファイル（css・js・assets・../js のエンジン）をそのまま読む。旧版の共有リプレイ（?r=）は classic.html へ送る。 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
let html = fs.readFileSync(path.join(root, "v2", "index.html"), "utf8");
const head = [
  '<script>if (/[?&]r=/.test(location.search)) location.replace("classic.html" + location.search);</script>',
  '<base href="v2/">',
  '<link rel="manifest" href="../manifest.webmanifest">',
].join("\n");
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + head);
html = html.replace("</body>", '<script>if ("serviceWorker" in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register("../sw.js", { scope: "../" }).catch(function () {});</script>\n</body>');
html = html.replace('<html lang="ja">', '<html lang="ja">\n<!-- 自動生成：tools/make_root.js（元は v2/index.html）。直接直さない -->');
fs.writeFileSync(path.join(root, "index.html"), html);
console.log("index.html written", html.length);
