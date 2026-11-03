// Keamanan inti: pengguna + peran, hash scrypt, sesi persisten, pembatas percobaan login,
// IP klien (TRUST_PROXY), CSRF, audit log, dan pembaca body HTTP dengan batas ukuran.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, save } from './jsonfile.js';

// ---------------------------------------------------------------- Jalur & galat

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Akar aplikasi (.env, data, config, public). Bisa diganti dengan APP_DIR. */
export const appDir = () => path.resolve(process.env.APP_DIR || CODE_ROOT);
/** Folder data. Bisa diganti dengan DATA_DIR (relatif dihitung dari akar aplikasi). */
export const dataDir = () => path.resolve(appDir(), process.env.DATA_DIR || 'data');

/** Galat yang pesannya aman ditampilkan ke klien. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const ROLES = ['admin', 'agent'];
export const hasRole = (user, role) => !!user && (user.role === 'admin' || user.role === role);

// ---------------------------------------------------------------- Kata sandi (scrypt)

const SCRYPT = { N: 16384, r: 8, p: 1 };
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 256;

const scrypt = (pw, salt, len, o) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(pw, salt, len, { N: o.N, r: o.r, p: o.p, maxmem: 128 * o.N * o.r * 2 + (1 << 20) }, (e, k) => (e ? reject(e) : resolve(k)))
  );

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export const isHash = (s) => /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/.test(String(s || ''));

export async function verifyPassword(password, stored) {
  if (!isHash(stored)) return false;
  const [, N, r, p, saltHex, keyHex] = stored.split('$');
  const o = { N: +N, r: +r, p: +p };
  if (o.N > 1 << 17 || o.r > 32 || o.p > 8) return false; // cegah parameter berlebihan dari file yang rusak
  const expected = Buffer.from(keyHex, 'hex');
  const key = await scrypt(String(password), Buffer.from(saltHex, 'hex'), expected.length, o);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

let dummyHash;
const dummy = () => (dummyHash ||= hashPassword('tidak-dipakai-' + crypto.randomBytes(8).toString('hex')));

// Daftar sandi umum (huruf kecil, tanpa pemisah). Panjang minimal tetap 8; ini hanya menolak yang mudah ditebak.
const COMMON_PW = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'admin123', 'admin1234', 'administrator', 'qwerty123',
  'qwertyui', 'qwertyuiop', 'asdfghjk', 'asdfghjkl', 'zxcvbnm1', 'letmein1', 'welcome1', 'welcome123', 'iloveyou', 'abc12345',
  'abcd1234', '12345678', '123456789', '1234567890', '12345678910', '11111111', '00000000', '1q2w3e4r', '1qaz2wsx', 'katasandi',
  'sandi123', 'rahasia1', 'rahasia123', 'indonesia', 'amnan123', 'amnanlive',
]);
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'].flatMap((r) => [r, [...r].reverse().join('')]);
const hasKeyboardRun = (s, n = 6) => KEY_ROWS.some((row) => { for (let i = 0; i + n <= row.length; i++) if (s.includes(row.slice(i, i + n))) return true; return false; });

function isSimplePattern(s) {
  if (new Set(s).size <= 2) return true; // aaaaaaaa, abababab
  for (let p = 1; p <= 4; p++) if (s.length % p === 0 && s === s.slice(0, p).repeat(s.length / p)) return true; // abcabcabc
  const d = [];
  for (let i = 1; i < s.length; i++) d.push(s.charCodeAt(i) - s.charCodeAt(i - 1));
  return d.every((x) => x === 1) || d.every((x) => x === -1);
}

/** Lempar HttpError 400 bila sandi terlalu pendek, terlalu umum, berpola, atau sama dengan username. */
export function checkPasswordPolicy(password, username = '') {
  const s = String(password ?? '');
  if (s.length < PASSWORD_MIN) throw new HttpError(400, `Password minimal ${PASSWORD_MIN} karakter`);
  if (s.length > PASSWORD_MAX) throw new HttpError(400, `Password maksimal ${PASSWORD_MAX} karakter`);
  const low = s.toLowerCase();
  const squeezed = low.replace(/[^a-z0-9]/g, '');
  const user = normName(username);
  if (user && (low === user || squeezed === user.replace(/[^a-z0-9]/g, ''))) throw new HttpError(400, 'Password tidak boleh sama dengan nama pengguna');
  if (COMMON_PW.has(low) || COMMON_PW.has(squeezed)) throw new HttpError(400, 'Password terlalu umum, pilih yang lebih sulit ditebak');
  if (hasKeyboardRun(squeezed)) throw new HttpError(400, 'Password tidak boleh memuat deret papan ketik atau angka berurutan (mis. qwerty, 123456)');
  if (isSimplePattern(s)) throw new HttpError(400, 'Password tidak boleh berupa pengulangan atau deret sederhana');
}

