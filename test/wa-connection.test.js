// Uji koneksi WA: adapter palsu + penjadwal palsu (tanpa Baileys/WhatsApp asli).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-p4-'));
let unhandled = 0;
process.on('unhandledRejection', () => unhandled++);

const { createConnection } = await import('../src/wa-connection.js');
const { makeHandle } = await import('../src/api/wa.js');

const tick = () => new Promise((r) => setImmediate(r));

class FakeAdapter {
  constructor(opts = {}) { Object.assign(this, { calls: [], stopped: 0, cleared: 0, loggedOut: 0, connectError: null, logoutError: null }, opts); }
  async connect(h) { this.h = h; this.calls.push('connect'); if (this.connectError) throw this.connectError; }
  async stop() { this.stopped++; }
  async logout() { this.loggedOut++; if (this.logoutError) throw this.logoutError; }
  async clearAuth() { this.cleared++; }
}

function setup(over = {}) {
  const adapters = [], timers = [], statuses = [], msgs = [], rcpts = [];
  let id = 0;
  const conn = createConnection({
    adapterFactory: () => { const a = new FakeAdapter(over.adapter?.(adapters.length)); adapters.push(a); return a; },
    onStatus: (w) => { statuses.push(w.status); over.onStatus?.(w); },
    onMessages: (m) => { msgs.push(m); over.onMessages?.(m); },
    onReceipts: (r) => { rcpts.push(r); return over.onReceipts?.(r); },
    schedule: (fn, ms) => { const t = { id: ++id, fn, ms, on: true }; timers.push(t); return t.id; },
    clear: (tid) => { const t = timers.find((x) => x.id === tid); if (t) t.on = false; },
    random: () => 0.5,
    now: () => 1000,
  });
  const active = () => timers.filter((t) => t.on);
  const fire = async () => { const t = active()[0]; t.on = false; t.fn(); await tick(); await tick(); };
  return { conn, adapters, timers, statuses, msgs, rcpts, active, fire };
}

// 1. start -> connecting; hanya sekali; qr -> open
{
  const s = setup(); await s.conn.start(); await s.conn.start();
  assert.equal(s.adapters.length, 1);
  assert.equal(s.conn.wa.status, 'connecting');
  s.adapters[0].h.onQr('data:qr'); assert.equal(s.conn.wa.status, 'qr'); assert.equal(s.conn.wa.qr, 'data:qr');
  s.adapters[0].h.onOpen('62811');
  assert.deepEqual([s.conn.wa.status, s.conn.wa.qr, s.conn.wa.number, s.conn.wa.error], ['connected', null, '62811', null]);
  assert.deepEqual(s.statuses, ['connecting', 'qr', 'connected']); // 2. status dilaporkan
}

// 3. backoff naik, tetap satu timer, batas 60 dtk, reset saat open
{
  const s = setup(); await s.conn.start();
  const delays = [];
  for (let i = 0; i < 7; i++) {
    s.conn.adapter().h.onClose({ code: 500 }); await tick(); await tick();
    assert.equal(s.active().length, 1);
    assert.equal(s.conn.wa.status, 'connecting'); // reconnect terjadwal
    delays.push(s.active()[0].ms); await s.fire();
  }
  assert.deepEqual(delays, [2500, 4500, 8500, 16500, 32500, 60500, 60500]);
  assert.equal(s.conn.wa.reconnectAttempts, 7);
  s.conn.adapter().h.onOpen('1'); assert.equal(s.conn.wa.reconnectAttempts, 0);
  s.conn.adapter().h.onClose({}); await tick(); await tick();
  assert.equal(s.active()[0].ms, 2500);
  // 4. start manual saat timer menunggu membatalkan timer lama; socket lama di-stop
  const old = s.adapters.at(-1);
  await s.conn.start();
  assert.equal(s.active().length, 0);
  assert.equal(s.adapters.length, 9);
  assert.ok(old.stopped >= 1 && s.adapters.slice(0, -1).every((a) => a.stopped >= 1));
}

// 5. event adapter lama diabaikan
{
  const s = setup(); await s.conn.start();
  const a0 = s.adapters[0]; a0.h.onClose({ code: 500 }); await tick(); await tick(); await s.fire();
  assert.equal(s.adapters.length, 2);
  a0.h.onOpen('999'); a0.h.onQr('x'); a0.h.onMessages([1]); a0.h.onClose({ replaced: true }); await tick();
  assert.equal(s.conn.wa.status, 'connecting'); assert.equal(s.conn.wa.number, null); assert.equal(s.msgs.length, 0);
  assert.equal(s.conn.adapter(), s.adapters[1]);
  s.adapters[1].h.onMessages([2]); s.adapters[1].h.onReceipts([{ waId: 'a', status: 'read' }]);
  assert.deepEqual([s.msgs, s.rcpts], [[[2]], [[{ waId: 'a', status: 'read' }]]]);
}

// 6. loggedOut -> clearAuth, nomor null, satu start setelah 1500 ms
{
  const s = setup(); await s.conn.start(); s.adapters[0].h.onOpen('62811');
  s.adapters[0].h.onClose({ loggedOut: true }); await tick(); await tick();
  assert.equal(s.adapters[0].cleared, 1); assert.equal(s.conn.wa.number, null);
  assert.equal(s.active().length, 1); assert.equal(s.active()[0].ms, 1500);
  await s.fire(); assert.equal(s.adapters.length, 2); assert.equal(s.active().length, 0);
}

