/**
 * Lead engine: learns which kinds of businesses turn dials into booked meetings (or, if you switch the goal in
 * Settings, pipeline value or closed deals) and ranks Call Mode's queue by it. A small share of each batch goes to
 * experiments: businesses whose traits it knows least about.
 *
 * How it learns: every call logged on a lead counts toward each of that lead's traits (trade, city, business age,
 * business type, owner name, public lists, Yelp, Google, score, attempt). A trait value's estimate is
 * connect rate × meetings per connect, each shrunk toward the overall average until it has data. So early on, when
 * meetings are rare, it effectively learns from connects; meetings take over as they accumulate. Your daily goals
 * (calls → connects → meetings) are the starting averages.
 *
 * Rules: due follow-ups stay first and untouched, My queue still comes before everything, and nothing is ever
 * excluded: the engine only changes the order.
 */
import { outcomeDef } from './constants';
import { titleCase } from './leadmap';
import type { QueueItem } from './queue';
import type { Activity, Contact, Lead, Opportunity } from './types';

export type EngineGoal = 'meetings' | 'pipeline' | 'closes';
export const GOAL_LABEL: Record<EngineGoal, string> = { meetings: 'Booked meetings', pipeline: 'Pipeline value', closes: 'Closed deals' };

/** What a logged call was: picked by the engine (proven or experiment), from My queue, or a due follow-up. */
export type CallPick = 'proven' | 'experiment' | 'queue' | 'followup';
export const PICK_LABEL: Record<string, string> = { proven: 'Proven', experiment: 'Experiment', queue: 'My queue', followup: 'Follow-up' };

export interface EngineSettings { goal: EngineGoal; experiments: number }
export const DEFAULT_ENGINE: EngineSettings = { goal: 'meetings', experiments: 2 };

export type TraitName = 'trade' | 'area' | 'age' | 'type' | 'owner' | 'lists' | 'yelp' | 'google' | 'score' | 'attempt';
export const TRAITS: TraitName[] = ['trade', 'area', 'age', 'type', 'owner', 'lists', 'yelp', 'google', 'score', 'attempt'];
export const TRAIT_LABEL: Record<TraitName, string> = {
  trade: 'Trade', area: 'City', age: 'Business age', type: 'Business type', owner: 'Owner name', lists: 'Public lists',
  yelp: 'Yelp', google: 'Google', score: 'Score', attempt: 'Attempt',
};
/** The traits experiments explore: what kind of business and where. */
const EXPLORE: TraitName[] = ['trade', 'area', 'age', 'type'];

export interface Tally { dials: number; connects: number; meetings: number; value: number; closes: number }
const zero = (): Tally => ({ dials: 0, connects: 0, meetings: 0, value: 0, closes: 0 });
const add = (t: Tally, x: Tally) => { t.dials += x.dials; t.connects += x.connects; t.meetings += x.meetings; t.value += x.value; t.closes += x.closes; };

// How many dials / connects / meetings a trait value needs before its own numbers outweigh the average.
const K_DIALS = 20;
const K_CONNECTS = 8;
const K_MEETINGS = 5;
/** Meetings per connect is judged as meetings vs the meetings expected from its connects, with this many meetings'
 * worth of benefit of the doubt: with few meetings anywhere, every trait looks about average there, so pickups decide. */
const K_EXPECTED = 3;
/** Correlated traits (a new business is often also a sole owner) shouldn't multiply up: each counts half. */
const DAMP = 0.5;
/** A trait is "proven" once it has this many dials. */
export const PROVEN_DIALS = 10;

// ---------------------------------------------------------------- traits

type Rec = Partial<Lead>;

export function ageBucket(licenseStart: string | undefined, at: number): string {
  const t = licenseStart ? Date.parse(licenseStart) : NaN;
  if (isNaN(t)) return 'Age unknown';
  const days = (at - t) / 86400000;
  if (days < 90) return 'Licensed < 3 mo';
  if (days < 365) return 'Licensed 3–12 mo';
  if (days < 3 * 365) return 'Licensed 1–3 yr';
  return 'Licensed 3+ yr';
}

