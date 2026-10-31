import test from 'node:test';
import assert from 'node:assert/strict';
import { processIncoming, onStatusUpdate, resendMessage } from '../src/bot-pipeline.js';

const NOW = 1_700_000_000_000;
const S = {
  botEnabled: true, botName: 'Sari', adminName: 'Dewi', openingMessage: 'Halo', fallbackMessage: '', handoverMessage: '',
  completionMessage: 'Terima kasih', botDurationMinutes: 0, staleMinutes: 10, fallbackCooldownMinutes: 30,
  autoTakeoverOnPhoneReply: true, slangMap: {}, intents: [],
  requiredFields: [
    { id: 'nama', label: 'Nama', question: 'Siapa nama Kakak?', enabled: true, type: 'name' },
    { id: 'keluhan', label: 'Keluhan', question: 'Apa keluhannya?', enabled: true, type: 'text' },
  ],
};
let seq = 0;
const M = (o = {}) => ({
  waId: 'in' + ++seq, jid: '6281@s.whatsapp.net', phone: '6281', lid: null, name: '', ts: NOW, kind: 'text', text: 'halo',
  caption: '', mediaId: null, mediaError: null, fromMe: false, fromPhone: false, source: {}, ...o,
});
// deps palsu: Map in-memory yang meniru API conversations D4.
function mk({ send, leads = [] } = {}) {
  const st = new Map(), events = [], sleeps = [], ingests = [], sent = [];
  let n = 0;
  const d = {
    now: () => NOW,
    sleep: async (ms) => void sleeps.push(ms),
    send: send || (async (jid, text) => (sent.push(text), { waId: 'out' + sent.length })),
    settings: { get: () => S },
    emit: (type, payload) => events.push({ type, payload }),
    ingest: (p) => (ingests.push(p), { created: false, ignored: false, lead: null, changes: ['x'] }),
    leads: {
      findByPhone: (p) => leads.find((l) => l.phone === p),
      findByLid: (l) => leads.find((x) => x.lid === l),
      update: (id, patch) => Object.assign(leads.find((l) => l.id === id), patch),
      remove: (id) => void leads.splice(leads.findIndex((l) => l.id === id), 1),
    },
    convs: {
      newConv: (key, jid, name, now = NOW) => ({
        phone: key, jid, name: name || '', mode: 'bot', createdAt: now, botStartedAt: now, lastMessageAt: now, unread: 0,
        openingSent: false, pending: null, skipped: [], retries: {}, data: {}, messages: [],
      }),
      getOrCreate: (key, jid, name) => {
        if (st.has(key)) return { conv: st.get(key), created: false };
        st.set(key, d.convs.newConv(key, jid, name));
        return { conv: st.get(key), created: true };
      },
      get: (k) => st.get(k),
      remove: (k) => void st.delete(k),
      save() {},
      addMessage(c, by, text, ts = NOW) {
        const m = { id: 'm' + ++n, by, text, ts };
        c.messages.push(m);
        c.lastMessageAt = Math.max(c.lastMessageAt || 0, ts);
        return m;
      },
      list: () => [...st.values()].map((c) => ({ phone: c.phone })),
      totalUnread: () => [...st.values()].reduce((a, c) => a + c.unread, 0),
    },
  };
  return { d, st, events, sleeps, ingests, sent, leads };
}
const fail = (retryable) => Object.assign(new Error('gagal'), { code: 'SEND_FAILED', retryable });
const botMsgs = (c) => c.messages.filter((m) => m.by === 'bot');

