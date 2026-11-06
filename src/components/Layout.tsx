import { isPast } from 'date-fns';
import { Briefcase, CheckSquare, Contact2, Gauge, Lightbulb, Mail, Menu, PhoneCall, RefreshCw, Search, Settings, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { isDesktop } from '../lib/platform';
import { unreadEmails } from '../lib/emailmatch';
import { useTable } from '../lib/store';
import { syncNow, useSecurity, useSyncState } from '../lib/sync';
import { installUpdate, useUpdateState } from '../lib/updater';
import { ago } from '../lib/format';
import { Modal } from './ui';
import { DeskPhoneBanner } from './DeskPhone';

const NAV = [
  { to: '/', label: 'Today', icon: Gauge, end: true },
  { to: '/call', label: 'Call Mode', icon: PhoneCall },
  { to: '/leads', label: 'Leads', icon: Users },
  { to: '/finder', label: 'Lead Finder', icon: Search },
  { to: '/contacts', label: 'Contacts', icon: Contact2 },
  { to: '/pipeline', label: 'Pipeline', icon: Briefcase },
  { to: '/tasks', label: 'Follow-ups', icon: CheckSquare, badge: true },
  { to: '/email', label: 'Email', icon: Mail, unread: true },
  { to: '/suggestions', label: 'Suggestions', icon: Lightbulb },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function SyncIndicator({ compact }: { compact?: boolean }) {
  const s = useSyncState();
  const label =
    s.status === 'syncing' ? 'Syncing…'
    : s.status === 'error' ? 'Sync error'
    : s.status === 'offline' ? 'Offline'
    : s.status === 'not-configured' ? 'Sync not set up'
    : `Synced ${ago(new Date(s.lastSyncedAt).toISOString())}`;
  return (
    <button className="btn ghost sm" onClick={() => syncNow()} title={s.error || 'Sync now'} style={{ gap: 8, width: compact ? undefined : '100%', justifyContent: 'flex-start' }}>
      <span className={`sync-dot ${s.status}`} />
      {!compact && <span style={{ fontSize: '0.78rem' }}>{s.lastSyncedAt || s.status !== 'idle' ? label : 'Not synced yet'}{s.pending ? ` · ${s.pending} pending` : ''}</span>}
      <RefreshCw size={13} style={{ marginLeft: compact ? 0 : 'auto' }} />
    </button>
  );
}

function UpdateBanner() {
  const u = useUpdateState();
  if (!['available', 'downloading', 'ready', 'installing'].includes(u.status) && !(u.status === 'available' && u.error)) return null;
  return (
    <div className="banner">
      <RefreshCw size={15} />
      <span style={{ flex: 1 }}>
        {u.status === 'available' && (u.error || `Update ${u.version} is available.`)}
        {u.status === 'downloading' && `Downloading update ${u.version}… ${Math.round((u.progress || 0) * 100)}%`}
        {u.status === 'ready' && `Update ${u.version} downloaded — it installs automatically when you quit, or restart now.`}
        {u.status === 'installing' && `Installing update ${u.version}…`}
      </span>
      {u.status === 'available' && <button className="btn primary sm" onClick={() => installUpdate()}>Install</button>}
      {u.status === 'ready' && <button className="btn primary sm" onClick={() => installUpdate()}>Restart now</button>}
    </div>
  );
}

function SyncErrorBanner() {
  const s = useSyncState();
  const loc = useLocation();
  if (s.status === 'not-configured' && loc.pathname !== '/settings')
    return <div className="banner warn"><span style={{ flex: 1 }}>Data is only saved on this device. Connect your Google Sheet to sync.</span><NavLink className="btn sm" to="/settings">Set up sync</NavLink></div>;
  if (s.status === 'error')
    return <div className="banner bad"><span style={{ flex: 1 }}>Sync error: {s.error}</span><button className="btn sm" onClick={() => syncNow()}>Retry</button></div>;
  return null;
}

/** Until the CRM is locked with the sync key, a reminder (hidden for the session once dismissed). */
function LockBanner() {
  const sec = useSecurity();
  const [hidden, setHidden] = useState(() => sessionStorage.getItem('tl.lockBannerHidden') === '1');
  if (!sec || sec.locked || hidden) return null;
  return (
    <div className="banner warn">
      🔓 <span style={{ flex: 1 }}>Lock your CRM: anyone who finds the sync link can read or change it. It takes 2 minutes.</span>
      <NavLink to="/settings" className="btn sm">Settings</NavLink>
      <button className="btn ghost sm" onClick={() => { sessionStorage.setItem('tl.lockBannerHidden', '1'); setHidden(true); }}>Later</button>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const tasks = useTable('tasks');
  const overdue = tasks.filter((t) => !t.done && t.dueAt && isPast(new Date(t.dueAt))).length;
  const acts = useTable('activities');
  const unread = useMemo(() => unreadEmails(acts).length, [acts]);
  // Mac: unread email from leads/contacts on the dock icon.
  useEffect(() => { window.tradelinkDesktop?.setBadge?.(unread); }, [unread]);
  const [more, setMore] = useState(false);
  const loc = useLocation();
  const current = NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))?.label || 'TradeLink';

  return (
    <div className={`app ${isDesktop() ? 'is-desktop' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-logo">TL</div>TradeLink CRM</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
            <n.icon size={17} /> {n.label}
            {n.badge && overdue > 0 && <span className="count">{overdue}</span>}
            {n.unread && unread > 0 && <span className="count unread" title={`${unread} unread email${unread === 1 ? '' : 's'} from leads & contacts`}>{unread}</span>}
          </NavLink>
        ))}
        <div className="sidebar-foot"><SyncIndicator /></div>
      </aside>
      <div className="main">
        <div className="mobile-top">
          <div className="brand-logo">TL</div>
          <div className="title">{current}</div>
          <SyncIndicator compact />
        </div>
        <UpdateBanner />
        <DeskPhoneBanner />
        <SyncErrorBanner />
        <LockBanner />
        {children}
        <nav className="bottom-nav">
          <NavLink to="/" end><Gauge size={21} />Today</NavLink>
          <NavLink to="/call"><PhoneCall size={21} />Call</NavLink>
          <NavLink to="/leads"><Users size={21} />Leads</NavLink>
          <NavLink to="/tasks"><CheckSquare size={21} />Follow-ups{overdue > 0 && <span className="dot">{overdue}</span>}</NavLink>
          <button onClick={() => setMore(true)}><Menu size={21} />More{unread > 0 && <span className="dot unread">{unread}</span>}</button>
        </nav>
      </div>
      {more && (
        <Modal title="More" onClose={() => setMore(false)}>
          <div className="col">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className="nav-link" onClick={() => setMore(false)}>
                <n.icon size={18} /> {n.label}
                {n.unread && unread > 0 && <span className="count unread">{unread}</span>}
              </NavLink>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Page({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
