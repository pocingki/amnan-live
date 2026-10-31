// Event bus dalam proses (K6). Tipe: 'wa:status', 'message:new', 'conversation:attention',
// 'lead:new', 'lead:hot', 'unread'. Pendengar yang error tidak pernah mengganggu pemancar.
const handlers = new Map(); // tipe -> Set<fn>; '*' menerima semua: fn(type, payload, id)
const lastByType = new Map();
const ring = []; // riwayat singkat untuk Last-Event-ID (SSE)
const RING_MAX = 100;
let seq = 0;

export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => off(type, fn);
}

export function off(type, fn) {
  handlers.get(type)?.delete(fn);
}

export function emit(type, payload = {}) {
  const id = ++seq;
  lastByType.set(type, payload);
  ring.push({ id, type, payload });
  if (ring.length > RING_MAX) ring.shift();
  for (const key of [type, '*']) {
    for (const fn of [...(handlers.get(key) || [])]) {
      try {
        const r = key === '*' ? fn(type, payload, id) : fn(payload, type, id);
        if (r && typeof r.catch === 'function') r.catch((e) => console.error(`[events] ${type}:`, e?.message || e));
      } catch (e) {
        console.error(`[events] pendengar '${type}' error:`, e?.message || e);
      }
    }
  }
  return id;
}

/** Payload terakhir untuk suatu tipe (mis. status WA saat klien SSE baru tersambung). */
export const last = (type) => lastByType.get(type);

/** Event setelah id tertentu (untuk Last-Event-ID). */
export const since = (id) => ring.filter((e) => e.id > id);

export function _resetForTests() {
  handlers.clear();
  lastByType.clear();
  ring.length = 0;
  seq = 0;
}
