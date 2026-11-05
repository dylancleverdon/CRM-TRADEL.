import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Page } from '../components/Layout';
import { similarSuggestions } from '../components/SuggestionBox';
import { Empty, Field, InlineInput, Modal, StatusPill } from '../components/ui';
import { DECISIONS } from '../lib/constants';
import { when } from '../lib/format';
import { nowIso, store, useTable } from '../lib/store';
import type { Decision } from '../lib/types';

export default function Suggestions() {
  const all = useTable('suggestions');
  const [params] = useSearchParams();
  const [decision, setDecision] = useState<string>('Pending');
  const [page, setPage] = useState(params.get('page') || '');
  const [adding, setAdding] = useState(false);
  const pages = Array.from(new Set(all.map((s) => s.page))).sort();
  const rows = all
    .filter((s) => !decision || (s.decision || 'Pending') === decision)
    .filter((s) => !page || s.page === page)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const count = (d: string) => all.filter((s) => (s.decision || 'Pending') === d).length;

  const decide = (id: string, d: Decision) => store.upsert('suggestions', { id, decision: d, decidedAt: d === 'Pending' ? '' : nowIso() });

  return (
    <Page title="Suggestions" sub="Every suggestion is stored in the Suggestions tab of your Google Sheet. Record a decision once so nothing gets re-decided."
      actions={<button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> New suggestion</button>}>
      <div className="stack">
        <div className="row wrap">
          <div className="tabs">
            <button className={!decision ? 'on' : ''} onClick={() => setDecision('')}>All<span className="n">{all.length}</span></button>
            {DECISIONS.map((d) => <button key={d} className={decision === d ? 'on' : ''} onClick={() => setDecision(d)}>{d}<span className="n">{count(d)}</span></button>)}
          </div>
          <select style={{ width: 180 }} value={page} onChange={(e) => setPage(e.target.value)}><option value="">All pages</option>{pages.map((p) => <option key={p}>{p}</option>)}</select>
        </div>
        {rows.length === 0 && <div className="card"><Empty>No suggestions here. Use the box at the bottom of any page to add one.</Empty></div>}
        {rows.map((s) => (
          <div className="card" key={s.id}>
            <div className="row wrap" style={{ marginBottom: 8 }}>
              <span className="pill accent">{s.page}</span>
              <StatusPill status={s.decision || 'Pending'} />
              <span className="faint" style={{ fontSize: '0.78rem' }}>Suggested {when(s.createdAt)}{s.decidedAt ? ` · decided ${when(s.decidedAt)}` : ''}</span>
              <span className="spacer" />
              <button className="btn ghost sm" onClick={() => confirm('Delete suggestion?') && store.remove('suggestions', s.id)}>Delete</button>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', marginBottom: 10 }}>{s.suggestion}</div>
            <div className="row wrap">
              {DECISIONS.map((d) => (
                <button key={d} className={`chip ${(s.decision || 'Pending') === d ? `on ${d === 'Approved' || d === 'Implemented' ? 'good' : d === 'Rejected' ? 'bad' : d === 'Pending' ? 'warn' : 'muted'}` : ''}`} onClick={() => decide(s.id, d)}>{d}</button>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <InlineInput value={s.decisionNotes} placeholder="Decision notes (why?)" onSave={(v) => store.upsert('suggestions', { id: s.id, decisionNotes: v })} />
            </div>
          </div>
        ))}
      </div>
      {adding && <AddSuggestion onClose={() => setAdding(false)} />}
    </Page>
  );
}

function AddSuggestion({ onClose }: { onClose: () => void }) {
  const all = useTable('suggestions');
  const [text, setText] = useState('');
  const [page, setPage] = useState('General');
  const similar = similarSuggestions(text, all);
  return (
    <Modal title="New suggestion" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => {
        if (text.trim()) store.upsert('suggestions', { page, suggestion: text.trim(), decision: 'Pending', decisionNotes: '', decidedAt: '' });
        onClose();
      }}>Save</button></>}>
      <div className="stack">
        <Field label="Page / area"><input value={page} onChange={(e) => setPage(e.target.value)} /></Field>
        <Field label="Suggestion"><textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        {similar.map((s: any) => <div key={s.id} className="row" style={{ fontSize: '0.85rem' }}><StatusPill status={s.decision || 'Pending'} />{s.suggestion}</div>)}
      </div>
    </Modal>
  );
}
