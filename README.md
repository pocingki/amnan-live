# AMNAN LIVE — Panduan Instalasi Lengkap dari Nol (Windows) dan Migrasi ke VPS

Panduan ini ditujukan untuk client yang menerima laptop/PC dalam kondisi belum disiapkan: belum ada Node.js, Git, editor kode, dependensi proyek, konfigurasi, maupun data aplikasi.

**Tujuan akhir:**
1. Client dapat memasang dan menjalankan AMNAN LIVE sendiri di laptop/PC Windows.
2. Client dapat membuka dashboard, login, menghubungkan WhatsApp melalui QR, dan menguji bot.
3. Jika kemudian memakai VPS, instalasi yang sudah ada di laptop dipindahkan ke VPS beserta data yang diperlukan. Migrasi ini bukan clone ulang dari GitHub.

> **Cara cepat untuk client:** lihat `docs/PASANG-MANDIRI.md` (pasang Node.js dan Git, `git clone`, lalu klik `Mulai-Amnan.bat`). Warna, logo, dan favicon diatur dari dashboard.
>
> **Banyak client dalam satu server?** Lihat `docs/MULTI-CLIENT.md` (satu kode, satu proses dan satu nomor WhatsApp per client; `node scripts/client.js new <slug>`).

> **Penting tentang WhatsApp:** AMNAN LIVE menggunakan Baileys `7.0.0-rc14`, yaitu library tidak resmi dan versi release candidate. WhatsApp dapat membatasi atau memblokir nomor. Gunakan nomor khusus untuk pengujian, hindari pesan massal, dan pahami risiko operasionalnya. Alternatif integrasi resmi dibahas di `docs/MIGRASI-CLOUD-API.md`.

---

# BAGIAN 1 — Memahami yang akan dipasang

## 1.1 Komponen yang digunakan

| Komponen | Fungsi | Wajib? |
|---|---|---|
| Windows 10/11 64-bit | Sistem operasi laptop/PC | Ya, untuk langkah panduan ini |
| Browser (Chrome/Edge/Firefox) | Membuka dashboard AMNAN LIVE | Ya |
| Node.js 20 atau 22 | Menjalankan server JavaScript | Ya |
| npm | Memasang paket/library proyek; ikut terpasang bersama Node.js | Ya |
| Git for Windows | Mengambil source code dari GitHub | Ya untuk metode clone |
| PowerShell / Windows Terminal | Mengetik perintah instalasi | Ya |
| Visual Studio Code | Membuka/mengedit `.env` dan file proyek | Disarankan, bukan syarat menjalankan |
| WinSCP | Mengirim source code dan data dari Windows ke VPS melalui SFTP | Hanya saat migrasi |
| WhatsApp di ponsel | Memindai QR untuk menautkan perangkat | Ya untuk menghubungkan WhatsApp |

Aplikasi juga memakai:
- **Baileys** untuk koneksi WhatsApp.
- **SQLite** melalui `better-sqlite3` untuk penyimpanan data.
- **Tailwind CSS** untuk membangun file CSS frontend.
- **PM2** atau systemd untuk pengelolaan proses di VPS (PM2 disediakan dalam konfigurasi proyek).

Client tidak perlu mengunduh Baileys, SQLite, atau Tailwind satu per satu. Paket-paket tersebut dipasang oleh npm dari konfigurasi proyek.

## 1.2 Alur instalasi

```text
Laptop Windows baru
  │
  ├─ Pasang browser (jika belum ada)
  ├─ Pasang Node.js 22
  ├─ Pasang Git for Windows
  ├─ (Opsional) Pasang Visual Studio Code
  │
  └─ Ambil source code dari GitHub
       │
       ├─ Pasang dependency dengan npm
       ├─ Buat file .env
       ├─ Build Tailwind CSS
       ├─ Jalankan server AMNAN LIVE
       ├─ Buka dashboard di browser
       └─ Scan QR WhatsApp
```

## 1.3 Spesifikasi dan persiapan perangkat

Sebelum mulai:
- Gunakan Windows 10 atau Windows 11 64-bit.
- Pastikan laptop memiliki ruang kosong yang cukup untuk source code, dependency, database, dan media WhatsApp.
- Pastikan koneksi internet stabil.
- Siapkan nomor WhatsApp yang akan ditautkan.
- Siapkan password dashboard yang kuat.
- Pastikan akun Windows yang digunakan boleh memasang aplikasi.

AMNAN LIVE harus tetap berjalan dan laptop harus tetap menyala serta terhubung internet agar bot aktif dalam Mode A.

---

# BAGIAN 2 — Instalasi perangkat lunak di laptop dari nol

Kerjakan berurutan. Jangan lompat ke instalasi proyek sebelum Node.js dan Git berhasil diperiksa.

## 2.1 Pastikan browser tersedia

1. Buka Microsoft Edge atau Google Chrome.
2. Jika Chrome belum ada, unduh dari: https://www.google.com/chrome/
3. Jalankan installer dan selesaikan pemasangan.
4. Browser ini akan digunakan untuk membuka dashboard lokal.

## 2.2 Pasang Node.js 22

Node.js menjalankan server AMNAN LIVE. npm yang digunakan untuk memasang library proyek ikut disertakan dalam installer Node.js.

1. Buka situs resmi: https://nodejs.org/en/download
2. Pilih **Node.js 22 LTS** untuk **Windows x64**.
3. Unduh installer Windows `.msi`.
4. Buka file `.msi` yang sudah diunduh.
5. Klik **Next**.
6. Setujui lisensi, lalu klik **Next**.
7. Biarkan lokasi instalasi bawaan, lalu klik **Next**.
8. Pastikan fitur **npm package manager** tetap dipilih.
9. Jika installer menawarkan pemasangan tools tambahan untuk native modules, fitur tersebut boleh dibiarkan tidak dipilih terlebih dahulu. Lihat bagian pemecahan masalah jika `better-sqlite3` gagal dipasang.
10. Klik **Install**, setujui permintaan Windows jika muncul, lalu tunggu selesai.
11. Klik **Finish**.

**Penting:** tutup semua jendela PowerShell/Terminal yang sudah terbuka. Buka PowerShell baru agar Windows membaca PATH Node.js yang baru dipasang.

### Periksa Node.js dan npm

1. Klik Start Windows.
2. Ketik `PowerShell`.
3. Buka **Windows PowerShell**.
4. Ketik satu per satu:

