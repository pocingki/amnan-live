// Mesin klasifikasi lead: deteksi sumber, Status Lead (Cold/Warm/Hot), Data Leads (New/Existing),
// siklus transaksi, daftar blokir. Murni logika (classify) + pembungkus penyimpanan (ingest).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as store from './store.js';
import { load, save } from './jsonfile.js';
import { emit as defaultEmit } from './events.js';

const CONFIG_FILE = process.env.KEYWORDS_FILE || path.resolve('config/keywords.json');

// Satu sumber kebenaran untuk aturan lead bawaan (config/keywords.json memakai nilai yang sama).
export const DEFAULT_LEAD_RULE = 'all';

// Nilai bawaan bila config/keywords.json (versi lama) tidak memuatnya.
const DEFAULT_STRONG = [
  'sudah transfer', 'sudah tf', 'bukti transfer', 'bukti bayar', 'bukti pembayaran', 'sudah bayar', 'sudah dp', 'lunas', 'pelunasan',
  'kirim bukti', 'konfirmasi pembayaran', 'jadi ambil', 'oke deal', 'ambil paket', 'checkout', 'order sekarang', 'pesan sekarang',
];
const DEFAULT_QUESTION_STARTERS = [
  'apa', 'apakah', 'bagaimana', 'gimana', 'gmn', 'berapa', 'dimana', 'di mana', 'kapan', 'bisa', 'boleh', 'ada', 'kenapa', 'mengapa', 'siapa', 'kalau', 'jika',
];
const DEFAULT_QUESTION_INLINE = ['berapa'];
const DEFAULT_SIGNALS = {
  dp: ['dp', 'sudah dp', 'down payment', 'uang muka'],
  pelunasan: ['lunas', 'pelunasan'],
  bayar: ['sudah bayar', 'baru bayar', 'sudah transfer', 'sudah tf', 'baru transfer', 'baru tf', 'transfer sekarang', 'saya transfer', 'bukti transfer', 'bukti bayar', 'bukti pembayaran', 'kirim bukti', 'konfirmasi pembayaran'],
  booking: ['booking', 'boking', 'booked', 'reservasi', 'jadwalkan', 'mau daftar', 'sudah daftar', 'daftar sekarang', 'jadi ambil', 'ambil paket', 'oke deal', 'checkout', 'order sekarang', 'pesan sekarang'],
};
const DEFAULT_WARM_SCORE = {
  threshold: 5, perThreeMessages: 1, maxMessageScore: 4, askedPrice: 2, askedSchedule: 2, askedLocation: 1, perAnsweredField: 1, maxFieldScore: 2,
};
const DEFAULT_INTENT = {
  price: ['harga', 'biaya', 'tarif', 'berapa', 'diskon', 'promo'],
  schedule: ['jadwal', 'jam buka', 'jam praktek', 'jam praktik', 'jam berapa', 'slot', 'tersedia', 'kosong'],
  location: ['lokasi', 'alamat', 'dimana', 'di mana', 'maps', 'letak', 'cabang'],
};
const FILLERS = ['kak', 'kakak', 'kk', 'min', 'admin', 'halo', 'hai', 'hi', 'permisi', 'mba', 'mbak', 'mas', 'bu', 'ibu', 'pak', 'bapak', 'dok', 'dokter', 'om', 'tante', 'oke', 'ok', 'ya', 'nah', 'eh', 'oh', 'terus', 'lalu', 'maaf'];
const MEDIA_KINDS = new Set(['image', 'document', 'video']);
const IGNORED_KINDS = new Set(['reaction', 'system']);
const DAY_MS = 86400000;

