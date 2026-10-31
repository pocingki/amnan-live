// Uji API CRM (src/api/crm.js). Jalankan: node --test test/crm-api.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
process.env.KEYWORDS_FILE = path.join(process.env.DATA_DIR, 'keywords.test.json');
const baseCfg = JSON.parse(fs.readFileSync('config/keywords.json', 'utf8'));
const setTz = (timezone) => fs.writeFileSync(process.env.KEYWORDS_FILE, JSON.stringify({ ...baseCfg, leadRule: 'all', timezone }));
setTz('Asia/Jakarta');

const store = await import('../src/store.js');
const C = await import('../src/conversations.js');
const L = await import('../src/leads.js');
const { handle } = await import('../src/api/crm.js');

const ADMIN = { name: 'Rina', role: 'admin' };
const AGENT = { name: 'Budi', role: 'agent' };
const DAY = 864e5;

async function call(method, urlPath, { body, user = ADMIN, headers = {} } = {}) {
  const audits = [];
  const out = { status: 0, headers: {}, text: '', audits, handled: undefined, viaSendJSON: false };
  const res = {
    writeHead(code, h = {}) { out.status = code; out.headers = { ...out.headers, ...h }; },
    end(t = '') { out.text += t; },
  };
  const ctx = {
    sendJSON(r, code, b) { out.viaSendJSON = true; out.status = code; out.text = JSON.stringify(b); },
    readBody: async () => body,
    user, ip: '127.0.0.1',
    audit: (action, detail) => audits.push({ action, detail }),
    requireRole(role) {
      if (user.role === role) return true;
      ctx.sendJSON(res, 403, { error: 'Akses ditolak' });
      return false;
    },
  };
  const req = { method, headers, url: urlPath };
  out.handled = await handle(req, res, new URL(urlPath, 'http://x'), ctx);
  try { out.json = JSON.parse(out.text); } catch { out.json = null; }
  return out;
}

const reset = () => { for (const l of [...store.all()]) store.remove(l.id); };
const mk = (o = {}) => store.add({
  phone: '62811' + Math.floor(Math.random() * 1e7), name: 'Tes', platform: 'Instagram', keyword: 'harga', status: 'Cold Leads', dataType: 'New',
  createdAt: Date.now(), lastMessageAt: Date.now(), ...o,
});
const withNow = async (iso, fn) => {
  const real = Date.now;
  Date.now = () => Date.parse(iso);
  try { return await fn(); } finally { Date.now = real; }
};

test('daftar: filter q (tidak peka huruf besar), status, sumber, dataType', async () => {
  reset();
  mk({ name: 'Ayu Lestari', phone: '6281100001', keyword: 'booking' });
  mk({ name: 'Budi', phone: '6281100002', platform: 'Facebook', status: 'Hot Leads' });
  mk({ name: 'Citra', phone: '6281100003', dataType: 'Existing' });
  const q = async (s) => (await call('GET', '/api/leads?' + s)).json;
  assert.deepEqual((await q('q=AYU')).leads.map((l) => l.name), ['Ayu Lestari']);
  assert.equal((await q('q=81100002')).total, 1);
  assert.equal((await q('q=BOOKING')).total, 1);
  assert.equal((await q('status=Hot Leads')).leads[0].name, 'Budi');
  assert.equal((await q('platform=Facebook')).total, 1);
  assert.equal((await q('dataType=Existing')).leads[0].name, 'Citra');
  const all = await q('');
  assert.equal(all.total, 3);
  assert.deepEqual(all.statuses, store.STATUSES);
  assert.equal(all.tz, 'Asia/Jakarta');
});

test('daftar: awaiting dan overdue', async () => {
  reset();
  const now = Date.now();
  mk({ name: 'Menunggu', lastCustomerMessageAt: now, lastReplyAt: now - 1000 });
  mk({ name: 'Sudah dibalas', lastCustomerMessageAt: now - 5000, lastReplyAt: now });
  mk({ name: 'Belum pernah dibalas', lastCustomerMessageAt: now });
  mk({ name: 'Lewat', followUpDate: '2000-01-01' });
  mk({ name: 'Nanti', followUpDate: '2999-01-01' });
  const names = async (s) => (await call('GET', '/api/leads?' + s)).json.leads.map((l) => l.name).sort();
  assert.deepEqual(await names('awaiting=1'), ['Belum pernah dibalas', 'Menunggu']);
  assert.deepEqual(await names('overdue=1'), ['Lewat']);
});

