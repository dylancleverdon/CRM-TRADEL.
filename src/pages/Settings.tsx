import { Check, Copy, Download, RefreshCw, Upload } from 'lucide-react';
import { useState } from 'react';
import scriptCode from '../../apps-script/Code.gs?raw';
import { Page } from '../components/Layout';
import { Field, InlineInput, toast } from '../components/ui';
import { DEFAULT_GOALS, DEFAULT_SCRIPT, DEFAULT_SERVICES, DEFAULT_STAGES, DEFAULT_TRADES, GITHUB_REPO, type StageDef } from '../lib/constants';
import { ago } from '../lib/format';
import { platformName } from '../lib/platform';
import { setSetting, store, useSetting } from '../lib/store';
import { fullResync, getSyncUrl, setSyncUrl, syncNow, testConnection, useSyncState } from '../lib/sync';
import { setThemePrefs, THEMES, useThemePrefs } from '../lib/theme';
import { APP_VERSION, checkForUpdate, installUpdate, useUpdateState } from '../lib/updater';

export default function Settings() {
  return (
    <Page title="Settings" sub={`TradeLink CRM v${APP_VERSION} · ${platformName()}`}>
      <div className="split">
        <div className="stack">
          <SyncSettings />
          <Appearance />
          <Updates />
        </div>
        <div className="stack">
          <Profile />
          <ListSetting title="Services you sell (opportunity types)" k="services" fallback={DEFAULT_SERVICES} />
          <ListSetting title="Trades (industries)" k="trades" fallback={DEFAULT_TRADES} />
          <Stages />
          <DataTools />
        </div>
      </div>
    </Page>
  );
}

