// Uji unit keamanan (src/auth.js, src/routes.js): hash, pembatas, IP klien, CSRF, audit, sesi, body, dispatcher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-sec-unit-'));
process.env.DATA_DIR = DATA;
delete process.env.TRUST_PROXY;

const A = await import('../src/auth.js');
const R = await import('../src/routes.js');

const fakeReq = (headers = {}, remote = '203.0.113.9') => ({ headers, socket: { remoteAddress: remote } });

test('hash scrypt: benar/salah, salt acak, format rusak ditolak', async () => {
  const h1 = await A.hashPassword('rahasia123');
  const h2 = await A.hashPassword('rahasia123');
  assert.match(h1, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(h1, h2);
  assert.equal(await A.verifyPassword('rahasia123', h1), true);
  assert.equal(await A.verifyPassword('salah', h1), false);
  assert.equal(await A.verifyPassword('x', 'plain-text'), false);
  assert.equal(await A.verifyPassword('x', 'scrypt$999999999$8$1$aa$bb'), false);
  assert.equal(A.isHash(h1), true);
  assert.equal(A.isHash('abc'), false);
});

test('pembatas: backoff eksponensial dengan batas atas', () => {
  let t = 1_000_000;
  const L = A.createLimiter({ free: 3, baseMs: 1000, maxMs: 8000, now: () => t });
  const k = ['ip:1.1.1.1'];
  assert.equal(L.fail(k), 0);
  assert.equal(L.fail(k), 0);
  assert.equal(L.check(k), 0);
  assert.equal(L.fail(k), 1); // gagal ke-3: kunci 1 detik
  assert.equal(L.check(k), 1);
  t += 1001;
  assert.equal(L.check(k), 0);
  assert.equal(L.fail(k), 2); // ke-4: 2 detik
  t += 2001;
  assert.equal(L.fail(k), 4); // ke-5
  t += 4001;
  assert.equal(L.fail(k), 8); // ke-6
  t += 8001;
  assert.equal(L.fail(k), 8); // ke-7: tertahan di batas atas
  L.reset(k);
  assert.equal(L.check(k), 0);
  assert.equal(L.size, 0);
});

test('pembatas: entri kedaluwarsa dibuang (TTL) dan jumlah entri dibatasi', () => {
  let t = 5_000_000;
  const L = A.createLimiter({ free: 2, baseMs: 1000, maxMs: 2000, ttlMs: 10_000, maxEntries: 20, now: () => t });
  L.fail(['u:lama']);
  t += 20_000;
  L.sweep();
  assert.equal(L.size, 0, 'entri lewat TTL harus dibuang');

  // banjir kunci unik: ukuran Map tidak boleh melewati batas
  for (let i = 0; i < 500; i++) L.fail([`ip:10.0.${i >> 8}.${i & 255}`]);
  assert.ok(L.size <= 20, `ukuran ${L.size} melebihi batas`);
  L.fail(['u:baru']);
  assert.ok(L.size <= 20);
  // kegagalan lama (di luar TTL) tidak ikut dihitung lagi
  L.fail(['u:x']);
  t += 20_000;
  assert.equal(L.fail(['u:x']), 0);
});

test('clientIp: TRUST_PROXY=0 mengabaikan X-Forwarded-For', () => {
  delete process.env.TRUST_PROXY;
  assert.equal(A.clientIp(fakeReq({ 'x-forwarded-for': '1.2.3.4' })), '203.0.113.9');
  assert.equal(A.clientIp(fakeReq({}, '::ffff:198.51.100.7')), '198.51.100.7');
  process.env.TRUST_PROXY = '0';
  assert.equal(A.clientIp(fakeReq({ 'x-forwarded-for': '1.2.3.4' })), '203.0.113.9');
});

test('clientIp: TRUST_PROXY=N mengambil entri ke-N dari kanan', () => {
  process.env.TRUST_PROXY = '1';
  assert.equal(A.clientIp(fakeReq({ 'x-forwarded-for': 'palsu, 198.51.100.5' })), '198.51.100.5');
  assert.equal(A.clientIp(fakeReq({ 'x-forwarded-for': '9.9.9.9' })), '9.9.9.9');
  process.env.TRUST_PROXY = '2';
  assert.equal(A.clientIp(fakeReq({ 'x-forwarded-for': '9.9.9.9, 198.51.100.5, 10.0.0.1' })), '198.51.100.5');
  // rantai lebih pendek dari jumlah hop: jangan percaya, pakai alamat soket
  assert.equal(A.clientIp(fakeReq({ 'x-forwarded-for': '9.9.9.9' })), '203.0.113.9');
  // entri bukan IP: pakai soket
  process.env.TRUST_PROXY = '1';
  assert.equal(A.clientIp(fakeReq({ 'x-forwarded-for': '1.1.1.1, <script>' })), '203.0.113.9');
  assert.equal(A.clientIp(fakeReq({ 'x-forwarded-for': '1.1.1.1, [2001:db8::1]:443' })), '2001:db8::1');
  assert.equal(A.clientIp(fakeReq({ 'x-forwarded-for': '1.1.1.1, 198.51.100.5:5555' })), '198.51.100.5');
  assert.equal(A.clientIp(fakeReq({})), '203.0.113.9');
  delete process.env.TRUST_PROXY;
});

test('isHttps hanya percaya X-Forwarded-Proto bila TRUST_PROXY>0', () => {
  delete process.env.TRUST_PROXY;
  assert.equal(A.isHttps(fakeReq({ 'x-forwarded-proto': 'https' })), false);
  process.env.TRUST_PROXY = '1';
  assert.equal(A.isHttps(fakeReq({ 'x-forwarded-proto': 'https' })), true);
  assert.equal(A.isHttps(fakeReq({ 'x-forwarded-proto': 'http' })), false);
  delete process.env.TRUST_PROXY;
});

test('ipKey: IPv6 dikelompokkan per /64', () => {
  assert.equal(A.ipKey('203.0.113.9'), '203.0.113.9');
  assert.equal(A.ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), A.ipKey('2001:db8:1:2::1'));
  assert.notEqual(A.ipKey('2001:db8:1:2::1'), A.ipKey('2001:db8:1:3::1'));
  assert.equal(A.ipKey('::1'), '0:0:0:0');
});