test('daftar: sort, arah, paginasi, batas pageSize', async () => {
  reset();
  for (const [n, t] of [['Citra', 3], ['Ayu', 1], ['Dewi', 4], ['Budi', 2], ['Eka', 5]]) mk({ name: n, createdAt: t * 1000, lastMessageAt: t * 1000 });
  const get = async (s) => (await call('GET', '/api/leads?' + s)).json;
  assert.deepEqual((await get('')).leads.map((l) => l.name), ['Eka', 'Dewi', 'Citra', 'Budi', 'Ayu']); // default lastContactAt desc
  assert.deepEqual((await get('sort=name&dir=asc')).leads.map((l) => l.name), ['Ayu', 'Budi', 'Citra', 'Dewi', 'Eka']);
  const p2 = await get('sort=name&dir=asc&pageSize=2&page=2');
  assert.deepEqual(p2.leads.map((l) => l.name), ['Citra', 'Dewi']);
  assert.equal(p2.total, 5); assert.equal(p2.page, 2); assert.equal(p2.pageSize, 2);
  assert.equal((await get('sort=name&dir=asc&pageSize=2&page=99')).page, 3); // dijepit ke halaman terakhir
  assert.equal((await get('pageSize=9999')).pageSize, 100);
  assert.equal((await get('pageSize=abc')).pageSize, 25);
  assert.equal((await call('GET', '/api/leads?sort=password')).status, 400);
  assert.equal((await call('GET', '/api/leads?dir=sideways')).status, 400);
});

test('daftar: bentuk item, data digabung dengan percakapan, lead lama tidak error', async () => {
  reset();
  const { conv } = C.getOrCreate('6281300001', '6281300001@s.whatsapp.net', 'Lama');
  conv.data = { nama: 'Dari percakapan', kebutuhan: 'Lutut' };
  mk({
    phone: '6281300001', name: 'Lama', notes: [{ id: 'n1', by: 'Rina', text: 'x', ts: 1 }], statusHistory: [{ status: 'Cold Leads', ts: 1, reason: 'a' }],
    lastCustomerMessageAt: 100, lastReplyAt: 300, lastMessageAt: 200, data: { nama: 'Dari lead' }, hotCandidate: { ts: 5, reason: 'bukti' }, warmScore: 7, warmReasons: ['aktif'],
  });
  mk({ phone: null, lid: 'abc@lid', name: 'Hanya LID' }); // tanpa field baru, tanpa phone
  const { leads } = (await call('GET', '/api/leads')).json;
  const a = leads.find((l) => l.name === 'Lama');
  assert.equal(a.noteCount, 1);
  assert.ok(!('notes' in a) && !('statusHistory' in a));
  assert.equal(a.lastContactAt, 300);
  assert.equal(a.awaitingReply, false);
  assert.deepEqual(a.data, { nama: 'Dari lead', kebutuhan: 'Lutut' });
  assert.equal(a.hotCandidate.reason, 'bukti'); assert.equal(a.warmScore, 7); assert.deepEqual(a.warmReasons, ['aktif']);
  const b = leads.find((l) => l.name === 'Hanya LID');
  assert.equal(b.noteCount, 0); assert.equal(b.hotCandidate, null); assert.equal(b.followUpOverdue, false);
});

test('daftar: lead terblokir tersembunyi kecuali blocked=1', async () => {
  reset();
  mk({ name: 'Normal' });
  mk({ name: 'Diblokir', blocked: true });
  assert.deepEqual((await call('GET', '/api/leads')).json.leads.map((l) => l.name), ['Normal']);
  assert.equal((await call('GET', '/api/leads?blocked=1')).json.total, 2);
});

