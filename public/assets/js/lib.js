// Helper bersama untuk semua halaman. Semua ekspor lama dipertahankan (crm.js memakainya).
// Modul ini TIDAK menyentuh DOM/window saat di-import, jadi fungsi murninya bisa diuji di Node.

/* ====================================================================
   Dasar
   ==================================================================== */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const INP = 'w-full border border-gray-300 rounded-lg text-sm px-3 py-2 bg-white';
export const BTN = 'px-4 py-2 text-sm font-medium rounded-lg';
export const BTN_DARK = BTN + ' bg-brand-800 text-white hover:bg-brand-900';
export const BTN_LIGHT = BTN + ' border border-gray-300 bg-white hover:bg-gray-50';
export const BTN_DANGER = BTN + ' bg-red-700 text-white hover:bg-red-800';

export const fmtDate = (ts) => new Date(ts).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');

export function debounce(fn, ms = 300) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
}

/** Jalankan fn tiap ms hanya saat tab terlihat; langsung jalan saat tab kembali terlihat. Mengembalikan fungsi stop. */
export function poll(fn, ms, { immediate = true } = {}) {
  let stopped = false;
  const run = async () => {
    if (stopped || document.hidden) return;
    try { await fn(); } catch { /* abaikan */ }
  };
  const onVis = () => { if (!document.hidden) run(); };
  document.addEventListener('visibilitychange', onVis);
  const t = setInterval(run, ms);
  if (immediate) run();
  return () => { stopped = true; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
}

/* ====================================================================
   Ikon SVG inline (CSP: tanpa CDN / font ikon)
   ==================================================================== */
const P = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  check2: '<path d="M2 12.5l4.5 4.5L15 8.5"/><path d="M10.5 15.5l1.5 1.5L22 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="M22 7l-6 5 6 5z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  dots: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  'user-plus': '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7M19 8v6M16 11h6"/>',
  'arrow-left': '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  link: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  'x-circle': '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h3M20 17v4"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
};
/** cls: icon-xs | icon-sm | icon-md | icon-lg (ukuran di style.css) */
export function icon(name, cls = 'icon-sm') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
}

/* ====================================================================
   HTTP: CSRF (K2), error ramah, api()/send()
   ==================================================================== */
export function readCookie(name, cookieStr = typeof document !== 'undefined' ? document.cookie : '') {
  for (const part of String(cookieStr).split(';')) {
    const i = part.indexOf('=');
    if (i < 0 || part.slice(0, i).trim() !== name) continue;
    const v = part.slice(i + 1).trim();
    try { return decodeURIComponent(v); } catch { return v; }
  }
  return '';
}
let csrfFallback = '';
export const setCsrfToken = (t) => { csrfFallback = t || ''; };
export const csrfToken = () => readCookie('csrf') || csrfFallback;

export class ApiError extends Error {
  constructor(message, { status = 0, data = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/** Pesan error ramah (Bahasa Indonesia) dari status HTTP + isi JSON. */
export function friendlyMessage(status, data) {
  const raw = data && typeof data.error === 'string' ? data.error.trim() : '';
  if (status === 403 && raw === 'CSRF') return 'Sesi keamanan sudah kedaluwarsa. Muat ulang halaman lalu coba lagi.';
  if (status === 403) return raw && !/^forbidden$/i.test(raw) ? raw : 'Anda tidak punya izin untuk tindakan ini.';
  if (status === 413) return 'Data yang dikirim terlalu besar (error 413). Kecilkan ukuran file atau pecah menjadi beberapa bagian.';
  if (status === 429) return raw || 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.';
  if (raw) return raw;
  if (status === 404) return 'Data tidak ditemukan.';
  if (status === 409) return 'Terjadi konflik data. Muat ulang lalu coba lagi.';
  if (status >= 500) return `Server sedang bermasalah (kode ${status}). Coba lagi sebentar lagi.`;
  return `Permintaan gagal (kode ${status}).`;
}

const SAFE_METHOD = /^(GET|HEAD|OPTIONS)$/i;

export async function api(path, opt = {}) {
  const method = String(opt.method || 'GET').toUpperCase();
  const headers = { ...(opt.headers || {}) };
  if (!SAFE_METHOD.test(method) && !Object.keys(headers).some((k) => k.toLowerCase() === 'x-csrf-token')) {
    const t = csrfToken();
    if (t) headers['X-CSRF-Token'] = t;
  }
  let res;
  try {
    res = await fetch(path, { ...opt, method, headers });
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server. Periksa koneksi internet Anda, lalu coba lagi.', { status: 0 });
  }
  if (res.status === 401) {
    location.href = '/login';
    throw new ApiError('Sesi berakhir. Silakan masuk kembali.', { status: 401 });
  }
  let data = null;
  try { const text = await res.text(); data = text ? JSON.parse(text) : null; } catch { /* bukan JSON */ }
  if (!res.ok) throw new ApiError(friendlyMessage(res.status, data), { status: res.status, data });
  return data;
}

/** send(path, body, method='POST', headers?) -> JSON. headers opsional (mis. If-Match). */
export const send = (path, body, method = 'POST', headers = {}) =>
  api(path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });

let meP = null;
/** Profil pengguna dari /api/me ({user, role, csrfToken}); di-cache. */
export function getMe() {
  if (!meP) {
    meP = api('/api/me').then((m) => { if (m?.csrfToken) setCsrfToken(m.csrfToken); return m; }).catch((e) => { meP = null; throw e; });
  }
  return meP;
}
export const ROLE_LABEL = { admin: 'Admin', agent: 'Agen' };
/** Tanpa field role (server lama) dianggap admin; server tetap yang menegakkan izin. */
export const isAdminRole = (me) => !me || !me.role || me.role === 'admin';

/* ====================================================================
   Toast (aria-live)
   ==================================================================== */
export function toast(msg, isErr = false, opt = {}) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'toast-host';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' toast-err' : '');
  t.setAttribute('role', isErr ? 'alert' : 'status');
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  const remove = () => t.remove();
  if (opt.action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = opt.action.label;
    b.onclick = () => { remove(); opt.action.fn(); };
    t.appendChild(b);
  }
  host.appendChild(t);
  setTimeout(remove, opt.duration ?? (isErr ? 7000 : opt.action ? 9000 : 3200));
  return t;
}

