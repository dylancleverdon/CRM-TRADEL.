/** Meetings booked through the CRM: join, reschedule or cancel (Google emails the client), and the Dashboard list. */
import { format, isToday, isTomorrow } from 'date-fns';
import { CalendarClock, CalendarX, Video } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mailboxEmail } from '../lib/email';
import { cancelMeeting, isLiveMeeting, joinUrl, meetingWhen, rescheduleMeeting, upcomingMeetings, type Pick } from '../lib/meetings';
import { openExternal } from '../lib/platform';
import { useTable } from '../lib/store';
import type { Activity } from '../lib/types';
import { MeetingPicker } from './MeetingPicker';
import { entityLink } from './Tasks';
import { Empty, Modal, toast } from './ui';

export const meetingRange = (a: Activity) => {
  const s = new Date(a.occurredAt), e = new Date(a.endAt || a.occurredAt);
  return isNaN(s.getTime()) ? '' : meetingWhen(s, isNaN(e.getTime()) || e <= s ? new Date(s.getTime() + 30 * 60000) : e);
};

export function MeetingActions({ a, compact }: { a: Activity; compact?: boolean }) {
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!isLiveMeeting(a) || Date.parse(a.endAt || a.occurredAt) < Date.now()) return null;
  const cancel = async () => {
    if (!confirm(`Cancel the meeting with ${a.entityName} (${meetingRange(a)})? Google will email them that it's cancelled.`)) return;
    setBusy(true);
    try { await cancelMeeting(a.id); toast('Meeting cancelled; Google is letting them know'); }
    catch (e: any) { toast(`Couldn't cancel it: ${e?.message || e}`); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="row wrap" style={{ gap: 6, marginTop: compact ? 0 : 6 }} onClick={(e) => e.stopPropagation()}>
        {a.meetLink && (() => {
          const account = a.emailFrom || mailboxEmail();
          return (
            <button className="btn sm primary" title={account ? `Opens Google Meet as ${account}` : undefined} onClick={() => openExternal(joinUrl(a.meetLink!, account))}>
              <Video size={13} /> Join
            </button>
          );
        })()}
        <button className="btn sm" disabled={busy} onClick={() => setMoving(true)}><CalendarClock size={13} /> Reschedule</button>
        <button className="btn sm ghost" disabled={busy} onClick={cancel}><CalendarX size={13} /> Cancel</button>
      </div>
      {moving && <Reschedule a={a} onClose={() => setMoving(false)} />}
    </>
  );
}

function Reschedule({ a, onClose }: { a: Activity; onClose: () => void }) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!pick) { toast('Pick the new time'); return; }
    setBusy(true);
    try { const when = await rescheduleMeeting(a.id, pick); toast(`📅 Moved to ${when}; Google is emailing them the new time`); onClose(); }
    catch (e: any) { toast(`Couldn't move it: ${e?.message || e}`); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={`Reschedule: ${a.entityName}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Keep {meetingRange(a)}</button><button className="btn primary" disabled={!pick || busy} onClick={save}>{busy ? 'Moving…' : 'Move the meeting'}</button></>}>
      <div className="faint" style={{ fontSize: '0.82rem', marginBottom: 10 }}>Now: {meetingRange(a)}. Google emails {a.emailTo || 'them'} the new time; the same Meet link stays.</div>
      <MeetingPicker value={pick} onChange={setPick} />
    </Modal>
  );
}

const dayLabel = (d: Date) => (isToday(d) ? 'Today' : isTomorrow(d) ? 'Tomorrow' : format(d, 'EEE, MMM d'));

/** Dashboard: meetings booked through the CRM that haven't ended yet. */
export function UpcomingMeetings() {
  const acts = useTable('activities');
  const navigate = useNavigate();
  const list = upcomingMeetings(acts).slice(0, 6);
  return (
    <div className="card">
      <div className="card-head"><CalendarClock size={16} /><h3>Upcoming meetings</h3>{list.length > 0 && <span className="faint" style={{ fontSize: '0.8rem' }}>{list.length}</span>}</div>
      {list.length === 0 && <Empty>No meetings booked through the CRM yet. Book one from Meeting Booked when you log a call, or Add meeting invite in an email.</Empty>}
      {list.map((a) => {
        const s = new Date(a.occurredAt);
        const live = Date.now() >= s.getTime() - 10 * 60000;
        return (
          <div className="list-item" key={a.id} style={{ alignItems: 'flex-start' }}>
            <div className="grow clickable" onClick={() => navigate(entityLink(a.entityType, a.entityId))}>
              <div className="title">{a.entityName}</div>
              <div className="meta">{dayLabel(s)} · {format(s, 'h:mm a')}{a.outcome === 'Rescheduled' ? ' · rescheduled' : ''}{live ? ' · starting now' : ''}</div>
            </div>
            <MeetingActions a={a} compact />
          </div>
        );
      })}
    </div>
  );
}
