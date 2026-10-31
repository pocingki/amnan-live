// Uji logika deteksi dan pembuatan lead (tanpa WhatsApp).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-test-'));

// tes aturan "platform": salin keywords.json dengan leadRule platform (bawaan produksi: all)
const kw = JSON.parse(fs.readFileSync('config/keywords.json', 'utf8'));
process.env.KEYWORDS_FILE = path.join(process.env.DATA_DIR, 'keywords.test.json');
fs.writeFileSync(process.env.KEYWORDS_FILE, JSON.stringify({ ...kw, leadRule: 'platform' }));

const { detect, ingest, qualifies, classify, hotMatches } = await import('../src/leads.js');
const store = await import('../src/store.js');

// deteksi platform dan keyword
let r = detect('Halo kak, saya lihat di Instagram, mau tanya harga paket');
assert.equal(r.platform, 'Instagram');
assert.deepEqual(r.keywords.sort(), ['harga', 'instagram', 'paket', 'tanya']);

r = detect('Kak info dong');
assert.equal(r.platform, 'Lainnya');
assert.deepEqual(r.keywords, ['info']);

// "ig" tidak boleh cocok di dalam kata lain
assert.equal(detect('digital marketing').platform, 'Lainnya');
assert.equal(detect('dari IG ya').platform, 'Instagram');

// pesan pertama membuat lead, pesan berikutnya dari nomor sama tidak
let a = ingest({ phone: '6281200000001', name: 'Budi', text: 'Halo, lihat iklan di facebook, mau order' });
assert.equal(a.created, true);
assert.equal(a.lead.platform, 'Facebook');
assert.equal(a.lead.status, 'Cold Leads'); // pesan pertama ('order' bukan sinyal transaksi)

a = ingest({ phone: '6281200000001', name: 'Budi', text: 'Ada promo?' });
assert.equal(a.created, false);
assert.equal(a.lead.messageCount, 2);
assert.equal(store.all().length, 1);

// chat tanpa kata kunci platform bukan lead (aturan default: platform)
a = ingest({ phone: '6281200000002', name: '', text: 'Selamat siang' });
assert.equal(a.created, false);
assert.equal(a.ignored, true);
assert.equal(store.all().length, 1);

// trigger saja (tanpa platform) juga belum cukup pada aturan default
a = ingest({ phone: '6281200000002', name: '', text: 'Mau tanya harga paket' });
assert.equal(a.ignored, true);
assert.equal(store.all().length, 1);

// platform disebut di chat berikutnya (bukan pesan pertama) -> tetap jadi lead (lead boleh dibuat di pesan mana pun)
a = ingest({ phone: '6281200000002', name: 'Sari', text: 'Saya lihat dari TikTok', customerCount: 3 });
assert.equal(a.created, true);
assert.equal(a.lead.messageCount, 3);
assert.equal(store.all().length, 2);
a = ingest({ phone: '6281200000003', name: 'Sari', text: 'Saya lihat dari TikTok' }); // pesan pertama
assert.equal(a.created, true);
assert.equal(a.lead.platform, 'TikTok');
assert.equal(store.all().length, 3);
store.flush();
const { getDb } = await import('../src/db.js');
assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM leads').get().n, 3);

// aturan lain
assert.equal(qualifies(detect('tanya harga'), 'keyword'), true);
assert.equal(qualifies(detect('selamat pagi'), 'keyword'), false);
assert.equal(qualifies(detect('selamat pagi'), 'all'), true);

// ubah status
const id = store.all()[0].id;
assert.equal(store.update(id, { status: 'Hot Leads' }).status, 'Hot Leads');
assert.equal(store.update('tidak-ada', { status: 'Hot Leads' }), null);

// ---- sinyal Hot: banyak kemungkinan, imbuhan, negasi ----
const H = (t) => hotMatches(t, ['booking', 'transfer', 'bayar', 'pembayaran', 'dp', 'sudah tf', 'lunas', 'konfirmasi pembayaran']);
assert.deepEqual(H('saya mau booking'), ['booking']);
assert.deepEqual(H('sudah ditransfer ya'), ['transfer']); // imbuhan di-
assert.deepEqual(H('ini bukti pembayarannya'), ['pembayaran']); // imbuhan -nya
assert.deepEqual(H('cara bayar gimana'), ['bayar']);
assert.deepEqual(H('DP nya berapa'), []); // pertanyaan bukan sinyal Hot
assert.deepEqual(H('belum transfer kak'), []); // negasi
assert.deepEqual(H('tidak jadi booking'), []);
assert.deepEqual(H('bunga ga transfer'), []);
assert.deepEqual(H('halo dp'), ['dp']);
assert.deepEqual(H('adpokat'), []); // bukan kata utuh

// ---- status & data leads otomatis ----
const m1 = { text: 'Halo dari Instagram', phone: '1', ts: 1000, customerCount: 1 };
const H24 = 24 * 3600000;
const c1 = classify(null, m1);
assert.equal(c1.lead.status, 'Cold Leads'); // pesan masuk pertama kali + keyword platform
assert.equal(c1.lead.dataType, 'New');
assert.equal(classify(null, { ...m1, text: 'mau booking' }).ignored, true); // tanpa platform bukan lead
assert.equal(classify(null, { ...m1, customerCount: 2 }).created, true); // lead boleh dibuat di pesan ke-2 dst
// Hot langsung di pesan pertama (sinyal pasti: sudah transfer dst); 'booking' saja hanya sinyal lemah
assert.equal(classify(null, { ...m1, text: 'dari Instagram, mau booking' }).lead.status, 'Cold Leads');
const h1 = classify(null, { ...m1, text: 'dari Instagram, sudah transfer' });
assert.equal(h1.lead.status, 'Hot Leads');
assert.equal(h1.lead.dataType, 'New');
assert.equal(h1.lead.transactionCount, 1);