function SyncSettings() {
  const s = useSyncState();
  const [url, setUrl] = useState(getSyncUrl());
  const [testing, setTesting] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const connect = async () => {
    setTesting(true);
    try {
      const r = await testConnection(url);
      setSyncUrl(url);
      toast(`Connected to "${r.sheet}"`);
      await syncNow();
    } catch (e: any) {
      toast(`Could not connect: ${e?.message || e}`);
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="card">
      <div className="card-head"><h3>Google Sheet sync</h3><span className={`sync-dot ${s.status}`} style={{ marginLeft: 'auto' }} /><span className="faint" style={{ fontSize: '0.8rem' }}>{s.status === 'idle' ? `Synced ${ago(new Date(s.lastSyncedAt).toISOString())}` : s.status}</span></div>
      <div className="stack">
        <Field label="Apps Script web app URL (ends in /exec)">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
        </Field>
        {s.error && <div className="pill bad" style={{ whiteSpace: 'normal' }}>{s.error}</div>}
        <div className="row wrap">
          <button className="btn primary" disabled={!url || testing} onClick={connect}>{testing ? 'Connecting…' : 'Connect & sync'}</button>
          <button className="btn" disabled={!getSyncUrl()} onClick={() => syncNow()}><RefreshCw size={14} /> Sync now</button>
          <button className="btn ghost" disabled={!getSyncUrl()} onClick={() => fullResync().then(() => toast('Full re-sync complete'))}>Full re-sync</button>
          {s.pending > 0 && <span className="faint" style={{ fontSize: '0.8rem' }}>{s.pending} changes waiting</span>}
        </div>
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowScript(!showScript)}>{showScript ? 'Hide' : 'Show'} setup instructions</button>
        {showScript && (
          <div className="card" style={{ background: 'var(--bg-2)' }}>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: '0.88rem', lineHeight: 1.7 }}>
              <li>Open your Google Sheet <b>CRM Tradelink Data Storage</b>.</li>
              <li>Click <b>Extensions → Apps Script</b>. Delete the starter code and paste the script (copy button below). Click <b>Save</b>.</li>
              <li>Click <b>Deploy → New deployment</b>, choose type <b>Web app</b>. Set <i>Execute as</i> = <b>Me</b> and <i>Who has access</i> = <b>Anyone</b>. Click <b>Deploy</b> and allow the permissions (Advanced → Go to project if Google warns you).</li>
              <li>Copy the <b>Web app URL</b> and paste it above on <b>both</b> the Mac and the phone app.</li>
            </ol>
            <button className="btn sm" style={{ marginTop: 10 }} onClick={() => { navigator.clipboard.writeText(scriptCode); toast('Script copied'); }}><Copy size={14} /> Copy Apps Script code</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Appearance() {
  const p = useThemePrefs();
  return (
    <div className="card">
      <div className="card-head"><h3>Appearance</h3></div>
      <div className="stack">
        <div className="tabs" style={{ width: 'fit-content' }}>
          {(['dark', 'light', 'system'] as const).map((m) => <button key={m} className={p.mode === m ? 'on' : ''} onClick={() => setThemePrefs({ mode: m })}>{m === 'dark' ? '🌙 Dark' : m === 'light' ? '☀️ Light' : '💻 System'}</button>)}
        </div>
        <div className="grid g2">
          {THEMES.map((t) => (
            <button key={t.id} className={`theme-swatch ${p.theme === t.id ? 'on' : ''}`} onClick={() => setThemePrefs({ theme: t.id })}>
              <span className="sw" style={{ background: `linear-gradient(135deg, hsl(${t.hue} ${Math.min(t.sat, 40)}% 9%) 50%, hsl(${t.hue} ${t.sat}% ${t.accentL ?? 45}%) 50%)` }} />
              {t.name}
              {p.theme === t.id && <Check size={15} style={{ marginLeft: 'auto' }} />}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <Field label="Density">
            <select value={p.density} onChange={(e) => setThemePrefs({ density: e.target.value as any })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select>
          </Field>
          <Field label={`Text size (${Math.round(p.fontScale * 100)}%)`}>
            <input type="range" min="0.85" max="1.25" step="0.05" value={p.fontScale} onChange={(e) => setThemePrefs({ fontScale: Number(e.target.value) })} />
          </Field>
        </div>
        <label className="row" style={{ fontSize: '0.88rem' }}><input type="checkbox" checked={p.oled} onChange={(e) => setThemePrefs({ oled: e.target.checked })} /> Pure black background in dark mode (saves battery on phones)</label>
      </div>
    </div>
  );
}

function Updates() {
  const u = useUpdateState();
  const [auto, setAuto] = useState(localStorage.getItem('tl.autoUpdate') !== 'off');
  return (
    <div className="card">
      <div className="card-head"><h3>Updates</h3><span className="faint" style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>v{APP_VERSION}</span></div>
      <div className="stack">
        <div style={{ fontSize: '0.9rem' }}>
          {u.status === 'none' && `You're up to date${u.version ? ` (latest ${u.version})` : ''}.`}
          {u.status === 'checking' && 'Checking…'}
          {u.status === 'available' && (u.error || `Version ${u.version} is available.`)}
          {u.status === 'downloading' && `Downloading ${u.version}… ${Math.round((u.progress || 0) * 100)}%`}
          {u.status === 'ready' && `Version ${u.version} is ready to install.`}
          {u.status === 'installing' && 'Installing…'}
          {u.status === 'error' && <span style={{ color: 'var(--bad)' }}>Update check failed: {u.error}</span>}
          {u.status === 'idle' && 'Updates are checked automatically on launch and every few hours.'}
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => checkForUpdate(true)}><RefreshCw size={14} /> Check now</button>
          {(u.status === 'available' || u.status === 'ready') && <button className="btn primary" onClick={() => installUpdate()}>Install update</button>}
        </div>
        <label className="row" style={{ fontSize: '0.88rem' }}>
          <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); localStorage.setItem('tl.autoUpdate', e.target.checked ? 'on' : 'off'); }} />
          Download & install updates automatically
        </label>
        <div className="faint" style={{ fontSize: '0.78rem' }}>Releases: github.com/{GITHUB_REPO}/releases</div>
      </div>
    </div>
  );
}

function Profile() {
  const name = useSetting('myName', '');
  const goals = useSetting('goals', DEFAULT_GOALS);
  const script = useSetting('callScript', DEFAULT_SCRIPT);
  const g = (k: keyof typeof DEFAULT_GOALS) => (v: string) => setSetting('goals', { ...goals, [k]: Number(v) || 0 });
  return (
    <div className="card">
      <div className="card-head"><h3>You & daily goals</h3></div>
      <div className="form-grid">
        <Field label="Your first name" full><InlineInput value={name} onSave={(v) => setSetting('myName', v)} /></Field>
        <Field label="Calls / day"><InlineInput type="number" value={goals.calls} onSave={g('calls')} /></Field>
        <Field label="Connects / day"><InlineInput type="number" value={goals.connects} onSave={g('connects')} /></Field>
        <Field label="Meetings / day"><InlineInput type="number" value={goals.meetings} onSave={g('meetings')} /></Field>
        <Field label="Follow-ups / day"><InlineInput type="number" value={goals.followUps} onSave={g('followUps')} /></Field>
        <Field label="Call script — placeholders: {company} {trade} {city} {name} {myName}" full>
          <ScriptEditor value={script} />
        </Field>
      </div>
    </div>
  );
}

function ScriptEditor({ value }: { value: string }) {
  const [v, setV] = useState(value);
  return (
    <>
      <textarea rows={9} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && setSetting('callScript', v)} />
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setV(DEFAULT_SCRIPT); setSetting('callScript', DEFAULT_SCRIPT); }}>Reset to default</button>
    </>
  );
}

