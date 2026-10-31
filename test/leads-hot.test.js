// Uji sinyal Hot (hotStrong/hotWeak), kalimat tanya/negasi/imbuhan, hotCandidate, dan event lead:hot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-leads-'));

const L = await import('../src/leads.js');
const cfg = L.getConfig();
const H = Date.now();
const MIN = 60000;

const strong = (t) => L.hotSignals(t, cfg).strong;
const weak = (t) => L.hotSignals(t, cfg).weak;

test('hotMatches 4 contoh bukti temuan tidak lagi Hot', () => {
  for (const t of ['mau konfirmasi jadwal terapi besok', 'bayar di mana ya kak?', 'ada cash back?', 'boleh book jam 5?']) {
    assert.deepEqual(L.hotMatches(t, cfg.hotStrong, { config: cfg }), [], t);
  }
});

const HOT = [
  'sudah transfer ya kak', 'Saya sudah tf barusan', 'ini bukti transfernya', 'sudah ditransfer kak',
  'ini buktinya, sudah bayar', 'sudah dp 500rb', 'Pelunasan sudah saya kirim', 'oke deal kak',
  'jadi ambil paket 10x', 'Sudah lunas ya', 'tolong cek, ini konfirmasi pembayarannya', 'checkout sekarang ya',
  'Halo kak, sudah transfer', 'sudah transfer kak, bisa dicek?',
];
const NOT_HOT = [
  'mau konfirmasi jadwal terapi besok', 'bayar di mana ya kak?', 'ada cash back?', 'boleh book jam 5?',
  'sudah transfer belum ya?', 'bisa bayar pakai qris', 'belum transfer kak', 'tidak jadi ambil paket',
  'batal booking', 'apakah sudah lunas', 'berapa harga paket lunas', 'bagaimana bukti transfer yang benar',
  'kalau sudah bayar bagaimana', 'sudah transfer?', 'kenapa belum lunas', 'dp nya berapa', 'booking jam 5',
  'mau transfer besok', 'rekening nya apa', 'Konfirmasi ya kak', 'cash saja ya', 'fix ya', 'belum sempat bayar',
  'Selamat siang', 'adpokat', 'gimana cara sudah transfer', 'kapan bisa dp kak',
];

test('tabel kalimat: pernyataan strong = Hot', () => {
  for (const t of HOT) assert.ok(strong(t).length > 0, 'harus Hot: ' + t);
});
test('tabel kalimat: pertanyaan, negasi, dan weak saja = bukan Hot', () => {
  for (const t of NOT_HOT) assert.deepEqual(strong(t), [], 'bukan Hot: ' + t);
});
test('tabel minimal 30 kalimat', () => assert.ok(HOT.length + NOT_HOT.length >= 30));

test('hotWeak terdeteksi walau pertanyaan', () => {
  assert.ok(weak('bayar di mana ya kak?').includes('bayar'));
  assert.ok(weak('ada cash back?').includes('cash'));
  assert.deepEqual(weak('Selamat siang'), []);
});

test('imbuhan dan negasi tetap berlaku pada hotMatches', () => {
  const W = ['sudah transfer', 'pembayaran', 'lunas', 'bayar'];
  assert.deepEqual(L.hotMatches('sudah ditransfer ya', W), ['sudah transfer']);
  assert.deepEqual(L.hotMatches('ini bukti pembayarannya', W), ['pembayaran']);
  assert.deepEqual(L.hotMatches('belum lunas', W), []);
  assert.deepEqual(L.hotMatches('tidak jadi bayar', W), []);
});

test('classify: weak tidak membuat Hot, strong membuat Hot', () => {
  const a = L.classify(null, { text: 'halo', phone: '1', ts: H, customerCount: 1 }, cfg);
  const b = L.classify(a.lead, { text: 'bayar di mana ya kak?', ts: H + MIN, customerCount: 2 }, cfg);
  assert.equal(b.lead.status, 'Cold Leads');
  assert.equal(b.lead.lastWeakAt, H + MIN);
  const c = L.classify(b.lead, { text: 'sudah transfer ya', ts: H + 2 * MIN, customerCount: 3 }, cfg);
  assert.equal(c.lead.status, 'Hot Leads');
});

test('hotCandidate: gambar <=10 menit sesudah bahasan bayar; bukan Hot otomatis', () => {
  let l = L.classify(null, { text: 'halo', phone: '2', ts: H, customerCount: 1 }, cfg).lead;
  l = L.classify(l, { text: 'bayar di mana ya kak?', ts: H + MIN, customerCount: 2 }, cfg).lead;
  const img = L.classify(l, { text: '[gambar]', kind: 'image', ts: H + 6 * MIN, customerCount: 3 }, cfg);
  assert.equal(img.lead.status, 'Cold Leads');
  assert.deepEqual(img.lead.hotCandidate, { ts: H + 6 * MIN, reason: 'Gambar/dokumen setelah pembahasan pembayaran' });
  // sesudah Hot, hotCandidate dihapus
  const hot = L.classify(img.lead, { text: 'sudah transfer', ts: H + 7 * MIN, customerCount: 4 }, cfg);
  assert.equal(hot.lead.status, 'Hot Leads');
  assert.equal(hot.lead.hotCandidate, null);
});

test('hotCandidate tidak muncul bila >10 menit atau tanpa bahasan bayar', () => {
  let l = L.classify(null, { text: 'halo', phone: '3', ts: H, customerCount: 1 }, cfg).lead;
  assert.equal(L.classify(l, { text: '[dokumen]', kind: 'document', ts: H + MIN, customerCount: 2 }, cfg).lead.hotCandidate, null);
  l = L.classify(l, { text: 'bayar gimana', ts: H + 2 * MIN, customerCount: 2 }, cfg).lead;
  assert.equal(L.classify(l, { text: '[gambar]', kind: 'image', ts: H + 13 * MIN, customerCount: 3 }, cfg).lead.hotCandidate, null);
  assert.equal(L.classify(l, { text: 'oke', kind: 'text', ts: H + 4 * MIN, customerCount: 3 }, cfg).lead.hotCandidate, null);
});

test('emit lead:hot hanya sekali saat berpindah ke Hot', () => {
  const ev = [];
  L.setEmitter((type, payload) => ev.push([type, payload]));
  L.ingest({ phone: '6281900000001', name: 'Rina', text: 'halo', ts: H, customerCount: 1 });
  L.ingest({ phone: '6281900000001', name: 'Rina', text: 'sudah transfer', ts: H + MIN, customerCount: 2 });
  L.ingest({ phone: '6281900000001', name: 'Rina', text: 'ini bukti transfer', ts: H + 2 * MIN, customerCount: 3 });
  L.ingest({ phone: '6281900000001', name: 'Rina', text: 'terima kasih', ts: H + 3 * MIN, customerCount: 4 });
  assert.deepEqual(ev.map((e) => e[0]), ['lead:new', 'lead:hot']);
  assert.deepEqual(ev[1][1], { phone: '6281900000001', name: 'Rina' });
});
