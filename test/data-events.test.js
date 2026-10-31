// Event bus, SSE /api/events, backup/rotasi, dan notifier (webhook/Telegram).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AMNAN_NO_BACKUP = '1';
process.env.AMNAN_NO_BG = '1';
const D = await import('../src/db.js');
const E = await import('../src/events.js');
const C = await import('../src/conversations.js');
const store = await import('../src/store.js');
const N = await import('../src/notifier.js');
const settings = await import('../src/settings.js');
const sse = await import('../src/api/events.js');

function fresh() {
  D.closeAll();
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-ev-'));
}

function fakeConn(headers = {}) {
  const req = Object.assign(new EventEmitter(), { method: 'GET', headers, socket: { setTimeout() {}, setNoDelay() {}, setKeepAlive() {} } });
  const res = Object.assign(new EventEmitter(), {
    chunks: [], head: null, ended: false, writableLength: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(code, h) { this.head = { code, h }; },
    write(s) { this.chunks.push(s); return true; },
    end() { this.ended = true; this.emit('close'); },
  });
  return { req, res, text: () => res.chunks.join('') };
}
const ctx = { sendJSON: (res, code, body) => { res.json = { code, body }; } };

test('bus: on/emit/off, pendengar error tidak mengganggu, wildcard, last', () => {
  E._resetForTests();
  const got = [];
  const off = E.on('x', (p) => got.push(p));
  E.on('x', () => { throw new Error('rusak'); });
  const err = console.error; console.error = () => {};
  E.emit('x', { a: 1 });
  console.error = err;
  assert.deepEqual(got, [{ a: 1 }]);
  off();
  E.emit('x', { a: 2 });
  assert.equal(got.length, 1);
  assert.deepEqual(E.last('x'), { a: 2 });
});

