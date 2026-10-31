// Koneksi WhatsApp: mesin status + reconnect (createConnection) dan adapter Baileys (BaileysAdapter).
import fs from 'node:fs';
import path from 'node:path';

const authDir = () => path.resolve(process.env.DATA_DIR || 'data', 'auth');
const digits = (s) => String(s || '').split('@')[0].split(':')[0].replace(/\D/g, '') || null;
const log = (...a) => console.error('[wa]', ...a);

export function createConnection({
  adapterFactory = () => new BaileysAdapter(),
  onStatus, onMessages, onReceipts,
  schedule = setTimeout, clear = clearTimeout, random = Math.random, now = Date.now,
} = {}) {
  const wa = { status: 'disconnected', qr: null, number: null, error: null, since: now(), reconnectAttempts: 0 };
  let state = 'idle'; // idle | connecting | qr | open | closing
  let cur = null; // adapter aktif
  let timer = null; // SATU timer (reconnect / start ulang)
  let epoch = 0; // naik tiap stop(): membatalkan operasi async yang tertunda
  let lastKey = '';

  const derive = () =>
    state === 'open' ? 'connected' : state === 'qr' ? 'qr' : state === 'connecting' || timer ? 'connecting' : 'disconnected';

  function emit() {
    const s = derive();
    if (s !== wa.status) { wa.status = s; wa.since = now(); }
    const key = [wa.status, wa.qr, wa.number, wa.error, wa.reconnectAttempts].join('|');
    if (key === lastKey) return;
    lastKey = key;
    try { onStatus?.(wa); } catch (e) { log('onStatus gagal:', e); }
  }
  const clearTimer = () => { if (timer != null) { clear(timer); timer = null; } };
  const arm = (ms, fn) => {
    clearTimer();
    timer = schedule(() => { timer = null; emit(); Promise.resolve().then(fn).catch((e) => log('timer gagal:', e)); }, ms);
    emit();
  };
  const reconnectLater = () => {
    const ms = Math.min(60000, 2000 * 2 ** wa.reconnectAttempts) + random() * 1000;
    wa.reconnectAttempts++;
    arm(ms, start);
  };
  const discard = async (a) => { try { await a?.stop(); } catch { /* abaikan */ } };

  // Lepas adapter: event-nya diabaikan, socket di-stop. false bila dibatalkan stop().
  async function drop(a, { clearAuth = false } = {}) {
    const ep = epoch;
    if (cur === a) cur = null;
    state = 'closing'; wa.qr = null; emit();
    await discard(a);
    if (clearAuth) { try { await a.clearAuth(); } catch (e) { log('clearAuth gagal:', e); } }
    if (ep !== epoch) return false;
    state = 'idle'; emit();
    return true;
  }

  const safe = (fn) => {
    try { const r = fn(); if (r && typeof r.catch === 'function') r.catch((e) => log('handler gagal:', e)); }
    catch (e) { log('handler gagal:', e); }
  };

  function handlers(a) {
    const live = (fn) => (...args) => { if (cur === a) safe(() => fn(...args)); };
    return {
      onQr: live((qr) => { state = 'qr'; wa.qr = qr; emit(); }),
      onOpen: live((number) => {
        clearTimer(); state = 'open'; wa.qr = null; wa.number = number || null; wa.error = null; wa.reconnectAttempts = 0; emit();
      }),
      onClose: live((info = {}) => onClose(a, info)),
      onMessages: live((raws) => onMessages?.(raws)),
      onReceipts: live((list) => onReceipts?.(list)),
    };
  }

  async function onClose(a, { loggedOut, restartRequired, replaced } = {}) {
    if (loggedOut) {
      wa.number = null;
      if (await drop(a, { clearAuth: true })) arm(1500, start); // QR baru
    } else if (restartRequired) {
      if (await drop(a)) await start(); // segera, tanpa backoff
    } else if (replaced) {
      wa.error = 'Sesi dipakai perangkat lain. Hubungkan ulang secara manual.';
      clearTimer();
      await drop(a);
    } else if (await drop(a)) reconnectLater();
  }

  async function start() {
    if (state !== 'idle') return;
    clearTimer();
    state = 'connecting'; wa.error = null; emit();
    const ep = epoch;
    const old = cur; cur = null;
    if (old) await discard(old); // socket lama selalu di-stop dulu
    if (ep !== epoch) return;
    let a;
    try {
      a = adapterFactory();
      cur = a;
      await a.connect(handlers(a));
    } catch (e) {
      if (ep !== epoch || (a && cur !== a)) return;
      wa.error = e?.message || String(e);
      log('gagal connect:', wa.error);
      if (a ? await drop(a) : ((state = 'idle'), true)) reconnectLater();
    }
  }

  async function stop() {
    epoch++;
    clearTimer();
    const a = cur; cur = null;
    state = 'closing'; wa.qr = null; emit();
    await discard(a);
    state = 'idle'; emit();
  }

  async function logout() {
    const a = cur;
    if (state === 'open' && a) {
      try { await a.logout(); return; } // onClose(loggedOut) yang memulai ulang
      catch (e) { log('logout gagal:', e); }
    }
    epoch++;
    clearTimer();
    cur = null;
    state = 'closing'; emit();
    const target = a || (() => { try { return adapterFactory(); } catch { return null; } })();
    await discard(a);
    try { await target?.clearAuth(); } catch (e) { log('clearAuth gagal:', e); }
    wa.qr = null; wa.number = null; state = 'idle';
    arm(1000, start);
  }

  return { wa, start, stop, logout, adapter: () => cur };
}

