import { Copy, Inbox, Link2, Mail, Plus, RefreshCw, Reply, Trash2, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import loaderCode from '../../apps-script/EmailLoader.gs?raw';
import { EmailCompose, type ComposeTarget } from '../components/EmailCompose';
import { Page } from '../components/Layout';
import { entityLink } from '../components/Tasks';
import { Empty, Field, InlineInput, Modal, toast } from '../components/ui';
import { logActivity } from '../lib/actions';
import { ago, when } from '../lib/format';
import { backfillAddress, checkEmail, connectEmail, disconnectEmail, useEmail } from '../lib/email';
import { DEFAULT_TEMPLATES, needsReply, normEmail, type EmailMessage, type EmailTemplate } from '../lib/emailmatch';
import { setSetting, store, uid, useSetting, useTable } from '../lib/store';

type Tab = 'reply' | 'all' | 'other' | 'templates' | 'settings';

export default function EmailPage() {
  const em = useEmail();
  const acts = useTable('activities');
  const [tab, setTab] = useState<Tab>('reply');
  const [compose, setCompose] = useState<ComposeTarget | null>(null);
  const navigate = useNavigate();
  const emails = useMemo(() => acts.filter((a) => a.type === 'email').sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [acts]);
  const waiting = useMemo(() => needsReply(emails), [emails]);

  if (em.status === 'not-connected') return <Page title="Email"><ConnectCard /></Page>;

  return (
    <Page
      title="Email"
      sub={<>Connected as <b>{em.me}</b> · {em.status === 'checking' ? 'checking…' : em.lastChecked ? `checked ${ago(new Date(em.lastChecked).toISOString())}` : 'not checked yet'}</>}
      actions={<>
        <button className="btn" onClick={() => checkEmail()}><RefreshCw size={15} className={em.status === 'checking' ? 'spin' : ''} /> Check now</button>
        <button className="btn primary" onClick={() => setCompose({})}><Plus size={15} /> New email</button>
      </>}
    >
      <div className="stack">
        {em.status === 'error' && <div className="banner bad" style={{ borderRadius: 10 }}>Email error: {em.error}</div>}
        <div className="tabs" style={{ width: 'fit-content', maxWidth: '100%' }}>
          <button className={tab === 'reply' ? 'on' : ''} onClick={() => setTab('reply')}>Needs reply<span className="n">{waiting.length}</span></button>
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>Leads & contacts<span className="n">{emails.length}</span></button>
          <button className={tab === 'other' ? 'on' : ''} onClick={() => setTab('other')}>Other inbox<span className="n">{em.other.length}</span></button>
          <button className={tab === 'templates' ? 'on' : ''} onClick={() => setTab('templates')}>Templates</button>
          <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>Settings</button>
        </div>

        {tab === 'reply' && (
          <div className="card" style={{ padding: '6px 14px' }}>
            {waiting.length === 0 && <Empty>No replies waiting. 🎉</Empty>}
            {waiting.map((a) => (
              <div className="list-item" key={a.id}>
                <div className="grow clickable" onClick={() => navigate(entityLink(a.entityType, a.entityId))}>
                  <div className="title">{a.entityName} <span className="faint" style={{ fontWeight: 500 }}>· {a.emailFrom}</span></div>
                  <div className="meta">{a.outcome.replace(/^Received: /, '')} — {a.notes.slice(0, 140)}</div>
                </div>
                <span className="faint" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{when(a.occurredAt)}</span>
                <button className="btn sm" onClick={() => setCompose({ entity: { type: a.entityType as any, id: a.entityId }, to: a.emailFrom, threadId: a.threadId })}><Reply size={14} /> Reply</button>
              </div>
            ))}
          </div>
        )}

        {tab === 'all' && (
          <div className="card" style={{ padding: '6px 14px' }}>
            {emails.length === 0 && <Empty>No emails with leads or contacts yet. Emails to or from any address saved on a lead/contact appear here automatically.</Empty>}
            {emails.slice(0, 300).map((a) => (
              <div className="list-item clickable" key={a.id} onClick={() => navigate(entityLink(a.entityType, a.entityId))}>
                <span className={`pill ${a.direction === 'in' ? 'info' : 'accent'}`}>{a.direction === 'in' ? 'In' : 'Out'}</span>
                <div className="grow">
                  <div className="title">{a.entityName} — {a.outcome.replace(/^(Sent|Received): /, '')}</div>
                  <div className="meta">{a.notes.slice(0, 160)}</div>
                </div>
                <span className="faint" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{when(a.occurredAt)}</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'other' && <OtherInbox onReply={(m) => setCompose({ to: m.from, threadId: m.threadId })} />}
        {tab === 'templates' && <Templates />}
        {tab === 'settings' && <EmailSettings />}
      </div>
      {compose && <EmailCompose target={compose} onClose={() => setCompose(null)} />}
    </Page>
  );
}

function ConnectCard() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    try { toast(`Connected ${await connectEmail(url)}`); } catch (e: any) { toast(`Could not connect: ${e?.message || e}`); } finally { setBusy(false); }
  };
  return (
    <div className="split">
      <div className="card">
        <div className="card-head"><Mail size={16} /><h3>Connect your email</h3></div>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: '0.9rem', lineHeight: 1.75 }}>
          <li>Sign in to Google as <b>Dylan@tradelink.marketing</b> (the mailbox you want connected).</li>
          <li>Open <b>script.google.com</b> → <b>New project</b>. Name it "TradeLink Email". Delete the starter code and paste the connector (copy button below). Click <b>Save</b>.</li>
          <li>Pick <b>updateNow</b> in the toolbar's function menu and click <b>▶ Run</b>. Approve the permissions (Advanced → Go to project → Allow).</li>
          <li><b>Deploy → New deployment</b> → type <b>Web app</b>. Execute as <b>Me</b>, Who has access <b>Anyone</b>. Click Deploy and copy the Web app URL.</li>
          <li>Paste the URL below. Do this once on the Mac and once on your phone.</li>
        </ol>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => { navigator.clipboard.writeText(loaderCode); toast('Connector copied'); }}><Copy size={14} /> Copy email connector code</button>
      </div>
      <div className="card">
        <div className="card-head"><h3>Connector URL</h3></div>
        <div className="stack">
          <Field label="Web app URL (ends in /exec)"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" /></Field>
          <button className="btn primary" disabled={!url || busy} onClick={connect}>{busy ? 'Connecting…' : 'Connect email'}</button>
          <div className="faint" style={{ fontSize: '0.78rem' }}>
            🔒 This URL is stored only on this device — it is never saved to your Google Sheet or shared, because anyone with it could read and send email from your mailbox. Only emails with your leads and contacts are logged in the CRM.
          </div>
        </div>
      </div>
    </div>
  );
}

