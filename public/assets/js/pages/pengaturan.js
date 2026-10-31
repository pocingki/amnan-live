// Pengaturan: bot, serah-terima, ketahanan, retensi, notifikasi + koneksi WhatsApp (QR).
import {
  $, api, send, esc, icon, field, INP, BTN_DARK, BTN_LIGHT, toast, poll, onEvent, confirmDialog, getMe, isAdminRole,
  loadSettings, getSettings, saveSettings, onSettingsChange, openSettingsHistory,
} from '../lib.js';

let stopPoll = null, off = null, offEv = null, lastQr = null, canEdit = true, root;

const BADGE = {
  connected: ['TERHUBUNG', 'text-green-800', 'ok'],
  qr: ['MENUNGGU SCAN QR', 'text-amber-800', 'qr'],
  connecting: ['MENGHUBUNGKAN', 'text-amber-800', 'refresh'],
  disconnected: ['TERPUTUS', 'text-red-800', 'x-circle'],
};
const VARS = 'Variabel: {nama} {bot} {admin}';

const RANGES = [
  ['botDurationMinutes', 'Batas durasi bot aktif', 0, 10080], ['adminAutoReturnMinutes', 'Bot aktif kembali otomatis', 0, 10080], ['staleMinutes', 'Batas pesan basi', 1, 1440],
  ['fallbackCooldownMinutes', 'Jeda respons default', 0, 1440], ['sendRateLimitPerMinute', 'Batas kirim per menit', 1, 600],
  ['retentionDays', 'Retensi data', 0, 3650],
];
const NOTIFY_RANGE = ['attentionMinutes', 'Menit sebelum pengingat perlu perhatian', 0, 1440];

/** Validasi + susun patch dari nilai form (murni, diuji). values: objek nama->string (checkbox: 'on' / tidak ada). */
export function buildSettingsPatch(v, cur = {}) {
  const errors = [], p = {};
  const txt = (k, max) => { p[k] = String(v[k] ?? '').trim().slice(0, max); };
  txt('brandName', 60); txt('brandTagline', 100); txt('botName', 60); txt('adminName', 60);
  for (const k of ['openingMessage', 'handoverMessage']) txt(k, 2000);
  p.botEnabled = v.botEnabled === 'on';
  p.autoTakeoverOnPhoneReply = v.autoTakeoverOnPhoneReply === 'on';
  const num = (k, label, min, max, target = p) => {
    const raw = String(v[k] ?? '').trim();
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < min || n > max) errors.push({ field: k, msg: `${label} harus bilangan bulat ${min}-${max}.` });
    else target[k] = n;
  };
  for (const [k, l, a, b] of RANGES) num(k, l, a, b);
  const n = { ...(cur.notify || {}) };
  for (const k of ['webhookUrl', 'telegramBotToken', 'telegramChatId']) n[k] = String(v[k] ?? '').trim();
  if (n.webhookUrl && !/^https?:\/\/\S+$/i.test(n.webhookUrl)) errors.push({ field: 'webhookUrl', msg: 'Webhook URL harus diawali http:// atau https://.' });
  if ((n.telegramBotToken && !n.telegramChatId) || (!n.telegramBotToken && n.telegramChatId)) errors.push({ field: 'telegramChatId', msg: 'Telegram butuh token bot DAN chat ID, atau kosongkan keduanya.' });
  n.onHot = v.onHot === 'on';
  n.onDisconnected = v.onDisconnected === 'on';
  num(NOTIFY_RANGE[0], NOTIFY_RANGE[1], NOTIFY_RANGE[2], NOTIFY_RANGE[3], n);
  p.notify = n;
  return { patch: p, errors };
}

const chk = (name, on, label, hint = '', dis = '') => `<label class="flex items-start gap-2 text-sm font-medium"><input type="checkbox" name="${name}" class="mt-1" ${on ? 'checked' : ''} ${dis}><span>${label}${hint ? `<span class="block text-xs text-gray-600 font-normal">${hint}</span>` : ''}</span></label>`;

export async function mount(el) {
  root = el;
  lastQr = null;
  const [, me] = await Promise.all([loadSettings(), getMe().catch(() => null)]);
  canEdit = isAdminRole(me);
  off = onSettingsChange((s, src) => { if (src !== 'save') render(); });
  render();
  offEv = onEvent('wa:status', () => pollWA());
  stopPoll = poll(pollWA, 3000);
}

export function unmount() { stopPoll?.(); off?.(); offEv?.(); stopPoll = off = offEv = null; }