test('alur normal: pembuka + pertanyaan terkirim, commit berjalan', async () => {
  const t = mk(), r = await processIncoming(M(), t.d);
  assert.deepEqual(t.sent, ['Halo', 'Siapa nama Kakak?']);
  assert.equal(r.conv.openingSent, true); assert.equal(r.conv.pending, 'nama'); assert.equal(r.conv.unread, 1);
  assert.deepEqual(r.replies.map((m) => [m.status, m.replyKind, m.fieldId]), [['sent', 'opening', undefined], ['sent', 'question', 'nama']]);
  assert.equal(t.ingests.length, 1); assert.equal(r.attention, null);
  assert.deepEqual(t.events.map((e) => e.type), ['message:new', 'unread']);
});
test('gagal di balasan ke-1: state tidak maju, failed, attention, berhenti', async () => {
  const t = mk({ send: async () => { throw fail(false); } }), r = await processIncoming(M(), t.d);
  assert.equal(r.conv.openingSent, false); assert.equal(r.conv.pending, null);
  assert.deepEqual(botMsgs(r.conv).map((m) => m.status), ['failed']);
  assert.equal(r.conv.attentionReason, 'send_failed'); assert.equal(r.conv.needsAttention, true);
  assert.ok(t.events.some((e) => e.type === 'conversation:attention' && e.payload.reason === 'send_failed'));
});
test('gagal di balasan ke-2: pembuka ter-commit, pertanyaan tidak', async () => {
  let n = 0;
  const t = mk({ send: async () => { if (++n === 2) throw fail(false); return { waId: 'w' + n }; } }), r = await processIncoming(M(), t.d);
  assert.equal(r.conv.openingSent, true); assert.equal(r.conv.pending, null);
  assert.deepEqual(botMsgs(r.conv).map((m) => m.status), ['sent', 'failed']);
});
test('retry sukses pada percobaan ke-2; retryable:false tanpa retry; retryable habis 3x', async () => {
  let n = 0;
  const a = mk({ send: async () => { if (++n === 1) throw fail(true); return { waId: 'w' }; } });
  await processIncoming(M(), a.d); assert.equal(a.sleeps[0], 1000); assert.equal(a.sleeps.length, 1);
  let c1 = 0;
  const b = mk({ send: async () => { c1++; throw fail(false); } });
  await processIncoming(M(), b.d); assert.equal(c1, 1); assert.deepEqual(b.sleeps, []);
  let c2 = 0;
  const c = mk({ send: async () => { c2++; throw fail(true); } });
  await processIncoming(M(), c.d); assert.equal(c2, 3); assert.deepEqual(c.sleeps, [1000, 3000]);
});
test('fromPhone: auto takeover, tanpa ingest dan tanpa kirim', async () => {
  const lead = { id: 'L', phone: '6281' }, t = mk({ leads: [lead] });
  const { conv } = t.d.convs.getOrCreate('6281', 'j', ''); conv.needsAttention = true;
  const r = await processIncoming(M({ fromMe: true, fromPhone: true, text: 'Halo kak' }), t.d);
  assert.equal(r.conv.mode, 'admin'); assert.equal(t.ingests.length, 0); assert.equal(t.sent.length, 0);
  assert.deepEqual(r.conv.messages.map((m) => [m.by, m.sender]), [['admin', 'HP'], ['system', undefined]]);
  assert.match(r.conv.messages[1].text, /Bot dinonaktifkan/);
  assert.equal(r.conv.needsAttention, false); assert.equal(lead.lastReplyAt, NOW);
});
test('reaksi/sistem -> null tanpa efek; tanpa key -> null', async () => {
  const t = mk();
  assert.equal(await processIncoming(M({ kind: 'reaction' }), t.d), null);
  assert.equal(await processIncoming(M({ kind: 'system' }), t.d), null);
  assert.equal(await processIncoming(M({ phone: null, lid: null }), t.d), null);
  assert.equal(t.st.size, 0); assert.equal(t.events.length, 0);
});
test('media: tercatat + attention media', async () => {
  const t = mk(), r = await processIncoming(M({ kind: 'image', text: '[Gambar]', mediaId: 'mid1' }), t.d);
  assert.equal(r.message.type, 'image'); assert.equal(r.message.mediaId, 'mid1');
  assert.equal(r.conv.attentionReason, 'media'); assert.equal(r.attention.reason, 'media');
});
test('customerCount tidak menghitung reaction/system', async () => {
  const t = mk(), { conv } = t.d.convs.getOrCreate('6281', 'j', '');
  conv.openingSent = true;
  for (const ty of ['reaction', 'system', 'text']) Object.assign(t.d.convs.addMessage(conv, 'customer', 'x'), { type: ty });
  await processIncoming(M(), t.d);
  assert.equal(t.ingests[0].customerCount, 2);
});
test('sinkron nama/data ke lead', async () => {
  const lead = { id: 'L', phone: '6281', name: 'x', data: {} }, t = mk({ leads: [lead] });
  await processIncoming(M(), t.d);
  const r = await processIncoming(M({ text: 'Andi' }), t.d);
  assert.equal(lead.name, 'Andi'); assert.equal(lead.data.nama, 'Andi'); assert.equal(r.lead, lead);
});
test('rekonsiliasi lid->phone: pindah', async () => {
  const t = mk(), { conv: old } = t.d.convs.getOrCreate('lid1', 'j', 'Lid');
  t.d.convs.addMessage(old, 'customer', 'lama', 5); old.phoneKnown = false;
  const r = await processIncoming(M({ lid: 'lid1' }), t.d);
  assert.equal(t.st.has('lid1'), false); assert.equal(r.conv.phone, '6281'); assert.equal(r.conv.phoneKnown, true);
  assert.ok(r.conv.messages.some((m) => m.text === 'lama')); assert.equal(r.conv.lid, 'lid1');
});
test('rekonsiliasi lid+phone: gabung', async () => {
  const t = mk(), { conv: old } = t.d.convs.getOrCreate('lid1', 'j', '');
  const { conv: cur } = t.d.convs.getOrCreate('6281', 'j', '');
  Object.assign(old, { createdAt: 1, unread: 2, data: { a: 1, b: 'old' } }); t.d.convs.addMessage(old, 'customer', 'o', 5);
  Object.assign(cur, { createdAt: 9, unread: 1, data: { b: 'cur' } }); t.d.convs.addMessage(cur, 'customer', 'c', 3);
  const r = await processIncoming(M({ lid: 'lid1', ts: NOW }), t.d);
  assert.equal(t.st.has('lid1'), false); assert.equal(r.conv.createdAt, 1); assert.equal(r.conv.unread, 4);
  assert.deepEqual(r.conv.data, { a: 1, b: 'cur' });
  assert.deepEqual(r.conv.messages.slice(0, 2).map((m) => m.text), ['c', 'o']);
});
test('lead ganda: pertahankan yang lebih lama, salin field kosong', async () => {
  const a = { id: 'a', lid: 'lid1', createdAt: 2, name: 'Baru', tag: 't', note: '' };
  const b = { id: 'b', phone: '6281', createdAt: 1, name: '' };
  const t = mk({ leads: [a, b] });
  await processIncoming(M({ lid: 'lid1' }), t.d);
  assert.deepEqual(t.leads.map((l) => l.id), ['b']);
  assert.equal(b.name, 'Baru'); assert.equal(b.tag, 't'); assert.equal(b.phone, '6281'); assert.equal(b.lid, 'lid1');
});
test('onStatusUpdate tidak menurunkan status; failed -> attention', async () => {
  const t = mk(), r = await processIncoming(M(), t.d), [m1, m2] = r.replies;
  onStatusUpdate({ waId: m1.waId, status: 'read' }, t.d);
  onStatusUpdate({ waId: m1.waId, status: 'delivered' }, t.d);
  onStatusUpdate({ waId: m1.waId, status: 'sent' }, t.d);
  assert.equal(m1.status, 'read');
  onStatusUpdate({ waId: m2.waId, status: 'failed' }, t.d);
  assert.equal(m2.status, 'failed'); assert.equal(r.conv.attentionReason, 'send_failed');
  onStatusUpdate({ waId: 'tidak-ada', status: 'read' }, t.d);
});
test('resendMessage menerapkan efek keluaran; NOT_FAILED', async () => {
  let n = 0;
  const t = mk({ send: async () => { if (++n === 1) throw fail(false); return { waId: 'ok' + n }; } });
  const r = await processIncoming(M(), t.d), failed = r.replies[0];
  assert.equal(r.conv.openingSent, false);
  const m = await resendMessage(r.conv, failed.id, t.d.send, t.d);
  assert.equal(m.status, 'sent'); assert.equal(m.waId, 'ok2'); assert.equal(r.conv.openingSent, true);
  assert.equal(r.conv.needsAttention, false);
  await assert.rejects(() => resendMessage(r.conv, failed.id, t.d.send, t.d), { code: 'NOT_FAILED' });
});