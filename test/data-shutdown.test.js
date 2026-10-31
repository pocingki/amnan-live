// Data yang masih menunggu debounce tidak hilang saat proses keluar (hook 'exit' memanggil flush).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.AMNAN_NO_BACKUP = '1';
process.env.AMNAN_NO_BG = '1';
const src = (f) => pathToFileURL(path.resolve('src', f)).href;

test('proses keluar tanpa flush() eksplisit: perubahan tetap tersimpan', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-exit-'));
  const code = `
    const C = await import('${src('conversations.js')}');
    const S = await import('${src('store.js')}');
    const { conv } = C.getOrCreate('62811', 'j', 'Ani');
    C.addMessage(conv, 'customer', 'pesan terakhir');
    conv.unread = 1;
    C.save();
    S.add({ phone: '62811', name: 'Ani' });
    C.markSeen('W1');
    // sengaja tanpa flush(); proses berakhir saat sekarang
  `;
  execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { env: { ...process.env, DATA_DIR: dir } });
  process.env.DATA_DIR = dir;
  const C = await import('../src/conversations.js');
  const S = await import('../src/store.js');
  const D = await import('../src/db.js');
  assert.equal(C.get('62811').messages[0].text, 'pesan terakhir');
  assert.equal(C.totalUnread(), 1);
  assert.equal(S.findByPhone('62811').name, 'Ani');
  assert.equal(C.seenMessage('W1'), true);
  D.closeAll();
});