export function typeBucket(ownership = ''): string {
  const o = ownership.toLowerCase();
  if (!o.trim()) return 'Type unknown';
  if (/individual|sole/.test(o)) return 'Sole owner';
  if (/limited liability|\bllc\b/.test(o)) return 'LLC';
  if (/partnership/.test(o)) return 'Partnership';
  if (/corporation|\binc\b/.test(o)) return 'Corporation';
  return 'Other type';
}

const listsBucket = (r: Rec) => {
  if (r.origin !== 'public') return 'Added by you';
  const n = (r.sources || '').split(',').filter(Boolean).length;
  return n >= 3 ? 'On 3+ lists' : n === 2 ? 'On 2 lists' : 'On 1 list';
};
const presence = (site: string, s?: string) => `${site}: ${s || 'Not checked'}`;
export const scoreBucket = (s?: number) => (s == null || isNaN(s) ? 'No score' : s >= 80 ? 'Score 80+' : s >= 60 ? 'Score 60–79' : s >= 40 ? 'Score 40–59' : 'Score < 40');
const attemptBucket = (n: number) => (n <= 1 ? '1st call' : n === 2 ? '2nd call' : n === 3 ? '3rd call' : '4th+ call');

/** A lead's traits for a call made at `at` that is its `attempt`-th call. */
export function traitsOf(r: Rec, at: number, attempt: number): Record<TraitName, string> {
  return {
    trade: r.trade || 'Trade unknown',
    area: titleCase((r.city || '').trim()) || 'City unknown',
    age: ageBucket(r.licenseStart, at),
    type: typeBucket(r.ownership),
    owner: r.contactName ? 'Owner name known' : 'No owner name',
    lists: listsBucket(r),
    yelp: presence('Yelp', r.yelpStatus),
    google: presence('Google', r.googleStatus),
    score: scoreBucket(r.score),
    attempt: attemptBucket(attempt),
  };
}

const comboKey = (tr: Record<TraitName, string>) => `${tr.trade}|${tr.area}`;

// ---------------------------------------------------------------- the model

export interface EngineModel {
  goal: EngineGoal;
  total: Tally;
  by: Record<TraitName, Map<string, Tally>>;
  /** Dials per trade + city. */
  combos: Map<string, number>;
  /** Goal per dial for one trait value, shrunk toward the average. */
  est: (t: TraitName, v: string) => number;
  /** The average goal per dial. */
  overall: number;
  /** Connect rate and meetings per connect, overall (shrunk toward your goals). */
  connectRate: number;
  meetingsPerConnect: number;
}

export interface ModelInput {
  activities: Activity[];
  getLead: (id: string) => Rec | undefined;
  contacts?: Contact[];
  opportunities?: Opportunity[];
  wonStages?: string[];
  goal?: EngineGoal;
  /** Your daily goals: the averages it starts from. */
  goals?: { calls: number; connects: number; meetings: number };
}

const isConnect = (outcome: string) => !!outcomeDef(outcome)?.connected;
const oppValue = (o: Opportunity) => (Number(o.monthlyValue) || 0) * 12 + (Number(o.setupFee) || 0);

/** Calls logged on leads, oldest first. */
export function leadCalls(activities: Activity[]): Activity[] {
  return activities.filter((a) => a.type === 'call' && !a.deleted && a.entityType === 'lead')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}

