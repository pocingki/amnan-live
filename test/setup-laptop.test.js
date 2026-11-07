// Pemasangan mandiri di laptop: scripts/setup-laptop.js, berkas .bat, dan server yang berjalan dari hasilnya.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = await import('../scripts/setup-laptop.js');
const C = await import('../scripts/client.js');
const { hashPassword, verifyPassword } = await import('../src/auth.js');

// Folder pasang tiruan: isinya tautan ke public/ dan config/ (kode tetap di ROOT), tempat .env dan data/ dibuat.
function installDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-laptop-'));
  const kind = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(path.join(ROOT, 'public'), path.join(dir, 'public'), kind);
  fs.symlinkSync(path.join(ROOT, 'config'), path.join(dir, 'config'), kind);
  return dir;
}
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const run = (dir, opt, extra = {}) => L.setup(opt, { appDir: dir, interactive: false, hashPassword, log: () => {}, ...extra });

test('parseArgs menerima daftar opsi boolean sendiri (tidak menelan argumen berikutnya)', () => {
  const { opt } = C.parseArgs(['--yes', '--name', 'A', '--skip-build', '--force', '--color', '#0b5fa5'], new Set(['yes', 'skip-build', 'force']));
  assert.deepEqual(opt, { yes: true, name: 'A', 'skip-build': true, force: true, color: '#0b5fa5' });
});

test('pickLocalPort melewati port yang terpakai', async () => {
  assert.equal(await L.pickLocalPort(8080, async () => true), 8080);
  assert.equal(await L.pickLocalPort(8080, async (p) => p >= 8083), 8083);
  await assert.rejects(() => L.pickLocalPort(8080, async () => false), /terpakai/);
});

test('setup: .env lengkap, password hanya berupa hash, keywords disalin, data/ dibuat, tidak menimpa tanpa --force', async () => {
  const dir = installDir();
  const r = await run(dir, { name: 'Klinik A', tagline: 'Fisio', color: '#0B5FA5', password: 'sandi-laptop-1', port: '8123', 'skip-build': true });
  assert.equal(r.port, 8123);
  assert.equal(r.generated, false);
  const raw = fs.readFileSync(r.envFile, 'utf8');
  const env = C.parseEnv(raw);
  assert.equal(env.BRAND_NAME, 'Klinik A');
  assert.equal(env.BRAND_TAGLINE, 'Fisio');
  assert.equal(env.BRAND_COLOR, '#0b5fa5');
  assert.equal(env.PORT, '8123');
  assert.equal(env.KEYWORDS_FILE, 'data/keywords.json');
  assert.match(env.DATA_KEY, /^[0-9a-f]{64}$/);
  assert.ok(!raw.includes('sandi-laptop-1'), 'password asli tidak boleh tersimpan');
  assert.ok(await verifyPassword('sandi-laptop-1', env.DASHBOARD_PASSWORD_HASH));
  assert.ok(raw.includes('\r\n'), '.env memakai CRLF agar nyaman di Notepad');
  assert.ok(fs.existsSync(path.join(dir, 'data', 'keywords.json')));
  assert.equal(await run(dir, { name: 'Lain', 'skip-build': true }), null, 'tidak menimpa .env yang ada');
  assert.equal(C.parseEnv(fs.readFileSync(r.envFile, 'utf8')).BRAND_NAME, 'Klinik A');
  const again = await run(dir, { name: 'Lain', force: true, 'no-encrypt': true, 'skip-build': true });
  assert.equal(again.encrypted, false);
  assert.equal(C.parseEnv(fs.readFileSync(r.envFile, 'utf8')).BRAND_NAME, 'Lain');
});

test('setup: password otomatis, validasi warna/password/nama/port', async () => {
  const gen = await run(installDir(), { name: 'X', 'skip-build': true });
  assert.equal(gen.generated, true);
  assert.equal(gen.password.length, 20);
  const bad = (opt, re) => assert.rejects(() => run(installDir(), { 'skip-build': true, ...opt }), re);
  await bad({ color: '#ffeb3b' }, /terlalu terang/);
  await bad({ color: 'merah' }, /#RRGGBB/);
  await bad({ password: 'pendek' }, /minimal 8/);
  await bad({ name: 'a"b' }, /tidak boleh/);
  await bad({ user: 'a b' }, /Nama pengguna/);
  await bad({ port: '80' }, /1024-65535/);
});

test('berkas .bat: ada, CRLF, memanggil setup dan server; .gitattributes menjaga CRLF', () => {
  for (const f of ['Mulai-Amnan.bat', 'Update-Amnan.bat']) {
    const txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(txt.includes('\r\n') && !/[^\r]\n/.test(txt), `${f} harus CRLF murni`);
  }
  const mulai = fs.readFileSync(path.join(ROOT, 'Mulai-Amnan.bat'), 'utf8');
  assert.match(mulai, /scripts\\setup-laptop\.js/);
  assert.match(mulai, /node server\.js/);
  assert.match(mulai, /npm ci/);
  assert.match(mulai, /build:css/);
  assert.match(fs.readFileSync(path.join(ROOT, 'Update-Amnan.bat'), 'utf8'), /git pull/);
  assert.match(fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8'), /\*\.bat text eol=crlf/);
});

test('server berjalan dari hasil setup: merek, warna, login, dan data berada di folder pasang', async () => {
  const dir = installDir();
  const port = await freePort();
  await run(dir, { name: 'Klinik Laptop', color: '#2e7d32', password: 'sandi-laptop-2', port: String(port), 'skip-build': true });
  const env = { ...process.env, APP_DIR: dir, DISABLE_WA: '1' };
  for (const k of ['PORT', 'DATA_DIR', 'ENV_FILE', 'BRAND_NAME', 'BRAND_COLOR', 'DASHBOARD_PASSWORD', 'DASHBOARD_PASSWORD_HASH', 'DATA_KEY', 'KEYWORDS_FILE']) delete env[k];
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: os.tmpdir(), env, stdio: 'ignore' });
  try {
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      try { up = (await fetch(base + '/healthz')).ok; } catch { await new Promise((ok) => setTimeout(ok, 150)); }
    }
    assert.ok(up, 'server tidak merespons');
    assert.deepEqual(await (await fetch(base + '/brand.json')).json(), { name: 'Klinik Laptop', logo: false });
    assert.match(await (await fetch(base + '/brand.css')).text(), /--brand: #2e7d32;/);
    const basic = (pw) => ({ headers: { Authorization: 'Basic ' + Buffer.from(`admin:${pw}`).toString('base64') } });
    assert.equal((await fetch(base + '/api/settings', basic('sandi-laptop-2'))).status, 200);
    assert.equal((await fetch(base + '/api/settings', basic('salah-salah-1'))).status, 401);
    assert.ok(fs.existsSync(path.join(dir, 'data', 'users.json')), 'data harus ditulis ke folder pasang');
  } finally {
    child.kill('SIGTERM');
    await new Promise((ok) => child.once('exit', ok));
  }
});