const R = {
  cold: 'Pesan masuk pertama kali dari nomor ini (sama dengan pesan pembuka bot)',
  warmScore: (s, th, reasons) => `Skor Warm ${s} (batas ${th}): ${reasons.join(', ')}`,
  warmLegacy: (n, after) => `Percakapan lebih dari ${after} pesan (${n} pesan dari customer)`,
  hot: (w) => `Ada sinyal transaksi: ${w.join(', ')}`,
  hotExisting: 'Customer lama (sudah pernah transaksi lebih dari sekali)',
  new: 'Pesan masuk pertama kali dari nomor ini',
  existing: (n) => `Customer pernah booking/transfer dan melakukannya lagi (transaksi ke-${n})`,
  candidate: 'Gambar/dokumen setelah pembahasan pembayaran',
};
// Kata negasi tepat sebelum keyword ("belum transfer", "tidak jadi booking") membatalkan sinyal
const NEG = /(?:^|[^\p{L}\p{N}])(?:belum|blm|tidak|tdk|nggak|ngga|gak|ga|bukan|batal|jangan|tanpa)\s+(?:\S+\s+)?$/iu;

// ---------- event (bisa diganti di tes) ----------
let emitter = defaultEmit;
export const setEmitter = (fn) => { emitter = fn || defaultEmit; };
const fire = (type, payload) => {
  try { emitter(type, payload); } catch (e) { console.error('[leads] emit gagal:', e.message); }
};

// ---------- config ----------
export const getConfig = () => {
  const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  return {
    ...c,
    leadRule: c.leadRule ?? DEFAULT_LEAD_RULE,
    timezone: c.timezone ?? 'Asia/Jakarta',
    transactionCycleDays: c.transactionCycleDays ?? 30,
    transactionGapHours: c.transactionGapHours ?? 24,
    hotCandidateMinutes: c.hotCandidateMinutes ?? 10,
  };
};

const settings = (config) => ({
  leadRule: config.leadRule ?? DEFAULT_LEAD_RULE,
  cycleMs: (config.transactionCycleDays ?? 30) * DAY_MS,
  gapMs: (config.transactionGapHours ?? 24) * 3600000,
  candidateMs: (config.hotCandidateMinutes ?? 10) * 60000,
});

// ---------- pencocokan kata ----------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const B = '(^|[^\\p{L}\\p{N}])';
const A = '(?=$|[^\\p{L}\\p{N}])';
const PREFIX = '(?:di|me|mem|men|meng|ber|ter|ke|se|pe|pem|pen)?';
const SUFFIX = '(?:nya|an|kan|i|lah|kah)?';