test('ETag: 200 dengan Cache-Control private, no-cache; 304 bila If-None-Match cocok; berubah saat data berubah', async () => {
  reset();
  mk({ name: 'Satu' });
  const r1 = await call('GET', '/api/leads');
  assert.equal(r1.status, 200);
  assert.equal(r1.viaSendJSON, false); // ditulis sendiri, bukan lewat sendJSON (no-store)
  assert.equal(r1.headers['Cache-Control'], 'private, no-cache');
  const etag = r1.headers.ETag;
  assert.match(etag, /^"[\w-]+"$/);
  const r2 = await call('GET', '/api/leads', { headers: { 'if-none-match': etag } });
  assert.equal(r2.status, 304); assert.equal(r2.text, '');
  assert.equal((await call('GET', '/api/leads', { headers: { 'if-none-match': 'W/' + etag } })).status, 304);
  mk({ name: 'Dua' });
  const r3 = await call('GET', '/api/leads', { headers: { 'if-none-match': etag } });
  assert.equal(r3.status, 200); assert.notEqual(r3.headers.ETag, etag);
});

test('stats: batas hari mengikuti timezone (Asia/Jakarta vs America/New_York)', async () => {
  reset();
  // sekarang = 2026-03-10 18:00 UTC = 11 Mar 01:00 WIB = 10 Mar 14:00 EDT
  mk({ name: 'A', createdAt: Date.parse('2026-03-10T17:30:00Z') }); // 11 Mar 00:30 WIB, 10 Mar 13:30 EDT
  mk({ name: 'B', createdAt: Date.parse('2026-03-10T10:00:00Z') }); // 10 Mar 17:00 WIB, 10 Mar 06:00 EDT
  await withNow('2026-03-10T18:00:00Z', async () => {
    setTz('Asia/Jakarta');
    let s = (await call('GET', '/api/leads/stats?period=day')).json;
    assert.equal(s.tz, 'Asia/Jakarta'); assert.equal(s.total, 1); assert.equal(s.prevTotal, 1); assert.equal(s.fromDate, '2026-03-11');
    assert.equal(s.from, Date.parse('2026-03-10T17:00:00Z'));
    setTz('America/New_York');
    s = (await call('GET', '/api/leads/stats?period=day')).json;
    assert.equal(s.tz, 'America/New_York'); assert.equal(s.total, 2); assert.equal(s.prevTotal, 0); assert.equal(s.fromDate, '2026-03-10');
    assert.equal(s.from, Date.parse('2026-03-10T04:00:00Z')); // EDT = UTC-4 (DST mulai 8 Mar 2026)
    assert.equal(s.deltaPct, null);
  });
  setTz('Asia/Jakarta');
});

