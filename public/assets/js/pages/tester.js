// Bot Tester: banyak nomor uji, tampilan seperti WhatsApp + pratinjau kolom CRM untuk semua nomor uji.
// Memakai mesin balasan dan logika Status Lead / Data Leads yang sama dengan WhatsApp asli.
// Jam simulasi dipakai untuk menguji "menghubungi kembali" (Existing) tanpa menunggu berhari-hari.
import { $, api, send, esc, chatHTML, toast, fmtDate, BTN_LIGHT, INP } from '../lib.js';

const ST = { 'Cold Leads': 'bg-blue-50 text-blue-700', 'Warm Leads': 'bg-amber-50 text-amber-700', 'Hot Leads': 'bg-red-50 text-red-700' };
const DT = { New: 'bg-brand-50 text-brand-800', Existing: 'bg-gray-100 text-gray-600' };
const DEFAULT_PHONE = '6281200000001';
const KEY = 'tester-phone';

let S, phone = DEFAULT_PHONE, msgs = [], st = {}, stAt = 0, data = {}, numbers = [], leads = [], offset = 0, timer, chain = Promise.resolve(), gone = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = (v) => { try { v === undefined ? (v = sessionStorage.getItem(KEY)) : sessionStorage.setItem(KEY, v); return v; } catch { return null; } };
const qs = (p) => '/api/tester?phone=' + encodeURIComponent(p);

export async function mount(el) {
  gone = false; chain = Promise.resolve();
  phone = store() || DEFAULT_PHONE;
  S = await api('/api/settings');
  setView(await api(qs(phone)));

  el.innerHTML = `<div class="space-y-8">
  <div class="card text-sm flex flex-wrap items-end gap-3">
    <div><label class="block text-xs text-gray-500 mb-1">Nomor uji</label>
      <input id="t-phone" list="t-numbers" class="${INP} !w-56" value="${esc(phone)}" placeholder="mis. 6281200000002"><datalist id="t-numbers"></datalist></div>
    <button id="t-go" class="${BTN_LIGHT}">Pakai nomor ini</button>
    <button id="t-new" class="${BTN_LIGHT}">Nomor uji baru</button>
    <div class="text-xs text-gray-500 flex-1 min-w-48">Setiap nomor punya percakapan, Status Lead, dan Data Leads sendiri, seperti nomor pelanggan berbeda di WhatsApp asli.</div>
  </div>
  <div class="flex flex-col lg:flex-row gap-8 items-start">
    <div class="wa-phone">
      <div class="wa-head">
        <div class="wa-avatar">${esc(S.botName.charAt(0).toUpperCase())}</div>
        <div class="flex-1 min-w-0"><div class="font-medium truncate">${esc(S.botName)}</div><div class="text-xs opacity-80" id="t-sub">online</div></div>
      </div>
      <div class="wa-body" id="t-body"></div>
      <div class="wa-foot">
        <textarea id="t-input" rows="1" placeholder="Ketik pesan sebagai pelanggan (Enter kirim)"></textarea>
        <button class="wa-send" id="t-send" title="Kirim">&#10148;</button>
      </div>
    </div>
    <div class="flex-1 space-y-4 text-sm w-full">
      <div class="card"><div class="font-semibold text-brand-800 mb-1">Nomor <span id="t-cur"></span></div><p id="t-line" class="text-gray-600"></p>
        <p id="t-clock" class="text-xs text-gray-500 mt-1"></p>
        <div class="flex flex-wrap gap-2 mt-3" id="t-actions"></div></div>
      <div class="card text-gray-600 space-y-2">
        <div class="font-semibold text-brand-800">Aturan yang diuji</div>
        <p><b>Status Lead:</b> Cold = pesan masuk pertama kali dari nomor ini (sama dengan pesan pembuka bot) dan memuat keyword platform. Warm = percakapan lebih dari 10 pesan customer. Hot = ada booking/transfer/pembayaran dst (daftar di keywords.json), atau sudah Existing.</p>
        <p><b>Data Leads:</b> New = pesan masuk pertama kali. Existing = customer yang pernah booking/transfer melakukannya untuk kedua kalinya (sinyal transaksi berikutnya yang berjarak minimal 24 jam dari sebelumnya).</p>
        <p>Untuk menguji Existing: kirim pesan pertama berisi keyword platform dan transaksi (mis. "dari IG, mau booking"), klik <b>+1 hari</b>, lalu kirim "mau transfer lagi". Untuk Warm: kirim lebih dari 10 pesan. Chat di sini tidak dikirim ke WhatsApp dan tidak masuk CRM asli.</p>
      </div>
    </div>
  </div>

  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
    <div class="p-5 border-b border-gray-200 flex items-center justify-between gap-3">
      <div><h3 class="font-bold text-lg text-brand-800">Hasil di CRM (pratinjau semua nomor uji)</h3>
      <p class="text-sm text-gray-500">Kolom yang sama dengan halaman CRM, terisi otomatis dari chat setiap nomor uji.</p></div>
      <button data-t="reset-all" class="${BTN_LIGHT}">Reset semua nomor</button>
    </div>
    <div id="t-crm" class="overflow-x-auto"></div>
  </section></div>`;

  const ta = $('#t-input');
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
  ta.oninput = fit;
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); fit(); } };
  $('#t-send').onclick = () => { submit(); fit(); ta.focus(); };
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
  msgs = v.messages; st = v.status; stAt = Date.now(); data = v.data || {};
  numbers = v.numbers || []; leads = v.leads || []; offset = v.offset || 0;
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
    chain = chain.then(async () => { setView(await api(qs(d))); if (!gone) renderAll(); });
    await chain;
  } catch (err) { toast(err.message, true); }
}

