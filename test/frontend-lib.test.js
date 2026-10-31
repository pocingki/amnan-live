// Uji fungsi murni frontend (lib.js + helper di pages/*). Tanpa browser: DOM yang dibutuhkan di-stub seperlunya.
import test from 'node:test';
import assert from 'node:assert/strict';

const lib = await import('../public/assets/js/lib.js');
const percakapan = await import('../public/assets/js/pages/percakapan.js');
const pesan = await import('../public/assets/js/pages/pesan.js');
const pengaturan = await import('../public/assets/js/pages/pengaturan.js');
const tester = await import('../public/assets/js/pages/tester.js');

const ts = new Date('2026-10-31T10:05:00').getTime();

test('esc melepas karakter HTML', () => {
  assert.equal(lib.esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(lib.esc(null), '');
});

test('readCookie + friendlyMessage', () => {
  assert.equal(lib.readCookie('csrf', 'a=1; csrf=tok%20en; b=2'), 'tok en');
  assert.equal(lib.readCookie('x', 'a=1'), '');
  assert.match(lib.friendlyMessage(413, null), /413/);
  assert.match(lib.friendlyMessage(403, { error: 'CSRF' }), /Muat ulang/);
  assert.match(lib.friendlyMessage(403, { error: 'Forbidden' }), /izin/);
  assert.equal(lib.friendlyMessage(400, { error: 'Pesan kosong' }), 'Pesan kosong');
  assert.match(lib.friendlyMessage(502, null), /502/);
});

test('api(): CSRF hanya pada non-GET, error jaringan ramah (bukan "Failed to fetch")', async () => {
  const calls = [];
  globalThis.fetch = async (path, o) => { calls.push({ path, o }); return { ok: true, status: 200, text: async () => '{"ok":true}' }; };
  lib.setCsrfToken('T0K');
  await lib.api('/api/x');
  await lib.send('/api/x', { a: 1 });
  await lib.send('/api/x', {}, 'PUT', { 'If-Match': '3' });
  assert.equal(calls[0].o.headers['X-CSRF-Token'], undefined);
  assert.equal(calls[1].o.headers['X-CSRF-Token'], 'T0K');
  assert.equal(calls[2].o.headers['If-Match'], '3');
  assert.equal(calls[2].o.headers['X-CSRF-Token'], 'T0K');

  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(lib.api('/api/x'), (e) => !/Failed to fetch/.test(e.message) && e.status === 0);

  globalThis.fetch = async () => ({ ok: false, status: 413, text: async () => '<html>too large</html>' });
  await assert.rejects(lib.send('/api/settings', {}, 'PUT'), (e) => e.status === 413 && /413/.test(e.message));
});

test('saveSettings: antrean menghitung patch dari data terbaru + If-Match naik', async () => {
  const el = () => ({ appendChild() {}, setAttribute() {}, remove() {}, set textContent(v) {} });
  globalThis.document = { getElementById: () => el(), createElement: el, body: el() };
  const st = globalThis.setTimeout;
  globalThis.setTimeout = (f, ms) => { const t = st(f, ms); if (ms >= 1000) t.unref?.(); return t; }; // hanya timer toast yang di-unref
  let server = { version: 1, intents: [{ id: 'a', active: true }, { id: 'b', active: true }] };
  const seen = [];
  globalThis.fetch = async (path, o) => {
    if (o.method === 'GET') return { ok: true, status: 200, text: async () => JSON.stringify(server) };
    seen.push(o.headers['If-Match']);
    await new Promise((r) => setTimeout(r, 5));
    server = { ...server, ...JSON.parse(o.body), version: server.version + 1 };
    return { ok: true, status: 200, text: async () => JSON.stringify(server) };
  };
  await lib.loadSettings();
  const t = (id) => (c) => ({ intents: c.intents.map((i) => (i.id === id ? { ...i, active: false } : i)) });
  await Promise.all([lib.saveSettings(t('a')), lib.saveSettings(t('b'))]); // toggle cepat
  assert.deepEqual(seen, ['1', '2']);
  assert.deepEqual(server.intents.map((i) => i.active), [false, false]); // tidak saling menimpa
  globalThis.setTimeout = st;
  delete globalThis.document;
});

test('formatTitle & debounce', async () => {
  assert.equal(lib.formatTitle('CRM', 0), 'CRM');
  assert.equal(lib.formatTitle('CRM', 3), '(3) CRM');
  assert.equal(lib.formatTitle('CRM', 150), '(99+) CRM');
  let n = 0;
  const d = lib.debounce(() => n++, 10);
  d(); d(); d();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(n, 1);
});

test('event: parseEventData + emitEvent/onEvent', () => {
  assert.deepEqual(lib.parseEventData('{"phone":"62"}'), { payload: { phone: '62' } });
  assert.deepEqual(lib.parseEventData('{"type":"unread","payload":{"total":2}}'), { type: 'unread', payload: { total: 2 } });
  assert.equal(lib.parseEventData('bukan json').payload && Object.keys(lib.parseEventData('x').payload).length, 0);
  const got = [];
  const off = lib.onEvent('lead:hot', (p) => got.push(p));
  lib.emitEvent('lead:hot', { phone: '1' });
  off();
  lib.emitEvent('lead:hot', { phone: '2' });
  assert.deepEqual(got, [{ phone: '1' }]);
});

test('bubble: status nyata, bukan ✓✓ tetap', () => {
  const m = (status, by = 'admin') => ({ id: '1', by, text: 'Halo', ts, status });
  const own = (x, o = {}) => lib.bubble(x, { own: true, ...o });
  assert.ok(!own(m('sent')).includes('✓') && !own(m('sent')).includes('&#10003;'));
  assert.match(own(m('sending')), /Mengirim/);
  assert.match(own(m('sent')), /Terkirim/);
  assert.match(own(m('delivered')), /Diterima/);
  assert.match(own(m('read')), /st-read/);
  assert.match(own(m('failed'), { canRetry: true }), /data-a="retry"[^>]*data-id="1"/);
  assert.doesNotMatch(own(m('failed')), /data-a="retry"/);
  assert.match(own(m(undefined)), /Terkirim/); // data lama tanpa status
  assert.equal(lib.statusKey({ by: 'customer', text: 'x' }, { own: true }), null);
  assert.equal(lib.statusKey({ by: 'bot', status: 'failed' }, { own: false }), 'failed');
  assert.equal(lib.statusKey({ by: 'bot', status: 'read' }, { own: false }), null);
});

test('bubble: teks di-escape, media lewat /api/media/:id dengan alt/label', () => {
  assert.match(lib.bubble({ id: 'x', by: 'customer', text: '<img onerror=1>', ts }), /&lt;img onerror=1&gt;/);
  const img = lib.mediaHTML({ type: 'image', mediaId: 'ab/12', by: 'customer' });
  assert.match(img, /src="\/api\/media\/ab%2F12"/);
  assert.match(img, /alt="Gambar dari pelanggan"/);
  assert.match(img, /data-zoom=/);
  assert.match(lib.mediaHTML({ type: 'audio', mediaId: 'a1' }), /<audio[^>]+controls/);
  const doc = lib.mediaHTML({ type: 'document', mediaId: 'd1', fileName: 'hasil.pdf' });
  assert.match(doc, /href="\/api\/media\/d1" download/);
  assert.match(doc, /hasil\.pdf/);
  assert.match(lib.mediaHTML({ type: 'image', by: 'customer' }), /tidak tersedia/);
  assert.equal(lib.mediaHTML({ type: 'text' }), '');
  assert.equal(lib.messageText({ type: 'image', text: '[Gambar]' }), '');
  assert.equal(lib.messageText({ type: 'image', caption: 'sakit lutut' }), 'sakit lutut');
  assert.equal(lib.previewText({ by: 'customer', type: 'audio', text: '' }), 'Pesan suara');
});

test('chatHTML: chip tanggal, chip sistem, teks status hanya di pesan terakhir', () => {
  const msgs = [
    { id: '1', by: 'bot', text: 'a', ts, status: 'read' },
    { id: '2', by: 'system', text: 'Admin mengambil alih dari HP', ts: ts + 1 },
    { id: '3', by: 'admin', text: 'b', ts: ts + 2, status: 'delivered' },
  ];
  const h = lib.chatHTML(msgs, (m) => ({ own: m.by !== 'customer' }));
  assert.match(h, /sys-chip/);
  assert.match(h, /Admin mengambil alih dari HP/);
  assert.equal((h.match(/b-st-text/g) || []).length, 1);
});

test('keywordConflicts: sama persis dan tumpang tindih', () => {
  const intents = [
    { name: 'Harga', keywords: ['harga', 'biaya'], active: true },
    { name: 'Paket', keywords: ['harga paket', 'promo'], active: true },
    { name: 'Lain', keywords: ['alamat'], active: true },
    { name: 'Mati', keywords: ['harga'], active: false },
  ];
  const c = lib.keywordConflicts(intents);
  assert.ok(c.has(0) && c.has(1));
  assert.ok(!c.has(2) && !c.has(3));
  assert.equal(c.get(0)[0].kind, 'tumpang');
  const same = lib.keywordConflicts([{ name: 'A', keywords: ['Harga'] }, { name: 'B', keywords: ['harga!'] }]);
  assert.equal(same.get(0)[0].kind, 'sama');
  assert.match(lib.conflictText(same.get(0)[0]), /"B"/);
});

test('CSV: kutip, baris ganda, nomor baris, kutip tidak ditutup, formula guard', () => {
  const csv = 'intent,kata_kunci,respons,aktif,prioritas\r\n"Harga","harga|biaya","Baris1\nBaris2, ok",1,5\r\nKosong,,,0,\r\n';
  const { items } = lib.intentsFromCSV(csv);
  assert.equal(items.length, 2);
  assert.equal(items[0].response, 'Baris1\nBaris2, ok');
  assert.deepEqual(items[0].keywords, ['harga', 'biaya']);
  assert.equal(items[0].priority, '5');
  assert.equal(items[1].line, 4); // baris fisik (respons sebelumnya 2 baris)
  assert.equal(items[1].active, false);
  assert.equal(lib.intentsFromCSV('a,b,c\n"x,y,z').errors.length, 1);
  assert.equal(lib.csvCell('=1+1'), '"\'=1+1"');
  assert.equal(lib.intentsFromCSV('intent,respons\n"\'=cmd","ok"').items[0].name, '=cmd');
  assert.equal(lib.intentsFromCSV('intent;kata_kunci;respons\nA;x;y').items[0].response, 'y'); // titik koma
  assert.throws(() => lib.intentsFromJSON('{rusak'), /JSON tidak valid/);
  assert.equal(lib.intentsFromJSON('{"intents":[{"intent":"A","respons":"B"}]}').items[0].name, 'A');
});

test('previewIntentImport: baru / duplikat / error per baris + mode', () => {
  const existing = [{ id: 'harga', name: 'Tanya Harga', keywords: ['harga'], response: 'lama', active: true, priority: 1 }];
  const items = [
    { line: 2, name: 'tanya  harga', keywords: ['tarif'], response: 'baru', active: true, priority: null },
    { line: 3, name: 'Alamat', keywords: ['alamat'], response: 'Jl. A', active: true, priority: '3' },
    { line: 4, name: 'Alamat', keywords: [], response: 'dobel', active: true, priority: null },
    { line: 5, name: '', keywords: [], response: 'x', active: true, priority: null },
    { line: 6, name: 'P', keywords: [], response: 'x', active: true, priority: '999' },
  ];
  const add = lib.previewIntentImport(existing, items, 'add');
  assert.deepEqual(add.rows.map((r) => r.state), ['duplikat', 'baru', 'duplikat', 'error', 'error']);
  assert.deepEqual(add.counts, { baru: 1, duplikat: 2, error: 2 });
  assert.equal(add.result.length, 2);
  assert.equal(add.result[0].response, 'lama');
  const upd = lib.previewIntentImport(existing, items, 'update');
  assert.equal(upd.result[0].response, 'baru');
  assert.equal(upd.result[0].id, 'harga');
  assert.equal(upd.result[0].priority, 1); // prioritas tidak ada di file: dipertahankan
  assert.equal(lib.previewIntentImport(existing, items, 'replace').result.length, 2);
  const full = lib.previewIntentImport(Array.from({ length: 300 }, (_, i) => ({ name: 'n' + i, keywords: [], response: 'r' })), [items[1]], 'add');
  assert.match(full.rows[0].reason, /batas 300/);
});

test('parseSlang / slangToText / parseKeywords / parseOptions', () => {
  const r = lib.parseSlang('gak = tidak\nbgt => banget\n# komentar\nrusak\ngak = lagi\nsama = sama');
  assert.deepEqual(r.map, { gak: 'tidak', bgt: 'banget' });
  assert.deepEqual(r.errors.map((e) => e.line), [4, 5, 6]);
  assert.equal(lib.slangToText({ gak: 'tidak' }), 'gak = tidak');
  assert.deepEqual(lib.parseKeywords('Harga, biaya;HARGA\nTarif'), ['harga', 'biaya', 'tarif']);
  assert.deepEqual(lib.parseOptions('A\nB, A | C'), ['A', 'B', 'C']);
});

test('normHistory menerima beberapa bentuk', () => {
  const h = lib.normHistory({ history: [{ version: 2, updatedAt: 5, updatedBy: 'x', changes: ['a', 'b'] }, { version: 3, ts: 9 }, { foo: 1 }] });
  assert.deepEqual(h.map((x) => x.version), [3, 2]);
  assert.equal(h[1].summary, 'a, b');
  assert.equal(lib.normHistory([{ version: 1 }]).length, 1);
});

test('percakapan: filterConversations', () => {
  const l = [
    { phone: '1', name: 'Budi', needsAttention: true, last: { text: 'sakit lutut' } },
    { phone: '2', name: 'Sari', awaitingReply: true, last: { type: 'image', text: '' } },
    { phone: '628123', name: '', last: { text: 'halo' } },
  ];
  assert.equal(percakapan.filterConversations(l).length, 3);
  assert.deepEqual(percakapan.filterConversations(l, 'attn').map((c) => c.phone), ['1']);
  assert.deepEqual(percakapan.filterConversations(l, 'await').map((c) => c.phone), ['2']);
  assert.deepEqual(percakapan.filterConversations(l, 'all', 'LUTUT').map((c) => c.phone), ['1']);
  assert.deepEqual(percakapan.filterConversations(l, 'all', '6281').map((c) => c.phone), ['628123']);
  assert.deepEqual(percakapan.filterConversations(l, 'all', 'gambar').map((c) => c.phone), ['2']);
});

test('pesan: move menggeser berdasarkan id', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(pesan.move(list, 'b', -1, 'intents').intents.map((x) => x.id), ['b', 'a', 'c']);
  assert.equal(pesan.move(list, 'a', -1, 'intents'), null);
  assert.throws(() => pesan.move(list, 'zzz', 1, 'intents'), /dihapus/);
});

