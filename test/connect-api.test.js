// Amnan Connect v1 lewat server.js asli: autentikasi kunci, scope, kontak, pesan (dry-run), kejadian, webhook.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, Client, basicAuth } from './helpers/server.js';
import { verifySignature } from '../src/connect.js';

let srv, admin, receiver, received, rxPort;

let idemN = 0;
const v1 = (token, method, path, body, headers = {}, { idem = true } = {}) => {
  const extra = { ...headers };
  if (idem && method === 'POST' && (path === '/api/v1/messages' || path === '/api/v1/events') && !extra['idempotency-key']) {
    extra['idempotency-key'] = `uji-${String(++idemN).padStart(8, '0')}-kunci`;
  }
  return fetch(srv.base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, headers: r.headers, json: await r.json().catch(() => null) }));
};

async function newKey(scopes, extra = {}) {
  const r = await admin.post('/api/integrations/keys', { name: 'Booking Live', app: 'booking', scopes, ...extra });
  assert.equal(r.status, 201, r.text);
  return r.json;
}

before(async () => {
  received = [];
  receiver = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ headers: req.headers, raw });
      res.writeHead(204).end();
    });
  });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
  rxPort = receiver.address().port;
  srv = await startServer({ env: { CONNECT_DRY_RUN: '1', CONNECT_ALLOW_PRIVATE_URLS: '1', CLIENT_ID: 'klinik-uji' } });
  admin = new Client(srv.base);
  assert.equal((await admin.login()).status, 302);
  await admin.get('/api/me'); // memastikan cookie csrf ada
});

after(async () => {
  await srv?.stop();
  await new Promise((r) => receiver.close(r));
});

test('admin membuat kunci; daftar tidak membocorkan rahasia; hanya admin', async () => {
  const { key, token } = await newKey(['leads:read', 'leads:write', 'messages:send', 'events:write']);
  assert.match(token, /^amk_[0-9a-f]{8}\.[A-Za-z0-9_-]{43}$/);
  const list = await admin.get('/api/integrations');
  assert.equal(list.status, 200);
  assert.ok(list.json.keys.some((k) => k.id === key.id));
  assert.ok(!list.text.includes(token.split('.')[1]), 'rahasia tidak muncul di daftar');
  assert.ok(!/secretHash/.test(list.text));

  // agent tidak boleh
  assert.equal((await admin.post('/api/users', { name: 'staf1', password: 'sandi-staf-12345', role: 'agent' })).status, 201);
  const agent = new Client(srv.base);
  assert.equal((await agent.login('staf1', 'sandi-staf-12345')).status, 302);
  await agent.get('/api/me');
  assert.equal((await agent.get('/api/integrations')).status, 403);
  assert.equal((await agent.post('/api/integrations/keys', { name: 'x', app: 'booking', scopes: ['leads:read'] })).status, 403);

  // validasi
  assert.equal((await admin.post('/api/integrations/keys', { name: 'x', app: 'booking', scopes: ['root'] })).status, 400);
  assert.equal((await admin.post('/api/integrations/keys', { name: 'x', app: 'boo king', scopes: ['leads:read'] })).status, 400);
});

