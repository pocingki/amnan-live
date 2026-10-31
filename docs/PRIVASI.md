# Privasi dan pelindungan data pelanggan

> **Bukan nasihat hukum.** Dokumen ini ringkasan praktis dari sisi teknis. Kutipan pasal bisa keliru atau berubah; verifikasi pada teks resmi dan konsultasikan dengan penasihat hukum atau pejabat pelindungan data sebelum klinik beroperasi memakai sistem ini.

## Data apa yang disimpan

Sistem menyimpan nomor WhatsApp (dan ID `lid` WhatsApp), nama profil, isi percakapan, media yang dikirim pelanggan (foto, suara, dokumen), jawaban data wajib (mis. nama, keluhan/kebutuhan), sumber iklan, catatan internal, jadwal tindak lanjut, serta log audit tindakan staf. Sesi WhatsApp (`data/auth`) berisi kunci yang setara dengan akses penuh ke akun WhatsApp klinik.

## Mengapa ini sensitif

Klinik fisioterapi memproses informasi tentang keluhan dan kondisi tubuh. Menurut UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP), data dan informasi kesehatan termasuk **data pribadi yang bersifat spesifik**, yang menuntut perlindungan lebih ketat dibanding data umum. Percakapan dengan calon pasien sangat mungkin memuat keluhan kesehatan, sehingga seluruh percakapan sebaiknya diperlakukan sebagai data spesifik.

## Hal yang perlu dipastikan klinik (untuk dikonfirmasi ke ahli hukum)

- **Dasar pemrosesan dan persetujuan.** Pemrosesan data spesifik umumnya perlu persetujuan eksplisit yang dapat dibuktikan atau dasar hukum lain yang sah. Pertimbangkan menambahkan kalimat pemberitahuan di pesan pembuka bot (Pengaturan > Pesan Pembuka), misalnya tujuan pencatatan data dan cara meminta penghapusan.
- **Hak pemilik data.** Pelanggan dapat meminta akses, perbaikan, penghentian pemrosesan, penarikan persetujuan, dan penghapusan data. Siapkan prosedur internal dan penanggung jawab.
- **Pemberitahuan insiden.** UU PDP mewajibkan pemberitahuan tertulis atas kegagalan pelindungan data kepada pemilik data dan lembaga berwenang dalam jangka waktu tertentu (periksa angka terbaru pada teks resmi/peraturan turunannya). Siapkan rencana respons insiden (lihat bagian di bawah).
- **Penilaian dampak dan pejabat PDP.** Pemrosesan data spesifik dalam skala besar dapat mewajibkan penilaian dampak pelindungan data dan penunjukan pejabat/petugas pelindungan data. Tanyakan apakah skala klinik Anda memenuhi syarat.
- **Rekam medis.** Bila ada informasi klinis yang dipindahkan dari chat ke rekam medis, aturan rekam medis (mis. Permenkes tentang rekam medis) berlaku untuk rekam medis itu. Sistem ini adalah CRM/penjawab otomatis, **bukan** sistem rekam medis.
- **Layanan pihak ketiga.** Notifikasi (webhook, Telegram) mengirim ringkasan keluar dari server Anda. WhatsApp/Meta memproses pesan di infrastrukturnya sendiri. Catat pihak-pihak ini dalam kebijakan privasi klinik.

## Kontrol teknis yang tersedia

| Kebutuhan | Fitur |
|---|---|
| Batasi akses | Login wajib, peran `admin` dan `agent`; agent tidak bisa menghapus data, mengubah pengaturan, atau logout WhatsApp. Jejak tindakan di log audit. |
| Enkripsi saat transit | Jalankan di belakang HTTPS (reverse proxy / Cloudflare Tunnel / ngrok). Cookie sesi bertanda `Secure` saat HTTPS terdeteksi (butuh `TRUST_PROXY=1`). |
| Enkripsi tersimpan | Isi `DATA_KEY` di `.env` untuk mengenkripsi data aplikasi yang tersimpan. Enkripsi disk penuh (LUKS/BitLocker/enkripsi volume cloud) tetap disarankan untuk `data/auth` dan media. Lihat catatan batasan di bawah. |
| Retensi | Pengaturan `retentionDays`: percakapan/pesan lebih tua dari N hari dihapus otomatis. `0` = nonaktif (data disimpan tanpa batas). Tetapkan angka sesuai kebijakan klinik. |
| Hapus data pelanggan | Admin dapat menghapus percakapan/lead dari dashboard (menghapus dari sistem ini, bukan dari ponsel pelanggan atau WhatsApp). Setelah menghapus, ingat backup lama masih memuat data itu. |
| Backup | `npm run backup` membuat arsip data. Perlakukan arsip sebagai data sensitif yang sama: simpan terenkripsi, batasi akses, dan hapus sesuai retensi. |

## Praktik yang disarankan

1. Pakai nomor WhatsApp khusus klinik, bukan nomor pribadi.
2. Beri akun `agent` hanya kepada staf yang butuh; hapus akun staf yang keluar (`npm run users`).
3. Aktifkan `retentionDays` dan jadwalkan backup dengan masa simpan yang sama pendeknya.
4. Jangan menaruh `.env`, `data/`, atau backup di git atau penyimpanan publik.
5. Minta pelanggan tidak mengirim dokumen medis lewat chat bila tidak perlu; arahkan ke kanal resmi klinik.
6. Latih staf: jangan menyalin data pelanggan ke grup chat atau spreadsheet pribadi.

## Rencana respons insiden (ringkas)

1. Putuskan akses: ganti `DASHBOARD_PASSWORD`, hapus akun yang dicurigai, logout perangkat tertaut dari WhatsApp (Perangkat Tertaut di ponsel) dan hapus `data/auth`.
2. Amankan bukti: salin log server dan log audit sebelum dibersihkan.
3. Nilai cakupan: data apa dan pelanggan mana yang terdampak.
4. Hubungi penasihat hukum untuk menentukan kewajiban dan tenggat pemberitahuan.

## Batasan yang jujur

- Sistem ini memakai Baileys (WhatsApp Web tidak resmi). Pesan WhatsApp tetap terenkripsi ujung-ke-ujung sampai ke perangkat tertaut, tetapi begitu masuk ke server ini tersimpan sesuai konfigurasi di atas.
- Penghapusan dari dashboard tidak menghapus pesan dari WhatsApp pelanggan.
- Enkripsi `DATA_KEY` melindungi berkas data aplikasi bila disk dicuri; tidak melindungi dari orang yang sudah login ke dashboard atau yang bisa membaca memori/lingkungan proses. Cakupan persisnya mengikuti implementasi lapisan data; cek `README.md` dan catatan rilis.
