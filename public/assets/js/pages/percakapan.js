// Percakapan Masuk: riwayat chat WA, filter, take over admin, kembalikan ke bot, pilih/hapus pesan, jadikan lead.
import {
  $, api, send, esc, icon, chatHTML, bindChatMedia, popMenu, toast, fmtTime, previewText, debounce,
  onEvent, loadSettings, getMe, isAdminRole, setActiveChat, confirmDialog, TYPE_LABEL,
} from '../lib.js';

let S, list = [], phone = null, conv = null, sel = false, first = true, admin = true, sending = false, markingRead = false;
let filter = 'all', query = '';
let unsubs = [];
let refresh = null;
let leadPhones = new Set();
const picked = new Set();
let kList = '', kHead = '', kBody = '', kFoot = '', kAlert = '';

const nameOf = (c) => c.name || '+' + c.phone;
const initial = (c) => (c.name || '#').trim().charAt(0).toUpperCase();
const who = (m) => (m.by === 'bot' ? S.botName : m.by === 'admin' ? m.sender || S.adminName : '');
const whoBy = (by) => (by === 'bot' ? S.botName : by === 'admin' ? S.adminName : '');
const EMPTY = '<div class="wa-empty">Pilih percakapan di sebelah kiri</div>';

export const FILTERS = [['all', 'Semua'], ['attn', 'Perlu perhatian'], ['await', 'Belum dibalas']];

/** Filter + pencarian daftar percakapan (murni, diuji). */
export function filterConversations(items, f = 'all', q = '') {
  const needle = String(q || '').trim().toLowerCase();
  return items.filter((c) => {
    if (f === 'attn' && !c.needsAttention) return false;
    if (f === 'await' && !c.awaitingReply) return false;
    if (!needle) return true;
    const hay = [c.name, c.phone, c.last?.text, c.last?.type && TYPE_LABEL[c.last.type]].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(needle);
  });
}

export async function mount(el) {
  phone = null; conv = null; sel = false; picked.clear(); kList = kHead = kBody = kFoot = kAlert = '';
  filter = 'all'; query = ''; sending = false; markingRead = false;
  const [s, me] = await Promise.all([
    loadSettings().catch(() => ({ botName: 'Bot', adminName: 'Admin' })),
    getMe().catch(() => null),
  ]);
  S = s; admin = isAdminRole(me);
  el.innerHTML = `<h1 class="sr-only">Percakapan Masuk</h1>
  <div class="wa-split" id="p-split">
    <aside class="wa-list" aria-label="Daftar percakapan">
      <div class="wa-tools">
        <div class="search-box">${icon('search')}<label class="sr-only" for="p-q">Cari percakapan</label><input id="p-q" type="search" autocomplete="off" placeholder="Cari nama, nomor, atau isi pesan"></div>
        <div class="chips" role="group" aria-label="Filter percakapan" id="p-filters"></div>
      </div>
      <div id="p-items"></div>
    </aside>
    <section class="wa-pane" id="p-pane" aria-label="Isi percakapan">${EMPTY}</section>
  </div>`;
  bindChatMedia($('#p-pane'));
  $('#p-items').onclick = (e) => { const it = e.target.closest('[data-p]'); if (it) open(it.dataset.p); };
  $('#p-pane').onclick = onPane;
  $('#p-q').oninput = debounce((e) => { query = e.target.value; kList = ''; renderList(); }, 150);
  $('#p-filters').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; kList = ''; renderList(); } };

  refresh = debounce(tick, 400);
  unsubs = [
    onEvent('message:new', () => refresh()),
    onEvent('conversation:attention', () => refresh()),
    onEvent('lead:new', () => loadLeads()),
    onEvent('resync', () => refresh()),
  ];
  document.addEventListener('visibilitychange', onVis);
  loadLeads();
  await tick();
}

export function unmount() {
  unsubs.forEach((u) => u());
  unsubs = [];
  refresh?.cancel();
  document.removeEventListener('visibilitychange', onVis);
  setActiveChat(null);
  phone = null;
}

function onVis() { if (!document.hidden) { maybeMarkRead(); refresh?.(); } }

async function loadLeads() {
  try { leadPhones = new Set((await api('/api/leads')).leads.map((l) => String(l.phone))); kList = kHead = ''; renderList(); if (conv) renderHead(); } catch { /* agen/jaringan: tombol tetap tampil */ }
}

