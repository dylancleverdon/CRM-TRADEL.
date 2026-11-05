import { format } from 'date-fns';
import { phoneKey, type QueueItem } from './queue';

/**
 * Call Mode's session: the next calls are locked in (10 at a time) and only change when you call or skip them,
 * or when something makes them uncallable (deleted, Do Not Call…). Leads you queue yourself ("My queue") go first.
 * The session is saved on this device, so leaving Call Mode or the app keeps the same list and skips.
 */

export const BATCH_SIZE = 10;
const KEY = 'tl.callSession';

export type CallType = 'lead' | 'contact';

/** One locked spot from the auto queue. */
export interface SessionItem {
  type: CallType;
  id: string;
  reason: string;
  /** When it was locked in; a call logged after this takes it off the list. */
  addedAt: string;
  /** Came in as a due follow-up: called even if the lead was disqualified. */
  followUp?: boolean;
}

export interface CallSession {
  day: string;
  trade: string;
  items: SessionItem[];
  skipped: string[];
  /** Due follow-ups you chose not to add from the banner. */
  dismissed: string[];
  /** The business on screen. It stays there until it's called, skipped or taken off. */
  currentId: string;
}

export interface ManualRef { type: CallType; id: string; queuedAt: string }

/** The record fields the session looks at (a lead or a contact). */
export interface CallRec {
  id: string;
  company?: string;
  phone?: string;
  status?: string;
  deleted?: boolean;
  lastContactedAt?: string;
  lastOutcome?: string;
  disqualifyReason?: string;
}
export type RecGetter = (type: CallType, id: string) => CallRec | undefined;

export interface ViewItem { type: CallType; id: string; company: string; reason: string; manual: boolean }

export interface SessionView {
  current?: ViewItem;
  /** My queue, after the current card. */
  manual: ViewItem[];
  /** The rest of the locked batch, after the current card. */
  locked: ViewItem[];
  /** Taken off for a reason other than being called. */
  removed: { id: string; company: string; reason: string }[];
  /** Callable spots left in the locked batch (the current card included). */
  lockedLeft: number;
  /** Everything on screen: current, My queue and the batch. */
  visible: Set<string>;
}

export const dayKey = (d = new Date()) => format(d, 'yyyy-MM-dd');

export function freshSession(trade = '', keep?: Pick<CallSession, 'skipped' | 'dismissed'>): CallSession {
  return { day: dayKey(), trade, items: [], skipped: keep?.skipped || [], dismissed: keep?.dismissed || [], currentId: '' };
}

export function loadSession(): CallSession {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && Array.isArray(s.items)) return s.day === dayKey() ? { ...freshSession(s.trade || ''), ...s } : freshSession(s.trade || '');
  } catch { /* ignore */ }
  return freshSession();
}

export function saveSession(s: CallSession) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** Leads and contacts you added to My queue, oldest first. */
export function manualQueue(leads: { id: string; queuedAt?: string }[], contacts: { id: string; queuedAt?: string }[]): ManualRef[] {
  const out: ManualRef[] = [];
  for (const l of leads) if (l.queuedAt) out.push({ type: 'lead', id: l.id, queuedAt: l.queuedAt });
  for (const c of contacts) if (c.queuedAt) out.push({ type: 'contact', id: c.id, queuedAt: c.queuedAt });
  return out.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt) || a.id.localeCompare(b.id));
}

/** Why a business comes off the list ('' = still callable). `explicit` = queued by you or a due follow-up. */
export function dropReason(type: CallType, rec: CallRec | undefined, since: string, dnc: Set<string>, explicit = false): string {
  if (!rec || rec.deleted) return 'deleted';
  if (since && rec.lastContactedAt && rec.lastContactedAt >= since) return 'called';
  if (rec.lastOutcome === 'Do Not Call' || rec.disqualifyReason === 'Do not call' || (rec.phone && dnc.has(phoneKey(rec.phone)))) return 'Do Not Call';
  if (!rec.phone) return 'no phone';
  if (type === 'lead' && rec.status === 'Converted') return 'now a contact';
  if (type === 'lead' && rec.status === 'Disqualified' && !explicit) return 'disqualified';
  return '';
}

/** What Call Mode shows. The order is exactly the order things were queued / locked in. */
export function resolveSession(s: CallSession, manual: ManualRef[], get: RecGetter, dnc: Set<string>): SessionView {
  const skipped = new Set(s.skipped);
  const manualIds = new Set(manual.map((m) => m.id));
  const removed: SessionView['removed'] = [];
  const mine: ViewItem[] = [];
  for (const m of manual) {
    if (skipped.has(m.id)) continue;
    const rec = get(m.type, m.id);
    const why = dropReason(m.type, rec, m.queuedAt, dnc, true);
    if (why) { if (why !== 'called') removed.push({ id: m.id, company: rec?.company || '', reason: why }); continue; }
    mine.push({ type: m.type, id: m.id, company: rec!.company || '', reason: 'My queue', manual: true });
  }
  const auto: ViewItem[] = [];
  const seen = new Set<string>();
  for (const it of s.items) {
    if (skipped.has(it.id) || manualIds.has(it.id) || seen.has(it.id)) continue;
    seen.add(it.id);
    const rec = get(it.type, it.id);
    const why = dropReason(it.type, rec, it.addedAt, dnc, it.followUp);
    if (why) { if (why !== 'called') removed.push({ id: it.id, company: rec?.company || '', reason: why }); continue; }
    auto.push({ type: it.type, id: it.id, company: rec!.company || '', reason: it.reason, manual: false });
  }
  const all = [...mine, ...auto];
  const current = all.find((x) => x.id === s.currentId) || all[0];
  return {
    current,
    manual: mine.filter((x) => x !== current),
    locked: auto.filter((x) => x !== current),
    removed,
    lockedLeft: auto.length,
    visible: new Set(all.map((x) => x.id)),
  };
}

/** The next calls to lock in: the top of the auto queue, minus anything shown, skipped or taken off. */
export function nextBatch(auto: QueueItem[], s: CallSession, view: SessionView, now = new Date().toISOString(), size = BATCH_SIZE): SessionItem[] {
  const blocked = new Set([...view.visible, ...s.skipped, ...view.removed.map((r) => r.id)]);
  const out: SessionItem[] = [];
  for (const q of auto) {
    if (out.length >= size) break;
    if (blocked.has(q.id)) continue;
    out.push({ type: q.type, id: q.id, reason: q.reason, addedAt: now, followUp: !!q.task });
  }
  return out;
}

/** Adds a batch to the session (a business that comes back, e.g. a follow-up now due, moves to its new spot). */
export function withBatch(s: CallSession, batch: SessionItem[]): CallSession {
  const ids = new Set(batch.map((b) => b.id));
  return { ...s, items: [...s.items.filter((i) => !ids.has(i.id)), ...batch] };
}

/** Follow-ups whose time has come that aren't on screen yet (offered in a banner rather than pushed in). */
export function dueNotShown(auto: QueueItem[], view: SessionView, s: CallSession): QueueItem[] {
  const hidden = new Set([...s.dismissed, ...s.skipped]);
  return auto.filter((q) => q.task && !view.visible.has(q.id) && !hidden.has(q.id));
}