```powershell
node -v
npm -v
```

Hasil yang diharapkan:
- `node -v` menampilkan versi `v22.x.x`.
- `npm -v` menampilkan nomor versi npm.

Jika muncul pesan bahwa `node` atau `npm` tidak dikenal:
1. Tutup PowerShell.
2. Buka kembali PowerShell.
3. Jika masih gagal, restart Windows.
4. Periksa ulang.
5. Jika tetap gagal, jalankan installer Node.js lagi dan pastikan fitur Node.js serta npm terpasang.

Jangan lanjut sebelum dua perintah di atas berhasil.

## 2.3 Pasang Git for Windows

Git digunakan untuk mengambil source code AMNAN LIVE dari GitHub.

1. Buka: https://git-scm.com/download/win
2. Unduh installer Git for Windows 64-bit.
3. Jalankan installer.
4. Pada sebagian besar layar, pengaturan bawaan sudah cukup. Klik **Next**.
5. Saat diminta memilih editor bawaan Git, pilih editor yang tersedia. Jika belum memasang VS Code, pilihan bawaan boleh digunakan.
6. Pada pilihan PATH, pilih opsi yang direkomendasikan installer agar Git dapat digunakan dari Command Prompt dan aplikasi lain.
7. Pada pilihan line ending, gunakan pilihan bawaan yang direkomendasikan Git for Windows.
8. Lanjutkan sampai **Install**, tunggu, lalu klik **Finish**.

### Periksa Git

Tutup PowerShell yang terbuka, lalu buka PowerShell baru. Ketik:

```powershell
git --version
```

Hasil yang diharapkan adalah nomor versi Git, misalnya `git version 2.xx.x`.

Jika `git` tidak dikenal, tutup dan buka ulang PowerShell. Jika masih gagal, restart Windows atau jalankan ulang installer Git.

## 2.4 Pasang Visual Studio Code (disarankan)

VS Code memudahkan client membuka folder proyek dan mengedit file `.env`. Aplikasi tetap dapat berjalan tanpa VS Code.

1. Buka: https://code.visualstudio.com/
2. Unduh versi Windows.
3. Jalankan installer.
4. Ikuti langkah instalasi.
5. Jika tersedia, centang opsi **Add to PATH** dan **Add "Open with Code" action**.
6. Selesaikan instalasi.

Setelah terpasang, VS Code dapat dibuka dari Start Windows.

## 2.5 (Khusus jika diperlukan) Siapkan tools kompilasi Windows

Biasanya `better-sqlite3` memasang binary siap pakai. Tools kompilasi hanya diperlukan jika npm gagal menemukan binary yang cocok dan mencoba mengompilasi modul dari source.

Jika muncul error yang secara jelas menyebut `node-gyp`, Python, Visual Studio C++ build tools, compiler, atau `MSBuild`:
1. Jangan mengunduh compiler dari situs tidak dikenal.
2. Buka dokumentasi resmi node-gyp: https://github.com/nodejs/node-gyp
3. Ikuti prasyarat Windows yang disebutkan di dokumentasi tersebut, termasuk Python dan Visual Studio Build Tools dengan komponen C++ yang diperlukan.
4. Setelah pemasangan selesai, tutup dan buka PowerShell baru.
5. Ulangi pemasangan dependency sesuai langkah Bagian 4.

Jangan memasang toolchain ini dari awal jika instalasi dependency berhasil normal.

---

# BAGIAN 3 — Mengambil source code AMNAN LIVE dari GitHub

## 3.1 Tentukan lokasi folder proyek

Contoh panduan ini menyimpan proyek di folder Downloads:

```text
C:\Users\NAMA-USER-WINDOWS\Downloads\amnan-live
```

`NAMA-USER-WINDOWS` akan otomatis berbeda pada setiap laptop.

1. Buka PowerShell.
2. Ketik:

```powershell
cd "$HOME\Downloads"
```

3. Periksa lokasi saat ini:

```powershell
pwd
```

Hasilnya harus mengarah ke folder Downloads milik user Windows.

## 3.2 Clone repository

Jalankan:

```powershell
git clone https://github.com/pocingki/amnan-live.git
```

Tunggu sampai proses selesai. Git akan membuat folder `amnan-live`.

Masuk ke folder tersebut:

```powershell
cd amnan-live
```

Pastikan lokasi benar:

```powershell
pwd
```

Pastikan file proyek terlihat:

```powershell
dir
```

Folder proyek seharusnya berisi antara lain `package.json`, `server.js`, `src`, `public`, `config`, `scripts`, `deploy`, `docs`, dan file pendukung lain.

**Jika Git meminta autentikasi atau menolak akses:** repository mungkin privat atau akun client belum diberi akses. Jangan membagikan password GitHub kepada pihak lain. Minta pemilik repository memberi akses akun client atau menyediakan arsip source code resmi.

## 3.3 Alternatif jika client tidak menggunakan Git

Jika client tidak ingin memasang Git, pemilik proyek dapat menyediakan arsip ZIP source code dari GitHub. Namun panduan utama menggunakan Git karena lebih mudah untuk mengambil versi proyek yang benar dan memperbarui source code di kemudian hari.

Jika memakai ZIP:
1. Unduh ZIP dari halaman repository GitHub.
2. Ekstrak ke folder `Downloads\amnan-live`.
3. Pastikan `package.json` berada langsung di dalam folder `amnan-live`, bukan di folder bertingkat yang tidak sesuai.
4. Lanjutkan ke Bagian 4.

---

# BAGIAN 4 — Memasang AMNAN LIVE di laptop

Semua perintah pada bagian ini harus dijalankan dari folder proyek `amnan-live`.

## 4.1 Pastikan terminal berada di folder proyek

Jika PowerShell belum berada di folder proyek:

```powershell
cd "$HOME\Downloads\amnan-live"
```

Periksa:

```powershell
dir package.json
```

Jika `package.json` ditemukan, lokasi proyek benar. Jika tidak ditemukan, periksa kembali lokasi folder.

## 4.2 Pasang semua dependency proyek

Jalankan:

```powershell
npm ci
```

Mengapa menggunakan `npm ci`?
- Proyek memiliki lockfile dan CI proyek menggunakan `npm ci`.
- npm memasang dependency sesuai versi yang dikunci.
- Perintah ini menghasilkan instalasi yang lebih konsisten daripada memasang versi dependency terbaru secara bebas.

