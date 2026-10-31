// Muat .env sederhana untuk skrip CLI (DATA_DIR, DATA_KEY, TZ).
import fs from 'node:fs';

if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.AMNAN_NO_BACKUP = '1'; // skrip tidak menjadwalkan cadangan otomatis
