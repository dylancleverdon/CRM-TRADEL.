import { ExternalLink, Mail, MapPin } from 'lucide-react';
import { useState } from 'react';
import type { EntityType } from '../lib/types';
import { EmailCompose } from './EmailCompose';
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

export function QuickLinks({ rec, entity }: { rec: { email?: string; website?: string; address?: string; city?: string; state?: string; company?: string }; entity?: { type: EntityType; id: string } }) {
  const [composing, setComposing] = useState(false);
  const site = rec.website ? (rec.website.startsWith('http') ? rec.website : `https://${rec.website}`) : '';
  const place = [rec.company, rec.address, rec.city, rec.state].filter(Boolean).join(' ');
  return (
    <div className="row wrap">
      {(rec.email || entity) && <button className="btn sm" onClick={() => (entity ? setComposing(true) : openExternal(`mailto:${rec.email}`))}><Mail size={14} /> Email</button>}
      {composing && entity && <EmailCompose target={{ entity }} onClose={() => setComposing(false)} />}
      {site && <button className="btn sm" onClick={() => openExternal(site)}><ExternalLink size={14} /> Website</button>}
      {place && <button className="btn sm" onClick={() => openExternal(`https://www.google.com/maps/search/${encodeURIComponent(place)}`)}><MapPin size={14} /> Google Maps</button>}
    </div>
  );
}