test('CSRF: token terikat sesi, header harus sama dengan cookie', () => {
  const t1 = 'a'.repeat(64);
  const t2 = 'b'.repeat(64);
  assert.equal(A.csrfFor(t1), A.csrfFor(t1));
  assert.notEqual(A.csrfFor(t1), A.csrfFor(t2));
  const csrf = A.csrfFor(t1);
  const ok = fakeReq({ 'x-csrf-token': csrf, cookie: `session=${t1}; csrf=${csrf}` });
  assert.equal(A.csrfOk(ok, { csrf }), true);
  assert.equal(A.csrfOk(fakeReq({ cookie: `csrf=${csrf}` }), { csrf }), false, 'tanpa header');
  assert.equal(A.csrfOk(fakeReq({ 'x-csrf-token': 'x', cookie: `csrf=${csrf}` }), { csrf }), false, 'header salah');
  assert.equal(A.csrfOk(fakeReq({ 'x-csrf-token': csrf }), { csrf }), false, 'tanpa cookie');
  const forged = A.csrfFor(t2);
  assert.equal(A.csrfOk(fakeReq({ 'x-csrf-token': forged, cookie: `csrf=${forged}` }), { csrf }), false, 'cookie sisipan tidak terikat sesi');
});

test('pengguna: tambah, peran, admin terakhir terlindungi, seed dari env', async () => {
  assert.equal(A.hasUsers(), false);
  process.env.DASHBOARD_USER = 'Boss';
  process.env.DASHBOARD_PASSWORD = 'rahasia123';
  assert.equal(await A.seedFromEnv(), true);
  assert.equal(await A.seedFromEnv(), false, 'seed hanya sekali');
  assert.deepEqual(A.listUsers().map((u) => [u.name, u.role]), [['boss', 'admin']]);
  assert.ok(!JSON.stringify(A.listUsers()).includes('scrypt'), 'hash tidak boleh bocor di listUsers');

  await assert.rejects(A.addUser('x', 'rahasia123'), { status: 400 });
  await assert.rejects(A.addUser('budi', 'pendek'), { status: 400 });
  await assert.rejects(A.addUser('budi', 'rahasia123', 'dewa'), { status: 400 });
  await A.addUser('Budi', 'rahasia123', 'agent');
  await assert.rejects(A.addUser('budi', 'rahasia123'), { status: 409 });
  assert.equal(A.getUser('BUDI').role, 'agent');

  assert.throws(() => A.removeUser('boss'), { status: 409 });
  assert.throws(() => A.setRole('boss', 'agent'), { status: 409 });
  A.setRole('budi', 'admin');
  A.setRole('boss', 'agent'); // sekarang ada admin lain
  A.removeUser('boss');
  assert.throws(() => A.removeUser('tidak-ada'), { status: 404 });

  const r = await A.login('203.0.113.1', 'budi', 'rahasia123', 'form');
  assert.deepEqual(r.user, { name: 'budi', role: 'admin' });
  assert.equal((await A.login('203.0.113.2', 'budi', 'salah-banget', 'form')).status, 401);
  assert.equal((await A.login('203.0.113.2', 'tidak-ada', 'salah-banget', 'form')).status, 401);
  delete process.env.DASHBOARD_USER;
  delete process.env.DASHBOARD_PASSWORD;
  process.env.DASHBOARD_PASSWORD_HASH = 'bukan-hash';
  fs.rmSync(path.join(DATA, 'users.json'));
  await new Promise((r) => setTimeout(r, 2100)); // cache pengguna kedaluwarsa
  await assert.rejects(A.seedFromEnv(), /DASHBOARD_PASSWORD_HASH tidak valid/);
  delete process.env.DASHBOARD_PASSWORD_HASH;
});

