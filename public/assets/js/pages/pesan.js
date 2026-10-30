// Pesan: intent & respons, data wajib CRM, impor intent & respons.
import { $, api, send, esc, field, INP, BTN, BTN_DARK, BTN_LIGHT, modal, toast } from '../lib.js';

let S, root;

export async function mount(el) {
  root = el;
  S = await api('/api/settings');
  render();
}

async function save(patch) {
  S = await send('/api/settings', patch, 'PUT');
  window.dispatchEvent(new Event('settings-changed'));
  toast('Tersimpan');
  render();
}

const VARS = 'Variabel: {nama} {bot} {admin}';

function render() {
  root.innerHTML = `<div class="space-y-8">
  <section class="card space-y-4">
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div><h2 class="text-xl font-bold">Intent &amp; Respons</h2><p class="text-sm text-gray-500">Bot membalas dengan respons dari intent yang kata kuncinya paling banyak cocok dengan pesan pelanggan.</p></div>
      <div class="flex flex-wrap gap-2">
        <button id="i-add" class="${BTN_DARK}">Tambah intent</button>
        <button id="i-import" class="${BTN_LIGHT}">Impor</button>
        <button id="i-export" class="${BTN_LIGHT}">Ekspor CSV</button>
        <button id="i-template" class="${BTN_LIGHT}">Unduh template</button>
        <input id="i-file" type="file" accept=".csv,.json,.txt" class="hidden">
      </div>
    </div>
    <div class="overflow-x-auto"><table class="w-full text-left text-sm border-collapse">
      <thead><tr class="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium"><th class="p-3">Aktif</th><th class="p-3">Intent</th><th class="p-3">Kata kunci</th><th class="p-3">Respons</th><th class="p-3"></th></tr></thead>
      <tbody class="divide-y divide-gray-200">${S.intents.length ? S.intents.map((it, i) => `<tr>
        <td class="p-3"><input type="checkbox" data-toggle="${i}" ${it.active ? 'checked' : ''}></td>
        <td class="p-3 font-medium">${esc(it.name)}</td>
        <td class="p-3 text-gray-600">${esc(it.keywords.join(', ') || '-')}</td>
        <td class="p-3 text-gray-600 max-w-sm"><div class="line-clamp-2 whitespace-pre-wrap">${esc(it.response)}</div></td>
        <td class="p-3 whitespace-nowrap text-right"><button data-edit="${i}" class="text-blue-600 hover:underline mr-3">Edit</button><button data-del="${i}" class="text-red-600 hover:underline">Hapus</button></td></tr>`).join('')
        : '<tr><td colspan="5" class="p-8 text-center text-gray-400 italic">Belum ada intent.</td></tr>'}</tbody></table></div>
    <form id="fb-form" class="space-y-2 border-t border-gray-100 pt-4">
      ${field('Respons default (jika tidak ada intent yang cocok)', `<textarea name="fallbackMessage" rows="2" class="${INP}">${esc(S.fallbackMessage)}</textarea>`, VARS + '. Kosongkan agar bot diam jika tidak ada yang cocok.')}
      <button class="${BTN_LIGHT}">Simpan respons default</button>
    </form>
  </section>

  <section class="card space-y-4">
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div><h2 class="text-xl font-bold">Data Wajib untuk CRM</h2><p class="text-sm text-gray-500">Setelah pesan pembuka, bot menanyakan data ini satu per satu. Jawaban pelanggan tersimpan ke data lead. Pelanggan bisa membalas "lewati".</p></div>
      <button id="f-add" class="${BTN_DARK}">Tambah data wajib</button>
    </div>
    <div class="overflow-x-auto"><table class="w-full text-left text-sm border-collapse">
      <thead><tr class="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium"><th class="p-3">Aktif</th><th class="p-3">Data</th><th class="p-3">Pertanyaan bot</th><th class="p-3"></th></tr></thead>
      <tbody class="divide-y divide-gray-200">${S.requiredFields.length ? S.requiredFields.map((f, i) => `<tr>
        <td class="p-3"><input type="checkbox" data-ftoggle="${i}" ${f.enabled ? 'checked' : ''}></td>
        <td class="p-3 font-medium">${esc(f.label)}</td><td class="p-3 text-gray-600">${esc(f.question)}</td>
        <td class="p-3 whitespace-nowrap text-right"><button data-fedit="${i}" class="text-blue-600 hover:underline mr-3">Edit</button><button data-fdel="${i}" class="text-red-600 hover:underline">Hapus</button></td></tr>`).join('')
        : '<tr><td colspan="4" class="p-8 text-center text-gray-400 italic">Belum ada data wajib. Bot tidak menanyakan data apa pun.</td></tr>'}</tbody></table></div>
    <form id="cm-form" class="space-y-2 border-t border-gray-100 pt-4">
      ${field('Pesan setelah semua data terkumpul', `<textarea name="completionMessage" rows="2" class="${INP}">${esc(S.completionMessage)}</textarea>`, VARS)}
      <button class="${BTN_LIGHT}">Simpan pesan penutup</button>
    </form>
  </section></div>`;
  bind();
}