function renderBody() {
  const b = $('#t-body');
  if (!b) return;
  b.innerHTML = chatHTML(msgs, (m) => ({ own: m.by === 'customer' }));
  b.scrollTop = b.scrollHeight;
}

const simNow = () => Date.now() + offset;

function renderLine() {
  const el = $('#t-line');
  if (!el) return;
  let t;
  if (!st.botEnabled) t = 'Bot nonaktif (lihat Pengaturan). Bot tidak akan membalas.';
  else if (st.mode === 'admin') t = `Ditangani ${S.adminName} (take over). Bot tidak membalas.`;
  else if (st.remainingMs == null) t = 'Bot aktif tanpa batas durasi.';
  else {
    const left = Math.max(0, st.remainingMs - (Date.now() - stAt));
    t = left > 0 ? `Bot aktif, sisa durasi ${Math.floor(left / 60000)} menit ${Math.floor((left % 60000) / 1000)} detik.` : 'Durasi bot habis. Pesan berikutnya kembali ke pesan pembuka.';
  }
  el.textContent = t;
  $('#t-clock').textContent = offset ? `Jam simulasi: ${fmtDate(simNow())} (maju ${(offset / 3600000).toFixed(offset % 3600000 ? 1 : 0)} jam dari waktu asli)` : 'Jam simulasi: sama dengan waktu asli.';
}

function renderActions() {
  $('#t-actions').innerHTML = `<button data-t="reset" class="${BTN_LIGHT}">Reset nomor ini</button>
    <button data-t="mode" class="${BTN_LIGHT}">${st.mode === 'bot' ? 'Simulasikan take over admin' : 'Kembalikan ke bot'}</button>
    <span class="text-xs text-gray-500 self-center ml-2">Majukan waktu:</span>
    <button data-h="1" class="${BTN_LIGHT}">+1 jam</button><button data-h="24" class="${BTN_LIGHT}">+1 hari</button><button data-h="168" class="${BTN_LIGHT}">+7 hari</button>`;
}