// ---------------------------------------------------------------- Pengguna (data/users.json)

const USERS_FILE = 'users.json';
const USERS_TTL_MS = 2000; // CLI scripts/users.js mengubah file; server membaca ulang tiap beberapa detik
let usersCache = null;
let usersAt = 0;

export const normName = (n) => String(n ?? '').trim().toLowerCase();
const NAME_RE = /^[a-z0-9][a-z0-9._@-]{1,63}$/;

function readUsers() {
  const t = Date.now();
  if (usersCache && t - usersAt < USERS_TTL_MS) return usersCache;
  const raw = load(USERS_FILE, { users: [] });
  usersCache = Array.isArray(raw?.users) ? raw.users : [];
  usersAt = t;
  return usersCache;
}

function writeUsers(list) {
  save(USERS_FILE, { users: list });
  usersCache = list;
  usersAt = Date.now();
}

const publicUser = (u) => ({ name: u.name, role: u.role, createdAt: u.createdAt, updatedAt: u.updatedAt });

export const hasUsers = () => readUsers().length > 0;
export const listUsers = () => readUsers().map(publicUser);
export const getUser = (name) => readUsers().find((u) => u.name === normName(name)) || null;
const adminCount = () => readUsers().filter((u) => u.role === 'admin').length;

export async function addUser(name, password, role = 'agent') {
  const n = normName(name);
  if (!NAME_RE.test(n)) throw new HttpError(400, 'Nama pengguna 2-64 karakter: huruf, angka, titik, garis bawah, @, atau minus');
  if (!ROLES.includes(role)) throw new HttpError(400, `Peran harus salah satu dari: ${ROLES.join(', ')}`);
  checkPasswordPolicy(password, n);
  if (getUser(n)) throw new HttpError(409, 'Nama pengguna sudah dipakai');
  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  const rec = { name: n, role, hash, createdAt: now, updatedAt: now };
  writeUsers([...readUsers(), rec]);
  return publicUser(rec);
}

export function removeUser(name) {
  const u = getUser(name);
  if (!u) throw new HttpError(404, 'Pengguna tidak ditemukan');
  if (u.role === 'admin' && adminCount() <= 1) throw new HttpError(409, 'Tidak bisa menghapus admin terakhir');
  writeUsers(readUsers().filter((x) => x !== u));
  return publicUser(u);
}

export async function setPassword(name, password) {
  const u = getUser(name);
  if (!u) throw new HttpError(404, 'Pengguna tidak ditemukan');
  checkPasswordPolicy(password, u.name);
  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  writeUsers(readUsers().map((x) => (x === u ? { ...x, hash, updatedAt: now } : x)));
  return publicUser(getUser(name));
}

export function setRole(name, role) {
  const u = getUser(name);
  if (!u) throw new HttpError(404, 'Pengguna tidak ditemukan');
  if (!ROLES.includes(role)) throw new HttpError(400, `Peran harus salah satu dari: ${ROLES.join(', ')}`);
  if (u.role === 'admin' && role !== 'admin' && adminCount() <= 1) throw new HttpError(409, 'Tidak bisa menurunkan admin terakhir');
  const now = new Date().toISOString();
  writeUsers(readUsers().map((x) => (x === u ? { ...x, role, updatedAt: now } : x)));
  return publicUser(getUser(name));
}

/**
 * Admin awal dari .env (DASHBOARD_USER + DASHBOARD_PASSWORD atau DASHBOARD_PASSWORD_HASH).
 * Hanya dipakai bila data/users.json masih kosong; setelah itu kelola lewat scripts/users.js.
 */
