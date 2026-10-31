// GET /api/media/:id — kirim berkas media (dukung Range).
import fs from 'node:fs';
import { pipeline } from 'node:stream';
import { getMedia } from '../media.js';

const SAFE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'application/pdf']);

// Hasil: {start,end} | 'invalid' | null (tanpa Range / format tidak dikenal -> kirim penuh)
function parseRange(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(h || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0 || size === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

export async function handle(req, res, url, ctx) {
  if (req.method !== 'GET') return false;
  const m = /^\/api\/media\/([^/]+)$/.exec(url.pathname);
  if (!m) return false;
  const media = getMedia(m[1]);
  if (!media) {
    ctx.sendJSON(res, 404, { error: 'Media tidak ditemukan.' });
    return true;
  }
  const base = String(media.mime).split(';')[0].trim().toLowerCase();
  const safe = SAFE.has(base);
  const headers = {
    'Content-Type': safe ? base : 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
    'Accept-Ranges': 'bytes',
  };
  if (!safe) {
    const fname = (media.name || 'media').replace(/[^\w.\-]+/g, '_').slice(0, 100) || 'media';
    headers['Content-Disposition'] = `attachment; filename="${fname}"`;
  }
  const range = parseRange(req.headers?.range, media.size);
  if (range === 'invalid') {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${media.size}` });
    res.end();
    return true;
  }
  let opts, code = 200;
  if (range) {
    code = 206;
    opts = { start: range.start, end: range.end };
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${media.size}`;
    headers['Content-Length'] = range.end - range.start + 1;
  } else {
    headers['Content-Length'] = media.size;
  }
  res.writeHead(code, headers);
  if (media.size === 0) { res.end(); return true; }
  pipeline(fs.createReadStream(media.path, opts), res, () => {});
  return true;
}
