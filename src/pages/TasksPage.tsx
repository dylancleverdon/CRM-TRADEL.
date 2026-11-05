import { endOfDay, isToday, startOfDay } from 'date-fns';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Page } from '../components/Layout';
import { TaskEditor, TaskRow } from '../components/Tasks';
import { Empty } from '../components/ui';
import { useTable } from '../lib/store';

export default function TasksPage() {
  const tasks = useTable('tasks');
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const sod = startOfDay(new Date()).toISOString();
  const eod = endOfDay(new Date()).toISOString();
  const open = tasks.filter((t) => !t.done).sort((a, b) => (a.dueAt || 'z').localeCompare(b.dueAt || 'z'));
  const groups = [
    { name: 'Overdue', items: open.filter((t) => t.dueAt && t.dueAt < sod), color: 'var(--bad)' },
    { name: 'Today', items: open.filter((t) => t.dueAt && t.dueAt >= sod && t.dueAt <= eod) },
    { name: 'Upcoming', items: open.filter((t) => t.dueAt && t.dueAt > eod) },
    { name: 'No date', items: open.filter((t) => !t.dueAt) },
  ];
  const done = tasks.filter((t) => t.done).sort((a, b) => b.doneAt.localeCompare(a.doneAt));
  const doneToday = done.filter((t) => t.doneAt && isToday(new Date(t.doneAt))).length;

  return (
    <Page title="Follow-ups" sub={`${groups[0].items.length} overdue · ${groups[1].items.length} due today · ${doneToday} completed today`}
      actions={<button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> New follow-up</button>}>
      <div className="stack">
        <div className="tabs" style={{ width: 'fit-content' }}>
          <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>Open<span className="n">{open.length}</span></button>
          <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Completed<span className="n">{done.length}</span></button>
        </div>
        {tab === 'open' && (open.length === 0 ? <div className="card"><Empty>All caught up.</Empty></div> :
          groups.filter((g) => g.items.length).map((g) => (
            <div className="card" key={g.name} style={{ padding: '10px 14px' }}>
              <div className="card-head" style={{ marginBottom: 2 }}><h3 style={{ color: g.color }}>{g.name}</h3><span className="faint">{g.items.length}</span></div>
              {g.items.map((t) => <TaskRow key={t.id} t={t} />)}
            </div>
          )))}
        {tab === 'done' && (
          <div className="card" style={{ padding: '10px 14px' }}>
            {done.length === 0 && <Empty>Nothing completed yet.</Empty>}
            {done.slice(0, 300).map((t) => <TaskRow key={t.id} t={t} />)}
          </div>
        )}
      </div>
      {adding && <TaskEditor onClose={() => setAdding(false)} />}
    </Page>
  );
}