export function hasWord(text, word) {
  return new RegExp(`${B}${escapeRe(word)}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

/** Regex kata/frasa utuh. Kata terakhir >= 5 huruf menerima imbuhan umum (ditransfer, pembayarannya, pelunasan). */
function wordRe(word, flags = 'giu') {
  const toks = word.trim().split(/\s+/);
  const body = toks.map((t, i) => {
    const core = escapeRe(t);
    return t.length >= 5 && i === toks.length - 1 ? `${PREFIX}${core}${SUFFIX}` : core;
  }).join('\\s+');
  return new RegExp(`${B}(${body})${A}`, flags);
}

const firstIndex = (text, word) => {
  const m = new RegExp(`${B}${escapeRe(word)}($|[^\\p{L}\\p{N}])`, 'iu').exec(text);
  return m ? m.index + m[1].length : -1;
};

/** Pecah teks jadi klausa (pemisah . ! ? , ; baris baru); q = diakhiri tanda tanya. */
function clauses(text) {
  const out = [];
  for (const m of String(text).matchAll(/([^.!?,;\n]+)([.!?,;\n]*)/gu)) {
    const body = m[1].trim();
    if (body) out.push({ text: body, q: m[2].includes('?') });
  }
  return out;
}

function isQuestion(clause, config) {
  if (clause.q) return true;
  let t = clause.text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  for (let again = true; again;) {
    again = false;
    for (const f of FILLERS) if (t.startsWith(f + ' ')) { t = t.slice(f.length + 1); again = true; }
  }
  const starters = config?.questionStarters ?? DEFAULT_QUESTION_STARTERS;
  if (starters.some((s) => t === s || t.startsWith(s + ' '))) return true;
  if (/(?:^| )(?:belum|gak|ga|nggak|enggak)$/.test(t)) return true;
  return (config?.questionInline ?? DEFAULT_QUESTION_INLINE).some((w) => hasWord(t, w));
}

/** filtered=true: hanya kalimat pernyataan dan tidak dinegasi. filtered=false: sebutan apa pun. */
function scan(text, words, { filtered, config }) {
  const parts = filtered ? clauses(text).filter((c) => !isQuestion(c, config)).map((c) => c.text) : [String(text)];
  const out = [];
  for (const w of words || []) {
    const re = wordRe(w);
    let hit = false;
    for (const part of parts) {
      for (const m of part.matchAll(re)) {
        const at = m.index + m[1].length;
        if (!filtered || !NEG.test(part.slice(Math.max(0, at - 25), at))) { hit = true; break; }
      }
      if (hit) break;
    }
    if (hit) out.push(w.toLowerCase());
  }
  return out;
}

const strongWords = (c) => c.hotStrong ?? c.hotKeywords ?? DEFAULT_STRONG;

/**
 * Kata Hot yang cocok: HANYA dari kalimat pernyataan (bukan tanya) dan tidak dinegasi; imbuhan diterima.
 * words default = hotStrong. opts.config dipakai untuk questionStarters.
 */
export function hotMatches(text, words, opts = {}) {
  let w = words;
  if (!w) { try { w = strongWords(getConfig()); } catch { w = DEFAULT_STRONG; } }
  return scan(text, w, { filtered: true, config: opts.config });
}

/** {strong:[], weak:[], signals:[jenis transaksi]} untuk satu pesan. */
export function hotSignals(text, config = getConfig()) {
  const strong = scan(text, strongWords(config), { filtered: true, config });
  const weak = scan(text, config.hotWeak || [], { filtered: false, config });
  const signals = Object.entries(config.transactionSignals || DEFAULT_SIGNALS)
    .filter(([, words]) => scan(text, words, { filtered: true, config }).length)
    .map(([type]) => type);
  return { strong, weak, signals };
}

// ---------- sumber / platform ----------
function platformFromSource(source, config) {
  if (!source) return null;
  const code = String(source.referralCode ?? '').trim().toLowerCase();
  if (code) {
    const key = Object.keys(config.referralCodes || {}).find((k) => k.toLowerCase() === code);
    if (key) return { platform: config.referralCodes[key], via: 'referral' };
  }
  const url = String(source.sourceUrl ?? '');
  if (source.ctwaClid || source.adId || url) return { platform: /tiktok/i.test(url) ? 'TikTok' : 'Iklan Meta', via: 'ads' };
  return null;
}

/**
 * Cari platform (sumber) dan keyword. Prioritas: referralCode > metadata iklan > teks (yang disebut PERTAMA) > defaultPlatform.
 * source = {referralCode, ctwaClid, adId, sourceUrl} (opsional).
 */
export function detect(text, config = getConfig(), source = null) {
  text = String(text ?? '');
  const matched = [];
  let best = null;
  for (const [name, words] of Object.entries(config.platforms || {})) {
    let hit = null;
    for (const w of words) {
      const idx = firstIndex(text, w);
      if (idx >= 0 && (!hit || idx < hit.idx || (idx === hit.idx && w.length > hit.w.length))) hit = { w, idx };
    }
    if (!hit) continue;
    matched.push(hit.w);
    if (!best || hit.idx < best.idx || (hit.idx === best.idx && hit.w.length > best.w.length)) best = { name, ...hit };
  }
  const fromSource = platformFromSource(source, config);
  let platform = config.defaultPlatform || 'Lainnya';
  let platformVia = null;
  if (fromSource) ({ platform, via: platformVia } = fromSource);
  else if (best) { platform = best.name; platformVia = 'text'; }

  const platformKeywords = matched.length;
  for (const w of config.triggers || []) if (hasWord(text, w)) matched.push(w);
  return {
    platform,
    platformFound: platformVia !== null,
    platformVia,
    triggerFound: matched.length > platformKeywords,
    keywords: [...new Set(matched.map((m) => m.toLowerCase()))],
  };
}

/**
 * Aturan kapan sebuah chat dihitung sebagai lead (config.leadRule):
 *  - "all" (bawaan, DEFAULT_LEAD_RULE): pesan customer mana pun dari nomor/lid yang belum punya lead
 *  - "platform": hanya jika ada kata kunci platform atau metadata sumber
 *  - "keyword": platform ATAU trigger (harga, order, ...)
 */
export function qualifies(result, rule = DEFAULT_LEAD_RULE) {
  if (rule === 'all') return true;
  if (rule === 'keyword') return result.platformFound || result.triggerFound;
  return result.platformFound;
}

// ---------- siklus transaksi ----------
const newCycle = (ts) => ({ id: randomUUID(), startedAt: ts, lastSignalAt: ts, signals: [], settledAt: null, doneAt: null });
const cloneCycles = (list) => list.map((c) => ({ ...c, signals: [...(c.signals || [])] }));

function cycleOpen(c, ts, S) {
  if (c.doneAt) return false;
  if (ts - c.lastSignalAt > S.cycleMs) return false;
  if (c.settledAt && ts - c.settledAt >= S.gapMs) return false;
  return true;
}

function applySignals(cycles, types, ts, S) {
  const list = cloneCycles(cycles);
  let cur = list.at(-1);
  if (!cur || !cycleOpen(cur, ts, S)) { cur = newCycle(ts); list.push(cur); }
  for (const type of types) cur.signals.push({ type, ts });
  if (cur.signals.length > 50) cur.signals = cur.signals.slice(-50);
  cur.lastSignalAt = ts;
  if (types.includes('pelunasan')) cur.settledAt = ts;
  return list;
}

const cycleFields = (cycles) => ({ transactionCycles: cycles, transactionCount: cycles.length, lastTransactionAt: cycles.length ? cycles.at(-1).lastSignalAt : null });

/** Salinan lead dengan default field baru terisi (aman untuk lead lama). Tidak mengubah objek asli. */
export function normalizeLead(lead) {
  const l = { ...lead };
  const fill = (k, v) => { if (l[k] === undefined) l[k] = v; };
  fill('phone', null);
  fill('lid', null);
  fill('messageCount', 1);
  fill('lastCustomerMessageAt', l.lastMessageAt ?? l.createdAt ?? null);
  fill('lastReplyAt', null);
  fill('data', {});
  fill('warmScore', 0);
  fill('hotCandidate', null);
  fill('blocked', false);
  fill('followUpDate', null);
  fill('followUpNote', '');
  l.statusHistory = Array.isArray(l.statusHistory) ? [...l.statusHistory] : [];
  l.warmReasons = Array.isArray(l.warmReasons) ? [...l.warmReasons] : [];
  l.notes = Array.isArray(l.notes) ? [...l.notes] : [];
  l.warmFlags = { ...(l.warmFlags || {}) };
  l.source = { platform: null, adId: null, ctwaClid: null, sourceUrl: null, referralCode: null, ...(l.source || {}) };
  if (Array.isArray(l.transactionCycles)) {
    l.transactionCycles = cloneCycles(l.transactionCycles);
  } else {
    // migrasi: lead lama dengan transactionCount N -> N siklus sintetis
    const n = Math.min(50, Math.max(0, Math.floor(Number(l.transactionCount ?? (l.status === 'Hot Leads' ? 1 : 0)) || 0)));
    const base = l.lastTransactionAt ?? l.lastMessageAt ?? l.createdAt ?? 0;
    l.transactionCycles = Array.from({ length: n }, (_, i) => ({
      id: `${l.id || 'lead'}-c${i + 1}`, startedAt: base, lastSignalAt: base, signals: [], settledAt: null, doneAt: null,
    }));
  }
  Object.assign(l, cycleFields(l.transactionCycles));
  if (!l.transactionCycles.length) l.lastTransactionAt = lead.lastTransactionAt ?? null;
  return l;
}

/** Patch untuk store.update: menutup siklus terbuka (doneAt=ts). Tidak menyentuh dataType. */
export function markTransactionDone(lead, ts = Date.now()) {
  const l = normalizeLead(lead);
  const cycles = cloneCycles(l.transactionCycles);
  const i = cycles.findLastIndex((c) => !c.doneAt);
  if (i >= 0) cycles[i].doneAt = ts;
  return cycleFields(cycles);
}

// ---------- skor Warm ----------
function intentFlags(flags, text, config) {
  const words = { ...DEFAULT_INTENT, ...(config.warmIntentWords || {}) };
  const out = { ...flags };
  const map = { price: 'askedPrice', schedule: 'askedSchedule', location: 'askedLocation' };
  for (const [kind, flag] of Object.entries(map)) {
    if (!out[flag] && words[kind].some((w) => wordRe(w, 'iu').test(text))) out[flag] = true;
  }
  return out;
}

function warmCompute(flags, count, dataCount, ws) {
  const reasons = [];
  let score = 0;
  const msg = Math.min(ws.maxMessageScore, Math.floor(count / 3) * ws.perThreeMessages);
  if (msg > 0) { score += msg; reasons.push(`${count} pesan dari customer`); }
  if (flags.askedPrice) { score += ws.askedPrice; reasons.push('Menanyakan harga'); }
  if (flags.askedSchedule) { score += ws.askedSchedule; reasons.push('Menanyakan jadwal'); }
  if (flags.askedLocation) { score += ws.askedLocation; reasons.push('Menanyakan lokasi'); }
  const fld = Math.min(ws.maxFieldScore, dataCount * ws.perAnsweredField);
  if (fld > 0) { score += fld; reasons.push(`${dataCount} data terisi`); }
  return { score, reasons };
}

const normSource = (s) => ({ platform: null, adId: null, ctwaClid: null, sourceUrl: null, referralCode: null, ...(s || {}) });
const hasSource = (s) => !!s && Object.values(s).some((v) => v);

/**
 * Inti logika otomatis (dipakai SAMA PERSIS oleh WhatsApp asli dan Bot Tester). Murni: tidak menyentuh penyimpanan.
 * classify(prev, {text, phone, lid, name, ts, customerCount, kind, source, data}, config)
 *  -> {created, ignored, lead, changes}. kind 'reaction'/'system' -> ignored. Media dihitung pesan biasa.
 *
 * STATUS LEAD (hanya naik, tidak turun otomatis)
 *  - Cold : lead baru (sesuai leadRule; boleh dibuat pada pesan ke berapa pun).
 *  - Warm : skor >= warmScore.threshold (jumlah pesan, tanya harga/jadwal/lokasi, kolom data terjawab).
 *  - Hot  : sinyal hotStrong dalam kalimat pernyataan tak-dinegasi, atau sudah Existing.
 *           hotWeak hanya mengisi lastWeakAt; gambar/dokumen <= 10 menit sesudahnya -> hotCandidate.
 * DATA LEADS
 *  - New / Existing: Existing bila punya >= 2 siklus transaksi (permanen). DP -> pelunasan = satu siklus.
 * Nilai manual (statusManual / dataTypeManual) tidak ditimpa sistem.
 */
export function classify(prev, msg = {}, config = getConfig()) {
  const { phone = null, lid = null, name = '', ts = Date.now(), customerCount = 1, kind = 'text', source = null } = msg;
  const ignoredResult = { created: false, ignored: true, lead: null, changes: [] };
  if (IGNORED_KINDS.has(kind)) return ignoredResult;
  const text = String(msg.text ?? '');
  const S = settings(config);
  const det = detect(text, config, source);
  const sig = hotSignals(text, config);
  const keywords = [...new Set([...det.keywords, ...sig.strong])];
  const ws = { ...DEFAULT_WARM_SCORE, ...(config.warmScore || {}) };
  const useScore = config.warmScore != null || config.warmAfterMessages == null;
  const warmAfter = config.warmAfterMessages ?? 10;

  if (!prev) {
    if (!qualifies(det, S.leadRule)) return ignoredResult;
    const count = Math.max(1, Math.floor(Number(customerCount)) || 1);
    const flags = intentFlags({}, text, config);
    const w = warmCompute(flags, count, Object.keys(msg.data || {}).length, ws);
    const warm = useScore ? w.score >= ws.threshold : count > warmAfter;
    const status = sig.strong.length ? 'Hot Leads' : warm ? 'Warm Leads' : 'Cold Leads';
    const statusReason = sig.strong.length ? R.hot(sig.strong)
      : warm ? (useScore ? R.warmScore(w.score, ws.threshold, w.reasons) : R.warmLegacy(count, warmAfter)) : R.cold;
    const cycles = sig.signals.length ? applySignals([], sig.signals, ts, S) : [];
    const lead = {
      phone: phone || null, lid: lid || null, name: name || '', platform: det.platform, keyword: keywords.join(', '), firstMessage: text,
      source: normSource(source),
      status, statusReason, statusHistory: [{ status, ts, reason: statusReason }],
      dataType: 'New', dataReason: R.new,
      ...cycleFields(cycles),
      messageCount: count, createdAt: ts, lastMessageAt: ts, lastCustomerMessageAt: ts,
      warmScore: w.score, warmReasons: w.reasons, warmFlags: flags,
      hotCandidate: null, blocked: false, notes: [], followUpDate: null, followUpNote: '',
    };
    if (sig.weak.length) lead.lastWeakAt = ts;
    if (sig.strong.length) lead.lastStrongAt = ts;
    return { created: true, ignored: false, lead, changes: [`Lead baru (sumber ${det.platform})`, `Status: ${status}`, 'Data Leads: New'] };
  }

  const lead = normalizeLead(prev);
  const changes = [];
  const count = Math.max((prev.messageCount || 1) + 1, customerCount);

  // sinyal lemah / kandidat Hot dari media
  const lastSignal = Math.max(lead.lastWeakAt || 0, lead.lastStrongAt || 0);
  if (MEDIA_KINDS.has(kind) && lastSignal && ts - lastSignal >= 0 && ts - lastSignal <= S.candidateMs) {
    lead.hotCandidate = { ts, reason: R.candidate };
  }
  if (sig.weak.length) lead.lastWeakAt = ts;
  if (sig.strong.length) lead.lastStrongAt = ts;

  // siklus transaksi
  if (sig.signals.length) Object.assign(lead, cycleFields(applySignals(lead.transactionCycles, sig.signals, ts, S)));
  const tx = lead.transactionCycles.length;
  if (!prev.dataTypeManual && prev.dataType !== 'Existing' && tx >= 2) {
    lead.dataType = 'Existing';
    lead.dataReason = R.existing(tx);
    changes.push('Data Leads: Existing');
  }

  // skor Warm (selalu dihitung untuk tampilan)
  lead.warmFlags = intentFlags(lead.warmFlags, text, config);
  const w = warmCompute(lead.warmFlags, count, Object.keys(prev.data || {}).length, ws);
  lead.warmScore = w.score;
  lead.warmReasons = w.reasons;

  if (!lead.statusManual && lead.status !== 'Hot Leads') {
    const before = lead.status;
    let reason = null;
    if (sig.strong.length) { lead.status = 'Hot Leads'; reason = R.hot(sig.strong); }
    else if (lead.dataType === 'Existing') { lead.status = 'Hot Leads'; reason = R.hotExisting; }
    else if (before === 'Cold Leads' && (useScore ? w.score >= ws.threshold : count > warmAfter)) {
      lead.status = 'Warm Leads';
      reason = useScore ? R.warmScore(w.score, ws.threshold, w.reasons) : R.warmLegacy(count, warmAfter);
    }
    if (lead.status !== before) {
      lead.statusReason = reason;
      lead.statusHistory.push({ status: lead.status, ts, reason });
      changes.push(`Status: ${lead.status}`);
    }
  }
  if (lead.status === 'Hot Leads') lead.hotCandidate = null;

  lead.keyword = [...new Set([...(prev.keyword ? prev.keyword.split(', ') : []), ...keywords])].join(', ');
  if (det.platformFound && (!lead.platform || lead.platform === 'Lainnya')) lead.platform = det.platform;
  if (hasSource(source)) {
    const cur = lead.source;
    for (const [k, v] of Object.entries(source)) if (v && !cur[k]) cur[k] = v;
  }
  if (name && !lead.name) lead.name = name;
  if (phone && !lead.phone) lead.phone = phone;
  if (lid && !lead.lid) lead.lid = lid;
  lead.messageCount = count;
  lead.lastMessageAt = ts;
  lead.lastCustomerMessageAt = ts;
  return { created: false, ignored: false, lead, changes };
}

// ---------- daftar blokir (blocked.json: {phones:[], lids:[]}) ----------
const BLOCK_FILE = 'blocked.json';
const idKey = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const readBlocked = () => {
  const b = load(BLOCK_FILE, {}) || {};
  return { phones: Array.isArray(b.phones) ? b.phones.map(String) : [], lids: Array.isArray(b.lids) ? b.lids.map(String) : [] };
};

export function isBlocked({ phone, lid } = {}) {
  const b = readBlocked();
  const p = idKey(phone);
  const l = idKey(lid);
  return !!((p && b.phones.includes(p)) || (l && b.lids.includes(l)));
}

function findLead(phone, lid) {
  let l = phone ? store.findByPhone(phone) : undefined;
  if (!l && lid) l = typeof store.findByLid === 'function' ? store.findByLid(lid) : store.all().find((x) => x.lid === lid);
  return l || null;
}

function setBlocked({ phone, lid } = {}, on) {
  const b = readBlocked();
  const p = idKey(phone);
  const l = idKey(lid);
  const upd = (arr, v) => (on ? (arr.includes(v) ? arr : [...arr, v]) : arr.filter((x) => x !== v));
  if (p) b.phones = upd(b.phones, p);
  if (l) b.lids = upd(b.lids, l);
  save(BLOCK_FILE, b);
  const lead = findLead(p, l);
  if (lead && !!lead.blocked !== on) store.update(lead.id, { blocked: on });
  return b;
}

export const block = (id) => setBlocked(id, true);
export const unblock = (id) => setBlocked(id, false);
export const listBlocked = () => readBlocked();

// ---------- penyimpanan ----------
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const announceNew = (lead, fallback = {}) => {
  const payload = { phone: lead.phone ?? fallback.phone ?? null, name: lead.name || fallback.name || '' };
  fire('lead:new', payload);
  if (lead.status === 'Hot Leads') fire('lead:hot', payload);
};

/** Dipanggil untuk setiap pesan pribadi yang masuk dari WhatsApp asli. */
export function ingest({ phone = null, lid = null, name = '', text = '', ts = Date.now(), customerCount, kind = 'text', source = null } = {}) {
  if (IGNORED_KINDS.has(kind)) return { created: false, ignored: true, blocked: false, lead: null, changes: [] };
  const existing = findLead(phone, lid);
  if (isBlocked({ phone, lid }) || (existing && existing.blocked)) {
    return { created: false, ignored: true, blocked: true, lead: null, changes: [] };
  }
  const r = classify(existing, { text, phone, lid, name, ts, customerCount, kind, source });
  if (r.ignored) return { ...r, blocked: false };
  if (r.created) {
    const lead = store.add(r.lead);
    announceNew(lead, { phone, name });
    return { ...r, blocked: false, lead };
  }
  const { id, ...rest } = r.lead;
  const patch = Object.fromEntries(Object.entries(rest).filter(([k, v]) => !sameJSON(v, existing[k])));
  const wasHot = existing.status === 'Hot Leads';
  const lead = store.update(existing.id, patch);
  if (!wasHot && lead.status === 'Hot Leads') fire('lead:hot', { phone: lead.phone ?? phone, name: lead.name || name || '' });
  return { ...r, blocked: false, lead };
}

/** Buat lead dari percakapan (tombol "jadikan lead"). Klasifikasi normal; tidak menghormati blokir bila belum ada lead. */
export function createFromConversation({ phone = null, lid = null, name = '', firstMessage = '', ts = Date.now(), customerCount = 1, data } = {}) {
  const found = findLead(phone, lid);
  if (found) return { lead: found, existed: true };
  const cfg = { ...getConfig(), leadRule: 'all' };
  const r = classify(null, { text: firstMessage, phone, lid, name, ts, customerCount, data }, cfg);
  const row = data && typeof data === 'object' ? { ...r.lead, data: { ...data } } : r.lead;
  const lead = store.add(row);
  announceNew(lead, { phone, name });
  return { lead, existed: false };
}

export function platformNames() {
  const c = getConfig();
  const names = Object.keys(c.platforms || {});
  const d = c.defaultPlatform || 'Lainnya';
  return names.includes(d) ? names : [...names, d];
}
