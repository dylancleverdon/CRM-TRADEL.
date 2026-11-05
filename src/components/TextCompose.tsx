import { MessageSquare, Save } from 'lucide-react';
import { useState } from 'react';
import { unfillEmail, firstName } from '../lib/emailmatch';
import { formatPhone } from '../lib/format';
import { getSetting, setSetting, store, useSetting } from '../lib/store';
import { DEFAULT_FOLLOW_UP_TEXT, fillText, sendFollowUpText, textRoute } from '../lib/texts';
import type { EntityType } from '../lib/types';
import { Field, Modal, toast } from './ui';

/** Text a lead or contact from your own number (on the Mac it goes out through your phone). */
export function TextCompose({ entity, phone, onClose }: { entity: { type: EntityType; id: string }; phone?: string; onClose: () => void }) {
  const tpl = useSetting('followUpText', DEFAULT_FOLLOW_UP_TEXT);
  const rec: any = entity.type === 'lead' ? store.get('leads', entity.id) : store.get('contacts', entity.id);
  const numbers = [rec?.phone, rec?.altPhone].filter(Boolean) as string[];
  const [to, setTo] = useState(phone || numbers[0] || '');
  const [body, setBody] = useState(() => fillText(tpl || DEFAULT_FOLLOW_UP_TEXT, entity));
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const route = textRoute();
  const parts = body.length > 160 ? Math.ceil(body.length / 153) : 1;

  const send = async () => {
    setSending(true);
    try {
      toast(`📱 ${await sendFollowUpText(entity, to, body, setStatus)}`);
      onClose();
    } catch (e: any) {
      setStatus('');
      toast(e?.message || String(e));
    } finally {
      setSending(false);
    }
  };
  const saveDefault = () => {
    const vars = { firstName: firstName(rec?.contactName || ''), name: rec?.contactName || '', company: rec?.company || '', myName: getSetting('myName', '') || 'Dylan' };
    setSetting('followUpText', unfillEmail(body, vars));
    toast('Saved as your default follow-up text');
  };

  return (
    <Modal title={<span className="row"><MessageSquare size={18} /> Text {rec?.company || 'contact'}</span>} onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={sending || !to || !body.trim()} onClick={send}>
          <MessageSquare size={15} /> {sending ? 'Sending…' : route.route === 'relay' ? 'Send from my phone' : 'Send'}
        </button>
      </>}>
      <div className="stack">
        {route.route === 'none' && <div className="banner warn" style={{ borderRadius: 10 }}>{route.why}</div>}
        <Field label="To">
          {numbers.length > 1
            ? <select value={to} onChange={(e) => setTo(e.target.value)}>{numbers.map((n) => <option key={n} value={n}>{formatPhone(n)}</option>)}</select>
            : <input type="tel" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Phone number" />}
        </Field>
        <Field label="Message"><textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} autoFocus /></Field>
        <div className="row wrap">
          <button className="btn ghost sm" onClick={saveDefault}><Save size={14} /> Save as my default text</button>
          <span className="spacer" />
          <span className="faint" style={{ fontSize: '0.75rem' }}>{body.length} characters{parts > 1 ? ` · arrives as one message (${parts} parts)` : ''}</span>
        </div>
        {status && <div className="faint" style={{ fontSize: '0.82rem' }}>{status}</div>}
        {route.route === 'relay' && !status && (
          <div className="faint" style={{ fontSize: '0.75rem' }}>Sent from your own number by your phone: keep TradeLink open on it with Desk phone mode on. It's saved to this {entity.type}'s history.</div>
        )}
      </div>
    </Modal>
  );
}