async function tick() {
  try {
    list = (await api('/api/conversations')).conversations;
    renderList();
    if (phone) await loadConv();
  } catch (e) { console.error(e); }
}

function renderList() {
  const box = $('#p-items');
  if (!box) return;
  const count = (f) => filterConversations(list, f, '').length;
  const shown = filterConversations(list, filter, query);
  const key = JSON.stringify([shown, phone, filter, query, count('attn'), count('await'), list.length]);
  if (key === kList) return;
  kList = key;
  $('#p-filters').innerHTML = FILTERS.map(([f, label]) => `<button type="button" class="chip" data-f="${f}" aria-pressed="${filter === f}">${label}${f === 'all' ? '' : ` <span class="chip-n">${count(f)}</span>`}</button>`).join('');
  const focusP = document.activeElement?.dataset?.p;
  box.innerHTML = shown.length
    ? shown.map((c) => `<button type="button" class="wa-item ${c.phone === phone ? 'active' : ''}" data-p="${esc(c.phone)}" ${c.phone === phone ? 'aria-current="true"' : ''}>
        <div class="wa-avatar" aria-hidden="true">${esc(initial(c))}</div>
        <div class="min-w-0 flex-1 text-left">
          <div class="flex justify-between gap-2"><span class="font-medium truncate">${esc(nameOf(c))}</span><span class="text-xs text-gray-600 shrink-0">${fmtTime(c.lastMessageAt)}</span></div>
          <div class="flex justify-between gap-2 text-sm text-gray-600"><span class="truncate">${esc(previewText(c.last, c.last ? whoBy(c.last.by) : ''))}</span>${c.unread ? `<span class="badge-unread" aria-label="${c.unread} belum dibaca">${c.unread}</span>` : ''}</div>
          <div class="tags">
            ${c.needsAttention ? `<span class="tag tag-warn">${icon('alert', 'icon-xs')} Perlu perhatian</span>` : ''}
            ${c.awaitingReply ? '<span class="tag tag-info">Belum dibalas</span>' : ''}
            ${c.mode === 'admin' ? '<span class="pill-admin">Admin</span>' : ''}
            ${leadPhones.has(String(c.phone)) ? '<span class="tag tag-ok">Lead</span>' : ''}
          </div>
        </div></button>`).join('')
    : `<div class="p-6 text-sm text-gray-600 text-center">${list.length ? 'Tidak ada percakapan yang cocok dengan filter atau pencarian.' : 'Belum ada percakapan masuk.'}</div>`;
  if (focusP) box.querySelector(`[data-p="${CSS.escape(focusP)}"]`)?.focus();
}

function open(p) {
  phone = p; conv = null; sel = false; picked.clear(); first = true; kHead = kBody = kFoot = kAlert = '';
  setActiveChat(p);
  $('#p-split').classList.add('open');
  $('#p-pane').innerHTML = '<div class="wa-head" id="c-head"></div><div id="c-alert"></div><div class="wa-body" id="c-body" tabindex="0" role="log" aria-label="Pesan percakapan"></div><div id="c-foot"></div>';
  kList = '';
  renderList();
  loadConv().then(() => $('#c-head .c-title')?.focus());
}

function close() {
  const was = phone;
  phone = null; conv = null;
  setActiveChat(null);
  $('#p-split').classList.remove('open');
  $('#p-pane').innerHTML = EMPTY;
  kList = '';
  renderList();
  if (was) $('#p-items').querySelector(`[data-p="${CSS.escape(was)}"]`)?.focus();
}

async function loadConv() {
  const p = phone;
  let c;
  try { c = await api('/api/conversations/' + p); } catch (e) { if (p === phone && e.status === 404) close(); return; }
  if (p !== phone || !$('#c-head')) return;
  conv = c;
  renderHead(); renderAlert(); renderBody(); renderFoot();
  maybeMarkRead();
}

/** Tandai terbaca hanya bila tab terlihat dan percakapan sedang dibuka (bukan oleh polling). */
async function maybeMarkRead() {
  if (document.hidden || !phone || !conv || markingRead) return;
  const unread = conv.unread ?? list.find((c) => c.phone === phone)?.unread ?? 0;
  if (!unread) return;
  markingRead = true;
  const p = phone;
  try {
    await send(`/api/conversations/${p}/read`, {});
    if (conv && p === phone) conv.unread = 0;
    const it = list.find((c) => c.phone === p);
    if (it) it.unread = 0;
    kList = '';
    renderList();
  } catch { /* coba lagi pada refresh berikutnya */ } finally { markingRead = false; }
}

