// Riwayat percakapan WhatsApp di SQLite: tabel conversations (metadata, blob JSON) dan
// messages (satu baris per pesan). Objek percakapan BEBAS-FIELD (semua properti tersimpan).
// Pola lama tetap: get()/getOrCreate() -> mutasi -> save(); tulis ditunda <=200 ms dan
// hanya untuk percakapan yang berubah; flush() sinkron untuk shutdown.
import { randomBytes } from 'node:crypto';
import * as D from './db.js';
import { emit } from './events.js';

const DEBOUNCE_MS = 150;
const MAX_MESSAGES = 1000;
const SEEN_KEEP_MS = 30 * 86400000;
const SWEEP_EVERY_MS = 60000;
const SWEEP_CHUNK = 200;

let ready = false;
let convs = {}; // phone -> percakapan
let written = new Map(); // phone -> { meta: json, msgs: Map(id -> { json, seq }) }
let tracker = D.createTracker();
let timer = null;
let sweepTimer = null;
let sweepCursor = 0;
let msgSeq = 0;
let seen = new Set();
let lastTotal = null;

function migrateLegacy({ force = false } = {}) {
  const lg = D.readLegacy('conversations.json');
  if (!lg.exists || lg.corrupt) return { skipped: !!lg.corrupt, imported: 0 };
  let imported = 0;
  if (D.getMeta('migrated:conversations.json') !== '1' || force) {
    const obj = lg.data && typeof lg.data === 'object' ? lg.data : {};
    D.tx((db) => {
      const mseq = db.prepare('SELECT COALESCE(MAX(seq),0) AS m FROM messages').get().m;
      let seq = mseq;
      const insC = db.prepare('INSERT OR IGNORE INTO conversations(k, last_message_at, blob) VALUES(?,?,?)');
      const insM = db.prepare('INSERT OR IGNORE INTO messages(ck, id, seq, ts, blob) VALUES(?,?,?,?,?)');
      for (const [phone, c] of Object.entries(obj)) {
        if (!c || typeof c !== 'object') continue;
        const { messages = [], ...rest } = c;
        rest.phone = rest.phone || phone;
        const k = D.rowKey(rest.phone);
        if (Number(insC.run(k, rest.lastMessageAt || 0, D.encodeBlob(rest)).changes)) imported++;
        messages.forEach((m, i) => {
          if (!m.id) m.id = randomBytes(4).toString('hex') + i;
          insM.run(k, String(m.id), ++seq, m.ts || 0, D.encodeBlob(m));
        });
      }
      D.setMeta('migrated:conversations.json', '1');
    });
    console.log(`[conversations] migrasi conversations.json: ${imported} percakapan`);
  }
  const bak = D.retireLegacy(lg.file);
  if (bak) console.log(`[conversations] conversations.json diganti nama menjadi ${bak}`);
  return { imported };
}

function init() {
  const db = D.getDb();
  migrateLegacy();
  convs = {};
  written = new Map();
  tracker = D.createTracker();
  const byKey = new Map();
  let bad = 0;
  for (const r of db.prepare('SELECT k, blob FROM conversations').all()) {
    try {
      const c = D.decodeBlob(r.blob);
      if (!c.phone) { if (D.encryptionEnabled()) { bad++; continue; } c.phone = r.k; }
      c.messages = [];
      convs[c.phone] = c;
      byKey.set(r.k, c);
    } catch { bad++; }
  }
  msgSeq = db.prepare('SELECT COALESCE(MAX(seq),0) AS m FROM messages').get().m;
  let orphan = 0;
  for (const r of db.prepare('SELECT ck, id, seq, blob FROM messages ORDER BY seq').all()) {
    const c = byKey.get(r.ck);
    if (!c) { orphan++; continue; }
    try {
      const m = D.decodeBlob(r.blob);
      m.id = r.id;
      c.messages.push(m);
    } catch { bad++; }
  }
  for (const c of Object.values(convs)) {
    const w = { meta: null, msgs: new Map() };
    const { messages, ...rest } = c;
    w.meta = JSON.stringify(rest);
    const seqs = new Map(db.prepare('SELECT id, seq FROM messages WHERE ck=?').all(D.rowKey(c.phone)).map((r) => [r.id, r.seq]));
    for (const m of messages) w.msgs.set(m.id, { json: JSON.stringify(m), seq: seqs.get(m.id) });
    written.set(c.phone, w);
  }
  if (bad) console.error(`[conversations] ${bad} baris tidak terbaca (kunci salah/rusak); dibiarkan utuh di database`);
  if (orphan) console.error(`[conversations] ${orphan} pesan tanpa percakapan diabaikan (tidak dihapus)`);
  seen = new Set(db.prepare('SELECT k FROM seen_messages').all().map((r) => r.k));
  ready = true;
  lastTotal = totalUnread();
  sweepTimer = setInterval(sweep, SWEEP_EVERY_MS);
  sweepTimer.unref?.();
  purgeSeen();
}

