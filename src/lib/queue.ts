import { endOfDay, isToday } from 'date-fns';
import { outcomeDef } from './constants';
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

/**
 * Who to call next. Order: overdue/due follow-ups → brand-new leads → leads still being attempted
 * (fewest attempts, oldest contact first). Disqualified/converted/nurture leads are skipped unless a follow-up is due.
 */
export function buildCallQueue(leads: Lead[], contacts: Contact[], tasks: Task[], filters: { trade?: string; maxAttempts?: number } = {}): QueueItem[] {
  const eod = endOfDay(new Date()).toISOString();
  const due = new Map<string, Task>();
  tasks
    .filter((t) => !t.done && t.dueAt && t.dueAt <= eod && t.entityId)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .forEach((t) => !due.has(t.entityId) && due.set(t.entityId, t));

  const items: QueueItem[] = [];
  const maxAttempts = filters.maxAttempts ?? 8;

  for (const l of leads) {
    if (!l.phone) continue;
    if (filters.trade && l.trade !== filters.trade) continue;
    const task = due.get(l.id);
    if (task) {
      items.push({ type: 'lead', id: l.id, company: l.company, phone: l.phone, reason: `Follow-up: ${task.title}`, priority: 0 + (task.priority === 'High' ? -0.5 : 0), task });
      continue;
    }
    if (['Disqualified', 'Converted', 'Nurture', 'Qualified'].includes(l.status)) continue;
    if (l.lastContactedAt && isToday(new Date(l.lastContactedAt))) continue;
    if (l.nextFollowUpAt && l.nextFollowUpAt > eod) continue; // scheduled for later
    if ((l.attempts || 0) >= maxAttempts) continue;
    if (l.status === 'New' || !l.attempts) items.push({ type: 'lead', id: l.id, company: l.company, phone: l.phone, reason: 'New lead', priority: 1 });
    else items.push({ type: 'lead', id: l.id, company: l.company, phone: l.phone, reason: `Attempt #${(l.attempts || 0) + 1}`, priority: 2 + (l.attempts || 0) * 0.1 });
  }
  for (const c of contacts) {
    const task = due.get(c.id);
    if (task && c.phone && (!filters.trade || c.trade === filters.trade))
      items.push({ type: 'contact', id: c.id, company: c.company, phone: c.phone, reason: `Follow-up: ${task.title}`, priority: -1, task });
  }
  const lastTouch = new Map(leads.map((l) => [l.id, l.lastContactedAt || l.createdAt || '']));
  return items.sort((a, b) => a.priority - b.priority || (lastTouch.get(a.id) || '').localeCompare(lastTouch.get(b.id) || ''));
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
