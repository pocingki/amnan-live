// Penyimpanan media WhatsApp di disk: <DATA_DIR>/media/<id> (isi) + <id>.json (metadata).
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as settings from './settings.js';

const ID_RE = /^[a-f0-9]{32}$/;
const dir = () => path.join(process.env.DATA_DIR || path.resolve('data'), 'media');

// Batas ukuran (byte). Field belum ada/tidak valid -> 16 MB.
function limitBytes(override) {
  let mb = override;
  if (mb == null) {
    try { mb = settings.get().maxMediaMB; } catch { mb = null; }
  }
  mb = Number(mb);
  if (!Number.isFinite(mb) || mb <= 0) mb = 16;
  return mb * 1024 * 1024;
}

// opts.maxMB (opsional) menimpa pengaturan; dipakai tes.
export async function saveMedia(buffer, { mime = '', kind = '', name = '', maxMB } = {}) {
  const size = buffer?.length ?? 0;
  if (size > limitBytes(maxMB)) {
    const e = new Error('Ukuran media melebihi batas.');
    e.code = 'MEDIA_TOO_LARGE';
    throw e;
  }
  const d = dir();
  await fs.promises.mkdir(d, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(d, 0o700).catch(() => {});
  const mediaId = randomBytes(16).toString('hex');
  const file = path.join(d, mediaId);
  const meta = { mime: String(mime), kind: String(kind), name: String(name).slice(0, 200), size, ts: Date.now() };
  try {
    await fs.promises.writeFile(file, buffer, { mode: 0o600 });
    await fs.promises.writeFile(file + '.json', JSON.stringify(meta), { mode: 0o600 });
  } catch (err) {
    await fs.promises.rm(file, { force: true }).catch(() => {});
    await fs.promises.rm(file + '.json', { force: true }).catch(() => {});
    throw err;
  }
  return { mediaId };
}

// id harus 32 hex (cegah path traversal); tidak ada -> null.
export function getMedia(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  const file = path.join(dir(), id);
  try {
    const meta = JSON.parse(fs.readFileSync(file + '.json', 'utf8'));
    const size = fs.statSync(file).size;
    return { path: file, mime: meta.mime || 'application/octet-stream', size, name: meta.name || '' };
  } catch {
    return null;
  }
}

export function deleteMedia(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return false;
  const file = path.join(dir(), id);
  let ok = false;
  for (const f of [file, file + '.json']) {
    try { fs.unlinkSync(f); ok = true; } catch { /* sudah tidak ada */ }
  }
  return ok;
}
