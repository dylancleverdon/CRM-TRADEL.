import { describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));
const nat = vi.hoisted(() => ({ log: null as null | { duration: number } }));
vi.mock('../platform', () => ({
  isAndroid: () => true, isDesktop: () => false, openExternal: vi.fn(), httpRequest: vi.fn(),
  Native: { lastCall: vi.fn(async () => (nat.log ? { found: true, duration: nat.log.duration } : { found: false })) },
}));
vi.hoisted(() => { const m = new Map<string, string>(); (globalThis as any).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, String(v)), removeItem: (k: string) => m.delete(k) }; });
import { store } from '../store';
import { fillTalkTimes, guessTalkSec, rememberDialed } from '../talktime';

describe('talk time', () => {
  const start = '2026-11-06T18:00:00.000Z';
  it('guesses from starting the call to saving the outcome, but never hours for a window left open', () => {
    expect(guessTalkSec(start, Date.parse(start) + 4 * 60000, true)).toBe(240);
    expect(guessTalkSec(start, Date.parse(start) + 3 * 3600000, true)).toBe(0);
    expect(guessTalkSec(start, Date.parse(start) + 4 * 60000, false)).toBe(0); // no answer: no talk
  });
  it("the phone puts the real length from its call log on the Mac's call entry once both exist", async () => {
    const at = Date.parse('2026-11-06T18:10:00.000Z');
    rememberDialed('L9', '2065550100', at);
    nat.log = { duration: 187 };
    await fillTalkTimes(at + 60000); // the Mac's entry hasn't synced yet: keep trying
    store.upsert('activities', { id: 'c9', type: 'call', entityType: 'lead', entityId: 'L9', outcome: 'Call Back Later', occurredAt: new Date(at + 2000).toISOString(), durationSec: 300 } as any);
    await fillTalkTimes(at + 120000);
    expect(store.get('activities', 'c9')!.durationSec).toBe(187);
  });
});