export async function seedFromEnv() {
  if (readUsers().length) return false;
  const name = normName(process.env.DASHBOARD_USER || 'admin');
  let hash = process.env.DASHBOARD_PASSWORD_HASH || '';
  if (hash && !isHash(hash)) throw new Error('DASHBOARD_PASSWORD_HASH tidak valid. Buat dengan: node scripts/users.js hash');
  if (!hash && process.env.DASHBOARD_PASSWORD) {
    try { checkPasswordPolicy(process.env.DASHBOARD_PASSWORD, name); } catch (e) { throw new Error(`DASHBOARD_PASSWORD ditolak: ${e.message}`); }
    hash = await hashPassword(process.env.DASHBOARD_PASSWORD);
  }
  if (!hash) return false;
  const now = new Date().toISOString();
  writeUsers([{ name, role: 'admin', hash, createdAt: now, updatedAt: now }]);
  return true;
}

/** Mode terbuka (tanpa login) hanya bila ALLOW_NO_AUTH=1 DAN belum ada pengguna sama sekali. */
export const openMode = () => process.env.ALLOW_NO_AUTH === '1' && !hasUsers();

const fingerprint = (u) => crypto.createHash('sha256').update(u.hash).digest('hex').slice(0, 16);

// ---------------------------------------------------------------- IP klien

export function trustProxy() {
  const n = parseInt(process.env.TRUST_PROXY ?? '0', 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function normalizeIp(raw) {
  let s = String(raw ?? '').trim();
  const br = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (br) s = br[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(':'));
  s = s.replace(/%.+$/, '').toLowerCase();
  const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return mapped ? mapped[1] : s;
}

/**
 * IP klien. TRUST_PROXY=0 (default): hanya alamat soket, header X-Forwarded-For diabaikan.
 * TRUST_PROXY=N: percaya N proxy di depan server; IP diambil dari entri ke-N dari KANAN
 * (entri kiri bisa dipalsukan klien). Bila rantai lebih pendek dari N, pakai alamat soket.
 */
export function clientIp(req) {
  const sock = normalizeIp(req.socket?.remoteAddress) || 'unknown';
  const n = trustProxy();
  if (!n) return sock;
  const raw = req.headers['x-forwarded-for'];
  const list = String(Array.isArray(raw) ? raw.join(',') : raw || '')
    .split(',')
    .map((s) => normalizeIp(s))
    .filter(Boolean);
  const cand = list.length >= n ? list[list.length - n] : '';
  return net.isIP(cand) ? cand : sock;
}

export function isHttps(req) {
  if (req.socket?.encrypted) return true;
  if (!trustProxy()) return false;
  return String(req.headers['x-forwarded-proto'] || '').split(',').pop().trim().toLowerCase() === 'https';
}

/** Kunci pembatas per IP; IPv6 dikelompokkan per /64 supaya tidak mudah dihindari dengan ganti alamat. */
export function ipKey(ip) {
  if (!ip.includes(':')) return ip;
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const parts = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return parts.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '')).join(':');
}

// ---------------------------------------------------------------- Pembatas percobaan login

/**
 * Backoff eksponensial per kunci. Setelah `free` kegagalan, kunci terkunci selama
 * baseMs * 2^(gagal - free), maksimal maxMs. Entri kedaluwarsa (ttlMs) dan jumlah entri dibatasi.
 */
export function createLimiter({ free = 5, baseMs = 30_000, maxMs = 15 * 60_000, ttlMs = 60 * 60_000, maxEntries = 10_000, now = Date.now } = {}) {
  const map = new Map(); // kunci -> { fails, lockedUntil, last }
  const ttl = Math.max(ttlMs, maxMs + 1000);

  function sweep(t = now()) {
    for (const [k, v] of map) if (t - v.last > ttl && v.lockedUntil <= t) map.delete(k);
  }

  return {
    /** Detik tersisa sampai boleh mencoba lagi (0 = boleh). */
    check(keys) {
      const t = now();
      let wait = 0;
      for (const k of keys) {
        const v = map.get(k);
        if (v && v.lockedUntil > t) wait = Math.max(wait, Math.ceil((v.lockedUntil - t) / 1000));
      }
      return wait;
    },
    /** Catat kegagalan. Mengembalikan detik kunci baru bila ada kunci yang baru saja terkunci. */
    fail(keys) {
      const t = now();
      let locked = 0;
      for (const k of keys) {
        let v = map.get(k);
        if (!v || (t - v.last > ttl && v.lockedUntil <= t)) v = { fails: 0, lockedUntil: 0, last: t };
        v.fails += 1;
        v.last = t;
        if (v.fails >= free) {
          const delay = Math.min(baseMs * 2 ** Math.min(v.fails - free, 30), maxMs);
          v.lockedUntil = t + delay;
          locked = Math.max(locked, Math.ceil(delay / 1000));
        }
        map.delete(k); // pindah ke ujung: urutan Map = urutan aktivitas terakhir
        map.set(k, v);
      }
      if (map.size > maxEntries) {
        sweep(t);
        for (const k of map.keys()) {
          if (map.size <= maxEntries) break;
          map.delete(k); // buang yang paling lama tidak aktif
        }
      }
      return locked;
    },
    reset(keys) {
      for (const k of keys) map.delete(k);
    },
    sweep,
    get size() {
      return map.size;
    },
  };
}

