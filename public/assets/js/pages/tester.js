// Bot Tester: banyak nomor uji, tampilan seperti WhatsApp + pratinjau kolom CRM untuk semua nomor uji.
// Memakai mesin balasan dan logika Status Lead / Data Leads yang sama dengan WhatsApp asli.
// Simulasi: gambar/suara/reaksi, gagal kirim, pesan basi, balasan admin dari HP, jam simulasi.
import { $, api, send, esc, icon, chatHTML, bindChatMedia, toast, fmtDate, confirmDialog, loadSettings, STATUS, BTN_LIGHT, INP } from '../lib.js';

const ST = { 'Cold Leads': 'bg-blue-50 text-blue-700', 'Warm Leads': 'bg-amber-50 text-amber-800', 'Hot Leads': 'bg-red-50 text-red-700' };
const DT = { New: 'bg-brand-50 text-brand-800', Existing: 'bg-gray-100 text-gray-700' };
const DEFAULT_PHONE = '6281200000001';
const KEY = 'tester-phone';

let S, phone = DEFAULT_PHONE, msgs = [], st = {}, stAt = 0, data = {}, numbers = [], leads = [], offset = 0, timer, chain = Promise.resolve(), gone = false;
let attn = { on: false, reason: '' };
let chips = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = (v) => { try { v === undefined ? (v = sessionStorage.getItem(KEY)) : sessionStorage.setItem(KEY, v); return v; } catch { return null; } };
const qs = (p) => '/api/tester?phone=' + encodeURIComponent(p);

/** needsAttention dari bentuk respons mana pun yang mungkin dipakai server. */
export function attentionOf(v) {
  const src = v?.needsAttention !== undefined ? v : v?.status?.needsAttention !== undefined ? v.status : v?.conversation || {};
  return { on: !!src.needsAttention, reason: src.attentionReason || '' };
}

/** Sisipkan chip lokal tepat setelah pesan yang jadi acuannya (murni, diuji). */
export function mergeChips(list, chipList) {
  const ids = new Set(list.map((m) => m.id));
  const after = new Map();
  const head = [], tail = [];
  for (const c of chipList) {
    if (c.after == null) head.push(c);
    else if (ids.has(c.after)) { if (!after.has(c.after)) after.set(c.after, []); after.get(c.after).push(c); }
    else tail.push(c);
  }
  const out = [...head];
  for (const m of list) { out.push(m); if (after.has(m.id)) out.push(...after.get(m.id)); }
  return out.concat(tail);
}

const lbl = (s) => STATUS[s]?.label || s;
/** Catatan perubahan antara dua tampilan tester: status pesan, mode, needsAttention (murni, diuji). */
export function diffTesterView(prev, next) {
  const out = [];
  const pm = new Map((prev.messages || []).map((m) => [m.id, m]));
  for (const m of next.messages || []) {
    const o = pm.get(m.id);
    if (o?.status && m.status && o.status !== m.status) {
      out.push(`Status pesan ${m.by === 'customer' ? 'pelanggan' : m.by === 'bot' ? 'bot' : 'admin'} berubah: ${lbl(o.status)} → ${lbl(m.status)}`);
    }
  }
  const pa = attentionOf(prev), na = attentionOf(next);
  if (pa.on !== na.on) out.push(na.on ? `Perlu perhatian: ${na.reason || 'ya'}` : 'Tanda perlu perhatian dihapus');
  const pmode = prev.status?.mode, nmode = next.status?.mode;
  if (pmode && nmode && pmode !== nmode) out.push(`Mode berubah: ${pmode} → ${nmode}`);
  return out;
}