export function buildModel(input: ModelInput): EngineModel {
  const goal = input.goal || 'meetings';
  const g = input.goals || { calls: 60, connects: 12, meetings: 2 };
  const by = Object.fromEntries(TRAITS.map((t) => [t, new Map<string, Tally>()])) as Record<TraitName, Map<string, Tally>>;
  const combos = new Map<string, number>();
  const total = zero();

  // Pipeline value and closed deals, credited to the call that booked the meeting.
  const leadValue = new Map<string, { value: number; closes: number }>();
  if (input.opportunities?.length && input.contacts?.length) {
    const won = new Set(input.wonStages || ['Closed Won']);
    const leadOf = new Map(input.contacts.filter((c) => c.leadId).map((c) => [c.id, c.leadId]));
    for (const o of input.opportunities) {
      if (o.deleted) continue;
      const lid = leadOf.get(o.contactId);
      if (!lid) continue;
      const v = leadValue.get(lid) || { value: 0, closes: 0 };
      v.value += oppValue(o);
      if (won.has(o.stage)) v.closes += 1;
      leadValue.set(lid, v);
    }
  }
  const calls = leadCalls(input.activities);
  const meetingCall = new Map<string, string>();
  for (const a of calls) if (a.outcome === 'Meeting Booked') meetingCall.set(a.entityId, a.id); // the last one

  const attempts = new Map<string, number>();
  for (const a of calls) {
    const n = (attempts.get(a.entityId) || 0) + 1;
    attempts.set(a.entityId, n);
    const tr = traitsOf(input.getLead(a.entityId) || {}, Date.parse(a.occurredAt) || Date.now(), n);
    const credit = meetingCall.get(a.entityId) === a.id ? leadValue.get(a.entityId) : undefined;
    const x: Tally = {
      dials: 1, connects: isConnect(a.outcome) ? 1 : 0, meetings: a.outcome === 'Meeting Booked' ? 1 : 0,
      value: credit?.value || 0, closes: credit?.closes || 0,
    };
    add(total, x);
    for (const t of TRAITS) {
      const m = by[t];
      const cur = m.get(tr[t]) || zero();
      add(cur, x);
      m.set(tr[t], cur);
    }
    combos.set(comboKey(tr), (combos.get(comboKey(tr)) || 0) + 1);
  }

  const cr0 = g.calls > 0 ? g.connects / g.calls : 0.2;
  const mpc0 = g.connects > 0 ? g.meetings / g.connects : 0.15;
  const CR = (total.connects + K_DIALS * cr0) / (total.dials + K_DIALS);
  const MPC = (total.meetings + K_CONNECTS * mpc0) / (total.connects + K_CONNECTS);
  const VPM = total.meetings > 0 && total.value > 0 ? total.value / total.meetings : 1;
  const CPM = (total.closes + K_MEETINGS * 0.25) / (total.meetings + K_MEETINGS);
  const tail = (s: Tally) => (goal === 'pipeline' ? (s.value + K_MEETINGS * VPM) / (s.meetings + K_MEETINGS)
    : goal === 'closes' ? (s.closes + K_MEETINGS * CPM) / (s.meetings + K_MEETINGS) : 1);
  const estOf = (s: Tally) => {
    const cr = (s.connects + K_DIALS * CR) / (s.dials + K_DIALS);
    const mpc = (MPC * (s.meetings + K_EXPECTED)) / (s.connects * MPC + K_EXPECTED);
    return cr * mpc * tail(s);
  };
  // Measured the same way as each trait, so a trait every call shares is exactly average.
  const overall = estOf(total);
  const est = (t: TraitName, v: string) => {
    const s = by[t].get(v);
    return s ? estOf(s) : overall;
  };
  return { goal, total, by, combos, est, overall, connectRate: CR, meetingsPerConnect: MPC };
}

