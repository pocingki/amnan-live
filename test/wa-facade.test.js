// Uji fasad WA: semua dependensi palsu (tanpa Baileys/WhatsApp asli).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-p5-'));
const { createWhatsApp } = await import('../src/whatsapp.js');

console.error = () => {}; // redam log galat yang memang diuji

function setup(over = {}) {
  const log = { incoming: [], status: [], emits: [], saved: [], seen: new Set(), lid: [] };
  let connOpts;
  const adapter = {
    lidToPhone: async (l) => (log.lid.push(l), '628123'),
    downloadMedia: async () => Buffer.from('x'),
    ...(over.adapter || {}),
  };
  const deps = {
    createConnection: (o) => { connOpts = o; return { wa: { status: 'connected', number: '62811' }, adapter: () => adapter, start() {}, stop() {}, logout() {} }; },
    sender: { sendText: async () => ({ waId: 'S' }), wasSentBySystem: (id) => id === 'SYS' },
    convs: { seenMessage: (id) => log.seen.has(id), markSeen: (id) => log.seen.add(id) },
    extractMessage: (r) => r._ext || { kind: 'text', text: 'halo', caption: '', hasMedia: false, source: { platform: 'ctwa', adId: 'A1' } },
    resolveIdentity: async (k, o) => {
      if (k.remoteJid.endsWith('@lid')) { const p = await o.lidToPhone(k.remoteJid.split('@')[0]); return { jid: k.remoteJid, phone: p, lid: k.remoteJid.split('@')[0] }; }
      return { jid: k.remoteJid, phone: k.remoteJid.split('@')[0], lid: null };
    },
    saveMedia: async (b, o) => (log.saved.push(o), { mediaId: 'M1' }),
    handleIncoming: async (m, s) => { log.incoming.push(m); if (over.throwBot) throw new Error('bot rusak'); },
    onStatusUpdate: (u) => { log.status.push(u); if (over.throwStatus) throw new Error('x'); },
    emit: (t, p) => log.emits.push([t, p]),
    now: () => 5000,
    mediaTimeoutMs: 50,
    ...(over.deps || {}),
  };
  const f = createWhatsApp(deps);
  return { f, log, connOpts };
}
const msg = (o = {}) => ({ key: { remoteJid: '62811@s.whatsapp.net', id: 'W1', fromMe: false, ...(o.key || {}) }, messageTimestamp: 100, pushName: 'Budi', ...o, key: { remoteJid: '62811@s.whatsapp.net', id: 'W1', fromMe: false, ...(o.key || {}) } });

