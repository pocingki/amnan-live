// Uji endpoint /api/conversations dan /api/tester (dispatcher dan WhatsApp diganti palsu).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-api-'));
const C = await import('../src/conversations.js');
const { handle } = await import('../src/api/bot.js');

const PH = '628111';
function call(method, p, { body = {}, role = 'admin', sendText } = {}) {
  const out = { audits: [] };
  const ctx = {
    sendJSON: (_r, code, b) => ((out.code = code), (out.body = b)),
    readBody: async () => body,
    user: { name: 'Dewi', role },
    audit: (a, d) => out.audits.push([a, d]),
    requireRole: (r) => (role === r ? true : (out.code = 403, out.body = { error: 'Dilarang' }, false)),
    sendText,
  };
  return handle({ method }, {}, new URL('http://x' + p), ctx).then((handled) => ({ handled, ...out }));
}
const seed = (o = {}) => {
  C.remove(PH);
  const { conv } = C.getOrCreate(PH, PH + '@s.whatsapp.net', 'Budi');
  C.addMessage(conv, 'customer', 'halo');
  Object.assign(conv, { unread: 2, ...o });
  return conv;
};

test('bukan jalurnya -> false', async () => {
  assert.equal((await call('GET', '/api/leads')).handled, false);
  assert.equal((await call('PUT', '/api/conversations/' + PH)).handled, false);
});
test('list dilengkapi needsAttention/awaitingReply/phoneKnown', async () => {
  seed({ needsAttention: true, attentionReason: 'media' });
  const r = await call('GET', '/api/conversations');
  const row = r.body.conversations.find((x) => x.phone === PH);
  assert.deepEqual([row.needsAttention, row.attentionReason, row.awaitingReply, row.phoneKnown], [true, 'media', true, true]);
});
test('GET tidak mereset unread; read mereset; 404', async () => {
  const c = seed();
  const g = await call('GET', '/api/conversations/' + PH);
  assert.equal(g.code, 200); assert.equal(c.unread, 2); assert.equal(g.body.awaitingReply, true);
  await call('POST', `/api/conversations/${PH}/read`);
  assert.equal(c.unread, 0);
  const n = await call('GET', '/api/conversations/999999');
  assert.deepEqual([n.code, n.body.error], [404, 'Percakapan tidak ditemukan']);
});
test('agent ditolak DELETE dan delete-messages (403); admin boleh + audit', async () => {
  const c = seed(); const id = c.messages[0].id;
  assert.equal((await call('DELETE', '/api/conversations/' + PH, { role: 'agent' })).code, 403);
  assert.equal((await call('POST', `/api/conversations/${PH}/delete-messages`, { role: 'agent', body: { ids: [id] } })).code, 403);
  assert.equal(c.messages.length, 1);
  const d = await call('POST', `/api/conversations/${PH}/delete-messages`, { body: { ids: [id] } });
  assert.equal(d.code, 200); assert.equal(c.messages.length, 0); assert.equal(d.audits.length, 1);
  const x = await call('DELETE', '/api/conversations/' + PH);
  assert.equal(x.code, 200); assert.equal(C.get(PH), undefined); assert.equal(x.audits[0][0], 'conversation.delete');
});
test('send: 409 saat mode bot; sukses isi sender, hapus attention', async () => {
  const c = seed({ needsAttention: true, attentionReason: 'media' });
  const sent = [];
  const sendText = async (jid, t) => (sent.push([jid, t]), { waId: 'W1' });
  assert.equal((await call('POST', `/api/conversations/${PH}/send`, { body: { text: 'hai' }, sendText })).code, 409);
  assert.equal(sent.length, 0);
  await call('POST', `/api/conversations/${PH}/mode`, { body: { mode: 'admin' } });
  const r = await call('POST', `/api/conversations/${PH}/send`, { body: { text: ' hai ' }, sendText });
  assert.equal(r.code, 200);
  assert.deepEqual(sent, [[PH + '@s.whatsapp.net', 'hai']]);
  assert.deepEqual([r.body.message.by, r.body.message.sender, r.body.message.status, r.body.message.waId], ['admin', 'Dewi', 'sent', 'W1']);
  assert.equal(c.needsAttention, false);
  assert.equal(r.audits.length, 1);
});
test('send: galat kirim -> 502; teks kosong -> 400', async () => {
  seed({ mode: 'admin' });
  const bad = async () => { throw new Error('WA putus'); };
  const r = await call('POST', `/api/conversations/${PH}/send`, { body: { text: 'x' }, sendText: bad });
  assert.deepEqual([r.code, r.body.error], [502, 'WA putus']);
  assert.equal((await call('POST', `/api/conversations/${PH}/send`, { body: { text: ' ' } })).code, 400);
});
test('mode ke bot menghapus attention; attention/clear', async () => {
  const c = seed({ mode: 'admin', needsAttention: true, attentionReason: 'stale' });
  await call('POST', `/api/conversations/${PH}/mode`, { body: { mode: 'bot' } });
  assert.deepEqual([c.mode, c.needsAttention], ['bot', false]);
  c.needsAttention = true;
  await call('POST', `/api/conversations/${PH}/attention/clear`);
  assert.equal(c.needsAttention, false);
});
test('resend: pesan failed terkirim ulang; bukan failed -> 409', async () => {
  const c = seed();
  const m = C.addMessage(c, 'bot', 'Halo', 5);
  Object.assign(m, { status: 'failed', replyKind: 'opening' });
  const sendText = async () => ({ waId: 'W9' });
  const r = await call('POST', `/api/conversations/${PH}/resend`, { body: { messageId: m.id }, sendText });
  assert.equal(r.code, 200); assert.equal(m.status, 'sent'); assert.equal(m.waId, 'W9'); assert.equal(c.openingSent, true);
  const again = await call('POST', `/api/conversations/${PH}/resend`, { body: { messageId: m.id }, sendText });
  assert.equal(again.code, 409);
});
test('tester: validasi nomor, send, phone-reply, reset', async () => {
  assert.equal((await call('GET', '/api/tester?phone=12')).body.error, 'Nomor uji tidak valid (8-15 digit)');
  assert.equal((await call('POST', '/api/tester/send', { body: { phone: 'abc', text: 'x' } })).code, 400);
  assert.equal((await call('POST', '/api/tester/send', { body: { phone: '081200000077', text: '' } })).code, 400);
  const s = await call('POST', '/api/tester/send', { body: { phone: '081200000077', text: 'halo' } });
  assert.equal(s.code, 200); assert.ok(s.body.replies.length >= 1);
  const pr = await call('POST', '/api/tester/phone-reply', { body: { phone: '6281200000077', text: 'dari HP' } });
  assert.deepEqual([pr.body.message.by, pr.body.message.sender], ['admin', 'HP']); // takeover otomatis diuji di bot.test.js (pengaturan palsu)
  assert.equal((await call('POST', '/api/tester/reset', { body: {} })).code, 200); // reset semua
  assert.equal((await call('GET', '/api/tester?phone=6281200000077')).body.numbers.length, 0);
  assert.equal((await call('POST', '/api/tester/xyz', { body: { phone: '6281200000077' } })).handled, false);
});
test('tester: transaction-done -> 400 bila tidak ada transaksi terbuka, 200 bila ada', async () => {
  const none = await call('POST', '/api/tester/transaction-done', { body: { phone: '6281299990001' } });
  assert.equal(none.code, 400);
  const bad = await call('POST', '/api/tester/transaction-done', { body: { phone: '12' } });
  assert.equal(bad.code, 400);
  await call('POST', '/api/tester/send', { body: { phone: '6281299990002', text: 'Halo dari Instagram, mau booking' } });
  const ok = await call('POST', '/api/tester/transaction-done', { body: { phone: '6281299990002' } });
  assert.equal(ok.code, 200);
  assert.ok(ok.body.lead.transactionCycles.every((c) => c.doneAt));
});
