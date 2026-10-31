// Validasi jawaban pelanggan untuk data wajib. Fungsi murni (hanya memakai normalizeText dari fase yang sama).
import { normalizeText } from './bot-intent.js';

/** Nomor telepon: digit saja, awalan 0 -> 62, 8-15 digit; selain itu null. */
export function normPhone(p) {
  let d = String(p ?? '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  return d.length >= 8 && d.length <= 15 ? d : null;
}

const SKIP = new Set(['lewati', 'skip', 'nanti', 'nanti dulu', 'tidak mau', 'gak mau', 'ga mau', 'nggak mau', 'ga usah', 'gak usah', 'nggak usah']);

export function isSkip(text) {
  const t = String(text ?? '').toLowerCase().trim().replace(/[\s.!?,;:]+$/, '').replace(/\s+/g, ' ');
  return SKIP.has(t);
}

const QUESTION_WORDS = new Set(['apa', 'apakah', 'bagaimana', 'gimana', 'berapa', 'dimana', 'kapan', 'bisa', 'boleh', 'ada', 'kenapa', 'mengapa', 'siapa']);

export function isQuestion(text, intentMatched) {
  if (String(text ?? '').includes('?') || intentMatched) return true;
  const tokens = normalizeText(text).split(' ').filter(Boolean);
  if (!tokens.length) return false;
  return QUESTION_WORDS.has(tokens[0]) || (tokens[0] === 'di' && tokens[1] === 'mana');
}

const no = (reason) => ({ ok: false, value: null, reason });
const yes = (value) => ({ ok: true, value, reason: null });

const NAME_PREFIX = /^(nama saya|panggil saja|panggil aja|nama|saya|aku)(?=\s|[:,-]|$)[\s:,-]*/i;
const MONTHS = new Set(['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'agu', 'agt', 'ags', 'agus', 'sep', 'sept', 'okt', 'nov', 'des',
  'january', 'february', 'march', 'may', 'june', 'july', 'august', 'october', 'december', 'aug', 'oct', 'dec']);
const DAYS = new Set(['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu', 'ahad']);

function validName(text) {
  let t = text.trim();
  for (let i = 0; i < 3 && NAME_PREFIX.test(t); i++) t = t.replace(NAME_PREFIX, '');
  t = t.replace(/[\s.,!]+$/, '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 60) return no('Nama harus 2-60 karakter. Boleh tulis nama Anda?');
  if (!/\p{L}/u.test(t)) return no('Nama harus berisi huruf. Boleh tulis nama Anda?');
  if (t.split(' ').length > 6) return no('Nama terlalu panjang. Cukup tulis nama panggilan Anda.');
  if (isQuestion(t, false)) return no('Sepertinya itu pertanyaan. Boleh kami tahu nama Anda dulu?');
  return yes(t);
}

function validDate(t) {
  if (!t) return no('Tanggal belum terbaca. Contoh: besok, Senin, atau 12/5.');
  if (t.length > 100) return no('Jawaban terlalu panjang. Cukup tulis tanggal atau harinya.');
  const low = t.toLowerCase();
  const tokens = normalizeText(low).split(' ');
  const ok =
    tokens.some((w) => MONTHS.has(w) || DAYS.has(w) || w === 'besok' || w === 'lusa') ||
    /hari\s*ini/.test(low) || /jum'?at/.test(low) ||
    /\b\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?\b/.test(low);
  return ok ? yes(t) : no('Tanggal belum terbaca. Contoh: besok, Senin, atau 12/5.');
}

function validChoice(field, t) {
  const opts = (field.options || []).map(String);
  if (!opts.length) return no('Pilihan belum tersedia.');
  const list = `Silakan pilih salah satu: ${opts.map((o, i) => `${i + 1}. ${o}`).join(', ')}.`;
  const num = t.match(/^(\d+)[\s.)]*$/);
  if (num) {
    const n = Number(num[1]);
    return n >= 1 && n <= opts.length ? yes(opts[n - 1]) : no(`Nomor tidak tersedia. ${list}`);
  }
  const low = t.toLowerCase();
  const exact = opts.find((o) => o.toLowerCase() === low);
  if (exact) return yes(exact);
  const contained = opts.filter((o) => low.includes(o.toLowerCase())).sort((a, b) => b.length - a.length);
  if (contained.length) return yes(contained[0]);
  if (low.length >= 3) { // jawaban singkat yang termuat di tepat satu opsi
    const part = opts.filter((o) => o.toLowerCase().includes(low));
    if (part.length === 1) return yes(part[0]);
  }
  return no(list);
}

/** Validasi jawaban sesuai field.type -> {ok, value, reason}. */
export function validateAnswer(field, text) {
  const t = String(text ?? '').trim();
  switch (field?.type) {
    case 'name': return validName(t);
    case 'phone': { const p = normPhone(t); return p ? yes(p) : no('Nomor telepon belum valid. Contoh: 081234567890.'); }
    case 'date': return validDate(t);
    case 'choice': return validChoice(field, t);
    default:
      if (!t) return no('Jawaban tidak boleh kosong.');
      return t.length > 500 ? no('Jawaban terlalu panjang (maksimal 500 karakter).') : yes(t);
  }
}