const envInt = (name, def) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : def;
};

/**
 * Pembatas login (form dan Basic Auth). Tiga lapis:
 *  - gabungan IP+username: ketat (`limiter`, juga dipakai kunci API),
 *  - IP saja: longgar, supaya satu IP tidak bisa menebak banyak akun,
 *  - username saja: sangat longgar dan kuncinya singkat (maks 60 dtk), supaya orang lain tidak bisa mengunci admin lama-lama.
 */
export const limiter = createLimiter({
  free: envInt('LOGIN_MAX_FAILS', 5),
  baseMs: envInt('LOGIN_LOCK_BASE_SEC', 30) * 1000,
  maxMs: envInt('LOGIN_LOCK_MAX_SEC', 900) * 1000,
});
const ipLimiter = createLimiter({ free: envInt('LOGIN_IP_MAX_FAILS', 20), baseMs: 30_000, maxMs: envInt('LOGIN_LOCK_MAX_SEC', 900) * 1000 });
const userLimiter = createLimiter({ free: envInt('LOGIN_USER_MAX_FAILS', 100), baseMs: 5_000, maxMs: 60_000 });
setInterval(() => { limiter.sweep(); ipLimiter.sweep(); userLimiter.sweep(); }, 5 * 60_000).unref();

export const limitKeys = (ip, username) => {
  const u = normName(username).slice(0, 64);
  return { both: [`ip:${ipKey(ip)}|u:${u}`], ip: [`ip:${ipKey(ip)}`], user: [`u:${u}`] };
};

const logName = (s) => JSON.stringify(String(s ?? '').slice(0, 64));

/**
 * Satu-satunya pintu verifikasi kredensial (form maupun Basic Auth).
 * -> { ok:true, user } | { ok:false, status:401 } | { ok:false, status:429, retryAfter }
 */
export async function login(ip, username, password, via) {
  const keys = limitKeys(ip, username);
  const wait = Math.max(limiter.check(keys.both), ipLimiter.check(keys.ip), userLimiter.check(keys.user));
  if (wait) return { ok: false, status: 429, retryAfter: wait };

  const u = getUser(username);
  const pw = String(password ?? '');
  let good = false;
  if (pw.length <= 1024) {
    good = await verifyPassword(pw, u ? u.hash : await dummy()); // pengguna tak dikenal tetap memakan waktu yang sama
    good = good && !!u;
  }
  if (good) {
    limiter.reset(keys.both); // kunci IP-saja tidak direset agar tidak bisa dipakai menghapus hitungan
    return { ok: true, user: { name: u.name, role: u.role } };
  }

  const lock = Math.max(limiter.fail(keys.both), ipLimiter.fail(keys.ip), userLimiter.fail(keys.user));
  console.warn(`[auth] login GAGAL via=${via} user=${logName(username)} ip=${ip}`);
  audit({ user: normName(username).slice(0, 64) || '-', ip, action: 'login.gagal', detail: { via } });
  if (lock) {
    console.warn(`[auth] DIKUNCI ${lock} detik user=${logName(username)} ip=${ip}`);
    audit({ user: normName(username).slice(0, 64) || '-', ip, action: 'login.dikunci', detail: { detik: lock, via } });
  }
  return { ok: false, status: 401 };
}

// ---------------------------------------------------------------- Sesi (data/sessions.json, hanya hash token)

