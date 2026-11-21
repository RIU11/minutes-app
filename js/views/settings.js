// 設定
import { h, svg, btn, toast, confirmDialog, fmtBytes } from '../ui.js';
import { kvGet, kvSet } from '../db.js';
import { detect, WHISPER, LLM } from '../device.js';
import { geminiModels, pickGeminiModel, externalReady } from '../external.js';
import { askPermission } from '../notify.js';
import { backupBlob, restoreBackup, download } from '../export.js';
import { mlTerminate } from '../ml-client.js';
import { unloadEngine } from '../llm-local.js';
import { switchEl } from './common.js';
import { APP_VERSION } from '../version.js';

export async function render(view) {
  const d = await detect();
  const [wm, lm, pubTrans, pubSum, extOff, notifyOn, theme, gKey, qKey, gModel] = await Promise.all([
    kvGet('whisperModel', 'auto'), kvGet('llmModel', 'auto'), kvGet('pubTrans', 'external'), kvGet('pubSum', 'external'), kvGet('externalOff', false),
    kvGet('notifyOn', true), kvGet('theme', 'auto'), kvGet('geminiKey'), kvGet('groqKey'), kvGet('geminiModel'),
  ]);

  const radio = (name, value, cur, title, desc, onpick, disabled = false) => h('label', { style: disabled ? { opacity: '.5' } : null },
    h('input', { type: 'radio', name, value, checked: cur === value, disabled, onchange: () => onpick(value) }),
    h('div', null, h('div', { class: 'rt' }, title), desc ? h('div', { class: 'rd' }, desc) : null));

  // 端末
  view.append(h('h1', null, '設定'));
  view.append(h('div', { class: 'card' },
    h('h2', null, 'この端末'),
    h('dl', { class: 'kv' },
      h('dt', null, 'WebGPU'), h('dd', null, d.webgpu ? `使える${d.f16 ? '（高速な16bit計算も可）' : ''}` : '使えない（AIはCPUで動かします・遅め）'),
      h('dt', null, '並列処理'), h('dd', null, d.isolated ? `使える（${d.threads}コア）` : '使えない（開き直すと使えることがあります）'),
      h('dt', null, '種類'), h('dd', null, d.mobile ? 'スマホ・タブレット' : 'パソコン'),
    ),
  ));

  // かんたん操作
  const [autoStart, alwaysConf] = await Promise.all([kvGet('autoStart', true), kvGet('alwaysConfidential', false)]);
  const row0 = (label, desc, el) => h('div', { class: 'setrow' }, h('div', null, h('div', { class: 'lbl' }, label), h('div', { class: 'desc' }, desc)), el);
  view.append(h('div', { class: 'card' }, h('h2', null, 'かんたん操作'),
    row0('録音を止めたら、すぐ文字起こしを始める', '話者の分け → 文字起こし → まとめ まで自動で進みます', switchEl(autoStart !== false, (v) => kvSet('autoStart', v))),
    row0('いつも「部外秘」で始める', '毎回の確認を出さずに、端末の中だけで処理します（記録はロックされます）', switchEl(alwaysConf === true, (v) => kvSet('alwaysConfidential', v))),
  ));

  // 文字起こし
  const wl = h('div', { class: 'radiolist' });
  const pickW = async (v) => { await kvSet('whisperModel', v); mlTerminate(); toast('文字起こしのAIを変えました'); };
  wl.append(radio('wm', 'auto', wm, '自動（おすすめ）', d.webgpu && d.f16 && !d.mobile ? 'この端末では「高精度」を使います。' : 'この端末では「標準」を使います。', pickW));
  for (const [k, m] of Object.entries(WHISPER)) wl.append(radio('wm', k, wm, `${m.label}（${m.size}）`, m.desc, pickW, m.needsWebGPU && !d.webgpu));
  view.append(h('div', { class: 'card' }, h('h2', { html: svg('file') + '<span>文字起こし（端末内）</span>' }), h('p', { class: 'small muted' }, '部外秘の記録は、いつもこの端末の中で文字起こしします。最初の1回だけ、AIのダウンロードが必要です（次からはオフラインでも使えます）。'), wl));

  // まとめ
  const ll = h('div', { class: 'radiolist' });
  const pickL = async (v) => { await kvSet('llmModel', v); await unloadEngine(); toast('まとめのAIを変えました'); };
  ll.append(radio('lm', 'auto', lm, '自動（おすすめ）', d.webgpu ? 'この端末では「日本語Gemma 2B」を使います。' : 'この端末では WebGPU が使えないので「簡易まとめ」になります。', pickL));
  for (const [k, m] of Object.entries(LLM)) ll.append(radio('lm', k, lm, `${m.label}（${m.size}）`, m.desc, pickL, k !== 'simple' && !d.webgpu));
  view.append(h('div', { class: 'card' }, h('h2', { html: svg('spark') + '<span>まとめ・質問（端末内AI）</span>' }), h('p', { class: 'small muted' }, '部外秘の記録は、この端末の中のAIでまとめます。パソコン（WebGPU が使えるブラウザ）向けです。'), ll));

  // 外部サービス
  const ext = h('div', { class: 'card' }, h('h2', { html: svg('globe') + '<span>外部サービス（部外秘ではない記録だけ）</span>' }));
  const status = (ok, name, desc) => h('div', { class: 'setrow' }, h('div', null, h('div', { class: 'lbl' }, name), h('div', { class: 'desc' }, desc)), h('span', { class: 'badge ' + (ok ? 'ok' : 'gray') }, ok ? '準備できています' : '未設定'));
  ext.append(
    h('p', { class: 'small muted' }, '「部外秘ではない」を選んだ記録だけ、外部の無料サービスで、より正確に処理します。キーはこの端末のブラウザの中にだけ保存します。'),
    status(!!gKey, 'Google Gemini', 'まとめ・質問づくり（キーがあれば文字起こしにも使えます）'),
    status(!!qKey, 'Groq', '文字起こし（Whisper large-v3・任意）'),
    h('div', { class: 'row', style: { margin: '10px 0' } },
      h('a', { class: 'btn primary', href: '#/setup', html: svg('key') + `<span>${gKey || qKey ? 'キーを入れ直す（画面で案内）' : '外部サービスを準備する（画面で案内）'}</span>` }),
      gKey || qKey ? btn('キーを消す', async () => {
        if (!(await confirmDialog('キーを消しますか？', 'この端末から Gemini と Groq のキーを消します。外部サービスは使えなくなります。', { ok: '消す', danger: true }))) return;
        await kvSet('geminiKey', null); await kvSet('groqKey', null); toast('キーを消しました'); location.reload();
      }, { cls: 'danger' }) : null),
  );
  if (gKey) {
    const sel = h('select', { 'aria-label': 'Gemini のモデル' }, h('option', { value: gModel || '' }, gModel || '（自動）'));
    const load = btn('一覧を読み込む', async () => {
      try {
        const list = await geminiModels(gKey);
        sel.innerHTML = '';
        const best = pickGeminiModel(list);
        for (const m of list.filter((x) => /^gemini-/.test(x.id))) sel.append(h('option', { value: m.id }, m.id + (m.id === best ? '（おすすめ）' : '')));
        sel.value = gModel || best;
        toast('読み込みました');
      } catch (e) { toast(e.message, 'err', 5000); }
    }, { cls: 'small' });
    sel.addEventListener('change', async () => { await kvSet('geminiModel', sel.value); toast('Gemini のモデルを変えました'); });
    ext.append(h('label', { class: 'field' }, h('span', null, 'Gemini のモデル'), h('div', { class: 'row nowrap' }, sel, load)));
  }
  const row = (label, desc, el) => h('div', { class: 'setrow' }, h('div', null, h('div', { class: 'lbl' }, label), desc ? h('div', { class: 'desc' }, desc) : null), el);
  ext.append(
    row('文字起こしに外部サービスを使う', 'オフにすると、部外秘ではない記録も端末の中で文字起こしします', switchEl(pubTrans === 'external', (v) => kvSet('pubTrans', v ? 'external' : 'local'))),
    row('まとめ・質問に外部サービスを使う', 'オフにすると、端末内AIでまとめます', switchEl(pubSum === 'external', (v) => kvSet('pubSum', v ? 'external' : 'local'))),
    row('外部サービスをすべて止める', 'オンにすると、どの記録も外には送りません', switchEl(!!extOff, (v) => kvSet('externalOff', v))),
  );
  view.append(ext);

  // お知らせ
  const permLbl = h('span', { class: 'small muted' });
  const showPerm = () => { permLbl.textContent = !('Notification' in window) ? 'この端末では使えません' : Notification.permission === 'granted' ? '許可されています' : Notification.permission === 'denied' ? 'ブラウザの設定で止められています' : 'まだ許可していません'; };
  showPerm();
  view.append(h('div', { class: 'card' },
    h('h2', { html: svg('bell') + '<span>宿題の期限のお知らせ</span>' }),
    row('期限が近い宿題をお知らせ', 'アプリを開いたときに、期限が今日・明日の宿題を知らせます', switchEl(notifyOn !== false, (v) => kvSet('notifyOn', v))),
    h('div', { class: 'row', style: { marginTop: '8px' } }, btn('お知らせを許可する', async () => { await askPermission(); showPerm(); }, { cls: 'small' }), permLbl),
    h('p', { class: 'tiny muted', style: { marginTop: '8px' } }, d.ios ? 'iPhone・iPad では、ホーム画面に追加したアプリから許可するとお知らせが届きます。' : '確実に知らせてほしいときは、宿題の 📅 からカレンダーに追加してください。'),
  ));

  // 表示
  const th = h('select', { 'aria-label': '表示の明るさ' }, h('option', { value: 'auto' }, '端末に合わせる'), h('option', { value: 'light' }, '明るい'), h('option', { value: 'dark' }, '暗い'));
  th.value = theme;
  th.addEventListener('change', async () => { await kvSet('theme', th.value); if (th.value === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = th.value; });
  view.append(h('div', { class: 'card' }, h('h2', null, '表示'), row('明るさ', '', th)));

  // データ
  const usage = h('span', { class: 'small muted' }, '計算中…');
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then((e) => { usage.textContent = `使用量 ${fmtBytes(e.usage)}（AIのファイルをふくむ）／ 空き ${fmtBytes(Math.max(0, e.quota - e.usage))}`; }).catch(() => { usage.textContent = ''; });
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', class: 'hide' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
    try { const r = await restoreBackup(f); toast(`読み込みました（追加 ${r.added}・更新 ${r.updated}・そのまま ${r.kept}）`, '', 5000); } catch (e) { toast(e.message, 'err', 5000); }
  });
  view.append(h('div', { class: 'card' },
    h('h2', null, 'データ'),
    h('p', null, usage),
    h('p', { class: 'small muted' }, '記録はすべて、この端末のブラウザの中に保存しています。別の端末に移すときは、バックアップ（音声は入りません）か、記録ごとの「音声を書き出す」を使ってください。'),
    h('div', { class: 'row' },
      btn('バックアップを保存', async () => { download(`議事録バックアップ_${new Date().toISOString().slice(0, 10)}.json`, await backupBlob()); }, { cls: 'small', ic: 'download' }),
      btn('バックアップを読み込む', () => fileIn.click(), { cls: 'small', ic: 'upload' }), fileIn,
      btn('AIのファイルを消して容量を空ける', async () => {
        if (!(await confirmDialog('ダウンロードしたAIのファイルを消しますか？', '記録は消えません。次に使うときに、もう一度ダウンロードします。', { ok: '消す', danger: true }))) return;
        mlTerminate(); await unloadEngine();
        const keys = await caches.keys();
        let n = 0; for (const k of keys) if (/transformers|webllm|tvmjs|mlc/i.test(k)) { await caches.delete(k); n++; }
        toast(n ? 'AIのファイルを消しました' : '消すファイルはありませんでした');
      }, { cls: 'small danger', ic: 'trash' })),
  ));

  // このアプリについて
  view.append(h('div', { class: 'card' },
    h('h2', null, 'このアプリについて'),
    h('p', { class: 'small' }, `議事録アプリ ${APP_VERSION}（デモ版）`),
    h('ul', { class: 'credits' },
      h('li', null, '文字起こし：Whisper（OpenAI, MIT）を Transformers.js（Hugging Face, Apache-2.0）で実行'),
      h('li', null, '話者の区切り：pyannote segmentation-3.0（MIT）'),
      h('li', null, '声の特徴：WeSpeaker ResNet34（CC BY 4.0）'),
      h('li', null, '端末内AI：WebLLM（Apache-2.0）・Gemma 2 2B JPN（Gemma 利用規約）・Qwen3.5（Apache-2.0）'),
      h('li', null, 'PDF：pdf-lib・fontkit（MIT）、フォント：M PLUS 1p（SIL Open Font License）'),
      h('li', null, '外部サービス（部外秘ではない記録のみ）：Google Gemini API、Groq API'),
    ),
  ));
}
