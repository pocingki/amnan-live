// API status & logout WhatsApp.
import { wa as defaultWa, logout as defaultLogout } from '../whatsapp.js';
import * as C from '../conversations.js';

// Pabrik supaya mudah diuji dengan dependensi palsu.
export function makeHandle({ wa, logout, unread }) {
  return async function handle(req, res, url, ctx) {
    const p = url.pathname;
    if (req.method === 'GET' && p === '/api/wa/status') {
      const off = process.env.DISABLE_WA === '1';
      ctx.sendJSON(res, 200, {
        status: off ? 'disabled' : wa.status,
        qr: !off && ctx.user?.role === 'admin' ? wa.qr : null, // QR hanya untuk admin, dan hanya bila soket hidup
        number: off ? null : wa.number,
        error: off ? null : wa.error,
        unread: unread(),
        since: off ? null : wa.since,
        reconnectAttempts: off ? 0 : wa.reconnectAttempts,
      });
      return true;
    }
    if (req.method === 'POST' && p === '/api/wa/logout') {
      if (!ctx.requireRole('admin')) return true;
      try {
        await logout();
        ctx.audit('wa.logout');
        ctx.sendJSON(res, 200, { ok: true });
      } catch (e) {
        ctx.sendJSON(res, 500, { error: 'Gagal logout WhatsApp' });
      }
      return true;
    }
    return false;
  };
}

export const handle = makeHandle({ wa: defaultWa, logout: defaultLogout, unread: () => C.totalUnread() });
