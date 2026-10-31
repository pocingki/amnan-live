// Koneksi SQLite bersama (data/amnan.db): WAL, enkripsi opsional, cadangan, pemulihan.
// Memakai better-sqlite3 bila terpasang; bila tidak, node:sqlite bawaan Node >=22.5.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir, ensureDir, secureFile, stamp } from './jsonfile.js';

let Driver;
try {
  const m = await import('better-sqlite3');
  Driver = { name: 'better-sqlite3', open: (f) => new m.default(f) };
} catch {
  const m = await import('node:sqlite');
  Driver = { name: 'node:sqlite', open: (f) => new m.DatabaseSync(f) };
}
export const driverName = () => Driver.name;

const BACKUP_KEEP_DAYS = 14;
let state = null; // { db, dir, file, enc, writable, reason, recoveredFrom, timers }
const flushers = new Set();
let exitHooked = false;

// ---------- enkripsi (AES-256-GCM, kunci dari env DATA_KEY) ----------
let cctx = null;
function cryptoFor() {
  const raw = process.env.DATA_KEY || '';
  if (!raw) return null;
  if (cctx?.raw === raw) return cctx;
  const master = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : crypto.scryptSync(raw, 'amnan-live/data-key/v1', 32);
  const sub = (info) => Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
  cctx = { raw, enc: sub('enc'), mac: sub('mac'), memo: new Map() };
  return cctx;
}

function encrypt(str) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cctx.enc, iv);
  const ct = Buffer.concat([c.update(str, 'utf8'), c.final()]);
  return 'e1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function decrypt(str) {
  const cx = cryptoFor();
  if (!cx) throw new Error('Data terenkripsi tetapi DATA_KEY tidak diset');
  const buf = Buffer.from(str.slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', cx.enc, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

/** String JSON -> nilai yang disimpan di kolom blob (terenkripsi bila DATA_KEY aktif). */
export const encodeJson = (json) => (st().enc ? encrypt(json) : json);
export const encodeBlob = (obj) => encodeJson(JSON.stringify(obj));
export function decodeBlob(s) {
  return JSON.parse(typeof s === 'string' && s.startsWith('e1:') ? decrypt(s) : s);
}
/** Kunci baris: nomor asli bila tidak terenkripsi, HMAC bila terenkripsi (nomor tidak ada di kolom polos). */
export function rowKey(v) {
  v = String(v);
  if (!st().enc) return v;
  const cx = cryptoFor();
  let k = cx.memo.get(v);
  if (!k) {
    k = 'h:' + crypto.createHmac('sha256', cx.mac).update(v).digest('hex');
    if (cx.memo.size > 20000) cx.memo.clear();
    cx.memo.set(v, k);
  }
  return k;
}
export const encryptionEnabled = () => st().enc;

// ---------- pembukaan, pemulihan, skema ----------
function openFile(file) {
  const db = Driver.open(file);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;');
    const v = Object.values(db.prepare('PRAGMA quick_check').get())[0];
    if (v !== 'ok') throw new Error(`quick_check: ${v}`);
    return db;
  } catch (e) {
    try { db.close(); } catch { /* sudah rusak */ }
    throw e;
  }
}

const sidecars = (f) => [f, `${f}-wal`, `${f}-shm`];

