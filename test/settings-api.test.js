// Uji API pengaturan dengan mock req/ctx.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-set-a-'));
const s = await import('../src/settings.js');
const { handle } = await import('../src/api/settings.js');

const audits = [];
async function call(method, p, { role = 'admin', body, headers = {} } = {}) {
  const out = { code: 0, body: null };
  const ctx = {
    user: { name: 'u-' + role, role },
    sendJSON: (_r, code, b) => { out.code = code; out.body = b; },
    readBody: async () => body,
    audit: (a, d) => audits.push({ a, d }),
    requireRole: (r) => { if (role === r) return true; out.code = 403; return false; },
  };
  out.handled = await handle({ method, headers }, {}, new URL(p, 'http://x'), ctx);
  return out;
}

// 1. peran agent: tanpa notify; admin: ada notify dengan token termask
await call('PUT', '/api/settings', { body: { notify: { telegramBotToken: 'SECRET-TOKEN-1234' } } });
let r = await call('GET', '/api/settings', { role: 'agent' });
assert.equal(r.code, 200);
assert.equal('notify' in r.body, false);
r = await call('GET', '/api/settings');
assert.equal(r.body.notify.telegramBotToken, '••••1234');
assert.ok(!JSON.stringify(r.body).includes('SECRET-TOKEN'));

// 2. PUT hanya admin; agent -> 403 dan tidak berubah
const v0 = s.get().version;
r = await call('PUT', '/api/settings', { role: 'agent', body: { brandName: 'Hack' } });
assert.equal(r.code, 403);
assert.equal(s.get().version, v0);

// 3. If-Match cocok (boleh berkutip) -> 200; tidak cocok -> 409 dengan current termask
r = await call('PUT', '/api/settings', { body: { brandName: 'Baru' }, headers: { 'if-match': `"${v0}"` } });
assert.equal(r.code, 200);
assert.equal(r.body.version, v0 + 1);
r = await call('PUT', '/api/settings', { body: { brandName: 'Basi' }, headers: { 'if-match': String(v0) } });
assert.equal(r.code, 409);
assert.equal(r.body.error, 'Pengaturan diubah orang lain, muat ulang.');
assert.equal(r.body.current.version, v0 + 1);
assert.equal(r.body.current.notify.telegramBotToken, '••••1234');
assert.equal(s.get().brandName, 'Baru');

// 4. audit hanya nama kunci + versi, tanpa nilai rahasia
audits.length = 0;
await call('PUT', '/api/settings', { body: { notify: { webhookUrl: 'https://hooks.example.com/rahasia-xyz', telegramBotToken: 'TOK-98765' }, brandName: 'C', version: 1, foo: 1 } });
assert.equal(audits.length, 1);
assert.equal(audits[0].a, 'settings.update');
assert.deepEqual(audits[0].d.fields.sort(), ['brandName', 'notify']);
assert.ok(!JSON.stringify(audits).match(/rahasia-xyz|TOK-98765/));

// 5. VALIDATION -> 400; history & restore (admin saja; 404 bila tidak ada)
r = await call('PUT', '/api/settings', { body: { notify: { webhookUrl: 'http://127.0.0.1/x' } } });
assert.equal(r.code, 400);
assert.equal((await call('GET', '/api/settings/history', { role: 'agent' })).code, 403);
r = await call('GET', '/api/settings/history');
assert.ok(r.body.length >= 1 && !('settings' in r.body[0]));
assert.equal((await call('POST', '/api/settings/restore', { body: { version: 9999 } })).code, 404);
const first = r.body[0].version;
r = await call('POST', '/api/settings/restore', { body: { version: first } });
assert.equal(r.code, 200);
assert.equal(r.body.version, s.get().version);
assert.equal(r.body.brandName, 'acesio');

// 6. jalur lain -> false
assert.equal((await call('GET', '/api/lain')).handled, false);
assert.equal((await call('DELETE', '/api/settings')).handled, false);

console.log('settings-api.test.js OK');
