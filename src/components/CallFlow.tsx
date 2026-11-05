import { App as CapApp } from '@capacitor/app';
import { Phone, PhoneOff } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { convertLead, createOpportunity, entityName, entityPhone, followUpDate, logCall, type Entity } from '../lib/actions';
import { CALL_OUTCOMES, DEFAULT_SERVICES } from '../lib/constants';
import { duration, formatPhone, fromLocalInput, toLocalInput } from '../lib/format';
import { getDesktopCallMode, ringPhone, waitForAck } from '../lib/deskphone';
import { isAndroid, isDesktop, placeCall } from '../lib/platform';
import { serviceList, toggleService } from '../lib/services';
import { getSetting, store } from '../lib/store';
import { Field, Modal, toast } from './ui';

interface PendingCall { entity: Entity; phone: string; startedAt: string; name: string }

interface CallCtx {
  startCall: (entity: Entity, phone?: string) => void;
  logManual: (entity: Entity) => void;
  onLogged: (fn: (() => void) | null) => void;
}

const Ctx = createContext<CallCtx>({ startCall: () => {}, logManual: () => {}, onLogged: () => {} });
export const useCall = () => useContext(Ctx);

const PENDING_KEY = 'tl.pendingCall';

export function CallProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<PendingCall | null>(null);
  const [showForm, setShowForm] = useState(false);
  const loggedCb = useRef<(() => void) | null>(null);

  // Resume flow on Android: after the dialer closes and the app comes back, prompt for the outcome.
  useEffect(() => {
    const saved = localStorage.getItem(PENDING_KEY);
    if (saved) {
      try { setActive(JSON.parse(saved)); setShowForm(true); } catch { /* ignore */ }
    }
    if (!isAndroid()) return;
    const h = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      const p = localStorage.getItem(PENDING_KEY);
      if (p) { setActive(JSON.parse(p)); setShowForm(true); }
    });
    return () => { h.then((x) => x.remove()); };
  }, []);

  const startCall = useCallback(async (entity: Entity, phone?: string) => {
    const num = phone || entityPhone(entity.type, entity.id);
    if (!num) { toast('No phone number on this record'); return; }
    const p: PendingCall = { entity, phone: num, startedAt: new Date().toISOString(), name: entityName(entity.type, entity.id) };
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    setActive(p);
    if (isDesktop() && getDesktopCallMode() === 'phone') {
      // Ring the Android phone: it dials, the outcome form stays here on the Mac.
      setShowForm(true);
      toast('📱 Sending call to your phone…');
      ringPhone({ number: num, name: p.name, entityType: entity.type, entityId: entity.id })
        .then(async (r) => {
          if (r.phoneSeenAgo < 0 || r.phoneSeenAgo > 20000)
            toast('Phone isn’t listening — open TradeLink on your phone and turn on Desk phone mode (request waits 45s)');
          const ok = await waitForAck(r.id, 45000);
          toast(ok ? '📞 Your phone is dialing' : 'Phone didn’t pick up the call request');
        })
        .catch((e) => toast(e?.message || 'Could not reach your phone'));
      return;
    }
    try {
      await placeCall(num);
    } catch (e: any) {
      toast(e?.message || 'Could not start call');
    }
    // On desktop the call happens on another device (iPhone/FaceTime), so show the form right away.
    if (!isAndroid()) setShowForm(true);
  }, []);

  const logManual = useCallback((entity: Entity) => {
    setActive({ entity, phone: entityPhone(entity.type, entity.id), startedAt: new Date().toISOString(), name: entityName(entity.type, entity.id) });
    setShowForm(true);
  }, []);

  const close = () => {
    localStorage.removeItem(PENDING_KEY);
    setShowForm(false);
    setActive(null);
  };

  return (
    <Ctx.Provider value={{ startCall, logManual, onLogged: (fn) => { loggedCb.current = fn; } }}>
      {children}
      {active && showForm && (
        <OutcomeForm call={active} onDone={() => { close(); loggedCb.current?.(); }} onCancel={close} />
      )}
    </Ctx.Provider>
  );
}

