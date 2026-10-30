# Amnan SaaS - Demo Live (CRM + Bot Balas Otomatis WhatsApp)

## Struktur

```
amnan-live/
├── server.js                 # HTTP server, login, static file
├── config/keywords.json      # kata kunci sumber (platform) + aturan lead
├── src/
│   ├── whatsapp.js           # koneksi WA (Baileys), QR, terima/kirim pesan
│   ├── bot.js                # mesin balasan (dipakai WA asli DAN Bot Tester)
│   ├── routes.js             # semua endpoint API
│   ├── leads.js              # deteksi sumber/keyword, pembuatan lead
│   ├── store.js              # data lead      -> data/leads.json
│   ├── conversations.js      # riwayat chat   -> data/conversations.json
│   ├── settings.js           # pengaturan bot -> data/settings.json
│   └── jsonfile.js
├── public/
│   ├── index.html, login.html
│   └── assets/
│       ├── css/style.css
│       ├── img/logo.png      # (opsional) taruh logo brand di sini
│       └── js/
│           ├── app.js        # router + status WA di header
│           ├── lib.js        # helper bersama
│           └── pages/        # pesan, percakapan, crm, tester, pengaturan, medis, profil
└── test/                     # npm test
```

## Menjalankan

```bash
npm install
cp .env.example .env      # isi DASHBOARD_PASSWORD
npm start
ngrok http 8080
```

## Alur bot

1. Chat pertama dari nomor mana pun selalu mendapat **pesan pembuka**.
2. Bot mencocokkan pesan dengan **intent** (kata kunci terbanyak yang cocok menang). Tidak cocok: **respons default**.
3. Bot menanyakan **data wajib CRM** satu per satu. Jawaban masuk ke detail lead. Pelanggan bisa membalas "lewati".
4. **Batas durasi bot**: jika habis, percakapan otomatis di-take over admin. Admin bisa **Take over** kapan saja dan **Kembalikan ke bot** dari Percakapan Masuk.
5. Lead di CRM dibuat jika pesan memuat kata kunci sumber (lihat `config/keywords.json`). Status awal: Warm Leads.

Bot Tester memakai mesin yang sama tetapi tidak mengirim ke WhatsApp dan tidak membuat lead.

## Catatan

- Baileys adalah library tidak resmi. Pakai nomor khusus tes.
- Pesan yang masuk lebih dari 10 menit lalu (misalnya saat server baru menyala) dicatat tetapi tidak dibalas bot.
- Hapus pesan/percakapan hanya menghapus dari dashboard, bukan dari WhatsApp.
- Untuk mengosongkan data demo: hentikan server, hapus `data/leads.json`, `data/conversations.json`. Jangan hapus `data/auth` (sesi WA).
