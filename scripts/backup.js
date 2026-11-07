// Buat cadangan database dan seluruh data instance (sesi WhatsApp, kunci integrasi, pengguna, pengaturan).
// DATA_KEY tidak disalin. Simpan kunci itu di tempat lain.
// Aman dijalankan saat server hidup: node scripts/backup.js
import './_env.js';
const D = await import('../src/db.js');

try {
  const file = D.backupNow({ force: true });
  if (!file) {
    console.error('Cadangan tidak dibuat: penulisan database sedang dihentikan (lihat log server).');
    process.exitCode = 1;
  } else {
    const snapshot = D.backupDataSnapshot({ force: true, dbFile: file });
    console.log(`Cadangan database: ${file}`);
    if (snapshot) console.log(`Cadangan data (sesi, kunci, pengaturan): ${snapshot}`);
    console.log('DATA_KEY tidak ikut cadangan. Simpan kunci itu terpisah dari folder backup.');
    console.log(`Tersimpan ${D.listBackups().length} berkas database di ${D.dbPath().replace(/amnan\.db$/, 'backups')} (rotasi 14 hari).`);
  }
} catch (e) {
  console.error('Cadangan gagal:', e.message);
  process.exitCode = 1;
} finally {
  D.closeAll();
}
