// Penyimpanan lead sederhana berbasis file JSON (cukup untuk demo).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DATA_DIR, 'leads.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

let leads = [];
if (fs.existsSync(FILE)) {
  try {
    leads = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    console.error('[store] leads.json rusak, mulai dari kosong');
  }
}

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(leads, null, 2));
  fs.renameSync(tmp, FILE);
}

export const STATUSES = ['Cold Leads', 'Warm Leads', 'Hot Leads'];
export const DATA_TYPES = ['New', 'Existing'];

// Migrasi status lama ke status baru
const OLD = { Baru: 'Warm Leads', 'Dalam Proses': 'Warm Leads', Deal: 'Hot Leads', Gagal: 'Cold Leads' };
let migrated = false;
for (const l of leads) {
  if (OLD[l.status]) { l.status = OLD[l.status]; migrated = true; }
  if (!l.dataType) { l.dataType = 'New'; migrated = true; }
}
if (migrated) save();

export const all = () => leads;

export const findByPhone = (phone) => leads.find((l) => l.phone === phone);

export const updateByPhone = (phone, patch) => update(findByPhone(phone)?.id, patch);

export function add(data) {
  const lead = { id: randomUUID(), ...data };
  leads.unshift(lead);
  save();
  return lead;
}

export function remove(id) {
  const i = leads.findIndex((l) => l.id === id);
  if (i < 0) return false;
  leads.splice(i, 1);
  save();
  return true;
}

export function update(id, patch) {
  const lead = leads.find((l) => l.id === id);
  if (!lead) return null;
  Object.assign(lead, patch);
  save();
  return lead;
}
