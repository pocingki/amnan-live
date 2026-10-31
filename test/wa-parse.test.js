// Uji parser pesan WA dan resolusi identitas (LID/nomor).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-wa-'));
const { unwrap, extractMessage } = await import('../src/wa-message.js');
const { jidToDigits, resolveIdentity, rememberLidPhone, lookupLidPhone, flushLidMap } = await import('../src/wa-identity.js');

const X = (message) => extractMessage({ key: {}, message });
const pick = (r) => [r.kind, r.text, r.caption, r.hasMedia, r.mime, r.fileName];

// 1. tiap kind (tabel): [pesan, [kind,text,caption,hasMedia,mime,fileName]]
const table = [
  [{ conversation: 'halo' }, ['text', 'halo', '', false, '', '']],
  [{ extendedTextMessage: { text: 'panjang' } }, ['text', 'panjang', '', false, '', '']],
  [{ buttonsResponseMessage: { selectedDisplayText: 'Ya' } }, ['text', 'Ya', '', false, '', '']],
  [{ listResponseMessage: { title: 'Opsi 1' } }, ['text', 'Opsi 1', '', false, '', '']],
  [{ templateButtonReplyMessage: { selectedDisplayText: 'Tpl' } }, ['text', 'Tpl', '', false, '', '']],
  [{ imageMessage: { mimetype: 'image/jpeg', caption: 'cap' } }, ['image', '[Gambar] cap', 'cap', true, 'image/jpeg', '']],
  [{ imageMessage: { mimetype: 'image/jpeg' } }, ['image', '[Gambar]', '', true, 'image/jpeg', '']],
  [{ videoMessage: { mimetype: 'video/mp4', caption: 'v' } }, ['video', '[Video] v', 'v', true, 'video/mp4', '']],
  [{ audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } }, ['audio', '[Pesan suara]', '', true, 'audio/ogg; codecs=opus', '']],
  [{ stickerMessage: { mimetype: 'image/webp' } }, ['sticker', '[Stiker]', '', true, 'image/webp', '']],
  [{ documentMessage: { mimetype: 'application/pdf', fileName: 'a.pdf' } }, ['document', '[Dokumen] a.pdf', '', true, 'application/pdf', 'a.pdf']],
  [{ locationMessage: { degreesLatitude: 1 } }, ['location', '[Lokasi]', '', false, '', '']],
  [{ liveLocationMessage: {} }, ['location', '[Lokasi]', '', false, '', '']],
  [{ contactMessage: { displayName: 'x' } }, ['contact', '[Kontak]', '', false, '', '']],
  [{ contactsArrayMessage: { contacts: [] } }, ['contact', '[Kontak]', '', false, '', '']],
];
for (const [m, want] of table) assert.deepEqual(pick(X(m)), want, JSON.stringify(m));

// 2. bungkus berlapis
{
  const inner = { imageMessage: { mimetype: 'image/png', caption: 'c' } };
  const wrapped = { ephemeralMessage: { message: { viewOnceMessageV2: { message: { viewOnceMessageV2Extension: { message: inner } } } } } };
  assert.equal(unwrap(wrapped), inner);
  assert.deepEqual(pick(X(wrapped)), ['image', '[Gambar] c', 'c', true, 'image/png', '']);
  const doc = { documentWithCaptionMessage: { message: { documentMessage: { fileName: 'f.docx', caption: 'lihat', mimetype: 'x/y' } } } };
  assert.equal(X(doc).text, '[Dokumen] f.docx lihat');
  let deep = { conversation: 'dalam' };
  for (let i = 0; i < 6; i++) deep = { ephemeralMessage: { message: deep } }; // 6 tingkat: berhenti di 5
  assert.equal(extractMessage({ message: deep }).kind, 'document'); // masih terbungkus -> tak dikenal, tidak jadi jawaban
}

// 3. reaksi, system, edit, kontekskosong
for (const m of [{ reactionMessage: { text: '👍' } }]) assert.deepEqual(pick(X(m)), ['reaction', '', '', false, '', '']);
for (const m of [{ protocolMessage: {} }, { editedMessage: { message: { conversation: 'baru' } } }, { senderKeyDistributionMessage: {} }, { pollUpdateMessage: {} }, { messageContextInfo: {} }, {}]) {
  assert.deepEqual(pick(X(m)), ['system', '', '', false, '', ''], JSON.stringify(m));
}
assert.equal(extractMessage({ key: {} }).kind, 'system');
// pesan grup: teks + senderKeyDistribution tetap teks
assert.equal(X({ conversation: 'hai', senderKeyDistributionMessage: {}, messageContextInfo: {} }).kind, 'text');

// 4. tipe tak dikenal -> document aman
{
  const r = X({ pollCreationMessage: { name: 'p' } });
  assert.deepEqual(pick(r), ['document', '[Pesan tidak didukung]', '', false, '', '']);
}