function renderHead() {
  const mins = conv.remainingMs == null ? null : Math.ceil(conv.remainingMs / 60000);
  const isLead = leadPhones.has(String(conv.phone));
  const key = JSON.stringify([conv.mode, conv.name, sel, picked.size, mins, isLead, admin]);
  if (key === kHead) return;
  kHead = key;
  const state = conv.mode === 'bot' ? `Dibalas ${S.botName}${mins != null ? ` (sisa ${mins} menit)` : ''}` : `Ditangani ${S.adminName}`;
  $('#c-head').innerHTML = `<button type="button" data-a="back" class="wa-back" aria-label="Kembali ke daftar percakapan">${icon('arrow-left', 'icon-md')}</button>
    <div class="wa-avatar" aria-hidden="true">${esc(initial(conv))}</div>
    <div class="flex-1 min-w-0"><div class="font-medium truncate c-title" tabindex="-1">${esc(nameOf(conv))}</div><div class="text-xs truncate">+${esc(conv.phone)} &middot; ${esc(state)}</div></div>
    <div class="head-actions">${sel
      ? `<span class="text-sm" role="status">${picked.size} dipilih</span><button type="button" data-a="del-sel" class="wa-hbtn" ${picked.size ? '' : 'disabled'}>Hapus</button><button type="button" data-a="cancel-sel" class="wa-hbtn">Batal</button>`
      : `<button type="button" data-a="${conv.mode === 'bot' ? 'takeover' : 'tobot'}" class="wa-hbtn">${conv.mode === 'bot' ? 'Take over admin' : 'Kembalikan ke bot'}</button>
         ${isLead ? '<a href="#/crm" class="wa-hbtn">Lihat di CRM</a>' : '<button type="button" data-a="to-lead" class="wa-hbtn">Jadikan lead</button>'}
         <button type="button" data-a="kebab" class="wa-hbtn" aria-label="Opsi percakapan" title="Opsi">${icon('dots')}</button>`}</div>`;
}

function renderAlert() {
  const key = JSON.stringify([conv.needsAttention, conv.attentionReason]);
  if (key === kAlert) return;
  kAlert = key;
  $('#c-alert').innerHTML = conv.needsAttention
    ? `<div class="attn-banner" role="note">${icon('alert')}<span><b>Perlu perhatian</b>${conv.attentionReason ? ': ' + esc(conv.attentionReason) : ''}</span></div>` : '';
}

function renderBody() {
  const key = JSON.stringify([conv.messages.map((m) => [m.id, m.status, m.mediaId, m.text]), sel, [...picked], S.botName, S.adminName]);
  if (key === kBody) return;
  kBody = key;
  const b = $('#c-body');
  const near = first || b.scrollHeight - b.scrollTop - b.clientHeight < 100;
  const st = b.scrollTop;
  b.innerHTML = chatHTML(conv.messages, (m) => ({ own: m.by !== 'customer', label: who(m), select: sel, checked: picked.has(m.id), canRetry: m.by === 'admin' }));
  b.scrollTop = near ? b.scrollHeight : st;
  first = false;
}

function renderFoot() {
  if (conv.mode === kFoot) return;
  kFoot = conv.mode;
  $('#c-foot').innerHTML = conv.mode === 'admin'
    ? `<div class="wa-foot"><label class="sr-only" for="c-input">Pesan sebagai ${esc(S.adminName)}</label><textarea id="c-input" rows="1" placeholder="Ketik pesan sebagai ${esc(S.adminName)} (Enter kirim, Shift+Enter baris baru)"></textarea><button type="button" class="wa-send" data-a="send" aria-label="Kirim pesan">${icon('send', 'icon-md')}</button></div>`
    : `<div class="wa-note">${esc(S.botName)} sedang menangani percakapan ini. Klik "Take over admin" untuk membalas sendiri.</div>`;
  const ta = $('#c-input');
  if (ta) ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendAdmin(); } };
}

const reset = () => { kHead = kBody = ''; };

