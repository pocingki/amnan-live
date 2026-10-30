// Percakapan Masuk: riwayat chat WA, take over admin, kembalikan ke bot, pilih/hapus pesan.
import { $, api, send, esc, chatHTML, popMenu, toast, fmtTime } from '../lib.js';

let timer, S, list = [], phone = null, conv = null, sel = false, first = true;
const picked = new Set();
let kList = '', kHead = '', kBody = '', kFoot = '';

const nameOf = (c) => c.name || '+' + c.phone;
const initial = (c) => (c.name || '#').trim().charAt(0).toUpperCase();
const who = (by) => (by === 'bot' ? S.botName : by === 'admin' ? S.adminName : '');
const EMPTY = '<div class="wa-empty">Pilih percakapan di sebelah kiri</div>';

export async function mount(el) {
  phone = null; conv = null; sel = false; picked.clear(); kList = '';
  try { S = await api('/api/settings'); } catch { S = { botName: 'Bot', adminName: 'Admin' }; }
  el.innerHTML = `<div class="wa-split" id="p-split"><aside class="wa-list" id="p-list"></aside><section class="wa-pane" id="p-pane">${EMPTY}</section></div>`;
  $('#p-list').onclick = (e) => { const it = e.target.closest('[data-p]'); if (it) open(it.dataset.p); };
  $('#p-pane').onclick = onPane;
  await tick();
  timer = setInterval(tick, 2500);
}

export function unmount() { clearInterval(timer); }

async function tick() {
  try {
    list = (await api('/api/conversations')).conversations;
    renderList();
    if (phone) await loadConv();
  } catch (e) { console.error(e); }
}

function renderList() {
  const key = JSON.stringify([list, phone]);
  if (key === kList || !$('#p-list')) return;
  kList = key;
  $('#p-list').innerHTML = list.length
    ? list.map((c) => `<div class="wa-item ${c.phone === phone ? 'active' : ''}" data-p="${c.phone}">
        <div class="wa-avatar">${esc(initial(c))}</div>
        <div class="min-w-0 flex-1">
          <div class="flex justify-between gap-2"><span class="font-medium truncate">${esc(nameOf(c))}</span><span class="text-xs text-gray-400 shrink-0">${fmtTime(c.lastMessageAt)}</span></div>
          <div class="flex justify-between gap-2 text-sm text-gray-500"><span class="truncate">${c.last ? esc((who(c.last.by) ? who(c.last.by) + ': ' : '') + c.last.text) : ''}</span>${c.unread ? `<span class="badge-unread">${c.unread}</span>` : ''}</div>
          ${c.mode === 'admin' ? '<span class="pill-admin">Admin</span>' : ''}
        </div></div>`).join('')
    : '<div class="p-6 text-sm text-gray-400 text-center">Belum ada percakapan masuk.</div>';
}

function open(p) {
  phone = p; conv = null; sel = false; picked.clear(); first = true; kHead = kBody = kFoot = '';
  $('#p-split').classList.add('open');
  $('#p-pane').innerHTML = '<div class="wa-head" id="c-head"></div><div class="wa-body" id="c-body"></div><div id="c-foot"></div>';
  renderList();
  loadConv();
}

function close() {
  phone = null; conv = null;
  $('#p-split').classList.remove('open');
  $('#p-pane').innerHTML = EMPTY;
  kList = '';
  renderList();
}

async function loadConv() {
  const p = phone;
  let c;
  try { c = await api('/api/conversations/' + p); } catch { if (p === phone) close(); return; }
  if (p !== phone || !$('#c-head')) return;
  conv = c;
  renderHead(); renderBody(); renderFoot();
}

function renderHead() {
  const mins = conv.remainingMs == null ? null : Math.ceil(conv.remainingMs / 60000);
  const key = JSON.stringify([conv.mode, conv.name, sel, picked.size, mins]);
  if (key === kHead) return;
  kHead = key;
  const state = conv.mode === 'bot' ? `Dibalas ${S.botName}${mins != null ? ` (sisa ${mins} menit)` : ''}` : `Ditangani ${S.adminName}`;
  $('#c-head').innerHTML = `<button data-a="back" class="wa-back" title="Kembali">&larr;</button>
    <div class="wa-avatar">${esc(initial(conv))}</div>
    <div class="flex-1 min-w-0"><div class="font-medium truncate">${esc(nameOf(conv))}</div><div class="text-xs opacity-80 truncate">+${esc(conv.phone)} &middot; ${esc(state)}</div></div>
    ${sel
      ? `<span class="text-sm">${picked.size} dipilih</span><button data-a="del-sel" class="wa-hbtn">Hapus</button><button data-a="cancel-sel" class="wa-hbtn">Batal</button>`
      : `<button data-a="${conv.mode === 'bot' ? 'takeover' : 'tobot'}" class="wa-hbtn">${conv.mode === 'bot' ? 'Take over admin' : 'Kembalikan ke bot'}</button>
         <button data-a="kebab" class="wa-hbtn" title="Opsi">&#8942;</button>`}`;
}

function renderBody() {
  const key = JSON.stringify([conv.messages.map((m) => m.id), sel, [...picked]]);
  if (key === kBody) return;
  kBody = key;
  const b = $('#c-body');
  const near = first || b.scrollHeight - b.scrollTop - b.clientHeight < 100;
  const st = b.scrollTop;
  b.innerHTML = chatHTML(conv.messages, (m) => ({ own: m.by !== 'customer', label: who(m.by), select: sel, checked: picked.has(m.id) }));
  b.scrollTop = near ? b.scrollHeight : st;
  first = false;
}

function renderFoot() {
  if (conv.mode === kFoot) return;
  kFoot = conv.mode;
  $('#c-foot').innerHTML = conv.mode === 'admin'
    ? `<div class="wa-foot"><textarea id="c-input" rows="1" placeholder="Ketik pesan sebagai ${esc(S.adminName)} (Enter kirim, Shift+Enter baris baru)"></textarea><button class="wa-send" data-a="send" title="Kirim">&#10148;</button></div>`
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
      case 'kebab':
        popMenu(a, [
          { label: 'Pilih pesan', fn: () => { sel = true; picked.clear(); reset(); renderHead(); renderBody(); } },
          { label: 'Hapus percakapan', danger: true, fn: delConv },
        ]);
        break;
      case 'cancel-sel': sel = false; picked.clear(); reset(); renderHead(); renderBody(); break;
      case 'del-sel':
        if (!picked.size || !confirm(`Hapus ${picked.size} pesan dari dashboard? (pesan di WhatsApp tidak ikut terhapus)`)) return;
        await send(`/api/conversations/${phone}/delete-messages`, { ids: [...picked] });
        sel = false; picked.clear(); reset();
        await loadConv();
        break;
      case 'send': await sendAdmin(); break;
    }
  } catch (err) { toast(err.message, true); }
}

async function delConv() {
  if (!confirm('Hapus seluruh percakapan ini dari dashboard? Chat berikutnya dari nomor ini akan dianggap pelanggan baru dan menampilkan pesan pembuka.')) return;
  try { await send(`/api/conversations/${phone}`, {}, 'DELETE'); close(); await tick(); } catch (e) { toast(e.message, true); }
}

async function sendAdmin() {
  const ta = $('#c-input');
  const text = ta?.value.trim();
  if (!text) return;
  ta.value = '';
  try { await send(`/api/conversations/${phone}/send`, { text }); first = true; await loadConv(); } catch (e) { ta.value = text; toast(e.message, true); }
}
