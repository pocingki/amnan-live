# Amnan Connect: kontrak integrasi v1

Amnan Live adalah **inti** (WhatsApp, percakapan, CRM). Produk lain (Booking Live, dan SaaS berikutnya) adalah **aplikasi terpisah** yang berbicara dengan Amnan hanya lewat kontrak ini. Tidak ada aplikasi yang membaca database aplikasi lain.

```
                 tautan prefill bertanda tangan (bot -> pelanggan)
  Pelanggan WA ───────────────────────────────────────────────────►  Booking Live
       ▲                                                                │   ▲
       │ pesan WA                                                       │   │ webhook bertanda tangan
       │                                                                ▼   │ (lead.created, message.received, ...)
   ┌───┴─────────────────────────────────────────────────────────────────────┴──┐
   │ Amnan Live    /api/v1/*  (API key + scope)    ◄── PUT contact / POST event / POST message
   └───────────────────────────────────────────────────────────────────────────┘
```

Aturan yang berlaku untuk semua aplikasi:

1. **Satu instance Amnan per client** (lihat `MULTI-CLIENT.md`). Aplikasi pendamping dipasangkan 1:1 dengan instance itu. Kunci dan rahasia tidak pernah dipakai lintas client.
2. **Aplikasi hanya memegang data miliknya.** Data aplikasi di Amnan disimpan di `lead.apps.<app>` dan catatan/timeline, tidak menimpa data bot (`lead.data`).
3. **Pesan WhatsApp dari aplikasi hanya untuk pesan transaksional** (konfirmasi, pengingat, perubahan jadwal), bukan promosi. WhatsApp lewat Baileys tidak resmi dan nomor bisa dibatasi; pembatasan harian di bawah melindungi nomor client.
4. **Gagal tidak boleh menggagalkan transaksi utama.** Aplikasi memakai outbox dan mencoba ulang; Amnan yang mati tidak boleh membuat booking gagal.

## 1. Autentikasi aplikasi (API key)

Format: `amk_<id>.<rahasia>` (id 8 heks, rahasia 43 karakter base64url). Dikirim sebagai `Authorization: Bearer <kunci>`.

- Hanya hash SHA-256 rahasia yang disimpan di `data/connect-keys.json`. Kunci lengkap **ditampilkan sekali** saat dibuat.
- Kunci hanya berlaku untuk `/api/v1/*`. Kunci tidak bisa membuka dashboard atau API admin.
- Setiap kunci punya `app` (mis. `booking`), `scopes`, dan batas harian pesan (`limits.messagesPerDay`, bawaan 300).
- Kunci yang dicabut (`revokedAt`) ditolak langsung. Percobaan dengan kunci salah dibatasi (5 gagal bebas, lalu kunci 30 dtk yang berlipat sampai 15 menit; 429 + `Retry-After`). Pembatas dihitung per pasangan IP + id kunci, jadi kunci lama yang masih dipakai setelah dicabut tidak mengunci aplikasi lain di server yang sama.

Scope:

| Scope | Boleh |
|---|---|
| `leads:read` | `GET /api/v1/contacts/:phone` |
| `leads:write` | `PUT /api/v1/contacts/:phone` |
| `messages:send` | `POST /api/v1/messages` |
| `events:write` | `POST /api/v1/events` |

Kesalahan memakai bentuk `{ "error": "pesan", "code": "KODE" }`. Kode umum: `UNAUTHORIZED` (401), `FORBIDDEN_SCOPE` (403), `VALIDATION` (400), `NOT_FOUND` (404), `RATE_LIMIT` (429), `BLOCKED` (403), `WA_UNAVAILABLE` (503).

## 2. Endpoint masuk (aplikasi -> Amnan)

Nomor telepon selalu dinormalisasi seperti bot: hanya digit, awalan `0` menjadi `62`, 8-15 digit.

### `GET /api/v1/ping`
Tanpa scope. `200 { ok, contract:"1", client, brand, app:{id,name,scopes}, wa:{status}, dryRun, time }`. Dipakai aplikasi untuk uji koneksi.

### `GET /api/v1/contacts/:phone` (`leads:read`)
`200 { contact: { phone, name, status, apps, createdAt, lastContactAt } }` atau `404 NOT_FOUND`. Tidak mengembalikan isi percakapan.

### `PUT /api/v1/contacts/:phone` (`leads:write`)
Buat atau perbarui lead.
```json
{ "name": "Siti", "data": { "lastBookingAt": "2026-11-05T09:00:00+07:00", "bookings": 2 }, "note": "Booking fisioterapi 5 Nov" }
```
- `name` hanya mengisi bila lead belum bernama.
- `data` (maks 20 kunci, nilai string/angka/boolean, string maks 500) digabung ke `lead.apps[<app>]`.
- `note` ditambahkan ke `lead.notes` dengan `by: "app:<nama>"`.
- Lead baru dibuat dengan aturan klasifikasi biasa dan memicu `lead.created`. `201` bila baru, `200` bila sudah ada. Lead yang diblokir -> `403 BLOCKED`.