// ---------- Adapter Baileys ----------
let libs = null;
async function loadLibs() {
  if (libs) return libs;
  const [baileys, qrcode, pino] = await Promise.all([import('@whiskeysockets/baileys'), import('qrcode'), import('pino')]);
  const b = baileys.useMultiFileAuthState ? baileys : baileys.default; // CJS atau ESM
  libs = {
    makeWASocket: typeof baileys.default === 'function' ? baileys.default : b.default || b.makeWASocket,
    useMultiFileAuthState: b.useMultiFileAuthState,
    DisconnectReason: b.DisconnectReason,
    fetchLatestBaileysVersion: b.fetchLatestBaileysVersion,
    downloadMediaMessage: b.downloadMediaMessage,
    Browsers: b.Browsers,
    QRCode: qrcode.default || qrcode,
    pino: pino.default || pino,
  };
  return libs;
}

// status Baileys (proto) -> status kontrak
const STATUS = { 0: 'failed', 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read' };

export class BaileysAdapter {
  constructor() { this.sock = null; this.connected = false; }

  async connect(h) {
    const L = await loadLibs();
    const dir = authDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await L.useMultiFileAuthState(dir);
    let version;
    try { ({ version } = await L.fetchLatestBaileysVersion()); } catch { /* pakai versi bawaan library */ }
    const sock = L.makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: L.pino({ level: 'silent' }),
      browser: L.Browsers.macOS('Amnan SaaS'),
      markOnlineOnConnect: false,
    });
    this.sock = sock;
    const mine = (fn) => (...a) => { if (this.sock === sock) fn(...a); };

    sock.ev.on('creds.update', () => { Promise.resolve(saveCreds()).catch((e) => log('saveCreds gagal:', e)); });

    sock.ev.on('connection.update', mine(async (u) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        try { h.onQr(await L.QRCode.toDataURL(qr, { width: 300, margin: 1 })); }
        catch (e) { log('QR gagal dibuat:', e); }
      }
      if (connection === 'open') {
        this.connected = true;
        h.onOpen(digits(sock.user?.id));
      }
      if (connection === 'close') {
        this.connected = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        h.onClose({
          code,
          loggedOut: code === L.DisconnectReason.loggedOut,
          restartRequired: code === L.DisconnectReason.restartRequired,
          replaced: code === L.DisconnectReason.connectionReplaced,
        });
      }
    }));

    sock.ev.on('messages.upsert', mine(({ messages, type }) => {
      if (type === 'notify' && messages?.length) h.onMessages(messages);
    }));

    const receipts = (list) => { if (list.length) h.onReceipts(list); };
    sock.ev.on('messages.update', mine((updates) => {
      const out = [];
      for (const u of updates || []) {
        const st = STATUS[u?.update?.status];
        if (u?.key?.fromMe && u.key.id && st) out.push({ waId: u.key.id, status: st });
      }
      receipts(out);
    }));
    sock.ev.on('message-receipt.update', mine((updates) => {
      const out = [];
      for (const u of updates || []) {
        const st = u?.receipt?.readTimestamp ? 'read' : u?.receipt?.receiptTimestamp ? 'delivered' : null;
        if (u?.key?.fromMe && u.key.id && st) out.push({ waId: u.key.id, status: st });
      }
      receipts(out);
    }));
  }

  async sendText(jid, text) {
    const res = await this.sock.sendMessage(jid, { text });
    return { waId: res?.key?.id };
  }
  async sendPresence(jid, state) { await this.sock.sendPresenceUpdate(state, jid); }
  async downloadMedia(raw) { return (await loadLibs()).downloadMediaMessage(raw, 'buffer', {}); }
  async lidToPhone(lid) {
    try {
      const id = String(lid).includes('@') ? String(lid) : lid + '@lid';
      return digits(await this.sock?.signalRepository?.lidMapping?.getPNForLID?.(id));
    } catch { return null; }
  }
  async logout() { await this.sock.logout(); }
  async clearAuth() { fs.rmSync(authDir(), { recursive: true, force: true }); }
  async stop() {
    const s = this.sock;
    this.sock = null; this.connected = false;
    try { s?.end(undefined); } catch { /* abaikan */ }
  }
  isConnected() { return this.connected; }
}
