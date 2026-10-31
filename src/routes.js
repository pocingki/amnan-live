// Dispatcher API (kontrak K1): memuat src/api/*.js berurutan alfabet, _legacy.js paling akhir.
// Setiap modul mengekspor `async function handle(req, res, url, ctx)` -> true bila sudah menangani.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'api');

let loaded = null; // Promise<[{name, handle}]>

/** Urutan modul: file publik alfabet -> (folder tambahan) -> _legacy.js. File berawalan "_" selain _legacy dilewati. */
export function listModuleFiles(dirs) {
  const files = [];
  let legacy = null;
  for (const dir of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
    } catch {
      continue;
    }
    for (const f of names) {
      if (f === '_legacy.js') legacy = path.join(dir, f);
      else if (!f.startsWith('_')) files.push(path.join(dir, f));
    }
  }
  return legacy ? [...files, legacy] : files;
}

export async function loadModules(dirs = defaultDirs()) {
  const mods = [];
  for (const file of listModuleFiles(dirs)) {
    const name = path.basename(file);
    try {
      const m = await import(pathToFileURL(file).href);
      if (typeof m.handle !== 'function') {
        console.warn(`[routes] ${name} dilewati: tidak mengekspor handle()`);
        continue;
      }
      mods.push({ name, handle: m.handle });
    } catch (err) {
      console.error(`[routes] ${name} GAGAL dimuat dan dilewati:`, err);
    }
  }
  return mods;
}

// API_EXTRA_DIR: folder modul tambahan (dipakai tes keamanan); dimuat sebelum _legacy.js
const defaultDirs = () => [API_DIR, ...(process.env.API_EXTRA_DIR ? [path.resolve(process.env.API_EXTRA_DIR)] : [])];

export const initRoutes = () => (loaded ||= loadModules());

const isWrite = (method) => !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

/**
 * Kebijakan peran terpusat: endpoint yang DILARANG untuk peran 'agent' (ubah pengaturan,
 * hapus lead/percakapan/pesan, logout WA, hapus data pelanggan, kelola pengguna, baca audit).
 * Dicek di dispatcher supaya tetap berlaku walau sebuah modul lupa memanggil ctx.requireRole.
 */
export function adminOnly(method, pathname) {
  const m = method.toUpperCase();
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p === '/api/users' || p.startsWith('/api/users/') || p === '/api/audit') return true;
  if (isWrite(m) && (p === '/api/settings' || p.startsWith('/api/settings/'))) return true;
  if (isWrite(m) && (p === '/api/data' || p.startsWith('/api/data/'))) return true;
  if (m === 'DELETE' && /^\/api\/leads\/[^/]+$/.test(p)) return true;
  if (m === 'DELETE' && /^\/api\/conversations\/[^/]+$/.test(p)) return true;
  if (m === 'POST' && /^\/api\/conversations\/[^/]+\/delete-messages$/.test(p)) return true;
  if (m === 'POST' && p === '/api/wa/logout') return true;
  return false;
}

/** Dipanggil server untuk setiap request /api/*. Mengembalikan true bila sudah ditangani. */
export async function route(req, res, url, ctx) {
  if (adminOnly(req.method, url.pathname) && !ctx.requireRole('admin')) return true;
  for (const mod of await initRoutes()) {
    if (await mod.handle(req, res, url, ctx)) return true;
  }
  return false;
}
