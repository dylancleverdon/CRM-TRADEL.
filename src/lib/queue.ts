import { isToday } from 'date-fns';
import { outcomeDef } from './constants';
import { isNewBusiness } from './leadmap';
import type { Activity, Contact, Lead, Task } from './types';

export interface QueueItem {
  type: 'lead' | 'contact';
  id: string;
  company: string;
  phone: string;
  reason: string;
  priority: number;
  task?: Task;
}

/** Last 10 digits of a phone number, used to match the same number across records. */
export const phoneKey = (p: string) => (p || '').replace(/\D/g, '').slice(-10);

/** Numbers that must never be called again, from any lead. */
export function dncPhones(leads: Lead[]): Set<string> {
  const dnc = new Set<string>();
  for (const l of leads)
    if (l.lastOutcome === 'Do Not Call' || l.disqualifyReason === 'Do not call') dnc.add(phoneKey(l.phone));
  return dnc;
}

/**
 * Who to call next. Order: follow-ups whose time has come → brand-new leads → leads still being attempted
 * (fewest attempts, oldest contact first). Disqualified/converted/nurture leads are skipped unless a follow-up is due.
 * A follow-up set for later today waits until its time (logging "Busy" no longer puts the lead straight back on top).
 */
export function buildCallQueue(leads: Lead[], contacts: Contact[], tasks: Task[], filters: { trade?: string; maxAttempts?: number; now?: number } = {}): QueueItem[] {
  const now = filters.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const due = new Map<string, Task>();
  tasks
    .filter((t) => !t.done && t.dueAt && t.dueAt <= nowIso && t.entityId)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .forEach((t) => !due.has(t.entityId) && due.set(t.entityId, t));

  const items: QueueItem[] = [];
  const maxAttempts = filters.maxAttempts ?? 8;
  const key = phoneKey;
  const dnc = dncPhones(leads);
  const seenPhones = new Set<string>();

  for (const l of leads) {
    if (!l.phone) continue;
    const pk = key(l.phone);
    if (dnc.has(pk)) continue;
    if (filters.trade && l.trade !== filters.trade) continue;
    const task = due.get(l.id);
    if (task) {
      seenPhones.add(pk);
      items.push({ type: 'lead', id: l.id, company: l.company, phone: l.phone, reason: `Follow-up: ${task.title}`, priority: 0 + (task.priority === 'High' ? -0.5 : 0), task });
      continue;
    }
    if (['Disqualified', 'Converted', 'Nurture', 'Qualified'].includes(l.status)) continue;
    if (l.notListedSince) continue; // no longer in any public list: kept for reference, not called
    if (l.lastContactedAt && isToday(new Date(l.lastContactedAt))) continue;
    if (l.nextFollowUpAt && l.nextFollowUpAt > nowIso) continue; // scheduled for later
    if ((l.attempts || 0) >= maxAttempts) continue;
    if (seenPhones.has(pk)) continue; // same business listed twice
    seenPhones.add(pk);
    const score = l.score ?? 50;
    const fresh = l.licenseStart && isNewBusiness(l.licenseStart, now);
    if (l.status === 'New' || !l.attempts)
      items.push({ type: 'lead', id: l.id, company: l.company, phone: l.phone,
        reason: fresh ? `NEW business · score ${score}` : l.lapsedAt ? `Lapsed license · score ${score}` : l.origin === 'public' ? `${l.trade || 'Lead'} · score ${score}` : 'New lead',
        priority: (fresh ? 0.9 : 1) + (100 - score) / 1000 });
    else items.push({ type: 'lead', id: l.id, company: l.company, phone: l.phone, reason: `Attempt #${(l.attempts || 0) + 1}`, priority: 2 + (l.attempts || 0) * 0.1 });
  }
  for (const c of contacts) {
    const task = due.get(c.id);
    if (task && c.phone && !dnc.has(key(c.phone)) && (!filters.trade || c.trade === filters.trade))
      items.push({ type: 'contact', id: c.id, company: c.company, phone: c.phone, reason: `Follow-up: ${task.title}`, priority: -1, task });
  }
  const lastTouch = new Map(leads.map((l) => [l.id, l.lastContactedAt || l.createdAt || '']));
  return items.sort((a, b) => a.priority - b.priority || (lastTouch.get(a.id) || '').localeCompare(lastTouch.get(b.id) || '') || a.id.localeCompare(b.id));
}

export function dayStats(acts: Activity[]) {
  const calls = acts.filter((a) => a.type === 'call');
  return {
    calls: calls.length,
    connects: calls.filter((a) => outcomeDef(a.outcome)?.connected).length,
    meetings: calls.filter((a) => a.outcome === 'Meeting Booked').length,
    talkSec: calls.reduce((s, a) => s + (a.durationSec || 0), 0),
  };
}