Tunggu sampai selesai. Proses pertama dapat memerlukan waktu dan koneksi internet.

Jika muncul pesan bahwa `package-lock.json` tidak ditemukan, gunakan:

```powershell
npm install
```

Jangan menjalankan `npm audit fix --force` hanya karena ada peringatan. Perintah tersebut dapat mengubah versi paket dan menyebabkan ketidakcocokan.

### Periksa hasil pemasangan

Jalankan:

```powershell
npm list --depth=0
```

Perintah ini menampilkan dependency tingkat atas. Jika ada error dependency yang belum terpasang, selesaikan error tersebut sebelum lanjut.

## 4.3 Buat file konfigurasi `.env`

`.env` adalah file pengaturan untuk laptop client. File ini berbeda dari source code dan tidak boleh dibagikan ke publik.

Pastikan masih berada di folder `amnan-live`, lalu jalankan:

```powershell
Copy-Item .env.example .env
```

Jika perintah berhasil, file `.env` akan dibuat dari template `.env.example`.

Jika muncul error bahwa `.env.example` tidak ditemukan:
1. Jalankan `dir -Force`.
2. Pastikan file `.env.example` memang ada pada source code.
3. Jika tidak ada, jangan membuat file kosong dengan menebak semua variabel. Minta pemilik source code menyediakan template konfigurasi yang sesuai dengan versi aplikasi.

## 4.4 Buka dan isi `.env`

### Cara A — Dengan Visual Studio Code

Dari PowerShell dalam folder proyek, jalankan:

```powershell
code .
```

Jika perintah `code` tidak dikenal, buka VS Code dari Start Windows, pilih **File > Open Folder**, lalu pilih folder `amnan-live`.

Di panel Explorer VS Code:
1. Cari file `.env`.
2. Klik file tersebut.
3. Isi nilai konfigurasi yang diperlukan.
4. Simpan dengan `Ctrl+S`.

### Cara B — Dengan Notepad

Dari PowerShell:

```powershell
notepad .env
```

Jika Windows menanyakan apakah ingin membuat file baru, batalkan jika file `.env` seharusnya sudah dibuat dari `.env.example`. Pastikan file template berhasil disalin terlebih dahulu.

### Pengaturan minimum

README proyek menyatakan bahwa server membutuhkan password dashboard. Isi `DASHBOARD_USER` dan `DASHBOARD_PASSWORD` sesuai variabel yang tersedia di `.env.example`.

Contoh nilai (gunakan password milik client sendiri, jangan menyalin contoh ini sebagai password produksi):

```env
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=GANTI_DENGAN_PASSWORD_UNIK_YANG_KUAT
```

Catatan penting:
- Jangan menghapus variabel lain yang sudah ada di `.env.example`.
- Jangan menambahkan variabel yang tidak dikenali versi source code.
- Jangan menggunakan password contoh.
- `DASHBOARD_PASSWORD_HASH` juga tersedia sebagai alternatif konfigurasi password sesuai implementasi proyek. Jangan mengisi keduanya secara asal; ikuti komentar di `.env.example`.
- `ALLOW_NO_AUTH` tidak boleh diaktifkan untuk penggunaan normal.
- Untuk penggunaan lokal tanpa reverse proxy, `TRUST_PROXY` harus `0`.
- Zona waktu bawaan proyek adalah `Asia/Jakarta`.
- `PORT` bawaan proyek adalah `8080`.
- `DATA_DIR` dan `APP_DIR` harus konsisten dengan lokasi aplikasi. Untuk instalasi laptop standar, ikuti nilai bawaan di `.env.example`.

**Jangan mengirim isi `.env` ke WhatsApp, email grup, GitHub, atau pihak yang tidak berwenang.** File ini berisi rahasia akses aplikasi.

## 4.5 Build Tailwind CSS

File CSS hasil build tidak ikut disimpan di Git. Karena itu langkah build wajib dilakukan sebelum aplikasi pertama kali dijalankan.

Dari folder proyek, jalankan:

```powershell
npm run build:css
```

Tunggu sampai proses selesai tanpa error.

Hasil build seharusnya berada di:

```text
public\assets\css\tailwind.css
```

Jika file CSS belum terbentuk atau perintah gagal, jangan lanjut dulu. Periksa pesan error di terminal.

Setiap kali class Tailwind di frontend diubah, jalankan lagi `npm run build:css`.

---

# BAGIAN 5 — Menjalankan AMNAN LIVE pertama kali

## 5.1 Jalankan server

Pastikan PowerShell berada di folder proyek:

```powershell
cd "$HOME\Downloads\amnan-live"
```

Jalankan:

```powershell
npm start
```

Jika berhasil, terminal akan menampilkan informasi bahwa server berjalan. Biarkan jendela terminal tetap terbuka.

**Jangan menutup terminal, mematikan laptop, atau membuat laptop sleep** jika ingin bot terus aktif.

Untuk menghentikan aplikasi dengan benar, klik jendela terminal lalu tekan `Ctrl+C`.

## 5.2 Buka dashboard

1. Buka Chrome atau Edge.
2. Masukkan alamat berikut pada address bar:

```text
http://localhost:8080
```

3. Tekan Enter.
4. Halaman login AMNAN LIVE akan muncul.
5. Masukkan username dan password yang sudah diatur pada `.env`.
6. Klik tombol login.

Jika dashboard tidak terbuka:
- Pastikan terminal masih menjalankan `npm start`.
- Pastikan port yang digunakan sesuai nilai `PORT` di `.env`.
- Pastikan tidak ada aplikasi lain yang memakai port tersebut.
- Periksa pesan error di terminal.

## 5.3 Hubungkan WhatsApp dengan QR

1. Pastikan ponsel yang berisi nomor WhatsApp tersedia.
2. Buka WhatsApp di ponsel.
3. Buka menu **Perangkat tertaut / Linked devices**.
4. Pilih **Tautkan perangkat / Link a device**.
5. Jika diminta, verifikasi sidik jari, PIN, atau kunci layar.
6. Pada dashboard AMNAN LIVE, buka halaman **Pesan/Percakapan** sesuai menu yang tersedia.
7. Tunggu QR muncul.
8. Arahkan kamera pemindai WhatsApp ke QR pada layar laptop.
9. Tunggu sampai status koneksi di dashboard berubah menjadi terhubung.

Jika QR belum muncul, tunggu sekitar 10–30 detik dan periksa log terminal.