test('pengaturan: buildSettingsPatch validasi', () => {
  const ok = { brandName: 'acesio', botName: 'Bot', adminName: 'Admin', botDurationMinutes: '0', staleMinutes: '10', fallbackCooldownMinutes: '30', sendRateLimitPerMinute: '20', retentionDays: '0', attentionMinutes: '15', botEnabled: 'on', onHot: 'on', webhookUrl: '', telegramBotToken: '', telegramChatId: '' };
  const r = pengaturan.buildSettingsPatch(ok, { notify: { x: 1 } });
  assert.deepEqual(r.errors, []);
  assert.equal(r.patch.staleMinutes, 10);
  assert.equal(r.patch.botEnabled, true);
  assert.equal(r.patch.autoTakeoverOnPhoneReply, false);
  assert.equal(r.patch.notify.onHot, true);
  assert.equal(r.patch.notify.onDisconnected, false);
  assert.equal(r.patch.notify.attentionMinutes, 15);
  assert.equal(r.patch.notify.x, 1); // field notify lain dipertahankan
  const bad = pengaturan.buildSettingsPatch({ ...ok, staleMinutes: '0', sendRateLimitPerMinute: 'abc', webhookUrl: 'ftp://x', telegramBotToken: 't' });
  assert.deepEqual(bad.errors.map((e) => e.field).sort(), ['sendRateLimitPerMinute', 'staleMinutes', 'telegramChatId', 'webhookUrl']);
});

test('tester: mergeChips, diffTesterView, attentionOf', () => {
  const msgs = [{ id: 'a' }, { id: 'b' }];
  const out = tester.mergeChips(msgs, [{ id: 'c1', after: 'a' }, { id: 'c2', after: null }, { id: 'c3', after: 'hilang' }]);
  assert.deepEqual(out.map((x) => x.id), ['c2', 'a', 'c1', 'b', 'c3']);
  const prev = { messages: [{ id: '1', by: 'bot', status: 'sending' }], status: { mode: 'bot' }, needsAttention: false };
  const next = { messages: [{ id: '1', by: 'bot', status: 'failed' }], status: { mode: 'admin' }, needsAttention: true, attentionReason: 'Gagal kirim' };
  const notes = tester.diffTesterView(prev, next);
  assert.equal(notes.length, 3);
  assert.match(notes[0], /Mengirim → Gagal terkirim/);
  assert.match(notes[1], /Perlu perhatian: Gagal kirim/);
  assert.match(notes[2], /bot → admin/);
  assert.deepEqual(tester.attentionOf({ status: { needsAttention: true, attentionReason: 'x' } }), { on: true, reason: 'x' });
  assert.deepEqual(tester.attentionOf({}), { on: false, reason: '' });
});
