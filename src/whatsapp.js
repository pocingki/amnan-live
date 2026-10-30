// Koneksi WhatsApp (Baileys): login via QR, dengar pesan masuk, teruskan ke leads.
import fs from 'node:fs';
import path from 'node:path';
import { handleIncoming } from './bot.js';

const AUTH_DIR = path.resolve(process.env.DATA_DIR || 'data', 'auth');

export const wa = {
  status: 'disconnected', // disconnected | connecting | qr | connected
  qr: null, // data URL gambar QR
  number: null,
  error: null,
};

let sock = null;
const seen = new Set(); // id pesan yang sudah diproses (cegah balasan ganda)
let starting = false;
let libs = null;

async function loadLibs() {
  if (libs) return libs;
  const [baileys, qrcode, pino] = await Promise.all([
    import('@whiskeysockets/baileys'),
    import('qrcode'),
    import('pino'),
  ]);
  // Baileys bisa diekspor sebagai CJS atau ESM tergantung versi
  const b = baileys.useMultiFileAuthState ? baileys : baileys.default;
  const makeWASocket = typeof baileys.default === 'function' ? baileys.default : b.default || b.makeWASocket;
  libs = {
    makeWASocket,
    useMultiFileAuthState: b.useMultiFileAuthState,
    DisconnectReason: b.DisconnectReason,
    fetchLatestBaileysVersion: b.fetchLatestBaileysVersion,
    Browsers: b.Browsers,
    QRCode: qrcode.default || qrcode,
    pino: pino.default || pino,
  };
  return libs;
}

function unwrap(message) {
  if (!message) return null;
  return (
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.documentWithCaptionMessage?.message ||
    message
  );
}

function extractText(m) {
  const msg = unwrap(m.message);
  if (!msg) return null;
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.buttonsResponseMessage?.selectedDisplayText ||
    msg.listResponseMessage?.title ||
    '[pesan non-teks]'
  );
}

function handleMessage(m) {
  const key = m.key || {};
  const jid = key.remoteJid || '';
  if (key.fromMe) return;
  if (key.id) {
    if (seen.has(key.id)) return;
    seen.add(key.id);
    if (seen.size > 500) seen.delete(seen.values().next().value);
  }
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;

  const text = extractText(m);
  if (!text) return;

  // Versi baru WhatsApp kadang memakai @lid; nomor asli ada di remoteJidAlt bila tersedia
  const realJid = jid.endsWith('@lid') && key.remoteJidAlt ? key.remoteJidAlt : jid;
  const phone = realJid.split('@')[0].split(':')[0];
  const ts = m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : Date.now();

  handleIncoming({ jid, phone, name: m.pushName || '', text, ts }, sendText).catch((e) => console.error('[bot]', e));
}

export async function start() {
  if (starting) return;
  starting = true;
  try {
    const L = await loadLibs();
    wa.status = 'connecting';
    wa.error = null;

    const { state, saveCreds } = await L.useMultiFileAuthState(AUTH_DIR);
    const { version } = await L.fetchLatestBaileysVersion();

    sock = L.makeWASocket({
      version,
      auth: state,
      logger: L.pino({ level: 'silent' }),
      browser: L.Browsers.macOS('Amnan SaaS'),
      markOnlineOnConnect: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;

      if (qr) {
        wa.qr = await L.QRCode.toDataURL(qr, { width: 300, margin: 1 });
        wa.status = 'qr';
      }

      if (connection === 'open') {
        wa.status = 'connected';
        wa.qr = null;
        wa.number = (sock.user?.id || '').split(':')[0].split('@')[0] || null;
        console.log('[wa] terhubung sebagai', wa.number);
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        wa.qr = null;
        if (code === L.DisconnectReason.loggedOut) {
          console.log('[wa] logout dari HP, sesi dihapus');
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          wa.status = 'disconnected';
          wa.number = null;
          setTimeout(() => start().catch(console.error), 1500);
        } else {
          console.log('[wa] koneksi putus (kode', code + '), mencoba lagi...');
          wa.status = 'connecting';
          setTimeout(() => start().catch(console.error), 2000);
        }
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) {
        try {
          handleMessage(m);
        } catch (err) {
          console.error('[wa] gagal memproses pesan:', err);
        }
      }
    });
  } catch (err) {
    wa.status = 'disconnected';
    wa.error = err.message;
    console.error('[wa] gagal start:', err);
  } finally {
    starting = false;
  }
}

/** Putuskan tautan perangkat dan buat QR baru. */
export async function logout() {
  if (sock && wa.status === 'connected') {
    // Event 'close' (loggedOut) akan menghapus sesi dan memulai ulang untuk QR baru
    try {
      await sock.logout();
      return;
    } catch {
      /* lanjut ke reset manual */
    }
  }
  try {
    sock?.end?.(undefined);
  } catch {
    /* abaikan */
  }
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  wa.status = 'disconnected';
  wa.qr = null;
  wa.number = null;
  setTimeout(() => start().catch(console.error), 1000);
}

export async function sendText(jid, text) {
  if (!sock || wa.status !== 'connected') throw new Error('WhatsApp belum terhubung');
  await sock.sendMessage(jid, { text });
}

export { handleMessage };