/** The engine's estimate for a lead: the average, moved by each trait's lift (damped). */
export function leadValueEstimate(model: EngineModel, tr: Record<TraitName, string>): number {
  if (model.overall <= 0) return 0;
  let log = 0;
  for (const t of TRAITS) log += Math.log(Math.max(model.est(t, tr[t]), 1e-9) / model.overall);
  return model.overall * Math.exp(DAMP * log);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** "Proven · HVAC, Licensed < 3 mo: 4 meetings / 50 dials", or '' if no trait is proven yet. */
export function provenWhy(model: EngineModel, tr: Record<TraitName, string>): string {
  const good = TRAITS.map((t) => ({ t, v: tr[t], s: model.by[t].get(tr[t]), lift: model.est(t, tr[t]) / (model.overall || 1) }))
    .filter((x) => x.s && x.s.dials >= PROVEN_DIALS && x.lift > 1.05)
    .sort((a, b) => b.lift - a.lift);
  if (!good.length) return '';
  const top = good[0].s!;
  const stat = model.goal === 'pipeline' && top.value > 0 ? `$${Math.round(top.value).toLocaleString()} pipeline / ${plural(top.dials, 'dial')}`
    : model.goal === 'closes' && top.closes > 0 ? `${plural(top.closes, 'deal')} / ${plural(top.dials, 'dial')}`
      : top.meetings > 0 ? `${plural(top.meetings, 'meeting')} / ${plural(top.dials, 'dial')}`
        : `${plural(top.connects, 'connect')} / ${plural(top.dials, 'dial')}`;
  return `Proven · ${good.slice(0, 2).map((x) => x.v).join(', ')}: ${stat}`;
}

export function experimentWhy(tr: Record<TraitName, string>, combos: Map<string, number>): string {
  const n = combos.get(comboKey(tr)) || 0;
  const what = tr.area === 'City unknown' ? tr.trade : `${tr.trade} in ${tr.area}`;
  return `Experiment · ${what}: ${n ? `${plural(n, 'dial')} so far` : 'not called yet'}`;
}

export interface RankedItem extends QueueItem { pick: CallPick; value?: number }

/**
 * Call Mode's order: due follow-ups first (untouched), then the engine's picks, with `experiments` of every 10
 * spots going to businesses it knows least about (spread over different trades and cities). Only the first
 * `head` spots are interleaved; the rest follow in the engine's order.
 */
export function rankQueue(items: QueueItem[], model: EngineModel, getLead: (id: string) => Rec | undefined,
  opts: { experiments?: number; now?: number; head?: number } = {}): RankedItem[] {
  const now = opts.now ?? Date.now();
  const share = Math.max(0, Math.min(10, opts.experiments ?? DEFAULT_ENGINE.experiments)) / 10;
  const head = opts.head ?? 200;
  const followUps: RankedItem[] = [];
  const rest: { item: QueueItem; tr: Record<TraitName, string>; value: number; i: number }[] = [];
  items.forEach((item, i) => {
    if (item.task || item.type !== 'lead') { followUps.push({ ...item, pick: 'followup' }); return; }
    const rec = getLead(item.id) || {};
    const tr = traitsOf(rec, now, (rec.attempts || 0) + 1);
    rest.push({ item, tr, value: leadValueEstimate(model, tr), i });
  });
  const byValue = [...rest].sort((a, b) => b.value - a.value || a.i - b.i);
  const used = new Set<string>();
  const combos = new Map(model.combos);
  const out: RankedItem[] = [...followUps];
  // Experiments: grouped by trade + city, so each pick looks at a few hundred groups instead of every business.
  type R = (typeof rest)[number];
  const groups = new Map<string, { list: (R & { extra: number })[]; at: number }>();
  if (share > 0) {
    for (const r of rest) {
      let traits = 0;
      for (const t of EXPLORE) traits += 1 / Math.sqrt(1 + (model.by[t].get(r.tr[t])?.dials || 0));
      const k = comboKey(r.tr);
      const g = groups.get(k) || { list: [], at: 0 };
      g.list.push({ ...r, extra: (0.5 * traits) / EXPLORE.length });
      groups.set(k, g);
    }
    for (const g of groups.values()) g.list.sort((a, b) => b.extra - a.extra || b.value - a.value || a.i - b.i);
  }
  const pickExperiment = (): R | null => {
    let best: (R & { extra: number }) | null = null;
    let bestU = -1;
    for (const [k, g] of groups) {
      while (g.at < g.list.length && used.has(g.list[g.at].item.id)) g.at++;
      const r = g.list[g.at];
      if (!r) continue;
      const u = 1 / Math.sqrt(1 + (combos.get(k) || 0)) + r.extra;
      if (u > bestU + 1e-12 || (best && Math.abs(u - bestU) <= 1e-12 && (r.value > best.value || (r.value === best.value && r.i < best.i)))) { best = r; bestU = u; }
    }
    return best;
  };
  let p = 0;
  let acc = 0;
  for (let slot = 0; slot < Math.min(head, rest.length); slot++) {
    acc += share;
    if (acc >= 1 - 1e-9) {
      acc -= 1;
      const best = pickExperiment();
      if (best) {
        used.add(best.item.id);
        out.push({ ...best.item, pick: 'experiment', reason: experimentWhy(best.tr, combos), value: best.value });
        const k = comboKey(best.tr);
        combos.set(k, (combos.get(k) || 0) + 1); // the next experiment tries somewhere else
        continue;
      }
    }
    while (p < byValue.length && used.has(byValue[p].item.id)) p++;
    if (p >= byValue.length) break;
    const r = byValue[p++];
    used.add(r.item.id);
    out.push({ ...r.item, pick: 'proven', reason: provenWhy(model, r.tr) || r.item.reason, value: r.value });
    const k = comboKey(r.tr);
    combos.set(k, (combos.get(k) || 0) + 1); // about to be called: experiments look elsewhere
  }
  for (const r of byValue) if (!used.has(r.item.id)) out.push({ ...r.item, pick: 'proven', value: r.value });
  return out;
}

// ---------------------------------------------------------------- when owners pick up

export interface Slot { day: number; hour: number; dials: number; connects: number; meetings: number }

/** Calls by weekday (0 = Sunday) × hour, in this device's time zone. */
export function pickupGrid(activities: Activity[], from = ''): Map<string, Slot> {
  const grid = new Map<string, Slot>();
  for (const a of activities) {
    if (a.type !== 'call' || a.deleted || (from && a.occurredAt < from)) continue;
    const d = new Date(a.occurredAt);
    if (isNaN(d.getTime())) continue;
    const k = `${d.getDay()}:${d.getHours()}`;
    const s = grid.get(k) || { day: d.getDay(), hour: d.getHours(), dials: 0, connects: 0, meetings: 0 };
    s.dials += 1;
    if (isConnect(a.outcome)) s.connects += 1;
    if (a.outcome === 'Meeting Booked') s.meetings += 1;
    grid.set(k, s);
  }
  return grid;
}

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

/**
 * The hours owners pick up most, once there's enough to say: slots with at least `minDials` calls whose connect
 * rate (shrunk toward the average) beats the average by 15%+. Empty until then.
 */
export function bestTimes(grid: Map<string, Slot>, opts: { minDials?: number; minTotal?: number; top?: number } = {}) {
  const slots = [...grid.values()];
  const dials = slots.reduce((s, x) => s + x.dials, 0);
  const connects = slots.reduce((s, x) => s + x.connects, 0);
  if (dials < (opts.minTotal ?? 60)) return { overall: dials ? connects / dials : 0, best: [] as (Slot & { rate: number })[] };
  const overall = connects / dials;
  const best = slots.filter((s) => s.dials >= (opts.minDials ?? 8))
    .map((s) => ({ ...s, rate: (s.connects + 10 * overall) / (s.dials + 10) }))
    .filter((s) => s.rate >= overall * 1.15)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, opts.top ?? 2);
  return { overall, best };
}

