// CRM: dashboard analytics + tabel lead.
import { $, api, send, esc, fmtDate, field, INP, modal, popMenu, toast } from '../lib.js';

const PERIOD = { day: 'Hari Ini', week: '7 Hari Terakhir', month: 'Bulan Ini', year: 'Tahun Ini' };
const ST = { 'Cold Leads': 'bg-blue-50 text-blue-700', 'Warm Leads': 'bg-amber-50 text-amber-700', 'Hot Leads': 'bg-red-50 text-red-700' };
const DT = { New: 'bg-brand-50 text-brand-800', Existing: 'bg-gray-100 text-gray-600' };

let timer, leads = [], meta = { statuses: [], dataTypes: [], platforms: [] }, labels = {}, period = 'day', lastKey = '', filled = false;

const card = (label, id, color, sub) => `<div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
  <p class="text-sm font-medium text-gray-500">${label}</p><p id="${id}" class="text-3xl font-bold mt-2 ${color}">0</p><p ${id === 'k-total' ? 'id="k-delta"' : ''} class="text-xs text-gray-400 mt-1">${sub}</p></div>`;
const chartBox = (title, id, empty) => `<div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm min-h-64 flex flex-col">
  <h3 class="text-sm font-bold text-gray-700" ${id === 'c-funnel' ? 'id="funnel-title"' : ''}>${title}</h3>
  <div id="${id}" class="flex-1 flex items-center justify-center text-sm text-gray-400 mt-4">${empty}</div></div>`;

export async function mount(el) {
  period = 'day'; lastKey = ''; filled = false;
  try {
    labels = Object.fromEntries((await api('/api/settings')).requiredFields.map((f) => [f.id, f.label]));
  } catch { /* abaikan */ }

  el.innerHTML = `<div class="space-y-8">
  <section class="space-y-6">
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-200 pb-4">
      <div><h2 class="text-2xl font-bold tracking-tight">Dashboard Laporan Analytics</h2><p class="text-sm text-gray-500">Ringkasan lead otomatis dari percakapan WhatsApp</p></div>
      <div id="period" class="flex bg-white border border-gray-300 rounded-lg p-1 text-sm shadow-sm">
        ${Object.entries({ day: 'Harian (Hari Ini)', week: 'Mingguan (7 Hari)', month: 'Bulanan (Bulan Ini)', year: 'Tahunan (Tahun Ini)' })
          .map(([k, v]) => `<button data-p="${k}" class="px-3 py-1.5 rounded-md ${k === 'day' ? 'bg-gray-100 font-medium' : 'text-gray-600 hover:text-gray-900'}">${v}</button>`).join('')}
      </div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      ${card('Total Leads', 'k-total', 'text-brand-800', '0% vs periode lalu')}
      ${card('Cold Leads', 'k-cold', 'text-sky-600', 'Pesan pertama masuk')}
      ${card('Warm Leads', 'k-warm', 'text-amber-500', 'Percakapan > 10 pesan')}
      ${card('Hot Leads', 'k-hot', 'text-red-600', 'Transaksi / booking')}
      ${card('Rate Konversi', 'k-rate', 'text-brand-700', 'Ratio Hot / Total')}
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      ${chartBox('Funnel Konversi Status Lead', 'c-funnel', 'Progres lead dari pesan pertama hingga closing (Menunggu data...)')}
      ${chartBox('Sumber Leads', 'c-source', 'Berdasarkan pencocokan kata kunci (Menunggu data...)')}
    </div>
  </section>

  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
    <div class="p-6 border-b border-gray-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
      <div><h3 class="font-bold text-lg text-gray-900">Lead Terbaru Masuk</h3><p class="text-sm text-gray-500">Otomatis terdeteksi dari WhatsApp listener</p></div>
      <div class="flex flex-wrap items-center gap-2">
        <select id="f-source" class="${INP} !w-auto"><option value="">Semua Sumber Leads</option></select>
        <select id="f-status" class="${INP} !w-auto"><option value="">Semua Status Leads</option></select>
        <select id="f-data" class="${INP} !w-auto"><option value="">Semua Data</option></select>
        <button id="btn-export" class="bg-brand-800 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-900"><i class="fa-solid fa-file-csv"></i> Export CSV</button>
      </div>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse text-sm">
        <thead><tr class="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium">
          <th class="p-4">Nama / No WA</th><th class="p-4">Sumber</th><th class="p-4">Keyword Matched</th><th class="p-4">Status Lead</th><th class="p-4">Data Leads</th><th class="p-4">Tanggal Masuk</th><th class="p-4 text-center w-12"></th>
        </tr></thead>
        <tbody id="rows" class="divide-y divide-gray-200"></tbody>
      </table>
    </div>
  </section>
  </div>`;

  $('#period').onclick = (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    period = b.dataset.p;
    document.querySelectorAll('#period [data-p]').forEach((x) => {
      const on = x === b;
      x.classList.toggle('bg-gray-100', on); x.classList.toggle('font-medium', on); x.classList.toggle('text-gray-600', !on);
    });
    renderStats();
  };
  ['f-source', 'f-status', 'f-data'].forEach((id) => ($('#' + id).onchange = () => { lastKey = ''; renderTable(); }));
  $('#btn-export').onclick = exportCSV;
  $('#rows').onclick = (e) => {
    const b = e.target.closest('.kebab');
    if (!b) return;
    const id = b.dataset.id;
    popMenu(b, [{ label: 'Edit', fn: () => edit(id) }, { label: 'Hapus', danger: true, fn: () => del(id) }]);
  };

  await load();
  timer = setInterval(load, 3000);
}

