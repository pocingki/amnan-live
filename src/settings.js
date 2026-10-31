// Pengaturan bot: nama, pesan, durasi, intent & respons, data wajib CRM, notifikasi.
// Versi + riwayat (maks 20) untuk deteksi konflik dan pemulihan.
import { randomBytes } from 'node:crypto';
import { load, save } from './jsonfile.js';

const OPENING_LAMA = 'Halo {nama}, selamat datang. Saya {bot}, asisten virtual yang membantu {admin}. Ada yang bisa kami bantu?';
const MASK = '••••';
const HISTORY_MAX = 20;
const FIELD_TYPES = ['text', 'name', 'phone', 'date', 'choice'];

export const DEFAULTS = {
  brandName: 'acesio',
  brandTagline: 'Physiotherapy Rehab & Sport Recovery Rehab',
  botEnabled: true,
  botName: 'Asisten Virtual',
  adminName: 'Admin',
  openingMessage: 'Halo {nama}, selamat datang. Saya {bot}, yang membantu {admin} menjawab pesan Anda. Ada yang bisa kami bantu?',
  fallbackMessage: 'Terima kasih, pesan Anda sudah kami terima. {admin} akan segera menindaklanjuti.',
  handoverMessage: 'Percakapan ini dilanjutkan oleh {admin}. Mohon tunggu balasan kami.',
  completionMessage: 'Terima kasih, data Anda sudah kami catat.',
  botDurationMinutes: 0, // 0 = tanpa batas
  staleMinutes: 10,
  autoTakeoverOnPhoneReply: true,
  adminAutoReturnMinutes: 0, // 0 = mati: tetap mode admin sampai dikembalikan manual
  fallbackCooldownMinutes: 30,
  sendRateLimitPerMinute: 20,
  maxMediaMB: 16,
  retentionDays: 0, // 0 = simpan selamanya
  notify: { webhookUrl: '', telegramBotToken: '', telegramChatId: '', onHot: true, onDisconnected: true, attentionMinutes: 30 },
  slangMap: {},
  intents: [
    { id: 'harga', name: 'Tanya harga', keywords: ['harga', 'biaya', 'tarif'], response: 'Untuk informasi harga, {admin} akan mengirimkan rinciannya. Mohon tunggu sebentar.', active: true, priority: 0 },
    { id: 'terima-kasih', name: 'Terima kasih', keywords: ['terima kasih', 'makasih', 'thanks'], response: 'Sama-sama. Kami siap membantu kapan saja.', active: true, priority: 0 },
    // Contoh nonaktif: isi respons lalu aktifkan.
    { id: 'jadwal', name: 'Jadwal & jam buka', keywords: ['jadwal', 'jam buka', 'jam operasional'], response: '[ISI: jadwal dan jam buka klinik]', active: false, example: true, priority: 0 },
    { id: 'lokasi', name: 'Lokasi', keywords: ['lokasi', 'alamat', 'dimana', 'di mana'], response: '[ISI: alamat dan petunjuk arah klinik]', active: false, example: true, priority: 0 },
    { id: 'layanan', name: 'Layanan', keywords: ['layanan', 'treatment', 'terapi'], response: '[ISI: daftar layanan yang tersedia]', active: false, example: true, priority: 0 },
    { id: 'cara-booking', name: 'Cara booking', keywords: ['booking', 'reservasi', 'daftar', 'janji'], response: '[ISI: langkah membuat janji/booking]', active: false, example: true, priority: 0 },
  ],
  requiredFields: [
    { id: 'nama', label: 'Nama', question: 'Boleh kami tahu nama Anda?', enabled: true, type: 'name', options: [] },
    { id: 'kebutuhan', label: 'Kebutuhan', question: 'Apa kebutuhan atau layanan yang Anda cari?', enabled: true, type: 'text', options: [] },
  ],
  version: 1,
  updatedAt: 0,
  updatedBy: '',
};

const META = new Set(['version', 'updatedAt', 'updatedBy']);
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const clampInt = (v, min, max, def) => {
  let n = Math.floor(Number(v));
  if (!Number.isFinite(n)) n = def;
  return Math.min(max, Math.max(min, n));
};
const slug = (s) =>
  str(s, 60).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const err = (code, message, extra) => Object.assign(new Error(message), { code }, extra);

