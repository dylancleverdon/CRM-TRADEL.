import { Database, Phone, RefreshCw, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCall } from '../components/CallFlow';
import { Page } from '../components/Layout';
import { exportCsv, ExportIcon, useIsMobile } from '../components/RecordForm';
import { Empty, StatusPill } from '../components/ui';
import { DEFAULT_TRADES } from '../lib/constants';
import { ago, formatPhone, shortDate } from '../lib/format';
import { isNewBusiness, SOURCE_LABEL, type SourceId } from '../lib/leadmap';
import { DEFAULT_ENABLED, refreshPool, SOURCES, useFinder } from '../lib/leadsources';
import { setSetting, useSetting, useTable } from '../lib/store';
import type { Lead } from '../lib/types';

export default function LeadFinder() {
  const f = useFinder();
  const leads = useTable('leads');
  const priority = useSetting<string[]>('priorityTrades', []);
  const enabled = useSetting<Record<SourceId, boolean>>('publicSources', DEFAULT_ENABLED);
  const [q, setQ] = useState('');
  const [trade, setTrade] = useState('');
  const [city, setCity] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [phone, setPhone] = useState<'any' | 'yes' | 'no'>('yes');
  const [onlyNew, setOnlyNew] = useState(false);
  const [untouched, setUntouched] = useState(true);
  const [source, setSource] = useState<SourceId | ''>('');
  const [limit, setLimit] = useState(200);
  const navigate = useNavigate();
  const { startCall } = useCall();
  const mobile = useIsMobile();

  const publicLeads = useMemo(() => leads.filter((l) => l.origin === 'public'), [leads]);

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    const cl = city.toLowerCase();
    const now = Date.now();
    return publicLeads
      .filter((l) => !trade || l.trade === trade)
      .filter((l) => !cl || (l.city || '').toLowerCase().startsWith(cl) || (l as any).zip === city)
      .filter((l) => (l.score || 0) >= minScore)
      .filter((l) => phone === 'any' || (phone === 'yes' ? !!l.phone : !l.phone))
      .filter((l) => !onlyNew || isNewBusiness(l.licenseStart || '', now))
      .filter((l) => !untouched || (!l.attempts && l.status === 'New'))
      .filter((l) => !source || (l.sources || '').split(',').includes(source))
      .filter((l) => !ql || [l.company, l.contactName, l.phone, l.specialty].some((x) => (x || '').toLowerCase().includes(ql)))
      .sort((a, b) => (b.score || 0) - (a.score || 0));
  }, [publicLeads, q, trade, city, minScore, phone, onlyNew, untouched, source]);

  const byTrade = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((l) => m.set(l.trade || 'Other', (m.get(l.trade || 'Other') || 0) + 1));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const newCount = useMemo(() => publicLeads.filter((l) => isNewBusiness(l.licenseStart || '')).length, [publicLeads]);
  const togglePriority = (t: string) => setSetting('priorityTrades', priority.includes(t) ? priority.filter((x) => x !== t) : [...priority, t]);

  return (
    <Page
      title="Lead Finder"
      sub={f.loaded ? `${f.total.toLocaleString()} WA businesses from public records · ${f.withPhone.toLocaleString()} with phone numbers · ${newCount.toLocaleString()} new in the last 30 days` : 'Loading…'}
      actions={<>
        <button className="btn hide-mobile" disabled={!rows.length} onClick={() => exportCsv('lead-finder', rows.slice(0, 5000))}><ExportIcon size={15} /> Export</button>
        <button className="btn primary" disabled={f.refreshing} onClick={() => refreshPool()}><RefreshCw size={15} className={f.refreshing ? 'spin' : ''} /> {f.refreshing ? 'Downloading…' : 'Refresh data'}</button>
      </>}
    >
      <div className="stack">
        {f.refreshing && <div className="banner" style={{ borderRadius: 10 }}><RefreshCw size={15} className="spin" /> {f.progress}</div>}
        {f.loaded && !f.total && !f.refreshing && (
          <div className="card">
            <Empty>
              <Database size={28} /><br />
              No public records downloaded yet. Tap <b>Refresh data</b> to download every licensed home-service business in Washington (about 20 MB, takes a minute or two).
            </Empty>
          </div>
        )}

        <div className="split">
          <div className="card">
            <div className="card-head"><Database size={16} /><h3>Sources</h3><span className="faint" style={{ marginLeft: 'auto', fontSize: '0.78rem' }}>{f.fetchedAt ? `updated ${ago(new Date(f.fetchedAt).toISOString())}` : 'never downloaded'}</span></div>
            {SOURCES.map((s) => {
              const st = f.sources[s.id];
              return (
                <div className="list-item" key={s.id}>
                  <input type="checkbox" checked={enabled[s.id] !== false} onChange={(e) => setSetting('publicSources', { ...DEFAULT_ENABLED, ...enabled, [s.id]: e.target.checked })} />
                  <div className="grow">
                    <div className="title">{s.name} {!s.hasPhones && <span className="pill warn">no phones</span>}</div>
                    <div className="meta" style={{ whiteSpace: 'normal' }}>{s.description}</div>
                    {st?.error && <div className="meta" style={{ color: 'var(--bad)' }}>Last download failed: {st.error}</div>}
                  </div>
                  <span className="faint" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{st ? st.count.toLocaleString() : '—'}</span>
                </div>
              );
            })}
            <div className="faint" style={{ fontSize: '0.75rem', marginTop: 8 }}>
              Data refreshes automatically every week. Businesses appear in Leads and Call Mode right away; they're saved to your Google Sheet only once you call, note or change them.
            </div>
          </div>
          <div className="card">
            <div className="card-head"><Sparkles size={16} /><h3>Priority trades</h3><span className="faint" style={{ marginLeft: 'auto', fontSize: '0.78rem' }}>boosts score +15</span></div>
            <div className="chips">
              {DEFAULT_TRADES.filter((t) => t !== 'Other').map((t) => (
                <button key={t} className={`chip ${priority.includes(t) ? 'on' : ''}`} onClick={() => togglePriority(t)}>{t}</button>
              ))}
            </div>
            <div className="faint" style={{ fontSize: '0.75rem', marginTop: 10 }}>
              Score (0–100) = trade value + has phone + owner name + small-business type + newly licensed + found in more than one source. Call Mode calls the highest scores first.
            </div>
          </div>
        </div>

        <div className="row wrap">
          <div className="search" style={{ flex: '1 1 220px' }}><Search size={15} /><input placeholder="Search name, owner, phone, specialty…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select style={{ width: 170 }} value={trade} onChange={(e) => setTrade(e.target.value)}>
            <option value="">All trades</option>{byTrade.map(([t, n]) => <option key={t} value={t}>{t} ({n.toLocaleString()})</option>)}
          </select>
          <input style={{ width: 140 }} placeholder="City or ZIP" value={city} onChange={(e) => setCity(e.target.value)} />
          <select style={{ width: 130 }} value={phone} onChange={(e) => setPhone(e.target.value as any)}>
            <option value="yes">Has phone</option><option value="no">Needs phone</option><option value="any">Any</option>
          </select>
          <select style={{ width: 130 }} value={source} onChange={(e) => setSource(e.target.value as any)}>
            <option value="">All sources</option>{(Object.keys(SOURCE_LABEL) as SourceId[]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="row wrap" style={{ fontSize: '0.85rem' }}>
          <label className="row"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> New businesses (30 days)</label>
          <label className="row"><input type="checkbox" checked={untouched} onChange={(e) => setUntouched(e.target.checked)} /> Not contacted yet</label>
          <label className="row" style={{ gap: 8 }}>Min score <input type="range" min="0" max="100" step="5" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} style={{ width: 120 }} /> <b>{minScore}</b></label>
          <span className="spacer" />
          <b>{rows.length.toLocaleString()} matches</b>
        </div>

        {rows.length === 0 && f.total > 0 && <div className="card"><Empty>No businesses match these filters.</Empty></div>}
        {rows.length > 0 && (mobile ? (
          <div className="card" style={{ padding: '4px 12px' }}>
            {rows.slice(0, limit).map((l) => <FinderCard key={l.id} l={l} onOpen={() => navigate(`/leads/${l.id}`)} onCall={() => startCall({ type: 'lead', id: l.id })} />)}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Score</th><th>Business</th><th>Trade</th><th>City</th><th>Phone</th><th>Licensed</th><th>Source</th><th></th></tr></thead>
              <tbody>
                {rows.slice(0, limit).map((l) => (
                  <tr key={l.id} onClick={() => navigate(`/leads/${l.id}`)}>
                    <td><ScorePill score={l.score || 0} /></td>
                    <td><div className="strong">{l.company}{isNewBusiness(l.licenseStart || '') && <span className="pill good" style={{ marginLeft: 6 }}>NEW</span>}</div><div className="faint" style={{ fontSize: '0.78rem' }}>{l.contactName}{l.ownership ? ` · ${l.ownership}` : ''}</div></td>
                    <td><div>{l.trade}</div><div className="faint" style={{ fontSize: '0.72rem', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.specialty}</div></td>
                    <td>{l.city}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{l.phone ? formatPhone(l.phone) : <span className="pill warn">needs phone</span>}</td>
                    <td>{shortDate(l.licenseStart ? l.licenseStart + 'T12:00:00' : '')}</td>
                    <td className="faint" style={{ fontSize: '0.78rem' }}>{l.source}</td>
                    <td onClick={(e) => e.stopPropagation()}>{l.phone && <button className="btn call sm" onClick={() => startCall({ type: 'lead', id: l.id })}><Phone size={13} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {rows.length > limit && <button className="btn block" onClick={() => setLimit(limit + 300)}>Show more ({(rows.length - limit).toLocaleString()} hidden)</button>}
      </div>
    </Page>
  );
}

export function ScorePill({ score }: { score: number }) {
  return <span className={`pill ${score >= 75 ? 'good' : score >= 50 ? 'accent' : score >= 30 ? 'warn' : ''}`}>{score}</span>;
}

function FinderCard({ l, onOpen, onCall }: { l: Lead; onOpen: () => void; onCall: () => void }) {
  return (
    <div className="list-item">
      <div className="grow" onClick={onOpen}>
        <div className="title">{l.company}</div>
        <div className="meta row wrap" style={{ gap: 6, marginTop: 3 }}>
          <ScorePill score={l.score || 0} />{isNewBusiness(l.licenseStart || '') && <span className="pill good">NEW</span>}
          <span>{l.trade}{l.city ? ` · ${l.city}` : ''}</span>
        </div>
        <div className="meta">{l.contactName || l.specialty}</div>
      </div>
      {l.phone ? <button className="btn call" onClick={onCall}><Phone size={17} /></button> : <StatusPill status="No phone" />}
    </div>
  );
}