export function unmount() { clearInterval(timer); }

async function load() {
  try {
    const d = await api('/api/leads');
    leads = d.leads;
    meta = d;
    if (!filled && $('#f-source')) {
      const fill = (id, arr) => $(id).insertAdjacentHTML('beforeend', arr.map((x) => `<option>${esc(x)}</option>`).join(''));
      fill('#f-source', d.platforms); fill('#f-status', d.statuses); fill('#f-data', d.dataTypes);
      filled = true;
    }
    renderStats();
    renderTable();
  } catch (e) { console.error(e); }
}

// ---------- ringkasan ----------
function ranges(p) {
  const now = new Date(), day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === 'day') { const prev = new Date(day); prev.setDate(prev.getDate() - 1); return { from: day, prevFrom: prev, prevTo: day }; }
  if (p === 'week') { const from = new Date(now - 7 * 864e5); return { from, prevFrom: new Date(from - 7 * 864e5), prevTo: from }; }
  if (p === 'month') { const from = new Date(now.getFullYear(), now.getMonth(), 1); return { from, prevFrom: new Date(now.getFullYear(), now.getMonth() - 1, 1), prevTo: from }; }
  const from = new Date(now.getFullYear(), 0, 1);
  return { from, prevFrom: new Date(now.getFullYear() - 1, 0, 1), prevTo: from };
}

function bars(rows) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="w-full space-y-3">${rows.map((r) => `<div>
    <div class="flex justify-between text-xs text-gray-600 mb-1"><span>${esc(r.label)}</span><span class="font-medium">${r.value}</span></div>
    <div class="h-2.5 bg-gray-100 rounded-full overflow-hidden"><div class="h-full ${r.color} rounded-full" style="width:${(r.value / max) * 100}%"></div></div></div>`).join('')}</div>`;
}

function renderStats() {
  if (!$('#k-total')) return;
  const { from, prevFrom, prevTo } = ranges(period);
  const cur = leads.filter((l) => l.createdAt >= from.getTime());
  const prev = leads.filter((l) => l.createdAt >= prevFrom.getTime() && l.createdAt < prevTo.getTime()).length;
  const n = (s) => cur.filter((l) => l.status === s).length;
  const total = cur.length, cold = n('Cold Leads'), warm = n('Warm Leads'), hot = n('Hot Leads');

  $('#k-total').textContent = total; $('#k-cold').textContent = cold; $('#k-warm').textContent = warm; $('#k-hot').textContent = hot;
  $('#k-rate').textContent = (total ? (hot / total) * 100 : 0).toFixed(1) + '%';
  $('#k-delta').textContent = prev === 0 ? (total === 0 ? '0% vs periode lalu' : 'Belum ada data periode lalu') : `${total >= prev ? '+' : ''}${(((total - prev) / prev) * 100).toFixed(0)}% vs periode lalu`;
  $('#funnel-title').textContent = `Funnel Konversi Status Lead (${PERIOD[period]})`;

  const empty = (id, t) => { $(id).className = 'flex-1 flex items-center justify-center text-sm text-gray-400 mt-4'; $(id).textContent = t; };
  if (!total) {
    empty('#c-funnel', 'Progres lead dari pesan pertama hingga closing (Menunggu data...)');
    empty('#c-source', 'Berdasarkan pencocokan kata kunci (Menunggu data...)');
    return;
  }
  $('#c-funnel').className = 'flex-1 flex items-center mt-4';
  $('#c-funnel').innerHTML = bars([
    { label: 'Semua lead (Cold ke atas)', value: total, color: 'bg-brand-300' },
    { label: 'Percakapan > 10 pesan atau transaksi (Warm + Hot)', value: warm + hot, color: 'bg-brand-500' },
    { label: 'Transaksi / Booking (Hot)', value: hot, color: 'bg-brand-800' },
  ]);
  const by = {};
  cur.forEach((l) => (by[l.platform] = (by[l.platform] || 0) + 1));
  $('#c-source').className = 'flex-1 flex items-center mt-4';
  $('#c-source').innerHTML = bars(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, color: 'bg-brand-600' })));
}

// ---------- tabel ----------
const filtered = () => {
  const s = $('#f-source').value, st = $('#f-status').value, d = $('#f-data').value;
  return leads.filter((l) => (!s || l.platform === s) && (!st || l.status === st) && (!d || l.dataType === d));
};

function renderTable() {
  if (!$('#rows')) return;
  const rows = filtered();
  const key = JSON.stringify(rows);
  if (key === lastKey) return;
  lastKey = key;
  $('#rows').innerHTML = rows.length
    ? rows.map((l) => `<tr class="hover:bg-gray-50">
      <td class="p-4"><div class="font-medium text-gray-900">${esc(l.name || 'Tanpa nama')}</div><div class="text-xs text-gray-500">${esc(l.phone)}</div></td>
      <td class="p-4">${esc(l.platform)}</td>
      <td class="p-4 text-gray-600">${esc(l.keyword || '-')}</td>
      <td class="p-4"><span title="${esc(l.statusReason || '')}" class="px-2.5 py-1 rounded-full text-xs font-medium ${ST[l.status] || ''}">${esc(l.status)}</span>${l.statusManual ? '<div class="text-[10px] text-gray-400 mt-1">manual</div>' : ''}</td>
      <td class="p-4"><span title="${esc(l.dataReason || '')}" class="px-2.5 py-1 rounded-full text-xs font-medium ${DT[l.dataType] || ''}">${esc(l.dataType)}</span>${l.dataTypeManual ? '<div class="text-[10px] text-gray-400 mt-1">manual</div>' : ''}</td>
      <td class="p-4 text-gray-600 whitespace-nowrap">${esc(fmtDate(l.createdAt))}</td>
      <td class="p-4 text-center"><button class="kebab px-2 py-1 rounded hover:bg-gray-100 text-gray-500" data-id="${esc(l.id)}" title="Opsi">&#8942;</button></td></tr>`).join('')
    : `<tr><td colspan="7" class="p-10 text-center text-gray-400 italic">Belum ada data lead masuk. Aktifkan listener WA untuk memindai pesan secara otomatis.</td></tr>`;
}

