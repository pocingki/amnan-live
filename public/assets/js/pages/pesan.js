// Pesan: intent & respons (prioritas, urutan, bentrok kata kunci), kamus gaul, data wajib CRM, impor/ekspor.
import {
  $, esc, field, icon, INP, BTN_DARK, BTN_LIGHT, modal, toast, debounce, confirmDialog, getMe, isAdminRole,
  loadSettings, getSettings, saveSettings, onSettingsChange, openSettingsHistory, FIELD_TYPES, INTENT_LIMIT,
  keywordConflicts, conflictText, parseKeywords, parseOptions, parseSlang, slangToText, intentsFromCSV,
  intentsFromJSON, previewIntentImport, toCSV,
} from '../lib.js';

let S, root, canEdit = true, off = null;
const VARS = 'Variabel: {nama} {bot} {admin}';
const byId = (list, id) => list.findIndex((x) => x.id === id);

export async function mount(el) {
  root = el;
  const [, me] = await Promise.all([loadSettings(), getMe().catch(() => null)]);
  S = getSettings();
  canEdit = isAdminRole(me);
  off = onSettingsChange((s, src) => { if (src !== 'save') { S = s; render(); } });
  render();
}
export function unmount() { off?.(); off = null; }

/** Simpan lewat antrean; setelah selesai/konflik gambar ulang halaman supaya selalu cocok dengan server. */
async function commit(patchOrFn, opt) {
  try { await saveSettings(patchOrFn, opt); } catch (e) {
    if (!e.conflict) toast(e.message, true);
  }
  S = getSettings();
  render();
}

const gone = () => { throw new Error('Data ini sudah dihapus oleh orang lain. Halaman dimuat ulang.'); };

