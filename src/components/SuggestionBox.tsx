import { Lightbulb, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { store, useTable } from '../lib/store';
import { StatusPill, toast } from './ui';

const STOP = new Set('the a an and or to of for in on with is it be can should would add make page this that i we my me have more'.split(' '));
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** Enter submits; Shift+Enter (or Enter while a keyboard is still composing a word) adds a line. */
export const submitsOnEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing;

/** Finds earlier suggestions that look similar so things don't get re-decided. */
export function similarSuggestions(text: string, list: { suggestion: string }[]) {
  const w = words(text);
  if (w.size < 2) return [];
  return list
    .map((s) => {
      const o = words(s.suggestion);
      let hit = 0;
      w.forEach((x) => o.has(x) && hit++);
      return { s, score: hit / Math.max(3, Math.min(w.size, o.size)) };
    })
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.s);
}

export function SuggestionBox({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const all = useTable('suggestions');
  const forPage = all.filter((s) => s.page === page);
  const similar = useMemo(() => similarSuggestions(text, all), [text, all]);

  const submit = () => {
    if (!text.trim()) return;
    store.upsert('suggestions', { page, suggestion: text.trim(), decision: 'Pending', decisionNotes: '', decidedAt: '' });
    setText('');
    setOpen(false);
    toast('Suggestion saved to the Suggestions sheet');
  };

  return (
    <div className="suggest-box">
      {!open ? (
        <div className="row">
          <Lightbulb size={16} color="var(--warn)" />
          <button className="btn ghost sm" onClick={() => setOpen(true)} style={{ paddingLeft: 4 }}>Suggest an improvement for the {page} page</button>
          <span className="spacer" />
          {forPage.length > 0 && <Link to={`/suggestions?page=${encodeURIComponent(page)}`} className="faint" style={{ fontSize: '0.8rem' }}>{forPage.length} for this page</Link>}
        </div>
      ) : (
        <div className="col">
          <div className="row"><Lightbulb size={16} color="var(--warn)" /><b style={{ fontSize: '0.9rem' }}>Suggestion for the {page} page</b></div>
          <textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="send"
            onKeyDown={(e) => { if (submitsOnEnter(e)) { e.preventDefault(); submit(); } }}
            placeholder="What would make this page better? Press Enter to submit (Shift+Enter for a new line). It goes into the Suggestions tab of the Google Sheet for review." />
          {similar.length > 0 && (
            <div className="card" style={{ background: 'var(--warn-soft)', padding: 10 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 650, marginBottom: 6 }}>Similar suggestions already exist:</div>
              {similar.map((s) => (
                <div key={(s as any).id} className="row" style={{ fontSize: '0.83rem', padding: '3px 0' }}>
                  <StatusPill status={(s as any).decision || 'Pending'} /> <span>{s.suggestion}</span>
                </div>
              ))}
            </div>
          )}
          <div className="row">
            <span className="spacer" />
            <button className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary sm" onClick={submit}><Send size={14} /> Submit</button>
          </div>
        </div>
      )}
    </div>
  );
}
