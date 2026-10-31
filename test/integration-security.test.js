// Tes integrasi keamanan: login + CSRF, header keamanan, /healthz, /api/me, brute force, 413/400.
// Menjalankan server.js sungguhan. Nama tes bertanda [butuh A#] bergantung pada pekerjaan agen lain
// dan boleh gagal sebelum semua hasil agen digabung.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, Client, ROOT, basicAuth, USER } from './helpers/server.js';

let srv;
before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv?.stop();
});

test('tanpa login: /api/* 401 JSON, halaman diarahkan ke /login', async () => {
  const c = new Client(srv.base, { mode: 'session' });
  const api = await c.get('/api/leads');
  assert.equal(api.status, 401);
  const page = await c.get('/');
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location') || '', /\/login/);
});

test('login salah ditolak, login benar memberi cookie sesi HttpOnly', async () => {
  const bad = new Client(srv.base);
  const r1 = await bad.login(USER, 'salah-total');
  assert.ok(r1.status === 302 || r1.status === 401 || r1.status === 403, `status ${r1.status}`);
  assert.ok(!bad.jar.has('session'), 'sesi tidak boleh dibuat untuk sandi salah');

  const c = new Client(srv.base);
  const r2 = await c.login();
  assert.ok([200, 302].includes(r2.status), `status ${r2.status}`);
  assert.ok(c.jar.has('session'), 'cookie session harus ada');
  const sc = (r2.headers.getSetCookie?.() || []).find((l) => l.startsWith('session='));
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /SameSite=(Lax|Strict)/i);
});

test('[butuh A3] login memberi cookie csrf non-HttpOnly (K2)', async () => {
  const c = new Client(srv.base);
  const r = await c.login();
  const line = (r.headers.getSetCookie?.() || []).find((l) => l.startsWith('csrf='));
  assert.ok(line, 'cookie csrf tidak ada');
  assert.doesNotMatch(line, /HttpOnly/i);
});

test('[butuh A3] GET /api/me -> {user, role, csrfToken} dan csrfToken = cookie csrf (K2)', async () => {
  const c = new Client(srv.base);
  await c.login();
  const me = await c.get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(typeof me.json.user, 'string');
  assert.ok(['admin', 'agent'].includes(me.json.role), `role: ${me.json.role}`);
  assert.equal(typeof me.json.csrfToken, 'string');
  assert.equal(me.json.csrfToken, decodeURIComponent(c.jar.get('csrf')));
  const unauth = await new Client(srv.base).get('/api/me');
  assert.equal(unauth.status, 401);
});

test('[butuh A3] CSRF: POST tanpa/ salah header -> 403 {error:"CSRF"}, dengan header benar lolos (K2)', async () => {
  const c = new Client(srv.base);
  await c.login();
  const body = { phone: '628100000001' };
  const none = await c.post('/api/tester/reset', body, { noCsrf: true });
  assert.equal(none.status, 403);
  assert.equal(none.json?.error, 'CSRF');
  const wrong = await c.post('/api/tester/reset', body, { noCsrf: true, headers: { 'X-CSRF-Token': 'salah' } });
  assert.equal(wrong.status, 403);
  const ok = await c.post('/api/tester/reset', body);
  assert.equal(ok.status, 200);
});

test('[butuh A3] Basic Auth tidak butuh CSRF (K2)', async () => {
  const c = new Client(srv.base, { mode: 'basic' });
  const r = await c.post('/api/tester/reset', { phone: '628100000002' });
  assert.equal(r.status, 200);
});

test('[butuh A3] logout memakai CSRF dan mematikan sesi', async () => {
  const c = new Client(srv.base);
  await c.login();
  const noToken = await c.req('POST', '/logout', { noCsrf: true });
  assert.equal(noToken.status, 403);
  const out = await c.req('POST', '/logout');
  assert.ok([200, 302].includes(out.status), `status ${out.status}`);
  const after = await c.get('/api/me');
  assert.equal(after.status, 401);
});

