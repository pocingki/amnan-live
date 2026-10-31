// GET /api/events: aliran SSE (Server-Sent Events). Autentikasi cookie sudah dilakukan dispatcher.
import * as events from '../events.js';
import * as C from '../conversations.js';
import * as store from '../store.js';
import * as notifier from '../notifier.js';
import * as retention from '../retention.js';

const HEARTBEAT_MS = 20000;
const MAX_BUFFER = 1024 * 1024; // klien yang terlalu lambat diputus
const clients = new Set();
let bgStarted = false;

/** Buka database, migrasi, lalu jalankan notifier & retensi. Aman dipanggil berulang. */
export function startBackground() {
  if (bgStarted) return;
  bgStarted = true;
  try {
    store.all();
    C.list();
    if (process.env.AMNAN_NO_BG !== '1') {
      notifier.start();
      retention.start();
    }
  } catch (e) {
    bgStarted = false;
    console.error('[events] gagal memulai layanan latar:', e.message);
    throw e;
  }
}

/** Tutup semua koneksi SSE (panggil saat shutdown agar server.close() tidak menggantung). */
export function closeAllClients() {
  for (const c of [...clients]) c.close();
}

export const clientCount = () => clients.size;

export async function handle(req, res, url, ctx) {
  if (url.pathname !== '/api/events') return false;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    ctx.sendJSON(res, 405, { error: 'Metode tidak diizinkan' });
    return true;
  }
  startBackground();
  req.socket?.setTimeout?.(0);
  req.socket?.setNoDelay?.(true);
  req.socket?.setKeepAlive?.(true);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  const write = (s) => {
    if (closed) return;
    try {
      res.write(s);
      if (res.writableLength > MAX_BUFFER) close();
    } catch { close(); }
  };
  const send = (type, payload, id) => write(`${id ? `id: ${id}\n` : ''}event: ${type}\ndata: ${JSON.stringify(payload ?? {})}\n\n`);

  const unsub = events.on('*', (type, payload, id) => send(type, payload, id));
  const hb = setInterval(() => write(': hb\n\n'), HEARTBEAT_MS);
  const client = { close };
  clients.add(client);

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(hb);
    unsub();
    clients.delete(client);
    try { res.end(); } catch { /* sudah tertutup */ }
  }
  req.on('close', close);
  res.on('close', close);
  res.on('error', close);

  write('retry: 3000\n\n');
  const lastId = Number(req.headers['last-event-id']);
  if (lastId > 0) for (const e of events.since(lastId)) send(e.type, e.payload, e.id);
  send('hello', { status: events.last('wa:status') || null, unread: C.totalUnread() });
  return true;
}
