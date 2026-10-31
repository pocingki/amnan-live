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
}

/** Efek keluaran sebuah balasan; dipanggil setelah balasan benar-benar terkirim. */
export function applyReplyEffect(conv, kind, fieldId, now = Date.now()) {
  if (kind === 'opening') conv.openingSent = true;
  else if (kind === 'question' || kind === 'reask') conv.pending = fieldId ?? null;
  else if (kind === 'fallback') conv.lastFallbackAt = now;
  else if (kind === 'completion') conv.completedAt = now;
  else if (kind === 'handover') {
    conv.mode = 'admin';
    conv.pending = null;
  }
}

export function plan(conv, msg, S, now = Date.now()) {
  const out = { replies: [], attention: null, ignored: false };
  if (!S.botEnabled || conv.mode !== 'bot' || msg.kind === 'reaction' || msg.kind === 'system') {
    out.ignored = true;
    return out;
  }
  // Pesan basi: tanpa balasan, tanpa ubah state.
  if (now - msg.ts > S.staleMinutes * 60000) {
    out.attention = { reason: 'stale' };
    return out;
  }
  const add = (kind, text, fieldId) => {
    const r = { text: fill(text, conv, S), kind, commit: (c) => applyReplyEffect(c, kind, fieldId, now) };
    if (fieldId) r.fieldId = fieldId;
    out.replies.push(r);
  };
  const cooled = () => now - (conv.lastFallbackAt || 0) >= S.fallbackCooldownMinutes * 60000;

  // Durasi bot habis: serah terima, tanpa pembuka ulang.
  if (S.botDurationMinutes > 0 && now - conv.botStartedAt > S.botDurationMinutes * 60000) {
    out.attention = { reason: 'bot_duration' };
    if (S.handoverMessage) add('handover', S.handoverMessage);
    else applyReplyEffect(conv, 'handover', null, now);
    return out;
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