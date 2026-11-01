// Muat .env sederhana untuk skrip CLI (DATA_DIR, DATA_KEY, TZ). ENV_FILE=<path> memilih file .env instance client.
import fs from 'node:fs';

const ENV_FILE = process.env.ENV_FILE || '.env';
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.AMNAN_NO_BACKUP = '1'; // skrip tidak menjadwalkan cadangan otomatis
