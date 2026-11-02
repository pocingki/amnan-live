// API admin untuk kunci aplikasi dan webhook (docs/INTEGRASI.md bagian 6). Hanya peran admin
// (dijaga di routes.adminOnly dan diperiksa ulang di sini).
import * as connect from '../connect.js';

const ID = /^[0-9a-f]{8}$/;

export async function handle(req, res, url, ctx) {
  const p = url.pathname.replace(/\/+$/, '');
  if (p !== '/api/integrations' && !p.startsWith('/api/integrations/')) return false;
  if (!ctx.requireRole('admin')) return true;
  const m = req.method;
  const send = (code, body) => (ctx.sendJSON(res, code, body), true);
  const guard = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      if (e?.status && e.status < 500) return send(e.status, { error: e.message, code: e.code || 'VALIDATION' });
      throw e;
    }
  };

  if (p === '/api/integrations' && m === 'GET') {
    return send(200, {
      contract: connect.CONTRACT, scopes: connect.SCOPES, webhookEvents: connect.WEBHOOK_EVENTS,
      keys: connect.listKeys(), webhooks: connect.listWebhooks(), deliveries: connect.deliveries(),
    });
  }

  if (p === '/api/integrations/keys' && m === 'POST') {
    return guard(async () => {
      const b = await ctx.readBody(req);
      const r = connect.createKey({ ...b, createdBy: ctx.user.name });
      ctx.audit('integrasi.kunci.buat', { id: r.key.id, app: r.key.app, scopes: r.key.scopes });
      return send(201, r);
    });
  }

  const km = p.match(/^\/api\/integrations\/keys\/([^/]+)$/);
  if (km && m === 'DELETE') {
    return guard(async () => {
      if (!ID.test(km[1])) return send(404, { error: 'Kunci tidak ditemukan', code: 'NOT_FOUND' });
      const key = connect.revokeKey(km[1]);
      ctx.audit('integrasi.kunci.cabut', { id: key.id });
      return send(200, { key });
    });
  }

  if (p === '/api/integrations/webhooks' && m === 'POST') {
    return guard(async () => {
      const r = connect.createWebhook(await ctx.readBody(req));
      ctx.audit('integrasi.webhook.buat', { id: r.webhook.id, url: r.webhook.url });
      connect.pingWebhook(r.webhook.id);
      return send(201, r);
    });
  }

  const wm = p.match(/^\/api\/integrations\/webhooks\/([^/]+)(?:\/(test))?$/);
  if (wm) {
    return guard(async () => {
      if (!ID.test(wm[1])) return send(404, { error: 'Webhook tidak ditemukan', code: 'NOT_FOUND' });
      if (wm[2] === 'test' && m === 'POST') return send(200, { ok: true, queued: connect.pingWebhook(wm[1]) });
      if (!wm[2] && m === 'PATCH') {
        const w = connect.updateWebhook(wm[1], await ctx.readBody(req));
        ctx.audit('integrasi.webhook.ubah', { id: w.id, aktif: w.active });
        return send(200, { webhook: w });
      }
      if (!wm[2] && m === 'DELETE') {
        connect.removeWebhook(wm[1]);
        ctx.audit('integrasi.webhook.hapus', { id: wm[1] });
        return send(200, { ok: true });
      }
      return false;
    });
  }
  return false;
}
