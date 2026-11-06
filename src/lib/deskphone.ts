/**
 * "Ring my phone": the Mac app places calls through the Android phone.
 * Mac  -> callRequest (stored in the Apps Script) -> phone polls every 3s -> phone dials.
 */
import { useSyncExternalStore } from 'react';
import { saveCalledNumber } from './phonecontacts';
import { pollPhoneRequests } from './texts';
import { httpRequest, isAndroid, isDesktop, Native, placeCall } from './platform';
import { getSyncUrl } from './sync';

const LS_DESK = 'tl.deskPhone';
const LS_MODE = 'tl.desktopCallMode';
const POLL_MS = 3000;

export type DesktopCallMode = 'phone' | 'mac';
export const getDesktopCallMode = (): DesktopCallMode => (localStorage.getItem(LS_MODE) as DesktopCallMode) || 'phone';
export const setDesktopCallMode = (m: DesktopCallMode) => localStorage.setItem(LS_MODE, m);

interface DeskState { enabled: boolean; listening: boolean; lastCall: string; error: string }
let state: DeskState = { enabled: localStorage.getItem(LS_DESK) === 'on', listening: false, lastCall: '', error: '' };
const listeners = new Set<() => void>();
const set = (p: Partial<DeskState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); };
export const useDeskPhone = () =>
  useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);

async function script(body: unknown) {
  const res = await httpRequest(getSyncUrl(), 'POST', JSON.stringify(body));
  let parsed: any;
  try { parsed = JSON.parse(res.text); } catch { throw new Error('Sync script did not respond'); }
  if (!parsed.ok) {
    if (/Unknown action/i.test(parsed.error || ''))
      throw new Error('Your Google Apps Script needs updating for "Ring my phone" (Settings → Show setup instructions).');
    throw new Error(parsed.error || 'Request failed');
  }
  return parsed;
}

export interface RingRequest { number: string; name: string; entityType: string; entityId: string }

/** Called on the Mac. Resolves with how long ago the phone last checked in (-1 = never). */
export async function ringPhone(req: RingRequest): Promise<{ id: string; phoneSeenAgo: number }> {
  return script({ action: 'callRequest', req });
}

/** Mac: wait (up to ~20s) for the phone to confirm it started dialing. */
export async function waitForAck(id: string, timeoutMs = 20000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const r = await script({ action: 'callPoll' });
      if (r.ack === id) return true;
    } catch { /* keep trying */ }
  }
  return false;
}

// ---------------- phone side ----------------
const LS_HANDLED = 'tl.deskHandled';
let timer: any = null;
let textTimer: any = null;
/** Texts / contacts the Mac asks the phone to send or save (through the private email connector). */
const TEXT_POLL_MS = 5000;
let polling = false;

async function pollOnce() {
  if (polling || document.visibilityState !== 'visible') return;
  polling = true;
  try {
    const r = await script({ action: 'callPoll', phone: true });
    set({ listening: true, error: '' });
    const req = r.req;
    if (req && req.id && req.id !== localStorage.getItem(LS_HANDLED)) {
      localStorage.setItem(LS_HANDLED, req.id);
      set({ lastCall: `${req.name || req.number} · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` });
      await placeCall(req.number);
      saveCalledNumber({ type: req.entityType, id: req.entityId }, req.number, null, false).catch(() => {});
      script({ action: 'callPoll', phone: true, ack: req.id }).catch(() => {});
    }
  } catch (e: any) {
    set({ listening: false, error: e?.message || String(e) });
  } finally {
    polling = false;
  }
}

function applyListener() {
  clearInterval(timer);
  clearInterval(textTimer);
  timer = null;
  textTimer = null;
  if (!isAndroid()) return;
  Native.keepAwake({ on: state.enabled }).catch(() => {});
  if (state.enabled) {
    pollOnce();
    timer = setInterval(pollOnce, POLL_MS);
    pollPhoneRequests();
    textTimer = setInterval(pollPhoneRequests, TEXT_POLL_MS);
  } else set({ listening: false });
}

export function setDeskPhone(on: boolean) {
  localStorage.setItem(LS_DESK, on ? 'on' : 'off');
  set({ enabled: on, error: '' });
  applyListener();
}

export function startDeskPhone() {
  if (!isAndroid()) return;
  applyListener();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.enabled) pollOnce();
  });
}

export const deskPhoneSupported = () => isAndroid();
export const ringPhoneSupported = () => isDesktop();
