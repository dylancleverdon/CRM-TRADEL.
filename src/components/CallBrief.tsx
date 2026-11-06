/**
 * Everything you need while you're on the phone, without opening the lead's page: the script, how they show up on
 * Yelp and Google, and the key details (editable right here).
 */
import { traitsOf } from '../lib/engine';
import { store, useRecord } from '../lib/store';
import { InfoFields, QuickLinks } from './Detail';
import { PresenceCard } from './Presence';
import { ScriptCard } from './ScriptCard';

type E = { type: 'lead' | 'contact'; id: string };

export function BriefDetails({ entity }: { entity: E }) {
  const rec: any = useRecord(entity.type === 'lead' ? 'leads' : 'contacts', entity.id);
  if (!rec) return null;
  const save = (k: string, v: string) => store.upsert(entity.type === 'lead' ? 'leads' : 'contacts', { id: entity.id, [k]: v } as any);
  const tr = entity.type === 'lead' ? traitsOf(rec, Date.now(), (rec.attempts || 0) + 1) : null;
  const facts = tr ? [tr.age, tr.type, tr.lists, rec.score != null ? `Score ${rec.score}` : '', rec.licenseNo ? `License ${rec.licenseNo}` : '']
    .filter((x) => x && !/unknown/i.test(x)) : [];
  return (
    <div className="card">
      <div className="card-head"><h3>Details</h3><div className="actions"><QuickLinks rec={rec} entity={entity} /></div></div>
      {facts.length > 0 && <div className="faint" style={{ fontSize: '0.8rem', marginBottom: 8 }}>{facts.join(' · ')}</div>}
      <InfoFields rec={rec} onSave={save} fields={[
        { key: 'contactName', label: 'Owner / contact' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'website', label: 'Website', type: 'url' },
        { key: 'address', label: 'Address' },
      ]} />
    </div>
  );
}

/** Script, Yelp/Google and details, for the call outcome panel. */
export function CallBrief({ entity }: { entity: E }) {
  const rec: any = useRecord(entity.type === 'lead' ? 'leads' : 'contacts', entity.id);
  if (!rec) return null;
  return (
    <div className="call-brief">
      <ScriptCard rec={rec} entity={entity} />
      <PresenceCard rec={rec} entity={entity} />
      <BriefDetails entity={entity} />
    </div>
  );
}
