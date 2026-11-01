# Satu instance per client

Model: **satu kode bersama, satu proses per client**. Setiap client punya nomor WhatsApp, database, pengaturan, pengguna, port, dan subdomain sendiri. Data client tidak pernah bercampur karena tiap proses hanya membuka folder `data/` miliknya.

```
/opt/amnan-live/              <- kode (satu salinan, git pull sekali untuk semua client)
/opt/clients/
   klinik-a/                  <- milik client "klinik-a"
      .env                    <- PORT, DATA_DIR, DATA_KEY, hash password, merek, dst.
      keywords.json           <- aturan lead/kata kunci khusus client ini
      nginx.conf              <- server block nginx (bila dibuat dengan --domain)
      data/                   <- database, sesi WhatsApp, media, pengaturan, audit
   toko-b/
      ...
```

## Menambah client baru

```bash
cd /opt/amnan-live
node scripts/client.js new klinik-a --name "Klinik A" --tagline "Fisioterapi" --color "#0b5fa5" --domain app.klinika.com
pm2 startOrReload deploy/ecosystem.clients.config.cjs && pm2 save
```

Perintah `new` mencetak password admin satu kali (di disk hanya hash-nya), memilih port kosong mulai 8101, membuat `DATA_KEY` acak, dan menyiapkan `nginx.conf`. Lalu ikuti langkah yang dicetak: arahkan DNS, pasang nginx, jalankan `certbot --nginx -d <domain>`, buka dashboard, dan pindai QR dengan nomor WhatsApp milik client.

Opsi lain: `--color` (warna utama), `--port`, `--tz`, `--user`, `--password`, `--no-encrypt`, `--dir` (bawaan `/opt/clients`, atau env `AMNAN_CLIENTS_DIR`; export variabel yang sama saat menjalankan pm2).

Melihat semua client: `node scripts/client.js list --check` (menampilkan port, domain, merek, dan status proses/WhatsApp).

## Yang perlu diingat

- **`DATA_KEY` jangan sampai hilang.** Tanpa kunci itu, data terenkripsi tidak bisa dibuka, termasuk dari backup. Simpan salinannya terpisah dari server (pengelola password).
- **Satu nomor WhatsApp hanya untuk satu proses.** Jangan menaikkan `instances` di pm2 dan jangan memindai QR yang sama di dua instance.
- **Memperbarui kode untuk semua client:** `cd /opt/amnan-live && git pull && npm ci && npm run build:css && pm2 reload all`. Uji dulu di instance demo.
- **Backup dan perintah CLI per client** memakai `ENV_FILE`:
  `ENV_FILE=/opt/clients/klinik-a/.env npm run backup` (juga `restore`, `users`, `migrate`).
- **Merek.** `BRAND_NAME`, `BRAND_TAGLINE`, dan `BRAND_COLOR` di `.env` hanya nilai awal. Setelah pengaturan pertama disimpan, nama, tagline, warna, logo, dan favicon diubah dari dashboard (Pengaturan > Bot & brand); logo dan favicon tersimpan di `data/brand/` milik client itu.
- **Setelah `git pull` dari versi sebelum fitur warna brand,** jalankan `npm run build:css` sekali agar palet Tailwind memakai variabel warna.
- **RAM.** Tiap client adalah satu proses Node dengan sesi WhatsApp sendiri. Pantau dengan `pm2 monit` sebelum menambah client; pm2 me-restart proses yang melewati 600 MB (`max_memory_restart`).
- **Port 8101 ke atas hanya didengarkan di localhost.** Akses dari luar selalu lewat nginx dengan HTTPS (`TRUST_PROXY=1` sudah diatur).

## Instalasi yang sudah berjalan

Instalasi tunggal di `/opt/apps/amnan-live` (pm2 `amnan-live`, `.env` di folder kodenya) tetap berjalan seperti biasa dan tidak perlu diubah. Memindahkannya ke model ini cukup dengan membuat folder client, menyalin `data/` dan `.env`-nya ke sana (set `DATA_DIR` dan `PORT`), lalu mengganti proses pm2. Lakukan saat sepi pesan, dan jangan menjalankan dua proses dengan sesi WhatsApp yang sama.

## Menyiapkan integrasi

Karena tiap client punya instance sendiri, konfigurasi integrasi (alamat web client, kunci rahasia) juga hidup di instance itu saja. Tahap berikutnya (webhook keluar, API masuk, dan aksi HTTP di bot) akan mengikuti pola ini: pengaturan per client disimpan di `data/` dan rahasia di `.env`.
