import { useSyncExternalStore } from 'react';
import { APK_URL, LATEST_JSON_URL } from './constants';
import { isAndroid, isDesktop, Native, type UpdateState } from './platform';

declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__;

let state: UpdateState = { status: 'idle' };
const listeners = new Set<() => void>();
const set = (s: UpdateState) => { state = s; listeners.forEach((l) => l()); };
export const useUpdateState = () =>
  useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);

export function newer(a: string, b: string) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

const autoInstall = () => localStorage.getItem('tl.autoUpdate') !== 'off';

export async function checkForUpdate(manual = false): Promise<UpdateState> {
  if (isDesktop()) {
    const s = await window.tradelinkDesktop!.checkForUpdate();
    set(s);
    return s;
  }
  if (!isAndroid()) { set({ status: 'none' }); return state; }
  if (['downloading', 'installing'].includes(state.status)) return state;
  set({ status: 'checking' });
  try {
    const res = await Native.http({ url: `${LATEST_JSON_URL}?t=${Date.now()}`, method: 'GET' });
    const info = JSON.parse(res.text);
    if (info.version && newer(info.version, APP_VERSION)) {
      set({ status: 'available', version: info.version });
      if (autoInstall() && !manual) installUpdate();
    } else set({ status: 'none', version: info.version });
  } catch (e: any) {
    set({ status: 'error', error: e?.message || String(e) });
  }
  return state;
}

export async function installUpdate() {
  if (isDesktop()) return window.tradelinkDesktop!.installUpdate();
  if (!isAndroid()) return;
  const v = state.version;
  set({ status: 'downloading', version: v, progress: 0 });
  const h = await Native.addListener('downloadProgress', (d) => set({ status: 'downloading', version: v, progress: d.progress }));
  try {
    const r = await Native.installApk({ url: APK_URL });
    if (r.status === 'needs-permission') set({ status: 'available', version: v, error: 'Allow "Install unknown apps" for TradeLink CRM — the update continues automatically when you come back.' });
    else set({ status: 'installing', version: v });
  } catch (e: any) {
    set({ status: 'error', version: v, error: e?.message || String(e) });
  } finally {
    h.remove();
  }
}

export function startUpdateChecks() {
  if (isDesktop()) {
    window.tradelinkDesktop!.onUpdateState((s) => set(s));
  }
  setTimeout(() => checkForUpdate(), 4000);
  setInterval(() => checkForUpdate(), 3 * 60 * 60 * 1000);
}
