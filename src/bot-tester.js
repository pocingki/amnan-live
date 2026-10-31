// Bot Tester: memakai processIncoming yang SAMA dengan jalur nyata, tetapi dengan deps in-memory
// (tanpa CRM asli, tanpa WhatsApp). Tiap nomor uji punya percakapan, lead virtual, dan jam simulasi sendiri.
import { randomBytes } from 'node:crypto';
import * as convStore from './conversations.js';
import * as settingsStore from './settings.js';
import { classify } from './leads.js';
import { processIncoming } from './bot-pipeline.js';
import { setMode, remainingMs } from './bot-plan.js';

const LABEL = {
  image: '[Gambar]', audio: '[Pesan suara]', video: '[Video]', sticker: '[Stiker]',
  document: '[Dokumen]', location: '[Lokasi]', contact: '[Kontak]',
};

export function createTester(over = {}) {
  const settings = over.settings || settingsStore;
  const classifyFn = over.classify || classify;
  const newConv = over.newConv || convStore.newConv;
  const testers = new Map(); // nomor -> {convs, lead, offset, sendFail}
  let seq = 0;

  const tnow = (t) => Date.now() + t.offset;
  const status = (t, S) => {
    const c = t.convs.get(t.phone);
    return { mode: c?.mode || 'bot', remainingMs: c ? remainingMs(c, S, tnow(t)) : null, botEnabled: S.botEnabled };
  };

  function T(phone) {
    if (testers.has(phone)) return testers.get(phone);
    const store = new Map();
    const t = { phone, lead: null, offset: 0, sendFail: false };
    t.convs = {
      get: (k) => store.get(k),
      getOrCreate(k, jid, name) {
        if (store.has(k)) return { conv: store.get(k), created: false };
        store.set(k, newConv(k, jid, name || '', tnow(t)));
        return { conv: store.get(k), created: true };
      },
      remove: (k) => void store.delete(k),
      save() {},
      addMessage(conv, by, text, ts = Date.now()) {
        const m = { id: randomBytes(4).toString('hex'), by, text, ts };
        conv.messages.push(m);
        conv.lastMessageAt = Math.max(conv.lastMessageAt || 0, ts);
        return m;
      },
      list: () => [...store.values()].map((c) => ({ phone: c.phone })),
      totalUnread: () => [...store.values()].reduce((n, c) => n + (c.unread || 0), 0),
    };
    t.convs.getOrCreate(phone, 'tester:' + phone, '');
    t.deps = {
      send: async () => {
        if (t.sendFail) throw Object.assign(new Error('Simulasi gagal kirim'), { code: 'SEND_FAILED', retryable: false });
        return { waId: 'sim' + ++seq };
      },
      now: () => tnow(t),
      sleep: () => Promise.resolve(),
      convs: t.convs,
      ingest: (payload) => {
        const r = classifyFn(t.lead, payload);
        if (r.lead) t.lead = r.lead;
        return r;
      },
      leads: {
        findByPhone: () => t.lead,
        findByLid: () => null,
        update: (id, p) => Object.assign(t.lead, p),
        remove: () => {},
      },
      settings,
      emit: () => {},
    };
    testers.set(phone, t);
    return t;
  }

  const envelope = (t, o) => ({
    waId: 'tw' + ++seq, jid: 'tester:' + t.phone, phone: t.phone, lid: null, name: '', ts: tnow(t),
    kind: 'text', text: '', caption: '', mediaId: null, mediaError: null, fromMe: false, fromPhone: false,
    source: { platform: '', adId: null, ctwaClid: null, sourceUrl: null, referralCode: null }, ...o,
  });

  async function run(t, msg) {
    const S = settings.get();
    t.sendFail = !!msg._sendFail;
    delete msg._sendFail;
    const r = await processIncoming(msg, t.deps);
    const conv = t.convs.get(t.phone);
    return {
      message: r?.message || null, replies: r?.replies || [], lead: t.lead, changes: r?.changes || [],
      data: conv.data, status: status(t, S), now: tnow(t), needsAttention: !!conv.needsAttention,
    };
  }

  return {
    testerView(phone) {
      const S = settings.get(), t = testers.get(phone);
      const c = t?.convs.get(phone);
      return {
        phone, messages: c ? c.messages : [], status: t ? status(t, S) : { mode: 'bot', remainingMs: null, botEnabled: S.botEnabled },
        lead: t?.lead || null, data: c ? c.data : {}, now: t ? tnow(t) : Date.now(), offset: t?.offset || 0,
        needsAttention: !!c?.needsAttention, numbers: [...testers.keys()],
        leads: [...testers].filter(([, x]) => x.lead).map(([ph, x]) => ({ ...x.lead, phone: ph, data: x.convs.get(ph).data })),
      };
    },
    async testerSend(phone, text, { kind = 'text', simulate = {} } = {}) {
      const t = T(phone), S = settings.get();
      let ts = tnow(t);
      if (simulate.stale) ts -= ((S.staleMinutes ?? 10) + 1) * 60000;
      const media = kind !== 'text';
      const cap = media ? String(text || '').trim() : '';
      return run(t, envelope(t, {
        ts, kind, caption: cap, text: media ? ((LABEL[kind] || '[Media]') + (cap ? ' ' + cap : '')) : text, _sendFail: !!simulate.sendFail,
      }));
    },
    testerReset: (phone) => (phone ? testers.delete(phone) : testers.clear()),
    testerMode(phone, mode) {
      const t = T(phone);
      setMode(t.convs.get(phone), mode, tnow(t));
      return status(t, settings.get());
    },
    testerAdvance(phone, hours) {
      T(phone).offset += hours * 3600000;
      return this.testerView(phone);
    },
    async testerPhoneReply(phone, text) {
      const t = T(phone);
      return run(t, envelope(t, { text, fromMe: true, fromPhone: true }));
    },
  };
}

const def = createTester();
export const { testerView, testerSend, testerReset, testerMode, testerAdvance, testerPhoneReply } = def;