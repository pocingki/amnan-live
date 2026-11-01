// pm2 untuk banyak client dari SATU salinan kode. Satu proses per folder client di AMNAN_CLIENTS_DIR
// (bawaan /opt/clients). Tiap folder berisi .env, keywords.json, dan data/ milik client itu.
// Tambah client:  node scripts/client.js new <slug> ...   lalu:
//   pm2 startOrReload deploy/ecosystem.clients.config.cjs && pm2 save
// Jika memakai AMNAN_CLIENTS_DIR selain bawaan, export variabelnya di shell yang sama saat menjalankan pm2.
const fs = require('fs');
const path = require('path');

const CODE_DIR = path.resolve(__dirname, '..');
const CLIENTS_DIR = path.resolve(process.env.AMNAN_CLIENTS_DIR || '/opt/clients');

let entries = [];
try {
  entries = fs.readdirSync(CLIENTS_DIR, { withFileTypes: true });
} catch {
  /* folder belum ada: tidak ada client */
}

const apps = entries
  .filter((e) => e.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(e.name))
  .filter((e) => fs.existsSync(path.join(CLIENTS_DIR, e.name, '.env')))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((e) => ({
    name: `amnan-${e.name}`,
    script: 'server.js',
    cwd: CODE_DIR,
    instances: 1, // JANGAN dinaikkan: satu sesi WhatsApp hanya boleh dipegang satu proses
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    kill_timeout: 15000, // waktu untuk flush data saat berhenti
    max_memory_restart: '600M', // pengaman agar satu client tidak menghabiskan RAM VPS
    env: {
      NODE_ENV: 'production',
      ENV_FILE: path.join(CLIENTS_DIR, e.name, '.env'), // PORT, DATA_DIR, password, dst. dibaca dari sini
    },
  }));

module.exports = { apps };
