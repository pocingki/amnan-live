// Integrasi: hubungkan Booking Live dengan satu kode sambungan (tanpa mengutak-atik .env).
import { $, api, send, esc, field, icon, toast, confirmDialog, getMe, fmtDate, INP, BTN_DARK, BTN_LIGHT, BTN_DANGER } from '../lib.js';

let root = null;
let freshCode = '';

const when = (iso) => (iso ? fmtDate(Date.parse(iso)) : '-');

export async function mount(el) {
  root = el;
  freshCode = '';
  const me = await getMe();
  if (me && me.role && me.role !== 'admin') {
    el.innerHTML = `<h1 class="sr-only">Integrasi</h1><div class="attn-banner" role="note">${icon('info')}<span>Menu Integrasi khusus Admin.</span></div>`;
    return;
  }
  await render();
}

export function unmount() { root = null; freshCode = ''; }

async function render() {
  if (!root) return;
  const st = await api('/api/integrations/booking');
  const connected = st.connected;
  const hook = st.webhook;
  const hookTxt = !hook ? '-' : hook.active ? (hook.lastStatus === 'ok' ? 'Aktif, terakhir terkirim ' + when(hook.lastAt) : hook.lastStatus ? 'Aktif, terakhir gagal: ' + hook.lastStatus : 'Aktif, belum ada kiriman') : 'Nonaktif (terlalu banyak gagal)';
  root.innerHTML = `<h1 class="sr-only">Integrasi</h1>
  <div class="max-w-2xl mx-auto space-y-6">
    <section class="card space-y-4" aria-labelledby="i-title">
      <div><h2 id="i-title" class="font-bold text-lg text-gray-900">Hubungkan Booking Live</h2>
        <p class="text-sm text-gray-600">Buat satu kode sambungan di sini, lalu tempel di menu <b>WhatsApp</b> pada Booking Live (di panel kiri). Tidak perlu mengisi berkas <code>.env</code>. Kabar ke aplikasi (lead, pesan masuk, status WhatsApp) dikirim sebagai webhook bertanda tangan dari halaman ini. Telegram untuk operator ada di Pengaturan.</p></div>

      ${connected ? `<dl class="text-sm grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
          <dt class="text-gray-600">Status</dt><dd class="font-medium text-green-700">Tersambung</dd>
          <dt class="text-gray-600">Alamat Booking</dt><dd class="break-all">${esc(st.bookingUrl)}</dd>
          <dt class="text-gray-600">Disambungkan</dt><dd>${esc(when(st.connectedAt))}</dd>
          <dt class="text-gray-600">Kunci terakhir dipakai</dt><dd>${esc(when(st.key?.lastUsedAt))}${st.key?.lastUsedAt ? '' : ' (Booking belum memakai kodenya)'}</dd>
          <dt class="text-gray-600">Kabar ke Booking</dt><dd>${esc(hookTxt)}</dd></dl>`
        : `<p class="text-sm text-gray-700">${st.fromEnv ? 'Saat ini tersambung lewat <code>.env</code> (cara lama). Membuat kode di sini akan menggantikannya.' : 'Belum tersambung.'}</p>`}

      <form id="i-form" class="space-y-3" novalidate>
        ${field('Alamat Booking Live', `<input name="bookingUrl" class="${INP}" placeholder="https://book.klinik.com" value="${esc(st.bookingUrl || '')}" autocomplete="off" required>`, 'Alamat yang dibuka pelanggan untuk booking. Harus https bila bukan uji lokal.')}
        ${field('Alamat Amnan ini', `<input name="amnanUrl" class="${INP}" value="${esc(location.origin)}" autocomplete="off" required>`, 'Alamat yang bisa dijangkau oleh Booking. Ubah bila Amnan diakses lewat alamat lain.')}
        <div class="flex flex-wrap gap-2">
          <button type="submit" class="${BTN_DARK}" id="i-go">${connected ? 'Buat ulang kode sambungan' : 'Buat kode sambungan'}</button>
          ${connected ? `<button type="button" class="${BTN_DANGER}" id="i-off">Putuskan</button>` : ''}
        </div>
        ${connected ? '<p class="text-xs text-gray-600">Membuat ulang kode mencabut kunci lama: Booking harus menempel kode baru.</p>' : ''}
        <p id="i-err" class="text-sm text-red-700" role="alert" hidden></p>
      </form>

      <div id="i-code" ${freshCode ? '' : 'hidden'} class="space-y-2 border-t border-gray-200 pt-4">
        <p class="text-sm font-medium text-gray-900">Kode sambungan</p>
        <textarea id="i-code-text" class="${INP} font-mono text-xs" rows="5" readonly aria-label="Kode sambungan">${esc(freshCode)}</textarea>
        <div class="flex flex-wrap gap-2 items-center"><button type="button" id="i-copy" class="${BTN_LIGHT}">Salin kode</button>
          <span class="text-xs text-gray-600">Kode ini berisi rahasia dan hanya tampil sekarang. Tempel di Booking, lalu jangan simpan di tempat lain.</span></div>
      </div>
    </section>
  </div>`;

  const form = $('#i-form', root);
  const err = (m) => { const e = $('#i-err', root); e.textContent = m || ''; e.hidden = !m; };
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err('');
    const f = new FormData(form);
    const btn = $('#i-go', root);
    btn.disabled = true;
    try {
      const r = await send('/api/integrations/booking', { bookingUrl: String(f.get('bookingUrl') || ''), amnanUrl: String(f.get('amnanUrl') || '') });
      freshCode = r.code;
      toast('Kode sambungan dibuat. Tempel di Booking Live.');
      await render();
      $('#i-code-text', root)?.focus();
    } catch (e) {
      err(e.message);
      btn.disabled = false;
    }
  });
  $('#i-copy', root)?.addEventListener('click', async () => {
    const ta = $('#i-code-text', root);
    try { await navigator.clipboard.writeText(ta.value); toast('Kode disalin.'); } catch { ta.select(); toast('Tekan Ctrl+C untuk menyalin.'); }
  });
  $('#i-off', root)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Putuskan Booking Live?', 'Kunci dicabut dan Booking tidak bisa lagi mengirim pesan atau menyinkronkan kontak sampai disambungkan ulang.', { okText: 'Putuskan', danger: true }))) return;
    try { await api('/api/integrations/booking', { method: 'DELETE' }); freshCode = ''; toast('Sambungan diputus.'); await render(); } catch (e) { toast(e.message, true); }
  });
}
