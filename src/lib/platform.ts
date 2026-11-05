import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface DesktopBridge {
  http(req: { url: string; method: string; body?: string }): Promise<{ status: number; text: string }>;
  openExternal(url: string): Promise<void>;
  version(): Promise<string>;
  checkForUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onUpdateState(cb: (s: UpdateState) => void): () => void;
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
  version?: string;
  progress?: number;
  error?: string;
}

interface NativePlugin {
  call(opts: { number: string }): Promise<{ method: string }>;
  http(opts: { url: string; method: string; body?: string }): Promise<{ status: number; text: string }>;
  installApk(opts: { url: string }): Promise<{ status: string }>;
  keepAwake(opts: { on: boolean }): Promise<void>;
  addListener(event: 'downloadProgress', cb: (d: { progress: number }) => void): Promise<PluginListenerHandle>;
}

declare global {
  interface Window { tradelinkDesktop?: DesktopBridge }
}

export const Native = registerPlugin<NativePlugin>('TradeLinkNative');

export const isDesktop = () => typeof window !== 'undefined' && !!window.tradelinkDesktop;
export const isAndroid = () => Capacitor.getPlatform() === 'android';
export const platformName = () => (isDesktop() ? 'mac' : isAndroid() ? 'android' : 'web');

/** HTTP request that bypasses browser CORS when running natively. */
export async function httpRequest(url: string, method: 'GET' | 'POST', body?: string): Promise<{ status: number; text: string }> {
  if (isDesktop()) return window.tradelinkDesktop!.http({ url, method, body });
  if (isAndroid()) return Native.http({ url, method, body });
  const res = await fetch(url, { method, body, redirect: 'follow', headers: body ? { 'Content-Type': 'text/plain;charset=utf-8' } : undefined });
  return { status: res.status, text: await res.text() };
}

export const cleanPhone = (p: string) => (p || '').replace(/[^\d+]/g, '');

/** Place a phone call. On Android this dials directly through the phone's SIM. */
export async function placeCall(phone: string): Promise<void> {
  const num = cleanPhone(phone);
  if (!num) throw new Error('No phone number');
  if (isAndroid()) {
    await Native.call({ number: num });
    return;
  }
  if (isDesktop()) {
    await window.tradelinkDesktop!.openExternal(`tel:${num}`);
    return;
  }
  window.location.href = `tel:${num}`;
}

export function openExternal(url: string) {
  if (isDesktop()) window.tradelinkDesktop!.openExternal(url);
  else window.open(url, '_blank');
}