export const field = (label, input, hint = '') =>
  `<label class="block text-sm font-medium text-gray-700">${label}<div class="mt-1 font-normal">${input}</div>${hint ? `<p class="text-xs text-gray-600 mt-1 font-normal">${hint}</p>` : ''}</label>`;

/* ====================================================================
   Dialog aksesibel: role=dialog, aria-modal, fokus terkunci, Esc
   ==================================================================== */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden]') && el.getClientRects().length);
let dlgSeq = 0;
let scrollLocks = 0;

/** Dasar semua dialog. Mengembalikan {el, body, close, onClose}. */
export function openDialog({ title, size = '' } = {}) {
  const opener = document.activeElement;
  const id = 'dlg' + ++dlgSeq;
  const wrap = document.createElement('div');
  wrap.className = 'dialog-backdrop';
  wrap.innerHTML = `<div class="dialog-box ${size}" role="dialog" aria-modal="true" aria-labelledby="${id}-t" tabindex="-1"><h3 id="${id}-t" class="dialog-title">${esc(title)}</h3><div class="dialog-body"></div></div>`;
  const box = wrap.firstElementChild;
  const d = { el: box, body: box.querySelector('.dialog-body'), onClose: null, close: null };
  let closed = false;
  d.close = () => {
    if (closed) return;
    closed = true;
    wrap.remove();
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (!scrollLocks) document.body.classList.remove('modal-open');
    if (opener && opener.isConnected) { try { opener.focus({ preventScroll: true }); } catch { /* abaikan */ } }
    d.onClose?.();
  };
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); if (!box.dataset.busy) d.close(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(box);
    if (!f.length) { e.preventDefault(); box.focus(); return; }
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (!box.contains(a) || (e.shiftKey && (a === first || a === box))) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  });
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap && !box.dataset.busy) d.close(); });
  document.body.appendChild(wrap);
  scrollLocks++;
  document.body.classList.add('modal-open');
  box.focus({ preventScroll: true });
  return d;
}

/**
 * Modal form (tanda tangan lama dipertahankan). onSave(form) dipanggil saat submit;
 * modal menutup jika tidak melempar error. opt.wide = lebar. Mengembalikan dialog (+ .form).
 */
export function modal(title, html, onSave, saveText = 'Simpan', opt = {}) {
  const d = openDialog({ title, size: opt.wide ? 'wide' : '' });
  d.body.innerHTML = `<form class="space-y-4"><div class="space-y-3">${html}</div>
    <div class="form-error" role="alert" hidden></div>
    <div class="dialog-actions"><button type="button" data-x class="${BTN_LIGHT}">Batal</button><button type="submit" data-save class="${BTN_DARK}">${esc(saveText)}</button></div></form>`;
  const form = d.body.querySelector('form');
  d.form = form;
  const errBox = form.querySelector('.form-error');
  form.querySelector('[data-x]').onclick = d.close;
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (d.el.dataset.busy) return;
    const buttons = [...form.querySelectorAll('button')];
    d.el.dataset.busy = '1';
    buttons.forEach((b) => (b.disabled = true));
    errBox.hidden = true;
    try {
      await onSave(form);
      delete d.el.dataset.busy;
      d.close();
    } catch (err) {
      delete d.el.dataset.busy;
      if (err?.conflict) { d.close(); return; } // data basi: pengguna sudah memilih di dialog konflik
      buttons.forEach((b) => (b.disabled = false));
      errBox.textContent = err?.message || 'Gagal menyimpan. Coba lagi.';
      errBox.hidden = false;
    }
  };
  (form.querySelector('input:not([type=radio]):not([type=checkbox]):not([type=file]),textarea,select') || focusables(d.el)[0])?.focus();
  return d;
}

/** Dialog pilihan. buttons=[{label,value,primary?,danger?}]. Resolve value tombol, atau null bila ditutup (Esc). */
export function choiceDialog(title, message, buttons) {
  return new Promise((resolve) => {
    const d = openDialog({ title });
    d.body.innerHTML = `<p class="text-sm text-gray-700 whitespace-pre-line">${esc(message)}</p>
      <div class="dialog-actions">${buttons.map((b, i) => `<button type="button" data-v="${i}" class="${b.primary ? (b.danger ? BTN_DANGER : BTN_DARK) : BTN_LIGHT}">${esc(b.label)}</button>`).join('')}</div>`;
    let done = false;
    d.body.onclick = (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      done = true;
      resolve(buttons[b.dataset.v].value);
      d.close();
    };
    d.onClose = () => { if (!done) resolve(null); };
    // tindakan merusak: fokus awal ke tombol pertama (Batal); selain itu ke tombol utama
    const risky = buttons.some((b) => b.danger);
    const target = risky ? d.body.querySelector('[data-v]') : d.body.querySelector('[data-v]:last-child') || d.body.querySelector('[data-v]');
    target?.focus();
  });
}