function uniq(list) {
  const seen = new Set();
  for (const x of list) {
    let id = x.id || slug(x.label || x.name);
    while (!id || seen.has(id)) id = (slug(x.label || x.name) || 'item') + '-' + randomBytes(3).toString('hex');
    x.id = id;
    seen.add(id);
  }
  return list;
}

// ---- validasi URL webhook (anti-SSRF) ----
function ipv6Groups(h) {
  let s = h;
  if (s.includes('.')) {
    const m = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
    if (!m) return null;
    const hex = (a, b) => ((a << 8) | b).toString(16);
    s = m[1] + hex(+m[2], +m[3]) + ':' + hex(+m[4], +m[5]);
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (parts.length === 1 && head.length !== 8)) return null;
  const g = [...head, ...Array(fill).fill('0'), ...tail].map((x) => (/^[0-9a-f]{1,4}$/i.test(x) ? parseInt(x, 16) : NaN));
  return g.length === 8 && g.every((n) => n >= 0) ? g : null;
}

function blockedV6(h) {
  const g = ipv6Groups(h);
  if (!g) return true;
  if (g.slice(0, 6).every((n) => n === 0)) return true; // ::, ::1, IPv4-compatible
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return true; // IPv4-mapped
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64
  return false;
}

function blockedV4(h) {
  const [a, b] = h.split('.').map(Number);
  return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function checkWebhook(v) {
  const raw = str(v, 600);
  if (raw === '') return '';
  const bad = () => err('VALIDATION', 'URL webhook tidak valid: gunakan http(s) ke alamat publik.');
  let u;
  try { u = new URL(raw); } catch { throw bad(); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad();
  if (raw.length > 500) throw bad();
  let host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) {
    if (blockedV6(host.slice(1, -1))) throw bad();
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (blockedV4(host)) throw bad();
  } else if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host) {
    throw bad();
  }
  return raw;
}

// ---- pembersihan input ----
function clean(p, base) {
  const o = {};
  for (const [k, max] of [['brandName', 60], ['brandTagline', 100], ['botName', 60], ['adminName', 60]]) if (k in p) o[k] = str(p[k], max) || DEFAULTS[k];
  for (const k of ['openingMessage', 'fallbackMessage', 'handoverMessage', 'completionMessage']) if (k in p) o[k] = str(p[k], 2000);
  for (const k of ['botEnabled', 'autoTakeoverOnPhoneReply']) if (k in p) o[k] = !!p[k];
  for (const [k, min, max] of [['botDurationMinutes', 0, 10080], ['adminAutoReturnMinutes', 0, 10080], ['staleMinutes', 1, 1440], ['fallbackCooldownMinutes', 0, 1440], ['sendRateLimitPerMinute', 1, 120], ['maxMediaMB', 1, 64], ['retentionDays', 0, 3650]]) {
    if (k in p) o[k] = clampInt(p[k], min, max, DEFAULTS[k]);
  }
  if ('slangMap' in p) {
    const m = {};
    if (p.slangMap && typeof p.slangMap === 'object' && !Array.isArray(p.slangMap)) {
      for (const [a, b] of Object.entries(p.slangMap).slice(0, 200)) {
        const k = str(a, 40).toLowerCase();
        const v = str(b, 40).toLowerCase();
        if (k && v) m[k] = v;
      }
    }
    o.slangMap = m;
  }
  if (p.notify && typeof p.notify === 'object') {
    const n = p.notify;
    const x = { ...base.notify };
    if ('webhookUrl' in n) x.webhookUrl = checkWebhook(n.webhookUrl);
    if ('telegramBotToken' in n) {
      const t = str(n.telegramBotToken, 200);
      if (!t.startsWith(MASK)) x.telegramBotToken = t; // berawalan •••• = tidak diubah
    }
    if ('telegramChatId' in n) x.telegramChatId = str(n.telegramChatId, 64);
    for (const k of ['onHot', 'onDisconnected']) if (k in n) x[k] = !!n[k];
    if ('attentionMinutes' in n) x.attentionMinutes = clampInt(n.attentionMinutes, 1, 1440, DEFAULTS.notify.attentionMinutes);
    o.notify = x;
  }
  if (Array.isArray(p.intents)) {
    o.intents = uniq(
      p.intents
        .slice(0, 300)
        .map((i) => ({
          id: slug(i.id),
          name: str(i.name, 80),
          response: str(i.response, 2000),
          active: i.active !== false,
          priority: clampInt(i.priority, 0, 100, 0),
          ...(i.example === true ? { example: true } : {}),
          keywords: [...new Set((Array.isArray(i.keywords) ? i.keywords : String(i.keywords ?? '').split(/[,;|\n]/)).map((k) => str(k, 60).toLowerCase()).filter(Boolean))].slice(0, 50),
        }))
        .filter((i) => i.name && i.response)
    );
  }
  if (Array.isArray(p.requiredFields)) {
    o.requiredFields = uniq(
      p.requiredFields
        .slice(0, 20)
        .map((f) => {
          const id = slug(f.id);
          const type = FIELD_TYPES.includes(f.type) ? f.type : id === 'nama' ? 'name' : 'text';
          const options = type === 'choice' && Array.isArray(f.options) ? [...new Set(f.options.map((x) => str(x, 60)).filter(Boolean))].slice(0, 20) : [];
          return { id, label: str(f.label, 60), question: str(f.question, 500), enabled: f.enabled !== false, type, options };
        })
        .filter((f) => f.label && f.question)
    );
  }
  return o;
}

