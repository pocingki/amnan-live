// Uji mesin bot, alur data wajib, durasi/take over, dan pembuatan lead dari WhatsApp (tanpa koneksi asli).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-bot-'));
process.env.BOT_NO_DELAY = '1';

const settings = await import('../src/settings.js');
const C = await import('../src/conversations.js');
const bot = await import('../src/bot.js');
const store = await import('../src/store.js');

const S = () => settings.get();
const mk = (name = 'Budi') => C.newConv('628111', '628111@s.whatsapp.net', name, 1000);

// 1. pesan pertama: pembuka + intent + pertanyaan data wajib pertama
let c = mk();
let r = bot.decide(c, 'Halo, berapa harga paket?', S(), 2000);
assert.equal(r.length, 3);
assert.match(r[0], /Budi/);
assert.match(r[0], /Asisten Virtual/);
assert.match(r[1], /informasi harga/);
assert.equal(r[2], 'Boleh kami tahu nama Anda?');

// 2. chat pertama apa pun tetap dapat pembuka (tanpa fallback)
c = mk();
r = bot.decide(c, 'Selamat siang', S());
assert.equal(r.length, 2);
assert.match(r[0], /selamat datang/);

// 3. jawaban nama -> tersimpan, lanjut pertanyaan berikutnya
r = bot.decide(c, 'Andi', S());
assert.deepEqual(r, ['Apa kebutuhan atau layanan yang Anda cari?']);
assert.equal(c.data.nama, 'Andi');
assert.equal(c.name, 'Andi');

// 4. pertanyaan ber-"?" yang cocok intent dijawab, pertanyaan data diulang
r = bot.decide(c, 'berapa harga?', S());
assert.match(r[0], /informasi harga/);
assert.equal(r[1], 'Apa kebutuhan atau layanan yang Anda cari?');
assert.equal(c.data.kebutuhan, undefined);

// 5. "lewati" -> selesai, pesan penutup
r = bot.decide(c, 'lewati', S());
assert.deepEqual(r, ['Terima kasih, data Anda sudah kami catat.']);
assert.equal(c.pending, null);

// 6. setelah data lengkap, pesan tak dikenal -> fallback saja
r = bot.decide(c, 'xyz', S());
assert.equal(r.length, 1);
assert.match(r[0], /Admin akan segera/);

// 7. take over admin: bot diam; kembalikan ke bot: aktif lagi
bot.setMode(c, 'admin');
assert.deepEqual(bot.decide(c, 'halo', S()), []);
bot.setMode(c, 'bot', 5000);
assert.equal(bot.decide(c, 'terima kasih', S(), 6000).length, 1);

// 8. batas durasi: habis -> kembali ke pesan pembuka lagi, durasi dihitung ulang, tetap mode bot
settings.update({ botDurationMinutes: 5 });
c = mk();
assert.equal(bot.remainingMs(c, S(), 1000 + 60000), 4 * 60000);
bot.decide(c, 'halo', S(), 1000 + 60000); // dalam durasi: pembuka terkirim
r = bot.decide(c, 'terima kasih', S(), 1000 + 2 * 60000); // masih dalam durasi: tanpa pembuka
assert.ok(!r.some((x) => /selamat datang/.test(x)));
r = bot.decide(c, 'halo', S(), 1000 + 6 * 60000); // durasi habis
assert.equal(c.mode, 'bot');
assert.match(r[0], /selamat datang/);
assert.equal(c.botStartedAt, 1000 + 6 * 60000);
r = bot.decide(c, 'terima kasih', S(), 1000 + 7 * 60000); // sesi baru berjalan normal
assert.ok(!r.some((x) => /selamat datang/.test(x)));
settings.update({ botDurationMinutes: 0 });

// 9. bot nonaktif -> tidak membalas
settings.update({ botEnabled: false });
assert.deepEqual(bot.decide(mk(), 'halo', S()), []);
settings.update({ botEnabled: true });

// 10. normalisasi pengaturan (impor): kata kunci string, id unik, item tanpa respons dibuang
settings.update({ intents: [
  { name: 'Lokasi', keywords: 'Alamat, lokasi|dimana', response: 'Contoh respons' },
  { name: 'Lokasi', keywords: [], response: 'Duplikat nama' },
  { name: 'Kosong', keywords: 'x', response: '' },
] });
assert.equal(S().intents.length, 2);
assert.deepEqual(S().intents[0].keywords, ['alamat', 'lokasi', 'dimana']);
assert.notEqual(S().intents[0].id, S().intents[1].id);
settings.update({ requiredFields: [{ label: 'Jumlah Orang', question: 'Berapa orang?' }] });
assert.equal(S().requiredFields[0].id, 'jumlah-orang');

// 11. alur WhatsApp asli (kirim palsu): lead + percakapan + balasan
settings.update({ intents: settings.DEFAULTS.intents, requiredFields: settings.DEFAULTS.requiredFields });
const sent = [];
const send = async (jid, text) => sent.push([jid, text]);
const jid = '628222@s.whatsapp.net';
await bot.handleIncoming({ jid, phone: '628222', name: 'Sari', text: 'Halo kak, saya lihat di Instagram, mau tanya harga', ts: Date.now() }, send);
assert.equal(sent.length, 3);
assert.ok(sent.every(([j]) => j === jid));
let lead = store.findByPhone('628222');
assert.equal(lead.platform, 'Instagram');
assert.equal(lead.status, 'Cold Leads'); // bot membalas, tapi belum percakapan intens
assert.equal(lead.dataType, 'New');
let conv = C.get('628222');
assert.deepEqual(conv.messages.map((m) => m.by), ['customer', 'bot', 'bot', 'bot']);
assert.equal(conv.unread, 1);

