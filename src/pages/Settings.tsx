import { BellRing, CalendarClock, Check, Copy, Download, Eye, EyeOff, Lock, RefreshCw, Smartphone, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import scriptCode from '../../apps-script/Loader.gs?raw';
import emailLoaderCode from '../../apps-script/EmailLoader.gs?raw';
import { CallingSettings } from '../components/DeskPhone';
import { Page } from '../components/Layout';
import { Field, InlineInput, toast } from '../components/ui';
import { DEFAULT_GOALS, DEFAULT_SCRIPT, DEFAULT_SERVICES, DEFAULT_STAGES, DEFAULT_TRADES, GITHUB_REPO, type StageDef } from '../lib/constants';
import { DEFAULT_ENGINE, GOAL_LABEL, type EngineGoal } from '../lib/engine';
import { ago } from '../lib/format';
import { useEngineSettings } from '../lib/useEngine';
import { connectorCall, emailConnected } from '../lib/email';
import { calendarReady, DEFAULT_MEETINGS, meetingSettings, WEEKDAYS, type MeetingSettings } from '../lib/meetings';
import { DEFAULT_CONTACT_ACCOUNT, getContactSave, setContactSave, type ContactSaveMode } from '../lib/phonecontacts';
import { allowCallLog } from '../lib/talktime';
import { allowExactTiming, nextReminder, reminderAccess, remindersOn, rescheduleAllReminders, scheduledCount, setReminders, type ReminderAccess } from '../lib/reminders';
import { DEFAULT_FOLLOW_UP_TEXT, TEXT_PLACEHOLDERS } from '../lib/texts';
import { isAndroid, isDesktop, Native, openExternal, platformName } from '../lib/platform';
import { setSetting, store, useSetting } from '../lib/store';
import { cleanServiceName } from '../lib/services';
import { fullResync, getSyncKey, getSyncUrl, lockCrm, saveSyncKey, sendKeyToPhone, setSyncUrl, syncNow, testConnection, thisDeviceId, useSecurity, useSyncState } from '../lib/sync';
import { setThemePrefs, THEMES, useThemePrefs } from '../lib/theme';
import { APP_VERSION, checkForUpdate, installUpdate, useUpdateState } from '../lib/updater';

export default function Settings() {
  return (
    <Page title="Settings" sub={`TradeLink CRM v${APP_VERSION} · ${platformName()}`}>
      <div className="split">
        <div className="stack">
          <SyncSettings />
          <SecuritySettings />
          <CallingSettings />
          <FollowUpText />
          {isAndroid() && <PhoneContacts />}
          {isAndroid() && <ReminderSettings />}
          {isAndroid() && <TalkTimeSettings />}
          <Appearance />
          <Updates />
        </div>
        <div className="stack">
          <Profile />
          <MeetingSettingsCard />
          <LeadEngineSettings />
          <ListSetting title="Services you sell (opportunity types)" k="services" fallback={DEFAULT_SERVICES} />
          <ListSetting title="Trades (industries)" k="trades" fallback={DEFAULT_TRADES} />
          <Stages />
          <DataTools />
        </div>
      </div>
    </Page>
  );
}

/** Lock the CRM with the private sync key, and see the daily backups. */
function SecuritySettings() {
  const sec = useSecurity();
  const [key, setKey] = useState(getSyncKey());
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState('');
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try { await fn(); } catch (e: any) { toast(e?.message || String(e)); } finally { setBusy(''); }
  };
  const save = () => run('save', async () => {
    const ok = await saveSyncKey(key);
    toast(ok ? 'Sync key saved on this device' : "That key doesn't match. Copy it again from the 🔒 Sync key tab of your Google Sheet.");
  });
  const send = () => run('send', async () => { await sendKeyToPhone((s) => toast(s)); toast('📱 Your phone has the key'); });
  const lock = () => run('lock', async () => {
    const waiting = Object.values(sec?.devices || {}).filter((d) => !d.keyed && Date.now() - d.at < 7 * 86400000);
    if (waiting.length && !confirm(`${waiting.map((d) => d.name).join(' and ')} hasn't synced with the key yet. Once locked, it stops syncing until you add the key there (nothing is lost). Lock anyway?`)) return;
    await lockCrm();
    toast('🔒 Locked: only your devices with the key can use the CRM now');
  });
  const devices = Object.entries(sec?.devices || {}).sort((a, b) => b[1].at - a[1].at);
  const backups = sec?.backup;
  const lastBackup = backups?.copies.reduce((m, c) => Math.max(m, c.at), 0) || 0;
  return (
    <div className="card">
      <div className="card-head"><Lock size={15} /><h3>Security &amp; backups</h3>
        {sec && <span className={`pill ${sec.locked ? 'good' : 'warn'}`} style={{ marginLeft: 'auto' }}>{sec.locked ? 'Locked' : 'Not locked yet'}</span>}
      </div>
      <div className="stack">
        {!sec && <div className="faint" style={{ fontSize: '0.82rem' }}>Checking with your sheet…</div>}
        {sec && !sec.locked && (
          <div className="faint" style={{ fontSize: '0.82rem' }}>
            Anyone who finds the sync link can read or change your CRM until you lock it. Your key is in the <b>🔒 Sync key</b> tab of your Google Sheet
            (only you can open it). Paste it here, {isDesktop() ? 'send it to your phone, ' : 'add it on your Mac too, '}then tap Lock my CRM.
          </div>
        )}
        {sec?.locked && !sec.keyed && <div className="pill bad" style={{ whiteSpace: 'normal' }}>Your CRM is locked and this device doesn't have the key yet. Paste it below to start syncing again.</div>}
        <Field label="Sync key">
          <div className="row" style={{ gap: 6 }}>
            <input type={show ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the key from the 🔒 Sync key tab" autoComplete="off" />
            <button className="btn ghost icon" title={show ? 'Hide' : 'Show'} onClick={() => setShow(!show)}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          </div>
        </Field>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn primary sm" disabled={!key.trim() || busy === 'save'} onClick={save}>{busy === 'save' ? 'Checking…' : 'Save key'}</button>
          {sec?.sheetUrl && <button className="btn sm" onClick={() => openExternal(sec.sheetUrl!)}>Open my Google Sheet</button>}
          {isDesktop() && sec?.keyed && <button className="btn sm" disabled={busy === 'send'} onClick={send}><Smartphone size={14} /> {busy === 'send' ? 'Sending…' : 'Send key to my phone'}</button>}
          {sec?.keyed && !sec.locked && <button className="btn sm" disabled={busy === 'lock'} onClick={lock}><Lock size={14} /> Lock my CRM</button>}
        </div>
        {devices.length > 0 && (
          <div style={{ fontSize: '0.84rem' }}>
            {devices.map(([id, d]) => (
              <div key={id} className="row" style={{ gap: 6, padding: '2px 0' }}>
                <span className={`pill ${d.keyed ? 'good' : 'warn'}`}>{d.keyed ? 'Has the key' : 'No key yet'}</span>
                <span>{d.name}{id === thisDeviceId() ? ' (this device)' : ''}</span>
                <span className="faint">· {ago(new Date(d.at).toISOString())}</span>
              </div>
            ))}
          </div>
        )}
        {sec && <ConnectorLock crmLocked={sec.locked} />}
        {backups && (
          <div style={{ fontSize: '0.84rem' }}>
            <b>Backups</b> <span className="faint">· two copies in your Drive, refreshed on alternating days</span>
            <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
              <span className="faint">{lastBackup ? `Last backup ${ago(new Date(lastBackup).toISOString())}` : 'First backup runs on the next sync'}</span>
              {backups.copies.map((c) => <button key={c.slot} className="btn ghost sm" onClick={() => openExternal(c.url)}>Copy {c.slot}{c.at ? ` (${ago(new Date(c.at).toISOString())})` : ''}</button>)}
            </div>
            {backups.error && <div className="pill bad" style={{ whiteSpace: 'normal', marginTop: 4 }}>Last backup failed: {backups.error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Your email connector (Gmail, and texts/contacts sent through your phone) follows the CRM's lock with the same key. */
function ConnectorLock({ crmLocked }: { crmLocked: boolean }) {
  const [st, setSt] = useState<{ locked?: boolean; keyed?: boolean; old?: boolean; error?: string } | null>(null);
  useEffect(() => {
    if (!emailConnected()) return;
    let live = true;
    connectorCall({ action: 'ping' })
      .then((r) => live && setSt({ locked: !!r.locked, keyed: !!r.keyed, old: r.locked === undefined }))
      .catch((e) => live && setSt({ error: e?.message || String(e) }));
    return () => { live = false; };
  }, [crmLocked]);
  if (!st) return null;
  const line = (pill: string, label: string, text: string) => (
    <div className="row wrap" style={{ gap: 6, fontSize: '0.84rem' }}><span className={`pill ${pill}`}>{label}</span><span className="faint">{text}</span></div>
  );
  if (st.error) return line('bad', 'Email connector', st.error);
  if (st.locked && st.keyed) return line('good', 'Email connector locked', 'Gmail, texts and contacts through your phone need the key too');
  if (st.locked) return line('bad', 'Email connector locked', "this device doesn't have the key yet");
  if (st.old) return line('warn', 'Email connector', 'updating itself to the version that locks with your key (within 10 minutes)');
  return line('warn', 'Email connector not locked yet', crmLocked ? 'it locks itself within 10 minutes' : 'it locks together with your CRM');
}

/** Google Calendar invites with Meet: your weekly hours, length, invite text, and the one-time connector step. */
function MeetingSettingsCard() {
  const s = meetingSettings(useSetting<Partial<MeetingSettings>>('meetings', {}));
  const set = (patch: Partial<MeetingSettings>) => setSetting('meetings', { ...s, ...patch });
  const setDay = (i: number, patch: Partial<MeetingSettings['week'][number]>) => set({ week: s.week.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const [ready, setReady] = useState<boolean | null>(null);
  const [err, setErr] = useState('');
  const check = () => {
    if (!emailConnected()) return;
    setErr('');
    calendarReady().then(setReady).catch((e) => setErr(e?.message || String(e)));
  };
  useEffect(check, []);
  const order = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  return (
    <div className="card">
      <div className="card-head"><CalendarClock size={15} /><h3>Meetings (Google Calendar)</h3>
        {ready === true && <span className="pill good" style={{ marginLeft: 'auto' }}>Calendar connected</span>}
        {ready === false && <span className="pill warn" style={{ marginLeft: 'auto' }}>Calendar not added yet</span>}
      </div>
      <div className="faint" style={{ fontSize: '0.82rem', marginBottom: 10 }}>
        Meeting Booked and Add meeting invite send a Google Calendar invite with a Google Meet link from your email connector's account.
        The time picker greys out times outside these hours and times already busy on your calendar.
      </div>
      {!emailConnected() && <div className="pill warn" style={{ whiteSpace: 'normal', marginBottom: 10 }}>Connect your email first (Email tab): invites go out through it.</div>}
      {err && <div className="pill bad" style={{ whiteSpace: 'normal', marginBottom: 10 }}>{err}</div>}
      {ready === false && (
        <div className="card" style={{ background: 'var(--warn-soft)', marginBottom: 12 }}>
          <b style={{ fontSize: '0.88rem' }}>One-time step (about 2 minutes), signed in to Google as your email connector's account:</b>
          <ol style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: '0.86rem', lineHeight: 1.7 }}>
            <li>Open <b>script.google.com</b> → your <b>TradeLink Email</b> project. Replace all the code with the new connector (Copy below) and click <b>Save</b>.</li>
            <li>On the left, <b>Services (+)</b> → <b>Google Calendar API</b> → <b>Add</b>.</li>
            <li>Pick <b>updateNow</b> in the toolbar → <b>▶ Run</b> → approve the new Calendar permission.</li>
            <li><b>Deploy → Manage deployments</b> → ✏️ <b>Edit</b> → Version: <b>New version</b> → <b>Deploy</b>. The URL stays the same.</li>
          </ol>
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            <button className="btn sm" onClick={() => { navigator.clipboard.writeText(emailLoaderCode); toast('Connector copied'); }}><Copy size={14} /> Copy email connector code</button>
            <button className="btn sm" onClick={() => openExternal('https://script.google.com/home')}>Open script.google.com</button>
            <button className="btn sm ghost" onClick={check}><RefreshCw size={13} /> Check again</button>
          </div>
        </div>
      )}
      <div style={{ fontSize: '0.84rem', fontWeight: 650, marginBottom: 6 }}>Your hours</div>
      <div className="stack" style={{ gap: 6, marginBottom: 12 }}>
        {order.map((i) => (
          <div key={i} className="row wrap" style={{ gap: 8 }}>
            <label className="row" style={{ width: 120, gap: 6, fontSize: '0.88rem' }}>
              <input type="checkbox" checked={s.week[i].on} onChange={(e) => setDay(i, { on: e.target.checked })} /> {WEEKDAYS[i]}
            </label>
            {s.week[i].on ? <>
              <input type="time" step={1800} style={{ width: 'auto' }} value={s.week[i].from} onChange={(e) => setDay(i, { from: e.target.value || '09:00' })} />
              <span className="faint">to</span>
              <input type="time" step={1800} style={{ width: 'auto' }} value={s.week[i].to} onChange={(e) => setDay(i, { to: e.target.value || '17:00' })} />
            </> : <span className="faint" style={{ fontSize: '0.82rem' }}>Not available</span>}
          </div>
        ))}
      </div>
      <div className="form-grid">
        <Field label="Meeting length">
          <select value={s.lengthMin} onChange={(e) => set({ lengthMin: Number(e.target.value) })}>
            {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes{m === DEFAULT_MEETINGS.lengthMin ? ' (default)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Invite title ({company} {firstName} {myName})"><InlineInput value={s.title} onSave={(v) => set({ title: v || DEFAULT_MEETINGS.title })} /></Field>
        <Field label="Invite description" full><InlineInput value={s.description} onSave={(v) => set({ description: v || DEFAULT_MEETINGS.description })} /></Field>
      </div>
    </div>
  );
}

/** Talk time comes from the phone's call log (for calls made here and calls the Mac rings through it). */
function TalkTimeSettings() {
  const [state, setState] = useState<string>('');
  useEffect(() => { Native.checkPermissions().then((p) => setState(p.callLog || '')).catch(() => {}); }, []);
  const allow = async () => { const ok = await allowCallLog(); setState(ok ? 'granted' : 'denied'); toast(ok ? 'Talk time will come from your call log' : 'Call log access is off: Android Settings → Apps → TradeLink CRM → Permissions'); };
  return (
    <div className="card">
      <div className="card-head"><h3>Talk time</h3>{state === 'granted' && <span className="pill good" style={{ marginLeft: 'auto' }}>From your call log</span>}</div>
      <div className="faint" style={{ fontSize: '0.82rem' }}>
        How long each call lasted is read from this phone's call log, also for calls your Mac rings through it. Without access it's estimated from when the call started to when you saved the outcome.
      </div>
      {state !== 'granted' && <button className="btn sm" style={{ marginTop: 10 }} onClick={allow}>Allow call log access</button>}
    </div>
  );
}

/** Follow-up reminders on this phone: off by default. */
function ReminderSettings() {
  const [on, setOn] = useState(remindersOn());
  const [access, setAccess] = useState<ReminderAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    let wasExact: string | undefined;
    const check = () => reminderAccess().then((a) => {
      // Just allowed exact timing in Android settings: put the reminders already scheduled on time too.
      if (wasExact === 'denied' && a.exact === 'granted') rescheduleAllReminders().finally(() => tick((n) => n + 1));
      wasExact = a.exact;
      setAccess(a);
    }).catch(() => {});
    check();
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [on]);
  const toggle = async (v: boolean) => {
    setBusy(true);
    try {
      setAccess(await setReminders(v));
      setOn(v);
      toast(v ? '🔔 Reminders on: this phone will notify you when a follow-up comes due' : 'Reminders off on this phone');
    } catch (e: any) { toast(e?.message || String(e)); } finally { setBusy(false); }
  };
  const next = on ? nextReminder() : null;
  const count = on ? scheduledCount() : 0;
  return (
    <div className="card">
      <div className="card-head"><BellRing size={15} /><h3>Follow-up reminders</h3></div>
      <label className="row" style={{ fontWeight: 600, fontSize: '0.92rem' }}>
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        Notify me on this phone when a follow-up comes due
      </label>
      <div className="faint" style={{ fontSize: '0.8rem', marginTop: 6 }}>
        At the follow-up's time, even with the app closed. Tap it to open the lead. Follow-ups you add on the Mac reach this phone the next time it syncs (when you open the app).
      </div>
      {on && access && (
        <div className="stack" style={{ marginTop: 10, fontSize: '0.84rem', gap: 6 }}>
          {access.notifications !== 'granted' && <div className="pill bad" style={{ whiteSpace: 'normal' }}>Notifications are off for TradeLink: Android Settings → Apps → TradeLink CRM → Notifications.</div>}
          {access.exact === 'denied' ? (
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="pill warn">May be a few minutes late</span>
              <button className="btn sm" onClick={() => allowExactTiming().catch(() => {})}>Allow on-time reminders</button>
            </div>
          ) : <span className="pill good" style={{ alignSelf: 'flex-start' }}>On time</span>}
          <div className="faint">
            {count ? `${count} reminder${count === 1 ? '' : 's'} scheduled` : 'No upcoming follow-ups to remind you about'}
            {next ? ` · next ${new Date(next.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}: ${next.title.replace(/^Follow-up: /, '')}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

function LeadEngineSettings() {
  const eng = useEngineSettings();
  const set = (patch: Partial<typeof eng>) => setSetting('engine', { ...eng, ...patch });
  return (
    <div className="card">
      <div className="card-head"><h3>Lead engine</h3></div>
      <div className="faint" style={{ fontSize: '0.82rem', marginBottom: 10 }}>
        Orders Call Mode by what has worked: every call teaches it which trades, cities, business ages and types pick up and
        book. Due follow-ups and My queue always come first, and nobody is ever left out.
      </div>
      <div className="form-grid">
        <Field label="Optimize for">
          <select value={eng.goal} onChange={(e) => set({ goal: e.target.value as EngineGoal })}>
            {(Object.keys(GOAL_LABEL) as EngineGoal[]).map((g) => <option key={g} value={g}>{GOAL_LABEL[g]}{g === DEFAULT_ENGINE.goal ? ' (recommended now)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Experiments in every 10 calls">
          <select value={eng.experiments} onChange={(e) => set({ experiments: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}{n === DEFAULT_ENGINE.experiments ? ' (default)' : ''}</option>)}
          </select>
        </Field>
      </div>
      <div className="faint" style={{ fontSize: '0.78rem', marginTop: 8 }}>
        Experiments try businesses it knows least about, so it keeps learning. It keeps every call's connects, meetings and deal value,
        so switching what it optimizes for uses all your history.
      </div>
    </div>
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
              <li>Click <b>Extensions → Apps Script</b>. Delete the existing code and paste the <b>auto-update loader</b> (copy button below). Click <b>Save</b>. You only ever do this once — after that the sheet updates itself.</li>
              <li>Click <b>Deploy → Manage deployments → ✏️ → Version: New version</b> (or <b>New deployment → Web app</b> the first time). Set <i>Execute as</i> = <b>Me</b> and <i>Who has access</i> = <b>Anyone</b>. Click <b>Deploy</b> and allow the permissions (Advanced → Go to project if Google warns you).</li>
              <li>Copy the <b>Web app URL</b> and paste it above on <b>both</b> the Mac and the phone app.</li>
            </ol>
            <button className="btn sm" style={{ marginTop: 10 }} onClick={() => { navigator.clipboard.writeText(scriptCode); toast('Script copied'); }}><Copy size={14} /> Copy Apps Script loader</button>
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

function FollowUpText() {
  const text = useSetting('followUpText', DEFAULT_FOLLOW_UP_TEXT);
  const [v, setV] = useState(text);
  const allow = async () => {
    try {
      const r = await Native.requestPermissions({ permissions: ['sms'] });
      toast(r.sms === 'granted' ? 'Texting allowed: the Mac can now send texts through this phone' : 'Texting is still off: allow it in Android Settings → Apps → TradeLink CRM → Permissions');
    } catch (e: any) { toast(e?.message || String(e)); }
  };
  return (
    <div className="card">
      <div className="card-head"><h3>Follow-up text</h3></div>
      <Field label={`Default message (placeholders: ${TEXT_PLACEHOLDERS})`}>
        <textarea rows={6} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== text && setSetting('followUpText', v)} />
      </Field>
      <div className="row wrap" style={{ marginTop: 8 }}>
        <button className="btn ghost sm" onClick={() => { setV(DEFAULT_FOLLOW_UP_TEXT); setSetting('followUpText', DEFAULT_FOLLOW_UP_TEXT); }}>Reset to default</button>
        {isAndroid() && <button className="btn sm" onClick={allow}>Allow texting on this phone</button>}
      </div>
      <div className="faint" style={{ fontSize: '0.78rem', marginTop: 8 }}>
        Texts go out from your own number. On the Mac, click Text (or tick "Text them" when you log a call) and your phone sends it:
        keep TradeLink open on the phone with Desk phone mode on, and connect your email on both (the request travels through your private email connector).
      </div>
    </div>
  );
}

function PhoneContacts() {
  const [s, setS] = useState(getContactSave());
  const [accounts, setAccounts] = useState<string[] | null>(null);
  const update = (patch: Partial<typeof s>) => { setContactSave(patch); setS(getContactSave()); };
  const find = async () => {
    try {
      const r = await Native.listAccounts();
      setAccounts(r.accounts);
      if (!r.accounts.length) toast('No Google account is syncing contacts on this phone yet');
    } catch (e: any) {
      toast(e?.code === 'denied' ? 'Allow Contacts access to see your accounts' : e?.message || String(e));
    }
  };
  const modes: [ContactSaveMode, string][] = [['all', 'Every call'], ['connected', 'Only when I spoke to someone'], ['off', 'Off']];
  return (
    <div className="card">
      <div className="card-head"><h3>Phone contacts</h3></div>
      <div className="faint" style={{ fontSize: '0.82rem', marginBottom: 10 }}>
        After a call, the number is saved to this phone's contacts as "Name – Company" under your Google account, so it syncs to Google Contacts
        and shows who's calling when they call back. Numbers already in your contacts are left alone, and new ones get a "TradeLink CRM" label.
        To add someone without calling, use <b>Save to phone</b> on their page (works from the Mac too, through this phone).
      </div>
      <div className="tabs" style={{ marginBottom: 12 }}>
        {modes.map(([m, label]) => <button key={m} className={s.mode === m ? 'on' : ''} onClick={() => update({ mode: m })}>{label}</button>)}
      </div>
      <Field label="Save to Google account">
        <InlineInput value={s.account} placeholder={DEFAULT_CONTACT_ACCOUNT} onSave={(v) => update({ account: v.trim() || DEFAULT_CONTACT_ACCOUNT })} />
      </Field>
      <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
        <button className="btn sm" onClick={find}>Check accounts on this phone</button>
        {accounts?.map((a) => <button key={a} className={`chip ${a === s.account ? 'on' : ''}`} onClick={() => update({ account: a })}>{a}</button>)}
      </div>
      {accounts && !accounts.includes(s.account) && (
        <div className="faint" style={{ fontSize: '0.78rem', marginTop: 8 }}>
          {s.account} isn't syncing contacts on this phone, so numbers are saved on the phone only. Add it in Android Settings → Passwords &amp; accounts and turn on Contacts sync.
        </div>
      )}
      {s.mode === 'connected' && <div className="faint" style={{ fontSize: '0.75rem', marginTop: 8 }}>Calls your Mac sends to this phone aren't saved in this mode (the phone doesn't see their outcome).</div>}
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
        <Field label="Call script — placeholders: {company} {trade} {city} {name} {myName} {yelp} {google} ({yelp}/{google} say what you found online, blank until checked)" full>
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
  // Commas separate an opportunity's services, so a service name can't contain one.
  const clean = (v: string) => (k === 'services' ? cleanServiceName(v) : v.trim());
  return (
    <div className="card">
      <div className="card-head"><h3>{title}</h3></div>
      <div className="chips">
        {list.map((x) => (
          <span key={x} className="chip" style={{ cursor: 'default' }}>{x} <button className="btn ghost sm icon" style={{ padding: 0, marginLeft: 4 }} onClick={() => setSetting(k, list.filter((y) => y !== x))}>✕</button></span>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add…" onKeyDown={(e) => { if (e.key === 'Enter' && clean(add)) { setSetting(k, [...list, clean(add)]); setAdd(''); } }} />
        <button className="btn" onClick={() => { if (clean(add)) { setSetting(k, [...list, clean(add)]); setAdd(''); } }}>Add</button>
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
