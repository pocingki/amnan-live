// SALINAN routes.js LAMA (sebelum dispatcher K1). Dimuat PALING AKHIR, jadi hanya menangani
// endpoint yang belum diambil alih modul lain di src/api/. Hapus bagian yang sudah dipindah.
// Perubahan dari aslinya: path import, tanda tangan handle(), /api/me pindah ke auth.js, dan ctx.audit.
import * as store from '../store.js';
import * as C from '../conversations.js';
import * as settings from '../settings.js';
import * as bot from '../bot.js';
import { platformNames } from '../leads.js';
import { wa, sendText, logout as logoutWA } from '../whatsapp.js';

const CONV = /^\/api\/conversations\/(\d+)(?:\/(mode|send|delete-messages))?$/;
const LEAD = /^\/api\/leads\/([\w-]+)$/;

export async function handle(req, res, url, { sendJSON, readBody, audit }) {
  const p = url.pathname;
  const m = req.method;
  const ok = (b = { ok: true }) => (sendJSON(res, 200, b), true);
  const fail = (code, msg) => (sendJSON(res, code, { error: msg }), true);

  if (m === 'GET' && p === '/api/wa/status') return ok({ status: wa.status, qr: wa.qr, number: wa.number, error: wa.error, unread: C.totalUnread() });
  if (m === 'POST' && p === '/api/wa/logout') return await logoutWA(), audit('wa.logout'), ok();

  if (p === '/api/settings') {
    if (m === 'GET') return ok(settings.get());
    if (m === 'PUT') {
      const next = settings.update(await readBody(req));
      audit('pengaturan.ubah');
      return ok(next);
    }
  }

  // ----- CRM -----
  if (m === 'GET' && p === '/api/leads') {
    return ok({
      leads: store.all().map((l) => ({ ...l, data: C.dataFor(l.phone) })),
      statuses: store.STATUSES, dataTypes: store.DATA_TYPES, platforms: platformNames(),
    });
  }
  const lm = p.match(LEAD);
  if (lm && m === 'DELETE') {
    if (!store.remove(lm[1])) return fail(404, 'Lead tidak ditemukan');
    audit('lead.hapus', { id: lm[1] });
    return ok();
  }
  if (lm && m === 'PATCH') {
    const b = await readBody(req);
    const cur = store.all().find((l) => l.id === lm[1]);
    if (!cur) return fail(404, 'Lead tidak ditemukan');
    const patch = {};
    for (const k of ['name', 'keyword', 'platform']) if (k in b) patch[k] = String(b[k]).trim().slice(0, 200);
    if (b.resetAuto) {
      // kembalikan ke otomatis: sistem boleh mengubah status/data leads lagi mulai pesan berikutnya
      patch.statusManual = false;
      patch.dataTypeManual = false;
    } else {
      if ('status' in b) {
        if (!store.STATUSES.includes(b.status)) return fail(400, 'Status tidak valid');
        if (b.status !== cur.status) Object.assign(patch, { status: b.status, statusManual: true, statusReason: 'Diubah manual' });
      }
      if ('dataType' in b) {
        if (!store.DATA_TYPES.includes(b.dataType)) return fail(400, 'Data Leads tidak valid');
        if (b.dataType !== cur.dataType) Object.assign(patch, { dataType: b.dataType, dataTypeManual: true, dataReason: 'Diubah manual' });
      }
    }
    return ok({ lead: store.update(cur.id, patch) });
  }

  // ----- Percakapan masuk -----
  if (m === 'GET' && p === '/api/conversations') return ok({ conversations: C.list() });
  const cm = p.match(CONV);
  if (cm) {
    const conv = C.get(cm[1]);
    if (!conv) return fail(404, 'Percakapan tidak ditemukan');
    const act = cm[2];
    if (!act && m === 'GET') {
      if (conv.unread) {
        conv.unread = 0;
        C.save();
      }
      return ok(bot.view(conv));
    }
    if (!act && m === 'DELETE') return C.remove(conv.phone), audit('percakapan.hapus', { phone: conv.phone }), ok();
    if (act === 'mode' && m === 'POST') {
      const b = await readBody(req);
      if (!['bot', 'admin'].includes(b.mode)) return fail(400, 'Mode tidak valid');
      bot.setMode(conv, b.mode);
      C.save();
      return ok({ mode: conv.mode });
    }
    if (act === 'send' && m === 'POST') {
      const text = String((await readBody(req)).text ?? '').trim();
      if (!text) return fail(400, 'Pesan kosong');
      if (conv.mode !== 'admin') return fail(409, 'Take over admin dulu untuk membalas');
      try {
        await sendText(conv.jid, text);
      } catch (e) {
        return fail(502, e.message);
      }
      const message = C.addMessage(conv, 'admin', text);
      conv.adminLastAt = message.ts;
      C.save();
      return ok({ message });
    }
    if (act === 'delete-messages' && m === 'POST') {
      const ids = (await readBody(req)).ids;
      if (!Array.isArray(ids)) return fail(400, 'ids harus berupa array');
      C.removeMessages(conv, ids);
      audit('pesan.hapus', { phone: conv.phone, jumlah: ids.length });
      return ok();
    }
  }

  // ----- Bot tester (banyak nomor uji; tidak menyentuh CRM asli) -----
  if (p === '/api/tester' && m === 'GET') {
    const phone = bot.normPhone(url.searchParams.get('phone'));
    return phone ? ok(bot.testerView(phone)) : fail(400, 'Nomor uji tidak valid (8-15 digit)');
  }
  if (p.startsWith('/api/tester/') && m === 'POST') {
    const b = await readBody(req);
    const act = p.slice('/api/tester/'.length);
    if (act === 'reset' && !b.phone) return bot.testerReset(), ok(); // reset semua nomor uji
    const phone = bot.normPhone(b.phone);
    if (!phone) return fail(400, 'Nomor uji tidak valid (8-15 digit)');
    if (act === 'send') {
      const text = String(b.text ?? '').trim().slice(0, 2000);
      return text ? ok(bot.testerSend(phone, text)) : fail(400, 'Pesan kosong');
    }
    if (act === 'reset') return bot.testerReset(phone), ok();
    if (act === 'mode') return ['bot', 'admin'].includes(b.mode) ? ok({ status: bot.testerMode(phone, b.mode) }) : fail(400, 'Mode tidak valid');
    if (act === 'advance') {
      const h = Number(b.hours);
      return h > 0 && h <= 24 * 365 ? ok(bot.testerAdvance(phone, h)) : fail(400, 'Jam tidak valid');
    }
  }

  return false;
}