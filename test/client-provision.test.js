// Persiapan satu-instance-per-client: skrip pembuat client, ecosystem pm2, dan ENV_FILE pada server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = await import('../scripts/client.js');
const { hashPassword } = await import('../src/auth.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-clients-'));
const fakeHash = async () => 'scrypt$16384$8$1$aa$bb';
const opts = (dir, extra = {}) => ({ dir, ...extra });
const deps = { isFree: async () => true, hashPassword: fakeHash };

test('slug dan domain: terima yang wajar, tolak yang berbahaya', () => {
  for (const ok of ['a', 'klinik-sehat', 'toko2', 'a-b-c']) assert.equal(C.validateSlug(ok), null, ok);
  for (const bad of ['', 'Klinik', '-a', 'a-', 'a b', '../x', 'a/b', 'a'.repeat(31)]) assert.ok(C.validateSlug(bad), bad);
  assert.equal(C.validateDomain('app.klien.co.id'), null);
  for (const bad of ['', 'localhost', 'a b.com', 'http://x.com', 'x.com/path']) assert.ok(C.validateDomain(bad), bad);
});

test('cleanText menolak baris baru dan tanda kutip (menjaga .env tetap utuh)', () => {
  assert.equal(C.cleanText('  Klinik Sehat ', 'Nama', 60), 'Klinik Sehat');
  for (const bad of ['a\nb', 'a"b', "a'b", 'a`b']) assert.throws(() => C.cleanText(bad, 'Nama', 60), /tidak boleh/);
  assert.throws(() => C.cleanText('x'.repeat(61), 'Nama', 60), /maksimal/);
});

test('parseArgs: opsi boolean tanpa nilai, opsi lain wajib bernilai', () => {
  const { pos, opt } = C.parseArgs(['new', 'abc', '--name', 'Klinik A', '--no-encrypt', '--port', '8200']);
  assert.deepEqual(pos, ['new', 'abc']);
  assert.deepEqual(opt, { name: 'Klinik A', 'no-encrypt': true, port: '8200' });
  assert.throws(() => C.parseArgs(['new', 'abc', '--name']), /butuh nilai/);
});

test('pickPort melewati port terpakai dan port yang sedang dipakai proses lain', async () => {
  assert.equal(await C.pickPort(new Set()), C.PORT_START);
  assert.equal(await C.pickPort(new Set([C.PORT_START, C.PORT_START + 1])), C.PORT_START + 2);
  const busy = new Set([C.PORT_START]);
  assert.equal(await C.pickPort(new Set(), async (p) => !busy.has(p)), C.PORT_START + 1);
  await assert.rejects(() => C.pickPort(new Set(), async () => false, 9000, 3), /Tidak ada port kosong/);
});

test('createClient: folder, .env 0600, keywords disalin, nginx hanya bila ada domain', async () => {
  const dir = tmp();
  const r = await C.createClient('klinik-a', opts(dir, { name: 'Klinik A', tagline: 'Fisio', domain: 'A.Example.com', password: 'rahasia-123' }), deps);
  assert.equal(r.port, C.PORT_START);
  assert.equal(r.domain, 'a.example.com');
  const env = C.parseEnv(fs.readFileSync(r.envFile, 'utf8'));
  assert.equal(env.CLIENT_ID, 'klinik-a');
  assert.equal(env.BRAND_NAME, 'Klinik A');
  assert.equal(env.BRAND_TAGLINE, 'Fisio');
  assert.equal(env.PORT, String(C.PORT_START));
  assert.equal(env.DATA_DIR, path.join(dir, 'klinik-a', 'data'));
  assert.equal(env.KEYWORDS_FILE, path.join(dir, 'klinik-a', 'keywords.json'));
  assert.equal(env.PUBLIC_URL, 'https://a.example.com');
  assert.equal(env.TRUST_PROXY, '1');
  assert.match(env.DATA_KEY, /^[0-9a-f]{64}$/);
  assert.equal(env.DASHBOARD_PASSWORD_HASH, 'scrypt$16384$8$1$aa$bb');
  assert.ok(!fs.readFileSync(r.envFile, 'utf8').includes('rahasia-123'), 'password asli tidak boleh tersimpan');
  assert.ok(fs.existsSync(env.KEYWORDS_FILE));
  assert.ok(fs.statSync(env.DATA_DIR).isDirectory());
  assert.match(fs.readFileSync(r.nginxFile, 'utf8'), new RegExp(`proxy_pass http://127\\.0\\.0\\.1:${C.PORT_START};`));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(r.envFile).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(dir, 'klinik-a')).mode & 0o777, 0o700);
  }
  const noDomain = await C.createClient('toko-b', opts(dir, { 'no-encrypt': true }), deps);
  assert.equal(noDomain.nginxFile, null);
  assert.equal(noDomain.generated, true);
  assert.equal(noDomain.password.length, 20);
  assert.equal(C.parseEnv(fs.readFileSync(noDomain.envFile, 'utf8')).DATA_KEY, '');
});

