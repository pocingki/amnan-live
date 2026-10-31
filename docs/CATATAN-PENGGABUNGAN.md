# Catatan penggabungan hasil revisi

Hasil audit (A1-A6) digabung ke struktur `amnan-live-main`.

## Penempatan file
- Folder per agen dipetakan ke struktur proyek (`src/`, `src/api/`, `test/`, `public/`, `scripts/`, `config/`, `docs/`, `deploy/`).
- Duplikat `mnt/user-data/outputs/...` memakai versi yang tepat: `src/api/media.js`, `src/api/settings.js`, dan `public/assets/js/pages/crm.js`.
- `a6/server.js` ternyata helper tes, jadi ditempatkan di `test/helpers/server.js`. `server.js` utama berasal dari A3.
- `a6/smoke.js` -> `scripts/smoke.js`; `a6/ci.yml` -> `.github/workflows/ci.yml`; `tailwind.input.css` -> `src/tailwind.input.css`.
- `amnan.service` dan `ecosystem.config.cjs` -> `deploy/` (sesuai README).
- `README-UPDATE.md` (A2-F1) -> `docs/README-UPDATE.md`.
- Dihapus (daftar A5 `HAPUS.txt`): `pages/medis.js`, `pages/profil.js`.

## Penyesuaian saat penggabungan
1. `test/leads.test.js`: pemeriksaan `data/leads.json` diganti kueri SQLite (catatan A4).
2. `public/index.html`: tautan CSS dibuat absolut (`/assets/css/...`) sesuai kontrak K3.
3. `src/api/crm.js`: `transaction-done` kini menolak (400) bila tidak ada siklus terbuka; "menunggu balasan" tidak lagi memakai nilai `lastCustomerMessageAt` hasil isian otomatis lead lama.
4. `test/integration-alur.test.js`: kasus "Hot tidak turun" memakai "sudah transfer" karena "booking" kini sinyal lemah (catatan A2-F1).

## Wajib setelah ini
- Jalankan `npm install` lalu commit `package-lock.json` (lockfile lama belum memuat better-sqlite3, tailwindcss, eslint). Pastikan `@whiskeysockets/baileys` tetap `7.0.0-rc14`.
- `npm run build:css` sebelum `npm start`.
- Belum terverifikasi di sini: `npm run lint`, build Tailwind, Docker, dan koneksi WhatsApp sungguhan (tidak ada akses registry npm).
