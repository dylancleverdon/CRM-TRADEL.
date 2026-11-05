import { useSyncExternalStore } from 'react';
import { httpRequest } from './platform';
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
  'https://script.google.com/macros/s/AKfycbwmZbXvkch8AG8MdvdBjeR0cHbxWcloUoTu2D7PQvlIz-Jx722dsBsbMFRAsgByOO4BFA/exec';
const LS_SINCE = 'tl.syncSince';
const LS_LAST = 'tl.lastSyncedAt';

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

export const getSyncUrl = () => localStorage.getItem(LS_URL) || DEFAULT_SYNC_URL;
export function setSyncUrl(url: string) {
  const clean = url.trim();
  if (clean) localStorage.setItem(LS_URL, clean);
  else localStorage.removeItem(LS_URL);
  localStorage.setItem(LS_SINCE, '0');
  setState({ status: 'idle', error: '' });
}

async function call(body: unknown) {
  const url = getSyncUrl();
  const res = await httpRequest(url, 'POST', JSON.stringify(body));
  let parsed: any;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    if (/<html/i.test(res.text) && /sign in|accounts\.google/i.test(res.text))
      throw new Error('Google asked for sign-in. Re-deploy the Apps Script with "Who has access: Anyone".');
    throw new Error(`Unexpected response from the sync script (HTTP ${res.status}). Check the URL ends in /exec.`);
  }
  if (!parsed.ok) throw new Error(parsed.error || 'Sync failed');
  return parsed;
}

export async function testConnection(url: string) {
  const res = await httpRequest(url.trim(), 'POST', JSON.stringify({ action: 'ping' }));
  const parsed = JSON.parse(res.text);
  if (!parsed.ok) throw new Error(parsed.error || 'Ping failed');
  return parsed as { sheet: string };
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
