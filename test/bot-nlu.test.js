// Uji NLU bot (fungsi murni, tanpa dependensi).
import assert from 'node:assert/strict';
import { normalizeText, matchIntent } from '../src/bot-intent.js';
import { normPhone, isSkip, isQuestion, validateAnswer } from '../src/bot-validate.js';

const I = (id, keywords, o = {}) => ({ id, name: id, keywords, response: id, active: true, priority: 0, ...o });
const intents = [I('harga', ['harga', 'biaya', 'tarif', 'berapa']), I('jadwal', ['jadwal', 'jam buka']), I('lokasi', ['lokasi', 'alamat', 'dimana'])];
const id = (t, list = intents, slang) => matchIntent(t, list, slang)?.id ?? null;

// 1. normalizeText
for (const [inp, slang, out] of [
  ['hargaaa!!', {}, 'harga'], ['Hrg paket brp?', {}, 'harga paket berapa'], ['Kaan', {}, 'kaan'], ['Kaaan', {}, 'kan'],
  ['Café  Müller', {}, 'cafe muller'], ['gk bsk trims', {}, 'tidak besok terima kasih'],
  ['hrg ok', { hrg: 'harga paket', ok: 'oke' }, 'harga paket oke'], ['', {}, ''], [null, {}, ''],
]) assert.equal(normalizeText(inp, slang), out, inp);

// 2. matchIntent: tabel input -> intent
for (const [t, want] of [
  ['harganya berapa?', 'harga'], ['hrg paket brp', 'harga'], ['biayanya berapa kak', 'harga'], ['Harga?', 'harga'],
  ['hargaaa', 'harga'], ['hargai saya', null], ['pengharga', null], ['jam buka kapan', 'jadwal'], ['jam tutup', null],
  ['jadwalnya gimana', 'jadwal'], ['alamatnya dmn', 'lokasi'], ['halo', null], ['', null],
]) assert.equal(id(t), want, t);

// 3. skor tertinggi, lalu priority, lalu urutan; intent nonaktif diabaikan
assert.equal(id('harga biaya jadwal'), 'harga'); // skor 2 vs 1
const tie = [I('a', ['harga']), I('b', ['harga'], { priority: 5 }), I('c', ['harga'], { priority: 5 })];
assert.equal(id('harga', tie), 'b');
assert.equal(id('harga', [I('a', ['harga']), I('b', ['harga'])]), 'a');
assert.equal(id('harga', [I('a', ['harga'], { active: false })]), null);

// 4. slangMap menimpa bawaan
assert.equal(id('pricelist', [I('p', ['harga'])], { pricelist: 'harga' }), 'p');
assert.equal(id('brp', [I('x', ['berapa']), I('y', ['murah'])], { brp: 'murah' }), 'y');

// 5. normPhone
for (const [p, want] of [['0812-3456-7890', '6281234567890'], ['+62 812 3456 7890', '6281234567890'], ['6281234567890', '6281234567890'],
  ['0812', null], ['1234567890123456', null], ['abc', null], [null, null]]) assert.equal(normPhone(p), want, String(p));

// 6. isSkip
for (const [t, want] of [['Lewati.', true], ['SKIP', true], ['nanti dulu!', true], ['Gak usah', true], ['nggak mau', true],
  ['ya', false], ['tidak', false], ['nanti saja ya', false], ['', false]]) assert.equal(isSkip(t), want, t);

// 7. isQuestion
for (const [t, im, want] of [['harga?', false, true], ['berapa lama terapinya', false, true], ['di mana lokasinya', false, true],
  ['dimana alamat', false, true], ['gmn caranya', false, true], ['halo', { id: 'x' }, true], ['Budi', false, false], ['besok jam 10', false, false], ['', false, false]])
  assert.equal(isQuestion(t, im), want, t);

// 8. validateAnswer name
const name = { type: 'name' };
for (const [t, ok, value] of [['Budi', true, 'Budi'], ['nama saya Budi', true, 'Budi'], ['Nama: Siti Aminah', true, 'Siti Aminah'], ['panggil aja Mas Joko', true, 'Mas Joko'],
  ['Berapa lama durasi terapinya', false], ['Siapa?', false], ['12345', false], ['😀', false], ['a', false], ['satu dua tiga empat lima enam tujuh', false], ['', false]]) {
  const r = validateAnswer(name, t);
  assert.equal(r.ok, ok, t); if (ok) assert.equal(r.value, value, t); else assert.match(r.reason, /\S/);
}

// 9. phone
assert.deepEqual(validateAnswer({ type: 'phone' }, '0812 3456 7890'), { ok: true, value: '6281234567890', reason: null });
assert.equal(validateAnswer({ type: 'phone' }, 'tidak punya').ok, false);

// 10. date
for (const [t, ok] of [['besok', true], ['Lusa pagi', true], ['hari ini', true], ['Senin depan', true], ["Jum'at", true], ['12 Mei', true], ['5 des 2026', true],
  ['12/5', true], ['3-6-2026', true], ['asal saja', false], ['', false], ['x'.repeat(101), false]]) assert.equal(validateAnswer({ type: 'date' }, t).ok, ok, t);
assert.equal(validateAnswer({ type: 'date' }, ' besok sore ').value, 'besok sore');

// 11. choice
const ch = { type: 'choice', options: ['Nyeri punggung', 'Cedera olahraga', 'Pasca stroke'] };
for (const [t, want] of [['2', 'Cedera olahraga'], ['3.', 'Pasca stroke'], ['nyeri punggung', 'Nyeri punggung'], ['saya mau pasca stroke kak', 'Pasca stroke'],
  ['punggung', 'Nyeri punggung'], ['4', null], ['0', null], ['lainnya', null]]) {
  const r = validateAnswer(ch, t); assert.equal(r.ok, want !== null, t); assert.equal(r.value, want, t);
}
assert.match(validateAnswer(ch, '9').reason, /1\. Nyeri punggung/);

// 12. text (default tanpa type)
for (const [f, t, ok] of [[{}, 'keluhan lutut', true], [{ type: 'text' }, 'a', true], [{ type: 'text' }, '   ', false], [{ type: 'text' }, 'x'.repeat(501), false], [{ type: 'text' }, 'x'.repeat(500), true]])
  assert.equal(validateAnswer(f, t).ok, ok, t.slice(0, 10));

console.log('bot-nlu: semua tes lolos');
