// Uji keamanan end-to-end: menjalankan server.js sebagai proses terpisah dari folder lain.
// Cakupan: brute force Basic+form, XFF palsu, CSRF, header, 413, 400, 500 tanpa bocor, peran agent,
// sesi bertahan setelah restart, healthz, audit, shutdown, galat tak tertangkap, CLI pengguna.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(REPO, 'server.js');
const CLI = path.join(REPO, 'scripts', 'users.js');
const PASS = 'rahasia123';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// Modul API tambahan khusus tes (dimuat lewat API_EXTRA_DIR sebelum _legacy)
const EXTRA = tmp('amnan-sec-extra-');
fs.writeFileSync(
  path.join(EXTRA, 'zz-tes.js'),
  `export async function handle(req, res, url, ctx) {
  const p = url.pathname;
  if (p === '/api/boom') throw new Error('rahasia-internal-jangan-bocor');
  if (p === '/api/reject') { Promise.reject(new Error('ditolak-diam-diam')); ctx.sendJSON(res, 200, { ok: true }); return true; }
  if (p === '/api/echo' || p === '/api/settings/echo') { const b = await ctx.readBody(req); ctx.sendJSON(res, 200, { n: JSON.stringify(b).length }); return true; }
  if (p === '/api/only-admin') { if (!ctx.requireRole('admin')) return true; ctx.sendJSON(res, 200, { ok: true }); return true; }
  if (p === '/api/who') { ctx.sendJSON(res, 200, { user: ctx.user, ip: ctx.ip }); return true; }
  return false;
}
`
);

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// Windows tidak punya sinyal POSIX: kill('SIGTERM'/'SIGINT') mematikan paksa (kode keluar null). Shutdown rapi diuji hanya di Linux/macOS.
const WIN = process.platform === 'win32';

const CLEAN_ENV = ['TRUST_PROXY', 'ALLOW_NO_AUTH', 'DASHBOARD_PASSWORD', 'DASHBOARD_PASSWORD_HASH', 'DASHBOARD_USER', 'DATA_DIR', 'APP_DIR', 'LOGIN_MAX_FAILS', 'LOGIN_LOCK_BASE_SEC', 'LOGIN_LOCK_MAX_SEC'];

/** Akar aplikasi sementara: public/config disalin lewat symlink, data/ dibuat server sendiri. */
function makeApp() {
  const dir = tmp('amnan-sec-app-');
  fs.symlinkSync(path.join(REPO, 'public'), path.join(dir, 'public'), 'junction'); // 'junction': tanpa hak admin di Windows
  fs.symlinkSync(path.join(REPO, 'config'), path.join(dir, 'config'), 'junction');
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(dir, 'package.json'));
  return dir;
}