const SESSIONS_FILE = 'sessions.json';
export const SESSION_MS = envInt('SESSION_HOURS', 12) * 3600 * 1000;
const MAX_SESSIONS_PER_USER = 20;
let sessions = null; // hash token -> { user, fp, iat, exp, ip }

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function sessionMap() {
  if (!sessions) {
    const raw = load(SESSIONS_FILE, { sessions: {} });
    sessions = new Map(Object.entries(raw?.sessions && typeof raw.sessions === 'object' ? raw.sessions : {}));
    cleanupSessions();
  }
  return sessions;
}

function persistSessions() {
  save(SESSIONS_FILE, { sessions: Object.fromEntries(sessions) });
}

/** Token CSRF terikat ke token sesi (HMAC), jadi tidak bisa ditebak atau disisipkan lewat cookie palsu. */
export const csrfFor = (token) => crypto.createHmac('sha256', token).update('csrf').digest('hex');

export function createSession(user, ip) {
  const map = sessionMap();
  const rec = getUser(user.name);
  const token = crypto.randomBytes(32).toString('hex');
  const mine = [...map.entries()].filter(([, s]) => s.user === user.name);
  for (const [h] of mine.slice(0, Math.max(0, mine.length - MAX_SESSIONS_PER_USER + 1))) map.delete(h);
  const now = Date.now();
  map.set(sha256(token), { user: user.name, fp: rec ? fingerprint(rec) : '', iat: now, exp: now + SESSION_MS, ip });
  persistSessions();
  return { token, csrf: csrfFor(token) };
}

export function getSession(token) {
  if (!/^[0-9a-f]{64}$/.test(String(token || ''))) return null;
  const s = sessionMap().get(sha256(token));
  return s && s.exp > Date.now() ? s : null;
}

export function destroySession(token) {
  if (!/^[0-9a-f]{64}$/.test(String(token || ''))) return;
  if (sessionMap().delete(sha256(token))) persistSessions();
}

/** Hapus sesi kedaluwarsa dan sesi milik pengguna yang sudah tidak ada. Mengembalikan jumlah yang dibuang. */
export function cleanupSessions() {
  const map = sessionMap();
  const t = Date.now();
  let n = 0;
  for (const [h, s] of map) {
    if (s.exp <= t) {
      map.delete(h);
      n++;
    }
  }
  if (n) persistSessions();
  return n;
}

export const sessionCount = () => sessionMap().size;

// ---------------------------------------------------------------- Cookie, autentikasi, CSRF

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * Autentikasi request: cookie sesi dulu, lalu Basic Auth (untuk curl/skrip).
 * -> { ok:true, user, via:'session'|'basic'|'open', csrf?, token? } | { ok:false, status:401|429, retryAfter? }
 */
export async function authenticate(req, ip) {
  if (openMode()) return { ok: true, user: { name: 'admin', role: 'admin' }, via: 'open' };

  const token = parseCookies(req).session;
  const s = token && getSession(token);
  if (s) {
    const u = getUser(s.user);
    if (u && fingerprint(u) === s.fp) return { ok: true, user: { name: u.name, role: u.role }, via: 'session', token, csrf: csrfFor(token) };
  }

  const header = req.headers.authorization || '';
  if (/^basic /i.test(header)) {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    const r = await login(ip, i >= 0 ? decoded.slice(0, i) : '', i >= 0 ? decoded.slice(i + 1) : decoded, 'basic');
    return r.ok ? { ...r, via: 'basic' } : r;
  }
  return { ok: false, status: 401 };
}

const safeEq = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

/** Header X-CSRF-Token harus sama dengan cookie `csrf` DAN dengan token yang terikat ke sesi. */
export function csrfOk(req, auth) {
  const header = req.headers['x-csrf-token'];
  return safeEq(header, auth.csrf) && safeEq(parseCookies(req).csrf, auth.csrf);
}

export function sessionCookies(req, token, csrf) {
  const secure = isHttps(req) ? '; Secure' : '';
  const age = Math.floor(SESSION_MS / 1000);
  return [
    `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secure}`,
    `csrf=${csrf}; SameSite=Lax; Path=/; Max-Age=${age}${secure}`,
  ];
}

export const clearCookies = () => ['session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0', 'csrf=; SameSite=Lax; Path=/; Max-Age=0'];

