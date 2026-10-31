// Parser pesan Baileys -> {kind,text,caption,hasMedia,mime,fileName,source} (kontrak D1/D5).
const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];
const SYSTEM_KEYS = new Set(['protocolMessage', 'editedMessage', 'senderKeyDistributionMessage', 'pollUpdateMessage', 'messageContextInfo']);
const MEDIA_LABEL = { image: '[Gambar]', video: '[Video]', audio: '[Pesan suara]', sticker: '[Stiker]', document: '[Dokumen]' };
const MEDIA_KEY = { image: 'imageMessage', video: 'videoMessage', audio: 'audioMessage', sticker: 'stickerMessage', document: 'documentMessage' };
const REF_RE = /\[(?:kode:\s*)?([A-Za-z0-9_-]{2,20})\]/i;

// Buka bungkus berlapis (maks 5 tingkat). editedMessage sengaja tidak dibuka (dianggap system).
export function unwrap(message) {
  let m = message || null;
  for (let i = 0; i < 5 && m; i++) {
    const w = WRAPPERS.find((k) => m[k]?.message);
    if (!w) break;
    m = m[w].message;
  }
  return m;
}

const s = (v) => (v == null ? '' : String(v));

function sourceOf(content, plain) {
  const ci = content?.contextInfo || {};
  const ad = ci.externalAdReply || {};
  // Cari kode di teks/caption asli (bukan label "[Gambar]" yang cocok dengan pola)
  const ref = REF_RE.exec(plain || '');
  return {
    platform: '', // dipetakan oleh A2
    adId: s(ad.sourceId),
    ctwaClid: s(ad.ctwaClid || ci.ctwaClid),
    sourceUrl: s(ad.sourceUrl),
    referralCode: ref ? ref[1].toUpperCase() : '',
  };
}

const base = (kind, text, extra = {}) => ({ kind, text, caption: '', hasMedia: false, mime: '', fileName: '', source: sourceOf(null, ''), ...extra });

export function extractMessage(raw) {
  const m = unwrap(raw?.message);
  if (!m || typeof m !== 'object') return base('system', '');

  // 1. teks
  let plain = null;
  if (typeof m.conversation === 'string') plain = m.conversation;
  else if (m.extendedTextMessage) plain = s(m.extendedTextMessage.text);
  else if (m.buttonsResponseMessage) plain = s(m.buttonsResponseMessage.selectedDisplayText);
  else if (m.listResponseMessage) plain = s(m.listResponseMessage.title);
  else if (m.templateButtonReplyMessage) plain = s(m.templateButtonReplyMessage.selectedDisplayText);
  if (plain !== null) {
    const content = m.extendedTextMessage || m.buttonsResponseMessage || m.listResponseMessage || m.templateButtonReplyMessage;
    return base('text', plain, { source: sourceOf(content, plain) });
  }

  // 2. media
  for (const [kind, key] of Object.entries(MEDIA_KEY)) {
    const c = m[key];
    if (!c) continue;
    const caption = s(c.caption);
    const fileName = kind === 'document' ? s(c.fileName) : '';
    const text = MEDIA_LABEL[kind] + (fileName ? ' ' + fileName : '') + (caption ? ' ' + caption : '');
    return { kind, text, caption, hasMedia: true, mime: s(c.mimetype), fileName, source: sourceOf(c, caption) };
  }

  // 3. lokasi, kontak, reaksi
  if (m.locationMessage || m.liveLocationMessage) {
    return base('location', '[Lokasi]', { source: sourceOf(m.locationMessage || m.liveLocationMessage, '') });
  }
  if (m.contactMessage || m.contactsArrayMessage) {
    return base('contact', '[Kontak]', { source: sourceOf(m.contactMessage || m.contactsArrayMessage, '') });
  }
  if (m.reactionMessage) return base('reaction', '');

  // 4. system (pesan protokol/edit/kunci grup/hanya konteks) atau tipe tak dikenal
  const rest = Object.keys(m).filter((k) => !SYSTEM_KEYS.has(k));
  if (rest.length === 0) return base('system', '');
  // Dianggap media (bukan jawaban); tanpa berkas yang bisa diunduh
  return base('document', '[Pesan tidak didukung]');
}
