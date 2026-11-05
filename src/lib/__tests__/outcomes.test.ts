import { describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));

import { addDays } from 'date-fns';
import { followUpDate, logCall } from '../actions';
import { outcomeDef } from '../constants';
import { buildCallQueue, dayStats } from '../queue';
import { store } from '../store';

const WARM = 'Warm – Not Ready Yet';

const newLead = (id: string, extra: Record<string, unknown> = {}) =>
  store.upsert('leads', {
    id, company: `Co ${id}`, contactName: 'Pat', phone: `206555${id.padStart(4, '0').slice(-4)}`, status: 'New', attempts: 0, ...extra,
  } as any);

describe('Warm – Not Ready Yet outcome', () => {
  it('counts as a connect, marks the lead good + Nurture and schedules a high-priority follow-up', () => {
    newLead('1001');
    const followUp = followUpDate(outcomeDef(WARM)!.followUpDays!).toISOString();
    logCall({ entity: { type: 'lead', id: '1001' }, outcome: WARM, notes: 'saved my info, call after new year', durationSec: 240, phone: '2065551001', followUp, followUpTitle: `Call back (${WARM})` });

    const lead = store.get('leads', '1001')!;
    expect(lead.status).toBe('Nurture');
    expect(lead.quality).toBe('good');
    expect(lead.attempts).toBe(1);
    expect(lead.lastOutcome).toBe(WARM);
    expect(lead.nextFollowUpAt).toBe(followUp);

    const task = store.list('tasks').find((t) => t.entityId === '1001' && !t.done)!;
    expect(task.priority).toBe('High');
    expect(task.dueAt).toBe(followUp);

    const acts = store.list('activities').filter((a) => a.entityId === '1001');
    expect(acts.some((a) => a.type === 'status' && a.outcome === 'New → Nurture')).toBe(true);
    const stats = dayStats(acts);
    expect(stats.connects).toBe(1);
    expect(stats.meetings).toBe(0);
  });

  it('defaults the follow-up to about a month out', () => {
    const due = followUpDate(outcomeDef(WARM)!.followUpDays!);
    const days = (due.getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('stays out of the auto queue until the follow-up comes due, then returns as a follow-up', () => {
    newLead('1002');
    logCall({ entity: { type: 'lead', id: '1002' }, outcome: WARM, notes: '', durationSec: 60, phone: '2065551002', followUp: followUpDate(30).toISOString() });
    const queued = () => buildCallQueue(store.list('leads'), [], store.list('tasks')).find((q) => q.id === '1002');
    expect(queued()).toBeUndefined();

    const task = store.list('tasks').find((t) => t.entityId === '1002' && !t.done)!;
    store.upsert('tasks', { id: task.id, dueAt: addDays(new Date(), -1).toISOString() });
    expect(queued()?.reason).toMatch(/^Follow-up:/);
  });

  it('never moves a converted lead out of Converted', () => {
    newLead('1003', { status: 'Converted' });
    logCall({ entity: { type: 'lead', id: '1003' }, outcome: WARM, notes: '', durationSec: 30, phone: '2065551003', followUp: null });
    expect(store.get('leads', '1003')!.status).toBe('Converted');
  });
});
