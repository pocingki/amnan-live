// Enkripsi at-rest opsional (DATA_KEY): data di disk bukan teks polos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AMNAN_NO_BACKUP = '1';
process.env.AMNAN_NO_BG = '1';
const D = await import('../src/db.js');
const store = await import('../src/store.js');
const C = await import('../src/conversations.js');

const PHONE = '6281234567890';
const SECRET = 'isi-pesan-sangat-rahasia-xyz';

function fresh() {
  D.closeAll();
  delete process.env.DATA_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-enc-'));
  process.env.DATA_DIR = dir;
  return dir;
}
const rawDisk = (dir) => Buffer.concat(fs.readdirSync(dir)
  .filter((f) => f.startsWith('amnan.db'))
  .map((f) => fs.readFileSync(path.join(dir, f))));
const seed = () => {
  store.add({ phone: PHONE, name: 'Nama Rahasia Pelanggan', status: 'Cold Leads', dataType: 'New' });
  const { conv } = C.getOrCreate(PHONE, `${PHONE}@s.whatsapp.net`, 'Nama Rahasia Pelanggan');
  C.addMessage(conv, 'customer', SECRET, Date.now());
  C.markSeen('WAID-' + PHONE);
  C.flush();
  store.flush();
};

test('tanpa DATA_KEY data berupa teks polos (pembanding)', () => {
  const dir = fresh();
  seed();
  D.closeAll();
  assert.ok(rawDisk(dir).includes(SECRET));
});

test('dengan DATA_KEY: pesan, nomor, nama tidak ada sebagai teks polos di disk; data tetap terbaca', () => {
  const dir = fresh();
  process.env.DATA_KEY = 'kunci-uji-yang-cukup-panjang';
  seed();
  D.closeAll();
  const raw = rawDisk(dir);
  for (const s of [SECRET, PHONE, 'Nama Rahasia Pelanggan', 'WAID-']) assert.ok(!raw.includes(s), `"${s}" bocor di disk`);
  assert.equal(D.status().encrypted, true);
  assert.equal(C.get(PHONE).messages[0].text, SECRET);
  assert.equal(store.findByPhone(PHONE).name, 'Nama Rahasia Pelanggan');
  assert.equal(C.seenMessage('WAID-' + PHONE), true);
  // cadangan juga terenkripsi
  const bk = D.backupNow({ force: true });
  assert.ok(!fs.readFileSync(bk).includes(SECRET));
  D.closeAll();
});

test('DATA_KEY salah atau hilang: berhenti dengan pesan jelas, data tidak diubah', () => {
  const dir = fresh();
  process.env.DATA_KEY = 'kunci-benar';
  seed();
  D.closeAll();
  const before = fs.readFileSync(path.join(dir, 'amnan.db'));
  process.env.DATA_KEY = 'kunci-salah';
  assert.throws(() => store.all(), /DATA_KEY salah/);
  D.closeAll();
  delete process.env.DATA_KEY;
  assert.throws(() => store.all(), /DATA_KEY belum diset/);
  D.closeAll();
  assert.ok(fs.readFileSync(path.join(dir, 'amnan.db')).equals(before));
  process.env.DATA_KEY = 'kunci-benar';
  assert.equal(C.get(PHONE).messages[0].text, SECRET);
  D.closeAll();
});

test('mengaktifkan DATA_KEY pada data lama yang polos: dienkripsi seluruhnya, sisa teks polos dibuang', () => {
  const dir = fresh();
  seed();
  D.closeAll();
  assert.ok(rawDisk(dir).includes(SECRET));
  process.env.DATA_KEY = 'kunci-baru';
  assert.equal(C.get(PHONE).messages[0].text, SECRET);
  assert.equal(store.findByPhone(PHONE).phone, PHONE);
  D.closeAll();
  const raw = rawDisk(dir);
  assert.ok(!raw.includes(SECRET) && !raw.includes(PHONE));
  assert.equal(C.get(PHONE).messages.length, 1);
  C.addMessage(C.get(PHONE), 'bot', 'balasan', Date.now());
  C.flush();
  D.closeAll();
  assert.equal(C.get(PHONE).messages.length, 2);
  D.closeAll();
});

test('kunci hex 64 karakter diterima langsung', () => {
  fresh();
  process.env.DATA_KEY = 'ab'.repeat(32);
  seed();
  D.closeAll();
  assert.equal(C.get(PHONE).messages[0].text, SECRET);
  D.closeAll();
});
