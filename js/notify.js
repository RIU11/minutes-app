// 宿題の期限のお知らせ（アプリを開いている間に確かめる。確実に知らせたいときはカレンダーに追加）
import { listRecords, updateRecord, kvGet } from './db.js';
import { todayISO } from './ui.js';

export function daysLeft(due, now = new Date()) {
  if (!due) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due); if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - t) / 86400000);
}
export function dueLabel(due) {
  const n = daysLeft(due);
  if (n == null) return '';
  if (n < 0) return `${-n}日すぎています`;
  if (n === 0) return '今日が期限';
  if (n === 1) return '明日が期限';
  return `あと${n}日`;
}

export async function dueTasks(withinDays = 3) {
  const out = [];
  for (const r of await listRecords()) {
    for (const t of r.tasks || []) {
      if (t.done || !t.due) continue;
      const n = daysLeft(t.due);
      if (n != null && n <= withinDays) out.push({ rec: r, task: t, days: n });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

export async function checkAndNotify() {
  if ((await kvGet('notifyOn', true)) === false) return 0;
  if (!('Notification' in window) || Notification.permission !== 'granted') return 0;
  const today = todayISO();
  let sent = 0;
  for (const { rec, task, days } of await dueTasks(1)) {
    if (task.notifiedOn === today) continue;
    const body = `${task.text.slice(0, 80)}（${rec.title || '議事録'}）`;
    const title = days < 0 ? '期限がすぎた宿題があります' : days === 0 ? '今日が期限の宿題があります' : '明日が期限の宿題があります';
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) await reg.showNotification(title, { body, tag: 'due-' + task.id, icon: 'icons/icon-192.png', badge: 'icons/favicon-64.png', data: { url: `#/r/${rec.id}/info` } });
      else new Notification(title, { body, tag: 'due-' + task.id, icon: 'icons/icon-192.png' });
      sent++;
      await updateRecord(rec.id, (r) => { const x = (r.tasks || []).find((q) => q.id === task.id); if (x) x.notifiedOn = today; });
    } catch (e) { console.warn(e); }
  }
  return sent;
}

export async function askPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission;
  try { return await Notification.requestPermission(); } catch (e) { return 'default'; }
}

let timer = null;
export function startDueWatcher() {
  checkAndNotify();
  clearInterval(timer);
  timer = setInterval(checkAndNotify, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkAndNotify(); });
}
