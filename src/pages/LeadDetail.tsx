import { ArrowLeft, MessageSquare, Phone, StickyNote, ThumbsDown, ThumbsUp, Trash2, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCall } from '../components/CallFlow';
import { InfoFields, QuickLinks } from '../components/Detail';
import { NotesFeed } from '../components/Notes';
import { Page } from '../components/Layout';
import { PresenceCard } from '../components/Presence';
import { QueueButton } from '../components/QueueButton';
import { TextCompose } from '../components/TextCompose';
import { TasksPanel } from '../components/Tasks';
import { Timeline } from '../components/Timeline';
import { Empty, Field, Modal, StatusPill, toast } from '../components/ui';
import { convertLead, setLeadQuality, setLeadStatus } from '../lib/actions';
import { DEFAULT_TRADES, DISQUALIFY_REASONS, LEAD_STATUSES, LEAD_STATUS_HELP } from '../lib/constants';
import { ago, formatPhone, when } from '../lib/format';
import { backfillAddress } from '../lib/email';
import { missingInfo } from '../lib/leadmap';
import { openExternal } from '../lib/platform';
import { getSetting, store, useRecord } from '../lib/store';
import type { Lead, LeadStatus } from '../lib/types';

export default function LeadDetail() {
  const { id } = useParams();
  const lead = useRecord('leads', id);
  const navigate = useNavigate();
  const { startCall, logManual } = useCall();
  const [badOpen, setBadOpen] = useState(false);
  const [texting, setTexting] = useState(false);
  const trades = getSetting('trades', DEFAULT_TRADES);

  if (!lead) return <Page title="Lead not found"><Empty><Link to="/leads">Back to leads</Link></Empty></Page>;
  const entity = { type: 'lead' as const, id: lead.id };
  const save = (k: string, v: string) => {
    store.upsert('leads', { id: lead.id, [k]: v } as Partial<Lead>);
    if (k === 'email' && v) backfillAddress(v).then((n) => n && toast(`${n} past email${n === 1 ? '' : 's'} linked`)).catch(() => {});
  };

  const convert = () => {
    const c = convertLead(lead);
    toast('Converted to contact');
    navigate(`/contacts/${c.id}`);
  };

  return (
    <Page
      title={<span className="row" style={{ gap: 10 }}><button className="btn ghost icon" onClick={() => navigate(-1)}><ArrowLeft size={18} /></button>{lead.company}</span>}
      sub={<span className="row wrap" style={{ gap: 8 }}>
        <StatusPill status={lead.status} />
        <span>{lead.contactName}</span>
        {lead.phone && <span>· {formatPhone(lead.phone)}</span>}
        <span>· {lead.attempts || 0} call attempts</span>
        <span>· last contact {ago(lead.lastContactedAt)}</span>
      </span>}
      actions={<>
        <div className="quality-toggle">
          <button className={`good ${lead.quality === 'good' ? 'on' : ''}`} onClick={() => setLeadQuality(lead, lead.quality === 'good' ? '' : 'good')}><ThumbsUp size={15} /> Good</button>
          <button className={`bad ${lead.quality === 'bad' ? 'on' : ''}`} onClick={() => (lead.quality === 'bad' ? setLeadQuality(lead, '') : setBadOpen(true))}><ThumbsDown size={15} /> Bad</button>
        </div>
        {lead.convertedContactId ? (
          <Link className="btn" to={`/contacts/${lead.convertedContactId}`}><UserCheck size={15} /> View contact</Link>
        ) : (
          <button className="btn" onClick={convert}><UserCheck size={15} /> Convert to contact</button>
        )}
        <QueueButton entity={entity} queued={!!lead.queuedAt} disabled={!lead.phone && !lead.queuedAt} />
        <button className="btn" disabled={!lead.phone} onClick={() => setTexting(true)}><MessageSquare size={15} /> Text</button>
        <button className="btn" onClick={() => logManual(entity)}><StickyNote size={15} /> Log call</button>
        <button className="btn call" disabled={!lead.phone} onClick={() => startCall(entity)}><Phone size={15} /> Call</button>
      </>}
    >
      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>Lead status</h3></div>
            <div className="chips">
              {LEAD_STATUSES.map((s) => (
                <button key={s} title={LEAD_STATUS_HELP[s]} className={`chip ${lead.status === s ? 'on' : ''}`} onClick={() => setLeadStatus(lead, s as LeadStatus)}>{s}</button>
              ))}
            </div>
            {lead.quality === 'bad' && (
              <div className="row" style={{ marginTop: 10 }}>
                <span className="faint" style={{ fontSize: '0.82rem' }}>Bad lead reason:</span>
                <select style={{ width: 'auto' }} value={lead.disqualifyReason} onChange={(e) => save('disqualifyReason', e.target.value)}>
                  <option value="">—</option>{DISQUALIFY_REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-head"><h3>Details</h3><div className="actions"><QuickLinks rec={lead} entity={entity} /></div></div>
            <InfoFields rec={lead} onSave={save} fields={[
              { key: 'company', label: 'Company', full: true },
              { key: 'contactName', label: 'Contact name' },
              { key: 'phone', label: 'Phone', type: 'tel' },
              { key: 'altPhone', label: 'Alt phone', type: 'tel' },
              { key: 'email', label: 'Email', type: 'email' },
              { key: 'website', label: 'Website', type: 'url' },
              { key: 'trade', label: 'Trade', type: 'select', options: trades },
              { key: 'city', label: 'City' },
              { key: 'state', label: 'State' },
              { key: 'address', label: 'Address', full: true },
              { key: 'source', label: 'Source' },
              { key: 'tags', label: 'Tags' },
            ]} />
            <div className="faint" style={{ fontSize: '0.75rem', marginTop: 10 }}>Added {when(lead.createdAt)} · Updated {when(lead.updatedAt)}</div>
          </div>
          <PresenceCard rec={lead} entity={entity} />
          {(lead.licenseNo || lead.ubi || lead.origin === 'public') && <PublicRecord lead={lead} />}
          <NotesFeed postTo={entity} summary={lead.notes} onSummary={(v) => save('notes', v)} />
          <button className="btn bad sm" onClick={() => { if (confirm('Delete this lead?')) { store.remove('leads', lead.id); navigate('/leads'); } }}><Trash2 size={14} /> Delete lead</button>
        </div>
        <div className="stack">
          <TasksPanel entity={entity} />
          <Timeline entities={[entity]} />
        </div>
      </div>
      {badOpen && <BadLeadModal lead={lead} onClose={() => setBadOpen(false)} />}
      {texting && <TextCompose entity={entity} onClose={() => setTexting(false)} />}
    </Page>
  );
}

function PublicRecord({ lead }: { lead: Lead }) {
  const isLI = (lead.sources || '').includes('li') && lead.licenseNo;
  return (
    <div className="card">
      <div className="card-head"><h3>Public record</h3>{lead.score != null && <span className="pill accent" style={{ marginLeft: 'auto' }}>Score {lead.score}</span>}</div>
      <dl className="kv">
        <dt>Source</dt><dd>{lead.source}</dd>
        {lead.specialty && <><dt>Specialty</dt><dd>{lead.specialty}</dd></>}
        {lead.ownership && <><dt>Business type</dt><dd>{lead.ownership}</dd></>}
        {lead.licenseStart && <><dt>Licensed since</dt><dd>{lead.licenseStart}</dd></>}
        {lead.licenseNo && <><dt>License #</dt><dd>{lead.licenseNo}</dd></>}
        {lead.ubi && <><dt>State UBI</dt><dd>{lead.ubi}</dd></>}
      </dl>
      {(() => {
        const miss = missingInfo(lead);
        return miss.length ? <div className="row wrap" style={{ marginTop: 10, gap: 6 }}><span className="faint" style={{ fontSize: '0.8rem' }}>Missing:</span>{miss.map((m) => <span key={m} className="pill warn">{m}</span>)}</div> : null;
      })()}
      {lead.lapsedAt && <div className="pill warn" style={{ marginTop: 8 }}>License lapsed {lead.lapsedAt} — may still be operating</div>}
      {lead.notListedSince && <div className="pill" style={{ marginTop: 8 }}>Not in any public list since {lead.notListedSince} (kept for reference)</div>}
      <div className="row wrap" style={{ marginTop: 10 }}>
        {!lead.phone && <button className="btn sm" onClick={() => openExternal(`https://www.google.com/search?q=${encodeURIComponent(`${lead.company} ${lead.city || ''} WA phone`)}`)}>Find phone on Google</button>}
        {isLI && <button className="btn sm" onClick={() => openExternal(`https://secure.lni.wa.gov/verify/Detail.aspx?LIC=${encodeURIComponent(lead.licenseNo!)}`)}>L&I license page</button>}
        <button className="btn sm" onClick={() => openExternal(`https://www.google.com/search?q=${encodeURIComponent(`${lead.company} ${lead.city || ''} WA`)}`)}>Google it</button>
      </div>
      {!lead.updatedAt && <div className="faint" style={{ fontSize: '0.75rem', marginTop: 8 }}>From public records — saved to your sheet as soon as you call, note or edit it. Anything you fill in (phone, owner, website…) is kept permanently, even when the public data refreshes.</div>}
    </div>
  );
}

function BadLeadModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [reason, setReason] = useState(lead.disqualifyReason || '');
  return (
    <Modal title="Mark as bad lead" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { setLeadQuality(lead, 'bad', reason); onClose(); }}>Mark bad</button></>}>
      <Field label="Why is this a bad lead?">
        <div className="chips" style={{ marginTop: 6 }}>
          {DISQUALIFY_REASONS.map((r) => <button key={r} className={`chip ${reason === r ? 'on bad' : ''}`} onClick={() => setReason(r)}>{r}</button>)}
        </div>
      </Field>
    </Modal>
  );
}