await bot.handleIncoming({ jid, phone: '628222', name: 'Sari', text: 'Siti Aminah', ts: Date.now() }, send);
assert.equal(store.findByPhone('628222').name, 'Siti Aminah');
assert.equal(C.dataFor('628222').nama, 'Siti Aminah');

// chat tanpa keyword platform: tetap dibalas bot (pembuka) tapi bukan lead
await bot.handleIncoming({ jid: '628333@s.whatsapp.net', phone: '628333', name: '', text: 'Selamat pagi', ts: Date.now() }, send);
assert.equal(store.findByPhone('628333'), undefined);
assert.equal(C.get('628333').messages.filter((m) => m.by === 'bot').length, 2);

// pesan basi (lama) dicatat tapi tidak dibalas
const before = sent.length;
await bot.handleIncoming({ jid: '628444@s.whatsapp.net', phone: '628444', name: '', text: 'Halo', ts: Date.now() - 3600000 }, send);
assert.equal(sent.length, before);
assert.equal(C.get('628444').messages.length, 1);

// admin mode via handleIncoming: tidak ada balasan
bot.setMode(C.get('628222'), 'admin');
await bot.handleIncoming({ jid, phone: '628222', name: 'Sari', text: 'ada promo?', ts: Date.now() }, send);
assert.equal(sent.length, before);

// 12. tester: banyak nomor, tidak menyentuh CRM asli
bot.testerReset();
const A = '6281200000001', B = '6281200000002';
const t = bot.testerSend(A, 'Halo dari TikTok, tanya harga');
assert.equal(t.replies.length, 3);
assert.equal(t.lead.platform, 'TikTok');
assert.equal(t.lead.status, 'Cold Leads');
assert.equal(t.lead.dataType, 'New');
assert.equal(bot.testerSend(A, 'Andi').lead.status, 'Cold Leads');
for (let i = 0; i < 8; i++) bot.testerSend(A, 'tanya lagi ' + i); // pesan customer ke-10: belum Warm
assert.equal(bot.testerView(A).lead.status, 'Cold Leads');
assert.equal(bot.testerSend(A, 'masih tanya').lead.status, 'Warm Leads'); // ke-11: lebih dari 10
assert.equal(bot.testerSend(A, 'ok saya mau booking').lead.status, 'Hot Leads'); // transaksi ke-1
// nomor lain terpisah
const tb = bot.testerSend(B, 'Halo, saya dari Instagram');
assert.equal(tb.lead.status, 'Cold Leads');
assert.equal(bot.testerView(A).lead.status, 'Hot Leads');
assert.equal(bot.testerView(A).leads.length, 2);
// transaksi ke-2 setelah jeda 24 jam: Existing
assert.equal(bot.testerSend(A, 'sudah transfer ya').lead.dataType, 'New'); // masih transaksi yang sama
bot.testerAdvance(A, 25);
assert.equal(bot.testerSend(A, 'halo kak').lead.dataType, 'New'); // chat biasa bukan transaksi
const t3 = bot.testerSend(A, 'mau booking lagi');
assert.equal(t3.lead.dataType, 'Existing');
assert.equal(t3.lead.status, 'Hot Leads');
assert.equal(bot.testerSend(B, 'ada promo?').lead.dataType, 'New'); // B belum pernah transaksi
// nomor yang pesan pertamanya tanpa keyword platform tidak pernah jadi lead
bot.testerSend('6281200000004', 'Selamat pagi');
assert.equal(bot.testerSend('6281200000004', 'saya dari Instagram').lead, null);
// tidak membuat lead / percakapan di CRM asli
assert.equal(store.findByPhone(A), undefined);
assert.equal(C.get(A), undefined);
assert.equal(bot.normPhone('0812-0000-0003'), '6281200000003');
assert.equal(bot.normPhone('12'), null);
bot.testerReset(A);
assert.equal(bot.testerView(A).lead, null);
assert.equal(bot.testerView(B).lead.status, 'Cold Leads');
bot.testerReset();
assert.equal(bot.testerView(B).numbers.length, 0);

// durasi habis di tester: kembali ke pesan pembuka (jam simulasi dimajukan)
settings.update({ botDurationMinutes: 5 });
bot.testerReset();
bot.testerSend(A, 'Halo dari Instagram');
bot.testerAdvance(A, 1);
const td = bot.testerSend(A, 'halo lagi');
assert.match(td.replies[0].text, /selamat datang/);
assert.equal(td.status.mode, 'bot');
settings.update({ botDurationMinutes: 0 });
bot.testerReset();

// tanpa balasan (admin mode): status tidak bergantung pada balasan
bot.testerMode(A, 'admin');
const t5 = bot.testerSend(A, 'Halo dari Instagram');
assert.equal(t5.replies.length, 0);
assert.equal(t5.lead.status, 'Cold Leads');
console.log('Uji bot lolos');