test('autentikasi v1: tanpa kunci, kunci salah, sesi dashboard, dan kunci tidak membuka API dashboard', async () => {
  const { token } = await newKey(['leads:read']);
  const ping = await v1(token, 'GET', '/api/v1/ping');
  assert.equal(ping.status, 200);
  assert.equal(ping.json.contract, '1');
  assert.equal(ping.json.client, 'klinik-uji');
  assert.equal(ping.json.dryRun, true);
  assert.deepEqual(ping.json.app.scopes, ['leads:read']);

  const none = await fetch(srv.base + '/api/v1/ping');
  assert.equal(none.status, 401);
  assert.match(none.headers.get('www-authenticate') || '', /Bearer/);
  assert.equal((await v1('amk_00000000.' + 'A'.repeat(43), 'GET', '/api/v1/ping')).status, 401);

  // sesi dashboard / Basic Auth admin TIDAK berlaku di /api/v1
  assert.equal((await admin.get('/api/v1/ping')).status, 401);
  const basic = await fetch(srv.base + '/api/v1/ping', { headers: { authorization: basicAuth() } });
  assert.equal(basic.status, 401);

  // kunci tidak berlaku di API dashboard
  const dash = await fetch(srv.base + '/api/leads', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(dash.status, 401);

  assert.equal((await v1(token, 'GET', '/api/v1/tidak-ada')).status, 404);
});

test('scope ditegakkan di setiap endpoint', async () => {
  const { token } = await newKey(['leads:read']);
  for (const [m, p, b] of [
    ['PUT', '/api/v1/contacts/6281200000001', { name: 'X' }],
    ['POST', '/api/v1/messages', { phone: '6281200000001', text: 'hai' }],
    ['POST', '/api/v1/events', { type: 'booking.created', summary: 's' }],
  ]) {
    const r = await v1(token, m, p, b);
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.json.code, 'FORBIDDEN_SCOPE');
  }
  const { token: t2 } = await newKey(['messages:send']);
  assert.equal((await v1(t2, 'GET', '/api/v1/contacts/6281200000001')).status, 403);
});

test('kontak: buat, perbarui tanpa menimpa nama, catatan, baca, validasi, dan data aplikasi tersimpan terpisah', async () => {
  const { token } = await newKey(['leads:read', 'leads:write']);
  const phone = '081200000010';
  const r1 = await v1(token, 'PUT', `/api/v1/contacts/${phone}`, { name: 'Siti', data: { bookings: 1, lastBookingAt: '2026-11-05T09:00:00+07:00' }, note: 'Booking pertama' });
  assert.equal(r1.status, 201, JSON.stringify(r1.json));
  assert.equal(r1.json.created, true);
  assert.equal(r1.json.contact.phone, '6281200000010', 'nomor dinormalisasi');
  assert.equal(r1.json.contact.apps.booking.bookings, 1);

  const r2 = await v1(token, 'PUT', `/api/v1/contacts/6281200000010`, { name: 'Nama Lain', data: { bookings: 2 } });
  assert.equal(r2.status, 200);
  assert.equal(r2.json.contact.name, 'Siti', 'nama yang sudah ada tidak ditimpa');
  assert.equal(r2.json.contact.apps.booking.bookings, 2);
  assert.equal(r2.json.contact.apps.booking.lastBookingAt, '2026-11-05T09:00:00+07:00', 'data lama digabung');

  const g = await v1(token, 'GET', '/api/v1/contacts/6281200000010');
  assert.equal(g.status, 200);
  assert.equal(g.json.contact.name, 'Siti');
  assert.equal((await v1(token, 'GET', '/api/v1/contacts/6281299999999')).status, 404);

  // terlihat di CRM dengan catatan oleh aplikasi; data bot tidak tersentuh
  const crm = new Client(srv.base, { mode: 'basic' });
  const leads = (await crm.get('/api/leads')).json;
  const row = (leads.leads || leads).find((l) => l.phone === '6281200000010');
  assert.ok(row, 'lead muncul di CRM');
  const detail = await crm.get(`/api/leads/${row.id}`);
  const lead = detail.json.lead || detail.json;
  assert.ok((lead.notes || []).some((n) => n.by === 'app:Booking Live' && n.text === 'Booking pertama'));
  assert.deepEqual(lead.data || {}, {}, 'lead.data (jawaban bot) tidak diubah aplikasi');

  for (const [body, why] of [[{ data: 'x' }, 'data bukan objek'], [{ data: { a: { b: 1 } } }, 'nilai objek'], [{ data: { 'bad key': 1 } }, 'nama kunci']]) {
    assert.equal((await v1(token, 'PUT', '/api/v1/contacts/6281200000011', body)).status, 400, why);
  }
  assert.equal((await v1(token, 'PUT', '/api/v1/contacts/123', { name: 'x' })).status, 400, 'nomor pendek');
});

