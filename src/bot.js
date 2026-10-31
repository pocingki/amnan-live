// Fasad bot: hanya re-ekspor (tanpa logika) agar impor lama tetap berjalan.
import * as settingsStore from './settings.js';
import { remainingMs } from './bot-plan.js';

export { fill, remainingMs, adminReturnMs, setMode, decide } from './bot-plan.js';
export { matchIntent } from './bot-intent.js';
export { normPhone } from './bot-validate.js';
export { handleIncoming, onStatusUpdate, resendMessage } from './bot-pipeline.js';
export { testerView, testerSend, testerReset, testerMode, testerAdvance, testerPhoneReply, testerTransactionDone } from './bot-tester.js';

/** Tampilan percakapan untuk dashboard: sisa durasi bot + status menunggu balasan. */
export const view = (conv) => ({
  ...conv,
  remainingMs: remainingMs(conv, settingsStore.get(), Date.now()),
  awaitingReply: conv.messages?.[conv.messages.length - 1]?.by === 'customer',
});