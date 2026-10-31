// Alur pesan masuk: rekonsiliasi identitas -> simpan -> CRM -> rencana balasan -> kirim -> sinkron lead.
import * as convStore from './conversations.js';
import * as leadStore from './store.js';
import * as settingsStore from './settings.js';
import { ingest } from './leads.js';
import { emit } from './events.js';
import { plan, setMode, applyReplyEffect } from './bot-plan.js';

const BACKOFF = [1000, 3000, 9000]; // jeda antar percobaan kirim
const ATTEMPTS = 3;
const RANK = { sending: 0, sent: 1, delivered: 2, read: 3 };
const waIdToKey = new Map(); // waId pesan bot -> kunci percakapan

export function makeRealDeps(send) {
  return {
    send,
    now: Date.now,
    sleep: process.env.BOT_NO_DELAY ? () => Promise.resolve() : (ms) => new Promise((r) => setTimeout(r, ms)),
    convs: convStore,
    ingest,
    leads: leadStore,
    settings: settingsStore,
    emit,
  };
}

const empty = (v) =>
  v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const findLead = (d, phone, lid) => (phone && d.leads.findByPhone(phone)) || (lid && d.leads.findByLid?.(lid)) || null;

function setAttention(d, conv, reason, now) {
  conv.needsAttention = true;
  conv.attentionReason = reason;
  conv.attentionAt = now;
  d.emit('conversation:attention', { phone: conv.phone, reason });
}

// Kirim dengan retry hanya bila galat boleh diulang (retryable !== false).
async function sendRetry(d, jid, text) {
  let err;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      return await d.send(jid, text);
    } catch (e) {
      err = e;
      if (e?.retryable === false || i === ATTEMPTS - 1) break;
      await d.sleep(BACKOFF[i]);
    }
  }
  throw err;
}

function mergeConv(cur, old) {
  cur.messages = [...cur.messages, ...old.messages].sort((a, b) => a.ts - b.ts);
  cur.createdAt = Math.min(cur.createdAt ?? Infinity, old.createdAt ?? Infinity);
  cur.data = { ...old.data, ...cur.data };
  cur.unread = (cur.unread || 0) + (old.unread || 0);
  cur.lastMessageAt = Math.max(cur.lastMessageAt || 0, old.lastMessageAt || 0);
  cur.skipped = [...new Set([...(cur.skipped || []), ...(old.skipped || [])])];
  cur.openingSent = !!(cur.openingSent || old.openingSent);
  cur.completedAt = cur.completedAt || old.completedAt;
  if (!cur.name && old.name) cur.name = old.name;
}

function reconcile(d, phone, lid) {
  if (!phone || !lid || phone === lid) return;
  const old = d.convs.get(lid);
  if (old) {
    const cur = d.convs.get(phone);
    if (!cur) {
      const { conv } = d.convs.getOrCreate(phone, old.jid, old.name);
      Object.assign(conv, old, { phone, phoneKnown: true });
    } else {
      mergeConv(cur, old);
      cur.phoneKnown = true;
    }
    d.convs.remove(lid);
  }
  const a = d.leads.findByLid?.(lid), b = d.leads.findByPhone(phone);
  if (a && b && a.id !== b.id) {
    const [keep, drop] = (a.createdAt ?? 0) <= (b.createdAt ?? 0) ? [a, b] : [b, a];
    const patch = { phone, lid: keep.lid || lid };
    for (const [k, v] of Object.entries(drop)) if (k !== 'id' && empty(keep[k]) && !empty(v)) patch[k] = v;
    d.leads.update(keep.id, patch);
    d.leads.remove(drop.id);
  }
}

