// AIを使わない簡易まとめ・用語・期限の読み取り・質問のひな形
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;

const STOP = new Set(('こと もの ため よう これ それ あれ ここ そこ どこ 私 僕 自分 皆さん みなさん 今日 今回 前回 先生 感じ 場合 部分 話 意味 時間 一つ 二つ 三つ 本当 ちょっと 全部 結構 普通 大体 多分 最初 最後 以上 以下 今 次 前 後 中 上 下 方 人 時 点 的 等 様 達 年 月 日 回 何 誰 皆 はい ええ えー あの あのー えっと まあ じゃあ では そう ですね ます です する なる ある いる できる 思い 思う 言う 言っ 考え ところ わけ はず 例えば つまり 実は 今日は').split(/\s+/));

export function sentences(text) {
  return String(text || '').replace(/\r/g, '').split(/(?<=[。！？!?])|\n+/).map((s) => s.trim()).filter((s) => s.length >= 4);
}

function words(text) {
  if (!segmenter) return (String(text).match(/[\p{Script=Han}\p{Script=Katakana}ー]{2,}|[A-Za-z][A-Za-z0-9\-]{2,}/gu) || []);
  const out = [];
  let run = [];
  const flush = () => { if (run.length) { out.push(run.join('')); if (run.length > 1) run.forEach((w) => out.push(w)); } run = []; };
  for (const s of segmenter.segment(String(text))) {
    const w = s.segment;
    if (s.isWordLike && /^[\p{Script=Han}\p{Script=Katakana}ーA-Za-z0-9]+$/u.test(w) && !/^\d+$/.test(w)) { run.push(w); if (run.length >= 4) flush(); }
    else flush();
  }
  flush();
  return out;
}

