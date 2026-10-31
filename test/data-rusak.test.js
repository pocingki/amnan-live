// File/DB rusak: tidak boleh jadi kosong lalu tertimpa tanpa jejak.
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
const J = await import('../src/jsonfile.js');

function fresh() {
  D.closeAll();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-bad-'));
  process.env.DATA_DIR = dir;
  return dir;
}
const quiet = (fn) => {
  const e = console.error;
  const log = [];
  console.error = (...a) => log.push(a.join(' '));
  try { return [fn(), log]; } finally { console.error = e; }
};

test('DB rusak tanpa cadangan: berkas tidak ditimpa, penulisan dihentikan, log jelas', () => {
  const dir = fresh();
  store.add({ phone: '1', name: 'A' });
  store.flush();
  D.closeAll();
  const file = path.join(dir, 'amnan.db');
  fs.writeFileSync(file, 'ini bukan database sqlite, ini sampah '.repeat(200));
  const before = fs.readFileSync(file);
  const [, log] = quiet(() => {
    store.add({ phone: '2', name: 'B' }); // tetap berjalan (memori)
    store.flush();
    C.getOrCreate('2', 'j', 'B');
    C.flush();
  });
  assert.ok(log.some((l) => /RUSAK/.test(l)), 'ada log rusak');
  assert.equal(D.status().writable, false);
  assert.match(D.status().reason, /scripts\/restore\.js/);
  assert.ok(fs.readFileSync(file).equals(before), 'berkas rusak tidak diubah');
  D.closeAll();
});

test('DB rusak dengan cadangan: dipulihkan, berkas rusak disimpan *.corrupt-*', () => {
  const dir = fresh();
  store.add({ phone: '1', name: 'Asli' });
  const { conv } = C.getOrCreate('1', 'j', 'Asli');
  C.addMessage(conv, 'customer', 'halo');
  const bk = D.backupNow({ force: true });
  assert.ok(bk && fs.existsSync(bk));
  D.closeAll();
  fs.writeFileSync(path.join(dir, 'amnan.db'), 'sampah'.repeat(5000));
  const [, log] = quiet(() => store.all());
  assert.ok(log.some((l) => /DIPULIHKAN/.test(l)));
  assert.equal(D.status().writable, true);
  assert.equal(store.findByPhone('1').name, 'Asli');
  assert.equal(C.get('1').messages.length, 1);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('amnan.db.corrupt-')));
  D.closeAll();
});

test('conversations.json lama rusak: tidak diganti nama/ditimpa, migrasi dihentikan', () => {
  const dir = fresh();
  const f = path.join(dir, 'conversations.json');
  fs.writeFileSync(f, '{"62811": {"phone": "62811", "messages": [');
  const [, log] = quiet(() => { C.list(); });
  assert.ok(log.some((l) => /RUSAK/.test(l)));
  assert.ok(fs.existsSync(f), 'berkas asli tetap di tempat');
  assert.ok(!fs.existsSync(f + '.bak'));
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('conversations.json.corrupt-')));
  assert.equal(D.canWrite(), false);
  D.closeAll();
});

test('jsonfile: rusak dengan .bak dipulihkan; tanpa .bak diblokir, bukan ditimpa', () => {
  const dir = fresh();
  J.save('settings.json', { v: 1 });
  J.save('settings.json', { v: 2 }); // .bak = v1
  fs.writeFileSync(path.join(dir, 'settings.json'), '{rusak');
  const [r1, log1] = quiet(() => J.load('settings.json', {}));
  assert.deepEqual(r1, { v: 1 });
  assert.ok(log1.some((l) => /dipulihkan/.test(l)));
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('settings.json.corrupt-')));

  fs.writeFileSync(path.join(dir, 'users.json'), '[{"name":');
  const raw = fs.readFileSync(path.join(dir, 'users.json'));
  const [r2, log2] = quiet(() => J.load('users.json', []));
  assert.deepEqual(r2, []);
  assert.ok(log2.some((l) => /diblokir/.test(l)));
  assert.throws(() => J.save('users.json', []), /diblokir/);
  assert.ok(fs.readFileSync(path.join(dir, 'users.json')).equals(raw), 'berkas rusak utuh');
  J.acknowledge('users.json');
  J.save('users.json', []);
  assert.deepEqual(J.load('users.json', null), []);
});

test('jsonfile: tulis atomik (tanpa sisa .tmp), izin 0600/0700, nama berbahaya ditolak', () => {
  const dir = fresh();
  J.save('a.json', { x: 1 });
  assert.ok(!fs.readdirSync(dir).some((n) => n.includes('.tmp')));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(dir, 'a.json')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  }
  assert.throws(() => J.save('../x.json', {}), /tidak valid/);
});

test('izin berkas database 0600', () => {
  const dir = fresh();
  store.add({ phone: '1' });
  store.flush();
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'amnan.db')).mode & 0o777, 0o600);
  D.closeAll();
});
