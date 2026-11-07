// Amnan Connect v1: kunci API, idempotensi, tanda tangan, tautan prefill, antrean webhook (unit, tanpa server).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-connect-'));
process.env.DATA_DIR = dir;
process.env.AMNAN_NO_BG = '1'; // tanpa timer latar; antrean dijalankan manual lewat processDue()
process.env.CLIENT_ID = 'klinik-uji';
const C = await import('../src/connect.js');
const { fill } = await import('../src/bot-plan.js');

const req = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });
let ipN = 0;
const freshIp = () => `10.1.${Math.floor(++ipN / 250)}.${ipN % 250}`;
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

test('createKey: validasi dan bentuk token; hanya hash yang tersimpan', () => {
  assert.throws(() => C.createKey({ name: '', app: 'booking', scopes: ['leads:read'] }), /Nama kunci/);
  assert.throws(() => C.createKey({ name: 'x', app: 'Booking!', scopes: ['leads:read'] }), /app harus/);
  assert.throws(() => C.createKey({ name: 'x', app: 'booking', scopes: [] }), /minimal satu scope/);
  assert.throws(() => C.createKey({ name: 'x', app: 'booking', scopes: ['admin:all'] }), /tidak dikenal/);
  const { key, token } = C.createKey({ name: 'Booking', app: 'booking', scopes: 'leads:read, messages:send', createdBy: 'tes' });
  assert.match(token, /^amk_[0-9a-f]{8}\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(key.scopes, ['leads:read', 'messages:send']);
  assert.equal(key.secretHash, undefined, 'respons publik tidak memuat hash');
  const raw = fs.readFileSync(path.join(dir, 'connect-keys.json'), 'utf8');
  const secret = token.split('.')[1];
  assert.ok(!raw.includes(secret), 'rahasia tidak boleh ada di berkas');
  assert.ok(raw.includes(crypto.createHash('sha256').update(secret).digest('hex')));
});

test('authenticateKey: kunci benar, salah, dicabut, dan pembatas per IP', () => {
  const { key, token } = C.createKey({ name: 'A', app: 'booking', scopes: ['leads:read'] });
  const ip = freshIp();
  const ok = C.authenticateKey(req(token), ip);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.app, { id: key.id, name: 'A', app: 'booking', scopes: ['leads:read'] });

  assert.equal(C.authenticateKey(req(), ip).status, 401);
  assert.equal(C.authenticateKey(req(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')), ip).status, 401);
  assert.equal(C.authenticateKey(req('amk_00000000.' + 'A'.repeat(43)), ip).status, 401);
  assert.equal(C.authenticateKey({ headers: { authorization: `Basic ${token}` } }, ip).status, 401, 'hanya Bearer');

  C.revokeKey(key.id);
  assert.equal(C.authenticateKey(req(token), freshIp()).status, 401, 'kunci dicabut ditolak');
  assert.throws(() => C.revokeKey('ffffffff'), /tidak ditemukan/);

  // tebakan kunci tak dikenal dikunci per IP; kunci sah dari IP yang sama tetap jalan
  const other = C.createKey({ name: 'B', app: 'invoice', scopes: ['leads:read'] });
  const badIp = freshIp();
  const guess = req('amk_00000000.' + 'A'.repeat(43));
  for (let i = 0; i < 5; i++) assert.equal(C.authenticateKey(guess, badIp).status, 401);
  const locked = C.authenticateKey(guess, badIp);
  assert.equal(locked.status, 429, 'setelah 5 kegagalan tebakan dikunci');
  assert.ok(locked.retryAfter > 0);
  assert.equal(C.authenticateKey(req(other.token), badIp).ok, true, 'aplikasi sah di IP yang sama tidak ikut terkunci');

  // kunci lama yang sudah dicabut dan terus dipakai hanya mengunci dirinya sendiri
  const old = C.createKey({ name: 'Lama', app: 'booking', scopes: ['leads:read'] });
  C.revokeKey(old.key.id);
  for (let i = 0; i < 5; i++) C.authenticateKey(req(old.token), badIp);
  assert.equal(C.authenticateKey(req(old.token), badIp).status, 429);
  assert.equal(C.authenticateKey(req(other.token), badIp).ok, true);
});

test('takeMessageQuota: batas harian per kunci dan pengembalian saat gagal', () => {
  const { key } = C.createKey({ name: 'Q', app: 'booking', scopes: ['messages:send'], messagesPerDay: 2 });
  const day = new Date('2026-11-05T03:00:00Z');
  assert.equal(C.takeMessageQuota(key.id, day), true);
  assert.equal(C.takeMessageQuota(key.id, day), true);
  assert.equal(C.takeMessageQuota(key.id, day), false);
  C.refundMessageQuota(key.id, day);
  assert.equal(C.takeMessageQuota(key.id, day), true, 'kuota yang dikembalikan bisa dipakai lagi');
  assert.equal(C.takeMessageQuota(key.id, new Date('2026-11-06T03:00:00Z')), true, 'hari baru, hitungan baru');
});

test('withIdempotency: efek sekali, replay, dan permintaan serentak', async () => {
  let runs = 0;
  const fn = async () => { runs++; await new Promise((r) => setTimeout(r, 30)); return { status: 200, body: { n: runs } }; };
  const [a, b] = await Promise.all([C.withIdempotency('k1', 'kunci-idem-1', fn), C.withIdempotency('k1', 'kunci-idem-1', fn)]);
  assert.equal(runs, 1);
  assert.deepEqual([a.body, b.body], [{ n: 1 }, { n: 1 }]);
  assert.equal([a.replay, b.replay].filter(Boolean).length, 1);
  const c = await C.withIdempotency('k1', 'kunci-idem-1', fn);
  assert.equal(c.replay, true);
  assert.equal(runs, 1);
  const d = await C.withIdempotency('k2', 'kunci-idem-1', fn); // aplikasi lain: ruang kunci terpisah
  assert.equal(d.replay, false);
  assert.equal(runs, 2);

  let fails = 0;
  const flaky = async () => (++fails, { status: 503, body: { error: 'x' } });
  await C.withIdempotency('k1', 'kunci-idem-5xx', flaky);
  await C.withIdempotency('k1', 'kunci-idem-5xx', flaky);
  assert.equal(fails, 2, 'respons 5xx tidak disimpan, jadi boleh dicoba lagi');

  assert.throws(() => C.idemKeyFrom({ headers: { 'idempotency-key': 'pendek' } }, {}), /8-120/);
  assert.equal(C.idemKeyFrom({ headers: {} }, {}), null);

  const idemFile = path.join(dir, 'connect-idem.json');
  let during = '';
  await C.withIdempotency('k1', 'kunci-idem-awal', async () => {
    during = fs.readFileSync(idemFile, 'utf8');
    return { status: 200, body: { ok: true } };
  });
  assert.match(during, /kunci-idem-awal/);
  assert.match(during, /"pending": true/);
  const after = JSON.parse(fs.readFileSync(idemFile, 'utf8'));
  const row = after.entries['k1:kunci-idem-awal'];
  assert.equal(row.pending, undefined);
  assert.equal(row.status, 200);
  const again = await C.withIdempotency('k1', 'kunci-idem-awal', async () => ({ status: 200, body: { ok: false } }));
  assert.equal(again.replay, true);
  assert.equal(again.body.ok, true);
});

test('tanda tangan webhook: valid, dirusak, kedaluwarsa', () => {
  const secret = 'whsec_contoh';
  const body = JSON.stringify({ a: 1 });
  const now = 1_800_000_000_000;
  const ts = Math.floor(now / 1000);
  const sig = C.signPayload(secret, ts, body);
  assert.match(sig, /^v1=[0-9a-f]{64}$/);
  assert.equal(C.verifySignature(secret, ts, body, sig, { now }), true);
  assert.equal(C.verifySignature(secret, ts, body + ' ', sig, { now }), false, 'body berubah');
  assert.equal(C.verifySignature('whsec_lain', ts, body, sig, { now }), false, 'rahasia lain');
  assert.equal(C.verifySignature(secret, ts, body, sig, { now: now + 301_000 }), false, 'lewat 5 menit');
  assert.equal(C.verifySignature(secret, ts, body, 'v1=abc', { now }), false);
  assert.equal(C.verifySignature(secret, 'x', body, sig, { now }), false);
});

test('checkWebhookUrl: https publik saja, kecuali operator mengizinkan privat', () => {
  assert.equal(C.checkWebhookUrl('https://book.klinik.com/hook'), 'https://book.klinik.com/hook');
  for (const u of ['http://book.klinik.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.2/x',
    'https://169.254.169.254/x', 'https://[::1]/x', 'https://[fd00::1]/x', 'https://[::ffff:10.0.0.1]/x', 'https://user:pw@book.klinik.com/x',
    'https://app.internal/x', 'ftp://x.com/x', 'bukan url', 'https://100.64.0.1/x']) {
    assert.throws(() => C.checkWebhookUrl(u), /URL webhook/, u);
  }
  process.env.CONNECT_ALLOW_PRIVATE_URLS = '1';
  try {
    assert.equal(C.checkWebhookUrl('http://127.0.0.1:8201/hook'), 'http://127.0.0.1:8201/hook');
  } finally {
    delete process.env.CONNECT_ALLOW_PRIVATE_URLS;
  }
});

test('tautan prefill {booking}: bertanda tangan, kedaluwarsa, dan tak dikonfigurasi', () => {
  const conv = { phone: '6281234567890', name: 'Siti' };
  const S = { botName: 'Bot', adminName: 'Admin' };
  assert.equal(fill('Booking: {booking}', conv, S), 'Booking: {booking}', 'tanpa env, placeholder dibiarkan');

  process.env.BOOKING_URL = 'https://book.klinik.com/';
  process.env.BOOKING_LINK_SECRET = 'rahasia-bersama-16x';
  try {
    const out = fill('Booking: {booking}', conv, S);
    const link = out.slice('Booking: '.length);
    assert.match(link, /^https:\/\/book\.klinik\.com\/\?c=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const [payload, mac] = new URL(link).searchParams.get('c').split('.');
    const expect = crypto.createHmac('sha256', 'rahasia-bersama-16x').update(payload).digest('base64url');
    assert.equal(mac, expect);
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    assert.equal(data.p, '6281234567890');
    assert.equal(data.n, 'Siti');
    assert.ok(data.exp > Date.now() / 1000 + 11 * 3600 && data.exp < Date.now() / 1000 + 13 * 3600, 'bawaan 12 jam');
    assert.equal(fill('{BOOKING}', { phone: 'lid-123' }, S), '{BOOKING}', 'tanpa nomor valid tidak dibuat tautan');
  } finally {
    delete process.env.BOOKING_URL;
    delete process.env.BOOKING_LINK_SECRET;
  }
});

test('antrean webhook: terkirim bertanda tangan, retry berjenjang, dibuang setelah 6 percobaan, nonaktif otomatis', async () => {
  C._resetCaches();
  process.env.CONNECT_ALLOW_PRIVATE_URLS = '1';
  const calls = [];
  let mode = 'ok';
  C.setFetch(async (url, init) => {
    calls.push({ url, init });
    return { status: mode === 'ok' ? 204 : 500, arrayBuffer: async () => new ArrayBuffer(0) };
  });
  try {
    const { webhook, secret } = C.createWebhook({ name: 'Booking', url: 'http://127.0.0.1:8201/hook', events: ['lead.created'] });
    assert.match(secret, /^whsec_/);
    assert.equal(C.enqueueEvent('lead.hot', { phone: '1' }), 0, 'tipe yang tidak dilanggan diabaikan');
    assert.equal(C.enqueueEvent('lead.created', { phone: '6281', name: 'Siti' }), 1);
    assert.equal(await C.processDue(), 1);
    assert.equal(calls.length, 1);
    const { init } = calls[0];
    assert.equal(init.redirect, 'manual');
    const h = init.headers;
    assert.equal(h['x-amnan-event'], 'lead.created');
    assert.ok(C.verifySignature(secret, h['x-amnan-timestamp'], init.body, h['x-amnan-signature']));
    const evt = JSON.parse(init.body);
    assert.equal(evt.client, 'klinik-uji');
    assert.deepEqual(evt.data, { phone: '6281', name: 'Siti' });
    assert.equal(await C.processDue(), 0, 'terkirim sekali, antrean kosong');

    // gagal terus: 6 percobaan dengan jeda 5s, 30s, 5m, 30m, 2j
    mode = 'fail';
    calls.length = 0;
    const t0 = Date.now();
    C.enqueueEvent('lead.created', { phone: '6282' });
    const delays = [];
    let now = t0 + 1;
    for (let i = 0; i < 8; i++) {
      const n = await C.processDue(now);
      if (!n) break;
      const status = C.deliveries()[0];
      delays.push(status.status);
      now += 2 * 3600_000 + 1_000; // lompat melewati jeda terbesar
    }
    assert.equal(calls.length, 6);
    assert.deepEqual(delays, ['retry', 'retry', 'retry', 'retry', 'retry', 'failed']);
    assert.equal(await C.processDue(now), 0, 'dibuang setelah percobaan terakhir');
    const delivery = calls[0].init.headers['x-amnan-delivery'];
    assert.ok(calls.every((c) => c.init.headers['x-amnan-delivery'] === delivery), 'id pengiriman tetap sama pada percobaan ulang');

    // 50 kegagalan beruntun -> langganan nonaktif otomatis
    assert.equal(C.listWebhooks()[0].active, true);
    for (let i = 0; i < 9; i++) C.enqueueEvent('lead.created', { phone: '628' + i });
    let t = now;
    for (let r = 0; r < 7; r++) { await C.processDue(t); t += 3 * 3600_000; }
    assert.equal(C.listWebhooks()[0].active, false, 'nonaktif setelah >= 50 kegagalan');
    assert.equal(C.enqueueEvent('lead.created', {}), 0, 'tidak ada pengiriman untuk langganan nonaktif');
    assert.equal(C.updateWebhook(webhook.id, { active: true }).failures, 0);
  } finally {
    C.setFetch(null);
    delete process.env.CONNECT_ALLOW_PRIVATE_URLS;
  }
});

test('pengiriman memeriksa ulang DNS: hasil alamat privat tidak dikirimi', async () => {
  C._resetCaches();
  let called = 0;
  C.setFetch(async () => (called++, { status: 200 }));
  C.setLookup(async () => [{ address: '10.0.0.5', family: 4 }]); // domain publik yang di-DNS ke alamat privat
  try {
    const hooks = C.listWebhooks();
    for (const w of hooks) C.removeWebhook(w.id);
    const { webhook } = C.createWebhook({ name: 'Rebind', url: 'https://aman.example.com/hook', events: ['lead.hot'] });
    C.enqueueEvent('lead.hot', { phone: '1' });
    await C.processDue();
    assert.equal(called, 0, 'fetch tidak dipanggil');
    assert.match(C.deliveries()[0].error, /bukan alamat publik/);
    C.removeWebhook(webhook.id);
  } finally {
    C.setFetch(null);
    C.setLookup(null);
  }
});

test('createWebhook: validasi tipe, batas jumlah, dan ping memaksa terkirim', () => {
  C._resetCaches();
  for (const w of C.listWebhooks()) C.removeWebhook(w.id);
  assert.throws(() => C.createWebhook({ name: 'x', url: 'https://a.example.com/x', events: ['lead.hapus'] }), /tidak dikenal/);
  assert.throws(() => C.createWebhook({ name: '', url: 'https://a.example.com/x' }), /Nama webhook/);
  const { webhook } = C.createWebhook({ name: 'Semua', url: 'https://a.example.com/x' });
  assert.ok(webhook.events.includes('lead.created') && !webhook.events.includes('ping'));
  assert.equal(C.pingWebhook(webhook.id), 1, 'ping tetap diantrekan walau tidak dilanggan');
  C.updateWebhook(webhook.id, { active: false });
  assert.throws(() => C.pingWebhook(webhook.id), /nonaktif/);
});

test('pinnedPost: menolak host yang resolve ke alamat privat (DNS rebinding) dan tidak mengikuti redirect', async () => {
  const http = await import('node:http');
  C.setLookup(async () => [{ address: '127.0.0.1', family: 4 }]);
  const old = process.env.CONNECT_ALLOW_PRIVATE_URLS;
  delete process.env.CONNECT_ALLOW_PRIVATE_URLS;
  try {
    await assert.rejects(C.pinnedPost('https://dns-licik.example.com/hook', { body: '{}' }), /bukan alamat publik/);
    // diizinkan privat: redirect 302 tidak diikuti, status dikembalikan apa adanya
    process.env.CONNECT_ALLOW_PRIVATE_URLS = '1';
    let hits = 0;
    const srv = http.createServer((req, res) => { hits++; res.writeHead(302, { location: 'http://127.0.0.1:1/dalam' }).end(); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const r = await C.pinnedPost(`http://127.0.0.1:${srv.address().port}/x`, { body: '{}' });
    assert.equal(r.status, 302);
    assert.equal(hits, 1);
    await new Promise((r2) => srv.close(r2));
  } finally {
    C.setLookup(null);
    if (old === undefined) delete process.env.CONNECT_ALLOW_PRIVATE_URLS; else process.env.CONNECT_ALLOW_PRIVATE_URLS = old;
  }
});
