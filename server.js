// Server dashboard amnan-live: HTTP, login/sesi, header keamanan, file statis, API (src/routes.js)
// dan siklus hidup proses (shutdown rapi, penanganan galat tak tertangkap).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.TZ ||= 'Asia/Jakarta';

// Semua path relatif ke akar aplikasi (lokasi file ini), bukan ke folder tempat perintah dijalankan.
// Override: APP_DIR (akar) dan DATA_DIR (data; relatif dihitung dari akar).
const ROOT = path.resolve(process.env.APP_DIR || path.dirname(fileURLToPath(import.meta.url)));

// Muat .env sederhana dari akar aplikasi (tanpa dependensi tambahan)
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {
  /* .env tidak ada: pakai environment apa adanya */
}

process.env.DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
// Modul lain memakai path relatif (config/keywords.json, dll.); pastikan selalu dihitung dari akar.
process.chdir(ROOT);

const auth = await import('./src/auth.js');
const { HttpError } = auth;
const { initRoutes, route } = await import('./src/routes.js');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.join(ROOT, 'public');

let VERSION = 'unknown';
try {
  VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || VERSION;
} catch {
  /* abaikan */
}

// ---------------------------------------------------------------- Pengguna awal

try {
  if (await auth.seedFromEnv()) console.log(`[auth] admin awal "${auth.normName(process.env.DASHBOARD_USER || 'admin')}" dibuat dari .env`);
} catch (err) {
  console.error('\n' + err.message + '\n');
  process.exit(1);
}

if (!auth.hasUsers() && process.env.ALLOW_NO_AUTH !== '1') {
  console.error(
    '\nBelum ada pengguna dashboard.\n' +
      'Dashboard ini berisi nomor WhatsApp pelanggan dan QR login, jadi jangan dibuka ke internet tanpa password.\n' +
      'Isi DASHBOARD_PASSWORD di .env, atau buat pengguna: node scripts/users.js add <nama> --role admin\n' +
      '(ALLOW_NO_AUTH=1 hanya untuk uji lokal.)\n'
  );
  process.exit(1);
}
if (auth.openMode()) console.warn('[auth] PERINGATAN: ALLOW_NO_AUTH=1 dan belum ada pengguna, dashboard terbuka tanpa login.');

// ---------------------------------------------------------------- WhatsApp (opsional)

let waMod = null;
if (process.env.DISABLE_WA !== '1') {
  try {
    waMod = await import('./src/whatsapp.js');
  } catch (err) {
    console.error('[wa] modul WhatsApp gagal dimuat, dashboard tetap jalan tanpa bot:', err);
  }
}

await initRoutes();

// ---------------------------------------------------------------- Helper HTTP

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

// Kebijakan K3
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function setSecurityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (auth.isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function sendJSON(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const sendText = (res, code, text, headers = {}) => res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', ...headers }).end(text);
const isWrite = (m) => !['GET', 'HEAD', 'OPTIONS'].includes(m);
const fmtWait = (s) => (s >= 120 ? `${Math.ceil(s / 60)} menit` : `${s} detik`);

/** Galat tak terduga: log lengkap di server dengan ID kejadian; klien hanya menerima pesan generik + ID. */
function sendError(req, res, err) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (err instanceof HttpError) {
    if (err.status === 413) res.setHeader('Connection', 'close');
    return sendJSON(res, err.status, { error: err.message });
  }
  if (err instanceof URIError) return sendJSON(res, 400, { error: 'Permintaan tidak valid' });
  const id = crypto.randomBytes(4).toString('hex');
  console.error(`[http] GALAT id=${id} ${req.method} ${String(req.url).slice(0, 200)}`, err);
  sendJSON(res, 500, { error: 'Terjadi kesalahan di server. Sebutkan ID kejadian ini saat melapor.', id });
}

function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) return sendJSON(res, 405, { error: 'Metode tidak diizinkan' });
  let rel = decodeURIComponent(pathname); // URIError (mis. %E0) ditangkap sendError -> 400
  if (rel.includes('\0')) throw new HttpError(400, 'Permintaan tidak valid');
  if (rel === '/') rel = '/index.html';
  if (rel.split('/').some((seg) => seg.startsWith('.'))) return sendText(res, 404, 'Tidak ditemukan');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return sendText(res, 404, 'Tidak ditemukan');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// Aset yang boleh dibuka sebelum login (halaman login + favicon)
const PUBLIC_ASSETS = new Set(['/favicon.svg', '/favicon.ico', '/assets/css/login.css', '/assets/js/login.js']);
const isPublicAsset = (p) => PUBLIC_ASSETS.has(p) || p.startsWith('/assets/img/');

function makeCtx(req, res, a, ip, url) {
  const { user } = a;
  const audit = (action, detail) => auth.audit({ user: user.name, role: user.role, ip, action, detail });
  return {
    sendJSON,
    readBody: (r = req, limit) => auth.readBody(r, limit ?? auth.bodyLimitFor(url.pathname)),
    user: { name: user.name, role: user.role },
    ip,
    audit,
    csrfToken: a.csrf ?? null,
    requireRole(role) {
      if (auth.hasRole(user, role)) return true;
      audit('akses.ditolak', { method: req.method, path: url.pathname, butuh: role });
      sendJSON(res, 403, { error: `Akses ditolak: perlu peran ${role}` });
      return false;
    },
  };
}

// ---------------------------------------------------------------- Alur request

