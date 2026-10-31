// Penyimpanan lead di SQLite (tabel leads: id, seq, blob JSON). Objek lead BEBAS-FIELD:
// seluruh properti disimpan di blob. Pola lama dipertahankan: objek dari all()/find*() boleh
// dimutasi lalu update()/save() dipanggil; tulis ke DB ditunda <=200 ms hanya untuk yang berubah.
import { randomUUID } from 'node:crypto';
import * as D from './db.js';

export const STATUSES = ['Cold Leads', 'Warm Leads', 'Hot Leads'];
export const DATA_TYPES = ['New', 'Existing'];

// Migrasi status lama ke status baru
const OLD = { Baru: 'Warm Leads', 'Dalam Proses': 'Warm Leads', Deal: 'Hot Leads', Gagal: 'Cold Leads' };
const DEBOUNCE_MS = 150;

let ready = false;
let leads = []; // terbaru di depan
let written = new Map(); // id -> JSON yang terakhir tertulis
let seqOf = new Map();
let maxSeq = 0;
let tracker = D.createTracker();
let timer = null;

function migrateLegacy({ force = false } = {}) {
  const lg = D.readLegacy('leads.json');
  if (!lg.exists || lg.corrupt) return { skipped: !!lg.corrupt, imported: 0 };
  let imported = 0;
  if (D.getMeta('migrated:leads.json') !== '1' || force) {
    const arr = Array.isArray(lg.data) ? lg.data : [];
    D.tx((db) => {
      const ins = db.prepare('INSERT OR IGNORE INTO leads(id, seq, blob) VALUES(?,?,?)');
      arr.forEach((l, i) => {
        if (!l || typeof l !== 'object') return;
        if (!l.id) l.id = randomUUID();
        imported += Number(ins.run(l.id, arr.length - i, D.encodeBlob(l)).changes) || 0;
      });
      D.setMeta('migrated:leads.json', '1');
    });
    console.log(`[store] migrasi leads.json: ${imported} lead`);
  }
  const bak = D.retireLegacy(lg.file);
  if (bak) console.log(`[store] leads.json diganti nama menjadi ${bak}`);
  return { imported };
}

function init() {
  D.getDb();
  migrateLegacy();
  leads = [];
  written = new Map();
  seqOf = new Map();
  tracker = D.createTracker();
  maxSeq = 0;
  let bad = 0;
  for (const r of D.getDb().prepare('SELECT id, seq, blob FROM leads ORDER BY seq DESC').all()) {
    maxSeq = Math.max(maxSeq, r.seq);
    let l;
    try { l = D.decodeBlob(r.blob); } catch (e) { bad++; continue; } // baris tidak terbaca dibiarkan di DB, tidak pernah dihapus
    l.id = r.id;
    seqOf.set(r.id, r.seq);
    written.set(r.id, JSON.stringify(l));
    leads.push(l);
  }
  if (bad) console.error(`[store] ${bad} lead tidak bisa dibaca (kunci salah/rusak); baris dibiarkan utuh di database`);
  ready = true;
  for (const l of leads) {
    let ch = false;
    if (OLD[l.status]) { l.status = OLD[l.status]; ch = true; }
    if (!l.dataType) { l.dataType = 'New'; ch = true; }
    if (ch) tracker.touch(l.id);
  }
  if (tracker.pending()) schedule(0);
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

function persist() {
  if (!ready) return;
  clearTimeout(timer);
  timer = null;
  const { ids, all } = tracker.take();
  const cur = new Map(leads.map((l) => [l.id, l]));
  const up = [];
  for (const id of all ? cur.keys() : ids) {
    const l = cur.get(id);
    if (!l) continue;
    const json = JSON.stringify(l);
    if (written.get(id) !== json) up.push([id, json]);
  }
  const del = [...written.keys()].filter((id) => !cur.has(id));
  if (up.length && !D.canWrite()) { tracker.retouch(ids); return; }
  if (up.length || del.length) {
    if (!D.canWrite()) return;
    try {
      D.tx((db) => {
        const upsert = db.prepare('INSERT INTO leads(id, seq, blob) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET blob=excluded.blob');
        for (const [id, json] of up) {
          if (!seqOf.has(id)) seqOf.set(id, ++maxSeq);
          upsert.run(id, seqOf.get(id), D.encodeJson(json));
        }
        const rm = db.prepare('DELETE FROM leads WHERE id=?');
        for (const id of del) rm.run(id);
      });
      for (const [id, json] of up) written.set(id, json);
      for (const id of del) { written.delete(id); seqOf.delete(id); }
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

/** Tandai perubahan; tulis ditunda <=200 ms. */
export function save(lead) {
  ensure();
  if (lead?.id) tracker.touch(lead.id);
  schedule();
}

/** Tulis sinkron semua perubahan (untuk shutdown). */
export function flush() {
  if (!ready) return;
  tracker.touchAll();
  persist();
}

D.registerFlusher({ flush, reset: () => { clearTimeout(timer); timer = null; ready = false; leads = []; } });

export const all = () => { ensure(); tracker.touchAll(); schedule(); return leads; }; // pemanggil boleh memutasi objeknya

export function findByPhone(phone) {
  ensure();
  const l = leads.find((x) => x.phone === phone);
  if (l) tracker.touch(l.id);
  return l;
}

export function findByLid(lid) {
  ensure();
  if (!lid) return undefined;
  const l = leads.find((x) => x.lid === lid);
  if (l) tracker.touch(l.id);
  return l;
}

export const updateByPhone = (phone, patch) => update(findByPhone(phone)?.id, patch);

export function add(data) {
  ensure();
  const lead = { id: randomUUID(), ...data };
  leads.unshift(lead);
  tracker.touch(lead.id);
  schedule();
  return lead;
}

export function remove(id) {
  ensure();
  const i = leads.findIndex((l) => l.id === id);
  if (i < 0) return false;
  leads.splice(i, 1);
  persist(); // penghapusan langsung permanen
  return true;
}

export function update(id, patch) {
  ensure();
  const lead = leads.find((l) => l.id === id);
  if (!lead) return null;
  Object.assign(lead, patch);
  tracker.touch(id);
  schedule();
  return lead;
}

/** Untuk scripts/migrate.js */
export function migrate(opts) { ensure(); const r = migrateLegacy(opts); ready = false; init(); return r; }
