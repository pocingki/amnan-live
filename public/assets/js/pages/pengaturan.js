// Pengaturan: koneksi WhatsApp (QR) + pengaturan bot.
import { $, api, send, esc, field, INP, BTN_DARK, toast } from '../lib.js';

let timer, S, lastQr = null;

const BADGE = {
  connected: ['TERHUBUNG', 'text-green-600'],
  qr: ['MENUNGGU SCAN QR', 'text-amber-600'],
  connecting: ['MENGHUBUNGKAN', 'text-amber-600'],
  disconnected: ['TERPUTUS', 'text-red-600'],
};

export async function mount(el) {
  S = await api('/api/settings');
  lastQr = null;
  el.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
    <form id="s-form" class="card space-y-4">
      <div><h3 class="font-bold text-lg text-gray-900">Pengaturan Bot</h3><p class="text-sm text-gray-500">Berlaku untuk WhatsApp asli dan Bot Tester</p></div>
      <label class="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="botEnabled" ${S.botEnabled ? 'checked' : ''}> Bot aktif (membalas chat otomatis)</label>
      ${field('Nama brand', `<input name="brandName" class="${INP}" value="${esc(S.brandName)}">`, 'Tampil di header dan footer')}
      ${field('Tagline brand', `<input name="brandTagline" class="${INP}" value="${esc(S.brandTagline)}">`, 'Tampil di bawah nama brand pada header')}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        ${field('Nama bot', `<input name="botName" class="${INP}" value="${esc(S.botName)}">`)}
        ${field('Nama admin', `<input name="adminName" class="${INP}" value="${esc(S.adminName)}">`)}
      </div>
      ${field('Pesan pembuka', `<textarea name="openingMessage" rows="4" class="${INP}">${esc(S.openingMessage)}</textarea>`, 'Dikirim untuk setiap chat pertama dari nomor baru. Variabel: {nama} {bot} {admin}')}
      ${field('Batas durasi bot aktif (menit)', `<input name="botDurationMinutes" type="number" min="0" max="10080" class="${INP}" value="${S.botDurationMinutes}">`, '0 = tanpa batas. Dihitung sejak chat pertama atau sejak dikembalikan ke bot. Jika habis, pesan berikutnya dari pelanggan otomatis kembali ke pesan pembuka dan durasi dihitung ulang.')}
      <button class="${BTN_DARK}">Simpan pengaturan</button>
    </form>

    <div class="card space-y-4">
      <div><h3 class="font-bold text-lg text-gray-900">Koneksi WhatsApp Gateway</h3><p class="text-sm text-gray-500">Kelola status listener dan login QR code nomor WhatsApp</p></div>
      <div class="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-2 text-sm">
        <p class="font-medium">Status Koneksi Saat Ini: <span id="w-label" class="font-bold text-red-600">TERPUTUS</span></p>
        <p id="w-number" class="hidden text-gray-600"></p>
        <p id="w-error" class="hidden text-red-600"></p>
      </div>
      <div id="w-qr" class="hidden flex-col items-center gap-3 border border-dashed border-gray-300 rounded-xl p-6">
        <img id="w-img" alt="QR code login WhatsApp" class="w-64 h-64">
        <p class="text-sm text-gray-500 text-center">Scan QR ini dari WhatsApp di HP. QR diperbarui otomatis.</p>
      </div>
      <button type="button" id="w-logout" class="hidden text-sm font-medium px-4 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50">Putuskan &amp; ganti nomor</button>
      <ol class="list-decimal list-inside space-y-1 text-sm text-gray-600">
        <li>Buka WhatsApp di HP, masuk ke Perangkat Tertaut.</li><li>Pilih Tautkan Perangkat, lalu scan QR di atas.</li><li>Setelah TERHUBUNG, chat masuk ke nomor tersebut diproses bot.</li>
      </ol>
    </div>
  </div>`;

  $('#s-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      S = await send('/api/settings', {
        botEnabled: f.get('botEnabled') === 'on', brandName: f.get('brandName'), brandTagline: f.get('brandTagline'), botName: f.get('botName'), adminName: f.get('adminName'),
        openingMessage: f.get('openingMessage'), botDurationMinutes: f.get('botDurationMinutes'),
      }, 'PUT');
      window.dispatchEvent(new Event('settings-changed'));
      toast('Pengaturan tersimpan');
    } catch (err) { toast(err.message, true); }
  };
  $('#w-logout').onclick = async () => {
    if (!confirm('Putuskan nomor WhatsApp ini dan tampilkan QR baru?')) return;
    try { await send('/api/wa/logout'); } catch (err) { toast(err.message, true); }
  };
  await poll();
  timer = setInterval(poll, 2000);
}

export function unmount() { clearInterval(timer); }

async function poll() {
  let s;
  try { s = await api('/api/wa/status'); } catch { return; }
  if (!$('#w-label')) return;
  const [label, cls] = BADGE[s.status] || BADGE.disconnected;
  $('#w-label').textContent = label;
  $('#w-label').className = 'font-bold ' + cls;
  $('#w-number').classList.toggle('hidden', !s.number);
  $('#w-number').textContent = s.number ? 'Nomor terhubung: +' + s.number : '';
  $('#w-error').classList.toggle('hidden', !s.error);
  $('#w-error').textContent = s.error ? 'Error: ' + s.error : '';
  const showQr = s.status === 'qr' && s.qr;
  $('#w-qr').classList.toggle('hidden', !showQr);
  $('#w-qr').classList.toggle('flex', !!showQr);
  if (showQr && s.qr !== lastQr) { $('#w-img').src = s.qr; lastQr = s.qr; }
  $('#w-logout').classList.toggle('hidden', s.status !== 'connected');
}