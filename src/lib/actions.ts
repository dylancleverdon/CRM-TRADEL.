import { addDays, addHours, setHours, setMinutes, startOfDay } from 'date-fns';
import { DEFAULT_STAGES, outcomeDef, type StageDef } from './constants';
import { getSetting, nowIso, store } from './store';
import type { Activity, ActivityType, Contact, EntityType, Lead, Opportunity, Quality, Task } from './types';

export type Entity = { type: EntityType; id: string };

export const stages = (): StageDef[] => getSetting('stages', DEFAULT_STAGES);

export function entityName(type: EntityType, id: string): string {
  if (type === 'lead') return store.get('leads', id)?.company || 'Lead';
  if (type === 'contact') return store.get('contacts', id)?.company || 'Contact';
  return store.get('opportunities', id)?.name || 'Opportunity';
}

export function entityPhone(type: EntityType, id: string): string {
  if (type === 'lead') return store.get('leads', id)?.phone || '';
  if (type === 'contact') return store.get('contacts', id)?.phone || '';
  const o = store.get('opportunities', id);
  return o ? store.get('contacts', o.contactId)?.phone || '' : '';
}

export function logActivity(e: Entity, a: Partial<Activity> & { type: ActivityType }): Activity {
  return store.upsert('activities', {
    entityType: e.type,
    entityId: e.id,
    entityName: entityName(e.type, e.id),
    outcome: '',
    notes: '',
    durationSec: 0,
    phone: '',
    occurredAt: nowIso(),
    ...a,
  });
}

/** Default follow-up time: N days out at 10:00, or 2 hours from now for "later today". */
export function followUpDate(days: number): Date {
  if (days <= 0) return addHours(new Date(), 2);
  return setMinutes(setHours(startOfDay(addDays(new Date(), days)), 10), 0);
}

export function addTask(e: Entity | null, title: string, dueAt: Date | string, priority: Task['priority'] = 'Normal', notes = ''): Task {
  const t = store.upsert('tasks', {
    entityType: e?.type || '',
    entityId: e?.id || '',
    entityName: e ? entityName(e.type, e.id) : '',
    title,
    dueAt: typeof dueAt === 'string' ? dueAt : dueAt.toISOString(),
    priority,
    done: false,
    doneAt: '',
    notes,
  });
  if (e) refreshFollowUp(e);
  return t;
}

export function completeTask(task: Task, done = true) {
  store.upsert('tasks', { id: task.id, done, doneAt: done ? nowIso() : '' });
  if (task.entityId && task.entityType) {
    const e = { type: task.entityType as EntityType, id: task.entityId };
    if (done) logActivity(e, { type: 'task', outcome: 'Completed', notes: task.title });
    refreshFollowUp(e);
  }
}

/** Keeps the lead/contact "nextFollowUpAt" column in step with its open tasks. */
export function refreshFollowUp(e: Entity) {
  if (e.type === 'opportunity') return;
  const open = store
    .list('tasks')
    .filter((t) => t.entityId === e.id && !t.done)
    .map((t) => t.dueAt)
    .sort();
  const next = open[0] || '';
  const table = e.type === 'lead' ? 'leads' : 'contacts';
  const cur = store.get(table, e.id);
  if (cur && cur.nextFollowUpAt !== next) store.upsert(table, { id: e.id, nextFollowUpAt: next } as any);
}

/** Close out open follow-up tasks for an entity (used after a call). */
function closeOpenFollowUps(e: Entity) {
  store
    .list('tasks')
    .filter((t) => t.entityId === e.id && !t.done && new Date(t.dueAt) <= addHours(new Date(), 12))
    .forEach((t) => store.upsert('tasks', { id: t.id, done: true, doneAt: nowIso() }));
}

export interface CallLog {
  entity: Entity;
  outcome: string;
  notes: string;
  durationSec: number;
  phone: string;
  followUp: string | null; // ISO or null
  followUpTitle?: string;
  startedAt?: string;
}

export function logCall(c: CallLog) {
  const def = outcomeDef(c.outcome);
  logActivity(c.entity, {
    type: 'call',
    outcome: c.outcome,
    notes: c.notes,
    durationSec: c.durationSec,
    phone: c.phone,
    occurredAt: c.startedAt || nowIso(),
  });
  closeOpenFollowUps(c.entity);
  const ts = nowIso();
  if (c.entity.type === 'lead') {
    const lead = store.get('leads', c.entity.id);
    if (lead) {
      const patch: Partial<Lead> = {
        id: lead.id,
        attempts: (lead.attempts || 0) + (def?.attempt ? 1 : 0),
        lastContactedAt: ts,
        lastOutcome: c.outcome,
      };
      if (lead.queuedAt) patch.queuedAt = ''; // called: done with "My queue"
      if (def?.status && lead.status !== 'Converted') {
        // never downgrade a qualified lead because of a missed call
        const keep = (lead.status === 'Qualified' || lead.status === 'Connected') && def.status === 'Attempting';
        if (!keep) patch.status = def.status;
      }
      if (def?.quality) patch.quality = def.quality;
      if (def?.disqualifyReason) patch.disqualifyReason = def.disqualifyReason;
      if (patch.status && patch.status !== lead.status)
        logActivity(c.entity, { type: 'status', outcome: `${lead.status} → ${patch.status}` });
      store.upsert('leads', patch);
    }
  } else if (c.entity.type === 'contact') {
    const contact = store.get('contacts', c.entity.id);
    store.upsert('contacts', { id: c.entity.id, lastContactedAt: ts, lastOutcome: c.outcome, ...(contact?.queuedAt ? { queuedAt: '' } : {}) });
  }
  if (c.followUp) addTask(c.entity, c.followUpTitle || `Follow up (${c.outcome})`, c.followUp, def?.connected ? 'High' : 'Normal');
  else refreshFollowUp(c.entity);
}

