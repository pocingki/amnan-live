// Uji pengirim WA dengan jam/sleep injeksi (tanpa jeda nyata).
import assert from 'node:assert/strict';
import { createSender } from '../src/wa-send.js';

delete process.env.BOT_NO_DELAY;

function setup({ rate = 20, connected = true, sendText } = {}) {
  const clock = { t: 1_000_000 };
  const log = [];
  let n = 0;
  const transport = {
    isConnected: () => connected,
    sendPresence: async (_j, s) => { log.push('presence:' + s); },
    sendText: sendText || (async (_j, t) => { log.push('send:' + t); return { waId: 'W' + ++n }; }),
  };
  const sleep = async (ms) => { log.push('sleep:' + ms); clock.t += ms; };
  const s = createSender({ transport, getSettings: () => ({ sendRateLimitPerMinute: rate }), sleep, random: () => 0.5, now: () => clock.t });
  return { s, clock, log, transport };
}

// 1. urutan presence -> jeda -> kirim -> paused (jeda = 800 + 4*15 + 0.5*400)
{
  const { s, log } = setup();
  const r = await s.sendText('j', 'halo');
  assert.deepEqual(log, ['presence:composing', 'sleep:1060', 'send:halo', 'presence:paused']);
  assert.equal(r.waId, 'W1');
  process.env.BOT_NO_DELAY = '1';
  const b = setup();
  await b.s.sendText('j', 'x');
  assert.deepEqual(b.log, ['presence:composing', 'send:x', 'presence:paused']);
}

// 2. rate limit antre (tidak dibuang), FIFO
{
  const { s, log } = setup({ rate: 2 });
  const order = [];
  const ps = ['a', 'b', 'c'].map((t) => s.sendText('j', t).then(() => order.push(t)));
  await Promise.all(ps);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.deepEqual(log.filter((x) => x.startsWith('sleep')), ['sleep:30000']);
}

// 3. timeout antre >60 dtk -> RATE_LIMIT_TIMEOUT, tanpa memanggil transport
{
  const { s, log } = setup({ rate: 1 });
  const rs = await Promise.allSettled([s.sendText('j', 'a'), s.sendText('j', 'b'), s.sendText('j', 'c')]);
  assert.equal(rs[0].status, 'fulfilled');
  assert.equal(rs[1].status, 'fulfilled');
  assert.equal(rs[2].reason.code, 'RATE_LIMIT_TIMEOUT');
  assert.equal(rs[2].reason.retryable, true);
  assert.equal(log.filter((x) => x === 'send:c').length, 0);
}

// 4. tidak terhubung
{
  const { s, log } = setup({ connected: false });
  await assert.rejects(s.sendText('j', 'a'), (e) => e.code === 'WA_NOT_CONNECTED' && e.retryable === true);
  assert.deepEqual(log, []);
}

// 5. galat transport dibungkus SEND_FAILED; retryable ikut err.retryable ?? true
for (const [err, want] of [[Object.assign(new Error('x'), { retryable: false }), false], [new Error('y'), true]]) {
  const { s, log } = setup({ sendText: async () => { throw err; } });
  await assert.rejects(s.sendText('j', 'a'), (e) => e.code === 'SEND_FAILED' && e.retryable === want && e.cause === err);
  assert.equal(log.at(-1), 'presence:paused');
}

// 6. waId tercatat; id asing false setelah masa tenggang
{
  const { s, clock } = setup();
  const { waId } = await s.sendText('j', 'a');
  assert.equal(s.wasSentBySystem(waId), true);
  assert.equal(s.wasSentBySystem('asing'), true); // masih <3 dtk
  clock.t += 3001;
  assert.equal(s.wasSentBySystem('asing'), false);
  assert.equal(s.wasSentBySystem(waId), true);
}

// 7. gema tiba saat kirim berjalan (waId belum tercatat)
{
  let release;
  const gate = new Promise((r) => (release = r));
  const { s, clock } = setup({ sendText: async () => { await gate; return { waId: 'WX' }; } });
  const p = s.sendText('j', 'a');
  await new Promise((r) => setImmediate(r));
  assert.equal(s.wasSentBySystem('ECHO'), true);
  release();
  await p;
  clock.t += 2000;
  assert.equal(s.wasSentBySystem('ECHO'), true);
  clock.t += 1500;
  assert.equal(s.wasSentBySystem('ECHO'), false);
}

// 8. TTL 1 jam dan batas 2000 entri
{
  const { s, clock } = setup({ rate: 120 });
  const { waId } = await s.sendText('j', 'a');
  clock.t += 3_600_001;
  assert.equal(s.wasSentBySystem(waId), false);
  const ids = [];
  for (let i = 0; i < 2001; i++) { ids.push((await s.sendText('j', 'b')).waId); clock.t += 1000; }
  clock.t += 5000;
  assert.equal(s.wasSentBySystem(ids[0]), false);
  assert.equal(s.wasSentBySystem(ids.at(-1)), true);
}

console.log('wa-send.test.js OK');