function ListSetting({ title, k, fallback }: { title: string; k: string; fallback: string[] }) {
  const list = useSetting<string[]>(k, fallback);
  const [add, setAdd] = useState('');
  return (
    <div className="card">
      <div className="card-head"><h3>{title}</h3></div>
      <div className="chips">
        {list.map((x) => (
          <span key={x} className="chip" style={{ cursor: 'default' }}>{x} <button className="btn ghost sm icon" style={{ padding: 0, marginLeft: 4 }} onClick={() => setSetting(k, list.filter((y) => y !== x))}>✕</button></span>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add…" onKeyDown={(e) => { if (e.key === 'Enter' && add.trim()) { setSetting(k, [...list, add.trim()]); setAdd(''); } }} />
        <button className="btn" onClick={() => { if (add.trim()) { setSetting(k, [...list, add.trim()]); setAdd(''); } }}>Add</button>
      </div>
    </div>
  );
}

function Stages() {
  const st = useSetting<StageDef[]>('stages', DEFAULT_STAGES);
  const upd = (i: number, patch: Partial<StageDef>) => setSetting('stages', st.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="card">
      <div className="card-head"><h3>Pipeline stages</h3><button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setSetting('stages', DEFAULT_STAGES)}>Reset</button></div>
      {st.map((s, i) => (
        <div className="row" key={i} style={{ marginBottom: 6 }}>
          <InlineInput value={s.name} onSave={(v) => upd(i, { name: v })} disabled={!!s.closed} />
          <div style={{ width: 90 }}><InlineInput type="number" value={s.probability} onSave={(v) => upd(i, { probability: Number(v) || 0 })} /></div>
          <span className="faint" style={{ width: 16 }}>%</span>
          {!s.closed && <button className="btn ghost sm" onClick={() => setSetting('stages', st.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      <button className="btn sm" onClick={() => {
        const open = st.filter((s) => !s.closed), closed = st.filter((s) => s.closed);
        setSetting('stages', [...open, { name: 'New stage', probability: 50 }, ...closed]);
      }}>Add stage</button>
    </div>
  );
}

function DataTools() {
  const backup = () => {
    const dump: Record<string, any[]> = {};
    (Object.keys(store.data) as (keyof typeof store.data)[]).forEach((t) => (dump[t] = Array.from(store.data[t].values())));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dump)], { type: 'application/json' }));
    a.download = `tradelink-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  const restore = (f: File) => {
    f.text().then(async (txt) => {
      if (!confirm('Replace all local data with this backup? It will then sync to the sheet.')) return;
      await store.replaceAll(JSON.parse(txt));
      toast('Backup restored');
      syncNow();
    });
  };
  return (
    <div className="card">
      <div className="card-head"><h3>Data</h3></div>
      <div className="row wrap">
        <button className="btn" onClick={backup}><Download size={14} /> Download backup</button>
        <label className="btn"><Upload size={14} /> Restore backup<input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} /></label>
      </div>
      <div className="faint" style={{ fontSize: '0.78rem', marginTop: 8 }}>Your data lives in the Google Sheet and is cached on each device so the app works offline.</div>
    </div>
  );
}