// 7. replaced -> berhenti, tanpa reconnect
{
  const s = setup(); await s.conn.start(); s.adapters[0].h.onOpen('1');
  s.adapters[0].h.onClose({ replaced: true }); await tick(); await tick();
  assert.equal(s.active().length, 0); assert.equal(s.conn.wa.status, 'disconnected');
  assert.equal(s.conn.wa.error, 'Sesi dipakai perangkat lain. Hubungkan ulang secara manual.');
  assert.equal(s.adapters[0].stopped, 1); assert.equal(s.adapters.length, 1);
}

// 8. restartRequired -> adapter baru segera, tanpa timer & tanpa menaikkan percobaan
{
  const s = setup(); await s.conn.start(); s.adapters[0].h.onQr('q');
  s.adapters[0].h.onClose({ restartRequired: true }); await tick(); await tick();
  assert.equal(s.adapters.length, 2); assert.equal(s.timers.length, 0);
  assert.equal(s.conn.wa.reconnectAttempts, 0); assert.equal(s.adapters[0].stopped, 1);
}

// 9. logout saat open: tidak menjadwalkan sendiri; onClose(loggedOut) -> satu start
{
  const s = setup(); await s.conn.start(); s.adapters[0].h.onOpen('1');
  await s.conn.logout();
  assert.equal(s.adapters[0].loggedOut, 1); assert.equal(s.timers.length, 0);
  s.adapters[0].h.onClose({ loggedOut: true }); await tick(); await tick();
  assert.equal(s.active().length, 1); await s.fire(); assert.equal(s.adapters.length, 2);
}

// 10. logout gagal / tidak open: stop + clearAuth + satu start setelah 1000 ms
{
  const s = setup({ adapter: (i) => (i === 0 ? { logoutError: new Error('x') } : {}) });
  await s.conn.start(); s.adapters[0].h.onOpen('1');
  await s.conn.logout();
  assert.equal(s.adapters[0].stopped, 1); assert.equal(s.adapters[0].cleared, 1);
  assert.equal(s.active().length, 1); assert.equal(s.active()[0].ms, 1000); assert.equal(s.conn.wa.number, null);
  await s.fire(); assert.equal(s.adapters.length, 2);
}

// 11. galat connect -> wa.error + reconnect terjadwal
{
  const s = setup({ adapter: (i) => (i === 0 ? { connectError: new Error('jaringan mati') } : {}) });
  await s.conn.start();
  assert.equal(s.conn.wa.error, 'jaringan mati'); assert.equal(s.conn.wa.status, 'connecting');
  assert.equal(s.active().length, 1); assert.equal(s.adapters[0].stopped, 1);
  await s.fire(); assert.equal(s.adapters.length, 2); assert.equal(s.conn.wa.error, null);
}

// 12. callback melempar tidak membuat crash / unhandled rejection
{
  const boom = () => { throw new Error('boom'); };
  const s = setup({ onStatus: boom, onMessages: boom, onReceipts: async () => { throw new Error('async boom'); } });
  await s.conn.start(); const h = s.adapters[0].h;
  h.onQr('q'); h.onMessages([1]); h.onReceipts([]); h.onOpen('1'); await tick(); await tick();
  assert.equal(s.conn.wa.status, 'connected');
}

// 13. stop: timer dibersihkan, disconnected, adapter di-stop
{
  const s = setup(); await s.conn.start(); s.adapters[0].h.onClose({}); await tick(); await tick();
  assert.equal(s.active().length, 1);
  await s.conn.stop(); assert.equal(s.active().length, 0); assert.equal(s.conn.wa.status, 'disconnected');
  await s.conn.start(); s.adapters[1].h.onOpen('1');
  await s.conn.stop(); assert.equal(s.adapters[1].stopped, 1); assert.equal(s.conn.wa.status, 'disconnected');
}

// 14. API: qr hanya untuk admin; logout hanya admin; jalur lain false
{
  const wa = { status: 'qr', qr: 'data:qr', number: null, error: null, since: 5, reconnectAttempts: 2 };
  let loggedOut = 0; const audits = [];
  const handle = makeHandle({ wa, logout: async () => { loggedOut++; }, unread: () => 3 });
  const call = async (method, p, role) => {
    let out = null;
    const ctx = { sendJSON: (_r, code, body) => (out = { code, body }), user: { role }, audit: (a) => audits.push(a),
      requireRole: (r) => { if (role === r) return true; out = { code: 403 }; return false; } };
    const handled = await handle({ method }, {}, new URL('http://x' + p), ctx);
    return { handled, out };
  };
  let r = await call('GET', '/api/wa/status', 'admin');
  assert.equal(r.out.body.qr, 'data:qr'); assert.equal(r.out.body.unread, 3); assert.equal(r.out.body.reconnectAttempts, 2);
  r = await call('GET', '/api/wa/status', 'agent'); assert.equal(r.out.body.qr, null); assert.equal(r.out.body.status, 'qr');
  r = await call('POST', '/api/wa/logout', 'agent'); assert.equal(r.out.code, 403); assert.equal(loggedOut, 0);
  r = await call('POST', '/api/wa/logout', 'admin'); assert.equal(r.out.code, 200); assert.deepEqual([loggedOut, audits], [1, ['wa.logout']]);
  r = await call('GET', '/api/lain', 'admin'); assert.equal(r.handled, false);
}

assert.equal(unhandled, 0);
console.log('wa-connection: semua tes lolos');
