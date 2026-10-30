// Deteksi lead + penentuan OTOMATIS Status Lead dan Data Leads dari isi chat.
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';

const CONFIG_FILE = process.env.KEYWORDS_FILE || path.resolve('config/keywords.json');

// Semua nilai ini bisa ditimpa lewat config/keywords.json: hotKeywords, warmAfterMessages, transactionGapHours
const DEFAULT_HOT = [
  'booking', 'booked', 'book', 'boking', 'deal', 'fix', 'setuju', 'oke deal', 'jadi ambil', 'ambil paket', 'checkout', 'order sekarang', 'pesan sekarang',
  'transfer', 'tf', 'trf', 'sudah transfer', 'sudah tf', 'bukti transfer', 'bukti bayar', 'bukti pembayaran', 'kirim bukti', 'struk', 'kwitansi',
  'bayar', 'sudah bayar', 'bayar di tempat', 'pembayaran', 'konfirmasi pembayaran', 'konfirmasi', 'dp', 'sudah dp', 'down payment', 'uang muka',
  'lunas', 'pelunasan', 'cicilan', 'invoice', 'tagihan', 'rekening', 'no rekening', 'norek', 'virtual account', 'va', 'qris', 'gopay', 'ovo', 'shopeepay',
  'cash', 'tunai', 'cod', 'reservasi', 'jadwalkan', 'mau daftar', 'daftar sekarang', 'sudah daftar',
];
const DEFAULT_WARM_AFTER = 10; // Warm jika pesan customer LEBIH dari angka ini
const DEFAULT_TX_GAP_H = 24; // sinyal transaksi berikutnya dihitung transaksi baru jika berjarak >= jam ini
const R = {
  cold: 'Pesan masuk pertama kali dari nomor ini (sama dengan pesan pembuka bot)',
  warm: (n) => `Percakapan lebih dari 10 pesan (${n} pesan dari customer)`,
  hot: (w) => `Ada sinyal transaksi/booking: ${w.join(', ')}`,
  hotExisting: 'Customer lama (sudah pernah transaksi lebih dari sekali)',
  new: 'Pesan masuk pertama kali dari nomor ini',
  existing: (n) => `Customer pernah booking/transfer dan melakukannya lagi (transaksi ke-${n})`,
};
// Kata negasi tepat sebelum keyword ("belum transfer", "tidak jadi booking") membatalkan sinyal Hot
const NEG = /(?:^|[^\p{L}\p{N}])(?:belum|blm|tidak|tdk|nggak|ngga|gak|ga|bukan|batal|jangan|tanpa)\s+(?:\S+\s+)?$/iu;

export const getConfig = () => JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function hasWord(text, word) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

/** Cari platform (sumber) dan keyword yang cocok dari teks pesan. */
export function detect(text, config = getConfig()) {
  const matched = [];
  let platform = config.defaultPlatform || 'Lainnya';
  let platformFound = false;

  for (const [name, words] of Object.entries(config.platforms || {})) {
    const hit = words.find((w) => hasWord(text, w));
    if (hit) {
      matched.push(hit);
      if (!platformFound) {
        platform = name;
        platformFound = true;
      }
    }
  }
  const platformKeywords = matched.length;
  for (const w of config.triggers || []) {
    if (hasWord(text, w)) matched.push(w);
  }
  return {
    platform,
    platformFound,
    triggerFound: matched.length > platformKeywords,
    keywords: [...new Set(matched.map((m) => m.toLowerCase()))],
  };
}

/**
 * Aturan kapan sebuah chat dihitung sebagai lead (config.leadRule):
 *  - "platform" (default): hanya jika ada kata kunci platform (mis. Instagram, FB, TikTok)
 *  - "keyword": jika ada kata kunci platform ATAU kata kunci trigger (harga, order, ...)
 *  - "all": semua chat dari nomor baru
 */
export function qualifies(result, rule = 'platform') {
  if (rule === 'all') return true;
  if (rule === 'keyword') return result.platformFound || result.triggerFound;
  return result.platformFound;
}

/** Kata Hot yang cocok. Kata tunggal >= 5 huruf menerima imbuhan umum (pembayarannya, ditransfer, pelunasan). */
export function hotMatches(text, words) {
  const out = [];
  for (const w of words) {
    const core = escapeRe(w);
    const stem = w.length >= 5 && !/\s/.test(w);
    const body = stem ? `(?:di|me|mem|men|meng|ber|ter|ke|se|pe|pem|pen)?${core}(?:nya|an|kan|i|lah|kah)?` : core;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${body})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    for (const m of text.matchAll(re)) {
      const at = m.index + m[1].length;
      if (!NEG.test(text.slice(Math.max(0, at - 25), at))) { out.push(w.toLowerCase()); break; }
    }
  }
  return out;
}

