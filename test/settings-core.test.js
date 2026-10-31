// Uji inti pengaturan: default, versi/riwayat, konflik, restore, validasi, masking.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-set-c-'));
const s = await import('../src/settings.js');
const code = (c) => (e) => e.code === c;

// 1. default: field lengkap, intent contoh nonaktif, intent bawaan aktif
{
  const c = s.get();
  assert.equal(c.version, 1);
  assert.deepEqual(c.requiredFields.map((f) => f.type), ['name', 'text']);
  const ex = c.intents.filter((i) => i.example);
  assert.deepEqual(ex.map((i) => i.id), ['jadwal', 'lokasi', 'layanan', 'cara-booking']);
  assert.ok(ex.every((i) => i.active === false && i.response.startsWith('[ISI:')));
  assert.deepEqual(c.intents.filter((i) => i.active).map((i) => i.id), ['harga', 'terima-kasih']);
  assert.ok(!/asisten virtual.*asisten virtual/i.test(c.openingMessage));
}

// 2. versi naik, riwayat menyimpan snapshot LAMA, by/updatedBy tercatat
{
  const r = s.update({ brandName: 'B2' }, { by: 'budi' });
  assert.equal(r.version, 2);
  assert.equal(r.updatedBy, 'budi');
  assert.deepEqual(s.history().map((h) => h.version), [1]);
  const raw = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'settings.history.json'), 'utf8'));
  assert.equal(raw[0].settings.brandName, 'acesio');
}

// 3. riwayat maks 20 (menyimpan yang terbaru)
{
  for (let i = 0; i < 25; i++) s.update({ brandName: 'n' + i }, { by: 'x' });
  const h = s.history();
  assert.equal(h.length, 20);
  assert.equal(h.at(-1).version, s.get().version - 1);
}

// 4. konflik: expectedVersion salah -> CONFLICT + current; tidak berubah; null = tanpa cek
{
  const v = s.get().version;
  assert.throws(() => s.update({ brandName: 'zzz' }, { expectedVersion: v - 1 }), (e) => e.code === 'CONFLICT' && e.current.version === v);
  assert.notEqual(s.get().brandName, 'zzz');
  assert.equal(s.update({ brandName: 'ok' }, { expectedVersion: v }).version, v + 1);
}

// 5. restore -> versi BARU berisi isi snapshot
{
  s.update({ brandName: 'Awal', adminName: 'A1' }, { by: 'x' });
  const target = s.get().version;
  s.update({ brandName: 'Akhir', adminName: 'A2' }, { by: 'x' });
  const before = s.get().version;
  const r = s.restore(target, { by: 'adm' });
  assert.equal(r.version, before + 1);
  assert.equal(r.brandName, 'Awal');
  assert.equal(r.updatedBy, 'adm');
  assert.throws(() => s.restore(99999, { by: 'adm' }), code('NOT_FOUND'));
}

// 6. SSRF webhook (tabel)
{
  const ok = ['', 'https://hooks.example.com/x?a=1', 'http://example.org', 'https://8.8.8.8/x', 'https://172.32.0.1/x', 'https://[2606:4700::1111]/x'];
  const bad = ['http://localhost:3000', 'http://LOCALHOST./x', 'http://foo.local/x', 'http://a.b.internal', 'http://127.0.0.1', 'http://127.1/', 'http://2130706433/', 'http://10.1.2.3', 'http://172.16.0.1', 'http://172.31.255.255', 'http://192.168.1.1', 'http://169.254.169.254/latest', 'http://0.0.0.0', 'http://[::1]/', 'http://[::]/', 'http://[fc00::1]/', 'http://[fd12:3::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:8.8.8.8]/', 'ftp://example.com', 'javascript:alert(1)', 'bukan url'];
  for (const u of ok) assert.doesNotThrow(() => s.update({ notify: { webhookUrl: u } }, { by: 'x' }), u);
  for (const u of bad) assert.throws(() => s.update({ notify: { webhookUrl: u } }, { by: 'x' }), code('VALIDATION'), u);
}

// 7. token: masking di publicView; nilai berawalan •••• = tidak diubah; kosong = hapus
{
  s.update({ notify: { telegramBotToken: '123456:ABCDEFwxyz9876' } }, { by: 'x' });
  const v = s.publicView(s.get());
  assert.equal(v.notify.telegramBotToken, '••••9876');
  assert.equal(s.get().notify.telegramBotToken, '123456:ABCDEFwxyz9876'); // asli tidak ikut termask
  s.update({ notify: { telegramBotToken: v.notify.telegramBotToken, telegramChatId: '77' } }, { by: 'x' });
  assert.equal(s.get().notify.telegramBotToken, '123456:ABCDEFwxyz9876');
  s.update({ notify: { telegramBotToken: '' } }, { by: 'x' });
  assert.equal(s.publicView(s.get()).notify.telegramBotToken, '');
}

// 8. clamp angka
{
  const r = s.update({ staleMinutes: 0, fallbackCooldownMinutes: -5, sendRateLimitPerMinute: 999, maxMediaMB: 500, retentionDays: 99999, botDurationMinutes: 'abc', notify: { attentionMinutes: 0 } }, { by: 'x' });
  assert.deepEqual([r.staleMinutes, r.fallbackCooldownMinutes, r.sendRateLimitPerMinute, r.maxMediaMB, r.retentionDays, r.botDurationMinutes, r.notify.attentionMinutes], [1, 0, 120, 64, 3650, 0, 1]);
}

// 9. intents, slangMap, requiredFields
{
  const r = s.update({
    slangMap: { ' Gk ': ' Tidak ', '': 'x', a: '' },
    intents: [{ name: 'A', response: 'r', keywords: 'a, b', priority: 500, example: true }, { name: 'B', response: 'r', priority: 'x' }],
    requiredFields: [{ id: 'pil', label: 'Pil', question: 'q', type: 'choice', options: ['a', 'a', 'b', 'x'.repeat(90)] }, { label: 'T', question: 'q', type: 'ngawur' }],
  }, { by: 'x' });
  assert.deepEqual(r.slangMap, { gk: 'tidak' });
  assert.deepEqual(r.intents.map((i) => [i.priority, i.example === true]), [[100, true], [0, false]]);
  assert.deepEqual(r.requiredFields.map((f) => f.type), ['choice', 'text']);
  assert.deepEqual(r.requiredFields[0].options, ['a', 'b', 'x'.repeat(60)]);
  const big = Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['k' + i, 'v']));
  assert.equal(Object.keys(s.update({ slangMap: big }, { by: 'x' }).slangMap).length, 200);
}

console.log('settings-core.test.js OK');
