// Router halaman + status WhatsApp + notifikasi + menu akun di header.
import {
  $, api, esc, icon, getMe, ROLE_LABEL, csrfToken, onEvent, notify, debounce, toast, popMenu,
  loadSettings, getSettings, setBaseTitle, setUnreadTotal, getActiveChat, unlockAudio, soundOn, setSound,
  notificationState, requestNotifications,
} from './lib.js';

const ROUTES = {
  '/pesan': './pages/pesan.js',
  '/percakapan': './pages/percakapan.js',
  '/crm': './pages/crm.js',
  '/bot-tester': './pages/tester.js',
  '/pengaturan': './pages/pengaturan.js',
};
const TITLES = { '/pesan': 'Pesan', '/percakapan': 'Percakapan Masuk', '/crm': 'CRM', '/bot-tester': 'Bot Tester', '/pengaturan': 'Pengaturan' };
let current = null;
let navId = 0;
let brand = 'acesio';
let pageTitle = '';

const updateTitle = () => setBaseTitle(`${pageTitle ? pageTitle + ' - ' : ''}${brand} - Lead Tracker Gateway`);

// ---------- router ----------
async function go() {
  const raw = location.hash.slice(1).split('?')[0];
  if (raw === '' || raw === '/') { location.replace('#/crm'); return; } // memicu hashchange lagi
  const path = ROUTES[raw] ? raw : null;
  const id = ++navId;
  document.querySelectorAll('.nav-link').forEach((a) => {
    const on = a.dataset.r === path;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  current?.unmount?.();
  current = null;
  const view = $('#view');
  view.innerHTML = '';

  if (!path) { // rute tidak dikenal: 404 yang jelas
    pageTitle = 'Halaman tidak ditemukan';
    updateTitle();
    view.innerHTML = `<div class="card max-w-xl mx-auto text-center space-y-3 py-10">
      <h1 class="text-2xl font-bold text-brand-800">Halaman tidak ditemukan</h1>
      <p class="text-sm text-gray-600">Alamat <code class="bg-gray-100 px-1 rounded">${esc(location.hash)}</code> tidak ada atau sudah dipindahkan.</p>
      <p class="flex flex-wrap justify-center gap-2 pt-2">${Object.keys(ROUTES).map((r) => `<a href="#${r}" class="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">${esc(TITLES[r])}</a>`).join('')}</p></div>`;
    announce('Halaman tidak ditemukan');
    return;
  }

  pageTitle = TITLES[path];
  updateTitle();
  view.setAttribute('aria-busy', 'true');
  view.innerHTML = '<p class="text-sm text-gray-600" role="status">Memuat…</p>';
  try {
    const mod = await import(ROUTES[path]);
    if (id !== navId) return;
    current = mod;
    view.innerHTML = '';
    await mod.mount(view);
    if (id !== navId) return;
    view.removeAttribute('aria-busy');
    announce(`Halaman ${pageTitle}`);
    view.focus({ preventScroll: true });
  } catch (err) {
    console.error(err);
    if (id !== navId) return;
    view.removeAttribute('aria-busy');
    view.innerHTML = `<div class="card text-sm space-y-3" role="alert"><p class="text-red-700">Gagal memuat halaman: ${esc(err.message)}</p>
      <button type="button" id="retry-page" class="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">Coba lagi</button></div>`;
    $('#retry-page').onclick = go;
  }
}
const announce = (t) => { $('#route-announcer').textContent = ''; setTimeout(() => ($('#route-announcer').textContent = t), 50); };

// ---------- status WhatsApp (terlihat juga di HP: ikon + teks ringkas) ----------
const BADGE = {
  connected: { cls: 'wa-ok', icon: 'ok', long: 'WA Terhubung', short: 'Terhubung' },
  qr: { cls: 'wa-warn', icon: 'qr', long: 'Menunggu Scan QR', short: 'Scan QR' },
  connecting: { cls: 'wa-warn', icon: 'refresh', long: 'Menghubungkan…', short: 'Menyambung' },
  disconnected: { cls: 'wa-bad', icon: 'x-circle', long: 'WA Terputus', short: 'Putus' },
};
let prevWa = null;

function applyWa(status) {
  const b = BADGE[status] || BADGE.disconnected;
  const el = $('#wa-badge');
  el.className = `wa-badge ${b.cls}`;
  el.setAttribute('aria-label', `Status WhatsApp: ${b.long}`);
  $('#wa-icon').innerHTML = icon(b.icon, 'icon-sm');
  $('#wa-long').textContent = b.long;
  $('#wa-short').textContent = b.short;
}

function applyUnread(n) {
  document.querySelectorAll('.nav-unread').forEach((u) => {
    u.textContent = n > 99 ? '99+' : n;
    u.hidden = !n;
    u.setAttribute('aria-label', `${n} belum dibaca`);
  });
  setUnreadTotal(n);
}

async function refreshStatus() {
  try {
    const s = await api('/api/wa/status');
    prevWa = s.status;
    applyWa(s.status);
    applyUnread(s.unread || 0);
  } catch { /* abaikan; badge tetap di status terakhir */ }
}

function applyBrand() {
  const s = getSettings();
  if (!s) return;
  brand = s.brandName || brand;
  $('#brand-name').textContent = brand;
  $('#brand-tagline').textContent = s.brandTagline || '';
  $('#foot-brand').textContent = brand;
  $('#brand-link').setAttribute('aria-label', `${brand}, ke halaman CRM`);
  updateTitle();
}

// ---------- notifikasi ----------
function bellMenu() {
  const st = notificationState();
  const items = [];
  if (st === 'default') {
    items.push({ label: 'Aktifkan notifikasi browser', fn: async () => {
      const r = await requestNotifications();
      toast(r === 'granted' ? 'Notifikasi browser aktif' : 'Izin notifikasi tidak diberikan', r !== 'granted');
    } });
  } else if (st === 'granted') items.push({ label: 'Notifikasi browser: aktif', disabled: true });
  else if (st === 'denied') items.push({ label: 'Notifikasi diblokir (ubah di pengaturan situs browser)', disabled: true });
  else items.push({ label: 'Browser tidak mendukung notifikasi', disabled: true });
  items.push({ label: soundOn() ? 'Matikan bunyi notifikasi' : 'Aktifkan bunyi notifikasi', fn: () => { setSound(!soundOn()); toast(soundOn() ? 'Bunyi notifikasi aktif' : 'Bunyi notifikasi mati'); } });
  popMenu($('#bell-btn'), items);
}

function setupNotifications() {
  $('#bell-btn').innerHTML = icon('bell', 'icon-md');
  $('#bell-btn').onclick = bellMenu;
  // bunyi hanya boleh setelah ada gestur pengguna
  const unlock = () => { unlockAudio(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);
  try {
    if (notificationState() === 'default' && !sessionStorage.getItem('acesio:hint')) {
      sessionStorage.setItem('acesio:hint', '1');
      toast('Klik ikon lonceng di kanan atas untuk mengaktifkan notifikasi pesan baru.', false, { duration: 7000 });
    }
  } catch { /* abaikan */ }

  // Isi notifikasi sengaja generik: tidak memuat nama/nomor (layar kunci HP).
  onEvent('unread', (p) => applyUnread(p.total || 0));
  onEvent('wa:status', (p) => {
    applyWa(p.status);
    if (prevWa === 'connected' && p.status === 'disconnected') {
      notify('WhatsApp terputus', 'Bot tidak bisa membalas sampai terhubung kembali.', { level: 'alert', tag: 'wa-down', hash: '#/pengaturan' });
    }
    prevWa = p.status;
  });
  onEvent('message:new', (p) => {
    if (p.by && p.by !== 'customer') return;
    if (p.phone && getActiveChat() === p.phone && !document.hidden) return; // sedang dibaca
    notify('Pesan baru', 'Ada pesan baru dari pelanggan.', { tag: 'msg', hash: '#/percakapan' });
  });
  onEvent('lead:hot', () => notify('Lead Hot', 'Ada lead Hot yang perlu segera ditindaklanjuti.', { level: 'alert', tag: 'hot', hash: '#/crm' }));
  onEvent('conversation:attention', () => notify('Perlu perhatian', 'Ada percakapan yang butuh ditangani admin.', { level: 'alert', tag: 'attn', hash: '#/percakapan' }));
  onEvent('resync', debounce(refreshStatus, 500));
}

// ---------- menu akun (lingkaran kanan atas) ----------
function setupAccount() {
  const btn = $('#avatar-btn'), menu = $('#avatar-menu');
  const open = (on) => {
    menu.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    if (on) menu.querySelector('a,button')?.focus();
  };
  btn.onclick = (e) => { e.stopPropagation(); open(menu.hidden); };
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) open(false); });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { open(false); btn.focus(); }
    else if (e.key === 'Tab') {
      const f = [...menu.querySelectorAll('a,button')];
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  $('#btn-signout').onclick = async () => {
    try { await fetch('/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken() } }); } catch { /* tetap ke halaman login */ }
    location.href = '/login';
  };
  getMe().then((m) => {
    $('#me-name').textContent = m.user;
    $('#me-role').textContent = ROLE_LABEL[m.role] || m.role || 'Admin';
    btn.setAttribute('aria-label', `Akun: ${m.user}`);
  }).catch(() => { $('#me-name').textContent = '-'; $('#me-role').textContent = '-'; });
}

// ---------- logo: pakai logo resmi bila ada (tanpa onload inline, sesuai CSP) ----------
function setupLogo() {
  const probe = new Image();
  probe.onload = () => {
    const logo = $('#brand-logo');
    logo.src = probe.src;
    logo.hidden = false;
    $('#brand-mark').hidden = true;
  };
  probe.src = 'assets/img/logo.png';
}

// ---------- mulai ----------
$('#year').textContent = new Date().getFullYear();
setupLogo();
setupAccount();
setupNotifications();
window.addEventListener('hashchange', go);
window.addEventListener('settings-changed', applyBrand);
loadSettings().then(applyBrand).catch(() => {});
refreshStatus();
go();
