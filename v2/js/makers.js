/* v2/js/makers.js — 作り手と部隊（Obsidian [[v2ゲーム設計]] 第5段 v2.s5.maker / v2.s5.makers / v2.s5.squads）。
 * 相手の部隊は必ず「作り手」に属する。12人・各2部隊＝24部隊（写し身は別）。
 * 作り手の性格はゲームと同じ軸の言葉（順応性・自信・好奇心＝0〜3）と核（部隊すべてに通る軸と極）。核は作り直し（5c）でも動かない。
 * 既存7部隊（data.js SQUAD_CAMPAIGN）は元のまま作り手に付け、ここでは新しい17部隊だけを持つ。 */
window.SCS2 = window.SCS2 || {};
(function () {
  "use strict";
  // 作り手：adapt＝順応性・conf＝自信・cur＝好奇心（0〜3・人格10軸の言葉で読む）、core＝[軸, 極]（極は 0〜3 の値の側）、hue＝色相、line＝流儀の一行
  const MAKERS = [
    { key: "kaze",   name: "カゼ",   adapt: 1, conf: 2, cur: 1, core: [[0, 3]],          hue: 0,   line: "先に殴る。昔からそうだ" },
    { key: "roku",   name: "ロク",   adapt: 0, conf: 3, cur: 2, core: [[4, 0], [5, 0]],  hue: 28,  line: "群れは要らない。腕だけでいい" },
    { key: "shizuku", name: "シズク", adapt: 2, conf: 1, cur: 3, core: [[5, 3]],         hue: 270, line: "姿を見せた方が負ける" },
    { key: "gen",    name: "ゲン",   adapt: 0, conf: 2, cur: 0, core: [[4, 3]],          hue: 215, sat: 28, line: "一歩も退かない。それだけだ" },
    { key: "en",     name: "エン",   adapt: 1, conf: 3, cur: 2, core: [[6, 0]],          hue: 325, line: "焼けば終わる。手段は問わない" },
    { key: "mina",   name: "ミナ",   adapt: 2, conf: 2, cur: 1, core: [[3, 3], [2, 3]],  hue: 140, line: "見えた時には、終わっている" },
    { key: "tsukasa", name: "ツカサ", adapt: 3, conf: 1, cur: 2, core: [[6, 3]],         hue: 48,  line: "核は渡さない。形は変える" },
    { key: "haru",   name: "ハル",   adapt: 2, conf: 2, cur: 3, core: [[3, 0], [0, 2]],  hue: 20,  line: "夜明け前に片を付ける" },
    { key: "sora",   name: "ソラ",   adapt: 3, conf: 1, cur: 1, core: [[2, 3], [8, 1]],  hue: 183, line: "風を読んでから撃つ" },
    { key: "rin",    name: "リン",   adapt: 1, conf: 3, cur: 1, core: [[7, 3], [1, 3]],  hue: 350, line: "情けは刃を鈍らせる" },
    { key: "yuki",   name: "ユキ",   adapt: 1, conf: 0, cur: 0, core: [[0, 0], [1, 0]],  hue: 252, line: "守り切れば、負けはしない" },
    { key: "takeru", name: "タケル", adapt: 0, conf: 3, cur: 2, core: [[8, 3], [2, 0]],  hue: 12,  line: "俺の部隊が一番強い" },
  ];
  // 既存7部隊の作り手
  const MAKER_OF = { redcrow: "kaze", strays: "roku", mistshade: "shizuku", stonewall: "gen", pyre: "en", blackpine: "mina", ringkeep: "tsukasa" };
  // 新しい17部隊（arena は v2 の戦場 key）
  const EXTRA = [
    { key: "kurokaze", maker: "kaze", name: "黒風の槍", flavor: "「風より先に、槍が届く」", scout: "楔の先端に猪突が二枚。橋の上で止まらない。", form: "楔", arena: "lavabridge",
      squad: [[3, 2, 1, 0, 2, 1, 1, 2, 2, 1], [3, 3, 2, 0, 1, 1, 1, 2, 3, 0], [2, 1, 2, 1, 3, 2, 2, 1, 1, 1]] },
    { key: "loners", maker: "roku", name: "群れぬ者たち", flavor: "「背中は預けない。預けた奴から死ぬ」", scout: "三人とも勝手に動く。だが一人ずつは厄介。", form: "散開", arena: "city",
      squad: [[2, 3, 0, 0, 0, 0, 0, 3, 3, 2], [3, 2, 1, 1, 0, 1, 1, 2, 3, 3], [1, 3, 1, 0, 0, 0, 0, 2, 2, 2]] },
    { key: "mizukagami", maker: "shizuku", name: "水鏡の三人", flavor: "「水面は、映すだけで語らない」", scout: "相手の出方を見てから形を変える。霧の中で待つ。", form: "散開", arena: "mistwood",
      squad: [[1, 1, 3, 2, 1, 3, 1, 2, 1, 3], [2, 2, 2, 1, 0, 3, 0, 2, 1, 3], [1, 2, 3, 3, 1, 3, 1, 1, 1, 2]] },
    { key: "tetsumon", maker: "gen", name: "鉄門の衛士", flavor: "「門は、閉じるためにある」", scout: "盾を二枚並べ、後ろの射手を守り切る戦列。", form: "戦列", arena: "spring",
      squad: [[0, 0, 3, 3, 3, 2, 3, 1, 1, 0], [1, 0, 3, 3, 3, 2, 2, 1, 1, 0], [1, 1, 3, 2, 3, 2, 2, 2, 1, 1]] },
    { key: "haimai", maker: "en", name: "灰の舞い手", flavor: "「灰になるまで、踊らせてやる」", scout: "火と毒で削り、仕留めは問わない。手段を選ばない三人。", form: "楔", arena: "lavabridge",
      squad: [[2, 2, 1, 1, 0, 3, 0, 3, 2, 3], [2, 3, 1, 0, 1, 2, 0, 2, 2, 3], [3, 2, 2, 1, 1, 2, 0, 2, 3, 2]] },
    { key: "enrai", maker: "mina", name: "遠雷の三弓", flavor: "「雷は、音より先に落ちる」", scout: "三人とも待ちの射手。干潟の向こうから撃ち続ける。", form: "戦列", arena: "tide",
      squad: [[1, 1, 3, 3, 3, 2, 2, 2, 1, 1], [0, 1, 3, 3, 2, 2, 2, 2, 0, 1], [1, 0, 3, 3, 3, 2, 2, 1, 1, 0]] },
    { key: "souyoku", maker: "tsukasa", name: "双翼の盾", flavor: "「翼は、守るために広げる」", scout: "騎士道の盾が二枚、翼のように後衛を囲む。", form: "円陣", arena: "spring",
      squad: [[1, 0, 2, 2, 3, 2, 3, 1, 1, 1], [1, 1, 3, 2, 2, 3, 3, 0, 1, 1], [2, 1, 2, 1, 2, 2, 3, 2, 2, 1]] },
    { key: "asagake", maker: "haru", name: "朝駆けの三騎", flavor: "「夜明けを待つ奴に、朝は来ない」", scout: "とにかく早い。開始数ターンで勝負を決めにくる。", form: "楔", arena: "plaza",
      squad: [[3, 2, 1, 0, 2, 1, 2, 2, 2, 2], [2, 2, 2, 0, 1, 2, 1, 2, 2, 3], [2, 3, 1, 0, 2, 2, 1, 2, 3, 2]] },
    { key: "hinata", maker: "haru", name: "日向の犬たち", flavor: "「陽のある内に、全部終わらせる」", scout: "攻め急ぐが人は良い。仲間をかばって自分が倒れる。", form: "散開", arena: "plaza",
      squad: [[2, 2, 1, 0, 1, 2, 2, 0, 1, 3], [3, 1, 2, 0, 2, 2, 3, 0, 2, 2], [2, 2, 2, 1, 1, 3, 2, 0, 1, 3]] },
    { key: "utsusemi", maker: "sora", name: "空蝉の射手", flavor: "「抜け殻を撃っている間に、本体が撃つ」", scout: "冷静な射手三人。囮と本命を入れ替える。", form: "散開", arena: "mistwood",
      squad: [[1, 1, 3, 2, 2, 3, 2, 2, 1, 1], [1, 2, 3, 1, 2, 3, 1, 2, 1, 2], [2, 1, 3, 2, 2, 2, 2, 2, 1, 1]] },
    { key: "kazami", maker: "sora", name: "風見の三羽", flavor: "「風向きが変われば、形も変える」", scout: "隊形を保ちながら、相手に合わせて向きを変える。", form: "円陣", arena: "tide",
      squad: [[1, 1, 3, 2, 3, 3, 2, 1, 1, 1], [2, 1, 3, 1, 3, 3, 2, 2, 1, 2], [1, 2, 3, 2, 2, 3, 2, 1, 1, 1]] },
    { key: "guren", maker: "rin", name: "紅蓮の双剣", flavor: "「迷った瞬間に、首が落ちる」", scout: "仕留めにいく剣士が二人。賭けに出て押し切る。", form: "楔", arena: "city",
      squad: [[3, 3, 1, 1, 2, 1, 1, 3, 2, 1], [3, 3, 2, 0, 1, 1, 0, 3, 3, 1], [1, 2, 2, 2, 2, 2, 1, 3, 1, 1]] },
    { key: "kiori", maker: "rin", name: "牙折りの三人", flavor: "「牙は、折ってから抜く」", scout: "冷酷だが慌てない。手負いを確実に仕留める。", form: "戦列", arena: "city",
      squad: [[2, 2, 3, 2, 2, 2, 1, 3, 2, 1], [1, 1, 3, 2, 3, 2, 1, 3, 1, 1], [2, 3, 2, 1, 2, 1, 0, 3, 2, 2]] },
    { key: "byakuya", maker: "yuki", name: "白夜の守人", flavor: "「夜が明けるまで、守り切る」", scout: "三人とも専守。時間切れを恐れない。", form: "円陣", arena: "spring",
      squad: [[0, 0, 3, 3, 3, 2, 2, 1, 0, 0], [0, 0, 2, 3, 2, 2, 3, 0, 0, 1], [0, 1, 3, 3, 3, 1, 2, 1, 1, 0]] },
    { key: "shimobashira", maker: "yuki", name: "霜柱", flavor: "「踏まれても、立つ」", scout: "弱気だが折れない。堅実に受け、少しずつ返す。", form: "戦列", arena: "mistwood",
      squad: [[0, 0, 3, 2, 2, 2, 2, 1, 0, 1], [1, 0, 2, 3, 3, 2, 2, 1, 0, 0], [0, 1, 3, 3, 2, 3, 1, 1, 0, 1]] },
    { key: "onibi", maker: "takeru", name: "鬼火の三人", flavor: "「燃え尽きる前に、全部燃やす」", scout: "短気で過信。勝つ時は圧倒し、負ける時は自滅する。", form: "楔", arena: "lavabridge",
      squad: [[3, 3, 0, 0, 1, 1, 1, 2, 3, 2], [3, 2, 0, 1, 0, 1, 0, 3, 3, 1], [2, 3, 0, 0, 1, 0, 1, 2, 3, 3]] },
    { key: "waregane", maker: "takeru", name: "割れ鐘", flavor: "「鳴らしてみろ。割れるのはお前だ」", scout: "鈍重だが一撃が重い。短気な盾役が前に出すぎる。", form: "戦列", arena: "plaza",
      squad: [[2, 1, 0, 2, 2, 1, 2, 2, 3, 0], [3, 0, 0, 1, 2, 1, 2, 1, 3, 0], [1, 1, 1, 2, 3, 1, 2, 2, 2, 1]] },
  ];
  const makerOf = (key) => MAKERS.find((m) => m.key === (MAKER_OF[key] || (EXTRA.find((s) => s.key === key) || {}).maker)) || null;
  SCS2.makers = { MAKERS, MAKER_OF, EXTRA, makerOf };
})();
