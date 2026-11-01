# Pemasangan mandiri di laptop client

Untuk client yang menjalankan AMNAN LIVE sendiri di laptop/PC Windows. Panduan lengkap dan pemecahan masalah ada di `README.md`; dokumen ini adalah jalur cepatnya.

## Untuk Anda (pengembang)

1. Simpan kode di repositori GitHub **private**. Beri tiap client akses baca (collaborator atau deploy key). Repo publik berarti kode terbuka untuk semua orang.
2. Satu repositori yang sama dipakai semua client. Perbedaan antar client (nama, warna, logo, favicon, password, data) **tidak ada di repositori**: semuanya tersimpan di `.env` dan folder `data/` milik masing-masing laptop, yang sudah diabaikan Git.
3. Kirim ke client: alamat repositori dan langkah di bawah. Bila Anda yang memasangkan, isi nama brand dan warna client saat skrip bertanya.

## Untuk client: tiga langkah

1. Pasang **Node.js 22 LTS** (https://nodejs.org) dan **Git for Windows** (https://git-scm.com). Cukup klik Next sampai selesai.
2. Ambil kodenya (sekali saja), di PowerShell:
   ```powershell
   git clone <alamat-repositori> amnan-live
   ```
3. Buka folder `amnan-live`, klik dua kali **`Mulai-Amnan.bat`**.
   - Pertama kali, aplikasi memasang komponennya (butuh internet, beberapa menit) lalu bertanya: nama brand, tagline, warna, nama pengguna, dan password. Kosongkan password bila ingin dibuatkan otomatis, lalu **catat** yang ditampilkan.
   - Browser terbuka ke dashboard. Login, buka **Pengaturan > Koneksi WhatsApp**, lalu scan QR dengan WhatsApp di HP (Perangkat Tertaut).

Selanjutnya cukup klik `Mulai-Amnan.bat` setiap kali ingin menjalankan. **Jendela hitamnya harus tetap terbuka dan laptop harus menyala dan online** agar bot membalas pesan.

## Identitas brand (warna, logo, favicon)

Di dashboard: **Pengaturan > Bot & brand**. Perubahan langsung tampil tanpa memulai ulang.

| Yang diubah | Cara | Ketentuan |
|---|---|---|
| Nama dan tagline | Isi kolom, klik **Simpan pengaturan** | Tampil di header, footer, dan halaman login |
| Warna utama | Pilih warna atau ketik kode, mis. `#0b5fa5`, lalu **Simpan pengaturan**. Tombol **Bawaan** mengembalikan biru standar | Satu warna cukup; sistem membuat turunan terang/gelapnya. Warna yang terlalu terang ditolak karena teks putih jadi sulit dibaca |
| Logo | **Unggah** / **Ganti** / **Hapus** | PNG, JPG, atau WebP, maks 1 MB. Latar transparan paling rapi. Tampil di header dan halaman login |
| Favicon | **Unggah** / **Ganti** / **Hapus** | PNG persegi (64x64 atau lebih) atau ICO, maks 256 KB. Tampil di tab browser |

SVG tidak diterima karena berkas SVG bisa membawa skrip. Ubah SVG menjadi PNG dulu.
Hanya peran Admin yang bisa mengubah identitas brand; Agent hanya melihat.

Nilai awal juga bisa diisi lewat `.env` (`BRAND_NAME`, `BRAND_TAGLINE`, `BRAND_COLOR`), tetapi hanya dipakai sebelum pengaturan pertama disimpan.

## Memperbarui ke versi baru

Tutup `Mulai-Amnan.bat`, klik **`Update-Amnan.bat`** (mengambil kode terbaru, memperbarui komponen, dan membangun ulang tampilan), lalu jalankan `Mulai-Amnan.bat` lagi. Data, pengaturan, logo, dan warna tidak berubah.

> Setelah memperbarui dari versi sebelum fitur warna brand: jalankan `npm run build:css` sekali (otomatis oleh `Update-Amnan.bat`). Tanpa ini, sebagian elemen (judul dan tombol bergaya Tailwind) masih biru lama.

## Cadangan dan keamanan

- Data ada di folder `data/`, kuncinya di `.env`. **Salin keduanya** secara berkala ke flashdisk atau penyimpanan lain. Tanpa `.env`, data terenkripsi tidak bisa dibuka lagi.
- Cadangan otomatis harian tersimpan di `data/backups/` (di laptop yang sama, jadi bukan pengganti salinan di luar laptop).
- Jangan membagikan `.env` dan folder `data/`.
- WhatsApp dihubungkan lewat Baileys (tidak resmi). Pakai nomor yang siap dengan risiko pembatasan; jangan kirim pesan massal.