const ensure = () => { if (!ready) init(); };

let timerAt = 0;
function schedule(ms = DEBOUNCE_MS) {
  const at = Date.now() + ms;
  if (timer && timerAt <= at) return; // sudah ada timer yang lebih cepat
  clearTimeout(timer);
  timerAt = at;
  timer = setTimeout(() => { timer = null; persist(); }, ms);
  timer.unref?.();
}

// Pemeriksaan bergilir: menjaga mutasi yang terlewat (mis. objek dipegang lewat await) tetap tersimpan.
function sweep() {
  const phones = Object.keys(convs);
  if (!phones.length) return;
  for (let i = 0; i < Math.min(SWEEP_CHUNK, phones.length); i++) tracker.touch(phones[(sweepCursor + i) % phones.length]);
  sweepCursor = (sweepCursor + SWEEP_CHUNK) % phones.length;
  schedule();
}

function persist() {
  if (!ready) return;
  clearTimeout(timer);
  timer = null;
  const { ids, all } = tracker.take();
  const ops = [];
  for (const phone of all ? Object.keys(convs) : ids) {
    const c = convs[phone];
    if (!c) continue;
    const { messages = [], ...rest } = c;
    const w = written.get(phone) || { meta: null, msgs: new Map() };
    const op = { phone, w, metaJson: null, msgUp: [], msgDel: [], newSeq: new Map() };
    const metaJson = JSON.stringify(rest);
    if (metaJson !== w.meta) op.metaJson = metaJson;
    const present = new Set();
    for (const m of messages) {
      if (!m.id) m.id = randomBytes(4).toString('hex');
      present.add(m.id);
      const json = JSON.stringify(m);
      const e = w.msgs.get(m.id);
      if (!e || e.json !== json) op.msgUp.push({ m, json });
    }
    for (const id of w.msgs.keys()) if (!present.has(id)) op.msgDel.push(id);
    if (op.metaJson || op.msgUp.length || op.msgDel.length) ops.push(op);
  }
  const gone = [...written.keys()].filter((p) => !convs[p]);
  if ((ops.length || gone.length) && D.canWrite()) {
    try {
      D.tx((db) => {
        const upC = db.prepare('INSERT INTO conversations(k, last_message_at, blob) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET last_message_at=excluded.last_message_at, blob=excluded.blob');
        const upM = db.prepare('INSERT INTO messages(ck, id, seq, ts, blob) VALUES(?,?,?,?,?) ON CONFLICT(ck, id) DO UPDATE SET ts=excluded.ts, blob=excluded.blob');
        const delM = db.prepare('DELETE FROM messages WHERE ck=? AND id=?');
        for (const op of ops) {
          const k = D.rowKey(op.phone);
          const c = convs[op.phone];
          if (op.metaJson) upC.run(k, c.lastMessageAt || 0, D.encodeJson(op.metaJson));
          for (const { m, json } of op.msgUp) {
            const e = op.w.msgs.get(m.id);
            const seq = e?.seq ?? ++msgSeq;
            op.newSeq.set(m.id, { json, seq });
            upM.run(k, String(m.id), seq, m.ts || 0, D.encodeJson(json));
          }
          for (const id of op.msgDel) delM.run(k, String(id));
        }
        for (const phone of gone) {
          const k = D.rowKey(phone);
          db.prepare('DELETE FROM messages WHERE ck=?').run(k);
          db.prepare('DELETE FROM conversations WHERE k=?').run(k);
        }
      });
      for (const op of ops) {
        if (op.metaJson) op.w.meta = op.metaJson;
        for (const [id, e] of op.newSeq) op.w.msgs.set(id, e);
        for (const id of op.msgDel) op.w.msgs.delete(id);
        written.set(op.phone, op.w);
      }
      for (const p of gone) written.delete(p);
    } catch (e) {
      D.noteWriteError(e);
      tracker.retouch(ids);
      if (D.canWrite()) schedule(1000);
      return;
    }
  }
  const next = tracker.nextAt();
  if (next) schedule(Math.max(next - Date.now(), 50));
}

function checkUnread() {
  const t = totalUnread();
  if (t !== lastTotal) {
    lastTotal = t;
    emit('unread', { total: t });
  }
}

/** Tandai perubahan (conv opsional); tulis ke DB ditunda <=200 ms. */
export function save(conv) {
  ensure();
  if (conv?.phone) tracker.touch(conv.phone);
  schedule();
  checkUnread();
}
export const touch = (conv) => { ensure(); if (conv?.phone) tracker.touch(conv.phone); };

/** Tulis sinkron semua perubahan (shutdown). */
export function flush() {
  if (!ready) return;
  tracker.touchAll();
  persist();
}