export async function mount(el) {
  gone = false; chain = Promise.resolve(); chips = [];
  phone = store() || DEFAULT_PHONE;
  S = await loadSettings();
  setView(await api(qs(phone)));

  el.innerHTML = `<h1 class="sr-only">Bot Tester</h1><div class="space-y-8">
  <div class="card text-sm flex flex-wrap items-end gap-3">
    <div><label for="t-phone" class="block text-xs text-gray-600 mb-1">Nomor uji</label>
      <input id="t-phone" list="t-numbers" class="${INP} !w-56" value="${esc(phone)}" placeholder="mis. 6281200000002"><datalist id="t-numbers"></datalist></div>
    <button type="button" id="t-go" class="${BTN_LIGHT}">Pakai nomor ini</button>
    <button type="button" id="t-new" class="${BTN_LIGHT}">Nomor uji baru</button>
    <div class="text-xs text-gray-600 flex-1 min-w-48">Setiap nomor punya percakapan, Status Lead, dan Data Leads sendiri, seperti nomor pelanggan berbeda di WhatsApp asli.</div>
  </div>
  <div class="flex flex-col lg:flex-row gap-8 items-start">
    <div class="wa-phone">
      <div class="wa-head">
        <div class="wa-avatar" aria-hidden="true">${esc(S.botName.charAt(0).toUpperCase())}</div>
        <div class="flex-1 min-w-0"><div class="font-medium truncate">${esc(S.botName)}</div><div class="text-xs" id="t-sub" aria-live="polite">online</div></div>
      </div>
      <div class="wa-body" id="t-body" role="log" aria-label="Percakapan uji" tabindex="0"></div>
      <div class="wa-foot">
        <label class="sr-only" for="t-input">Pesan sebagai pelanggan</label>
        <textarea id="t-input" rows="1" placeholder="Ketik pesan sebagai pelanggan (Enter kirim)"></textarea>
        <button type="button" class="wa-send" id="t-send" aria-label="Kirim pesan">${icon('send', 'icon-md')}</button>
      </div>
    </div>
    <div class="flex-1 space-y-4 text-sm w-full">
      <div class="card"><div class="font-semibold text-brand-800 mb-1">Nomor <span id="t-cur"></span></div><p id="t-line" class="text-gray-700"></p>
        <div id="t-attn" class="mt-2" aria-live="polite"></div>
        <p id="t-clock" class="text-xs text-gray-600 mt-1"></p>
        <div class="flex flex-wrap gap-2 mt-3" id="t-actions"></div></div>
      <div class="card space-y-3" id="t-sim">
        <div class="font-semibold text-brand-800">Simulasi</div>
        <div class="flex flex-wrap gap-2">
          <button type="button" data-k="image" class="${BTN_LIGHT}">${icon('image')} Kirim gambar</button>
          <button type="button" data-k="audio" class="${BTN_LIGHT}">${icon('mic')} Kirim suara</button>
          <button type="button" data-k="reaction" class="${BTN_LIGHT}">${icon('smile')} Kirim reaksi</button>
        </div>
        <p class="text-xs text-gray-600">Teks di kolom pesan dipakai sebagai keterangan gambar/suara. Reaksi tidak pernah masuk CRM.</p>
        <label class="flex items-center gap-2"><input type="checkbox" id="t-sendfail"> Simulasikan gagal kirim (balasan bot gagal terkirim)</label>
        <label class="flex items-center gap-2"><input type="checkbox" id="t-stale"> Pesan basi (lebih lama dari ${esc(S.staleMinutes ?? 10)} menit)</label>
        <p class="text-xs text-gray-600">Dua pilihan di atas berlaku untuk pesan berikutnya yang Anda kirim.</p>
        <div class="border-t border-gray-100 pt-3 space-y-2">
          <label for="t-pr" class="block font-medium">Balasan admin dari HP</label>
          <div class="flex flex-wrap gap-2"><input id="t-pr" class="${INP} flex-1 min-w-40" placeholder="Isi balasan admin"><button type="button" data-t="phone-reply" class="${BTN_LIGHT}">Kirim dari HP</button></div>
          <p class="text-xs text-gray-600">Mensimulasikan admin membalas lewat aplikasi WhatsApp di HP; bila "ambil alih otomatis" aktif, mode berubah ke admin.</p>
        </div>
      </div>
      <div class="card text-gray-700 space-y-2">
        <div class="font-semibold text-brand-800">Aturan yang diuji</div>
        <p><b>Status Lead:</b> Cold = pesan masuk pertama kali dari nomor ini (sama dengan pesan pembuka bot). Jika leadRule di keywords.json = platform, pesan itu juga harus memuat keyword platform. Warm = percakapan lebih dari 10 pesan customer. Hot = ada booking/transfer/pembayaran dst (daftar di keywords.json), atau sudah Existing.</p>
        <p><b>Data Leads:</b> New = pesan masuk pertama kali. Existing = customer yang transaksi pertamanya sudah selesai lalu mengirim sinyal transaksi baru (booking, dp, bayar). Transaksi dianggap selesai bila ada pesan "lunas" lalu sinyal berikutnya berjarak minimal 24 jam, bila sinyal terakhir lebih dari 30 hari lalu, atau bila admin menekan <b>Transaksi selesai</b>.</p>
        <p>Untuk menguji Existing lewat chat: kirim "sudah dp", lalu "sudah lunas", klik <b>+1 hari</b>, lalu kirim "mau booking lagi". Untuk menguji pelunasan di lokasi: kirim "mau booking", klik <b>Transaksi selesai</b>, lalu kirim "mau booking lagi" (tidak perlu menunggu 24 jam). Untuk Warm: kirim lebih dari 10 pesan. Chat di sini tidak dikirim ke WhatsApp dan tidak masuk CRM asli.</p>
      </div>
    </div>
  </div>

  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" aria-labelledby="t-crm-h">
    <div class="p-5 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="t-crm-h" class="font-bold text-lg text-brand-800">Hasil di CRM (pratinjau semua nomor uji)</h2>
      <p class="text-sm text-gray-600">Kolom yang sama dengan halaman CRM, terisi otomatis dari chat setiap nomor uji.</p></div>
      <button type="button" data-t="reset-all" class="${BTN_LIGHT}">Reset semua nomor</button>
    </div>
    <div id="t-crm" class="overflow-x-auto"></div>
  </section></div>`;

  bindChatMedia($('#t-body'));
  const ta = $('#t-input');
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
  ta.oninput = fit;
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit('text'); fit(); } };
  $('#t-send').onclick = () => { submit('text'); fit(); ta.focus(); };
  $('#t-go').onclick = () => switchTo($('#t-phone').value);
  $('#t-phone').onkeydown = (e) => { if (e.key === 'Enter') switchTo(e.target.value); };
  $('#t-new').onclick = () => {
    const used = new Set([...numbers, ...leads.map((l) => l.phone)]);
    let n = 1; while (used.has('628120000' + String(n).padStart(4, '0'))) n++;
    switchTo('628120000' + String(n).padStart(4, '0'));
  };
  el.onclick = onAction;

  renderAll();
  timer = setInterval(renderLine, 1000);
  ta.focus();
}