test('stats: Hot dihitung dari statusHistory, lead lama dari createdAt, cohortHotRate, blocked dikecualikan, periode', async () => {
  reset();
  setTz('Asia/Jakarta');
  const T = (iso) => Date.parse(iso);
  await withNow('2026-05-20T05:00:00Z', async () => { // 20 Mei 2026 12:00 WIB
    // dibuat bulan lalu, naik Hot bulan ini -> masuk hot bulan ini, tidak masuk total bulan ini
    mk({ name: 'Naik', status: 'Hot Leads', createdAt: T('2026-04-25T03:00:00Z'),
      statusHistory: [{ status: 'Cold Leads', ts: T('2026-04-25T03:00:00Z') }, { status: 'Hot Leads', ts: T('2026-05-10T03:00:00Z') }] });
    // dibuat dan Hot bulan ini
    mk({ name: 'Baru Hot', status: 'Hot Leads', platform: 'Facebook', createdAt: T('2026-05-02T03:00:00Z'),
      statusHistory: [{ status: 'Cold Leads', ts: T('2026-05-02T03:00:00Z') }, { status: 'Warm Leads', ts: T('2026-05-03T03:00:00Z') }, { status: 'Hot Leads', ts: T('2026-05-04T03:00:00Z') }] });
    // lead lama tanpa statusHistory
    mk({ name: 'Lama Warm', status: 'Warm Leads', createdAt: T('2026-05-05T03:00:00Z') });
    mk({ name: 'Cold', status: 'Cold Leads', createdAt: T('2026-05-06T03:00:00Z') });
    mk({ name: 'Blokir', status: 'Hot Leads', blocked: true, createdAt: T('2026-05-06T03:00:00Z') });
    mk({ name: 'April', status: 'Cold Leads', createdAt: T('2026-04-10T03:00:00Z') });
    const s = (await call('GET', '/api/leads/stats?period=month')).json;
    assert.equal(s.total, 3);
    assert.equal(s.hot, 2); // Naik + Baru Hot
    assert.equal(s.warm, 2); // Baru Hot + Lama Warm
    assert.equal(s.cold, 2); // Baru Hot + Cold (awal di bulan ini)
    assert.equal(s.cohortHotRate, 33.3); // hanya 'Baru Hot' dari 3 lead yang dibuat bulan ini
    assert.equal(s.prevTotal, 2); // Naik + April
    assert.equal(s.deltaPct, 50);
    assert.deepEqual(s.funnel, [{ label: 'Semua lead', value: 3 }, { label: 'Warm + Hot', value: 2 }, { label: 'Hot', value: 1 }]);
    assert.deepEqual(s.bySource, [{ label: 'Instagram', value: 2 }, { label: 'Facebook', value: 1 }]);
    assert.equal(s.fromDate, '2026-05-01'); assert.equal(s.toDate, '2026-05-31');
    const w = (await call('GET', '/api/leads/stats?period=week')).json;
    assert.equal(w.fromDate, '2026-05-14'); assert.equal(w.toDate, '2026-05-20'); assert.equal(w.total, 0);
    const y = (await call('GET', '/api/leads/stats?period=year')).json;
    assert.equal(y.fromDate, '2026-01-01'); assert.equal(y.toDate, '2026-12-31'); assert.equal(y.total, 5);
    assert.equal((await call('GET', '/api/leads/stats?period=decade')).status, 400);
  });
});

test('export.csv: BOM, CRLF, kolom, proteksi formula injection, audit', async () => {
  reset();
  mk({
    name: '=HYPERLINK("http://x")', phone: '+6281400001', keyword: '@cmd', platform: 'Instagram',
    createdAt: Date.parse('2026-03-10T17:30:00Z'), lastMessageAt: Date.parse('2026-03-11T01:00:00Z'),
    followUpDate: '2026-04-01', followUpNote: 'telepon',
    data: { nama: 'Ayu', kebutuhan: '-5 kg' },
    notes: [{ id: '1', by: 'Rina', text: '+62 minta jadwal', ts: 1 }, { id: '2', by: 'Budi', text: 'baris "dua"', ts: 2 }],
  });
  mk({ name: 'Disembunyikan', blocked: true });
  const r = await call('GET', '/api/leads/export.csv?q=cmd');
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Type'], /^text\/csv; charset=utf-8/);
  assert.match(r.headers['Content-Disposition'], /^attachment; filename="leads-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(r.text.charCodeAt(0), 0xfeff);
  const lines = r.text.slice(1).split('\r\n');
  assert.equal(lines.pop(), ''); // diakhiri CRLF
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '"Nama","No WA","Sumber","Keyword","Status","Data Leads","Tanggal Masuk","Kontak Terakhir","Follow-up","Data Wajib","Catatan"');
  assert.ok(lines[1].startsWith('"\'=HYPERLINK(""http://x"")"'), lines[1]); // diawali apostrof + kutip digandakan
  assert.ok(lines[1].includes('"+6281400001"')); // nomor tidak diberi apostrof
  assert.ok(lines[1].includes('"\'@cmd"'));
  assert.ok(lines[1].includes('"2026-03-11 00:30"')); // Tanggal Masuk menurut timezone config (WIB)
  assert.ok(lines[1].includes('"2026-03-11 08:00"')); // Kontak Terakhir
  assert.ok(lines[1].includes('"2026-04-01 (telepon)"'));
  assert.ok(lines[1].includes('"Nama: Ayu; Kebutuhan: -5 kg"')); // Data Wajib memakai label dari pengaturan
  assert.ok(lines[1].endsWith('"Rina: +62 minta jadwal | Budi: baris ""dua"""')); // catatan digabung
  assert.deepEqual(r.audits, [{ action: 'lead.export', detail: { count: 1 } }]);
  // tanpa filter: blocked tetap tersembunyi, tanpa paginasi
  assert.equal((await call('GET', '/api/leads/export.csv')).text.split('\r\n').length, 3);
});