D.registerFlusher({
  flush,
  reset: () => { clearTimeout(timer); clearInterval(sweepTimer); timer = null; sweepTimer = null; ready = false; convs = {}; seen = new Set(); },
});

export function newConv(phone, jid, name = '', now = Date.now(), lid = null) {
  return {
    phone, jid, name, lid,
    mode: 'bot', // bot | admin
    createdAt: now, botStartedAt: now, lastMessageAt: now,
    unread: 0, openingSent: false, pending: null, skipped: [], data: {}, messages: [],
    needsAttention: false, attentionReason: '', attentionAt: null, completedAt: null, lastFallbackAt: null,
  };
}

/** extra: properti tambahan pesan (type, mediaId, caption, status, waId, sender, ...). */
export function addMessage(conv, by, text, ts = Date.now(), extra = {}) {
  const m = { id: randomBytes(4).toString('hex'), by, text, ts, type: 'text', ...extra }; // by: customer | bot | admin | system
  conv.messages.push(m);
  if (conv.messages.length > MAX_MESSAGES) conv.messages.splice(0, conv.messages.length - MAX_MESSAGES);
  conv.lastMessageAt = Math.max(conv.lastMessageAt || 0, ts);
  if (conv.phone) tracker.touch(conv.phone);
  return m;
}

export function get(phone) {
  ensure();
  const c = convs[phone];
  if (c) tracker.touch(phone);
  return c;
}

export function getOrCreate(phone, jid, name) {
  ensure();
  if (convs[phone]) { tracker.touch(phone); return { conv: convs[phone], created: false }; }
  convs[phone] = newConv(phone, jid, name);
  tracker.touch(phone);
  schedule();
  return { conv: convs[phone], created: true };
}

export function findByLid(lid) {
  ensure();
  if (!lid) return undefined;
  const c = Object.values(convs).find((x) => x.lid === lid);
  if (c) tracker.touch(c.phone);
  return c;
}

export function remove(phone) {
  ensure();
  delete convs[phone];
  persist(); // penghapusan langsung permanen
  checkUnread();
}

export function removeMessages(conv, ids) {
  ensure();
  const s = new Set(ids);
  conv.messages = conv.messages.filter((m) => !s.has(m.id));
  tracker.touch(conv.phone);
  persist();
}

export const dataFor = (phone) => { ensure(); const c = convs[phone]; if (c) tracker.touch(phone); return c?.data || {}; };

export function totalUnread() {
  ensure();
  let n = 0;
  for (const c of Object.values(convs)) n += c.unread || 0;
  return n;
}

/** Pesan terakhir yang bukan 'system' dari pelanggan, belum dibalas siapa pun -> true. */
function awaitingReply(c) {
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const m = c.messages[i];
    if (m.by === 'system') continue;
    return m.by === 'customer';
  }
  return false;
}

export function list() {
  ensure();
  return Object.values(convs)
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
    .map((c) => {
      const last = c.messages[c.messages.length - 1];
      return {
        phone: c.phone, name: c.name, mode: c.mode, unread: c.unread || 0, lastMessageAt: c.lastMessageAt,
        lid: c.lid || null,
        needsAttention: !!c.needsAttention, attentionReason: c.attentionReason || '', attentionAt: c.attentionAt || null,
        completedAt: c.completedAt || null,
        awaitingReply: awaitingReply(c),
        last: last ? { by: last.by, type: last.type || 'text', text: String(last.text || last.caption || '').slice(0, 80) } : null,
      };
    });
}

// ---------- dedupe pesan lintas restart ----------
export function seenMessage(waId) {
  ensure();
  return seen.has(D.rowKey(waId));
}

export function markSeen(waId, ts = Date.now()) {
  ensure();
  const k = D.rowKey(waId); // HMAC bila terenkripsi; set `seen` juga berisi kunci baris
  if (seen.has(k)) return;
  seen.add(k);
  if (!D.canWrite()) return;
  try {
    D.getDb().prepare('INSERT OR IGNORE INTO seen_messages(k, ts) VALUES(?,?)').run(k, ts);
  } catch (e) {
    D.noteWriteError(e);
  }
}

function purgeSeen() {
  if (!D.canWrite()) return;
  try { D.getDb().prepare('DELETE FROM seen_messages WHERE ts < ?').run(Date.now() - SEEN_KEEP_MS); } catch (e) { D.noteWriteError(e); }
}
export const purgeSeenOld = () => { ensure(); purgeSeen(); };

/** Semua percakapan (untuk retensi/hapus data pelanggan). Objek asli, boleh dimutasi lalu save(). */
export function _all() { ensure(); tracker.touchAll(); schedule(); return Object.values(convs); }

export function migrate(opts) { ensure(); return migrateLegacy(opts); }

/** Hanya untuk tes performa: tulis yang berubah sekarang (tanpa pemindaian penuh). */
export const _persistNow = () => persist();