function OtherInbox({ onReply }: { onReply: (m: EmailMessage) => void }) {
  const em = useEmail();
  const [linking, setLinking] = useState<EmailMessage | null>(null);
  const navigate = useNavigate();
  const addLead = async (m: EmailMessage) => {
    const domain = m.from.split('@')[1] || '';
    const lead = store.upsert('leads', {
      company: m.fromName || domain, contactName: m.fromName, email: m.from, phone: '', altPhone: '', website: /gmail|yahoo|outlook|hotmail|icloud|aol/.test(domain) ? '' : domain,
      trade: '', city: '', state: 'WA', address: '', source: 'Email', status: 'Connected', quality: '', disqualifyReason: '', tags: '',
      attempts: 0, lastContactedAt: '', lastOutcome: '', nextFollowUpAt: '', notes: '', convertedContactId: '',
    });
    logActivity({ type: 'lead', id: lead.id }, { type: 'created', outcome: 'Lead added from email' });
    await backfillAddress(m.from);
    toast('Lead created and emails linked');
    navigate(`/leads/${lead.id}`);
  };
  return (
    <div className="card" style={{ padding: '6px 14px' }}>
      <div className="faint" style={{ fontSize: '0.78rem', padding: '6px 0' }}>Recent mail from addresses that aren't on any lead or contact. Shown only on this device — not saved to the CRM unless you link it.</div>
      {em.other.length === 0 && <Empty>Nothing here.</Empty>}
      {em.other.slice(0, 100).map((m) => (
        <div className="list-item" key={m.id}>
          <Inbox size={15} color="var(--text-3)" />
          <div className="grow">
            <div className="title">{m.fromName || m.from} <span className="faint" style={{ fontWeight: 500 }}>· {m.from}</span></div>
            <div className="meta">{m.subject} — {m.snippet.slice(0, 120)}</div>
          </div>
          <span className="faint hide-mobile" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{when(m.date)}</span>
          <button className="btn sm ghost" title="Link to a lead/contact" onClick={() => setLinking(m)}><Link2 size={14} /></button>
          <button className="btn sm ghost" title="Create lead" onClick={() => addLead(m)}><UserPlus size={14} /></button>
          <button className="btn sm ghost" title="Reply" onClick={() => onReply(m)}><Reply size={14} /></button>
        </div>
      ))}
      {linking && <LinkModal msg={linking} onClose={() => setLinking(null)} />}
    </div>
  );
}