test('sesi: hanya hash token di disk, bertahan setelah "restart", kedaluwarsa dibersihkan', async () => {
  await A.addUser('sesi', 'rahasia123', 'agent');
  const { token, csrf } = A.createSession({ name: 'sesi' }, '203.0.113.5');
  assert.equal(csrf, A.csrfFor(token));
  const file = fs.readFileSync(path.join(DATA, 'sessions.json'), 'utf8');
  assert.ok(!file.includes(token), 'token mentah tidak boleh tersimpan');
  assert.ok(file.includes(A.csrfFor.name) === false);

  // "restart": instance modul baru membaca sessions.json dari disk
  const B = await import('../src/auth.js?restart=1');
  assert.equal(B.getSession(token)?.user, 'sesi');
  assert.equal(B.getSession('0'.repeat(64)), null);
  assert.equal(B.getSession('bukan-token'), null);

  // kedaluwarsa
  const saved = JSON.parse(file);
  const [h] = Object.keys(saved.sessions);
  saved.sessions[h].exp = Date.now() - 1000;
  fs.writeFileSync(path.join(DATA, 'sessions.json'), JSON.stringify(saved));
  const C = await import('../src/auth.js?restart=2');
  assert.equal(C.getSession(token), null);
  assert.equal(C.sessionCount(), 0, 'sesi kedaluwarsa dibersihkan saat dimuat');

  const s2 = C.createSession({ name: 'sesi' }, '203.0.113.5');
  C.destroySession(s2.token);
  assert.equal(C.getSession(s2.token), null);
});

test('audit: JSONL harian, rahasia disamarkan, baca terbaru dulu, tanggal divalidasi', () => {
  const fileBefore = path.join(DATA, 'audit', `${A.dayStamp()}.jsonl`);
  const before = fs.existsSync(fileBefore) ? fs.readFileSync(fileBefore, 'utf8').trim().split('\n').length : 0;
  A.audit({ user: 'budi', role: 'admin', ip: '203.0.113.1', action: 'tes.satu', detail: { password: 'RAHASIA', token: 'T', nama: 'x' } });
  A.audit({ user: 'budi', ip: '203.0.113.1', action: 'tes.dua\nbaris', detail: 'y'.repeat(5000) });
  const file = path.join(DATA, 'audit', `${A.dayStamp()}.jsonl`);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('RAHASIA'));
  assert.equal(raw.trim().split('\n').length, before + 2, 'satu entri = satu baris (newline di-escape)');
  const out = A.readAudit({});
  assert.equal(out[0].action, 'tes.dua\nbaris');
  assert.equal(out[1].detail.password, '[disembunyikan]');
  assert.equal(out[1].detail.nama, 'x');
  assert.ok(out[0].detail.length <= 1001);
  assert.equal(out[1].ip, '203.0.113.1');
  assert.ok(out[1].ts);
  assert.equal(A.readAudit({ q: 'tes.satu' }).length, 1);
  assert.equal(A.readAudit({ limit: 1 }).length, 1);
  assert.deepEqual(A.readAudit({ date: '2001-01-01' }), []);
  assert.throws(() => A.readAudit({ date: '../../etc/passwd' }), { status: 400 });
  assert.ok(A.auditDates().includes(A.dayStamp()));
});

async function withServer(limit, fn) {
  const server = http.createServer(async (req, res) => {
    try {
      const b = await A.readBody(req, limit);
      res.writeHead(200).end(JSON.stringify({ ok: true, n: JSON.stringify(b).length }));
    } catch (e) {
      res.writeHead(e.status || 500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: e.message }));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

test('readBody: 413 berisi pesan (bukan koneksi putus), 400 untuk JSON rusak', async () => {
  await withServer(100 * 1024, async (base) => {
    const big = JSON.stringify({ x: 'a'.repeat(157 * 1024) });
    const r = await fetch(base, { method: 'POST', body: big });
    assert.equal(r.status, 413);
    assert.deepEqual(await r.json(), { error: 'Data terlalu besar (maks 100 KB)' });
    const huge = await fetch(base, { method: 'POST', body: JSON.stringify({ x: 'a'.repeat(5 * 1024 * 1024) }) });
    assert.equal(huge.status, 413);
    const ok = await fetch(base, { method: 'POST', body: JSON.stringify({ x: 'a'.repeat(50 * 1024) }) });
    assert.equal(ok.status, 200);
    const bad = await fetch(base, { method: 'POST', body: '{rusak' });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'JSON tidak valid' });
    assert.equal((await fetch(base, { method: 'POST', body: 'null' })).status, 400);
    assert.equal((await fetch(base, { method: 'POST', body: '' })).status, 200);
  });
  await withServer(2 * 1024 * 1024, async (base) => {
    const r = await fetch(base, { method: 'POST', body: JSON.stringify({ x: 'a'.repeat(3 * 1024 * 1024) }) });
    assert.equal(r.status, 413);
    assert.equal((await r.json()).error, 'Data terlalu besar (maks 2 MB)');
  });
});

