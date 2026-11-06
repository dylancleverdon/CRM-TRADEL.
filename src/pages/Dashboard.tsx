import { format, isToday, startOfDay, startOfMonth, subDays } from 'date-fns';
import { CalendarCheck, Check, Circle, Clock, DollarSign, Phone, PhoneCall, PhoneIncoming, Plus, Target, ThumbsUp, X } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCall } from '../components/CallFlow';
import { Breakdown, EngineStatus, PickupHeatmap, Scorecard } from '../components/Insights';
import { UpcomingMeetings } from '../components/Meetings';
import { Page } from '../components/Layout';
import { entityLink, TaskRow } from '../components/Tasks';
import { Empty, Progress } from '../components/ui';
import { isClosed, stages } from '../lib/actions';
import { DEFAULT_GOALS, outcomeDef } from '../lib/constants';
import { duration, money, when } from '../lib/format';
import { rankQueue } from '../lib/engine';
import { buildCallQueue, dayStats } from '../lib/queue';
import { useEngineModel } from '../lib/useEngine';
import { unreadEmails } from '../lib/emailmatch';
import { store, useSetting, useTable } from '../lib/store';

export default function Dashboard() {
  const leads = useTable('leads');
  const contacts = useTable('contacts');
  const tasks = useTable('tasks');
  const acts = useTable('activities');
  const opps = useTable('opportunities');
  const goals = useSetting('goals', DEFAULT_GOALS);
  const myName = useSetting('myName', '');
  const { startCall } = useCall();
  const navigate = useNavigate();
  const { model, settings: eng } = useEngineModel();

  const d = useMemo(() => {
    const sod = startOfDay(new Date()).toISOString();
    const now = new Date().toISOString();
    const todayActs = acts.filter((a) => a.occurredAt >= sod).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const s = dayStats(todayActs);
    const openTasks = tasks.filter((t) => !t.done);
    const overdue = openTasks.filter((t) => t.dueAt && t.dueAt < sod).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    const dueToday = openTasks.filter((t) => t.dueAt && t.dueAt >= sod && isToday(new Date(t.dueAt))).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    const doneToday = tasks.filter((t) => t.done && t.doneAt >= sod);
    const qualified = todayActs.filter((a) => a.type === 'status' && /GOOD|→ Qualified/.test(a.outcome)).length;
    const disq = todayActs.filter((a) => a.type === 'status' && /BAD|→ Disqualified/.test(a.outcome)).length;
    const converted = todayActs.filter((a) => a.type === 'converted' && a.entityType === 'lead').length;
    const newLeads = leads.filter((l) => l.origin !== 'public' && (l.createdAt || '') >= sod).length;
    const newOpps = opps.filter((o) => (o.createdAt || '') >= sod).length;
    const openOpps = opps.filter((o) => !isClosed(o.stage));
    const mrr = openOpps.reduce((x, o) => x + (o.monthlyValue || 0), 0);
    const weighted = openOpps.reduce((x, o) => x + ((o.monthlyValue || 0) * (o.probability || 0)) / 100, 0);
    const som = startOfMonth(new Date()).toISOString();
    const wonStage = stages().find((x) => x.closed === 'won')?.name;
    const wonMonth = opps.filter((o) => o.stage === wonStage && (o.closedAt || '') >= som);
    const week = Array.from({ length: 7 }, (_, i) => {
      const day = subDays(startOfDay(new Date()), 6 - i);
      const next = subDays(day, -1).toISOString();
      const ds = dayStats(acts.filter((a) => a.occurredAt >= day.toISOString() && a.occurredAt < next));
      return { label: format(day, 'EEE'), ...ds };
    });
    const queue = buildCallQueue(leads, contacts, tasks);
    const outcomes: Record<string, number> = {};
    todayActs.filter((a) => a.type === 'call').forEach((a) => (outcomes[a.outcome] = (outcomes[a.outcome] || 0) + 1));
    const emailsSent = todayActs.filter((a) => a.type === 'email' && a.direction === 'out').length;
    const replies = unreadEmails(acts);
    return { emailsSent, replies, todayActs, s, overdue, dueToday, doneToday, qualified, disq, converted, newLeads, newOpps, openOpps, mrr, weighted, wonMonth, week, queue, outcomes, now };
  }, [acts, tasks, leads, contacts, opps]);

  const upNext = useMemo(() => rankQueue(d.queue, model, (id) => store.get('leads', id), { experiments: eng.experiments, head: 10 }), [d.queue, model, eng.experiments]);

  const checklist = [
    { label: `Make ${goals.calls} calls`, done: d.s.calls >= goals.calls, progress: `${d.s.calls}/${goals.calls}` },
    { label: `Reach ${goals.connects} decision makers`, done: d.s.connects >= goals.connects, progress: `${d.s.connects}/${goals.connects}` },
    { label: `Book ${goals.meetings} meetings`, done: d.s.meetings >= goals.meetings, progress: `${d.s.meetings}/${goals.meetings}` },
    { label: 'Clear follow-ups due today', done: d.dueToday.length === 0, progress: `${d.dueToday.length} left` },
    { label: 'No overdue follow-ups', done: d.overdue.length === 0, progress: `${d.overdue.length} overdue`, late: d.overdue.length > 0 },
  ];
  const done = checklist.filter((c) => c.done).length;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const maxBar = Math.max(1, ...d.week.map((w) => w.calls));

  return (
    <Page
      title={`${greet}${myName ? `, ${myName}` : ''}`}
      sub={`${format(new Date(), 'EEEE, MMMM d')} · ${done}/${checklist.length} daily goals done`}
      actions={<>
        <Link className="btn" to="/leads?new=1"><Plus size={16} /> Lead</Link>
        <Link className="btn primary" to="/call"><PhoneCall size={16} /> Start calling</Link>
      </>}
    >
      <div className="stack">
        <div className="grid g4">
          <Stat icon={<Phone size={14} />} label="Calls" value={d.s.calls} goal={goals.calls} />
          <Stat icon={<PhoneIncoming size={14} />} label="Connects" value={d.s.connects} goal={goals.connects}
            extra={d.s.calls ? `${Math.round((d.s.connects / d.s.calls) * 100)}% rate` : undefined} />
          <Stat icon={<CalendarCheck size={14} />} label="Meetings booked" value={d.s.meetings} goal={goals.meetings} />
          <Stat icon={<Check size={14} />} label="Follow-ups done" value={d.doneToday.length} goal={goals.followUps} />
        </div>

        <div className="split">
          <div className="card">
            <div className="card-head"><Target size={16} /><h3>Today's goals</h3><span className="pill accent" style={{ marginLeft: 'auto' }}>{done}/{checklist.length}</span></div>
            {checklist.map((c) => (
              <div className="check-row" key={c.label}>
                <div className={`ico ${c.done ? 'done' : c.late ? 'late' : 'todo'}`}>{c.done ? <Check size={14} /> : c.late ? <X size={13} /> : <Circle size={10} />}</div>
                <div style={{ flex: 1, textDecoration: c.done ? 'line-through' : undefined, color: c.done ? 'var(--text-2)' : undefined }}>{c.label}</div>
                <span className="faint" style={{ fontSize: '0.8rem' }}>{c.progress}</span>
              </div>
            ))}
            <hr />
            <div className="grid g3" style={{ fontSize: '0.85rem' }}>
              <MiniStat label="Leads marked good" value={d.qualified} color="var(--good)" />
              <MiniStat label="Leads marked bad" value={d.disq} color="var(--bad)" />
              <MiniStat label="Converted to contact" value={d.converted} />
              <MiniStat label="New leads added" value={d.newLeads} />
              <MiniStat label="New opportunities" value={d.newOpps} />
              <MiniStat label="Talk time" value={duration(d.s.talkSec) || '0m'} />
              <MiniStat label="Emails sent" value={d.emailsSent} />
            </div>
          </div>

          <div className="card">
            <div className="card-head"><Clock size={16} /><h3>Still to do</h3>
              <Link to="/tasks" className="faint" style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>All follow-ups</Link>
            </div>
            {d.replies.length > 0 && <Link to="/email" className="list-item" style={{ color: 'inherit' }}><div className="grow"><div className="title" style={{ color: 'var(--warn)' }}>✉️ {d.replies.length} unread email{d.replies.length === 1 ? '' : 's'} from leads & contacts</div><div className="meta">{d.replies.slice(0, 3).map((r) => r.entityName).join(', ')}</div></div></Link>}
            {d.overdue.length + d.dueToday.length === 0 && !d.replies.length && <Empty>Nothing due today. 🎉</Empty>}
            {d.overdue.slice(0, 6).map((t) => <TaskRow key={t.id} t={t} />)}
            {d.dueToday.slice(0, 8).map((t) => <TaskRow key={t.id} t={t} />)}
            {d.overdue.length + d.dueToday.length > 14 && <div className="faint" style={{ fontSize: '0.8rem', paddingTop: 8 }}>+{d.overdue.length + d.dueToday.length - 14} more</div>}
          </div>
        </div>

        <div className="split">
          <Scorecard acts={acts} />
          <EngineStatus model={model} experiments={eng.experiments} acts={acts} />
        </div>

        <div className="split">
          <PickupHeatmap acts={acts} />
          <Breakdown acts={acts} />
        </div>

        <div className="split">
          <div className="card">
            <div className="card-head"><Check size={16} /><h3>Done today</h3><span className="faint" style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>{d.todayActs.length} actions</span></div>
            {Object.keys(d.outcomes).length > 0 && (
              <div className="chips" style={{ marginBottom: 10 }}>
                {Object.entries(d.outcomes).map(([k, v]) => (
                  <span key={k} className={`pill ${outcomeDef(k)?.color === 'good' ? 'good' : outcomeDef(k)?.color === 'bad' ? 'bad' : ''}`}>{k}: {v}</span>
                ))}
              </div>
            )}
            {d.todayActs.length === 0 && <Empty>No activity yet today. Hit "Start calling" to get going.</Empty>}
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {d.todayActs.slice(0, 60).map((a) => (
                <div key={a.id} className="list-item clickable" onClick={() => navigate(entityLink(a.entityType, a.entityId))}>
                  <div className="grow">
                    <div className="title">{a.entityName} <span className="faint" style={{ fontWeight: 500 }}>· {a.type === 'call' ? 'Call' : a.type}</span></div>
                    <div className="meta">{a.outcome}{a.notes ? ` — ${a.notes.slice(0, 80)}` : ''}</div>
                  </div>
                  <span className="faint" style={{ fontSize: '0.78rem' }}>{format(new Date(a.occurredAt), 'h:mm a')}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="col" style={{ gap: 'var(--gap)' }}>
            <UpcomingMeetings />
            <div className="card">
              <div className="card-head"><PhoneCall size={16} /><h3>Up next</h3><span className="faint" style={{ fontSize: '0.8rem' }}>{d.queue.length} in queue</span>
                <Link to="/call" className="btn sm primary" style={{ marginLeft: 'auto' }}>Call mode</Link>
              </div>
              {d.queue.length === 0 && <Empty>Queue is empty. Add or import leads.</Empty>}
              {upNext.slice(0, 5).map((q) => (
                <div className="list-item" key={q.type + q.id}>
                  <div className="grow clickable" onClick={() => navigate(entityLink(q.type, q.id))}>
                    <div className="title">{q.company}</div>
                    <div className="meta">{q.reason}</div>
                  </div>
                  <button className="btn call sm" onClick={() => startCall({ type: q.type, id: q.id }, undefined, q.pick)}><Phone size={14} /></button>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="card-head"><h3>Last 7 days</h3><span className="faint" style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>■ calls <span style={{ color: 'var(--good)' }}>■</span> connects</span></div>
              <div className="bars">
                {d.week.map((w) => (
                  <div className="bar" key={w.label}>
                    <span className="n">{w.calls || ''}</span>
                    <div className="fill" style={{ height: `${(w.calls / maxBar) * 85}%` }}>
                      <div className="fill connect" style={{ height: w.calls ? `${(w.connects / w.calls) * 100}%` : 0 }} />
                    </div>
                    <span>{w.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-head"><DollarSign size={16} /><h3>Pipeline</h3><Link to="/pipeline" className="faint" style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>Open board</Link></div>
              <div className="grid g2">
                <MiniStat label="Open deals" value={d.openOpps.length} />
                <MiniStat label="Open MRR" value={money(d.mrr) + '/mo'} />
                <MiniStat label="Weighted MRR" value={money(d.weighted) + '/mo'} />
                <MiniStat label="Won this month" value={`${d.wonMonth.length} · ${money(d.wonMonth.reduce((x, o) => x + o.monthlyValue, 0))}/mo`} color="var(--good)" />
              </div>
            </div>
          </div>
        </div>
        <div className="faint" style={{ fontSize: '0.75rem' }}><ThumbsUp size={11} /> Tip: goals are editable in Settings → Daily goals. Last refreshed {when(d.now)}.</div>
      </div>
    </Page>
  );
}

function Stat({ icon, label, value, goal, extra }: { icon: React.ReactNode; label: string; value: number; goal: number; extra?: string }) {
  return (
    <div className="stat">
      <div className="label">{icon}{label}</div>
      <div className="value">{value}<small>/ {goal}</small></div>
      <Progress value={value} max={goal} />
      {extra && <div className="faint" style={{ fontSize: '0.75rem' }}>{extra}</div>}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: '1.05rem', color }}>{value}</div>
      <div className="faint" style={{ fontSize: '0.76rem' }}>{label}</div>
    </div>
  );
}
