/**
 * Pick the meeting time you agreed on the phone: 30-minute times over the next two weeks. Times outside your
 * weekly hours (Settings → Meetings) and times already busy on your Google Calendar are greyed out.
 */
import { addDays, format, isSameDay, startOfDay } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fromLocalInput, toLocalInput } from '../lib/format';
import { daySlots, fetchBusy, meetingSettings, meetingWhen, pickerDays, type Busy, type MeetingSettings, type Pick } from '../lib/meetings';
import { useSetting } from '../lib/store';

const STATE_LABEL = { free: 'Free', busy: 'Busy on your calendar', off: 'Outside your hours', past: 'Already past' } as const;

export function MeetingPicker({ value, onChange }: { value: Pick | null; onChange: (v: Pick | null) => void }) {
  const s = meetingSettings(useSetting<Partial<MeetingSettings>>('meetings', {}));
  const days = useMemo(() => pickerDays(), []);
  const [busy, setBusy] = useState<Busy[] | null>(null);
  const [error, setError] = useState('');
  const [other, setOther] = useState(false);
  const firstOpen = useMemo(() => days.find((d) => daySlots(d, s, [], Date.now()).some((x) => x.state === 'free')) || days[0], []); // eslint-disable-line react-hooks/exhaustive-deps
  const [day, setDay] = useState<Date>(value ? startOfDay(value.start) : firstOpen);

  useEffect(() => {
    let live = true;
    fetchBusy(days[0], addDays(days[days.length - 1], 1))
      .then((b) => live && setBusy(b))
      .catch((e) => { if (live) { setError(e?.message || String(e)); setBusy([]); } });
    return () => { live = false; };
  }, [days]);

  const slots = daySlots(day, s, busy || [], Date.now());
  const pickAt = (iso: string) => {
    if (!iso) return;
    const start = new Date(fromLocalInput(iso));
    if (isNaN(start.getTime())) return;
    onChange({ start, end: new Date(start.getTime() + s.lengthMin * 60000) });
  };

  return (
    <div className="meet-picker">
      <div className="day-chips">
        {days.map((d) => (
          <button key={d.toISOString()} type="button" className={`chip ${isSameDay(d, day) ? 'on' : ''} ${s.week[d.getDay()].on ? '' : 'day-off'}`}
            onClick={() => setDay(d)} title={s.week[d.getDay()].on ? undefined : 'Not one of your working days'}>
            <span>{isSameDay(d, days[0]) ? 'Today' : format(d, 'EEE')}</span><b>{format(d, 'MMM d')}</b>
          </button>
        ))}
      </div>
      {busy === null && <div className="faint" style={{ fontSize: '0.8rem' }}>Checking your Google Calendar…</div>}
      {error && (
        <div className="pill warn" style={{ whiteSpace: 'normal' }}>
          Couldn't check your calendar ({error}). Busy times aren't greyed out.{' '}
          {/Settings → Meetings/.test(error) && <Link to="/settings">Open Settings</Link>}
        </div>
      )}
      <div className="slots" role="listbox" aria-label={`Times on ${format(day, 'EEEE, MMMM d')}`}>
        {slots.map((x) => {
          const on = !!value && value.start.getTime() === x.start.getTime();
          return (
            <button key={x.start.toISOString()} type="button" role="option" aria-selected={on} disabled={x.state !== 'free'}
              className={`slot ${x.state} ${on ? 'on' : ''}`} title={STATE_LABEL[x.state]} onClick={() => onChange({ start: x.start, end: x.end })}>
              {format(x.start, 'h:mm a')}
            </button>
          );
        })}
      </div>
      <div className="slot-legend">
        <span><i className="slot free" /> Free</span><span><i className="slot busy" /> Busy on your calendar</span><span><i className="slot off" /> Outside your hours</span>
        <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setOther(!other)}>{other ? 'Hide' : 'Another time…'}</button>
      </div>
      {other && (
        <div className="row wrap" style={{ gap: 8 }}>
          <input type="datetime-local" style={{ width: 'auto' }} value={value ? toLocalInput(value.start.toISOString()) : ''} onChange={(e) => pickAt(e.target.value)} />
          <span className="faint" style={{ fontSize: '0.78rem' }}>For a one-off outside your usual hours. Change your hours in Settings → Meetings.</span>
        </div>
      )}
      {value && <div className="meet-picked">📅 {meetingWhen(value.start, value.end)} · {s.lengthMin} min · Google Meet</div>}
    </div>
  );
}
