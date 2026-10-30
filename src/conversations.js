// Riwayat percakapan WhatsApp (data/conversations.json).
import { randomBytes } from 'node:crypto';
import { load, save as write } from './jsonfile.js';

const FILE = 'conversations.json';
const convs = load(FILE, {});

export const save = () => write(FILE, convs);

export function newConv(phone, jid, name = '', now = Date.now()) {
  return {
    phone, jid, name,
    mode: 'bot', // bot | admin
    createdAt: now, botStartedAt: now, lastMessageAt: now,
    unread: 0, openingSent: false, pending: null, skipped: [], data: {}, messages: [],
  };
}

export function addMessage(conv, by, text, ts = Date.now()) {
  const m = { id: randomBytes(4).toString('hex'), by, text, ts }; // by: customer | bot | admin
  conv.messages.push(m);
  if (conv.messages.length > 1000) conv.messages.splice(0, conv.messages.length - 1000);
  conv.lastMessageAt = Math.max(conv.lastMessageAt || 0, ts);
  return m;
}

export const get = (phone) => convs[phone];

export function getOrCreate(phone, jid, name) {
  if (convs[phone]) return { conv: convs[phone], created: false };
  convs[phone] = newConv(phone, jid, name);
  return { conv: convs[phone], created: true };
}

export function remove(phone) {
  delete convs[phone];
  save();
}

export function removeMessages(conv, ids) {
  const s = new Set(ids);
  conv.messages = conv.messages.filter((m) => !s.has(m.id));
  save();
}

export const dataFor = (phone) => convs[phone]?.data || {};

export const totalUnread = () => Object.values(convs).reduce((n, c) => n + (c.unread || 0), 0);

export function list() {
  return Object.values(convs)
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    .map((c) => {
      const last = c.messages[c.messages.length - 1];
      return {
        phone: c.phone, name: c.name, mode: c.mode, unread: c.unread, lastMessageAt: c.lastMessageAt,
        last: last ? { by: last.by, text: last.text.slice(0, 80) } : null,
      };
    });
}
