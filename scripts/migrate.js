// Migrasi manual data/leads.json dan data/conversations.json ke SQLite (biasanya otomatis saat start).
//   node scripts/migrate.js             migrasi yang belum dilakukan
//   node scripts/migrate.js --force     impor ulang (INSERT OR IGNORE: data yang sudah ada tidak ditimpa)
//   node scripts/migrate.js --skip-corrupt <leads.json|conversations.json>  lewati berkas lama yang rusak
import './_env.js';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, stamp } from '../src/jsonfile.js';

const args = process.argv.slice(2);
const i = args.indexOf('--skip-corrupt');
if (i >= 0) {
  const name = args[i + 1];
  if (!['leads.json', 'conversations.json'].includes(name)) { console.error('Nama berkas harus leads.json atau conversations.json'); process.exit(1); }
  const f = path.join(dataDir(), name);
  if (fs.existsSync(f)) fs.renameSync(f, `${f}.corrupt-skipped-${stamp()}`);
  console.log(`${name} dilewati (dipindah, tidak dihapus).`);
  process.exit(0);
}

const force = args.includes('--force');
const D = await import('../src/db.js');
const store = await import('../src/store.js');
const C = await import('../src/conversations.js');
try {
  console.log('leads:', store.migrate({ force }));
  console.log('percakapan:', C.migrate({ force }));
  console.log('status database:', D.status());
} catch (e) {
  console.error('Migrasi gagal:', e.message);
  process.exitCode = 1;
} finally {
  D.closeAll();
}