// ---- muat + migrasi file lama (tanpa menimpa intents/requiredFields pengguna) ----
function normalize(saved) {
  const s = { ...structuredClone(DEFAULTS), ...saved };
  s.notify = { ...DEFAULTS.notify, ...(saved.notify && typeof saved.notify === 'object' ? saved.notify : {}) };
  s.slangMap = saved.slangMap && typeof saved.slangMap === 'object' ? saved.slangMap : {};
  s.intents = (Array.isArray(s.intents) ? s.intents : []).map((i) => ({ ...i, priority: clampInt(i.priority, 0, 100, 0) }));
  s.requiredFields = (Array.isArray(s.requiredFields) ? s.requiredFields : []).map((f) => ({
    ...f,
    type: FIELD_TYPES.includes(f.type) ? f.type : f.id === 'nama' ? 'name' : 'text',
    options: Array.isArray(f.options) ? f.options : [],
  }));
  s.version = Number.isInteger(saved.version) && saved.version >= 1 ? saved.version : 1;
  return s;
}

const saved = load('settings.json', {});
if (saved.brandName === 'Amnan SaaS') delete saved.brandName; // default lama
if (saved.openingMessage === OPENING_LAMA) delete saved.openingMessage; // teks lama redundan
let cur = normalize(saved);

export const get = () => cur;

const readHistory = () => {
  const h = load('settings.history.json', []);
  return Array.isArray(h) ? h : [];
};

function apply(patch, by) {
  const next = { ...cur, ...clean(patch || {}, cur) }; // galat validasi -> tidak ada perubahan
  const hist = readHistory();
  hist.push({ version: cur.version, ts: cur.updatedAt || Date.now(), by: cur.updatedBy || '', settings: cur });
  save('settings.history.json', hist.slice(-HISTORY_MAX));
  next.version = cur.version + 1;
  next.updatedAt = Date.now();
  next.updatedBy = str(by, 60);
  cur = next;
  save('settings.json', cur);
  return cur;
}

export function update(patch, { expectedVersion = null, by = '' } = {}) {
  if (expectedVersion != null && Number(expectedVersion) !== cur.version) {
    throw err('CONFLICT', 'Pengaturan diubah orang lain.', { current: cur });
  }
  return apply(patch, by);
}

export const history = () => readHistory().map(({ version, ts, by }) => ({ version, ts, by }));

// Terapkan snapshot lama sebagai versi BARU.
export function restore(version, { by = '' } = {}) {
  const h = readHistory().find((x) => x.version === Number(version));
  if (!h) throw err('NOT_FOUND', 'Versi pengaturan tidak ditemukan.');
  const patch = Object.fromEntries(Object.entries(h.settings).filter(([k]) => !META.has(k)));
  return apply(patch, by);
}

// Salinan aman untuk klien: token Telegram dimasking.
export function publicView(S) {
  const v = structuredClone(S);
  const t = v.notify?.telegramBotToken;
  if (v.notify) v.notify.telegramBotToken = t ? MASK + String(t).slice(-4) : '';
  return v;
}
