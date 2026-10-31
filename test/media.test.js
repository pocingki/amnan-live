// Uji penyimpanan media dan endpoint GET /api/media/:id.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-media-'));
const { saveMedia, getMedia, deleteMedia } = await import('../src/media.js');
const { handle } = await import('../src/api/media.js');

// --- tes modul media ---
const { mediaId } = await saveMedia(Buffer.from('halo dunia'), { mime: 'image/png', kind: 'image', name: 'a.png' });
assert.match(mediaId, /^[a-f0-9]{32}$/);
const g = getMedia(mediaId);
assert.equal(g.size, 10);
assert.equal(g.mime, 'image/png');
assert.equal(fs.readFileSync(g.path, 'utf8'), 'halo dunia');
if (process.platform !== 'win32') {
  assert.equal(fs.statSync(path.dirname(g.path)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(g.path).mode & 0o777, 0o600);
}
for (const bad of ['../x', '..%2fx', '', 'A'.repeat(32), mediaId + '0', null, undefined, 5]) assert.equal(getMedia(bad), null, String(bad));
await assert.rejects(saveMedia(Buffer.alloc(1024 * 1024 + 1), { mime: 'image/png', maxMB: 1 }), { code: 'MEDIA_TOO_LARGE' });
await assert.doesNotReject(saveMedia(Buffer.alloc(1024 * 1024), { mime: 'image/png', maxMB: 1 }));
assert.equal(deleteMedia(mediaId), true);
assert.equal(getMedia(mediaId), null);
assert.equal(fs.existsSync(g.path + '.json'), false);
assert.equal(deleteMedia('../x'), false);

// --- tes API (mock req/res) ---
class Res extends Writable {
  constructor() { super(); this.chunks = []; this.headers = {}; this.code = 0; }
  writeHead(c, h) { this.code = c; Object.assign(this.headers, h); }
  _write(c, _e, cb) { this.chunks.push(c); cb(); }
  get text() { return Buffer.concat(this.chunks).toString(); }
}
const ctx = { sendJSON(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); } };
async function get(p, headers = {}, method = 'GET') {
  const res = new Res();
  const done = new Promise((r) => res.on('finish', r));
  const h = await handle({ method, headers }, res, new URL(p, 'http://x'), ctx);
  if (h) await done;
  return { h, res };
}
const mk = (buf, mime, name = 'f') => saveMedia(Buffer.from(buf), { mime, kind: 'x', name }).then((r) => r.mediaId);

// whitelist tipe
const ogg = await mk('abc', 'audio/ogg; codecs=opus');
let r = await get('/api/media/' + ogg);
assert.equal(r.res.code, 200);
assert.equal(r.res.headers['Content-Type'], 'audio/ogg');
assert.equal(r.res.headers['X-Content-Type-Options'], 'nosniff');
assert.equal(r.res.headers['Cache-Control'], 'private, max-age=3600');
const html = await mk('<script>1</script>', 'text/html', 'x.html');
r = await get('/api/media/' + html);
assert.equal(r.res.headers['Content-Type'], 'application/octet-stream');
assert.match(r.res.headers['Content-Disposition'], /^attachment/);
assert.equal((await get('/api/foo')).h, false);
assert.equal((await get('/api/media/' + ogg, {}, 'POST')).h, false);

// Range
const rg = await mk('0123456789', 'video/mp4');
r = await get('/api/media/' + rg, { range: 'bytes=2-5' });
assert.equal(r.res.code, 206);
assert.equal(r.res.headers['Content-Range'], 'bytes 2-5/10');
assert.equal(r.res.text, '2345');
r = await get('/api/media/' + rg, { range: 'bytes=-3' });
assert.equal(r.res.text, '789');
r = await get('/api/media/' + rg, { range: 'bytes=20-30' });
assert.equal(r.res.code, 416);
assert.equal(r.res.headers['Content-Range'], 'bytes */10');
r = await get('/api/media/' + rg, { range: 'bytes=5-2' });
assert.equal(r.res.code, 416);

// 404
r = await get('/api/media/' + '0'.repeat(32));
assert.equal(r.res.code, 404);
r = await get('/api/media/..%2fx');
assert.equal(r.res.code, 404);

console.log('media.test.js OK');