test('SSE: header benar, hello, event terformat, heartbeat 20 dtk, replay Last-Event-ID, tutup bersih', async () => {
  fresh();
  E._resetForTests();
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    E.emit('wa:status', { status: 'connected', number: '6281' });
    const { req, res, text } = fakeConn();
    assert.equal(await sse.handle(req, res, new URL('http://x/api/events'), ctx), true);
    assert.equal(res.head.code, 200);
    assert.match(res.head.h['Content-Type'], /^text\/event-stream/);
    assert.match(res.head.h['Cache-Control'], /no-cache/);
    assert.equal(res.head.h['X-Accel-Buffering'], 'no');
    assert.match(text(), /^retry: 3000\n\n/);
    assert.match(text(), /event: hello\ndata: \{"status":\{"status":"connected"/);

    const id = E.emit('message:new', { phone: '6281', by: 'customer', type: 'text' });
    assert.match(text(), new RegExp(`id: ${id}\\nevent: message:new\\ndata: \\{"phone":"6281","by":"customer","type":"text"\\}\\n\\n`));

    mock.timers.tick(20000);
    assert.ok(text().endsWith(': hb\n\n'), 'heartbeat 20 dtk');
    assert.equal(sse.clientCount(), 1);

    // klien kedua menyambung ulang dengan Last-Event-ID
    const c2 = fakeConn({ 'last-event-id': String(id - 1) });
    await sse.handle(c2.req, c2.res, new URL('http://x/api/events'), ctx);
    assert.match(c2.text(), /event: message:new/);

    req.emit('close'); // klien putus
    assert.equal(sse.clientCount(), 1);
    const before = text().length;
    E.emit('unread', { total: 3 });
    assert.equal(text().length, before, 'tidak menulis ke klien yang sudah tutup');
    mock.timers.tick(40000);
    assert.equal(text().length, before, 'heartbeat berhenti');

    sse.closeAllClients();
    assert.equal(sse.clientCount(), 0);
    assert.equal(c2.res.ended, true);

    const post = fakeConn();
    post.req.method = 'POST';
    await sse.handle(post.req, post.res, new URL('http://x/api/events'), ctx);
    assert.equal(post.res.json.code, 405);
    assert.equal(await sse.handle(post.req, post.res, new URL('http://x/api/lain'), ctx), false);
  } finally {
    mock.timers.reset();
  }
});

test('backup: berkas harian, tidak menimpa, lewati bila kosong, rotasi 14 hari, pemulihan', () => {
  fresh();
  assert.equal(D.backupNow(), null, 'DB kosong tidak dicadangkan');
  store.add({ phone: '1', name: 'Satu' });
  const f1 = D.backupNow();
  assert.ok(f1 && /amnan-\d{4}-\d{2}-\d{2}\.db$/.test(f1));
  assert.equal(D.backupNow(), null, 'sekali per hari');

  const dir = path.dirname(f1);
  const old = path.join(dir, 'amnan-2020-01-01.db');
  const recent = path.join(dir, 'amnan-2026-10-25.db');
  fs.copyFileSync(f1, old); fs.copyFileSync(f1, recent);
  fs.utimesSync(old, new Date(2020, 0, 1), new Date(2020, 0, 1));
  D.backupNow({ force: true }); // memicu rotasi
  const names = fs.readdirSync(dir);
  assert.ok(!names.includes('amnan-2020-01-01.db'), 'cadangan > 14 hari dihapus');
  assert.ok(names.includes(path.basename(f1)));
  if (process.platform !== 'win32') assert.equal(fs.statSync(f1).mode & 0o777, 0o600);

  store.add({ phone: '2', name: 'Dua' });
  store.flush();
  D.closeAll();
  const r = D.restoreBackup(f1);
  assert.ok(r.previous && fs.existsSync(r.previous), 'DB lama disimpan, tidak dihapus');
  assert.deepEqual(store.all().map((l) => l.phone), ['1']);
  D.closeAll();
});

// ---------- notifier ----------
function setupNotifier(notify) {
  fresh();
  E._resetForTests();
  N.stop();
  settings.get().notify = notify;
  const calls = [];
  N.setFetch(async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body), opts }); return { ok: true, status: 200 }; });
  N.start();
  return calls;
}
const tick = () => new Promise((r) => setImmediate(r));

test('notifier: lead:hot -> webhook + Telegram, nama/nomor tersamar, tanpa isi pesan', async () => {
  process.env.PUBLIC_URL = 'https://crm.contoh.id/';
  const calls = setupNotifier({ webhookUrl: 'https://hook.contoh.id/x', telegramBotToken: '123:ABC', telegramChatId: '-100', onHot: true });
  const { conv } = C.getOrCreate('6281234567890', 'j', 'Budi Santoso');
  C.addMessage(conv, 'customer', 'ISI-PESAN-RAHASIA', Date.now());
  E.emit('lead:hot', { phone: '6281234567890', name: 'Budi Santoso' });
  await tick(); await tick();
  assert.equal(calls.length, 2);
  const wh = calls.find((c) => c.url.startsWith('https://hook'));
  const tg = calls.find((c) => c.url.startsWith('https://api.telegram.org/bot123:ABC/sendMessage'));
  assert.ok(wh && tg);
  const all = JSON.stringify(calls.map((c) => c.body));
  assert.ok(!all.includes('ISI-PESAN-RAHASIA'), 'isi pesan tidak dikirim');
  assert.ok(!all.includes('6281234567890'), 'nomor utuh tidak dikirim');
  assert.ok(!all.includes('Santoso'), 'nama belakang tidak dikirim');
  assert.match(tg.body.text, /Budi S\. \(6281\*\*\*\*890\)/);
  assert.match(tg.body.text, /https:\/\/crm\.contoh\.id\/#\/crm/);
  assert.ok(wh.opts.signal, 'ada signal timeout');
  E.emit('lead:hot', { phone: '6281234567890', name: 'Budi Santoso' }); // duplikat dalam 10 menit
  await tick();
  assert.equal(calls.length, 2, 'dedupe');
  N.stop();
  D.closeAll();
});

test('notifier: onHot mati -> tidak mengirim; fetch error/timeout tidak melempar ke proses utama', async () => {
  let calls = setupNotifier({ webhookUrl: 'https://hook.contoh.id/x', onHot: false });
  E.emit('lead:hot', { phone: '6281', name: 'A' });
  await tick();
  assert.equal(calls.length, 0);
  N.stop();

  setupNotifier({ webhookUrl: 'https://hook.contoh.id/x', telegramBotToken: 'TOK:SECRET', telegramChatId: '1', onHot: true });
  N.setFetch(async () => { throw new Error('gagal TOK:SECRET'); });
  const warn = console.warn; const logs = []; console.warn = (...a) => logs.push(a.join(' '));
  assert.equal(await N.notify('x', { title: 't', phone: 'p1' }), false);
  console.warn = warn;
  assert.ok(logs.length && logs.every((l) => !l.includes('TOK:SECRET')), 'token tidak bocor ke log');

  // fetch yang tidak pernah selesai -> dibatalkan setelah 5 dtk (waktu dipalsukan)
  N.setFetch(() => new Promise(() => {}));
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const p = N.notify('x', { title: 't', phone: 'p2' });
    mock.timers.tick(5600);
    assert.equal(await p, false);
  } finally {
    mock.timers.reset();
  }
  N.stop();
  D.closeAll();
});