export function keywords(text, n = 8) {
  const freq = new Map();
  for (const w of words(text)) {
    if (w.length < 2 || STOP.has(w) || /^[\p{Script=Hiragana}]+$/u.test(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const scored = [...freq.entries()].map(([w, f]) => [w, f * Math.log(1 + Math.min(w.length, 8)) * (/[\p{Script=Han}]/u.test(w) || /[\p{Script=Katakana}]{3,}/u.test(w) ? 1.2 : 1)]);
  scored.sort((a, b) => b[1] - a[1]);
  const picked = [];
  for (const [w] of scored) {
    if (picked.some((p) => p.includes(w) || w.includes(p))) continue;
    picked.push(w);
    if (picked.length >= n) break;
  }
  return picked;
}

const RE_TASK = /(宿題|課題|提出|締め?切り?|〆切|までに|やってき|やってくる|読んでおい|調べておい|予習|復習|持ってき|準備しておい|小テスト(を|が|します|があり))/;
const RE_DECIDE = /(決定|決まりました|決めました|ことにしま|ことになりま|に決ま|方針|合意|確定)/;
const RE_NEXT = /(次回|次の授業|次の時間|来週の授業|次は)/;

// 宿題・決まったこと・次回 らしい文を取り出す（AIに渡す前の候補）
export function candidates(text, max = 5) {
  const sents = sentences(text);
  const uniq = (arr) => [...new Set(arr)].slice(0, max);
  return {
    tasks: uniq(sents.filter((s) => RE_TASK.test(s))),
    decisions: uniq(sents.filter((s) => RE_DECIDE.test(s))),
    next: uniq(sents.filter((s) => RE_NEXT.test(s))).slice(0, 2),
  };
}

export function parseDue(text, base = new Date()) {
  const s = String(text || '').normalize('NFKC');
  const y = base.getFullYear();
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let m = /(\d{1,2})月(\d{1,2})日/.exec(s) || /(\d{1,2})\/(\d{1,2})(?!\d)/.exec(s);
  if (m) { let d = new Date(y, +m[1] - 1, +m[2]); if (d < new Date(base.getFullYear(), base.getMonth(), base.getDate() - 60)) d = new Date(y + 1, +m[1] - 1, +m[2]); return fmt(d); }
  const wd = '日月火水木金土';
  m = /(来週|今週|次の)?([日月火水木金土])曜/.exec(s);
  if (m) {
    const target = wd.indexOf(m[2]);
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    if (m[1] === '来週') {
      const monIdx = (d.getDay() + 6) % 7; // 月曜=0
      d.setDate(d.getDate() + (7 - monIdx) + ((target + 6) % 7));
    } else {
      let add = (target - d.getDay() + 7) % 7;
      if (add === 0 && m[1] !== '今週') add = 7;
      d.setDate(d.getDate() + add);
    }
    return fmt(d);
  }
  if (/明後日|あさって/.test(s)) { const d = new Date(base); d.setDate(d.getDate() + 2); return fmt(d); }
  if (/明日|あした/.test(s)) { const d = new Date(base); d.setDate(d.getDate() + 1); return fmt(d); }
  if (/次回|来週/.test(s)) { const d = new Date(base); d.setDate(d.getDate() + 7); return fmt(d); }
  return '';
}

function scoreSentences(sents, kws) {
  return sents.map((s, i) => {
    let sc = 0;
    kws.forEach((k, r) => { if (s.includes(k)) sc += (kws.length - r) / kws.length + 0.5; });
    if (/重要|大事|ポイント|まとめ|つまり|結論|覚えて|試験に出|注意/.test(s)) sc += 1.5;
    if (s.length < 12) sc *= 0.5; if (s.length > 120) sc *= 0.8;
    return { s, i, sc };
  });
}

export function simpleSummary(text, { base = new Date() } = {}) {
  const sents = sentences(text);
  const kws = keywords(text, 10);
  const scored = scoreSentences(sents, kws);
  const top = scored.slice().sort((a, b) => b.sc - a.sc).slice(0, Math.min(8, Math.max(3, Math.round(sents.length / 12))));
  top.sort((a, b) => a.i - b.i);
  const overview = top.slice(0, 2).map((x) => x.s).join('');
  const tasks = []; const seen = new Set();
  for (const s of sents) if (RE_TASK.test(s) && !seen.has(s)) { seen.add(s); tasks.push({ text: s, who: '', due: parseDue(s, base) }); if (tasks.length >= 8) break; }
  const decisions = sents.filter((s) => RE_DECIDE.test(s)).slice(0, 6);
  const next = sents.filter((s) => RE_NEXT.test(s)).slice(0, 2).join('');
  return {
    title: kws.length ? kws.slice(0, 2).join('・') + 'について' : '',
    overview: overview || (sents[0] || ''),
    sections: [{ heading: '大事そうな発言', points: top.map((x) => x.s) }],
    terms: kws.slice(0, 8).map((k) => ({ term: k, desc: '' })),
    decisions, tasks, next,
  };
}

// 質問の系統
export const QCATS = [
  { id: 'deep', label: '理解を深める', hint: 'なぜそうなるのか、仕組みや理由を深く理解するための質問' },
  { id: 'example', label: '具体例を聞く', hint: '具体例や身近な例を引き出す質問' },
  { id: 'check', label: 'わからない点の確認', hint: '聞き逃しやあいまいな点、ことばの意味を確認する質問' },
  { id: 'apply', label: '応用・発展', hint: '他の分野や実生活への応用、発展的な内容をたずねる質問' },
  { id: 'critical', label: '批判的に考える', hint: '前提・限界・反対の立場・例外を考える質問' },
  { id: 'exam', label: '試験・課題の対策', hint: '試験や課題で問われそうな点、評価の基準を確認する質問' },
  { id: 'next', label: '次回・今後', hint: '次回の内容、準備、今後の進め方についての質問' },
];

export function templateQuestions(catId, kws, free = '') {
  const k = kws.length ? kws : ['今日の内容'];
  const a = k[0], b = k[1] || k[0], c = k[2] || k[0];
  const T = {
    deep: [`「${a}」は、なぜそうなるのですか？仕組みをもう少しくわしく教えてください。`, `「${a}」と「${b}」は、どのようにつながっていますか？`, `「${c}」の考え方が生まれた背景は何ですか？`, `「${b}」がなかったら、どうなりますか？`, `今日の内容で、いちばん大事な考え方は何ですか？`],
    example: [`「${a}」の身近な例を教えてください。`, `「${b}」が実際に使われている場面はありますか？`, `「${c}」の具体的な数字やデータの例はありますか？`, `「${a}」がうまくいかなかった例はありますか？`, `「${b}」を自分で試すとしたら、どんな例がありますか？`],
    check: [`「${a}」とは、どういう意味ですか？もう一度教えてください。`, `「${a}」と「${b}」の違いは何ですか？`, `「${c}」の部分を聞き逃したので、要点を確認させてください。`, `今日の話の結論は、「${a}」ということで合っていますか？`, `「${b}」の説明で使った用語の意味を確認させてください。`],
    apply: [`「${a}」は、他の分野ではどのように使われていますか？`, `「${b}」を実生活に生かすとしたら、どんな方法がありますか？`, `「${a}」と「${c}」を組み合わせると、何ができますか？`, `「${b}」の考え方は、これから先どう発展していきそうですか？`, `「${c}」について、さらに学ぶにはどんな本や資料がありますか？`],
    critical: [`「${a}」が当てはまらない例外はありますか？`, `「${b}」の考え方に反対する立場はありますか？`, `「${a}」の前提が変わったら、結論はどう変わりますか？`, `「${c}」の弱点や限界は何ですか？`, `「${b}」のデータや根拠は、どこまで信頼できますか？`],
    exam: [`「${a}」について、試験ではどんな形で問われますか？`, `「${b}」で、特に覚えておくべきポイントはどこですか？`, `「${a}」と「${c}」の違いを説明する問題は出ますか？`, `課題・レポートで「${b}」を扱うときの評価の基準を教えてください。`, `今日の内容で、試験の前に復習しておくべきところはどこですか？`],
    next: [`次回は「${a}」の続きを扱いますか？`, `次回までに「${b}」について準備しておくことはありますか？`, `「${c}」について、予習で読んでおくとよい資料はありますか？`, `今日の内容は、次回のどの話につながりますか？`, `課題の提出方法や期限を、もう一度確認させてください。`],
  };
  const list = (T[catId] || T.deep).slice(0, 5);
  if (free) list[4] = `（${free}）の観点から：「${a}」について、もう少しくわしく教えていただけますか？`;
  return list.map((q) => ({ q, why: '' }));
}
