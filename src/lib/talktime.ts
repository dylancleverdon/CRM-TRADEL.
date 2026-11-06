/**
 * Talk time, without typing it: from the phone's call log when the phone has the call, otherwise a guess from when
 * the call started to when you saved the outcome. A guess over 45 minutes (a window left open) counts as unknown,
 * calls that didn't connect count as no talk, and calls logged without dialing have none.
 * When the Mac rings the phone, the phone fills the real length into the Mac's call entry once the call is over.
 */
import { isAndroid, Native } from './platform';
import { store } from './store';

export const MAX_GUESS_SEC = 45 * 60;

export function guessTalkSec(startedAt: string, savedAt: number, connected: boolean): number {
  if (!connected) return 0;
  const s = Math.round((savedAt - Date.parse(startedAt)) / 1000);
  return s > 0 && s <= MAX_GUESS_SEC ? s : 0;
}

/** Seconds of the latest call to `number` since `sinceMs`, from the phone's call log (null: not there / not allowed). */
export async function callLogSeconds(number: string, sinceMs: number, noPrompt = true): Promise<number | null> {
  if (!isAndroid() || !number) return null;
  try {
    const r = await Native.lastCall({ number, since: sinceMs, noPrompt });
    return r.found ? Math.max(0, Math.round(Number(r.duration) || 0)) : null;
  } catch { return null; }
}

const LS = 'tl.pendingTalk';
interface Dialed { entityId: string; number: string; at: number }
const load = (): Dialed[] => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } };
const save = (l: Dialed[]) => { try { localStorage.setItem(LS, JSON.stringify(l.slice(-30))); } catch { /* ignore */ } };

/** Phone: a call it dialed for the Mac, whose real length should reach the Mac's call entry. */
export function rememberDialed(entityId: string, number: string, at = Date.now()) {
  if (!entityId || !number) return;
  save([...load(), { entityId, number, at }]);
}

/** Sets a call entry's talk time from the call log (once the call is over and the entry has synced). */
export function applyTalkSeconds(entityId: string, at: number, sec: number): boolean {
  const act = store.list('activities').find((a) => a.type === 'call' && a.entityId === entityId && Math.abs(Date.parse(a.occurredAt) - at) < 3 * 60000);
  if (!act) return false;
  if (act.durationSec !== sec) store.upsert('activities', { id: act.id, durationSec: sec });
  return true;
}

let busy = false;
/** Phone: fill in the real talk time for calls dialed for the Mac (kept trying for 3 hours). */
export async function fillTalkTimes(now = Date.now()) {
  if (!isAndroid() || busy) return;
  busy = true;
  try {
    const keep: Dialed[] = [];
    for (const d of load()) {
      if (now - d.at > 3 * 3600000) continue;
      const sec = await callLogSeconds(d.number, d.at, true);
      if (sec === null || !applyTalkSeconds(d.entityId, d.at, sec)) keep.push(d);
    }
    save(keep);
  } finally { busy = false; }
}

/** Settings (phone): ask for call log access. */
export async function allowCallLog(): Promise<boolean> {
  if (!isAndroid()) return false;
  try { const r = await Native.lastCall({ number: '0', since: Date.now(), noPrompt: false }); return !r.denied; } catch { return false; }
}