test('createClient: port otomatis berurutan, duplikat dan port bentrok ditolak', async () => {
  const dir = tmp();
  const a = await C.createClient('a', opts(dir), deps);
  const b = await C.createClient('b', opts(dir), deps);
  assert.equal(b.port, a.port + 1);
  await assert.rejects(() => C.createClient('a', opts(dir), deps), /sudah ada/);
  await assert.rejects(() => C.createClient('c', opts(dir, { port: String(a.port) }), deps), /sudah dipakai client lain/);
  await assert.rejects(() => C.createClient('c', opts(dir, { port: '80' }), deps), /1024-65535/);
  await assert.rejects(() => C.createClient('c', opts(dir, { port: '9100' }), { ...deps, isFree: async () => false }), /proses lain/);
  await assert.rejects(() => C.createClient('c', opts(dir, { tz: 'Mars/Olympus' }), deps), /Zona waktu/);
  await assert.rejects(() => C.createClient('c', opts(dir, { domain: 'bukan domain' }), deps), /Domain tidak valid/);
  assert.ok(!fs.existsSync(path.join(dir, 'c')), 'kegagalan validasi tidak boleh meninggalkan folder');
  assert.deepEqual(C.listClients(dir).map((c) => c.slug), ['a', 'b']);
});

test('ecosystem pm2: satu proses per folder client dengan ENV_FILE masing-masing', async () => {
  const dir = tmp();
  await C.createClient('b-client', opts(dir), deps);
  await C.createClient('a-client', opts(dir), deps);
  fs.mkdirSync(path.join(dir, 'tanpa-env')); // folder tanpa .env diabaikan
  const prev = process.env.AMNAN_CLIENTS_DIR;
  process.env.AMNAN_CLIENTS_DIR = dir;
  try {
    const require = createRequire(import.meta.url);
    const file = path.join(ROOT, 'deploy', 'ecosystem.clients.config.cjs');
    delete require.cache[file];
    const { apps } = require(file);
    assert.deepEqual(apps.map((a) => a.name), ['amnan-a-client', 'amnan-b-client']);
    for (const a of apps) {
      assert.equal(a.instances, 1);
      assert.equal(a.cwd, ROOT);
      assert.equal(a.env.ENV_FILE, path.join(dir, a.name.replace('amnan-', ''), '.env'));
    }
  } finally {
    if (prev === undefined) delete process.env.AMNAN_CLIENTS_DIR; else process.env.AMNAN_CLIENTS_DIR = prev;
  }
});

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });

test('server membaca ENV_FILE: port, data, merek, dan login milik client itu', async () => {
  const dir = tmp();
  const port = await freePort();
  const r = await C.createClient('envtest', opts(dir, { name: 'Merek Uji', password: 'sandi-uji-12345', port: String(port) }), { isFree: async () => true, hashPassword });
  const env = { ...process.env, ENV_FILE: r.envFile, DISABLE_WA: '1' };
  for (const k of ['PORT', 'DATA_DIR', 'CLIENT_ID', 'BRAND_NAME', 'KEYWORDS_FILE', 'DASHBOARD_PASSWORD', 'DASHBOARD_PASSWORD_HASH', 'DATA_KEY']) delete env[k];
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    let health = null;
    for (let i = 0; i < 80 && !health; i++) {
      try { health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json(); } catch { await new Promise((ok) => setTimeout(ok, 150)); }
    }
    assert.ok(health, 'server tidak merespons');
    assert.equal(health.status, 'ok');
    const auth = (pw) => ({ headers: { Authorization: `Basic ${Buffer.from(`admin:${pw}`).toString('base64')}` } });
    const ok = await fetch(`http://127.0.0.1:${port}/api/settings`, auth('sandi-uji-12345'));
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal((body.settings || body).brandName, 'Merek Uji');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/settings`, auth('salah-salah-1'))).status, 401);
    assert.ok(fs.existsSync(path.join(dir, 'envtest', 'data', 'users.json')), 'data harus ditulis ke DATA_DIR client');
  } finally {
    child.kill('SIGTERM');
    await new Promise((ok) => child.once('exit', ok));
  }
});

test('createClient: --color ditulis ke .env sebagai BRAND_COLOR; warna terlalu terang atau salah ditolak', async () => {
  const dir = tmp();
  const r = await C.createClient('berwarna', opts(dir, { color: '#0B5FA5' }), deps);
  assert.equal(C.parseEnv(fs.readFileSync(r.envFile, 'utf8')).BRAND_COLOR, '#0b5fa5');
  const none = await C.createClient('polos', opts(dir), deps);
  assert.equal(C.parseEnv(fs.readFileSync(none.envFile, 'utf8')).BRAND_COLOR, '');
  await assert.rejects(() => C.createClient('terang', opts(dir, { color: '#ffeb3b' }), deps), /terlalu terang/);
  await assert.rejects(() => C.createClient('salah', opts(dir, { color: 'merah' }), deps), /#RRGGBB/);
  assert.ok(!fs.existsSync(path.join(dir, 'terang')), 'penolakan tidak meninggalkan folder');
});
