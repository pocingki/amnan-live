// Fasad WhatsApp: merangkai koneksi, pengirim, ekstraksi pesan, identitas, media, dan bot.
// Membuat instans TIDAK memulai koneksi dan tidak memuat Baileys (dimuat lazy di BaileysAdapter).
import { createConnection as realCreateConnection } from './wa-connection.js';
import * as waSend from './wa-send.js';
import * as waMessage from './wa-message.js';
import * as waIdentity from './wa-identity.js';
import * as mediaMod from './media.js';
import * as convsMod from './conversations.js';
import * as settingsMod from './settings.js';
import * as botMod from './bot.js';
import * as eventsMod from './events.js';

const IGNORED_JID = /@(g\.us|broadcast|newsletter)$/;

const withTimeout = (promise, ms, label) => {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
};

export function createWhatsApp(deps = {}) {
  const createConnection = deps.createConnection || realCreateConnection;
  const extractMessage = deps.extractMessage || ((r) => waMessage.extractMessage(r));
  const resolveIdentity = deps.resolveIdentity || ((k, o) => waIdentity.resolveIdentity(k, o));
  const saveMedia = deps.saveMedia || ((b, o) => mediaMod.saveMedia(b, o));
  const convs = deps.convs || { seenMessage: (id) => convsMod.seenMessage(id), markSeen: (id) => convsMod.markSeen(id) };
  const handleIncoming = deps.handleIncoming || ((m, s) => botMod.handleIncoming(m, s));
  const onStatusUpdate = deps.onStatusUpdate || ((u) => botMod.onStatusUpdate(u));
  const emit = deps.emit || ((t, p) => eventsMod.emit(t, p));
  const now = deps.now || Date.now;
  const mediaTimeoutMs = deps.mediaTimeoutMs ?? 20000;

  const connection =
    deps.connection ||
    createConnection({
      onStatus: (w) => emit('wa:status', { status: w.status, number: w.number }),
      onMessages: async (raws) => { for (const r of raws || []) await handleMessage(r); }, // berurutan
      onReceipts: (list) => {
        for (const u of list || []) {
          try { Promise.resolve(onStatusUpdate(u)).catch((e) => console.error('[wa] receipt gagal:', e)); }
          catch (e) { console.error('[wa] receipt gagal:', e); }
        }
      },
    });

  const getAdapter = () => connection.adapter();

  const sender =
    deps.sender ||
    waSend.createSender({
      transport: {
        sendText: (j, t) => connection.adapter().sendText(j, t),
        sendPresence: (j, s) => connection.adapter().sendPresence(j, s),
        isConnected: () => connection.wa.status === 'connected',
      },
      getSettings: () => settingsMod.get(),
    });

  const sendText = (jid, text) => sender.sendText(jid, text);

  async function handleMessage(raw) {
    try {
      const key = raw?.key || {};
      const rjid = key.remoteJid || '';
      if (!rjid || IGNORED_JID.test(rjid)) return; // grup, broadcast, status, newsletter
      const waId = key.id || null;
      const fromMe = !!key.fromMe;
      if (fromMe && waId && sender.wasSentBySystem(waId)) return; // gema pesan sistem
      if (waId) {
        if (convs.seenMessage(waId)) return;
        convs.markSeen(waId);
      }

      const ext = extractMessage(raw);
      if (!ext) return;
      if (fromMe && (ext.kind === 'reaction' || ext.kind === 'system')) return;

      const id = await resolveIdentity(
        { remoteJid: key.remoteJid, remoteJidAlt: key.remoteJidAlt, participant: key.participant, participantAlt: key.participantAlt },
        { lidToPhone: (l) => getAdapter()?.lidToPhone(l) },
      );
      const sec = Number(raw.messageTimestamp);
      const ts = sec > 0 ? sec * 1000 : now();

      let mediaId = null;
      let mediaError = null;
      if (ext.hasMedia) {
        try {
          const buf = await withTimeout(Promise.resolve().then(() => getAdapter().downloadMedia(raw)), mediaTimeoutMs, 'Unduh media melewati batas waktu');
          ({ mediaId } = await saveMedia(buf, { mime: ext.mime, kind: ext.kind, name: ext.fileName }));
        } catch (e) {
          mediaId = null;
          mediaError = e?.message || String(e);
        }
      }

      if (ext.kind === 'text' && !String(ext.text || '').trim()) return;

      const envelope = {
        waId,
        jid: id.jid || rjid,
        phone: id.phone || null,
        lid: id.lid || null,
        name: raw.pushName || '',
        ts,
        kind: ext.kind,
        text: ext.text || '',
        caption: ext.caption || '',
        mediaId,
        mediaError,
        fromMe,
        fromPhone: fromMe,
        source: { platform: '', adId: '', ctwaClid: '', sourceUrl: '', referralCode: '', ...(ext.source || {}) },
      };
      await Promise.resolve(handleIncoming(envelope, sendText)).catch((e) => console.error('[bot]', e));
    } catch (err) {
      console.error('[wa] gagal memproses pesan:', err);
    }
  }

  return {
    wa: connection.wa,
    start: () => connection.start(),
    stop: () => connection.stop(),
    logout: () => connection.logout(),
    sendText,
    handleMessage,
    getAdapter,
  };
}

const inst = createWhatsApp();
export const { wa, start, stop, logout, sendText, handleMessage, getAdapter } = inst;
