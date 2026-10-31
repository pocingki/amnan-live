#!/usr/bin/env node
// Uji asap: memanggil tiap endpoint penting pada server yang SUDAH berjalan dan memeriksa bentuk jawabannya.
// Pakai:  node scripts/smoke.js [http://127.0.0.1:8080]
// Kredensial dari env: DASHBOARD_USER / DASHBOARD_PASSWORD (atau SMOKE_USER / SMOKE_PASSWORD).
// Hanya membaca, kecuali memakai nomor uji 6281999000001 pada Bot Tester (data tester ada di memori dan direset di akhir).
const base = (process.argv[2] || process.env.SMOKE_URL || `http://127.0.0.1:${process.env.PORT || 8080}`).replace(/\/$/, '');
const user = process.env.SMOKE_USER || process.env.DASHBOARD_USER || 'admin';
const pass = process.env.SMOKE_PASSWORD || process.env.DASHBOARD_PASSWORD || '';
const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const PHONE = '6281999000001';

const rows = [];
async function call(method, url, { body, noAuth, headers = {}, expectStream } = {}) {
  const h = { ...headers };
  if (!noAuth) h.Authorization = auth;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: ctl.signal });
    if (expectStream) {
      ctl.abort();
      return { status: res.status, headers: res.headers, json: null, text: '' };
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* bukan JSON */ }
    return { status: res.status, headers: res.headers, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function check(name, fn) {
  try {
    const msg = await fn();
    rows.push({ name, ok: true, msg: msg || '' });
  } catch (e) {
    rows.push({ name, ok: false, msg: e.message });
  }
}
const must = (c, m) => { if (!c) throw new Error(m); };

await check('GET /healthz (publik)', async () => {
  const r = await call('GET', '/healthz', { noAuth: true });
  must(r.status === 200, `status ${r.status}`);
});
await check('GET /login (publik)', async () => {
  const r = await call('GET', '/login', { noAuth: true });
  must(r.status === 200, `status ${r.status}`);
  must(/content-security-policy/i.test([...r.headers.keys()].join(',')), 'tanpa header CSP');
});
await check('GET /api/leads tanpa login -> 401', async () => {
  const r = await call('GET', '/api/leads', { noAuth: true });
  must(r.status === 401, `status ${r.status}`);
});
await check('GET /api/me', async () => {
  const r = await call('GET', '/api/me');
  must(r.status === 200 && r.json, `status ${r.status} (kredensial benar?)`);
  must(typeof r.json.user === 'string', 'tanpa user');
  must(['admin', 'agent'].includes(r.json.role), 'tanpa role');
  return `${r.json.user} (${r.json.role})`;
});
await check('GET /api/wa/status', async () => {
  const r = await call('GET', '/api/wa/status');
  must(r.status === 200 && typeof r.json?.status === 'string', `status ${r.status}`);
  return r.json.status;
});
await check('GET /api/conversations', async () => {
  const r = await call('GET', '/api/conversations');
  must(r.status === 200 && Array.isArray(r.json?.conversations), `status ${r.status}`);
  return `${r.json.conversations.length} percakapan`;
});
await check('GET /api/leads (+ETag)', async () => {
  const r = await call('GET', '/api/leads');
  must(r.status === 200 && Array.isArray(r.json?.leads), `status ${r.status}`);
  const etag = r.headers.get('etag');
  must(etag, 'tanpa ETag');
  const r2 = await call('GET', '/api/leads', { headers: { 'If-None-Match': etag } });
  must(r2.status === 304, `If-None-Match -> ${r2.status}, harusnya 304`);
  return `${r.json.leads.length} lead`;
});
await check('GET /api/settings (+version)', async () => {
  const r = await call('GET', '/api/settings');
  must(r.status === 200 && Number.isInteger(r.json?.version), `status ${r.status}, version ${r.json?.version}`);
  return `versi ${r.json.version}`;
});
await check('GET /api/settings/history', async () => {
  const r = await call('GET', '/api/settings/history');
  must(r.status === 200, `status ${r.status}`);
});
await check('GET /api/events (SSE)', async () => {
  const r = await call('GET', '/api/events', { expectStream: true, headers: { Accept: 'text/event-stream' } });
  must(r.status === 200 && /text\/event-stream/.test(r.headers.get('content-type') || ''), `status ${r.status}, ${r.headers.get('content-type')}`);
});
await check('GET /api/media/xxx -> 404 (terautentikasi)', async () => {
  const r = await call('GET', '/api/media/smoke-tidak-ada');
  must(r.status === 404, `status ${r.status}`);
});
await check('GET /api/users', async () => {
  const r = await call('GET', '/api/users');
  must(r.status === 200, `status ${r.status}`);
});
await check('GET /api/audit', async () => {
  const r = await call('GET', '/api/audit');
  must(r.status === 200, `status ${r.status}`);
});
await check('GET /api/data/* ada', async () => {
  const r = await call('GET', '/api/data/stats');
  must(r.status !== 500 && !(r.status === 404 && /endpoint tidak ditemukan/i.test(r.json?.error || '')), `status ${r.status}`);
});
await check('Bot Tester: kirim pesan -> lead Cold', async () => {
  await call('POST', '/api/tester/reset', { body: { phone: PHONE } });
  const r = await call('POST', '/api/tester/send', { body: { phone: PHONE, text: 'Halo kak, saya lihat di Instagram, mau tanya harga' } });
  must(r.status === 200, `status ${r.status}: ${r.text.slice(0, 120)}`);
  must(r.json.lead?.status === 'Cold Leads', `status lead ${r.json.lead?.status}, harusnya Cold Leads`);
  must(r.json.replies?.length >= 1, 'bot tidak membalas');
});
await check('Bot Tester: sinyal transaksi -> Hot', async () => {
  const r = await call('POST', '/api/tester/send', { body: { phone: PHONE, text: 'sudah transfer ya' } });
  must(r.status === 200 && r.json.lead?.status === 'Hot Leads', `lead ${r.json?.lead?.status}`);
});
await check('Bot Tester: GET /api/tester', async () => {
  const r = await call('GET', `/api/tester?phone=${PHONE}`);
  must(r.status === 200 && Array.isArray(r.json?.messages), `status ${r.status}`);
});
await check('Bot Tester: reset', async () => {
  const r = await call('POST', '/api/tester/reset', { body: { phone: PHONE } });
  must(r.status === 200, `status ${r.status}`);
});
await check('Endpoint tak dikenal -> 404 JSON', async () => {
  const r = await call('GET', '/api/smoke-tidak-ada');
  must(r.status === 404 && r.json?.error, `status ${r.status}`);
});

const w = Math.max(...rows.map((r) => r.name.length));
let fail = 0;
for (const r of rows) {
  if (!r.ok) fail++;
  console.log(`${r.ok ? 'OK   ' : 'GAGAL'}  ${r.name.padEnd(w)}  ${r.msg}`);
}
console.log(`\n${rows.length - fail}/${rows.length} lolos terhadap ${base}`);
process.exit(fail ? 1 : 0);