function render() {
  const S = getSettings(), N = S.notify || {};
  const dis = canEdit ? '' : 'disabled';
  const num = (name, label, hint, min, max) => field(label, `<input name="${name}" type="number" min="${min}" max="${max}" step="1" class="${INP}" value="${esc(S[name] ?? N[name] ?? '')}" ${dis}>`, hint);
  root.innerHTML = `<h1 class="sr-only">Pengaturan</h1>
  ${canEdit ? '' : `<div class="attn-banner mb-6" role="note">${icon('info')}<span>Anda masuk sebagai Agen: pengaturan hanya bisa dilihat. Perubahan dan pemutusan WhatsApp khusus Admin.</span></div>`}
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
    <form id="s-form" class="card space-y-6" novalidate>
      <div class="flex items-start justify-between gap-3"><div><h2 class="font-bold text-lg text-gray-900">Pengaturan Bot</h2><p class="text-sm text-gray-600">Berlaku untuk WhatsApp asli dan Bot Tester${S.version != null ? ` &middot; versi ${esc(S.version)}` : ''}</p></div>
        <button type="button" id="s-history" class="${BTN_LIGHT} shrink-0">Riwayat versi</button></div>

      <fieldset class="space-y-4"><legend class="font-semibold text-brand-800 mb-2">Bot &amp; brand</legend>
        ${chk('botEnabled', S.botEnabled, 'Bot aktif (membalas chat otomatis)', '', dis)}
        ${field('Nama brand', `<input name="brandName" class="${INP}" value="${esc(S.brandName)}" ${dis}>`, 'Tampil di header dan footer')}
        ${field('Tagline brand', `<input name="brandTagline" class="${INP}" value="${esc(S.brandTagline)}" ${dis}>`, 'Tampil di bawah nama brand pada header')}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${field('Nama bot', `<input name="botName" class="${INP}" value="${esc(S.botName)}" ${dis}>`)}
          ${field('Nama admin', `<input name="adminName" class="${INP}" value="${esc(S.adminName)}" ${dis}>`)}
        </div>
        ${field('Pesan pembuka', `<textarea name="openingMessage" rows="4" class="${INP}" ${dis}>${esc(S.openingMessage)}</textarea>`, 'Dikirim untuk setiap chat pertama dari nomor baru. ' + VARS)}
        ${num('botDurationMinutes', 'Batas durasi bot aktif (menit)', '0 = tanpa batas. Dihitung sejak chat pertama atau sejak dikembalikan ke bot. Jika habis, pesan berikutnya kembali ke pesan pembuka.', 0, 10080)}
      </fieldset>

      <fieldset class="space-y-4 border-t border-gray-100 pt-4"><legend class="font-semibold text-brand-800 mb-2">Serah-terima ke admin &amp; ketahanan</legend>
        ${field('Pesan serah-terima', `<textarea name="handoverMessage" rows="2" class="${INP}" ${dis}>${esc(S.handoverMessage)}</textarea>`, 'Dikirim saat percakapan dialihkan dari bot ke admin. ' + VARS)}
        ${chk('autoTakeoverOnPhoneReply', S.autoTakeoverOnPhoneReply, 'Otomatis ambil alih saat admin membalas dari HP', 'Bila admin membalas langsung lewat aplikasi WhatsApp di HP, bot berhenti membalas percakapan itu.', dis)}
        ${num('adminAutoReturnMinutes', 'Bot aktif kembali otomatis setelah admin tidak membalas (menit)', '0 = mati (bot tetap diam sampai Anda mengembalikannya manual). Jika diisi, saat pelanggan chat lagi dan admin sudah tidak aktif (tidak membalas atau mengambil alih) lebih lama dari ini, percakapan kembali ke mode bot dan dibalas pesan pembuka.', 0, 10080)}
        ${num('staleMinutes', 'Batas pesan basi (menit)', 'Pesan yang lebih lama dari ini (mis. terkirim saat bot mati) tidak dibalas bot dan ditandai perlu perhatian.', 1, 1440)}
        ${num('fallbackCooldownMinutes', 'Jeda respons default (menit)', 'Respons default tidak dikirim berulang ke nomor yang sama dalam rentang ini. 0 = tanpa jeda.', 0, 1440)}
        ${num('sendRateLimitPerMinute', 'Batas kirim per menit', 'Melindungi nomor WhatsApp dari pemblokiran karena mengirim terlalu cepat.', 1, 600)}
      </fieldset>

      <fieldset class="space-y-4 border-t border-gray-100 pt-4"><legend class="font-semibold text-brand-800 mb-2">Retensi data</legend>
        ${num('retentionDays', 'Hapus percakapan lama setelah (hari)', '0 = dimatikan (data disimpan selamanya). Bila diisi, percakapan yang lebih lama akan dihapus PERMANEN secara berkala.', 0, 3650)}
      </fieldset>

      <fieldset class="space-y-4 border-t border-gray-100 pt-4"><legend class="font-semibold text-brand-800 mb-2">Notifikasi ke luar dashboard</legend>
        ${field('Webhook URL', `<input name="webhookUrl" type="url" inputmode="url" class="${INP}" value="${esc(N.webhookUrl || '')}" placeholder="https://..." ${dis}>`, 'Dipanggil saat ada kejadian penting. Kosongkan untuk mematikan.')}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${field('Token bot Telegram', `<input name="telegramBotToken" type="password" autocomplete="off" class="${INP}" value="${esc(N.telegramBotToken || '')}" ${dis}>`, 'Rahasia: jangan dibagikan.')}
          ${field('Chat ID Telegram', `<input name="telegramChatId" autocomplete="off" class="${INP}" value="${esc(N.telegramChatId || '')}" ${dis}>`)}
        </div>
        ${chk('onHot', N.onHot, 'Kabari saat ada lead Hot', '', dis)}
        ${chk('onDisconnected', N.onDisconnected, 'Kabari saat WhatsApp terputus', '', dis)}
        ${num('attentionMinutes', 'Pengingat perlu perhatian (menit)', 'Kabari bila percakapan yang butuh admin belum ditangani selama ini. 0 = mati.', 0, 1440)}
      </fieldset>

      <div id="s-err" class="form-error" role="alert" hidden></div>
      ${canEdit ? `<button class="${BTN_DARK}">Simpan pengaturan</button>` : ''}
    </form>

    <div class="card space-y-4">
      <div><h2 class="font-bold text-lg text-gray-900">Koneksi WhatsApp Gateway</h2><p class="text-sm text-gray-600">Kelola status listener dan login QR code nomor WhatsApp</p></div>
      <div class="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-2 text-sm" aria-live="polite">
        <p class="font-medium">Status Koneksi Saat Ini: <span id="w-label" class="font-bold inline-flex items-center gap-1 text-red-800">TERPUTUS</span></p>
        <p id="w-number" class="text-gray-700" hidden></p>
        <p id="w-error" class="text-red-800" hidden></p>
      </div>
      <div id="w-qr" class="flex-col items-center gap-3 border border-dashed border-gray-300 rounded-xl p-6" hidden>
        <img id="w-img" alt="QR code login WhatsApp" class="w-64 h-64">
        <p class="text-sm text-gray-600 text-center">Scan QR ini dari WhatsApp di HP. QR diperbarui otomatis.</p>
      </div>
      ${canEdit ? '<button type="button" id="w-logout" class="text-sm font-medium px-4 py-2 rounded-lg border border-red-300 text-red-800 hover:bg-red-50" hidden>Putuskan &amp; ganti nomor</button>' : ''}
      <ol class="list-decimal list-inside space-y-1 text-sm text-gray-700">
        <li>Buka WhatsApp di HP, masuk ke Perangkat Tertaut.</li><li>Pilih Tautkan Perangkat, lalu scan QR di atas.</li><li>Setelah TERHUBUNG, chat masuk ke nomor tersebut diproses bot.</li>
      </ol>
    </div>
  </div>`;
  lastQr = null;

  $('#s-history').onclick = openSettingsHistory;
  $('#s-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    const v = Object.fromEntries(new FormData(e.target));
    const cur = getSettings();
    const { patch, errors } = buildSettingsPatch(v, cur);
    const box = $('#s-err');
    box.hidden = !errors.length;
    box.innerHTML = errors.map((x) => esc(x.msg)).join('<br>');
    if (errors.length) { e.target.elements[errors[0].field]?.focus(); return; }
    if (patch.retentionDays > 0 && patch.retentionDays !== (cur.retentionDays || 0)
      && !(await confirmDialog('Aktifkan penghapusan otomatis?', `Percakapan yang lebih lama dari ${patch.retentionDays} hari akan dihapus permanen secara berkala dan tidak bisa dikembalikan. Lanjutkan?`, { okText: 'Aktifkan', danger: true }))) return;
    const btn = e.target.querySelector('button:not([type=button])');
    btn.disabled = true;
    try { await saveSettings(patch, { message: 'Pengaturan tersimpan' }); render(); } catch (err) {
      if (err.conflict) render(); else { box.hidden = false; box.textContent = err.message; }
    } finally { if (btn.isConnected) btn.disabled = false; }
  };
  $('#w-logout')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Putuskan WhatsApp?', 'Putuskan nomor WhatsApp ini dan tampilkan QR baru? Bot tidak akan membalas sampai nomor terhubung lagi.', { okText: 'Putuskan', danger: true }))) return;
    try { await send('/api/wa/logout'); pollWA(); } catch (err) { toast(err.message, true); }
  });
  pollWA();
}

async function pollWA() {
  let s;
  try { s = await api('/api/wa/status'); } catch { return; }
  if (!$('#w-label')) return;
  const [label, cls, ic] = BADGE[s.status] || BADGE.disconnected;
  $('#w-label').innerHTML = `${icon(ic)} ${label}`;
  $('#w-label').className = 'font-bold inline-flex items-center gap-1 ' + cls;
  $('#w-number').hidden = !s.number;
  $('#w-number').textContent = s.number ? 'Nomor terhubung: +' + s.number : '';
  $('#w-error').hidden = !s.error;
  $('#w-error').textContent = s.error ? 'Error: ' + s.error : '';
  const showQr = s.status === 'qr' && s.qr;
  $('#w-qr').hidden = !showQr;
  $('#w-qr').classList.toggle('flex', !!showQr);
  if (showQr && s.qr !== lastQr) { $('#w-img').src = s.qr; lastQr = s.qr; }
  const lo = $('#w-logout');
  if (lo) lo.hidden = s.status !== 'connected';
}
