// Migrasi JSON lama -> SQLite, field bebas, dedupe persisten, status lama.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AMNAN_NO_BACKUP = '1';
process.env.AMNAN_NO_BG = '1';
const D = await import('../src/db.js');
const store = await import('../src/store.js');
const C = await import('../src/conversations.js');

function fresh() {
  D.closeAll();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-data-'));
  process.env.DATA_DIR = dir;
  return dir;
}
const reopen = () => { C.flush(); store.flush(); D.closeAll(); };

test('migrasi leads.json + conversations.json, idempotent, berkas lama jadi .bak', () => {
  const dir = fresh();
  fs.writeFileSync(path.join(dir, 'leads.json'), JSON.stringify([
    { id: 'a', phone: '62811', name: 'Ani', status: 'Deal', extra: { x: 1 } },
    { id: 'b', phone: '62822', name: 'Budi', status: 'Baru', dataType: 'Existing' },
    { id: 'c', phone: '62833', name: 'Cici', status: 'Gagal' },
  ]));
  fs.writeFileSync(path.join(dir, 'conversations.json'), JSON.stringify({
    62811: { phone: '62811', jid: 'j', name: 'Ani', mode: 'admin', lastMessageAt: 5, unread: 2, data: { nama: 'Ani' }, custom: 'ok',
      messages: [{ id: 'm1', by: 'customer', text: 'halo', ts: 1 }, { id: 'm2', by: 'bot', text: 'hai', ts: 2 }, { id: 'm3', by: 'admin', text: 'ya', ts: 3 }] },
  }));

  const ls = store.all();
  assert.deepEqual(ls.map((l) => l.id), ['a', 'b', 'c'], 'urutan terbaru-di-depan dipertahankan');
  assert.equal(ls[0].status, 'Hot Leads');
  assert.equal(ls[1].status, 'Warm Leads');
  assert.equal(ls[2].status, 'Cold Leads');
  assert.equal(ls[0].dataType, 'New');
  assert.equal(ls[1].dataType, 'Existing');
  assert.deepEqual(ls[0].extra, { x: 1 });
  const c = C.get('62811');
  assert.equal(c.custom, 'ok');
  assert.deepEqual(c.messages.map((m) => m.id), ['m1', 'm2', 'm3']);
  assert.equal(C.dataFor('62811').nama, 'Ani');

  assert.ok(fs.existsSync(path.join(dir, 'leads.json.bak')) && !fs.existsSync(path.join(dir, 'leads.json')));
  assert.ok(fs.existsSync(path.join(dir, 'conversations.json.bak')));

  reopen(); // restart: tidak ada impor ulang, status baru tersimpan
  assert.equal(store.all().length, 3);
  assert.equal(store.findByPhone('62811').status, 'Hot Leads');
  assert.equal(C.get('62811').messages.length, 3);

  // berkas lama muncul lagi (mis. dipulihkan manual): tidak menggandakan dan .bak lama tidak ditimpa
  fs.writeFileSync(path.join(dir, 'leads.json'), JSON.stringify([{ id: 'a', phone: '62811', name: 'LAMA' }]));
  reopen();
  assert.equal(store.all().length, 3);
  assert.equal(store.findByPhone('62811').name, 'Ani');
  assert.ok(fs.readdirSync(dir).filter((f) => f.startsWith('leads.json.bak')).length >= 2, 'tidak ada .bak yang tertimpa');
  D.closeAll();
});

