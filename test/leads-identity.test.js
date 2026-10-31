// Uji identitas lead (phone/lid), lead dibuat di pesan mana pun, daftar blokir, createFromConversation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-leads-'));

const L = await import('../src/leads.js');
const store = await import('../src/store.js');
const cfg = L.getConfig();
const T = Date.now();
const noop = () => {};
L.setEmitter(noop);

test('leadRule bawaan konsisten: kode dan config sama-sama all', () => {
  assert.equal(L.DEFAULT_LEAD_RULE, 'all');
  assert.equal(cfg.leadRule, 'all');
  assert.equal(L.qualifies(L.detect('selamat pagi', cfg)), true);
});

test('lead dibuat pada pesan ke-5 (aturan platform): "halo" dulu, lalu "dari IG mau booking"', () => {
  const c = { ...cfg, leadRule: 'platform' };
  assert.equal(L.classify(null, { text: 'halo', phone: '5', ts: T, customerCount: 1 }, c).ignored, true);
  const r = L.classify(null, { text: 'dari IG mau booking', phone: '5', ts: T, customerCount: 5 }, c);
  assert.equal(r.created, true);
  assert.equal(r.lead.messageCount, 5);
  assert.equal(r.lead.platform, 'Instagram');
  assert.equal(r.lead.firstMessage, 'dari IG mau booking');
});

test('ingest: nomor yang sudah ada tetapi leadnya dihapus bisa jadi lead lagi', () => {
  let a = L.ingest({ phone: '6281700000001', name: 'A', text: 'halo', ts: T, customerCount: 1 });
  assert.equal(a.created, true);
  store.remove(a.lead.id);
  a = L.ingest({ phone: '6281700000001', name: 'A', text: 'mau tanya harga', ts: T + 1, customerCount: 4 });
  assert.equal(a.created, true);
  assert.equal(a.lead.messageCount, 4);
});

test('daftar blokir: block/isBlocked/unblock/listBlocked + ingest terblokir', () => {
  assert.equal(L.isBlocked({ phone: '6281700000002' }), false);
  L.block({ phone: '6281700000002' });
  L.block({ lid: '555@lid' });
  assert.equal(L.isBlocked({ phone: '6281700000002' }), true);
  assert.equal(L.isBlocked({ phone: null, lid: '555@lid' }), true);
  assert.equal(L.isBlocked({ phone: '6281700000003', lid: null }), false);
  assert.deepEqual(L.listBlocked(), { phones: ['6281700000002'], lids: ['555@lid'] });
  const onDisk = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'blocked.json'), 'utf8'));
  assert.deepEqual(onDisk, { phones: ['6281700000002'], lids: ['555@lid'] });
  const before = store.all().length;
  let r = L.ingest({ phone: '6281700000002', name: 'B', text: 'halo', ts: T, customerCount: 1 });
  assert.equal(r.ignored, true);
  assert.equal(r.blocked, true);
  r = L.ingest({ phone: null, lid: '555@lid', name: 'B', text: 'halo', ts: T, customerCount: 1 });
  assert.equal(r.blocked, true);
  assert.equal(store.all().length, before);
  L.unblock({ phone: '6281700000002' });
  assert.equal(L.isBlocked({ phone: '6281700000002' }), false);
  r = L.ingest({ phone: '6281700000002', name: 'B', text: 'halo', ts: T, customerCount: 1 });
  assert.equal(r.created, true);
  assert.equal(r.blocked, false);
});

test('createFromConversation: baru, lalu existed, tidak menghormati blokir untuk pembuatan', () => {
  const r = L.createFromConversation({ phone: '6281700000004', name: 'Cici', firstMessage: 'dari facebook, mau tanya harga', ts: T, customerCount: 3, data: { nama: 'Cici' } });
  assert.equal(r.existed, false);
  assert.equal(r.lead.platform, 'Facebook');
  assert.equal(r.lead.messageCount, 3);
  assert.deepEqual(r.lead.data, { nama: 'Cici' });
  assert.equal(r.lead.statusHistory.length, 1);
  assert.equal(store.findByPhone('6281700000004').id, r.lead.id);
  const again = L.createFromConversation({ phone: '6281700000004', name: 'Cici', firstMessage: 'x', ts: T + 5 });
  assert.equal(again.existed, true);
  assert.equal(again.lead.id, r.lead.id);
  L.block({ phone: '6281700000005' });
  const b = L.createFromConversation({ phone: '6281700000005', name: 'D', firstMessage: 'halo', ts: T });
  assert.equal(b.existed, false);
  assert.ok(b.lead.id);
});

test('identitas lid: lead dari lid, lalu phone diketahui -> lead sama diperbarui', () => {
  let a = L.ingest({ phone: null, lid: '777@lid', name: 'E', text: 'halo', ts: T, customerCount: 1 });
  assert.equal(a.created, true);
  assert.equal(a.lead.phone, null);
  assert.equal(a.lead.lid, '777@lid');
  const n = store.all().length;
  const b = L.ingest({ phone: '6281700000006', lid: '777@lid', name: 'E', text: 'ada promo?', ts: T + 1, customerCount: 2 });
  assert.equal(b.created, false);
  assert.equal(b.lead.id, a.lead.id);
  assert.equal(b.lead.phone, '6281700000006');
  assert.equal(b.lead.messageCount, 2);
  assert.equal(store.all().length, n);
  // ditemukan lewat phone, lid terisi
  const c = L.ingest({ phone: '6281700000001', lid: '888@lid', name: 'A', text: 'halo lagi', ts: T + 9, customerCount: 5 });
  assert.equal(c.lead.lid, '888@lid');
});

test('ingest reaction/system diabaikan tanpa efek', () => {
  const a = L.ingest({ phone: '6281700000007', name: 'F', text: 'halo', ts: T, customerCount: 1 });
  const n = store.all().length;
  for (const kind of ['reaction', 'system']) {
    const r = L.ingest({ phone: '6281700000007', name: 'F', text: '👍', kind, ts: T + 1, customerCount: 2 });
    assert.equal(r.ignored, true);
  }
  assert.equal(store.findByPhone('6281700000007').messageCount, a.lead.messageCount);
  assert.equal(store.all().length, n);
  assert.equal(L.ingest({ phone: '6281700000099', text: '👍', kind: 'reaction', customerCount: 1 }).ignored, true);
  assert.equal(store.findByPhone('6281700000099'), undefined);
});

test('pesan media dihitung sebagai pesan customer', () => {
  L.ingest({ phone: '6281700000008', name: 'G', text: 'halo', ts: T, customerCount: 1 });
  const r = L.ingest({ phone: '6281700000008', name: 'G', text: '[gambar] bukti transfer', kind: 'image', ts: T + 1, customerCount: 2 });
  assert.equal(r.lead.messageCount, 2);
  assert.equal(r.lead.lastCustomerMessageAt, T + 1);
});
