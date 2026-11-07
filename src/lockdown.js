// Menutup izin folder data dan berkas rahasia agar akun lain di komputer yang sama tidak bisa membacanya.
// Unix: mode 0700/0600. Windows: ACL hanya pemilik proses, SYSTEM, dan Administrator (bukan Users/Everyone).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const chmod = (target, mode) => { try { fs.chmodSync(target, mode); } catch { /* sistem berkas tanpa chmod */ } };

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
  });
}

async function restrictWindows(target, directory) {
  const who = (await run('whoami', [])).trim();
  if (!who) return false;
  const ace = directory ? '(OI)(CI)F' : 'F';
  const out = await run('icacls', [
    target,
    '/inheritance:r',
    '/grant:r', `${who}:${ace}`,
    '/grant:r', `SYSTEM:${ace}`,
    '/grant:r', `BUILTIN\\Administrators:${ace}`,
  ]);
  return /successfully processed/i.test(out);
}

/** Kunci DATA_DIR (termasuk data/auth) dan berkas .env. Tidak melempar. */
export async function lockdownSensitive({ dataDir, envFile } = {}) {
  if (dataDir) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    chmod(dataDir, 0o700);
    const auth = path.join(dataDir, 'auth');
    if (fs.existsSync(auth)) chmod(auth, 0o700);
    let names = [];
    try { names = fs.readdirSync(dataDir); } catch { names = []; }
    for (const name of names) {
      const file = path.join(dataDir, name);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (st.isFile()) chmod(file, 0o600);
      else if (st.isDirectory()) chmod(file, 0o700);
    }
    if (process.platform === 'win32') await restrictWindows(dataDir, true);
  }
  if (envFile && fs.existsSync(envFile)) {
    chmod(envFile, 0o600);
    if (process.platform === 'win32') await restrictWindows(envFile, false);
  }
}