test('field bebas pada lead dan percakapan tersimpan dan dimuat kembali', () => {
  fresh();
  const lead = store.add({ phone: '62899', name: 'Dedi', status: 'Cold Leads', dataType: 'New', source: { platform: 'Instagram', adId: '1' },
    statusHistory: [{ status: 'Cold Leads', ts: 1, reason: 'x' }], notes: [{ id: 'n', by: 'a', text: 't', ts: 1 }], followUpAt: 99, blocked: true, apaSaja: { dalam: [1, 2] } });
  store.update(lead.id, { lastReplyAt: 7, tambahan: 'baru' });
  const { conv } = C.getOrCreate('62899', 'j@s', 'Dedi');
  conv.lid = '123@lid';
  conv.needsAttention = true;
  conv.attentionReason = 'komplain';
  conv.apaSaja = { z: [1] };
  const m = C.addMessage(conv, 'customer', '', 10, { type: 'image', mediaId: 'mid1', caption: 'foto', status: 'read', waId: 'W1', sender: 'x', ekstra: 1 });
  C.save();
  reopen();
  const l = store.findByPhone('62899');
  assert.deepEqual(l.apaSaja, { dalam: [1, 2] });
  assert.equal(l.tambahan, 'baru');
  assert.equal(l.lastReplyAt, 7);
  assert.equal(l.blocked, true);
  assert.equal(store.findByLid(undefined), undefined);
  const c = C.get('62899');
  assert.equal(c.lid, '123@lid');
  assert.equal(C.findByLid('123@lid').phone, '62899');
  assert.deepEqual(c.apaSaja, { z: [1] });
  const mm = c.messages.find((x) => x.id === m.id);
  assert.equal(mm.mediaId, 'mid1');
  assert.equal(mm.ekstra, 1);
  assert.equal(mm.type, 'image');
  const row = C.list()[0];
  assert.equal(row.needsAttention, true);
  assert.equal(row.awaitingReply, true);
  D.closeAll();
});

test('mutasi pesan setelah await (status sending -> sent) tersimpan lewat save(conv)', async () => {
  fresh();
  const { conv } = C.getOrCreate('62877', 'j', 'Eko');
  const m = C.addMessage(conv, 'admin', 'halo', Date.now(), { status: 'sending' });
  C.save();
  C.flush();
  await new Promise((r) => setTimeout(r, 300)); // debounce lewat
  m.status = 'sent'; // mutasi pada objek lama, lalu save(conv) (cara yang dianjurkan setelah await)
  C.save(conv);
  await new Promise((r) => setTimeout(r, 300));
  // periksa langsung isi DB (sebelum shutdown yang melakukan flush penuh)
  const rows = D.getDb().prepare('SELECT blob FROM messages').all().map((r) => D.decodeBlob(r.blob));
  assert.equal(rows[0].status, 'sent');
  D.closeAll();
  assert.equal(C.get('62877').messages[0].status, 'sent');
  D.closeAll();
});

test('save() tanpa argumen setelah await: tetap tersimpan lewat pemeriksaan ulang terjadwal (<= ~3 dtk)', async () => {
  fresh();
  const { conv } = C.getOrCreate('62878', 'j', 'Eka');
  const m = C.addMessage(conv, 'admin', 'halo', Date.now(), { status: 'sending' });
  C.save();
  await new Promise((r) => setTimeout(r, 300));
  m.status = 'sent';
  C.save(); // pola lama tanpa argumen
  await new Promise((r) => setTimeout(r, 3600));
  const rows = D.getDb().prepare('SELECT blob FROM messages').all().map((r) => D.decodeBlob(r.blob));
  assert.equal(rows[0].status, 'sent');
  D.closeAll();
});

test('seenMessage/markSeen persisten lintas restart', () => {
  fresh();
  assert.equal(C.seenMessage('ABC'), false);
  C.markSeen('ABC');
  assert.equal(C.seenMessage('ABC'), true);
  reopen();
  assert.equal(C.seenMessage('ABC'), true);
  assert.equal(C.seenMessage('XYZ'), false);
  D.closeAll();
});

test('list(): awaitingReply mengabaikan pesan system; unread total memancarkan event', async () => {
  fresh();
  const E = await import('../src/events.js');
  const got = [];
  const off = E.on('unread', (p) => got.push(p.total));
  const { conv } = C.getOrCreate('62866', 'j', 'Fani');
  C.addMessage(conv, 'customer', 'tanya', 1);
  C.addMessage(conv, 'system', 'catatan', 2);
  conv.unread = 2;
  C.save();
  assert.equal(C.list()[0].awaitingReply, true);
  C.addMessage(conv, 'admin', 'jawab', 3);
  C.addMessage(conv, 'system', 'catatan2', 4);
  assert.equal(C.list()[0].awaitingReply, false);
  conv.unread = 0;
  C.save();
  off();
  assert.deepEqual(got, [2, 0]);
  D.closeAll();
});
