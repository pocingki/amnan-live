#!/usr/bin/env node
// Kelola integrasi aplikasi (kunci API & webhook), docs/INTEGRASI.md. Jalankan di server yang sama dengan instance.
//   node scripts/integrations.js list
//   node scripts/integrations.js key add --app booking --name "Booking Live" --scopes leads:read,leads:write,messages:send,events:write [--perDay 300]
//   node scripts/integrations.js key revoke <id>
//   node scripts/integrations.js webhook add --name "Booking" --url https://book.klinik.com/api/integrations/amnan/webhook [--events lead.created,lead.hot]
//   node scripts/integrations.js webhook enable|disable|remove <id>
//   node scripts/integrations.js link-secret         (cetak rahasia acak untuk BOOKING_LINK_SECRET / AMNAN_LINK_SECRET)
// Untuk instance client: ENV_FILE=/opt/clients/klinik-a/.env node scripts/integrations.js ...
// Server yang sedang berjalan membaca ulang kunci dan webhook tiap beberapa detik, jadi tidak perlu restart.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.TZ ||= 'Asia/Jakarta';
const ROOT = path.resolve(process.env.APP_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
try {
  const envFile = process.env.ENV_FILE ? path.resolve(process.env.ENV_FILE) : path.join(ROOT, '.env');
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {
  /* tanpa .env */
}
process.env.DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
process.env.APP_DIR = ROOT;
process.env.AMNAN_NO_BG = '1';

const C = await import('../src/connect.js');

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, opt };
}

const { pos, opt } = parseArgs(process.argv.slice(2));
const [cmd, sub, arg] = pos;
const die = (m) => (console.error(m), process.exit(1));
const table = (rows) => (rows.length ? console.table(rows) : console.log('(kosong)'));

try {
  if (cmd === 'list') {
    console.log('Kunci:');
    table(C.listKeys().map((k) => ({ id: k.id, app: k.app, nama: k.name, scopes: k.scopes.join(','), perHari: k.messagesPerDay, dicabut: k.revokedAt ? 'ya' : '', terakhirDipakai: k.lastUsedAt || '' })));
    console.log('Webhook:');
    table(C.listWebhooks().map((w) => ({ id: w.id, nama: w.name, url: w.url, events: w.events.join(','), aktif: w.active ? 'ya' : 'TIDAK', gagalBeruntun: w.failures })));
  } else if (cmd === 'key' && sub === 'add') {
    const r = C.createKey({ name: opt.name, app: opt.app, scopes: opt.scopes, messagesPerDay: opt.perDay, createdBy: 'cli' });
    console.log(`Kunci dibuat (id ${r.key.id}, app ${r.key.app}). SIMPAN SEKARANG, tidak akan ditampilkan lagi:\n\n  ${r.token}\n`);
  } else if (cmd === 'key' && sub === 'revoke') {
    if (!arg) die('Pakai: key revoke <id>');
    C.revokeKey(arg);
    console.log(`Kunci ${arg} dicabut.`);
  } else if (cmd === 'webhook' && sub === 'add') {
    const r = C.createWebhook({ name: opt.name, url: opt.url, events: opt.events });
    C.pingWebhook(r.webhook.id);
    C.flush();
    console.log(`Webhook dibuat (id ${r.webhook.id}). SIMPAN rahasia penandatangan sekarang, tidak ditampilkan lagi:\n\n  ${r.secret}\n\nPing uji diantrekan; terkirim setelah server berjalan.`);
  } else if (cmd === 'webhook' && ['enable', 'disable'].includes(sub)) {
    if (!arg) die(`Pakai: webhook ${sub} <id>`);
    C.updateWebhook(arg, { active: sub === 'enable' });
    console.log(`Webhook ${arg} ${sub === 'enable' ? 'diaktifkan' : 'dinonaktifkan'}.`);
  } else if (cmd === 'webhook' && sub === 'remove') {
    if (!arg) die('Pakai: webhook remove <id>');
    C.removeWebhook(arg);
    C.flush();
    console.log(`Webhook ${arg} dihapus.`);
  } else if (cmd === 'link-secret') {
    console.log(crypto.randomBytes(32).toString('base64url'));
  } else {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  die(`Gagal: ${e.message}`);
}
