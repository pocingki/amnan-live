// Router halaman + status WhatsApp + menu akun di header.
import { $, api } from './lib.js';

const ROUTES = {
  '/pesan': './pages/pesan.js',
  '/percakapan': './pages/percakapan.js',
  '/crm': './pages/crm.js',
  '/bot-tester': './pages/tester.js',
  '/pengaturan': './pages/pengaturan.js',
};
let current = null;
let navId = 0;

async function go() {
  const path = ROUTES[location.hash.slice(1)] ? location.hash.slice(1) : '/crm';
  const id = ++navId;
  document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.r === path));
  current?.unmount?.();
  current = null;
  const view = $('#view');
  view.innerHTML = '';
  try {
    const mod = await import(ROUTES[path]);
    if (id !== navId) return;
    current = mod;
    await mod.mount(view);
  } catch (err) {
    console.error(err);
    if (id === navId) view.innerHTML = `<div class="card text-red-600 text-sm">Gagal memuat halaman: ${err.message}</div>`;
  }
}

// ---------- status WhatsApp ----------
const BADGE = {
  connected: ['bg-green-50 text-green-700 border-green-200', 'bg-green-500', 'WA Terhubung'],
  qr: ['bg-amber-50 text-amber-700 border-amber-200', 'bg-amber-500', 'Menunggu Scan QR'],
  connecting: ['bg-amber-50 text-amber-700 border-amber-200', 'bg-amber-500', 'Menghubungkan...'],
  disconnected: ['bg-red-50 text-red-700 border-red-200', 'bg-red-500', 'Status Koneksi WA Terputus'],
};

async function pollStatus() {
  try {
    const s = await api('/api/wa/status');
    const [box, dot, text] = BADGE[s.status] || BADGE.disconnected;
    $('#wa-badge').className = `hidden md:flex shrink-0 items-center space-x-2 text-sm px-3 py-1.5 rounded-full font-medium border ${box}`;
    $('#wa-dot').className = `w-2 h-2 rounded-full animate-pulse ${dot}`;
    $('#wa-text').textContent = text;
    document.querySelectorAll('.nav-unread').forEach((u) => {
      u.textContent = s.unread;
      u.style.display = s.unread ? 'inline-block' : 'none';
    });
  } catch { /* abaikan */ }
}

async function loadBrand() {
  try {
    const s = await api('/api/settings');
    $('#brand-name').textContent = s.brandName;
    $('#brand-tagline').textContent = s.brandTagline;
    $('#foot-brand').textContent = s.brandName;
    document.title = s.brandName + ' - Lead Tracker Gateway';
  } catch { /* abaikan */ }
}

// ---------- menu akun (lingkaran kanan atas) ----------
const menu = $('#avatar-menu');
$('#avatar-btn').onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.classList.add('hidden'); });
$('#btn-signout').onclick = async () => {
  try { await fetch('/logout', { method: 'POST' }); } finally { location.href = '/login'; }
};
api('/api/me').then((m) => ($('#me-name').textContent = m.user)).catch(() => {});

$('#year').textContent = new Date().getFullYear();
window.addEventListener('hashchange', go);
window.addEventListener('settings-changed', loadBrand);
loadBrand();
pollStatus();
setInterval(pollStatus, 2500);
go();