async function start({ app = makeApp(), env = {}, password = PASS } = {}) {
  const port = await freePort();
  const e = { ...process.env };
  for (const k of CLEAN_ENV) delete e[k];
  Object.assign(e, { APP_DIR: app, PORT: String(port), DISABLE_WA: '1', API_EXTRA_DIR: EXTRA }, password ? { DASHBOARD_PASSWORD: password } : {}, env);
  const proc = spawn(process.execPath, [SERVER], { cwd: os.tmpdir(), env: e }); // sengaja dari folder lain
  const S = { app, port, base: `http://127.0.0.1:${port}`, proc, log: '', exited: null };
  proc.stdout.on('data', (d) => (S.log += d));
  proc.stderr.on('data', (d) => (S.log += d));
  S.exit = new Promise((r) => proc.on('exit', (code, sig) => r((S.exited = { code, sig }))));
  for (let i = 0; i < 100; i++) {
    if (S.exited) throw new Error('server berhenti saat start:\n' + S.log);
    try {
      if ((await fetch(S.base + '/healthz')).ok) return S;
    } catch {
      /* belum siap */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server tidak siap:\n' + S.log);
}

async function stop(S, sig = 'SIGTERM') {
  if (!S.exited) S.proc.kill(sig);
  return S.exit;
}

const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

async function call(S, p, { method = 'GET', headers = {}, body, cookie, auth, json } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (auth) h.authorization = auth;
  let payload = body;
  if (json !== undefined) {
    payload = JSON.stringify(json);
    h['content-type'] = 'application/json';
  }
  const r = await fetch(S.base + p, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* bukan JSON */
  }
  return { status: r.status, headers: r.headers, text, data, cookies: r.headers.getSetCookie() };
}

const cookieJar = (cookies) =>
  Object.fromEntries(cookies.map((c) => c.split(';')[0]).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));

async function formLogin(S, username, password, headers = {}) {
  return call(S, '/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ username, password }).toString() });
}

/** Login form -> { cookie, csrf, headers untuk request tulis } */
async function session(S, username = 'admin', password = PASS) {
  const r = await formLogin(S, username, password);
  assert.equal(r.status, 302, 'login harus berhasil: ' + r.text);
  const jar = cookieJar(r.cookies);
  return { cookie: `session=${jar.session}; csrf=${jar.csrf}`, csrf: jar.csrf, jar, res: r, write: { 'x-csrf-token': jar.csrf } };
}

const cli = (app, ...args) => {
  const e = { ...process.env, APP_DIR: app };
  for (const k of CLEAN_ENV) if (k !== 'APP_DIR') delete e[k];
  return spawnSync(process.execPath, [CLI, ...args], { cwd: os.tmpdir(), env: e, encoding: 'utf8' });
};

// ================================================================ server bersama

let M; // server utama
before(async () => {
  M = await start();
});
after(async () => {
  await stop(M);
});

test('header keamanan ada di semua jenis respons (K3)', async () => {
  for (const p of ['/login', '/healthz', '/api/me', '/assets/css/login.css', '/tidak-ada']) {
    const r = await call(M, p);
    const csp = r.headers.get('content-security-policy');
    assert.ok(csp, `CSP hilang di ${p}`);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), 'script-src tidak boleh unsafe-inline');
    assert.match(csp, /style-src 'self' 'unsafe-inline'/);
    assert.match(csp, /img-src 'self' data: blob:/);
    assert.match(csp, /media-src 'self' blob:/);
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY', p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer', p);
    assert.ok(r.headers.get('permissions-policy'), p);
    assert.equal(r.headers.get('strict-transport-security'), null, 'HSTS tidak dikirim lewat HTTP biasa');
  }
  // X-Forwarded-Proto dari klien tidak dipercaya tanpa TRUST_PROXY
  const spoof = await call(M, '/healthz', { headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(spoof.headers.get('strict-transport-security'), null);
});

test('login.html bebas <style>/<script> inline dan atribut on*; aset login terbuka tanpa login', async () => {
  const html = (await call(M, '/login')).text;
  assert.ok(!/<style[\s>]/i.test(html), 'ada <style> inline');
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), 'ada <script> inline');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'ada atribut on*');
  assert.match(html, /\/assets\/css\/login\.css/);
  assert.match(html, /\/assets\/js\/login\.js/);
  assert.equal((await call(M, '/assets/css/login.css')).status, 200);
  const js = await call(M, '/assets/js/login.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  // aset lain tetap butuh login
  assert.equal((await call(M, '/assets/js/app.js')).status, 302);
  assert.equal((await call(M, '/index.html')).status, 302);
  assert.equal((await call(M, '/api/me')).status, 401);
});

test('login form: cookie sesi HttpOnly + cookie csrf; /api/me sesuai K2', async () => {
  const s = await session(M);
  const raw = s.res.cookies;
  const sess = raw.find((c) => c.startsWith('session='));
  const csrf = raw.find((c) => c.startsWith('csrf='));
  assert.match(sess, /HttpOnly/);
  assert.match(sess, /SameSite=Lax/);
  assert.ok(!/HttpOnly/i.test(csrf), 'cookie csrf harus bisa dibaca JS');
  assert.equal(s.res.headers.get('location'), '/');

  const me = await call(M, '/api/me', { cookie: s.cookie });
  assert.equal(me.status, 200);
  assert.deepEqual(me.data, { user: 'admin', role: 'admin', csrfToken: s.csrf });

  // halaman dashboard terbuka untuk yang sudah login
  assert.equal((await call(M, '/', { cookie: s.cookie })).status, 200);
  // Basic Auth: csrfToken null
  const b = await call(M, '/api/me', { auth: basic('admin', PASS) });
  assert.deepEqual(b.data, { user: 'admin', role: 'admin', csrfToken: null });
});

