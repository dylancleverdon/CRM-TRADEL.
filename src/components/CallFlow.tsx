import { App as CapApp } from '@capacitor/app';
import { Phone, PhoneForwarded, PhoneOff } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { convertLead, createOpportunity, entityName, entityPhone, followUpDate, logCall, type Entity } from '../lib/actions';
import { CALL_OUTCOMES, DEFAULT_SERVICES } from '../lib/constants';
import { duration, formatPhone, fromLocalInput, toLocalInput } from '../lib/format';
import { getDesktopCallMode, ringPhone, waitForAck } from '../lib/deskphone';
import { emailConnected } from '../lib/email';
import { emailsIn } from '../lib/emailmatch';
import { isTyping, outcomeForKey, outcomeKey } from '../lib/keys';
import { bookMeeting, type Pick as MeetingPick } from '../lib/meetings';
import { isAndroid, isDesktop, placeCall } from '../lib/platform';
import { saveCalledNumber } from '../lib/phonecontacts';
import { fillText, getFollowUpText, sendFollowUpText } from '../lib/texts';
import { serviceList, toggleService } from '../lib/services';
import { getSetting, store } from '../lib/store';
import { MeetingPicker } from './MeetingPicker';
import { Field, Modal, toast } from './ui';

interface PendingCall { entity: Entity; phone: string; startedAt: string; name: string; pick?: string }

/** Call Mode registers this so the outcome form can offer "Save and call next". */
export interface NextHandler {
  /** True when this call is the business on Call Mode's screen, so there is a "next" to call. */
  canCallNext: (entity: Entity) => boolean;
  /** Runs once the outcome is saved: Call Mode calls whoever comes up next. */
  callNext: (entity: Entity) => void;
}

interface CallCtx {
  /** `pick`: why Call Mode is calling it, recorded on the call. */
  startCall: (entity: Entity, phone?: string, pick?: string) => void;
  logManual: (entity: Entity) => void;
  onLogged: (fn: (() => void) | null) => void;
  onNext: (h: NextHandler | null) => void;
}

const Ctx = createContext<CallCtx>({ startCall: () => {}, logManual: () => {}, onLogged: () => {}, onNext: () => {} });
export const useCall = () => useContext(Ctx);

const PENDING_KEY = 'tl.pendingCall';

export function CallProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<PendingCall | null>(null);
  const [showForm, setShowForm] = useState(false);
  const loggedCb = useRef<(() => void) | null>(null);
  const [nextHandler, setNextHandler] = useState<NextHandler | null>(null);
  const onNext = useCallback((h: NextHandler | null) => setNextHandler(() => h), []);

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

  const startCall = useCallback(async (entity: Entity, phone?: string, pick?: string) => {
    const num = phone || entityPhone(entity.type, entity.id);
    if (!num) { toast('No phone number on this record'); return; }
    const p: PendingCall = { entity, phone: num, startedAt: new Date().toISOString(), name: entityName(entity.type, entity.id), ...(pick ? { pick } : {}) };
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
    <Ctx.Provider value={{ startCall, logManual, onLogged: (fn) => { loggedCb.current = fn; }, onNext }}>
      {children}
      {active && showForm && (
        <OutcomeForm call={active} next={nextHandler} onDone={() => { close(); loggedCb.current?.(); }} onCancel={close} />
      )}
    </Ctx.Provider>
  );
}

