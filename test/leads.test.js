// Uji logika deteksi dan pembuatan lead (tanpa WhatsApp).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-test-'));

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

// platform disebut di chat berikutnya (bukan pesan pertama) -> tidak jadi lead
a = ingest({ phone: '6281200000002', name: 'Sari', text: 'Saya lihat dari TikTok', customerCount: 3 });
assert.equal(a.ignored, true);
assert.equal(store.all().length, 1);
a = ingest({ phone: '6281200000003', name: 'Sari', text: 'Saya lihat dari TikTok' }); // pesan pertama
assert.equal(a.created, true);
assert.equal(a.lead.platform, 'TikTok');
assert.equal(store.all().length, 2);
const onDisk = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'leads.json'), 'utf8'));
assert.equal(onDisk.length, 2);

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
assert.ok(H('DP nya berapa').includes('dp'));
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
assert.equal(classify(null, { ...m1, customerCount: 2 }).ignored, true); // bukan pesan pertama kali
// Hot langsung di pesan pertama (booking/transfer dst)
const h1 = classify(null, { ...m1, text: 'dari Instagram, mau booking' });
assert.equal(h1.lead.status, 'Hot Leads');
assert.equal(h1.lead.dataType, 'New');
assert.equal(h1.lead.transactionCount, 1);

// Cold -> Warm hanya jika pesan customer LEBIH dari 10 (jadi mulai pesan ke-11)
let w = c1.lead;
for (let n = 2; n <= 10; n++) {
  w = classify(w, { text: 'oke', ts: 1000 + n, customerCount: n }).lead;
  assert.equal(w.status, 'Cold Leads', 'pesan ke-' + n);
  assert.equal(w.dataType, 'New');
}
w = classify(w, { text: 'oke', ts: 2000, customerCount: 11 });
assert.equal(w.lead.status, 'Warm Leads');
assert.match(w.lead.statusReason, /lebih dari 10/);
// Hot di pesan lanjutan, tidak turun lagi
let c4 = classify(w.lead, { text: 'saya transfer sekarang', ts: 3000, customerCount: 12 });
assert.equal(c4.lead.status, 'Hot Leads');
assert.equal(c4.lead.dataType, 'New'); // baru satu kali transaksi
assert.equal(c4.lead.transactionCount, 1);
// pesan lain dalam transaksi yang sama (di bawah 24 jam) tidak dihitung transaksi baru
let c5 = classify(c4.lead, { text: 'ini bukti transfer', ts: 4000, customerCount: 13 });
assert.equal(c5.lead.transactionCount, 1);
assert.equal(c5.lead.dataType, 'New');
assert.equal(classify(c5.lead, { text: 'terima kasih', ts: 5000, customerCount: 14 }).lead.status, 'Hot Leads');
// chat biasa (tanpa sinyal transaksi) setelah jeda 24 jam: tetap New
assert.equal(classify(c5.lead, { text: 'halo kak', ts: 4000 + H24, customerCount: 15 }).lead.dataType, 'New');
// transaksi kedua (>= 24 jam setelah yang pertama) -> Existing, permanen, tetap Hot
let c6 = classify(c5.lead, { text: 'mau booking lagi', ts: 4000 + H24, customerCount: 15 });
assert.equal(c6.lead.transactionCount, 2);
assert.equal(c6.lead.dataType, 'Existing');
assert.equal(c6.lead.status, 'Hot Leads');
assert.match(c6.lead.dataReason, /transaksi ke-2/);
assert.equal(classify(c6.lead, { text: 'halo', ts: 4000 + 2 * H24, customerCount: 16 }).lead.dataType, 'Existing');
// transaksi pertama saat Cold/Warm lalu kedua -> Existing juga; tapi tanpa transaksi pertama tidak Existing
assert.equal(classify(c1.lead, { text: 'halo lagi', ts: 1000 + 3 * H24, customerCount: 2 }).lead.dataType, 'New');
// lead lama berstatus Hot tanpa catatan transaksi dianggap sudah 1 transaksi
const legacy = { ...c1.lead, status: 'Hot Leads', lastMessageAt: 1000 };
delete legacy.transactionCount;
assert.equal(classify(legacy, { text: 'transfer lagi', ts: 1000 + H24, customerCount: 5 }).lead.dataType, 'Existing');
// Existing diubah manual lalu chat -> langsung Hot
const ex = classify({ ...c1.lead, dataType: 'Existing', dataTypeManual: true }, { text: 'halo', ts: 2000, customerCount: 2 });
assert.equal(ex.lead.status, 'Hot Leads');
// nilai manual tidak ditimpa sistem (transaksi tetap dihitung)
const ms = classify({ ...c1.lead, statusManual: true }, { text: 'booking', ts: 2000, customerCount: 5 });
assert.equal(ms.lead.status, 'Cold Leads');
assert.equal(ms.lead.transactionCount, 1);
assert.equal(classify({ ...c5.lead, dataTypeManual: true }, { text: 'booking lagi', ts: 4000 + H24, customerCount: 15 }).lead.dataType, 'New');
// konfigurasi bisa ditimpa
const cfg = { ...JSON.parse(fs.readFileSync('config/keywords.json', 'utf8')), warmAfterMessages: 1 };
assert.equal(classify(c1.lead, { text: 'oke', ts: 2000, customerCount: 2 }, cfg).lead.status, 'Warm Leads');

console.log('Semua uji lolos');