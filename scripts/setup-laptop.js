#!/usr/bin/env node
// Pengaturan awal untuk pemasangan mandiri (laptop/PC client): membuat .env, password admin, kunci enkripsi,
// salinan keywords.json, dan membangun CSS. Dijalankan otomatis oleh Mulai-Amnan.bat saat .env belum ada.
//   node scripts/setup-laptop.js                      (bertanya satu per satu)
//   node scripts/setup-laptop.js --yes --name "Klinik A" --color #0b5fa5 [--tagline "..."] [--user admin]
//                                [--password <pw>] [--port 8080] [--no-encrypt] [--skip-build] [--force]
// Folder pasang = APP_DIR atau folder induk skrip ini.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, cleanText, randomPassword } from './client.js';
import { normalizeHex, checkBase } from '../public/assets/js/brand-color.js';

const CODE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PORT = 8080;
const BOOL = new Set(['yes', 'no-encrypt', 'skip-build', 'force']);

export function renderLaptopEnv({ name, tagline, color, port, user, hash, dataKey }) {
  return [
    '# Dibuat oleh scripts/setup-laptop.js. SIMPAN SALINAN file ini di tempat aman (berisi kunci enkripsi data).',
    '# Jangan dibagikan dan jangan diunggah ke GitHub.',
    `BRAND_NAME=${name}`,
    `BRAND_TAGLINE=${tagline || ''}`,
    `BRAND_COLOR=${color || ''}`,
    '',
    `PORT=${port}`,
    'TZ=Asia/Jakarta',
    'KEYWORDS_FILE=data/keywords.json',
    '',
    `DASHBOARD_USER=${user}`,
    `DASHBOARD_PASSWORD_HASH=${hash}`,
    '',
    '# Kunci enkripsi data. HILANG = data tidak bisa dibuka lagi, termasuk dari backup.',
    `DATA_KEY=${dataKey}`,
    '',
  ].join('\r\n'); // CRLF supaya nyaman dibuka di Notepad Windows (parser .env menerima keduanya)
}

const portIsFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });

/** Port pertama yang kosong mulai dari `start` (maks. 20 percobaan). */
export async function pickLocalPort(start = DEFAULT_PORT, isFree = portIsFree) {
  for (let p = start; p < start + 20; p++) if (await isFree(p)) return p;
  throw new Error(`Port ${start}-${start + 19} semua terpakai. Tutup aplikasi lain atau isi --port.`);
}

async function ask(rl, question, def = '', { hidden = false } = {}) {
  const suffix = def ? ` [${def}]` : '';
  if (hidden) {
    rl._writeToOutput = (s) => { if (!rl.__mute) process.stdout.write(s); };
    process.stdout.write(`${question}${suffix}: `);
    rl.__mute = true;
    const a = await rl.question('');
    rl.__mute = false;
    process.stdout.write('\n');
    return a.trim() || def;
  }
  return ((await rl.question(`${question}${suffix}: `)).trim()) || def;
}

export async function setup(opt, { appDir, interactive, hashPassword, build = true, log = console.log } = {}) {
  const root = path.resolve(appDir);
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile) && !opt.force) {
    log('File .env sudah ada, pengaturan awal dilewati. (Pakai --force untuk membuat ulang; .env lama akan ditimpa.)');
    return null;
  }

  let rl = null;
  if (interactive) rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const val = async (key, question, def = '', o = {}) => (opt[key] !== undefined ? String(opt[key]) : interactive ? ask(rl, question, def, o) : def);
  try {
    const name = cleanText(await val('name', 'Nama brand / usaha', 'Amnan'), 'Nama brand', 60) || 'Amnan';
    const tagline = cleanText(await val('tagline', 'Tagline (boleh kosong)', ''), 'Tagline', 100);
    let color = '';
    for (;;) {
      const raw = (await val('color', 'Warna utama brand, contoh #0b5fa5 (kosong = biru bawaan)', '')).trim();
      if (!raw) break;
      const bad = checkBase(raw);
      if (!bad) { color = normalizeHex(raw); break; }
      if (!interactive || opt.color !== undefined) throw new Error(bad);
      log(`  ${bad}`);
    }
    const user = cleanText(await val('user', 'Nama pengguna admin', 'admin'), 'Nama pengguna', 40) || 'admin';
    if (!/^[a-z0-9._-]{2,40}$/i.test(user)) throw new Error('Nama pengguna hanya huruf, angka, titik, minus, garis bawah.');
    let password = await val('password', 'Password admin (kosong = dibuatkan otomatis)', '', { hidden: true });
    const generated = !password;
    if (generated) password = randomPassword();
    if (password.length < 8) throw new Error('Password minimal 8 karakter.');
    const wantPort = opt.port !== undefined ? Number(opt.port) : DEFAULT_PORT;
    if (!Number.isInteger(wantPort) || wantPort < 1024 || wantPort > 65535) throw new Error('Port harus angka 1024-65535.');
    const port = opt.port !== undefined ? wantPort : await pickLocalPort(wantPort);

    const hash = await hashPassword(password);
    const dataKey = opt['no-encrypt'] ? '' : crypto.randomBytes(32).toString('hex');

    const dataDir = path.join(root, 'data');
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const kw = path.join(dataDir, 'keywords.json');
    if (!fs.existsSync(kw)) fs.copyFileSync(path.join(CODE_DIR, 'config', 'keywords.json'), kw);
    fs.writeFileSync(envFile, renderLaptopEnv({ name, tagline, color, port, user, hash, dataKey }), { mode: 0o600 });

    let built = null;
    if (build && !opt['skip-build']) {
      const r = spawnSync('npm', ['run', 'build:css'], { cwd: root, shell: true, stdio: 'inherit' });
      built = r.status === 0;
    }
    return { name, user, password, generated, port, encrypted: !!dataKey, envFile, built, url: `http://localhost:${port}` };
  } finally {
    rl?.close();
  }
}

async function main() {
  const { opt } = parseArgs(process.argv.slice(2), BOOL);
  const interactive = !opt.yes && process.stdin.isTTY;
  const auth = await import('../src/auth.js');
  console.log('\n=== Pengaturan awal AMNAN LIVE ===\n');
  const appDir = process.env.APP_DIR || CODE_DIR;
  const r = await setup(opt, { appDir, interactive, hashPassword: auth.hashPassword });
  if (!r) return;
  console.log([
    '',
    'Selesai. Catat data berikut:',
    `  Alamat dashboard : ${r.url}`,
    `  Pengguna         : ${r.user}`,
    `  Password         : ${r.generated ? r.password : '(sesuai yang Anda ketik)'}${r.generated ? '   <- catat sekarang, tidak disimpan dalam bentuk asli' : ''}`,
    r.encrypted ? `  Enkripsi data    : aktif. Salin file ${r.envFile} ke tempat aman (flashdisk/penyimpanan terpisah).` : '  Enkripsi data    : mati',
    r.built === false ? '\n  PERHATIAN: tampilan belum dibangun. Jalankan: npm run build:css' : '',
    '',
    'Logo, favicon, dan warna bisa diubah kapan saja di dashboard: Pengaturan > Bot & brand.',
    '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`\nGagal: ${e.message}\n`);
    process.exit(1);
  });
}
