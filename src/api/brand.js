// /api/brand: ringkasan identitas brand + unggah/hapus logo dan favicon (admin saja untuk perubahan).
// Warna diubah lewat PUT /api/settings (brandColor) supaya ikut versi dan riwayat pengaturan.
import * as brand from '../brand.js';
import { HttpError } from '../auth.js';

const ROUTE = /^\/api\/brand\/(logo|favicon)$/;

export async function handle(req, res, url, ctx) {
  const p = url.pathname;
  if (p === '/api/brand' && req.method === 'GET') {
    ctx.sendJSON(res, 200, brand.status());
    return true;
  }
  const m = ROUTE.exec(p);
  if (!m) return false;
  const kind = m[1];

  if (req.method === 'POST' || req.method === 'PUT') {
    if (!ctx.requireRole('admin')) return true;
    const buf = await readRawBuffer(req, brand.KINDS[kind].max);
    try {
      const r = brand.saveAsset(kind, buf);
      ctx.audit(`brand.${kind}.set`, { type: r.type, size: r.size });
      ctx.sendJSON(res, 200, brand.status());
    } catch (e) {
      if (!(e instanceof brand.BrandError)) throw e;
      ctx.sendJSON(res, e.status, { error: e.message });
    }
    return true;
  }

  if (req.method === 'DELETE') {
    if (!ctx.requireRole('admin')) return true;
    brand.removeAsset(kind);
    ctx.audit(`brand.${kind}.remove`, {});
    ctx.sendJSON(res, 200, brand.status());
    return true;
  }

  res.setHeader('Allow', 'POST, PUT, DELETE');
  ctx.sendJSON(res, 405, { error: 'Metode tidak diizinkan' });
  return true;
}

/** Body biner. auth.readRaw() mengubah ke string UTF-8 (merusak byte gambar), jadi baca langsung di sini. */
function readRawBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) {
      req.resume();
      return reject(new HttpError(413, `Berkas terlalu besar (maks ${Math.round(limit / 1024)} KB).`));
    }
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) over = true;
      else if (!over) chunks.push(c);
    });
    req.on('end', () => (over ? reject(new HttpError(413, `Berkas terlalu besar (maks ${Math.round(limit / 1024)} KB).`)) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}
