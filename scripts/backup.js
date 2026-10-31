// Buat cadangan database sekarang (aman dijalankan saat server hidup): node scripts/backup.js
import './_env.js';
const D = await import('../src/db.js');

try {
  const file = D.backupNow({ force: true });
  if (!file) {
    console.error('Cadangan tidak dibuat: penulisan database sedang dihentikan (lihat log server).');
    process.exitCode = 1;
  } else {
    console.log(`Cadangan dibuat: ${file}`);
    console.log(`Tersimpan ${D.listBackups().length} berkas di ${D.dbPath().replace(/amnan\.db$/, 'backups')} (rotasi 14 hari).`);
  }
} catch (e) {
  console.error('Cadangan gagal:', e.message);
  process.exitCode = 1;
} finally {
  D.closeAll();
}