**Keamanan sesi:** folder `data/auth` atau lokasi auth yang ditetapkan aplikasi menyimpan sesi WhatsApp. Siapa pun yang mendapatkan folder ini dapat berpotensi mengambil alih sesi. Jangan mengirim atau mengunggah folder tersebut.

## 5.4 Tes dashboard dan bot sebelum dipakai customer

Lakukan pengujian berikut secara berurutan:

1. Login dashboard.
2. Buka daftar percakapan.
3. Buka pengaturan bot.
4. Periksa pesan pembuka, intent, respons default, dan pengaturan yang tersedia.
5. Buka **Bot Tester**.
6. Kirim beberapa pesan simulasi.
7. Pastikan respons bot sesuai aturan.
8. Periksa apakah data lead dan percakapan simulasi bekerja sesuai fungsi Bot Tester.
9. Setelah tes simulasi, gunakan nomor WhatsApp lain sebagai nomor penguji.
10. Kirim pesan uji ke nomor WhatsApp yang sudah ditautkan.
11. Periksa pesan masuk di dashboard.
12. Periksa balasan yang dikirim bot.
13. Uji balasan admin dan fitur Take over / Kembalikan ke bot jika tersedia.

Bot Tester tidak mengirim pesan ke WhatsApp dan tidak membuat lead di CRM nyata. Tes WhatsApp sungguhan tetap perlu dilakukan secara manual dengan nomor uji.

## 5.5 Periksa health endpoint

Saat server masih berjalan, buka PowerShell baru dan ketik:

```powershell
Invoke-WebRequest http://localhost:8080/healthz
```

Jika server sehat, endpoint akan memberikan respons. Jika gagal, periksa terminal utama yang menjalankan server.

---

# BAGIAN 6 — Menjalankan aplikasi setiap hari di laptop

Untuk menjalankan kembali setelah laptop restart:

1. Nyalakan laptop dan pastikan internet aktif.
2. Buka PowerShell.
3. Masuk ke folder proyek:

```powershell
cd "$HOME\Downloads\amnan-live"
```

4. Jalankan:

```powershell
npm start
```

5. Biarkan terminal terbuka.
6. Buka dashboard di browser:

```text
http://localhost:8080
```

7. Periksa status WhatsApp.

### Hal yang membuat bot berhenti

Bot di laptop tidak akan bekerja normal jika:
- Laptop dimatikan.
- Laptop masuk sleep/hibernate.
- Internet terputus.
- Jendela terminal ditutup atau proses dihentikan.
- Server mengalami error atau crash.

Jika client menginginkan bot aktif 24 jam, gunakan komputer yang selalu menyala dengan pengaturan sleep yang sesuai atau pindahkan aplikasi ke VPS.

### Menutup aplikasi

1. Kembali ke jendela PowerShell yang menjalankan `npm start`.
2. Tekan `Ctrl+C`.
3. Tunggu sampai proses berhenti.
4. Baru tutup terminal atau matikan laptop.

Jangan menghapus folder data untuk menghentikan aplikasi.

---

# BAGIAN 7 — Tes teknis tambahan (opsional, disarankan sebelum produksi)

Jalankan dari folder proyek. Tes berikut tidak menggantikan uji WhatsApp sungguhan.

```powershell
npm test
npm run lint
npm run audit
```

Keterangan:
- `npm test`: menjalankan unit test dan integration test dengan `node:test`.
- `npm run lint`: memeriksa masalah gaya/kualitas kode sesuai konfigurasi proyek.
- `npm run audit`: memeriksa kerentanan dependency sesuai skrip proyek.
- `npm run smoke`: menguji endpoint aplikasi; server harus sedang berjalan dan kredensial disediakan melalui environment `DASHBOARD_USER`/`DASHBOARD_PASSWORD`.

Untuk smoke test, buka PowerShell kedua, masuk folder proyek, lalu jalankan:

```powershell
$env:DASHBOARD_USER="admin"
$env:DASHBOARD_PASSWORD="PASSWORD_ADMIN_CLIENT"
npm run smoke
```

Ganti nilai di atas dengan kredensial yang benar. Jangan menaruh password asli ke file panduan atau mengirimkannya ke orang lain.

---

# BAGIAN 8 — Memindahkan instalasi laptop ke VPS

Mode VPS adalah kelanjutan dari Mode A. Lakukan hanya setelah aplikasi di laptop sudah terpasang dan data yang ingin dipertahankan sudah ada.

## 8.1 Pahami tiga hal yang berbeda

**1. Source code**
- Berisi file program AMNAN LIVE.
- Dipindahkan ke folder aplikasi VPS.
- Dependency akan dipasang ulang di VPS.
- Folder `node_modules` tidak perlu dikirim.

**2. Data aplikasi**
- Berisi database SQLite, sesi WhatsApp, media, dan file data lain yang digunakan aplikasi.
- Harus disalin secara terpisah dan utuh.
- Lokasinya ditentukan oleh `DATA_DIR`.

**3. Konfigurasi `.env`**
- Konfigurasi laptop dan VPS tidak sama.
- Buat `.env` baru di VPS.
- Jangan menimpa `.env` VPS dengan `.env` laptop.
- Jika menggunakan `DATA_KEY`, nilai yang sama harus dipertahankan untuk membuka data terenkripsi.

## 8.2 Catat lokasi data sebelum migrasi

1. Di laptop, buka `.env`.
2. Cari nilai `DATA_DIR`.
3. Jika nilainya `./data`, folder data ada di dalam folder proyek `amnan-live\data`.
4. Jika nilainya berupa path lain, gunakan folder yang ditunjuk oleh nilai tersebut.
5. Catat nilai `DATA_KEY` jika digunakan, simpan dengan aman.
6. Periksa isi folder data menggunakan File Explorer.

Jangan mengasumsikan nama database atau isi folder tertentu. Salin seluruh folder yang ditunjuk oleh `DATA_DIR`.

## 8.3 Hentikan aplikasi laptop

Jika berjalan menggunakan `npm start`:
1. Buka jendela PowerShell aplikasi.
2. Tekan `Ctrl+C`.
3. Pastikan server berhenti.

Jika berjalan menggunakan PM2:
- Hentikan hanya proses AMNAN LIVE berdasarkan nama proses yang benar.
- Jangan menjalankan `pm2 stop all` jika PM2 mengelola aplikasi lain.

Aplikasi harus berhenti sebelum data disalin agar database dan sesi tidak berubah saat transfer.