function renderCrm() {
  const el = $('#t-crm');
  if (!el) return;
  if (!leads.length) {
    el.innerHTML = '<div class="p-8 text-center text-sm text-gray-400 italic">Belum ada nomor uji yang menjadi lead. Chat harus memuat kata kunci sumber (misalnya Instagram atau TikTok) agar tercatat di CRM.</div>';
    return;
  }
  const label = Object.fromEntries((S.requiredFields || []).map((f) => [f.id, f.label]));
  el.innerHTML = `<table class="w-full text-left border-collapse text-sm">
    <thead><tr class="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium">
      <th class="p-4">Nama / No WA</th><th class="p-4">Sumber</th><th class="p-4">Keyword Matched</th><th class="p-4">Status Lead</th><th class="p-4">Data Leads</th><th class="p-4">Tanggal Masuk</th>
    </tr></thead><tbody class="divide-y divide-gray-200">${leads.map((l) => {
      const collected = Object.entries(l.data || {});
      return `<tr class="${l.phone === phone ? 'bg-brand-50/40' : ''}">
      <td class="p-4"><div class="font-medium text-gray-900">${esc(l.name || 'Tanpa nama')}</div><div class="text-xs text-gray-500">${esc(l.phone)}</div></td>
      <td class="p-4">${esc(l.platform)}</td>
      <td class="p-4 text-gray-600">${esc(l.keyword || '-')}</td>
      <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-medium ${ST[l.status] || ''}">${esc(l.status)}</span><div class="text-[11px] text-gray-500 mt-1">${esc(l.statusReason || '')}</div></td>
      <td class="p-4"><span class="px-2.5 py-1 rounded-full text-xs font-medium ${DT[l.dataType] || ''}">${esc(l.dataType)}</span><div class="text-[11px] text-gray-500 mt-1">${esc(l.dataReason || '')}</div></td>
      <td class="p-4 text-gray-600 whitespace-nowrap">${esc(fmtDate(l.createdAt))}${collected.length ? `<div class="text-[11px] text-gray-500 mt-1 whitespace-normal">${collected.map(([k, v]) => `${esc(label[k] || k)}: ${esc(v)}`).join(' &middot; ')}</div>` : ''}</td>
    </tr>`;
    }).join('')}</tbody></table>`;
}

const chip = (text) => msgs.push({ id: 'sys' + Math.random().toString(36).slice(2, 8), by: 'system', ts: Date.now(), text });

async function onAction(e) {
  const b = e.target.closest('[data-t],[data-h]');
  if (!b) return;
  try {
    if (b.dataset.t === 'reset-all') {
      if (!confirm('Reset semua nomor uji?')) return;
      await send('/api/tester/reset', {});
      setView(await api(qs(phone)));
    } else if (b.dataset.t === 'reset') {
      await send('/api/tester/reset', { phone });
      setView(await api(qs(phone)));
    } else if (b.dataset.t === 'mode') {
      const r = await send('/api/tester/mode', { phone, mode: st.mode === 'bot' ? 'admin' : 'bot' });
      st = r.status; stAt = Date.now();
      chip(st.mode === 'admin' ? `${S.adminName} mengambil alih percakapan` : 'Percakapan dikembalikan ke bot');
    } else if (b.dataset.h) {
      const v = await send('/api/tester/advance', { phone, hours: Number(b.dataset.h) });
      const keep = msgs; setView(v); msgs = keep;
      chip(`Waktu simulasi maju ${b.dataset.h} jam`);
    }
    renderAll();
  } catch (err) { toast(err.message, true); }
}

function submit() {
  const ta = $('#t-input');
  const text = ta.value.trim();
  if (!text) return;
  ta.value = '';
  const p = phone;
  chain = chain.then(() => handle(p, text)).catch((e) => toast(e.message, true));
}

async function handle(p, text) {
  const r = await send('/api/tester/send', { phone: p, text });
  if (gone || p !== phone) return; // pindah nomor saat menunggu: tampilan tidak dicampur
  msgs.push(r.message);
  if (r.changes?.length) chip('Sistem: ' + r.changes.join(' · '));
  st = r.status; stAt = Date.now(); data = r.data;
  renderBody();
  if (r.replies.length) $('#t-sub').textContent = 'mengetik...';
  for (const rep of r.replies) {
    await sleep(500 + Math.min(1500, rep.text.length * 10));
    if (gone || p !== phone) return;
    msgs.push(rep);
    renderBody();
  }
  if (gone || p !== phone) return;
  const v = await api(qs(p)); // ambil ulang agar tabel CRM semua nomor uji ikut diperbarui
  numbers = v.numbers; leads = v.leads;
  $('#t-sub').textContent = 'online';
  renderNumbers(); renderActions(); renderLine(); renderCrm();
}