// ---------- edit / hapus ----------
function edit(id) {
  const l = leads.find((x) => x.id === id);
  if (!l) return;
  const sel = (name, opts, cur) => `<select name="${name}" class="${INP}">${opts.map((o) => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  const data = Object.entries(l.data || {});
  modal('Edit lead', `
    ${field('Nama', `<input name="name" class="${INP}" value="${esc(l.name)}">`)}
    ${field('No WA', `<input class="${INP} bg-gray-100" value="${esc(l.phone)}" disabled>`)}
    ${field('Sumber', sel('platform', [...new Set([...meta.platforms, l.platform])], l.platform))}
    ${field('Keyword Matched', `<input name="keyword" class="${INP}" value="${esc(l.keyword)}">`)}
    ${field('Status Lead', sel('status', meta.statuses, l.status), 'Otomatis: Cold saat pesan masuk pertama kali, Warm saat percakapan lebih dari 10 pesan, Hot saat ada transaksi/booking/transfer. Jika diubah manual, status ini dikunci.')}
    ${field('Data Leads', sel('dataType', meta.dataTypes, l.dataType), 'Otomatis: New pada pesan masuk pertama kali; Existing bila customer yang pernah booking/transfer melakukannya untuk kedua kalinya (permanen). Jika diubah manual, dikunci.')}
    ${l.statusManual || l.dataTypeManual ? '<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="resetAuto"> Kembalikan Status Lead &amp; Data Leads ke otomatis</label>' : ''}
    ${data.length ? `<div class="text-sm"><div class="font-medium text-gray-700 mb-1">Data yang dikumpulkan bot</div><div class="bg-gray-50 rounded-lg p-3 space-y-1 text-gray-600">${data.map(([k, v]) => `<div><b>${esc(labels[k] || k)}:</b> ${esc(v)}</div>`).join('')}</div></div>` : ''}`,
  async (f) => {
    await send('/api/leads/' + encodeURIComponent(id), Object.fromEntries(new FormData(f)), 'PATCH');
    toast('Lead diperbarui');
    lastKey = '';
    await load();
  });
}

async function del(id) {
  const l = leads.find((x) => x.id === id);
  if (!confirm(`Hapus lead ${l?.name || l?.phone || ''}? Tindakan ini tidak bisa dibatalkan.`)) return;
  try { await send('/api/leads/' + encodeURIComponent(id), {}, 'DELETE'); lastKey = ''; await load(); } catch (e) { toast(e.message, true); }
}

// ---------- export CSV ----------
const cell = (v, guard = true) => {
  let s = String(v ?? '');
  if (guard && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // cegah formula injection
  return '"' + s.replace(/"/g, '""') + '"';
};

function exportCSV() {
  const head = ['Nama', 'No WA', 'Sumber', 'Keyword', 'Status Lead', 'Data Leads', 'Tanggal Masuk', 'Data Wajib'];
  const lines = filtered().map((l) => [
    cell(l.name), cell(l.phone, false), cell(l.platform), cell(l.keyword), cell(l.status), cell(l.dataType), cell(fmtDate(l.createdAt), false),
    cell(Object.entries(l.data || {}).map(([k, v]) => `${labels[k] || k}: ${v}`).join('; ')),
  ].join(','));
  const blob = new Blob(['﻿' + [head.map((h) => cell(h, false)).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}