## 8.4 Buat backup sebelum transfer

1. Salin seluruh folder `DATA_DIR` ke lokasi backup lain.
2. Simpan backup pada disk eksternal atau lokasi aman.
3. Simpan salinan `.env` laptop untuk referensi konfigurasi, dengan perlindungan yang sesuai.
4. Simpan `DATA_KEY` terpisah jika digunakan.
5. Pastikan backup dapat dibaca dan ukuran file masuk akal.

Skrip `npm run backup` tersedia untuk backup data aplikasi:

```powershell
npm run backup
```

Lihat petunjuk skrip:

```powershell
npm run backup -- --help
```

Untuk migrasi penuh, tetap verifikasi apakah backup skrip mencakup sesi WhatsApp dan seluruh media. Jika belum dipastikan, salin juga seluruh `DATA_DIR` secara langsung ketika aplikasi sudah berhenti.

## 8.5 Siapkan akses VPS

Client harus memperoleh informasi berikut dari penyedia VPS/admin server:
- IP address VPS.
- Username SSH.
- Password SSH atau private key SSH.
- Sistem operasi VPS (langkah berikut menggunakan Ubuntu/Debian).
- Hak akses sudo atau bantuan administrator.
- Domain (jika dashboard akan memakai domain).
- Lokasi folder yang akan digunakan.

Contoh lokasi pada panduan ini:
- Source code: `/opt/apps/amnan-live`
- Data aplikasi: `/opt/data/amnan-live`

Jangan menggunakan folder atau nama proses milik aplikasi lain.

## 8.6 Pasang WinSCP di laptop Windows

WinSCP memudahkan transfer file ke VPS melalui SFTP.

1. Buka situs resmi: https://winscp.net/eng/download.php
2. Unduh installer WinSCP.
3. Jalankan installer.
4. Pilih instalasi standar.
5. Selesaikan pemasangan.
6. Buka WinSCP.

### Buat koneksi SFTP

Di jendela Login WinSCP:
1. File protocol: pilih **SFTP**.
2. Host name: masukkan IP VPS.
3. Port number: `22` (kecuali administrator memberi port lain).
4. User name: masukkan username SSH.
5. Password: masukkan password SSH jika menggunakan autentikasi password, atau pilih private key jika menggunakan SSH key.
6. Klik **Login**.
7. Saat pertama kali terhubung, verifikasi fingerprint host melalui administrator sebelum menyetujui host key.

Jangan mengirim private key SSH atau password VPS melalui grup publik.

## 8.7 Siapkan folder di VPS

Masuk ke VPS melalui SSH (WinSCP dapat membuka terminal, atau gunakan PowerShell):

```powershell
ssh USER_VPS@IP_VPS
```

Ganti `USER_VPS` dan `IP_VPS` sesuai data VPS.

Di terminal VPS Ubuntu/Debian:

```bash
sudo mkdir -p /opt/apps/amnan-live
sudo mkdir -p /opt/data/amnan-live
sudo chown -R "$USER":"$USER" /opt/apps/amnan-live /opt/data/amnan-live
```

Perintah ini menyiapkan dua folder terpisah. Jika user VPS tidak memiliki izin sudo, minta administrator menyiapkannya.

## 8.8 Transfer source code dari laptop ke VPS

### Cara yang disarankan: WinSCP

1. Di panel kiri WinSCP, buka folder proyek laptop `amnan-live`.
2. Di panel kanan, buka `/opt/apps/amnan-live`.
3. Pilih file dan folder source code proyek.
4. Transfer ke panel kanan.

Jangan ikut mengirim:
- `node_modules/`
- `.git/` (tidak diperlukan untuk menjalankan hasil transfer)
- `.env` laptop
- folder data jika data akan dikirim melalui langkah terpisah

Pastikan `package.json`, `server.js`, `public`, `src`, `config`, `scripts`, `deploy`, `docs`, `test`, dan file proyek lain yang dibutuhkan berada langsung di `/opt/apps/amnan-live`.

### Alternatif: arsip source code dari Git

Jika source code di laptop sudah berada pada commit yang benar, dari PowerShell di folder proyek jalankan:

```powershell
git archive --format=zip --output "$HOME\Downloads\amnan-live-source.zip" HEAD
```

Kirim arsip:

```powershell
scp "$HOME\Downloads\amnan-live-source.zip" USER_VPS@IP_VPS:/tmp/
```

Di VPS:

```bash
sudo apt update
sudo apt install -y unzip
cd /opt/apps/amnan-live
unzip /tmp/amnan-live-source.zip
```

Catatan: `git archive` hanya memasukkan file yang sudah di-commit. Perubahan yang belum di-commit tidak akan ikut. Tidak perlu push ke GitHub hanya untuk membuat arsip dan memindahkannya ke VPS.

## 8.9 Transfer folder data

1. Di WinSCP panel kiri, buka lokasi `DATA_DIR` laptop yang dicatat di langkah 8.2.
2. Di panel kanan, buka `/opt/data/amnan-live`.
3. Salin seluruh isi folder data.
4. Pastikan struktur folder tetap sama.
5. Pastikan database, folder auth/sesi, media, dan file lain ikut jika memang ada.
6. Tunggu transfer selesai.
7. Periksa ukuran dan keberadaan file di VPS.

**Jangan menyalin data saat server laptop masih berjalan. Jangan menggabungkan folder data dari dua instalasi yang berbeda.**

## 8.10 Pasang Node.js di VPS

Panduan ini mengasumsikan Ubuntu/Debian. Metode pemasangan Node.js dapat berubah mengikuti versi distribusi. Gunakan Node.js 20 atau 22 yang didukung proyek, dan pilih satu metode instalasi resmi/tepercaya yang konsisten dengan standar administrator VPS.

Setelah Node.js dipasang, periksa:

```bash
node -v
npm -v
```

Pastikan Node.js menunjukkan versi 20.x atau 22.x.

Jika VPS sudah menjalankan aplikasi lain, jangan mengganti versi Node.js global tanpa memeriksa dampaknya. Perubahan versi global dapat memengaruhi aplikasi lain di server.

## 8.11 Buat `.env` khusus VPS

Di VPS:

```bash
cd /opt/apps/amnan-live
cp .env.example .env
nano .env
```