test('PATCH: status manual menambah statusHistory + statusManual, validasi, batas 200 karakter, resetAuto', async () => {
  reset();
  const l = mk({ name: 'Ayu', status: 'Cold Leads', createdAt: 1000 });
  let r = await call('PATCH', '/api/leads/' + l.id, { body: { status: 'Warm Leads', name: ' ' + 'x'.repeat(300) } });
  assert.equal(r.status, 200);
  assert.equal(r.json.lead.status, 'Warm Leads'); assert.equal(r.json.lead.statusManual, true); assert.equal(r.json.lead.name.length, 200);
  const h = r.json.lead.statusHistory;
  assert.equal(h.length, 2); // entri awal disemai untuk lead lama
  assert.equal(h[0].status, 'Cold Leads');
  assert.equal(h[1].status, 'Warm Leads'); assert.equal(h[1].reason, 'Diubah manual oleh Rina');
  assert.deepEqual(r.audits, [{ action: 'lead.update', detail: { id: l.id, fields: ['name', 'status'] } }]);
  // status sama: tidak menambah riwayat
  r = await call('PATCH', '/api/leads/' + l.id, { body: { status: 'Warm Leads' } });
  assert.equal(r.json.lead.statusHistory.length, 2);
  // validasi
  assert.equal((await call('PATCH', '/api/leads/' + l.id, { body: { status: 'Deal' } })).status, 400);
  assert.equal((await call('PATCH', '/api/leads/' + l.id, { body: { dataType: 'Baru' } })).status, 400);
  assert.equal((await call('PATCH', '/api/leads/' + l.id, { body: { platform: '  ' } })).status, 400);
  assert.equal((await call('PATCH', '/api/leads/' + l.id, { body: { name: 5 } })).status, 400);
  assert.equal((await call('PATCH', '/api/leads/' + l.id, { body: { foo: 1 } })).status, 400);
  assert.equal((await call('PATCH', '/api/leads/tidak-ada', { body: { name: 'a' } })).status, 404);
  // dataType manual lalu resetAuto
  r = await call('PATCH', '/api/leads/' + l.id, { body: { dataType: 'Existing' } });
  assert.equal(r.json.lead.dataTypeManual, true);
  r = await call('PATCH', '/api/leads/' + l.id, { body: { resetAuto: true, status: 'Hot Leads' } });
  assert.equal(r.json.lead.statusManual, false); assert.equal(r.json.lead.dataTypeManual, false);
  assert.equal(r.json.lead.status, 'Warm Leads'); // status diabaikan saat resetAuto (perilaku lama)
  // agent juga boleh PATCH
  assert.equal((await call('PATCH', '/api/leads/' + l.id, { body: { keyword: 'baru' }, user: AGENT })).status, 200);
});

test('PATCH confirmHot: set Hot manual, hapus hotCandidate, tambah riwayat', async () => {
  reset();
  const l = mk({ status: 'Warm Leads', hotCandidate: { ts: 1, reason: 'gambar setelah bahas pembayaran' }, statusHistory: [{ status: 'Warm Leads', ts: 1, reason: 'a' }] });
  const r = await call('PATCH', '/api/leads/' + l.id, { body: { confirmHot: true }, user: AGENT });
  assert.equal(r.status, 200);
  assert.equal(r.json.lead.status, 'Hot Leads'); assert.equal(r.json.lead.statusManual, true); assert.equal(r.json.lead.hotCandidate, null);
  assert.equal(r.json.lead.statusHistory.at(-1).reason, 'Diubah manual oleh Budi');
  assert.equal(store.all().find((x) => x.id === l.id).hotCandidate, null);
  assert.equal((await call('PATCH', '/api/leads/' + l.id, { body: { confirmHot: true, resetAuto: true } })).status, 400);
});