export function unmount() { gone = true; clearInterval(timer); }

function setView(v) {
  phone = v.phone; store(phone);
  msgs = v.messages; st = v.status || {}; stAt = Date.now(); data = v.data || {};
  numbers = v.numbers || []; leads = v.leads || []; offset = v.offset || 0;
  attn = attentionOf(v);
}

function renderAll() { renderNumbers(); renderBody(); renderActions(); renderLine(); renderCrm(); }

function renderNumbers() {
  const all = [...new Set([...numbers, phone])];
  $('#t-numbers').innerHTML = all.map((n) => `<option value="${esc(n)}">`).join('');
  $('#t-phone').value = phone;
  $('#t-cur').textContent = phone;
}

async function switchTo(raw) {
  try {
    const d = (raw || '').replace(/\D/g, '');
    if (d.length < 8) return toast('Nomor uji minimal 8 digit', true);
    chain = chain.then(async () => { setView(await api(qs(d))); chips = []; if (!gone) renderAll(); });
    await chain;
  } catch (err) { toast(err.message, true); }
}

function renderBody() {
  const b = $('#t-body');
  if (!b) return;
  b.innerHTML = chatHTML(mergeChips(msgs, chips), (m) => ({ own: m.by === 'customer' }));
  b.scrollTop = b.scrollHeight;
}

const simNow = () => Date.now() + offset;

function renderLine() {
  const el = $('#t-line');
  if (!el) return;
  let t;
  if (!st.botEnabled) t = 'Bot nonaktif (lihat Pengaturan). Bot tidak akan membalas.';
  else if (st.mode === 'admin') {
    if (st.adminReturnMs == null) t = `Ditangani ${S.adminName} (take over). Bot tidak membalas.`;
    else {
      const left = Math.max(0, st.adminReturnMs - (Date.now() - stAt));
      t = left > 0
        ? `Ditangani ${S.adminName} (take over). Bot aktif kembali otomatis bila admin tidak membalas dalam ${Math.floor(left / 60000)} menit ${Math.floor((left % 60000) / 1000)} detik.`
        : `Ditangani ${S.adminName}, tetapi admin sudah tidak aktif melewati batas. Pesan pelanggan berikutnya mengembalikan percakapan ke bot.`;
    }
  }
  else if (st.remainingMs == null) t = 'Bot aktif tanpa batas durasi.';
  else {
    const left = Math.max(0, st.remainingMs - (Date.now() - stAt));
    t = left > 0 ? `Bot aktif, sisa durasi ${Math.floor(left / 60000)} menit ${Math.floor((left % 60000) / 1000)} detik.` : 'Durasi bot habis. Pesan berikutnya kembali ke pesan pembuka.';
  }
  el.textContent = t;
  $('#t-clock').textContent = offset ? `Jam simulasi: ${fmtDate(simNow())} (maju ${(offset / 3600000).toFixed(offset % 3600000 ? 1 : 0)} jam dari waktu asli)` : 'Jam simulasi: sama dengan waktu asli.';
  const a = $('#t-attn');
  const html = attn.on ? `<span class="tag tag-warn">${icon('alert', 'icon-xs')} Perlu perhatian${attn.reason ? ': ' + esc(attn.reason) : ''}</span>` : '<span class="tag">Tidak perlu perhatian</span>';
  if (a.dataset.k !== html) { a.dataset.k = html; a.innerHTML = html; }
}