Isi variabel berdasarkan `.env.example` dan konfigurasi VPS. Minimal:
- `DASHBOARD_USER`
- `DASHBOARD_PASSWORD` atau mekanisme hash yang didukung proyek
- `PORT`
- `DATA_DIR=/opt/data/amnan-live`
- `APP_DIR=/opt/apps/amnan-live`
- `DATA_KEY` yang sama seperti laptop jika digunakan
- `TRUST_PROXY=1` hanya jika benar-benar di belakang reverse proxy tepercaya
- `TZ=Asia/Jakarta`
- `ALLOW_NO_AUTH=0`

Jangan menghapus variabel lain yang ada pada template. Jangan menyalin seluruh `.env` laptop begitu saja.

Simpan file, lalu batasi izin:

```bash
chmod 600 .env
```

## 8.12 Pasang dependency dan build CSS di VPS

Dari folder aplikasi:

```bash
cd /opt/apps/amnan-live
npm ci
npm run build:css
```

Jika tidak ada `package-lock.json`, gunakan `npm install`.

Jangan jalankan `npm prune --omit=dev` sebelum build CSS. Tailwind diperlukan untuk membangun CSS; README proyek menjelaskan build harus dilakukan sebelum dev dependencies dihapus.

## 8.13 Uji server secara lokal di VPS

Jalankan:

```bash
npm start
```

Dari terminal VPS lain, periksa:

```bash
curl -i http://127.0.0.1:8080/healthz
```

Jika aplikasi sehat, hentikan proses uji dengan `Ctrl+C` sebelum menjalankannya melalui PM2.

Jika port pada `.env` bukan `8080`, sesuaikan perintah pemeriksaan.

## 8.14 Jalankan dengan PM2 di VPS

PM2 digunakan untuk menjaga proses server tetap berjalan di background.

Pasang PM2 jika belum tersedia:

```bash
sudo npm install -g pm2
```

Masuk ke folder aplikasi dan mulai proses:

```bash
cd /opt/apps/amnan-live
pm2 start deploy/ecosystem.config.cjs
pm2 status
pm2 logs --lines 50
```

Pastikan hanya ada satu instance AMNAN LIVE yang memakai folder data dan sesi WhatsApp tersebut.

Setelah proses berjalan benar:

```bash
pm2 save
```

Agar aplikasi kembali berjalan setelah VPS restart, jalankan:

```bash
pm2 startup
```

PM2 akan menampilkan perintah tambahan yang perlu dijalankan. Salin dan jalankan perintah yang ditampilkan tersebut sesuai user Linux pemilik proses. Setelah itu jalankan lagi:

```bash
pm2 save
```

Jangan menjalankan perintah startup sebagai user yang berbeda dari user yang mengelola aplikasi.

## 8.15 Domain, reverse proxy, HTTPS, dan firewall

Langkah ini bergantung pada konfigurasi server client. README proyek mendukung penggunaan reverse proxy seperti Nginx atau Caddy, tetapi tidak menentukan domain client.

Secara umum:
1. Arahkan DNS domain ke IP VPS.
2. Siapkan Nginx atau Caddy.
3. Proxy-kan domain ke `127.0.0.1:8080`.
4. Aktifkan HTTPS/TLS.
5. Atur firewall agar hanya port yang diperlukan yang terbuka.
6. Jangan membuka port dashboard langsung ke internet jika akses publik harus melewati reverse proxy.
7. Setelah proxy tepercaya benar-benar dikonfigurasi, atur `TRUST_PROXY=1`.

Jangan menyalin konfigurasi domain dari server lain tanpa memeriksa domain, port, sertifikat, dan aplikasi yang sudah berjalan. Jika VPS sudah dipakai aplikasi lain, konfigurasi reverse proxy harus dibuat tanpa mengganggu aplikasi tersebut.

## 8.16 Verifikasi setelah migrasi

Periksa satu per satu:
- [ ] Proses AMNAN LIVE online pada `pm2 status`.
- [ ] Log PM2 tidak menunjukkan error berulang.
- [ ] `/healthz` memberikan respons sehat.
- [ ] Dashboard dapat dibuka melalui alamat lokal atau domain.
- [ ] Login admin berhasil.
- [ ] Data lead dan percakapan lama terlihat.
- [ ] Pengaturan bot masih ada.
- [ ] Media lama dapat dibuka.
- [ ] Status WhatsApp terhubung.
- [ ] Bot Tester berfungsi.
- [ ] Pesan uji dapat diterima dan dibalas.
- [ ] Backup VPS berhasil dibuat.

Jika sesi WhatsApp yang disalin masih valid, QR mungkin tidak perlu dipindai ulang. Jika WhatsApp meminta tautan ulang atau sesi tidak valid, tautkan kembali melalui QR dari dashboard VPS.

**Setelah VPS dinyatakan normal, VPS menjadi server utama. Jangan menyalakan kembali AMNAN LIVE di laptop menggunakan sesi WhatsApp yang sama.** Simpan backup laptop sampai VPS stabil.

---

# BAGIAN 9 — Operasional setelah pindah ke VPS

Perintah berikut dijalankan di VPS menggunakan user yang mengelola aplikasi.

```bash
pm2 status
pm2 logs
pm2 logs --lines 100
pm2 restart NAMA_PROSES
pm2 stop NAMA_PROSES
pm2 save
```

Ganti `NAMA_PROSES` dengan nama yang terlihat di `pm2 status`.

Cek health:

```bash
curl -i http://127.0.0.1:8080/healthz
```

Jangan gunakan `pm2 stop all`, `pm2 delete all`, atau perintah massal lain pada VPS yang juga menjalankan aplikasi lain.

## 9.1 Update kode setelah migrasi

Metode yang paling mudah dipahami adalah:
1. Backup data VPS.
2. Hentikan proses AMNAN LIVE.
3. Perbaiki dan uji kode di laptop.
4. Transfer source code terbaru ke VPS.
5. Jangan timpa `.env` VPS.
6. Jangan timpa atau menghapus `/opt/data/amnan-live`.
7. Jika dependency berubah, jalankan `npm ci`.
8. Jika frontend/Tailwind berubah, jalankan `npm run build:css`.
9. Jalankan kembali proses PM2.
10. Periksa log, health endpoint, dashboard, dan WhatsApp.

GitHub dapat digunakan sebagai metode update alternatif jika VPS memang menggunakan clone repository Git. Jangan mencampur metode `git pull` dengan transfer arsip/file secara sembarangan pada folder yang sama.

---

# BAGIAN 10 — Backup dan restore

## 10.1 Backup