function bind() {
  $('#i-add').onclick = () => intentModal();
  $('#i-import').onclick = () => $('#i-file').click();
  $('#i-file').onchange = (e) => { if (e.target.files[0]) onFile(e.target.files[0]); e.target.value = ''; };
  $('#i-export').onclick = () => download('intent-respons.csv', toCSV(S.intents.map((i) => [i.name, i.keywords.join('|'), i.response, i.active ? 1 : 0])));
  $('#i-template').onclick = () => download('template-intent-respons.csv', toCSV([['Tanya harga', 'harga|biaya|tarif', 'Untuk informasi harga, {admin} akan mengirimkan rinciannya.', 1]]));
  $('#fb-form').onsubmit = (e) => { e.preventDefault(); save({ fallbackMessage: new FormData(e.target).get('fallbackMessage') }); };
  $('#cm-form').onsubmit = (e) => { e.preventDefault(); save({ completionMessage: new FormData(e.target).get('completionMessage') }); };
  $('#f-add').onclick = () => fieldModal();

  root.onclick = (e) => {
    const d = e.target.dataset;
    if (d.edit != null) intentModal(+d.edit);
    else if (d.del != null) { if (confirm('Hapus intent ini?')) save({ intents: S.intents.filter((_, i) => i !== +d.del) }); }
    else if (d.fedit != null) fieldModal(+d.fedit);
    else if (d.fdel != null) { if (confirm('Hapus data wajib ini?')) save({ requiredFields: S.requiredFields.filter((_, i) => i !== +d.fdel) }); }
  };
  root.onchange = (e) => {
    const d = e.target.dataset;
    if (d.toggle != null) save({ intents: S.intents.map((it, i) => (i === +d.toggle ? { ...it, active: e.target.checked } : it)) });
    if (d.ftoggle != null) save({ requiredFields: S.requiredFields.map((f, i) => (i === +d.ftoggle ? { ...f, enabled: e.target.checked } : f)) });
  };
}

function intentModal(i) {
  const it = i != null ? S.intents[i] : { name: '', keywords: [], response: '', active: true };
  modal(i != null ? 'Edit intent' : 'Tambah intent', `
    ${field('Nama intent', `<input name="name" required class="${INP}" value="${esc(it.name)}" placeholder="Contoh: Tanya harga">`)}
    ${field('Kata kunci', `<textarea name="keywords" rows="2" class="${INP}" placeholder="harga, biaya, tarif">${esc(it.keywords.join(', '))}</textarea>`, 'Pisahkan dengan koma atau baris baru. Dicocokkan sebagai kata utuh, tidak peka huruf besar/kecil.')}
    ${field('Respons', `<textarea name="response" required rows="4" class="${INP}">${esc(it.response)}</textarea>`, VARS)}
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="active" ${it.active ? 'checked' : ''}> Aktif</label>`,
  async (f) => {
    const d = new FormData(f);
    const next = { ...it, name: d.get('name'), keywords: d.get('keywords'), response: d.get('response'), active: d.get('active') === 'on' };
    await save({ intents: i != null ? S.intents.map((x, k) => (k === i ? next : x)) : [...S.intents, next] });
  });
}