test('adminOnly: peran agent dilarang di endpoint sensitif', () => {
  const deny = [
    ['PUT', '/api/settings'], ['POST', '/api/settings/restore'], ['PATCH', '/api/settings/'],
    ['DELETE', '/api/leads/abc'], ['DELETE', '/api/conversations/628111'], ['POST', '/api/conversations/628111/delete-messages'],
    ['POST', '/api/wa/logout'], ['GET', '/api/users'], ['POST', '/api/users'], ['DELETE', '/api/users/budi'], ['GET', '/api/audit'],
    ['DELETE', '/api/data/customers'], ['POST', '/api/data/import'],
  ];
  const allow = [
    ['GET', '/api/settings'], ['GET', '/api/settings/history'], ['GET', '/api/leads'], ['PATCH', '/api/leads/abc'],
    ['POST', '/api/conversations/628111/send'], ['GET', '/api/conversations/628111'], ['GET', '/api/me'],
    ['GET', '/api/wa/status'], ['POST', '/api/tester/send'], ['GET', '/api/data/export'], ['GET', '/api/events'],
  ];
  for (const [m, p] of deny) assert.equal(R.adminOnly(m, p), true, `${m} ${p} harus admin-only`);
  for (const [m, p] of allow) assert.equal(R.adminOnly(m, p), false, `${m} ${p} harus boleh untuk agent`);
});

test('dispatcher: urutan alfabet, _legacy terakhir, file "_" lain dilewati, modul rusak tidak menjatuhkan server', async () => {
  const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-routes-a-'));
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-routes-b-'));
  const mod = (name) => `export async function handle(req, res, url, ctx) { ctx.calls.push('${name}'); return url.pathname === '/api/${name}'; }`;
  for (const n of ['zeta', 'alpha', '_legacy', 'mid']) fs.writeFileSync(path.join(d1, `${n}.js`), mod(n));
  fs.writeFileSync(path.join(d1, '_helper.js'), mod('helper'));
  fs.writeFileSync(path.join(d1, 'catatan.txt'), 'bukan modul');
  fs.writeFileSync(path.join(d1, 'rusak.js'), 'export const x = ;');
  fs.writeFileSync(path.join(d1, 'tanpa-handle.js'), 'export const x = 1;');
  fs.writeFileSync(path.join(d2, 'extra.js'), mod('extra'));

  const names = R.listModuleFiles([d1, d2]).map((f) => path.basename(f));
  // folder utama dulu (alfabet), lalu folder tambahan, lalu _legacy.js
  assert.deepEqual(names, ['alpha.js', 'mid.js', 'rusak.js', 'tanpa-handle.js', 'zeta.js', 'extra.js', '_legacy.js']);

  const origErr = console.error;
  const origWarn = console.warn;
  console.error = console.warn = () => {};
  const mods = await R.loadModules([d1, d2]);
  console.error = origErr;
  console.warn = origWarn;
  assert.deepEqual(mods.map((m) => m.name), ['alpha.js', 'mid.js', 'zeta.js', 'extra.js', '_legacy.js']);

  const ctx = { calls: [] };
  let hit = null;
  for (const m of mods) {
    if (await m.handle({}, {}, new URL('http://x/api/zeta'), ctx)) {
      hit = m.name;
      break;
    }
  }
  assert.equal(hit, 'zeta.js');
  assert.deepEqual(ctx.calls, ['alpha', 'mid', 'zeta']);

  // dispatcher asli memuat modul A3 dan _legacy
  const real = await R.loadModules([path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'api')]);
  assert.equal(real.at(-1).name, '_legacy.js');
  assert.ok(real.some((m) => m.name === 'auth.js'));
});

test('route: agent ditolak 403 oleh dispatcher walau tidak ada modul yang menangani', async () => {
  let sent = null;
  const ctx = {
    user: { name: 'budi', role: 'agent' },
    requireRole(role) {
      if (role === 'admin' && this.user.role !== 'admin') {
        sent = 403;
        return false;
      }
      return true;
    },
  };
  const url = new URL('http://x/api/settings');
  assert.equal(await R.route({ method: 'PUT' }, {}, url, ctx), true);
  assert.equal(sent, 403);
});
