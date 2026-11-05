import { BellRing, ExternalLink, ListPlus, Phone, RefreshCw, Search, SkipForward, StickyNote, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { startOfDay } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCall } from '../components/CallFlow';
import { NotesCard, QuickLinks } from '../components/Detail';
import { DeskPhoneToggle } from '../components/DeskPhone';
import { Page } from '../components/Layout';
import { PresenceCard } from '../components/Presence';
import { Empty, Progress, QualityPill, StatusPill, toast } from '../components/ui';
import { setLeadQuality, setQueued } from '../lib/actions';
import {
  dayKey, dueNotShown, freshSession, loadSession, manualQueue, nextBatch, resolveSession, saveSession, withBatch,
  type CallSession, type CallType, type RecGetter,
} from '../lib/callsession';
import { DEFAULT_GOALS, DEFAULT_SCRIPT, DEFAULT_TRADES } from '../lib/constants';
import { ago, fillTemplate, formatPhone, when } from '../lib/format';
import { presenceLines } from '../lib/presence';
import { buildCallQueue, dayStats, dncPhones } from '../lib/queue';
import { getSetting, store, useSetting, useTable } from '../lib/store';
import type { Contact, Lead } from '../lib/types';

const getRec: RecGetter = (type, id) => (type === 'lead' ? store.get('leads', id) : store.get('contacts', id));
const sectionLabel = { fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const, marginTop: 4 };

export default function CallMode() {
  const leads = useTable('leads');
  const contacts = useTable('contacts');
  const tasks = useTable('tasks');
  const acts = useTable('activities');
  const [session, setSession] = useState<CallSession>(loadSession);
  const [showScript, setShowScript] = useState(true);
  const { startCall, onLogged } = useCall();
  const script = useSetting('callScript', DEFAULT_SCRIPT);
  const myName = useSetting('myName', '');
  const goals = useSetting('goals', DEFAULT_GOALS);
  const trades = getSetting('trades', DEFAULT_TRADES);
  const trade = session.trade;

  const auto = useMemo(() => buildCallQueue(leads, contacts, tasks, { trade }), [leads, contacts, tasks, trade]);
  const dnc = useMemo(() => dncPhones(leads), [leads]);
  const manual = useMemo(() => manualQueue(leads, contacts), [leads, contacts]);
  const view = resolveSession(session, manual, getRec, dnc);
  const cur = view.current;
  const dueNow = dueNotShown(auto, view, session);
  const inQueue = (cur ? 1 : 0) + view.manual.length + view.locked.length;
  const today = dayStats(acts.filter((a) => a.occurredAt >= startOfDay(new Date()).toISOString()));

  useEffect(() => { onLogged(() => {}); return () => onLogged(null); }, []);
  useEffect(() => saveSession(session), [session]);
  // A new day starts a new session.
  useEffect(() => { if (session.day !== dayKey()) setSession(freshSession(session.trade)); });
  // When this batch is used up, lock in the next one.
  useEffect(() => {
    if (view.lockedLeft > 0) return;
    const batch = nextBatch(auto, session, view);
    if (!batch.length) return;
    if (session.items.length) toast(`Next ${batch.length} calls locked in`);
    setSession((s) => withBatch(s, batch));
  }, [view.lockedLeft, auto]);
  // Remember which business is on screen, so it stays until you call or skip it.
  useEffect(() => {
    if ((cur?.id || '') !== session.currentId) setSession((s) => ({ ...s, currentId: cur?.id || '' }));
  }, [cur?.id]);

  const skip = () => cur && setSession((s) => ({ ...s, skipped: [...s.skipped, cur.id], currentId: '' }));
  const newBatch = () => { setSession((s) => freshSession(s.trade, s)); toast('Fresh batch locked in'); };
  const addDue = () => {
    const base = Date.now();
    dueNow.forEach((q, i) => setQueued(q, true, new Date(base + i).toISOString()));
    toast(`${dueNow.length} follow-up${dueNow.length === 1 ? '' : 's'} added to your queue`);
  };

  const rec: any = cur ? getRec(cur.type, cur.id) : null;
  const recent = cur ? acts.filter((a) => a.entityId === cur.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 4) : [];

  return (
    <Page
      title="Call Mode"
      sub={`${inQueue} in queue · ${today.calls}/${goals.calls} calls · ${today.connects} connects · ${today.meetings} meetings today`}
      actions={<>
        <select style={{ width: 170 }} value={trade} onChange={(e) => setSession((s) => freshSession(e.target.value, s))}>
          <option value="">All trades</option>{trades.map((t) => <option key={t}>{t}</option>)}
        </select>
        {session.skipped.length > 0 && <button className="btn" onClick={() => setSession((s) => ({ ...s, skipped: [] }))}>Reset skipped ({session.skipped.length})</button>}
      </>}
    >
      <div style={{ marginBottom: 14 }}><Progress value={today.calls} max={goals.calls} /></div>
      <div className="hide-desktop" style={{ marginBottom: 12 }}><DeskPhoneToggle /></div>
      {dueNow.length > 0 && (
        <div className="card row wrap" style={{ marginBottom: 12, background: 'var(--warn-soft)', padding: '10px 14px' }}>
          <BellRing size={16} color="var(--warn)" />
          <span style={{ flex: '1 1 220px', fontSize: '0.88rem' }}>
            <b>{dueNow.length} follow-up{dueNow.length === 1 ? '' : 's'} due now:</b> {dueNow.slice(0, 3).map((q) => q.company).join(', ')}{dueNow.length > 3 ? ` +${dueNow.length - 3} more` : ''}
          </span>
          <button className="btn sm primary" onClick={addDue}><ListPlus size={14} /> Add to my queue</button>
          <button className="btn ghost icon sm" title="Not now" onClick={() => setSession((s) => ({ ...s, dismissed: [...s.dismissed, ...dueNow.map((q) => q.id)] }))}><X size={14} /></button>
        </div>
      )}
      {!cur && (
        <div className="split">
          <div className="card"><Empty>🎉 Queue is clear. Add leads to your queue, import more, or check back when follow-ups come due.</Empty></div>
          <QueueSearch leads={leads} contacts={contacts} />
        </div>
      )}
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
                  <button className="btn" onClick={skip}><SkipForward size={15} /> Skip</button>
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
            <PresenceCard key={`p:${cur.type}:${cur.id}`} rec={rec} entity={{ type: cur.type, id: cur.id }} />
            <NotesCard key={`${cur.type}:${cur.id}`} value={rec.notes} onSave={(v) => store.upsert(cur.type === 'lead' ? 'leads' : 'contacts', { id: cur.id, notes: v } as any)} />
          </div>
          <div className="stack">
            <div className="card">
              <div className="card-head"><StickyNote size={15} /><h3>Script</h3><button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setShowScript(!showScript)}>{showScript ? 'Hide' : 'Show'}</button></div>
              {showScript && <div className="script">{fillTemplate(script, { company: rec.company, trade: (rec.trade || 'home service').toLowerCase(), city: rec.city || 'your area', name: rec.contactName || 'there', myName: myName || 'me', ...presenceLines(rec) }, ['yelp', 'google'])}</div>}
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
              <div className="card-head">
                <h3>Up next</h3>
                <span className="faint" style={{ fontSize: '0.78rem' }}>{view.lockedLeft} left in this batch</span>
                <div className="actions"><button className="btn ghost sm" title="Lock in a fresh batch from today's priorities" onClick={newBatch}><RefreshCw size={13} /> New batch</button></div>
              </div>
              {view.manual.length > 0 && <div className="faint" style={sectionLabel}>My queue</div>}
              {view.manual.map((q) => (
                <div className="list-item" key={q.id}>
                  <div className="grow"><div className="title" style={{ fontSize: '0.88rem' }}>{q.company}</div><div className="meta">Added by you</div></div>
                  <button className="btn ghost icon sm" title="Take off my queue" onClick={() => setQueued(q, false)}><X size={14} /></button>
                </div>
              ))}
              {view.manual.length > 0 && view.locked.length > 0 && <div className="faint" style={sectionLabel}>Locked in</div>}
              {view.locked.map((q) => (
                <div className="list-item" key={q.id}>
                  <div className="grow"><div className="title" style={{ fontSize: '0.88rem' }}>{q.company}</div><div className="meta">{q.reason}</div></div>
                </div>
              ))}
              {view.manual.length + view.locked.length === 0 && <Empty>Nothing else queued.</Empty>}
              {view.removed.length > 0 && (
                <div className="faint" style={{ fontSize: '0.75rem', marginTop: 8 }}>
                  Taken off: {view.removed.slice(-3).map((r) => `${r.company} (${r.reason})`).join(', ')}
                </div>
              )}
            </div>
            <QueueSearch leads={leads} contacts={contacts} />
          </div>
        </div>
      )}
    </Page>
  );
}