function renderActions() {
  const me = leads.find((l) => l.phone === phone);
  const open = ((me && me.transactionCycles) || []).filter((c) => c && !c.doneAt).length;
  const txBtn = open
    ? `<button type="button" data-t="tx-done" class="${BTN_LIGHT}">Transaksi selesai (${open} terbuka)</button>`
    : `<button type="button" disabled title="Belum ada transaksi terbuka (kirim pesan seperti 'mau booking' atau 'sudah dp' dulu)" class="${BTN_LIGHT} opacity-50 cursor-not-allowed">Transaksi selesai (belum ada)</button>`;
  $('#t-actions').innerHTML = txBtn + `<button type="button" data-t="reset" class="${BTN_LIGHT}">Reset nomor ini</button>
    <button type="button" data-t="mode" class="${BTN_LIGHT}">${st.mode === 'bot' ? 'Simulasikan take over admin' : 'Kembalikan ke bot'}</button>
    <span class="text-xs text-gray-600 self-center ml-2">Majukan waktu:</span>
    <button type="button" data-h="1" class="${BTN_LIGHT}">+1 jam</button><button type="button" data-h="24" class="${BTN_LIGHT}">+1 hari</button><button type="button" data-h="168" class="${BTN_LIGHT}">+7 hari</button>`;
}

function renderCrm() {
  const el = $('#t-crm');
  if (!el) return;
  if (!leads.length) {
    el.innerHTML = '<div class="p-8 text-center text-sm text-gray-600 italic">Belum ada nomor uji yang menjadi lead. Lead dibuat dari pesan pertama sebuah nomor. Jika sudah terlanjur chat sebelumnya, klik Reset nomor ini atau pakai Nomor uji baru.</div>';
    return;
  }
  const label = Object.fromEntries((S.requiredFields || []).map((f) => [f.id, f.label]));
  el.innerHTML = `<table class="w-full text-left border-collapse text-sm rtable"><caption class="sr-only">Lead dari nomor uji</caption>
    <thead><tr class="bg-gray-50 border-b border-gray-200 text-gray-600 font-medium">
      <th scope="col" class="p-4">Nama / No WA</th><th scope="col" class="p-4">Sumber</th><th scope="col" class="p-4">Keyword Matched</th><th scope="col" class="p-4">Status Lead</th><th scope="col" class="p-4">Data Leads</th><th scope="col" class="p-4">Tanggal Masuk</th>
    </tr></thead><tbody class="divide-y divide-gray-200">${leads.map((l) => {
      const collected = Object.entries(l.data || {});
      return `<tr class="${l.phone === phone ? 'bg-brand-50/40' : ''}">
      <td class="p-4" data-label="Nama / No WA"><div class="font-medium text-gray-900">${esc(l.name || 'Tanpa nama')}</div><div class="text-xs text-gray-600">${esc(l.phone)}</div></td>
      <td class="p-4" data-label="Sumber">${esc(l.platform)}</td>
      <td class="p-4 text-gray-700" data-label="Keyword Matched">${esc(l.keyword || '-')}</td>
      <td class="p-4" data-label="Status Lead"><span class="px-2.5 py-1 rounded-full text-xs font-medium ${ST[l.status] || ''}">${esc(l.status)}</span><div class="text-[11px] text-gray-600 mt-1">${esc(l.statusReason || '')}</div></td>
      <td class="p-4" data-label="Data Leads"><span class="px-2.5 py-1 rounded-full text-xs font-medium ${DT[l.dataType] || ''}">${esc(l.dataType)}</span><div class="text-[11px] text-gray-600 mt-1">${esc(l.dataReason || '')}</div></td>
      <td class="p-4 text-gray-700 whitespace-nowrap" data-label="Tanggal Masuk">${esc(fmtDate(l.createdAt))}${collected.length ? `<div class="text-[11px] text-gray-600 mt-1 whitespace-normal">${collected.map(([k, v]) => `${esc(label[k] || k)}: ${esc(v)}`).join(' &middot; ')}</div>` : ''}</td>
    </tr>`;
    }).join('')}</tbody></table>`;
}

