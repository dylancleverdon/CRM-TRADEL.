import { Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { emailConnected, sendEmail } from '../lib/email';
import { DEFAULT_TEMPLATES, emailsIn, fillEmail, firstName, type EmailTemplate } from '../lib/emailmatch';
import { openExternal } from '../lib/platform';
import { getSetting, store, useSetting } from '../lib/store';
import type { EntityType } from '../lib/types';
import { Field, Modal, toast } from './ui';

export interface ComposeTarget { entity?: { type: EntityType; id: string }; to?: string; subject?: string; threadId?: string }

export function EmailCompose({ target, onClose }: { target: ComposeTarget; onClose: () => void }) {
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
  const [to, setTo] = useState(target.to || emailsIn(rec?.email || '')[0] || '');
  const [subject, setSubject] = useState(target.subject || '');
  const [body, setBody] = useState('');
  const [tpl, setTpl] = useState('');
  const [sending, setSending] = useState(false);
  const connected = emailConnected();

  const applyTemplate = (id: string) => {
    setTpl(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (!target.threadId) setSubject(fillEmail(t.subject, vars));
    setBody(fillEmail(t.body, vars));
  };

  const send = async () => {
    if (!emailsIn(to).length) { toast('Enter a valid email address'); return; }
    if (!connected) {
      openExternal(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
      onClose();
      return;
    }
    setSending(true);
    try {
      await sendEmail({ entity: target.entity, to, subject, body, threadId: target.threadId });
      toast('Email sent');
      onClose();
    } catch (e: any) {
      toast(`Send failed: ${e?.message || e}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal wide title={target.threadId ? 'Reply' : `Email${rec ? ` ${rec.company}` : ''}`} onClose={onClose}
      footer={<>
        {!connected && <span className="faint" style={{ marginRight: 'auto', fontSize: '0.8rem' }}>Email not connected — opens your mail app. <Link to="/email" onClick={onClose}>Connect</Link></span>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={sending} onClick={send}><Send size={15} /> {sending ? 'Sending…' : 'Send'}</button>
      </>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="To"><input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="owner@business.com" autoFocus={!to} /></Field>
          <Field label="Template">
            <select value={tpl} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">— none —</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {!target.threadId && <Field label="Subject" full><input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
          <Field label="Message" full><textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} autoFocus={!!to} /></Field>
        </div>
        <div className="faint" style={{ fontSize: '0.75rem' }}>Sent from your connected mailbox and logged to this {target.entity?.type || 'record'}'s history. Your signature from Email → Settings is added automatically.</div>
      </div>
    </Modal>
  );
}