test('[butuh A3] header keamanan + CSP sesuai K3', async () => {
  const c = new Client(srv.base);
  await c.login();
  for (const url of ['/', '/login']) {
    const r = await c.get(url);
    const csp = r.headers.get('content-security-policy') || '';
    assert.ok(csp, `CSP tidak ada di ${url}`);
    const dir = (n) => (csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(n + ' ')) || '');
    assert.match(dir('script-src'), /'self'/);
    assert.doesNotMatch(dir('script-src'), /unsafe-inline|unsafe-eval|https?:/);
    assert.match(dir('frame-ancestors'), /'none'/);
    assert.match(dir('connect-src'), /'self'/);
    assert.match(dir('img-src'), /data:/);
    assert.match(dir('img-src'), /blob:/);
    assert.match(dir('media-src'), /blob:/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('[butuh A3] /healthz publik, cepat, dan tidak membocorkan data', async () => {
  const r = await new Client(srv.base).get('/healthz');
  assert.equal(r.status, 200);
  assert.ok(r.text.length < 2000);
  assert.doesNotMatch(r.text, /sandi-uji|password|auth/i);
});

test('[butuh A5] HTML bebas skrip inline dan atribut on*= (CSP K3)', () => {
  for (const f of ['public/index.html', 'public/login.html']) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) && body.trim());
    assert.equal(inline.length, 0, `${f}: ada <script> inline`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, `${f}: ada atribut event inline`);
    assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//i, `${f}: ada aset eksternal/CDN`);
  }
});

test('[butuh A5] index.html memuat /assets/css/tailwind.css', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /\/assets\/css\/tailwind\.css/);
});

test('[butuh A3] body terlalu besar -> 413; JSON rusak -> 400 (bukan 500 / koneksi putus)', async () => {
  const c = new Client(srv.base, { mode: 'basic' });
  const bad = await c.req('POST', '/api/tester/send', { raw: '{bukan json', headers: { 'Content-Type': 'application/json' } });
  assert.equal(bad.status, 400, bad.text);
  assert.ok(bad.json?.error);

  const huge = JSON.stringify({ phone: '628100000003', text: 'x'.repeat(3 * 1024 * 1024) });
  let res;
  try {
    res = await c.req('POST', '/api/tester/send', { raw: huge, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    assert.fail(`koneksi diputus tanpa respons 413: ${e.message}`);
  }
  assert.equal(res.status, 413, res.text.slice(0, 200));
});

test('IP klien: X-Forwarded-For diabaikan bila TRUST_PROXY tidak aktif [butuh A3]', async () => {
  // 12 percobaan salah dengan XFF berbeda-beda tetap dihitung sebagai satu IP -> harus kena 429
  const s2 = await startServer({ env: { TRUST_PROXY: '0' } });
  try {
    let got429 = false;
    for (let i = 0; i < 40 && !got429; i++) {
      const r = await fetch(s2.base + '/api/me', { headers: { Authorization: basicAuth(USER, 'salah' + i), 'X-Forwarded-For': `10.9.${i}.1` } });
      if (r.status === 429) got429 = true;
    }
    assert.ok(got429, 'XFF palsu berhasil menghindari pembatasan percobaan');
  } finally {
    await s2.stop();
  }
});

test('brute force Basic Auth -> 429 dengan Retry-After [butuh A3]', async () => {
  const s2 = await startServer();
  try {
    let status = 0;
    let last;
    for (let i = 0; i < 60; i++) {
      last = await fetch(s2.base + '/api/me', { headers: { Authorization: basicAuth(USER, 'salah' + i) } });
      status = last.status;
      if (status === 429) break;
    }
    assert.equal(status, 429, 'tidak pernah kena 429 setelah 60 percobaan salah');
    assert.ok(last.headers.get('retry-after'), 'header Retry-After tidak ada');
    // setelah dibatasi, sandi benar pun tidak langsung lolos
    const ok = await fetch(s2.base + '/api/me', { headers: { Authorization: basicAuth() } });
    assert.equal(ok.status, 429);
  } finally {
    await s2.stop();
  }
});