function OutcomeForm({ call, next, onDone, onCancel }: {
  call: PendingCall; next: NextHandler | null; onDone: () => void; onCancel: () => void;
}) {
  const navigate = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [durationMin, setDurationMin] = useState('');
  const [followUp, setFollowUp] = useState<string>('');
  const [followTitle, setFollowTitle] = useState('');
  const [convert, setConvert] = useState(true);
  const [service, setService] = useState('');
  const [sendText, setSendText] = useState(() => localStorage.getItem('tl.autoText') === 'on');
  const services = getSetting('services', DEFAULT_SERVICES);
  // Meeting Booked: a Google Calendar invite with a Meet link (Google emails it), plus your confirmation email.
  const rec: any = call.entity.type === 'lead' ? store.get('leads', call.entity.id) : call.entity.type === 'contact' ? store.get('contacts', call.entity.id) : null;
  const canInvite = emailConnected() && (call.entity.type === 'lead' || call.entity.type === 'contact');
  const [invite, setInvite] = useState(() => localStorage.getItem('tl.autoInvite') !== 'off');
  const [inviteTo, setInviteTo] = useState(() => emailsIn(rec?.email || '')[0] || '');
  const [slot, setSlot] = useState<MeetingPick | null>(null);
  const [confirmMail, setConfirmMail] = useState(() => localStorage.getItem('tl.autoConfirm') !== 'off');

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

  // From Call Mode, for the business on screen: save, then call whoever is next.
  const canNext = !!next?.canCallNext(call.entity);
  const finish = (andNext: boolean) => {
    onDone();
    if (andNext) next?.callNext(call.entity);
  };

  const inviting = outcome === 'Meeting Booked' && canInvite && invite;
  const pickSlot = (p: MeetingPick | null) => {
    setSlot(p);
    if (p) { setFollowUp(toLocalInput(p.start.toISOString())); setFollowTitle('Discovery call'); } // the follow-up is the meeting
  };
  const book = (e: Entity) => {
    if (!inviting || !slot) return;
    toast('📅 Sending the calendar invite…');
    bookMeeting(e, emailsIn(inviteTo)[0], slot, confirmMail)
      .then((said) => said.forEach((m) => toast(m)))
      .catch((err) => toast(`Calendar invite not sent: ${err?.message || err}`));
  };

  const save = (andNext = false) => {
    if (!outcome) { toast('Pick an outcome'); return; }
    if (inviting && !slot) { toast('Pick the meeting time for the invite, or untick “Send a Google Calendar invite”'); return; }
    if (inviting && !emailsIn(inviteTo).length) { toast('Add their email so the invite can go out'); return; }
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
      pick: call.pick,
    });
    toast(`Logged: ${outcome}`);
    saveCalledNumber(call.entity, call.phone, outcome).then((m) => m && toast(m));
    if (sendText && connectedOutcome) {
      toast('📱 Sending your follow-up text…');
      sendFollowUpText(call.entity, call.phone, fillText(getFollowUpText(), call.entity))
        .then((m) => toast(`📱 ${m}`))
        .catch((e) => toast(`Follow-up text not sent: ${e?.message || e}`));
    }
    if (outcome === 'Meeting Booked' && call.entity.type === 'lead' && convert) {
      const lead = store.get('leads', call.entity.id);
      if (lead) {
        const contact = convertLead(lead);
        const opp = createOpportunity(contact, { service, stage: 'Discovery Booked', nextStep: followTitle || 'Discovery call' });
        book({ type: 'contact', id: contact.id });
        if (andNext) {
          // Done in the background so you keep dialing; it's under Contacts and Opportunities.
          toast(`🎉 ${contact.company || call.name} is now a contact with an opportunity`);
          finish(true);
          return;
        }
        onDone();
        navigate(`/contacts/${contact.id}?opp=${opp.id}`);
        return;
      }
    }
    book(call.entity);
    finish(andNext);
  };

  // Keys: 1–0 pick an outcome and N jumps to the notes (when you aren't typing); Enter saves (and calls next from
  // Call Mode), Shift+Enter is a new line; Esc stops typing, a second Esc discards.
  const keys = useRef({ save, pick, canNext });
  keys.current = { save, pick, canNext };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      const mine = bodyRef.current?.closest('.modal-back');
      const open = document.querySelectorAll('.modal-back');
      if (!mine || open[open.length - 1] !== mine) return; // another window is open on top of this one
      const t = e.target as HTMLElement | null;
      const typing = isTyping(t);
      if (e.key === 'Escape' && typing) {
        e.preventDefault(); e.stopPropagation(); t?.blur();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        if (t?.closest?.('.modal-foot, .modal-head')) return; // a focused button there does its own thing
        e.preventDefault();
        keys.current.save(keys.current.canNext);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const name = outcomeForKey(e.key);
      if (name) { e.preventDefault(); keys.current.pick(name); return; }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); notesRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey, true); // capture: runs before the window's Esc-to-close
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const isLead = call.entity.type === 'lead';
  const connectedOutcome = !!CALL_OUTCOMES.find((o) => o.name === outcome)?.connected;

  return (
    <Modal
      wide={inviting}
      title={<span className="row"><Phone size={18} /> Call outcome — {call.name}</span>}
      onClose={onCancel}
      footer={<>
        <button className="btn ghost" onClick={onCancel}><PhoneOff size={15} /> Discard</button>
        {canNext ? <>
          <button className="btn" onClick={() => save(false)}>Save</button>
          <button className="btn primary" onClick={() => save(true)} title="Enter"><PhoneForwarded size={15} /> Save and call next</button>
        </> : <button className="btn primary" onClick={() => save(false)} title="Enter">Save outcome</button>}
      </>}
    >
      <div className="stack" ref={bodyRef}>
        <div className="row muted" style={{ fontSize: '0.85rem' }}>
          <span>{formatPhone(call.phone)}</span><span>•</span>
          <span>Started {new Date(call.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><span>•</span>
          <span>{duration(elapsed) || '0s'} ago</span>
        </div>
        <div>
          <div className="field" style={{ marginBottom: 6 }}>How did it go?</div>
          <div className="chips">
            {CALL_OUTCOMES.map((o) => {
              const k = outcomeKey(o.name);
              return (
                <button key={o.name} className={`chip ${o.color} ${outcome === o.name ? 'on' : ''}`} onClick={() => pick(o.name)} title={k ? `Key ${k}` : undefined}>
                  {k && <kbd className="key">{k}</kbd>}{o.name}
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Notes">
          <textarea ref={notesRef} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened? Pain points, who you spoke with, objections…" rows={4} />
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
        {connectedOutcome && (
          <label className="row" style={{ fontSize: '0.88rem', fontWeight: 600 }}>
            <input type="checkbox" checked={sendText} onChange={(e) => { setSendText(e.target.checked); localStorage.setItem('tl.autoText', e.target.checked ? 'on' : 'off'); }} />
            📱 Text them my follow-up message (from my phone)
          </label>
        )}
        {outcome === 'Meeting Booked' && canInvite && (
          <div className="card" style={{ background: 'var(--accent-soft)' }}>
            <label className="row" style={{ fontWeight: 600 }}>
              <input type="checkbox" checked={invite} onChange={(e) => { setInvite(e.target.checked); localStorage.setItem('tl.autoInvite', e.target.checked ? 'on' : 'off'); }} />
              📅 Send a Google Calendar invite with a Meet link
            </label>
            {invite && (
              <div className="stack" style={{ marginTop: 10, gap: 10 }}>
                <Field label="Their email"><input type="email" value={inviteTo} onChange={(e) => setInviteTo(e.target.value)} placeholder="owner@business.com" /></Field>
                <MeetingPicker value={slot} onChange={pickSlot} />
                <label className="row" style={{ fontSize: '0.88rem' }}>
                  <input type="checkbox" checked={confirmMail} onChange={(e) => { setConfirmMail(e.target.checked); localStorage.setItem('tl.autoConfirm', e.target.checked ? 'on' : 'off'); }} />
                  Also send my “Meeting confirmation” email, with the time and Meet link
                </label>
              </div>
            )}
          </div>
        )}
        {outcome === 'Meeting Booked' && !canInvite && (call.entity.type === 'lead' || call.entity.type === 'contact') && (
          <div className="faint" style={{ fontSize: '0.8rem' }}>Connect your email (Email tab) to send a Google Calendar invite from here.</div>
        )}
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
        <div className="key-legend">
          <kbd className="key">1</kbd>–<kbd className="key">0</kbd> outcome · <kbd className="key">N</kbd> notes ·{' '}
          <kbd className="key">Enter</kbd> {canNext ? 'save and call next' : 'save'} · <kbd className="key">Shift</kbd>+<kbd className="key">Enter</kbd> new line · <kbd className="key">Esc</kbd> discard
        </div>
      </div>
    </Modal>
  );
}
