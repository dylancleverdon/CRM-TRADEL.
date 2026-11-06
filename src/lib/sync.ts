import { useSyncExternalStore } from 'react';
import { httpRequest, isAndroid, isDesktop } from './platform';
import { store } from './store';
import { TABLES, type TableName } from './types';

export interface SyncState {
  status: 'not-configured' | 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncedAt: number;
  error: string;
  pending: number;
}

const LS_URL = 'tl.syncUrl';
/** TradeLink's Google Sheet ("CRM Tradelink Data Storage") — used unless another URL is set in Settings. */
export const DEFAULT_SYNC_URL =
  'https://script.google.com/macros/s/AKfycbwfcYLWddHT-9JJ4-TcWJkTucaQUzKsQ8aAp5hg_jbyrlSYC5B16ZOxMZfd9WLRacC4Jw/exec';
const LS_SINCE = 'tl.syncSince';
const LS_LAST = 'tl.lastSyncedAt';
const LS_KEY = 'tl.syncKey';
const LS_DEVICE = 'tl.deviceId';

// ---------------------------------------------------------------- security

/** The private sync key: stored only on this device, never in the sheet's data or in the code. */
export const getSyncKey = () => localStorage.getItem(LS_KEY) || '';
export function setSyncKey(key: string) {
  const k = key.trim();
  if (k) localStorage.setItem(LS_KEY, k);
  else localStorage.removeItem(LS_KEY);
}

function deviceInfo() {
  let id = localStorage.getItem(LS_DEVICE);
  if (!id) {
    id = (crypto as any).randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(LS_DEVICE, id);
  }
  return { id, name: isDesktop() ? 'Mac' : isAndroid() ? 'Android phone' : 'Browser' };
}

export const thisDeviceId = () => deviceInfo().id;

/** Every request to the sheet carries this device's key (once set) and who it is. */
export function withAuth<T extends object>(body: T) {
  const key = getSyncKey();
  return { ...body, ...(key ? { key } : {}), device: deviceInfo() };
}

export interface SecurityInfo {
  locked: boolean;
  keyed: boolean;
  sheetUrl?: string;
  devices?: Record<string, { name: string; keyed: boolean; at: number }>;
  backup?: { copies: { slot: string; at: number; url: string }[]; error: string };
}
let security: SecurityInfo | null = null;
const securityListeners = new Set<() => void>();
function setSecurity(s: SecurityInfo | null | undefined) {
  if (!s) return;
  security = s;
  securityListeners.forEach((l) => l());
}
/** What the sheet last said about the lock, this device's key, devices and backups (null = old server code). */
export const useSecurity = () =>
  useSyncExternalStore((fn) => { securityListeners.add(fn); return () => securityListeners.delete(fn); }, () => security);

let state: SyncState = {
  status: 'idle',
  lastSyncedAt: Number(localStorage.getItem(LS_LAST) || 0),
  error: '',
  pending: 0,
};
const listeners = new Set<() => void>();
const setState = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const useSyncState = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );

/** Earlier TradeLink deployments; a device that saved one of these is moved to the current one. */
const RETIRED_URLS = [
  'https://script.google.com/macros/s/AKfycbwmZbXvkch8AG8MdvdBjeR0cHbxWcloUoTu2D7PQvlIz-Jx722dsBsbMFRAsgByOO4BFA/exec',
  'https://script.google.com/macros/s/AKfycbwfy9oIAwRTjv9-va29_ZMvoh0_tXdVFzcu8mZ1ff_NPAITpyKU90VFJaxQpK2oX-7A0w/exec',
];
export const getSyncUrl = () => {
  const saved = localStorage.getItem(LS_URL);
  return saved && !RETIRED_URLS.includes(saved.trim()) ? saved : DEFAULT_SYNC_URL;
};
export function setSyncUrl(url: string) {
  const clean = url.trim();
  if (clean) localStorage.setItem(LS_URL, clean);
  else localStorage.removeItem(LS_URL);
  localStorage.setItem(LS_SINCE, '0');
  setState({ status: 'idle', error: '' });
}

async function call(body: object) {
  const url = getSyncUrl();
  const res = await httpRequest(url, 'POST', JSON.stringify(withAuth(body)));
  let parsed: any;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    if (/<html/i.test(res.text) && /sign in|accounts\.google/i.test(res.text))
      throw new Error('Google asked for sign-in. Re-deploy the Apps Script with "Who has access: Anyone".');
    throw new Error(`Unexpected response from the sync script (HTTP ${res.status}). Check the URL ends in /exec.`);
  }
  if (!parsed.ok) {
    if (parsed.code === 'locked') setSecurity({ locked: true, keyed: false });
    throw new Error(parsed.error || 'Sync failed');
  }
  setSecurity(parsed.security);
  return parsed;
}