function render() {
  const conflicts = keywordConflicts(S.intents);
  const nConf = conflicts.size;
  const dis = canEdit ? '' : 'disabled';
  root.innerHTML = `<h1 class="sr-only">Pesan</h1><div class="space-y-8">
  ${canEdit ? '' : `<div class="attn-banner" role="note">${icon('info')}<span>Anda masuk sebagai Agen. Halaman ini hanya bisa dilihat; hanya Admin yang dapat mengubah pengaturan.</span></div>`}
  <section class="card space-y-4" aria-labelledby="h-intent">
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div><h2 id="h-intent" class="text-xl font-bold">Intent &amp; Respons</h2><p class="text-sm text-gray-600">Bot membalas dengan respons dari intent yang kata kuncinya paling banyak cocok dengan pesan pelanggan. Saat beberapa intent sama-sama cocok, prioritas lebih tinggi diutamakan. Maksimal ${INTENT_LIMIT} intent.</p></div>
      <div class="flex flex-wrap gap-2">
        ${canEdit ? `<button type="button" id="i-add" class="${BTN_DARK}">Tambah intent</button><button type="button" id="i-import" class="${BTN_LIGHT}">Impor</button>` : ''}
        <button type="button" id="i-export" class="${BTN_LIGHT}">Ekspor CSV</button>
        <button type="button" id="i-template" class="${BTN_LIGHT}">Unduh template</button>
        <button type="button" id="i-history" class="${BTN_LIGHT}">Riwayat versi</button>
        <input id="i-file" type="file" accept=".csv,.json,.txt" hidden aria-label="Pilih file impor intent">
      </div>
    </div>
    ${nConf ? `<div class="warn-box" role="note">${icon('alert')}<span><b>${nConf} intent punya kata kunci yang bentrok</b> dengan intent lain. Bot bisa memilih intent yang tidak Anda maksud; atur prioritas atau ubah kata kuncinya.</span></div>` : ''}
    <div class="overflow-x-auto"><table class="w-full text-left text-sm border-collapse rtable">
      <caption class="sr-only">Daftar intent dan respons</caption>
      <thead><tr class="bg-gray-50 border-b border-gray-200 text-gray-600 font-medium"><th scope="col" class="p-3">Aktif</th><th scope="col" class="p-3">Intent</th><th scope="col" class="p-3">Kata kunci</th><th scope="col" class="p-3">Respons</th><th scope="col" class="p-3">Prioritas</th><th scope="col" class="p-3">Aksi</th></tr></thead>
      <tbody class="divide-y divide-gray-200">${S.intents.length ? S.intents.map((it, i) => `<tr>
        <td class="p-3" data-label="Aktif"><input type="checkbox" data-toggle="${esc(it.id)}" aria-label="Aktifkan intent ${esc(it.name)}" ${it.active ? 'checked' : ''} ${dis}></td>
        <td class="p-3 font-medium" data-label="Intent">${esc(it.name)}${it.active ? '' : ' <span class="tag">Nonaktif</span>'}</td>
        <td class="p-3 text-gray-700" data-label="Kata kunci">${esc(it.keywords.join(', ') || '-')}${(conflicts.get(i) || []).slice(0, 3).map((c) => `<div class="warn-text">${icon('alert', 'icon-xs')} ${esc(conflictText(c))}</div>`).join('')}</td>
        <td class="p-3 text-gray-700 max-w-sm" data-label="Respons"><div class="line-clamp-2 whitespace-pre-wrap">${esc(it.response)}</div></td>
        <td class="p-3" data-label="Prioritas">${esc(it.priority ?? 0)}</td>
        <td class="p-3 whitespace-nowrap text-right" data-label="Aksi">${canEdit ? `
          <button type="button" class="mini-btn" data-up="${esc(it.id)}" aria-label="Naikkan urutan intent ${esc(it.name)}" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button type="button" class="mini-btn" data-down="${esc(it.id)}" aria-label="Turunkan urutan intent ${esc(it.name)}" ${i === S.intents.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
          <button type="button" data-edit="${esc(it.id)}" class="link-btn mr-2" aria-label="Edit intent ${esc(it.name)}">Edit</button><button type="button" data-del="${esc(it.id)}" class="link-btn danger" aria-label="Hapus intent ${esc(it.name)}">Hapus</button>` : '-'}</td></tr>`).join('')
        : '<tr><td colspan="6" class="p-8 text-center text-gray-600 italic">Belum ada intent.</td></tr>'}</tbody></table></div>
    <form id="fb-form" class="space-y-2 border-t border-gray-100 pt-4">
      ${field('Respons default (jika tidak ada intent yang cocok)', `<textarea name="fallbackMessage" rows="2" class="${INP}" ${dis}>${esc(S.fallbackMessage)}</textarea>`, VARS + '. Kosongkan agar bot diam jika tidak ada yang cocok.')}
      ${canEdit ? `<button class="${BTN_LIGHT}">Simpan respons default</button>` : ''}
    </form>
    <form id="sl-form" class="space-y-2 border-t border-gray-100 pt-4">
      ${field('Kamus bahasa gaul (slangMap)', `<textarea name="slang" rows="4" class="${INP} font-mono" placeholder="gak = tidak&#10;bgt = banget" ${dis}>${esc(slangToText(S.slangMap))}</textarea>`, 'Satu per baris: kata gaul = kata baku. Pesan pelanggan dinormalkan memakai kamus ini sebelum dicocokkan dengan kata kunci.')}
      <div id="sl-err" class="form-error" role="alert" hidden></div>
      ${canEdit ? `<button class="${BTN_LIGHT}">Simpan kamus</button>` : ''}
    </form>
  </section>

  <section class="card space-y-4" aria-labelledby="h-field">
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div><h2 id="h-field" class="text-xl font-bold">Data Wajib untuk CRM</h2><p class="text-sm text-gray-600">Setelah pesan pembuka, bot menanyakan data ini satu per satu sesuai urutan. Jawaban pelanggan tersimpan ke data lead. Pelanggan bisa membalas "lewati".</p></div>
      ${canEdit ? `<button type="button" id="f-add" class="${BTN_DARK}">Tambah data wajib</button>` : ''}
    </div>
    <div class="overflow-x-auto"><table class="w-full text-left text-sm border-collapse rtable">
      <caption class="sr-only">Daftar data wajib</caption>
      <thead><tr class="bg-gray-50 border-b border-gray-200 text-gray-600 font-medium"><th scope="col" class="p-3">Aktif</th><th scope="col" class="p-3">Data</th><th scope="col" class="p-3">Tipe</th><th scope="col" class="p-3">Pertanyaan bot</th><th scope="col" class="p-3">Aksi</th></tr></thead>
      <tbody class="divide-y divide-gray-200">${S.requiredFields.length ? S.requiredFields.map((f, i) => `<tr>
        <td class="p-3" data-label="Aktif"><input type="checkbox" data-ftoggle="${esc(f.id)}" aria-label="Aktifkan data ${esc(f.label)}" ${f.enabled ? 'checked' : ''} ${dis}></td>
        <td class="p-3 font-medium" data-label="Data">${esc(f.label)}</td>
        <td class="p-3" data-label="Tipe">${esc(FIELD_TYPES[f.type] || FIELD_TYPES.text)}${f.type === 'choice' ? `<div class="text-xs text-gray-600">${esc((f.options || []).join(', '))}</div>` : ''}</td>
        <td class="p-3 text-gray-700" data-label="Pertanyaan bot">${esc(f.question)}</td>
        <td class="p-3 whitespace-nowrap text-right" data-label="Aksi">${canEdit ? `
          <button type="button" class="mini-btn" data-fup="${esc(f.id)}" aria-label="Naikkan urutan ${esc(f.label)}" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button type="button" class="mini-btn" data-fdown="${esc(f.id)}" aria-label="Turunkan urutan ${esc(f.label)}" ${i === S.requiredFields.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
          <button type="button" data-fedit="${esc(f.id)}" class="link-btn mr-2" aria-label="Edit data ${esc(f.label)}">Edit</button><button type="button" data-fdel="${esc(f.id)}" class="link-btn danger" aria-label="Hapus data ${esc(f.label)}">Hapus</button>` : '-'}</td></tr>`).join('')
        : '<tr><td colspan="5" class="p-8 text-center text-gray-600 italic">Belum ada data wajib. Bot tidak menanyakan data apa pun.</td></tr>'}</tbody></table></div>
    <form id="cm-form" class="space-y-2 border-t border-gray-100 pt-4">
      ${field('Pesan setelah semua data terkumpul', `<textarea name="completionMessage" rows="2" class="${INP}" ${dis}>${esc(S.completionMessage)}</textarea>`, VARS)}
      ${canEdit ? `<button class="${BTN_LIGHT}">Simpan pesan penutup</button>` : ''}
    </form>
  </section></div>`;
  bind();
}

