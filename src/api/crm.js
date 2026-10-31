// API CRM: daftar lead, statistik, export CSV, detail, ubah, hapus, catatan, tindak lanjut, blokir.
// Dipanggil dispatcher: handle(req, res, url, ctx) -> true bila sudah menangani.
// Fungsi baru milik F1 (src/leads.js) dipanggil lewat namespace agar modul ini tetap termuat
// walau ekspornya belum ada; bila hilang, endpoint terkait menjawab 501.
import { createHash, randomUUID } from 'node:crypto';
import * as store from '../store.js';
import * as C from '../conversations.js';
import * as L from '../leads.js';
import * as settings from '../settings.js';

const DEFAULT_TZ = 'Asia/Jakarta';
const SORTS = ['createdAt', 'lastContactAt', 'name', 'status', 'platform'];
const PERIODS = ['day', 'week', 'month', 'year'];
const MAX_NOTES = 200;
const SUB_ROUTE = /^\/api\/leads\/([\w-]+)(?:\/(notes|followup|transaction-done|block|unblock)(?:\/([\w-]+))?)?$/;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const truthy = (v) => v === true || v === 'on' || v === 'true' || v === 1 || v === '1';
const pad = (n) => String(n).padStart(2, '0');

// ---------- timezone ----------
const fmtCache = new Map();
function dtf(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function getTz() {
  let tz;
  try { tz = L.getConfig?.().timezone; } catch { /* config rusak: pakai bawaan */ }
  if (typeof tz !== 'string' || !tz) return DEFAULT_TZ;
  try { dtf(tz); return tz; } catch { return DEFAULT_TZ; }
}

function parts(ts, tz) {
  const o = {};
  for (const p of dtf(tz).formatToParts(new Date(ts))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}

const offsetMs = (ts, tz) => {
  const p = parts(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000;
};

/** Epoch ms awal hari (00:00 lokal) untuk y-m-d di tz; m/d boleh melimpah (m=13 -> Januari berikutnya). */
function startOfDay(y, m, d, tz) {
  const guess = Date.UTC(y, m - 1, d);
  let ts = guess - offsetMs(guess, tz);
  ts = guess - offsetMs(ts, tz);
  return ts;
}

export function dayKey(ts, tz) {
  const p = parts(ts, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

const stamp = (ts, tz) => {
  if (!num(ts)) return '';
  const p = parts(ts, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
};

function periodRange(period, now, tz) {
  const { y, m, d } = parts(now, tz);
  const S = (yy, mm, dd) => startOfDay(yy, mm, dd, tz);
  switch (period) {
    case 'day': return { from: S(y, m, d), to: S(y, m, d + 1), prevFrom: S(y, m, d - 1), prevTo: S(y, m, d) };
    case 'week': return { from: S(y, m, d - 6), to: S(y, m, d + 1), prevFrom: S(y, m, d - 13), prevTo: S(y, m, d - 6) };
    case 'month': return { from: S(y, m, 1), to: S(y, m + 1, 1), prevFrom: S(y, m - 1, 1), prevTo: S(y, m, 1) };
    default: return { from: S(y, 1, 1), to: S(y + 1, 1, 1), prevFrom: S(y - 1, 1, 1), prevTo: S(y, 1, 1) };
  }
}

// ---------- tampilan lead ----------
/** Salinan lead dengan default terisi; lead lama tidak pernah menyebabkan error. */
function norm(l) {
  let n;
  try { n = typeof L.normalizeLead === 'function' ? { ...L.normalizeLead(l) } : { ...l }; } catch { n = { ...l }; }
  for (const k of ['notes', 'statusHistory', 'warmReasons', 'transactionCycles']) if (!Array.isArray(n[k])) n[k] = [];
  n.data = { ...C.dataFor(n.phone), ...(isObj(n.data) ? n.data : {}) };
  n.warmScore = num(n.warmScore);
  n.hotCandidate = isObj(n.hotCandidate) ? n.hotCandidate : null;
  n.source = isObj(n.source) ? n.source : null;
  n.blocked = n.blocked === true;
  // normalizeLead mengisi lastCustomerMessageAt dari lastMessageAt (lead lama); untuk "menunggu balasan" hanya nilai asli yang dipercaya.
  n.lastCustomerMessageAt = l.lastCustomerMessageAt ?? null;
  return n;
}

function derive(n, today) {
  const last = Math.max(num(n.lastCustomerMessageAt), num(n.lastReplyAt), num(n.lastMessageAt));
  return {
    noteCount: n.notes.length,
    awaitingReply: num(n.lastCustomerMessageAt) > num(n.lastReplyAt),
    lastContactAt: last || null,
    followUpOverdue: typeof n.followUpDate === 'string' && n.followUpDate < today,
  };
}

function listItem(l, today) {
  const n = norm(l);
  const { notes, statusHistory, ...rest } = n;
  return { ...rest, ...derive(n, today) };
}

const detailView = (l, today = dayKey(Date.now(), getTz())) => {
  const n = norm(l);
  return { ...n, ...derive(n, today) };
};

// ---------- query daftar ----------
function parseQuery(sp, tz) {
  const sort = sp.get('sort') || 'lastContactAt';
  if (!SORTS.includes(sort)) return { error: 'Parameter sort tidak valid' };
  const dir = sp.get('dir') || 'desc';
  if (dir !== 'asc' && dir !== 'desc') return { error: 'Parameter dir harus asc atau desc' };
  const intOr = (v, d) => (Number.isInteger(Number(v)) && Number(v) >= 1 ? Number(v) : d);
  return {
    q: (sp.get('q') || '').trim().toLowerCase(),
    status: sp.get('status') || '', platform: sp.get('platform') || '', dataType: sp.get('dataType') || '',
    awaiting: sp.get('awaiting') === '1', overdue: sp.get('overdue') === '1', blocked: sp.get('blocked') === '1',
    sort, dir,
    page: intOr(sp.get('page'), 1),
    pageSize: Math.min(100, intOr(sp.get('pageSize'), 25)),
    today: dayKey(Date.now(), tz),
  };
}

function select(o) {
  const items = [];
  for (const l of store.all()) {
    if (l.blocked === true && !o.blocked) continue;
    const it = listItem(l, o.today);
    if (o.status && it.status !== o.status) continue;
    if (o.platform && it.platform !== o.platform) continue;
    if (o.dataType && it.dataType !== o.dataType) continue;
    if (o.awaiting && !it.awaitingReply) continue;
    if (o.overdue && !it.followUpOverdue) continue;
    if (o.q && ![it.name, it.phone, it.keyword].some((v) => String(v ?? '').toLowerCase().includes(o.q))) continue;
    items.push(it);
  }
  const rank = (s) => store.STATUSES.indexOf(s);
  const text = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'id', { sensitivity: 'base' });
  const by = {
    createdAt: (a, b) => num(a.createdAt) - num(b.createdAt),
    lastContactAt: (a, b) => num(a.lastContactAt) - num(b.lastContactAt),
    name: (a, b) => text(a.name, b.name),
    status: (a, b) => rank(a.status) - rank(b.status),
    platform: (a, b) => text(a.platform, b.platform),
  }[o.sort];
  const sign = o.dir === 'asc' ? 1 : -1;
  items.sort((a, b) => sign * by(a, b) || num(b.createdAt) - num(a.createdAt) || String(a.id).localeCompare(String(b.id)));
  return items;
}

function sendCached(req, res, body) {
  const text = JSON.stringify(body);
  const etag = '"' + createHash('sha1').update(text).digest('base64url').slice(0, 22) + '"';
  const inm = String(req.headers?.['if-none-match'] || '');
  const hit = inm && inm.split(',').some((t) => t.trim() === '*' || t.trim().replace(/^W\//, '') === etag);
  const h = { 'Cache-Control': 'private, no-cache', ETag: etag, 'X-Content-Type-Options': 'nosniff' };
  if (hit) { res.writeHead(304, h); res.end(); return; }
  res.writeHead(200, { ...h, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

// ---------- statistik ----------
export function computeStats(period, tz, now = Date.now()) {
  const r = periodRange(period, now, tz);
  const live = store.all().filter((l) => l.blocked !== true);
  const inR = (ts, a, b) => typeof ts === 'number' && ts >= a && ts < b;
  const cohort = live.filter((l) => inR(l.createdAt, r.from, r.to));
  const prevTotal = live.filter((l) => inR(l.createdAt, r.prevFrom, r.prevTo)).length;

  const entered = { 'Cold Leads': 0, 'Warm Leads': 0, 'Hot Leads': 0 };
  for (const l of live) {
    const hist = Array.isArray(l.statusHistory) && l.statusHistory.length ? l.statusHistory : [{ status: l.status, ts: l.createdAt }];
    const seen = new Set();
    for (const h of hist) if (h && Object.hasOwn(entered, h.status) && inR(h.ts, r.from, r.to)) seen.add(h.status);
    for (const s of seen) entered[s]++;
  }

  const total = cohort.length;
  const nowHot = cohort.filter((l) => l.status === 'Hot Leads').length;
  const warmUp = cohort.filter((l) => l.status === 'Warm Leads' || l.status === 'Hot Leads').length;
  const src = new Map();
  for (const l of cohort) src.set(l.platform || 'Lainnya', (src.get(l.platform || 'Lainnya') || 0) + 1);

  return {
    period, from: r.from, to: r.to, fromDate: dayKey(r.from, tz), toDate: dayKey(r.to - 1, tz),
    total, cold: entered['Cold Leads'], warm: entered['Warm Leads'], hot: entered['Hot Leads'],
    cohortHotRate: total ? Math.round((nowHot / total) * 1000) / 10 : 0,
    prevTotal, deltaPct: prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : null,
    funnel: [{ label: 'Semua lead', value: total }, { label: 'Warm + Hot', value: warmUp }, { label: 'Hot', value: nowHot }],
    bySource: [...src].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })),
    tz,
  };
}

// ---------- CSV ----------
const cell = (v, guard = true) => {
  let s = String(v ?? '');
  if (guard && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // cegah formula injection
  return '"' + s.replace(/"/g, '""') + '"';
};

function buildCSV(items, tz) {
  let labels = {};
  try { labels = Object.fromEntries((settings.get().requiredFields || []).map((f) => [f.id, f.label])); } catch { /* pakai id */ }
  const head = ['Nama', 'No WA', 'Sumber', 'Keyword', 'Status', 'Data Leads', 'Tanggal Masuk', 'Kontak Terakhir', 'Follow-up', 'Data Wajib', 'Catatan'];
  const lines = items.map((l) => {
    const full = store.all().find((x) => x.id === l.id);
    const notes = (Array.isArray(full?.notes) ? full.notes : []).map((n) => `${n.by}: ${n.text}`).join(' | ');
    const fu = l.followUpDate ? l.followUpDate + (l.followUpNote ? ` (${l.followUpNote})` : '') : '';
    const phone = String(l.phone ?? '');
    return [
      cell(l.name), cell(phone, !/^\+?\d+$/.test(phone)), cell(l.platform), cell(l.keyword), cell(l.status), cell(l.dataType),
      cell(stamp(l.createdAt, tz), false), cell(stamp(l.lastContactAt, tz), false), cell(fu, !/^\d{4}-/.test(fu)),
      cell(Object.entries(l.data || {}).map(([k, v]) => `${labels[k] || k}: ${v}`).join('; ')), cell(notes),
    ].join(',');
  });
  return '\ufeff' + [head.map((h) => cell(h, false)).join(','), ...lines].join('\r\n') + '\r\n';
}

// ---------- validasi tanggal ----------
function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// ---------- handler utama ----------
export async function handle(req, res, url, ctx) {
  const p = url.pathname;
  if (p !== '/api/leads' && !p.startsWith('/api/leads/')) return false;
  const m = req.method;
  const send = (code, body) => (ctx.sendJSON(res, code, body), true);
  const fail = (code, msg) => send(code, { error: msg });
  const notAllowed = () => fail(405, 'Metode tidak diizinkan');
  const who = ctx.user?.name || 'pengguna';

  const readJSON = async () => {
    try {
      const b = await ctx.readBody(req);
      if (isObj(b)) return b;
    } catch { /* jatuh ke 400 */ }
    fail(400, 'Isi permintaan tidak valid');
    return null;
  };

  try {
    // Rute tetap dicek SEBELUM pola :id.
    if (p === '/api/leads') {
      if (m !== 'GET') return notAllowed();
      const tz = getTz();
      const o = parseQuery(url.searchParams, tz);
      if (o.error) return fail(400, o.error);
      const items = select(o);
      const pages = Math.max(1, Math.ceil(items.length / o.pageSize));
      const page = Math.min(o.page, pages);
      const platforms = [...new Set([...L.platformNames(), ...store.all().map((l) => l.platform).filter(Boolean)])];
      sendCached(req, res, {
        leads: items.slice((page - 1) * o.pageSize, page * o.pageSize), total: items.length, page, pageSize: o.pageSize,
        statuses: store.STATUSES, dataTypes: store.DATA_TYPES, platforms, tz,
      });
      return true;
    }

    if (p === '/api/leads/stats') {
      if (m !== 'GET') return notAllowed();
      const period = url.searchParams.get('period') || 'day';
      if (!PERIODS.includes(period)) return fail(400, 'Periode tidak valid (day, week, month, year)');
      return send(200, computeStats(period, getTz()));
    }

    if (p === '/api/leads/export.csv') {
      if (m !== 'GET') return notAllowed();
      const tz = getTz();
      const o = parseQuery(url.searchParams, tz);
      if (o.error) return fail(400, o.error);
      const items = select(o);
      const csv = buildCSV(items, tz);
      ctx.audit('lead.export', { count: items.length });
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="leads-${dayKey(Date.now(), tz)}.csv"`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      });
      res.end(csv);
      return true;
    }

    if (p === '/api/leads/from-conversation') {
      if (m !== 'POST') return notAllowed();
      const b = await readJSON();
      if (!b) return true;
      const phone = String(b.phone ?? '').replace(/\D/g, '');
      if (phone.length < 6 || phone.length > 20) return fail(400, 'Nomor telepon tidak valid');
      const conv = C.get(phone);
      if (!conv) return fail(404, 'Percakapan tidak ditemukan');
      if (typeof L.createFromConversation !== 'function') return fail(501, 'Pembuatan lead dari percakapan belum tersedia');
      const mine = (Array.isArray(conv.messages) ? conv.messages : []).filter((x) => x.by === 'customer');
      const r = L.createFromConversation({
        phone, lid: conv.lid || null, name: conv.name || '', firstMessage: mine[0]?.text || '',
        ts: mine[0]?.ts || conv.createdAt || Date.now(), customerCount: mine.length, data: conv.data || {},
      });
      ctx.audit('lead.create', { id: r.lead?.id, phone, existed: !!r.existed });
      return send(r.existed ? 200 : 201, { lead: detailView(r.lead), existed: !!r.existed });
    }

    const mm = p.match(SUB_ROUTE);
    if (!mm) return false;
    const [, id, sub, sub2] = mm;
    if (sub2 && sub !== 'notes') return false;
    const find = () => store.all().find((l) => l.id === id);
    const gone = () => fail(404, 'Lead tidak ditemukan');

    // ----- detail / ubah / hapus -----
    if (!sub) {
      if (m === 'GET') { const l = find(); return l ? send(200, { lead: detailView(l) }) : gone(); }

      if (m === 'DELETE') {
        if (!ctx.requireRole('admin')) return true;
        const l = find();
        if (!l) return gone();
        store.remove(id);
        ctx.audit('lead.delete', { id, phone: l.phone ?? null }); // percakapan tidak ikut terhapus
        return send(200, { ok: true });
      }

      if (m === 'PATCH') {
        const cur = find();
        if (!cur) return gone();
        const b = await readJSON();
        if (!b) return true;
        const patch = {}, fields = [], now = Date.now();
        for (const k of ['name', 'keyword', 'platform']) {
          if (!(k in b)) continue;
          if (typeof b[k] !== 'string') return fail(400, `Field ${k} harus berupa teks`);
          const v = b[k].trim().slice(0, 200);
          if (k === 'platform' && !v) return fail(400, 'Sumber tidak boleh kosong');
          patch[k] = v; fields.push(k);
        }
        const reset = truthy(b.resetAuto), confirmHot = truthy(b.confirmHot);
        if (reset && confirmHot) return fail(400, 'resetAuto dan confirmHot tidak bisa dipakai bersamaan');

        const hist = [...norm(cur).statusHistory];
        const manualStatus = (status) => {
          if (!hist.length) hist.push({ status: cur.status, ts: num(cur.createdAt) || now, reason: 'Status awal' });
          hist.push({ status, ts: now, reason: `Diubah manual oleh ${who}` });
          Object.assign(patch, { status, statusManual: true, statusReason: 'Diubah manual', statusHistory: hist });
          if (status === 'Hot Leads') patch.hotCandidate = null;
        };
        if (reset) {
          // kembalikan ke otomatis: sistem boleh mengubah status/data leads lagi mulai pesan berikutnya
          Object.assign(patch, { statusManual: false, dataTypeManual: false });
          fields.push('resetAuto');
        } else {
          if (confirmHot) {
            if (cur.status !== 'Hot Leads') manualStatus('Hot Leads');
            Object.assign(patch, { statusManual: true, hotCandidate: null });
            fields.push('confirmHot');
          } else if ('status' in b) {
            if (!store.STATUSES.includes(b.status)) return fail(400, 'Status tidak valid');
            if (b.status !== cur.status) manualStatus(b.status);
            fields.push('status');
          }
          if ('dataType' in b) {
            if (!store.DATA_TYPES.includes(b.dataType)) return fail(400, 'Data Leads tidak valid');
            if (b.dataType !== cur.dataType) Object.assign(patch, { dataType: b.dataType, dataTypeManual: true, dataReason: 'Diubah manual' });
            fields.push('dataType');
          }
        }
        if (!fields.length) return fail(400, 'Tidak ada field yang bisa diubah');
        const lead = store.update(id, patch);
        ctx.audit('lead.update', { id, fields });
        return send(200, { lead: detailView(lead) });
      }
      return notAllowed();
    }

    // ----- blokir (hanya admin) -----
    if (sub === 'block' || sub === 'unblock') {
      if (m !== 'POST') return notAllowed();
      if (!ctx.requireRole('admin')) return true;
      const l = find();
      if (!l) return gone();
      const fn = L[sub];
      if (typeof fn !== 'function') return fail(501, 'Fitur blokir belum tersedia');
      if (!l.phone && !l.lid) return fail(400, 'Lead tidak punya nomor atau LID untuk diblokir');
      fn({ phone: l.phone ?? null, lid: l.lid ?? null });
      const lead = store.update(id, { blocked: sub === 'block' });
      ctx.audit('lead.' + sub, { id });
      return send(200, { lead: detailView(lead) });
    }

    const cur = find();
    if (!cur) return gone();

    // ----- catatan -----
    if (sub === 'notes') {
      const notes = Array.isArray(cur.notes) ? cur.notes : [];
      if (m === 'POST' && !sub2) {
        const b = await readJSON();
        if (!b) return true;
        const text = typeof b.text === 'string' ? b.text.trim() : '';
        if (!text) return fail(400, 'Catatan tidak boleh kosong');
        if (text.length > 1000) return fail(400, 'Catatan maksimal 1000 karakter');
        if (notes.length >= MAX_NOTES) return fail(400, `Batas ${MAX_NOTES} catatan per lead sudah tercapai`);
        const note = { id: randomUUID(), by: who, text, ts: Date.now() };
        store.update(id, { notes: [...notes, note] });
        ctx.audit('lead.note.add', { id, noteId: note.id });
        return send(201, { note, noteCount: notes.length + 1 });
      }
      if (m === 'DELETE' && sub2) {
        const note = notes.find((n) => n.id === sub2);
        if (!note) return fail(404, 'Catatan tidak ditemukan');
        if (note.by !== ctx.user?.name && ctx.user?.role !== 'admin') return fail(403, 'Hanya penulis catatan atau admin yang boleh menghapus');
        store.update(id, { notes: notes.filter((n) => n.id !== sub2) });
        ctx.audit('lead.note.delete', { id, noteId: sub2 });
        return send(200, { ok: true, noteCount: notes.length - 1 });
      }
      return notAllowed();
    }

    // ----- tindak lanjut -----
    if (sub === 'followup') {
      if (m !== 'PUT') return notAllowed();
      const b = await readJSON();
      if (!b) return true;
      if (!('date' in b)) return fail(400, 'Field date wajib diisi (YYYY-MM-DD atau null)');
      if (b.date !== null && !validDate(b.date)) return fail(400, 'Format tanggal harus YYYY-MM-DD dan tanggalnya harus valid');
      const note = b.note == null ? '' : b.note;
      if (typeof note !== 'string') return fail(400, 'Catatan tindak lanjut harus berupa teks');
      if (note.trim().length > 300) return fail(400, 'Catatan tindak lanjut maksimal 300 karakter');
      const lead = store.update(id, { followUpDate: b.date, followUpNote: b.date === null ? '' : note.trim() });
      ctx.audit('lead.followup', { id, date: b.date });
      return send(200, { lead: detailView(lead) });
    }

    // ----- transaksi selesai -----
    if (sub === 'transaction-done') {
      if (m !== 'POST') return notAllowed();
      if (typeof L.markTransactionDone !== 'function') return fail(501, 'Fitur transaksi selesai belum tersedia');
      const hasOpen = norm(cur).transactionCycles.some((c) => c && !c.doneAt);
      if (!hasOpen) return fail(400, 'Tidak ada transaksi terbuka untuk ditandai selesai');
      const patch = L.markTransactionDone(cur, Date.now());
      if (!isObj(patch) || !Object.keys(patch).length) return fail(400, 'Tidak ada transaksi terbuka untuk ditandai selesai');
      const lead = store.update(id, patch);
      ctx.audit('lead.transaction-done', { id });
      return send(200, { lead: detailView(lead) });
    }

    return false;
  } catch (e) {
    console.error('[crm]', e);
    return fail(500, 'Terjadi kesalahan pada server');
  }
}
