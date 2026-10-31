// Uji atribusi sumber: referralCode > metadata iklan > teks > default; platform pertama disebut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-leads-'));

const L = await import('../src/leads.js');
const cfg = L.getConfig();
const T = Date.now();
const mk = (text, source) => L.classify(null, { text, phone: '1', ts: T, customerCount: 1, source }, cfg).lead;

test('config platform baru + platformNames lengkap', () => {
  const n = L.platformNames();
  for (const p of ['Instagram', 'Facebook', 'TikTok', 'Google Ads', 'Google (organik)', 'Website', 'Iklan Meta', 'Lainnya']) assert.ok(n.includes(p), p);
});

test('"web" saja tidak cukup; website/situs cukup', () => {
  assert.equal(L.detect('cari web developer', cfg).platform, 'Lainnya');
  assert.equal(L.detect('saya lihat website kalian', cfg).platform, 'Website');
  assert.equal(L.detect('tahu dari situs web', cfg).platform, 'Website');
});

test('google: ads vs organik vs maps', () => {
  assert.equal(L.detect('dari google', cfg).platform, 'Google (organik)');
  assert.equal(L.detect('cari di google maps', cfg).platform, 'Google (organik)');
  assert.equal(L.detect('lihat iklan google', cfg).platform, 'Google Ads');
  assert.equal(L.detect('dari google ads', cfg).platform, 'Google Ads');
  assert.equal(L.detect('dari gmaps', cfg).platform, 'Google (organik)');
});

test('beberapa platform: yang disebut PERTAMA menang', () => {
  assert.equal(L.detect('dari fb dan instagram', cfg).platform, 'Facebook');
  assert.equal(L.detect('dari instagram dan fb', cfg).platform, 'Instagram');
  assert.equal(L.detect('tiktok atau google', cfg).platform, 'TikTok');
});

test('referralCode mengalahkan metadata iklan dan teks', () => {
  const l = mk('dari facebook', { referralCode: 'IG01', ctwaClid: 'abc' });
  assert.equal(l.platform, 'Instagram');
  assert.equal(L.detect('halo', cfg, { referralCode: 'fb01' }).platform, 'Facebook');
  assert.equal(L.detect('halo', cfg, { referralCode: 'XXX' }).platform, 'Lainnya'); // kode tak dikenal
});

test('metadata iklan: ctwaClid/adId/sourceUrl -> Iklan Meta, tiktok di url -> TikTok, mengalahkan teks', () => {
  assert.equal(mk('halo', { ctwaClid: 'AbC' }).platform, 'Iklan Meta');
  assert.equal(mk('halo', { adId: '123' }).platform, 'Iklan Meta');
  assert.equal(mk('halo', { sourceUrl: 'https://fb.me/xyz' }).platform, 'Iklan Meta');
  assert.equal(mk('halo', { sourceUrl: 'https://www.tiktok.com/@a/video/1' }).platform, 'TikTok');
  assert.equal(mk('dari tiktok', { ctwaClid: 'AbC' }).platform, 'Iklan Meta');
});

test('lead.source disimpan apa adanya', () => {
  const s = { platform: 'x', adId: '9', ctwaClid: 'c', sourceUrl: 'u', referralCode: 'IG01' };
  assert.deepEqual(mk('halo', s).source, s);
});

test('platform Lainnya ditingkatkan oleh pesan/metadata berikutnya; platform lain tidak ditimpa', () => {
  let l = mk('halo');
  assert.equal(l.platform, 'Lainnya');
  l = L.classify(l, { text: 'saya dari IG', ts: T + 1, customerCount: 2 }, cfg).lead;
  assert.equal(l.platform, 'Instagram');
  l = L.classify(l, { text: 'atau dari facebook', ts: T + 2, customerCount: 3 }, cfg).lead;
  assert.equal(l.platform, 'Instagram');
  let m = mk('halo');
  m = L.classify(m, { text: 'ok', ts: T + 1, customerCount: 2, source: { ctwaClid: 'zz' } }, cfg).lead;
  assert.equal(m.platform, 'Iklan Meta');
  assert.equal(m.source.ctwaClid, 'zz');
});