### `POST /api/v1/events` (`events:write`)
Catat kejadian aplikasi di linimasa Amnan.
```json
{ "type": "booking.created", "phone": "081234567890", "name": "Siti", "summary": "Booking Fisioterapi, Kamis 5 Nov 09:00 (BK-7F3K2)", "data": { "code": "BK-7F3K2" } }
```
- `type` harus berbentuk `<app>.<aksi>` dan awalan `<app>` **harus sama** dengan `app` pada kunci (mencegah penyamaran).
- Bila ada percakapan untuk nomor itu: ditambahkan pesan `system` (`sender: "app:<nama>"`). Bila ada lead: catatan ditambahkan. Bila keduanya tidak ada, kejadian tetap diterima (`200 { recorded:false }`) dan hanya masuk audit.
- Dipancarkan ke event bus internal sebagai `app:event`.

### `POST /api/v1/messages` (`messages:send`)
Kirim teks WhatsApp transaksional.
```json
{ "phone": "081234567890", "text": "Booking Anda dikonfirmasi ...", "name": "Siti" }
```
- `text` 1-4000 karakter. Nomor diblokir (`/api/leads/:id/block`) -> `403 BLOCKED`.
- Melewati antrean kirim dan batas laju yang sama dengan bot (`sendRateLimitPerMinute`), ditambah batas harian per kunci -> `429 RATE_LIMIT`.
- WhatsApp belum terhubung -> `503 WA_UNAVAILABLE` (aplikasi mencoba lagi nanti).
- Pesan dicatat di percakapan sebagai `by:"bot"`, `replyKind:"app"`, `sender:"app:<nama>"`, sehingga status terkirim/dibaca ikut terlacak.
- `200 { ok:true, waId, conversation:"<phone>", dryRun:false }`.
- Mode uji: `CONNECT_DRY_RUN=1` mencatat pesan tanpa mengirim (`dryRun:true`) untuk pengembangan dan CI.

### Idempotensi
`POST /api/v1/messages` dan `POST /api/v1/events` menolak permintaan tanpa header `Idempotency-Key` (8-120 karakter). `PUT` kontak menerima kunci yang sama, tetapi tidak mewajibkannya. Permintaan ulang dengan kunci yang sama dari aplikasi yang sama dalam 24 jam mengembalikan respons semula dengan header `Idempotent-Replay: true` dan **tidak mengulang efek** (pesan tidak terkirim dua kali). Reservasi kunci ditulis ke disk sebelum efek dijalankan. Proses yang mati di tengah membalas `409 IN_PROGRESS` pada ulang kunci yang sama, bukan mengirim pesan kedua.

## 3. Webhook keluar (Amnan -> aplikasi)

Langganan dibuat admin (`node scripts/integrations.js webhook add ...` atau `POST /api/integrations/webhooks`). Tiap langganan punya `url`, `events[]`, dan `secret` (`whsec_...`, ditampilkan sekali).

Permintaan:
```
POST <url>
Content-Type: application/json
X-Amnan-Event: lead.created
X-Amnan-Delivery: 3f1c...            (uuid, tetap sama pada tiap percobaan ulang)
X-Amnan-Timestamp: 1793523600         (detik epoch)
X-Amnan-Signature: v1=<hex>           (HMAC-SHA256 dari "<timestamp>.<body mentah>" dengan secret)

{ "id":"evt_...", "type":"lead.created", "client":"klinik-a", "ts":1793523600123, "data":{ "phone":"6281234567890", "name":"Siti" } }
```

Penerima **wajib**: menghitung HMAC dari body **mentah**, membandingkan dengan `timingSafeEqual`, menolak bila `|sekarang - timestamp| > 300` detik, dan idempoten terhadap `X-Amnan-Delivery`/`id`. Balas `2xx` dalam 10 detik.

Percobaan ulang: gagal (non-2xx, timeout, galat jaringan) diulang setelah 5 detik, 30 detik, 5 menit, 30 menit, 2 jam (total 6 percobaan). Antrean disimpan di `data/connect-outbox.json` sehingga bertahan saat restart. Langganan dinonaktifkan otomatis setelah 50 kegagalan beruntun; aktifkan ulang dengan `webhook enable`. **Pengiriman bersifat at-least-once; urutan tidak dijamin.**

Tipe kejadian v1:

