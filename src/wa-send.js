// Pengirim WA: antrean FIFO, token bucket, simulasi mengetik, pencatatan waId kirim sistem.
const WAIT_MAX_MS = 60_000; // batas tunggu antrean+rate limit
const ECHO_GRACE_MS = 3_000;
const MAP_MAX = 2000;
const MAP_TTL_MS = 3_600_000;

const fail = (code, message, retryable, cause) => {
  const e = new Error(message);
  e.code = code;
  e.retryable = retryable;
  if (cause) e.cause = cause;
  return e;
};

export function createSender({
  transport,
  getSettings = () => ({}),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  random = Math.random,
  now = Date.now,
} = {}) {
  const sent = new Map(); // waId -> ts
  let tokens = null; // diinisialisasi saat pertama dipakai (penuh)
  let lastRefill = 0;
  let inflight = 0;
  let lastDone = -Infinity;
  let tail = Promise.resolve();

  const rate = () => {
    const r = Math.floor(Number(getSettings()?.sendRateLimitPerMinute));
    return Math.min(120, Math.max(1, Number.isFinite(r) ? r : 20));
  };

  // Ambil 1 token; menunggu bila kosong. Total tunggu sejak antre > 60 dtk -> galat.
  async function acquire(enqueuedAt) {
    for (;;) {
      const r = rate();
      const t = now();
      if (tokens === null) { tokens = r; lastRefill = t; }
      tokens = Math.min(r, tokens + ((t - lastRefill) * r) / 60_000);
      lastRefill = t;
      if (tokens >= 1) { tokens -= 1; return; }
      const wait = Math.ceil(((1 - tokens) * 60_000) / r);
      if (t - enqueuedAt + wait > WAIT_MAX_MS) {
        throw fail('RATE_LIMIT_TIMEOUT', 'Antrean kirim terlalu padat, coba lagi nanti.', true);
      }
      await sleep(wait);
    }
  }

  const notConnected = () => fail('WA_NOT_CONNECTED', 'WhatsApp belum terhubung.', true);

  function remember(waId) {
    const t = now();
    for (const [k, ts] of sent) { if (t - ts > MAP_TTL_MS) sent.delete(k); else break; }
    while (sent.size >= MAP_MAX) sent.delete(sent.keys().next().value);
    sent.delete(waId);
    sent.set(waId, t);
  }

  async function run(jid, text, enqueuedAt) {
    if (!transport.isConnected()) throw notConnected();
    await acquire(enqueuedAt);
    if (!transport.isConnected()) throw notConnected();
    inflight++;
    try {
      await transport.sendPresence(jid, 'composing');
    } catch { /* presence hanya kosmetik */ }
    try {
      if (process.env.BOT_NO_DELAY !== '1') {
        await sleep(800 + Math.min(1700, String(text).length * 15) + Math.floor(random() * 400));
      }
      let res;
      try {
        res = await transport.sendText(jid, text);
      } catch (err) {
        throw fail('SEND_FAILED', 'Gagal mengirim pesan WhatsApp.', err?.retryable ?? true, err);
      }
      if (res?.waId) remember(res.waId);
      lastDone = now();
      return { waId: res?.waId };
    } finally {
      try { await transport.sendPresence(jid, 'paused'); } catch { /* diabaikan */ }
      inflight--;
    }
  }

  return {
    sendText(jid, text) {
      const enq = now();
      const p = tail.then(() => run(jid, text, enq));
      tail = p.catch(() => {});
      return p;
    },
    // Gema pesan kita sendiri bisa tiba SEBELUM waId tercatat (sendText belum selesai),
    // jadi kirim yang sedang berjalan / baru selesai <3 dtk dianggap dari sistem.
    wasSentBySystem(waId) {
      const ts = sent.get(waId);
      if (ts !== undefined) {
        if (now() - ts <= MAP_TTL_MS) return true;
        sent.delete(waId);
      }
      return inflight > 0 || now() - lastDone < ECHO_GRACE_MS;
    },
  };
}