// Cold -> Warm memakai skor (bukan lagi "lebih dari 10 pesan"): 11 pesan saja = 3 poin, tetap Cold
let w = c1.lead;
for (let n = 2; n <= 11; n++) {
  w = classify(w, { text: 'oke', ts: 1000 + n, customerCount: n }).lead;
  assert.equal(w.status, 'Cold Leads', 'pesan ke-' + n);
  assert.equal(w.dataType, 'New');
}
w = classify({ ...w, data: { nama: 'Budi', keluhan: 'pinggang' } }, { text: 'oke', ts: 2000, customerCount: 12 });
assert.equal(w.lead.status, 'Warm Leads'); // 4 (pesan) + 2 (data) >= 5
assert.match(w.lead.statusReason, /12 pesan dari customer/);
// Hot di pesan lanjutan, tidak turun lagi
let c4 = classify(w.lead, { text: 'saya transfer sekarang', ts: 3000, customerCount: 12 });
assert.equal(c4.lead.status, 'Hot Leads');
assert.equal(c4.lead.dataType, 'New'); // baru satu kali transaksi
assert.equal(c4.lead.transactionCount, 1);
// pesan lain dalam transaksi yang sama tidak dihitung transaksi baru
let c5 = classify(c4.lead, { text: 'ini bukti transfer', ts: 4000, customerCount: 13 });
assert.equal(c5.lead.transactionCount, 1);
assert.equal(c5.lead.dataType, 'New');
assert.equal(classify(c5.lead, { text: 'terima kasih', ts: 5000, customerCount: 14 }).lead.status, 'Hot Leads');
// chat biasa (tanpa sinyal transaksi) setelah jeda: tetap New
assert.equal(classify(c5.lead, { text: 'halo kak', ts: 4000 + H24, customerCount: 15 }).lead.dataType, 'New');
// sinyal lagi 24 jam kemudian masih siklus yang sama (siklus terbuka 30 hari) -> tetap New
const c6a = classify(c5.lead, { text: 'mau booking lagi', ts: 4000 + H24, customerCount: 15 });
assert.equal(c6a.lead.transactionCount, 1);
assert.equal(c6a.lead.dataType, 'New');
// sesudah siklus ditutup / lewat 30 hari -> siklus ke-2 -> Existing, permanen, tetap Hot
let c6 = classify(c5.lead, { text: 'mau booking lagi', ts: 4000 + 31 * H24, customerCount: 15 });
assert.equal(c6.lead.transactionCount, 2);
assert.equal(c6.lead.dataType, 'Existing');
assert.equal(c6.lead.status, 'Hot Leads');
assert.match(c6.lead.dataReason, /transaksi ke-2/);
assert.equal(classify(c6.lead, { text: 'halo', ts: 4000 + 60 * H24, customerCount: 16 }).lead.dataType, 'Existing');
// transaksi pertama saat Cold/Warm lalu kedua -> Existing juga; tapi tanpa transaksi pertama tidak Existing
assert.equal(classify(c1.lead, { text: 'halo lagi', ts: 1000 + 3 * H24, customerCount: 2 }).lead.dataType, 'New');
// lead lama berstatus Hot tanpa catatan transaksi dianggap sudah 1 transaksi
const legacy = { ...c1.lead, status: 'Hot Leads', lastMessageAt: 1000 };
delete legacy.transactionCount;
delete legacy.transactionCycles; // lead lama sungguhan tidak punya field siklus
assert.equal(classify(legacy, { text: 'sudah transfer lagi', ts: 1000 + 31 * H24, customerCount: 5 }).lead.dataType, 'Existing');
// Existing diubah manual lalu chat -> langsung Hot
const ex = classify({ ...c1.lead, dataType: 'Existing', dataTypeManual: true }, { text: 'halo', ts: 2000, customerCount: 2 });
assert.equal(ex.lead.status, 'Hot Leads');
// nilai manual tidak ditimpa sistem (transaksi tetap dihitung)
const ms = classify({ ...c1.lead, statusManual: true }, { text: 'booking', ts: 2000, customerCount: 5 });
assert.equal(ms.lead.status, 'Cold Leads');
assert.equal(ms.lead.transactionCount, 1);
assert.equal(classify({ ...c5.lead, dataTypeManual: true }, { text: 'booking lagi', ts: 4000 + 31 * H24, customerCount: 15 }).lead.dataType, 'New');
// konfigurasi bisa ditimpa
const { warmScore: _ws, ...kwOld } = JSON.parse(fs.readFileSync('config/keywords.json', 'utf8'));
const cfg = { ...kwOld, warmAfterMessages: 1 }; // tanpa warmScore -> fallback warmAfterMessages
assert.equal(classify(c1.lead, { text: 'oke', ts: 2000, customerCount: 2 }, cfg).lead.status, 'Warm Leads');

// bawaan produksi (leadRule all): pesan pertama tanpa keyword apa pun langsung Cold; bukan pesan pertama tetap tidak
assert.equal(kw.leadRule, 'all');
const al = classify(null, { text: 'Halo kak', phone: '9', ts: 1000, customerCount: 1 }, kw);
assert.equal(al.lead.status, 'Cold Leads');
assert.equal(al.lead.platform, 'Lainnya');
assert.equal(classify(null, { text: 'Halo kak', ts: 1000, customerCount: 2 }, kw).created, true); // pesan ke-2 pun boleh jadi lead

console.log('Semua uji lolos');