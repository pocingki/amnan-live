// Identitas pengirim WA: JID -> nomor asli / LID. LID TIDAK PERNAH masuk ke phone.
import { load, save } from './jsonfile.js';

const FILE = 'lid-map.json';
const MAX = 5000;
const PHONE_RE = /^\d{8,15}$/;
const PN_SUFFIX = '@s.whatsapp.net';

let map = null; // Map lid -> phone (urutan sisip = urutan umur)
let timer = null;
let exitHooked = false;

export const jidToDigits = (jid) => String(jid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');

function ensure() {
  if (!map) {
    const o = load(FILE, {});
    map = new Map(Object.entries(o && typeof o === 'object' ? o : {}));
  }
  if (!exitHooked) {
    exitHooked = true;
    process.on('exit', () => flushLidMap());
  }
  return map;
}

// Tulis ke disk (dipanggil tertunda agar tidak menulis per entri; juga saat proses keluar).
export function flushLidMap() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!map) return;
  try { save(FILE, Object.fromEntries(map)); } catch (e) { console.error('[wa-identity] gagal simpan lid-map:', e.message); }
}

export function rememberLidPhone(lid, phone) {
  const l = jidToDigits(lid);
  const p = jidToDigits(phone);
  if (!l || !PHONE_RE.test(p)) return;
  const m = ensure();
  if (m.get(l) === p) return;
  m.delete(l); // pindah ke posisi terbaru
  m.set(l, p);
  while (m.size > MAX) m.delete(m.keys().next().value);
  if (!timer) { timer = setTimeout(flushLidMap, 300); timer.unref?.(); }
}

export function lookupLidPhone(lid) {
  const l = jidToDigits(lid);
  return (l && ensure().get(l)) || null;
}

const validPhone = (p) => (PHONE_RE.test(p) ? p : null);

function withTimeout(p, ms) {
  let t;
  const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); });
  return Promise.race([p, to]).finally(() => clearTimeout(t));
}

// key = {remoteJid, remoteJidAlt, participant, participantAlt}; jid = target balasan (remoteJid).
export async function resolveIdentity(key = {}, { lidToPhone, timeoutMs = 2000 } = {}) {
  const jid = String(key?.remoteJid || '');
  if (jid.endsWith(PN_SUFFIX)) return { jid, phone: validPhone(jidToDigits(jid)), lid: null };
  if (!jid.endsWith('@lid')) return { jid, phone: null, lid: null };

  const lid = jidToDigits(jid);
  let phone = null;
  for (const alt of [key.remoteJidAlt, key.participantAlt]) {
    if (typeof alt === 'string' && alt.endsWith(PN_SUFFIX) && validPhone(jidToDigits(alt))) {
      phone = jidToDigits(alt);
      rememberLidPhone(lid, phone);
      break;
    }
  }
  if (!phone) phone = validPhone(lookupLidPhone(lid) || '');
  if (!phone && typeof lidToPhone === 'function') {
    try {
      phone = validPhone(jidToDigits(await withTimeout(Promise.resolve(lidToPhone(lid)), timeoutMs)));
      if (phone) rememberLidPhone(lid, phone);
    } catch { phone = null; }
  }
  return { jid, phone, lid };
}
