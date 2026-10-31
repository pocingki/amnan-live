// Tes integrasi alur lead end-to-end lewat Bot Tester (kirim pesan -> lead -> status).
// Bot Tester memakai classify() dan decide() yang sama dengan WhatsApp asli.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client } from './helpers/server.js';

let srv;
let c;
before(async () => {
  srv = await startServer();
  c = new Client(srv.base, { mode: 'basic' });
});
after(async () => {
  await srv?.stop();
});

const send = (phone, text, extra = {}) => c.post('/api/tester/send', { phone, text, ...extra });

test('nomor baru: pesan pertama -> lead Cold (bukan Warm), Data Leads New, pembuka bot terkirim', async () => {
  const r = await send('628120000001', 'Halo kak, saya lihat di Instagram, mau tanya harga');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.lead, 'lead harus terbentuk');
  assert.equal(r.json.lead.status, 'Cold Leads');
  assert.equal(r.json.lead.dataType, 'New');
  assert.equal(r.json.lead.platform, 'Instagram');
  assert.ok(Array.isArray(r.json.replies) && r.json.replies.length >= 1, 'bot harus membalas');
  assert.match(r.json.replies[0].text, /selamat datang/i, 'balasan pertama = pesan pembuka');
});

test('sinyal transaksi -> Hot; "belum transfer" (negasi) tidak membuat Hot', async () => {
  const neg = await send('628120000002', 'Halo dari Instagram, belum transfer ya masih tanya dulu');
  assert.equal(neg.json.lead.status, 'Cold Leads');
  const hot = await send('628120000002', 'Oke sudah transfer ya, ini bukti transfer');
  assert.equal(hot.json.lead.status, 'Hot Leads');
  assert.match(hot.json.lead.statusReason || '', /transaksi|booking|transfer/i);
});

test('status hanya naik: Hot tidak turun oleh pesan biasa berikutnya', async () => {
  const p = '628120000003';
  await send(p, 'Halo kak dari Instagram, sudah transfer ya'); // 'booking' kini hanya sinyal lemah (A2-F1)
  const after = await send(p, 'terima kasih ya');
  assert.equal(after.json.lead.status, 'Hot Leads');
});

test('lebih dari 10 pesan customer -> Warm', async () => {
  const p = '628120000004';
  let last;
  for (let i = 1; i <= 11; i++) last = await send(p, i === 1 ? 'Halo kak dari Instagram' : `pertanyaan nomor ${i}`);
  assert.equal(last.json.lead.status, 'Warm Leads');
});

test('GET /api/tester memuat percakapan, lead, dan data nomor uji', async () => {
  const v = await c.get('/api/tester?phone=628120000001');
  assert.equal(v.status, 200);
  assert.ok(Array.isArray(v.json.messages) && v.json.messages.length >= 2);
  assert.ok(v.json.lead);
  assert.ok(v.json.status && ['bot', 'admin'].includes(v.json.status.mode));
});

test('alur data wajib: jawaban masuk ke data lead', async () => {
  const p = '628120000005';
  await send(p, 'Halo kak dari Instagram');
  const r = await send(p, 'Budi Santoso');
  assert.ok(r.json.data && Object.keys(r.json.data).length >= 1, 'data wajib tercatat');
});

test('nomor tidak valid -> 400; pesan kosong -> 400', async () => {
  assert.equal((await send('12', 'halo')).status, 400);
  assert.equal((await send('628120000006', '   ')).status, 400);
});

test('[butuh A1] simulasi: kirim gagal (simulate.sendFail) dan pesan basi (simulate.stale)', async () => {
  const fail = await send('628120000007', 'Halo dari Instagram', { simulate: { sendFail: true } });
  assert.equal(fail.status, 200, fail.text);
  const failedReply = (fail.json.replies || []).find((m) => m.status === 'failed');
  assert.ok(failedReply, 'balasan bot harus bertanda status failed');
  const stale = await send('628120000008', 'Halo dari Instagram', { simulate: { stale: true } });
  assert.equal(stale.status, 200, stale.text);
  assert.equal((stale.json.replies || []).length, 0, 'pesan basi tidak dibalas bot');
});

test('[butuh A1] POST /api/tester/phone-reply: admin membalas dari HP -> mode jadi admin', async () => {
  const p = '628120000009';
  await send(p, 'Halo dari Instagram');
  const r = await c.post('/api/tester/phone-reply', { phone: p, text: 'Halo, saya admin' });
  assert.equal(r.status, 200, r.text);
  const v = await c.get('/api/tester?phone=' + p);
  assert.equal(v.json.status.mode, 'admin');
  const after = await send(p, 'ada promo?');
  assert.equal((after.json.replies || []).length, 0, 'bot diam saat admin mengambil alih');
});

test('[butuh A1] durasi bot habis -> handover (bukan reset pembuka): handoverMessage terkirim lalu mode admin', async () => {
  const get = await c.get('/api/settings');
  assert.equal(get.status, 200);
  const put = await c.req('PUT', '/api/settings', { body: { botDurationMinutes: 5 }, headers: { 'If-Match': String(get.json.version) } });
  assert.equal(put.status, 200, put.text);
  const p = '628120000010';
  await send(p, 'Halo dari Instagram');
  await c.post('/api/tester/advance', { phone: p, hours: 1 });
  const r = await send(p, 'halo lagi');
  const texts = (r.json.replies || []).map((m) => m.text).join('\n');
  assert.match(texts, /dilanjutkan oleh/i, 'handoverMessage harus terkirim');
  assert.doesNotMatch(texts, /selamat datang/i, 'pembuka tidak boleh diulang');
  const v = await c.get('/api/tester?phone=' + p);
  assert.equal(v.json.status.mode, 'admin');
});
