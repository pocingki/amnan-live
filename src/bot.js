// Mesin balasan bot. Dipakai SAMA PERSIS oleh WhatsApp asli dan Bot Tester.
import * as settingsStore from './settings.js';
import * as C from './conversations.js';
import * as leadStore from './store.js';
import { ingest, hasWord, classify } from './leads.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const delayFor = (t) => (process.env.BOT_NO_DELAY ? 0 : 700 + Math.min(1500, t.length * 12));
const STALE_MS = 10 * 60 * 1000; // pesan lebih lama dari ini tidak dibalas bot

export const fill = (t, conv, S) =>
  String(t || '').replace(/\{nama\}/gi, conv.name || 'Kak').replace(/\{bot\}/gi, S.botName).replace(/\{admin\}/gi, S.adminName);

export function matchIntent(text, intents) {
  let best = null;
  let bestHits = 0;
  for (const it of intents) {
    if (!it.active) continue;
    const hits = it.keywords.filter((k) => hasWord(text, k)).length;
    if (hits > bestHits) {
      best = it;
      bestHits = hits;
    }
  }
  return best;
}

export function remainingMs(conv, S, now = Date.now()) {
  if (conv.mode !== 'bot' || !S.botEnabled || !(S.botDurationMinutes > 0)) return null;
  return Math.max(0, conv.botStartedAt + S.botDurationMinutes * 60000 - now);
}

export function setMode(conv, mode, now = Date.now()) {
  conv.mode = mode;
  if (mode === 'bot') conv.botStartedAt = now;
}

/** Memutuskan balasan untuk satu pesan masuk. Mengubah state conv, mengembalikan daftar teks balasan. */
export function decide(conv, text, S, now = Date.now()) {
  const replies = [];
  if (!S.botEnabled) return replies;

  // Batas durasi bot: habis -> sesi bot dimulai ulang, pesan ini dijawab mulai dari pesan pembuka lagi
  if (conv.mode === 'bot' && S.botDurationMinutes > 0 && now - conv.botStartedAt > S.botDurationMinutes * 60000) {
    conv.openingSent = false;
    conv.pending = null;
    conv.botStartedAt = now;
  }
  if (conv.mode !== 'bot') return replies;

  const fields = S.requiredFields.filter((f) => f.enabled);
  const first = !conv.openingSent;
  if (first) {
    conv.openingSent = true; // pesan pembuka wajib untuk chat pertama
    if (S.openingMessage) replies.push(fill(S.openingMessage, conv, S));
  }

  let answered = false;
  const pend = conv.pending && fields.find((f) => f.id === conv.pending);
  const isQuestion = /\?/.test(text) && matchIntent(text, S.intents);
  if (pend && !isQuestion) {
    if (/^\s*(lewati|skip)\s*$/i.test(text)) conv.skipped.push(pend.id);
    else {
      conv.data[pend.id] = text.trim().slice(0, 500);
      if (pend.id === 'nama') conv.name = conv.data[pend.id];
    }
    conv.pending = null;
    answered = true;
  } else {
    const it = matchIntent(text, S.intents);
    if (it) replies.push(fill(it.response, conv, S));
    else if (!first && S.fallbackMessage) replies.push(fill(S.fallbackMessage, conv, S));
  }

  const next = fields.find((f) => !(f.id in conv.data) && !conv.skipped.includes(f.id));
  if (next) {
    conv.pending = next.id;
    replies.push(fill(next.question, conv, S));
  } else if (answered && fields.length && S.completionMessage) {
    replies.push(fill(S.completionMessage, conv, S));
  }
  return replies;
}

export const view = (conv) => ({ ...conv, remainingMs: remainingMs(conv, settingsStore.get()) });

// ---------- WhatsApp asli ----------
const queues = new Map();

export function handleIncoming(msg, send) {
  const prev = queues.get(msg.phone) || Promise.resolve();
  const p = prev
    .then(() => run(msg, send))
    .catch((e) => console.error('[bot]', e))
    .finally(() => {
      if (queues.get(msg.phone) === p) queues.delete(msg.phone);
    });
  queues.set(msg.phone, p);
  return p;
}

