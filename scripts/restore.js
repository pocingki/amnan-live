// Pulihkan database dari cadangan. HENTIKAN SERVER dulu.
//   node scripts/restore.js                      daftar cadangan
//   node scripts/restore.js <berkas|latest>      pulihkan (meminta konfirmasi; --yes untuk lewati)
//   node scripts/restore.js --accept-empty <nama> mulai kosong untuk berkas rusak (amnan.db atau *.json);
//                                                berkas rusak dipindah, bukan dihapus
import './_env.js';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { dataDir, stamp } from '../src/jsonfile.js';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const rest = args.filter((a) => !a.startsWith('--'));

if (args.includes('--accept-empty')) {
  const name = rest[0];
  if (!name || name !== path.basename(name)) { console.error('Pakai: node scripts/restore.js --accept-empty <amnan.db|nama.json>'); process.exit(1); }
  const dir = dataDir();
  const names = name === 'amnan.db' ? ['amnan.db', 'amnan.db-wal', 'amnan.db-shm'] : [name];
  let moved = 0;
  for (const n of names) {
    const f = path.join(dir, n);
    if (fs.existsSync(f)) { fs.renameSync(f, `${f}.corrupt-accepted-${stamp()}`); moved++; }
  }
  console.log(moved ? `Berkas dipindah (tidak dihapus). Server akan mulai dari kosong untuk ${name}.` : `${name} tidak ditemukan.`);
  process.exit(0);
}

const D = await import('../src/db.js');
const list = D.listBackups(dataDir());

if (!rest.length) {
  if (!list.length) console.log('Belum ada cadangan.');
  for (const b of list) console.log(`${b.file}  ${(b.size / 1024).toFixed(0)} KB  ${new Date(b.mtime).toISOString()}`);
  process.exit(0);
}

const pick = rest[0] === 'latest' ? list[0]?.path : fs.existsSync(rest[0]) ? rest[0] : list.find((b) => b.file === rest[0])?.path;
if (!pick) { console.error('Cadangan tidak ditemukan. Jalankan tanpa argumen untuk melihat daftar.'); process.exit(1); }

console.log(`Database sekarang akan DIGANTI dengan: ${pick}`);
console.log('Data setelah waktu cadangan itu akan hilang dari database aktif (berkas lama disimpan dengan akhiran .before-restore-*).');
if (!yes) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question('Ketik YA untuk melanjutkan: ')).trim();
  rl.close();
  if (a !== 'YA') { console.log('Dibatalkan.'); process.exit(1); }
}
try {
  const r = D.restoreBackup(pick);
  console.log(`Selesai. Dipulihkan ke ${r.restoredTo}${r.previous ? `; database lama: ${r.previous}` : ''}`);
} catch (e) {
  console.error('Pemulihan gagal, tidak ada yang diubah:', e.message);
  process.exit(1);
}
