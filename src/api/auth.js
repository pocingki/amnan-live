// Endpoint milik A3: /api/me, /api/users*, /api/audit (pengguna & audit hanya untuk admin).
import * as A from '../auth.js';

const USER = /^\/api\/users\/([^/]+)$/;

export async function handle(req, res, url, ctx) {
  const p = url.pathname;
  const m = req.method;
  const ok = (body = { ok: true }, code = 200) => (ctx.sendJSON(res, code, body), true);
  const fail = (code, msg) => (ctx.sendJSON(res, code, { error: msg }), true);

  if (p === '/api/me' && m === 'GET') {
    return ok({ user: ctx.user.name, role: ctx.user.role, csrfToken: ctx.csrfToken ?? null });
  }

  if (p === '/api/audit' && m === 'GET') {
    if (!ctx.requireRole('admin')) return true;
    const q = url.searchParams;
    const date = q.get('date') || undefined;
    return ok({
      date: date || A.dayStamp(),
      entries: A.readAudit({ date, limit: q.get('limit') || 200, q: q.get('q') || '' }),
      dates: A.auditDates(),
    });
  }

  if (p === '/api/users' || USER.test(p)) {
    if (!ctx.requireRole('admin')) return true;

    if (p === '/api/users') {
      if (m === 'GET') return ok({ users: A.listUsers(), roles: A.ROLES });
      if (m === 'POST') {
        const b = await ctx.readBody(req);
        const user = await A.addUser(b.name, b.password, b.role ?? 'agent');
        ctx.audit('user.tambah', { name: user.name, role: user.role });
        return ok({ user }, 201);
      }
      return false;
    }

    const name = decodeURIComponent(p.match(USER)[1]);
    if (m === 'PATCH' || m === 'PUT') {
      const b = await ctx.readBody(req);
      if (b.role === undefined && b.password === undefined) return fail(400, 'Isi role dan/atau password');
      if (b.password !== undefined) A.checkPasswordPolicy(b.password); // validasi dulu agar tidak setengah terterap
      if (b.role !== undefined) A.setRole(name, b.role);
      if (b.password !== undefined) await A.setPassword(name, b.password);
      ctx.audit('user.ubah', { name: A.normName(name), role: b.role, passwordDiubah: b.password !== undefined });
      return ok({ user: A.listUsers().find((u) => u.name === A.normName(name)) });
    }
    if (m === 'DELETE') {
      if (A.normName(name) === ctx.user.name) return fail(409, 'Tidak bisa menghapus akun sendiri');
      A.removeUser(name);
      ctx.audit('user.hapus', { name: A.normName(name) });
      return ok();
    }
  }

  return false;
}