| Tipe | `data` |
|---|---|
| `ping` | `{ message }` (dikirim saat langganan dibuat / uji) |
| `lead.created` | `{ phone, name }` |
| `lead.hot` | `{ phone, name }` |
| `message.received` | `{ phone, by, type }` (tanpa isi pesan) |
| `conversation.attention` | `{ phone, reason }` |
| `wa.status` | `{ status, number }` (nomor tersamar) |

Webhook membawa nomor telepon lengkap (berbeda dengan notifikasi Telegram yang tersamar). Hanya daftarkan URL milik aplikasi Anda sendiri. Secara bawaan URL harus `https` ke alamat publik (anti-SSRF, dicek ulang tiap pengiriman terhadap hasil DNS). Untuk aplikasi pendamping di server yang sama, operator dapat mengizinkan alamat privat dengan `CONNECT_ALLOW_PRIVATE_URLS=1` di `.env` (tidak bisa diubah lewat API).

## 4. Tautan prefill bertanda tangan (bot -> aplikasi)

Agar pelanggan WhatsApp tidak mengetik ulang nomornya, balasan bot dapat memuat `{booking}`:

```
Silakan pilih jadwal Anda di sini: {booking}
```
Diganti menjadi `<BOOKING_URL>/?c=<token>`. `token = base64url(JSON{ "p": phone, "n": name, "exp": detikEpoch }) + "." + base64url(HMAC-SHA256(rahasia, payloadBase64))`.

- `.env` Amnan: `BOOKING_URL`, `BOOKING_LINK_SECRET`, `BOOKING_LINK_TTL_HOURS` (bawaan 12, maks 24; Booking menolak tautan > 24 jam; `BOOKING_LINK_SECRET` minimal 16 karakter). Aplikasi booking memakai rahasia yang sama (`AMNAN_LINK_SECRET`).
- Aplikasi **memverifikasi** tanda tangan dan kedaluwarsa, lalu menganggap nomor itu terverifikasi (sudah memegang percakapan WhatsApp dengan bisnis). Nomor diambil dari token, bukan dari isian formulir.
- Bila `BOOKING_URL` atau `BOOKING_LINK_SECRET` belum diisi, `{booking}` dibiarkan apa adanya (terlihat jelas di Bot Tester).

## 5. Menambah SaaS baru

1. Pilih `app` (huruf kecil, mis. `invoice`). Buat kunci: `node scripts/integrations.js key add --app invoice --name "Invoice Live" --scopes leads:read,messages:send,events:write`.
2. Tambah webhook bila perlu: `node scripts/integrations.js webhook add --url https://... --events lead.created,lead.hot`.
3. Tulis tipe kejadian sendiri dengan awalan `invoice.` pada `POST /api/v1/events`.
4. Ikuti pola Booking Live: outbox + percobaan ulang, `Idempotency-Key`, verifikasi tanda tangan webhook, dan mode mandiri bila Amnan tidak dikonfigurasi.

Perubahan yang bersifat menambah (endpoint, field respons, tipe webhook) tidak menaikkan versi. Menghapus atau mengubah arti sesuatu berarti `v2` di `/api/v2/*` dengan `v1` tetap hidup.

## 6. API admin (dashboard/CLI)

Hanya peran `admin` (cookie sesi + CSRF seperti API lain). Tidak pernah mengembalikan rahasia selain saat dibuat.

| Metode | Path | Fungsi |
|---|---|---|
| GET | `/api/integrations` | daftar kunci (tanpa rahasia), langganan webhook, 50 pengiriman terakhir |
| POST | `/api/integrations/keys` | `{name, app, scopes[], messagesPerDay?}` -> `{key, token}` (token sekali) |
| DELETE | `/api/integrations/keys/:id` | cabut kunci |
| POST | `/api/integrations/webhooks` | `{name, url, events[]}` -> `{webhook, secret}` (secret sekali) |
| PATCH | `/api/integrations/webhooks/:id` | `{active?, events?, url?}` |
| DELETE | `/api/integrations/webhooks/:id` | hapus |
| POST | `/api/integrations/webhooks/:id/test` | kirim `ping` |

UI dashboard untuk halaman ini belum dibuat; sementara gunakan `scripts/integrations.js`.

## 7. Batasan yang diketahui

- Webhook at-least-once dan tidak berurutan; aplikasi harus idempoten dan tidak bergantung urutan.
- Idempotensi 24 jam disimpan di berkas JSON; cukup untuk satu instance per client, bukan untuk ribuan permintaan per detik.
- Bila nanti memakai WhatsApp Cloud API (`MIGRASI-CLOUD-API.md`), pesan di luar jendela 24 jam butuh template; `POST /api/v1/messages` akan mengembalikan `WA_UNAVAILABLE`/galat terpisah dan aplikasi perlu mendukung template.
- Rotasi: buat kunci baru, ganti di aplikasi, cabut kunci lama. Tidak ada dua kunci aktif yang saling bergantung.
