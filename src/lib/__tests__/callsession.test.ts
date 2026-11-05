import { describe, expect, it } from 'vitest';
import { BATCH_SIZE, freshSession, manualQueue, nextBatch, resolveSession, withBatch, type CallRec, type CallSession } from '../callsession';
import { buildCallQueue, dncPhones } from '../queue';

const T = (h: number, m = 0) => new Date(2026, 10, 5, h, m).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

const lead = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `L${String(n).padStart(2, '0')}`, company: `Biz ${n}`, contactName: '', phone: `20655501${String(n).padStart(2, '0')}`,
  status: 'New', attempts: 0, score: 100, trade: 'Roofing', origin: 'public', createdAt: '', updatedAt: '',
  lastContactedAt: '', lastOutcome: '', nextFollowUpAt: '', quality: '', disqualifyReason: '', ...extra,
}) as any;

/** Builds a session the way Call Mode does: lock in the first batch at `now`. */
function startSession(leads: any[], tasks: any[], now: number): CallSession {
  const auto = buildCallQueue(leads, [], tasks, { now });
  const s = freshSession();
  const view = resolveSession(s, [], () => undefined, new Set());
  return withBatch(s, nextBatch(auto, s, view, iso(now)));
}

const getter = (leads: any[]) => {
  const m = new Map<string, CallRec>(leads.map((l) => [l.id, l]));
  return (_t: string, id: string) => m.get(id);
};

describe('call queue follow-up timing', () => {
  it('a "Busy" call-back set for later today waits until its time instead of jumping back on top', () => {
    const busy = lead(1, { status: 'Attempting', attempts: 1, lastContactedAt: iso(T(9)), lastOutcome: 'Busy', nextFollowUpAt: iso(T(11)) });
    const tasks = [{ id: 't1', entityId: busy.id, entityType: 'lead', title: 'Call back (Busy)', dueAt: iso(T(11)), done: false, priority: 'Normal' }];
    const others = [lead(2), lead(3)];
    expect(buildCallQueue([busy, ...others], [], tasks as any, { now: T(9, 5) }).map((q) => q.id)).toEqual(['L02', 'L03']);
    const at11 = buildCallQueue([busy, ...others], [], tasks as any, { now: T(11, 1) });
    expect(at11[0].id).toBe('L01');
    expect(at11[0].reason).toMatch(/^Follow-up/);
  });

  it("doesn't call a lead early when its follow-up is later today", () => {
    const later = lead(4, { status: 'Attempting', attempts: 2, lastContactedAt: iso(T(9) - 86400000), nextFollowUpAt: iso(T(15)) });
    const tasks = [{ id: 't2', entityId: later.id, entityType: 'lead', title: 'Call back', dueAt: iso(T(15)), done: false, priority: 'Normal' }];
    expect(buildCallQueue([later], [], tasks as any, { now: T(10) })).toHaveLength(0);
    expect(buildCallQueue([later], [], tasks as any, { now: T(15, 1) })[0].id).toBe('L04');
  });
});

describe('locked call session', () => {
  it('locks in the next 10 and keeps that order while the data underneath changes', () => {
    const leads = Array.from({ length: 14 }, (_, i) => lead(i + 1));
    const s = startSession(leads, [], T(9));
    expect(s.items).toHaveLength(BATCH_SIZE);
    const order = resolveSession(s, [], getter(leads), new Set()).locked.map((x) => x.id);

    // What used to reshuffle the queue: a lead gets touched (createdAt set), a new higher-scoring lead appears,
    // and another lead's score changes.
    leads[5] = { ...leads[5], createdAt: iso(T(9, 30)), notes: 'touched' };
    leads[7] = { ...leads[7], score: 40 };
    leads.push(lead(99, { score: 100, licenseStart: '2026-11-01' }));
    const after = resolveSession({ ...s, currentId: '' }, [], getter(leads), new Set());
    expect([after.current!.id, ...after.locked.map((x) => x.id)]).toEqual([s.items[0].id, ...order]);
  });

  it('puts your queued leads next without replacing the call on screen', () => {
    const leads = Array.from({ length: 12 }, (_, i) => lead(i + 1));
    let s = startSession(leads, [], T(9));
    let view = resolveSession(s, [], getter(leads), new Set());
    s = { ...s, currentId: view.current!.id };
    const onScreen = view.current!.id;

    const mine = lead(50, { queuedAt: iso(T(9, 10)) });
    const all = [...leads, mine];
    view = resolveSession(s, manualQueue(all, []), getter(all), new Set());
    expect(view.current!.id).toBe(onScreen);
    expect(view.manual.map((x) => x.id)).toEqual(['L50']);

    // Log a call on the current one: the queued lead is next, ahead of the locked batch.
    const called = all.map((l) => (l.id === onScreen ? { ...l, lastContactedAt: iso(T(9, 12)) } : l));
    view = resolveSession({ ...s, currentId: '' }, manualQueue(called, []), getter(called), new Set());
    expect(view.current!.id).toBe('L50');
    expect(view.current!.manual).toBe(true);
    expect(view.lockedLeft).toBe(BATCH_SIZE - 1);
  });

  it('takes off a business marked Do Not Call elsewhere and says why; skips stay skipped', () => {
    const leads = Array.from({ length: 10 }, (_, i) => lead(i + 1));
    let s = startSession(leads, [], T(9));
    const dncLeads = leads.map((l) => (l.id === 'L03' ? { ...l, lastOutcome: 'Do Not Call', status: 'Disqualified' } : l));
    s = { ...s, skipped: ['L02'] };
    const view = resolveSession(s, [], getter(dncLeads), dncPhones(dncLeads));
    const shown = [view.current!.id, ...view.locked.map((x) => x.id)];
    expect(shown).not.toContain('L02');
    expect(shown).not.toContain('L03');
    expect(view.removed).toEqual([{ id: 'L03', company: 'Biz 3', reason: 'Do Not Call' }]);
  });

  it('locks in the next batch only from businesses not already shown, skipped or taken off', () => {
    const leads = Array.from({ length: 25 }, (_, i) => lead(i + 1));
    let s = startSession(leads, [], T(9));
    const first = s.items.map((i) => i.id);
    // Call all 10.
    const called = leads.map((l) => (first.includes(l.id) ? { ...l, lastContactedAt: iso(T(10)), attempts: 1, status: 'Attempting' } : l));
    s = { ...s, skipped: ['L11'] };
    const view = resolveSession(s, [], getter(called), new Set());
    expect(view.lockedLeft).toBe(0);
    const auto = buildCallQueue(called, [], [], { now: T(10, 5) });
    const batch = nextBatch(auto, s, view, iso(T(10, 5)));
    expect(batch).toHaveLength(BATCH_SIZE);
    expect(batch.map((b) => b.id)).not.toContain('L11');
    expect(batch.some((b) => first.includes(b.id))).toBe(false);
  });
});
