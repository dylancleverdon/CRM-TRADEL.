import { Pencil, StickyNote } from 'lucide-react';
import { useRef, useState } from 'react';
import { DEFAULT_SCRIPT } from '../lib/constants';
import { fillTemplate } from '../lib/format';
import { presenceLines } from '../lib/presence';
import { setSetting, store, useSetting } from '../lib/store';
import { toast } from './ui';

const TOKENS = ['company', 'name', 'trade', 'city', 'myName', 'yelp', 'google'];
const OPTIONAL = ['yelp', 'google'];

/** Fills a script for a lead/contact. */
export function renderScript(tpl: string, rec: any, myName: string) {
  return fillTemplate(tpl, {
    company: rec.company, trade: (rec.trade || 'home service').toLowerCase(), city: rec.city || 'your area',
    name: rec.contactName || 'there', myName: myName || 'me', ...presenceLines(rec),
  }, OPTIONAL);
}

/**
 * The call script in Call Mode. Edit it right here: save it for just this lead (stored on the lead, synced) or make it
 * your default for everyone.
 */
export function ScriptCard({ rec, entity }: { rec: any; entity: { type: 'lead' | 'contact'; id: string } }) {
  const defaultScript = useSetting('callScript', DEFAULT_SCRIPT);
  const myName = useSetting('myName', '');
  const custom: string = rec.script || '';
  const tpl = custom || defaultScript;
  const [show, setShow] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tpl);
  const box = useRef<HTMLTextAreaElement>(null);
  const saveOnRecord = (script: string) => {
    if (entity.type === 'lead') store.upsert('leads', { id: entity.id, script });
    else store.upsert('contacts', { id: entity.id, script });
  };

  const insert = (token: string) => {
    const el = box.current;
    const t = `{${token}}`;
    const s = el ? el.selectionStart : draft.length;
    const e = el ? el.selectionEnd : draft.length;
    setDraft(draft.slice(0, s) + t + draft.slice(e));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(s + t.length, s + t.length); });
  };
  const saveForLead = () => {
    saveOnRecord(draft.trim() === defaultScript.trim() ? '' : draft);
    setEditing(false);
    toast(`Script saved for ${rec.company}`);
  };
  const saveDefault = () => {
    setSetting('callScript', draft);
    if (custom) saveOnRecord('');
    setEditing(false);
    toast('Default script updated');
  };

  return (
    <div className="card">
      <div className="card-head">
        <StickyNote size={15} /><h3>Script</h3>
        {custom && !editing && <span className="pill accent">Just for this lead</span>}
        <div className="actions">
          {!editing && <button className="btn ghost sm" onClick={() => { setDraft(tpl); setEditing(true); setShow(true); }}><Pencil size={13} /> Edit</button>}
          {!editing && <button className="btn ghost sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>}
        </div>
      </div>
      {editing ? (
        <>
          <div className="row wrap" style={{ gap: 4, marginBottom: 6 }}>
            <span className="faint" style={{ fontSize: '0.75rem' }}>Insert:</span>
            {TOKENS.map((t) => <button key={t} className="btn sm" style={{ padding: '2px 7px' }} onClick={() => insert(t)}>{`{${t}}`}</button>)}
          </div>
          <textarea ref={box} rows={11} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
            <button className="btn primary sm" onClick={saveForLead}>Save for this lead</button>
            <button className="btn sm" onClick={saveDefault}>Make it my default</button>
            <span className="spacer" />
            <button className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          <div className="faint" style={{ fontSize: '0.72rem', marginTop: 6 }}>{'{yelp}'} and {'{google}'} say what you found online, and stay blank until you check.</div>
        </>
      ) : (
        <>
          {show && <div className="script">{renderScript(tpl, rec, myName)}</div>}
          {custom && show && (
            <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => { saveOnRecord(''); toast('Back to your default script'); }}>Use my default script</button>
          )}
        </>
      )}
    </div>
  );
}
