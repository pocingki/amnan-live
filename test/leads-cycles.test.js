// Uji siklus transaksi (DP -> pelunasan -> booking lagi), migrasi lead lama, markTransactionDone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-leads-'));

const L = await import('../src/leads.js');
const cfg = L.getConfig();
const HR = 3600000;
const t0 = Date.UTC(2026, 0, 5, 3);
const step = (prev, text, ts, n) => L.classify(prev, { text, phone: '1', ts, customerCount: n }, cfg);

test('contoh spesifikasi: booking -> dp -> pelunasan tetap New, booking lagi = Existing', () => {
  let r = step(null, 'dari IG mau booking', t0, 1);
  assert.equal(r.lead.platform, 'Instagram');
  assert.equal(r.lead.dataType, 'New');
  assert.equal(r.lead.transactionCycles.length, 1);
  r = step(r.lead, 'sudah dp', t0 + 2 * HR, 2);
  assert.equal(r.lead.status, 'Hot Leads');
  assert.equal(r.lead.transactionCycles.length, 1);
  assert.ok(r.lead.transactionCycles[0].signals.some((s) => s.type === 'dp'));
  r = step(r.lead, 'ini pelunasan', t0 + 30 * HR, 3);
  assert.equal(r.lead.dataType, 'New');
  assert.equal(r.lead.transactionCount, 1);
  assert.equal(r.lead.transactionCycles[0].settledAt, t0 + 30 * HR);
  assert.ok(r.lead.transactionCycles[0].signals.some((s) => s.type === 'pelunasan'));
  r = step(r.lead, 'booking lagi', t0 + 72 * HR, 4);
  assert.equal(r.lead.transactionCycles.length, 2);
  assert.equal(r.lead.transactionCount, 2);
  assert.equal(r.lead.dataType, 'Existing');
  assert.match(r.lead.dataReason, /transaksi ke-2/);
});

test('sinyal <24 jam setelah pelunasan masih satu siklus', () => {
  let r = step(null, 'sudah dp', t0, 1);
  r = step(r.lead, 'ini pelunasan', t0 + HR, 2);
  r = step(r.lead, 'booking juga untuk teman', t0 + 10 * HR, 3);
  assert.equal(r.lead.transactionCycles.length, 1);
  assert.equal(r.lead.dataType, 'New');
});

test('jeda > transactionCycleDays membuat siklus baru', () => {
  let r = step(null, 'sudah dp', t0, 1);
  r = step(r.lead, 'halo', t0 + 20 * 24 * HR, 2);
  r = step(r.lead, 'sudah transfer', t0 + 29 * 24 * HR, 3);
  assert.equal(r.lead.transactionCycles.length, 1);
  r = step(r.lead, 'sudah transfer lagi', t0 + 29 * 24 * HR + 31 * 24 * HR, 4);
  assert.equal(r.lead.transactionCycles.length, 2);
  assert.equal(r.lead.dataType, 'Existing');
});

test('pertanyaan/negasi tidak membuat siklus', () => {
  let r = step(null, 'halo', t0, 1);
  r = step(r.lead, 'boleh book jam 5?', t0 + HR, 2);
  r = step(r.lead, 'belum sudah dp kak', t0 + 2 * HR, 3);
  r = step(r.lead, 'dp berapa?', t0 + 3 * HR, 4);
  assert.equal(r.lead.transactionCycles.length, 0);
  assert.equal(r.lead.transactionCount, 0);
});

test('Existing permanen dan dataTypeManual dihormati', () => {
  let r = step(null, 'sudah dp', t0, 1);
  r = step(r.lead, 'sudah dp lagi', t0 + 40 * 24 * HR, 2);
  assert.equal(r.lead.dataType, 'Existing');
  r = step(r.lead, 'halo', t0 + 200 * 24 * HR, 3);
  assert.equal(r.lead.dataType, 'Existing');
  let m = step(null, 'sudah dp', t0, 1).lead;
  m = { ...m, dataTypeManual: true };
  m = step(m, 'sudah dp lagi', t0 + 40 * 24 * HR, 2).lead;
  assert.equal(m.transactionCycles.length, 2);
  assert.equal(m.dataType, 'New');
});

test('migrasi lead lama: N siklus sintetis', () => {
  const old = { id: 'x', phone: '1', status: 'Hot Leads', dataType: 'Existing', transactionCount: 2, lastTransactionAt: t0, createdAt: t0 - HR, lastMessageAt: t0, messageCount: 5 };
  const n = L.normalizeLead(old);
  assert.equal(n.transactionCycles.length, 2);
  assert.ok(n.transactionCycles.every((c) => c.lastSignalAt === t0 && c.doneAt === null));
  assert.equal(n.transactionCount, 2);
  assert.deepEqual(n.notes, []);
  assert.equal(n.followUpDate, null);
  assert.equal(n.hotCandidate, null);
  assert.equal(n.blocked, false);
  // normalizeLead tidak mengubah objek asli
  assert.equal(old.transactionCycles, undefined);
  // lead Hot lama tanpa transactionCount = 1 siklus
  assert.equal(L.normalizeLead({ id: 'y', status: 'Hot Leads', createdAt: t0, lastMessageAt: t0 }).transactionCycles.length, 1);
  assert.equal(L.normalizeLead({ id: 'z', status: 'Cold Leads', createdAt: t0 }).transactionCycles.length, 0);
  // classify lead lama tidak error, jumlah transaksi tetap
  const r = L.classify(old, { text: 'halo', ts: t0 + HR, customerCount: 6 }, cfg);
  assert.equal(r.lead.transactionCount, 2);
});

test('markTransactionDone menutup siklus terbuka tanpa menurunkan Existing', () => {
  let r = step(null, 'sudah dp', t0, 1);
  const patch = L.markTransactionDone(r.lead, t0 + HR);
  assert.equal(patch.transactionCycles[0].doneAt, t0 + HR);
  assert.equal(patch.dataType, undefined);
  const closed = { ...r.lead, ...patch };
  r = step(closed, 'sudah dp lagi', t0 + 2 * HR, 2);
  assert.equal(r.lead.transactionCycles.length, 2);
  assert.equal(r.lead.dataType, 'Existing');
  const p2 = L.markTransactionDone(r.lead, t0 + 3 * HR);
  assert.equal(p2.dataType, undefined);
  assert.equal(p2.transactionCount, 2);
});