export async function testConnection(url: string) {
  const res = await httpRequest(url.trim(), 'POST', JSON.stringify(withAuth({ action: 'ping' })));
  const parsed = JSON.parse(res.text);
  if (!parsed.ok) throw new Error(parsed.error || 'Ping failed');
  if (parsed.locked && !parsed.keyed) setSecurity({ locked: true, keyed: false });
  else setSecurity(parsed.security);
  return parsed as { sheet: string };
}

/** Checks a key against the sheet without saving it. */
export async function checkSyncKey(key: string): Promise<boolean> {
  const res = await httpRequest(getSyncUrl(), 'POST', JSON.stringify({ ...withAuth({ action: 'ping' }), key: key.trim() }));
  const parsed = JSON.parse(res.text);
  return !!(parsed.ok && (parsed.security?.keyed || parsed.keyed));
}

/** Saves the key on this device and refreshes what the sheet says about it. */
export async function saveSyncKey(key: string): Promise<boolean> {
  const ok = await checkSyncKey(key);
  if (!ok) return false;
  setSyncKey(key);
  await call({ action: 'ping' }).catch(() => {});
  syncNow();
  return true;
}

/**
 * Mac: hand this device's key to the phone through the private email connector (the phone, in Desk phone mode,
 * saves it and syncs). Throws a readable reason if it can't.
 */
export async function sendKeyToPhone(onStatus?: (s: string) => void): Promise<void> {
  const key = getSyncKey();
  if (!key) throw new Error('Save the sync key on this Mac first');
  const { emailConnected } = await import('./email');
  if (!emailConnected()) throw new Error('Connect your email on this Mac and the phone first (Email tab), or paste the key on the phone yourself.');
  const { relayToPhone } = await import('./phonerelay');
  const ack = await relayToPhone('keyRequest', { key }, 'keyAck', onStatus);
  if (!ack.ok) throw new Error(ack.error || 'The phone could not save the key');
}

/** From now on the sheet refuses every request without the key. */
export async function lockCrm(): Promise<void> {
  await call({ action: 'lock' });
}

let running: Promise<void> | null = null;
let again = false;

export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = doSync().finally(() => {
    running = null;
    if (again) {
      again = false;
      syncNow();
    }
  });
  return running;
}

async function doSync() {
  if (!getSyncUrl()) {
    setState({ status: 'not-configured', pending: store.dirtyCount() });
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setState({ status: 'offline', pending: store.dirtyCount() });
    return;
  }
  setState({ status: 'syncing', error: '' });
  try {
    const sent: Record<string, Map<string, string>> = {};
    const changes: Record<string, any[]> = {};
    for (const t of TABLES) {
      const ids = Array.from(store.dirty[t]);
      sent[t] = new Map();
      changes[t] = ids
        .map((id) => store.data[t].get(id))
        .filter(Boolean)
        .map((r) => {
          sent[t].set(r!.id, r!.updatedAt);
          return r;
        });
    }
    const since = Number(localStorage.getItem(LS_SINCE) || 0);
    const res = await call({ action: 'sync', since, changes });

    // clear dirty flags for records that did not change while we were syncing
    for (const t of TABLES) {
      for (const [id, upd] of sent[t]) {
        if (store.data[t].get(id)?.updatedAt === upd) store.dirty[t].delete(id);
      }
    }
    for (const t of Object.keys(res.changes || {}) as TableName[]) {
      if (TABLES.includes(t)) store.applyRemote(t, res.changes[t]);
    }
    store.scheduleSave();
    localStorage.setItem(LS_SINCE, String(res.serverTime));
    localStorage.setItem(LS_LAST, String(Date.now()));
    setState({ status: 'idle', lastSyncedAt: Date.now(), pending: store.dirtyCount(), error: '' });
  } catch (e: any) {
    setState({ status: 'error', error: e?.message || String(e), pending: store.dirtyCount() });
  }
}

/** Pull everything from the sheet again (keeps unsynced local changes). */
export async function fullResync() {
  localStorage.setItem(LS_SINCE, '0');
  await syncNow();
}

let debounce: any = null;
export function startAutoSync() {
  store.onLocalChange = () => {
    setState({ pending: store.dirtyCount() });
    clearTimeout(debounce);
    debounce = setTimeout(() => syncNow(), 2500);
  };
  syncNow();
  setInterval(() => syncNow(), 45_000);
  window.addEventListener('online', () => syncNow());
  window.addEventListener('focus', () => syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
}