test('CSRF: tulis dengan cookie tanpa/ salah header -> 403 {error:"CSRF"}; Basic Auth tidak butuh CSRF', async () => {
  const s = await session(M);
  const body = { name: 'csrf-a', password: PASS, role: 'agent' };
  const none = await call(M, '/api/users', { method: 'POST', cookie: s.cookie, json: body });
  assert.equal(none.status, 403);
  assert.deepEqual(none.data, { error: 'CSRF' });
  const wrong = await call(M, '/api/users', { method: 'POST', cookie: s.cookie, headers: { 'x-csrf-token': 'x'.repeat(64) }, json: body });
  assert.equal(wrong.status, 403);
  // cookie csrf dipalsukan + header sama: tetap ditolak karena tidak terikat ke sesi
  const forged = 'f'.repeat(64);
  const f = await call(M, '/api/users', { method: 'POST', cookie: `${s.cookie.split(';')[0]}; csrf=${forged}`, headers: { 'x-csrf-token': forged }, json: body });
  assert.equal(f.status, 403);
  for (const m of ['PUT', 'PATCH', 'DELETE']) {
    assert.equal((await call(M, '/api/users/csrf-a', { method: m, cookie: s.cookie, json: {} })).status, 403, m);
  }
  const ok = await call(M, '/api/users', { method: 'POST', cookie: s.cookie, headers: s.write, json: body });
  assert.equal(ok.status, 201);
  // GET tidak butuh CSRF
  assert.equal((await call(M, '/api/users', { cookie: s.cookie })).status, 200);
  // Basic Auth
  const viaBasic = await call(M, '/api/users', { method: 'POST', auth: basic('admin', PASS), json: { name: 'csrf-b', password: PASS } });
  assert.equal(viaBasic.status, 201);
  assert.equal(viaBasic.data.user.role, 'agent', 'peran bawaan agent');
});

test('logout memakai CSRF dan mencabut sesi di server', async () => {
  const s = await session(M);
  const no = await call(M, '/logout', { method: 'POST', cookie: s.cookie });
  assert.equal(no.status, 403);
  assert.deepEqual(no.data, { error: 'CSRF' });
  assert.equal((await call(M, '/api/me', { cookie: s.cookie })).status, 200, 'sesi masih hidup setelah logout gagal');
  const out = await call(M, '/logout', { method: 'POST', cookie: s.cookie, headers: s.write });
  assert.equal(out.status, 302);
  assert.equal(out.headers.get('location'), '/login');
  assert.ok(out.cookies.some((c) => /^session=;.*Max-Age=0/.test(c)));
  assert.equal((await call(M, '/api/me', { cookie: s.cookie })).status, 401, 'token lama tidak boleh berlaku lagi');
});

test('413: body melebihi batas -> JSON, bukan koneksi putus; /api/settings* batas 2 MB', async () => {
  const s = await session(M);
  const big = JSON.stringify({ x: 'a'.repeat(157 * 1024) }); // seperti impor 157 KB
  const r = await call(M, '/api/echo', { method: 'POST', cookie: s.cookie, headers: { ...s.write, 'content-type': 'application/json' }, body: big });
  assert.equal(r.status, 413);
  assert.deepEqual(r.data, { error: 'Data terlalu besar (maks 100 KB)' });

  const okSettings = await call(M, '/api/settings/echo', { method: 'POST', cookie: s.cookie, headers: { ...s.write, 'content-type': 'application/json' }, body: big });
  assert.equal(okSettings.status, 200, 'settings boleh sampai 2 MB');
  const huge = JSON.stringify({ x: 'a'.repeat(3 * 1024 * 1024) });
  const r2 = await call(M, '/api/settings/echo', { method: 'POST', cookie: s.cookie, headers: { ...s.write, 'content-type': 'application/json' }, body: huge });
  assert.equal(r2.status, 413);
  assert.equal(r2.data.error, 'Data terlalu besar (maks 2 MB)');
  // server tetap hidup dan melayani
  assert.equal((await call(M, '/healthz')).status, 200);
});

test('400: JSON rusak dan URL rusak (%E0) -> pesan generik, bukan 500', async () => {
  const s = await session(M);
  const bad = await call(M, '/api/echo', { method: 'POST', cookie: s.cookie, headers: { ...s.write, 'content-type': 'application/json' }, body: '{rusak' });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.data, { error: 'JSON tidak valid' });

  const stat = await call(M, '/%E0', { cookie: s.cookie });
  assert.equal(stat.status, 400);
  assert.deepEqual(stat.data, { error: 'Permintaan tidak valid' });
  assert.ok(!/URI malformed/i.test(stat.text));
  const api = await call(M, '/api/users/%E0', { cookie: s.cookie });
  assert.equal(api.status, 400);
  assert.deepEqual(api.data, { error: 'Permintaan tidak valid' });
  // traversal tetap tertutup
  const trav = await call(M, '/..%2f..%2fpackage.json', { cookie: s.cookie });
  assert.ok([400, 403, 404].includes(trav.status));
  assert.ok(!trav.text.includes('"name": "amnan-live"'));
  assert.equal((await call(M, '/%2e%2e/package.json', { cookie: s.cookie })).status === 200, false);
});

