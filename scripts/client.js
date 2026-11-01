#!/usr/bin/env node
// Kelola instance per client (satu nomor WhatsApp per client, satu kode bersama).
//   node scripts/client.js new <slug> --name "Nama Brand" [--tagline "..."] [--domain app.client.com]
//                                     [--color #0b5fa5] [--port 8101] [--tz Asia/Jakarta] [--user admin]
//                                     [--password <pw>] [--no-encrypt] [--dir /opt/clients]
//   node scripts/client.js list [--check] [--dir /opt/clients]
// Folder client: <dir>/<slug>/{.env, keywords.json, nginx.conf (bila --domain), data/}.
// Bawaan <dir> = env AMNAN_CLIENTS_DIR atau /opt/clients. Panduan: docs/MULTI-CLIENT.md
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeHex, checkBase } from '../public/assets/js/brand-color.js';

const CODE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_CLIENTS_DIR = '/opt/clients';
export const PORT_START = 8101;
const PORT_SPAN = 800;
const BOOL_FLAGS = new Set(['no-encrypt', 'check', 'help']);

// ---------------------------------------------------------------- helper murni (diuji di test/client-provision.test.js)

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export function validateSlug(slug) {
  if (!slug) return 'Slug client wajib diisi, contoh: klinik-sehat';
  if (!SLUG_RE.test(slug)) return 'Slug hanya boleh huruf kecil, angka, dan tanda minus (maks. 30 karakter, tidak diawali/diakhiri minus).';
  return null;
}

export const validateDomain = (d) => (DOMAIN_RE.test(String(d || '')) ? null : `Domain tidak valid: ${d}`);

/** Nilai teks bebas yang ditulis ke .env: tanpa baris baru dan tanda kutip (parser .env membuang kutip di tepi). */
export function cleanText(v, label, max) {
  const s = String(v ?? '').trim();
  if (/[\r\n"'`]/.test(s)) throw new Error(`${label} tidak boleh mengandung baris baru atau tanda kutip.`);
  if (s.length > max) throw new Error(`${label} maksimal ${max} karakter.`);
  return s;
}

export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

export function parseArgs(argv, bools = BOOL_FLAGS) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const key = a.slice(2);
    if (bools.has(key)) opt[key] = true;
    else {
      if (i + 1 >= argv.length) throw new Error(`Opsi --${key} butuh nilai.`);
      opt[key] = argv[++i];
    }
  }
  return { pos, opt };
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function randomPassword(len = 20) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

/** Port terkecil mulai PORT_START yang belum dipakai client lain dan (bila isFree diberikan) benar-benar kosong. */
export async function pickPort(used, isFree = async () => true, start = PORT_START, span = PORT_SPAN) {
  for (let p = start; p < start + span; p++) {
    if (used.has(p)) continue;
    if (await isFree(p)) return p;
  }
  throw new Error(`Tidak ada port kosong di ${start}-${start + span - 1}.`);
}

export const portIsFree = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });

export function renderEnv({ slug, name, tagline, color, port, dataDir, keywordsFile, dataKey, user, hash, tz, domain }) {
  const lines = [
    `# Instance client "${slug}" - dibuat oleh scripts/client.js. Jangan commit file ini.`,
    `CLIENT_ID=${slug}`,
    `BRAND_NAME=${name}`,
    `BRAND_TAGLINE=${tagline || ''}`,
    `BRAND_COLOR=${color || ''}`,
    '',
    `PORT=${port}`,
    `DATA_DIR=${dataDir}`,
    `KEYWORDS_FILE=${keywordsFile}`,
    `TZ=${tz}`,
    '# Aplikasi di belakang nginx (reverse proxy).',
    'TRUST_PROXY=1',
    ...(domain ? [`PUBLIC_URL=https://${domain}`] : []),
    '',
    '# Admin pertama (dibuat saat server pertama kali jalan). Password disimpan sebagai hash.',
    `DASHBOARD_USER=${user}`,
    `DASHBOARD_PASSWORD_HASH=${hash}`,
    '',
    '# Kunci enkripsi data. HILANG = data tidak bisa dibuka. Simpan salinan terpisah dari backup.',
    `DATA_KEY=${dataKey}`,
    '',
  ];
  return lines.join('\n');
}