function OutcomeForm({ call, onDone, onCancel }: { call: PendingCall; onDone: () => void; onCancel: () => void }) {
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [durationMin, setDurationMin] = useState('');
  const [followUp, setFollowUp] = useState<string>('');
  const [followTitle, setFollowTitle] = useState('');
  const [convert, setConvert] = useState(true);
  const [service, setService] = useState('');
  const services = getSetting('services', DEFAULT_SERVICES);

  useEffect(() => {
    const start = new Date(call.startedAt).getTime();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [call.startedAt]);

  const pick = (name: string) => {
    setOutcome(name);
    const def = CALL_OUTCOMES.find((o) => o.name === name);
    if (def?.followUpDays !== undefined) setFollowUp(toLocalInput(followUpDate(def.followUpDays).toISOString()));
    else setFollowUp('');
    setFollowTitle(name === 'Meeting Booked' ? 'Discovery call' : `Call back (${name})`);
  };

  const quick = (days: number) => setFollowUp(toLocalInput(followUpDate(days).toISOString()));

  const save = () => {
    if (!outcome) { toast('Pick an outcome'); return; }
    const dur = durationMin ? Math.round(Number(durationMin) * 60) : elapsed;
    logCall({
      entity: call.entity,
      outcome,
      notes,
      durationSec: dur,
      phone: call.phone,
      followUp: followUp ? fromLocalInput(followUp) : null,
      followUpTitle: followTitle,
      startedAt: call.startedAt,
    });
    toast(`Logged: ${outcome}`);
    if (outcome === 'Meeting Booked' && call.entity.type === 'lead' && convert) {
      const lead = store.get('leads', call.entity.id);
      if (lead) {
        const contact = convertLead(lead);
        const opp = createOpportunity(contact, { service, stage: 'Discovery Booked', nextStep: followTitle || 'Discovery call' });
        onDone();
        navigate(`/contacts/${contact.id}?opp=${opp.id}`);
        return;
      }
    }
    onDone();
  };

  const isLead = call.entity.type === 'lead';

  return (
    <Modal
      title={<span className="row"><Phone size={18} /> Call outcome — {call.name}</span>}
      onClose={onCancel}
      footer={<>
        <button className="btn ghost" onClick={onCancel}><PhoneOff size={15} /> Discard</button>
        <button className="btn primary" onClick={save}>Save outcome</button>
      </>}
    >
      <div className="stack">
        <div className="row muted" style={{ fontSize: '0.85rem' }}>
          <span>{formatPhone(call.phone)}</span><span>•</span>
          <span>Started {new Date(call.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><span>•</span>
          <span>{duration(elapsed) || '0s'} ago</span>
        </div>
        <div>
          <div className="field" style={{ marginBottom: 6 }}>How did it go?</div>
          <div className="chips">
            {CALL_OUTCOMES.map((o) => (
              <button key={o.name} className={`chip ${o.color} ${outcome === o.name ? 'on' : ''}`} onClick={() => pick(o.name)}>{o.name}</button>
            ))}
          </div>
        </div>
        <Field label="Notes">
          <textarea autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened? Pain points, who you spoke with, objections…" rows={4} />
        </Field>
        <div className="form-grid">
          <Field label="Talk time (minutes, optional)">
            <input type="number" min="0" step="0.5" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} placeholder="auto" />
          </Field>
          <Field label="Follow-up">
            <input type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </Field>
          {followUp && (
            <Field label="Follow-up task" full>
              <input value={followTitle} onChange={(e) => setFollowTitle(e.target.value)} />
            </Field>
          )}
        </div>
        <div className="row wrap">
          <span className="faint" style={{ fontSize: '0.8rem' }}>Quick follow-up:</span>
          {[['Later today', 0], ['Tomorrow', 1], ['2 days', 2], ['1 week', 7], ['1 month', 30]].map(([l, d]) => (
            <button key={l} className="btn sm" onClick={() => quick(d as number)}>{l}</button>
          ))}
          {followUp && <button className="btn sm ghost" onClick={() => setFollowUp('')}>None</button>}
        </div>
        {outcome === 'Meeting Booked' && isLead && (
          <div className="card" style={{ background: 'var(--accent-soft)' }}>
            <label className="row" style={{ fontWeight: 600 }}>
              <input type="checkbox" checked={convert} onChange={(e) => setConvert(e.target.checked)} />
              Convert to contact & create an opportunity
            </label>
            {convert && (
              <div className="chips" style={{ marginTop: 10 }}>
                {services.map((s) => (
                  <button key={s} className={`chip ${serviceList(service).includes(s) ? 'on' : ''}`} onClick={() => setService(toggleService(service, s))}>{s}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