test('500: tidak membocorkan err.message; ID kejadian dikirim ke klien dan ada di log server', async () => {
  const s = await session(M);
  const r = await call(M, '/api/boom', { cookie: s.cookie });
  assert.equal(r.status, 500);
  assert.ok(!r.text.includes('rahasia-internal-jangan-bocor'));
  assert.match(r.data.id, /^[0-9a-f]{8}$/);
  assert.ok(M.log.includes(`id=${r.data.id}`), 'ID harus tercatat di log server');
  assert.ok(M.log.includes('rahasia-internal-jangan-bocor'), 'detail galat harus tercatat di server');
});

test('peran agent: ditolak di endpoint admin, diizinkan di endpoint biasa; ctx.requireRole bekerja', async () => {
  const admin = await session(M);
  const mk = await call(M, '/api/users', { method: 'POST', cookie: admin.cookie, headers: admin.write, json: { name: 'agen1', password: PASS, role: 'agent' } });
  assert.equal(mk.status, 201);
  const a = await session(M, 'agen1');

  const me = await call(M, '/api/me', { cookie: a.cookie });
  assert.equal(me.data.role, 'agent');
  for (const [m, p] of [['GET', '/api/users'], ['POST', '/api/users'], ['DELETE', '/api/users/admin'], ['GET', '/api/audit'], ['PUT', '/api/settings'], ['POST', '/api/settings/restore'], ['DELETE', '/api/leads/abc'], ['DELETE', '/api/conversations/628111'], ['POST', '/api/conversations/628111/delete-messages'], ['POST', '/api/wa/logout'], ['DELETE', '/api/data/semua'], ['GET', '/api/only-admin']]) {
    const r = await call(M, p, { method: m, cookie: a.cookie, headers: a.write, json: m === 'GET' ? undefined : {} });
    assert.equal(r.status, 403, `${m} ${p} harus 403, dapat ${r.status}`);
    assert.match(r.data.error, /Akses ditolak/);
  }
  // endpoint biasa tetap boleh
  assert.equal((await call(M, '/api/who', { cookie: a.cookie })).data.user.name, 'agen1');
  assert.equal((await call(M, '/api/only-admin', { cookie: admin.cookie })).status, 200);
  // penolakan tercatat di audit
  const log = (await call(M, '/api/audit?q=akses.ditolak', { cookie: admin.cookie })).data.entries;
  assert.ok(log.some((e) => e.user === 'agen1' && e.action === 'akses.ditolak'));
  // agent tidak bisa menaikkan dirinya sendiri
  assert.equal((await call(M, '/api/users/agen1', { method: 'PATCH', cookie: a.cookie, headers: a.write, json: { role: 'admin' } })).status, 403);
});

test('admin: kelola pengguna lewat API (validasi, admin terakhir, tidak hapus diri sendiri)', async () => {
  const s = await session(M);
  const w = { cookie: s.cookie, headers: s.write };
  assert.equal((await call(M, '/api/users', { method: 'POST', ...w, json: { name: 'x', password: PASS } })).status, 400);
  assert.equal((await call(M, '/api/users', { method: 'POST', ...w, json: { name: 'valid1', password: 'pendek' } })).status, 400);
  assert.equal((await call(M, '/api/users', { method: 'POST', ...w, json: { name: 'valid1', password: PASS, role: 'raja' } })).status, 400);
  assert.equal((await call(M, '/api/users', { method: 'POST', ...w, json: { name: 'admin', password: PASS } })).status, 409);
  assert.equal((await call(M, '/api/users/admin', { method: 'DELETE', ...w })).status, 409);
  assert.equal((await call(M, '/api/users/admin', { method: 'PATCH', ...w, json: { role: 'agent' } })).status, 409);
  assert.equal((await call(M, '/api/users/tidak-ada', { method: 'PATCH', ...w, json: { role: 'agent' } })).status, 404);
  assert.equal((await call(M, '/api/users/valid1', { method: 'PATCH', ...w, json: {} })).status, 400);

  await call(M, '/api/users', { method: 'POST', ...w, json: { name: 'hapus-aku', password: PASS } });
  const list = (await call(M, '/api/users', { cookie: s.cookie })).data;
  assert.ok(list.users.some((u) => u.name === 'hapus-aku'));
  assert.ok(!JSON.stringify(list).includes('scrypt'), 'hash tidak boleh dikirim ke klien');
  assert.equal((await call(M, '/api/users/hapus-aku', { method: 'DELETE', ...w })).status, 200);
  assert.equal((await call(M, '/api/users/hapus-aku', { method: 'DELETE', ...w })).status, 404);
  // password lama berhenti berlaku setelah diganti lewat API
  await call(M, '/api/users', { method: 'POST', ...w, json: { name: 'ganti-pw', password: PASS } });
  assert.equal((await call(M, '/api/users/ganti-pw', { method: 'PATCH', ...w, json: { password: 'password-baru-1' } })).status, 200);
  assert.equal((await formLogin(M, 'ganti-pw', PASS)).headers.get('location'), '/login?error=1');
  assert.equal((await formLogin(M, 'ganti-pw', 'password-baru-1')).headers.get('location'), '/');
});

