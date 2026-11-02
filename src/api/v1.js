// API aplikasi pendamping (kontrak v1, docs/INTEGRASI.md): /api/v1/*. Diautentikasi dengan API key
// di server.js (ctx.app); modul ini hanya berjalan bila ctx.app ada, jadi sesi dashboard tidak bisa memakainya.
import { randomUUID } from 'node:crypto';
import * as store from '../store.js';
import * as C from '../conversations.js';
import * as L from '../leads.js';
import * as settings from '../settings.js';
import * as connect from '../connect.js';
import { normPhone } from '../bot-validate.js';
import { emit } from '../events.js';

const CONTACT = /^\/api\/v1\/contacts\/([^/]+)$/;
const MAX_NOTES = 200;
const MAX_APP_KEYS = 20;
const TYPE_RE = /^[a-z][a-z0-9-]{1,23}\.[a-z][a-z0-9_]{1,40}$/;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const err = (status, code, error) => ({ status, body: { error, code } });
const okRes = (body, status = 200) => ({ status, body });

const findLead = (phone, conv) => store.findByPhone(phone) || (conv?.lid && store.findByLid?.(conv.lid)) || null;

function publicContact(lead) {
  return {
    phone: lead.phone, name: lead.name || '', status: lead.status, apps: lead.apps || {},
    createdAt: lead.createdAt ?? null, lastContactAt: lead.lastCustomerMessageAt ?? lead.lastMessageAt ?? null,
  };
}

function cleanAppData(data) {
  if (!isObj(data)) throw Object.assign(new Error('data harus berupa objek'), { v: true });
  const out = {};
  for (const [k, v] of Object.entries(data).slice(0, MAX_APP_KEYS)) {
    const key = String(k).slice(0, 40);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw Object.assign(new Error(`Nama kunci data tidak valid: ${key}`), { v: true });
    if (typeof v === 'string') out[key] = v.slice(0, 500);
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean' || v === null) out[key] = v;
    else throw Object.assign(new Error(`Nilai data "${key}" harus string, angka, atau boolean`), { v: true });
  }
  return out;
}

const bad = (m) => err(400, 'VALIDATION', m);

function addNote(lead, app, text) {
  const notes = Array.isArray(lead.notes) ? lead.notes : [];
  if (notes.length >= MAX_NOTES) return;
  store.update(lead.id, { notes: [...notes, { id: randomUUID(), by: `app:${app.name}`, text: String(text).slice(0, 1000), ts: Date.now() }] });
}

// ---------------------------------------------------------------- Handler per endpoint

function putContact(ctx, phoneRaw, b) {
  const phone = normPhone(decodeURIComponent(phoneRaw));
  if (!phone) return bad('Nomor tidak valid (8-15 digit)');
  if (!isObj(b)) return bad('Body harus berupa objek JSON');
  let data = null;
  try { if (b.data !== undefined) data = cleanAppData(b.data); } catch (e) { if (e.v) return bad(e.message); throw e; }
  const name = String(b.name ?? '').trim().slice(0, 100);
  const note = String(b.note ?? '').trim();

  const conv = C.get(phone);
  let lead = findLead(phone, conv);
  let created = false;
  if (lead?.blocked || L.isBlocked({ phone, lid: conv?.lid })) return err(403, 'BLOCKED', 'Kontak ini diblokir');
  if (!lead) {
    const r = L.createFromConversation({ phone, lid: conv?.lid || null, name: name || conv?.name || '', firstMessage: '', customerCount: 0 });
    lead = r.lead;
    created = !r.existed;
    store.update(lead.id, { origin: `app:${ctx.app.app}` });
  }
  const patch = {};
  if (name && !lead.name) patch.name = name;
  if (data) patch.apps = { ...(lead.apps || {}), [ctx.app.app]: { ...((lead.apps || {})[ctx.app.app] || {}), ...data, updatedAt: new Date().toISOString() } };
  if (Object.keys(patch).length) lead = store.update(lead.id, patch);
  if (note) addNote(lead, ctx.app, note);
  ctx.audit('v1.contact.put', { phone, app: ctx.app.app, baru: created });
  return okRes({ contact: publicContact(store.findByPhone(phone) || lead), created }, created ? 201 : 200);
}

