/** History: everything you've done (calls, emails, texts, notes, meetings…), newest first, each opening its record. */
import { format, isToday, isYesterday } from 'date-fns';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../components/Layout';
import { entityLink } from '../components/Tasks';
import { ICONS, LABEL } from '../components/Timeline';
import { Empty } from '../components/ui';
import { duration } from '../lib/format';
import { useTable } from '../lib/store';
import type { Activity } from '../lib/types';

const FILTERS: [string, string, (a: Activity) => boolean][] = [
  ['all', 'All', () => true],
  ['call', 'Calls', (a) => a.type === 'call'],
  ['email', 'Emails', (a) => a.type === 'email'],
  ['text', 'Texts', (a) => a.type === 'text'],
  ['note', 'Notes', (a) => a.type === 'note'],
  ['meeting', 'Meetings', (a) => a.type === 'meeting'],
  ['other', 'Changes', (a) => !['call', 'email', 'text', 'note', 'meeting'].includes(a.type)],
];
const dayLabel = (d: Date) => (isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'EEEE, MMMM d'));

export default function HistoryPage() {
  const acts = useTable('activities');
  const navigate = useNavigate();
  const [f, setF] = useState('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(150);
  const list = useMemo(() => {
    const test = FILTERS.find((x) => x[0] === f)![2];
    const s = q.trim().toLowerCase();
    return acts.filter((a) => !a.deleted && test(a) && (!s || `${a.entityName} ${a.outcome} ${a.notes}`.toLowerCase().includes(s)))
      .sort((a, b) => (b.occurredAt || '').localeCompare(a.occurredAt || ''));
  }, [acts, f, q]);
  let lastDay = '';
  return (
    <Page title="History" sub={`${list.length} action${list.length === 1 ? '' : 's'}`}>
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        <div className="chips">{FILTERS.map(([k, label]) => <button key={k} className={`chip ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>{label}</button>)}</div>
        <div className="search" style={{ marginLeft: 'auto', minWidth: 240 }}><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a business, outcome or note…" /></div>
      </div>
      <div className="card">
        {list.length === 0 && <Empty>Nothing here yet.</Empty>}
        {list.slice(0, limit).map((a) => {
          const Icon = ICONS[a.type] || ICONS.note;
          const d = dayLabel(new Date(a.occurredAt));
          const head = d !== lastDay ? (lastDay = d) : '';
          return (
            <div key={a.id}>
              {head && <div className="faint" style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '12px 0 2px' }}>{head}</div>}
              <div className="list-item clickable" onClick={() => navigate(entityLink(a.entityType, a.entityId))}>
                <div className={`tl-icon ${a.type}`} style={{ flex: 'none' }}><Icon size={15} /></div>
                <div className="grow">
                  <div className="title">{a.entityName || 'Record'} <span className="faint" style={{ fontWeight: 500 }}>· {LABEL[a.type] || a.type}{a.outcome ? ` — ${a.outcome}` : ''}</span></div>
                  {a.notes && <div className="meta">{a.notes.slice(0, 160)}</div>}
                </div>
                <span className="faint" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{format(new Date(a.occurredAt), 'h:mm a')}{a.durationSec ? ` · ${duration(a.durationSec)}` : ''}</span>
              </div>
            </div>
          );
        })}
        {list.length > limit && <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setLimit(limit + 300)}>Show more ({list.length - limit} older)</button>}
      </div>
    </Page>
  );
}
