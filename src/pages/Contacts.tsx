import { ArrowLeft, Briefcase, MessageSquare, Phone, Plus, Search, StickyNote, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCall } from '../components/CallFlow';
import { InfoFields, QuickLinks } from '../components/Detail';
import { NotesFeed } from '../components/Notes';
import { Page } from '../components/Layout';
import { NewOpportunity, OpportunityModal } from '../components/Opportunity';
import { PresenceCard } from '../components/Presence';
import { PhoneContactButton } from '../components/PhoneContactButton';
import { QueueButton } from '../components/QueueButton';
import { TextCompose } from '../components/TextCompose';
import { exportCsv, ExportIcon, useIsMobile } from '../components/RecordForm';
import { TasksPanel } from '../components/Tasks';
import { Timeline } from '../components/Timeline';
import { Empty, Field, Modal, StatusPill, toast } from '../components/ui';
import { isClosed, logActivity } from '../lib/actions';
import { backfillAddress } from '../lib/email';
import { CONTACT_STATUSES, DEFAULT_TRADES } from '../lib/constants';
import { ago, formatPhone, money, shortDate } from '../lib/format';
import { serviceLabel } from '../lib/services';
import { getSetting, store, useRecord, useTable } from '../lib/store';
import type { Contact } from '../lib/types';