test('audit log: login, logout, kelola pengguna tercatat (siapa, aksi, waktu, IP); tanpa password; GET /api/audit admin', async () => {
  const s = await session(M);
  await call(M, '/logout', { method: 'POST', cookie: s.cookie, headers: s.write });
  const s2 = await session(M);
  const r = await call(M, '/api/audit?limit=500', { cookie: s2.cookie });
  assert.equal(r.status, 200);
  const acts = r.data.entries.map((e) => e.action);
  for (const a of ['login', 'logout', 'user.tambah', 'user.hapus', 'user.ubah']) assert.ok(acts.includes(a), `aksi ${a} tidak tercatat`);
  const e = r.data.entries.find((x) => x.action === 'user.tambah');
  assert.equal(e.user, 'admin');
  assert.equal(e.role, 'admin');
  assert.match(e.ip, /^127\.0\.0\.1$/);
  assert.ok(!Number.isNaN(Date.parse(e.ts)));
  assert.ok(r.data.dates.includes(r.data.date));

  const file = path.join(M.app, 'data', 'audit', `${r.data.date}.jsonl`);
  assert.ok(fs.existsSync(file), 'file audit harian harus ada di data/audit/');
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(PASS) && !raw.includes('password-baru-1'), 'password tidak boleh masuk audit');
  assert.equal((await call(M, '/api/audit?date=bukan-tanggal', { cookie: s2.cookie })).status, 400);
});

test('/healthz tanpa login, tanpa data sensitif', async () => {
  const r = await call(M, '/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.data).sort(), ['status', 'uptime', 'version', 'wa']);
  assert.equal(r.data.status, 'ok');
  assert.equal(r.data.version, JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version);
  assert.deepEqual(Object.keys(r.data.wa), ['status']);
  assert.equal((await call(M, '/healthz', { method: 'POST' })).status, 302, 'hanya GET/HEAD yang publik');
});

test('path relatif ke akar aplikasi: server dijalankan dari folder lain, data masuk ke APP_DIR/data', async () => {
  assert.ok(fs.existsSync(path.join(M.app, 'data', 'users.json')));
  assert.ok(fs.existsSync(path.join(M.app, 'data', 'sessions.json')));
  assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'data', 'users.json')), 'tidak boleh menulis ke cwd');
  const users = JSON.parse(fs.readFileSync(path.join(M.app, 'data', 'users.json'), 'utf8'));
  assert.ok(users.users[0].hash.startsWith('scrypt$'), 'password harus berupa hash, bukan teks');
  assert.ok(!fs.readFileSync(path.join(M.app, 'data', 'users.json'), 'utf8').includes(PASS));
});

test('ctx.ip memakai IP soket dan mengabaikan X-Forwarded-For palsu (TRUST_PROXY=0)', async () => {
  const s = await session(M);
  const r = await call(M, '/api/who', { cookie: s.cookie, headers: { 'x-forwarded-for': '6.6.6.6' } });
  assert.equal(r.data.ip, '127.0.0.1');
});

// ================================================================ brute force & XFF (server terpisah)

