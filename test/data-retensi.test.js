// Retensi (retentionDays) dan hapus data satu pelanggan, termasuk berkas media.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AMNAN_NO_BACKUP = '1';
process.env.AMNAN_NO_BG = '1';
const D = await import('../src/db.js');
const store = await import('../src/store.js');
const C = await import('../src/conversations.js');
const R = await import('../src/retention.js');
const dataApi = await import('../src/api/data.js');

const DAY = 86400000;
function fresh() {
  D.closeAll();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-ret-'));
  process.env.DATA_DIR = dir;
  fs.mkdirSync(path.join(dir, 'media'));
  return dir;
}
const media = (dir, id, ext = '') => { fs.writeFileSync(path.join(dir, 'media', id + ext), 'x'); return path.join(dir, 'media', id + ext); };

test('retensi: pesan lama dihapus, percakapan lama dihapus, media ikut terhapus, lead lama dianonimkan', () => {
  const dir = fresh();
  const now = Date.now();
  const f = { lama: media(dir, 'mLama'), lamaExt: media(dir, 'mLama2', '.jpg'), baru: media(dir, 'mBaru'), campur: media(dir, 'mCampur') };

  const a = C.getOrCreate('6281', 'j', 'Lama').conv; // seluruh percakapan lama
  C.addMessage(a, 'customer', 'x', now - 100 * DAY, { type: 'image', mediaId: 'mLama' });
  C.addMessage(a, 'customer', 'y', now - 99 * DAY, { type: 'image', mediaId: 'mLama2' });
  a.lastMessageAt = now - 99 * DAY; // newConv memberi lastMessageAt = sekarang; simulasikan percakapan lama
  const b = C.getOrCreate('6282', 'j', 'Baru').conv; // masih aktif, tapi ada pesan lama
  C.addMessage(b, 'customer', 'lama', now - 90 * DAY, { type: 'image', mediaId: 'mCampur' });
  C.addMessage(b, 'customer', 'baru', now - 1 * DAY, { type: 'image', mediaId: 'mBaru' });
  store.add({ phone: '6281', name: 'Lama', lastMessageAt: now - 99 * DAY, data: { a: 1 }, notes: [{ text: 'rahasia' }], source: { platform: 'IG', adId: '9' } });
  store.add({ phone: '6282', name: 'Baru', lastMessageAt: now - DAY });
  store.add({ phone: '6283', name: 'TanpaChat', lastMessageAt: now - 120 * DAY });

  assert.deepEqual(R.purge({ days: 0, now }), { days: 0, messages: 0, conversations: 0, media: 0, leadsAnonymized: 0 }, 'retentionDays=0 mati');
  assert.equal(C.list().length, 2);

  const r = R.purge({ days: 30, now });
  assert.equal(r.conversations, 1);
  assert.equal(r.messages, 3);
  assert.equal(r.media, 3);
  assert.equal(r.leadsAnonymized, 2);
  assert.ok(!fs.existsSync(f.lama) && !fs.existsSync(f.lamaExt) && !fs.existsSync(f.campur));
  assert.ok(fs.existsSync(f.baru));
  assert.equal(C.get('6281'), undefined);
  assert.deepEqual(C.get('6282').messages.map((m) => m.text), ['baru']);
  const anon = store.all().filter((l) => l.anonymizedAt);
  assert.equal(anon.length, 2);
  assert.ok(anon.every((l) => l.name === 'Anonim' && /^anon-/.test(l.phone) && l.notes.length === 0));
  assert.equal(store.findByPhone('6282').name, 'Baru');

  D.closeAll(); // tersimpan permanen
  assert.equal(C.get('6281'), undefined);
  assert.equal(C.get('6282').messages.length, 1);
  assert.equal(store.all().filter((l) => l.anonymizedAt).length, 2);
  D.closeAll();
});

test('deleteMedia menolak path traversal', () => {
  const dir = fresh();
  fs.writeFileSync(path.join(dir, 'rahasia.txt'), 'x');
  assert.equal(R.deleteMedia(['../rahasia.txt', '..', '']), 0);
  assert.ok(fs.existsSync(path.join(dir, 'rahasia.txt')));
});

function call(method, url, role = 'admin') {
  const out = { audits: [], status: null, body: null, forbidden: false };
  const ctx = {
    sendJSON: (res, code, body) => { out.status = code; out.body = body; },
    user: { name: 'tes', role },
    audit: (a, d) => out.audits.push([a, d]),
    requireRole: (r) => { const ok = role === r || role === 'admin'; if (!ok) { out.forbidden = true; out.status = 403; } return ok; },
  };
  return dataApi.handle({ method }, {}, new URL(url, 'http://x'), ctx).then((handled) => ({ handled, ...out }));
}

test('DELETE /api/data/customer/:phone menghapus lead + percakapan + media pelanggan itu saja (admin)', async () => {
  const dir = fresh();
  const p1 = media(dir, 'm1');
  const p2 = media(dir, 'm2');
  const c1 = C.getOrCreate('62811', 'j', 'Ani').conv;
  C.addMessage(c1, 'customer', 'hai', Date.now(), { mediaId: 'm1', type: 'image' });
  const c2 = C.getOrCreate('62822', 'j', 'Budi').conv;
  C.addMessage(c2, 'customer', 'hai', Date.now(), { mediaId: 'm2', type: 'image' });
  store.add({ phone: '62811', name: 'Ani' });
  store.add({ phone: '62822', name: 'Budi' });

  let r = await call('DELETE', '/api/data/customer/62811', 'agent');
  assert.equal(r.status, 403);
  assert.ok(C.get('62811') && fs.existsSync(p1), 'agent tidak boleh menghapus');

  r = await call('DELETE', '/api/data/customer/62811');
  assert.equal(r.handled, true);
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted.leads, 1);
  assert.equal(r.body.deleted.media, 1);
  assert.equal(r.audits[0][0], 'data.delete_customer');
  assert.ok(!JSON.stringify(r.audits).includes('62811'), 'audit tidak memuat nomor utuh');
  assert.ok(!fs.existsSync(p1) && fs.existsSync(p2));
  assert.equal(C.get('62811'), undefined);
  assert.equal(store.findByPhone('62811'), undefined);
  assert.ok(C.get('62822') && store.findByPhone('62822'));

  r = await call('DELETE', '/api/data/customer/62811');
  assert.equal(r.status, 404);
  r = await call('DELETE', '/api/data/customer/..%2Fx');
  assert.equal(r.status, 400);

  D.closeAll(); // sudah permanen di disk
  assert.equal(C.get('62811'), undefined);
  assert.equal(store.findByPhone('62811'), undefined);
  assert.equal(C.get('62822').messages.length, 1);
  D.closeAll();
});

test('/api/data/status dan /backup hanya admin', async () => {
  fresh();
  store.add({ phone: '1' });
  let r = await call('GET', '/api/data/status', 'agent');
  assert.equal(r.status, 403);
  r = await call('GET', '/api/data/status');
  assert.equal(r.status, 200);
  assert.equal(r.body.counts.leads, 1);
  assert.equal(r.body.db.writable, true);
  r = await call('POST', '/api/data/backup');
  assert.equal(r.status, 200);
  assert.equal(r.audits[0][0], 'data.backup');
  r = await call('GET', '/api/lain');
  assert.equal(r.handled, false);
  D.closeAll();
});