export function renderNginx({ slug, domain, port }) {
  return `# Client "${slug}". Pasang:
#   sudo ln -s <path file ini> /etc/nginx/sites-enabled/amnan-${slug}.conf
#   sudo nginx -t && sudo systemctl reload nginx
#   sudo certbot --nginx -d ${domain}     (menambahkan HTTPS)
server {
    listen 80;
    server_name ${domain};

    client_max_body_size 20m;   # media WhatsApp

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;        # SSE (/api/events) harus langsung diteruskan
        proxy_read_timeout 3600s;
    }
}
`;
}

/** Semua client di folder: [{ slug, dir, env }] terurut menurut slug. */
export function listClients(clientsDir) {
  let entries = [];
  try { entries = fs.readdirSync(clientsDir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || !SLUG_RE.test(e.name)) continue;
    const file = path.join(clientsDir, e.name, '.env');
    if (!fs.existsSync(file)) continue;
    out.push({ slug: e.name, dir: path.join(clientsDir, e.name), env: parseEnv(fs.readFileSync(file, 'utf8')) });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

// ---------------------------------------------------------------- perintah

const clientsDirOf = (opt) => path.resolve(opt.dir || process.env.AMNAN_CLIENTS_DIR || DEFAULT_CLIENTS_DIR);

export async function createClient(slug, opt = {}, { isFree = portIsFree, hashPassword } = {}) {
  const bad = validateSlug(slug);
  if (bad) throw new Error(bad);
  const name = cleanText(opt.name || slug, 'Nama brand', 60);
  const tagline = cleanText(opt.tagline || '', 'Tagline', 100);
  const color = opt.color ? normalizeHex(opt.color) : '';
  if (opt.color) {
    const bad = checkBase(opt.color);
    if (bad) throw new Error(bad);
  }
  const user = cleanText(opt.user || 'admin', 'Nama pengguna', 40);
  if (!/^[a-z0-9._-]{2,40}$/i.test(user)) throw new Error('Nama pengguna hanya huruf, angka, titik, minus, garis bawah.');
  const tz = opt.tz || 'Asia/Jakarta';
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw new Error(`Zona waktu tidak dikenal: ${tz}`); }
  const domain = opt.domain ? String(opt.domain).toLowerCase() : '';
  if (domain && validateDomain(domain)) throw new Error(validateDomain(domain));

  const clientsDir = clientsDirOf(opt);
  const dir = path.join(clientsDir, slug);
  if (fs.existsSync(dir)) throw new Error(`Client "${slug}" sudah ada di ${dir}.`);

  const existing = listClients(clientsDir);
  const used = new Set(existing.map((c) => Number(c.env.PORT)).filter(Number.isInteger));
  let port;
  if (opt.port !== undefined) {
    port = Number(opt.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port harus angka 1024-65535.');
    if (used.has(port)) throw new Error(`Port ${port} sudah dipakai client lain.`);
    if (!(await isFree(port))) throw new Error(`Port ${port} sedang dipakai proses lain di server ini.`);
  } else {
    port = await pickPort(used, isFree);
  }

  const password = opt.password || randomPassword();
  const hash = await hashPassword(password);
  const dataKey = opt['no-encrypt'] ? '' : crypto.randomBytes(32).toString('hex');

  const dataDir = path.join(dir, 'data');
  const keywordsFile = path.join(dir, 'keywords.json');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  fs.copyFileSync(path.join(CODE_DIR, 'config', 'keywords.json'), keywordsFile);
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, renderEnv({ slug, name, tagline, color, port, dataDir, keywordsFile, dataKey, user, hash, tz, domain }), { mode: 0o600 });
  let nginxFile = null;
  if (domain) {
    nginxFile = path.join(dir, 'nginx.conf');
    fs.writeFileSync(nginxFile, renderNginx({ slug, domain, port }));
  }
  return { slug, name, dir, port, domain, user, password, generated: !opt.password, encrypted: !!dataKey, envFile, nginxFile };
}

async function cmdNew(pos, opt) {
  const auth = await import('../src/auth.js');
  if (opt.password) auth.checkPasswordPolicy(opt.password); // melempar galat bila terlalu pendek/panjang
  const r = await createClient(pos[0], opt, { hashPassword: auth.hashPassword });
  const out = [
    '',
    `Client "${r.slug}" dibuat di ${r.dir}`,
    `  Port        : ${r.port} (hanya localhost)`,
    `  Dashboard   : ${r.domain ? `https://${r.domain}` : `http://127.0.0.1:${r.port}`}`,
    `  Pengguna    : ${r.user}`,
    `  Password    : ${r.generated ? r.password : '(sesuai --password)'}${r.generated ? '   <- catat sekarang, tidak disimpan dalam bentuk asli' : ''}`,
    r.encrypted
      ? `  Enkripsi    : aktif. SALIN DATA_KEY dari ${r.envFile} ke penyimpanan terpisah; bila hilang, data tidak bisa dibuka.`
      : '  Enkripsi    : mati (--no-encrypt)',
    '',
    'Langkah berikutnya:',
    `  1. Jalankan : pm2 startOrReload deploy/ecosystem.clients.config.cjs && pm2 save`,
    ...(r.domain
      ? [
          `  2. DNS      : arahkan A record ${r.domain} ke IP server ini`,
          `  3. nginx    : sudo ln -s ${r.nginxFile} /etc/nginx/sites-enabled/amnan-${r.slug}.conf && sudo nginx -t && sudo systemctl reload nginx`,
          `  4. HTTPS    : sudo certbot --nginx -d ${r.domain}`,
          '  5. Buka dashboard, login, lalu pindai QR WhatsApp dengan nomor milik client',
        ]
      : ['  2. Buka dashboard (butuh nginx + domain bila diakses dari luar server), login, pindai QR WhatsApp']),
    '',
  ];
  console.log(out.join('\n'));
}

async function cmdList(opt) {
  const clientsDir = clientsDirOf(opt);
  const clients = listClients(clientsDir);
  if (!clients.length) {
    console.log(`Belum ada client di ${clientsDir}. Buat dengan: node scripts/client.js new <slug> --name "..."`);
    return;
  }
  for (const c of clients) {
    const e = c.env;
    let state = '';
    if (opt.check) {
      try {
        const res = await fetch(`http://127.0.0.1:${e.PORT}/healthz`, { signal: AbortSignal.timeout(2000) });
        const j = await res.json();
        state = `  [jalan, WA: ${j.wa?.status ?? '?'}]`;
      } catch {
        state = '  [tidak merespons]';
      }
    }
    console.log(`${c.slug.padEnd(24)} port ${String(e.PORT || '?').padEnd(6)} ${(e.PUBLIC_URL || '-').padEnd(34)} ${e.BRAND_NAME || ''}${state}`);
  }
}

const HELP = `Penggunaan:
  node scripts/client.js new <slug> --name "Nama Brand" [--tagline "..."] [--domain app.client.com]
                                    [--color #0b5fa5] [--port N] [--tz Asia/Jakarta] [--user admin] [--password <pw>]
                                    [--no-encrypt] [--dir /opt/clients]
  node scripts/client.js list [--check] [--dir /opt/clients]`;

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = pos;
  if (!cmd || opt.help) return console.log(HELP);
  if (cmd === 'new') return cmdNew(rest, opt);
  if (cmd === 'list') return cmdList(opt);
  console.error(`Perintah tidak dikenal: ${cmd}\n\n${HELP}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`\nGagal: ${e.message}\n`);
    process.exit(1);
  });
}
