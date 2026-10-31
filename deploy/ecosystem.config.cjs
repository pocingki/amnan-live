// Konfigurasi pm2. Jalankan:  pm2 start deploy/ecosystem.config.cjs && pm2 save
// Variabel lain (password, TRUST_PROXY, dst.) dibaca dari .env di folder kerja.
module.exports = {
  apps: [
    {
      name: 'amnan-live',
      script: 'server.js',
      cwd: __dirname + '/..',
      instances: 1, // JANGAN dinaikkan: satu sesi WhatsApp hanya boleh dipegang satu proses
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 15000, // waktu untuk flush data saat berhenti
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Jakarta',
      },
    },
  ],
};
