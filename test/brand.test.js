// Identitas brand per client: warna (palet dari satu warna), logo, favicon. Unit + HTTP end-to-end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, Client, ROOT } from './helpers/server.js';
import * as K from '../public/assets/js/brand-color.js';

// ---------------------------------------------------------------- warna (murni)

test('normalizeHex: #RGB, #RRGGBB, tanpa #, huruf besar; selain itu null', () => {
  assert.equal(K.normalizeHex('#ABC'), '#aabbcc');
  assert.equal(K.normalizeHex(' 0B5FA5 '), '#0b5fa5');
  for (const bad of ['', null, undefined, '#12345', '#gggggg', 'merah', '#1234567']) assert.equal(K.normalizeHex(bad), null, String(bad));
});

test('checkBase: tolak format salah dan warna terlalu terang, terima yang kontras dengan teks putih', () => {
  assert.match(K.checkBase('merah'), /#RRGGBB/);
  for (const light of ['#ffeb3b', '#ffffff', '#e65100', '#777777']) assert.match(K.checkBase(light), /terlalu terang/, light);
  for (const ok of ['#083284', '#0b5fa5', '#2e7d32', '#b71c1c', '#6a1b9a', '#000000']) assert.equal(K.checkBase(ok), null, ok);
});

test('paletteFrom: warna utama = shade 800, makin terang ke 50, lebih gelap di 900, semua hex valid', () => {
  for (const base of ['#083284', '#0b5fa5', '#2e7d32', '#b71c1c', '#6a1b9a', '#111111']) {
    const p = K.paletteFrom(base);
    assert.equal(p[800], base);
    assert.deepEqual(Object.keys(p).map(Number), K.SHADES);
    const lum = K.SHADES.map((k) => K.contrastWithWhite(p[k]));
    for (let i = 1; i < lum.length; i++) assert.ok(lum[i] >= lum[i - 1] - 1e-9, `${base}: kontras harus naik dari shade ${K.SHADES[i - 1]} ke ${K.SHADES[i]}`);
    for (const v of Object.values(p)) assert.match(v, /^#[0-9a-f]{6}$/);
  }
  assert.deepEqual(K.paletteFrom(''), K.DEFAULT_PALETTE);
  assert.deepEqual(K.paletteFrom('bukan warna'), K.DEFAULT_PALETTE);
});

test('cssFor: kosong = komentar saja; berwarna = variabel RGB untuk Tailwind + variabel style.css', () => {
  assert.doesNotMatch(K.cssFor(''), /--brand/);
  const css = K.cssFor('#0b5fa5');
  assert.match(css, /--brand-800-rgb: 11 95 165;/);
  assert.match(css, /--brand: #0b5fa5;/);
  for (const n of K.SHADES) assert.match(css, new RegExp(`--brand-${n}-rgb: \\d+ \\d+ \\d+;`));
  assert.match(css, /--focus: #[0-9a-f]{6};/);
});

// ---------------------------------------------------------------- HTTP

// Berkas biner minimal: hanya byte awal yang diperiksa server.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.alloc(64, 3)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(32, 4)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

let S, admin, agent, session;
before(async () => {
  S = await startServer({ env: { BRAND_NAME: 'Klinik Uji', BRAND_COLOR: '#2e7d32' } });
  admin = new Client(S.base, { mode: 'basic' });
  const mk = await admin.post('/api/users', { name: 'agen1', password: 'sandi-agen-123', role: 'agent' });
  assert.equal(mk.status, 201, mk.text);
  agent = new Client(S.base, { mode: 'basic' });
  agent.authHeader = 'Basic ' + Buffer.from('agen1:sandi-agen-123').toString('base64');
  session = new Client(S.base, { mode: 'session' });
  assert.equal((await session.login()).status, 302);
});
after(() => S?.stop());

const asAgent = (method, url, opts = {}) => agent.req(method, url, { ...opts, headers: { Authorization: agent.authHeader, ...(opts.headers || {}) } });
const upload = (kind, buf, type = 'application/octet-stream', who = admin) => who.req('POST', `/api/brand/${kind}`, { raw: buf, headers: { 'Content-Type': type } });

test('nilai awal dari .env: nama dan warna; /brand.css, /brand.json, /brand/favicon publik tanpa login', async () => {
  const css = await fetch(S.base + '/brand.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /^text\/css/);
  assert.equal(css.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await css.text(), /--brand: #2e7d32;/);
  const j = await (await fetch(S.base + '/brand.json')).json();
  assert.deepEqual(j, { name: 'Klinik Uji', logo: false });
  const ico = await fetch(S.base + '/brand/favicon');
  assert.equal(ico.status, 200);
  assert.equal(ico.headers.get('content-type'), 'image/svg+xml');
  assert.equal((await fetch(S.base + '/brand/logo')).status, 404);
  assert.equal((await fetch(S.base + '/brand.css', { method: 'POST', redirect: 'manual' })).status, 302, 'hanya GET/HEAD yang publik');
});

test('halaman login dan dashboard memuat /brand.css dan favicon dinamis', async () => {
  const login = await (await fetch(S.base + '/login')).text();
  assert.match(login, /href="\/brand\.css"/);
  assert.match(login, /href="\/brand\/favicon"/);
  const idx = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(idx, /id="brand-css" rel="stylesheet" href="\/brand\.css"/);
  assert.ok(idx.indexOf('style.css') < idx.indexOf('brand.css'), 'brand.css harus dimuat setelah style.css agar menimpa warna');
});

test('warna lewat /api/settings: simpan, ditolak bila terlalu terang/salah, kosong = bawaan, ikut riwayat', async () => {
  let r = await admin.put('/api/settings', { brandColor: '#0B5FA5' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.brandColor, '#0b5fa5');
  assert.match(await (await fetch(S.base + '/brand.css')).text(), /--brand-800-rgb: 11 95 165;/);
  for (const bad of ['#ffeb3b', 'merah', '#12']) {
    r = await admin.put('/api/settings', { brandColor: bad });
    assert.equal(r.status, 400, bad);
  }
  assert.equal((await admin.get('/api/settings')).json.brandColor, '#0b5fa5', 'penolakan tidak mengubah apa pun');
  r = await admin.put('/api/settings', { brandColor: '' });
  assert.equal(r.status, 200);
  assert.doesNotMatch(await (await fetch(S.base + '/brand.css')).text(), /--brand:/);
  const v = (await admin.get('/api/settings/history')).json.find((h) => h.version > 1);
  assert.ok(v, 'perubahan warna tercatat di riwayat versi');
});

test('unggah logo PNG: tersaji publik, ETag/304, brand.json menandai logo, tersimpan 0600 di data/brand', async () => {
  const r = await upload('logo', PNG, 'image/png');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.logo.type, 'png');
  const res = await fetch(S.base + '/brand/logo');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  const etag = res.headers.get('etag');
  assert.ok(etag);
  assert.equal((await fetch(S.base + '/brand/logo', { headers: { 'If-None-Match': etag } })).status, 304);
  assert.equal((await (await fetch(S.base + '/brand.json')).json()).logo, true);
  const file = path.join(S.dataDir, 'brand', 'logo.png');
  assert.ok(fs.existsSync(file));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('mengganti logo dengan format lain: berkas lama dibuang, tidak ada sisa ganda', async () => {
  assert.equal((await upload('logo', JPG, 'image/jpeg')).status, 200);
  assert.deepEqual(fs.readdirSync(path.join(S.dataDir, 'brand')).filter((f) => f.startsWith('logo')), ['logo.jpg']);
  assert.equal((await fetch(S.base + '/brand/logo')).headers.get('content-type'), 'image/jpeg');
  assert.equal((await upload('logo', WEBP, 'image/webp')).status, 200);
  assert.deepEqual(fs.readdirSync(path.join(S.dataDir, 'brand')).filter((f) => f.startsWith('logo')), ['logo.webp']);
});

test('keamanan unggahan: SVG, HTML berkedok gambar, berkas kosong, terlalu besar, format salah untuk favicon', async () => {
  let r = await upload('logo', SVG, 'image/svg+xml');
  assert.equal(r.status, 415);
  assert.match(r.json.error, /SVG/);
  r = await upload('logo', Buffer.from('<html><script>alert(1)</script></html>'.repeat(3)), 'image/png');
  assert.equal(r.status, 415, 'Content-Type palsu tidak dipercaya, byte-nya yang diperiksa');
  assert.equal((await upload('logo', Buffer.alloc(0), 'image/png')).status, 400);
  r = await upload('logo', Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]), 'image/png');
  assert.equal(r.status, 413);
  assert.equal((await upload('favicon', WEBP, 'image/webp')).status, 415, 'favicon hanya PNG/ICO');
  assert.equal((await upload('favicon', Buffer.concat([ICO, Buffer.alloc(256 * 1024)]), 'image/x-icon')).status, 413);
  assert.equal((await upload('lain', PNG, 'image/png')).status, 404);
  assert.equal((await fetch(S.base + '/brand/logo')).headers.get('content-type'), 'image/webp', 'unggahan yang ditolak tidak mengubah logo');
});

test('favicon: ICO tersaji dengan tipe benar; hapus -> kembali ke bawaan; logo juga bisa dihapus', async () => {
  assert.equal((await upload('favicon', ICO, 'image/x-icon')).status, 200);
  const res = await fetch(S.base + '/brand/favicon');
  assert.equal(res.headers.get('content-type'), 'image/x-icon');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), ICO);
  let r = await admin.del('/api/brand/favicon');
  assert.equal(r.status, 200);
  assert.equal(r.json.favicon, null);
  assert.equal((await fetch(S.base + '/brand/favicon')).headers.get('content-type'), 'image/svg+xml');
  r = await admin.del('/api/brand/logo');
  assert.equal(r.json.logo, null);
  assert.equal((await fetch(S.base + '/brand/logo')).status, 404);
  assert.equal((await admin.del('/api/brand/logo')).status, 200, 'hapus berulang tidak galat');
});

test('hak akses: agent boleh melihat ringkasan tetapi tidak mengubah; tanpa login ditolak; CSRF wajib untuk sesi', async () => {
  assert.equal((await asAgent('GET', '/api/brand')).status, 200);
  assert.equal((await asAgent('POST', '/api/brand/logo', { raw: PNG, headers: { 'Content-Type': 'image/png' } })).status, 403);
  assert.equal((await asAgent('DELETE', '/api/brand/logo')).status, 403);
  assert.equal((await asAgent('PUT', '/api/settings', { body: { brandColor: '#0b5fa5' } })).status, 403);
  assert.equal((await fetch(S.base + '/api/brand')).status, 401);
  assert.equal((await fetch(S.base + '/api/brand/logo', { method: 'POST', body: PNG })).status, 401);
  const noCsrf = await session.req('POST', '/api/brand/logo', { raw: PNG, headers: { 'Content-Type': 'image/png' }, noCsrf: true });
  assert.equal(noCsrf.status, 403);
  const withCsrf = await session.req('POST', '/api/brand/logo', { raw: PNG, headers: { 'Content-Type': 'image/png' } });
  assert.equal(withCsrf.status, 200, withCsrf.text);
  await admin.del('/api/brand/logo');
});

test('GET /api/brand: ringkasan nama, warna, palet, batas ukuran; perubahan masuk audit', async () => {
  await admin.put('/api/settings', { brandColor: '#6a1b9a' });
  await upload('logo', PNG, 'image/png');
  const b = (await admin.get('/api/brand')).json;
  assert.equal(b.name, 'Klinik Uji');
  assert.equal(b.color, '#6a1b9a');
  assert.equal(b.palette[800], '#6a1b9a');
  assert.equal(b.logo.type, 'png');
  assert.deepEqual(b.limits, { logoKB: 1024, faviconKB: 256 });
  const audit = fs.readdirSync(path.join(S.dataDir, 'audit')).map((f) => fs.readFileSync(path.join(S.dataDir, 'audit', f), 'utf8')).join('\n');
  assert.match(audit, /brand\.logo\.set/);
  assert.match(audit, /brand\.logo\.remove/);
});
