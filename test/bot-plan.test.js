import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, decide, fill, applyReplyEffect } from '../src/bot-plan.js';

const NOW = 1_700_000_000_000;
const S0 = () => ({
  botEnabled: true, botName: 'Sari', adminName: 'Dewi', openingMessage: 'Halo, saya {bot}.',
  fallbackMessage: 'Maaf kurang paham.', handoverMessage: 'Dilanjut {admin}.', completionMessage: 'Terima kasih {nama}.',
  botDurationMinutes: 0, staleMinutes: 10, fallbackCooldownMinutes: 30, slangMap: {},
  intents: [{ id: 'harga', keywords: ['harga', 'durasi'], response: 'Info {nama}.', active: true }],
  requiredFields: [
    { id: 'nama', label: 'Nama', question: 'Siapa nama Kakak?', enabled: true, type: 'name' },
    { id: 'keluhan', label: 'Keluhan', question: 'Apa keluhannya?', enabled: true, type: 'text' },
  ],
});
const C0 = (o = {}) => ({ mode: 'bot', name: '', botStartedAt: NOW, openingSent: true, pending: 'nama', skipped: [], retries: {}, data: {}, ...o });
const T = (text, o = {}) => ({ text, kind: 'text', ts: NOW, ...o });
const kinds = (p) => p.replies.map((r) => r.kind);