test('brute force Basic Auth: 429 setelah 5 salah (bukan 60x 401); kredensial benar pun ditolak saat terkunci', async () => {
  const S = await start();
  try {
    const codes = [];
    for (let i = 0; i < 60; i++) codes.push((await call(S, '/api/me', { auth: basic('admin', 'salah' + i) })).status);
    assert.equal(codes.filter((c) => c === 401).length, 5, 'hanya 5 percobaan pertama yang dievaluasi');
    assert.equal(codes.filter((c) => c === 429).length, 55);
    assert.deepEqual(codes.slice(0, 6), [401, 401, 401, 401, 401, 429]);

    const locked = await call(S, '/api/me', { auth: basic('admin', PASS) });
    assert.equal(locked.status, 429, 'password benar tidak boleh lolos saat IP terkunci');
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
    assert.match(locked.data.error, /Terlalu banyak percobaan/);

    // XFF palsu tidak membuka kunci (TRUST_PROXY default 0)
    for (const xff of ['8.8.8.8', '1.2.3.4, 5.6.7.8', '::1']) {
      const r = await call(S, '/api/me', { auth: basic('admin', PASS), headers: { 'x-forwarded-for': xff } });
      assert.equal(r.status, 429, `XFF ${xff} lolos!`);
    }
    // form login juga terkunci karena pembatas yang sama
    const f = await formLogin(S, 'admin', PASS, { 'x-forwarded-for': '9.9.9.9' });
    assert.equal(f.status, 429);

    // sesi yang sudah ada tetap berfungsi (hanya percobaan login yang dibatasi)
    assert.ok(S.log.includes('login GAGAL via=basic'), 'kegagalan harus dicatat di log');
    const audit = fs.readFileSync(path.join(S.app, 'data', 'audit', fs.readdirSync(path.join(S.app, 'data', 'audit'))[0]), 'utf8');
    assert.match(audit, /"action":"login.gagal"/);
    assert.match(audit, /"action":"login.dikunci"/);
    assert.ok(!audit.includes('salah3'), 'password yang dicoba tidak boleh dicatat');
  } finally {
    await stop(S);
  }
});

test('brute force form login: 5 salah -> 429; username juga dibatasi', async () => {
  const S = await start();
  try {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const r = await formLogin(S, 'admin', 'salah' + i);
      out.push(r.status === 302 ? r.headers.get('location') : r.status);
    }
    assert.deepEqual(out, ['/login?error=1', '/login?error=1', '/login?error=1', '/login?error=1', '/login?error=1', 429, 429, 429]);
    assert.equal((await formLogin(S, 'admin', PASS)).status, 429);
    const r = await formLogin(S, 'admin', PASS);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    // Basic Auth dari IP yang sama ikut terkunci (satu pembatas untuk keduanya)
    assert.equal((await call(S, '/api/me', { auth: basic('admin', PASS) })).status, 429);
  } finally {
    await stop(S);
  }
});

test('backoff eksponensial pada server nyata: kunci memanjang setelah kunci pertama lewat', async () => {
  const S = await start({ env: { LOGIN_MAX_FAILS: '2', LOGIN_LOCK_BASE_SEC: '1', LOGIN_LOCK_MAX_SEC: '60' } });
  try {
    await call(S, '/api/me', { auth: basic('admin', 'x1') });
    await call(S, '/api/me', { auth: basic('admin', 'x2') }); // gagal ke-2: kunci 1 detik
    const a = await call(S, '/api/me', { auth: basic('admin', PASS) });
    assert.equal(a.status, 429);
    assert.equal(a.headers.get('retry-after'), '1');
    await new Promise((r) => setTimeout(r, 1150));
    assert.equal((await call(S, '/api/me', { auth: basic('admin', 'x3') })).status, 401); // gagal ke-3: kunci 2 detik
    const b = await call(S, '/api/me', { auth: basic('admin', PASS) });
    assert.equal(b.status, 429);
    assert.equal(b.headers.get('retry-after'), '2');
    await new Promise((r) => setTimeout(r, 2150));
    assert.equal((await call(S, '/api/me', { auth: basic('admin', PASS) })).status, 200, 'setelah kunci lewat, login benar berhasil');
  } finally {
    await stop(S);
  }
});

