/** Calendar: meetings booked through the CRM, by day, with Join / Reschedule / Cancel. */
import { format, isToday, isTomorrow, isYesterday, startOfDay, subDays } from 'date-fns';
import { CalendarClock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../components/Layout';
import { MeetingActions, meetingRange } from '../components/Meetings';
import { entityLink } from '../components/Tasks';
import { Empty } from '../components/ui';
import { useTable } from '../lib/store';
import type { Activity } from '../lib/types';

const dayLabel = (d: Date) => (isToday(d) ? 'Today' : isTomorrow(d) ? 'Tomorrow' : isYesterday(d) ? 'Yesterday' : format(d, 'EEEE, MMMM d'));
const pill = (a: Activity, past: boolean) => (a.outcome === 'Cancelled' ? 'bad' : past ? '' : a.outcome === 'Rescheduled' ? 'warn' : 'good');

function byDay(list: Activity[]) {
  const groups: { day: string; items: Activity[] }[] = [];
  for (const a of list) {
    const d = dayLabel(new Date(a.occurredAt));
    const g = groups[groups.length - 1];
    if (g && g.day === d) g.items.push(a); else groups.push({ day: d, items: [a] });
  }
  return groups;
}

export default function CalendarPage() {
  const acts = useTable('activities');
  const [showPast, setShowPast] = useState(false);
  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const meetings = acts.filter((a) => a.type === 'meeting' && !a.deleted);
    const ends = (a: Activity) => Date.parse(a.endAt || a.occurredAt);
    return {
      upcoming: meetings.filter((a) => ends(a) > now && a.outcome !== 'Cancelled').sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
      past: meetings.filter((a) => (ends(a) <= now || a.outcome === 'Cancelled') && a.occurredAt >= subDays(startOfDay(new Date()), 60).toISOString())
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    };
  }, [acts]);
  const row = (a: Activity, isPast: boolean) => (
    <div className="list-item" key={a.id} style={{ alignItems: 'flex-start' }}>
      <div className="grow">
        <div className="title"><Link to={entityLink(a.entityType, a.entityId)} style={{ color: 'inherit' }}>{a.entityName}</Link></div>
        <div className="meta">{meetingRange(a).split(' · ')[1] || format(new Date(a.occurredAt), 'h:mm a')}{a.emailTo ? ` · ${a.emailTo}` : ''}</div>
      </div>
      <span className={`pill ${pill(a, isPast)}`}>{a.outcome === 'Cancelled' ? 'Cancelled' : isPast ? 'Done' : a.outcome || 'Scheduled'}</span>
      {!isPast && <MeetingActions a={a} compact />}
    </div>
  );
  return (
    <Page title="Calendar" sub={`${upcoming.length} upcoming meeting${upcoming.length === 1 ? '' : 's'} booked through the CRM`}
      actions={<button className="btn" onClick={() => setShowPast(!showPast)}>{showPast ? 'Hide past' : `Past meetings (${past.length})`}</button>}>
      <div className="stack">
        {upcoming.length === 0 && <div className="card"><Empty>No meetings coming up. Book one from Meeting Booked when you log a call, or Add meeting invite in an email.</Empty></div>}
        {byDay(upcoming).map((g) => (
          <div className="card" key={g.day}>
            <div className="card-head"><CalendarClock size={16} /><h3>{g.day}</h3><span className="faint" style={{ fontSize: '0.8rem' }}>{g.items.length}</span></div>
            {g.items.map((a) => row(a, false))}
          </div>
        ))}
        {showPast && (
          <div className="card">
            <div className="card-head"><h3>Past 60 days</h3></div>
            {past.length === 0 && <Empty>No past meetings yet.</Empty>}
            {byDay(past).map((g) => (
              <div key={g.day}><div className="faint" style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '10px 0 2px' }}>{g.day}</div>{g.items.map((a) => row(a, true))}</div>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
