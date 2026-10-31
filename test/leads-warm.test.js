// Uji skor Warm, alasan, statusHistory, lastCustomerMessageAt, konfigurasi lama sebagai fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-leads-'));

const L = await import('../src/leads.js');
const cfg = L.getConfig();
const T = Date.now();
const MIN = 60000;
const at = (prev, text, n, extra = {}, c = cfg) => L.classify(prev, { text, phone: '1', ts: T + n * MIN, customerCount: n, ...extra }, c);

test('config memuat warmScore, timezone, transactionCycleDays', () => {
  assert.equal(cfg.warmScore.threshold, 5);
  assert.equal(cfg.timezone, 'Asia/Jakarta');
  assert.equal(cfg.transactionCycleDays, 30);
  assert.equal(cfg.leadRule, 'all');
});

test('skor: harga (sekali) + jadwal + pesan -> Warm dengan alasan; statusHistory dan lastCustomerMessageAt', () => {
  let r = at(null, 'halo', 1);
  assert.equal(r.lead.status, 'Cold Leads');
  assert.equal(r.lead.warmScore, 0);
  assert.deepEqual(r.lead.warmReasons, []);
  assert.equal(r.lead.statusHistory.length, 1);
  assert.equal(r.lead.statusHistory[0].status, 'Cold Leads');
  assert.equal(r.lead.statusHistory[0].ts, T + MIN);
  assert.ok(r.lead.statusHistory[0].reason);
  assert.equal(r.lead.lastCustomerMessageAt, T + MIN);
  r = at(r.lead, 'berapa harganya kak?', 2);
  assert.equal(r.lead.warmScore, 2);
  r = at(r.lead, 'harganya berapa sih?', 3); // jenis sama tidak dihitung lagi; 3 pesan = +1
  assert.equal(r.lead.warmScore, 3);
  assert.equal(r.lead.status, 'Cold Leads');
  r = at(r.lead, 'jadwal besok ada?', 4);
  assert.equal(r.lead.warmScore, 5);
  assert.equal(r.lead.status, 'Warm Leads');
  assert.ok(r.lead.warmReasons.includes('Menanyakan harga'));
  assert.ok(r.lead.warmReasons.includes('Menanyakan jadwal'));
  assert.ok(r.lead.warmReasons.includes('4 pesan dari customer'));
  assert.match(r.lead.statusReason, /Menanyakan harga/);
  assert.equal(r.lead.statusHistory.length, 2);
  assert.equal(r.lead.statusHistory[1].status, 'Warm Leads');
  assert.equal(r.lead.statusHistory[1].ts, T + 4 * MIN);
  assert.ok(r.changes.includes('Status: Warm Leads'));
  assert.equal(r.lead.lastCustomerMessageAt, T + 4 * MIN);
});

test('hanya pesan banyak: 11 pesan = 3 poin, tetap Cold; maksimal 4 poin', () => {
  let l = at(null, 'halo', 1).lead;
  for (let n = 2; n <= 11; n++) l = at(l, 'oke', n).lead;
  assert.equal(l.status, 'Cold Leads');
  assert.equal(l.warmScore, 3);
  l = at(l, 'oke', 40).lead;
  assert.equal(l.warmScore, 4);
  assert.equal(l.status, 'Cold Leads');
});

test('kolom data terjawab menambah skor (maks 2) dan masuk alasan', () => {
  let l = at(null, 'halo', 1).lead;
  l = { ...l, data: { nama: 'Budi', keluhan: 'pinggang', umur: '30' } };
  for (let n = 2; n <= 11; n++) l = at(l, 'oke', n).lead;
  assert.equal(l.status, 'Warm Leads'); // 3 (pesan) + 2 (data, maks) = 5
  assert.ok(l.warmReasons.includes('11 pesan dari customer'));
  assert.ok(l.warmReasons.includes('3 data terisi'));
});

test('Hot tidak turun; status manual tidak ditimpa; riwayat hanya perubahan otomatis', () => {
  let l = at(null, 'halo', 1).lead;
  l = at(l, 'sudah transfer', 2).lead;
  assert.equal(l.status, 'Hot Leads');
  assert.equal(l.statusHistory.at(-1).status, 'Hot Leads');
  l = at(l, 'berapa harga jadwal lokasi?', 3).lead;
  assert.equal(l.status, 'Hot Leads');
  const m = at({ ...at(null, 'halo', 1).lead, statusManual: true }, 'berapa harga? jadwal ada? lokasi dimana?', 6);
  assert.equal(m.lead.status, 'Cold Leads');
  assert.equal(m.lead.statusHistory.length, 1);
});

test('fallback warmAfterMessages bila warmScore tidak ada di config', () => {
  const { warmScore, ...old } = cfg;
  const c = { ...old, warmAfterMessages: 3 };
  let l = at(null, 'halo', 1, {}, c).lead;
  l = at(l, 'oke', 2, {}, c).lead;
  l = at(l, 'oke', 3, {}, c).lead;
  assert.equal(l.status, 'Cold Leads');
  l = at(l, 'oke', 4, {}, c).lead;
  assert.equal(l.status, 'Warm Leads');
});

test('lead lama tanpa field baru tidak membuat error di classify', () => {
  const old = { id: 'o', phone: '1', name: 'X', platform: 'Lainnya', status: 'Cold Leads', dataType: 'New', messageCount: 2, createdAt: T, lastMessageAt: T, keyword: '' };
  const r = at(old, 'halo lagi', 3);
  assert.equal(r.lead.messageCount, 3);
  assert.ok(Array.isArray(r.lead.transactionCycles));
});

test('reaction/system pada classify diabaikan', () => {
  const l = at(null, 'halo', 1).lead;
  const r = at(l, '👍', 2, { kind: 'reaction' });
  assert.equal(r.ignored, true);
  assert.equal(r.lead, null);
  assert.equal(at(null, 'x', 1, { kind: 'system' }).ignored, true);
});
