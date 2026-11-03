# Perbaikan keamanan (hasil audit)

- **Password**: minimal tetap 8 karakter, tetapi sandi umum (`123456789`, `password`, `amnan123`, ...), deret papan ketik/angka berurutan, pengulangan, dan sandi = nama pengguna ditolak. Berlaku juga untuk `DASHBOARD_PASSWORD` di `.env` (server tidak mau membuat admin awal dengan sandi lemah).
- **Login**: kunci per IP+username (ketat, 5 gagal), per IP (20 gagal), per username (100 gagal, kunci maks 60 detik) sehingga orang lain tidak bisa mengunci admin lama-lama. Atur dengan `LOGIN_MAX_FAILS`, `LOGIN_IP_MAX_FAILS`, `LOGIN_USER_MAX_FAILS`. Di belakang proxy/tunnel set `TRUST_PROXY=1`.
- **Pesan sensitif**: `POST /api/v1/messages` menerima `"sensitive": true` (dipakai Booking untuk OTP): pesan dikirim tetapi tidak disimpan di percakapan dan tidak membuat percakapan baru.
- **Hak hapus lewat API**: scope baru `leads:delete` + `DELETE /api/v1/contacts/{phone}` (lead, percakapan, pesan, media). Beri scope ini ke kunci Booking agar penghapusan di Booking ikut menghapus di Amnan.
- **Audit**: field `phone` selalu dimasker (`6281****890`).
- **SSRF**: webhook keluar dan notifikasi (`notify.webhookUrl`, Telegram) mengunci IP hasil DNS dan tidak mengikuti redirect.
- **Enkripsi**: bila `DATA_KEY` diisi, berkas JSON (pengguna, sesi, pengaturan + token Telegram, kunci & rahasia webhook, antrean) ikut terenkripsi, termasuk `.bak`. Berkas lama yang masih polos dimigrasi saat disimpan berikutnya. Kunci hilang/salah = galat jelas, bukan dianggap rusak.
- **Tautan prefill**: bawaan 12 jam (maks 24).
- `GET /api/v1/contacts/{phone}` hanya menampilkan data `apps` milik aplikasi pemanggil.

## Menu Integrasi (sambungan tanpa .env)
Menu **Integrasi** (khusus admin) membuat sambungan ke Booking Live dengan satu kode: API key (semua scope yang dibutuhkan), webhook ke Booking, dan rahasia tautan dibuat sekaligus, lalu dikemas jadi satu kode `AMN1....` yang ditempel di menu **WhatsApp** pada Booking Live. Alamat Booking dan rahasia tautan disimpan di `data/connect-booking.json` (terenkripsi bila `DATA_KEY` aktif) dan menang atas `BOOKING_URL` / `BOOKING_LINK_SECRET` di `.env`. Membuat ulang kode mencabut key dan webhook lama; "Putuskan" mencabut semuanya.