function fieldModal(i) {
  const f0 = i != null ? S.requiredFields[i] : { label: '', question: '', enabled: true };
  modal(i != null ? 'Edit data wajib' : 'Tambah data wajib', `
    ${field('Nama data', `<input name="label" required class="${INP}" value="${esc(f0.label)}" placeholder="Contoh: Tanggal keberangkatan">`, 'Tampil sebagai kolom data di detail lead. Data bernama "Nama" otomatis mengisi nama lead.')}
    ${field('Pertanyaan bot', `<textarea name="question" required rows="3" class="${INP}">${esc(f0.question)}</textarea>`, VARS)}
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" ${f0.enabled ? 'checked' : ''}> Aktif</label>`,
  async (f) => {
    const d = new FormData(f);
    const next = { ...f0, label: d.get('label'), question: d.get('question'), enabled: d.get('enabled') === 'on' };
    await save({ requiredFields: i != null ? S.requiredFields.map((x, k) => (k === i ? next : x)) : [...S.requiredFields, next] });
  });
}

// ---------- impor / ekspor ----------
function parseCSV(text) {
  const first = text.split(/\r?\n/, 1)[0];
  const d = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function fromCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...n) => head.findIndex((h) => n.includes(h));
  let iN = col('intent', 'nama', 'name'), iK = col('kata_kunci', 'kata kunci', 'keywords', 'keyword'), iR = col('respons', 'response', 'jawaban'), iA = col('aktif', 'active');
  let body = rows.slice(1);
  if (iN < 0 || iR < 0) { iN = 0; iK = 1; iR = 2; iA = 3; body = rows; } // tanpa header: urutan intent, kata kunci, respons, aktif
  return body.map((r) => ({
    name: r[iN] || '', keywords: r[iK] || '', response: r[iR] || '',
    active: !/^(0|tidak|no|false|nonaktif)$/i.test((r[iA] || '1').trim()),
  }));
}

function fromJSON(text) {
  const d = JSON.parse(text);
  const arr = Array.isArray(d) ? d : d.intents;
  if (!Array.isArray(arr)) throw new Error('JSON harus berupa array intent');
  return arr.map((x) => ({ name: x.name ?? x.intent ?? '', keywords: x.keywords ?? x.kata_kunci ?? '', response: x.response ?? x.respons ?? '', active: x.active ?? x.aktif ?? true }));
}

async function onFile(file) {
  let items;
  try {
    const text = (await file.text()).replace(/^﻿/, '');
    items = (file.name.toLowerCase().endsWith('.json') ? fromJSON(text) : fromCSV(text)).filter((x) => x.name && x.response);
  } catch (e) { return toast('File tidak bisa dibaca: ' + e.message, true); }
  if (!items.length) return toast('Tidak ada intent yang valid di file (butuh nama dan respons)', true);
  modal('Impor intent & respons', `<p class="text-sm">${items.length} intent ditemukan di <b>${esc(file.name)}</b>.</p>
    <label class="flex items-center gap-2 text-sm"><input type="radio" name="mode" value="add" checked> Tambahkan ke daftar yang ada</label>
    <label class="flex items-center gap-2 text-sm"><input type="radio" name="mode" value="replace"> Ganti seluruh daftar</label>`,
  async (f) => {
    const replace = new FormData(f).get('mode') === 'replace';
    await save({ intents: replace ? items : [...S.intents, ...items] });
  }, 'Impor');
}

const toCSV = (rows) => ['intent,kata_kunci,respons,aktif', ...rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','))].join('\r\n');

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
