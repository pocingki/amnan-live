#!/usr/bin/env node
// Kelola pengguna dashboard (data/users.json). Bisa dijalankan dari folder mana pun.
//   node scripts/users.js list
//   node scripts/users.js add <nama> [--role admin|agent] [--password <pw>]
//   node scripts/users.js passwd <nama> [--password <pw>]
//   node scripts/users.js remove <nama>
//   node scripts/users.js hash [--password <pw>]     (hash untuk DASHBOARD_PASSWORD_HASH di .env)
// Tanpa --password, password dibaca dari prompt tersembunyi (atau baris pertama stdin bila dipipa).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

process.env.TZ ||= 'Asia/Jakarta';
const ROOT = path.resolve(process.env.APP_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

// Sama seperti server: baca .env dari akar aplikasi (DATA_DIR bisa diatur di sana)
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {
  /* tanpa .env */
}
process.env.DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
process.env.APP_DIR = ROOT;

const A = await import('../src/auth.js');

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, opt };
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin });
      rl.once('line', (l) => (resolve(l), rl.close()));
      rl.once('close', () => resolve(''));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted) process.stdout.write(s);
    };
    process.stdout.write(question);
    muted = hidden;
    rl.question('', (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function getPassword(opt, confirm) {
  if (opt.password !== undefined) return opt.password;
  const pw = await ask('Password: ', { hidden: true });
  if (confirm && process.stdin.isTTY && pw !== (await ask('Ulangi password: ', { hidden: true }))) throw new Error('Password tidak sama');
  return pw;
}

const usage = () => {
  console.log(
    'Pemakaian:\n  node scripts/users.js list\n  node scripts/users.js add <nama> [--role admin|agent] [--password <pw>]\n' +
      '  node scripts/users.js passwd <nama> [--password <pw>]\n  node scripts/users.js remove <nama>\n  node scripts/users.js hash [--password <pw>]'
  );
};

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const [cmd, name] = pos;
  switch (cmd) {
    case 'list': {
      const users = A.listUsers();
      if (!users.length) console.log('(belum ada pengguna)');
      for (const u of users) console.log(`${u.name.padEnd(24)} ${u.role.padEnd(6)} dibuat ${u.createdAt}`);
      break;
    }
    case 'add': {
      if (!name) return usage(), 1;
      const u = await A.addUser(name, await getPassword(opt, true), opt.role || 'agent');
      console.log(`Pengguna "${u.name}" (${u.role}) dibuat.`);
      break;
    }
    case 'passwd': {
      if (!name) return usage(), 1;
      const u = await A.setPassword(name, await getPassword(opt, true));
      console.log(`Password "${u.name}" diganti. Sesi login lama pengguna ini otomatis tidak berlaku.`);
      break;
    }
    case 'remove': {
      if (!name) return usage(), 1;
      const u = A.removeUser(name);
      console.log(`Pengguna "${u.name}" dihapus.`);
      break;
    }
    case 'hash': {
      const pw = await getPassword(opt, false);
      A.checkPasswordPolicy(pw);
      console.log(await A.hashPassword(pw));
      break;
    }
    default:
      usage();
      return cmd ? 1 : 0;
  }
  return 0;
}

let code = 0;
try {
  code = await main();
} catch (err) {
  console.error('Galat:', err.message);
  code = 1;
}
try {
  const db = await import('../src/db.js'); // penyimpanan SQLite (A4) bila ada: tutup rapi agar data tertulis
  await db.closeAll?.();
} catch {
  /* modul belum ada */
}
process.exit(code);
