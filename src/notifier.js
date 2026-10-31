// Notifikasi operasional lewat webhook / Telegram (settings.notify). Tidak pernah mengirim isi
// pesan: hanya nama dan nomor tersamar + tautan dashboard. Gagal kirim tidak melempar error.
import * as events from './events.js';
import * as C from './conversations.js';
import * as settings from './settings.js';

const TIMEOUT_MS = 5000;
const DEDUPE_MS = 10 * 60000;
let fetchFn = (...a) => globalThis.fetch(...a);
export const setFetch = (f) => { fetchFn = f || ((...a) => globalThis.fetch(...a)); };

let unsubs = [];
let waTimer = null;
let waDownNotified = false;
const attTimers = new Map();
const sentAt = new Map();

const cfg = () => {
  try { return settings.get()?.notify || {}; } catch { return {}; }
};
const brand = () => {
  try { return settings.get()?.brandName || 'Amnan'; } catch { return 'Amnan'; }
};

export function maskPhone(p) {
  const d = String(p ?? '').replace(/\D/g, '');
  if (d.length < 7) return d ? '****' : '';
  return `${d.slice(0, 4)}****${d.slice(-3)}`;
}
export function maskName(n) {
  const parts = String(n ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Tanpa nama';
  return parts.length === 1 ? parts[0].slice(0, 20) : `${parts[0].slice(0, 20)} ${parts[1][0].toUpperCase()}.`;
}
const link = (page) => {
  const base = String(cfg().dashboardUrl || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  return /^https?:\/\//.test(base) ? `${base}/#/${page}` : '';
};

function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })]).finally(() => clearTimeout(t));
}

async function post(url, body) {
  const secret = cfg().telegramBotToken;
  try {
    const res = await withTimeout(fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }), TIMEOUT_MS + 500);
    if (res && res.ok === false) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (e) {
    let msg = String(e?.message || e);
    if (secret) msg = msg.split(secret).join('***'); // token Telegram tidak boleh masuk log
    console.warn(`[notifier] gagal kirim: ${msg}`);
    return false;
  }
}

/** Kirim ke semua kanal yang dikonfigurasi. Tidak pernah melempar error. */
export async function notify(kind, { title, text, url = '', name = '', phone = '' }, { key = '' } = {}) {
  try {
    const now = Date.now();
    const dk = key || `${kind}:${phone}`;
    if (now - (sentAt.get(dk) || 0) < DEDUPE_MS) return false;
    sentAt.set(dk, now);
    if (sentAt.size > 500) for (const [k, t] of sentAt) if (now - t > DEDUPE_MS) sentAt.delete(k);
    const n = cfg();
    const msg = [`${brand()}: ${title}`, text, url].filter(Boolean).join('\n');
    const jobs = [];
    if (/^https?:\/\//i.test(n.webhookUrl || '')) {
      jobs.push(post(n.webhookUrl, { event: kind, title, text, name, phone, url, ts: now }));
    }
    if (n.telegramBotToken && n.telegramChatId) {
      jobs.push(post(`https://api.telegram.org/bot${n.telegramBotToken}/sendMessage`,
        { chat_id: n.telegramChatId, text: msg, disable_web_page_preview: true }));
    }
    if (!jobs.length) return false;
    return (await Promise.all(jobs)).some(Boolean);
  } catch (e) {
    console.warn('[notifier] error:', e?.message || e);
    return false;
  }
}

const disconnectedMinutes = () => {
  const v = cfg().onDisconnected;
  return typeof v === 'number' && v > 0 ? v : Number(cfg().disconnectedMinutes) > 0 ? Number(cfg().disconnectedMinutes) : 5;
};

function onWaStatus({ status, number } = {}) {
  if (status === 'connected') {
    clearTimeout(waTimer);
    waTimer = null;
    if (waDownNotified && cfg().onDisconnected) {
      notify('wa:up', { title: 'WhatsApp tersambung kembali', phone: maskPhone(number), url: link('pengaturan') }, { key: `wa:up:${Date.now()}` });
    }
    waDownNotified = false;
    return;
  }
  if (waTimer || !cfg().onDisconnected) return;
  const min = disconnectedMinutes();
  waTimer = setTimeout(() => {
    waTimer = null;
    if (!cfg().onDisconnected) return;
    waDownNotified = true;
    notify('wa:down', { title: `WhatsApp terputus lebih dari ${min} menit`, text: 'Bot tidak menerima/membalas pesan sampai tersambung lagi.', phone: maskPhone(number), url: link('pengaturan') });
  }, min * 60000);
  waTimer.unref?.();
}

function lastNonSystem(c) {
  for (let i = c.messages.length - 1; i >= 0; i--) if (c.messages[i].by !== 'system') return c.messages[i];
  return null;
}

function armAttention(phone, atMs) {
  const min = Number(cfg().attentionMinutes);
  if (!(min > 0)) return;
  clearTimeout(attTimers.get(phone));
  const t = setTimeout(() => {
    attTimers.delete(phone);
    try {
      const c = C.get(phone);
      const m = c && lastNonSystem(c);
      if (!c || !c.needsAttention || !m || m.by !== 'customer') return; // sudah dibalas / selesai
      notify('attention', {
        title: `Percakapan butuh perhatian belum dibalas ${min} menit`,
        text: `${maskName(c.name)} (${maskPhone(phone)})`, name: maskName(c.name), phone: maskPhone(phone), url: link('percakapan'),
      }, { key: `attention:${phone}:${c.attentionAt || ''}` });
    } catch (e) { console.warn('[notifier] attention:', e.message); }
  }, Math.max(1000, min * 60000 - (Date.now() - atMs)));
  t.unref?.();
  attTimers.set(phone, t);
}

export function start() {
  if (unsubs.length) return;
  unsubs.push(
    events.on('lead:hot', ({ phone, name } = {}) => {
      if (!cfg().onHot) return;
      notify('lead:hot', { title: 'Lead HOT baru', text: `${maskName(name)} (${maskPhone(phone)})`, name: maskName(name), phone: maskPhone(phone), url: link('crm') });
    }),
    events.on('wa:status', onWaStatus),
    events.on('conversation:attention', ({ phone } = {}) => phone && armAttention(phone, Date.now())),
  );
  const st = events.last('wa:status');
  if (st) onWaStatus(st);
  try { // pasang ulang pengatur waktu setelah restart
    for (const c of C.list()) if (c.needsAttention && c.awaitingReply) armAttention(c.phone, c.attentionAt || Date.now());
  } catch (e) { console.warn('[notifier] pasang ulang gagal:', e.message); }
}

export function stop() {
  unsubs.forEach((u) => u());
  unsubs = [];
  clearTimeout(waTimer); waTimer = null; waDownNotified = false;
  attTimers.forEach(clearTimeout); attTimers.clear();
  sentAt.clear();
}