test('DELETE: agent ditolak 403, admin berhasil, percakapan tidak ikut terhapus', async () => {
  reset();
  C.getOrCreate('6281500001', 'j', 'Hapus');
  const l = mk({ phone: '6281500001' });
  let r = await call('DELETE', '/api/leads/' + l.id, { user: AGENT });
  assert.equal(r.status, 403); assert.equal(store.all().length, 1);
  assert.equal((await call('DELETE', '/api/leads/tidak-ada')).status, 404);
  r = await call('DELETE', '/api/leads/' + l.id);
  assert.equal(r.status, 200); assert.equal(store.all().length, 0);
  assert.ok(C.get('6281500001'));
  assert.equal(r.audits[0].action, 'lead.delete');
});

test('block/unblock: agent ditolak 403; admin memblokir, lead tersembunyi dari daftar dan statistik, lalu dibuka', async () => {
  reset();
  const l = mk({ phone: '6281600001', name: 'Blokir Aku' });
  for (const a of ['block', 'unblock']) {
    const r = await call('POST', `/api/leads/${l.id}/${a}`, { user: AGENT });
    assert.equal(r.status, 403);
  }
  assert.equal(store.all()[0].blocked, undefined);
  let r = await call('POST', `/api/leads/${l.id}/block`);
  assert.equal(r.status, 200); assert.equal(r.json.lead.blocked, true);
  assert.equal(L.isBlocked({ phone: '6281600001' }), true);
  assert.equal(store.all().length, 1); // lead tetap ada
  assert.equal((await call('GET', '/api/leads')).json.total, 0);
  assert.equal((await call('GET', '/api/leads?blocked=1')).json.total, 1);
  assert.equal((await call('GET', '/api/leads/stats?period=year')).json.total, 0);
  r = await call('POST', `/api/leads/${l.id}/unblock`);
  assert.equal(r.json.lead.blocked, false);
  assert.equal(L.isBlocked({ phone: '6281600001' }), false);
  assert.equal((await call('GET', '/api/leads')).json.total, 1);
});

test('from-conversation: 404 tanpa percakapan, 400 nomor salah, 201 baru, 200 existed', async () => {
  reset();
  assert.equal((await call('POST', '/api/leads/from-conversation', { body: { phone: 'abc' } })).status, 400);
  assert.equal((await call('POST', '/api/leads/from-conversation', { body: { phone: '6289999999' } })).status, 404);
  const { conv } = C.getOrCreate('6281700001', 'j', 'Dari Chat');
  C.addMessage(conv, 'customer', 'Halo, lihat iklan instagram, berapa harga?', 5000);
  C.addMessage(conv, 'bot', 'Halo!', 6000);
  C.addMessage(conv, 'customer', 'Lutut sakit', 7000);
  conv.data = { nama: 'Dari Chat' };
  let r = await call('POST', '/api/leads/from-conversation', { body: { phone: '6281700001' } });
  assert.equal(r.status, 201); assert.equal(r.json.existed, false);
  assert.equal(r.json.lead.phone, '6281700001'); assert.equal(r.json.lead.data.nama, 'Dari Chat');
  assert.equal(store.all().length, 1);
  assert.equal(r.audits[0].action, 'lead.create');
  r = await call('POST', '/api/leads/from-conversation', { body: { phone: '6281700001' } });
  assert.equal(r.status, 200); assert.equal(r.json.existed, true);
  assert.equal(store.all().length, 1);
});