async function handleLogin(req, res, ip) {
  if (auth.openMode()) return void res.writeHead(302, { Location: '/' }).end();
  const form = new URLSearchParams(await auth.readRaw(req, 16 * 1024));
  const username = String(form.get('username') || '').slice(0, 200);
  const r = await auth.login(ip, username, String(form.get('password') || ''), 'form');

  if (r.status === 429) return sendText(res, 429, `Terlalu banyak percobaan. Coba lagi dalam ${fmtWait(r.retryAfter)}.`, { 'Retry-After': String(r.retryAfter) });
  if (!r.ok) return void res.writeHead(302, { Location: '/login?error=1' }).end();

  const { token, csrf } = auth.createSession(r.user, ip);
  autoAudit(r.user, ip, 'login');
  res.writeHead(302, { 'Set-Cookie': auth.sessionCookies(req, token, csrf), Location: '/' }).end();
}

function autoAudit(user, ip, action, detail) {
  auth.audit({ user: user.name, role: user.role, ip, action, detail });
}

async function handleLogout(req, res, ip) {
  const token = auth.parseCookies(req).session;
  const s = token && auth.getSession(token);
  if (s) {
    const csrf = auth.csrfFor(token);
    if (!auth.csrfOk(req, { csrf })) {
      autoAudit({ name: s.user }, ip, 'csrf.gagal', { path: '/logout' });
      return sendJSON(res, 403, { error: 'CSRF' });
    }
    auth.destroySession(token);
    const u = auth.getUser(s.user);
    autoAudit({ name: s.user, role: u?.role }, ip, 'logout');
  }
  res.writeHead(302, { 'Set-Cookie': auth.clearCookies(), Location: '/login' }).end();
}

function health(req, res) {
  const status = process.env.DISABLE_WA === '1' ? 'disabled' : (waMod?.wa?.status ?? 'unavailable');
  sendJSON(res, 200, { status: 'ok', uptime: Math.round(process.uptime()), version: VERSION, wa: { status } });
}

async function handle(req, res) {
  setSecurityHeaders(req, res);
  if (!String(req.url).startsWith('/')) throw new HttpError(400, 'Permintaan tidak valid');
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    throw new HttpError(400, 'Permintaan tidak valid');
  }
  const p = url.pathname;
  const ip = auth.clientIp(req);

  if (p === '/healthz' && ['GET', 'HEAD'].includes(req.method)) return health(req, res);

  if (p === '/login') {
    if (req.method === 'POST') return await handleLogin(req, res, ip);
    return serveStatic(req, res, '/login.html');
  }
  if (p === '/logout' && req.method === 'POST') return await handleLogout(req, res, ip);
  if (req.method === 'GET' && isPublicAsset(p)) return serveStatic(req, res, p);

  const a = await auth.authenticate(req, ip);
  if (!a.ok) {
    if (a.status === 429) {
      res.setHeader('Retry-After', String(a.retryAfter));
      return sendJSON(res, 429, { error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${fmtWait(a.retryAfter)}.` });
    }
    if (p.startsWith('/api/')) return sendJSON(res, 401, { error: 'perlu login' });
    return void res.writeHead(302, { Location: '/login' }).end();
  }

  // K2: permintaan yang memakai cookie sesi wajib membawa X-CSRF-Token (Basic Auth tidak perlu)
  if (a.via === 'session' && isWrite(req.method) && !auth.csrfOk(req, a)) {
    autoAudit(a.user, ip, 'csrf.gagal', { method: req.method, path: p });
    return sendJSON(res, 403, { error: 'CSRF' });
  }

  if (p.startsWith('/api/')) {
    const handled = await route(req, res, url, makeCtx(req, res, a, ip, url));
    if (!handled && !res.headersSent) sendJSON(res, 404, { error: 'endpoint tidak ditemukan' });
    return;
  }
  return serveStatic(req, res, p);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => sendError(req, res, err));
});
server.requestTimeout = 120_000;
server.headersTimeout = 30_000;

// ---------------------------------------------------------------- Siklus hidup proses

let stopping = false;

async function shutdown(reason, code = 0) {
  if (stopping) return;
  stopping = true;
  console.log(`[server] berhenti (${reason})...`);
  const force = setTimeout(() => {
    console.error('[server] batas waktu shutdown habis, keluar paksa');
    process.exit(code || 1);
  }, 10_000);
  force.unref();

  const closed = new Promise((resolve) => server.close(resolve));
  server.closeIdleConnections?.();
  setTimeout(() => server.closeAllConnections?.(), 2000).unref(); // SSE dan koneksi yang masih menggantung
  await Promise.race([closed, new Promise((r) => setTimeout(r, 3000))]);

  try {
    await waMod?.stop?.();
  } catch (err) {
    console.error('[server] gagal menghentikan WhatsApp:', err);
  }
  for (const [file, fn] of [['./src/store.js', 'flush'], ['./src/conversations.js', 'flush'], ['./src/db.js', 'closeAll']]) {
    try {
      const mod = await import(file);
      if (typeof mod[fn] === 'function') await mod[fn]();
    } catch (err) {
      console.error(`[server] gagal ${fn} ${file}:`, err.message);
    }
  }
  process.exit(code);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException:', err);
  shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (err) => {
  console.error('[server] unhandledRejection:', err);
  shutdown('unhandledRejection', 1);
});

setInterval(() => auth.cleanupSessions(), 10 * 60_000).unref();

server.listen(PORT, () => {
  console.log(`Dashboard jalan di http://localhost:${PORT}`);
  waMod?.start?.().catch(console.error);
});