test('pesan: dry-run tercatat di percakapan, idempotensi tidak menggandakan, dan validasi', async () => {
  const { token } = await newKey(['messages:send']);
  const phone = '6281200000020';
  const body = { phone: '081200000020', text: 'Booking Anda dikonfirmasi.', name: 'Rina' };
  const a = await v1(token, 'POST', '/api/v1/messages', body, { 'idempotency-key': 'konfirmasi-BK-1' });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.dryRun, true);
  assert.equal(a.json.conversation, phone);
  const b = await v1(token, 'POST', '/api/v1/messages', body, { 'idempotency-key': 'konfirmasi-BK-1' });
  assert.equal(b.status, 200);
  assert.equal(b.headers.get('idempotent-replay'), 'true');
  assert.equal(b.json.waId, a.json.waId, 'respons yang sama');

  const basic = new Client(srv.base, { mode: 'basic' });
  const conv = (await basic.get(`/api/conversations/${phone}`)).json;
  const bots = conv.messages.filter((m) => m.by === 'bot');
  assert.equal(bots.length, 1, 'hanya satu pesan walau dikirim dua kali');
  assert.equal(bots[0].sender, 'app:Booking Live');
  assert.equal(bots[0].replyKind, 'app');
  assert.equal(bots[0].text, 'Booking Anda dikonfirmasi.');
  assert.equal(conv.name, 'Rina');

  const missing = await v1(token, 'POST', '/api/v1/messages', { phone, text: 'tanpa-kunci' }, {}, { idem: false });
  assert.equal(missing.status, 400);
  assert.match(missing.json.error, /Idempotency-Key wajib/);
  assert.equal((await v1(token, 'POST', '/api/v1/messages', { phone: '12', text: 'x' })).status, 400);
  assert.equal((await v1(token, 'POST', '/api/v1/messages', { phone, text: '   ' })).status, 400);
  assert.equal((await v1(token, 'POST', '/api/v1/messages', { phone, text: 'x'.repeat(4001) })).status, 400);
  assert.equal((await v1(token, 'POST', '/api/v1/messages', { phone, text: 'x' }, { 'idempotency-key': 'pendek' })).status, 400);
});

