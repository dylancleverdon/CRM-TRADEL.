import { isPast, isToday } from 'date-fns';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addTask, completeTask, followUpDate, refreshFollowUp, type Entity } from '../lib/actions';
import { fromLocalInput, toLocalInput, when } from '../lib/format';
import { store, useTable } from '../lib/store';
import type { EntityType, Task } from '../lib/types';
import { Empty, Field, Modal } from './ui';

export const entityLink = (type: string, id: string) =>
  type === 'lead' ? `/leads/${id}` : type === 'contact' ? `/contacts/${id}` : type === 'opportunity' ? `/pipeline?opp=${id}` : '';

export function TaskRow({ t, showEntity = true }: { t: Task; showEntity?: boolean }) {
  const [edit, setEdit] = useState(false);
  const due = t.dueAt ? new Date(t.dueAt) : null;
  const overdue = !t.done && due && isPast(due) && !isToday(due);
  return (
    <div className="list-item">
      <input type="checkbox" checked={t.done} onChange={(e) => completeTask(t, e.target.checked)} />
      <div className="grow clickable" onClick={() => setEdit(true)}>
        <div className="title" style={{ textDecoration: t.done ? 'line-through' : undefined, color: t.done ? 'var(--text-3)' : undefined }}>
          {t.priority === 'High' && !t.done && <span style={{ color: 'var(--bad)' }}>! </span>}{t.title}
        </div>
        <div className="meta">
          <span style={{ color: overdue ? 'var(--bad)' : undefined, fontWeight: overdue ? 650 : undefined }}>
            {t.done ? `Done ${when(t.doneAt)}` : due ? `${overdue ? 'Overdue · ' : ''}${when(t.dueAt)}` : 'No due date'}
          </span>
          {showEntity && t.entityId && (
            <> · <Link to={entityLink(t.entityType, t.entityId)} onClick={(e) => e.stopPropagation()}>{t.entityName}</Link></>
          )}
        </div>
      </div>
      {edit && <TaskEditor task={t} onClose={() => setEdit(false)} />}
    </div>
  );
}

export function TaskEditor({ task, entity, onClose }: { task?: Task; entity?: Entity | null; onClose: () => void }) {
  const [title, setTitle] = useState(task?.title || 'Call back');
  const [due, setDue] = useState(toLocalInput(task?.dueAt || followUpDate(1).toISOString()));
  const [priority, setPriority] = useState<Task['priority']>(task?.priority || 'Normal');
  const [notes, setNotes] = useState(task?.notes || '');
  const save = () => {
    if (task) {
      store.upsert('tasks', { id: task.id, title, dueAt: fromLocalInput(due), priority, notes });
      if (task.entityId) refreshFollowUp({ type: task.entityType as EntityType, id: task.entityId });
    } else addTask(entity || null, title, fromLocalInput(due), priority, notes);
    onClose();
  };
  return (
    <Modal
      title={task ? 'Edit follow-up' : 'New follow-up'}
      onClose={onClose}
      footer={<>
        {task && <button className="btn bad" style={{ marginRight: 'auto' }} onClick={() => {
          store.remove('tasks', task.id);
          if (task.entityId) refreshFollowUp({ type: task.entityType as EntityType, id: task.entityId });
          onClose();
        }}><Trash2 size={14} /> Delete</button>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </>}
    >
      <div className="form-grid">
        <Field label="Task" full><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Due"><input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value as Task['priority'])}>
            <option>Low</option><option>Normal</option><option>High</option>
          </select>
        </Field>
        <div className="row wrap full">
          {[['Later today', 0], ['Tomorrow', 1], ['2 days', 2], ['1 week', 7], ['2 weeks', 14], ['1 month', 30]].map(([l, d]) => (
            <button key={l} className="btn sm" onClick={() => setDue(toLocalInput(followUpDate(d as number).toISOString()))}>{l}</button>
          ))}
        </div>
        <Field label="Notes" full><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function TasksPanel({ entity }: { entity: Entity }) {
  const tasks = useTable('tasks').filter((t) => t.entityId === entity.id);
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const open = tasks.filter((t) => !t.done).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const done = tasks.filter((t) => t.done).sort((a, b) => b.doneAt.localeCompare(a.doneAt));
  return (
    <div className="card">
      <div className="card-head">
        <h3>Follow-ups</h3>
        <div className="actions">
          {done.length > 0 && <button className="btn ghost sm" onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} done ({done.length})</button>}
          <button className="btn sm" onClick={() => setAdding(true)}><Plus size={14} /> Add</button>
        </div>
      </div>
      {open.length === 0 && !showDone && <Empty>No follow-ups scheduled.</Empty>}
      {open.map((t) => <TaskRow key={t.id} t={t} showEntity={false} />)}
      {showDone && done.map((t) => <TaskRow key={t.id} t={t} showEntity={false} />)}
      {adding && <TaskEditor entity={entity} onClose={() => setAdding(false)} />}
    </div>
  );
}
