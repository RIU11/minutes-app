// 外部サービスの準備（APIキー）を、画面で案内する
// 操作を見つけたら（サイトから戻ってきた・キーを貼った・キーが使えると確かめた）自動で次の画面へ進む
import { h, svg, btn, toast } from '../ui.js';
import { kvGet, kvSet } from '../db.js';
import { geminiCheck, groqCheck } from '../external.js';

const STEPS = ['intro', 'g-open', 'g-paste', 'q-ask', 'q-open', 'q-paste', 'done'];
const LINKS = { gemini: 'https://aistudio.google.com/apikey', groq: 'https://console.groq.com/keys' };
const SS = 'minutes-setup-step';

export async function render(view, [stepArg]) {
  let step = STEPS.includes(stepArg) ? stepArg : (sessionStorage.getItem(SS) || 'intro');
  if (!STEPS.includes(step)) step = 'intro';
  const wrap = h('div', { class: 'wiz' });
  view.append(wrap);
  let cleanups = [];
  const clean = () => { cleanups.forEach((f) => { try { f(); } catch (e) { /* 無視 */ } }); cleanups = []; };

  const go = (s) => { clean(); step = s; try { sessionStorage.setItem(SS, s); } catch (e) { /* 無視 */ } history.replaceState(null, '', '#/setup/' + s); paint(); window.scrollTo({ top: 0 }); };
  const dots = () => {
    const order = ['intro', 'g-open', 'g-paste', 'q-ask', 'q-open', 'q-paste', 'done'];
    const i = order.indexOf(step);
    return h('div', { class: 'wiz-top' },
      step !== 'intro' && step !== 'done' ? h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'もどる', html: svg('back'), onclick: () => go(order[Math.max(0, i - 1)]) }) : null,
      h('div', { class: 'wiz-dots', 'aria-label': `${i + 1} / ${order.length}` }, order.map((_, k) => h('span', { class: k < i ? 'done' : k === i ? 'on' : '' }))),
      h('span', { class: 'tiny muted' }, `${i + 1} / ${order.length}`));
  };

  // 外部サイトを開いて、戻ってきたら次へ
  const openAndWait = (url, next, waitBox) => {
    let left = false;
    const onVis = () => {
      if (document.visibilityState === 'hidden') left = true;
      else if (left) { toast('おかえりなさい。次に進みます'); go(next); }
    };
    const onBlur = () => { left = true; };
    const onFocus = () => { if (left && document.visibilityState === 'visible') { setTimeout(() => { if (step !== next) go(next); }, 300); } };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    cleanups.push(() => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus); });
    window.open(url, '_blank', 'noopener');
    waitBox.classList.remove('hide');
  };

  // キーの貼り付け → 自動で確かめる → 次へ
  const pasteStep = ({ service, title, check, save, next, placeholder }) => {
    const input = h('input', { type: 'password', class: 'keybox', placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'APIキー' });
    const show = h('label', { class: 'small row', style: { gap: '6px', marginTop: '6px' } }, h('input', { type: 'checkbox', onchange: (e) => { input.type = e.target.checked ? 'text' : 'password'; } }), 'キーを表示する');
    const status = h('div');
    let lastTried = '', timer = null;
    const tryKey = async (raw) => {
      const key = String(raw || '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
      if (key === lastTried) return;
      if (key.length < 20 || /\s/.test(key)) { if (key) status.replaceChildren(h('p', { class: 'small muted' }, 'キーの全体を貼り付けてください。')); return; }
      lastTried = key;
      status.replaceChildren(h('div', { class: 'waiting' }, h('span', { class: 'spinner' }), 'キーが使えるか確かめています…'));
      try {
        const res = await check(key);
        await save(key, res);
        status.replaceChildren(h('div', { class: 'check-ok', html: svg('check') + `<span>使えるキーです${res.pick ? `（${res.pick}）` : ''}。次に進みます…</span>` }));
        setTimeout(() => { if (step !== next) go(next); }, 1300);
      } catch (e) {
        lastTried = '';
        const s = e.status;
        status.replaceChildren(h('div', { class: 'notice err small' }, h('strong', null, 'このキーは使えませんでした'),
          s === 401 || s === 403 ? (service === 'gemini' ? 'キーが正しくコピーされているか確かめてください。作ったばかりのキーは、使えるようになるまで数分かかることがあります。AI Studio でキーに「Gemini API だけに制限」を付けると使えることがあります。' : 'キーが正しくコピーされているか確かめてください（gsk_ で始まります）。') :
            s === 429 ? '今は混み合っています。少し待ってからもう一度貼り付けてください。' : (e.message || 'ネットワークを確かめてください。')));
      }
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => tryKey(input.value), 350); });
    input.addEventListener('paste', () => { setTimeout(() => tryKey(input.value), 50); });
    const pasteBtn = btn('貼り付ける', async () => {
      try { const t = await navigator.clipboard.readText(); input.value = t; tryKey(t); } catch (e) { input.focus(); toast('長押し（または ⌘V / Ctrl+V）で貼り付けてください'); }
    }, { cls: 'primary big block', ic: 'paste' });
    // 戻ってきた時点で、許可されていればクリップボードを自動で読む
    const auto = async () => {
      try {
        if (!navigator.permissions || !navigator.clipboard) return;
        const p = await navigator.permissions.query({ name: 'clipboard-read' });
        if (p.state === 'granted') { const t = await navigator.clipboard.readText(); if (t && t.trim().length >= 20 && !/\s/.test(t.trim())) { input.value = t.trim(); tryKey(t); } }
      } catch (e) { /* 使えないブラウザは手で貼る */ }
    };
    const onFocus = () => auto();
    window.addEventListener('focus', onFocus);
    cleanups.push(() => { window.removeEventListener('focus', onFocus); clearTimeout(timer); });
    setTimeout(auto, 200);
    setTimeout(() => input.focus(), 250);
    return h('div', { class: 'wiz-step' },
      dots(),
      h('div', { class: 'bigicon', html: svg('paste') }),
      h('h1', null, title),
      h('p', { class: 'lead' }, 'コピーしたキーを、下に貼り付けてください。貼り付けると自動で確かめて、次に進みます。'),
      pasteBtn,
      h('div', { style: { marginTop: '12px' } }, input, show),
      status,
      h('p', { class: 'tiny muted', style: { marginTop: '12px' } }, 'キーはこの端末のブラウザの中にだけ保存します。公開ページやほかの人には送りません。'),
    );
  };

  const mock = (url, parts) => h('div', { class: 'mock', 'aria-hidden': 'true' },
    h('div', { class: 'mbar' }, h('i'), h('i'), h('i'), h('span', { class: 'url' }, url)),
    h('div', { class: 'mbody' }, h('div', { class: 'mside' }, h('span'), h('span'), h('span'), h('span')), h('div', { class: 'mmain' }, ...parts)),
    h('div', { class: 'cap' }, 'イメージ図です。実際の画面は少しちがうことがあります。'));

  const paint = async () => {
    wrap.innerHTML = '';
    const gKey = await kvGet('geminiKey'), qKey = await kvGet('groqKey');
    if (step === 'intro') {
      wrap.append(h('div', { class: 'wiz-step' }, dots(),
        h('div', { class: 'bigicon', html: svg('key') }),
        h('h1', null, '外部サービスの準備'),
        h('p', { class: 'lead' }, '「部外秘ではない」を選んだ記録を、より正確に文字起こし・まとめするための準備です。どちらも無料で使えます。'),
        h('div', { class: 'card tight' },
          h('p', null, h('strong', null, '1. Google Gemini（必要）'), h('br'), h('span', { class: 'small muted' }, 'まとめ・質問づくりに使います。Google アカウントがあれば、約2分でできます。')),
          h('p', { style: { margin: 0 } }, h('strong', null, '2. Groq（任意）'), h('br'), h('span', { class: 'small muted' }, '文字起こしがさらに正確になります。'))),
        h('div', { class: 'notice small' }, h('strong', null, '安心のために'),
          h('ul', { style: { margin: '4px 0 0', paddingLeft: '1.2em' } },
            h('li', null, '部外秘の記録は、キーを入れても外には送りません。'),
            h('li', null, '送るのは「部外秘ではない」記録の、オンにした人の声と文字だけです。'),
            h('li', null, '無料のサービスでは、送った内容がサービスの改善に使われることがあります。'))),
        btn(gKey ? 'Gemini のキーを入れ直す' : 'はじめる', () => go('g-open'), { cls: 'primary big block' }),
        gKey ? btn('Groq の準備へ進む', () => go('q-ask'), { cls: 'block', ic: 'chevron' }) : null,
      ));
    } else if (step === 'g-open') {
      const wait = h('div', { class: 'waiting hide' }, h('span', { class: 'spinner' }), 'キーをコピーしたら、このページに戻ってきてください。戻ると自動で次に進みます。');
      wrap.append(h('div', { class: 'wiz-step' }, dots(),
        h('div', { class: 'bigicon', html: svg('external') }),
        h('h1', null, 'Google AI Studio でキーをつくる'),
        h('ol', { class: 'howto' },
          h('li', null, '下のボタンで Google AI Studio を開き、Google アカウントでログインします。'),
          h('li', null, 'はじめてのときは、利用規約に同意します（キーが自動でつくられることがあります）。'),
          h('li', null, '「APIキーを作成」（Create API key）があれば押します。'),
          h('li', null, 'できたキーの「コピー」を押します。'),
          h('li', null, 'このページに戻ってきます（自動で次へ進みます）。')),
        mock('aistudio.google.com/apikey', [h('div', { class: 'mline', style: { width: '40%' } }), h('span', { class: 'mbtn pulse' }, '＋ APIキーを作成'), h('div', { class: 'mkey' }, h('b', null, 'AQ.Ab8RN6…（あなたのキー）'), h('span', { class: 'mcopy pulse' }, 'コピー')), h('div', { class: 'mline', style: { width: '70%' } })]),
        btn('Google AI Studio を開く', (e) => openAndWait(LINKS.gemini, 'g-paste', wait), { cls: 'primary big block', ic: 'external' }),
        wait,
        btn('もうキーをコピーした（次へ）', () => go('g-paste'), { cls: 'ghost block' }),
      ));
    } else if (step === 'g-paste') {
      wrap.append(pasteStep({
        service: 'gemini', title: 'Gemini のキーを貼り付ける', placeholder: 'ここに貼り付け（AQ. や AIza で始まります）', next: 'q-ask',
        check: geminiCheck,
        save: async (key, res) => { await kvSet('geminiKey', key); await kvSet('geminiModel', res.pick); await kvSet('geminiKeyInQuery', !!res.keyInQuery); },
      }));
    } else if (step === 'q-ask') {
      wrap.append(h('div', { class: 'wiz-step' }, dots(),
        gKey ? h('div', { class: 'check-ok', html: svg('check') + '<span>Gemini の準備ができました</span>' }) : null,
        h('div', { class: 'bigicon', html: svg('file') }),
        h('h1', null, '文字起こしも、もっと正確にしますか？（任意）'),
        h('p', { class: 'lead' }, 'Groq（グロック）の無料サービスを使うと、高精度の Whisper large-v3 で文字起こしできます。'),
        h('p', { class: 'small muted' }, 'Groq を準備しない場合でも、「部外秘ではない」記録の文字起こしは Gemini で行えます。'),
        btn('Groq も準備する', () => go('q-open'), { cls: 'primary big block' }),
        btn('今はしない（完了へ）', () => go('done'), { cls: 'block' }),
      ));
    } else if (step === 'q-open') {
      const wait = h('div', { class: 'waiting hide' }, h('span', { class: 'spinner' }), 'キーをコピーしたら、このページに戻ってきてください。戻ると自動で次に進みます。');
      wrap.append(h('div', { class: 'wiz-step' }, dots(),
        h('div', { class: 'bigicon', html: svg('external') }),
        h('h1', null, 'GroqCloud でキーをつくる'),
        h('ol', { class: 'howto' },
          h('li', null, '下のボタンで GroqCloud を開き、ログインします（Google アカウントでも入れます）。'),
          h('li', null, '「Create API Key」を押し、名前（例：minutes）を入れて「Submit」を押します。'),
          h('li', null, '表示されたキー（gsk_ で始まる）の「Copy」を押します。キーは一度しか表示されません。'),
          h('li', null, 'このページに戻ってきます（自動で次へ進みます）。')),
        mock('console.groq.com/keys', [h('div', { class: 'mline', style: { width: '30%' } }), h('span', { class: 'mbtn pulse' }, 'Create API Key'), h('div', { class: 'mkey' }, h('b', null, 'gsk_••••••••••••（あなたのキー）'), h('span', { class: 'mcopy pulse' }, 'Copy')), h('div', { class: 'mline', style: { width: '60%' } })]),
        btn('GroqCloud を開く', () => openAndWait(LINKS.groq, 'q-paste', wait), { cls: 'primary big block', ic: 'external' }),
        wait,
        btn('もうキーをコピーした（次へ）', () => go('q-paste'), { cls: 'ghost block' }),
      ));
    } else if (step === 'q-paste') {
      wrap.append(pasteStep({
        service: 'groq', title: 'Groq のキーを貼り付ける', placeholder: 'ここに貼り付け（gsk_ で始まります）', next: 'done',
        check: groqCheck,
        save: async (key, res) => { await kvSet('groqKey', key); await kvSet('groqModel', res.pick); },
      }));
    } else {
      try { sessionStorage.removeItem(SS); } catch (e) { /* 無視 */ }
      wrap.append(h('div', { class: 'wiz-step' }, dots(),
        h('div', { class: 'bigicon', style: { background: 'var(--ok-weak)', color: 'var(--ok)' }, html: svg('check') }),
        h('h1', null, '準備ができました'),
        h('div', { class: 'card tight' },
          h('p', null, gKey ? '✓ Google Gemini：まとめ・質問づくり' : '— Google Gemini：未設定'),
          h('p', { style: { margin: 0 } }, qKey ? '✓ Groq：文字起こし' : '— Groq：未設定（文字起こしは Gemini で行います）')),
        h('p', { class: 'small' }, '記録の画面で「部外秘ではない」を選ぶと、外部サービスで処理します。「部外秘」を選んだ記録は、これまでどおり端末の中だけで処理します。'),
        h('a', { class: 'btn primary big block', href: '#/' }, '一覧へもどる'),
        h('a', { class: 'btn block', href: '#/settings', style: { marginTop: '8px' } }, '設定を見る'),
      ));
    }
  };
  await paint();
  return () => clean();
}
