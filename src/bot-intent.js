// NLU ringan untuk bot: normalisasi teks (slang, huruf berulang) dan pencocokan intent. Fungsi murni.

const DEFAULT_SLANG = {
  hrg: 'harga', brp: 'berapa', tlg: 'tolong',
  gk: 'tidak', ga: 'tidak', gak: 'tidak', nggak: 'tidak', ngga: 'tidak', tdk: 'tidak',
  udh: 'sudah', sdh: 'sudah', udah: 'sudah', bsk: 'besok', jd: 'jadi',
  gmn: 'bagaimana', bgmn: 'bagaimana', dmn: 'dimana', knp: 'kenapa',
  yg: 'yang', dgn: 'dengan', utk: 'untuk', kpn: 'kapan',
  trims: 'terima kasih', tks: 'terima kasih', thx: 'thanks',
};

const base = (text) =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // buang aksen
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])\1{2,}/g, '$1') // "hargaaa" -> "harga"; "aa" tetap
    .trim();

/** Normalisasi: huruf kecil, tanpa aksen/tanda baca, huruf berulang dipadatkan, slang diganti. */
export function normalizeText(text, slangMap = {}) {
  const slang = { ...DEFAULT_SLANG };
  for (const [k, v] of Object.entries(slangMap || {})) {
    const key = base(k);
    if (key) slang[key] = String(v ?? '').toLowerCase().trim(); // slangMap menang
  }
  return base(text)
    .split(' ')
    .filter(Boolean)
    .map((t) => (Object.hasOwn(slang, t) ? slang[t] : t))
    .filter(Boolean)
    .join(' ');
}

const PREFIX = ['', 'di', 'me', 'mem', 'men', 'meng', 'ber', 'ter', 'pe', 'pem', 'pen', 'se'];
const SUFFIX = ['', 'nya', 'kah', 'lah', 'an', 'ku', 'mu', 'pun'];

// Token t cocok dengan kata dasar k: persis, atau [awalan]+k+[akhiran].
const stemMatch = (t, k) => {
  if (t === k) return true;
  if (t.length <= k.length) return false;
  return PREFIX.some((p) => SUFFIX.some((s) => t === p + k + s));
};

// Kata kunci cocok bila: 1 kata >=4 huruf -> stemMatch; selain itu token persis berurutan.
function keywordMatches(tokens, kw) {
  const words = kw.split(' ');
  if (words.length === 1 && words[0].length >= 4) return tokens.some((t) => stemMatch(t, words[0]));
  for (let i = 0; i + words.length <= tokens.length; i++) {
    if (words.every((w, j) => tokens[i + j] === w)) return true;
  }
  return false;
}

/** Intent terbaik: skor (jumlah kata kunci cocok) tertinggi, lalu priority, lalu urutan awal. */
export function matchIntent(text, intents, slangMap = {}) {
  const tokens = normalizeText(text, slangMap).split(' ').filter(Boolean);
  if (!tokens.length || !Array.isArray(intents)) return null;
  let best = null;
  let bestScore = 0;
  for (const intent of intents) {
    if (!intent || intent.active === false || !Array.isArray(intent.keywords)) continue;
    let score = 0;
    for (const k of intent.keywords) {
      const kw = normalizeText(k, slangMap);
      if (kw && keywordMatches(tokens, kw)) score++;
    }
    if (!score) continue;
    const pr = Number(intent.priority) || 0;
    if (score > bestScore || (score === bestScore && pr > (Number(best.priority) || 0))) {
      best = intent;
      bestScore = score;
    }
  }
  return best;
}
