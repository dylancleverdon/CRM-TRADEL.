import { ExternalLink, Phone, SkipForward, StickyNote, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCall } from '../components/CallFlow';
import { NotesCard, QuickLinks } from '../components/Detail';
import { Page } from '../components/Layout';
import { Empty, Progress, QualityPill, StatusPill } from '../components/ui';
import { setLeadQuality } from '../lib/actions';
import { DEFAULT_GOALS, DEFAULT_SCRIPT, DEFAULT_TRADES } from '../lib/constants';
import { ago, fillTemplate, formatPhone, when } from '../lib/format';
import { buildCallQueue, dayStats } from '../lib/queue';
import { getSetting, store, useSetting, useTable } from '../lib/store';
import { startOfDay } from 'date-fns';

export default function CallMode() {
  const leads = useTable('leads');
  const contacts = useTable('contacts');
  const tasks = useTable('tasks');
  const acts = useTable('activities');
  const [trade, setTrade] = useState('');
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [showScript, setShowScript] = useState(true);
  const { startCall, onLogged } = useCall();
  const script = useSetting('callScript', DEFAULT_SCRIPT);
  const myName = useSetting('myName', '');
  const goals = useSetting('goals', DEFAULT_GOALS);
  const trades = getSetting('trades', DEFAULT_TRADES);

  const queue = useMemo(() => buildCallQueue(leads, contacts, tasks, { trade }).filter((q) => !skipped.has(q.id)), [leads, contacts, tasks, trade, skipped]);
  const cur = queue[0];
  const today = dayStats(acts.filter((a) => a.occurredAt >= startOfDay(new Date()).toISOString()));

  useEffect(() => { onLogged(() => {}); return () => onLogged(null); }, []);

  const rec: any = cur ? (cur.type === 'lead' ? store.get('leads', cur.id) : store.get('contacts', cur.id)) : null;
  const recent = cur ? acts.filter((a) => a.entityId === cur.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 4) : [];

  return (
    <Page
      title="Call Mode"
      sub={`${queue.length} in queue · ${today.calls}/${goals.calls} calls · ${today.connects} connects · ${today.meetings} meetings today`}
      actions={<>
        <select style={{ width: 170 }} value={trade} onChange={(e) => setTrade(e.target.value)}><option value="">All trades</option>{trades.map((t) => <option key={t}>{t}</option>)}</select>
        {skipped.size > 0 && <button className="btn" onClick={() => setSkipped(new Set())}>Reset skipped ({skipped.size})</button>}
      </>}
    >
      <div style={{ marginBottom: 14 }}><Progress value={today.calls} max={goals.calls} /></div>
      {!cur && <div className="card"><Empty>🎉 Queue is clear. Import more leads or check back when follow-ups come due.</Empty></div>}
      {cur && rec && (
        <div className="split">
          <div className="stack">
            <div className="card">
              <div className="call-hero">
                <div className="row" style={{ justifyContent: 'center', marginBottom: 8, gap: 6 }}>
                  <span className="pill accent">{cur.reason}</span>
                  {cur.type === 'lead' ? <StatusPill status={rec.status} /> : <span className="pill info">Contact</span>}
                  {cur.type === 'lead' && <QualityPill q={rec.quality} />}
                </div>
                <div className="co">{rec.company}</div>
                <div className="muted">{[rec.contactName, rec.trade, [rec.city, rec.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</div>
                <div className="ph">{formatPhone(rec.phone)}</div>
                <button className="btn call lg" style={{ minWidth: 220 }} onClick={() => startCall({ type: cur.type, id: cur.id })}><Phone size={20} /> Call now</button>
                <div className="row" style={{ justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={() => setSkipped(new Set(skipped).add(cur.id))}><SkipForward size={15} /> Skip</button>
                  {cur.type === 'lead' && <>
                    <button className="btn" onClick={() => setLeadQuality(rec, 'good')}><ThumbsUp size={15} /> Good</button>
                    <button className="btn" onClick={() => setLeadQuality(rec, 'bad')}><ThumbsDown size={15} /> Bad</button>
                  </>}
                  <Link className="btn" to={cur.type === 'lead' ? `/leads/${cur.id}` : `/contacts/${cur.id}`}><ExternalLink size={15} /> Open</Link>
                </div>
                <div className="faint" style={{ fontSize: '0.8rem', marginTop: 12 }}>
                  {rec.attempts ? `${rec.attempts} previous attempts · ` : ''}Last contact {ago(rec.lastContactedAt)}{rec.lastOutcome ? ` (${rec.lastOutcome})` : ''}
                </div>
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center' }}><QuickLinks rec={rec} /></div>
              </div>
            </div>
            <NotesCard value={rec.notes} onSave={(v) => store.upsert(cur.type === 'lead' ? 'leads' : 'contacts', { id: cur.id, notes: v } as any)} />
          </div>
          <div className="stack">
            <div className="card">
              <div className="card-head"><StickyNote size={15} /><h3>Script</h3><button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setShowScript(!showScript)}>{showScript ? 'Hide' : 'Show'}</button></div>
              {showScript && <div className="script">{fillTemplate(script, { company: rec.company, trade: (rec.trade || 'home service').toLowerCase(), city: rec.city || 'your area', name: rec.contactName || 'there', myName: myName || 'me' })}</div>}
              <div className="faint" style={{ fontSize: '0.75rem', marginTop: 6 }}>Edit the script in Settings.</div>
            </div>
            <div className="card">
              <div className="card-head"><h3>Recent history</h3></div>
              {recent.length === 0 && <Empty>First touch.</Empty>}
              {recent.map((a) => (
                <div className="list-item" key={a.id}>
                  <div className="grow">
                    <div className="title" style={{ fontSize: '0.88rem' }}>{a.type === 'call' ? 'Call' : a.type} — {a.outcome}</div>
                    <div className="meta">{when(a.occurredAt)}{a.notes ? ` · ${a.notes}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="card-head"><h3>Up next</h3></div>
              {queue.slice(1, 7).map((q) => (
                <div className="list-item" key={q.id}>
                  <div className="grow"><div className="title" style={{ fontSize: '0.88rem' }}>{q.company}</div><div className="meta">{q.reason}</div></div>
                </div>
              ))}
              {queue.length <= 1 && <Empty>Nothing else queued.</Empty>}
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
