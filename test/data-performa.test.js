// Bukti performa: 1.500 percakapan x 60 pesan, operasi tulis per pesan harus < 10 ms.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AMNAN_NO_BACKUP = '1';
process.env.AMNAN_NO_BG = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-perf-'));
const D = await import('../src/db.js');
const C = await import('../src/conversations.js');
const store = await import('../src/store.js');

const N = 1500;
const M = 60;
const pct = (arr, p) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length * p)];

test(`tulis per pesan < 10 ms pada ${N} percakapan x ${M} pesan`, () => {
  // isi data awal
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const phone = `628${String(10000000 + i)}`;
    const { conv } = C.getOrCreate(phone, `${phone}@s.whatsapp.net`, `Pelanggan ${i}`);
    for (let j = 0; j < M; j++) C.addMessage(conv, j % 2 ? 'bot' : 'customer', `pesan ke-${j} dari ${i} `.repeat(3), 1700000000000 + i * 1000 + j);
    store.add({ phone, name: `Pelanggan ${i}`, status: 'Cold Leads', dataType: 'New', source: { platform: 'Instagram' } });
  }
  C.flush();
  store.flush();
  const seed = performance.now() - t0;
  const size = fs.statSync(path.join(process.env.DATA_DIR, 'amnan.db')).size;

  // restart dingin: muat ulang dari disk
  D.closeAll();
  const t1 = performance.now();
  assert.equal(C.list().length, N);
  const load = performance.now() - t1;
  assert.equal(C.get('62810000000').messages.length, M);

  // simulasi pesan masuk: get -> addMessage -> unread++ -> save() -> penulisan debounce dijalankan
  const syncPart = [];
  const total = [];
  for (let k = 0; k < 400; k++) {
    const phone = `628${String(10000000 + ((k * 37) % N))}`;
    const a = performance.now();
    const conv = C.get(phone);
    C.addMessage(conv, 'customer', `halo ${k}`, Date.now());
    conv.unread++;
    store.updateByPhone(phone, { lastMessageAt: Date.now(), messageCount: k });
    C.save();
    const b = performance.now();
    C._persistNow(); // pekerjaan yang normalnya dilakukan timer debounce
    const c = performance.now();
    syncPart.push(b - a);
    total.push(c - a);
  }
  console.log(`seed ${seed.toFixed(0)} ms, ukuran DB ${(size / 1048576).toFixed(1)} MB, muat dingin ${load.toFixed(0)} ms`);
  console.log(`bagian sinkron p50=${pct(syncPart, 0.5).toFixed(2)} p95=${pct(syncPart, 0.95).toFixed(2)} ms`);
  console.log(`total tulis per pesan p50=${pct(total, 0.5).toFixed(2)} p95=${pct(total, 0.95).toFixed(2)} max=${Math.max(...total).toFixed(2)} ms`);
  assert.ok(pct(total, 0.95) < 10, `p95 ${pct(total, 0.95)} ms >= 10 ms`);
  assert.ok(pct(syncPart, 0.95) < 5);

  // data benar-benar tersimpan
  C.flush();
  store.flush();
  D.closeAll();
  assert.equal(C.get('628' + String(10000000)).messages.length >= M, true);
  D.closeAll();
});
