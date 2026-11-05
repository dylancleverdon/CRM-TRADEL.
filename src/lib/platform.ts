import { Browser } from '@capacitor/browser';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface DesktopBridge {
  http(req: { url: string; method: string; body?: string }): Promise<{ status: number; text: string }>;
  openExternal(url: string): Promise<void>;
  /** Opens a page in a window docked beside the CRM (newer desktop builds). */
  openSide?(url: string): Promise<void>;
  /** Brings the CRM window to the front (e.g. after clicking a notification). */
  focus?(): Promise<void>;
  /** Number on the dock icon (0 clears it). */
  setBadge?(n: number): Promise<void>;
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
  saveContact(opts: { name: string; company: string; phone: string; title?: string; note?: string; account?: string; group?: string }):
    Promise<{ status: 'saved' | 'saved-on-phone' | 'exists'; name?: string; account?: string }>;
  listAccounts(): Promise<{ accounts: string[] }>;
  sendSms(opts: { number: string; body: string; noPrompt?: boolean }): Promise<{ parts: number }>;
  checkPermissions(): Promise<{ call?: string; contacts?: string; sms?: string }>;
  requestPermissions(opts?: { permissions: string[] }): Promise<{ call?: string; contacts?: string; sms?: string }>;
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

/**
 * Opens a web page next to the CRM so it stays visible during a call: a window docked beside the app on the Mac,
 * an in-app browser tab on Android (back returns to the call), a new tab in a browser.
 */
export async function openBeside(url: string): Promise<void> {
  if (isDesktop()) {
    const d = window.tradelinkDesktop!;
    await (d.openSide ? d.openSide(url) : d.openExternal(url));
    return;
  }
  if (isAndroid()) {
    try { await Browser.open({ url }); return; } catch { /* fall back to the system browser */ }
  }
  window.open(url, '_blank');
}

/**
 * A system notification (Mac app / browser). The Android app's web view can't show them, so there the caller's
 * in-app alert is what you see.
 */
export function notify(title: string, body: string, onClick?: () => void) {
  if (isAndroid() || typeof Notification === 'undefined') return;
  const show = () => {
    const n = new Notification(title, { body });
    n.onclick = () => { window.focus(); window.tradelinkDesktop?.focus?.(); onClick?.(); n.close(); };
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && show()).catch(() => {});
}

export function openExternal(url: string) {
  if (isDesktop()) window.tradelinkDesktop!.openExternal(url);
  else window.open(url, '_blank');
}
