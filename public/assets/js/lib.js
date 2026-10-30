// Helper bersama untuk semua halaman.
export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const INP = 'w-full border border-gray-300 rounded-lg text-sm px-3 py-2 bg-white';
export const BTN = 'px-4 py-2 text-sm font-medium rounded-lg';
export const BTN_DARK = BTN + ' bg-brand-800 text-white hover:bg-brand-900';
export const BTN_LIGHT = BTN + ' border border-gray-300 bg-white hover:bg-gray-50';

export const fmtDate = (ts) => new Date(ts).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');

export async function api(path, opt) {
  const res = await fetch(path, opt);
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('Perlu login');
  }
  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }
  if (!res.ok) throw new Error(data?.error || 'HTTP ' + res.status);
  return data;
}

export const send = (path, body, method = 'POST') =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm text-white shadow-lg ${isErr ? 'bg-red-600' : 'bg-gray-800'}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

export const field = (label, input, hint = '') =>
  `<label class="block text-sm font-medium text-gray-700">${label}<div class="mt-1 font-normal">${input}</div>${hint ? `<p class="text-xs text-gray-400 mt-1 font-normal">${hint}</p>` : ''}</label>`;

/** Modal form. onSave(form) dipanggil saat submit; modal menutup jika tidak melempar error. */
export function modal(title, html, onSave, saveText = 'Simpan') {
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4';
  wrap.innerHTML = `<form class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
    <h3 class="font-bold text-lg">${esc(title)}</h3><div class="space-y-3">${html}</div>
    <div class="flex justify-end gap-2 pt-2"><button type="button" data-x class="${BTN_LIGHT}">Batal</button><button class="${BTN_DARK}">${esc(saveText)}</button></div></form>`;
  const close = () => wrap.remove();
  wrap.querySelector('[data-x]').onclick = close;
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await onSave(e.target);
      close();
    } catch (err) {
      toast(err.message, true);
    }
  };
  document.body.appendChild(wrap);
  wrap.querySelector('input:not([type=radio]),textarea,select')?.focus();
}

/** Menu titik tiga: items = [{label, fn, danger}] */
export function popMenu(anchor, items) {
  document.querySelectorAll('.pop-menu').forEach((n) => n.remove());
  const r = anchor.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'pop-menu fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-sm text-gray-800';
  el.style.minWidth = '170px';
  el.style.top = r.bottom + 4 + 'px';
  el.style.left = Math.max(8, Math.min(r.right - 170, innerWidth - 178)) + 'px';
  el.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" class="block w-full text-left px-4 py-2 hover:bg-gray-50 ${it.danger ? 'text-red-600' : ''}">${esc(it.label)}</button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (b) { el.remove(); items[b.dataset.i].fn(); }
  };
  document.body.appendChild(el);
  setTimeout(() => document.addEventListener('click', () => el.remove(), { once: true }));
}

// ---------- Gelembung chat gaya WhatsApp ----------
export function dayLabel(ts) {
  const d = new Date(ts), n = new Date(), y = new Date(n);
  y.setDate(n.getDate() - 1);
  if (d.toDateString() === n.toDateString()) return 'Hari ini';
  if (d.toDateString() === y.toDateString()) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { dateStyle: 'medium' });
}

export function bubble(m, o = {}) {
  return `<div class="msg-row ${o.own ? 'own' : ''}" data-id="${esc(m.id)}">
    ${o.select ? `<input type="checkbox" class="msg-check" ${o.checked ? 'checked' : ''}>` : ''}
    <div class="bubble ${o.own ? 'out' : 'in'}">${o.label ? `<div class="b-label">${esc(o.label)}</div>` : ''}<span class="b-text">${esc(m.text)}</span><span class="b-meta">${fmtTime(m.ts)}${o.own ? ' &#10003;&#10003;' : ''}</span></div></div>`;
}

/** opt(m) -> {own, label, select, checked}. Pesan by:'system' tampil sebagai chip di tengah. */
export function chatHTML(msgs, opt) {
  let last = '', out = '';
  for (const m of msgs) {
    const l = dayLabel(m.ts);
    if (l !== last) { out += `<div class="date-chip"><span>${esc(l)}</span></div>`; last = l; }
    out += m.by === 'system' ? `<div class="date-chip"><span>${esc(m.text)}</span></div>` : bubble(m, opt(m));
  }
  return out;
}