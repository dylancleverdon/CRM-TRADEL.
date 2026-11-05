import { Monitor, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { deskPhoneSupported, getDesktopCallMode, ringPhoneSupported, setDeskPhone, setDesktopCallMode, useDeskPhone, type DesktopCallMode } from '../lib/deskphone';

/** Settings card: how calls are placed on this device. */
export function CallingSettings() {
  const desk = useDeskPhone();
  const [mode, setMode] = useState<DesktopCallMode>(getDesktopCallMode());
  return (
    <div className="card">
      <div className="card-head"><h3>Calling</h3></div>
      {ringPhoneSupported() && (
        <div className="stack">
          <p className="muted" style={{ fontSize: '0.88rem' }}>When you click <b>Call</b> on the Mac:</p>
          <label className="row" style={{ alignItems: 'flex-start' }}>
            <input type="radio" checked={mode === 'phone'} onChange={() => { setMode('phone'); setDesktopCallMode('phone'); }} />
            <span><b><Smartphone size={14} /> Ring my Android phone</b> (recommended)<br />
              <span className="faint" style={{ fontSize: '0.8rem' }}>Your phone dials the number on your own line within ~3 seconds. Keep TradeLink open on the phone with <b>Desk phone mode</b> on. Log the outcome here on the Mac.</span></span>
          </label>
          <label className="row" style={{ alignItems: 'flex-start' }}>
            <input type="radio" checked={mode === 'mac'} onChange={() => { setMode('mac'); setDesktopCallMode('mac'); }} />
            <span><b><Monitor size={14} /> Use this Mac</b><br />
              <span className="faint" style={{ fontSize: '0.8rem' }}>Opens FaceTime / "Calls from iPhone" (iPhone only) or another calling app.</span></span>
          </label>
        </div>
      )}
      {deskPhoneSupported() && (
        <div className="stack">
          <DeskPhoneToggle />
          <p className="faint" style={{ fontSize: '0.8rem' }}>
            Lets the Mac app place calls through this phone. Keep TradeLink open on screen (it stays awake while this is on) — e.g. on a stand next to your Mac.
            {desk.error && <><br /><span style={{ color: 'var(--bad)' }}>{desk.error}</span></>}
          </p>
        </div>
      )}
      {!ringPhoneSupported() && !deskPhoneSupported() && <p className="faint">Calls open your device's dialer.</p>}
    </div>
  );
}

export function DeskPhoneToggle() {
  const desk = useDeskPhone();
  if (!deskPhoneSupported()) return null;
  return (
    <label className="row" style={{ fontWeight: 600 }}>
      <input type="checkbox" checked={desk.enabled} onChange={(e) => setDeskPhone(e.target.checked)} />
      <Smartphone size={16} /> Desk phone mode
      {desk.enabled && <span className={`pill ${desk.listening ? 'good' : 'warn'}`}>{desk.listening ? 'Listening for Mac calls' : 'Connecting…'}</span>}
    </label>
  );
}

/** Thin banner shown on the phone while desk phone mode is on. */
export function DeskPhoneBanner() {
  const desk = useDeskPhone();
  if (!deskPhoneSupported() || !desk.enabled) return null;
  return (
    <div className="banner">
      <Smartphone size={15} />
      <span style={{ flex: 1 }}>
        Desk phone mode {desk.listening ? 'on — calls from your Mac will dial here' : '— connecting…'}
        {desk.lastCall && <span className="faint"> · last: {desk.lastCall}</span>}
      </span>
      <button className="btn sm" onClick={() => setDeskPhone(false)}>Turn off</button>
    </div>
  );
}
