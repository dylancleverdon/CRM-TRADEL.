import Papa from 'papaparse';
import { Download, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { logActivity } from '../lib/actions';
import { DEFAULT_TRADES, LEAD_STATUSES } from '../lib/constants';
import { getSetting, store } from '../lib/store';
import type { Lead } from '../lib/types';
import { Field, Modal, toast } from './ui';

export const emptyLead = (): Partial<Lead> => ({
  company: '', contactName: '', phone: '', altPhone: '', email: '', website: '', trade: '', city: '', state: '',
  address: '', source: 'Cold list', status: 'New', quality: '', disqualifyReason: '', tags: '', attempts: 0,
  lastContactedAt: '', lastOutcome: '', nextFollowUpAt: '', notes: '', convertedContactId: '',
});

export function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth <= 820);
  useEffect(() => {
    const f = () => setM(window.innerWidth <= 820);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return m;
}

export function LeadForm({ onClose, onSaved }: { onClose: () => void; onSaved?: (l: Lead) => void }) {
  const [f, setF] = useState<Partial<Lead>>(emptyLead());
  const trades = getSetting('trades', DEFAULT_TRADES);
  const up = (k: keyof Lead) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const dup = f.phone && f.phone.replace(/\D/g, '').length >= 7
    ? store.list('leads').find((l) => l.phone.replace(/\D/g, '').endsWith(f.phone!.replace(/\D/g, '').slice(-10)))
    : undefined;
  const save = () => {
    if (!f.company?.trim()) { toast('Company name is required'); return; }
    const lead = store.upsert('leads', f);
    logActivity({ type: 'lead', id: lead.id }, { type: 'created', outcome: 'Lead added' });
    onSaved?.(lead);
    onClose();
  };
  return (
    <Modal title="New lead" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save lead</button></>}>
      <div className="form-grid">
        <Field label="Company *" full><input autoFocus value={f.company} onChange={up('company')} placeholder="Smith Plumbing" /></Field>
        <Field label="Contact name"><input value={f.contactName} onChange={up('contactName')} placeholder="Owner name" /></Field>
        <Field label="Phone"><input type="tel" value={f.phone} onChange={up('phone')} /></Field>
        {dup && <div className="full pill warn">Possible duplicate: {dup.company}</div>}
        <Field label="Trade">
          <select value={f.trade} onChange={up('trade')}><option value="">—</option>{trades.map((t) => <option key={t}>{t}</option>)}</select>
        </Field>
        <Field label="Status">
          <select value={f.status} onChange={up('status')}>{LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        </Field>
        <Field label="City"><input value={f.city} onChange={up('city')} /></Field>
        <Field label="State"><input value={f.state} onChange={up('state')} /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={up('email')} /></Field>
        <Field label="Website"><input value={f.website} onChange={up('website')} /></Field>
        <Field label="Source"><input value={f.source} onChange={up('source')} placeholder="Google Maps, Yelp, referral…" /></Field>
        <Field label="Tags (comma separated)"><input value={f.tags} onChange={up('tags')} /></Field>
        <Field label="Notes" full><textarea value={f.notes} onChange={up('notes')} /></Field>
      </div>
    </Modal>
  );
}

const FIELD_ALIASES: Record<string, string[]> = {
  company: ['company', 'business', 'business name', 'company name', 'name', 'title', 'account'],
  contactName: ['contact', 'contact name', 'owner', 'owner name', 'first name', 'full name', 'person'],
  phone: ['phone', 'phone number', 'telephone', 'mobile', 'cell', 'main phone'],
  altPhone: ['alt phone', 'phone 2', 'secondary phone', 'other phone'],
  email: ['email', 'e-mail', 'email address'],
  website: ['website', 'url', 'site', 'web', 'domain'],
  trade: ['trade', 'industry', 'category', 'niche', 'type', 'service'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region'],
  address: ['address', 'street', 'full address', 'location'],
  source: ['source', 'lead source', 'list'],
  notes: ['notes', 'note', 'comments', 'description'],
  tags: ['tags', 'tag', 'labels'],
};

export function ImportLeads({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [skipDupes, setSkipDupes] = useState(true);
  const [source, setSource] = useState('CSV import');
  const fileRef = useRef<HTMLInputElement>(null);
  const headers = rows[0] ? Object.keys(rows[0]) : [];

  const onFile = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (r) => {
        setRows(r.data);
        const hs = r.meta.fields || [];
        const m: Record<string, string> = {};
        for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
          const hit = hs.find((h) => aliases.includes(h.trim().toLowerCase()));
          if (hit && !Object.values(m).includes(hit)) m[field] = hit;
        }
        setMap(m);
      },
    });
  };

  const run = () => {
    const existing = new Set(store.list('leads').map((l) => l.phone.replace(/\D/g, '').slice(-10)).filter(Boolean));
    let added = 0, skipped = 0;
    for (const r of rows) {
      const lead: Partial<Lead> = { ...emptyLead(), source };
      for (const [field, col] of Object.entries(map)) if (col) (lead as any)[field] = (r[col] || '').trim();
      if (!lead.company) { skipped++; continue; }
      const key = (lead.phone || '').replace(/\D/g, '').slice(-10);
      if (skipDupes && key && existing.has(key)) { skipped++; continue; }
      existing.add(key);
      store.upsert('leads', lead);
      added++;
    }
    toast(`Imported ${added} leads${skipped ? `, skipped ${skipped}` : ''}`);
    onClose();
  };

  return (
    <Modal wide title="Import leads from CSV" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!rows.length || !map.company} onClick={run}>Import {rows.length} rows</button></>}>
      <div className="stack">
        <p className="muted">Export a list from Google Maps scrapers, Yelp, a spreadsheet, etc. as CSV. Columns are matched automatically — adjust below.</p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {rows.length > 0 && (
          <>
            <div className="form-grid">
              {Object.keys(FIELD_ALIASES).map((field) => (
                <Field key={field} label={field === 'company' ? 'company *' : field}>
                  <select value={map[field] || ''} onChange={(e) => setMap({ ...map, [field]: e.target.value })}>
                    <option value="">— skip —</option>
                    {headers.map((h) => <option key={h}>{h}</option>)}
                  </select>
                </Field>
              ))}
              <Field label="Source label"><input value={source} onChange={(e) => setSource(e.target.value)} /></Field>
              <label className="row" style={{ alignSelf: 'end', fontSize: '0.85rem' }}><input type="checkbox" checked={skipDupes} onChange={(e) => setSkipDupes(e.target.checked)} /> Skip duplicate phone numbers</label>
            </div>
            <div className="faint" style={{ fontSize: '0.8rem' }}>Preview: {rows.slice(0, 3).map((r) => r[map.company] || '?').join(', ')}…</div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function exportCsv(name: string, rows: Record<string, any>[]) {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const ImportIcon = Upload;
export const ExportIcon = Download;