const lastId = () => (msgs.length ? msgs[msgs.length - 1].id : null);
const chip = (text) => chips.push({ id: 'sys' + Math.random().toString(36).slice(2, 8), by: 'system', ts: Date.now(), text, after: lastId() });

/** Ambil ulang tampilan nomor ini, tambahkan chip untuk perubahan status/needsAttention/mode. */
async function resync(p, before) {
  const v = await api(qs(p));
  if (gone || p !== phone) return;
  const notes = diffTesterView(before, v);
  setView(v);
  notes.forEach((n) => chip('Sistem: ' + n));
  renderAll();
}
const snapshot = () => ({ messages: msgs.map((m) => ({ ...m })), status: { ...st }, needsAttention: attn.on, attentionReason: attn.reason });

async function onAction(e) {
  const k = e.target.closest('[data-k]');
  if (k) { submit(k.dataset.k); return; }
  const b = e.target.closest('[data-t],[data-h]');
  if (!b) return;
  try {
    if (b.dataset.t === 'reset-all') {
      if (!(await confirmDialog('Reset semua nomor uji?', 'Semua percakapan dan lead nomor uji akan dihapus.', { okText: 'Reset', danger: true }))) return;
      await send('/api/tester/reset', {});
      setView(await api(qs(phone))); chips = [];
    } else if (b.dataset.t === 'reset') {
      await send('/api/tester/reset', { phone });
      setView(await api(qs(phone))); chips = [];
    } else if (b.dataset.t === 'tx-done') {
      const before = snapshot();
      const r = await send('/api/tester/transaction-done', { phone });
      setView(r);
      chip('Transaksi ditandai selesai (simulasi tombol di CRM)');
      await resync(phone, before);
      return;
    } else if (b.dataset.t === 'mode') {
      const before = snapshot();
      const r = await send('/api/tester/mode', { phone, mode: st.mode === 'bot' ? 'admin' : 'bot' });
      st = r.status; stAt = Date.now();
      chip(st.mode === 'admin' ? `${S.adminName} mengambil alih percakapan` : 'Percakapan dikembalikan ke bot');
      await resync(phone, { ...before, status: st });
      return;
    } else if (b.dataset.t === 'phone-reply') {
      const inp = $('#t-pr');
      const text = inp.value.trim();
      if (!text) { toast('Ketik isi balasan admin dulu', true); inp.focus(); return; }
      const before = snapshot();
      const p = phone;
      await send('/api/tester/phone-reply', { phone: p, text });
      inp.value = '';
      chip(`${S.adminName} membalas dari HP (simulasi)`);
      await resync(p, before);
      return;
    } else if (b.dataset.h) {
      const v = await send('/api/tester/advance', { phone, hours: Number(b.dataset.h) });
      setView(v);
      chip(`Waktu simulasi maju ${b.dataset.h} jam`);
    }
    renderAll();
  } catch (err) { toast(err.message, true); }
}

/** kind: text | image | audio | reaction. Opsi simulasi diambil dari kotak centang. */
function submit(kind) {
  const ta = $('#t-input');
  let text = ta.value.trim();
  if (kind === 'text' && !text) return;
  if (kind === 'reaction' && !text) text = '👍';
  ta.value = '';
  const simulate = {};
  if ($('#t-sendfail').checked) simulate.sendFail = true;
  if ($('#t-stale').checked) simulate.stale = true;
  const body = { text };
  if (kind !== 'text') body.kind = kind;
  if (Object.keys(simulate).length) body.simulate = simulate;
  $('#t-sendfail').checked = false;
  $('#t-stale').checked = false;
  const p = phone;
  chain = chain.then(() => handle(p, body)).catch((e) => toast(e.message, true));
}

async function handle(p, body) {
  const before = snapshot();
  const r = await send('/api/tester/send', { phone: p, ...body });
  if (gone || p !== phone) return; // pindah nomor saat menunggu: tampilan tidak dicampur
  if (r.message) msgs.push(r.message);
  if (r.changes?.length) chip('Sistem: ' + r.changes.join(' · '));
  if (r.status) st = r.status;
  stAt = Date.now(); data = r.data || data;
  renderBody();
  const replies = r.replies || [];
  if (replies.length) $('#t-sub').textContent = 'mengetik...';
  for (const rep of replies) {
    await sleep(500 + Math.min(1500, (rep.text || '').length * 10));
    if (gone || p !== phone) return;
    msgs.push(rep);
    renderBody();
  }
  if (gone || p !== phone) return;
  $('#t-sub').textContent = 'online';
  await resync(p, before); // sinkron status pesan/needsAttention + tabel CRM semua nomor uji
}
