import { ListPlus, Phone, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCall } from '../components/CallFlow';
import { Page } from '../components/Layout';
import { exportCsv, ExportIcon, ImportIcon, ImportLeads, LeadForm, useIsMobile } from '../components/RecordForm';
import { Empty, QualityPill, StatusPill, toast } from '../components/ui';
import { setLeadStatus, setQueued } from '../lib/actions';
import { DEFAULT_TRADES, LEAD_STATUSES } from '../lib/constants';
import { ago, formatPhone, shortDate } from '../lib/format';
import { presenceMatch } from '../lib/presence';
import { getSetting, store, useTable } from '../lib/store';
import type { Lead, LeadStatus } from '../lib/types';

type SortKey = 'company' | 'status' | 'trade' | 'city' | 'attempts' | 'lastContactedAt' | 'nextFollowUpAt' | 'createdAt';

export default function Leads() {
  const leads = useTable('leads');
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'Open' | LeadStatus | 'All'>('Open');
  const [trade, setTrade] = useState('');
  const [quality, setQuality] = useState('');
  const [origin, setOrigin] = useState<'' | 'mine' | 'public'>('');
  const [presence, setPresence] = useState('');
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'createdAt', dir: -1 });
  const [adding, setAdding] = useState(params.get('new') === '1');
  const [importing, setImporting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(200);
  const navigate = useNavigate();
  const { startCall } = useCall();
  const mobile = useIsMobile();
  const trades = getSetting('trades', DEFAULT_TRADES);

  useEffect(() => { if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: leads.length, Open: 0 };
    leads.forEach((l) => {
      c[l.status] = (c[l.status] || 0) + 1;
      if (!['Disqualified', 'Converted'].includes(l.status)) c.Open++;
    });
    return c;
  }, [leads]);

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return leads
      .filter((l) => tab === 'All' || (tab === 'Open' ? !['Disqualified', 'Converted'].includes(l.status) : l.status === tab))
      .filter((l) => !trade || l.trade === trade)
      .filter((l) => !quality || (quality === 'none' ? !l.quality : l.quality === quality))
      .filter((l) => !origin || (origin === 'public' ? l.origin === 'public' : l.origin !== 'public'))
      .filter((l) => presenceMatch(l, presence))
      .filter((l) => !ql || [l.company, l.contactName, l.phone, l.city, l.email, l.tags, l.notes].some((x) => (x || '').toLowerCase().includes(ql)))
      .sort((a, b) => {
        const av = (a as any)[sort.k] ?? '', bv = (b as any)[sort.k] ?? '';
        if (typeof av === 'number') return (av - bv) * sort.dir;
        if (!av && bv) return 1;
        if (av && !bv) return -1;
        return String(av).localeCompare(String(bv)) * sort.dir;
      });
  }, [leads, q, tab, trade, quality, origin, presence, sort]);

  const th = (k: SortKey, label: string) => (
    <th onClick={() => setSort({ k, dir: sort.k === k ? (-sort.dir as 1 | -1) : 1 })}>{label}{sort.k === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</th>
  );

  const bulk = (action: string) => {
    const ids = Array.from(sel);
    if (action === 'queue') {
      // Keep the order you picked them in.
      const base = Date.now();
      const callable = ids.filter((id) => store.get('leads', id)?.phone);
      callable.forEach((id, i) => setQueued({ type: 'lead', id }, true, new Date(base + i).toISOString()));
      const missing = ids.length - callable.length;
      toast(`${callable.length} added to your call queue${missing ? ` (${missing} without a phone number skipped)` : ''}`);
      setSel(new Set());
      return;
    }
    if (action === 'delete') {
      if (!confirm(`Delete ${ids.length} leads?`)) return;
      ids.forEach((id) => store.remove('leads', id));
    } else if (LEAD_STATUSES.includes(action as LeadStatus)) {
      ids.forEach((id) => { const l = store.get('leads', id); if (l) setLeadStatus(l, action as LeadStatus); });
    }
    toast(`Updated ${ids.length} leads`);
    setSel(new Set());
  };

  return (
    <Page
      title="Leads"
      sub={`${counts.Open} open · ${leads.length} total`}
      actions={<>
        <button className="btn hide-mobile" onClick={() => exportCsv('leads', rows)}><ExportIcon size={15} /> Export</button>
        <button className="btn" onClick={() => setImporting(true)}><ImportIcon size={15} /> Import</button>
        <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> New lead</button>
      </>}
    >
      <div className="stack">
        <div className="tabs">
          {(['Open', ...LEAD_STATUSES, 'All'] as const).map((s) => (
            <button key={s} className={tab === s ? 'on' : ''} onClick={() => setTab(s)}>{s}<span className="n">{counts[s] || 0}</span></button>
          ))}
        </div>
        <div className="row wrap">
          <div className="search" style={{ flex: '1 1 240px' }}><Search size={15} /><input placeholder="Search company, name, phone, city, notes…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select style={{ width: 160 }} value={trade} onChange={(e) => setTrade(e.target.value)}><option value="">All trades</option>{trades.map((t) => <option key={t}>{t}</option>)}</select>
          <select style={{ width: 140 }} value={quality} onChange={(e) => setQuality(e.target.value)}>
            <option value="">Any quality</option><option value="good">👍 Good</option><option value="bad">👎 Bad</option><option value="none">Not rated</option>
          </select>
          <select style={{ width: 160 }} value={origin} onChange={(e) => setOrigin(e.target.value as any)}>
            <option value="">All leads</option><option value="mine">Added by me</option><option value="public">Public records</option>
          </select>
          <select style={{ width: 170 }} value={presence} onChange={(e) => setPresence(e.target.value)} title="What you found on Yelp and Google">
            <option value="">Any online presence</option><option value="gap">Missing Yelp or Google</option><option value="noYelp">Not on Yelp / unclaimed</option>
            <option value="noGoogle">Not on Google / unverified</option><option value="unchecked">Not checked yet</option>
          </select>
        </div>
        {sel.size > 0 && (
          <div className="card row wrap" style={{ padding: 10 }}>
            <b>{sel.size} selected</b>
            <select style={{ width: 180 }} value="" onChange={(e) => e.target.value && bulk(e.target.value)}>
              <option value="">Set status…</option>{LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <button className="btn sm" onClick={() => bulk('queue')}><ListPlus size={14} /> Add to call queue</button>
            <button className="btn bad sm" onClick={() => bulk('delete')}>Delete</button>
            <button className="btn ghost sm" onClick={() => setSel(new Set())}>Clear</button>
          </div>
        )}
        {rows.length === 0 && <div className="card"><Empty>No leads here. Add one or import a CSV list.</Empty></div>}
        {rows.length > 0 && mobile && (
          <div className="card" style={{ padding: '4px 12px' }}>
            {rows.slice(0, limit).map((l) => <LeadCard key={l.id} l={l} onOpen={() => navigate(`/leads/${l.id}`)} onCall={() => startCall({ type: 'lead', id: l.id })} />)}
          </div>
        )}
        {rows.length > 0 && !mobile && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 30 }} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.size > 0 && sel.size === Math.min(rows.length, limit)}
                      onChange={(e) => setSel(e.target.checked ? new Set(rows.slice(0, limit).map((r) => r.id)) : new Set())} />
                  </th>
                  {th('company', 'Company')}{th('status', 'Status')}{th('trade', 'Trade')}{th('city', 'Location')}
                  <th>Phone</th>{th('attempts', 'Tries')}{th('lastContactedAt', 'Last contact')}{th('nextFollowUpAt', 'Follow-up')}<th></th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((l) => (
                  <tr key={l.id} onClick={() => navigate(`/leads/${l.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={sel.has(l.id)} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(l.id) : s.delete(l.id); setSel(s); }} />
                    </td>
                    <td><div className="strong">{l.company}</div><div className="faint" style={{ fontSize: '0.78rem' }}>{l.contactName}</div></td>
                    <td><div className="row"><StatusPill status={l.status} /><QualityPill q={l.quality} />{l.queuedAt && <span className="pill accent">In queue</span>}<PresencePills l={l} /></div></td>
                    <td>{l.trade}</td>
                    <td>{[l.city, l.state].filter(Boolean).join(', ')}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatPhone(l.phone)}</td>
                    <td>{l.attempts || 0}</td>
                    <td><div>{l.lastContactedAt ? ago(l.lastContactedAt) : '—'}</div><div className="faint" style={{ fontSize: '0.75rem' }}>{l.lastOutcome}</div></td>
                    <td style={{ color: l.nextFollowUpAt && l.nextFollowUpAt < new Date().toISOString() ? 'var(--bad)' : undefined }}>{shortDate(l.nextFollowUpAt) || '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {l.phone && <button className="btn call sm" onClick={() => startCall({ type: 'lead', id: l.id })}><Phone size={13} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > limit && <button className="btn block" onClick={() => setLimit(limit + 300)}>Show more ({rows.length - limit} hidden)</button>}
      </div>
      {adding && <LeadForm onClose={() => setAdding(false)} onSaved={(l) => navigate(`/leads/${l.id}`)} />}
      {importing && <ImportLeads onClose={() => setImporting(false)} />}
    </Page>
  );
}

/** "No Yelp" / "No Google" tags: the best prospects for TradeLink. */
function PresencePills({ l }: { l: Lead }) {
  return <>
    {(l.yelpStatus === 'Not listed' || l.yelpStatus === 'Unclaimed') && <span className="pill warn">{l.yelpStatus === 'Unclaimed' ? 'Yelp unclaimed' : 'No Yelp'}</span>}
    {(l.googleStatus === 'Not listed' || l.googleStatus === 'Unverified') && <span className="pill warn">{l.googleStatus === 'Unverified' ? 'Google unverified' : 'No Google'}</span>}
  </>;
}

function LeadCard({ l, onOpen, onCall }: { l: Lead; onOpen: () => void; onCall: () => void }) {
  return (
    <div className="list-item">
      <div className="grow" onClick={onOpen}>
        <div className="title">{l.company}</div>
        <div className="meta row wrap" style={{ gap: 6, marginTop: 3 }}>
          <StatusPill status={l.status} /><QualityPill q={l.quality} />{l.queuedAt && <span className="pill accent">In queue</span>}<PresencePills l={l} />
          <span>{l.trade}{l.city ? ` · ${l.city}` : ''}</span>
        </div>
        <div className="meta" style={{ marginTop: 2 }}>
          {l.attempts ? `${l.attempts} tries · ` : ''}{l.lastOutcome || 'Not contacted'}{l.nextFollowUpAt ? ` · F/U ${shortDate(l.nextFollowUpAt)}` : ''}
        </div>
      </div>
      {l.phone && <button className="btn call" onClick={onCall}><Phone size={17} /></button>}
    </div>
  );
}