/**
 * Inti logika otomatis (dipakai SAMA PERSIS oleh WhatsApp asli dan Bot Tester).
 * Menerima lead sebelumnya (atau null) dan satu pesan customer baru, mengembalikan lead terbaru + daftar perubahan.
 * Tidak menyentuh penyimpanan. customerCount = jumlah pesan customer pada percakapan (termasuk pesan ini).
 *
 * STATUS LEAD (hanya naik, tidak turun otomatis)
 *  - Cold : pesan masuk PERTAMA KALI dari nomor itu (momen yang sama dengan pesan pembuka bot), dan memuat keyword platform.
 *           Chat berikutnya dari nomor yang tidak jadi lead di pesan pertama tidak membuat lead.
 *  - Warm : percakapan lebih dari warmAfterMessages (default 10) pesan customer.
 *  - Hot  : ada transaksi/booking/transfer dst (hotKeywords), atau sudah Existing.
 * DATA LEADS
 *  - New      : pesan masuk pertama kali.
 *  - Existing : customer yang pernah transaksi lalu transaksi untuk kedua kalinya. Transaksi baru dihitung
 *               bila sinyal transaksi muncul >= transactionGapHours (default 24 jam) setelah sinyal sebelumnya,
 *               supaya beberapa pesan dalam satu transaksi ("transfer ya", "ini buktinya") tidak dihitung dua kali. Permanen.
 * Nilai yang diubah manual (statusManual / dataTypeManual) tidak ditimpa sistem.
 */
export function classify(prev, { text, phone = '', name = '', ts = Date.now(), customerCount = 1 }, config = getConfig()) {
  const det = detect(text, config);
  const hot = hotMatches(text, config.hotKeywords || DEFAULT_HOT);
  const keywords = [...new Set([...det.keywords, ...hot])];
  const warmAfter = config.warmAfterMessages ?? DEFAULT_WARM_AFTER;
  const gapMs = (config.transactionGapHours ?? DEFAULT_TX_GAP_H) * 3600000;

  if (!prev) {
    // hanya pesan pertama kali masuk yang bisa menjadi lead
    if (customerCount > 1 || !qualifies(det, config.leadRule)) return { created: false, ignored: true, lead: null, changes: [] };
    const status = hot.length ? 'Hot Leads' : 'Cold Leads';
    const lead = {
      phone, name, platform: det.platform, keyword: keywords.join(', '), firstMessage: text,
      status, statusReason: hot.length ? R.hot(hot) : R.cold,
      dataType: 'New', dataReason: R.new,
      transactionCount: hot.length ? 1 : 0, lastTransactionAt: hot.length ? ts : null,
      messageCount: 1, createdAt: ts, lastMessageAt: ts,
    };
    return { created: true, ignored: false, lead, changes: [`Lead baru (sumber ${det.platform})`, `Status: ${status}`, 'Data Leads: New'] };
  }

  const lead = { ...prev };
  const changes = [];
  const count = Math.max((prev.messageCount || 1) + 1, customerCount);

  // hitung transaksi (lead lama berstatus Hot dianggap sudah 1 transaksi)
  let tx = prev.transactionCount ?? (prev.status === 'Hot Leads' ? 1 : 0);
  let lastTx = prev.lastTransactionAt ?? (tx ? prev.lastMessageAt || prev.createdAt : null);
  if (hot.length) {
    if (tx === 0 || ts - lastTx >= gapMs) tx += 1;
    lastTx = ts;
  }
  lead.transactionCount = tx;
  lead.lastTransactionAt = lastTx;

  if (!prev.dataTypeManual && prev.dataType !== 'Existing' && tx >= 2) {
    lead.dataType = 'Existing';
    lead.dataReason = R.existing(tx);
    changes.push('Data Leads: Existing');
  }

  if (!prev.statusManual && prev.status !== 'Hot Leads') {
    if (hot.length) {
      lead.status = 'Hot Leads';
      lead.statusReason = R.hot(hot);
    } else if (lead.dataType === 'Existing') {
      lead.status = 'Hot Leads';
      lead.statusReason = R.hotExisting;
    } else if (prev.status === 'Cold Leads' && count > warmAfter) {
      lead.status = 'Warm Leads';
      lead.statusReason = R.warm(count);
    }
    if (lead.status !== prev.status) changes.push(`Status: ${lead.status}`);
  }

  lead.keyword = [...new Set([...(prev.keyword ? prev.keyword.split(', ') : []), ...keywords])].join(', ');
  if (det.platformFound && (!prev.platform || prev.platform === 'Lainnya')) lead.platform = det.platform;
  if (name && !lead.name) lead.name = name;
  lead.messageCount = count;
  lead.lastMessageAt = ts;
  return { created: false, ignored: false, lead, changes };
}

/** Dipanggil untuk setiap pesan pribadi yang masuk dari WhatsApp asli. */
export function ingest({ phone, name, text, ts = Date.now(), customerCount }) {
  const existing = store.findByPhone(phone);
  const r = classify(existing, { text, phone, name, ts, customerCount });
  if (r.ignored) return r;
  if (r.created) return { ...r, lead: store.add(r.lead) };
  const { id, ...rest } = r.lead;
  return { ...r, lead: store.update(existing.id, rest) };
}

export function platformNames() {
  const c = getConfig();
  return [...Object.keys(c.platforms || {}), c.defaultPlatform || 'Lainnya'];
}