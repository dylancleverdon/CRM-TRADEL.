import { EyeOff, Reply } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { emailConnected, getFullEmail, markEmailsRead, type FullEmail } from '../lib/email';
import { when } from '../lib/format';
import { useRecord } from '../lib/store';
import { ComposeForm } from './EmailCompose';
import { entityLink } from './Tasks';
import { Modal } from './ui';

/**
 * Read an email in a window. Opening it marks it read (in Gmail too). Reply opens the same writer as New email
 * (templates, save as template, signature) right here, replying in the same thread.
 */
export function EmailReader({ activityId, onClose }: { activityId: string; onClose: () => void }) {
  const a = useRecord('activities', activityId);
  const [full, setFull] = useState<FullEmail | null>(null);
  const [err, setErr] = useState('');
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    if (a && a.direction === 'in' && !a.readAt) markEmailsRead([a.id]);
  }, [a?.id]);
  useEffect(() => {
    if (!a?.messageId || !emailConnected()) return;
    let live = true;
    getFullEmail(a.messageId).then((m) => live && setFull(m)).catch((e) => live && setErr(e?.message || String(e)));
    return () => { live = false; };
  }, [a?.messageId]);

  if (!a) return null;
  const incoming = a.direction === 'in';
  const subject = a.outcome.replace(/^(Sent|Received): /, '') || '(no subject)';
  const replyTo = incoming ? a.emailFrom || '' : (a.emailTo || '').split(',')[0].trim();
  const entity = a.entityType === 'lead' || a.entityType === 'contact' ? { type: a.entityType, id: a.entityId } : undefined;

  return (
    <Modal wide title={subject} onClose={onClose}>
      <div className="stack">
        <div style={{ fontSize: '0.88rem', lineHeight: 1.6 }}>
          <div><b>{incoming ? full?.fromName || a.entityName : 'You'}</b> <span className="faint">&lt;{a.emailFrom}&gt;</span></div>
          <div className="faint">To {a.emailTo}{full?.cc?.length ? ` · Cc ${full.cc.join(', ')}` : ''}</div>
          <div className="faint">
            {when(a.occurredAt)} · <Link to={entityLink(a.entityType, a.entityId)} onClick={onClose}>{a.entityName}</Link>
          </div>
        </div>
        <div className="email-body">{full?.body || a.notes}</div>
        {!full && !err && emailConnected() && a.messageId && <div className="faint" style={{ fontSize: '0.78rem' }}>Loading the full message…</div>}
        {err && <div className="faint" style={{ fontSize: '0.78rem' }}>Showing the preview: the full message couldn't be loaded ({err}).</div>}
        {replying ? (
          <div className="card" style={{ background: 'var(--bg-2)' }}>
            <ComposeForm target={{ entity, to: replyTo, threadId: a.threadId }} onDone={onClose} onCancel={() => setReplying(false)} />
          </div>
        ) : (
          <div className="row wrap">
            <button className="btn primary" onClick={() => setReplying(true)}><Reply size={15} /> Reply</button>
            {incoming && <button className="btn ghost" onClick={() => { markEmailsRead([a.id], false); onClose(); }}><EyeOff size={15} /> Mark unread</button>}
            <span className="spacer" />
            <button className="btn ghost" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
