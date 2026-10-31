# Amnan Live - CRM + Bot Balas Otomatis WhatsApp

Dashboard CRM dan bot balasan otomatis WhatsApp untuk klinik fisioterapi **acesio**. Node.js (ESM, >= 20), Baileys, penyimpanan SQLite, frontend JavaScript murni + Tailwind.

> Baileys adalah library **tidak resmi** dan paket yang dikunci adalah **release candidate** (`7.0.0-rc14`). Pakai nomor WhatsApp khusus, siap kemungkinan nomor dibatasi/diblokir, dan evaluasi versi stabil atau migrasi ke Cloud API resmi (`docs/MIGRASI-CLOUD-API.md`).

## Isi

- [Instalasi](#instalasi) · [Menjalankan](#menjalankan) · [Alur bot](#alur-bot) · [Status lead](#status-lead-cold--warm--hot) · [Peran dan pengguna](#peran-dan-pengguna)
- [Akses dari internet](#akses-dari-internet-trust_proxy) · [Backup](#backup-dan-restore) · [Keamanan](#keamanan) · [Privasi](#privasi) · [Batasan](#batasan-baileys) · [Pemecahan masalah](#pemecahan-masalah)
- [Docker / systemd / pm2](#deploy) · [Tes dan CI](#tes-lint-dan-ci) · [Struktur](#struktur)

## Instalasi

Butuh Node.js 20 atau 22. Perintah berikut berurutan dan dijalankan dari folder proyek:

git clone git@github.com:pocingki/amnan-live.git

```bash
npm install                 # memasang semua dependensi (termasuk Tailwind & ESLint untuk build)
npm run build:css           # membangun public/assets/css/tailwind.css (WAJIB sebelum pertama kali start)
cp .env.example .env        # lalu isi DASHBOARD_PASSWORD
npm start
```

Hasil build CSS tidak ikut git (`.gitignore`). Ulangi `npm run build:css` setiap mengubah kelas Tailwind di `public/**/*.html|js` atau `src/tailwind.input.css`. Tanpa langkah ini halaman tampil tanpa gaya.

Pemasangan produksi tanpa dev-dependencies: jalankan `npm run build:css` **dulu** (butuh Tailwind), baru `npm prune --omit=dev`. Cara termudah adalah Docker (lihat [Deploy](#deploy)), yang melakukannya otomatis.

`better-sqlite3` memakai binari siap-pakai. Bila tidak tersedia untuk platform Anda, npm akan mengompilasi dan butuh `python3`, `make`, dan `g++` (Linux) atau Build Tools (Windows).

## Menjalankan

1. Isi `.env` (semua variabel dijelaskan di `.env.example`). Minimal `DASHBOARD_PASSWORD`. Server menolak start tanpa password kecuali `ALLOW_NO_AUTH=1` (hanya uji lokal).
2. `npm start`, buka `http://localhost:8080`, login.
3. Buka halaman Pesan/Percakapan, pindai **QR** dengan WhatsApp di ponsel (Perangkat Tertaut > Tautkan perangkat). Status koneksi tampil di header.
4. Uji dulu lewat **Bot Tester** (tidak mengirim ke WhatsApp). Cek kesehatan: `GET /healthz`. Uji asap seluruh endpoint: `npm run smoke` (server harus sedang berjalan; kredensial dari env `DASHBOARD_USER`/`DASHBOARD_PASSWORD`).

Variabel lingkungan utama: `DASHBOARD_USER`, `DASHBOARD_PASSWORD`, `DASHBOARD_PASSWORD_HASH`, `PORT`, `DATA_DIR`, `APP_DIR`, `DATA_KEY`, `TRUST_PROXY`, `TZ` (bawaan Asia/Jakarta), `ALLOW_NO_AUTH`, `BOT_NO_DELAY`.

## Alur bot

1. **Chat pertama** dari nomor mana pun mendapat **pesan pembuka** (placeholder `{nama}`, `{bot}`, `{admin}`).
2. Bot mencocokkan pesan dengan **intent**. Kata kunci yang cocok terbanyak menang; bila seri, `priority` intent yang lebih tinggi menang. Pelanggan sering menulis singkatan/slang; `slangMap` di Pengaturan menormalkannya sebelum pencocokan. Tidak cocok: **respons default**, tetapi tidak lebih sering dari satu kali per `fallbackCooldownMinutes` (bawaan 30 menit) agar pelanggan tidak dibalas default berulang. Percakapan yang tidak dipahami bot ditandai **needsAttention** (perlu perhatian admin).
3. Bot menanyakan **data wajib CRM** satu per satu. Tiap data punya tipe (`text`, `name`, `phone`, `date`, `choice` dengan `options`) yang divalidasi. Jawaban disimpan ke `lead.data` (sumber kebenaran data wajib) dan tampil di detail lead. Pelanggan bisa membalas "lewati". Setelah semua terjawab bot mengirim pesan penutup dan percakapan ditandai selesai (`completedAt`).
4. **Batas durasi bot** (`botDurationMinutes`, 0 = tanpa batas): bila habis, bot mengirim **handoverMessage** ("Percakapan ini dilanjutkan oleh {admin}...") lalu percakapan **diserahkan ke admin** (mode admin, ditandai perlu perhatian). Pesan pembuka **tidak** diulang. Admin dapat **Take over** kapan saja dan **Kembalikan ke bot** dari Percakapan Masuk.
5. **Admin membalas dari HP**: bila `autoTakeoverOnPhoneReply` aktif (bawaan), balasan yang dikirim dari aplikasi WhatsApp di ponsel otomatis mengalihkan percakapan ke mode admin sehingga bot diam.
6. **Pesan lama (stale)**: pesan yang masuk lebih dari `staleMinutes` (bawaan 10 menit) lalu, misalnya saat server baru menyala, dicatat tetapi tidak dibalas bot.
7. **Pembatas kirim**: bot dan admin dibatasi `sendRateLimitPerMinute` (bawaan 20/menit) untuk mengurangi risiko dianggap spam.
8. Pesan **reaksi** dan pesan sistem tidak diproses sebagai pesan pelanggan (tidak membuat/menaikkan lead). Media (foto, suara, video, dokumen, stiker, lokasi, kontak) tersimpan dan tampil di percakapan.
9. Status pesan keluar: `sending` -> `sent` -> `delivered` -> `read`, atau `failed` (tampil di percakapan).

Pengaturan bot memakai **versi**: simpan pengaturan membawa `If-Match: <versi>`; bila orang lain menyimpan lebih dulu, simpan Anda ditolak (409) dan Anda diminta memuat ulang. Riwayat versi tersedia dan bisa dikembalikan (restore).

**Bot Tester** memakai mesin yang sama dengan WhatsApp asli (balasan, data wajib, status lead), tetapi tidak mengirim ke WhatsApp dan tidak membuat lead di CRM nyata. Tersedia simulasi kirim gagal, pesan basi, "admin balas dari HP", dan memajukan jam.

## Status lead: Cold / Warm / Hot

Dihitung otomatis dari isi chat oleh mesin yang sama (WhatsApp asli dan Bot Tester). Status hanya **naik**, tidak turun otomatis.

| Status | Syarat |
|---|---|
| **Cold** (status awal, bukan Warm) | Pesan pertama dari nomor baru yang lolos `leadRule` |
| **Warm** | Pesan pelanggan lebih dari `warmAfterMessages` (bawaan 10) |
| **Hot** | Ada sinyal transaksi/booking (`hotKeywords`: transfer, booking, dp, lunas, dst.), atau pelanggan sudah **Existing** |

Catatan sinyal Hot: kata negasi tepat sebelum kata kunci ("belum transfer", "tidak jadi booking") membatalkan sinyal; kata tunggal >= 5 huruf menerima imbuhan ("pembayarannya", "ditransfer").

**Data Leads**: `New` untuk pesan pertama; menjadi `Existing` bila pelanggan melakukan transaksi untuk kedua kalinya (sinyal transaksi baru dihitung transaksi baru bila berjarak >= `transactionGapHours`, bawaan 24 jam, dari sinyal sebelumnya). Permanen. Nilai yang diubah manual tidak ditimpa sistem sampai dikembalikan ke otomatis.

**leadRule** (di `config/keywords.json`) menentukan chat mana yang menjadi lead:

| Nilai | Arti |
|---|---|
| `all` (bawaan) | setiap pesan pertama dari nomor baru menjadi lead |
| `platform` | hanya bila pesan pertama memuat kata kunci platform (Instagram, FB, TikTok, ...) |
| `keyword` | kata kunci platform **atau** kata kunci trigger (harga, order, ...) |

Nomor yang tidak menjadi lead pada pesan pertamanya tidak menjadi lead di pesan berikutnya (kecuali admin membuatnya manual dari percakapan: "Jadikan lead").

Fitur CRM lain: **catatan** per lead, **tindak lanjut** (`followUpAt` + catatan, ditandai terlambat), tandai **transaksi selesai**, **blokir/buka blokir** nomor (pesan dari nomor terblokir tidak dibalas bot dan tidak membuat lead), sumber iklan Click-to-WhatsApp (`source`), dan riwayat perubahan status.

## Peran dan pengguna

| | admin | agent |
|---|---|---|
| Lihat percakapan & lead, balas, take over, catatan, tindak lanjut | ya | ya |
| Ubah pengaturan bot | ya | tidak |
| Hapus lead / percakapan / data pelanggan | ya | tidak |
| Logout WhatsApp | ya | tidak |
| Kelola pengguna, lihat log audit | ya | tidak |

Akun pertama dibuat dari `DASHBOARD_USER` + `DASHBOARD_PASSWORD` (atau `DASHBOARD_PASSWORD_HASH`) dan berperan admin. Akun tambahan dikelola dengan skrip:

```bash
npm run users          # tanpa argumen: tampilkan bantuan dan perintah yang tersedia
```

Pakai skrip ini untuk menambah agent, mengganti password, dan menghapus akun. Setelah staf keluar, hapus akunnya segera.

## Akses dari internet (TRUST_PROXY)

Dashboard berisi nomor WhatsApp pelanggan dan QR login: **jangan** buka tanpa password dan sebaiknya hanya lewat HTTPS.

- Jalankan di belakang reverse proxy atau tunnel: `ngrok http 8080`, Cloudflare Tunnel, nginx, Caddy.
- Isi `TRUST_PROXY=1` **hanya** bila memang ada proxy tepercaya di depan. Efeknya: IP klien dibaca dari `X-Forwarded-For` (untuk pembatasan percobaan login dan log audit), dan cookie sesi diberi `Secure` bila `X-Forwarded-Proto: https`.
- Biarkan `TRUST_PROXY=0` bila server dibuka langsung; kalau tidak, penyerang bisa memalsukan header dan menghindari pembatasan login.
- Uji: setelah tunnel hidup, login lewat URL HTTPS dan pastikan cookie `session` bertanda Secure di devtools.

## Backup dan restore

```bash
npm run backup                 # membuat arsip data (bantuan: npm run backup -- --help)
npm run restore -- <arsip>     # memulihkan; HENTIKAN server dulu
```

Backup memuat percakapan dan data pelanggan: simpan terenkripsi dan terpisah dari server. Jika memakai `DATA_KEY`, simpan salinan kunci **terpisah** dari backup (tanpa kunci, backup terenkripsi tidak bisa dibuka). Uji restore secara berkala di mesin lain. Data lama berformat JSON tetap terbaca; migrasi ke SQLite berjalan otomatis atau lewat `node scripts/migrate.js` (lihat bantuan skrip).

Jangan menghapus `data/auth` (sesi WhatsApp) kecuali sengaja ingin login ulang dengan QR.

## Keamanan

- Login wajib (cookie sesi `HttpOnly`, `SameSite`), CSRF token untuk semua POST/PUT/PATCH/DELETE yang memakai cookie, Basic Auth untuk skrip (tanpa CSRF).
- Pembatasan percobaan login/Basic Auth: terlalu banyak percobaan salah -> HTTP 429.
- Header keamanan dan **CSP**: skrip hanya dari `'self'` (tanpa inline script), tanpa CDN, `frame-ancestors 'none'`.
- Batas ukuran body: terlalu besar -> 413, JSON rusak -> 400.
- Log audit untuk tindakan penting (admin: `/api/audit`).
- Peran admin/agent membatasi tindakan berbahaya.
- Gunakan password panjang unik dan HTTPS. Ganti password bila ada kecurigaan; hapus `data/auth` dan putuskan perangkat tertaut di ponsel bila server dicurigai bocor.
- Jalankan `npm run audit` berkala untuk memeriksa kerentanan dependensi produksi.

## Privasi

Data kesehatan termasuk data pribadi spesifik menurut UU PDP No. 27/2022. Baca `docs/PRIVASI.md` (retensi `retentionDays`, penghapusan data, enkripsi, insiden). **Bukan nasihat hukum; konsultasikan dengan ahli hukum.**

## Batasan Baileys

- Tidak resmi; WhatsApp dapat membatasi atau memblokir nomor. Hindari pesan massal dan balasan terlalu cepat/banyak.
- Hanya satu proses yang boleh memegang satu sesi WhatsApp (jangan jalankan dua instance dengan `data/auth` yang sama).
- Menghapus pesan/percakapan di dashboard tidak menghapusnya dari WhatsApp.
- Pesan yang dikirim dari ponsel saat server mati tidak terbaca sistem; pesan pelanggan yang masuk saat server mati bisa terlewat atau datang terlambat (lihat stale).
- Versi saat ini `7.0.0-rc14` dikunci tepat di `package.json`. Pembaruan dilakukan manual setelah diuji.
- Alternatif resmi: `docs/MIGRASI-CLOUD-API.md`.

## Pemecahan masalah

**WhatsApp putus / status "terputus".** Lihat log server. Jika log menyebut sesi keluar (logged out), hapus folder `data/auth` (server dihentikan dulu) lalu mulai ulang dan pindai QR lagi. Jika hanya putus koneksi internet, server mencoba menyambung ulang sendiri. Notifikasi putus dapat diaktifkan di Pengaturan (`notify.onDisconnected`).

**QR tidak muncul.** Tunggu 10-30 detik setelah start. Pastikan server punya akses internet keluar dan jam sistem akurat. Jika status sudah "terhubung" QR memang tidak tampil. Bila macet: hentikan server, hapus `data/auth`, start lagi. Pastikan Anda tidak membuka dua instance. Setelah beberapa kali QR kedaluwarsa, tunggu beberapa menit dan coba lagi.

**Halaman tanpa gaya / tampilan rusak.** Jalankan `npm run build:css`, lalu muat ulang (Ctrl+F5).

**Server menolak start: DASHBOARD_PASSWORD belum diisi.** `cp .env.example .env`, isi password, mulai ulang.

**Lupa password.** Atur ulang lewat server: `npm run users` (ganti password akun), atau ubah `DASHBOARD_PASSWORD` di `.env` untuk admin pertama dan restart. Akses ke server Anda sendiri sudah cukup; tidak ada reset lewat email.

**Terkena 429 saat login.** Terlalu banyak percobaan salah dari IP yang sama; tunggu beberapa menit (lihat header `Retry-After`).

**Data rusak / server gagal membaca data.** Hentikan server, salin folder `data/` sebagai bukti, lalu `npm run restore -- <arsip backup terakhir>`. Jangan hapus `data/auth` untuk memperbaiki masalah data. Jika belum punya backup, hubungi pengembang dengan salinan folder `data/`.

**Bot tidak membalas.** Cek: bot aktif di Pengaturan, percakapan tidak sedang mode admin, pesan tidak lebih tua dari `staleMinutes`, nomor tidak diblokir, status WhatsApp terhubung. Coba nomor yang sama di Bot Tester.

**Jam/zona waktu salah.** Setel `TZ=Asia/Jakarta` (bawaan) di `.env` atau lingkungan kontainer.

## Deploy

**Docker (disarankan):**

```bash
cp .env.example .env     # isi DASHBOARD_PASSWORD, TRUST_PROXY=1 bila di belakang proxy
docker compose up -d --build
docker compose logs -f
```

Data tersimpan di volume `amnan-data` (`/data`). Port hanya dibuka ke `127.0.0.1`; pasang reverse proxy/tunnel untuk akses publik. Healthcheck memakai `/healthz`.

**systemd:** `deploy/amnan.service` (petunjuk pemasangan di dalamnya). **pm2:** `pm2 start deploy/ecosystem.config.cjs`. Keduanya menjalankan **satu** instance saja.

## Tes, lint, dan CI

```bash
npm test          # node --test: tes unit + tes integrasi (menjalankan server asli di port acak)
npm run lint
npm run smoke     # server harus berjalan
npm run audit
```

CI (`.github/workflows/ci.yml`): `npm ci`, lint, build CSS, tes, `npm audit --omit=dev` (menggagalkan build pada tingkat high ke atas) pada Node 20 dan 22. Tes integrasi tidak menyambung ke WhatsApp sungguhan; perilaku dengan WhatsApp asli (QR, kirim/terima, media) harus diuji manual dengan nomor khusus tes.

Kontrak antar-modul: `docs/KONTRAK.md`.

## Struktur

```
server.js              # HTTP server, sesi, header keamanan, dispatcher
config/keywords.json   # kata kunci platform, trigger, hotKeywords, leadRule
src/
  whatsapp.js          # koneksi Baileys (QR, terima/kirim)
  bot.js               # mesin balasan (WA asli dan Bot Tester)
  leads.js             # klasifikasi lead (Cold/Warm/Hot, New/Existing)
  store.js / conversations.js / db.js / jsonfile.js   # penyimpanan
  routes.js            # dispatcher modul src/api/*
  api/                 # endpoint per modul (bot, crm, auth, events, data, _legacy)
scripts/               # users, backup, restore, migrate, smoke
public/                # frontend (assets/css/tailwind.css hasil build)
deploy/                # systemd, pm2
docs/                  # PRIVASI, MIGRASI-CLOUD-API, KONTRAK
test/                  # unit + integrasi (node:test)
```
