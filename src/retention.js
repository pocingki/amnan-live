// Retensi data pelanggan: hapus pesan/percakapan lama + berkas media, anonimkan lead lama,
// dan hapus seluruh data satu pelanggan (hak hapus). retentionDays = 0 berarti mati.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as store from './store.js';
import * as C from './conversations.js';
import * as D from './db.js';
import * as settings from './settings.js';
import { dataDir } from './jsonfile.js';

const DAY = 86400000;
let timer = null;
let first = null;
let lastResult = null;

const cfg = () => {
  try { return settings.get() || {}; } catch { return {}; }
};
export const retentionDays = () => Math.max(0, Number(cfg().retentionDays) || 0);
export const getLastResult = () => lastResult;

/** Hapus berkas media (data/media/<mediaId>, juga <mediaId>.<ext>). Mengembalikan jumlah berkas terhapus. */
export function deleteMedia(ids) {
  const want = new Set([...ids].map(String).filter((id) => id && id === path.basename(id) && !id.startsWith('.')));
  if (!want.size) return 0;
  const dir = path.join(dataDir(), 'media');
  let files;
  try { files = fs.readdirSync(dir); } catch { return 0; }
  let n = 0;
  for (const f of files) {
    const base = f.includes('.') ? f.slice(0, f.indexOf('.')) : f;
    if (want.has(f) || want.has(base)) {
      try { fs.rmSync(path.join(dir, f), { force: true }); n++; } catch (e) { console.error(`[retention] gagal hapus media: ${e.message}`); }
    }
  }
  return n;
}

const mediaIds = (msgs) => msgs.map((m) => m.mediaId).filter(Boolean);
const lastActivity = (l) => Math.max(0, ...['lastMessageAt', 'lastCustomerMessageAt', 'lastReplyAt', 'createdAt', 'updatedAt'].map((k) => Number(l[k]) || 0));

function anonymize(l) {
  const h = crypto.createHash('sha256').update(String(l.id)).digest('hex').slice(0, 8);
  l.phone = `anon-${h}`;
  l.name = 'Anonim';
  delete l.lid;
  l.data = {};
  l.notes = [];
  l.followUpNote = '';
  l.statusReason = '';
  l.keyword = '';
  l.source = l.source ? { platform: l.source.platform } : l.source;
  l.anonymizedAt = Date.now();
}

/** Terapkan retensi. days default dari settings; days<=0 -> tidak melakukan apa-apa. */
export function purge({ days = retentionDays(), now = Date.now() } = {}) {
  const res = { days, messages: 0, conversations: 0, media: 0, leadsAnonymized: 0 };
  if (!(days > 0)) return res;
  if (!D.canWrite()) { console.error('[retention] dilewati: penulisan database sedang dihentikan'); return { ...res, skipped: true }; }
  const cutoff = now - days * DAY;
  const media = [];
  for (const c of C._all()) {
    const old = c.messages.filter((m) => (m.ts || 0) < cutoff);
    if ((c.lastMessageAt || 0) < cutoff) {
      media.push(...mediaIds(c.messages));
      res.messages += c.messages.length;
      C.remove(c.phone);
      res.conversations++;
    } else if (old.length) {
      media.push(...mediaIds(old));
      res.messages += old.length;
      C.removeMessages(c, old.map((m) => m.id));
    }
  }
  const phones = new Set(C._all().map((c) => c.phone));
  for (const l of store.all()) {
    if (l.anonymizedAt || phones.has(l.phone) || lastActivity(l) >= cutoff) continue;
    anonymize(l);
    store.save(l);
    res.leadsAnonymized++;
  }
  res.media = deleteMedia(media);
  C.purgeSeenOld();
  store.flush();
  C.flush();
  lastResult = { ...res, at: now };
  try { D.setMeta('retention:lastRun', String(now)); } catch { /* abaikan */ }
  if (res.conversations || res.messages || res.leadsAnonymized) {
    console.log(`[retention] ${days} hari: ${res.messages} pesan, ${res.conversations} percakapan, ${res.media} media, ${res.leadsAnonymized} lead dianonimkan`);
  }
  return res;
}

/** Hapus semua data satu pelanggan: lead + percakapan + pesan + media. */
export function deleteCustomer(phone) {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  const keys = new Set([raw, digits].filter(Boolean));
  const out = { leads: 0, conversation: false, messages: 0, media: 0 };
  const media = [];
  const lids = new Set();
  for (const k of keys) {
    const c = C.get(k);
    if (!c) continue;
    if (c.lid) lids.add(c.lid);
    media.push(...mediaIds(c.messages));
    out.messages += c.messages.length;
    C.remove(c.phone);
    out.conversation = true;
  }
  for (const l of [...store.all()]) {
    if (keys.has(l.phone) || (l.lid && lids.has(l.lid))) {
      if (l.lid) lids.add(l.lid);
      store.remove(l.id);
      out.leads++;
    }
  }
  for (const lid of lids) { // percakapan lain yang terhubung lewat LID yang sama
    const c = C.findByLid(lid);
    if (c) { media.push(...mediaIds(c.messages)); out.messages += c.messages.length; C.remove(c.phone); out.conversation = true; }
  }
  out.media = deleteMedia(media);
  store.flush();
  C.flush();
  out.found = out.leads > 0 || out.conversation;
  return out;
}

export function start() {
  if (timer) return;
  const tick = () => {
    try {
      const last = Number(D.getMeta('retention:lastRun')) || 0;
      if (retentionDays() > 0 && Date.now() - last > 20 * 3600000) purge();
    } catch (e) { console.error('[retention] gagal:', e.message); }
  };
  first = setTimeout(tick, 60000);
  timer = setInterval(tick, 6 * 3600000);
  first.unref?.(); timer.unref?.();
}

export function stop() {
  clearTimeout(first); clearInterval(timer);
  timer = null; first = null;
}
