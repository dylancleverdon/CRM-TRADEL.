import { Pencil, Pin, Send, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { logActivity, type Entity } from '../lib/actions';
import { ago, when } from '../lib/format';
import { store, useTable } from '../lib/store';
import type { Activity } from '../lib/types';
import { toast } from './ui';

const draftKey = (e: Entity) => `tl.noteDraft:${e.type}:${e.id}`;
function readDraft(e: Entity) { try { return localStorage.getItem(draftKey(e)) || ''; } catch { return ''; } }
function writeDraft(e: Entity, v: string) {
  try { if (v) localStorage.setItem(draftKey(e), v); else localStorage.removeItem(draftKey(e)); } catch { /* ignore */ }
}

/**
 * Notes you post one at a time: each is saved with the date and time (a "note" in the history, so it syncs to the
 * activities tab) and can be edited or deleted later. `summary` is the record's own notes field, shown pinned on top.
 * An unposted note is kept as a draft on this device, so switching apps mid-call doesn't lose it.
 */
export function NotesFeed({ postTo, entities, summary, onSummary, title = 'Notes' }: {
  postTo: Entity;
  /** Whose notes to list (e.g. a contact and the lead it came from). Defaults to `postTo`. */
  entities?: Entity[];
  summary?: string;
  onSummary?: (v: string) => void;
  title?: string;
}) {
  const all = useTable('activities');
  const ids = (entities || [postTo]).map((e) => e.id);
  const idKey = ids.join(',');
  const notes = useMemo(
    () => all.filter((a) => a.type === 'note' && ids.includes(a.entityId)).sort((a, b) => (b.occurredAt || '').localeCompare(a.occurredAt || '')),
    [all, idKey],
  );
  const [text, setText] = useState(() => readDraft(postTo));
  const [limit, setLimit] = useState(5);
  useEffect(() => { setText(readDraft(postTo)); setLimit(5); }, [postTo.type, postTo.id]);

  const post = () => {
    const v = text.trim();
    if (!v) return;
    logActivity(postTo, { type: 'note', notes: v });
    setText('');
    writeDraft(postTo, '');
    toast('Note posted');
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
        {notes.length > 0 && <span className="faint" style={{ fontSize: '0.78rem' }}>{notes.length} posted</span>}
      </div>
      {onSummary && <PinnedSummary value={summary || ''} onSave={onSummary} />}
      <textarea
        rows={3}
        value={text}
        placeholder="Write a note, then post it. It's saved with today's date and time."
        onChange={(e) => { setText(e.target.value); writeDraft(postTo, e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <span className="faint hide-mobile" style={{ fontSize: '0.75rem' }}>⌘/Ctrl + Enter posts</span>
        <span className="spacer" />
        <button className="btn primary sm" disabled={!text.trim()} onClick={post}><Send size={13} /> Post note</button>
      </div>
      {notes.slice(0, limit).map((n) => <NoteItem key={n.id} n={n} from={n.entityId !== postTo.id ? n.entityType : ''} />)}
      {notes.length > limit && <button className="btn ghost sm block" style={{ marginTop: 6 }} onClick={() => setLimit(limit + 10)}>Show older notes ({notes.length - limit})</button>}
    </div>
  );
}

function NoteItem({ n, from }: { n: Activity; from: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(n.notes);
  const edited = !!n.updatedAt && !!n.createdAt && new Date(n.updatedAt).getTime() - new Date(n.createdAt).getTime() > 60000;
  const save = () => {
    const t = v.trim();
    if (!t) return;
    if (t !== n.notes) store.upsert('activities', { id: n.id, notes: t });
    setEditing(false);
  };
  return (
    <div className="note-item">
      <div className="row" style={{ gap: 4 }}>
        <span className="faint" style={{ fontSize: '0.78rem' }}>
          {when(n.occurredAt)}{edited ? ` · edited ${ago(n.updatedAt)}` : ''}{from ? ` · on the ${from}` : ''}
        </span>
        <span className="spacer" />
        {!editing && <button className="btn ghost icon sm" title="Edit note" onClick={() => { setV(n.notes); setEditing(true); }}><Pencil size={13} /></button>}
        <button className="btn ghost icon sm" title="Delete note" onClick={() => { if (confirm('Delete this note?')) { store.remove('activities', n.id); toast('Note deleted'); } }}><Trash2 size={13} /></button>
      </div>
      {editing ? (
        <>
          <textarea rows={3} value={v} autoFocus onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } if (e.key === 'Escape') setEditing(false); }} />
          <div className="row" style={{ marginTop: 6, justifyContent: 'flex-end' }}>
            <button className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn primary sm" disabled={!v.trim()} onClick={save}>Save</button>
          </div>
        </>
      ) : (
        <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', overflowWrap: 'anywhere' }}>{n.notes}</div>
      )}
    </div>
  );
}

/** The record's notes field, kept as a short summary you see before every call. Saves when you click away. */
function PinnedSummary({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(!!value);
  const [v, setV] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(value);
    if (value) setOpen(true);
  }, [value]);
  if (!open) {
    return <button className="btn ghost sm" style={{ marginBottom: 8, paddingLeft: 2 }} onClick={() => setOpen(true)}><Pin size={13} /> Add a pinned summary</button>;
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="faint row" style={{ gap: 4, fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        <Pin size={11} /> Pinned summary
      </div>
      <textarea
        rows={2}
        value={v}
        placeholder="The one-liner you want to see before every call…"
        onFocus={() => { focused.current = true; }}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { focused.current = false; if (v !== value) onSave(v); }}
      />
    </div>
  );
}
