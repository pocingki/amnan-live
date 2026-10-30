import { api, esc, BTN_DARK } from '../lib.js';

export async function mount(el) {
  const me = await api('/api/me');
  el.innerHTML = `<div class="card max-w-md mx-auto space-y-4">
    <h2 class="text-xl font-bold">Profil</h2>
    <p class="text-sm text-gray-600">Masuk sebagai <b>${esc(me.user)}</b></p>
    <form method="POST" action="/logout"><button class="${BTN_DARK}">Keluar</button></form>
  </div>`;
}
