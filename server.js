// Server demo Amnan SaaS: dashboard statis + API lead + koneksi WhatsApp.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Muat .env sederhana (tanpa dependensi tambahan)
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const { start: startWA } = await import('./src/whatsapp.js');
const { route } = await import('./src/routes.js');

const PORT = Number(process.env.PORT) || 8080;
const USER = process.env.DASHBOARD_USER || 'admin';
const PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const PUBLIC_DIR = path.resolve('public');

if (!PASSWORD && process.env.ALLOW_NO_AUTH !== '1') {
  console.error(
    '\nDASHBOARD_PASSWORD belum diisi.\n' +
      'Dashboard ini berisi nomor WhatsApp pelanggan dan QR login, jadi jangan dibuka ke internet tanpa password.\n' +
      'Salin .env.example menjadi .env lalu isi DASHBOARD_PASSWORD (atau set ALLOW_NO_AUTH=1 hanya untuk uji lokal).\n'
  );
  process.exit(1);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest();

function credsOk(user, pass) {
  const okUser = crypto.timingSafeEqual(sha(user), sha(USER));
  const okPass = crypto.timingSafeEqual(sha(pass), sha(PASSWORD));
  return okUser && okPass;
}

// Sesi login disimpan di memori (hilang saat server restart, cukup untuk demo)
const SESSION_MS = 12 * 3600 * 1000;
const sessions = new Map(); // token -> waktu kedaluwarsa
const attempts = new Map(); // ip -> { count, reset }

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function authorized(req) {
  if (!PASSWORD) return true;

  const token = parseCookies(req).session;
  if (token && (sessions.get(token) || 0) > Date.now()) return true;

  // Basic auth tetap diterima untuk curl/skrip, tanpa memicu popup di browser
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i >= 0) return credsOk(decoded.slice(0, i), decoded.slice(i + 1));
  }
  return false;
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e4) {
        reject(new Error('body terlalu besar'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
  });
}

async function handleLogin(req, res) {
  const ip = clientIp(req);
  const now = Date.now();
  const rec = attempts.get(ip);
  if (rec && rec.reset > now && rec.count >= 10) {
    res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');
    return;
  }

  const form = new URLSearchParams(await readRaw(req));
  if (credsOk(form.get('username') || '', form.get('password') || '')) {
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, now + SESSION_MS);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.writeHead(302, {
      'Set-Cookie': `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`,
      Location: '/',
    });
    res.end();
    return;
  }

  attempts.set(ip, rec && rec.reset > now ? { count: rec.count + 1, reset: rec.reset } : { count: 1, reset: now + 10 * 60 * 1000 });
  res.writeHead(302, { Location: '/login?error=1' }).end();
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJSON(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e5) {
        reject(new Error('body terlalu besar'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('JSON tidak valid'));
      }
    });
  });
}

async function handleApi(req, res, url) {
  const handled = await route(req, res, url, { sendJSON, readBody, user: USER });
  if (!handled) sendJSON(res, 404, { error: 'endpoint tidak ditemukan' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Tidak ditemukan');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/login') {
      if (req.method === 'POST') return await handleLogin(req, res);
      return serveStatic(req, res, { pathname: '/login.html' });
    }

    if (url.pathname === '/logout' && req.method === 'POST') {
      const t = parseCookies(req).session;
      if (t) sessions.delete(t);
      res.writeHead(302, { 'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0', Location: '/login' }).end();
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/favicon.svg' || url.pathname === '/favicon.ico' || url.pathname.startsWith('/assets/img/'))) return serveStatic(req, res, url);

    if (!authorized(req)) {
      if (url.pathname.startsWith('/api/')) return sendJSON(res, 401, { error: 'perlu login' });
      res.writeHead(302, { Location: '/login' }).end();
      return;
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    console.error('[http]', err);
    if (!res.headersSent) sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Dashboard jalan di http://localhost:${PORT}`);
  startWA().catch(console.error);
});