test('pesan: kontak diblokir ditolak dan batas harian per kunci ditegakkan', async () => {
  const { token } = await newKey(['messages:send', 'leads:write'], { messagesPerDay: 2 });
  await v1(token, 'PUT', '/api/v1/contacts/6281200000030', { name: 'Blok' });
  const basic = new Client(srv.base, { mode: 'basic' });
  const leads = (await basic.get('/api/leads')).json;
  const row = (leads.leads || leads).find((l) => l.phone === '6281200000030');
  assert.equal((await basic.post(`/api/leads/${row.id}/block`, {})).status, 200);
  const blocked = await v1(token, 'POST', '/api/v1/messages', { phone: '6281200000030', text: 'hai' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'BLOCKED');

  assert.equal((await v1(token, 'POST', '/api/v1/messages', { phone: '6281200000031', text: 'satu' })).status, 200);
  assert.equal((await v1(token, 'POST', '/api/v1/messages', { phone: '6281200000031', text: 'dua' })).status, 200);
  const third = await v1(token, 'POST', '/api/v1/messages', { phone: '6281200000031', text: 'tiga' });
  assert.equal(third.status, 429);
  assert.equal(third.json.code, 'RATE_LIMIT');
});

test('kejadian: awalan harus sama dengan app kunci; tercatat di percakapan dan catatan lead', async () => {
  const { token } = await newKey(['events:write', 'leads:write', 'messages:send']);
  const phone = '6281200000040';
  await v1(token, 'PUT', `/api/v1/contacts/${phone}`, { name: 'Dewi' });
  await v1(token, 'POST', '/api/v1/messages', { phone, text: 'halo' });

  const spoof = await v1(token, 'POST', '/api/v1/events', { type: 'invoice.paid', phone, summary: 'palsu' });
  assert.equal(spoof.status, 403, 'tidak boleh menyamar sebagai aplikasi lain');
  assert.equal((await v1(token, 'POST', '/api/v1/events', { type: 'bukan-tipe', summary: 's' })).status, 400);
  assert.equal((await v1(token, 'POST', '/api/v1/events', { type: 'booking.created', phone })).status, 400, 'summary wajib');

  const ok = await v1(token, 'POST', '/api/v1/events', { type: 'booking.created', phone, summary: 'Booking Fisioterapi, Kamis 5 Nov 09:00 (BK-7F3K2)' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.recorded, true);
  const basic = new Client(srv.base, { mode: 'basic' });
  const conv = (await basic.get(`/api/conversations/${phone}`)).json;
  const sys = conv.messages.find((m) => m.by === 'system' && m.eventType === 'booking.created');
  assert.ok(sys && sys.text.includes('BK-7F3K2') && sys.sender === 'app:Booking Live');

  const none = await v1(token, 'POST', '/api/v1/events', { type: 'booking.created', phone: '6281200009999', summary: 'tidak ada kontak' });
  assert.equal(none.status, 200);
  assert.equal(none.json.recorded, false);
});

test('kunci dicabut langsung ditolak', async () => {
  const { key, token } = await newKey(['leads:read']);
  assert.equal((await v1(token, 'GET', '/api/v1/ping')).status, 200);
  const del = await admin.del(`/api/integrations/keys/${key.id}`);
  assert.equal(del.status, 200);
  assert.ok(del.json.key.revokedAt);
  assert.equal((await v1(token, 'GET', '/api/v1/ping')).status, 401);
  assert.equal((await admin.del('/api/integrations/keys/zzzzzzzz')).status, 404);
});

test('kunci lama yang terus dipakai setelah dicabut tidak mengunci aplikasi sah di IP yang sama', async () => {
  const old = await newKey(['leads:read']);
  const live = await newKey(['leads:read']);
  await admin.del(`/api/integrations/keys/${old.key.id}`);
  for (let i = 0; i < 7; i++) await v1(old.token, 'GET', '/api/v1/ping');
  assert.equal((await v1(old.token, 'GET', '/api/v1/ping')).status, 429, 'kunci lama dikunci sementara');
  assert.equal((await v1(live.token, 'GET', '/api/v1/ping')).status, 200, 'kunci lain tetap bisa');
});

test('webhook: ping saat dibuat, lead.created terkirim bertanda tangan, dan penerima bisa memverifikasi', async () => {
  received.length = 0;
  const create = await admin.post('/api/integrations/webhooks', { name: 'Booking', url: `http://127.0.0.1:${rxPort}/hook`, events: ['lead.created', 'message.received'] });
  assert.equal(create.status, 201, create.text);
  const { secret, webhook } = create.json;
  assert.match(secret, /^whsec_/);
  assert.ok(!(await admin.get('/api/integrations')).text.includes(secret), 'rahasia tidak muncul lagi di daftar');

  const waitFor = async (pred, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = received.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('webhook tidak diterima: ' + JSON.stringify(received.map((r) => r.headers['x-amnan-event'])));
  };

  const ping = await waitFor((r) => r.headers['x-amnan-event'] === 'ping');
  assert.ok(verifySignature(secret, ping.headers['x-amnan-timestamp'], ping.raw, ping.headers['x-amnan-signature']));

  const { token } = await newKey(['leads:write']);
  await v1(token, 'PUT', '/api/v1/contacts/6281200000050', { name: 'Hendra' });
  const ev = await waitFor((r) => r.headers['x-amnan-event'] === 'lead.created');
  assert.ok(verifySignature(secret, ev.headers['x-amnan-timestamp'], ev.raw, ev.headers['x-amnan-signature']), 'tanda tangan sah');
  assert.ok(!verifySignature('whsec_salah', ev.headers['x-amnan-timestamp'], ev.raw, ev.headers['x-amnan-signature']));
  const body = JSON.parse(ev.raw);
  assert.equal(body.type, 'lead.created');
  assert.equal(body.client, 'klinik-uji');
  assert.equal(body.data.phone, '6281200000050');
  assert.equal(ev.headers['x-amnan-delivery'].length, 36);

  // uji manual + nonaktifkan
  received.length = 0;
  assert.equal((await admin.post(`/api/integrations/webhooks/${webhook.id}/test`, {})).status, 200);
  await waitFor((r) => r.headers['x-amnan-event'] === 'ping');
  assert.equal((await admin.patch(`/api/integrations/webhooks/${webhook.id}`, { active: false })).json.webhook.active, false);
  assert.equal((await admin.post(`/api/integrations/webhooks/${webhook.id}/test`, {})).status, 409);
  assert.equal((await admin.del(`/api/integrations/webhooks/${webhook.id}`)).status, 200);
});

test('webhook: URL privat ditolak saat operator tidak mengizinkan', async () => {
  const strict = await startServer({ env: { CONNECT_DRY_RUN: '1' } });
  try {
    const c = new Client(strict.base);
    await c.login();
    await c.get('/api/me');
    for (const url of ['http://127.0.0.1:9/x', 'https://localhost/x', 'https://10.1.2.3/x', 'https://169.254.169.254/latest']) {
      const r = await c.post('/api/integrations/webhooks', { name: 'x', url });
      assert.equal(r.status, 400, url);
    }
  } finally {
    await strict.stop();
  }
});

test('audit mencatat tindakan aplikasi dan pembuatan kunci tanpa rahasia', async () => {
  const entries = (await admin.get('/api/audit?limit=1000')).json.entries;
  assert.ok(entries.some((e) => e.action === 'integrasi.kunci.buat'));
  assert.ok(entries.some((e) => e.action === 'v1.message.kirim' && e.role === 'app'));
  assert.ok(entries.some((e) => e.action === 'v1.auth.gagal'));
  assert.ok(!JSON.stringify(entries).includes('amk_'), 'token tidak pernah masuk audit');
});

// ---- perbaikan keamanan
test('pesan sensitif (OTP): terkirim tetapi tidak disimpan di percakapan dan tidak membuat percakapan baru', async () => {
  const { token } = await newKey(['messages:send']);
  const phone = '6281200000090';
  const r = await v1(token, 'POST', '/api/v1/messages', { phone, text: 'Kode verifikasi Klinik: 123456. Berlaku 10 menit.', sensitive: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.stored, false);
  const basic = new Client(srv.base, { mode: 'basic' });
  assert.equal((await basic.get(`/api/conversations/${phone}`)).status, 404, 'tidak ada percakapan baru');
  const audit = (await basic.get('/api/audit?q=v1.message.kirim')).text;
  assert.ok(!audit.includes('123456'), 'kode tidak masuk audit');
  assert.ok(!audit.includes(phone), 'nomor utuh tidak masuk audit');
});

test('hapus kontak: butuh scope leads:delete; menghapus lead dan percakapan; 404 bila tidak ada; audit tanpa nomor utuh', async () => {
  const { token: w } = await newKey(['leads:write', 'messages:send']);
  const { token: d } = await newKey(['leads:delete']);
  const phone = '6281200000091';
  await v1(w, 'PUT', `/api/v1/contacts/${phone}`, { name: 'Hapus Aku' });
  await v1(w, 'POST', '/api/v1/messages', { phone, text: 'halo' });
  assert.equal((await v1(w, 'DELETE', `/api/v1/contacts/${phone}`)).status, 403, 'tanpa scope ditolak');
  const r = await v1(d, 'DELETE', `/api/v1/contacts/${phone}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.deleted.leads >= 1);
  const basic = new Client(srv.base, { mode: 'basic' });
  assert.equal((await basic.get(`/api/conversations/${phone}`)).status, 404);
  assert.equal((await v1(d, 'DELETE', `/api/v1/contacts/${phone}`)).status, 404);
  assert.equal((await v1(d, 'DELETE', `/api/v1/contacts/12`)).status, 400);
  assert.ok(!(await basic.get('/api/audit?q=v1.contact.hapus')).text.includes(phone), 'nomor utuh tidak masuk audit');
});

test('kontak: kunci hanya melihat data aplikasinya sendiri di apps', async () => {
  const { token: a } = await newKey(['leads:read', 'leads:write']);
  const rb = await admin.post('/api/integrations/keys', { name: 'Aplikasi Lain', app: 'lain', scopes: ['leads:read', 'leads:write'] });
  const b = rb.json.token;
  const phone = '6281200000092';
  await v1(a, 'PUT', `/api/v1/contacts/${phone}`, { name: 'Dua App', data: { rahasiaBooking: 'x1' } });
  await v1(b, 'PUT', `/api/v1/contacts/${phone}`, { data: { rahasiaLain: 'y2' } });
  const seenByA = (await v1(a, 'GET', `/api/v1/contacts/${phone}`)).json.contact.apps;
  assert.ok(seenByA.booking && !seenByA.lain, JSON.stringify(seenByA));
  const seenByB = (await v1(b, 'GET', `/api/v1/contacts/${phone}`)).json.contact.apps;
  assert.ok(seenByB.lain && !seenByB.booking, JSON.stringify(seenByB));
});

test('hubungkan Booking: satu kode berisi key+webhook+rahasia tautan; status; hubungkan ulang mencabut yang lama; putuskan', async () => {
  const r = await admin.post('/api/integrations/booking', { bookingUrl: `http://127.0.0.1:${rxPort}`, amnanUrl: 'http://127.0.0.1:9' });
  assert.equal(r.status, 201, r.text);
  assert.match(r.json.code, /^AMN1\./);
  const d = JSON.parse(Buffer.from(r.json.code.slice(5), 'base64url').toString());
  assert.equal(d.u, 'http://127.0.0.1:9');
  assert.match(d.k, /^amk_[0-9a-f]{8}\./);
  assert.match(d.w, /^whsec_/);
  assert.ok(d.l.length >= 32);
  // key dari kode benar-benar bekerja dan punya scope lengkap termasuk hapus kontak
  const ping = await v1(d.k, 'GET', '/api/v1/ping');
  assert.equal(ping.status, 200);
  assert.ok(ping.json.app.scopes.includes('leads:delete') && ping.json.app.scopes.includes('messages:send'));
  const st = (await admin.get('/api/integrations/booking')).json;
  assert.equal(st.connected, true);
  assert.equal(st.bookingUrl, `http://127.0.0.1:${rxPort}`);
  assert.ok(!JSON.stringify(st).includes(d.k.split('.')[1]), 'status tidak membocorkan rahasia');
  // hubungkan ulang: key lama dicabut
  const r2 = await admin.post('/api/integrations/booking', { bookingUrl: `http://127.0.0.1:${rxPort}`, amnanUrl: 'http://127.0.0.1:9' });
  assert.equal(r2.status, 201);
  assert.equal((await v1(d.k, 'GET', '/api/v1/ping')).status, 401, 'key lama dicabut');
  // validasi
  assert.equal((await admin.post('/api/integrations/booking', { bookingUrl: 'bukan url', amnanUrl: 'http://127.0.0.1:9' })).status, 400);
  // putuskan
  const d2 = JSON.parse(Buffer.from(r2.json.code.slice(5), 'base64url').toString());
  assert.equal((await admin.req('DELETE', '/api/integrations/booking')).status, 200);
  assert.equal((await v1(d2.k, 'GET', '/api/v1/ping')).status, 401);
  assert.equal((await admin.get('/api/integrations/booking')).json.connected, false);
});