// 5. source iklan
{
  const r = X({ extendedTextMessage: { text: 'Halo', contextInfo: { externalAdReply: { sourceId: 'AD1', ctwaClid: 'CL1', sourceUrl: 'https://fb.me/x' } } } });
  assert.deepEqual(r.source, { platform: '', adId: 'AD1', ctwaClid: 'CL1', sourceUrl: 'https://fb.me/x', referralCode: '' });
  const r2 = X({ imageMessage: { caption: 'c', contextInfo: { ctwaClid: 'TOP' } } });
  assert.equal(r2.source.ctwaClid, 'TOP');
  assert.deepEqual(X({ conversation: 'x' }).source, { platform: '', adId: '', ctwaClid: '', sourceUrl: '', referralCode: '' });
}

// 6. referralCode: ada / tidak ada / di caption; teks tidak diubah; label media bukan kode
{
  const r = X({ conversation: 'Halo [promo-1] dan [lain]' });
  assert.equal(r.source.referralCode, 'PROMO-1');
  assert.equal(r.text, 'Halo [promo-1] dan [lain]');
  assert.equal(X({ conversation: 'Halo [kode: ab_9]' }).source.referralCode, 'AB_9');
  assert.equal(X({ conversation: 'Halo saja [x] [a b]' }).source.referralCode, '');
  assert.equal(X({ imageMessage: { caption: 'iklan [KODE: Mei26]' } }).source.referralCode, 'MEI26');
  assert.equal(X({ imageMessage: {} }).source.referralCode, ''); // "[Gambar]" bukan kode
}

// --- identitas ---
// 7. jidToDigits
assert.equal(jidToDigits('628123456789:12@s.whatsapp.net'), '628123456789');
assert.equal(jidToDigits('1234567890123@lid'), '1234567890123');
assert.equal(jidToDigits(undefined), '');

// 8. nomor asli
assert.deepEqual(await resolveIdentity({ remoteJid: '628111222333@s.whatsapp.net' }), { jid: '628111222333@s.whatsapp.net', phone: '628111222333', lid: null });

// 9. lid + alt (diingat), lalu lid tanpa alt memakai peta
{
  const r = await resolveIdentity({ remoteJid: '9990001@lid', remoteJidAlt: '628555000111:3@s.whatsapp.net' });
  assert.deepEqual(r, { jid: '9990001@lid', phone: '628555000111', lid: '9990001' });
  assert.equal(lookupLidPhone('9990001'), '628555000111');
  const r2 = await resolveIdentity({ remoteJid: '9990001@lid' });
  assert.equal(r2.phone, '628555000111');
  const r3 = await resolveIdentity({ remoteJid: '9990002@lid', participantAlt: '628777000222@s.whatsapp.net' });
  assert.equal(r3.phone, '628777000222');
}

// 10. lid + lidToPhone (hasil disimpan)
{
  let calls = 0;
  const f = async () => { calls++; return '628999000333'; };
  assert.equal((await resolveIdentity({ remoteJid: '7770001@lid' }, { lidToPhone: f })).phone, '628999000333');
  assert.equal((await resolveIdentity({ remoteJid: '7770001@lid' }, { lidToPhone: f })).phone, '628999000333');
  assert.equal(calls, 1);
}

// 11. semua gagal -> phone null (LID tak pernah di phone); galat lidToPhone; hasil tak valid
{
  assert.deepEqual(await resolveIdentity({ remoteJid: '5550001@lid' }), { jid: '5550001@lid', phone: null, lid: '5550001' });
  assert.equal((await resolveIdentity({ remoteJid: '5550002@lid' }, { lidToPhone: async () => { throw new Error('x'); } })).phone, null);
  assert.equal((await resolveIdentity({ remoteJid: '5550003@lid' }, { lidToPhone: async () => '12345' })).phone, null);
  assert.equal((await resolveIdentity({ remoteJid: '5550004@lid', remoteJidAlt: '123@s.whatsapp.net' })).phone, null);
}

// 12. lidToPhone timeout
{
  const t0 = Date.now();
  const r = await resolveIdentity({ remoteJid: '5550005@lid' }, { lidToPhone: () => new Promise(() => {}), timeoutMs: 30 });
  assert.equal(r.phone, null);
  assert.ok(Date.now() - t0 < 1000);
}

// 13. nomor tak valid / JID lain
{
  assert.equal((await resolveIdentity({ remoteJid: '123@s.whatsapp.net' })).phone, null);
  assert.equal((await resolveIdentity({ remoteJid: '6281234567890123456@s.whatsapp.net' })).phone, null);
  assert.deepEqual(await resolveIdentity({ remoteJid: '1203@g.us' }), { jid: '1203@g.us', phone: null, lid: null });
  rememberLidPhone('4440001', 'abc');
  assert.equal(lookupLidPhone('4440001'), null);
}

// 14. peta persisten dan dibatasi 5000 (buang tertua)
{
  for (let i = 0; i < 5005; i++) rememberLidPhone(String(100000000000 + i), '62811' + String(1000000 + i));
  assert.equal(lookupLidPhone('100000000000'), null);
  assert.equal(lookupLidPhone('100000005004'), '628111005004');
  flushLidMap();
  const f = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'lid-map.json'), 'utf8'));
  assert.equal(Object.keys(f).length, 5000);
  assert.equal(f['100000005004'], '628111005004');
}

console.log('wa-parse.test.js OK');