// ---------------------------------------------------------------- scorecard

export interface Funnel { dials: number; connects: number; meetings: number }

export function funnel(acts: Activity[], from: string, to = '￿'): Funnel {
  const f = { dials: 0, connects: 0, meetings: 0 };
  for (const a of acts) {
    if (a.type !== 'call' || a.deleted || a.occurredAt < from || a.occurredAt >= to) continue;
    f.dials += 1;
    if (isConnect(a.outcome)) f.connects += 1;
    if (a.outcome === 'Meeting Booked') f.meetings += 1;
  }
  return f;
}

/** Calls in a period grouped by `key`, biggest first. */
export function breakdown(acts: Activity[], from: string, key: (a: Activity) => string): { key: string; f: Funnel }[] {
  const m = new Map<string, Funnel>();
  for (const a of acts) {
    if (a.type !== 'call' || a.deleted || a.occurredAt < from) continue;
    const k = key(a) || 'Other';
    const f = m.get(k) || { dials: 0, connects: 0, meetings: 0 };
    f.dials += 1;
    if (isConnect(a.outcome)) f.connects += 1;
    if (a.outcome === 'Meeting Booked') f.meetings += 1;
    m.set(k, f);
  }
  return [...m.entries()].map(([k, f]) => ({ key: k, f })).sort((a, b) => b.f.dials - a.f.dials || a.key.localeCompare(b.key));
}

/** The trait values doing best right now (proven ones only). */
export function topTraits(model: EngineModel, n = 3) {
  const out: { t: TraitName; v: string; s: Tally; lift: number }[] = [];
  for (const t of TRAITS) {
    if (t === 'attempt') continue;
    for (const [v, s] of model.by[t]) {
      if (s.dials < PROVEN_DIALS || /unknown|Not checked|No score/i.test(v)) continue;
      const lift = model.est(t, v) / (model.overall || 1);
      if (lift > 1.05) out.push({ t, v, s, lift });
    }
  }
  return out.sort((a, b) => b.lift - a.lift).slice(0, n);
}