// ---------------------------------------------------------------- Audit log (JSONL harian)

const pad = (n) => String(n).padStart(2, '0');
export const dayStamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const auditDir = () => path.join(dataDir(), 'audit');
const SECRET_KEY = /pass|token|secret|hash|csrf|cookie|authorization/i;
// Nomor pelanggan tidak dicatat utuh di audit (berkas audit tidak ikut terhapus oleh hak hapus/retensi).
const maskPhoneForAudit = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length < 7 ? (d ? '****' : '') : `${d.slice(0, 4)}****${d.slice(-3)}`;
};

function cleanDetail(detail) {
  if (detail === undefined || detail === null) return undefined;
  let s;
  try {
    s = JSON.stringify(detail, (k, v) => (k && SECRET_KEY.test(k) ? '[disembunyikan]' : k === 'phone' && (typeof v === 'string' || typeof v === 'number') ? maskPhoneForAudit(v) : v));
  } catch {
    return String(detail).slice(0, 500);
  }
  if (s.length <= 1000) return JSON.parse(s);
  return s.slice(0, 1000) + '…';
}

/** Catat siapa melakukan apa dan kapan. Tidak pernah melempar galat. */
export function audit({ user, role, ip, action, detail }) {
  try {
    const entry = { ts: new Date().toISOString(), user: user ?? '-', ...(role ? { role } : {}), action, detail: cleanDetail(detail), ip: ip ?? '-' };
    fs.mkdirSync(auditDir(), { recursive: true });
    fs.appendFileSync(path.join(auditDir(), `${dayStamp()}.jsonl`), JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('[audit] gagal menulis:', e.message);
  }
}

export function auditDates() {
  try {
    return fs
      .readdirSync(auditDir())
      .map((f) => f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/)?.[1])
      .filter(Boolean)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Entri audit satu hari, terbaru dulu. */
export function readAudit({ date, limit = 200, q = '' } = {}) {
  const day = date || dayStamp();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'Tanggal tidak valid (format YYYY-MM-DD)');
  const max = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  let text = '';
  try {
    text = fs.readFileSync(path.join(auditDir(), `${day}.jsonl`), 'utf8');
  } catch {
    return [];
  }
  const needle = String(q || '').toLowerCase();
  const out = [];
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
    if (!lines[i] || (needle && !lines[i].toLowerCase().includes(needle))) continue;
    try {
      out.push(JSON.parse(lines[i]));
    } catch {
      /* baris rusak dilewati */
    }
  }
  return out;
}

// ---------------------------------------------------------------- Body HTTP dengan batas ukuran

export const BODY_LIMIT = 100 * 1024;
export const SETTINGS_BODY_LIMIT = 2 * 1024 * 1024;
const DRAIN_MAX = 32 * 1024 * 1024; // sisa body yang masih dibuang agar klien sempat membaca 413

export const fmtSize = (n) => (n >= 1024 * 1024 ? `${+(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** Baca body mentah. Melebihi batas -> HttpError 413 (sisa body dibuang, koneksi tidak diputus paksa). */
export function readRaw(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const tooBig = () => new HttpError(413, `Data terlalu besar (maks ${fmtSize(limit)})`);
    const declared = Number(req.headers['content-length']);
    if (declared > DRAIN_MAX) return reject(tooBig());
    let size = 0;
    let over = declared > limit;
    let chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        over = true;
        chunks = [];
      } else if (!over) chunks.push(c);
      if (size > DRAIN_MAX) reject(tooBig());
    });
    req.on('end', () => (over ? reject(tooBig()) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
    req.on('close', () => reject(new Error('koneksi ditutup sebelum body selesai')));
  });
}

/** Baca body JSON (objek atau array). JSON rusak -> 400. */
export async function readBody(req, limit = BODY_LIMIT) {
  const raw = await readRaw(req, limit);
  if (!raw.trim()) return {};
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'JSON tidak valid');
  }
  if (v === null || typeof v !== 'object') throw new HttpError(400, 'Body harus berupa objek JSON');
  return v;
}

export const bodyLimitFor = (pathname) => (pathname === '/api/settings' || pathname.startsWith('/api/settings/') ? SETTINGS_BODY_LIMIT : BODY_LIMIT);
