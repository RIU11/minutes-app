// 議事録アプリ：はじまり
import { fillIcons, toast, h, svg, fmtDur } from './ui.js';
import { onRecording, isRecording, recState, recoverInterrupted } from './recording.js';
import { onJobs, anyJob } from './jobs.js';
import { startDueWatcher } from './notify.js';
import { checkAnnounce } from './announce.js';
import { kvGet } from './db.js';

const ROUTES = [
  [/^#?\/?$/, () => import('./views/home.js'), 'home'],
  [/^#\/rec$/, () => import('./views/rec.js'), 'rec'],
  [/^#\/r\/([^/]+)(?:\/(\w+))?$/, () => import('./views/detail.js'), 'home'],
  [/^#\/settings$/, () => import('./views/settings.js'), 'settings'],
  [/^#\/setup(?:\/([\w-]+))?$/, () => import('./views/setup.js'), 'settings'],
];

let cleanup = null;
let routeSeq = 0;
async function route() {
  const seq = ++routeSeq;
  const hash = location.hash || '#/';
  const found = ROUTES.find(([re]) => re.test(hash));
  if (!found) { location.hash = '#/'; return; }
  const [re, loader, tab] = found;
  const m = hash.match(re);
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const view = document.getElementById('view');
  let mod;
  try { mod = await loader(); } catch (e) {
    view.innerHTML = '';
    view.append(h('div', { class: 'notice err' }, h('strong', null, '画面を読み込めませんでした'), '通信を確かめて、もう一度開いてください。'));
    console.error(e); return;
  }
  if (seq !== routeSeq) return;
  view.innerHTML = '';
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  try { cleanup = (await mod.render(view, m.slice(1).map((x) => x && decodeURIComponent(x)))) || null; } catch (e) {
    console.error(e);
    view.append(h('div', { class: 'notice err' }, h('strong', null, 'エラーが起きました'), String(e.message || e)));
  }
  if (!/\/r\//.test(hash)) window.scrollTo(0, 0);
}

// 上のバーの「録音中」「処理中」の印
function updateStatus() {
  const box = document.getElementById('topbar-right');
  if (!box) return;
  let pill = box.querySelector('.status-pill');
  const rec = isRecording();
  const busy = anyJob();
  if (!rec && !busy) { if (pill) pill.remove(); return; }
  if (!pill) { pill = h('a', { class: 'badge status-pill', href: '#/rec' }); box.prepend(pill); }
  if (rec) {
    const s = recState();
    pill.className = 'badge status-pill unset';
    pill.style.color = 'var(--rec)';
    pill.href = '#/rec';
    pill.textContent = (s.paused ? '⏸ 一時停止 ' : s.interrupted ? '⚠ マイク停止中 ' : '● 録音中 ') + fmtDur(s.seconds);
  } else {
    pill.className = 'badge status-pill info';
    pill.style.color = '';
    pill.textContent = '処理中…';
  }
}

window.addEventListener('beforeunload', (e) => {
  if (isRecording() || anyJob()) { e.preventDefault(); e.returnValue = ''; }
});

async function boot() {
  fillIcons();
  // 表示の明るさ
  const theme = await kvGet('theme', 'auto').catch(() => 'auto');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;

  window.addEventListener('hashchange', route);
  onRecording(updateStatus);
  onJobs(updateStatus);
  setInterval(updateStatus, 1000);
  let fixed = [];
  try { fixed = await recoverInterrupted(); } catch (e) { console.warn(e); }
  await route();
  if (fixed.length) toast('中断した録音があります。「録音」から続きを録音できます', '', 5000);

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
      // 初めて開いたとき：準備ができたら1回だけ開き直して、端末内AIを速く動かせるようにする
      if (!self.crossOriginIsolated) {
        const reloadOnce = () => {
          let done = false; try { done = sessionStorage.getItem('coi-reload') === '1'; } catch (e) { done = true; }
          if (done || isRecording() || anyJob()) return;
          try { sessionStorage.setItem('coi-reload', '1'); } catch (e) { return; }
          location.reload();
        };
        if (navigator.serviceWorker.controller) reloadOnce();
        else navigator.serviceWorker.addEventListener('controllerchange', reloadOnce, { once: true });
      }
    } catch (e) { console.warn('service worker', e); }
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev.data && ev.data.type === 'open' && ev.data.url) location.hash = ev.data.url.replace(/^.*#/, '#');
    });
  }
  startDueWatcher();
  checkAnnounce();
  if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) { /* 無視 */ } }
}
boot();
