import { describe, expect, it } from 'vitest';
import { nextBatch, freshSession, resolveSession } from '../callsession';
import { bestTimes, breakdown, buildModel, funnel, pickupGrid, rankQueue, traitsOf, topTraits } from '../engine';
import type { QueueItem } from '../queue';
import type { Activity, Contact, Lead, Opportunity } from '../types';

const NOW = Date.parse('2026-11-06T18:00:00.000Z');
let seq = 0;
const lead = (id: string, trade: string, city: string, extra: Partial<Lead> = {}): Lead => ({
  id, company: `${trade} Co ${id}`, contactName: 'Owner', phone: `206555${String(++seq).padStart(4, '0')}`, trade, city, state: 'WA',
  status: 'New', attempts: 0, origin: 'public', sources: 'li', score: 70, updatedAt: '', ...extra,
} as Lead);
const call = (entityId: string, outcome: string, at: string, i = 0): Activity => ({
  id: `c-${entityId}-${i}-${outcome}`, entityType: 'lead', entityId, entityName: '', type: 'call', outcome, notes: '', durationSec: 60,
  phone: '', occurredAt: at, updatedAt: at,
} as Activity);
const item = (l: Lead, reason = 'New lead', priority = 1): QueueItem => ({ type: 'lead', id: l.id, company: l.company, phone: l.phone, reason, priority });

/** n calls on fresh leads of a trade/city, `connects` of them connected and `meetings` of those booked. */
function history(trade: string, city: string, n: number, connects: number, meetings: number, leads: Map<string, Lead>, acts: Activity[]) {
  for (let i = 0; i < n; i++) {
    const l = lead(`h-${trade}-${city}-${i}`, trade, city, { status: 'Attempting', attempts: 1 });
    leads.set(l.id, l);
    const outcome = i < meetings ? 'Meeting Booked' : i < connects ? 'Not Interested' : 'No Answer';
    acts.push(call(l.id, outcome, new Date(NOW - 86400000 * 3 + i * 60000).toISOString(), i));
  }
}