async function onPane(e) {
  const a = e.target.closest('[data-a]');
  const row = e.target.closest('.msg-row');
  if (!a) {
    if (sel && row) {
      const id = row.dataset.id;
      picked.has(id) ? picked.delete(id) : picked.add(id);
      reset(); renderHead(); renderBody();
    }
    return;
  }
  try {
    switch (a.dataset.a) {
      case 'back': close(); break;
      case 'takeover': case 'tobot':
        await send(`/api/conversations/${phone}/mode`, { mode: a.dataset.a === 'takeover' ? 'admin' : 'bot' });
        await loadConv();
        toast(a.dataset.a === 'takeover' ? 'Anda mengambil alih percakapan ini' : 'Percakapan dikembalikan ke bot');
        break;
      case 'to-lead': await toLead(); break;
      case 'kebab': {
        const items = [];
        if (admin) {
          items.push({ label: 'Pilih pesan', fn: () => { sel = true; picked.clear(); reset(); renderHead(); renderBody(); } });
          items.push({ label: 'Hapus percakapan', danger: true, fn: delConv });
        } else items.push({ label: 'Hanya Admin yang dapat menghapus', disabled: true });
        popMenu(a, items);
        break;
      }
      case 'cancel-sel': sel = false; picked.clear(); reset(); renderHead(); renderBody(); break;
      case 'del-sel':
        if (!picked.size) return;
        if (!(await confirmDialog('Hapus pesan?', `Hapus ${picked.size} pesan dari dashboard? Pesan di WhatsApp tidak ikut terhapus.`, { okText: 'Hapus', danger: true }))) return;
        await send(`/api/conversations/${phone}/delete-messages`, { ids: [...picked] });
        sel = false; picked.clear(); reset();
        await loadConv();
        break;
      case 'send': await sendAdmin(); break;
      case 'retry': await retry(a); break;
    }
  } catch (err) { toast(err.message, true); }
}

async function toLead() {
  const p = phone;
  try {
    await send('/api/leads/from-conversation', { phone: p });
    toast('Lead dibuat dari percakapan ini.', false, { action: { label: 'Buka CRM', fn: () => { location.hash = '#/crm'; } } });
  } catch (e) {
    if (e.status !== 409) throw e;
    toast('Percakapan ini sudah menjadi lead.');
  }
  leadPhones.add(String(p));
  kList = kHead = '';
  renderList();
  if (conv) renderHead();
}

async function delConv() {
  if (!(await confirmDialog('Hapus percakapan?', 'Hapus seluruh percakapan ini dari dashboard? Chat berikutnya dari nomor ini akan dianggap pelanggan baru dan menampilkan pesan pembuka.', { okText: 'Hapus', danger: true }))) return;
  try { await send(`/api/conversations/${phone}`, {}, 'DELETE'); close(); await tick(); } catch (e) { toast(e.message, true); }
}

async function sendAdmin() {
  const ta = $('#c-input');
  const text = ta?.value.trim();
  if (!text || sending) return;
  sending = true;
  const btn = $('[data-a="send"]');
  if (btn) btn.disabled = true;
  try {
    const r = await send(`/api/conversations/${phone}/send`, { text });
    if (ta.value.trim() === text) ta.value = '';
    first = true;
    await loadConv();
    if (r?.message?.status === 'failed') toast('Pesan gagal terkirim. Klik "Kirim ulang" pada pesan tersebut.', true);
  } catch (e) { toast(e.message, true); } finally {
    sending = false;
    const b2 = $('[data-a="send"]');
    if (b2) b2.disabled = false;
  }
}

/** Kirim ulang pesan gagal. retryOf memberi tahu server bahwa ini pengiriman ulang; bila server tetap membuat pesan baru, yang gagal dihapus. */
async function retry(btn) {
  const id = btn.dataset.id;
  const m = conv?.messages.find((x) => x.id === id);
  if (!m?.text) return;
  btn.disabled = true;
  try {
    const r = await send(`/api/conversations/${phone}/send`, { text: m.text, retryOf: id });
    if (r?.message && r.message.id !== id) {
      try { await send(`/api/conversations/${phone}/delete-messages`, { ids: [id] }); } catch { /* agen tidak boleh menghapus: biarkan */ }
    }
    first = true;
    await loadConv();
    if (r?.message?.status === 'failed') toast('Masih gagal terkirim. Periksa koneksi WhatsApp di Pengaturan.', true);
  } catch (e) { btn.disabled = false; throw e; }
}