export async function confirmDialog(title, message, { okText = 'Ya', cancelText = 'Batal', danger = false } = {}) {
  return (await choiceDialog(title, message, [{ label: cancelText, value: false }, { label: okText, value: true, primary: true, danger }])) === true;
}

export function openLightbox(src, alt = '') {
  const d = openDialog({ title: 'Pratinjau gambar', size: 'wide' });
  d.body.innerHTML = `<img class="lightbox-img" src="${esc(src)}" alt="${esc(alt || 'Gambar kiriman')}">
    <div class="dialog-actions"><a class="${BTN_LIGHT}" href="${esc(src)}" download>${icon('download')} Unduh</a><button type="button" data-x class="${BTN_DARK}">Tutup</button></div>`;
  d.body.querySelector('[data-x]').onclick = d.close;
  d.body.querySelector('[data-x]').focus();
  return d;
}

/* ====================================================================
   Menu titik tiga (bisa dengan keyboard)
   ==================================================================== */
let openMenu = null;
const closeMenu = () => openMenu?.close();

/** items = [{label, fn, danger, disabled}] */
export function popMenu(anchor, items) {
  if (openMenu && openMenu.anchor === anchor) { closeMenu(); return; } // klik kedua = tutup
  closeMenu();
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'true');
  if (!anchor.getAttribute('aria-label')) anchor.setAttribute('aria-label', anchor.getAttribute('title') || 'Opsi');
  const el = document.createElement('div');
  el.className = 'pop-menu';
  el.setAttribute('role', 'menu');
  el.innerHTML = items.map((it, i) => `<button type="button" role="menuitem" tabindex="-1" data-i="${i}" ${it.disabled ? 'aria-disabled="true" disabled' : ''} class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('');
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth || 190, h = el.offsetHeight || 40;
  el.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  el.style.top = (r.bottom + 4 + h > innerHeight && r.top - h - 4 > 0 ? r.top - h - 4 : r.bottom + 4) + 'px';

  const btns = () => [...el.querySelectorAll('button:not([disabled])')];
  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => {
    const b = btns();
    const i = b.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); b[(i + 1) % b.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); b[(i - 1 + b.length) % b.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); b[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); b[b.length - 1]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close();
  };
  const close = (refocus = false) => {
    if (openMenu?.el !== el) return;
    openMenu = null;
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('resize', close);
    el.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (refocus === true) anchor.focus();
  };
  el.addEventListener('keydown', onKey);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b || b.disabled) return;
    close(true);
    items[b.dataset.i].fn?.();
  });
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', close);
  openMenu = { el, anchor, close };
  btns()[0]?.focus();
}

/* ====================================================================
   Gelembung chat (status nyata, media, chip sistem)
   ==================================================================== */
export function dayLabel(ts) {
  const d = new Date(ts), n = new Date(), y = new Date(n);
  y.setDate(n.getDate() - 1);
  if (d.toDateString() === n.toDateString()) return 'Hari ini';
  if (d.toDateString() === y.toDateString()) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { dateStyle: 'medium' });
}

export const TYPE_LABEL = { text: 'Pesan', image: 'Gambar', audio: 'Pesan suara', video: 'Video', sticker: 'Stiker', document: 'Dokumen', location: 'Lokasi', contact: 'Kontak' };
export const TYPE_ICON = { image: 'image', audio: 'mic', video: 'video', sticker: 'smile', document: 'file', location: 'pin', contact: 'user' };
export const STATUS = {
  sending: { label: 'Mengirim', icon: 'clock' },
  sent: { label: 'Terkirim', icon: 'check' },
  delivered: { label: 'Diterima', icon: 'check2' },
  read: { label: 'Dibaca', icon: 'check2' },
  failed: { label: 'Gagal terkirim', icon: 'alert' },
};
export const mediaUrl = (id) => '/api/media/' + encodeURIComponent(id);

/**
 * Status yang ditampilkan untuk sebuah pesan. Pesan masuk (bukan own) hanya menampilkan 'failed'.
 * Pesan bot/admin lama tanpa field status dianggap 'sent'; pesan pelanggan tanpa status: tidak ada.
 */
export function statusKey(m, o = {}) {
  const s = m.status && STATUS[m.status] ? m.status : null;
  if (s === 'failed') return 'failed';
  if (!o.own) return null;
  if (s) return s;
  return m.by && m.by !== 'customer' ? 'sent' : null;
}

function statusHTML(m, o) {
  const k = statusKey(m, o);
  if (!k) return '';
  const s = STATUS[k];
  const visible = k === 'failed' || o.statusText;
  return `<span class="b-status st-${k}" title="${esc(s.label)}">${icon(s.icon, 'icon-xs')}<span class="${visible ? 'b-st-text' : 'sr-only'}">${esc(s.label)}</span></span>`;
}

const missing = (t, label) => `<div class="b-file b-missing">${icon(TYPE_ICON[t] || 'file')}<span>${esc(label)} tidak tersedia</span></div>`;

/** HTML lampiran untuk pesan bertipe media. Mengembalikan '' untuk pesan teks. */
export function mediaHTML(m) {
  const t = m.type;
  if (!t || t === 'text') return '';
  const label = TYPE_LABEL[t] || 'Lampiran';
  const alt = m.caption ? String(m.caption) : `${label} dari ${m.by === 'customer' ? 'pelanggan' : 'tim'}`;
  if (t === 'location' || t === 'contact') return `<div class="b-file">${icon(TYPE_ICON[t])}<span>${label} dibagikan</span></div>`;
  if (!m.mediaId) return missing(t, label);
  const url = mediaUrl(m.mediaId);
  switch (t) {
    case 'image':
      return `<button type="button" class="b-img-btn" data-zoom="${esc(url)}" data-alt="${esc(alt)}" aria-label="Perbesar gambar: ${esc(alt)}"><img class="b-img" src="${esc(url)}" alt="${esc(alt)}" loading="lazy"></button>`;
    case 'sticker':
      return `<img class="b-sticker" src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`;
    case 'audio':
      return `<audio class="b-audio" controls preload="none" src="${esc(url)}" aria-label="${esc(alt)}"></audio>`;
    case 'video':
      return `<video class="b-video" controls preload="none" src="${esc(url)}" aria-label="${esc(alt)}"></video>`;
    case 'document':
      return `<a class="b-file" href="${esc(url)}" download>${icon('file')}<span>${esc(m.fileName || m.caption || 'Dokumen')}</span>${icon('download')}<span class="sr-only">Unduh</span></a>`;
    default:
      return missing(t, label);
  }
}

/** Teks yang dipakai sebagai keterangan pesan (caption untuk media, atau teks biasa). */
export function messageText(m) {
  const t = m.type;
  if (!t || t === 'text') return m.text ?? '';
  if (m.caption) return m.caption;
  const txt = m.text ?? '';
  return !txt || txt === `[${TYPE_LABEL[t]}]` ? '' : txt;
}

/** Teks pratinjau untuk daftar percakapan. */
export function previewText(last, who = '') {
  if (!last) return '';
  const t = last.type;
  const txt = t && t !== 'text' ? (messageText(last) || TYPE_LABEL[t] || 'Lampiran') : (last.text || '');
  return (who ? who + ': ' : '') + txt;
}

/** o: {own, label, select, checked, canRetry, statusText} */
export function bubble(m, o = {}) {
  const txt = messageText(m);
  const failed = statusKey(m, o) === 'failed';
  const canRetry = failed && o.canRetry && (!m.type || m.type === 'text') && m.text;
  const who = m.by === 'customer' ? 'pelanggan' : m.by === 'bot' ? 'bot' : 'admin';
  return `<div class="msg-row ${o.own ? 'own' : ''}" data-id="${esc(m.id)}">
    ${o.select ? `<input type="checkbox" class="msg-check" aria-label="Pilih pesan dari ${who} pukul ${fmtTime(m.ts)}" ${o.checked ? 'checked' : ''}>` : ''}
    <div class="bubble ${o.own ? 'out' : 'in'}${failed ? ' failed' : ''}">${o.label ? `<div class="b-label">${esc(o.label)}</div>` : ''}${mediaHTML(m)}${txt ? `<span class="b-text">${esc(txt)}</span>` : ''}<span class="b-meta">${fmtTime(m.ts)}${statusHTML(m, o)}</span>${canRetry ? `<div class="b-retry-row"><button type="button" class="b-retry" data-a="retry" data-id="${esc(m.id)}">${icon('refresh', 'icon-xs')} Kirim ulang</button></div>` : ''}</div></div>`;
}

/** opt(m) -> {own, label, select, checked, canRetry}. Pesan by:'system' tampil sebagai chip di tengah. */
export function chatHTML(msgs, opt) {
  let lastOwn = -1;
  msgs.forEach((m, i) => { if (m.by !== 'system' && statusKey(m, opt(m)) && opt(m).own) lastOwn = i; });
  let last = '', out = '';
  msgs.forEach((m, i) => {
    const l = dayLabel(m.ts);
    if (l !== last) { out += `<div class="date-chip"><span>${esc(l)}</span></div>`; last = l; }
    if (m.by === 'system') { out += `<div class="sys-row"><span class="sys-chip">${icon('info', 'icon-xs')}<span>${esc(m.text)}</span></span></div>`; return; }
    const o = opt(m);
    out += bubble(m, i === lastOwn && o.statusText === undefined ? { ...o, statusText: true } : o);
  });
  return out;
}

/** Pasang penanganan media di wadah chat yang persisten: klik gambar = perbesar, media gagal dimuat = pengganti. */
export function bindChatMedia(root) {
  if (!root || root.dataset.mediaBound) return;
  root.dataset.mediaBound = '1';
  root.addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]');
    if (z) openLightbox(z.dataset.zoom, z.dataset.alt || '');
  });
  root.addEventListener('error', (e) => {
    const t = e.target;
    if (!t?.matches) return;
    const swap = (label, type) => {
      const holder = t.closest('.b-img-btn') || t;
      const tmp = document.createElement('div');
      tmp.innerHTML = missing(type, label).replace(' tidak tersedia', ' tidak dapat dimuat');
      holder.replaceWith(tmp.firstElementChild);
    };
    if (t.matches('img.b-img')) swap('Gambar', 'image');
    else if (t.matches('img.b-sticker')) swap('Stiker', 'sticker');
    else if (t.matches('audio.b-audio')) swap('Pesan suara', 'audio');
    else if (t.matches('video.b-video')) swap('Video', 'video');
  }, true);
}

/* ====================================================================
   Judul tab "(N) ...", bunyi, Notification API
   ==================================================================== */
const T = { base: '', unread: 0, alerts: 0 };
export const formatTitle = (base, n) => (n > 0 ? `(${n > 99 ? '99+' : n}) ${base}` : base);
function renderTitle() {
  if (typeof document === 'undefined') return;
  document.title = formatTitle(T.base || document.title, T.unread + T.alerts);
}
export function setBaseTitle(t) { T.base = t; renderTitle(); }
export function setUnreadTotal(n) { T.unread = Math.max(0, Number(n) || 0); renderTitle(); }
export function clearAlerts() { T.alerts = 0; renderTitle(); }

let visBound = false;
function bindVisibility() {
  if (visBound || typeof document === 'undefined') return;
  visBound = true;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) clearAlerts(); });
}

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* abaikan */ } };
export const soundOn = () => lsGet('acesio:sound') !== '0';
export const setSound = (on) => lsSet('acesio:sound', on ? '1' : '0');

let actx = null;
/** Panggil dari gestur pengguna (klik/ketik) agar browser mengizinkan bunyi. */
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx ||= new AC();
    if (actx.state === 'suspended') actx.resume();
  } catch { /* abaikan */ }
}
export function beep(kind = 'info') {
  if (!soundOn() || !actx || actx.state !== 'running') return;
  try {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = 'sine';
    o.frequency.value = kind === 'alert' ? 440 : 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + 0.45);
  } catch { /* abaikan */ }
}

export const notificationState = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
export async function requestNotifications() {
  if (typeof Notification === 'undefined') return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

/**
 * Pemberitahuan: bunyi; bila tab tersembunyi juga Notification browser + penambah angka di judul tab;
 * bila tab terlihat tampil toast. opt: {level:'alert'|'info', tag, hash, toast:false}. Jangan masukkan data pribadi di body.
 */
export function notify(title, body = '', opt = {}) {
  bindVisibility();
  const hidden = document.hidden;
  beep(opt.level === 'alert' ? 'alert' : 'info');
  if (hidden) {
    T.alerts++;
    renderTitle();
    if (notificationState() === 'granted') {
      try {
        const n = new Notification(title, { body, tag: opt.tag, icon: '/favicon.svg' });
        n.onclick = () => { window.focus(); if (opt.hash) location.hash = opt.hash; n.close(); };
      } catch { /* sebagian browser HP tidak mendukung konstruktor */ }
    }
  } else if (opt.toast !== false) {
    toast(body ? `${title}: ${body}` : title, opt.level === 'alert');
  }
}

/* ====================================================================
   Event (K6): SSE /api/events + fallback polling
   ==================================================================== */
const EVENT_TYPES = ['wa:status', 'message:new', 'conversation:attention', 'lead:new', 'lead:hot', 'unread'];
const subs = new Map();
let evStarted = false, sseOk = false, es = null, retryMs = 3000;
let activeChat = null;
export const setActiveChat = (p) => { activeChat = p || null; };
export const getActiveChat = () => activeChat;

/** Publikasi lokal (dipakai SSE, fallback polling, dan tes). */
export function emitEvent(type, payload = {}) {
  for (const fn of [...(subs.get(type) || [])]) {
    try { fn(payload ?? {}, type); } catch (e) { console.error(e); }
  }
}

/** Ubah data mentah SSE menjadi {type?, payload}. Mendukung `data: {...payload}` dan `data: {type, payload|...}`. */
export function parseEventData(raw) {
  let d;
  try { d = JSON.parse(raw); } catch { return { payload: {} }; }
  if (d && typeof d === 'object' && typeof d.type === 'string') return { type: d.type, payload: d.payload ?? d };
  return { payload: d && typeof d === 'object' ? d : {} };
}

/**
 * Langganan event. Tipe K6: wa:status, message:new, conversation:attention, lead:new, lead:hot, unread.
 * Tipe tambahan 'resync' = "ambil ulang data": dipancarkan saat SSE (re)connect, tab kembali terlihat,
 * dan oleh polling lambat ketika SSE tidak tersedia. Mengembalikan fungsi berhenti.
 */
export function onEvent(type, fn) {
  if (!subs.has(type)) subs.set(type, new Set());
  subs.get(type).add(fn);
  startEvents();
  return () => subs.get(type)?.delete(fn);
}

function connectSSE() {
  if (typeof EventSource === 'undefined') return;
  try { es = new EventSource('/api/events'); } catch { return; }
  es.onopen = () => { sseOk = true; retryMs = 3000; emitEvent('resync'); };
  for (const t of EVENT_TYPES) es.addEventListener(t, (ev) => emitEvent(t, parseEventData(ev.data).payload));
  es.onmessage = (ev) => { const { type, payload } = parseEventData(ev.data); if (type) emitEvent(type, payload); };
  es.onerror = () => {
    sseOk = false;
    if (es.readyState === 2) { // ditutup permanen (mis. 401/403/5xx): coba lagi dengan jeda bertambah
      es.close();
      setTimeout(connectSSE, retryMs);
      retryMs = Math.min(retryMs * 2, 60000);
    }
  };
}

let fbLast = { status: null, number: null, unread: null };
async function fallbackTick() {
  if (sseOk) return;
  const s = await api('/api/wa/status');
  if (s.status !== fbLast.status || s.number !== fbLast.number) emitEvent('wa:status', { status: s.status, number: s.number });
  if (s.unread !== fbLast.unread) {
    if (fbLast.unread != null && s.unread > fbLast.unread) emitEvent('message:new', { phone: null, by: 'customer', type: 'text', synthetic: true });
    emitEvent('unread', { total: s.unread });
  }
  fbLast = { status: s.status, number: s.number, unread: s.unread };
  emitEvent('resync');
}

function startEvents() {
  if (evStarted || typeof document === 'undefined') return;
  evStarted = true;
  bindVisibility();
  connectSSE();
  // Fallback: polling lambat hanya saat SSE putus dan tab terlihat (poll() berhenti saat document.hidden).
  poll(fallbackTick, 15000, { immediate: false });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) emitEvent('resync'); });
}

/* ====================================================================
   Klien pengaturan: If-Match (versi), antrean simpan, konflik 409, riwayat, Undo
   ==================================================================== */
const SK = { cur: null, chain: Promise.resolve(), subs: new Set() };
export class SettingsConflict extends Error {
  constructor(message = 'Pengaturan sudah diubah orang lain.') { super(message); this.name = 'SettingsConflict'; this.conflict = true; }
}
export const getSettings = () => SK.cur;
export const unwrapSettings = (r) => (r && typeof r === 'object' && r.settings && typeof r.settings === 'object' ? r.settings : r);

/** Langganan perubahan cache pengaturan: fn(settings, source) dengan source 'save'|'restore'|'reload'. */
export function onSettingsChange(fn) { SK.subs.add(fn); return () => SK.subs.delete(fn); }
function emitSettings(source) {
  for (const f of [...SK.subs]) { try { f(SK.cur, source); } catch (e) { console.error(e); } }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('settings-changed'));
}

export async function loadSettings() {
  SK.cur = unwrapSettings(await api('/api/settings'));
  return SK.cur;
}

const enqueue = (job) => {
  const p = SK.chain.then(job);
  SK.chain = p.catch(() => {});
  return p;
};

/**
 * Simpan pengaturan lewat antrean (toggle cepat tidak saling menimpa). patchOrFn bisa fungsi (cur) -> patch,
 * dihitung saat gilirannya terhadap data TERBARU; kembalikan null bila tidak ada yang perlu disimpan.
 * Konflik 409: dialog "Muat ulang?"; ditolak dengan SettingsConflict (e.conflict) bila pengguna tidak menimpa.
 */
export function saveSettings(patchOrFn, { message = 'Tersimpan', undo = true } = {}) {
  return enqueue(async () => {
    if (!SK.cur) await loadSettings();
    for (let attempt = 0; attempt < 2; attempt++) {
      const patch = typeof patchOrFn === 'function' ? patchOrFn(SK.cur) : patchOrFn;
      if (!patch) return SK.cur;
      const before = SK.cur.version;
      try {
        const res = await send('/api/settings', patch, 'PUT', before != null ? { 'If-Match': String(before) } : {});
        SK.cur = unwrapSettings(res);
        emitSettings('save');
        toast(message, false, before != null && undo ? { action: { label: 'Urungkan', fn: () => undoTo(before) } } : {});
        return SK.cur;
      } catch (err) {
        if (err.status !== 409) throw err;
        if (err.data?.current) SK.cur = unwrapSettings(err.data.current); else await loadSettings();
        const choice = await choiceDialog('Diubah orang lain',
          'Pengaturan ini sudah diubah oleh orang lain sejak Anda membukanya. Muat ulang untuk melihat versi terbaru? Perubahan Anda yang belum tersimpan akan dibuang.',
          [{ label: 'Muat ulang', value: 'reload', primary: true }, { label: 'Timpa dengan perubahan saya', value: 'overwrite' }]);
        if (choice === 'overwrite' && attempt === 0) continue;
        emitSettings('reload');
        throw new SettingsConflict();
      }
    }
    throw new SettingsConflict();
  });
}

export function restoreSettings(version) {
  return enqueue(async () => {
    const res = await send('/api/settings/restore', { version });
    const s = unwrapSettings(res);
    if (s && Array.isArray(s.intents)) SK.cur = s; else await loadSettings();
    emitSettings('restore');
    return SK.cur;
  });
}
async function undoTo(version) {
  try { await restoreSettings(version); toast('Perubahan diurungkan'); } catch (e) { toast(e.message, true); }
}

/** Normalisasi respons /api/settings/history menjadi [{version, ts, by, summary}] terbaru dulu. */
export function normHistory(d) {
  const arr = Array.isArray(d) ? d : d?.history ?? d?.versions ?? d?.items ?? [];
  return arr.map((h) => ({
    version: h.version,
    ts: h.updatedAt ?? h.ts ?? h.at ?? null,
    by: h.updatedBy ?? h.by ?? h.user ?? '',
    summary: Array.isArray(h.summary ?? h.changes) ? (h.summary ?? h.changes).join(', ') : String(h.summary ?? h.changes ?? h.note ?? ''),
  })).filter((h) => h.version != null).sort((a, b) => b.version - a.version);
}

export async function openSettingsHistory() {
  let items;
  try { items = normHistory(await api('/api/settings/history')); } catch (e) { return toast(e.message, true); }
  const curV = SK.cur?.version;
  const d = openDialog({ title: 'Riwayat versi pengaturan', size: 'wide' });
  d.body.innerHTML = `<p class="text-sm text-gray-600 mb-3">Pulihkan pengaturan ke versi sebelumnya. Memulihkan membuat versi baru, jadi riwayat tidak hilang.</p>
    ${items.length ? `<ul class="history-list">${items.map((h) => `<li><div class="min-w-0"><div class="font-medium">Versi ${esc(h.version)}${h.version === curV ? ' <span class="tag tag-info">Versi aktif</span>' : ''}</div>
      <div class="text-xs text-gray-600">${h.ts ? esc(fmtDate(h.ts)) : ''}${h.by ? ' &middot; oleh ' + esc(h.by) : ''}${h.summary ? ' &middot; ' + esc(h.summary) : ''}</div></div>
      ${h.version === curV ? '' : `<button type="button" class="${BTN_LIGHT}" data-restore="${esc(h.version)}">Pulihkan</button>`}</li>`).join('')}</ul>` : '<p class="text-sm text-gray-600">Belum ada riwayat versi.</p>'}
    <div class="dialog-actions"><button type="button" data-x class="${BTN_DARK}">Tutup</button></div>`;
  d.body.querySelector('[data-x]').onclick = d.close;
  d.body.onclick = async (e) => {
    const b = e.target.closest('[data-restore]');
    if (!b) return;
    const v = Number(b.dataset.restore);
    if (!(await confirmDialog('Pulihkan versi ' + v + '?', 'Pengaturan saat ini akan diganti dengan isi versi ' + v + '.', { okText: 'Pulihkan' }))) return;
    try { await restoreSettings(v); toast('Versi ' + v + ' dipulihkan'); d.close(); } catch (err) { toast(err.message, true); }
  };
  (d.body.querySelector('[data-restore]') || d.body.querySelector('[data-x]')).focus();
}

/* ====================================================================
   Fungsi murni untuk intent, impor CSV/JSON, kamus gaul, data wajib
   ==================================================================== */
export const INTENT_LIMIT = 300;
const KW_SPLIT = /[,;|\n]/;
const normName = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
export const normKw = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** "a, b|c" atau array -> daftar unik, huruf kecil. */
export function parseKeywords(v) {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(KW_SPLIT);
  return [...new Set(arr.map((k) => String(k).trim().toLowerCase()).filter(Boolean))];
}

export function parseOptions(v) {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(/[,;|\n]/);
  return [...new Set(arr.map((k) => String(k).trim()).filter(Boolean))];
}

/** Kata kunci yang bentrok antar-intent. Mengembalikan Map<indeks, [{keyword, other, otherKeyword, kind:'sama'|'tumpang'}]>. */
export function keywordConflicts(intents, { onlyActive = true } = {}) {
  const owners = new Map(); // kw ternormalisasi -> Set indeks intent
  intents.forEach((it, i) => {
    if (onlyActive && it.active === false) return;
    for (const k of it.keywords || []) {
      const n = normKw(k);
      if (!n) continue;
      if (!owners.has(n)) owners.set(n, new Set());
      owners.get(n).add(i);
    }
  });
  const out = new Map();
  const add = (i, rec) => {
    const l = out.get(i) || [];
    if (l.length < 6 && !l.some((x) => x.keyword === rec.keyword && x.other === rec.other && x.kind === rec.kind)) l.push(rec);
    out.set(i, l);
  };
  intents.forEach((it, i) => {
    if (onlyActive && it.active === false) return;
    for (const k of it.keywords || []) {
      const n = normKw(k);
      if (!n) continue;
      for (const j of owners.get(n) || []) if (j !== i) add(i, { keyword: k, other: intents[j].name, otherKeyword: k, kind: 'sama' });
      const w = n.split(' ');
      if (w.length < 2) continue;
      for (let a = 0; a < w.length; a++) {
        for (let b = a + 1; b <= w.length; b++) {
          if (b - a === w.length) continue; // seluruh frasa sudah dicek di atas
          const sub = w.slice(a, b).join(' ');
          for (const j of owners.get(sub) || []) {
            if (j === i) continue;
            add(i, { keyword: k, other: intents[j].name, otherKeyword: sub, kind: 'tumpang' });
            add(j, { keyword: sub, other: it.name, otherKeyword: k, kind: 'tumpang' });
          }
        }
      }
    }
  });
  return out;
}

export const conflictText = (c) => (c.kind === 'sama'
  ? `Kata kunci "${c.keyword}" juga dipakai intent "${c.other}"`
  : `"${c.keyword}" tumpang tindih dengan "${c.otherKeyword}" di intent "${c.other}"`);

/* ---- CSV ---- */
export function parseCSVRows(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const first = src.split(/\r?\n/, 1)[0];
  const d = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cur = '', q = false, line = 1, start = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else { if (c === '\n') line++; cur += c; }
    } else if (c === '"') q = true;
    else if (c === d) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      rows.push({ line: start, cells: row });
      row = []; line++; start = line;
    } else cur += c;
  }
  const unterminated = q;
  if (cur || row.length) { row.push(cur); rows.push({ line: start, cells: row }); }
  return { rows: rows.filter((r) => r.cells.some((x) => x.trim())), delimiter: d, unterminated };
}

/** Cegah formula injection di Excel saat ekspor; dibuka lagi saat impor. */
export const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};
const unguard = (s) => (/^'[=+\-@]/.test(s) ? s.slice(1) : s);
export const toCSV = (header, rows) => [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');

const HEAD = {
  name: ['intent', 'nama', 'name'], kw: ['kata_kunci', 'kata kunci', 'keywords', 'keyword'],
  res: ['respons', 'response', 'jawaban'], act: ['aktif', 'active'], pri: ['prioritas', 'priority'],
};
const isOff = (v) => /^(0|tidak|no|false|nonaktif|off)$/i.test(String(v ?? '1').trim());

/** -> {items:[{line,name,keywords,response,active,priority|null}], errors:[{line,msg}]} */
export function intentsFromCSV(text) {
  const { rows, unterminated } = parseCSVRows(text);
  const errors = [];
  if (unterminated) errors.push({ line: 0, msg: 'Ada tanda kutip (") yang tidak ditutup; baris sesudahnya bisa salah terbaca.' });
  if (!rows.length) return { items: [], errors };
  const head = rows[0].cells.map((h) => h.trim().toLowerCase());
  const col = (names) => head.findIndex((h) => names.includes(h));
  let iN = col(HEAD.name), iK = col(HEAD.kw), iR = col(HEAD.res), iA = col(HEAD.act), iP = col(HEAD.pri);
  let body = rows.slice(1);
  if (iN < 0 || iR < 0) { iN = 0; iK = 1; iR = 2; iA = 3; iP = 4; body = rows; } // tanpa header: intent, kata kunci, respons, aktif, prioritas
  const items = body.map((r) => {
    const g = (i) => (i >= 0 ? unguard(String(r.cells[i] ?? '').trim()) : '');
    return { line: r.line, name: g(iN), keywords: parseKeywords(g(iK)), response: g(iR), active: !isOff(g(iA) || '1'), priority: g(iP) === '' ? null : g(iP) };
  });
  return { items, errors };
}

/** -> {items, errors}; melempar Error ramah bila JSON rusak. */
export function intentsFromJSON(text) {
  let d;
  try { d = JSON.parse(String(text ?? '').replace(/^\uFEFF/, '')); } catch (e) { throw new Error('File JSON tidak valid: ' + e.message); }
  const arr = Array.isArray(d) ? d : d?.intents;
  if (!Array.isArray(arr)) throw new Error('JSON harus berupa array intent, atau objek dengan properti "intents".');
  const items = arr.map((x, i) => {
    const o = x && typeof x === 'object' ? x : {};
    const pr = o.priority ?? o.prioritas;
    return {
      line: i + 1, name: String(o.name ?? o.intent ?? '').trim(), keywords: parseKeywords(o.keywords ?? o.kata_kunci ?? ''),
      response: String(o.response ?? o.respons ?? '').trim(), active: o.active ?? o.aktif ?? true, priority: pr === undefined || pr === '' ? null : pr,
    };
  });
  return { items, errors: [] };
}

/** Pesan alasan bila item tidak valid, '' bila valid. Batas mengikuti validasi server. */
export function validateImportItem(it) {
  if (!it.name) return 'Nama intent kosong';
  if (it.name.length > 80) return 'Nama intent lebih dari 80 karakter';
  if (!it.response) return 'Respons kosong';
  if (it.response.length > 2000) return 'Respons lebih dari 2000 karakter';
  if (it.keywords.length > 50) return 'Kata kunci lebih dari 50';
  const long = it.keywords.find((k) => k.length > 60);
  if (long) return `Kata kunci "${long.slice(0, 20)}…" lebih dari 60 karakter`;
  if (it.priority != null) {
    const n = Number(it.priority);
    if (!Number.isInteger(n) || n < 0 || n > 100) return 'Prioritas harus bilangan bulat 0-100';
  }
  return '';
}

/**
 * Pratinjau impor. mode: 'add' (lewati duplikat) | 'update' (perbarui duplikat) | 'replace' (ganti semua).
 * -> {rows:[{line,name,state:'baru'|'duplikat'|'error',reason}], counts, result: daftar intent hasil akhir}
 */
export function previewIntentImport(existing, items, mode = 'add', max = INTENT_LIMIT) {
  const base = mode === 'replace' ? [] : existing.map((x) => ({ ...x }));
  const byName = new Map(base.map((x, i) => [normName(x.name), i]));
  const seenInFile = new Map();
  const rows = [];
  const counts = { baru: 0, duplikat: 0, error: 0 };
  const result = base;
  for (const it of items) {
    const key = normName(it.name);
    const row = { line: it.line, name: it.name, state: 'baru', reason: '' };
    const bad = validateImportItem(it);
    if (bad) { row.state = 'error'; row.reason = bad; }
    else if (seenInFile.has(key)) { row.state = 'duplikat'; row.reason = `Sama dengan baris ${seenInFile.get(key)} di file ini; dilewati`; }
    else if (byName.has(key)) {
      row.state = 'duplikat';
      if (mode === 'update') {
        const idx = byName.get(key);
        const next = { ...result[idx], keywords: it.keywords, response: it.response, active: it.active };
        if (it.priority != null) next.priority = Number(it.priority);
        result[idx] = next;
        row.reason = 'Intent yang sudah ada akan diperbarui';
      } else row.reason = 'Sudah ada di daftar; dilewati';
      seenInFile.set(key, it.line);
    } else if (result.length >= max) { row.state = 'error'; row.reason = `Melebihi batas ${max} intent`; }
    else {
      const next = { name: it.name, keywords: it.keywords, response: it.response, active: it.active };
      if (it.priority != null) next.priority = Number(it.priority);
      result.push(next);
      byName.set(key, result.length - 1);
      seenInFile.set(key, it.line);
      row.reason = 'Akan ditambahkan';
    }
    counts[row.state]++;
    rows.push(row);
  }
  return { rows, counts, result };
}

/* ---- kamus bahasa gaul (slangMap) ---- */
export function slangToText(map) {
  return Object.entries(map || {}).map(([k, v]) => `${k} = ${v}`).join('\n');
}
/** "gak = tidak" per baris (boleh juga =>, ->, :). -> {map, errors:[{line,msg}]} */
export function parseSlang(text, max = 500) {
  const map = {}, errors = [];
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const s = raw.trim();
    if (!s || s.startsWith('#')) return;
    const m = s.match(/^(.+?)\s*(?:=>|->|=|:)\s*(.+)$/);
    const line = i + 1;
    if (!m) return errors.push({ line, msg: 'Format harus "kata gaul = kata baku"' });
    const k = m[1].trim().toLowerCase(), v = m[2].trim();
    if (k.length > 40 || v.length > 60) return errors.push({ line, msg: 'Terlalu panjang (maks. 40 / 60 karakter)' });
    if (k === v.toLowerCase()) return errors.push({ line, msg: 'Kata gaul dan kata baku sama' });
    if (k in map) return errors.push({ line, msg: `Kata "${k}" muncul lebih dari sekali` });
    if (Object.keys(map).length >= max) return errors.push({ line, msg: `Melebihi batas ${max} entri` });
    map[k] = v;
  });
  return { map, errors };
}

export const FIELD_TYPES = { text: 'Teks bebas', name: 'Nama', phone: 'Nomor telepon', date: 'Tanggal', choice: 'Pilihan' };
