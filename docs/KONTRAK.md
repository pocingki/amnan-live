# Kontrak antar-modul (K1-K9)

Dokumen ini adalah salinan kontrak yang dipatuhi keenam modul (Bot, CRM, Keamanan, Data, Frontend, Infra). Bila kode dan kontrak berbeda, perbaiki salah satunya dan perbarui dokumen ini.

**K1 Modul API.** Setiap `src/api/*.js` mengekspor `async function handle(req,res,url,ctx)` -> `true` bila sudah menangani. `src/routes.js` adalah dispatcher: memuat modul di `src/api/` berurutan alfabet, `_legacy.js` terakhir. `ctx = { sendJSON(res,code,body), readBody(req), user:{name,role}, ip, audit(action,detail), requireRole(role) -> bool (sudah mengirim 403 bila false) }`. Peran: `admin` (semua) dan `agent` (DILARANG: ubah pengaturan, hapus lead/percakapan, logout WA, hapus data pelanggan, kelola pengguna). Prefix milik: Bot `/api/settings*`, `/api/conversations*`, `/api/media*`, `/api/tester*`, `/api/wa*`; CRM `/api/leads*`; Keamanan `/api/me`, `/api/users*`, `/api/audit`; Data `/api/events`, `/api/data*`.

**K2 Auth/CSRF.** Cookie sesi HttpOnly + cookie `csrf` (non-HttpOnly) dibuat saat login. Semua POST/PUT/PATCH/DELETE yang memakai cookie WAJIB header `X-CSRF-Token` = nilai cookie `csrf`, jika tidak 403 `{error:'CSRF'}`. Basic Auth tidak butuh CSRF. `GET /api/me` -> `{user:'nama', role, csrfToken}`. `POST /logout` juga memakai CSRF.

**K3 CSP.** `script-src 'self'` (TANPA inline `<script>` dan tanpa atribut onclick/onload), `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`, `media-src 'self' blob:`, `connect-src 'self'`, `frame-ancestors 'none'`. Tidak ada CDN; semua aset lokal. CSS: `/assets/css/tailwind.css` (dibangun dengan `npm run build:css`).

**K4 API penyimpanan.** Tanda tangan tidak boleh berubah, boleh ditambah. `jsonfile {load(name,fallback), save(name,data)}`. `store {STATUSES, DATA_TYPES, all, findByPhone, findByLid(lid), updateByPhone, add, remove, update, flush}`. `conversations {newConv, addMessage, get, getOrCreate, remove, removeMessages, dataFor, totalUnread, list, save, flush, seenMessage(waId)->bool, markSeen(waId)}`. Objek lead dan conv BEBAS-FIELD: properti tambahan apa pun harus tersimpan dan dimuat kembali (tanpa whitelist). Objek dari `get()`/`all()` boleh dimutasi lalu `save()` dipanggil; `save()` boleh ditunda <= 200 ms; `flush()` sinkron untuk shutdown. `src/db.js` mengekspor `closeAll()`.

**K5 Skema field baru.**
- Lead: `data{idField:jawaban}` (sumber kebenaran data wajib; ditulis Bot, dibaca CRM dengan fallback `conversations.dataFor`), `lid`, `source{platform,adId,ctwaClid,sourceUrl,referralCode}`, `statusHistory[{status,ts,reason}]`, `notes[{id,by,text,ts}]`, `followUpAt`, `followUpNote`, `transactionCycles[]`, `blocked`, `lastCustomerMessageAt` (ditulis CRM), `lastReplyAt` (ditulis Bot tiap bot/admin membalas).
- Conversation: `lid`, `needsAttention(bool)`, `attentionReason`, `attentionAt`, `completedAt`, `lastFallbackAt`; `messages[]`: `{id, by:'customer'|'bot'|'admin'|'system', text, ts, type:'text'|'image'|'audio'|'video'|'sticker'|'document'|'location'|'contact', mediaId, caption, status:'sending'|'sent'|'delivered'|'read'|'failed', waId, sender}`.
- Settings: `handoverMessage` (dipakai), `staleMinutes` (10), `autoTakeoverOnPhoneReply` (true), `adminAutoReturnMinutes` (0 = mati; >0: mode admin kembali ke bot saat pelanggan chat dan admin tidak aktif lebih lama dari ini; disimpan di `conv.adminLastAt`), `fallbackCooldownMinutes` (30), `sendRateLimitPerMinute` (20), `retentionDays` (0 = mati), `notify{webhookUrl,telegramBotToken,telegramChatId,onHot,onDisconnected,attentionMinutes}`, `slangMap{}`, `version` (int), `updatedAt`, `updatedBy`; `intents[].priority`; `requiredFields[].type` (`text`|`name`|`phone`|`date`|`choice`) + `options[]`.
- Serah-terima bot -> CRM: Bot memanggil `ingest({phone,lid,name,text,ts,customerCount,kind,source})`; CRM membuat `classify(prev,{...sama})`. Pesan `reaction` dan sistem tidak pernah di-ingest.

**K6 Event.** `src/events.js`: `emit(type,payload)`, `on(type,fn)`; SSE `GET /api/events`. Tipe: `wa:status{status,number}`, `message:new{phone,by,type}`, `conversation:attention{phone,reason}`, `lead:new{phone}`, `lead:hot{phone,name}`, `unread{total}`. Modul lain memakai `import { emit } from './events.js'`.

**K7 API percakapan/tester/pengaturan.**
- `GET /api/conversations` (list + needsAttention, awaitingReply, unread) | `GET /api/conversations/:phone` (TIDAK lagi mereset unread) | `POST /:phone/read` | `POST /:phone/mode` | `POST /:phone/send` (label pengirim = `ctx.user.name`; balikan message dengan status) | `POST /:phone/delete-messages` | `DELETE /:phone` | `GET /api/media/:id` (terautentikasi).
- `GET /api/settings` (+version) | `PUT /api/settings` (header `If-Match: version`; konflik -> 409 `{error,current}`) | `GET /api/settings/history` | `POST /api/settings/restore {version}`.
- `POST /api/tester/send {phone,text,kind?,simulate?:{sendFail?,stale?}}` | `POST /api/tester/phone-reply {phone,text}` (simulasi admin membalas dari HP) | tester lain tetap.
- CRM: `GET /api/leads` (ETag) | `PATCH/DELETE /api/leads/:id` | `POST /api/leads/from-conversation {phone}` | `POST /api/leads/:id/notes` | `PUT /api/leads/:id/followup` | `POST /api/leads/:id/transaction-done` | `POST /api/leads/:id/block`, `/unblock`.

**K8 Palet Tailwind "brand"** (di `tailwind.config.js`): 50 `#eef7fe`, 100 `#d9eefc`, 200 `#b5defa`, 300 `#75c5f5`, 400 `#3f9fe6`, 500 `#1d6fcf`, 600 `#0f50b0`, 700 `#0b3f98`, 800 `#083284`, 900 `#062567`.

**K9 Umum.** Tes memakai `node:test`; dilarang menambah dependensi selain `better-sqlite3` (hanya lapisan Data) dan `tailwindcss` + `eslint` (dev, hanya Infra); zona waktu default Asia/Jakarta (env `TZ`).
