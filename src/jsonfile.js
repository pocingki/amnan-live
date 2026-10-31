// Helper baca/tulis berkas JSON kecil di folder data (settings, users, dll.).
// Tulis atomik + fsync. Berkas rusak TIDAK pernah ditimpa diam-diam: dipindah ke
// <nama>.corrupt-<waktu>, dipulihkan dari <nama>.bak bila ada, dan bila tidak ada
// yang bisa dipulihkan penulisan nama itu diblokir sampai operator mengonfirmasi.
import fs from 'node:fs';
import path from 'node:path';

export const dataDir = () => process.env.DATA_DIR || path.resolve('data');

export const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* sistem berkas tanpa chmod */ }
  return dir;
}

export function secureFile(file) {
  try { fs.chmodSync(file, 0o600); } catch { /* abaikan bila tidak didukung */ }
}

function fsyncDir(dir) {
  try {
    const fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch { /* Windows tidak mendukung fsync direktori */ }
}

function safeName(name) {
  if (typeof name !== 'string' || !name || name !== path.basename(name)) throw new Error(`Nama berkas tidak valid: ${name}`);
  return name;
}

const blocked = new Map(); // nama -> alasan (berkas rusak dan tidak bisa dipulihkan)
const status = new Map(); // nama -> { corrupt, quarantinedTo, recoveredFrom }

export const loadStatus = (name) => status.get(name) || null;
export const isBlocked = (name) => blocked.has(name);
/** Operator menyatakan aman untuk menulis ulang berkas ini (mis. setelah memulihkan manual). */
export const acknowledge = (name) => blocked.delete(name);

// Salin (bukan pindahkan) berkas rusak: berkas asli tetap di tempat supaya start berikutnya
// tetap terblokir sampai operator bertindak, bukan diam-diam mulai dari kosong.
function quarantineCopy(file) {
  const content = fs.readFileSync(file);
  const dir = path.dirname(file);
  const base = path.basename(file);
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(`${base}.corrupt-`) && fs.readFileSync(path.join(dir, f)).equals(content)) return path.join(dir, f); // sudah pernah disalin
  }
  const q = `${file}.corrupt-${stamp()}`;
  fs.writeFileSync(q, content, { mode: 0o600 });
  return q;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Baca JSON. Hilang -> fallback. Rusak -> log, karantina, coba .bak, lalu fallback.
 * opts.strict: lempar error bila rusak (untuk berkas yang tidak boleh kosong).
 */
export function load(name, fallback, opts = {}) {
  const file = path.join(dataDir(), safeName(name));
  if (!fs.existsSync(file)) return fallback;
  try {
    return readJson(file);
  } catch (e) {
    const q = quarantineCopy(file);
    console.error(`[jsonfile] ${name} RUSAK (${e.message}). Salinan untuk pemeriksaan: ${path.basename(q)}`);
    status.set(name, { corrupt: true, quarantinedTo: q });
    if (opts.strict) throw new Error(`${name} rusak; salinan: ${q}`);
    try {
      const data = readJson(`${file}.bak`);
      console.error(`[jsonfile] ${name} dipulihkan dari cadangan ${name}.bak (perubahan terakhir mungkin hilang)`);
      status.set(name, { corrupt: true, quarantinedTo: q, recoveredFrom: `${file}.bak` });
      save(name, data);
      return data;
    } catch {
      const why = `${name} rusak dan tidak ada cadangan. Penulisan diblokir. Salinan rusak: ${q}. ` +
        `Pulihkan berkasnya atau jalankan: node scripts/restore.js --accept-empty ${name}`;
      blocked.set(name, why);
      console.error(`[jsonfile] ${why}`);
      return fallback;
    }
  }
}

export function save(name, data) {
  safeName(name);
  if (blocked.has(name)) throw new Error(blocked.get(name));
  const dir = ensureDir(dataDir());
  const file = path.join(dir, name);
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, `${file}.bak`); secureFile(`${file}.bak`); } catch { /* cadangan best-effort */ }
  }
  fs.renameSync(tmp, file);
  secureFile(file);
  fsyncDir(dir);
}
