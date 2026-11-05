import { ArrowRightLeft, Briefcase, Calendar, CheckCircle2, Mail, MessageSquare, Pencil, Phone, Plus, StickyNote, Trash2, UserCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { logActivity, type Entity } from '../lib/actions';
import { duration, fromLocalInput, toLocalInput, when } from '../lib/format';
import { store, useTable } from '../lib/store';
import type { Activity, ActivityType } from '../lib/types';
import { Empty, Field, Modal } from './ui';

const ICONS: Record<string, any> = {
  call: Phone, note: StickyNote, email: Mail, text: MessageSquare, meeting: Calendar, status: ArrowRightLeft,
  converted: UserCheck, opportunity: Briefcase, stage: ArrowRightLeft, task: CheckCircle2, created: Plus,
};

const LABEL: Record<string, string> = {
  call: 'Call', note: 'Note', email: 'Email', text: 'Text message', meeting: 'Meeting', status: 'Status change',
  converted: 'Converted', opportunity: 'Opportunity', stage: 'Stage change', task: 'Task', created: 'Created',
};

export function Timeline({ entities, title = 'Activity history' }: { entities: Entity[]; title?: string }) {
  const all = useTable('activities');
  const ids = entities.map((e) => e.id).join(',');
  const items = useMemo(
    () => all.filter((a) => ids.split(',').includes(a.entityId)).sort((a, b) => (b.occurredAt || '').localeCompare(a.occurredAt || '')),
    [all, ids],
  );
  const [editing, setEditing] = useState<Activity | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<'all' | 'call' | 'notes'>('all');

  const shown = items.filter((a) => filter === 'all' || (filter === 'call' ? a.type === 'call' : ['note', 'email', 'text', 'meeting'].includes(a.type)));

  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
        <span className="faint" style={{ fontSize: '0.8rem' }}>{items.length}</span>
        <div className="actions">
          <div className="tabs" style={{ padding: 2 }}>
            {(['all', 'call', 'notes'] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)} style={{ padding: '3px 9px', fontSize: '0.78rem' }}>
                {f === 'all' ? 'All' : f === 'call' ? 'Calls' : 'Notes'}
              </button>
            ))}
          </div>
          <button className="btn sm" onClick={() => setAdding(true)}><Plus size={14} /> Log</button>
        </div>
      </div>
      {shown.length === 0 && <Empty>No activity yet.</Empty>}
      <div className="timeline">
        {shown.map((a) => {
          const Icon = ICONS[a.type] || StickyNote;
          return (
            <div className="tl-item" key={a.id}>
              <div className={`tl-icon ${a.type}`}><Icon size={15} /></div>
              <div className="tl-body">
                <div className="row">
                  <div className="tl-title" style={{ flex: 1 }}>
                    {LABEL[a.type] || a.type}{a.outcome ? ` — ${a.outcome}` : ''}
                    {entities.length > 1 && <span className="faint" style={{ fontWeight: 500 }}> · {a.entityType}</span>}
                  </div>
                  <button className="btn ghost icon sm" title="Edit" onClick={() => setEditing(a)}><Pencil size={13} /></button>
                </div>
                <div className="tl-time">
                  {when(a.occurredAt)}{a.durationSec ? ` · ${duration(a.durationSec)}` : ''}
                </div>
                {a.notes && <div className="tl-notes">{a.notes}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {editing && <ActivityEditor activity={editing} onClose={() => setEditing(null)} />}
      {adding && <ActivityEditor entity={entities[0]} onClose={() => setAdding(false)} />}
    </div>
  );
}

function ActivityEditor({ activity, entity, onClose }: { activity?: Activity; entity?: Entity; onClose: () => void }) {
  const [type, setType] = useState<ActivityType>(activity?.type || 'note');
  const [outcome, setOutcome] = useState(activity?.outcome || '');
  const [notes, setNotes] = useState(activity?.notes || '');
  const [at, setAt] = useState(toLocalInput(activity?.occurredAt || new Date().toISOString()));
  const save = () => {
    if (activity) store.upsert('activities', { id: activity.id, type, outcome, notes, occurredAt: fromLocalInput(at) });
    else if (entity) logActivity(entity, { type, outcome, notes, occurredAt: fromLocalInput(at) });
    onClose();
  };
  return (
    <Modal
      title={activity ? 'Edit activity' : 'Log activity'}
      onClose={onClose}
      footer={<>
        {activity && <button className="btn bad" style={{ marginRight: 'auto' }} onClick={() => { store.remove('activities', activity.id); onClose(); }}><Trash2 size={14} /> Delete</button>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </>}
    >
      <div className="form-grid">
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
            {Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Date & time">
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label="Outcome / summary" full>
          <input value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        </Field>
        <Field label="Notes" full>
          <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}