/**
 * Add a lead or contact to "My queue" in Call Mode, or take it off. Stored on the record so it syncs:
 * queue on the Mac, call from the phone. `at` lets a bulk add keep the order you picked.
 */
export function setQueued(e: { type: 'lead' | 'contact'; id: string }, on: boolean, at: string = nowIso()) {
  if (e.type === 'lead') store.upsert('leads', { id: e.id, queuedAt: on ? at : '' });
  else store.upsert('contacts', { id: e.id, queuedAt: on ? at : '' });
}

export function setLeadQuality(lead: Lead, quality: Quality, reason = '') {
  const patch: Partial<Lead> = { id: lead.id, quality };
  if (lead.status !== 'Converted') {
    if (quality === 'good') patch.status = 'Qualified';
    if (quality === 'bad') patch.status = 'Disqualified';
  }
  patch.disqualifyReason = quality === 'bad' ? reason || lead.disqualifyReason : '';
  store.upsert('leads', patch);
  logActivity({ type: 'lead', id: lead.id }, {
    type: 'status',
    outcome: quality === 'good' ? 'Marked GOOD lead' : quality === 'bad' ? `Marked BAD lead${reason ? ` (${reason})` : ''}` : 'Quality cleared',
  });
}

export function setLeadStatus(lead: Lead, status: Lead['status']) {
  if (status === lead.status) return;
  store.upsert('leads', { id: lead.id, status });
  logActivity({ type: 'lead', id: lead.id }, { type: 'status', outcome: `${lead.status} → ${status}` });
}

/** Lead → Contact conversion. Moves open tasks and copies history links. */
export function convertLead(lead: Lead): Contact {
  if (lead.convertedContactId) {
    const existing = store.get('contacts', lead.convertedContactId);
    if (existing) return existing;
  }
  const contact = store.upsert('contacts', {
    company: lead.company,
    contactName: lead.contactName,
    title: 'Owner',
    phone: lead.phone,
    altPhone: lead.altPhone,
    email: lead.email,
    website: lead.website,
    trade: lead.trade,
    city: lead.city,
    state: lead.state,
    address: lead.address,
    status: 'Prospect',
    leadId: lead.id,
    tags: lead.tags,
    lastContactedAt: lead.lastContactedAt,
    lastOutcome: lead.lastOutcome,
    nextFollowUpAt: '',
    notes: lead.notes,
    queuedAt: lead.queuedAt || '',
  });
  store.upsert('leads', { id: lead.id, status: 'Converted', quality: 'good', convertedContactId: contact.id, ...(lead.queuedAt ? { queuedAt: '' } : {}) });
  store
    .list('tasks')
    .filter((t) => t.entityId === lead.id && !t.done)
    .forEach((t) => store.upsert('tasks', { id: t.id, entityType: 'contact', entityId: contact.id }));
  logActivity({ type: 'lead', id: lead.id }, { type: 'converted', outcome: 'Converted to contact' });
  logActivity({ type: 'contact', id: contact.id }, { type: 'converted', outcome: 'Created from lead' });
  refreshFollowUp({ type: 'contact', id: contact.id });
  return contact;
}

export function createOpportunity(contact: Contact, data: Partial<Opportunity>): Opportunity {
  const st = stages();
  const stage = data.stage || st[0].name;
  const opp = store.upsert('opportunities', {
    contactId: contact.id,
    name: data.name || `${contact.company} - ${data.service || 'Marketing'}`,
    service: data.service || '',
    stage,
    monthlyValue: data.monthlyValue || 0,
    setupFee: data.setupFee || 0,
    probability: data.probability ?? st.find((s) => s.name === stage)?.probability ?? 0,
    expectedCloseDate: data.expectedCloseDate || '',
    nextStep: data.nextStep || '',
    lostReason: '',
    closedAt: '',
    notes: data.notes || '',
  });
  logActivity({ type: 'contact', id: contact.id }, { type: 'opportunity', outcome: `New opportunity: ${opp.name}` });
  logActivity({ type: 'opportunity', id: opp.id }, { type: 'created', outcome: `Created in ${stage}` });
  return opp;
}

export function setOpportunityStage(opp: Opportunity, stage: string, lostReason = '') {
  if (opp.stage === stage) return;
  const def = stages().find((s) => s.name === stage);
  const patch: Partial<Opportunity> = { id: opp.id, stage, probability: def?.probability ?? opp.probability };
  if (def?.closed) patch.closedAt = nowIso();
  else patch.closedAt = '';
  if (def?.closed === 'lost') patch.lostReason = lostReason || opp.lostReason;
  store.upsert('opportunities', patch);
  logActivity({ type: 'opportunity', id: opp.id }, { type: 'stage', outcome: `${opp.stage} → ${stage}` });
  if (def?.closed === 'won') {
    store.upsert('contacts', { id: opp.contactId, status: 'Active Client' });
    logActivity({ type: 'contact', id: opp.contactId }, { type: 'opportunity', outcome: `WON: ${opp.name}` });
  }
}

export function isClosed(stage: string) {
  return !!stages().find((s) => s.name === stage)?.closed;
}
