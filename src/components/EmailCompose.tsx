import { CalendarPlus, Save, Send, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { emailConnected, sendEmail } from '../lib/email';
import { DEFAULT_TEMPLATES, emailsIn, fillEmail, firstName, unfillEmail, type EmailTemplate } from '../lib/emailmatch';
import { createInvite, meetingWhen, withMeeting, withMeetingPlaceholders, type Booked, type Pick as MeetingPick } from '../lib/meetings';
import { openExternal } from '../lib/platform';
import { getSetting, setSetting, store, uid, useSetting } from '../lib/store';
import type { EntityType } from '../lib/types';
import { MeetingPicker } from './MeetingPicker';
import { Field, Modal, toast } from './ui';

export interface ComposeTarget { entity?: { type: EntityType; id: string }; to?: string; subject?: string; threadId?: string }

/** The "New email" window. */
export function EmailCompose({ target, onClose }: { target: ComposeTarget; onClose: () => void }) {
  const rec: any = target.entity ? store.get(target.entity.type === 'lead' ? 'leads' : 'contacts', target.entity.id) : null;
  return (
    <Modal wide title={target.threadId ? 'Reply' : `Email${rec ? ` ${rec.company}` : ''}`} onClose={onClose}>
      <ComposeForm target={target} onDone={onClose} onCancel={onClose} />
    </Modal>
  );
}

/**
 * The email writer, used by New email and by Reply in the email reader: templates, save as a new template or
 * update the one you started from, signature, send.
 */
export function ComposeForm({ target, onDone, onCancel }: { target: ComposeTarget; onDone: () => void; onCancel: () => void }) {
  const templates = useSetting<EmailTemplate[]>('emailTemplates', DEFAULT_TEMPLATES);
  const rec: any = target.entity ? store.get(target.entity.type === 'lead' ? 'leads' : 'contacts', target.entity.id) : null;
  const vars = useMemo(() => ({
    company: rec?.company || '',
    name: rec?.contactName || '',
    firstName: firstName(rec?.contactName || ''),
    trade: (rec?.trade || 'home service').toLowerCase(),
    city: rec?.city || 'your area',
    myName: getSetting('myName', '') || 'Dylan',
  }), [rec]);
  const reply = !!target.threadId;
  const [to, setTo] = useState(target.to || emailsIn(rec?.email || '')[0] || '');
  const [subject, setSubject] = useState(target.subject || '');
  const [body, setBody] = useState('');
  const [tpl, setTpl] = useState('');
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState<'new' | 'update' | null>(null);
  const connected = emailConnected();
  // Add meeting invite: a Google Calendar invite with a Meet link goes out when you send, and the time and link
  // are filled into the message.
  const canInvite = connected && (target.entity?.type === 'lead' || target.entity?.type === 'contact');
  const [meeting, setMeeting] = useState<MeetingPick | null>(null);
  const [picking, setPicking] = useState(false);
  const booked = useRef<Booked | null>(null); // the invite already went out (don't book twice if the email fails)
  const pickMeeting = (p: MeetingPick | null) => {
    setMeeting(p);
    booked.current = null;
    if (p) setBody((b) => withMeetingPlaceholders(b));
  };
  const removeMeeting = () => {
    setMeeting(null);
    setPicking(false);
    setBody((b) => b.replace(/\n*\{meetingTime\}\nGoogle Meet: \{meetLink\}\n*/, '\n\n').replace(/^\n+/, ''));
  };
  const current = templates.find((t) => t.id === tpl);
  const changed = !!current && (body !== fillEmail(current.body, vars) || (!reply && subject !== fillEmail(current.subject, vars)));

  const applyTemplate = (id: string) => {
    setTpl(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (!reply) setSubject(fillEmail(t.subject, vars));
    setBody(fillEmail(t.body, vars));
  };

  const send = async () => {
    if (!emailsIn(to).length) { toast('Enter a valid email address'); return; }
    if (!connected) {
      openExternal(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
      onDone();
      return;
    }
    setSending(true);
    try {
      let text = body;
      if (meeting && target.entity) {
        try {
          if (!booked.current) booked.current = await createInvite(target.entity, emailsIn(to)[0], meeting);
        } catch (e: any) {
          toast(`Invite not sent, so the email wasn't either: ${e?.message || e}`);
          return;
        }
        text = withMeeting(body, booked.current.when, booked.current.meetLink);
      }
      try {
        await sendEmail({ entity: target.entity, to, subject, body: text, threadId: target.threadId });
      } catch (e: any) {
        toast(booked.current ? `The invite went out, but the email didn't: ${e?.message || e}. Send again to retry the email.` : `Send failed: ${e?.message || e}`);
        return;
      }
      toast(meeting ? '📅 Invite and email sent' : 'Email sent');
      onDone();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="To"><input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="owner@business.com" autoFocus={!to} /></Field>
        <Field label="Template">
          <select value={tpl} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">— none —</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        {!reply && <Field label="Subject" full><input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
        <Field label="Message" full><textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} autoFocus={!!to} /></Field>
      </div>
      {canInvite && picking && (
        <div className="card" style={{ background: 'var(--accent-soft)' }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <b style={{ fontSize: '0.9rem' }}>📅 Meeting invite</b>
            <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={removeMeeting}><X size={14} /> Remove</button>
          </div>
          <MeetingPicker value={meeting} onChange={pickMeeting} />
          {meeting && (
            <div className="faint" style={{ fontSize: '0.78rem', marginTop: 8 }}>
              When you send: Google emails {emailsIn(to)[0] || 'them'} the invite for {meetingWhen(meeting.start, meeting.end)} with a Google Meet link,
              and {'{meetingTime}'} and {'{meetLink}'} in your message are filled in.
            </div>
          )}
        </div>
      )}
      <div className="row wrap" style={{ gap: 6 }}>
        {canInvite && !picking && <button className="btn ghost sm" onClick={() => setPicking(true)}><CalendarPlus size={14} /> Add meeting invite</button>}
        <button className="btn ghost sm" disabled={!body.trim()} onClick={() => setSaving('new')}><Save size={14} /> Save as new template</button>
        {current && changed && <button className="btn ghost sm" onClick={() => setSaving('update')}><Save size={14} /> Update “{current.name}”</button>}
        <span className="spacer" />
        {!connected && <span className="faint" style={{ fontSize: '0.8rem' }}>Email not connected: opens your mail app. <Link to="/email" onClick={onCancel}>Connect</Link></span>}
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={sending || (picking && !meeting)} onClick={send} title={picking && !meeting ? 'Pick the meeting time, or remove the invite' : undefined}>
          <Send size={15} /> {sending ? 'Sending…' : meeting ? 'Send invite & email' : 'Send'}
        </button>
      </div>
      <div className="faint" style={{ fontSize: '0.75rem' }}>Sent from your connected mailbox and logged to this {target.entity?.type || 'record'}'s history. Your signature from Email → Settings is added automatically.</div>
      {saving && (
        <SaveTemplate
          mode={saving}
          existing={current}
          subject={reply ? undefined : unfillEmail(subject, vars)}
          body={unfillEmail(body, vars)}
          onClose={() => setSaving(null)}
          onSaved={(t) => setTpl(t.id)}
        />
      )}
    </div>
  );
}

/**
 * Save what you wrote as a template, or as the new version of the template you started from. The person's
 * details are turned back into {placeholders} first, so check them before saving.
 */
function SaveTemplate({ mode, existing, subject, body, onClose, onSaved }: {
  mode: 'new' | 'update'; existing?: EmailTemplate; subject?: string; body: string; onClose: () => void; onSaved: (t: EmailTemplate) => void;
}) {
  const templates = useSetting<EmailTemplate[]>('emailTemplates', DEFAULT_TEMPLATES);
  const updating = mode === 'update' && !!existing;
  const [name, setName] = useState(updating ? existing!.name : '');
  const [subj, setSubj] = useState(subject ?? existing?.subject ?? '');
  const [text, setText] = useState(body);
  const save = () => {
    if (!updating && !name.trim()) { toast('Give the template a name'); return; }
    const t: EmailTemplate = updating
      ? { ...existing!, name: name.trim() || existing!.name, subject: subj, body: text }
      : { id: uid(), name: name.trim(), subject: subj, body: text };
    setSetting('emailTemplates', updating ? templates.map((x) => (x.id === t.id ? t : x)) : [...templates, t]);
    toast(updating ? `Template “${t.name}” updated` : `Saved as template “${t.name}”`);
    onSaved(t);
    onClose();
  };
  return (
    <Modal wide title={updating ? `Update template “${existing!.name}”` : 'Save as a new template'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>{updating ? 'Update template' : 'Save template'}</button></>}>
      <div className="form-grid">
        <Field label="Template name" full><input value={name} autoFocus={!updating} onChange={(e) => setName(e.target.value)} placeholder="e.g. After a good call" /></Field>
        <Field label="Subject" full><input value={subj} onChange={(e) => setSubj(e.target.value)} /></Field>
        <Field label="Message" full><textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </div>
      <div className="faint" style={{ fontSize: '0.78rem', marginTop: 8 }}>
        Their name, company, city and trade were turned back into {'{firstName}'}, {'{company}'}, {'{city}'}… so the template works for anyone. Check them before saving.
      </div>
    </Modal>
  );
}
