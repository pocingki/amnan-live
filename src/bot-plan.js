// Rencana balasan bot (fungsi murni terhadap objek conv; tanpa I/O dan tanpa kirim).
// Efek JAWABAN berlaku segera pada conv; efek KELUARAN hanya lewat commit(conv) setelah balasan terkirim.
import { matchIntent } from './bot-intent.js';
import { isQuestion, isSkip, validateAnswer } from './bot-validate.js';

const MEDIA = new Set(['image', 'audio', 'video', 'sticker', 'document', 'location', 'contact']);

// Satu kali lewat: nilai hasil penggantian tidak diperluas lagi.
export const fill = (t, conv, S) =>
  String(t || '').replace(/\{(nama|bot|admin)\}/gi, (_, k) => {
    k = k.toLowerCase();
    return k === 'nama' ? conv.name || 'Kak' : k === 'bot' ? S.botName : S.adminName;
  });

export function remainingMs(conv, S, now = Date.now()) {
  if (conv.mode !== 'bot' || !S.botEnabled || !(S.botDurationMinutes > 0)) return null;
  return Math.max(0, conv.botStartedAt + S.botDurationMinutes * 60000 - now);
}

export function setMode(conv, mode, now = Date.now()) {
  conv.mode = mode;
  if (mode === 'bot') conv.botStartedAt = now;
  else if (mode === 'admin') conv.adminLastAt = now;
}

/** Kapan admin terakhir aktif di percakapan ini (ambil alih / membalas). 0 bila tidak diketahui. */
export function adminLastAt(conv) {
  if (conv.adminLastAt) return conv.adminLastAt;
  const m = [...(conv.messages || [])].reverse().find((x) => x.by === 'admin');
  return m ? m.ts : 0;
}

/** Sisa ms sebelum mode admin boleh kembali ke bot (null bila bukan mode admin atau fitur mati). */
export function adminReturnMs(conv, S, now = Date.now()) {
  const mins = Number(S.adminAutoReturnMinutes) || 0;
  if (conv.mode !== 'admin' || !S.botEnabled || !(mins > 0)) return null;
  return Math.max(0, adminLastAt(conv) + mins * 60000 - now);
}

/** Efek keluaran sebuah balasan; dipanggil setelah balasan benar-benar terkirim. */
export function applyReplyEffect(conv, kind, fieldId, now = Date.now()) {
  if (kind === 'opening') conv.openingSent = true;
  else if (kind === 'question' || kind === 'reask') conv.pending = fieldId ?? null;
  else if (kind === 'fallback') conv.lastFallbackAt = now;
  else if (kind === 'completion') conv.completedAt = now;
  else if (kind === 'handover') {
    conv.mode = 'admin';
    conv.adminLastAt = now;
    conv.pending = null;
  }
}

export function plan(conv, msg, S, now = Date.now()) {
  const out = { replies: [], attention: null, ignored: false };
  if (!S.botEnabled || msg.kind === 'reaction' || msg.kind === 'system') {
    out.ignored = true;
    return out;
  }
  const stale = now - msg.ts > S.staleMinutes * 60000;
  // Mode admin: bot diam, kecuali admin sudah tidak aktif melebihi adminAutoReturnMinutes.
  // Pesan basi tidak membangunkan bot.
  if (conv.mode !== 'bot') {
    const left = adminReturnMs(conv, S, now);
    if (stale || left == null || left > 0) {
      out.ignored = true;
      return out;
    }
    setMode(conv, 'bot', now);
    conv.openingSent = false; // sesi baru: kembali ke pesan pembuka
    conv.pending = null;
    out.returnedToBot = Number(S.adminAutoReturnMinutes);
  }
  // Pesan basi: tanpa balasan, tanpa ubah state.
  if (stale) {
    out.attention = { reason: 'stale' };
    return out;
  }
  const add = (kind, text, fieldId) => {
    const r = { text: fill(text, conv, S), kind, commit: (c) => applyReplyEffect(c, kind, fieldId, now) };
    if (fieldId) r.fieldId = fieldId;
    out.replies.push(r);
  };
  const cooled = () => now - (conv.lastFallbackAt || 0) >= S.fallbackCooldownMinutes * 60000;

  // Durasi bot habis: sesi baru. Sesuai teks Pengaturan, pesan berikutnya kembali ke pesan pembuka
  // dan hitungan durasi dimulai ulang; bot tetap aktif (data yang sudah terkumpul tidak dihapus).
  if (S.botDurationMinutes > 0 && now - conv.botStartedAt > S.botDurationMinutes * 60000) {
    conv.botStartedAt = now;
    conv.openingSent = false;
  }

  const first = !conv.openingSent;
  if (first) {
    if (S.openingMessage) add('opening', S.openingMessage);
    else conv.openingSent = true;
  }

  // Media: bukan jawaban data; intent hanya dari caption.
  if (MEDIA.has(msg.kind)) {
    const it = matchIntent(msg.caption || '', S.intents, S.slangMap);
    if (it) add('intent', it.response);
    else if (!first && S.fallbackMessage && cooled()) add('fallback', S.fallbackMessage);
    out.attention = { reason: 'media' };
    return out;
  }

  // Teks.
  const text = msg.text || '';
  const fields = (S.requiredFields || []).filter((f) => f.enabled);
  const matched = matchIntent(text, S.intents, S.slangMap);
  const pend = conv.pending && fields.find((f) => f.id === conv.pending);
  let answered = false, skippedNow = false, reasked = false;

  if (pend && !isQuestion(text, matched)) {
    conv.skipped = conv.skipped || [];
    conv.retries = conv.retries || {};
    conv.data = conv.data || {};
    if (isSkip(text)) {
      conv.skipped.push(pend.id);
      conv.pending = null;
      skippedNow = true;
    } else {
      const v = validateAnswer(pend, text);
      if (v.ok) {
        conv.data[pend.id] = v.value;
        if (pend.id === 'nama' || pend.type === 'name') conv.name = v.value;
        delete conv.retries[pend.id];
        conv.pending = null;
        answered = true;
      } else {
        conv.retries[pend.id] = (conv.retries[pend.id] || 0) + 1;
        if (conv.retries[pend.id] > 2) {
          conv.skipped.push(pend.id);
          conv.pending = null;
          skippedNow = true;
        } else {
          add('reask', 'Maaf, jawaban belum sesuai. ' + pend.question, pend.id);
          reasked = true;
        }
      }
    }
  } else if (matched) add('intent', matched.response);
  else if (!first && S.fallbackMessage && cooled()) add('fallback', S.fallbackMessage);

  if (!reasked && !conv.completedAt) {
    const next = fields.find((f) => !(f.id in (conv.data || {})) && !(conv.skipped || []).includes(f.id));
    if (next) add('question', next.question, next.id);
    else if (fields.length && (answered || skippedNow)) {
      if (S.completionMessage) add('completion', S.completionMessage);
      else conv.completedAt = now;
    }
  }

  if (!out.replies.length && !first) out.attention = { reason: 'no_reply' };
  return out;
}

/** Pembungkus kompatibilitas: jalankan semua commit, kembalikan teks balasan. */
export function decide(conv, text, S, now = Date.now()) {
  const p = plan(conv, { text, kind: 'text', ts: now }, S, now);
  p.replies.forEach((r) => r.commit(conv));
  return p.replies.map((r) => r.text);
}