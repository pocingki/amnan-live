// API percakapan (/api/conversations) dan Bot Tester (/api/tester).
import * as C from '../conversations.js';
import * as leadStore from '../store.js';
import * as bot from '../bot.js';
import { emit } from '../events.js';

const CONV = /^\/api\/conversations\/(\d+)(?:\/(read|mode|send|delete-messages|resend|attention\/clear))?$/;
const METHODS = { '': ['GET', 'DELETE'], read: ['POST'], mode: ['POST'], send: ['POST'], 'delete-messages': ['POST'], resend: ['POST'], 'attention/clear': ['POST'] };
const TESTER_ACTS = ['send', 'phone-reply', 'reset', 'mode', 'advance', 'transaction-done'];
const KINDS = ['text', 'image', 'audio', 'video', 'sticker', 'document', 'location', 'contact'];
const BAD_PHONE = 'Nomor uji tidak valid (8-15 digit)';

const clearAttention = (c) => {
  c.needsAttention = false;
  c.attentionReason = null;
  c.attentionAt = null;
};
const awaiting = (c) => c.messages?.[c.messages.length - 1]?.by === 'customer';

function enrich(row) {
  const c = C.get(row.phone) || {};
  return {
    ...row,
    needsAttention: row.needsAttention ?? !!c.needsAttention,
    attentionReason: row.attentionReason ?? c.attentionReason ?? null,
    awaitingReply: row.awaitingReply ?? awaiting(c),
    phoneKnown: row.phoneKnown ?? c.phoneKnown ?? (c.lid ? c.phone !== c.lid : true),
  };
}

// sendText diambil malas dari ../whatsapp.js (ctx.sendText hanya untuk tes).
const getSend = async (ctx) => ctx.sendText || (await import('../whatsapp.js')).sendText;

export async function handle(req, res, url, ctx) {
  const p = url.pathname, m = req.method;
  const ok = (b = { ok: true }) => (ctx.sendJSON(res, 200, b), true);
  const fail = (code, msg) => (ctx.sendJSON(res, code, { error: msg }), true);

  if (p === '/api/conversations') return m === 'GET' ? ok({ conversations: C.list().map(enrich) }) : false;

  const cm = p.match(CONV);
  if (cm) {
    const act = cm[2] || '';
    if (!METHODS[act].includes(m)) return false;
    if ((m === 'DELETE' || act === 'delete-messages') && !ctx.requireRole('admin')) return true;
    const conv = C.get(cm[1]);
    if (!conv) return fail(404, 'Percakapan tidak ditemukan');

    if (!act && m === 'GET') return ok(bot.view(conv)); // TIDAK mereset unread
    if (!act && m === 'DELETE') {
      C.remove(conv.phone);
      ctx.audit('conversation.delete', { phone: conv.phone });
      return ok();
    }
    if (act === 'read') {
      conv.unread = 0;
      C.save();
      emit('unread', { total: C.totalUnread() });
      return ok();
    }
    if (act === 'attention/clear') {
      clearAttention(conv);
      C.save();
      return ok();
    }
    const b = await ctx.readBody(req);
    if (act === 'mode') {
      if (!['bot', 'admin'].includes(b.mode)) return fail(400, 'Mode tidak valid');
      bot.setMode(conv, b.mode);
      if (b.mode === 'bot') clearAttention(conv);
      C.save();
      ctx.audit('conversation.mode', { phone: conv.phone, mode: b.mode });
      return ok({ mode: conv.mode });
    }
    if (act === 'send') {
      const text = String(b.text ?? '').trim().slice(0, 4000);
      if (!text) return fail(400, 'Pesan kosong');
      if (conv.mode !== 'admin') return fail(409, 'Take over admin dulu untuk membalas');
      let r;
      try {
        r = await (await getSend(ctx))(conv.jid, text);
      } catch (e) {
        return fail(502, e.message);
      }
      const message = C.addMessage(conv, 'admin', text);
      Object.assign(message, { type: 'text', sender: ctx.user.name, status: 'sent', waId: r?.waId });
      conv.adminLastAt = message.ts;
      clearAttention(conv);
      const lead = leadStore.findByPhone(conv.phone) || (conv.lid && leadStore.findByLid?.(conv.lid));
      if (lead) leadStore.update(lead.id, { lastReplyAt: message.ts });
      C.save();
      ctx.audit('conversation.send', { phone: conv.phone });
      return ok({ message });
    }
    if (act === 'resend') {
      if (!b.messageId) return fail(400, 'messageId wajib');
      try {
        return ok({ message: await bot.resendMessage(conv, String(b.messageId), await getSend(ctx)) });
      } catch (e) {
        return e.code === 'NOT_FAILED' ? fail(409, e.message) : fail(502, e.message);
      }
    }
    if (act === 'delete-messages') {
      if (!Array.isArray(b.ids)) return fail(400, 'ids harus berupa array');
      const ids = new Set(b.ids), n = conv.messages.length;
      conv.messages = conv.messages.filter((x) => !ids.has(x.id));
      C.save();
      ctx.audit('conversation.delete-messages', { phone: conv.phone, count: n - conv.messages.length });
      return ok({ removed: n - conv.messages.length });
    }
    return false;
  }

  // ----- Bot tester -----
  if (p === '/api/tester' && m === 'GET') {
    const phone = bot.normPhone(url.searchParams.get('phone'));
    return phone ? ok(bot.testerView(phone)) : fail(400, BAD_PHONE);
  }
  if (p.startsWith('/api/tester/') && m === 'POST') {
    const act = p.slice('/api/tester/'.length);
    if (!TESTER_ACTS.includes(act)) return false;
    const b = (await ctx.readBody(req)) || {};
    if (act === 'reset' && !b.phone) return bot.testerReset(), ok(); // reset semua nomor uji
    const phone = bot.normPhone(b.phone);
    if (!phone) return fail(400, BAD_PHONE);
    if (act === 'reset') return bot.testerReset(phone), ok();
    if (act === 'mode') return ['bot', 'admin'].includes(b.mode) ? ok({ status: bot.testerMode(phone, b.mode) }) : fail(400, 'Mode tidak valid');
    if (act === 'transaction-done') {
      try {
        return ok(bot.testerTransactionDone(phone));
      } catch (e) {
        return e.code === 'NO_OPEN' ? fail(400, e.message) : fail(500, 'Terjadi kesalahan pada server');
      }
    }
    if (act === 'advance') {
      const h = Number(b.hours);
      return h > 0 && h <= 24 * 365 ? ok(bot.testerAdvance(phone, h)) : fail(400, 'Jam tidak valid');
    }
    const text = String(b.text ?? '').trim().slice(0, 2000);
    if (act === 'phone-reply') return text ? ok(await bot.testerPhoneReply(phone, text)) : fail(400, 'Pesan kosong');
    const kind = KINDS.includes(b.kind) ? b.kind : 'text';
    if (kind === 'text' && !text) return fail(400, 'Pesan kosong');
    const sim = b.simulate || {};
    return ok(await bot.testerSend(phone, text, { kind, simulate: { stale: !!sim.stale, sendFail: !!sim.sendFail } }));
  }
  return false;
}