test('TRUST_PROXY=1: IP diambil dari kanan; entri kiri XFF yang dipalsukan tidak menghindari kunci; per-username lintas IP', async () => {
  const S = await start({ env: { TRUST_PROXY: '1' } });
  try {
    const via = (ip, spoof = '') => ({ 'x-forwarded-for': spoof ? `${spoof}, ${ip}` : ip });
    // (a) satu IP nyata (kanan) dengan entri kiri berganti-ganti + username berganti-ganti
    for (let i = 0; i < 5; i++) {
      const r = await call(S, '/api/me', { auth: basic('user' + i, 'salah'), headers: via('10.0.0.1', `1.1.1.${i}`) });
      assert.equal(r.status, 401);
    }
    const blocked = await call(S, '/api/me', { auth: basic('lain', 'salah'), headers: via('10.0.0.1', '77.77.77.77') });
    assert.equal(blocked.status, 429, 'ganti entri kiri XFF tidak boleh menghindari kunci IP');
    // IP nyata lain tidak terdampak
    assert.equal((await call(S, '/api/me', { auth: basic('admin', PASS), headers: via('10.0.0.2') })).status, 200);

    // (b) satu username diserang dari banyak IP -> kunci per-username
    for (let i = 0; i < 5; i++) {
      assert.equal((await call(S, '/api/me', { auth: basic('admin', 'salah' + i), headers: via(`10.0.1.${i}`) })).status, 401);
    }
    const u = await call(S, '/api/me', { auth: basic('admin', PASS), headers: via('10.0.1.99') });
    assert.equal(u.status, 429, 'username terkunci walau IP-nya baru');

    // (c) HSTS & cookie Secure hanya bila proxy melaporkan https
    const h = await call(S, '/healthz', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '10.0.2.1' } });
    assert.match(h.headers.get('strict-transport-security') || '', /max-age=\d+/);
    const l = await call(S, '/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-proto': 'https', 'x-forwarded-for': '10.0.2.2' }, body: new URLSearchParams({ username: 'agen-xx', password: 'x' }).toString() });
    assert.equal(l.status, 302);
  } finally {
    await stop(S);
  }
});