async function run({ jid, phone, name, text, ts }, send) {
  const S = settingsStore.get();
  const { conv } = C.getOrCreate(phone, jid, name);
  conv.jid = jid;
  if (name && !conv.name) conv.name = name;
  C.addMessage(conv, 'customer', text, ts);
  conv.unread++;

  const customerCount = conv.messages.filter((m) => m.by === 'customer').length;
  const res = ingest({ phone, name, text, ts, customerCount }); // CRM (status & data leads dihitung dari isi chat)
  const nameBefore = conv.name;
  const stale = Date.now() - ts > STALE_MS;
  const replies = stale ? [] : decide(conv, text, S);
  C.save();
  console.log(`[wa] ${res.created ? 'LEAD BARU' : res.ignored ? 'chat (bukan lead)' : 'lanjutan'} ${phone}: ${text.slice(0, 50)} | balasan bot: ${replies.length}`);

  let sent = 0;
  for (const r of replies) {
    await sleep(delayFor(r));
    try {
      await send(jid, r);
      C.addMessage(conv, 'bot', r);
      sent++;
    } catch (e) {
      console.error('[bot] gagal kirim:', e.message);
      break;
    }
  }
  if (conv.name !== nameBefore) leadStore.updateByPhone(phone, { name: conv.name });
  C.save();
}

// ---------- Bot Tester (tidak masuk CRM dan tidak dikirim ke WhatsApp) ----------
// Banyak nomor uji sekaligus. Tiap nomor punya percakapan, lead virtual, dan jam simulasi sendiri.
// Logika Status Lead / Data Leads memakai classify() yang sama dengan WhatsApp asli.
const testers = new Map(); // phone -> { conv, lead, offset(ms jam simulasi) }

export function normPhone(p) {
  let d = String(p ?? '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  return d.length >= 8 && d.length <= 15 ? d : null;
}
const T = (phone) => {
  if (!testers.has(phone)) testers.set(phone, { conv: C.newConv(phone, 'tester:' + phone, ''), lead: null, offset: 0 });
  return testers.get(phone);
};
const tnow = (t) => Date.now() + t.offset;
const status = (t, S) => ({ mode: t.conv.mode, remainingMs: remainingMs(t.conv, S, tnow(t)), botEnabled: S.botEnabled });

export function testerView(phone) {
  const S = settingsStore.get();
  const t = testers.get(phone) || { conv: C.newConv(phone, 'tester:' + phone, ''), lead: null, offset: 0 };
  return {
    phone, messages: t.conv.messages, status: status(t, S), lead: t.lead, data: t.conv.data, now: tnow(t), offset: t.offset,
    numbers: [...testers.keys()],
    leads: [...testers].filter(([, x]) => x.lead).map(([ph, x]) => ({ ...x.lead, phone: ph, data: x.conv.data })),
  };
}
export const testerReset = (phone) => (phone ? testers.delete(phone) : testers.clear());
export function testerMode(phone, mode) { const t = T(phone); setMode(t.conv, mode, tnow(t)); return status(t, settingsStore.get()); }
export const testerAdvance = (phone, hours) => { T(phone).offset += hours * 3600000; return testerView(phone); };

export function testerSend(phone, text) {
  const S = settingsStore.get();
  const t = T(phone);
  const c = t.conv;
  const now = tnow(t);
  const message = C.addMessage(c, 'customer', text, now);
  const r = classify(t.lead, { text, phone, name: c.name, ts: now, customerCount: c.messages.filter((m) => m.by === 'customer').length });
  if (r.lead) t.lead = r.lead;
  const replies = decide(c, text, S, now).map((x) => C.addMessage(c, 'bot', x, now));
  if (t.lead && c.name) t.lead.name = c.name;
  return { message, replies, lead: t.lead, changes: r.changes, data: c.data, status: status(t, S), now };
}