describe('lead engine', () => {
  it('with no history it keeps your current order, but spends 2 of every 10 spots exploring other trades and cities', () => {
    const leads = [
      ...Array.from({ length: 12 }, (_, i) => lead(`a${i}`, 'HVAC', 'Kent')),
      lead('e1', 'Electrical', 'Everett'), lead('r1', 'Roofing', 'Tacoma'), lead('p1', 'Plumbing', 'Bellevue'),
    ];
    const map = new Map(leads.map((l) => [l.id, l]));
    const model = buildModel({ activities: [], getLead: (id) => map.get(id) });
    const ranked = rankQueue(leads.map((l, i) => item(l, `score ${90 - i}`, 1 + i / 100)), model, (id) => map.get(id), { now: NOW });
    const first10 = ranked.slice(0, 10);
    expect(first10.filter((r) => r.pick === 'experiment')).toHaveLength(2);
    expect(first10.filter((r) => r.pick === 'proven').map((r) => r.id)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']);
    const exp = first10.filter((r) => r.pick === 'experiment');
    expect(new Set(exp.map((r) => map.get(r.id)!.trade)).size).toBe(2); // two different kinds of business
    expect(exp.every((r) => map.get(r.id)!.trade !== 'HVAC')).toBe(true);
    expect(exp[0].reason).toMatch(/^Experiment · (Electrical in Everett|Roofing in Tacoma|Plumbing in Bellevue): not called yet$/);
    expect(first10.find((r) => r.pick === 'proven')!.reason).toBe('score 90'); // nothing proven yet: your reason stays
  });

  it('early on it learns from who picks up: trades that connect more move up', () => {
    const leads = new Map<string, Lead>();
    const acts: Activity[] = [];
    history('HVAC', 'Kent', 40, 16, 0, leads, acts); // 40% pick up
    history('Roofing', 'Kent', 40, 2, 0, leads, acts); // 5%
    const fresh = [lead('roof', 'Roofing', 'Kent'), lead('hvac', 'HVAC', 'Kent')];
    fresh.forEach((l) => leads.set(l.id, l));
    const model = buildModel({ activities: acts, getLead: (id) => leads.get(id) });
    const ranked = rankQueue(fresh.map((l) => item(l)), model, (id) => leads.get(id), { now: NOW, experiments: 0 });
    expect(ranked.map((r) => r.id)).toEqual(['hvac', 'roof']);
    expect(ranked[0].reason).toBe('Proven · HVAC: 16 connects / 40 dials');
  });

  it('once meetings come in, they take over from connects', () => {
    const leads = new Map<string, Lead>();
    const acts: Activity[] = [];
    history('HVAC', 'Kent', 50, 15, 0, leads, acts); // picks up, never books
    history('Electrical', 'Kent', 50, 12, 5, leads, acts); // picks up a bit less, books meetings
    const fresh = [lead('hvac', 'HVAC', 'Kent'), lead('elec', 'Electrical', 'Kent')];
    fresh.forEach((l) => leads.set(l.id, l));
    const model = buildModel({ activities: acts, getLead: (id) => leads.get(id) });
    const ranked = rankQueue(fresh.map((l) => item(l)), model, (id) => leads.get(id), { now: NOW, experiments: 0 });
    expect(ranked[0].id).toBe('elec');
    expect(ranked[0].reason).toBe('Proven · Electrical: 5 meetings / 50 dials');
    expect(topTraits(model)[0]).toMatchObject({ t: 'trade', v: 'Electrical' });
  });

  it('can optimize for pipeline value instead, using the deals that came from each lead', () => {
    const leads = new Map<string, Lead>();
    const acts: Activity[] = [];
    history('HVAC', 'Kent', 30, 10, 3, leads, acts);
    history('Plumbing', 'Kent', 30, 10, 3, leads, acts);
    const contacts: Contact[] = [];
    const opps: Opportunity[] = [];
    for (const [i, l] of [...leads.values()].filter((x) => x.id.includes('-0') || x.id.includes('-1') || x.id.includes('-2')).entries()) {
      if (!acts.some((a) => a.entityId === l.id && a.outcome === 'Meeting Booked')) continue;
      contacts.push({ id: `ct${i}`, leadId: l.id } as Contact);
      opps.push({ id: `o${i}`, contactId: `ct${i}`, monthlyValue: l.trade === 'Plumbing' ? 2000 : 300, setupFee: 0, stage: 'Discovery Booked' } as Opportunity);
    }
    const fresh = [lead('hvac', 'HVAC', 'Kent'), lead('plumb', 'Plumbing', 'Kent')];
    fresh.forEach((l) => leads.set(l.id, l));
    const base = { activities: acts, getLead: (id: string) => leads.get(id), contacts, opportunities: opps };
    const meetings = rankQueue(fresh.map((l) => item(l)), buildModel(base), (id) => leads.get(id), { now: NOW, experiments: 0 });
    expect(meetings.map((r) => r.id)).toEqual(['hvac', 'plumb']); // equal on meetings: your order
    const pipeline = rankQueue(fresh.map((l) => item(l)), buildModel({ ...base, goal: 'pipeline' }), (id) => leads.get(id), { now: NOW, experiments: 0 });
    expect(pipeline[0].id).toBe('plumb');
    expect(pipeline[0].reason).toMatch(/^Proven · Plumbing: \$72,000 pipeline \/ 30 dials$/);
  });

  it('follow-ups stay first and untouched; nothing is ever dropped', () => {
    const leads = [lead('x1', 'HVAC', 'Kent'), lead('x2', 'Roofing', 'Kent'), lead('x3', 'HVAC', 'Kent')];
    const map = new Map(leads.map((l) => [l.id, l]));
    const fu: QueueItem = { ...item(leads[1], 'Follow-up: Call back', 0), task: { id: 't1' } as any };
    const contactFu: QueueItem = { type: 'contact', id: 'ct1', company: 'Client', phone: '1', reason: 'Follow-up: Discovery call', priority: -1, task: { id: 't2' } as any };
    const ranked = rankQueue([contactFu, fu, item(leads[0]), item(leads[2])], buildModel({ activities: [], getLead: (id) => map.get(id) }), (id) => map.get(id), { now: NOW });
    expect(ranked.slice(0, 2).map((r) => [r.id, r.pick, r.reason])).toEqual([['ct1', 'followup', 'Follow-up: Discovery call'], ['x2', 'followup', 'Follow-up: Call back']]);
    expect(ranked.map((r) => r.id).sort()).toEqual(['ct1', 'x1', 'x2', 'x3']);
  });

  it("each locked batch of 10 is 8 proven picks and 2 experiments, and the call's pick goes with it", () => {
    const leads = Array.from({ length: 30 }, (_, i) => lead(`b${i}`, ['HVAC', 'Roofing', 'Plumbing', 'Electrical', 'Painting'][i % 5], ['Kent', 'Tacoma', 'Everett'][i % 3]));
    const map = new Map(leads.map((l) => [l.id, l]));
    const ranked = rankQueue(leads.map((l, i) => item(l, 'New lead', 1 + i / 100)), buildModel({ activities: [], getLead: (id) => map.get(id) }), (id) => map.get(id), { now: NOW });
    const s = freshSession();
    const view = resolveSession(s, [], (_t, id) => map.get(id) as any, new Set());
    const batch = nextBatch(ranked, s, view);
    expect(batch).toHaveLength(10);
    expect(batch.filter((b) => b.pick === 'experiment')).toHaveLength(2);
    const v2 = resolveSession({ ...s, items: batch }, [], (_t, id) => map.get(id) as any, new Set());
    expect(v2.current?.pick).toBe('proven');
    expect([...v2.locked.map((x) => x.pick)].filter((p) => p === 'experiment')).toHaveLength(2);
  });

  it('describes a lead by what it learns from', () => {
    const tr = traitsOf(lead('t', 'HVAC', 'kent', { licenseStart: '2026-09-01', ownership: 'Limited Liability Company', sources: 'li,seattle', yelpStatus: 'Not listed', score: 85 }), NOW, 2);
    expect(tr).toEqual({
      trade: 'HVAC', area: 'Kent', age: 'Licensed < 3 mo', type: 'LLC', owner: 'Owner name known', lists: 'On 2 lists',
      yelp: 'Yelp: Not listed', google: 'Google: Not checked', score: 'Score 80+', attempt: '2nd call',
    });
  });
});

describe('when owners pick up, and the scorecard', () => {
  const at = (day: number, hour: number) => { const d = new Date(2026, 10, 1 + day, hour, 15); return d.toISOString(); }; // Nov 1 2026 is a Sunday
  it('finds the hours owners pick up most, once there are enough calls', () => {
    const acts: Activity[] = [];
    let i = 0;
    for (let k = 0; k < 20; k++) acts.push(call('L', k < 10 ? 'Call Back Later' : 'No Answer', at(2, 9), i++)); // Tue 9 AM: 50%
    for (let k = 0; k < 50; k++) acts.push(call('L', k < 5 ? 'Not Interested' : 'No Answer', at(4, 15), i++)); // Thu 3 PM: 10%
    const grid = pickupGrid(acts);
    expect(grid.get('2:9')).toMatchObject({ dials: 20, connects: 10 });
    const bt = bestTimes(grid);
    expect(bt.best.map((s) => [s.day, s.hour])).toEqual([[2, 9]]);
    expect(bestTimes(pickupGrid(acts.slice(0, 30))).best).toEqual([]); // not enough calls yet
  });

  it('counts dials → connects → meetings, and breaks them down', () => {
    const acts = [call('a', 'No Answer', '2026-11-05T17:00:00Z', 1), call('a', 'Meeting Booked', '2026-11-06T17:00:00Z', 2),
      { ...call('b', 'Call Back Later', '2026-11-06T18:00:00Z', 3), pick: 'experiment' } as Activity];
    expect(funnel(acts, '2026-11-06T00:00:00Z')).toEqual({ dials: 2, connects: 2, meetings: 1 });
    expect(breakdown(acts, '', (a) => a.pick || 'Before tracking').map((r) => [r.key, r.f.dials])).toEqual([['Before tracking', 2], ['experiment', 1]]);
  });
});
