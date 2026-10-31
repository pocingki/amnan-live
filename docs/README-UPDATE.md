# Panduan Update: PC → GitHub → VPS

Berlaku untuk dua project:

| Project | Folder PC | Folder VPS | Domain |
|---|---|---|---|
| acesio-dashboard | `C:\Users\AMNAN\Downloads\acesio-dashboard` | `/opt/apps/acesio-dashboard` | https://demo.k2.amnan.id |
| amnan-live | `C:\Users\AMNAN\Downloads\amnan-live` | `/opt/apps/amnan-live` | https://demo.amnan.id |

Repo: https://github.com/pocingki/acesio-dashboard dan https://github.com/pocingki/amnan-live

## 1. Update GitHub (di PC, PowerShell)

```powershell
cd C:\Users\AMNAN\Downloads\NAMA_PROJECT
git status
git add .
git commit -m "deskripsi singkat perubahan"
git push
```

Cek `git status`: pastikan **tidak ada** `.env`, `data/`, atau `node_modules/` di daftar.

## 2. Update VPS (SSH)

```bash
ssh amnan-vps@103.93.162.85
/opt/apps/update.sh NAMA_PROJECT
```

Contoh: `/opt/apps/update.sh acesio-dashboard` atau `/opt/apps/update.sh amnan-live`.

Skrip otomatis: `git pull`, `npm install`, restart pm2, tampilkan log. Pastikan log tanpa error.

## 3. Cek hasil

- Hash commit sama di PC dan VPS: `git log --oneline -3`
- Buka domain dengan `Ctrl+Shift+R` agar cache browser tidak menampilkan versi lama.
- amnan-live: tunggu log `[wa] terhubung` (WhatsApp putus sebentar saat restart).

## Aturan penting

- **Edit dan commit hanya di PC.** Di VPS jangan pernah `git commit`.
- `.env` dan `data/` **tidak ikut Git**. Variabel `.env` baru harus ditambah manual di VPS:
  `nano /opt/apps/NAMA_PROJECT/.env` lalu `pm2 restart NAMA_PROJECT --update-env`
- Ubah `PORT` di `.env`? Sesuaikan juga `proxy_pass` di `/etc/nginx/sites-available/`, lalu `sudo nginx -t && sudo systemctl reload nginx`.

## Perintah berguna di VPS

```bash
pm2 status                              # status aplikasi
pm2 logs NAMA_PROJECT --lines 30        # lihat log
pm2 restart NAMA_PROJECT --update-env   # restart manual
```

## Kalau ada masalah

| Masalah | Solusi |
|---|---|
| `git pull` menolak: *local changes would be overwritten* atau riwayat bercabang | Samakan VPS dengan GitHub: `cd /opt/apps/NAMA_PROJECT && git fetch origin && git reset --hard origin/main` (`.env` dan `data/` aman) |
| Perubahan tidak terlihat di browser | `Ctrl+Shift+R` atau jendela incognito |
| `Permission denied (publickey)` di VPS | Cek deploy key di GitHub: repo → Settings → Deploy keys |
| Update bermasalah, mau kembali | Di VPS: `git log --oneline -5`, lalu `git reset --hard KODE_COMMIT_LAMA` dan `pm2 restart NAMA_PROJECT`. Perbaiki di PC lalu push lagi |
| WhatsApp minta scan QR | `pm2 logs amnan-live`, scan QR yang muncul |