function bind() {
  $('#i-add')?.addEventListener('click', () => intentModal());
  $('#i-import')?.addEventListener('click', () => $('#i-file').click());
  $('#i-file').onchange = (e) => { if (e.target.files[0]) onFile(e.target.files[0]); e.target.value = ''; };
  $('#i-history').onclick = openSettingsHistory;
  $('#i-export').onclick = () => download('intent-respons.csv', toCSV(CSV_HEAD, S.intents.map((i) => [i.name, i.keywords.join('|'), i.response, i.active ? 1 : 0, i.priority ?? 0])));
  $('#i-template').onclick = () => download('template-intent-respons.csv', toCSV(CSV_HEAD, [['Tanya harga', 'harga|biaya|tarif', 'Untuk informasi harga, {admin} akan mengirimkan rinciannya.', 1, 0]]));
  $('#f-add')?.addEventListener('click', () => fieldModal());
  $('#fb-form').onsubmit = (e) => { e.preventDefault(); const v = new FormData(e.target).get('fallbackMessage'); commit({ fallbackMessage: v }); };
  $('#cm-form').onsubmit = (e) => { e.preventDefault(); const v = new FormData(e.target).get('completionMessage'); commit({ completionMessage: v }); };
  $('#sl-form').onsubmit = (e) => {
    e.preventDefault();
    const { map, errors } = parseSlang(new FormData(e.target).get('slang'));
    const box = $('#sl-err');
    box.hidden = !errors.length;
    box.innerHTML = errors.map((x) => `Baris ${x.line}: ${esc(x.msg)}`).join('<br>');
    if (!errors.length) commit({ slangMap: map });
  };

  root.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.edit) intentModal(d.edit);
    else if (d.del) {
      const it = S.intents[byId(S.intents, d.del)];
      if (await confirmDialog('Hapus intent?', `Hapus intent "${it?.name ?? ''}"?`, { okText: 'Hapus', danger: true })) commit((c) => ({ intents: c.intents.filter((x) => x.id !== d.del) }));
    } else if (d.up || d.down) commit((c) => move(c.intents, d.up || d.down, d.up ? -1 : 1, 'intents'));
    else if (d.fedit) fieldModal(d.fedit);
    else if (d.fdel) {
      const f = S.requiredFields[byId(S.requiredFields, d.fdel)];
      if (await confirmDialog('Hapus data wajib?', `Hapus data wajib "${f?.label ?? ''}"?`, { okText: 'Hapus', danger: true })) commit((c) => ({ requiredFields: c.requiredFields.filter((x) => x.id !== d.fdel) }));
    } else if (d.fup || d.fdown) commit((c) => move(c.requiredFields, d.fup || d.fdown, d.fup ? -1 : 1, 'requiredFields'));
  };
  root.onchange = (e) => {
    const d = e.target.dataset, on = e.target.checked;
    if (d.toggle) commit((c) => ({ intents: c.intents.map((it) => (it.id === d.toggle ? { ...it, active: on } : it)) }));
    if (d.ftoggle) commit((c) => ({ requiredFields: c.requiredFields.map((f) => (f.id === d.ftoggle ? { ...f, enabled: on } : f)) }));
  };
}

