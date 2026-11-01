// Identitas brand per instance: warna (di settings.brandColor), logo, dan favicon.
// Logo/favicon disimpan di <DATA_DIR>/brand/ (bukan di public/, supaya tidak ikut git dan tiap client berbeda).
// Rute publik (dipakai halaman login juga): /brand.css, /brand.json, /brand/logo, /brand/favicon.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, ensureDir, secureFile } from './jsonfile.js';
import * as settings from './settings.js';
// Satu implementasi warna dipakai server (validasi, brand.css) dan browser (pratinjau di Pengaturan).
import { cssFor, paletteFrom } from '../public/assets/js/brand-color.js';

export const KINDS = {
  logo: { max: 1024 * 1024, types: ['png', 'jpeg', 'webp'] },
  favicon: { max: 256 * 1024, types: ['png', 'ico'] },
};
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon' };
const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp', ico: 'ico' };
const ALL_EXT = ['png', 'jpg', 'webp', 'ico'];
const DEFAULT_FAVICON = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'favicon.svg');

export const brandDir = () => path.join(dataDir(), 'brand');

/** Jenis gambar dari byte awal (bukan dari nama berkas/Content-Type kiriman klien). SVG sengaja tidak diterima. */
export function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'ico';
  return null;
}

export class BrandError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** Validasi dan simpan. Mengembalikan { type, size }. Melempar BrandError bila ditolak. */
export function saveAsset(kind, buf) {
  const spec = KINDS[kind];
  if (!spec) throw new BrandError('Jenis tidak dikenal.', 404);
  if (!buf || !buf.length) throw new BrandError('Berkas kosong.');
  if (buf.length > spec.max) throw new BrandError(`Berkas terlalu besar (maks ${Math.round(spec.max / 1024)} KB).`, 413);
  const type = sniff(buf);
  if (!type || !spec.types.includes(type)) {
    const ok = spec.types.map((t) => t.toUpperCase()).join(', ');
    throw new BrandError(`Format tidak didukung. Gunakan ${ok}. (SVG tidak diterima demi keamanan.)`, 415);
  }
  const dir = ensureDir(brandDir());
  removeAsset(kind);
  const file = path.join(dir, `${kind}.${EXT[type]}`);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, buf, { mode: 0o600 });
  fs.renameSync(tmp, file);
  secureFile(file);
  return { type, size: buf.length };
}

export function removeAsset(kind) {
  let removed = false;
  for (const ext of ALL_EXT) {
    try { fs.unlinkSync(path.join(brandDir(), `${kind}.${ext}`)); removed = true; } catch { /* tidak ada */ }
  }
  return removed;
}

/** { file, type, size, mtimeMs } atau null bila belum ada. */
export function readAsset(kind) {
  for (const type of KINDS[kind].types) {
    const file = path.join(brandDir(), `${kind}.${EXT[type]}`);
    try {
      const st = fs.statSync(file);
      if (st.isFile()) return { file, type, size: st.size, mtimeMs: st.mtimeMs };
    } catch { /* coba berikutnya */ }
  }
  return null;
}

const info = (a) => (a ? { type: a.type, size: a.size, updatedAt: Math.round(a.mtimeMs) } : null);

/** Ringkasan untuk dashboard (GET /api/brand). */
export function status() {
  const S = settings.get();
  return {
    name: S.brandName,
    color: S.brandColor || '',
    palette: paletteFrom(S.brandColor),
    logo: info(readAsset('logo')),
    favicon: info(readAsset('favicon')),
    limits: { logoKB: KINDS.logo.max / 1024, faviconKB: KINDS.favicon.max / 1024 },
  };
}

function send(req, res, code, type, body, extra = {}) {
  res.writeHead(code, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body ?? ''),
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function sendFile(req, res, file, type, etag) {
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
    return res.end();
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** Rute publik tanpa login. true bila ditangani. Dipanggil server untuk GET/HEAD sebelum autentikasi. */
export function servePublic(req, res, pathname) {
  if (pathname === '/brand.css') {
    send(req, res, 200, 'text/css; charset=utf-8', cssFor(settings.get().brandColor));
    return true;
  }
  if (pathname === '/brand.json') { // hanya yang memang tampil di halaman login
    send(req, res, 200, 'application/json; charset=utf-8', JSON.stringify({ name: settings.get().brandName, logo: !!readAsset('logo') }));
    return true;
  }
  if (pathname === '/brand/logo') {
    const a = readAsset('logo');
    if (!a) send(req, res, 404, 'text/plain; charset=utf-8', 'Belum ada logo');
    else sendFile(req, res, a.file, MIME[a.type], `W/"${a.size}-${Math.round(a.mtimeMs)}"`);
    return true;
  }
  if (pathname === '/brand/favicon') {
    const a = readAsset('favicon');
    if (a) sendFile(req, res, a.file, MIME[a.type], `W/"${a.size}-${Math.round(a.mtimeMs)}"`);
    else sendFile(req, res, DEFAULT_FAVICON, 'image/svg+xml', 'W/"default"');
    return true;
  }
  return false;
}