Dari folder proyek:

```bash
npm run backup
```

Bantuan:

```bash
npm run backup -- --help
```

Backup berisi data pelanggan. Simpan dengan aman dan batasi aksesnya.

## 10.2 Restore

Hentikan server terlebih dahulu:

```bash
npm run restore -- <arsip>
```

Ganti `<arsip>` dengan lokasi arsip backup yang benar.

Jangan melakukan restore di atas data produksi tanpa backup kondisi terakhir.

## 10.3 Hal yang harus dipertahankan

- Database SQLite.
- Seluruh folder `DATA_DIR`.
- Sesi WhatsApp/auth jika ingin mempertahankan tautan.
- Media dan file data lain.
- `DATA_KEY` yang benar jika enkripsi digunakan.
- Backup terpisah sebelum update atau migrasi.

Jangan menghapus `data/auth` kecuali memang sengaja ingin logout dan menautkan WhatsApp ulang.

---

# BAGIAN 11 — Pemecahan masalah

## 11.1 `node` atau `npm` tidak dikenal

Penyebab umum: Node.js belum terpasang benar atau PowerShell belum membaca PATH terbaru.

Solusi:
1. Tutup PowerShell.
2. Buka PowerShell baru.
3. Jalankan `node -v` dan `npm -v`.
4. Jika masih gagal, restart Windows.
5. Jika tetap gagal, jalankan installer Node.js lagi.

## 11.2 `git` tidak dikenal

1. Tutup PowerShell.
2. Buka ulang PowerShell.
3. Jalankan `git --version`.
4. Jika gagal, pasang ulang Git for Windows dan pastikan opsi PATH direkomendasikan dipilih.

## 11.3 `npm ci` gagal

1. Periksa koneksi internet.
2. Pastikan PowerShell berada di folder yang memiliki `package.json`.
3. Periksa pesan error lengkap.
4. Jika error menyebut native module/`better-sqlite3`, ikuti bagian toolchain Windows.
5. Jangan langsung menjalankan `npm audit fix --force`.

## 11.4 `better-sqlite3` gagal dibangun

Biasanya npm tidak menemukan binary siap pakai untuk kombinasi Node.js/Windows yang digunakan lalu mencoba kompilasi.

Periksa pesan error. Jika menyebut `node-gyp`, Python, MSBuild, atau C++ compiler, pasang prasyarat Windows sesuai dokumentasi resmi node-gyp. Setelah selesai, ulangi `npm ci`.

## 11.5 File `.env` tidak ditemukan

Pastikan:
- Terminal berada di folder proyek.
- File `.env.example` tersedia.
- Perintah `Copy-Item .env.example .env` berhasil.

Jangan membuat konfigurasi kosong dengan menebak semua nama variabel.

## 11.6 Server menolak start karena password

Periksa `.env`. Pastikan `DASHBOARD_PASSWORD` telah diisi atau `DASHBOARD_PASSWORD_HASH` dikonfigurasi sesuai template proyek. Jangan gunakan `ALLOW_NO_AUTH=1` untuk penggunaan normal.

## 11.7 Dashboard tidak bisa dibuka

- Pastikan `npm start` masih berjalan.
- Periksa port pada `.env`.
- Pastikan browser membuka `http://localhost:PORT`.
- Periksa apakah port sedang dipakai aplikasi lain.
- Baca error pada terminal server.

## 11.8 Halaman tampil tanpa desain/CSS

Jalankan:

```powershell
npm run build:css
```

Kemudian refresh browser dengan `Ctrl+F5`.

## 11.9 QR WhatsApp tidak muncul

- Tunggu 10–30 detik setelah server berjalan.
- Pastikan internet tersedia.
- Jika status sudah terhubung, QR memang tidak muncul.
- Pastikan hanya satu proses yang menggunakan sesi tersebut.
- Periksa log server.

## 11.10 WhatsApp logout atau terputus

Jika log menunjukkan sesi benar-benar logout, hentikan server. Hapus folder auth hanya jika memang ingin menghubungkan ulang, lalu jalankan server dan scan QR baru.

Jika hanya internet terputus, aplikasi dapat mencoba menyambung kembali.

## 11.11 Bot tidak membalas

Periksa:
- Bot aktif di Pengaturan.
- WhatsApp terhubung.
- Percakapan tidak dalam mode admin.
- Nomor tidak diblokir.
- Pesan tidak lebih tua dari `staleMinutes`.
- Respons dan intent sudah dikonfigurasi.
- Uji melalui Bot Tester.

## 11.12 Data lama tidak terlihat di VPS

Periksa:
1. Nilai `DATA_DIR` pada `.env` VPS.
2. Folder tersebut benar-benar berisi data hasil transfer.
3. User Linux pemilik proses memiliki izin membaca/menulis folder.
4. `DATA_KEY` sama dengan kunci yang digunakan untuk data lama jika enkripsi dipakai.
5. Server sudah dihentikan sebelum data dipindahkan.

Jangan membuat database kosong baru atau menghapus data lama sebelum backup dan pemeriksaan dilakukan.

## 11.13 PM2 tidak berjalan setelah reboot

1. Jalankan `pm2 status`.
2. Pastikan `pm2 startup` telah dijalankan.
3. Jalankan perintah startup tambahan yang diberikan PM2.
4. Jalankan `pm2 save`.
5. Pastikan user Linux yang menjalankan startup sama dengan user pemilik proses.

---

# BAGIAN 12 — Fitur dan cara kerja aplikasi

## 12.1 Alur balasan bot

1. Chat pertama dari nomor baru mendapat pesan pembuka.
2. Bot mencocokkan pesan dengan intent.
3. Kata kunci yang paling banyak cocok menang; jika seri, prioritas intent lebih tinggi menang.
4. `slangMap` menormalkan singkatan/bahasa sehari-hari.
5. Jika tidak ada intent yang cocok, bot menggunakan respons default dengan jeda cooldown.
6. Percakapan yang tidak dipahami ditandai perlu perhatian admin.
7. Bot dapat menanyakan data wajib CRM satu per satu.
8. Data yang dijawab disimpan di lead.
9. Setelah pengumpulan data selesai, bot mengirim pesan penutup.
10. Batas durasi bot dapat menyerahkan percakapan ke admin.
11. Admin dapat Take over atau mengembalikan percakapan ke bot.
12. Jika admin membalas dari HP dan `autoTakeoverOnPhoneReply` aktif, percakapan beralih ke mode admin.