async function sendMessage(ctx, b) {
  if (!isObj(b)) return bad('Body harus berupa objek JSON');
  const phone = normPhone(b.phone);
  if (!phone) return bad('Nomor tidak valid (8-15 digit)');
  const text = String(b.text ?? '').trim();
  if (!text) return bad('Pesan kosong');
  if (text.length > 4000) return bad('Pesan terlalu panjang (maks 4000 karakter)');

  let conv = C.get(phone);
  const lead = findLead(phone, conv);
  if (lead?.blocked || L.isBlocked({ phone, lid: conv?.lid })) return err(403, 'BLOCKED', 'Kontak ini diblokir');
  if (!connect.takeMessageQuota(ctx.app.id)) return err(429, 'RATE_LIMIT', 'Batas pesan harian untuk kunci ini sudah tercapai');

  const jid = conv?.jid || `${phone}@s.whatsapp.net`;
  const dry = process.env.CONNECT_DRY_RUN === '1';
  let waId;
  if (dry) {
    waId = `dry-${randomUUID().slice(0, 8)}`;
  } else {
    try {
      const send = ctx.sendText || (await import('../whatsapp.js')).sendText;
      ({ waId } = (await send(jid, text)) || {});
    } catch (e) {
      const unavailable = e?.code === 'WA_NOT_CONNECTED' || e?.code === 'RATE_LIMIT_TIMEOUT';
      connect.refundMessageQuota(ctx.app.id);
      ctx.audit('v1.message.gagal', { phone, kode: e?.code || 'ERR' });
      return err(unavailable ? 503 : 502, unavailable ? 'WA_UNAVAILABLE' : 'SEND_FAILED', unavailable ? e.message : 'Gagal mengirim pesan WhatsApp');
    }
  }
  if (!conv) conv = C.getOrCreate(phone, jid, String(b.name ?? '').trim().slice(0, 100)).conv;
  const m = C.addMessage(conv, 'bot', text, Date.now());
  Object.assign(m, { type: 'text', status: 'sent', waId, replyKind: 'app', sender: `app:${ctx.app.name}` });
  C.save(conv);
  emit('message:new', { phone, by: 'bot', type: 'text' });
  ctx.audit('v1.message.kirim', { phone, app: ctx.app.app, dryRun: dry || undefined });
  return okRes({ ok: true, waId: waId || null, conversation: phone, dryRun: dry });
}

function postEvent(ctx, b) {
  if (!isObj(b)) return bad('Body harus berupa objek JSON');
  const type = String(b.type ?? '');
  if (!TYPE_RE.test(type)) return bad('type harus berbentuk "<app>.<aksi>", mis. booking.created');
  if (type.split('.')[0] !== ctx.app.app) return err(403, 'FORBIDDEN_SCOPE', `Kunci ini hanya boleh mengirim kejadian berawalan "${ctx.app.app}."`);
  const summary = String(b.summary ?? '').trim().slice(0, 500);
  if (!summary) return bad('summary wajib diisi');
  const phone = b.phone ? normPhone(b.phone) : null;
  if (b.phone && !phone) return bad('Nomor tidak valid (8-15 digit)');
  let recorded = false;
  if (phone) {
    const conv = C.get(phone);
    if (conv) {
      const m = C.addMessage(conv, 'system', summary, Date.now());
      Object.assign(m, { sender: `app:${ctx.app.name}`, eventType: type });
      C.save(conv);
      recorded = true;
    }
    const lead = findLead(phone, conv);
    if (lead) {
      addNote(lead, ctx.app, `[${type}] ${summary}`);
      recorded = true;
    }
  }
  emit('app:event', { app: ctx.app.app, type, phone });
  ctx.audit('v1.event', { type, phone, recorded });
  return okRes({ ok: true, recorded });
}

export async function handle(req, res, url, ctx) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/') || !ctx.app) return false;
  const m = req.method;
  const send = (r) => (ctx.sendJSON(res, r.status, r.body), true);
  const need = (scope) => {
    if (ctx.app.scopes.includes(scope)) return true;
    send(err(403, 'FORBIDDEN_SCOPE', `Kunci ini tidak punya scope ${scope}`));
    return false;
  };

  if (p === '/api/v1/ping' && m === 'GET') {
    let wa = 'unavailable';
    if (process.env.DISABLE_WA === '1') wa = 'disabled';
    else { try { wa = (await import('../whatsapp.js')).wa.status; } catch { /* modul WA tidak termuat */ } }
    const S = settings.get();
    return send(okRes({
      ok: true, contract: connect.CONTRACT, client: process.env.CLIENT_ID || '', brand: S.brandName,
      app: { id: ctx.app.id, name: ctx.app.name, scopes: ctx.app.scopes }, wa: { status: wa },
      dryRun: process.env.CONNECT_DRY_RUN === '1', time: new Date().toISOString(),
    }));
  }

  const cm = p.match(CONTACT);
  if (cm && m === 'GET') {
    if (!need('leads:read')) return true;
    const phone = normPhone(decodeURIComponent(cm[1]));
    if (!phone) return send(bad('Nomor tidak valid (8-15 digit)'));
    const lead = findLead(phone, C.get(phone));
    return send(lead ? okRes({ contact: publicContact(lead) }) : err(404, 'NOT_FOUND', 'Kontak tidak ditemukan'));
  }

  const writes = (cm && m === 'PUT') ? 'leads:write' : (p === '/api/v1/messages' && m === 'POST') ? 'messages:send' : (p === '/api/v1/events' && m === 'POST') ? 'events:write' : null;
  if (!writes) return false;
  if (!need(writes)) return true;

  let body;
  try {
    body = await ctx.readBody(req);
  } catch (e) {
    return send(err(e.status || 400, 'VALIDATION', e.message));
  }
  let idemKey;
  try { idemKey = connect.idemKeyFrom(req, body); } catch (e) { return send(err(400, 'VALIDATION', e.message)); }

  const run = async () => {
    if (cm) return putContact(ctx, cm[1], body);
    if (p === '/api/v1/messages') return await sendMessage(ctx, body);
    return postEvent(ctx, body);
  };
  const r = await connect.withIdempotency(ctx.app.id, idemKey, run);
  if (r.replay) res.setHeader('Idempotent-Replay', 'true');
  return send(r);
}