// 1. grup/broadcast/status/newsletter dilewati; jid kosong dilewati
{
  const { f, log } = setup();
  for (const j of ['1@g.us', 'status@broadcast', '1@newsletter', '']) await f.handleMessage(msg({ key: { remoteJid: j, id: 'G' + j } }));
  assert.equal(log.incoming.length, 0);
}
// 2. dedupe berdasar waId
{
  const { f, log } = setup();
  await f.handleMessage(msg()); await f.handleMessage(msg());
  assert.equal(log.incoming.length, 1);
}
// 3. gema sistem dibuang; fromMe dari HP diteruskan (fromMe=fromPhone=true)
{
  const { f, log } = setup();
  await f.handleMessage(msg({ key: { id: 'SYS', fromMe: true } }));
  await f.handleMessage(msg({ key: { id: 'HP1', fromMe: true } }));
  assert.equal(log.incoming.length, 1);
  assert.deepEqual([log.incoming[0].fromMe, log.incoming[0].fromPhone, log.incoming[0].waId], [true, true, 'HP1']);
}
// 4. amplop D1 lengkap + ts + source
{
  const { f, log } = setup(); await f.handleMessage(msg());
  assert.deepEqual(log.incoming[0], {
    waId: 'W1', jid: '62811@s.whatsapp.net', phone: '62811', lid: null, name: 'Budi', ts: 100000, kind: 'text', text: 'halo', caption: '',
    mediaId: null, mediaError: null, fromMe: false, fromPhone: false,
    source: { platform: 'ctwa', adId: 'A1', ctwaClid: '', sourceUrl: '', referralCode: '' },
  });
}
// 5. resolusi lid: phone dari lidToPhone adapter, lid terpisah
{
  const { f, log } = setup(); await f.handleMessage(msg({ key: { remoteJid: '999@lid', id: 'L1' } }));
  assert.deepEqual(log.lid, ['999']);
  assert.deepEqual([log.incoming[0].phone, log.incoming[0].lid], ['628123', '999']);
}
// 6. media tersimpan
{
  const { f, log } = setup({ deps: { extractMessage: () => ({ kind: 'image', text: '[Gambar] cap', caption: 'cap', hasMedia: true, mime: 'image/jpeg', fileName: null }) } });
  await f.handleMessage(msg());
  assert.deepEqual(log.saved, [{ mime: 'image/jpeg', kind: 'image', name: null }]);
  assert.deepEqual([log.incoming[0].mediaId, log.incoming[0].mediaError, log.incoming[0].caption], ['M1', null, 'cap']);
}
// 7. unduh gagal / timeout / simpan gagal -> mediaError, pesan tetap diteruskan
for (const adapter of [
  { downloadMedia: async () => { throw new Error('unduh gagal'); } },
  { downloadMedia: () => new Promise(() => {}) },
]) {
  const { f, log } = setup({ adapter, deps: { extractMessage: () => ({ kind: 'audio', text: '[Pesan suara]', caption: '', hasMedia: true, mime: 'audio/ogg' }) } });
  await f.handleMessage(msg());
  assert.equal(log.incoming.length, 1); assert.equal(log.incoming[0].mediaId, null);
  assert.match(log.incoming[0].mediaError, /unduh gagal|batas waktu/);
}
{
  const { f, log } = setup({ deps: { saveMedia: async () => { const e = new Error('Terlalu besar'); e.code = 'MEDIA_TOO_LARGE'; throw e; }, extractMessage: () => ({ kind: 'video', text: '[Video]', caption: '', hasMedia: true }) } });
  await f.handleMessage(msg());
  assert.deepEqual([log.incoming[0].mediaId, log.incoming[0].mediaError], [null, 'Terlalu besar']);
}
// 8. reaksi pelanggan diteruskan; reaksi/system fromMe dibuang
{
  const react = { deps: { extractMessage: () => ({ kind: 'reaction', text: '', caption: '', hasMedia: false }) } };
  let s = setup(react); await s.f.handleMessage(msg()); assert.equal(s.log.incoming.length, 1);
  s = setup(react); await s.f.handleMessage(msg({ key: { fromMe: true, id: 'R2' } })); assert.equal(s.log.incoming.length, 0);
  s = setup({ deps: { extractMessage: () => ({ kind: 'system', text: '', caption: '' }) } }); await s.f.handleMessage(msg({ key: { fromMe: true, id: 'R3' } })); assert.equal(s.log.incoming.length, 0);
}
// 9. teks kosong dilewati
{
  const { f, log } = setup({ deps: { extractMessage: () => ({ kind: 'text', text: '  ', caption: '', hasMedia: false }) } });
  await f.handleMessage(msg()); assert.equal(log.incoming.length, 0);
}
// 10. onReceipts -> onStatusUpdate per entri (galat tidak menghentikan entri berikutnya)
{
  const { log, connOpts } = setup({ throwStatus: true });
  connOpts.onReceipts([{ waId: 'a', status: 'sent' }, { waId: 'b', status: 'read' }]);
  assert.deepEqual(log.status.map((u) => u.waId), ['a', 'b']);
}
// 11. handleIncoming melempar -> tidak crash; handleMessage tidak melempar
{
  const { f, log } = setup({ throwBot: true });
  await f.handleMessage(msg()); assert.equal(log.incoming.length, 1);
  const g = setup({ deps: { resolveIdentity: async () => { throw new Error('id'); } } });
  await g.f.handleMessage(msg());
  assert.equal(await f.handleMessage(null), undefined);
}
// 12. emit status + onMessages berurutan + pesan terdedup per id
{
  const { log, connOpts } = setup();
  connOpts.onStatus({ status: 'qr', number: null, qr: 'rahasia' });
  assert.deepEqual(log.emits, [['wa:status', { status: 'qr', number: null }]]);
  await connOpts.onMessages([msg({ key: { id: 'A' } }), msg({ key: { id: 'B' } })]);
  assert.deepEqual(log.incoming.map((m) => m.waId), ['A', 'B']);
}
// 13. sendText mendelegasikan ke sender; wa dari koneksi
{
  const { f } = setup(); assert.deepEqual(await f.sendText('j', 't'), { waId: 'S' }); assert.equal(f.wa.number, '62811');
}
console.log('wa-facade: semua tes lolos');
