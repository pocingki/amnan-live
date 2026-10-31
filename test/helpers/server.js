// Helper tes integrasi: menjalankan server.js asli di port acak dengan DATA_DIR sementara.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const USER = 'admin';
export const PASSWORD = 'sandi-uji-12345';

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Menyalakan server. Mengembalikan { base, port, dataDir, logs(), stop() }. */
export async function startServer({ env = {}, timeoutMs = 20000 } = {}) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amnan-int-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      DASHBOARD_USER: USER,
      DASHBOARD_PASSWORD: PASSWORD,
      BOT_NO_DELAY: '1',
      TZ: 'Asia/Jakarta',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  let exited = null;
  child.on('exit', (code) => (exited = code ?? 'signal'));

  const base = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  for (;;) {
    if (exited !== null) throw new Error(`server berhenti (kode ${exited}) sebelum siap:\n${log.slice(-1500)}`);
    try {
      const r = await fetch(base + '/login', { signal: AbortSignal.timeout(1000) });
      if (r.status < 500) break;
    } catch {
      /* belum siap */
    }
    if (Date.now() - t0 > timeoutMs) {
      child.kill('SIGKILL');
      throw new Error(`server tidak siap dalam ${timeoutMs} ms:\n${log.slice(-1500)}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  return {
    base,
    port,
    dataDir,
    logs: () => log,
    async stop() {
      if (exited === null) {
        child.kill('SIGTERM');
        await new Promise((r) => {
          const t = setTimeout(() => (child.kill('SIGKILL'), r()), 8000);
          child.once('exit', () => (clearTimeout(t), r()));
        });
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export const basicAuth = (user = USER, pass = PASSWORD) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

/** Klien HTTP kecil dengan cookie jar. mode 'basic' = Basic Auth (tanpa CSRF); 'session' = cookie sesi + CSRF. */
export class Client {
  constructor(base, { mode = 'session' } = {}) {
    this.base = base;
    this.mode = mode;
    this.jar = new Map();
  }

  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  storeCookies(res) {
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      if (/;\s*Max-Age=0/i.test(line) || v === '') this.jar.delete(k);
      else this.jar.set(k, v);
    }
  }

  /** Login lewat form POST /login (perilaku bawaan server). Mengembalikan Response. */
  async login(user = USER, pass = PASSWORD) {
    const res = await fetch(this.base + '/login', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: user, password: pass }),
    });
    this.storeCookies(res);
    return res;
  }

  /** opts: { body, headers, raw, noCsrf }. body objek -> JSON. */
  async req(method, url, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.mode === 'basic') headers.Authorization ??= basicAuth();
    else {
      const c = this.cookieHeader();
      if (c) headers.Cookie = c;
      if (!['GET', 'HEAD'].includes(method) && !opts.noCsrf && this.jar.has('csrf')) headers['X-CSRF-Token'] = decodeURIComponent(this.jar.get('csrf'));
    }
    let body = opts.raw;
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['Content-Type'] ??= 'application/json';
    }
    const res = await fetch(this.base + url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs || 10000) });
    this.storeCookies(res);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* bukan JSON */
    }
    return { status: res.status, headers: res.headers, text, json };
  }

  get = (u, o) => this.req('GET', u, o);
  post = (u, body, o = {}) => this.req('POST', u, { ...o, body });
  put = (u, body, o = {}) => this.req('PUT', u, { ...o, body });
  patch = (u, body, o = {}) => this.req('PATCH', u, { ...o, body });
  del = (u, o) => this.req('DELETE', u, o);
}