/** Find any business with a phone number and put it at the front of the line (after the current call). */
function QueueSearch({ leads, contacts }: { leads: Lead[]; contacts: Contact[] }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const digits = s.replace(/\D/g, '');
    const hit = (r: { company?: string; contactName?: string; phone?: string }) =>
      (r.company || '').toLowerCase().includes(s) || (r.contactName || '').toLowerCase().includes(s) ||
      (digits.length >= 3 && (r.phone || '').replace(/\D/g, '').includes(digits));
    const out: { type: CallType; id: string; company: string; meta: string; queued: boolean }[] = [];
    for (const c of contacts) {
      if (out.length >= 8) break;
      if (c.phone && hit(c)) out.push({ type: 'contact', id: c.id, company: c.company, meta: `Contact · ${formatPhone(c.phone)}`, queued: !!c.queuedAt });
    }
    for (const l of leads) {
      if (out.length >= 8) break;
      if (l.phone && hit(l)) out.push({ type: 'lead', id: l.id, company: l.company, meta: [l.trade, l.city, formatPhone(l.phone)].filter(Boolean).join(' · '), queued: !!l.queuedAt });
    }
    return out;
  }, [q, leads, contacts]);
  return (
    <div className="card">
      <div className="card-head"><ListPlus size={15} /><h3>Add to my queue</h3></div>
      <div className="search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a business, owner or phone…" /></div>
      {results.map((r) => (
        <div className="list-item" key={r.id}>
          <div className="grow"><div className="title" style={{ fontSize: '0.88rem' }}>{r.company}</div><div className="meta">{r.meta}</div></div>
          {r.queued
            ? <span className="pill accent">Queued</span>
            : <button className="btn sm" onClick={() => { setQueued(r, true); toast(`${r.company} added to your queue`); }}><ListPlus size={13} /> Add</button>}
        </div>
      ))}
      {q.trim().length >= 2 && results.length === 0 && <Empty>No business with a phone number matches.</Empty>}
      {q.trim().length < 2 && <div className="faint" style={{ fontSize: '0.75rem', marginTop: 8 }}>Queued businesses are called right after the current one, before the auto queue.</div>}
    </div>
  );
}
