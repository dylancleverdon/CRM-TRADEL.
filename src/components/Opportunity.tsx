import { Phone, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createOpportunity, setOpportunityStage, stages } from '../lib/actions';
import { DEFAULT_SERVICES, LOST_REASONS } from '../lib/constants';
import { money, shortDate } from '../lib/format';
import { serviceLabel, serviceList, toggleService } from '../lib/services';
import { getSetting, store, useRecord } from '../lib/store';
import type { Contact, Opportunity } from '../lib/types';
import { useCall } from './CallFlow';
import { NotesFeed } from './Notes';
import { TasksPanel } from './Tasks';
import { Timeline } from './Timeline';
import { Field, InlineInput, Modal, StatusPill } from './ui';

export function NewOpportunity({ contact, onClose, onCreated }: { contact: Contact; onClose: () => void; onCreated?: (o: Opportunity) => void }) {
  const services = getSetting('services', DEFAULT_SERVICES);
  const st = stages().filter((s) => !s.closed);
  const [service, setService] = useState('');
  const [stage, setStage] = useState(st[0]?.name || '');
  const [monthly, setMonthly] = useState('');
  const [setup, setSetup] = useState('');
  const [close, setClose] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [name, setName] = useState('');
  const save = () => {
    const o = createOpportunity(contact, {
      name: name || `${contact.company} - ${serviceLabel(service) || 'Marketing'}`, service, stage, monthlyValue: Number(monthly) || 0, setupFee: Number(setup) || 0,
      expectedCloseDate: close, nextStep,
    });
    onCreated?.(o);
    onClose();
  };
  return (
    <Modal title={`New opportunity — ${contact.company}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Create</button></>}>
      <div className="stack">
        <Field label="Services (pick as many as you like)">
          <div className="chips" style={{ marginTop: 4 }}>{services.map((s) => <button key={s} className={`chip ${serviceList(service).includes(s) ? 'on' : ''}`} onClick={() => setService(toggleService(service, s))}>{s}</button>)}</div>
        </Field>
        <div className="form-grid">
          <Field label="Name (optional)" full><input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${contact.company} - ${serviceLabel(service) || 'Marketing'}`} /></Field>
          <Field label="Stage"><select value={stage} onChange={(e) => setStage(e.target.value)}>{st.map((s) => <option key={s.name}>{s.name}</option>)}</select></Field>
          <Field label="Expected close"><input type="date" value={close} onChange={(e) => setClose(e.target.value)} /></Field>
          <Field label="Monthly value ($/mo)"><input type="number" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="1500" /></Field>
          <Field label="Setup fee ($)"><input type="number" value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="0" /></Field>
          <Field label="Next step" full><input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="Discovery call Tue 2pm" /></Field>
        </div>
      </div>
    </Modal>
  );
}