test('notifier: WA terputus > menit tertentu, tersambung kembali membatalkan', async () => {
  const calls = setupNotifier({ webhookUrl: 'https://hook.contoh.id/x', onDisconnected: 3 });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    E.emit('wa:status', { status: 'disconnected', number: '6281234567890' });
    mock.timers.tick(2 * 60000);
    await tick();
    assert.equal(calls.length, 0, 'belum 3 menit');
    E.emit('wa:status', { status: 'connected', number: '6281234567890' });
    mock.timers.tick(5 * 60000);
    await tick();
    assert.equal(calls.length, 0, 'tersambung lagi sebelum batas');

    E.emit('wa:status', { status: 'disconnected', number: '6281234567890' });
    mock.timers.tick(3 * 60000 + 10);
    await tick(); await tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.event, 'wa:down');
    assert.match(calls[0].body.title, /3 menit/);
  } finally {
    mock.timers.reset();
  }
  N.stop();
  D.closeAll();
});

test('notifier: percakapan needsAttention belum dibalas > attentionMinutes; sudah dibalas -> diam', async () => {
  const calls = setupNotifier({ webhookUrl: 'https://hook.contoh.id/x', attentionMinutes: 10 });
  const a = C.getOrCreate('62811110000', 'j', 'Ani Lestari').conv;
  C.addMessage(a, 'customer', 'RAHASIA-A', Date.now());
  a.needsAttention = true; a.attentionAt = Date.now();
  const b = C.getOrCreate('62822220000', 'j', 'Budi').conv;
  C.addMessage(b, 'customer', 'RAHASIA-B', Date.now());
  b.needsAttention = true; b.attentionAt = Date.now();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    E.emit('conversation:attention', { phone: '62811110000', reason: 'komplain' });
    E.emit('conversation:attention', { phone: '62822220000', reason: 'komplain' });
    mock.timers.tick(5 * 60000);
    C.addMessage(b, 'admin', 'sudah saya balas', Date.now()); // admin membalas Budi
    mock.timers.tick(5 * 60000 + 100);
    await tick(); await tick();
  } finally {
    mock.timers.reset();
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.event, 'attention');
  const all = JSON.stringify(calls[0].body);
  assert.match(all, /Ani L\./);
  assert.ok(!all.includes('RAHASIA') && !all.includes('62811110000'));
  N.stop();
  D.closeAll();
});
