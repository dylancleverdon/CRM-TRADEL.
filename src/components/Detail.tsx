import { ExternalLink, Mail, MapPin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { openExternal } from '../lib/platform';
import { Field, InlineInput } from './ui';

export interface FieldDef { key: string; label: string; type?: 'text' | 'tel' | 'email' | 'select' | 'url'; options?: string[]; full?: boolean }

export function InfoFields({ rec, fields, onSave }: { rec: Record<string, any>; fields: FieldDef[]; onSave: (k: string, v: string) => void }) {
  return (
    <div className="form-grid">
      {fields.map((f) => (
        <Field key={f.key} label={f.label} full={f.full}>
          {f.type === 'select' ? (
            <select value={rec[f.key] || ''} onChange={(e) => onSave(f.key, e.target.value)}>
              <option value="">—</option>
              {(f.options || []).concat(rec[f.key] && !(f.options || []).includes(rec[f.key]) ? [rec[f.key]] : []).map((o) => <option key={o}>{o}</option>)}
            </select>
          ) : (
            <InlineInput type={f.type === 'url' ? 'text' : f.type || 'text'} value={rec[f.key] || ''} onSave={(v) => onSave(f.key, v)} />
          )}
        </Field>
      ))}
    </div>
  );
}

export function QuickLinks({ rec }: { rec: { email?: string; website?: string; address?: string; city?: string; state?: string; company?: string } }) {
  const site = rec.website ? (rec.website.startsWith('http') ? rec.website : `https://${rec.website}`) : '';
  const place = [rec.company, rec.address, rec.city, rec.state].filter(Boolean).join(' ');
  return (
    <div className="row wrap">
      {rec.email && <button className="btn sm" onClick={() => openExternal(`mailto:${rec.email}`)}><Mail size={14} /> Email</button>}
      {site && <button className="btn sm" onClick={() => openExternal(site)}><ExternalLink size={14} /> Website</button>}
      {place && <button className="btn sm" onClick={() => openExternal(`https://www.google.com/maps/search/${encodeURIComponent(place)}`)}><MapPin size={14} /> Google Maps</button>}
    </div>
  );
}

/** Large editable notes area with autosave. */
export function NotesCard({ value, onSave, title = 'Notes' }: { value: string; onSave: (v: string) => void; title?: string }) {
  const [v, setV] = useState(value || '');
  const [state, setState] = useState<'saved' | 'editing'>('saved');
  const timer = useRef<any>(null);
  const latest = useRef(value);
  useEffect(() => {
    if (state === 'saved') setV(value || '');
    latest.current = value;
  }, [value]);
  const change = (x: string) => {
    setV(x);
    setState('editing');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { onSave(x); setState('saved'); }, 1200);
  };
  return (
    <div className="card">
      <div className="card-head"><h3>{title}</h3><span className="faint" style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>{state === 'editing' ? 'Saving…' : 'Saved'}</span></div>
      <textarea
        rows={7}
        value={v}
        onChange={(e) => change(e.target.value)}
        onBlur={() => { if (state === 'editing') { clearTimeout(timer.current); onSave(v); setState('saved'); } }}
        placeholder="Pain points, current marketing, budget, best time to call, gatekeeper name…"
      />
    </div>
  );
}
