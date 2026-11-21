// 録音の画面
import { h, svg, fmtDur, toast, todayISO, nowHM, confirmDialog } from '../ui.js';
import { startRecording, stopRecording, pauseRecording, resumeRecording, addAnchor, onRecording, recState, isRecording, continueRecording, pausedRecords, finishPaused } from '../recording.js';
import { fmtDateJa, btn } from '../ui.js';
import { levelInfo, MicMonitor } from '../recorder.js';
import { getRecord, updateRecord, kvGet } from '../db.js';
import { detect } from '../device.js';

let draft = null; // 入力途中の情報（画面を移っても残す）

export async function render(view) {
  const d = await detect();
  const st = recState();
  if (!draft) draft = { title: '', date: todayISO(), time: nowHM(), place: '', participants: '', agenda: '' };
  if (st.rid) { const r = await getRecord(st.rid); if (r) draft = { title: r.title, date: r.date, time: r.time, place: r.place, participants: r.participants, agenda: r.agenda }; }

  const f = {};
  const field = (key, label, attrs = {}) => {
    const el = h(attrs.multiline ? 'textarea' : 'input', { type: attrs.type || 'text', placeholder: attrs.placeholder || '', rows: attrs.multiline ? 3 : null });
    el.value = draft[key] || '';
    el.addEventListener('input', () => { draft[key] = el.value; if (isRecording()) saveInfo(); });
    f[key] = el;
    return h('label', { class: 'field' }, h('span', null, label), el);
  };
  let saveT = null;
  const saveInfo = () => { clearTimeout(saveT); saveT = setTimeout(() => { const s = recState(); if (s.rid) updateRecord(s.rid, (r) => Object.assign(r, draft)).catch(() => {}); }, 500); };

  const info = h('details', { class: 'card', open: !isRecording() },
    h('summary', { style: { cursor: 'pointer', fontWeight: '700' } }, '講義・会議の情報（あとからでも入力できます）'),
    h('div', { style: { marginTop: '12px' } },
      field('title', 'タイトル', { placeholder: '例）経済学 第5回／定例ミーティング' }),
      h('div', { class: 'grid2' }, field('date', '日付', { type: 'date' }), field('time', '開始時刻', { type: 'time' })),
      field('place', '場所', { placeholder: '例）302教室／オンライン' }),
      field('participants', '参加者', { placeholder: '例）山田先生、受講生' }),
      field('agenda', '議題・テーマ', { multiline: true, placeholder: '例）需要と供給、来週の小テストについて' }),
    ),
  );

  const timeEl = h('div', { class: 'rectime' }, '0:00');
  const stateEl = h('div', { class: 'recstate' }, 'タップして録音');
  const meterFill = h('div');
  const meter = h('div', { class: 'meter', title: '声の大きさ' }, meterFill, h('span', { class: 'mark', style: { left: '36%' } }), h('span', { class: 'mark', style: { left: '86%' } }));
  const levelMsg = h('div', { class: 'levelmsg' }, '');
  const mainBtn = h('button', { type: 'button', class: 'recbtn', 'aria-label': '録音をはじめる', html: svg('mic') });
  const pauseBtn = h('button', { type: 'button', class: 'btn hide', html: svg('pause') + '<span>一時停止</span>' });
  const anchorBtn = h('button', { type: 'button', class: 'btn big block anchorbtn', disabled: true, html: svg('teacher') + '<span>いま先生が話している</span>' });
  const anchorNote = h('p', { class: 'small muted', style: { marginTop: '6px' } }, '先生が話しているときに押すと、あとで「先生の声」を見分けやすくなります（何回押してもOK）。');
  const testBtn = h('button', { type: 'button', class: 'btn small ghost', html: svg('wave') + '<span>マイクを試す</span>' });

  const panel = h('div', { class: 'card recpanel' }, stateEl, timeEl, h('div', null, mainBtn), h('div', { class: 'row', style: { justifyContent: 'center' } }, pauseBtn, testBtn), meter, levelMsg, anchorBtn, anchorNote);

  const tips = h('div', { class: 'notice' },
    h('strong', null, '録音のコツ'),
    h('ul', { style: { margin: '4px 0 0', paddingLeft: '1.2em' } },
      h('li', null, 'スマホやパソコンは、先生の方に向けて机に置きましょう。'),
      h('li', null, '録音中は画面を開いたままにしてください（自動で画面が消えないようにしています）。'),
      h('li', null, '「停止」を押すまで録音は終わりません。画面を閉じてマイクが止められても、戻ると自動で再開します（止まっていた間は録音されません）。'),
      d.ios ? h('li', null, 'iPhone・iPad は、画面を消したりほかのアプリに切り替えたりすると、その間マイクが止められます。できるだけ画面を開いたままにしてください。') : null,
      h('li', null, '録音はこの端末の中だけに保存されます。'),
    ),
  );
  const pausedBox = h('div');
  view.append(pausedBox, panel, info, tips);
  tips.classList.add('tiny');
  const drawPaused = async () => {
    pausedBox.innerHTML = '';
    if (isRecording()) return;
    for (const r of await pausedRecords()) {
      pausedBox.append(h('div', { class: 'notice warn' },
        h('strong', null, '中断した録音があります'),
        h('div', { class: 'small' }, `${r.title || '（タイトルなし）'}・${fmtDateJa(r.date)} ${r.time || ''}・${fmtDur(r.audio.duration || 0)}まで録音済み`),
        h('div', { class: 'row', style: { marginTop: '8px' } },
          btn('続きを録音する', async () => {
            try { await continueRecording(r.id); draft = { title: r.title, date: r.date, time: r.time, place: r.place, participants: r.participants, agenda: r.agenda }; info.open = false; toast('続きの録音をはじめました'); drawPaused(); }
            catch (e) { toast(micError(e), 'err', 6000); }
          }, { cls: 'primary small', ic: 'mic' }),
          btn('ここで録音を終える', async () => {
            if (!(await confirmDialog('この録音を終えますか？', '終えると、文字起こしに進みます。', { ok: '終える' }))) return;
            await finishPaused(r.id);
            if ((await kvGet('autoStart', true)) !== false) { try { sessionStorage.setItem('minutes-autostart', r.id); } catch (e) { /* 無視 */ } }
            location.hash = '#/r/' + r.id;
          }, { cls: 'small' })),
      ));
    }
  };
  drawPaused();

  let monitor = null;
  const showLevel = (rms) => {
    const L = levelInfo(rms);
    meterFill.style.width = L.pct + '%';
    levelMsg.textContent = L.msg; levelMsg.className = 'levelmsg ' + L.cls;
  };
  testBtn.addEventListener('click', async () => {
    if (monitor) { monitor.stop(); monitor = null; testBtn.querySelector('span').textContent = 'マイクを試す'; meterFill.style.width = '0'; levelMsg.textContent = ''; return; }
    try { monitor = new MicMonitor(); await monitor.start(showLevel); testBtn.querySelector('span').textContent = '試すのをやめる'; } catch (e) { monitor = null; toast(micError(e), 'err', 5000); }
  });

  const paint = (s) => {
    const rec = !!s.rec;
    timeEl.textContent = fmtDur(s.seconds);
    mainBtn.classList.toggle('stop', rec);
    mainBtn.innerHTML = svg(rec ? 'stop' : 'mic');
    mainBtn.setAttribute('aria-label', rec ? '録音を止めて保存する' : '録音をはじめる');
    pauseBtn.classList.toggle('hide', !rec);
    pauseBtn.innerHTML = svg(s.paused ? 'play' : 'pause') + `<span>${s.paused ? '再開' : '一時停止'}</span>`;
    testBtn.classList.toggle('hide', rec);
    anchorBtn.disabled = !rec || s.paused;
    stateEl.className = 'recstate' + (rec && !s.paused ? ' live' : '');
    stateEl.textContent = rec ? (s.paused ? '一時停止中' : s.interrupted ? 'マイクが止められています（画面に戻ると自動で再開します）' : '録音中') : 'タップして録音';
    if (rec) showLevel(s.paused ? 0 : s.level);
  };
  const off = onRecording(paint);
  const tick = setInterval(() => paint(recState()), 500);
  paint(recState());

  mainBtn.addEventListener('click', async () => {
    if (!isRecording()) {
      if (monitor) { monitor.stop(); monitor = null; }
      mainBtn.disabled = true;
      try {
        await startRecording({ ...draft });
        info.open = false;
        toast('録音をはじめました');
      } catch (e) { toast(micError(e), 'err', 6000); } finally { mainBtn.disabled = false; }
    } else {
      const ok = await confirmDialog('録音を止めますか？', '止めると保存して、すぐ文字起こしを始めます。', { ok: '止めて保存', cancel: '続ける' });
      if (!ok) return;
      mainBtn.disabled = true;
      try {
        const rid = await stopRecording();
        draft = null;
        toast('保存しました');
        if ((await kvGet('autoStart', true)) !== false) { try { sessionStorage.setItem('minutes-autostart', rid); } catch (e) { /* 無視 */ } }
        location.hash = '#/r/' + rid;
      } catch (e) { toast('保存に失敗しました：' + e.message, 'err', 6000); } finally { mainBtn.disabled = false; }
    }
  });
  pauseBtn.addEventListener('click', () => { const s = recState(); if (s.paused) resumeRecording(); else pauseRecording(); });
  anchorBtn.addEventListener('click', async () => {
    const n = await addAnchor();
    anchorBtn.classList.remove('flash'); void anchorBtn.offsetWidth; anchorBtn.classList.add('flash');
    anchorBtn.querySelector('span').textContent = `いま先生が話している（${n}回）`;
    toast('先生の声として印をつけました');
  });

  return () => { off(); clearInterval(tick); if (monitor) monitor.stop(); clearTimeout(saveT); };
}

function micError(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください。';
  if (n === 'NotFoundError') return 'マイクが見つかりません。';
  if (n === 'NotReadableError') return 'マイクをほかのアプリが使っています。';
  return 'マイクを使えませんでした：' + ((e && e.message) || e);
}