test('TRUST_PROXY=1: cookie Secure saat https, ctx.ip dari proxy', async () => {
  const S = await start({ env: { TRUST_PROXY: '1' } });
  try {
    const r = await formLogin(S, 'admin', PASS, { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.50' });
    assert.equal(r.status, 302);
    assert.ok(r.cookies.every((c) => /; Secure/.test(c)), 'semua cookie harus Secure di https');
    const plain = await formLogin(S, 'admin', PASS, { 'x-forwarded-proto': 'http', 'x-forwarded-for': '203.0.113.51' });
    assert.ok(plain.cookies.every((c) => !/; Secure/.test(c)));
    const jar = cookieJar(r.cookies);
    const who = await call(S, '/api/who', { cookie: `session=${jar.session}; csrf=${jar.csrf}`, headers: { 'x-forwarded-for': '1.1.1.1, 198.51.100.77' } });
    assert.equal(who.data.ip, '198.51.100.77');
  } finally {
    await stop(S);
  }
});

// ================================================================ restart, proses, CLI

test('sesi bertahan setelah server restart; token tidak tersimpan mentah', async () => {
  const app = makeApp();
  let S = await start({ app });
  const s = await session(S);
  assert.equal((await call(S, '/api/me', { cookie: s.cookie })).status, 200);
  const code = await stop(S);
  if (!WIN) {
    assert.equal(code.code, 0, 'shutdown SIGTERM harus keluar bersih');
    assert.match(S.log, /berhenti \(SIGTERM\)/);
  }

  const disk = fs.readFileSync(path.join(app, 'data', 'sessions.json'), 'utf8');
  assert.ok(!disk.includes(s.jar.session), 'token sesi mentah tidak boleh ada di sessions.json');

  S = await start({ app });
  try {
    const me = await call(S, '/api/me', { cookie: s.cookie });
    assert.equal(me.status, 200, 'sesi harus tetap berlaku setelah restart');
    assert.equal(me.data.csrfToken, s.csrf);
    // CSRF lama tetap valid untuk tulis
    assert.equal((await call(S, '/api/users', { method: 'POST', cookie: s.cookie, headers: s.write, json: { name: 'pasca-restart', password: PASS } })).status, 201);
  } finally {
    await stop(S);
  }
});

test('CLI users + sesi lama batal bila password diganti / pengguna dihapus', async () => {
  const app = makeApp();
  const S = await start({ app });
  try {
    let r = cli(app, 'add', 'siti', '--role', 'agent', '--password', PASS);
    assert.equal(r.status, 0, r.stderr);
    r = cli(app, 'list');
    assert.match(r.stdout, /siti\s+agent/);
    assert.match(r.stdout, /admin\s+admin/);
    assert.notEqual(cli(app, 'add', 'siti', '--password', PASS).status, 0, 'nama ganda');
    assert.notEqual(cli(app, 'add', 'baru', '--password', 'pendek').status, 0, 'password pendek');
    assert.notEqual(cli(app, 'add', 'baru', '--role', 'dewa', '--password', PASS).status, 0, 'peran tidak valid');
    assert.notEqual(cli(app, 'remove', 'admin').status, 0, 'admin terakhir tidak boleh dihapus');
    assert.notEqual(cli(app, 'remove', 'tidak-ada').status, 0);

    await new Promise((x) => setTimeout(x, 2200)); // cache pengguna server kedaluwarsa
    const sit = await session(S, 'siti');
    assert.equal((await call(S, '/api/me', { cookie: sit.cookie })).data.role, 'agent');

    assert.equal(cli(app, 'passwd', 'siti', '--password', 'password-baru-9').status, 0);
    await new Promise((x) => setTimeout(x, 2200));
    assert.equal((await call(S, '/api/me', { cookie: sit.cookie })).status, 401, 'sesi lama harus batal setelah ganti password');
    assert.equal((await formLogin(S, 'siti', 'password-baru-9')).headers.get('location'), '/');

    const sit2 = await session(S, 'siti', 'password-baru-9');
    assert.equal(cli(app, 'remove', 'siti').status, 0);
    await new Promise((x) => setTimeout(x, 2200));
    assert.equal((await call(S, '/api/me', { cookie: sit2.cookie })).status, 401, 'sesi pengguna terhapus harus batal');

    // password lewat stdin (tidak tampil di argumen proses)
    const piped = spawnSync(process.execPath, [CLI, 'add', 'pipa'], { cwd: os.tmpdir(), env: { ...process.env, APP_DIR: app }, input: PASS + '\n', encoding: 'utf8' });
    assert.equal(piped.status, 0, piped.stderr);
  } finally {
    await stop(S);
  }
});

test('DASHBOARD_PASSWORD_HASH dari env dipakai sebagai admin awal', async () => {
  const app = makeApp();
  const h = cli(app, 'hash', '--password', PASS);
  assert.equal(h.status, 0, h.stderr);
  const hash = h.stdout.trim();
  assert.match(hash, /^scrypt\$/);
  const S = await start({ app, password: '', env: { DASHBOARD_PASSWORD_HASH: hash, DASHBOARD_USER: 'Kepala' } });
  try {
    assert.equal((await call(S, '/api/me', { auth: basic('kepala', PASS) })).data.role, 'admin');
    assert.equal((await call(S, '/api/me', { auth: basic('kepala', 'salah') })).status, 401);
  } finally {
    await stop(S);
  }
  const bad = await start({ app: makeApp(), password: '', env: { DASHBOARD_PASSWORD_HASH: 'bukan-hash' } }).then(
    () => null,
    (e) => e
  );
  assert.ok(bad && /DASHBOARD_PASSWORD_HASH tidak valid/.test(bad.message));
});

test('tanpa pengguna/password server menolak start; ALLOW_NO_AUTH=1 hanya berlaku bila belum ada pengguna', async () => {
  const refused = await start({ app: makeApp(), password: '' }).then(
    () => null,
    (e) => e
  );
  assert.ok(refused && /Belum ada pengguna/.test(refused.message));

  const open = await start({ app: makeApp(), password: '', env: { ALLOW_NO_AUTH: '1' } });
  try {
    const me = await call(open, '/api/me');
    assert.deepEqual(me.data, { user: 'admin', role: 'admin', csrfToken: null });
    assert.equal((await call(open, '/api/echo', { method: 'POST', json: {} })).status, 200, 'mode terbuka tidak butuh CSRF');
  } finally {
    await stop(open);
  }

  const app = makeApp();
  assert.equal(cli(app, 'add', 'satu', '--role', 'admin', '--password', PASS).status, 0);
  const closed = await start({ app, password: '', env: { ALLOW_NO_AUTH: '1' } });
  try {
    assert.equal((await call(closed, '/api/me')).status, 401, 'sudah ada pengguna: ALLOW_NO_AUTH diabaikan');
    assert.equal((await call(closed, '/api/me', { auth: basic('satu', PASS) })).status, 200);
  } finally {
    await stop(closed);
  }
});

test('unhandledRejection: dicatat lalu proses keluar rapi (kode 1); SIGINT keluar 0', async () => {
  const S = await start();
  const s = await session(S);
  const r = await call(S, '/api/reject', { cookie: s.cookie });
  assert.equal(r.status, 200);
  const res = await Promise.race([S.exit, new Promise((x) => setTimeout(() => x('timeout'), 8000))]);
  assert.notEqual(res, 'timeout', 'proses harus berhenti setelah unhandledRejection');
  assert.equal(res.code, 1);
  assert.match(S.log, /unhandledRejection/);
  assert.match(S.log, /ditolak-diam-diam/);

  const T = await start();
  const code = await stop(T, 'SIGINT');
  if (!WIN) {
    assert.equal(code.code, 0);
    assert.match(T.log, /berhenti \(SIGINT\)/);
  }
});
