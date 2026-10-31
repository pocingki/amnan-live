# Rencana migrasi ke WhatsApp Cloud API resmi

Baileys meniru klien WhatsApp Web dan **tidak resmi**: nomor bisa diblokir, protokol bisa berubah tanpa pemberitahuan, dan paket yang dipakai adalah release candidate (`7.0.0-rc14`). Untuk operasional jangka panjang, WhatsApp Business Platform (Cloud API) dari Meta adalah jalur resmi. Dokumen ini adalah rencana; **belum ada kode migrasi** dan semua angka/ketentuan harus diverifikasi pada dokumentasi dan daftar harga Meta saat ini.

## Pendekatan: adapter di `src/whatsapp.js`

Bagian lain aplikasi (bot, CRM, API) hanya boleh bergantung pada antarmuka kecil di `whatsapp.js`. Pisahkan implementasi menjadi dua adapter dengan antarmuka sama, dipilih lewat env (mis. `WA_DRIVER=baileys|cloud`).

| Fungsi/antarmuka sekarang | Baileys | Cloud API |
|---|---|---|
| `start()` | buka soket, QR / sesi di `data/auth` | tidak ada soket; daftarkan webhook `POST /webhook/wa` (HTTPS publik), verifikasi `GET` dengan `hub.verify_token` |
| `wa.status` / `wa.qr` / `wa.number` | status koneksi, QR | status = token valid + nomor terverifikasi (panggil Graph API berkala); QR tidak berlaku |
| `sendText(jid, text)` | `sock.sendMessage` | `POST /{phone-number-id}/messages` `{type:'text'}` (di dalam jendela 24 jam) atau `{type:'template'}` (di luar jendela) |
| kirim media | `sendMessage` dengan buffer | unggah ke `/media` lalu kirim `{type:'image'|'audio'|'document'}` dengan `id` |
| terima pesan (`messages.upsert`) | event Baileys | payload webhook `entry[].changes[].value.messages[]` -> dinormalisasi ke bentuk `{phone,lid,name,text,ts,kind,source,waId}` yang sama |
| status pesan (`messages.update`) | ack Baileys | webhook `statuses[]`: `sent`/`delivered`/`read`/`failed` -> `message.status` (K5) |
| unduh media masuk | `downloadMediaMessage` | `GET /{media-id}` -> URL sementara -> unduh dengan token, simpan ke `data/media` |
| `logout()` | hapus sesi | tidak ada; cabut token di Meta |
| `lid` | ada pada WA Web | tidak ada; pakai `wa_id` (nomor) |
| sumber iklan (`source`) | `contextInfo.externalAdReply` | `messages[].referral` (`ctwa_clid`, `source_url`, `source_id`, `headline`) |
| tanda baca "mengetik" / alasan stale | emulasi | tidak tersedia; hapus jeda `delayFor` untuk adapter ini |

Normalisasi pesan masuk ke satu bentuk internal adalah syarat agar `bot.js`, `leads.js`, dan K5 tidak berubah.

## Persyaratan awal

1. Akun Meta Business dan aplikasi di Meta for Developers dengan produk WhatsApp; verifikasi bisnis (dokumen klinik) bila diminta.
2. Nomor telepon yang akan dipakai. Aturan umum: nomor yang sedang dipakai di aplikasi WhatsApp biasa/Business harus didaftarkan ulang ke Cloud API (chat lama tidak ikut pindah), kecuali fitur koeksistensi bila tersedia untuk Anda; cek dokumentasi terbaru.
3. Token akses permanen (System User) disimpan di env/secret, tidak di repo.
4. Webhook HTTPS publik dengan verifikasi tanda tangan `X-Hub-Signature-256` (HMAC SHA-256 dari body mentah memakai App Secret). Endpoint ini publik, jadi ia harus dikecualikan dari login dashboard tetapi **wajib** memverifikasi tanda tangan, membatasi ukuran body, dan idempoten (`waId` sudah dilihat -> abaikan; fungsi `seenMessage`/`markSeen` sudah tersedia di K4).

## Jendela 24 jam dan template pesan

- Setelah pelanggan mengirim pesan, bisnis boleh membalas **bebas** (teks, media) selama 24 jam sejak pesan pelanggan terakhir.
- Di luar jendela, hanya **template pesan** yang sudah disetujui Meta yang boleh dikirim, dan template melalui peninjauan serta punya kategori (utility, marketing, authentication) yang mempengaruhi biaya.
- Dampak ke aplikasi:
  - Simpan `lastCustomerMessageAt` (sudah ada di K5) dan hitung sisa jendela; tampilkan penghitung di dashboard.
  - Saat jendela habis, UI hanya menawarkan template (pengingat tindak lanjut `followUpAt`, konfirmasi jadwal).
  - `handoverMessage` dan balasan admin harus melewati pemeriksaan jendela; gagal kirim ditandai `status:'failed'` dengan alasan.
- Daftar template awal yang disarankan: konfirmasi jadwal terapi, pengingat jadwal, tindak lanjut setelah sesi, balasan atas pertanyaan yang tertunda. Variabel template memakai `{{1}}`, `{{2}}`; siapkan versi Bahasa Indonesia. Hindari isi yang memuat detail kesehatan di template (lihat `docs/PRIVASI.md`).

## Biaya (verifikasi sebelum memutuskan)

- Meta menagih per pesan template menurut kategori dan negara tujuan (model per-pesan berlaku sejak pertengahan 2025; sebelumnya per-percakapan). Balasan bebas di dalam jendela layanan umumnya tidak ditagih; pesan dari iklan Click-to-WhatsApp memiliki jendela promosi tersendiri. Periksa halaman harga resmi untuk tarif Indonesia (IDR) saat ini.
- Biaya tambahan: hosting webhook publik, penyedia solusi (BSP) bila tidak langsung ke Meta.
- Bandingkan: biaya bulanan perkiraan = (jumlah template per kategori x tarif) + infrastruktur. Hitung dari data nyata: berapa pelanggan per bulan yang butuh pesan di luar 24 jam.

## Risiko dan hal yang hilang

- Tidak ada riwayat chat lama dan kontak lama bila nomor dipindah; ekspor data dari dashboard dulu.
- Template ditolak atau dibatasi; kualitas pesan (laporan spam) menurunkan batas kirim.
- Batas throughput dan tingkat pesan (messaging limits) per nomor.
- Ketergantungan pada Meta (kebijakan, harga, kebijakan data kesehatan). Baca kebijakan WhatsApp Business tentang kategori data sensitif sebelum memproses informasi kesehatan lewat platform.
- Pesan masuk non-teks dan fitur Baileys yang tidak ada di Cloud API (mis. reaksi tertentu, status "mengetik") perlu diuji ulang.
- Waktu pengerjaan: adapter + webhook + templat + UI jendela 24 jam + tes, perkirakan beberapa hari kerja ditambah masa persetujuan Meta yang tidak bisa dipastikan.

## Rencana bertahap

1. Refaktor `whatsapp.js` menjadi antarmuka + adapter Baileys (tanpa perubahan perilaku; tes lama tetap lolos).
2. Tambah adapter Cloud API di balik `WA_DRIVER=cloud`, dengan tes memakai payload webhook contoh.
3. Daftarkan nomor uji (Meta menyediakan nomor sandbox), uji kirim/terima/status dan jendela 24 jam.
4. Ajukan template; tambahkan UI template dan penghitung jendela.
5. Jalankan paralel (nomor lama tetap Baileys) beberapa minggu, lalu pindahkan nomor produksi.
6. Hapus kode Baileys bila tidak lagi dibutuhkan.

Status: **rencana, belum diuji dengan Meta**.