/** Geser item berdasarkan id (aman terhadap perubahan urutan oleh orang lain). */
export function move(list, id, dir, key) {
  const i = byId(list, id);
  if (i < 0) gone();
  const j = i + dir;
  if (j < 0 || j >= list.length) return null;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return { [key]: next };
}

function intentModal(id) {
  const idx = id != null ? byId(S.intents, id) : -1;
  const it = idx >= 0 ? S.intents[idx] : { name: '', keywords: [], response: '', active: true, priority: 0 };
  const d = modal(idx >= 0 ? 'Edit intent' : 'Tambah intent', `
    ${field('Nama intent', `<input name="name" required maxlength="80" class="${INP}" value="${esc(it.name)}" placeholder="Contoh: Tanya harga">`)}
    ${field('Kata kunci', `<textarea name="keywords" rows="2" class="${INP}" placeholder="harga, biaya, tarif">${esc(it.keywords.join(', '))}</textarea>`, 'Pisahkan dengan koma atau baris baru. Dicocokkan sebagai kata utuh, tidak peka huruf besar/kecil.')}
    <div id="im-warn" class="warn-box" role="status" aria-live="polite" hidden></div>
    ${field('Respons', `<textarea name="response" required maxlength="2000" rows="4" class="${INP}">${esc(it.response)}</textarea>`, VARS)}
    ${field('Prioritas', `<input name="priority" type="number" min="0" max="100" step="1" class="${INP}" value="${esc(it.priority ?? 0)}">`, 'Bilangan bulat 0-100. Prioritas lebih tinggi diutamakan saat beberapa intent sama-sama cocok.')}
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="active" ${it.active ? 'checked' : ''}> Aktif</label>`,
  async (f) => {
    const v = new FormData(f);
    const pr = Number(v.get('priority') || 0);
    if (!Number.isInteger(pr) || pr < 0 || pr > 100) throw new Error('Prioritas harus bilangan bulat 0-100');
    const next = { ...it, name: String(v.get('name')).trim(), keywords: parseKeywords(v.get('keywords')), response: String(v.get('response')).trim(), priority: pr, active: v.get('active') === 'on' };
    if (idx < 0 && S.intents.length >= INTENT_LIMIT) throw new Error(`Maksimal ${INTENT_LIMIT} intent`);
    await saveSettings((c) => {
      if (idx < 0) return { intents: [...c.intents, next] };
      if (byId(c.intents, it.id) < 0) gone();
      return { intents: c.intents.map((x) => (x.id === it.id ? next : x)) };
    });
    S = getSettings();
    render();
  }, 'Simpan', { wide: true });
  // peringatan bentrok langsung saat mengetik kata kunci
  const warn = d.form.querySelector('#im-warn');
  const check = () => {
    const cand = { name: d.form.name.value || 'intent ini', keywords: parseKeywords(d.form.keywords.value), active: true };
    const others = S.intents.filter((x) => x.id !== it.id);
    const c = keywordConflicts([...others, cand]).get(others.length) || [];
    warn.hidden = !c.length;
    warn.innerHTML = c.length ? icon('alert') + '<span>' + c.map((x) => esc(conflictText(x))).join('<br>') + '</span>' : '';
  };
  d.form.keywords.addEventListener('input', debounce(check, 250));
  check();
}