export function ContactsList() {
  const contacts = useTable('contacts');
  const opps = useTable('opportunities');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const { startCall } = useCall();
  const mobile = useIsMobile();

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return contacts
      .filter((c) => !status || c.status === status)
      .filter((c) => !ql || [c.company, c.contactName, c.phone, c.email, c.city, c.notes].some((x) => (x || '').toLowerCase().includes(ql)))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }, [contacts, q, status]);

  const oppInfo = (id: string) => {
    const mine = opps.filter((o) => o.contactId === id);
    const open = mine.filter((o) => !isClosed(o.stage));
    return { total: mine.length, open: open.length, mrr: open.reduce((s, o) => s + o.monthlyValue, 0) };
  };

  return (
    <Page title="Contacts" sub={`${contacts.length} contacts · ${contacts.filter((c) => c.status === 'Active Client').length} active clients`}
      actions={<>
        <button className="btn hide-mobile" onClick={() => exportCsv('contacts', rows)}><ExportIcon size={15} /> Export</button>
        <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> New contact</button>
      </>}>
      <div className="stack">
        <div className="row wrap">
          <div className="search" style={{ flex: '1 1 240px' }}><Search size={15} /><input placeholder="Search contacts…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="tabs">
            <button className={!status ? 'on' : ''} onClick={() => setStatus('')}>All</button>
            {CONTACT_STATUSES.map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s}</button>)}
          </div>
        </div>
        {rows.length === 0 && <div className="card"><Empty>No contacts yet. Convert a good lead into a contact from the lead page.</Empty></div>}
        {rows.length > 0 && mobile && (
          <div className="card" style={{ padding: '4px 12px' }}>
            {rows.map((c) => {
              const oi = oppInfo(c.id);
              return (
                <div className="list-item" key={c.id}>
                  <div className="grow" onClick={() => navigate(`/contacts/${c.id}`)}>
                    <div className="title">{c.company}</div>
                    <div className="meta row wrap" style={{ gap: 6 }}><StatusPill status={c.status} />{c.contactName}{oi.open ? ` · ${oi.open} open deals` : ''}</div>
                  </div>
                  {c.phone && <button className="btn call" onClick={() => startCall({ type: 'contact', id: c.id })}><Phone size={17} /></button>}
                </div>
              );
            })}
          </div>
        )}
        {rows.length > 0 && !mobile && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Company</th><th>Status</th><th>Phone</th><th>Opportunities</th><th>Last contact</th><th>Follow-up</th><th></th></tr></thead>
              <tbody>
                {rows.map((c) => {
                  const oi = oppInfo(c.id);
                  return (
                    <tr key={c.id} onClick={() => navigate(`/contacts/${c.id}`)}>
                      <td><div className="strong">{c.company}</div><div className="faint" style={{ fontSize: '0.78rem' }}>{c.contactName}{c.trade ? ` · ${c.trade}` : ''}</div></td>
                      <td><StatusPill status={c.status} /></td>
                      <td>{formatPhone(c.phone)}</td>
                      <td>{oi.total ? `${oi.open} open · ${money(oi.mrr)}/mo` : <span className="faint">None</span>}</td>
                      <td>{c.lastContactedAt ? ago(c.lastContactedAt) : '—'}</td>
                      <td>{shortDate(c.nextFollowUpAt) || '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>{c.phone && <button className="btn call sm" onClick={() => startCall({ type: 'contact', id: c.id })}><Phone size={13} /></button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <NewContact onClose={() => setAdding(false)} />}
    </Page>
  );
}

function NewContact({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ company: '', contactName: '', phone: '', email: '' });
  const save = () => {
    if (!f.company) { toast('Company is required'); return; }
    const c = store.upsert('contacts', { ...f, title: '', altPhone: '', website: '', trade: '', city: '', state: '', address: '', status: 'Prospect', leadId: '', tags: '', lastContactedAt: '', lastOutcome: '', nextFollowUpAt: '', notes: '' });
    logActivity({ type: 'contact', id: c.id }, { type: 'created', outcome: 'Contact added' });
    onClose();
    navigate(`/contacts/${c.id}`);
  };
  return (
    <Modal title="New contact" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Company *" full><input autoFocus value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></Field>
        <Field label="Contact name"><input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
        <Field label="Phone"><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email" full><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function ContactDetail() {
  const { id } = useParams();
  const c = useRecord('contacts', id);
  const opps = useTable('opportunities').filter((o) => o.contactId === id);
  const [params, setParams] = useSearchParams();
  const [newOpp, setNewOpp] = useState(false);
  const [texting, setTexting] = useState(false);
  const navigate = useNavigate();
  const { startCall, logManual } = useCall();
  const trades = getSetting('trades', DEFAULT_TRADES);
  if (!c) return <Page title="Contact not found"><Empty><Link to="/contacts">Back to contacts</Link></Empty></Page>;
  const entity = { type: 'contact' as const, id: c.id };
  const save = (k: string, v: string) => {
    store.upsert('contacts', { id: c.id, [k]: v } as Partial<Contact>);
    if (k === 'email' && v) backfillAddress(v).then((n) => n && toast(`${n} past email${n === 1 ? '' : 's'} linked`)).catch(() => {});
  };
  const openOpp = params.get('opp');
  const timelineEntities = [entity, ...(c.leadId ? [{ type: 'lead' as const, id: c.leadId }] : []), ...opps.map((o) => ({ type: 'opportunity' as const, id: o.id }))];

  return (
    <Page
      title={<span className="row" style={{ gap: 10 }}><button className="btn ghost icon" onClick={() => navigate(-1)}><ArrowLeft size={18} /></button>{c.company}</span>}
      sub={<span className="row wrap" style={{ gap: 8 }}><StatusPill status={c.status} /><span>{c.contactName}</span>{c.phone && <span>· {formatPhone(c.phone)}</span>}<span>· last contact {ago(c.lastContactedAt)}</span></span>}
      actions={<>
        <button className="btn" onClick={() => setNewOpp(true)}><Briefcase size={15} /> New opportunity</button>
        <QueueButton entity={entity} queued={!!c.queuedAt} disabled={!c.phone && !c.queuedAt} />
        <PhoneContactButton entity={entity} rec={c} />
        <button className="btn" disabled={!c.phone} onClick={() => setTexting(true)}><MessageSquare size={15} /> Text</button>
        <button className="btn" onClick={() => logManual(entity)}><StickyNote size={15} /> Log call</button>
        <button className="btn call" disabled={!c.phone} onClick={() => startCall(entity)}><Phone size={15} /> Call</button>
      </>}
    >
      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>Opportunities</h3><div className="actions"><button className="btn sm" onClick={() => setNewOpp(true)}><Plus size={14} /> Add</button></div></div>
            {opps.length === 0 && <Empty>No opportunities yet. What could you sell them?</Empty>}
            {opps.map((o) => (
              <div className="list-item clickable" key={o.id} onClick={() => { params.set('opp', o.id); setParams(params); }}>
                <div className="grow">
                  <div className="title">{o.name}</div>
                  <div className="meta">{serviceLabel(o.service) || 'No service picked'} · {money(o.monthlyValue)}/mo{o.setupFee ? ` + ${money(o.setupFee)} setup` : ''}{o.nextStep ? ` · → ${o.nextStep}` : ''}</div>
                </div>
                <StatusPill status={o.stage} />
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-head"><h3>Details</h3><div className="actions"><QuickLinks rec={c} entity={entity} /></div></div>
            <div className="row" style={{ marginBottom: 12 }}>
              {CONTACT_STATUSES.map((s) => <button key={s} className={`chip ${c.status === s ? 'on' : ''}`} onClick={() => save('status', s)}>{s}</button>)}
            </div>
            <InfoFields rec={c} onSave={save} fields={[
              { key: 'company', label: 'Company', full: true },
              { key: 'contactName', label: 'Contact name' },
              { key: 'title', label: 'Title' },
              { key: 'phone', label: 'Phone', type: 'tel' },
              { key: 'altPhone', label: 'Alt phone', type: 'tel' },
              { key: 'email', label: 'Email', type: 'email' },
              { key: 'website', label: 'Website' },
              { key: 'trade', label: 'Trade', type: 'select', options: trades },
              { key: 'city', label: 'City' },
              { key: 'state', label: 'State' },
              { key: 'address', label: 'Address' },
              { key: 'tags', label: 'Tags', full: true },
            ]} />
            {c.leadId && <div style={{ fontSize: '0.8rem', marginTop: 10 }}><Link to={`/leads/${c.leadId}`}>View original lead</Link></div>}
          </div>
          <PresenceCard rec={c} entity={entity} />
          <NotesFeed postTo={entity} entities={[entity, ...(c.leadId ? [{ type: 'lead' as const, id: c.leadId }] : [])]} summary={c.notes} onSummary={(v) => save('notes', v)} />
          <button className="btn bad sm" onClick={() => { if (confirm('Delete this contact?')) { store.remove('contacts', c.id); navigate('/contacts'); } }}><Trash2 size={14} /> Delete contact</button>
        </div>
        <div className="stack">
          <TasksPanel entity={entity} />
          <Timeline entities={timelineEntities} title="Full history (lead + contact + deals)" />
        </div>
      </div>
      {newOpp && <NewOpportunity contact={c} onClose={() => setNewOpp(false)} onCreated={(o) => { params.set('opp', o.id); setParams(params); }} />}
      {openOpp && <OpportunityModal id={openOpp} onClose={() => { params.delete('opp'); setParams(params); }} />}
      {texting && <TextCompose entity={entity} onClose={() => setTexting(false)} />}
    </Page>
  );
}