function LinkModal({ msg, onClose }: { msg: EmailMessage; onClose: () => void }) {
  const leads = useTable('leads');
  const contacts = useTable('contacts');
  const [q, setQ] = useState('');
  const ql = q.toLowerCase();
  const results = q.length < 2 ? [] : [
    ...contacts.filter((c) => c.company.toLowerCase().includes(ql) || (c.contactName || '').toLowerCase().includes(ql)).slice(0, 8).map((c) => ({ type: 'contact' as const, rec: c })),
    ...leads.filter((l) => l.company.toLowerCase().includes(ql) || (l.contactName || '').toLowerCase().includes(ql)).slice(0, 12).map((l) => ({ type: 'lead' as const, rec: l })),
  ];
  const link = async (type: 'lead' | 'contact', rec: any) => {
    const table = type === 'lead' ? 'leads' : 'contacts';
    const cur = rec.email ? `${rec.email}, ${msg.from}` : msg.from;
    if (!(rec.email || '').toLowerCase().includes(normEmail(msg.from))) store.upsert(table, { id: rec.id, email: cur } as any);
    const n = await backfillAddress(msg.from);
    toast(`Linked — ${n} email${n === 1 ? '' : 's'} added to ${rec.company}`);
    onClose();
  };
  return (
    <Modal title={`Link ${msg.from}`} onClose={onClose}>
      <div className="stack">
        <input autoFocus placeholder="Search leads and contacts…" value={q} onChange={(e) => setQ(e.target.value)} />
        {results.map(({ type, rec }) => (
          <div key={rec.id} className="list-item clickable" onClick={() => link(type, rec)}>
            <span className="pill">{type}</span>
            <div className="grow"><div className="title">{rec.company}</div><div className="meta">{rec.contactName} {rec.city ? `· ${rec.city}` : ''}</div></div>
          </div>
        ))}
        {q.length >= 2 && !results.length && <Empty>No matches.</Empty>}
      </div>
    </Modal>
  );
}

function Templates() {
  const templates = useSetting<EmailTemplate[]>('emailTemplates', DEFAULT_TEMPLATES);
  const [edit, setEdit] = useState<EmailTemplate | null>(null);
  const save = (t: EmailTemplate) => {
    const exists = templates.some((x) => x.id === t.id);
    setSetting('emailTemplates', exists ? templates.map((x) => (x.id === t.id ? t : x)) : [...templates, t]);
    setEdit(null);
  };
  return (
    <div className="card">
      <div className="card-head"><h3>Email templates</h3>
        <div className="actions">
          <button className="btn ghost sm" onClick={() => confirm('Reset templates to the defaults?') && setSetting('emailTemplates', DEFAULT_TEMPLATES)}>Reset defaults</button>
          <button className="btn sm" onClick={() => setEdit({ id: uid(), name: 'New template', subject: '', body: '' })}><Plus size={14} /> New</button>
        </div>
      </div>
      <div className="faint" style={{ fontSize: '0.78rem', marginBottom: 8 }}>Placeholders: {'{firstName} {name} {company} {trade} {city} {myName}'}</div>
      {templates.map((t) => (
        <div className="list-item clickable" key={t.id} onClick={() => setEdit(t)}>
          <div className="grow"><div className="title">{t.name}</div><div className="meta">{t.subject}</div></div>
        </div>
      ))}
      {edit && (
        <Modal wide title="Edit template" onClose={() => setEdit(null)}
          footer={<>
            <button className="btn bad" style={{ marginRight: 'auto' }} onClick={() => { setSetting('emailTemplates', templates.filter((x) => x.id !== edit.id)); setEdit(null); }}><Trash2 size={14} /> Delete</button>
            <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn primary" onClick={() => save(edit)}>Save</button>
          </>}>
          <div className="form-grid">
            <Field label="Name" full><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Subject" full><input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>
            <Field label="Body" full><textarea rows={14} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EmailSettings() {
  const em = useEmail();
  const signature = useSetting('emailSignature', '');
  return (
    <div className="split">
      <div className="card">
        <div className="card-head"><h3>Signature</h3></div>
        <InlineInput value={signature} placeholder="e.g. Dylan · TradeLink · (206) 555-0100 · tradelink.marketing" onSave={(v) => setSetting('emailSignature', v)} />
        <div className="faint" style={{ fontSize: '0.75rem', marginTop: 6 }}>Added to every email sent from the CRM. Shared across your devices.</div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Connection</h3></div>
        <div style={{ fontSize: '0.9rem' }}>Connected as <b>{em.me}</b> on this device.</div>
        <button className="btn bad sm" style={{ marginTop: 10 }} onClick={() => confirm('Disconnect email on this device?') && disconnectEmail()}>Disconnect</button>
      </div>
    </div>
  );
}
