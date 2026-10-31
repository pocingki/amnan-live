// /api/settings: baca/ubah pengaturan (versi + If-Match), riwayat, pemulihan.
import * as settings from '../settings.js';

const META = new Set(['version', 'updatedAt', 'updatedBy']);
const isObj = (b) => b && typeof b === 'object' && !Array.isArray(b);

// If-Match: 3 / "3" / W/"3" -> 3; kosong -> null (tanpa pemeriksaan)
function ifMatch(req) {
  const h = String(req.headers?.['if-match'] ?? '').trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  return h === '' ? null : Number(h);
}

export async function handle(req, res, url, ctx) {
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/settings' && m === 'GET') {
    const view = settings.publicView(settings.get());
    if (ctx.user?.role !== 'admin') delete view.notify;
    ctx.sendJSON(res, 200, view);
    return true;
  }

  if (p === '/api/settings' && m === 'PUT') {
    if (!ctx.requireRole('admin')) return true;
    const body = await ctx.readBody(req);
    if (!isObj(body)) {
      ctx.sendJSON(res, 400, { error: 'Isi permintaan tidak valid.' });
      return true;
    }
    try {
      const next = settings.update(body, { expectedVersion: ifMatch(req), by: ctx.user?.name });
      // audit: hanya nama kunci, tanpa nilai (token/webhook rahasia)
      ctx.audit('settings.update', { fields: Object.keys(body).filter((k) => k in settings.DEFAULTS && !META.has(k)), version: next.version });
      ctx.sendJSON(res, 200, settings.publicView(next));
    } catch (e) {
      if (e.code === 'CONFLICT') ctx.sendJSON(res, 409, { error: 'Pengaturan diubah orang lain, muat ulang.', current: settings.publicView(e.current) });
      else if (e.code === 'VALIDATION') ctx.sendJSON(res, 400, { error: e.message });
      else throw e;
    }
    return true;
  }

  if (p === '/api/settings/history' && m === 'GET') {
    if (!ctx.requireRole('admin')) return true;
    ctx.sendJSON(res, 200, settings.history());
    return true;
  }

  if (p === '/api/settings/restore' && m === 'POST') {
    if (!ctx.requireRole('admin')) return true;
    const body = await ctx.readBody(req);
    try {
      const next = settings.restore(isObj(body) ? body.version : null, { by: ctx.user?.name });
      ctx.audit('settings.restore', { from: Number(body.version), version: next.version });
      ctx.sendJSON(res, 200, settings.publicView(next));
    } catch (e) {
      if (e.code === 'NOT_FOUND') ctx.sendJSON(res, 404, { error: e.message });
      else if (e.code === 'VALIDATION') ctx.sendJSON(res, 400, { error: e.message });
      else throw e;
    }
    return true;
  }

  return false;
}