## 12.2 Status lead

| Status | Keterangan |
|---|---|
| Cold | Status awal untuk pesan pertama yang lolos aturan lead |
| Warm | Pelanggan telah mengirim lebih dari jumlah pesan ambang |
| Hot | Terdeteksi sinyal transaksi/booking atau pelanggan Existing |

Status otomatis hanya naik, tidak turun otomatis.

`leadRule` di `config/keywords.json` menentukan pesan mana yang menjadi lead:
- `all`: setiap pesan pertama dari nomor baru.
- `platform`: hanya pesan pertama yang mengandung kata kunci platform.
- `keyword`: kata kunci platform atau kata kunci trigger.

Fitur CRM lain mencakup catatan lead, tindak lanjut, transaksi selesai, blokir nomor, sumber iklan Click-to-WhatsApp, dan riwayat perubahan status.

## 12.3 Peran pengguna

Akun pertama dibuat dari `DASHBOARD_USER` dan `DASHBOARD_PASSWORD` (atau mekanisme hash yang didukung). Akun tambahan dikelola melalui skrip:

```bash
npm run users
```

Skrip tersebut menampilkan bantuan penggunaan untuk menambah agent, mengganti password, dan menghapus akun.

---

# BAGIAN 13 — Keamanan dan privasi

1. Gunakan password dashboard yang panjang dan unik.
2. Jangan mengaktifkan `ALLOW_NO_AUTH=1` untuk penggunaan normal.
3. Jangan membagikan `.env`, password, `DATA_KEY`, database, backup, atau folder auth WhatsApp.
4. Jangan mengunggah data pelanggan ke repository GitHub.
5. Gunakan HTTPS jika dashboard diakses dari internet.
6. Gunakan `TRUST_PROXY=1` hanya jika reverse proxy tepercaya benar-benar berada di depan aplikasi.
7. Batasi izin file `.env` pada VPS, misalnya `chmod 600 .env`.
8. Backup data secara berkala dan simpan terpisah dari server.
9. Hapus akun staf yang sudah tidak berwenang.
10. Data kesehatan termasuk data pribadi spesifik menurut UU PDP No. 27/2022. Baca `docs/PRIVASI.md` tentang retensi, penghapusan data, enkripsi, dan insiden. Panduan ini bukan nasihat hukum.

---

# BAGIAN 14 — Checklist instalasi client

## A. Sebelum instalasi

- [ ] Laptop Windows 10/11 siap.
- [ ] Browser tersedia.
- [ ] Node.js 22 terpasang.
- [ ] `node -v` berhasil.
- [ ] `npm -v` berhasil.
- [ ] Git terpasang.
- [ ] `git --version` berhasil.
- [ ] Client memiliki akses repository atau arsip source resmi.

## B. Instalasi aplikasi

- [ ] Source code berada di folder `amnan-live`.
- [ ] `package.json` ditemukan.
- [ ] `npm ci` berhasil.
- [ ] `.env` dibuat dari `.env.example`.
- [ ] Password dashboard sudah diganti.
- [ ] `npm run build:css` berhasil.
- [ ] `npm start` berhasil.
- [ ] Dashboard terbuka di browser.
- [ ] Login berhasil.

## C. WhatsApp dan pengujian

- [ ] QR berhasil dipindai.
- [ ] Status WhatsApp terhubung.
- [ ] Bot Tester diuji.
- [ ] Pesan WhatsApp uji diterima.
- [ ] Balasan bot diterima.
- [ ] Take over/admin diuji.
- [ ] Data lead dan percakapan diperiksa.

## D. Jika pindah ke VPS

- [ ] Backup data laptop dibuat.
- [ ] Aplikasi laptop dihentikan.
- [ ] Lokasi `DATA_DIR` dicatat.
- [ ] Source code ditransfer.
- [ ] Data ditransfer secara terpisah.
- [ ] `.env` VPS dibuat baru.
- [ ] `DATA_KEY` dipertahankan jika digunakan.
- [ ] Node.js dan npm tersedia di VPS.
- [ ] `npm ci` dan `npm run build:css` berhasil.
- [ ] `/healthz` sehat.
- [ ] PM2 online dan startup dikonfigurasi.
- [ ] Domain/HTTPS diuji jika digunakan.
- [ ] Dashboard, data lama, WhatsApp, dan bot diuji di VPS.
- [ ] Laptop tidak menjalankan sesi WhatsApp yang sama lagi.

---

# Referensi resmi untuk mengunduh perangkat lunak

| Perangkat lunak | Situs resmi |
|---|---|
| Node.js | https://nodejs.org/en/download |
| Git for Windows | https://git-scm.com/download/win |
| Visual Studio Code | https://code.visualstudio.com/ |
| Google Chrome | https://www.google.com/chrome/ |
| WinSCP | https://winscp.net/eng/download.php |
| Dokumentasi node-gyp (jika kompilasi native diperlukan) | https://github.com/nodejs/node-gyp |

# Informasi teknis AMNAN LIVE

- Node.js ESM, minimum versi 20; proyek CI menguji Node.js 20 dan 22.
- Baileys `7.0.0-rc14`.
- SQLite melalui `better-sqlite3`.
- Frontend JavaScript dan Tailwind CSS.
- Hasil CSS berada di `public/assets/css/tailwind.css`.
- Tes memakai `node:test`.
- Endpoint pemeriksaan kesehatan: `/healthz`.
- Port bawaan: `8080`.
- Zona waktu bawaan: `Asia/Jakarta`.
- Konfigurasi PM2: `deploy/ecosystem.config.cjs`.

Dokumentasi proyek yang juga perlu dibaca:
- `docs/PRIVASI.md`
- `docs/MIGRASI-CLOUD-API.md`
- `docs/KONTRAK.md`

**Catatan batas dokumentasi:** langkah domain, HTTPS, firewall, pemasangan Node.js di VPS, dan autentikasi SSH bergantung pada provider serta kondisi VPS masing-masing. Perintah di atas memberikan alur umum untuk Ubuntu/Debian, bukan konfigurasi spesifik semua provider. Jika VPS telah menjalankan aplikasi lain, jangan mengubah Node.js global, PM2, Nginx, Caddy, firewall, atau sertifikat tanpa memeriksa dampaknya terlebih dahulu.

- Perbaikan keamanan terbaru: lihat docs/PERBAIKAN-KEAMANAN.md.
