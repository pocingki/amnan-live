// Uji migrasi file pengaturan lama (tanpa version/priority/type).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-set-m-'));
const OPENING_LAMA = 'Halo {nama}, selamat datang. Saya {bot}, asisten virtual yang membantu {admin}. Ada yang bisa kami bantu?';
fs.writeFileSync(path.join(process.env.DATA_DIR, 'settings.json'), JSON.stringify({
  brandName: 'Klinikku',
  openingMessage: OPENING_LAMA,
  fallbackMessage: 'Kustom saya',
  intents: [{ id: 'x', name: 'X', keywords: ['x'], response: 'jawab', active: true }],
  requiredFields: [{ id: 'nama', label: 'Nama', question: 'Siapa?', enabled: true }, { id: 'usia', label: 'Usia', question: 'Umur?', enabled: true }],
}));

const s = await import('../src/settings.js');
const c = s.get();
assert.equal(c.version, 1);
assert.equal(c.brandName, 'Klinikku');
assert.equal(c.fallbackMessage, 'Kustom saya'); // pengaturan pengguna dipertahankan
assert.equal(c.openingMessage, s.DEFAULTS.openingMessage); // teks lama diganti baru
assert.deepEqual(c.intents.map((i) => [i.id, i.priority]), [['x', 0]]); // tidak ditimpa default
assert.deepEqual(c.requiredFields.map((f) => [f.id, f.type]), [['nama', 'name'], ['usia', 'text']]);
assert.equal(c.staleMinutes, 10);
assert.equal(c.notify.attentionMinutes, 30);
assert.deepEqual(c.slangMap, {});
console.log('settings-migrate.test.js OK');