export function OpportunityModal({ id, onClose }: { id: string; onClose: () => void }) {
  const o = useRecord('opportunities', id);
  const contact = useRecord('contacts', o?.contactId);
  const services = getSetting('services', DEFAULT_SERVICES);
  const { startCall } = useCall();
  const [lostAsk, setLostAsk] = useState(false);
  if (!o) return null;
  const save = (k: keyof Opportunity, v: any) => store.upsert('opportunities', { id: o.id, [k]: v });
  const st = stages();
  const stageChange = (s: string) => {
    if (st.find((x) => x.name === s)?.closed === 'lost') setLostAsk(true);
    setOpportunityStage(o, s);
  };
  return (
    <Modal wide title={o.name} onClose={onClose}
      footer={<>
        <button className="btn bad" style={{ marginRight: 'auto' }} onClick={() => { if (confirm('Delete this opportunity?')) { store.remove('opportunities', o.id); onClose(); } }}><Trash2 size={14} /> Delete</button>
        {contact?.phone && <button className="btn call" onClick={() => startCall({ type: 'contact', id: contact.id })}><Phone size={14} /> Call {contact.contactName || contact.company}</button>}
        <button className="btn primary" onClick={onClose}>Done</button>
      </>}>
      <div className="stack">
        <div className="chips">
          {st.map((s) => (
            <button key={s.name} className={`chip ${o.stage === s.name ? `on ${s.closed === 'won' ? 'good' : s.closed === 'lost' ? 'bad' : ''}` : ''}`} onClick={() => stageChange(s.name)}>{s.name}</button>
          ))}
        </div>
        {(lostAsk || st.find((x) => x.name === o.stage)?.closed === 'lost') && (
          <Field label="Lost reason">
            <select value={o.lostReason} onChange={(e) => { save('lostReason', e.target.value); setLostAsk(false); }}>
              <option value="">—</option>{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
        )}
        <div className="split">
          <div className="stack">
            <div className="card">
              <div className="form-grid">
                <Field label="Name" full><InlineInput value={o.name} onSave={(v) => save('name', v)} /></Field>
                <Field label="Services" full>
                  <div className="chips" style={{ marginTop: 4 }}>
                    {services.concat(serviceList(o.service).filter((s) => !services.includes(s))).map((s) => (
                      <button key={s} className={`chip ${serviceList(o.service).includes(s) ? 'on' : ''}`} onClick={() => save('service', toggleService(o.service, s))}>{s}</button>
                    ))}
                  </div>
                </Field>
                <Field label="Probability %"><InlineInput type="number" value={o.probability} onSave={(v) => save('probability', Number(v) || 0)} /></Field>
                <Field label="Monthly value ($/mo)"><InlineInput type="number" value={o.monthlyValue} onSave={(v) => save('monthlyValue', Number(v) || 0)} /></Field>
                <Field label="Setup fee ($)"><InlineInput type="number" value={o.setupFee} onSave={(v) => save('setupFee', Number(v) || 0)} /></Field>
                <Field label="Expected close"><input type="date" value={o.expectedCloseDate?.slice(0, 10) || ''} onChange={(e) => save('expectedCloseDate', e.target.value)} /></Field>
                <Field label="Next step"><InlineInput value={o.nextStep} onSave={(v) => save('nextStep', v)} /></Field>
              </div>
              {contact && (
                <div className="row" style={{ marginTop: 12, fontSize: '0.85rem' }}>
                  Contact: <Link to={`/contacts/${contact.id}`} onClick={onClose}>{contact.company}{contact.contactName ? ` (${contact.contactName})` : ''}</Link>
                  <StatusPill status={contact.status} />
                </div>
              )}
              <div className="faint" style={{ fontSize: '0.8rem', marginTop: 8 }}>
                Annual value {money(o.monthlyValue * 12 + o.setupFee)} · weighted {money((o.monthlyValue * o.probability) / 100)}/mo
              </div>
            </div>
            <NotesFeed postTo={{ type: 'opportunity', id: o.id }} summary={o.notes} onSummary={(v) => save('notes', v)} title="Opportunity notes" />
          </div>
          <div className="stack">
            <TasksPanel entity={{ type: 'opportunity', id: o.id }} />
            <Timeline entities={[{ type: 'opportunity', id: o.id }]} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function OppCard({ o, onClick, draggable, onDragStart, onDragEnd, dragging }: {
  o: Opportunity; onClick: () => void; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void; dragging?: boolean;
}) {
  const contact = store.get('contacts', o.contactId);
  const overdue = o.expectedCloseDate && o.expectedCloseDate < new Date().toISOString().slice(0, 10);
  return (
    <div className={`kcard ${dragging ? 'dragging' : ''}`} onClick={onClick} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="t">{contact?.company || o.name}</div>
      <div className="m">{serviceLabel(o.service) || '—'}</div>
      <div className="row" style={{ marginTop: 6 }}>
        <b style={{ fontSize: '0.85rem' }}>{money(o.monthlyValue)}<span className="faint">/mo</span></b>
        <span className="spacer" />
        {o.expectedCloseDate && <span className={`pill ${overdue ? 'bad' : ''}`}>{shortDate(o.expectedCloseDate + 'T12:00:00')}</span>}
      </div>
      {o.nextStep && <div className="m" style={{ marginTop: 4 }}>→ {o.nextStep}</div>}
    </div>
  );
}