export async function processIncoming(msg, d) {
  const key = msg.phone || msg.lid;
  if (!key || msg.kind === 'reaction' || msg.kind === 'system') return null;
  const S = d.settings.get();
  const now = d.now();
  reconcile(d, msg.phone, msg.lid);

  const { conv } = d.convs.getOrCreate(key, msg.jid, msg.name);
  conv.jid = msg.jid;
  conv.lid = msg.lid || conv.lid;
  conv.phoneKnown = !!msg.phone;
  if (!conv.name && msg.name) conv.name = msg.name;
  const nameBefore = conv.name;
  const media = { type: msg.kind, mediaId: msg.mediaId, caption: msg.caption, waId: msg.waId };

  // Pesan dari HP admin: auto-takeover, tidak masuk CRM.
  if (msg.fromPhone) {
    const m = d.convs.addMessage(conv, 'admin', msg.text, msg.ts);
    Object.assign(m, media, { sender: 'HP' });
    if (S.autoTakeoverOnPhoneReply && conv.mode === 'bot') {
      setMode(conv, 'admin', now);
      d.convs.addMessage(conv, 'system', 'Admin membalas dari HP. Bot dinonaktifkan untuk percakapan ini.', now);
    }
    conv.needsAttention = false;
    conv.attentionReason = null;
    conv.attentionAt = null;
    const lead = findLead(d, msg.phone, msg.lid);
    if (lead) d.leads.update(lead.id, { lastReplyAt: msg.ts });
    d.convs.save();
    d.emit('message:new', { phone: key, by: 'admin', type: msg.kind });
    return { conv, message: m, replies: [], lead, changes: null, attention: null };
  }

  // Pesan pelanggan.
  const message = d.convs.addMessage(conv, 'customer', msg.text, msg.ts);
  Object.assign(message, media);
  conv.unread = (conv.unread || 0) + 1;
  const customerCount = conv.messages.filter((m) => m.by === 'customer' && m.type !== 'reaction' && m.type !== 'system').length;
  const res = d.ingest({
    phone: msg.phone, lid: msg.lid, name: conv.name || msg.name, text: msg.text,
    ts: msg.ts, customerCount, kind: msg.kind, source: msg.source,
  });

  const p = plan(conv, { text: msg.text, caption: msg.caption, kind: msg.kind, ts: msg.ts }, S, now);
  if (p.attention) setAttention(d, conv, p.attention.reason, now);

  // Kirim berurutan; gagal -> berhenti tanpa commit.
  const replies = [];
  for (const r of p.replies) {
    try {
      const { waId } = await sendRetry(d, conv.jid, r.text);
      const m = d.convs.addMessage(conv, 'bot', r.text, d.now());
      Object.assign(m, { type: 'text', status: 'sent', waId, replyKind: r.kind, fieldId: r.fieldId });
      waIdToKey.set(waId, key);
      r.commit(conv);
      const l = findLead(d, msg.phone, msg.lid);
      if (l) d.leads.update(l.id, { lastReplyAt: d.now() });
      replies.push(m);
    } catch {
      const m = d.convs.addMessage(conv, 'bot', r.text, d.now());
      Object.assign(m, { type: 'text', status: 'failed', replyKind: r.kind, fieldId: r.fieldId });
      replies.push(m);
      setAttention(d, conv, 'send_failed', now);
      break;
    }
  }

  // Sinkron nama/data ke lead.
  let lead = findLead(d, msg.phone, msg.lid) || res?.lead || null;
  if (lead) {
    const patch = {};
    const merged = { ...(lead.data || {}), ...conv.data };
    if (JSON.stringify(merged) !== JSON.stringify(lead.data || {})) patch.data = merged;
    if (conv.name !== nameBefore) patch.name = conv.name;
    if (Object.keys(patch).length) {
      d.leads.update(lead.id, patch);
      lead = findLead(d, msg.phone, msg.lid) || lead;
    }
  }
  d.convs.save();
  d.emit('message:new', { phone: key, by: 'customer', type: msg.kind });
  d.emit('unread', { total: d.convs.totalUnread() });
  return { conv, message, replies, lead, changes: res?.changes, attention: p.attention };
}

// Antrean serial per kunci percakapan.
const queues = new Map();
export function handleIncoming(msg, send) {
  const k = msg.phone || msg.lid || '';
  const prev = queues.get(k) || Promise.resolve();
  const p = prev
    .then(() => processIncoming(msg, makeRealDeps(send)))
    .catch((e) => console.error('[bot]', e))
    .finally(() => {
      if (queues.get(k) === p) queues.delete(k);
    });
  queues.set(k, p);
  return p;
}

function findByWaId(d, waId) {
  const hit = (c) => c?.messages?.find((m) => m.waId === waId && m.by === 'bot');
  const c0 = d.convs.get(waIdToKey.get(waId));
  if (hit(c0)) return { conv: c0, m: hit(c0) };
  for (const row of d.convs.list()) {
    const c = d.convs.get(row.phone);
    if (hit(c)) return { conv: c, m: hit(c) };
  }
  return null;
}

/** Status kirim/baca dari WA. Tidak pernah menurunkan status. deps opsional (untuk tes). */
export function onStatusUpdate({ waId, status }, d = makeRealDeps(null)) {
  const f = findByWaId(d, waId);
  if (!f) return;
  const { conv, m } = f;
  if (status === 'failed') {
    if ((RANK[m.status] ?? 0) <= RANK.sent) m.status = 'failed';
    setAttention(d, conv, 'send_failed', d.now());
  } else if ((RANK[status] ?? -1) > (RANK[m.status] ?? -1)) m.status = status;
  d.convs.save();
}

/** Kirim ulang pesan bot yang gagal; efek keluaran diterapkan setelah sukses. */
export async function resendMessage(conv, messageId, send, d = makeRealDeps(send)) {
  const m = conv.messages.find((x) => x.id === messageId && x.by === 'bot' && x.status === 'failed');
  if (!m) throw Object.assign(new Error('Pesan tidak berstatus gagal'), { code: 'NOT_FAILED' });
  const { waId } = await sendRetry(d, conv.jid, m.text);
  m.status = 'sent';
  m.waId = waId;
  waIdToKey.set(waId, conv.phone);
  applyReplyEffect(conv, m.replyKind, m.fieldId, d.now());
  if (conv.attentionReason === 'send_failed') {
    conv.needsAttention = false;
    conv.attentionReason = null;
    conv.attentionAt = null;
  }
  d.convs.save();
  return m;
}