test('jawaban nama valid -> data+name segera, lanjut pertanyaan', () => {
  const c = C0(), p = plan(c, T('Budi'), S0(), NOW);
  assert.equal(c.name, 'Budi'); assert.equal(c.data.nama, 'Budi'); assert.equal(c.pending, null);
  assert.deepEqual(kinds(p), ['question']); assert.equal(p.replies[0].fieldId, 'keluhan');
  assert.equal(c.pending, null); p.replies[0].commit(c); assert.equal(c.pending, 'keluhan');
});
test('pertanyaan saat pending bukan nama', () => {
  const c = C0(), p = plan(c, T('Berapa lama durasi terapinya'), S0(), NOW);
  assert.equal(c.name, ''); assert.ok(!('nama' in c.data)); assert.deepEqual(kinds(p), ['intent', 'question']);
});
test('reask lalu auto-skip setelah >2', () => {
  const c = C0(), S = S0();
  for (let i = 1; i <= 2; i++) {
    const p = plan(c, T('123'), S, NOW);
    assert.deepEqual(kinds(p), ['reask']); assert.match(p.replies[0].text, /^Maaf, jawaban belum sesuai\. Siapa/);
  }
  assert.equal(c.name, '');
  const p = plan(c, T('123'), S, NOW);
  assert.deepEqual(c.skipped, ['nama']); assert.equal(c.pending, null); assert.deepEqual(kinds(p), ['question']);
});
test('skip', () => {
  const c = C0(), p = plan(c, T('lewati'), S0(), NOW);
  assert.deepEqual(c.skipped, ['nama']); assert.deepEqual(kinds(p), ['question']);
});
test('media bukan jawaban + attention media; intent dari caption', () => {
  const c = C0(), p = plan(c, T('[Gambar] harga', { kind: 'image', caption: 'harga' }), S0(), NOW);
  assert.equal(c.pending, 'nama'); assert.ok(!('nama' in c.data));
  assert.deepEqual(kinds(p), ['intent']); assert.deepEqual(p.attention, { reason: 'media' });
  const q = plan(C0({ openingSent: false }), { text: '[Stiker]', kind: 'sticker', ts: NOW }, S0(), NOW);
  assert.deepEqual(kinds(q), ['opening']);
});
test('reaksi diabaikan', () => {
  assert.deepEqual(plan(C0(), T('', { kind: 'reaction' }), S0(), NOW), { replies: [], attention: null, ignored: true });
});
test('pesan basi: tanpa perubahan state', () => {
  const c = C0({ openingSent: false }), snap = JSON.stringify(c);
  const p = plan(c, T('Budi', { ts: NOW - 11 * 60000 }), S0(), NOW);
  assert.deepEqual(p, { replies: [], attention: { reason: 'stale' }, ignored: false }); assert.equal(JSON.stringify(c), snap);
});
test('durasi habis -> handover tanpa pembuka ulang', () => {
  const S = { ...S0(), botDurationMinutes: 5 }, c = C0({ botStartedAt: NOW - 6 * 60000, openingSent: false });
  const p = plan(c, T('halo'), S, NOW);
  assert.deepEqual(kinds(p), ['handover']); assert.equal(p.replies[0].text, 'Dilanjut Dewi.');
  assert.deepEqual(p.attention, { reason: 'bot_duration' }); assert.equal(c.mode, 'bot');
  p.replies[0].commit(c); assert.equal(c.mode, 'admin'); assert.equal(c.pending, null);
  const c2 = C0({ botStartedAt: NOW - 6 * 60000 }), p2 = plan(c2, T('halo'), { ...S, handoverMessage: '' }, NOW);
  assert.equal(c2.mode, 'admin'); assert.equal(p2.replies.length, 0);
});
test('cooldown fallback + attention no_reply', () => {
  const S = { ...S0(), requiredFields: [] }, c = C0({ pending: null });
  const a = plan(c, T('asdf'), S, NOW); assert.deepEqual(kinds(a), ['fallback']);
  a.replies[0].commit(c); assert.equal(c.lastFallbackAt, NOW);
  const b = plan(c, T('qwer', { ts: NOW + 60000 }), S, NOW + 60000); assert.equal(b.replies.length, 0); assert.deepEqual(b.attention, { reason: 'no_reply' });
  assert.deepEqual(kinds(plan(c, T('qwer', { ts: NOW + 31 * 60000 }), S, NOW + 31 * 60000)), ['fallback']);
});
test('completion hanya sekali', () => {
  const S = S0(), c = C0();
  assert.deepEqual(decide(c, 'Budi', S, NOW), ['Apa keluhannya?']);
  const r = decide(c, 'Pegal', S, NOW);
  assert.deepEqual(r, ['Terima kasih Budi.']); assert.equal(c.completedAt, NOW);
  assert.ok(!kinds(plan(c, T('oke'), S, NOW)).includes('completion'));
});
test('field baru tidak ditanyakan jika completedAt', () => {
  const S = S0(); S.requiredFields.push({ id: 'umur', question: 'Umur?', enabled: true, type: 'text' });
  const c = C0({ pending: null, completedAt: NOW - 1, data: { nama: 'B', keluhan: 'x' } });
  assert.deepEqual(kinds(plan(c, T('harga'), S, NOW)), ['intent']);
});
test('fill tanpa ekspansi ganda', () => {
  assert.equal(fill('Hai {NAMA}/{bot}/{Admin}', { name: '{admin}' }, { botName: 'B', adminName: 'A' }), 'Hai {admin}/B/A');
  assert.equal(fill('{nama}', {}, {}), 'Kak');
});
test('commit tidak dijalankan -> state keluaran tidak maju', () => {
  const c = C0({ openingSent: false, pending: null }), p = plan(c, T('halo'), S0(), NOW);
  assert.deepEqual(kinds(p), ['opening', 'question']);
  assert.equal(c.openingSent, false); assert.equal(c.pending, null); assert.equal(c.lastFallbackAt, undefined);
  p.replies.forEach((r) => r.commit(c)); assert.equal(c.openingSent, true); assert.equal(c.pending, 'nama');
});
test('opening kosong -> openingSent langsung', () => {
  const c = C0({ openingSent: false, pending: null }), p = plan(c, T('halo'), { ...S0(), openingMessage: '' }, NOW);
  assert.equal(c.openingSent, true); assert.deepEqual(kinds(p), ['question']);
});
test('botEnabled false / mode admin -> ignored; applyReplyEffect', () => {
  assert.equal(plan(C0(), T('x'), { ...S0(), botEnabled: false }, NOW).ignored, true);
  assert.equal(plan(C0({ mode: 'admin' }), T('x'), S0(), NOW).ignored, true);
  const c = C0(); applyReplyEffect(c, 'completion', null, 5); assert.equal(c.completedAt, 5);
});