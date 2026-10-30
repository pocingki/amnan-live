// Pengaturan bot: nama, pesan, durasi, intent & respons, data wajib CRM.
import { randomBytes } from 'node:crypto';
import { load, save } from './jsonfile.js';

export const DEFAULTS = {
  brandName: 'acesio',
  brandTagline: 'Physiotherapy Rehab & Sport Recovery Rehab',
  botEnabled: true,
  botName: 'Asisten Virtual',
  adminName: 'Admin',
  openingMessage: 'Halo {nama}, selamat datang. Saya {bot}, asisten virtual yang membantu {admin}. Ada yang bisa kami bantu?',
  fallbackMessage: 'Terima kasih, pesan Anda sudah kami terima. {admin} akan segera menindaklanjuti.',
  handoverMessage: 'Percakapan ini dilanjutkan oleh {admin}. Mohon tunggu balasan kami.',
  completionMessage: 'Terima kasih, data Anda sudah kami catat.',
  botDurationMinutes: 0, // 0 = tanpa batas
  intents: [
    { id: 'harga', name: 'Tanya harga', keywords: ['harga', 'biaya', 'tarif'], response: 'Untuk informasi harga, {admin} akan mengirimkan rinciannya. Mohon tunggu sebentar.', active: true },
    { id: 'terima-kasih', name: 'Terima kasih', keywords: ['terima kasih', 'makasih', 'thanks'], response: 'Sama-sama. Kami siap membantu kapan saja.', active: true },
  ],
  requiredFields: [
    { id: 'nama', label: 'Nama', question: 'Boleh kami tahu nama Anda?', enabled: true },
    { id: 'kebutuhan', label: 'Kebutuhan', question: 'Apa kebutuhan atau layanan yang Anda cari?', enabled: true },
  ],
};

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const slug = (s) =>
  str(s, 60).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

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

function clean(p) {
  const o = {};
  for (const [k, max] of [['brandName', 60], ['brandTagline', 100], ['botName', 60], ['adminName', 60]]) if (k in p) o[k] = str(p[k], max) || DEFAULTS[k];
  for (const k of ['openingMessage', 'fallbackMessage', 'handoverMessage', 'completionMessage']) if (k in p) o[k] = str(p[k], 2000);
  if ('botEnabled' in p) o.botEnabled = !!p.botEnabled;
  if ('botDurationMinutes' in p) o.botDurationMinutes = Math.min(10080, Math.max(0, Math.floor(Number(p.botDurationMinutes)) || 0));
  if (Array.isArray(p.intents)) {
    o.intents = uniq(
      p.intents
        .slice(0, 300)
        .map((i) => ({
          id: slug(i.id),
          name: str(i.name, 80),
          response: str(i.response, 2000),
          active: i.active !== false,
          keywords: [...new Set((Array.isArray(i.keywords) ? i.keywords : String(i.keywords ?? '').split(/[,;|\n]/)).map((k) => str(k, 60).toLowerCase()).filter(Boolean))].slice(0, 50),
        }))
        .filter((i) => i.name && i.response)
    );
  }
  if (Array.isArray(p.requiredFields)) {
    o.requiredFields = uniq(
      p.requiredFields
        .slice(0, 20)
        .map((f) => ({ id: slug(f.id), label: str(f.label, 60), question: str(f.question, 500), enabled: f.enabled !== false }))
        .filter((f) => f.label && f.question)
    );
  }
  return o;
}

const saved = load('settings.json', {});
if (saved.brandName === 'Amnan SaaS') delete saved.brandName; // default lama
let cur = { ...DEFAULTS, ...saved };

export const get = () => cur;

export function update(patch) {
  cur = { ...cur, ...clean(patch || {}) };
  save('settings.json', cur);
  return cur;
}