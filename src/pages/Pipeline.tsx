import { LayoutGrid, List } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Page } from '../components/Layout';
import { OppCard, OpportunityModal } from '../components/Opportunity';
import { useIsMobile } from '../components/RecordForm';
import { Empty, StatusPill } from '../components/ui';
import { isClosed, setOpportunityStage, stages } from '../lib/actions';
import { DEFAULT_SERVICES } from '../lib/constants';
import { money, shortDate } from '../lib/format';
import { getSetting, store, useTable } from '../lib/store';

export default function Pipeline() {
  const opps = useTable('opportunities');
  const [params, setParams] = useSearchParams();
  const openId = params.get('opp');
  const mobile = useIsMobile();
  const [view, setView] = useState<'board' | 'list'>(mobile ? 'list' : 'board');
  const [service, setService] = useState('');
  const [showClosed, setShowClosed] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const services = getSetting('services', DEFAULT_SERVICES);
  const st = stages();

  const filtered = useMemo(() => opps.filter((o) => !service || o.service === service), [opps, service]);
  const open = filtered.filter((o) => !isClosed(o.stage));
  const mrr = open.reduce((s, o) => s + (o.monthlyValue || 0), 0);
  const weighted = open.reduce((s, o) => s + ((o.monthlyValue || 0) * (o.probability || 0)) / 100, 0);
  const won = filtered.filter((o) => st.find((s) => s.name === o.stage)?.closed === 'won');
  const lost = filtered.filter((o) => st.find((s) => s.name === o.stage)?.closed === 'lost');
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;
  const cols = st.filter((s) => showClosed || !s.closed);

  const openOpp = (id: string) => { params.set('opp', id); setParams(params); };
  const closeOpp = () => { params.delete('opp'); setParams(params); };

  return (
    <Page
      title="Pipeline"
      sub={`${open.length} open · ${money(mrr)}/mo open · ${money(weighted)}/mo weighted · ${winRate}% win rate`}
      actions={<>
        <select style={{ width: 200 }} value={service} onChange={(e) => setService(e.target.value)}>
          <option value="">All services</option>{services.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="row hide-mobile" style={{ fontSize: '0.85rem' }}><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Closed</label>
        <div className="tabs">
          <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}><LayoutGrid size={14} /></button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><List size={14} /></button>
        </div>
      </>}
    >
      {opps.length === 0 && (
        <div className="card"><Empty>No opportunities yet. Open a contact and click "New opportunity", or log a "Meeting Booked" call on a lead.</Empty></div>
      )}
      {opps.length > 0 && view === 'board' && (
        <div className="kanban">
          {cols.map((s) => {
            const items = filtered.filter((o) => o.stage === s.name).sort((a, b) => (b.monthlyValue || 0) - (a.monthlyValue || 0));
            const tot = items.reduce((x, o) => x + (o.monthlyValue || 0), 0);
            return (
              <div key={s.name} className={`kcol ${over === s.name ? 'over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(s.name); }}
                onDragLeave={() => setOver(null)}
                onDrop={() => {
                  const o = dragId ? store.get('opportunities', dragId) : undefined;
                  if (o) setOpportunityStage(o, s.name);
                  if (o && s.closed === 'lost') openOpp(o.id);
                  setDragId(null); setOver(null);
                }}>
                <div className="kcol-head">
                  <div className="name">{s.name}<span className="faint" style={{ fontWeight: 500 }}>{items.length}</span>
                    <span className="spacer" /><span className="faint" style={{ fontSize: '0.72rem', fontWeight: 500 }}>{s.probability}%</span></div>
                  <div className="tot">{money(tot)}/mo</div>
                </div>
                <div className="kcol-body">
                  {items.map((o) => (
                    <OppCard key={o.id} o={o} onClick={() => openOpp(o.id)} draggable dragging={dragId === o.id}
                      onDragStart={() => setDragId(o.id)} onDragEnd={() => { setDragId(null); setOver(null); }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {opps.length > 0 && view === 'list' && (
        <div className="stack">
          {cols.map((s) => {
            const items = filtered.filter((o) => o.stage === s.name);
            if (!items.length) return null;
            return (
              <div className="card" key={s.name} style={{ padding: '10px 14px' }}>
                <div className="card-head" style={{ marginBottom: 4 }}><h3>{s.name}</h3><span className="faint">{items.length} · {money(items.reduce((x, o) => x + o.monthlyValue, 0))}/mo</span></div>
                {items.map((o) => {
                  const c = store.get('contacts', o.contactId);
                  return (
                    <div className="list-item clickable" key={o.id} onClick={() => openOpp(o.id)}>
                      <div className="grow">
                        <div className="title">{c?.company || o.name}</div>
                        <div className="meta">{o.service} · {money(o.monthlyValue)}/mo{o.expectedCloseDate ? ` · close ${shortDate(o.expectedCloseDate + 'T12:00:00')}` : ''}</div>
                      </div>
                      <StatusPill status={`${o.probability}%`} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {openId && <OpportunityModal id={openId} onClose={closeOpp} />}
    </Page>
  );
}
