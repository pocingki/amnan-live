// /api/data*: status penyimpanan, cadangan, retensi, hapus data pelanggan (khusus admin).
import fs from 'node:fs';
import path from 'node:path';
import * as D from '../db.js';
import * as store from '../store.js';
import * as C from '../conversations.js';
import * as retention from '../retention.js';
import { maskPhone } from '../notifier.js';
import { dataDir } from '../jsonfile.js';

function mediaStats() {
  try {
    const dir = path.join(dataDir(), 'media');
    const files = fs.readdirSync(dir);
    return { files: files.length, bytes: files.reduce((n, f) => n + (fs.statSync(path.join(dir, f)).size || 0), 0) };
  } catch { return { files: 0, bytes: 0 }; }
}

export async function handle(req, res, url, ctx) {
  const p = url.pathname;
  if (!p.startsWith('/api/data')) return false;
  if (p !== '/api/data' && !p.startsWith('/api/data/')) return false;
  const m = req.method;

  if (!ctx.requireRole('admin')) return true; // requireRole sudah mengirim 403

  if (p === '/api/data/status' && m === 'GET') {
    const backups = D.listBackups().map(({ file, size, mtime }) => ({ file, size, mtime }));
    ctx.sendJSON(res, 200, {
      db: D.status(),
      counts: { leads: store.all().length, conversations: C.list().length },
      backups,
      lastBackupAt: backups[0]?.mtime || null,
      retention: { days: retention.retentionDays(), last: retention.getLastResult() },
      media: mediaStats(),
    });
    return true;
  }

  if (p === '/api/data/backup' && m === 'POST') {
    try {
      const file = D.backupNow({ force: true });
      if (!file) { ctx.sendJSON(res, 409, { error: 'Cadangan tidak dibuat (penulisan database sedang dihentikan)' }); return true; }
      ctx.audit('data.backup', { file: path.basename(file) });
      ctx.sendJSON(res, 200, { ok: true, file: path.basename(file) });
    } catch (e) {
      console.error('[data] cadangan gagal:', e.message);
      ctx.sendJSON(res, 500, { error: 'Cadangan gagal' });
    }
    return true;
  }

  if (p === '/api/data/retention/run' && m === 'POST') {
    const days = retention.retentionDays();
    if (!(days > 0)) { ctx.sendJSON(res, 409, { error: 'Retensi mati (retentionDays = 0)' }); return true; }
    const r = retention.purge({ days });
    ctx.audit('data.retention', r);
    ctx.sendJSON(res, 200, { ok: true, result: r });
    return true;
  }

  const cm = p.match(/^\/api\/data\/customer\/([^/]+)$/);
  if (cm && m === 'DELETE') {
    let phone;
    try { phone = decodeURIComponent(cm[1]); } catch { ctx.sendJSON(res, 400, { error: 'Nomor tidak valid' }); return true; }
    if (!/^[\w+.@-]{3,64}$/.test(phone)) { ctx.sendJSON(res, 400, { error: 'Nomor tidak valid' }); return true; }
    const r = retention.deleteCustomer(phone);
    if (!r.found) { ctx.sendJSON(res, 404, { error: 'Data pelanggan tidak ditemukan' }); return true; }
    ctx.audit('data.delete_customer', { phone: maskPhone(phone), leads: r.leads, messages: r.messages, media: r.media });
    ctx.sendJSON(res, 200, { ok: true, deleted: r });
    return true;
  }

  ctx.sendJSON(res, 404, { error: 'Tidak ditemukan' });
  return true;
}