test('catatan: tambah, batas 1000 karakter dan 200 catatan, hak hapus penulis atau admin', async () => {
  reset();
  const l = mk();
  assert.equal((await call('POST', `/api/leads/${l.id}/notes`, { body: { text: '   ' } })).status, 400);
  assert.equal((await call('POST', `/api/leads/${l.id}/notes`, { body: { text: 'x'.repeat(1001) } })).status, 400);
  let r = await call('POST', `/api/leads/${l.id}/notes`, { body: { text: ' Halo ' }, user: AGENT });
  assert.equal(r.status, 201);
  assert.equal(r.json.note.text, 'Halo'); assert.equal(r.json.note.by, 'Budi'); assert.ok(r.json.note.id && r.json.note.ts);
  const nid = r.json.note.id;
  // bukan penulis dan bukan admin
  const other = { name: 'Sari', role: 'agent' };
  assert.equal((await call('DELETE', `/api/leads/${l.id}/notes/${nid}`, { user: other })).status, 403);
  assert.equal((await call('DELETE', `/api/leads/${l.id}/notes/nope`, { user: other })).status, 404);
  assert.equal((await call('DELETE', `/api/leads/${l.id}/notes/${nid}`, { user: AGENT })).status, 200); // penulis
  r = await call('POST', `/api/leads/${l.id}/notes`, { body: { text: 'dari agent' }, user: AGENT });
  assert.equal((await call('DELETE', `/api/leads/${l.id}/notes/${r.json.note.id}`)).status, 200); // admin
  // batas 200
  store.update(l.id, { notes: Array.from({ length: 200 }, (_, i) => ({ id: 'n' + i, by: 'Rina', text: 't', ts: i })) });
  assert.equal((await call('POST', `/api/leads/${l.id}/notes`, { body: { text: 'ke-201' } })).status, 400);
  assert.equal((await call('GET', `/api/leads/${l.id}`)).json.lead.notes.length, 200);
});

test('followup: validasi format dan tanggal nyata, batas catatan, hapus dengan null', async () => {
  reset();
  const l = mk();
  const put = (body) => call('PUT', `/api/leads/${l.id}/followup`, { body });
  assert.equal((await put({ date: '01-04-2026' })).status, 400);
  assert.equal((await put({ date: '2026-02-30' })).status, 400);
  assert.equal((await put({ date: 20260401 })).status, 400);
  assert.equal((await put({ note: 'tanpa date' })).status, 400);
  assert.equal((await put({ date: '2026-04-01', note: 'x'.repeat(301) })).status, 400);
  let r = await put({ date: '2026-04-01', note: ' telepon ' });
  assert.equal(r.status, 200); assert.equal(r.json.lead.followUpDate, '2026-04-01'); assert.equal(r.json.lead.followUpNote, 'telepon');
  assert.equal(r.json.lead.followUpOverdue, true);
  r = await put({ date: null, note: 'diabaikan' });
  assert.equal(r.json.lead.followUpDate, null); assert.equal(r.json.lead.followUpNote, '');
  assert.equal((await call('PATCH', `/api/leads/${l.id}/followup`, { body: {} })).status, 405);
});

test('transaction-done: menutup siklus terbuka; tanpa siklus terbuka 400', async () => {
  reset();
  const l = mk({ transactionCycles: [{ id: 'c1', startedAt: 1, lastSignalAt: 2, signals: ['transfer'], settledAt: null, doneAt: null }] });
  const r = await call('POST', `/api/leads/${l.id}/transaction-done`, { user: AGENT });
  assert.equal(r.status, 200);
  assert.ok(r.json.lead.transactionCycles[0].doneAt > 0);
  assert.equal((await call('POST', `/api/leads/${l.id}/transaction-done`)).status, 400);
  assert.equal(r.audits[0].action, 'lead.transaction-done');
});

test('routing: /stats, /export.csv, /from-conversation tidak tertangkap pola :id', async () => {
  reset();
  const l = mk();
  let r = await call('GET', '/api/leads/stats');
  assert.equal(r.status, 200); assert.equal(r.json.period, 'day'); assert.ok(!('lead' in r.json));
  r = await call('GET', '/api/leads/export.csv');
  assert.equal(r.status, 200); assert.match(r.headers['Content-Type'], /text\/csv/);
  assert.equal((await call('GET', '/api/leads/from-conversation')).status, 405); // bukan 404 "Lead tidak ditemukan"
  assert.equal((await call('DELETE', '/api/leads/stats')).status, 405); // tidak menghapus lead bernama "stats"
  assert.equal((await call('POST', '/api/leads/stats', { user: AGENT })).status, 405);
  // di luar wilayah modul
  assert.equal((await call('GET', '/api/conversations')).handled, false);
  assert.equal((await call('GET', '/api/leadsx')).handled, false);
  assert.equal((await call('GET', '/api/leads/a/b/c')).handled, false);
  // detail
  assert.equal((await call('GET', '/api/leads/' + l.id)).status, 200);
  assert.equal((await call('GET', '/api/leads/tidak-ada')).json.error, 'Lead tidak ditemukan');
});
