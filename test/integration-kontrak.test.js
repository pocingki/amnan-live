// Tes integrasi: endpoint kontrak K1/K7 ada dan berbentuk benar. Memakai Basic Auth (tanpa CSRF).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, basicAuth } from './helpers/server.js';

let srv;
let c;
before(async () => {
  srv = await startServer();
  c = new Client(srv.base, { mode: 'basic' });
});
after(async () => {
  await srv?.stop();
});

test('GET /api/wa/status -> {status, qr, number, error, unread}', async () => {
  const r = await c.get('/api/wa/status');
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.status, 'string');
  assert.ok('qr' in r.json && 'number' in r.json && 'unread' in r.json);
});

test('GET /api/conversations -> {conversations:[]} (K7)', async () => {
  const r = await c.get('/api/conversations');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.conversations));
});

test('GET /api/conversations/:phone tidak ada -> 404 JSON', async () => {
  const r = await c.get('/api/conversations/628999999999');
  assert.equal(r.status, 404);
  assert.ok(r.json?.error);
});

test('[butuh A1] POST /api/conversations/:phone/read ada (404 untuk nomor tak dikenal, bukan "endpoint tidak ditemukan")', async () => {
  const r = await c.post('/api/conversations/628999999999/read', {});
  assert.equal(r.status, 404);
  assert.doesNotMatch(r.json?.error || '', /endpoint tidak ditemukan/i);
});

test('[butuh A1] GET /api/media/:id tak dikenal -> 404 (rute ada, terautentikasi)', async () => {
  const r = await c.get('/api/media/tidak-ada');
  assert.equal(r.status, 404);
  const anon = await fetch(srv.base + '/api/media/tidak-ada');
  assert.equal(anon.status, 401);
});

test('[butuh A1] GET /api/settings memuat version (int) dan field kontrak K5', async () => {
  const r = await c.get('/api/settings');
  assert.equal(r.status, 200);
  assert.ok(Number.isInteger(r.json.version), 'version harus integer');
  for (const k of ['handoverMessage', 'staleMinutes', 'autoTakeoverOnPhoneReply', 'fallbackCooldownMinutes', 'sendRateLimitPerMinute', 'retentionDays', 'notify', 'slangMap', 'intents', 'requiredFields']) {
    assert.ok(k in r.json, `settings.${k} tidak ada`);
  }
  assert.equal(r.json.staleMinutes, 10);
  assert.equal(r.json.autoTakeoverOnPhoneReply, true);
  assert.equal(r.json.fallbackCooldownMinutes, 30);
  assert.equal(r.json.sendRateLimitPerMinute, 20);
  assert.ok(r.json.requiredFields.every((f) => ['text', 'name', 'phone', 'date', 'choice'].includes(f.type)));
});

test('[butuh A1] PUT /api/settings dengan If-Match basi -> 409 {error,current}; versi benar -> naik', async () => {
  const cur = (await c.get('/api/settings')).json;
  const stale = await c.req('PUT', '/api/settings', { body: { botName: 'Uji' }, headers: { 'If-Match': String(cur.version + 99) } });
  assert.equal(stale.status, 409);
  assert.ok(stale.json.error && stale.json.current);
  const ok = await c.req('PUT', '/api/settings', { body: { botName: 'Asisten Uji' }, headers: { 'If-Match': String(cur.version) } });
  assert.equal(ok.status, 200, ok.text);
  const after = (await c.get('/api/settings')).json;
  assert.equal(after.botName, 'Asisten Uji');
  assert.ok(after.version > cur.version);
});

test('[butuh A1] GET /api/settings/history dan POST /api/settings/restore', async () => {
  const h = await c.get('/api/settings/history');
  assert.equal(h.status, 200);
  assert.ok(Array.isArray(h.json.history ?? h.json), 'riwayat harus berupa array');
  const bad = await c.post('/api/settings/restore', { version: 999999 });
  assert.ok([400, 404].includes(bad.status), `status ${bad.status}`);
});

test('GET /api/leads -> {leads:[]} + ETag, If-None-Match -> 304 [butuh A2]', async () => {
  const r = await c.get('/api/leads');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.leads));
  assert.ok(Array.isArray(r.json.statuses));
  const etag = r.headers.get('etag');
  assert.ok(etag, 'ETag tidak ada');
  const again = await fetch(srv.base + '/api/leads', { headers: { Authorization: basicAuth(), 'If-None-Match': etag } });
  assert.equal(again.status, 304);
});

test('[butuh A2] endpoint lead ada: nomor/ID tak dikenal -> 404 JSON dari modul, bukan rute hilang', async () => {
  const id = 'tidak-ada';
  const checks = [
    c.patch(`/api/leads/${id}`, { name: 'x' }),
    c.del(`/api/leads/${id}`),
    c.post(`/api/leads/${id}/notes`, { text: 'catatan' }),
    c.put(`/api/leads/${id}/followup`, { followUpAt: Date.now() + 3600000, followUpNote: 'tes' }),
    c.post(`/api/leads/${id}/transaction-done`, {}),
    c.post(`/api/leads/${id}/block`, {}),
    c.post(`/api/leads/${id}/unblock`, {}),
    c.post('/api/leads/from-conversation', { phone: '628999999999' }),
  ];
  for (const r of await Promise.all(checks)) {
    assert.ok([400, 404].includes(r.status), `status ${r.status}: ${r.text}`);
    assert.ok(r.json?.error);
    assert.doesNotMatch(r.json.error, /endpoint tidak ditemukan/i);
  }
});

test('GET /api/events -> SSE (text/event-stream) [butuh A4]', async () => {
  const ctl = new AbortController();
  const res = await fetch(srv.base + '/api/events', { headers: { Authorization: basicAuth(), Accept: 'text/event-stream' }, signal: ctl.signal });
  try {
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
  } finally {
    ctl.abort();
  }
});

test('GET /api/data* (A4) tidak 404 "endpoint tidak ditemukan" [butuh A4]', async () => {
  const r = await c.get('/api/data/stats');
  assert.notEqual(r.status, 500);
  if (r.status === 404) assert.doesNotMatch(r.json?.error || '', /endpoint tidak ditemukan/i, 'rute /api/data* belum ada');
});

test('[butuh A3] GET /api/users dan /api/audit hanya untuk admin; endpoint ada', async () => {
  const u = await c.get('/api/users');
  assert.equal(u.status, 200, u.text);
  assert.ok(Array.isArray(u.json.users ?? u.json));
  const a = await c.get('/api/audit');
  assert.equal(a.status, 200, a.text);
});

test('endpoint tak dikenal -> 404 JSON', async () => {
  const r = await c.get('/api/tidak-ada-endpoint');
  assert.equal(r.status, 404);
  assert.ok(r.json?.error);
});

test('tester lain tetap ada: reset, mode, advance', async () => {
  const p = '628130000001';
  assert.equal((await c.post('/api/tester/mode', { phone: p, mode: 'admin' })).status, 200);
  assert.equal((await c.post('/api/tester/mode', { phone: p, mode: 'ngawur' })).status, 400);
  const adv = await c.post('/api/tester/advance', { phone: p, hours: 2 });
  assert.equal(adv.status, 200);
  assert.equal((await c.post('/api/tester/advance', { phone: p, hours: -1 })).status, 400);
  assert.equal((await c.post('/api/tester/reset', { phone: p })).status, 200);
});