function recover(file, err, info) {
  console.error(`[db] ${path.basename(file)} RUSAK atau tidak terbaca: ${err.message}`);
  for (const b of listBackups(path.dirname(file))) {
    const probe = `${file}.restore-probe`;
    try {
      fs.copyFileSync(b.path, probe);
      openFile(probe).close();
      const q = `${file}.corrupt-${stamp()}`;
      sidecars(file).forEach((f, i) => { if (fs.existsSync(f)) fs.renameSync(f, q + ['', '-wal', '-shm'][i]); });
      fs.renameSync(probe, file);
      info.recoveredFrom = b.path;
      info.quarantined = q;
      console.error(`[db] DIPULIHKAN dari cadangan ${b.file}. Berkas rusak disimpan di ${path.basename(q)}. Data sesudah cadangan itu hilang.`);
      return openFile(file);
    } catch (e) {
      try { fs.rmSync(probe, { force: true }); } catch { /* abaikan */ }
      console.error(`[db] cadangan ${b.file} tidak bisa dipakai: ${e.message}`);
    }
  }
  info.writable = false;
  info.reason = `Database rusak dan tidak ada cadangan yang valid (${err.message}). Penulisan ke disk DIHENTIKAN; ` +
    `berkas rusak dibiarkan di tempat. Pulihkan dengan: node scripts/restore.js (atau --accept-empty untuk mulai kosong).`;
  console.error(`[db] ${info.reason}`);
  return Driver.open(':memory:'); // aplikasi tetap jalan di memori, tidak ada yang tertulis
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, blob TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (k TEXT PRIMARY KEY, last_message_at INTEGER, blob TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (ck TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, ts INTEGER, blob TEXT NOT NULL, PRIMARY KEY (ck, id));
CREATE INDEX IF NOT EXISTS messages_seq ON messages (seq);
CREATE TABLE IF NOT EXISTS seen_messages (k TEXT PRIMARY KEY, ts INTEGER NOT NULL);
`;

function open() {
  const dir = ensureDir(dataDir());
  const file = path.join(dir, 'amnan.db');
  const info = { writable: true, reason: null, recoveredFrom: null, quarantined: null };
  let db;
  try {
    db = openFile(file);
  } catch (e) {
    if (!fs.existsSync(file)) throw e;
    db = recover(file, e, info);
  }
  db.exec(SCHEMA);
  state = { db, dir, file, enc: !!cryptoFor(), ...info, timers: [] };
  if (info.writable) sidecars(file).forEach((f) => fs.existsSync(f) && secureFile(f));
  setupEncryption();
  if (!exitHooked) {
    exitHooked = true;
    process.on('exit', () => { try { flushAll(); state?.db.close(); } catch { /* sedang keluar */ } });
  }
  scheduleBackups();
  return state;
}

function st() {
  return state || open();
}
export const getDb = () => st().db;
export const dbPath = () => st().file;
export const canWrite = () => st().writable;
export const status = () => ({ writable: st().writable, reason: st().reason, recoveredFrom: st().recoveredFrom, encrypted: st().enc, driver: Driver.name });

/** Hentikan penulisan ke disk (dipanggil modul bila menemukan korupsi / data tak aman). */
export function block(reason) {
  const s = st();
  if (s.writable) console.error(`[db] PENULISAN DIHENTIKAN: ${reason}`);
  s.writable = false;
  s.reason = s.reason || reason;
}
export const CORRUPT_RE = /malformed|corrupt|not a database|disk image|I\/O error|readonly|read-only/i;
export function noteWriteError(e) {
  console.error(`[db] gagal menulis: ${e.message}`);
  if (CORRUPT_RE.test(e.message || '')) block(`kesalahan SQLite: ${e.message}`);
}

export const getMeta = (k) => st().db.prepare('SELECT value FROM meta WHERE key=?').get(k)?.value ?? null;
export const setMeta = (k, v) => st().db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

export function tx(fn) {
  const db = st().db;
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn(db);
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* sudah dibatalkan */ }
    throw e;
  }
}

function setupEncryption() {
  const s = state;
  const flag = getMeta('enc') === '1';
  if (!s.enc) {
    if (flag) throw new Error('Data di disk terenkripsi tetapi DATA_KEY belum diset. Isi DATA_KEY yang sama seperti sebelumnya.');
    return;
  }
  if (flag) {
    try {
      if (decodeBlob(getMeta('canary')).ok !== true) throw new Error('canary');
    } catch {
      try { s.db.close(); } catch { /* abaikan */ }
      state = null;
      throw new Error('DATA_KEY salah: data terenkripsi tidak bisa dibuka. Tidak ada yang diubah.');
    }
    return;
  }
  // Data lama masih polos: enkripsi seluruhnya dalam satu transaksi.
  if (!s.writable) return;
  const db = s.db;
  tx(() => {
    for (const r of db.prepare('SELECT id, blob FROM leads').all()) {
      if (!r.blob.startsWith('e1:')) db.prepare('UPDATE leads SET blob=? WHERE id=?').run(encrypt(r.blob), r.id);
    }
    for (const r of db.prepare('SELECT k, blob FROM conversations').all()) {
      const obj = JSON.parse(r.blob);
      const nk = rowKey(obj.phone ?? r.k);
      db.prepare('UPDATE messages SET ck=? WHERE ck=?').run(nk, r.k);
      db.prepare('UPDATE conversations SET k=?, blob=? WHERE k=?').run(nk, encrypt(r.blob), r.k);
    }
    for (const r of db.prepare('SELECT ck, id, blob FROM messages').all()) {
      if (!r.blob.startsWith('e1:')) db.prepare('UPDATE messages SET blob=? WHERE ck=? AND id=?').run(encrypt(r.blob), r.ck, r.id);
    }
    for (const r of db.prepare('SELECT k FROM seen_messages').all()) {
      if (!r.k.startsWith('h:')) db.prepare('UPDATE seen_messages SET k=? WHERE k=?').run(rowKey(r.k), r.k);
    }
    setMeta('canary', encodeBlob({ ok: true }));
    setMeta('enc', '1');
  });
  // buang sisa teks polos di halaman bebas / WAL
  db.exec('VACUUM');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  console.log('[db] enkripsi at-rest AES-256-GCM aktif (data lama dienkripsi)');
}

// ---------- pelacak perubahan (dirty tracking) ----------
// Objek dimutasi lalu save() dipanggil tanpa argumen, jadi pemilik objek yang "disentuh" dicatat.
// Setelah ditulis, id diperiksa ulang sekali lagi beberapa detik kemudian (mutasi setelah await).
export function createTracker(delays = [3000, 20000]) {
  const hot = new Set();
  let later = [];
  let all = false;
  return {
    touch: (id) => hot.add(id),
    touchAll: () => { all = true; },
    pending: () => hot.size > 0 || all,
    take(now = Date.now()) {
      const ids = new Set(hot);
      const keep = [];
      for (const x of later) (x.at <= now ? ids.add(x.id) : keep.push(x));
      later = keep;
      for (const id of hot) for (const d of delays) later.push({ id, at: now + d });
      hot.clear();
      const a = all;
      all = false;
      return { ids, all: a };
    },
    retouch: (ids) => ids.forEach((i) => hot.add(i)),
    nextAt: () => (later.length ? Math.min(...later.map((x) => x.at)) : null),
  };
}

// ---------- flusher & penutupan ----------
export function registerFlusher(f) { flushers.add(f); } // f = { flush(), reset() }
export function flushAll() {
  for (const f of flushers) {
    try { f.flush(); } catch (e) { console.error('[db] flush gagal:', e.message); }
  }
}

export function closeAll() {
  if (!state) return;
  flushAll();
  for (const t of state.timers) clearInterval(t), clearTimeout(t);
  for (const f of flushers) { try { f.reset(); } catch { /* abaikan */ } }
  try { state.db.close(); } catch { /* abaikan */ }
  state = null;
}

// ---------- berkas JSON lama (migrasi) ----------
/** Baca berkas JSON lama. Rusak -> salinan .corrupt-*, tetap di tempat, hasil {corrupt:true}. */
export function readLegacy(name) {
  const file = path.join(st().dir, name);
  if (!fs.existsSync(file)) return { exists: false };
  try {
    return { exists: true, file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    const q = `${file}.corrupt-${stamp()}`;
    try { fs.copyFileSync(file, q); secureFile(q); } catch { /* abaikan */ }
    console.error(`[db] ${name} lama RUSAK (${e.message}); salinan ${path.basename(q)}. Migrasi dihentikan, berkas asli tidak diubah.`);
    block(`${name} rusak sehingga migrasi tidak bisa dilakukan. Perbaiki berkas itu lalu restart (atau node scripts/migrate.js --skip-corrupt ${name}).`);
    return { exists: true, file, corrupt: true };
  }
}

/** Ganti nama berkas lama menjadi .bak (tidak pernah dihapus, tidak menimpa .bak yang ada). */
export function retireLegacy(file) {
  if (!fs.existsSync(file)) return null;
  let dest = `${file}.bak`;
  if (fs.existsSync(dest)) dest = `${file}.bak-${stamp()}`;
  fs.renameSync(file, dest);
  return dest;
}

// ---------- cadangan ----------
const BK_RE = /^amnan-(\d{4}-\d{2}-\d{2})(-\d{6})?\.db$/;

function tzNow(d = new Date()) {
  const tz = process.env.TZ || 'Asia/Jakarta';
  try {
    return { day: d.toLocaleDateString('sv-SE', { timeZone: tz }), time: d.toLocaleTimeString('sv-SE', { timeZone: tz }).replace(/:/g, '') };
  } catch {
    const iso = d.toISOString();
    return { day: iso.slice(0, 10), time: iso.slice(11, 19).replace(/:/g, '') };
  }
}

export function listBackups(dir = st().dir) {
  const bdir = path.join(dir, 'backups');
  if (!fs.existsSync(bdir)) return [];
  return fs.readdirSync(bdir)
    .filter((f) => BK_RE.test(f))
    .map((f) => {
      const p = path.join(bdir, f);
      const s = fs.statSync(p);
      return { file: f, path: p, size: s.size, mtime: s.mtimeMs, day: f.match(BK_RE)[1] };
    })
    .sort((a, b) => b.mtime - a.mtime || (a.file < b.file ? 1 : -1));
}

function rotateBackups() {
  const all = listBackups();
  const cut = tzNow(new Date(Date.now() - BACKUP_KEEP_DAYS * 86400000)).day;
  for (const b of all.slice(1)) { // yang terbaru tidak pernah dihapus
    if (b.day <= cut) fs.rmSync(b.path, { force: true });
  }
}

/** Cadangan online (VACUUM INTO, konsisten walau server sedang menulis). force=true -> berkas tambahan bercap waktu. */
export function backupNow({ force = false } = {}) {
  const s = st();
  if (!s.writable) return null;
  flushAll();
  const { day, time } = tzNow();
  const dir = ensureDir(path.join(s.dir, 'backups'));
  const dest = path.join(dir, force ? `amnan-${day}-${time}.db` : `amnan-${day}.db`);
  if (!force && fs.existsSync(dest)) return null;
  const n = s.db.prepare('SELECT (SELECT COUNT(*) FROM leads) + (SELECT COUNT(*) FROM conversations) AS n').get().n;
  if (!force && n === 0) return null; // jangan menggeser cadangan bagus dengan cadangan kosong
  const tmp = `${dest}.tmp`;
  fs.rmSync(tmp, { force: true });
  s.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  fs.renameSync(tmp, dest);
  secureFile(dest);
  rotateBackups();
  console.log(`[db] cadangan dibuat: ${path.basename(dest)}`);
  return dest;
}

function scheduleBackups() {
  if (process.env.AMNAN_NO_BACKUP === '1') return;
  const run = () => { try { backupNow(); } catch (e) { console.error('[db] cadangan harian gagal:', e.message); } };
  const t1 = setTimeout(run, 5000);
  const t2 = setInterval(run, 3600 * 1000);
  t1.unref?.(); t2.unref?.();
  state.timers.push(t1, t2);
}

/** Pulihkan dari berkas cadangan (server harus mati). DB saat ini diganti nama, bukan dihapus. */
export function restoreBackup(backupFile) {
  const dir = ensureDir(dataDir());
  const file = path.join(dir, 'amnan.db');
  openFile(backupFile).close(); // verifikasi dulu; lempar error bila rusak
  const q = `${file}.before-restore-${stamp()}`;
  sidecars(file).forEach((f, i) => { if (fs.existsSync(f)) fs.renameSync(f, q + ['', '-wal', '-shm'][i]); });
  fs.copyFileSync(backupFile, file);
  secureFile(file);
  return { restoredTo: file, previous: fs.existsSync(q) ? q : null };
}
