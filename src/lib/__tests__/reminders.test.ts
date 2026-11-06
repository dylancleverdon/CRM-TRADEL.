import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));
const env = vi.hoisted(() => ({ android: true }));
const ln = vi.hoisted(() => ({
  scheduled: new Map<number, any>(),
  display: 'granted' as string,
  schedule: vi.fn(async ({ notifications }: any) => { for (const n of notifications) ln.scheduled.set(n.id, n); }),
  cancel: vi.fn(async ({ notifications }: any) => { for (const n of notifications) ln.scheduled.delete(n.id); }),
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    schedule: ln.schedule, cancel: ln.cancel,
    checkPermissions: async () => ({ display: ln.display }),
    requestPermissions: async () => ({ display: ln.display }),
    checkExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
    changeExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
    addListener: async () => ({ remove: () => {} }), createChannel: async () => {},
  },
}));
vi.mock('../platform', () => ({ isAndroid: () => env.android, isDesktop: () => false, Native: {}, openExternal: vi.fn(), httpRequest: vi.fn() }));
vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, String(v)), removeItem: (k: string) => m.delete(k), clear: () => m.clear() };
});

import { diffReminders, notifId, planReminders, routeFor, setReminders, syncReminders } from '../reminders';
import { store } from '../store';
import type { Task } from '../types';

const NOW = Date.parse('2026-11-06T18:00:00.000Z');
const task = (id: string, dueAt: string, extra: Partial<Task> = {}): Task => ({
  id, entityType: 'lead', entityId: `L-${id}`, entityName: 'American First Air', title: 'Call back (No Answer)', dueAt, priority: 'Normal',
  done: false, doneAt: '', notes: '', updatedAt: '', ...extra,
} as Task);

describe('follow-up reminders', () => {
  beforeEach(() => { localStorage.clear(); ln.scheduled.clear(); ln.schedule.mockClear(); ln.cancel.mockClear(); ln.display = 'granted'; env.android = true; });

  it('plans one for each open follow-up still to come, soonest first, and none for past or done ones', () => {
    const plan = planReminders([
      task('b', '2026-11-08T17:00:00.000Z'), task('a', '2026-11-07T17:00:00.000Z'), task('past', '2026-11-06T17:00:00.000Z'),
      task('done', '2026-11-07T18:00:00.000Z', { done: true }), task('far', '2027-01-30T18:00:00.000Z'), task('gone', '2026-11-07T19:00:00.000Z', { deleted: true }),
    ], NOW);
    expect(plan.map((p) => p.taskId)).toEqual(['a', 'b']);
    expect(plan[0]).toMatchObject({ id: notifId('a'), at: '2026-11-07T17:00:00.000Z', title: 'Follow-up: American First Air', body: 'Call back (No Answer). Tap to open.', route: '/leads/L-a' });
  });

  it('tapping one opens the lead, the contact, or the deal', () => {
    expect(routeFor({ entityType: 'lead', entityId: 'L1' })).toBe('/leads/L1');
    expect(routeFor({ entityType: 'contact', entityId: 'C1' })).toBe('/contacts/C1');
    expect(routeFor({ entityType: 'opportunity', entityId: 'O1' }, () => 'C9')).toBe('/contacts/C9?opp=O1');
    expect(routeFor({ entityType: '', entityId: '' })).toBe('/tasks');
  });

  it('only reschedules what changed: a moved follow-up is replaced, a finished one is cancelled', () => {
    const before = planReminders([task('a', '2026-11-07T17:00:00.000Z'), task('b', '2026-11-08T17:00:00.000Z')], NOW);
    const prev = Object.fromEntries(before.map((p) => [p.taskId, { n: p.id, at: p.at, title: p.title, body: p.body }]));
    const after = planReminders([task('a', '2026-11-07T20:00:00.000Z'), task('c', '2026-11-09T17:00:00.000Z')], NOW);
    const d = diffReminders(prev, after);
    expect(d.cancel.sort()).toEqual([notifId('a'), notifId('b')].sort());
    expect(d.schedule.map((p) => p.taskId)).toEqual(['a', 'c']);
    expect(diffReminders(Object.fromEntries(after.map((p) => [p.taskId, { n: p.id, at: p.at, title: p.title, body: p.body }])), after)).toEqual({ cancel: [], schedule: [] });
  });

  it('is off until you turn it on; then it schedules on the phone, and off cancels them all', async () => {
    vi.useFakeTimers({ now: NOW });
    store.upsert('tasks', task('t1', '2026-11-07T17:00:00.000Z'));
    store.upsert('tasks', task('t2', '2026-11-07T19:00:00.000Z', { entityType: 'contact', entityId: 'C7' }));
    await syncReminders();
    expect(ln.schedule).not.toHaveBeenCalled();
    await setReminders(true);
    expect([...ln.scheduled.values()].map((n) => [n.title, n.extra.route, n.schedule.allowWhileIdle])).toEqual([
      ['Follow-up: American First Air', '/leads/L-t1', true], ['Follow-up: American First Air', '/contacts/C7', true],
    ]);
    store.upsert('tasks', { id: 't1', done: true } as any);
    await syncReminders();
    expect([...ln.scheduled.keys()]).toEqual([notifId('t2')]);
    await setReminders(false);
    expect(ln.scheduled.size).toBe(0);
    vi.useRealTimers();
  });

  it("says what to do when notifications aren't allowed, and stays off", async () => {
    ln.display = 'denied';
    await expect(setReminders(true)).rejects.toThrow(/Android Settings → Apps → TradeLink CRM → Notifications/);
    expect(localStorage.getItem('tl.reminders')).toBeNull();
  });

  it('does nothing on the Mac', async () => {
    env.android = false;
    localStorage.setItem('tl.reminders', 'on');
    expect(await syncReminders()).toBe(0);
    expect(ln.schedule).not.toHaveBeenCalled();
  });
});