function fieldModal(id) {
  const idx = id != null ? byId(S.requiredFields, id) : -1;
  const f0 = idx >= 0 ? S.requiredFields[idx] : { label: '', question: '', enabled: true, type: 'text', options: [] };
  const type0 = f0.type || 'text';
  const d = modal(idx >= 0 ? 'Edit data wajib' : 'Tambah data wajib', `
    ${field('Nama data', `<input name="label" required maxlength="60" class="${INP}" value="${esc(f0.label)}" placeholder="Contoh: Tanggal keberangkatan">`, 'Tampil sebagai kolom data di detail lead. Data bernama "Nama" otomatis mengisi nama lead.')}
    ${field('Pertanyaan bot', `<textarea name="question" required maxlength="500" rows="3" class="${INP}">${esc(f0.question)}</textarea>`, VARS)}
    ${field('Tipe jawaban', `<select name="type" class="${INP}">${Object.entries(FIELD_TYPES).map(([k, v]) => `<option value="${k}" ${k === type0 ? 'selected' : ''}>${v}</option>`).join('')}</select>`, 'Bot memvalidasi jawaban sesuai tipe (mis. nomor telepon atau tanggal).')}
    <div id="fm-opt" ${type0 === 'choice' ? '' : 'hidden'}>${field('Pilihan jawaban', `<textarea name="options" rows="3" class="${INP}" placeholder="Satu pilihan per baris">${esc((f0.options || []).join('\n'))}</textarea>`, 'Minimal 2 pilihan. Satu per baris atau dipisah koma.')}</div>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" ${f0.enabled ? 'checked' : ''}> Aktif</label>`,
  async (f) => {
    const v = new FormData(f);
    const type = v.get('type');
    const options = type === 'choice' ? parseOptions(v.get('options')) : [];
    if (type === 'choice' && options.length < 2) throw new Error('Tipe Pilihan butuh minimal 2 pilihan jawaban.');
    if (options.some((o) => o.length > 60) || options.length > 20) throw new Error('Maksimal 20 pilihan, masing-masing sampai 60 karakter.');
    const next = { ...f0, label: String(v.get('label')).trim(), question: String(v.get('question')).trim(), type, options, enabled: v.get('enabled') === 'on' };
    await saveSettings((c) => {
      if (idx < 0) return { requiredFields: [...c.requiredFields, next] };
      if (byId(c.requiredFields, f0.id) < 0) gone();
      return { requiredFields: c.requiredFields.map((x) => (x.id === f0.id ? next : x)) };
    });
    S = getSettings();
    render();
  });
  d.form.type.addEventListener('change', (e) => { d.form.querySelector('#fm-opt').hidden = e.target.value !== 'choice'; });
}

// ---------- impor / ekspor ----------
const CSV_HEAD = ['intent', 'kata_kunci', 'respons', 'aktif', 'prioritas'];
const MAX_FILE = 2 * 1024 * 1024;
const STATE_LABEL = { baru: ['Baru', 'tag-ok', 'plus'], duplikat: ['Duplikat', 'tag-info', 'info'], error: ['Error', 'tag-warn', 'alert'] };

