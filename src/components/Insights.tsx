/**
 * Dashboard insights: the scorecard (dials → connects → meetings), breakdowns, when owners pick up, and what the
 * lead engine has learned.
 */
import { startOfDay, startOfWeek, subDays } from 'date-fns';
import { BarChart3, Clock, FlaskConical } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  bestTimes, breakdown, DAY_SHORT, funnel, GOAL_LABEL, hourLabel, leadCalls, PICK_LABEL, pickupGrid, topTraits,
  type EngineModel, type Funnel, type Slot,
} from '../lib/engine';
import { store } from '../lib/store';
import type { Activity } from '../lib/types';
import { Empty } from './ui';

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');
const per100 = (n: number, d: number) => (d ? (Math.round((n / d) * 1000) / 10).toString() : '–');

function periods(now = new Date()) {
  const sod = startOfDay(now);
  const sow = startOfWeek(now, { weekStartsOn: 1 });
  const lastWeek = subDays(sow, 7);
  return {
    today: sod.toISOString(),
    week: sow.toISOString(),
    lastWeek: lastWeek.toISOString(),
    lastWeekNow: subDays(now, 7).toISOString(),
    d30: subDays(now, 30).toISOString(),
  };
}

// ---------------------------------------------------------------- scorecard

export function Scorecard({ acts }: { acts: Activity[] }) {
  const d = useMemo(() => {
    const p = periods();
    return {
      today: funnel(acts, p.today),
      week: funnel(acts, p.week),
      lastWeek: funnel(acts, p.lastWeek, p.week),
      lastWeekByNow: funnel(acts, p.lastWeek, p.lastWeekNow),
      d30: funnel(acts, p.d30),
    };
  }, [acts]);
  const rows: [string, Funnel][] = [['Today', d.today], ['This week', d.week], ['Last week', d.lastWeek], ['Last 30 days', d.d30]];
  const delta = (a: number, b: number) => (a === b ? 'same as' : a > b ? `▲ ${a - b} more than` : `▼ ${b - a} fewer than`);
  return (
    <div className="card">
      <div className="card-head"><BarChart3 size={16} /><h3>Scorecard</h3><span className="faint" style={{ marginLeft: 'auto', fontSize: '0.78rem' }}>dials → connects → meetings</span></div>
      <div className="grid g3" style={{ marginBottom: 12 }}>
        <div className="stat">
          <div className="label">Dials this week</div>
          <div className="value">{d.week.dials}</div>
          <div className="faint" style={{ fontSize: '0.75rem' }}>{delta(d.week.dials, d.lastWeekByNow.dials)} last week by now ({d.lastWeekByNow.dials})</div>
        </div>
        <div className="stat">
          <div className="label">Connects</div>
          <div className="value">{d.week.connects}<small>{pct(d.week.connects, d.week.dials)}</small></div>
          <div className="faint" style={{ fontSize: '0.75rem' }}>pick-up rate · last week {pct(d.lastWeek.connects, d.lastWeek.dials)}</div>
        </div>
        <div className="stat">
          <div className="label">Meetings booked</div>
          <div className="value">{d.week.meetings}<small>{per100(d.week.meetings, d.week.dials)} / 100 dials</small></div>
          <div className="faint" style={{ fontSize: '0.75rem' }}>last week {d.lastWeek.meetings} ({per100(d.lastWeek.meetings, d.lastWeek.dials)} / 100 dials)</div>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th style={{ cursor: 'default' }}></th><th style={{ cursor: 'default' }}>Dials</th><th style={{ cursor: 'default' }}>Connects</th><th style={{ cursor: 'default' }}>Pick-up</th><th style={{ cursor: 'default' }}>Meetings</th><th style={{ cursor: 'default' }}>Per 100 dials</th></tr></thead>
          <tbody>
            {rows.map(([label, f]) => (
              <tr key={label}>
                <td className="strong">{label}</td><td>{f.dials}</td><td>{f.connects}</td><td>{pct(f.connects, f.dials)}</td><td>{f.meetings}</td><td>{per100(f.meetings, f.dials)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- breakdowns

type By = 'trade' | 'script' | 'pick';
const BY_LABEL: Record<By, string> = { trade: 'By trade', script: 'By script', pick: 'Proven vs experiment' };

function recTrade(a: Activity): string {
  const r: any = a.entityType === 'lead' ? store.get('leads', a.entityId) : a.entityType === 'contact' ? store.get('contacts', a.entityId) : null;
  return r?.trade || 'Trade unknown';
}

export function Breakdown({ acts }: { acts: Activity[] }) {
  const [by, setBy] = useState<By>('trade');
  const rows = useMemo(() => {
    const from = subDays(new Date(), 30).toISOString();
    const key = by === 'trade' ? recTrade
      : by === 'script' ? (a: Activity) => (a.scriptKind === 'custom' ? 'Its own script' : a.scriptKind === 'default' ? 'Default script' : 'Not recorded')
        : (a: Activity) => PICK_LABEL[a.pick || ''] || 'Other calls';
    const all = breakdown(acts, from, key);
    if (all.length <= 8) return all;
    const rest = all.slice(7).reduce((f, r) => ({ dials: f.dials + r.f.dials, connects: f.connects + r.f.connects, meetings: f.meetings + r.f.meetings }), { dials: 0, connects: 0, meetings: 0 });
    return [...all.slice(0, 7), { key: `${all.length - 7} more`, f: rest }];
  }, [acts, by]);
  return (
    <div className="card">
      <div className="card-head"><h3>Breakdown</h3><span className="faint" style={{ marginLeft: 'auto', fontSize: '0.78rem' }}>last 30 days</span></div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {(Object.keys(BY_LABEL) as By[]).map((k) => <button key={k} className={`chip ${by === k ? 'on' : ''}`} onClick={() => setBy(k)}>{BY_LABEL[k]}</button>)}
      </div>
      {rows.length === 0 ? <Empty>No calls in the last 30 days yet.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ cursor: 'default' }}></th><th style={{ cursor: 'default' }}>Dials</th><th style={{ cursor: 'default' }}>Pick-up</th><th style={{ cursor: 'default' }}>Meetings</th><th style={{ cursor: 'default' }}>Per 100 dials</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}><td className="strong">{r.key}</td><td>{r.f.dials}</td><td>{pct(r.f.connects, r.f.dials)}</td><td>{r.f.meetings}</td><td>{per100(r.f.meetings, r.f.dials)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {by === 'script' && <div className="faint" style={{ fontSize: '0.75rem', marginTop: 6 }}>"Its own script" = you edited the script for that business (Call Mode → Script → Edit).</div>}
      {by === 'pick' && <div className="faint" style={{ fontSize: '0.75rem', marginTop: 6 }}>Experiments are the calls the lead engine spends on businesses it knows least about. Other calls: from a lead's page or before tracking began.</div>}
    </div>
  );
}

// ---------------------------------------------------------------- when owners pick up

type Metric = 'rate' | 'meetings';
const MIN_CELL = 3; // fewer calls than this in an hour: too few to color
const RATE_BINS = [0.1, 0.2, 0.3]; // < 10%, 10–20%, 20–30%, 30%+
const MEET_BINS = [1, 2, 3]; // 0, 1, 2, 3+
const RATE_LEGEND = ['< 10%', '10–20%', '20–30%', '30%+'];
const MEET_LEGEND = ['0', '1', '2', '3+'];
const binOf = (v: number, bins: number[]) => { let i = 0; while (i < bins.length && v >= bins[i]) i++; return i; };

export function PickupHeatmap({ acts }: { acts: Activity[] }) {
  const [metric, setMetric] = useState<Metric>('rate');
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<{ s: Slot | undefined; day: number; hour: number; x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const { grid, days, hours, times } = useMemo(() => {
    const g = pickupGrid(acts, subDays(new Date(), 90).toISOString());
    const slots = [...g.values()];
    const weekend = slots.some((s) => s.day === 0 || s.day === 6);
    const ds = weekend ? [1, 2, 3, 4, 5, 6, 0] : [1, 2, 3, 4, 5];
    const lo = Math.min(8, ...slots.map((s) => s.hour));
    const hi = Math.max(17, ...slots.map((s) => s.hour));
    return { grid: g, days: ds, hours: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), times: bestTimes(g) };
  }, [acts]);
  const total = [...grid.values()].reduce((n, s) => n + s.dials, 0);
  const step = (s: Slot | undefined) => {
    if (!s || s.dials < MIN_CELL) return -1;
    return metric === 'rate' ? binOf(s.connects / s.dials, RATE_BINS) : binOf(s.meetings, MEET_BINS);
  };
  const describe = (s: Slot | undefined) => !s ? 'No calls yet'
    : metric === 'rate' ? `${pct(s.connects, s.dials)} picked up` : `${s.meetings} meeting${s.meetings === 1 ? '' : 's'} booked`;
  const detail = (s: Slot | undefined) => !s ? '' : `${s.connects} of ${s.dials} call${s.dials === 1 ? '' : 's'} picked up · ${s.meetings} meeting${s.meetings === 1 ? '' : 's'}${s.dials < MIN_CELL ? ' · too few to say' : ''}`;
  const show = (e: React.SyntheticEvent<HTMLElement>, s: Slot | undefined, day: number, hour: number) => {
    const box = wrap.current?.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    if (box) setHover({ s, day, hour, x: r.left - box.left + r.width / 2, y: r.top - box.top });
  };
  return (
    <div className="card">
      <div className="card-head"><Clock size={16} /><h3>When owners pick up</h3><span className="faint" style={{ marginLeft: 'auto', fontSize: '0.78rem' }}>last 90 days · your time</span></div>
      <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
        <div className="chips">
          <button className={`chip ${metric === 'rate' ? 'on' : ''}`} onClick={() => setMetric('rate')}>Pick-up rate</button>
          <button className={`chip ${metric === 'meetings' ? 'on' : ''}`} onClick={() => setMetric('meetings')}>Meetings booked</button>
        </div>
        <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setTable(!table)}>{table ? 'Show chart' : 'Show table'}</button>
      </div>
      {total === 0 ? <Empty>Log some calls and this shows which days and hours owners pick up and book.</Empty> : table ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ cursor: 'default' }}></th>{days.map((d) => <th key={d} style={{ cursor: 'default' }}>{DAY_SHORT[d]}</th>)}</tr></thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h}>
                  <td className="strong">{hourLabel(h)}</td>
                  {days.map((d) => {
                    const s = grid.get(`${d}:${h}`);
                    return <td key={d}>{s ? (metric === 'rate' ? `${pct(s.connects, s.dials)} (${s.dials})` : `${s.meetings} (${s.dials})`) : ''}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="heat-wrap" ref={wrap} onMouseLeave={() => setHover(null)}>
            <div className="heat-scroll">
            <div className="heat" style={{ gridTemplateColumns: `34px repeat(${hours.length}, minmax(18px, 1fr))` }} role="grid" aria-label="Calls by weekday and hour">
              <span />
              {hours.map((h) => <span key={h} className="heat-h">{h % 2 === 0 ? hourLabel(h).replace(' ', '').toLowerCase() : ''}</span>)}
              {days.map((d) => (
                <div key={d} style={{ display: 'contents' }} role="row">
                  <span className="heat-d">{DAY_SHORT[d]}</span>
                  {hours.map((h) => {
                    const s = grid.get(`${d}:${h}`);
                    const k = step(s);
                    return (
                      <span key={h} role="gridcell" tabIndex={0} className={`heat-c ${k < 0 ? (s ? 'few' : 'none') : `s${k}`}`}
                        aria-label={`${DAY_SHORT[d]} ${hourLabel(h)}: ${describe(s)}. ${detail(s)}`}
                        onMouseEnter={(e) => show(e, s, d, h)} onFocus={(e) => show(e, s, d, h)} onBlur={() => setHover(null)} />
                    );
                  })}
                </div>
              ))}
            </div>
            </div>
            {hover && (
              <div className="heat-tip" style={{ left: hover.x, top: hover.y }} role="status">
                <b>{describe(hover.s)}</b>
                <span>{DAY_SHORT[hover.day]} {hourLabel(hover.hour)}{hover.s ? ` · ${detail(hover.s)}` : ''}</span>
              </div>
            )}
          </div>
          <div className="heat-legend">
            <span>{metric === 'rate' ? 'Picked up' : 'Meetings'}</span>
            {(metric === 'rate' ? RATE_LEGEND : MEET_LEGEND).map((l, i) => <span key={l} className="row" style={{ gap: 4 }}><i className={`heat-c s${i}`} />{l}</span>)}
            <span className="row" style={{ gap: 4 }}><i className="heat-c few" />fewer than {MIN_CELL} calls</span>
          </div>
        </>
      )}
      <div className="faint" style={{ fontSize: '0.78rem', marginTop: 8 }}>
        {times.best.length
          ? <>Best so far: {times.best.map((b) => `${DAY_SHORT[b.day]} ${hourLabel(b.hour)} (${pct(b.connects, b.dials)} of ${b.dials})`).join(' · ')} · average {Math.round(times.overall * 100)}%</>
          : total >= 60 ? 'No hour stands out yet: an hour needs 8+ calls before it counts, so keep calling at different times.'
            : total > 0 ? `Needs about 60 calls before it can say which hours are best (${total} so far).` : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- engine status

export function EngineStatus({ model, experiments, acts }: { model: EngineModel; experiments: number; acts: Activity[] }) {
  const t = model.total;
  const top = topTraits(model, 4);
  const arms = useMemo(() => {
    const from = subDays(new Date(), 30).toISOString();
    const by = new Map(breakdown(acts, from, (a) => a.pick || '').map((r) => [r.key, r.f]));
    return { proven: by.get('proven'), experiment: by.get('experiment') };
  }, [acts]);
  const leadDials = leadCalls(acts).length;
  return (
    <div className="card">
      <div className="card-head"><FlaskConical size={16} /><h3>Lead engine</h3>
        <span className="pill accent" style={{ marginLeft: 'auto' }}>Optimizing for {GOAL_LABEL[model.goal].toLowerCase()}</span>
      </div>
      <div className="stack" style={{ fontSize: '0.86rem' }}>
        <div>
          Learned from <b>{leadDials}</b> call{leadDials === 1 ? '' : 's'} on leads: {t.connects} connect{t.connects === 1 ? '' : 's'} ({pct(t.connects, t.dials)}) and {t.meetings} meeting{t.meetings === 1 ? '' : 's'}.
          {' '}{experiments} of every 10 calls are experiments.
        </div>
        {(arms.proven || arms.experiment) && (
          <div className="faint">
            Last 30 days: proven picks {arms.proven ? `${pct(arms.proven.connects, arms.proven.dials)} pick-up, ${per100(arms.proven.meetings, arms.proven.dials)} meetings / 100 dials` : 'none yet'}
            {' '}· experiments {arms.experiment ? `${pct(arms.experiment.connects, arms.experiment.dials)} pick-up, ${per100(arms.experiment.meetings, arms.experiment.dials)} / 100` : 'none yet'}
          </div>
        )}
        {top.length > 0 ? (
          <div>
            <div className="faint" style={{ fontSize: '0.75rem', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Doing best</div>
            {top.map((x) => (
              <div key={x.t + x.v} className="row" style={{ gap: 8, padding: '3px 0' }}>
                <span className="strong" style={{ fontWeight: 650 }}>{x.v}</span>
                <span className="faint">{x.s.meetings ? `${x.s.meetings} meeting${x.s.meetings === 1 ? '' : 's'} / ${x.s.dials} dials` : `${pct(x.s.connects, x.s.dials)} pick up (${x.s.dials} dials)`}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="faint">Still learning: a trend shows once a trade, city or kind of business has {10}+ calls. Until then it follows your lead scores and spreads experiments across trades and cities.</div>
        )}
        <Link to="/settings" className="faint" style={{ fontSize: '0.78rem' }}>Change what it optimizes for →</Link>
      </div>
    </div>
  );
}