async function onFile(file) {
  if (file.size > MAX_FILE) return toast('File terlalu besar (maks. 2 MB). Pecah menjadi beberapa file lebih kecil.', true);
  let parsed;
  try {
    const text = await file.text();
    parsed = file.name.toLowerCase().endsWith('.json') ? intentsFromJSON(text) : intentsFromCSV(text);
  } catch (e) { return toast('File tidak bisa dibaca: ' + e.message, true); }
  if (!parsed.items.length) return toast('File kosong atau formatnya tidak dikenali. Gunakan template (kolom: intent, kata_kunci, respons, aktif, prioritas).', true);

  let mode = 'add';
  const d = modal('Impor intent & respons', `
    <p class="text-sm">${parsed.items.length} baris ditemukan di <b>${esc(file.name)}</b>. Periksa pratinjau sebelum mengimpor.</p>
    ${parsed.errors.map((x) => `<div class="warn-box">${icon('alert')}<span>${esc(x.msg)}</span></div>`).join('')}
    <fieldset class="space-y-1"><legend class="text-sm font-medium">Jika nama intent sudah ada</legend>
      <label class="flex items-center gap-2 text-sm"><input type="radio" name="mode" value="add" checked> Lewati duplikat (tambahkan yang baru saja)</label>
      <label class="flex items-center gap-2 text-sm"><input type="radio" name="mode" value="update"> Perbarui intent yang sudah ada</label>
      <label class="flex items-center gap-2 text-sm"><input type="radio" name="mode" value="replace"> Ganti seluruh daftar dengan isi file</label></fieldset>
    <div id="imp-sum" class="text-sm font-medium" role="status" aria-live="polite"></div>
    <div class="overflow-x-auto max-h-72 overflow-y-auto border border-gray-200 rounded-lg"><table class="w-full text-left text-sm"><caption class="sr-only">Pratinjau impor per baris</caption>
      <thead><tr class="bg-gray-50 text-gray-600"><th scope="col" class="p-2">Baris</th><th scope="col" class="p-2">Status</th><th scope="col" class="p-2">Intent</th><th scope="col" class="p-2">Keterangan</th></tr></thead><tbody id="imp-rows"></tbody></table></div>
    <button type="button" id="imp-report" class="link-btn" hidden>Unduh laporan kesalahan (CSV)</button>`,
  async () => {
    const pv = previewIntentImport(S.intents, parsed.items, mode);
    const added = pv.counts.baru + (mode === 'update' ? pv.counts.duplikat : 0);
    if (!added) throw new Error('Tidak ada baris yang bisa diimpor. Perbaiki file atau ubah pilihan di atas.');
    if (mode === 'replace' && !(await confirmDialog('Ganti seluruh daftar?', `Semua ${S.intents.length} intent saat ini akan diganti dengan ${pv.result.length} intent dari file.`, { okText: 'Ganti', danger: true }))) throw new Error('Impor dibatalkan.');
    await saveSettings((c) => ({ intents: previewIntentImport(c.intents, parsed.items, mode).result }), { message: `${added} intent diimpor` });
    S = getSettings();
    render();
  }, 'Impor', { wide: true });

  const paint = () => {
    const pv = previewIntentImport(S.intents, parsed.items, mode);
    d.form.querySelector('#imp-sum').textContent = `${pv.counts.baru} baru, ${pv.counts.duplikat} duplikat, ${pv.counts.error} error`;
    d.form.querySelector('#imp-rows').innerHTML = pv.rows.map((r) => { const [l, c, ic] = STATE_LABEL[r.state]; return `<tr class="border-t border-gray-100"><td class="p-2">${esc(r.line)}</td><td class="p-2"><span class="tag ${c}">${icon(ic, 'icon-xs')} ${l}</span></td><td class="p-2">${esc(r.name || '-')}</td><td class="p-2 text-gray-700">${esc(r.reason)}</td></tr>`; }).join('');
    const rep = d.form.querySelector('#imp-report');
    rep.hidden = !pv.counts.error;
    rep.onclick = () => download('laporan-kesalahan-impor.csv', toCSV(['baris', 'intent', 'alasan'], pv.rows.filter((r) => r.state === 'error').map((r) => [r.line, r.name, r.reason])));
  };
  d.form.addEventListener('change', (e) => { if (e.target.name === 'mode') { mode = e.target.value; paint(); } });
  paint();
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
